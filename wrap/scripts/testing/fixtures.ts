import { dayWindow } from "../day.ts";
import type { CalendarEvent, Sources, SpTask } from "../sources.ts";

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
    { id: "mail", label: "Mail", minutes: 80 },
    { id: "code", label: "Code", minutes: 200 },
    { id: "admin", label: "Admin", minutes: 50 },
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
  }),
  task({ id: "late", title: "Shop", isDone: true, doneOn: at("2026-10-30T03:59:59+01:00"), timeSpentOnDay: { [DAY]: minutes(5) } }),
  task({ id: "next-day", title: "Next day", isDone: true, doneOn: at("2026-10-30T04:00:00+01:00") }),
  task({ id: "day-before", title: "Day before", isDone: true, doneOn: at("2026-10-28T20:00:00+01:00") }),
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
        { repository: "davidvornholt/postlude", title: "Start of day", mergedAt: "2026-10-29T03:00:00Z" },
        { repository: "davidvornholt/sp-cli", title: "Afternoon", mergedAt: "2026-10-29T15:00:00Z" },
        { repository: "davidvornholt/pim", title: "End of day belongs to the next day", mergedAt: "2026-10-30T03:00:00Z" },
      ],
    },
  },
  closedPrs: {
    ok: true,
    value: {
      incomplete: false,
      prs: [
        { repository: "davidvornholt/sp-cli", title: "Try a second parser", closedAt: "2026-10-29T10:45:00Z" },
        { repository: "davidvornholt/pim", title: "Closed the day before", closedAt: "2026-10-29T02:59:59Z" },
      ],
    },
  },
  mail: {
    ok: true,
    value: [
      {
        mailbox: "b@example.com",
        reading: { ok: true, value: { sentAt: ["2026-10-29T09:00:00+01:00", "2026-10-30T02:00:00+01:00", "2026-10-28T23:00:00+01:00"], limitReached: false } },
      },
      { mailbox: "a@example.com", reading: { ok: false, error: "login failed" } },
      { mailbox: "c@example.com", reading: { ok: true, value: { sentAt: ["2026-10-29T20:00:00+01:00", "2026-10-29T19:00:00+01:00"], limitReached: true } } },
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
      runs: [
        // Began before the journal day, so the timeline clips it to the day's start.
        { threadTitle: "Night build", project: "~/dev/nix-config", start: "2026-10-29T02:30:00.000Z", end: "2026-10-29T03:30:00.000Z" },
        { threadTitle: "Fix the parser", project: "~/dev/postlude", start: "2026-10-29T08:30:00.000Z", end: "2026-10-29T09:15:00.000Z" },
        { threadTitle: "Tidy tests", project: "~/dev/sp-cli", start: "2026-10-29T14:00:00.000Z", end: "2026-10-29T14:40:00.000Z" },
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
