// The day's timeline and its parts. The report draws the timeline, and the agent writes a title and a few lines per part.
//
// A part starts as a stretch of the user's screen time: the timeline's pieces joined across gaps shorter than PART_GAP_MINUTES. A stretch with less than PART_MIN_MINUTES of screen time joins the stretch before it, or the one after it when it comes first, so a short check at night doesn't need lines of its own. Things that happened, such as a landed pull request, a prompt or an agent's run, belong to the part whose bound holds them: from the start of its stretch to the start of the next one, the first part from the start of the journal day, and the last part to its end. A part's printed time range covers its screen time and everything placed in it, so it can begin before its stretch and end after it.

import { compareText } from "./compare.ts";
import { type DayWindow, toBerlinClock, toBerlinIso } from "./day.ts";
import { clip, type Interval, joinGaps, totalMinutes, totalMs, union } from "./intervals.ts";
import { type FocusBlock, parseSummary, type Summary, type TimelinePiece, type WindowPiece } from "./metrics.ts";
import type { ListStatus } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";

export const PART_GAP_MINUTES = 30;
export const PART_MIN_MINUTES = 10;
/** The threads listed per part, those with the most prompts and then the most agent time first. */
export const PART_THREADS = 12;
/** The windows listed per part, those in front longest first, and the least time a window needs in a part to be listed. */
export const PART_WINDOWS = 12;
export const PART_WINDOW_MIN_MINUTES = 2;

// T3 Code's own windows, as nix-config's activity-summary.json matches them under t3Windows. The part's threads already say what happened there.
const T3_APP = /^(com\.t3tools\.T3Code|t3code)$/i;
const T3_TITLE = /^T3 Code( \(Beta\))?$/i;
const REDACTED = "<redacted>";

export const UNCATEGORISED = "Not categorised";

export type Prompt = { readonly at: number; readonly fromPhone: boolean };

/** A T3 Code thread the user prompted or an agent ran in, with its subagents folded in. */
export type TimelineThread = {
  readonly id: string;
  readonly title: string;
  readonly project: string;
  /** The summary category that files the thread's project, so the thread sits with the screen time it got; null when none does. */
  readonly category: string | null;
  /** When at least one agent of the thread was running. */
  readonly runs: readonly Interval[];
  readonly prompts: readonly Prompt[];
};

/** What the report draws; the agent doesn't need to read it. Times are epoch milliseconds, clipped to the journal day. */
export type Timeline = {
  readonly status: ListStatus;
  readonly pieces: readonly TimelinePiece[];
  readonly focusBlocks: readonly FocusBlock[];
  readonly categoryLabels: Readonly<Record<string, string>>;
  readonly threads: { readonly status: ListStatus; readonly items: readonly TimelineThread[] };
  /** Send times only, from the mailboxes that could be read. */
  readonly sentMail: { readonly status: ListStatus; readonly times: readonly number[] };
};

export type DayPart = {
  readonly start: string;
  readonly end: string;
  /** start and end as clock times, such as "09:10–11:45": the first and last minute of the part's screen time, prompts, agent runs, and the tasks, threads, pull requests and appointments placed in it. */
  readonly clock: string;
  readonly screenMinutes: number;
  readonly areas: readonly { readonly label: string; readonly minutes: number }[];
  readonly projects: readonly { readonly project: string; readonly screenMinutes: number; readonly agentMinutes: number }[];
  readonly threads: readonly { readonly title: string; readonly project: string; readonly prompts: number; readonly agentMinutes: number }[];
  /** The user's own windows, without T3 Code's and redacted ones. title is null for a Windows program. They hold window titles, so they are for the agent's text only and never reach the report or Postlude. */
  readonly windows: readonly { readonly app: string | null; readonly title: string | null; readonly minutes: number }[];
};

/** A T3 project's name in the report: the last folder of its path. */
export const projectLabel = (project: string): string => project.split("/").filter(Boolean).at(-1) ?? project;

const windowInterval = (window: DayWindow): Interval => ({ start: window.startMs, end: window.endMs });

const clipped = <T extends Interval>(items: readonly T[], window: Interval): T[] =>
  items.flatMap((item) => clip([item], window).map((interval) => ({ ...item, ...interval })));

const minutes = (ms: number): number => Math.round(ms / 60_000);

const inDay = (ms: number, day: Interval): boolean => ms >= day.start && ms < day.end;

/** The activity summary, or null when it is unusable or no host was read. */
const usableSummary = (window: DayWindow, sources: Sources): Summary | null => {
  if (!sources.summary.ok) return null;
  try {
    const summary = parseSummary(sources.summary.value, window.day);
    return summary.hosts.every((host) => host.status === "missing") ? null : summary;
  } catch {
    return null;
  }
};

/** The summary's windows within the journal day. They hold window titles, so they stay out of the timeline, which the collected file keeps. */
export const dayWindows = (window: DayWindow, sources: Sources): WindowPiece[] =>
  clipped(usableSummary(window, sources)?.windows ?? [], windowInterval(window));

const dayThreads = (window: DayWindow, sources: Sources, summary: Summary | null): Timeline["threads"] => {
  if (!sources.t3.ok) return { status: "missing", items: [] };
  const day = windowInterval(window);
  const { dayThreads: threads, runs, prompts } = sources.t3.value;
  const categories = new Map<string, string>();
  for (const category of summary?.categories ?? []) for (const project of category.t3Projects) categories.set(project, category.id);
  const items = threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    project: thread.project,
    category: categories.get(thread.project) ?? null,
    runs: union(
      clip(
        runs.filter((run) => run.threadId === thread.id).map((run) => ({ start: Date.parse(run.start), end: Date.parse(run.end) })),
        day,
      ),
    ),
    prompts: prompts
      .filter((prompt) => prompt.threadId === thread.id)
      .map((prompt) => ({ at: Date.parse(prompt.at), fromPhone: prompt.fromPhone }))
      .filter((prompt) => inDay(prompt.at, day))
      .toSorted((a, b) => a.at - b.at),
  }));
  return { status: "complete", items: items.filter((thread) => thread.runs.length > 0 || thread.prompts.length > 0) };
};

/** The mail sent within the journal day from the mailboxes that could be read, the earliest first. */
export const sentMails = (
  window: DayWindow,
  sources: Sources,
): { readonly status: ListStatus; readonly items: readonly { readonly mailbox: string; readonly at: number; readonly subject: string }[] } => {
  if (!sources.mail.ok) return { status: "missing", items: [] };
  const day = windowInterval(window);
  const read = sources.mail.value.flatMap(({ mailbox, reading }) => (reading.ok ? [{ mailbox, ...reading.value }] : []));
  const items = read
    .flatMap(({ mailbox, sent }) => sent.map((mail) => ({ mailbox, at: Date.parse(mail.at), subject: mail.subject })))
    .filter((mail) => inDay(mail.at, day))
    .toSorted((a, b) => a.at - b.at || compareText(a.mailbox, b.mailbox));
  const status =
    read.length === 0 ? "missing" : read.length < sources.mail.value.length || read.some((mailbox) => mailbox.limitReached) ? "partial" : "complete";
  return { status, items };
};

const sentMail = (window: DayWindow, sources: Sources): Timeline["sentMail"] => {
  const { status, items } = sentMails(window, sources);
  return { status, times: items.map((mail) => mail.at) };
};

export const buildTimeline = (window: DayWindow, sources: Sources): Timeline => {
  const day = windowInterval(window);
  const summary = usableSummary(window, sources);
  const threads = dayThreads(window, sources, summary);
  const mail = sentMail(window, sources);
  if (summary === null) return { status: "missing", pieces: [], focusBlocks: [], categoryLabels: {}, threads, sentMail: mail };
  return {
    status: summary.hosts.every((host) => host.status === "complete") ? "complete" : "partial",
    pieces: clipped(summary.timeline, day),
    focusBlocks: clipped(summary.focusBlocks, day),
    categoryLabels: Object.fromEntries(summary.categories.map((category) => [category.id, category.label])),
    threads,
    sentMail: mail,
  };
};

const stretches = (pieces: readonly TimelinePiece[]): Interval[] => {
  const joined = joinGaps(pieces, PART_GAP_MINUTES * 60_000);
  // Unrounded, so a stretch of nine and a half minutes doesn't count as ten.
  const short = (stretch: Interval) => totalMs(clip(pieces, stretch)) < PART_MIN_MINUTES * 60_000;
  const kept: Interval[] = [];
  for (const stretch of joined) {
    const last = kept.at(-1);
    if (last && short(stretch)) kept[kept.length - 1] = { start: last.start, end: stretch.end };
    else if (last && short(last)) kept[kept.length - 1] = { start: last.start, end: stretch.end };
    else kept.push(stretch);
  }
  return kept;
};

/** Where things that happened at a time belong: part i covers bounds[i]. There is one bound per part. */
export type PartBounds = readonly Interval[];

export const partBounds = (window: DayWindow, timeline: Timeline): PartBounds => {
  const found = stretches(timeline.pieces);
  return found.map((stretch, index) => ({
    start: index === 0 ? window.startMs : stretch.start,
    end: found[index + 1]?.start ?? window.endMs,
  }));
};

/** The index of the part an instant belongs to, or null when the day has no parts or the instant lies outside it. */
export const partAt = (bounds: PartBounds, ms: number): number | null => {
  const index = bounds.findIndex((bound) => ms >= bound.start && ms < bound.end);
  return index === -1 ? null : index;
};

const byMinutes = <T extends { readonly minutes: number; readonly label: string }>(a: T, b: T): number =>
  b.minutes - a.minutes || compareText(a.label, b.label);

/** When something placed in a part happened: an instant, with start equal to end, or an appointment. */
export type Moment = Interval & { readonly part: number | null };

const ownWindow = ({ app, title }: WindowPiece): boolean =>
  (app !== null || title !== null) && app !== REDACTED && title !== REDACTED && !T3_APP.test(app ?? "") && !T3_TITLE.test(title ?? "");

const partWindows = (windows: readonly WindowPiece[], bound: Interval): DayPart["windows"] => {
  const byWindow = new Map<string, { app: string | null; title: string | null; intervals: Interval[] }>();
  for (const piece of clipped(windows.filter(ownWindow), bound)) {
    const key = JSON.stringify([piece.app, piece.title]);
    const entry = byWindow.get(key) ?? { app: piece.app, title: piece.title, intervals: [] };
    byWindow.set(key, entry);
    entry.intervals.push(piece);
  }
  return [...byWindow.values()]
    .map((entry) => ({ ...entry, ms: totalMs(entry.intervals) }))
    .filter((entry) => entry.ms >= PART_WINDOW_MIN_MINUTES * 60_000)
    .toSorted((a, b) => b.ms - a.ms || compareText(a.app ?? "", b.app ?? "") || compareText(a.title ?? "", b.title ?? ""))
    .slice(0, PART_WINDOWS)
    .map(({ app, title, ms }) => ({ app, title, minutes: minutes(ms) }));
};

export const buildParts = (timeline: Timeline, bounds: PartBounds, moments: readonly Moment[], windows: readonly WindowPiece[]): DayPart[] =>
  bounds.map((bound, index): DayPart => {
    const pieces = clipped(timeline.pieces, bound);
    const threads = timeline.threads.items.map((thread) => ({
      thread,
      runs: clip(thread.runs, bound),
      prompts: thread.prompts.filter((prompt) => inDay(prompt.at, bound)),
    }));
    // An appointment can begin before the journal day or run into the next part, so only its time within this part's bound counts.
    const placed = moments
      .filter((moment) => moment.part === index)
      .map((moment) => ({ start: Math.max(moment.start, bound.start), end: Math.min(moment.end, bound.end) }));
    // Every part has screen time, so the range is never empty.
    const covered = [
      ...pieces,
      ...threads.flatMap((entry) => [...entry.runs, ...entry.prompts.map((prompt) => ({ start: prompt.at, end: prompt.at }))]),
      ...placed,
    ];
    const start = Math.min(...covered.map((interval) => interval.start));
    const end = Math.max(...covered.map((interval) => interval.end));
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
    for (const entry of threads) project(entry.thread.project).agent.push(...entry.runs);
    return {
      start: toBerlinIso(start),
      end: toBerlinIso(end),
      clock: `${toBerlinClock(start)}–${toBerlinClock(end)}`,
      screenMinutes: totalMinutes(pieces),
      areas: [...areas]
        .map(([label, ms]) => ({ label, minutes: minutes(ms) }))
        .filter((area) => area.minutes > 0)
        .toSorted(byMinutes),
      projects: [...projects]
        .map(([path, time]) => ({ project: projectLabel(path), screenMinutes: totalMinutes(time.screen), agentMinutes: totalMinutes(time.agent) }))
        .filter((entry) => entry.screenMinutes + entry.agentMinutes > 0)
        .toSorted((a, b) => b.screenMinutes + b.agentMinutes - (a.screenMinutes + a.agentMinutes) || compareText(a.project, b.project)),
      threads: threads
        .map((entry) => ({
          title: entry.thread.title,
          project: projectLabel(entry.thread.project),
          prompts: entry.prompts.length,
          agentMinutes: totalMinutes(entry.runs),
        }))
        .filter((thread) => thread.prompts > 0 || thread.agentMinutes > 0)
        .toSorted((a, b) => b.prompts - a.prompts || b.agentMinutes - a.agentMinutes || compareText(a.title, b.title))
        .slice(0, PART_THREADS),
      windows: partWindows(windows, bound),
    };
  });
