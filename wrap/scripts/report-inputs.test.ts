import { expect, test } from "bun:test";
import { buildCollected } from "./day-report.ts";
import { clip } from "./intervals.ts";
import { buildReportInputs } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";
import { event, sources, WINDOW } from "./testing/fixtures.ts";
import { buildTimeline, partAt, partBounds } from "./timeline.ts";

const inputs = (changes: Partial<Sources> = {}) => {
  const all = { ...sources, ...changes };
  return buildReportInputs(WINDOW, all, buildTimeline(WINDOW, all));
};

test("builds the parts and lists of a day with all sources", () => {
  expect(inputs()).toEqual({
    parts: [
      {
        // The pull request at the start of the day and the run clipped to it come before the screen time, and lunch runs until the next part.
        start: "2026-10-29T04:00:00+01:00",
        end: "2026-10-29T13:00:00+01:00",
        clock: "04:00–13:00",
        screenMinutes: 240,
        areas: [
          { label: "Code", minutes: 210 },
          { label: "Mail", minutes: 30 },
        ],
        projects: [
          { project: "postlude", screenMinutes: 210, agentMinutes: 80 },
          // The run began before the journal day, so only its last half hour counts.
          { project: "nix-config", screenMinutes: 0, agentMinutes: 30 },
        ],
        threads: [
          { title: "Fix the parser", project: "postlude", prompts: 2, agentMinutes: 80 },
          { title: "Night build", project: "nix-config", prompts: 0, agentMinutes: 30 },
        ],
        // Without T3 Code's own windows, redacted ones, and the calculator's single minute; the mail windows add up across the redacted one.
        windows: [{ app: "org.example.Mail", title: "Inbox - Mail", minutes: 24 }],
      },
      {
        // A task done just before the end of the journal day, and the night train clipped to it.
        start: "2026-10-29T13:00:00+01:00",
        end: "2026-10-30T04:00:00+01:00",
        clock: "13:00–04:00",
        screenMinutes: 330,
        areas: [
          { label: "Code", minutes: 180 },
          { label: "Not categorised", minutes: 90 },
          { label: "Admin", minutes: 60 },
        ],
        // Two threads' agents overlapping in a project count once.
        projects: [
          { project: "sp-cli", screenMinutes: 180, agentMinutes: 55 },
          { project: "nix-config", screenMinutes: 0, agentMinutes: 60 },
        ],
        threads: [
          { title: "Tidy tests", project: "sp-cli", prompts: 2, agentMinutes: 55 },
          { title: "Watch the deploy", project: "nix-config", prompts: 0, agentMinutes: 60 },
          { title: "Write docs", project: "sp-cli", prompts: 0, agentMinutes: 10 },
        ],
        windows: [
          { app: "org.example.Writer", title: "Garden plan - Writer", minutes: 70 },
          // A Windows program has no title.
          { app: "accounts.exe", title: null, minutes: 60 },
        ],
      },
    ],
    handedOffTasks: {
      status: "complete",
      items: [
        { title: "Write tests", project: "Work", doneAt: "2026-10-29T10:00:00+01:00", part: 0 },
        { title: "Garden › Dig", project: "Home", doneAt: "2026-10-29T11:00:00+01:00", part: 0 },
        // After the last stretch of screen time, so it belongs to the last part.
        { title: "Shop", project: "Home", doneAt: "2026-10-30T03:59:59+01:00", part: 1 },
      ],
    },
    settledThreads: { status: "complete", items: [{ title: "Settled today", project: "postlude", settledAt: "2026-10-29T17:00:00+01:00", part: 1 }] },
    openThreads: {
      status: "complete",
      items: [
        { title: "Settled later", project: "nix-config", openSince: "2026-10-20" },
        { title: "Long open", project: "dev", openSince: "2026-10-25" },
      ],
    },
    landedPrs: {
      status: "complete",
      items: [
        // Before the first stretch of screen time, so it belongs to the first part.
        {
          repository: "davidvornholt/postlude",
          number: 12,
          ref: "postlude#12",
          title: "Start of day",
          summary: "The morning page now opens with the weather.",
          mergedAt: "2026-10-29T04:00:00+01:00",
          part: 0,
        },
        { repository: "davidvornholt/sp-cli", number: 7, ref: "sp-cli#7", title: "Afternoon", summary: null, mergedAt: "2026-10-29T16:00:00+01:00", part: 1 },
      ],
    },
    closedPrs: {
      status: "complete",
      items: [
        {
          repository: "davidvornholt/sp-cli",
          number: 8,
          ref: "sp-cli#8",
          title: "Try a second parser",
          summary: "Reads the task list with a second parser.",
          closedAt: "2026-10-29T11:45:00+01:00",
          part: 0,
        },
      ],
    },
    // Partial, because one mailbox failed and another filled its page.
    sentMail: {
      status: "partial",
      items: [
        { mailbox: "b@example.com", subject: "Garden plan for Saturday", sentAt: "2026-10-29T09:00:00+01:00", part: 0 },
        { mailbox: "c@example.com", subject: "Invoice for October", sentAt: "2026-10-29T19:00:00+01:00", part: 1 },
        { mailbox: "c@example.com", subject: "Re: Invoice for October", sentAt: "2026-10-29T20:00:00+01:00", part: 1 },
        { mailbox: "b@example.com", subject: "Late reply", sentAt: "2026-10-30T02:00:00+01:00", part: 1 },
      ],
    },
    appointments: {
      status: "complete",
      items: [
        { title: "Holiday", start: null, end: null, part: null },
        { title: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00", part: 0 },
        { title: "Review", start: "2026-10-29T10:30:00+01:00", end: "2026-10-29T11:30:00+01:00", part: 0 },
        { title: "Lunch", start: "2026-10-29T12:00:00+01:00", end: "2026-10-29T13:00:00+01:00", part: 0 },
        { title: "Night train", start: "2026-10-30T03:30:00+01:00", end: "2026-10-30T05:00:00+01:00", part: 1 },
      ],
    },
    trackedTasks: {
      status: "complete",
      items: [
        { title: "Write tests", project: "Work", minutes: 50 },
        { title: "Garden › Dig", project: "Home", minutes: 30 },
        { title: "Walk", project: "Home", minutes: 20 },
        { title: "Garden › Plant", project: "Home", minutes: 15 },
        { title: "Shop", project: "Home", minutes: 5 },
      ],
    },
    kontor: { status: "missing", attempted: null, approvalNeeded: null },
    looseEnds: {
      waitingPrs: {
        status: "complete",
        // Not the pull request linked only after the day, nor those merged or closed within it.
        items: [
          { repository: "davidvornholt/nix-config", number: 5, ref: "nix-config#5", title: "Build at night", isDraft: true, thread: "Night build" },
          { repository: "davidvornholt/pim", number: 3, ref: "pim#3", title: "End of day belongs to the next day", isDraft: false, thread: "Fix the parser" },
          { repository: "davidvornholt/postlude", number: 14, ref: "postlude#14", title: "Parse dates", isDraft: false, thread: "Fix the parser" },
        ],
      },
      dueTasks: {
        status: "complete",
        // Not the task done before the day ended, the one marked won't do, or the one due after the next day.
        items: [
          { title: "Pay the bill", project: "Home", day: "2026-10-27", kind: "due", when: "overdue" },
          { title: "Call the plumber", project: "Home", day: "2026-10-29", kind: "due", when: "today" },
          { title: "Next day", project: "Home", day: "2026-10-29", kind: "due", when: "today" },
          { title: "Pack", project: "Home", day: "2026-10-30", kind: "deadline", when: "tomorrow" },
        ],
      },
      runningThreads: { status: "complete", items: [{ title: "Watch the deploy", project: "nix-config" }] },
    },
    facts: {
      prompts: { count: 4, fromPhone: 1, threads: 2 },
      // Each thread's agent time adds up, so overlapping threads count twice; the time any agent ran counts them once.
      agents: { minutes: 235, wallMinutes: 225, threads: 5, peak: { count: 2, at: "2026-10-29T15:20:00+01:00" } },
      followUp: { medianSeconds: 450, count: 2 },
      leadTimes: {
        status: "complete",
        items: [
          {
            thread: "Tidy tests",
            project: "sp-cli",
            prs: 1,
            firstPromptAt: "2026-10-29T14:50:00+01:00",
            mergedAt: "2026-10-29T16:00:00+01:00",
            minutes: 70,
          },
        ],
      },
      focus: { blocks: 1, longest: { minutes: 200, start: "2026-10-29T08:12:00+01:00", end: "2026-10-29T11:32:00+01:00", area: "Code" } },
      dueToday: { count: 3, done: 1 },
      promptsByArea: [{ area: "Code", prompts: 4 }],
    },
  });
});

test("writes a pull request's ref with its owner when two of the day's repositories share its name", () => {
  const github: Sources["github"] = {
    ok: true,
    value: {
      incomplete: false,
      prs: [
        { repository: "davidvornholt/postlude", number: 12, title: "Start of day", summary: null, mergedAt: "2026-10-29T03:00:00Z" },
        { repository: "someone/postlude", number: 4, title: "A fork", summary: null, mergedAt: "2026-10-29T09:00:00Z" },
      ],
    },
  };
  const { landedPrs, looseEnds } = inputs({ github });
  expect(landedPrs.items.map((pr) => pr.ref)).toEqual(["davidvornholt/postlude#12", "someone/postlude#4"]);
  expect(looseEnds.waitingPrs.items.map((pr) => pr.ref)).toEqual(["nix-config#5", "pim#3", "davidvornholt/postlude#14"]);
});

test("counts a reply only when the user prompted before an agent started in the thread again", () => {
  const t3 = sources.t3.ok ? sources.t3.value : null;
  if (t3 === null) throw new Error("The fixture has T3 Code data.");
  const value = {
    ...t3,
    runs: [
      { threadId: "t-parser", start: "2026-10-29T10:00:00.000Z", end: "2026-10-29T10:10:00.000Z", running: false },
      { threadId: "t-parser", start: "2026-10-29T10:20:00.000Z", end: "2026-10-29T10:30:00.000Z", running: false },
    ],
    // Sent while the second run was going, so it doesn't answer the first.
    prompts: [{ threadId: "t-parser", at: "2026-10-29T10:25:00.000Z", fromPhone: false }],
  };
  expect(inputs({ t3: { ok: true, value } }).facts.followUp).toBeNull();
});

test("has no parts when screen activity is missing, so nothing is placed in one", () => {
  const unusable = inputs({ summary: { ok: false, error: "unreachable" } });
  expect(unusable.parts).toEqual([]);
  expect(unusable.landedPrs.items.map((pr) => pr.part)).toEqual([null, null]);
});

test("marks lists of unreachable sources as missing", () => {
  const unavailable = { ok: false, error: "unreachable" } as const;
  const lists = inputs({ sp: unavailable, t3: unavailable, github: unavailable, closedPrs: unavailable, mail: unavailable, calendar: unavailable });
  for (const list of [
    lists.sentMail,
    lists.handedOffTasks,
    lists.settledThreads,
    lists.openThreads,
    lists.landedPrs,
    lists.closedPrs,
    lists.appointments,
    lists.trackedTasks,
    lists.looseEnds.waitingPrs,
    lists.looseEnds.dueTasks,
    lists.looseEnds.runningThreads,
    lists.facts.leadTimes,
  ]) {
    expect(list).toEqual({ status: "missing", items: [] });
  }
  expect(lists.facts).toMatchObject({ prompts: null, agents: null, followUp: null, dueToday: null, promptsByArea: [] });
});

test("marks closed pull requests partial when GitHub's search was incomplete, and keeps the landed ones", () => {
  const closedPrs: Sources["closedPrs"] = { ok: true, value: { incomplete: true, prs: [] } };
  const partial = inputs({ closedPrs });
  expect(partial.closedPrs).toEqual({ status: "partial", items: [] });
  expect(partial.landedPrs.status).toBe("complete");
  expect(buildCollected(WINDOW, { ...sources, closedPrs }).problems).toContain(
    "GitHub reported incomplete search results, so closed pull requests may be missing.",
  );
});

test("marks appointments partial when an account failed", () => {
  const calendar: Sources["calendar"] = {
    ok: true,
    value: {
      limitReached: false,
      accounts: [
        { account: "me@example.com", failure: null, events: [] },
        { account: "work@example.com", failure: "timeout", events: [] },
      ],
    },
  };
  expect(inputs({ calendar }).appointments).toEqual({ status: "partial", items: [] });
});

test("leaves out a meeting whose answer couldn't be read and marks appointments partial", () => {
  const events = [
    event({ summary: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00" }),
    event({ summary: "Planning", start: "2026-10-29T16:00:00+01:00", end: "2026-10-29T17:00:00+01:00", declined: null }),
  ];
  const calendar: Sources["calendar"] = { ok: true, value: { limitReached: false, accounts: [{ account: "me@example.com", failure: null, events }] } };
  expect(inputs({ calendar }).appointments).toEqual({
    status: "partial",
    items: [{ title: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00", part: 0 }],
  });
});

test("reads only whether Kontor has attempted a sync and needs approval", () => {
  const kontor = (value: unknown) => inputs({ kontor: { ok: true, value } }).kontor;
  expect(
    kontor({ lastSyncAt: "2026-10-29T06:00:00Z", approvalExpiresAt: "2026-11-02T00:00:00Z", daysLeft: 3, approvalNeeded: true, lastSyncOutcome: "ok" }),
  ).toEqual({ status: "complete", attempted: true, approvalNeeded: true });
  expect(kontor({ daysLeft: 3 })).toEqual({ status: "missing", attempted: null, approvalNeeded: null });
  expect(kontor({ lastSyncAt: null, approvalNeeded: false })).toEqual({ status: "missing", attempted: null, approvalNeeded: null });
  expect(kontor({ approvalNeeded: true, lastSyncOutcome: 1 })).toEqual({ status: "missing", attempted: null, approvalNeeded: null });
  expect(kontor(null)).toEqual({ status: "missing", attempted: null, approvalNeeded: null });
});

test("reads a Kontor that has never attempted a sync as a state, not a gap", () => {
  const neverAttempted = {
    lastSyncAt: null,
    approvalExpiresAt: null,
    daysLeft: 0,
    approvalNeeded: true,
    reason: "never-approved",
    lastSyncOutcome: null,
  };
  const collected = buildCollected(WINDOW, { ...sources, kontor: { ok: true, value: neverAttempted } });
  expect(collected.reportInputs.kontor).toEqual({ status: "complete", attempted: false, approvalNeeded: true });
  expect(collected.problems.filter((problem) => problem.startsWith("Kontor"))).toEqual([]);
});

test("reads a first login that stopped before every account as an attempt", () => {
  // Kontor archived what it read, but lastSyncAt counts only runs that read every account.
  const incomplete = {
    lastSyncAt: null,
    approvalExpiresAt: "2027-02-06T10:00:00.000Z",
    daysLeft: 0,
    approvalNeeded: true,
    reason: "bank-asked",
    lastSyncOutcome: "approval_required",
  };
  const collected = buildCollected(WINDOW, { ...sources, kontor: { ok: true, value: incomplete } });
  expect(collected.reportInputs.kontor).toEqual({ status: "complete", attempted: true, approvalNeeded: true });
  expect(collected.problems.filter((problem) => problem.startsWith("Kontor"))).toEqual([]);
});

test("explains every gap in the collected problems", () => {
  const collected = buildCollected(WINDOW, { ...sources, t3: { ok: false, error: "ssh timed out" } });
  expect(collected.problems).toContain("T3 Code unavailable: ssh timed out");
  expect(collected.problems).toContain("Kontor status unavailable: kontor could not run: Executable not found in $PATH");
  expect(collected.window).toEqual({ start: "2026-10-29T04:00:00+01:00", end: "2026-10-30T04:00:00+01:00" });
});

test("prints each part's time range over everything placed in it", () => {
  const timeline = buildTimeline(WINDOW, sources);
  const { parts, handedOffTasks, settledThreads, landedPrs, closedPrs, appointments } = buildReportInputs(WINDOW, sources, timeline);
  const bounds = partBounds(WINDOW, timeline);
  const instant = (part: number | null, what: string, iso: string) => ({ part, what, start: Date.parse(iso), end: Date.parse(iso) });
  const placed = [
    ...handedOffTasks.items.map((task) => instant(task.part, task.title, task.doneAt)),
    ...settledThreads.items.map((thread) => instant(thread.part, thread.title, thread.settledAt)),
    ...landedPrs.items.map((pr) => instant(pr.part, pr.title, pr.mergedAt)),
    ...closedPrs.items.map((pr) => instant(pr.part, pr.title, pr.closedAt)),
    ...appointments.items.flatMap((event) =>
      event.start === null || event.end === null ? [] : [{ part: event.part, what: event.title, start: Date.parse(event.start), end: Date.parse(event.end) }],
    ),
    // An agent run belongs to every part whose bound it overlaps, and a prompt to the part it falls in.
    ...timeline.threads.items.flatMap((thread) => [
      ...thread.runs.flatMap((run) => bounds.map((_, index) => ({ part: index, what: thread.title, ...run }))),
      ...thread.prompts.map((prompt) => ({ part: partAt(bounds, prompt.at), what: thread.title, start: prompt.at, end: prompt.at })),
    ]),
  ];
  const outside = placed.flatMap(({ part, what, start, end }) => {
    const bound = part === null ? undefined : bounds[part];
    const range = part === null ? undefined : parts[part];
    if (bound === undefined || range === undefined) return [];
    const [shown] = start === end ? [{ start, end }] : clip([{ start, end }], bound);
    if (shown === undefined) return [];
    return shown.start < Date.parse(range.start) || shown.end > Date.parse(range.end) ? [`${what} in ${range.clock}`] : [];
  });
  expect(parts).toHaveLength(2);
  expect(outside).toEqual([]);
});
