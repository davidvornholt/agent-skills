import { compareText } from "./compare.ts";
import { addDays, type DayWindow, eventOnDay, journalDayAt, toBerlinDate, toBerlinIso } from "./day.ts";
import { totalMinutes, totalMs } from "./intervals.ts";
import type { CalendarEvent, Sources, SpData, SpTask } from "./sources.ts";
import {
  buildParts,
  type DayPart,
  dayWindows,
  type Moment,
  type PartBounds,
  partAt,
  partBounds,
  projectLabel,
  sentMails,
  type Timeline,
  type TimelineThread,
  UNCATEGORISED,
} from "./timeline.ts";

/** A thread counts as open for several days once it was created this many days before the end of the journal day. */
export const OPEN_THREAD_DAYS = 3;

export type ListStatus = "complete" | "partial" | "missing";
export type List<T> = { readonly status: ListStatus; readonly items: readonly T[] };

/** The index into `parts` of the part something happened in; null when the day has no parts or it has no time of day. */
type InPart = { readonly part: number | null };

/** How the report refers to a pull request: "name#12", or "owner/name#12" when two of the day's repositories share the name. */
type Ref = { readonly repository: string; readonly number: number; readonly ref: string };

/** What was left open at the end of the day, as the sources recorded it. */
export type LooseEnds = {
  /** Pull requests linked to the day's T3 Code threads that were open at the end of the day; isDraft is as T3 last synced it. */
  readonly waitingPrs: List<Ref & { readonly title: string; readonly isDraft: boolean; readonly thread: string }>;
  /** Open Super Productivity tasks due or with a deadline by the next day, the earliest first. */
  readonly dueTasks: List<{
    readonly title: string;
    readonly project: string | null;
    readonly day: string;
    readonly kind: "due" | "deadline";
    readonly when: "overdue" | "today" | "tomorrow";
  }>;
  /** T3 Code threads with an agent still running at the end of the day. */
  readonly runningThreads: List<{ readonly title: string; readonly project: string }>;
};

type Peak = { readonly count: number; readonly at: string };

/** Figures for the report to print. Each is null when its source wasn't available. */
export type Facts = {
  readonly prompts: { readonly count: number; readonly fromPhone: number; readonly threads: number } | null;
  /** minutes adds up each thread's agent time; wallMinutes counts the time at least one agent ran. peak is the most threads with an agent running at once, and when that first happened. */
  readonly agents: {
    readonly minutes: number;
    readonly wallMinutes: number;
    readonly threads: number;
    readonly peak: Peak | null;
  } | null;
  /** The median time from an agent finishing to the user's next prompt in that thread, over the times the user prompted before an agent started there again. */
  readonly followUp: { readonly medianSeconds: number; readonly count: number } | null;
  /** Per thread, the time from the user's first prompt in it to the last of its pull requests merged on the day, the quickest first. */
  readonly leadTimes: List<{
    readonly thread: string;
    readonly project: string;
    readonly prs: number;
    readonly firstPromptAt: string;
    readonly mergedAt: string;
    readonly minutes: number;
  }>;
  readonly focus: {
    readonly blocks: number;
    readonly longest: { readonly minutes: number; readonly start: string; readonly end: string; readonly area: string } | null;
  } | null;
  /** Super Productivity tasks due on the day, and how many of them were done by its end. */
  readonly dueToday: { readonly count: number; readonly done: number } | null;
  readonly promptsByArea: readonly { readonly area: string; readonly prompts: number }[];
};

export type ReportInputs = {
  readonly parts: readonly DayPart[];
  readonly handedOffTasks: List<{ readonly title: string; readonly project: string | null; readonly doneAt: string } & InPart>;
  readonly settledThreads: List<{ readonly title: string; readonly project: string; readonly settledAt: string } & InPart>;
  readonly openThreads: List<{ readonly title: string; readonly project: string; readonly openSince: string }>;
  /** summary is the start of the pull request's description, for the agent to say what it changed; the report shows only the title. */
  readonly landedPrs: List<Ref & { readonly title: string; readonly summary: string | null; readonly mergedAt: string } & InPart>;
  readonly closedPrs: List<Ref & { readonly title: string; readonly summary: string | null; readonly closedAt: string } & InPart>;
  /** The mail the user sent, for the agent to describe in its own words; subjects never reach the report or Postlude. */
  readonly sentMail: List<{ readonly mailbox: string; readonly subject: string; readonly sentAt: string } & InPart>;
  /** start and end are null for an all-day event. */
  readonly appointments: List<{ readonly title: string; readonly start: string | null; readonly end: string | null } & InPart>;
  /** Super Productivity tasks with time tracked on the day, the most time first. SP keeps only a total per day, so they have no time of day. */
  readonly trackedTasks: List<{ readonly title: string; readonly project: string | null; readonly minutes: number }>;
  /**
   * Only whether Kontor has ever attempted a sync and whether the bank connection needs a new approval; never amounts.
   * Until its first attempt (lastSyncOutcome null) Kontor always reports approvalNeeded. An attempt that stopped early may leave lastSyncAt null.
   */
  readonly kontor: { readonly status: ListStatus; readonly attempted: boolean | null; readonly approvalNeeded: boolean | null };
  readonly looseEnds: LooseEnds;
  readonly facts: Facts;
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

const trackedTasks = (reading: Sources["sp"], day: string): ReportInputs["trackedTasks"] => {
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

type RefFor = (repository: string, number: number) => string;

const landedPrs = (reading: Sources["github"], window: DayWindow, bounds: PartBounds, ref: RefFor): ReportInputs["landedPrs"] => {
  if (!reading.ok) return missing();
  const items = reading.value.prs
    .map((pr) => ({ pr, mergedMs: Date.parse(pr.mergedAt) }))
    .filter(({ mergedMs }) => inWindow(mergedMs, window))
    .toSorted((a, b) => a.mergedMs - b.mergedMs || compareText(a.pr.repository, b.pr.repository) || a.pr.number - b.pr.number)
    .map(({ pr, mergedMs }) => ({
      repository: pr.repository,
      number: pr.number,
      ref: ref(pr.repository, pr.number),
      title: pr.title,
      summary: pr.summary,
      mergedAt: toBerlinIso(mergedMs),
      part: partAt(bounds, mergedMs),
    }));
  return { status: reading.value.incomplete ? "partial" : "complete", items };
};

const closedPrs = (reading: Sources["closedPrs"], window: DayWindow, bounds: PartBounds, ref: RefFor): ReportInputs["closedPrs"] => {
  if (!reading.ok) return missing();
  const items = reading.value.prs
    .map((pr) => ({ pr, closedMs: Date.parse(pr.closedAt) }))
    .filter(({ closedMs }) => inWindow(closedMs, window))
    .toSorted((a, b) => a.closedMs - b.closedMs || compareText(a.pr.repository, b.pr.repository) || a.pr.number - b.pr.number)
    .map(({ pr, closedMs }) => ({
      repository: pr.repository,
      number: pr.number,
      ref: ref(pr.repository, pr.number),
      title: pr.title,
      summary: pr.summary,
      closedAt: toBerlinIso(closedMs),
      part: partAt(bounds, closedMs),
    }));
  return { status: reading.value.incomplete ? "partial" : "complete", items };
};

const openAtEnd = (pr: { readonly state: string; readonly mergedAt: string | null; readonly closedAt: string | null }, window: DayWindow): boolean => {
  const ended = pr.mergedAt ?? pr.closedAt;
  return pr.state === "open" || (ended !== null && Date.parse(ended) >= window.endMs);
};

const waitingPrs = (reading: Sources["t3"], window: DayWindow, ref: RefFor): LooseEnds["waitingPrs"] => {
  if (!reading.ok) return missing();
  const seen = new Map<string, { pr: { repository: string; number: number; title: string; isDraft: boolean }; thread: string; linkedMs: number }>();
  for (const thread of reading.value.dayThreads) {
    for (const pr of thread.pullRequests) {
      const linkedMs = Date.parse(pr.linkedAt);
      const key = `${pr.repository}#${pr.number}`;
      if (linkedMs >= window.endMs || !openAtEnd(pr, window) || (seen.get(key)?.linkedMs ?? Number.POSITIVE_INFINITY) <= linkedMs) continue;
      seen.set(key, { pr, thread: thread.title, linkedMs });
    }
  }
  const items = [...seen.values()]
    .toSorted((a, b) => compareText(a.pr.repository, b.pr.repository) || a.pr.number - b.pr.number)
    .map(({ pr, thread }) => ({
      repository: pr.repository,
      number: pr.number,
      ref: ref(pr.repository, pr.number),
      title: pr.title,
      isDraft: pr.isDraft,
      thread,
    }));
  return { status: "complete", items };
};

const repoName = (repository: string): string => repository.split("/").at(-1) ?? repository;

/** The pull requests of the day's lists, so that each ref the report prints names one of them. */
const refsFor = (sources: Sources, window: DayWindow): RefFor => {
  const repositories = new Set<string>();
  if (sources.github.ok) for (const pr of sources.github.value.prs) repositories.add(pr.repository);
  if (sources.closedPrs.ok) for (const pr of sources.closedPrs.value.prs) repositories.add(pr.repository);
  if (sources.t3.ok)
    for (const thread of sources.t3.value.dayThreads) for (const pr of thread.pullRequests) if (openAtEnd(pr, window)) repositories.add(pr.repository);
  const named = new Map<string, number>();
  for (const repository of repositories) named.set(repoName(repository), (named.get(repoName(repository)) ?? 0) + 1);
  return (repository, number) => `${named.get(repoName(repository)) === 1 ? repoName(repository) : repository}#${number}`;
};

const spTaskDay = (task: SpTask, kind: "due" | "deadline"): string | null => {
  const [day, time] = kind === "due" ? [task.dueDay, task.dueWithTime] : [task.deadlineDay, task.deadlineWithTime];
  const days = [day, time === null ? null : journalDayAt(time)].filter((value) => value !== null);
  return days.toSorted(compareText)[0] ?? null;
};

const spDoneBy = (task: SpTask, ms: number): boolean => task.isDone && (task.doneOn ?? 0) < ms;

const spWontDoBy = (task: SpTask, ms: number): boolean => task.wontDoOn !== null && task.wontDoOn < ms;

const dueTasks = (reading: Sources["sp"], window: DayWindow): LooseEnds["dueTasks"] => {
  if (!reading.ok) return missing();
  const name = spTaskNames(reading.value);
  const tomorrow = addDays(window.day, 1);
  const items = reading.value.tasks
    .filter((task) => !spDoneBy(task, window.endMs) && !spWontDoBy(task, window.endMs))
    .flatMap((task) => {
      const due = spTaskDay(task, "due");
      const deadline = spTaskDay(task, "deadline");
      // A deadline counts first, because it is the harder date.
      const [day, kind] = deadline !== null && (due === null || deadline <= due) ? [deadline, "deadline" as const] : [due, "due" as const];
      if (day === null || day > tomorrow) return [];
      const when = day < window.day ? ("overdue" as const) : day === window.day ? ("today" as const) : ("tomorrow" as const);
      return [{ ...name(task), day, kind, when }];
    })
    .toSorted((a, b) => compareText(a.day, b.day) || compareText(a.title, b.title));
  return { status: "complete", items };
};

const runningThreads = (reading: Sources["t3"], window: DayWindow): LooseEnds["runningThreads"] => {
  if (!reading.ok) return missing();
  const running = new Set(reading.value.runs.filter((run) => run.running || Date.parse(run.end) >= window.endMs).map((run) => run.threadId));
  const items = reading.value.dayThreads
    .filter((thread) => running.has(thread.id))
    .map((thread) => ({ title: thread.title, project: projectLabel(thread.project) }))
    .toSorted((a, b) => compareText(a.title, b.title));
  return { status: "complete", items };
};

export const median = (values: readonly number[]): number => {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

/** The most threads with an agent running at once, and when that first happened. */
const peakAgents = (threads: readonly TimelineThread[]): Peak | null => {
  // An end sorts before a start at the same time, because the intervals are half-open.
  const edges = threads.flatMap((thread) =>
    thread.runs.flatMap((run) => [
      { at: run.start, step: 1 },
      { at: run.end, step: -1 },
    ]),
  );
  let count = 0;
  let peak: { count: number; at: number } | null = null;
  for (const edge of edges.toSorted((a, b) => a.at - b.at || a.step - b.step)) {
    count += edge.step;
    if (peak === null || count > peak.count) peak = { count, at: edge.at };
  }
  return peak === null ? null : { count: peak.count, at: toBerlinIso(peak.at) };
};

// The next prompt counts only when it came before an agent started in the thread again, so a prompt queued while an agent was running doesn't count as a reply.
const followUpSeconds = (thread: TimelineThread, window: DayWindow): number[] =>
  thread.runs.flatMap((run, index) => {
    const next = thread.runs[index + 1]?.start ?? window.endMs;
    const prompt = thread.prompts.find((entry) => entry.at >= run.end);
    return prompt !== undefined && prompt.at <= next ? [Math.round((prompt.at - run.end) / 1000)] : [];
  });

const leadTimes = (reading: Sources["t3"], window: DayWindow): Facts["leadTimes"] => {
  if (!reading.ok) return missing();
  const items = reading.value.dayThreads
    .flatMap((thread) => {
      if (thread.firstPromptAt === null) return [];
      const firstMs = Date.parse(thread.firstPromptAt);
      const merged = thread.pullRequests.flatMap((pr) => (pr.mergedAt !== null && inWindow(Date.parse(pr.mergedAt), window) ? [Date.parse(pr.mergedAt)] : []));
      if (merged.length === 0) return [];
      const mergedMs = Math.max(...merged);
      if (mergedMs < firstMs) return [];
      return [
        {
          thread: thread.title,
          project: projectLabel(thread.project),
          prs: merged.length,
          firstPromptAt: toBerlinIso(firstMs),
          mergedAt: toBerlinIso(mergedMs),
          minutes: Math.round((mergedMs - firstMs) / 60_000),
        },
      ];
    })
    .toSorted((a, b) => a.minutes - b.minutes || compareText(a.thread, b.thread));
  return { status: "complete", items };
};

const facts = (window: DayWindow, sources: Sources, timeline: Timeline): Facts => {
  const t3 = timeline.threads.status !== "missing";
  const threads = timeline.threads.items;
  const prompts = threads.flatMap((thread) => thread.prompts);
  const areaLabel = (category: string | null) => (category === null ? UNCATEGORISED : (timeline.categoryLabels[category] ?? category));
  const byArea = new Map<string, number>();
  for (const thread of threads)
    if (thread.prompts.length > 0) byArea.set(areaLabel(thread.category), (byArea.get(areaLabel(thread.category)) ?? 0) + thread.prompts.length);
  const followUps = threads.flatMap((thread) => followUpSeconds(thread, window));
  const longest = timeline.focusBlocks.toSorted((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0];
  const dueToday = sources.sp.ok ? sources.sp.value.tasks.filter((task) => spTaskDay(task, "due") === window.day && !spWontDoBy(task, window.endMs)) : null;
  return {
    prompts: t3
      ? {
          count: prompts.length,
          fromPhone: prompts.filter((prompt) => prompt.fromPhone).length,
          threads: threads.filter((thread) => thread.prompts.length > 0).length,
        }
      : null,
    agents: t3
      ? {
          minutes: Math.round(threads.reduce((sum, thread) => sum + totalMs(thread.runs), 0) / 60_000),
          wallMinutes: totalMinutes(threads.flatMap((thread) => thread.runs)),
          threads: threads.filter((thread) => thread.runs.length > 0).length,
          peak: peakAgents(threads),
        }
      : null,
    followUp: followUps.length === 0 ? null : { medianSeconds: Math.round(median(followUps)), count: followUps.length },
    leadTimes: leadTimes(sources.t3, window),
    focus:
      timeline.status === "missing"
        ? null
        : {
            blocks: timeline.focusBlocks.length,
            longest:
              longest === undefined
                ? null
                : { minutes: totalMinutes([longest]), start: toBerlinIso(longest.start), end: toBerlinIso(longest.end), area: areaLabel(longest.category) },
          },
    dueToday: dueToday === null ? null : { count: dueToday.length, done: dueToday.filter((task) => spDoneBy(task, window.endMs)).length },
    promptsByArea: [...byArea].map(([area, count]) => ({ area, prompts: count })).toSorted((a, b) => b.prompts - a.prompts || compareText(a.area, b.area)),
  };
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

const sentMail = (window: DayWindow, sources: Sources, bounds: PartBounds): ReportInputs["sentMail"] => {
  const { status, items } = sentMails(window, sources);
  return { status, items: items.map(({ mailbox, subject, at }) => ({ mailbox, subject, sentAt: toBerlinIso(at), part: partAt(bounds, at) })) };
};

const kontor = (reading: Sources["kontor"]): ReportInputs["kontor"] => {
  const unknown = { status: "missing", attempted: null, approvalNeeded: null } as const;
  if (!reading.ok || typeof reading.value !== "object" || reading.value === null) return unknown;
  const { lastSyncOutcome, approvalNeeded } = reading.value as { lastSyncOutcome?: unknown; approvalNeeded?: unknown };
  if (typeof approvalNeeded !== "boolean" || (typeof lastSyncOutcome !== "string" && lastSyncOutcome !== null)) return unknown;
  return { status: "complete", attempted: lastSyncOutcome !== null, approvalNeeded };
};

type Placed = Pick<ReportInputs, "handedOffTasks" | "settledThreads" | "landedPrs" | "closedPrs" | "appointments">;

const moments = (placed: Placed): Moment[] => {
  const instant = (part: number | null, iso: string): Moment => ({ part, start: Date.parse(iso), end: Date.parse(iso) });
  return [
    ...placed.handedOffTasks.items.map((task) => instant(task.part, task.doneAt)),
    ...placed.settledThreads.items.map((thread) => instant(thread.part, thread.settledAt)),
    ...placed.landedPrs.items.map((pr) => instant(pr.part, pr.mergedAt)),
    ...placed.closedPrs.items.map((pr) => instant(pr.part, pr.closedAt)),
    ...placed.appointments.items.flatMap((event) =>
      event.start === null || event.end === null ? [] : [{ part: event.part, start: Date.parse(event.start), end: Date.parse(event.end) }],
    ),
  ];
};

export const buildReportInputs = (window: DayWindow, sources: Sources, timeline: Timeline): ReportInputs => {
  const bounds = partBounds(window, timeline);
  const ref = refsFor(sources, window);
  const placed: Placed = {
    handedOffTasks: handedOffTasks(sources.sp, window, bounds),
    settledThreads: settledThreads(sources.t3, window, bounds),
    landedPrs: landedPrs(sources.github, window, bounds, ref),
    closedPrs: closedPrs(sources.closedPrs, window, bounds, ref),
    appointments: appointments(sources.calendar, window, bounds),
  };
  return {
    parts: buildParts(timeline, bounds, moments(placed), dayWindows(window, sources)),
    ...placed,
    sentMail: sentMail(window, sources, bounds),
    openThreads: openThreads(sources.t3, window),
    trackedTasks: trackedTasks(sources.sp, window.day),
    kontor: kontor(sources.kontor),
    looseEnds: { waitingPrs: waitingPrs(sources.t3, window, ref), dueTasks: dueTasks(sources.sp, window), runningThreads: runningThreads(sources.t3, window) },
    facts: facts(window, sources, timeline),
  };
};
