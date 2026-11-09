import { expect, test } from "bun:test";
import { buildCollected } from "./day-report.ts";
import { buildReportInputs } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";
import { event, sources, WINDOW } from "./testing/fixtures.ts";
import { buildTimeline } from "./timeline.ts";

const inputs = (changes: Partial<Sources> = {}) => {
  const all = { ...sources, ...changes };
  return buildReportInputs(WINDOW, all, buildTimeline(WINDOW, all));
};

test("builds the parts and lists of a day with all sources", () => {
  expect(inputs()).toEqual({
    parts: [
      {
        start: "2026-10-29T08:00:00+01:00",
        end: "2026-10-29T12:00:00+01:00",
        clock: "08:00–12:00",
        screenMinutes: 240,
        areas: [
          { label: "Code", minutes: 210 },
          { label: "Mail", minutes: 30 },
        ],
        projects: [
          { project: "postlude", screenMinutes: 210, agentMinutes: 45 },
          // The run began before the journal day, so only its last half hour counts.
          { project: "nix-config", screenMinutes: 0, agentMinutes: 30 },
        ],
        threads: [
          { title: "Fix the parser", project: "postlude", agentMinutes: 45 },
          { title: "Night build", project: "nix-config", agentMinutes: 30 },
        ],
      },
      {
        start: "2026-10-29T13:00:00+01:00",
        end: "2026-10-29T18:30:00+01:00",
        clock: "13:00–18:30",
        screenMinutes: 330,
        areas: [
          { label: "Code", minutes: 180 },
          { label: "Not categorised", minutes: 90 },
          { label: "Admin", minutes: 60 },
        ],
        projects: [{ project: "sp-cli", screenMinutes: 180, agentMinutes: 40 }],
        threads: [{ title: "Tidy tests", project: "sp-cli", agentMinutes: 40 }],
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
        { repository: "davidvornholt/postlude", title: "Start of day", mergedAt: "2026-10-29T04:00:00+01:00", part: 0 },
        { repository: "davidvornholt/sp-cli", title: "Afternoon", mergedAt: "2026-10-29T16:00:00+01:00", part: 1 },
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
    offComputerTasks: {
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
  });
});

test("has no parts when screen activity is missing, so nothing is placed in one", () => {
  const unusable = inputs({ summary: { ok: false, error: "unreachable" } });
  expect(unusable.parts).toEqual([]);
  expect(unusable.landedPrs.items.map((pr) => pr.part)).toEqual([null, null]);
});

test("marks lists of unreachable sources as missing", () => {
  const unavailable = { ok: false, error: "unreachable" } as const;
  const lists = inputs({ sp: unavailable, t3: unavailable, github: unavailable, calendar: unavailable });
  for (const list of [lists.handedOffTasks, lists.settledThreads, lists.openThreads, lists.landedPrs, lists.appointments, lists.offComputerTasks]) {
    expect(list).toEqual({ status: "missing", items: [] });
  }
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
