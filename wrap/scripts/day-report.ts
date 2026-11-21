import { buildConversations, type Conversation } from "./conversations.ts";
import type { DayWindow } from "./day.ts";
import { clip, type Interval, subtract } from "./intervals.ts";
import { computeDayMetrics, type DayMetrics, parseSummary } from "./metrics.ts";
import { buildReportInputs, type List, type ReportInputs } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";
import { buildTimeline, partBounds, type Timeline } from "./timeline.ts";

export type Collected = {
  readonly day: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly dayMetrics: DayMetrics;
  readonly reportInputs: ReportInputs;
  /** The day's T3 Code threads in full, for the agent to read; never stored. */
  readonly conversations: List<Conversation>;
  /** What the report's timeline draws, for compose only. */
  readonly timeline: Timeline;
  /** Why a source is missing or partial, for the agent; never stored. */
  readonly problems: readonly string[];
};

/** The journal day's pauses of the activity log, which hold even when no host could be read; none when the summary can't be read. */
const pauses = (window: DayWindow, sources: Sources): Interval[] => {
  if (!sources.summary.ok) return [];
  try {
    return clip(parseSummary(sources.summary.value, window.day).pausedIntervals, { start: window.startMs, end: window.endMs });
  } catch {
    return [];
  }
};

/**
 * The sources without what happened in T3 Code while the user paused the activity log: the prompts and messages in a pause, whoever wrote them, the threads settled in one, and the day threads with no prompt or run in the journal day outside the pauses.
 */
export const withoutPaused = (window: DayWindow, sources: Sources): Sources => {
  const paused = pauses(window, sources);
  if (!sources.t3.ok || paused.length === 0) return sources;
  const inPause = (at: string | null) => {
    const ms = at === null ? Number.NaN : Date.parse(at);
    return paused.some((pause) => ms >= pause.start && ms < pause.end);
  };
  const t3 = sources.t3.value;
  const prompts = t3.prompts.filter((prompt) => !inPause(prompt.at));
  const day = { start: window.startMs, end: window.endMs };
  const outside = new Set([
    ...prompts.map((prompt) => prompt.threadId),
    ...t3.runs.filter((run) => subtract(clip([{ start: Date.parse(run.start), end: Date.parse(run.end) }], day), paused).length > 0).map((run) => run.threadId),
  ]);
  const kept = ({ threadId }: { readonly threadId: string }) => outside.has(threadId);
  return {
    ...sources,
    t3: {
      ok: true,
      value: {
        threads: t3.threads.filter((thread) => !inPause(thread.settledAt)),
        dayThreads: t3.dayThreads.filter((thread) => outside.has(thread.id)),
        runs: t3.runs.filter(kept),
        prompts: prompts.filter(kept),
        messages: t3.messages.filter((message) => kept(message) && !inPause(message.at)),
      },
    },
  };
};

export const buildCollected = (window: DayWindow, read: Sources): Collected => {
  const sources = withoutPaused(window, read);
  const { dayMetrics, problems } = computeDayMetrics(window, sources);
  const timeline = buildTimeline(window, sources);
  const reportInputs = buildReportInputs(window, sources, timeline);
  const listProblems = [
    ...(sources.closedPrs.ok ? [] : [`Pull requests closed without merging unavailable: ${sources.closedPrs.error}`]),
    ...(sources.closedPrs.ok && sources.closedPrs.value.incomplete
      ? ["GitHub reported incomplete search results, so closed pull requests may be missing."]
      : []),
    ...(sources.t3.ok ? [] : [`T3 Code unavailable: ${sources.t3.error}`]),
    ...(sources.kontor.ok ? [] : [`Kontor status unavailable: ${sources.kontor.error}`]),
    ...(sources.kontor.ok && reportInputs.kontor.status === "missing" ? ["Kontor status has no approvalNeeded or lastSyncOutcome field."] : []),
  ];
  return {
    day: window.day,
    window: { start: window.start, end: window.end },
    dayMetrics,
    reportInputs,
    conversations: buildConversations(window, sources.t3, partBounds(window, timeline)),
    timeline,
    problems: [...problems, ...listProblems],
  };
};
