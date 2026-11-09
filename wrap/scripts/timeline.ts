// The day's timeline and its parts. The report draws the timeline, and the agent writes one paragraph per part.
//
// A part is a stretch of the user's screen time: the timeline's pieces joined across gaps shorter than PART_GAP_MINUTES. A stretch with less than PART_MIN_MINUTES of screen time joins the stretch before it, or the one after it when it comes first, so a short check at night doesn't need a paragraph of its own. For placing things that happened, such as a landed pull request or an agent's run, part i runs from its start to the start of part i + 1, the first part from the start of the journal day, and the last part to its end.

import { compareText } from "./compare.ts";
import { type DayWindow, toBerlinClock, toBerlinIso } from "./day.ts";
import { clip, type Interval, totalMinutes, union } from "./intervals.ts";
import { type FocusBlock, parseSummary, type TimelinePiece } from "./metrics.ts";
import type { ListStatus } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";

export const PART_GAP_MINUTES = 30;
export const PART_MIN_MINUTES = 10;
/** The threads listed per part, those with the most agent time first. */
export const PART_THREADS = 12;

export const UNCATEGORISED = "Not categorised";

export type AgentRun = Interval & { readonly project: string; readonly threadTitle: string };

/** What the report draws; the agent doesn't need to read it. Times are epoch milliseconds, clipped to the journal day. */
export type Timeline = {
  readonly status: ListStatus;
  readonly pieces: readonly TimelinePiece[];
  readonly focusBlocks: readonly FocusBlock[];
  readonly categoryLabels: Readonly<Record<string, string>>;
  readonly agentRuns: { readonly status: ListStatus; readonly items: readonly AgentRun[] };
};

export type DayPart = {
  readonly start: string;
  readonly end: string;
  /** The stretch's first and last minute of screen time, such as "09:10–11:45". */
  readonly clock: string;
  readonly screenMinutes: number;
  readonly areas: readonly { readonly label: string; readonly minutes: number }[];
  readonly projects: readonly { readonly project: string; readonly screenMinutes: number; readonly agentMinutes: number }[];
  readonly threads: readonly { readonly title: string; readonly project: string; readonly agentMinutes: number }[];
};

/** A T3 project's name in the report: the last folder of its path. */
export const projectLabel = (project: string): string => project.split("/").filter(Boolean).at(-1) ?? project;

const windowInterval = (window: DayWindow): Interval => ({ start: window.startMs, end: window.endMs });

const clipped = <T extends Interval>(items: readonly T[], window: Interval): T[] =>
  items.flatMap((item) => clip([item], window).map((interval) => ({ ...item, ...interval })));

const minutes = (ms: number): number => Math.round(ms / 60_000);

export const buildTimeline = (window: DayWindow, sources: Sources): Timeline => {
  const day = windowInterval(window);
  const agentRuns: Timeline["agentRuns"] = sources.t3.ok
    ? {
        status: "complete",
        items: clipped(
          sources.t3.value.runs.map((run) => ({ start: Date.parse(run.start), end: Date.parse(run.end), project: run.project, threadTitle: run.threadTitle })),
          day,
        ),
      }
    : { status: "missing", items: [] };
  const empty = { status: "missing", pieces: [], focusBlocks: [], categoryLabels: {}, agentRuns } as const;
  if (!sources.summary.ok) return empty;
  let summary: ReturnType<typeof parseSummary>;
  try {
    summary = parseSummary(sources.summary.value, window.day);
  } catch {
    return empty;
  }
  if (summary.hosts.every((host) => host.status === "missing")) return empty;
  return {
    status: summary.hosts.every((host) => host.status === "complete") ? "complete" : "partial",
    pieces: clipped(summary.timeline, day),
    focusBlocks: clipped(summary.focusBlocks, day),
    categoryLabels: Object.fromEntries(summary.categories.map((category) => [category.id, category.label])),
    agentRuns,
  };
};

const stretches = (pieces: readonly TimelinePiece[]): Interval[] => {
  const joined: Interval[] = [];
  for (const piece of union(pieces)) {
    const last = joined.at(-1);
    if (last && piece.start - last.end < PART_GAP_MINUTES * 60_000) joined[joined.length - 1] = { start: last.start, end: piece.end };
    else joined.push(piece);
  }
  const screen = (stretch: Interval) => totalMinutes(clip(pieces, stretch));
  const kept: Interval[] = [];
  for (const stretch of joined) {
    const last = kept.at(-1);
    if (last && screen(stretch) < PART_MIN_MINUTES) kept[kept.length - 1] = { start: last.start, end: stretch.end };
    else if (last && screen(last) < PART_MIN_MINUTES) kept[kept.length - 1] = { start: last.start, end: stretch.end };
    else kept.push(stretch);
  }
  return kept;
};

/** Where things that happened at a time belong: part i covers bounds[i] up to bounds[i + 1]. */
export type PartBounds = readonly Interval[];

export const partBounds = (window: DayWindow, parts: readonly Interval[]): PartBounds =>
  parts.map((part, index) => ({
    start: index === 0 ? window.startMs : part.start,
    end: parts[index + 1]?.start ?? window.endMs,
  }));

/** The index of the part an instant belongs to, or null when the day has no parts or the instant lies outside it. */
export const partAt = (bounds: PartBounds, ms: number): number | null => {
  const index = bounds.findIndex((bound) => ms >= bound.start && ms < bound.end);
  return index === -1 ? null : index;
};

const byMinutes = <T extends { readonly minutes: number; readonly label: string }>(a: T, b: T): number =>
  b.minutes - a.minutes || compareText(a.label, b.label);

export const buildParts = (window: DayWindow, timeline: Timeline): { readonly parts: readonly DayPart[]; readonly bounds: PartBounds } => {
  const found = stretches(timeline.pieces);
  const bounds = partBounds(window, found);
  const parts = found.map((stretch, index): DayPart => {
    const bound = bounds[index] as Interval;
    const pieces = clipped(timeline.pieces, bound);
    const runs = clipped(timeline.agentRuns.items, bound);
    const areas = new Map<string, number>();
    const projects = new Map<string, { screen: Interval[]; agent: Interval[] }>();
    const project = (path: string) => {
      const time = projects.get(path) ?? { screen: [], agent: [] };
      projects.set(path, time);
      return time;
    };
    for (const piece of pieces) {
      const label = piece.category === null ? UNCATEGORISED : (timeline.categoryLabels[piece.category] ?? piece.category);
      areas.set(label, (areas.get(label) ?? 0) + piece.end - piece.start);
      if (piece.project !== null) project(piece.project).screen.push(piece);
    }
    const threads = new Map<string, { title: string; project: string; runs: Interval[] }>();
    for (const run of runs) {
      project(run.project).agent.push(run);
      const key = JSON.stringify([run.project, run.threadTitle]);
      const thread = threads.get(key) ?? { title: run.threadTitle, project: run.project, runs: [] };
      threads.set(key, thread);
      thread.runs.push(run);
    }
    return {
      start: toBerlinIso(stretch.start),
      end: toBerlinIso(stretch.end),
      clock: `${toBerlinClock(stretch.start)}–${toBerlinClock(stretch.end)}`,
      screenMinutes: totalMinutes(pieces),
      areas: [...areas]
        .map(([label, ms]) => ({ label, minutes: minutes(ms) }))
        .filter((area) => area.minutes > 0)
        .toSorted(byMinutes),
      projects: [...projects]
        .map(([path, time]) => ({ project: projectLabel(path), screenMinutes: totalMinutes(time.screen), agentMinutes: totalMinutes(time.agent) }))
        .filter((entry) => entry.screenMinutes + entry.agentMinutes > 0)
        .toSorted((a, b) => b.screenMinutes + b.agentMinutes - (a.screenMinutes + a.agentMinutes) || compareText(a.project, b.project)),
      threads: [...threads.values()]
        .map((thread) => ({ title: thread.title, project: projectLabel(thread.project), agentMinutes: totalMinutes(thread.runs) }))
        .filter((thread) => thread.agentMinutes > 0)
        .toSorted((a, b) => b.agentMinutes - a.agentMinutes || compareText(a.title, b.title))
        .slice(0, PART_THREADS),
    };
  });
  return { parts, bounds };
};
