// Bump METRICS_VERSION whenever any definition below changes, even when the shape stays, because Postlude only compares days with the same version.
//
// Coverage statuses:
// - complete: the source gave everything.
// - partial: the source was reachable but didn't give everything. Numbers it gave are lower bounds, and numbers it couldn't give are null.
// - missing: the source was unreachable, and its numbers are null.
//
// Definitions:
// - Activity numbers and categories are copied from the activity summary (Contract 1). They are null when the summary is unavailable or every host is missing.
// - offComputerMinutes: time tracked in Super Productivity on the day on tasks tagged OFF_COMPUTER_TAG, or whose parent task carries the tag. Only tasks without subtasks count, because a parent's tracked time is the sum of its subtasks'. SP files time under its own date keys, which follow its "start of next day" setting rather than the 04:00 journal boundary.
// - appointmentMinutes: the union of all timed calendar events, clipped to the journal day, so overlapping events count once. All-day events don't count.
// - appointmentOffScreenMinutes: the part of that union outside the active screen intervals of both hosts. It needs `activeIntervals` in the activity summary and every host complete, because screen time on a host that wasn't fully read would count as off screen.
// - landedPrs: pull requests authored by the davidvornholt account and merged during the journal day, in any repository.
// - sentMails: messages in each mailbox's Sent folder dated within the journal day.

import { compareText } from "./compare.ts";
import type { DayWindow } from "./day.ts";
import { clip, type Interval, subtract, totalMinutes, union } from "./intervals.ts";
import type { CalendarEvent, Reading, SentMailData, Sources, SpData } from "./sources.ts";

export const METRICS_VERSION = 1;
export const SUMMARY_VERSION = 1;
export const OFF_COMPUTER_TAG = "off-computer";

export type CoverageStatus = "complete" | "partial" | "missing";
export type Coverage = { readonly source: string; readonly status: CoverageStatus };
export type Category = { readonly id: string; readonly label: string; readonly minutes: number };

export type DayMetrics = {
  readonly metricsVersion: number;
  readonly day: string;
  readonly activeMinutes: number | null;
  readonly firstActivityAt: string | null;
  readonly lastActivityAt: string | null;
  readonly focusMinutes: number | null;
  readonly scatteredMinutes: number | null;
  readonly categories: readonly Category[];
  readonly offComputerMinutes: number | null;
  readonly appointmentMinutes: number | null;
  readonly appointmentOffScreenMinutes: number | null;
  readonly landedPrs: number | null;
  readonly sentMails: readonly { readonly mailbox: string; readonly count: number | null }[];
  readonly coverage: readonly Coverage[];
};

type Summary = {
  readonly hosts: readonly { readonly host: string; readonly status: CoverageStatus; readonly activeMinutes: number | null }[];
  readonly activeMinutes: number | null;
  readonly firstActivityAt: string | null;
  readonly lastActivityAt: string | null;
  readonly focusMinutes: number | null;
  readonly scatteredMinutes: number | null;
  readonly categories: readonly Category[];
  readonly activeIntervals: readonly Interval[] | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isMinutes = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isInstant = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isStatus = (value: unknown): value is CoverageStatus => value === "complete" || value === "partial" || value === "missing";

const minutesOrNull = (value: unknown, path: string): number | null => {
  if (value === null) return null;
  if (isMinutes(value)) return value;
  throw new Error(`${path} is not a number of minutes`);
};

const instantOrNull = (value: unknown, path: string): string | null => {
  if (value === null) return null;
  if (isInstant(value)) return value;
  throw new Error(`${path} is not a timestamp`);
};

export const parseSummary = (raw: unknown, day: string): Summary => {
  if (!isRecord(raw)) throw new Error("the activity summary is not a JSON object");
  if (raw.summaryVersion !== SUMMARY_VERSION) {
    throw new Error(
      `the activity summary has summaryVersion ${String(raw.summaryVersion)}, but the metrics read version ${SUMMARY_VERSION}; update metrics.ts and bump METRICS_VERSION`,
    );
  }
  if (raw.day !== day) throw new Error(`the activity summary is for ${String(raw.day)}, not ${day}`);
  if (!Array.isArray(raw.hosts)) throw new Error("hosts is not a list");
  const hosts = raw.hosts.map((host, index) => {
    if (!isRecord(host) || typeof host.host !== "string" || !isStatus(host.status)) throw new Error(`hosts[${index}] has no host name and status`);
    return { host: host.host, status: host.status, activeMinutes: minutesOrNull(host.activeMinutes, `hosts[${index}].activeMinutes`) };
  });
  if (!Array.isArray(raw.categories)) throw new Error("categories is not a list");
  const categories = raw.categories.map((category, index) => {
    if (!isRecord(category) || typeof category.id !== "string" || typeof category.label !== "string" || !isMinutes(category.minutes)) {
      throw new Error(`categories[${index}] needs an id, a label, and minutes`);
    }
    return { id: category.id, label: category.label, minutes: category.minutes };
  });
  // activeIntervals is not in Contract 1 yet; without it the off-screen appointment time stays null.
  let activeIntervals: Interval[] | null = null;
  if (raw.activeIntervals !== undefined) {
    if (!Array.isArray(raw.activeIntervals)) throw new Error("activeIntervals is not a list");
    activeIntervals = raw.activeIntervals.map((interval, index) => {
      if (!isRecord(interval) || !isInstant(interval.start) || !isInstant(interval.end)) throw new Error(`activeIntervals[${index}] needs a start and an end`);
      return { start: Date.parse(interval.start), end: Date.parse(interval.end) };
    });
  }
  return {
    hosts,
    activeMinutes: minutesOrNull(raw.activeMinutes, "activeMinutes"),
    firstActivityAt: instantOrNull(raw.firstActivityAt, "firstActivityAt"),
    lastActivityAt: instantOrNull(raw.lastActivityAt, "lastActivityAt"),
    focusMinutes: minutesOrNull(raw.focusMinutes, "focusMinutes"),
    scatteredMinutes: minutesOrNull(raw.scatteredMinutes, "scatteredMinutes"),
    categories,
    activeIntervals,
  };
};

type Part<T> = { readonly value: T; readonly coverage: readonly Coverage[]; readonly problems: readonly string[] };

const activityPart = (reading: Reading<unknown>, day: string): Part<Summary | null> => {
  if (!reading.ok) return { value: null, coverage: [{ source: "activity", status: "missing" }], problems: [`Activity summary unavailable: ${reading.error}`] };
  let summary: Summary;
  try {
    summary = parseSummary(reading.value, day);
  } catch (error) {
    return { value: null, coverage: [{ source: "activity", status: "missing" }], problems: [`Activity summary unusable: ${(error as Error).message}`] };
  }
  const coverage: Coverage[] = summary.hosts
    .map((host) => ({ source: `activity:${host.host}`, status: host.status }))
    .toSorted((a, b) => compareText(a.source, b.source));
  if (coverage.length === 0) coverage.push({ source: "activity", status: "missing" });
  const problems: string[] = [];
  const allComplete = summary.hosts.every((host) => host.status === "complete");
  if (summary.activeIntervals === null) {
    coverage.push({ source: "activity:intervals", status: "missing" });
    problems.push("The activity summary has no activeIntervals, so off-screen appointment time is unknown.");
  } else if (!allComplete) {
    problems.push("Some activity hosts were not complete, so off-screen appointment time is unknown.");
  }
  const anyHost = summary.hosts.some((host) => host.status !== "missing");
  return { value: anyHost ? { ...summary, activeIntervals: allComplete ? summary.activeIntervals : null } : null, coverage, problems };
};

const offComputerMinutes = (sp: SpData, day: string): Part<number | null> => {
  const tag = sp.tags.find((candidate) => candidate.title.trim().toLowerCase() === OFF_COMPUTER_TAG);
  if (!tag) {
    return {
      value: null,
      coverage: [{ source: "sp", status: "partial" }],
      problems: [`Super Productivity has no tag named "${OFF_COMPUTER_TAG}", so off-computer time is unknown.`],
    };
  }
  const byId = new Map(sp.tasks.map((task) => [task.id, task]));
  let milliseconds = 0;
  for (const task of sp.tasks) {
    if (task.subTaskIds.some((id) => byId.has(id))) continue;
    const parent = task.parentId === null ? undefined : byId.get(task.parentId);
    if (task.tagIds.includes(tag.id) || parent?.tagIds.includes(tag.id)) milliseconds += task.timeSpentOnDay[day] ?? 0;
  }
  return { value: Math.round(milliseconds / 60_000), coverage: [{ source: "sp", status: "complete" }], problems: [] };
};

const spPart = (reading: Sources["sp"], day: string): Part<number | null> =>
  reading.ok
    ? offComputerMinutes(reading.value, day)
    : { value: null, coverage: [{ source: "sp", status: "missing" }], problems: [`Super Productivity unavailable: ${reading.error}`] };

const inWindow = (ms: number, window: DayWindow): boolean => ms >= window.startMs && ms < window.endMs;

const githubPart = (reading: Sources["github"], window: DayWindow): Part<number | null> => {
  if (!reading.ok) return { value: null, coverage: [{ source: "github", status: "missing" }], problems: [`GitHub unavailable: ${reading.error}`] };
  const count = reading.value.prs.filter((pr) => inWindow(Date.parse(pr.mergedAt), window)).length;
  return {
    value: count,
    coverage: [{ source: "github", status: reading.value.incomplete ? "partial" : "complete" }],
    problems: reading.value.incomplete ? ["GitHub reported incomplete search results, so landed PRs may be undercounted."] : [],
  };
};

const mailboxCount = (mailbox: string, reading: Reading<SentMailData>, window: DayWindow): Part<number | null> => {
  const source = `mail:${mailbox}`;
  if (!reading.ok) return { value: null, coverage: [{ source, status: "missing" }], problems: [`Sent mail of ${mailbox} unavailable: ${reading.error}`] };
  const times = reading.value.sentAt.map((sentAt) => Date.parse(sentAt));
  const valid = times.filter((ms) => !Number.isNaN(ms));
  const problems: string[] = [];
  if (valid.length < times.length) problems.push(`Some sent mail of ${mailbox} has no readable date.`);
  // The search returns the newest mail first, so a full page whose oldest message is inside the day may have left out older ones.
  const truncated = reading.value.limitReached && (valid.length === 0 || Math.min(...valid) >= window.startMs);
  if (truncated) problems.push(`The sent-mail search of ${mailbox} hit its limit inside the day.`);
  return {
    value: valid.filter((ms) => inWindow(ms, window)).length,
    coverage: [{ source, status: problems.length > 0 ? "partial" : "complete" }],
    problems,
  };
};

const toInterval = (event: CalendarEvent): Interval | null => {
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return Number.isNaN(start) || Number.isNaN(end) ? null : { start, end };
};

type CalendarResult = { readonly appointments: readonly Interval[] | null };

const calendarPart = (reading: Sources["calendar"], window: DayWindow): Part<CalendarResult> => {
  if (!reading.ok)
    return { value: { appointments: null }, coverage: [{ source: "calendar", status: "missing" }], problems: [`Calendar unavailable: ${reading.error}`] };
  const coverage: Coverage[] = [];
  const problems: string[] = [];
  const intervals: Interval[] = [];
  let anyAccount = false;
  for (const { account, events, failure } of reading.value.accounts) {
    const source = `calendar:${account}`;
    if (failure !== null && events.length === 0) {
      coverage.push({ source, status: "missing" });
      problems.push(`Calendar of ${account} unavailable: ${failure}`);
      continue;
    }
    anyAccount = true;
    let status: CoverageStatus = failure !== null || reading.value.limitReached ? "partial" : "complete";
    if (failure !== null) problems.push(`Some calendar events of ${account} were unreadable: ${failure}`);
    for (const event of events) {
      if (event.allDay) continue;
      const interval = toInterval(event);
      if (interval === null) {
        status = "partial";
        problems.push(`A calendar event of ${account} has an unreadable time.`);
      } else {
        intervals.push(interval);
      }
    }
    coverage.push({ source, status });
  }
  if (reading.value.limitReached) problems.push("The calendar search hit its event limit, so appointment time may be undercounted.");
  return {
    value: { appointments: anyAccount ? union(clip(intervals, { start: window.startMs, end: window.endMs })) : null },
    coverage: coverage.toSorted((a, b) => compareText(a.source, b.source)),
    problems,
  };
};

export type ComputedMetrics = { readonly dayMetrics: DayMetrics; readonly problems: readonly string[] };

export const computeDayMetrics = (window: DayWindow, sources: Sources): ComputedMetrics => {
  const activity = activityPart(sources.summary, window.day);
  const sp = spPart(sources.sp, window.day);
  const github = githubPart(sources.github, window);
  const mailboxes = sources.mail.ok
    ? sources.mail.value
        .map(({ mailbox, reading }) => ({ mailbox, part: mailboxCount(mailbox, reading, window) }))
        .toSorted((a, b) => compareText(a.mailbox, b.mailbox))
    : [];
  const mailProblems = sources.mail.ok ? mailboxes.flatMap(({ part }) => part.problems) : [`Mail accounts unavailable: ${sources.mail.error}`];
  const mailCoverage: Coverage[] = sources.mail.ok ? mailboxes.flatMap(({ part }) => part.coverage) : [{ source: "mail", status: "missing" }];
  const calendar = calendarPart(sources.calendar, window);

  const summary = activity.value;
  const appointments = calendar.value.appointments;
  const activeIntervals = summary?.activeIntervals ?? null;

  const dayMetrics: DayMetrics = {
    metricsVersion: METRICS_VERSION,
    day: window.day,
    activeMinutes: summary?.activeMinutes ?? null,
    firstActivityAt: summary?.firstActivityAt ?? null,
    lastActivityAt: summary?.lastActivityAt ?? null,
    focusMinutes: summary?.focusMinutes ?? null,
    scatteredMinutes: summary?.scatteredMinutes ?? null,
    categories: (summary?.categories ?? []).toSorted((a, b) => b.minutes - a.minutes || compareText(a.id, b.id)),
    offComputerMinutes: sp.value,
    appointmentMinutes: appointments === null ? null : totalMinutes(appointments),
    appointmentOffScreenMinutes: appointments === null || activeIntervals === null ? null : totalMinutes(subtract(appointments, activeIntervals)),
    landedPrs: github.value,
    sentMails: mailboxes.map(({ mailbox, part }) => ({ mailbox, count: part.value })),
    coverage: [...activity.coverage, ...sp.coverage, ...github.coverage, ...mailCoverage, ...calendar.coverage],
  };
  return { dayMetrics, problems: [...activity.problems, ...sp.problems, ...github.problems, ...mailProblems, ...calendar.problems] };
};
