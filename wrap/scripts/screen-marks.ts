// The marks of one area's row of screen time in the report's timeline: a mark for each stretch of the area's screen time, with what its card says, and one for each of the area's focus blocks.
//
// A stretch is the area's screen time joined across gaps shorter than SWITCH_GRACE_MINUTES. That is the stretch the activity summary's focus rule tests (focus_blocks in nix-config's bin/activity-digest): a run of one area lasts while every switch away, to another area, to a window in no area, or away from the computer, is shorter than two minutes, and it is a focus block when its time at the computer, those switches included, is at least FOCUS_MIN_MINUTES. The summary's focus blocks decide whether a stretch counted, so a card never disagrees with them; a stretch can differ from the run the summary tested only where its start counted toward another area's focus block.

import { compareText } from "./compare.ts";
import { toBerlinIso } from "./day.ts";
import { clip, type Interval, joinGaps, totalMs } from "./intervals.ts";
import type { FocusBlock, TimelinePiece } from "./metrics.ts";
import { label, type ScreenFocus, type ScreenMark, type TimelineMark } from "./report-document.ts";
import { projectLabel, type Timeline, threadTitle } from "./timeline.ts";

/** The summary's focus rule: a switch away this long ends a run, and a focus block needs this much time at the computer. */
export const SWITCH_GRACE_MINUTES = 2;
export const FOCUS_MIN_MINUTES = 25;
/** What a stretch's card names, those with the most time first, and the least time an app or window needs in the stretch to be named. */
export const APPS_PER_MARK = 5;
export const WINDOWS_PER_MARK = 3;
export const PROJECTS_PER_MARK = 5;
export const THREADS_PER_MARK = 5;
export const NAMED_MIN_MINUTES = 1;

const MINUTE_MS = 60_000;

/** Whole minutes, cut down, so a stretch just short of FOCUS_MIN_MINUTES never shows as long enough. */
const wholeMinutes = (ms: number): number => Math.floor(ms / MINUTE_MS);
const roundMinutes = (ms: number): number => Math.round(ms / MINUTE_MS);
const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && a.end > b.start;

/** The time each key had within screen, the most first, without keys under NAMED_MIN_MINUTES. */
const ranked = <T extends Interval>(pieces: readonly T[], screen: readonly Interval[], keyOf: (piece: T) => string | null) => {
  const byKey = new Map<string, number>();
  for (const piece of pieces) {
    const key = keyOf(piece);
    if (key === null) continue;
    const ms = totalMs(clip(screen, piece));
    if (ms > 0) byKey.set(key, (byKey.get(key) ?? 0) + ms);
  }
  return [...byKey]
    .filter(([, ms]) => ms >= NAMED_MIN_MINUTES * MINUTE_MS)
    .toSorted(([a, left], [b, right]) => right - left || compareText(a, b))
    .map(([key, ms]) => ({ key, ms }));
};

/** A focus block's time at the computer, which counts the short switches it spans, as the summary's focus minutes do. */
export const focusMinutes = (pieces: readonly TimelinePiece[], block: Interval): number => roundMinutes(totalMs(clip(pieces, block)));

export type Area = {
  readonly category: string | null;
  readonly pieces: readonly TimelinePiece[];
  /** The label of an area by its category, for a focus block of another area. */
  readonly areaLabel: (category: string) => string;
};

const focusOf = (area: Area, stretch: Interval, timeline: Timeline): ScreenFocus => {
  if (area.category === null) return { status: "noArea" };
  const block = timeline.focusBlocks.find((entry) => entry.category === area.category && overlaps(entry, stretch));
  if (block !== undefined) {
    const start = Math.max(block.start, stretch.start);
    const end = Math.min(block.end, stretch.end);
    return { status: "counted", start: toBerlinIso(start), end: toBerlinIso(end), minutes: focusMinutes(timeline.pieces, block) };
  }
  const minutes = wholeMinutes(totalMs(clip(timeline.pieces, stretch)));
  if (minutes < FOCUS_MIN_MINUTES) return { status: "short", minutes, needs: FOCUS_MIN_MINUTES };
  const other: FocusBlock | undefined = timeline.focusBlocks.find((entry) => entry.start <= stretch.start && entry.end > stretch.start);
  return { status: "notCounted", ...(other === undefined ? {} : { within: label(area.areaLabel(other.category)) }) };
};

const promptedIn = (area: Area, stretch: Interval, timeline: Timeline, names: ReadonlyMap<string, string>): string[] =>
  timeline.threads.items
    .flatMap((thread) => {
      if (thread.category !== area.category) return [];
      const first = thread.prompts.find((prompt) => prompt.at >= stretch.start && prompt.at <= stretch.end);
      return first === undefined ? [] : [{ name: names.get(thread.id) ?? threadTitle(thread), at: first.at }];
    })
    .toSorted((a, b) => a.at - b.at || compareText(a.name, b.name))
    .map((thread) => label(thread.name));

const screenMark = (area: Area, stretch: Interval, timeline: Timeline, names: ReadonlyMap<string, string>): ScreenMark => {
  const screen = clip(area.pieces, stretch);
  const inStretch = timeline.windows.filter((window) => overlaps(window, stretch));
  const apps = ranked(inStretch, screen, (window) => window.app).slice(0, APPS_PER_MARK);
  const windows = ranked(inStretch, screen, (window) => window.title).slice(0, WINDOWS_PER_MARK);
  const projects = ranked(
    area.pieces.filter((piece) => overlaps(piece, stretch)),
    screen,
    (piece) => (piece.project === null ? null : projectLabel(piece.project)),
  );
  const threads = promptedIn(area, stretch, timeline, names);
  return {
    kind: "screen",
    start: toBerlinIso(stretch.start),
    end: toBerlinIso(stretch.end),
    minutes: wholeMinutes(totalMs(screen)),
    ...(apps.length === 0 ? {} : { apps: apps.map(({ key, ms }) => ({ name: label(key), minutes: roundMinutes(ms) })) }),
    ...(projects.length === 0 ? {} : { projects: projects.slice(0, PROJECTS_PER_MARK).map(({ key }) => label(key)) }),
    ...(threads.length === 0 ? {} : { threads: threads.slice(0, THREADS_PER_MARK) }),
    ...(threads.length > THREADS_PER_MARK ? { moreThreads: threads.length - THREADS_PER_MARK } : {}),
    ...(windows.length === 0 ? {} : { windows: windows.map(({ key }) => label(key)) }),
    focus: focusOf(area, stretch, timeline),
  };
};

/** The row's marks: its stretches of screen time, then its focus blocks. names holds the agent's names for threads, by id. */
export const areaMarks = (area: Area, timeline: Timeline, names: ReadonlyMap<string, string>): TimelineMark[] => [
  ...joinGaps(area.pieces, SWITCH_GRACE_MINUTES * MINUTE_MS).map((stretch) => screenMark(area, stretch, timeline, names)),
  ...timeline.focusBlocks
    .filter((block) => block.category === area.category)
    .map(
      (block): TimelineMark => ({
        kind: "focus",
        start: toBerlinIso(block.start),
        end: toBerlinIso(block.end),
        minutes: focusMinutes(timeline.pieces, block),
      }),
    ),
];
