import { expect, test } from "bun:test";
import { buildCollected } from "./day-report.ts";
import { buildReportInputs } from "./report-inputs.ts";
import type { Sources } from "./sources.ts";
import { event, sources, WINDOW } from "./testing/fixtures.ts";

test("builds the lists of a day with all sources", () => {
  expect(buildReportInputs(WINDOW, sources)).toEqual({
    handedOffTasks: {
      status: "complete",
      items: [
        { title: "Write tests", project: "Work" },
        { title: "Garden › Dig", project: "Home" },
        { title: "Shop", project: "Home" },
      ],
    },
    settledThreads: { status: "complete", items: [{ title: "Settled today", project: "postlude" }] },
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
        { repository: "davidvornholt/postlude", title: "Start of day" },
        { repository: "davidvornholt/sp-cli", title: "Afternoon" },
      ],
    },
    appointments: {
      status: "complete",
      items: [
        { time: null, title: "Holiday" },
        { time: "10:00–11:00", title: "Standup" },
        { time: "10:30–11:30", title: "Review" },
        { time: "12:00–13:00", title: "Lunch" },
        { time: "03:30–05:00", title: "Night train" },
      ],
    },
    kontor: { status: "missing", attempted: null, approvalNeeded: null },
  });
});

test("marks lists of unreachable sources as missing", () => {
  const unavailable = { ok: false, error: "unreachable" } as const;
  const inputs = buildReportInputs(WINDOW, { ...sources, sp: unavailable, t3: unavailable, github: unavailable, calendar: unavailable });
  for (const list of [inputs.handedOffTasks, inputs.settledThreads, inputs.openThreads, inputs.landedPrs, inputs.appointments]) {
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
  expect(buildReportInputs(WINDOW, { ...sources, calendar }).appointments).toEqual({ status: "partial", items: [] });
});

test("leaves out a meeting whose answer couldn't be read and marks appointments partial", () => {
  const events = [
    event({ summary: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00" }),
    event({ summary: "Planning", start: "2026-10-29T16:00:00+01:00", end: "2026-10-29T17:00:00+01:00", declined: null }),
  ];
  const calendar: Sources["calendar"] = { ok: true, value: { limitReached: false, accounts: [{ account: "me@example.com", failure: null, events }] } };
  expect(buildReportInputs(WINDOW, { ...sources, calendar }).appointments).toEqual({ status: "partial", items: [{ time: "10:00–11:00", title: "Standup" }] });
});

test("reads only whether Kontor has attempted a sync and needs approval", () => {
  const kontor = (value: unknown) => buildReportInputs(WINDOW, { ...sources, kontor: { ok: true, value } }).kontor;
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
  expect(collected.problems).toContain("T3 Code threads unavailable: ssh timed out");
  expect(collected.problems).toContain("Kontor status unavailable: kontor could not run: Executable not found in $PATH");
  expect(collected.window).toEqual({ start: "2026-10-29T04:00:00+01:00", end: "2026-10-30T04:00:00+01:00" });
});
