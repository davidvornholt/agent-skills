import { CODE_BLOCK_MAX_LINES } from "../conversations.ts";
import { dayWindow } from "../day.ts";
import type { CalendarEvent, Sources, SpTask, T3PullRequest } from "../sources.ts";

export const DAY = "2026-10-29";
export const WINDOW = dayWindow(DAY);

export const summary = {
  summaryVersion: 10,
  day: DAY,
  window: { start: WINDOW.start, end: WINDOW.end },
  hosts: [
    { host: "david-z890-nixos", status: "complete", activeMinutes: 300 },
    { host: "david-x1-nixos", status: "partial", activeMinutes: 60 },
  ],
  activeMinutes: 330,
  firstActivityAt: "2026-10-29T08:12:00+01:00",
  lastActivityAt: "2026-10-29T23:40:00+01:00",
  focusMinutes: 200,
  scatteredMinutes: 130,
  focusBlocks: [{ start: "2026-10-29T08:12:00+01:00", end: "2026-10-29T11:32:00+01:00", category: "code" }],
  categories: [
    { id: "mail", label: "Mail", minutes: 80, t3Projects: [] },
    { id: "code", label: "Code", minutes: 200, t3Projects: ["~/dev/postlude", "~/dev/sp-cli"] },
    { id: "admin", label: "Admin", minutes: 50, t3Projects: [] },
  ],
  unattributedMinutes: 0,
  activeIntervals: [
    { start: "2026-10-29T08:00:00+01:00", end: "2026-10-29T12:00:00+01:00" },
    { start: "2026-10-29T13:00:00+01:00", end: "2026-10-29T18:30:00+01:00" },
  ],
  timeline: [
    { start: "2026-10-29T08:00:00+01:00", end: "2026-10-29T11:30:00+01:00", category: "code", project: "~/dev/postlude" },
    { start: "2026-10-29T11:30:00+01:00", end: "2026-10-29T12:00:00+01:00", category: "mail", project: null },
    { start: "2026-10-29T13:00:00+01:00", end: "2026-10-29T14:00:00+01:00", category: "admin", project: null },
    { start: "2026-10-29T14:00:00+01:00", end: "2026-10-29T17:00:00+01:00", category: "code", project: "~/dev/sp-cli" },
    { start: "2026-10-29T17:00:00+01:00", end: "2026-10-29T18:30:00+01:00", category: null, project: null },
  ],
  windows: [
    { start: "2026-10-29T08:00:00.000+01:00", end: "2026-10-29T11:30:00.000+01:00", app: "com.t3tools.T3Code", title: "T3 Code" },
    { start: "2026-10-29T11:30:00.000+01:00", end: "2026-10-29T11:31:00.000+01:00", app: "org.example.Calculator", title: "Calculator" },
    { start: "2026-10-29T11:31:00.000+01:00", end: "2026-10-29T11:50:00.000+01:00", app: "org.example.Mail", title: "Inbox - Mail" },
    { start: "2026-10-29T11:50:00.000+01:00", end: "2026-10-29T11:55:00.000+01:00", app: "<redacted>", title: "<redacted>" },
    { start: "2026-10-29T11:55:00.000+01:00", end: "2026-10-29T12:00:00.000+01:00", app: "org.example.Mail", title: "Inbox - Mail" },
    { start: "2026-10-29T13:00:00.000+01:00", end: "2026-10-29T14:00:00.000+01:00", app: "accounts.exe", title: null },
    { start: "2026-10-29T14:00:00.000+01:00", end: "2026-10-29T17:00:00.000+01:00", app: "t3code", title: "T3 Code (Beta)" },
    { start: "2026-10-29T17:00:00.000+01:00", end: "2026-10-29T17:40:00.000+01:00", app: "org.example.Writer", title: "Garden plan - Writer" },
    { start: "2026-10-29T17:40:00.000+01:00", end: "2026-10-29T17:50:00.000+01:00", app: "org.example.Browser", title: "<redacted>" },
    { start: "2026-10-29T17:50:00.000+01:00", end: "2026-10-29T18:00:00.000+01:00", app: null, title: null },
    { start: "2026-10-29T18:00:00.000+01:00", end: "2026-10-29T18:30:00.000+01:00", app: "org.example.Writer", title: "Garden plan - Writer" },
  ],
};

const minutes = (count: number): number => count * 60_000;
const at = (iso: string): number => Date.parse(iso);

const task = (fields: Partial<SpTask> & Pick<SpTask, "id" | "title">): SpTask => ({
  isDone: false,
  doneOn: null,
  projectId: "p-home",
  parentId: null,
  subTaskIds: [],
  timeSpentOnDay: {},
  dueDay: null,
  dueWithTime: null,
  deadlineDay: null,
  deadlineWithTime: null,
  wontDoOn: null,
  ...fields,
});

const pullRequest = (fields: Partial<T3PullRequest> & Pick<T3PullRequest, "repository" | "number" | "title" | "linkedAt">): T3PullRequest => ({
  state: "open",
  isDraft: false,
  mergedAt: null,
  closedAt: null,
  ...fields,
});

export const event = (fields: Partial<CalendarEvent> & Pick<CalendarEvent, "summary" | "start" | "end">): CalendarEvent => ({
  allDay: false,
  cancelled: false,
  declined: false,
  ...fields,
});

export const spTasks: SpTask[] = [
  task({ id: "garden", title: "Garden", subTaskIds: ["dig", "plant"], timeSpentOnDay: { [DAY]: minutes(45) } }),
  task({
    id: "dig",
    title: "Dig",
    projectId: null,
    parentId: "garden",
    isDone: true,
    doneOn: at("2026-10-29T11:00:00+01:00"),
    timeSpentOnDay: { [DAY]: minutes(30) },
  }),
  task({ id: "plant", title: "Plant", parentId: "garden", timeSpentOnDay: { [DAY]: minutes(15) } }),
  task({ id: "walk", title: "Walk", timeSpentOnDay: { [DAY]: minutes(20), "2026-10-28": minutes(10) } }),
  task({
    id: "code",
    title: "Write tests",
    projectId: "p-work",
    isDone: true,
    doneOn: at("2026-10-29T10:00:00+01:00"),
    timeSpentOnDay: { [DAY]: minutes(50) },
    dueDay: DAY,
  }),
  task({ id: "late", title: "Shop", isDone: true, doneOn: at("2026-10-30T03:59:59+01:00"), timeSpentOnDay: { [DAY]: minutes(5) } }),
  // Due at a time on the day and done only after it ended, so it was still open at the end.
  task({ id: "next-day", title: "Next day", isDone: true, doneOn: at("2026-10-30T04:00:00+01:00"), dueWithTime: at("2026-10-29T15:00:00+01:00") }),
  task({ id: "day-before", title: "Day before", isDone: true, doneOn: at("2026-10-28T20:00:00+01:00"), dueDay: "2026-10-27" }),
  task({ id: "bill", title: "Pay the bill", dueDay: "2026-10-27" }),
  task({ id: "call", title: "Call the plumber", dueDay: DAY }),
  // The deadline comes before the day it's planned for, so it counts.
  task({ id: "pack", title: "Pack", dueDay: "2026-11-02", deadlineDay: "2026-10-30" }),
  task({ id: "later", title: "Later", dueDay: "2026-10-31" }),
  task({ id: "skipped", title: "Skipped", isDone: true, dueDay: DAY, wontDoOn: at("2026-10-29T09:00:00+01:00") }),
];

export const sources: Sources = {
  summary: { ok: true, value: summary },
  sp: {
    ok: true,
    value: {
      tasks: spTasks,
      projects: [
        { id: "p-home", title: "Home" },
        { id: "p-work", title: "Work" },
      ],
    },
  },
  github: {
    ok: true,
    value: {
      incomplete: false,
      prs: [
        {
          repository: "davidvornholt/postlude",
          number: 12,
          title: "Start of day",
          summary: "The morning page now opens with the weather.",
          mergedAt: "2026-10-29T03:00:00Z",
        },
        { repository: "davidvornholt/sp-cli", number: 7, title: "Afternoon", summary: null, mergedAt: "2026-10-29T15:00:00Z" },
        { repository: "davidvornholt/pim", number: 3, title: "End of day belongs to the next day", summary: null, mergedAt: "2026-10-30T03:00:00Z" },
      ],
    },
  },
  closedPrs: {
    ok: true,
    value: {
      incomplete: false,
      prs: [
        {
          repository: "davidvornholt/sp-cli",
          number: 8,
          title: "Try a second parser",
          summary: "Reads the task list with a second parser.",
          closedAt: "2026-10-29T10:45:00Z",
        },
        { repository: "davidvornholt/pim", number: 2, title: "Closed the day before", summary: null, closedAt: "2026-10-29T02:59:59Z" },
      ],
    },
  },
  mail: {
    ok: true,
    value: [
      {
        mailbox: "b@example.com",
        reading: {
          ok: true,
          value: {
            sent: [
              { at: "2026-10-29T09:00:00+01:00", subject: "Garden plan for Saturday" },
              { at: "2026-10-30T02:00:00+01:00", subject: "Late reply" },
              { at: "2026-10-28T23:00:00+01:00", subject: "Sent the day before" },
            ],
            limitReached: false,
          },
        },
      },
      { mailbox: "a@example.com", reading: { ok: false, error: "login failed" } },
      {
        mailbox: "c@example.com",
        reading: {
          ok: true,
          value: {
            sent: [
              { at: "2026-10-29T20:00:00+01:00", subject: "Re: Invoice for October" },
              { at: "2026-10-29T19:00:00+01:00", subject: "Invoice for October" },
            ],
            limitReached: true,
          },
        },
      },
    ],
  },
  calendar: {
    ok: true,
    value: {
      limitReached: false,
      accounts: [
        {
          account: "me@example.com",
          failure: null,
          events: [
            event({ summary: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00" }),
            event({ summary: "Review", start: "2026-10-29T10:30:00+01:00", end: "2026-10-29T11:30:00+01:00" }),
            event({ summary: "Lunch", start: "2026-10-29T12:00:00+01:00", end: "2026-10-29T13:00:00+01:00" }),
            event({ summary: "Holiday", start: "2026-10-29", end: "2026-10-29", allDay: true }),
            event({ summary: "Night train", start: "2026-10-30T03:30:00+01:00", end: "2026-10-30T05:00:00+01:00" }),
            event({ summary: "Before the day", start: "2026-10-29T02:00:00+01:00", end: "2026-10-29T03:00:00+01:00" }),
            event({ summary: "Moved call", start: "2026-10-29T14:00:00+01:00", end: "2026-10-29T15:00:00+01:00", cancelled: true }),
            event({ summary: "Declined sync", start: "2026-10-29T19:00:00+01:00", end: "2026-10-29T20:00:00+01:00", declined: true }),
          ],
        },
        {
          account: "work@example.com",
          failure: null,
          events: [event({ summary: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00" })],
        },
      ],
    },
  },
  t3: {
    ok: true,
    value: {
      dayThreads: [
        {
          id: "t-night",
          title: "Night build",
          project: "~/dev/nix-config",
          firstPromptAt: "2026-10-28T20:00:00.000Z",
          startedBy: "phone",
          pullRequests: [
            pullRequest({ repository: "davidvornholt/nix-config", number: 5, title: "Build at night", linkedAt: "2026-10-28T21:00:00.000Z", isDraft: true }),
          ],
        },
        {
          id: "t-parser",
          title: "Fix the parser",
          project: "~/dev/postlude",
          firstPromptAt: "2026-10-29T08:20:00.000Z",
          startedBy: "user",
          pullRequests: [
            pullRequest({ repository: "davidvornholt/postlude", number: 14, title: "Parse dates", linkedAt: "2026-10-29T09:00:00.000Z" }),
            // Merged at the end of the journal day, so it was still open then.
            pullRequest({
              repository: "davidvornholt/pim",
              number: 3,
              title: "End of day belongs to the next day",
              linkedAt: "2026-10-29T09:30:00.000Z",
              state: "merged",
              mergedAt: "2026-10-30T03:00:00Z",
            }),
            pullRequest({ repository: "davidvornholt/postlude", number: 15, title: "Linked the next day", linkedAt: "2026-10-30T05:00:00.000Z" }),
          ],
        },
        {
          id: "t-tidy",
          title: "Tidy tests",
          project: "~/dev/sp-cli",
          firstPromptAt: "2026-10-29T13:50:00.000Z",
          startedBy: "user",
          pullRequests: [
            pullRequest({
              repository: "davidvornholt/sp-cli",
              number: 7,
              title: "Afternoon",
              linkedAt: "2026-10-29T14:10:00.000Z",
              state: "merged",
              mergedAt: "2026-10-29T15:00:00Z",
            }),
            pullRequest({
              repository: "davidvornholt/sp-cli",
              number: 8,
              title: "Try a second parser",
              linkedAt: "2026-10-29T10:00:00.000Z",
              state: "closed",
              closedAt: "2026-10-29T10:45:00Z",
            }),
          ],
        },
        { id: "t-docs", title: "Write docs", project: "~/dev/sp-cli", firstPromptAt: null, startedBy: "thread", pullRequests: [] },
        { id: "t-deploy", title: "Watch the deploy", project: "~/dev/nix-config", firstPromptAt: null, startedBy: "schedule", pullRequests: [] },
      ],
      runs: [
        // Began before the journal day, so the timeline clips it to the day's start.
        { threadId: "t-night", start: "2026-10-29T02:30:00.000Z", end: "2026-10-29T03:30:00.000Z", running: false },
        { threadId: "t-parser", start: "2026-10-29T08:30:00.000Z", end: "2026-10-29T09:15:00.000Z", running: false },
        { threadId: "t-parser", start: "2026-10-29T09:25:00.000Z", end: "2026-10-29T10:00:00.000Z", running: false },
        { threadId: "t-tidy", start: "2026-10-29T14:00:00.000Z", end: "2026-10-29T14:40:00.000Z", running: false },
        { threadId: "t-tidy", start: "2026-10-29T14:45:00.000Z", end: "2026-10-29T15:00:00.000Z", running: false },
        { threadId: "t-docs", start: "2026-10-29T14:20:00.000Z", end: "2026-10-29T14:30:00.000Z", running: false },
        // Still running when T3 was read, so the timeline clips it to the day's end.
        { threadId: "t-deploy", start: "2026-10-30T02:00:00.000Z", end: "2026-10-30T06:00:00.000Z", running: true },
      ],
      prompts: [
        { threadId: "t-parser", at: "2026-10-29T08:20:00.000Z", fromPhone: false },
        { threadId: "t-parser", at: "2026-10-29T09:25:00.000Z", fromPhone: true },
        { threadId: "t-tidy", at: "2026-10-29T13:50:00.000Z", fromPhone: false },
        { threadId: "t-tidy", at: "2026-10-29T14:45:00.000Z", fromPhone: false },
      ],
      messages: [
        // Before the journal day.
        { threadId: "t-night", at: "2026-10-29T02:45:00.000Z", author: "agent", text: "The night build is green." },
        { threadId: "t-parser", at: "2026-10-29T08:20:00.000Z", author: "user", text: "The parser drops dates like 29.10. without a year. Can you fix that?" },
        {
          threadId: "t-parser",
          at: "2026-10-29T09:10:00.000Z",
          author: "agent",
          text: "Dates without a year now parse, and postlude#14 adds a test for them.",
        },
        { threadId: "t-parser", at: "2026-10-29T09:25:00.000Z", author: "phone", text: "Merge it once the checks pass." },
        { threadId: "t-tidy", at: "2026-10-29T13:50:00.000Z", author: "user", text: "Split the task list tests by command." },
        {
          threadId: "t-tidy",
          at: "2026-10-29T14:30:00.000Z",
          author: "delegates",
          text: "Delegated task (Split the tests) [completed]:\nThe tests now sit in one file per command.",
        },
        {
          threadId: "t-tidy",
          at: "2026-10-29T14:40:00.000Z",
          author: "agent",
          text: `The old helper is gone:\n\n\`\`\`ts\n${Array.from({ length: CODE_BLOCK_MAX_LINES + 1 }, (_, index) => `const line${index} = ${index};`).join("\n")}\n\`\`\`\n\nA short block stays:\n\n\`\`\`sh\nbun test\n\`\`\``,
        },
        { threadId: "t-deploy", at: "2026-10-30T02:00:00.000Z", author: "schedule", text: "Check whether the deploy finished." },
      ],
      threads: [
        { title: "Settled today", project: "postlude", settledAt: "2026-10-29T16:00:00.000Z", snoozedUntil: null, createdAt: "2026-10-28T10:00:00.000Z" },
        { title: "Settled yesterday", project: "postlude", settledAt: "2026-10-28T16:00:00.000Z", snoozedUntil: null, createdAt: "2026-10-27T10:00:00.000Z" },
        { title: "Long open", project: "dev", settledAt: null, snoozedUntil: null, createdAt: "2026-10-25T10:00:00.000Z" },
        { title: "Recently opened", project: "dev", settledAt: null, snoozedUntil: null, createdAt: "2026-10-28T10:00:00.000Z" },
        { title: "Snoozed", project: "dev", settledAt: null, snoozedUntil: "2026-11-02T08:00:00.000Z", createdAt: "2026-10-20T10:00:00.000Z" },
        { title: "Settled later", project: "nix-config", settledAt: "2026-10-30T12:00:00.000Z", snoozedUntil: null, createdAt: "2026-10-20T10:00:00.000Z" },
      ],
    },
  },
  kontor: { ok: false, error: "kontor could not run: Executable not found in $PATH" },
};
