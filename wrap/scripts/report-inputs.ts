import { compareText } from "./compare.ts";
import { type DayWindow, eventOnDay, toBerlinDate, toBerlinIso } from "./day.ts";
import type { CalendarEvent, Sources, SpData, SpTask } from "./sources.ts";
import { buildParts, type DayPart, type PartBounds, partAt, type Timeline } from "./timeline.ts";

/** A thread counts as open for several days once it was created this many days before the end of the journal day. */
export const OPEN_THREAD_DAYS = 3;

export type ListStatus = "complete" | "partial" | "missing";
export type List<T> = { readonly status: ListStatus; readonly items: readonly T[] };

/** The index into `parts` of the part something happened in; null when the day has no parts or it has no time of day. */
type InPart = { readonly part: number | null };

export type ReportInputs = {
  readonly parts: readonly DayPart[];
  readonly handedOffTasks: List<{ readonly title: string; readonly project: string | null; readonly doneAt: string } & InPart>;
  readonly settledThreads: List<{ readonly title: string; readonly project: string; readonly settledAt: string } & InPart>;
  readonly openThreads: List<{ readonly title: string; readonly project: string; readonly openSince: string }>;
  readonly landedPrs: List<{ readonly repository: string; readonly title: string; readonly mergedAt: string } & InPart>;
  /** start and end are null for an all-day event. */
  readonly appointments: List<{ readonly title: string; readonly start: string | null; readonly end: string | null } & InPart>;
  /** Super Productivity tasks with time tracked on the day, the most time first. SP keeps only a total per day, so they have no time of day. */
  readonly offComputerTasks: List<{ readonly title: string; readonly project: string | null; readonly minutes: number }>;
  /**
   * Only whether Kontor has ever attempted a sync and whether the bank connection needs a new approval; never amounts.
   * Until its first attempt (lastSyncOutcome null) Kontor always reports approvalNeeded. An attempt that stopped early may leave lastSyncAt null.
   */
  readonly kontor: { readonly status: ListStatus; readonly attempted: boolean | null; readonly approvalNeeded: boolean | null };
};

const missing = <T>(): List<T> => ({ status: "missing", items: [] });

const inWindow = (ms: number, window: DayWindow): boolean => ms >= window.startMs && ms < window.endMs;

const spTaskNames = (sp: SpData) => {
  const tasks = new Map(sp.tasks.map((task) => [task.id, task]));
  const projects = new Map(sp.projects.map((project) => [project.id, project.title]));
  return (task: SpTask) => {
    const parent = task.parentId === null ? undefined : tasks.get(task.parentId);
    const projectId = task.projectId ?? parent?.projectId ?? null;
    return { title: parent ? `${parent.title} › ${task.title}` : task.title, project: projectId === null ? null : (projects.get(projectId) ?? null) };
  };
};

const handedOffTasks = (reading: Sources["sp"], window: DayWindow, bounds: PartBounds): ReportInputs["handedOffTasks"] => {
  if (!reading.ok) return missing();
  const name = spTaskNames(reading.value);
  const items = reading.value.tasks
    .filter((task): task is SpTask & { doneOn: number } => task.isDone && task.doneOn !== null && inWindow(task.doneOn, window))
    .toSorted((a, b) => a.doneOn - b.doneOn || compareText(a.id, b.id))
    .map((task) => ({ ...name(task), doneAt: toBerlinIso(task.doneOn), part: partAt(bounds, task.doneOn) }));
  return { status: "complete", items };
};

const offComputerTasks = (reading: Sources["sp"], day: string): ReportInputs["offComputerTasks"] => {
  if (!reading.ok) return missing();
  const name = spTaskNames(reading.value);
  const ids = new Set(reading.value.tasks.map((task) => task.id));
  const items = reading.value.tasks
    .filter((task) => !task.subTaskIds.some((id) => ids.has(id)))
    .map((task) => ({ ...name(task), minutes: Math.round((task.timeSpentOnDay[day] ?? 0) / 60_000) }))
    .filter((task) => task.minutes > 0)
    .toSorted((a, b) => b.minutes - a.minutes || compareText(a.title, b.title));
  return { status: "complete", items };
};

const settledThreads = (reading: Sources["t3"], window: DayWindow, bounds: PartBounds): ReportInputs["settledThreads"] => {
  if (!reading.ok) return missing();
  const items = reading.value.threads
    .flatMap((thread) => {
      const settledMs = thread.settledAt === null ? Number.NaN : Date.parse(thread.settledAt);
      return inWindow(settledMs, window) ? [{ thread, settledMs }] : [];
    })
    .toSorted((a, b) => a.settledMs - b.settledMs || compareText(a.thread.title, b.thread.title))
    .map(({ thread, settledMs }) => ({ title: thread.title, project: thread.project, settledAt: toBerlinIso(settledMs), part: partAt(bounds, settledMs) }));
  return { status: "complete", items };
};

const openThreads = (reading: Sources["t3"], window: DayWindow): ReportInputs["openThreads"] => {
  if (!reading.ok) return missing();
  const openedBefore = window.endMs - OPEN_THREAD_DAYS * 24 * 60 * 60_000;
  const items = reading.value.threads
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

const landedPrs = (reading: Sources["github"], window: DayWindow, bounds: PartBounds): ReportInputs["landedPrs"] => {
  if (!reading.ok) return missing();
  const items = reading.value.prs
    .map((pr) => ({ pr, mergedMs: Date.parse(pr.mergedAt) }))
    .filter(({ mergedMs }) => inWindow(mergedMs, window))
    .toSorted((a, b) => a.mergedMs - b.mergedMs || compareText(a.pr.repository, b.pr.repository))
    .map(({ pr, mergedMs }) => ({ repository: pr.repository, title: pr.title, mergedAt: toBerlinIso(mergedMs), part: partAt(bounds, mergedMs) }));
  return { status: reading.value.incomplete ? "partial" : "complete", items };
};

const appointments = (reading: Sources["calendar"], window: DayWindow, bounds: PartBounds): ReportInputs["appointments"] => {
  if (!reading.ok) return missing();
  const accounts = reading.value.accounts;
  const reachable = accounts.filter((account) => account.failure === null || account.events.length > 0);
  if (reachable.length === 0) return missing();
  const seen = new Set<string>();
  const events: CalendarEvent[] = [];
  let unanswered = false;
  for (const account of reachable) {
    for (const event of account.events) {
      if (event.cancelled || event.declined === true || !eventOnDay(event, window)) continue;
      if (event.declined === null) {
        unanswered = true;
        continue;
      }
      const key = JSON.stringify([event.summary, event.start, event.end, event.allDay]);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  const items = events
    .toSorted((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start) || compareText(a.summary, b.summary))
    .map((event) => {
      if (event.allDay) return { title: event.summary, start: null, end: null, part: null };
      const startMs = Date.parse(event.start);
      // An event that began before the journal day belongs to its first part.
      return {
        title: event.summary,
        start: toBerlinIso(startMs),
        end: toBerlinIso(Date.parse(event.end)),
        part: partAt(bounds, Math.max(startMs, window.startMs)),
      };
    });
  const complete = accounts.every((account) => account.failure === null) && !reading.value.limitReached && !unanswered;
  return { status: complete ? "complete" : "partial", items };
};

const kontor = (reading: Sources["kontor"]): ReportInputs["kontor"] => {
  const unknown = { status: "missing", attempted: null, approvalNeeded: null } as const;
  if (!reading.ok || typeof reading.value !== "object" || reading.value === null) return unknown;
  const { lastSyncOutcome, approvalNeeded } = reading.value as { lastSyncOutcome?: unknown; approvalNeeded?: unknown };
  if (typeof approvalNeeded !== "boolean" || (typeof lastSyncOutcome !== "string" && lastSyncOutcome !== null)) return unknown;
  return { status: "complete", attempted: lastSyncOutcome !== null, approvalNeeded };
};

export const buildReportInputs = (window: DayWindow, sources: Sources, timeline: Timeline): ReportInputs => {
  const { parts, bounds } = buildParts(window, timeline);
  return {
    parts,
    handedOffTasks: handedOffTasks(sources.sp, window, bounds),
    settledThreads: settledThreads(sources.t3, window, bounds),
    openThreads: openThreads(sources.t3, window),
    landedPrs: landedPrs(sources.github, window, bounds),
    appointments: appointments(sources.calendar, window, bounds),
    offComputerTasks: offComputerTasks(sources.sp, window.day),
    kontor: kontor(sources.kontor),
  };
};
