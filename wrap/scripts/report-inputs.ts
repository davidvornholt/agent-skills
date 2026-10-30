// Builds the lists the report shows next to the metrics. Pure and deterministic, like metrics.ts.

import { compareText } from "./compare.ts";
import { type DayWindow, toBerlinClock, toBerlinDate } from "./day.ts";
import type { CalendarEvent, Sources } from "./sources.ts";

/** A thread counts as open for several days once it was created this many days before the end of the journal day. */
export const OPEN_THREAD_DAYS = 3;

export type ListStatus = "complete" | "partial" | "missing";
export type List<T> = { readonly status: ListStatus; readonly items: readonly T[] };

export type ReportInputs = {
  readonly handedOffTasks: List<{ readonly title: string; readonly project: string | null }>;
  readonly settledThreads: List<{ readonly title: string; readonly project: string }>;
  readonly openThreads: List<{ readonly title: string; readonly project: string; readonly openSince: string }>;
  readonly landedPrs: List<{ readonly repository: string; readonly title: string }>;
  readonly appointments: List<{ readonly time: string | null; readonly title: string }>;
  /** Only whether the bank connection needs a new approval; never amounts. */
  readonly kontor: { readonly status: ListStatus; readonly approvalNeeded: boolean | null };
};

const missing = <T>(): List<T> => ({ status: "missing", items: [] });

const inWindow = (ms: number, window: DayWindow): boolean => ms >= window.startMs && ms < window.endMs;

const handedOffTasks = (reading: Sources["sp"], window: DayWindow): ReportInputs["handedOffTasks"] => {
  if (!reading.ok) return missing();
  const tasks = new Map(reading.value.tasks.map((task) => [task.id, task]));
  const projects = new Map(reading.value.projects.map((project) => [project.id, project.title]));
  const items = reading.value.tasks
    .filter((task) => task.isDone && task.doneOn !== null && inWindow(task.doneOn, window))
    .toSorted((a, b) => (a.doneOn ?? 0) - (b.doneOn ?? 0) || compareText(a.id, b.id))
    .map((task) => {
      const parent = task.parentId === null ? undefined : tasks.get(task.parentId);
      const projectId = task.projectId ?? parent?.projectId ?? null;
      return {
        title: parent ? `${parent.title} › ${task.title}` : task.title,
        project: projectId === null ? null : (projects.get(projectId) ?? null),
      };
    });
  return { status: "complete", items };
};

const settledThreads = (reading: Sources["t3"], window: DayWindow): ReportInputs["settledThreads"] => {
  if (!reading.ok) return missing();
  const items = reading.value
    .filter((thread) => thread.settledAt !== null && inWindow(Date.parse(thread.settledAt), window))
    .toSorted((a, b) => Date.parse(a.settledAt ?? "") - Date.parse(b.settledAt ?? "") || compareText(a.title, b.title))
    .map((thread) => ({ title: thread.title, project: thread.project }));
  return { status: "complete", items };
};

const openThreads = (reading: Sources["t3"], window: DayWindow): ReportInputs["openThreads"] => {
  if (!reading.ok) return missing();
  const openedBefore = window.endMs - OPEN_THREAD_DAYS * 24 * 60 * 60_000;
  const items = reading.value
    .filter((thread) => {
      const createdAt = Date.parse(thread.createdAt);
      const stillOpen = thread.settledAt === null || Date.parse(thread.settledAt) >= window.endMs;
      const snoozed = thread.snoozedUntil !== null && Date.parse(thread.snoozedUntil) > window.endMs;
      return createdAt <= openedBefore && stillOpen && !snoozed;
    })
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || compareText(a.title, b.title))
    .map((thread) => ({ title: thread.title, project: thread.project, openSince: toBerlinDate(Date.parse(thread.createdAt)) }));
  return { status: "complete", items };
};

const landedPrs = (reading: Sources["github"], window: DayWindow): ReportInputs["landedPrs"] => {
  if (!reading.ok) return missing();
  const items = reading.value.prs
    .filter((pr) => inWindow(Date.parse(pr.mergedAt), window))
    .toSorted((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt) || compareText(a.repository, b.repository))
    .map((pr) => ({ repository: pr.repository, title: pr.title }));
  return { status: reading.value.incomplete ? "partial" : "complete", items };
};

const coversDay = (event: CalendarEvent, window: DayWindow): boolean => {
  if (event.allDay) return event.start.slice(0, 10) <= window.day && window.day <= event.end.slice(0, 10);
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return start < window.endMs && end > window.startMs;
};

const appointments = (reading: Sources["calendar"], window: DayWindow): ReportInputs["appointments"] => {
  if (!reading.ok) return missing();
  const accounts = reading.value.accounts;
  const reachable = accounts.filter((account) => account.failure === null || account.events.length > 0);
  if (reachable.length === 0) return missing();
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  for (const account of reachable) {
    for (const event of account.events) {
      const key = JSON.stringify([event.summary, event.start, event.end, event.allDay]);
      if (seen.has(key) || !coversDay(event, window)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  const items = events
    .toSorted((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start) || compareText(a.summary, b.summary))
    .map((event) => ({
      time: event.allDay ? null : `${toBerlinClock(Date.parse(event.start))}–${toBerlinClock(Date.parse(event.end))}`,
      title: event.summary,
    }));
  const complete = accounts.every((account) => account.failure === null) && !reading.value.limitReached;
  return { status: complete ? "complete" : "partial", items };
};

const kontor = (reading: Sources["kontor"]): ReportInputs["kontor"] => {
  if (!reading.ok) return { status: "missing", approvalNeeded: null };
  const value = reading.value;
  if (typeof value !== "object" || value === null || typeof (value as { approvalNeeded?: unknown }).approvalNeeded !== "boolean") {
    return { status: "missing", approvalNeeded: null };
  }
  return { status: "complete", approvalNeeded: (value as { approvalNeeded: boolean }).approvalNeeded };
};

export const buildReportInputs = (window: DayWindow, sources: Sources): ReportInputs => ({
  handedOffTasks: handedOffTasks(sources.sp, window),
  settledThreads: settledThreads(sources.t3, window),
  openThreads: openThreads(sources.t3, window),
  landedPrs: landedPrs(sources.github, window),
  appointments: appointments(sources.calendar, window),
  kontor: kontor(sources.kontor),
});
