import { buildConversations, type Conversation } from "./conversations.ts";
import type { DayWindow } from "./day.ts";
import { computeDayMetrics, type DayMetrics } from "./metrics.ts";
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

export const buildCollected = (window: DayWindow, sources: Sources): Collected => {
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
