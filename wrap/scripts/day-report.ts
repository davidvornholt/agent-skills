// What `wrap.ts collect` prints: the day metrics, the report lists, and the reasons for any gaps.

import type { DayWindow } from "./day.ts";
import { computeDayMetrics, type DayMetrics } from "./metrics.ts";
import { buildReportInputs, type ReportInputs } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";

export type Collected = {
  readonly day: string;
  readonly window: { readonly start: string; readonly end: string };
  readonly dayMetrics: DayMetrics;
  readonly reportInputs: ReportInputs;
  /** Why a source is missing or partial, for the agent; never stored. */
  readonly problems: readonly string[];
};

export const buildCollected = (window: DayWindow, sources: Sources): Collected => {
  const { dayMetrics, problems } = computeDayMetrics(window, sources);
  const reportInputs = buildReportInputs(window, sources);
  const listProblems = [
    ...(sources.t3.ok ? [] : [`T3 Code threads unavailable: ${sources.t3.error}`]),
    ...(sources.kontor.ok ? [] : [`Kontor status unavailable: ${sources.kontor.error}`]),
    ...(sources.kontor.ok && reportInputs.kontor.status === "missing" ? ["Kontor status has no approvalNeeded field."] : []),
  ];
  return { day: window.day, window: { start: window.start, end: window.end }, dayMetrics, reportInputs, problems: [...problems, ...listProblems] };
};
