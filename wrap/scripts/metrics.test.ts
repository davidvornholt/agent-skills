import { describe, expect, test } from "bun:test";
import { computeDayMetrics, METRICS_VERSION, parseSummary } from "./metrics.ts";
import type { Sources } from "./sources.ts";
import { DAY, event, sources, summary, WINDOW } from "./testing/fixtures.ts";

const metrics = (changes: Partial<Sources> = {}) => computeDayMetrics(WINDOW, { ...sources, ...changes });
const unavailable = { ok: false, error: "unreachable" } as const;
const coverageOf = (changes: Partial<Sources>, prefix: string) =>
  metrics(changes).dayMetrics.coverage.filter((entry) => entry.source === prefix || entry.source.startsWith(`${prefix}:`));

test("computes every metric of a day with all sources", () => {
  expect(metrics()).toEqual({
    dayMetrics: {
      metricsVersion: METRICS_VERSION,
      day: DAY,
      activeMinutes: 330,
      firstActivityAt: "2026-10-29T08:12:00+01:00",
      lastActivityAt: "2026-10-29T23:40:00+01:00",
      focusMinutes: 200,
      scatteredMinutes: 130,
      categories: [
        { id: "code", label: "Code", minutes: 200 },
        { id: "mail", label: "Mail", minutes: 80 },
        { id: "admin", label: "Admin", minutes: 50 },
      ],
      offComputerMinutes: 120,
      appointmentMinutes: 180,
      appointmentOffScreenMinutes: null,
      landedPrs: 2,
      sentMails: [
        { mailbox: "a@example.com", count: null },
        { mailbox: "b@example.com", count: 2 },
        { mailbox: "c@example.com", count: 2 },
      ],
      coverage: [
        { source: "activity:david-x1-nixos", status: "partial" },
        { source: "activity:david-z890-nixos", status: "complete" },
        { source: "sp", status: "complete" },
        { source: "github", status: "complete" },
        { source: "mail:a@example.com", status: "missing" },
        { source: "mail:b@example.com", status: "complete" },
        { source: "mail:c@example.com", status: "partial" },
        { source: "calendar:me@example.com", status: "complete" },
        { source: "calendar:work@example.com", status: "complete" },
      ],
    },
    problems: [
      "Some activity hosts were not complete, so off-screen appointment time is unknown.",
      "Sent mail of a@example.com unavailable: login failed",
      "The sent-mail search of c@example.com hit its limit inside the day.",
    ],
  });
});

test("gives the same output for the same input", () => {
  expect(JSON.stringify(metrics())).toBe(JSON.stringify(metrics()));
});

test("unreachable sources become missing coverage and null numbers, never zero", () => {
  const { dayMetrics, problems } = metrics({ summary: unavailable, sp: unavailable, github: unavailable, mail: unavailable, calendar: unavailable });
  expect(dayMetrics).toMatchObject({
    activeMinutes: null,
    firstActivityAt: null,
    focusMinutes: null,
    scatteredMinutes: null,
    categories: [],
    offComputerMinutes: null,
    appointmentMinutes: null,
    appointmentOffScreenMinutes: null,
    landedPrs: null,
    sentMails: [],
  });
  expect(dayMetrics.coverage).toEqual(["activity", "sp", "github", "mail", "calendar"].map((source) => ({ source, status: "missing" })));
  expect(problems).toHaveLength(5);
});

describe("activity", () => {
  test("rejects a summary of another version or day instead of guessing", () => {
    expect(() => parseSummary({ ...summary, summaryVersion: 1 }, DAY)).toThrow(/summaryVersion 1/);
    // A host whose activity-digest predates the Windows split.
    expect(() => parseSummary({ ...summary, summaryVersion: 2 }, DAY)).toThrow(/summaryVersion 2/);
    // A host whose activity-digest predates counting game controller input.
    expect(() => parseSummary({ ...summary, summaryVersion: 3 }, DAY)).toThrow(/summaryVersion 3/);
    // A host whose activity-digest predates sorting browser pages and documents.
    expect(() => parseSummary({ ...summary, summaryVersion: 4 }, DAY)).toThrow(/summaryVersion 4/);
    // A host whose activity-digest still calls a running day partial over snapshot lag.
    expect(() => parseSummary({ ...summary, summaryVersion: 5 }, DAY)).toThrow(/summaryVersion 5/);
    // A host whose activity-digest predates counting Windows used at the desk.
    expect(() => parseSummary({ ...summary, summaryVersion: 6 }, DAY)).toThrow(/summaryVersion 6/);
    // A host whose activity-digest predates the wider Learning category.
    expect(() => parseSummary({ ...summary, summaryVersion: 7 }, DAY)).toThrow(/summaryVersion 7/);
    // A host whose activity-digest predates the timeline by category and T3 project.
    expect(() => parseSummary({ ...summary, summaryVersion: 8 }, DAY)).toThrow(/summaryVersion 8/);
    // A host whose activity-digest predates window titles.
    expect(() => parseSummary({ ...summary, summaryVersion: 9 }, DAY)).toThrow(/summaryVersion 9/);
    expect(() => parseSummary(summary, "2026-10-28")).toThrow(/not 2026-10-28/);
    const { dayMetrics, problems } = metrics({ summary: { ok: true, value: { ...summary, summaryVersion: 1 } } });
    expect(dayMetrics.activeMinutes).toBeNull();
    expect(dayMetrics.coverage[0]).toEqual({ source: "activity", status: "missing" });
    expect(problems[0]).toStartWith("Activity summary unusable");
  });

  test("leaves the numbers null when every host is missing", () => {
    const hosts = summary.hosts.map((host) => ({ ...host, status: "missing", activeMinutes: null }));
    const { dayMetrics } = metrics({ summary: { ok: true, value: { ...summary, hosts } } });
    expect(dayMetrics.activeMinutes).toBeNull();
    expect(dayMetrics.categories).toEqual([]);
    expect(dayMetrics.coverage.slice(0, 2)).toEqual([
      { source: "activity:david-x1-nixos", status: "missing" },
      { source: "activity:david-z890-nixos", status: "missing" },
    ]);
  });

  test("rejects a summary without active intervals", () => {
    const { activeIntervals: _, ...withoutIntervals } = summary;
    expect(() => parseSummary(withoutIntervals, DAY)).toThrow(/activeIntervals is not a list/);
  });

  test("rejects a category without the T3 projects filed under it, which the metrics then leave out", () => {
    const categories = summary.categories.map(({ t3Projects: _, ...category }) => category);
    expect(() => parseSummary({ ...summary, categories }, DAY)).toThrow(/categories\[0\] needs an id, a label, minutes, and a list of T3 projects/);
  });

  test("reads the timeline and focus blocks as epoch milliseconds", () => {
    const parsed = parseSummary(summary, DAY);
    expect(parsed.timeline[0]).toEqual({
      start: Date.parse("2026-10-29T08:00:00+01:00"),
      end: Date.parse("2026-10-29T11:30:00+01:00"),
      category: "code",
      project: "~/dev/postlude",
    });
    expect(parsed.timeline.at(-1)).toMatchObject({ category: null, project: null });
    expect(parsed.focusBlocks).toEqual([{ start: Date.parse("2026-10-29T08:12:00+01:00"), end: Date.parse("2026-10-29T11:32:00+01:00"), category: "code" }]);
    expect(() => parseSummary({ ...summary, timeline: undefined }, DAY)).toThrow(/timeline is not a list/);
    expect(() => parseSummary({ ...summary, timeline: [{ ...summary.timeline[0], project: 1 }] }, DAY)).toThrow(/timeline\[0\]\.project/);
  });

  test("reads the windows, and rejects a summary whose windows are malformed", () => {
    expect(parseSummary(summary, DAY).windows.at(5)).toEqual({
      start: Date.parse("2026-10-29T13:00:00+01:00"),
      end: Date.parse("2026-10-29T14:00:00+01:00"),
      app: "accounts.exe",
      title: null,
    });
    expect(() => parseSummary({ ...summary, windows: undefined }, DAY)).toThrow(/windows is not a list/);
    expect(() => parseSummary({ ...summary, windows: [{ ...summary.windows[0], app: 1 }] }, DAY)).toThrow(/windows\[0\]\.app/);
    expect(() => parseSummary({ ...summary, windows: [{ ...summary.windows[0], end: "later" }] }, DAY)).toThrow(/windows\[0\] needs a start and an end/);
  });

  test("leaves the off-screen appointment time null unless every host is complete", () => {
    const withLaptop = (status: string) => ({
      ok: true as const,
      value: { ...summary, hosts: summary.hosts.map((host) => (host.host === "david-x1-nixos" ? { ...host, status } : host)) },
    });
    expect(metrics({ summary: withLaptop("complete") }).dayMetrics.appointmentOffScreenMinutes).toBe(90);
    for (const status of ["partial", "missing"]) {
      const { dayMetrics, problems } = metrics({ summary: withLaptop(status) });
      expect(dayMetrics.appointmentMinutes).toBe(180);
      expect(dayMetrics.appointmentOffScreenMinutes).toBeNull();
      expect(problems).toContain("Some activity hosts were not complete, so off-screen appointment time is unknown.");
    }
  });
});

describe("tracked time", () => {
  test("counts all time tracked in Super Productivity, each task without subtasks once", () => {
    if (!sources.sp.ok) throw new Error("fixture");
    // Garden's own total repeats its subtasks', so only Dig and Plant count; Walk's time on the day before doesn't.
    const tasks = sources.sp.value.tasks.filter((task) => ["garden", "dig", "plant", "walk"].includes(task.id));
    expect(metrics({ sp: { ok: true, value: { ...sources.sp.value, tasks } } }).dayMetrics.offComputerMinutes).toBe(65);
  });

  test("is zero, not unknown, when nothing was tracked", () => {
    if (!sources.sp.ok) throw new Error("fixture");
    const { dayMetrics } = metrics({ sp: { ok: true, value: { ...sources.sp.value, tasks: [] } } });
    expect(dayMetrics.offComputerMinutes).toBe(0);
    expect(dayMetrics.coverage).toContainEqual({ source: "sp", status: "complete" });
  });
});

describe("landed PRs", () => {
  test("marks an incomplete search as partial and keeps the count as a lower bound", () => {
    if (!sources.github.ok) throw new Error("fixture");
    const github = { ok: true as const, value: { ...sources.github.value, incomplete: true } };
    expect(metrics({ github }).dayMetrics.landedPrs).toBe(2);
    expect(coverageOf({ github }, "github")).toEqual([{ source: "github", status: "partial" }]);
  });
});

describe("sent mail", () => {
  test("counts a full page that reaches back before the day as complete", () => {
    const mail = {
      ok: true as const,
      value: [
        {
          mailbox: "c@example.com",
          reading: {
            ok: true as const,
            value: {
              sent: [
                { at: "2026-10-29T20:00:00+01:00", subject: "Today" },
                { at: "2026-10-28T19:00:00+01:00", subject: "Yesterday" },
              ],
              limitReached: true,
            },
          },
        },
      ],
    };
    expect(metrics({ mail }).dayMetrics.sentMails).toEqual([{ mailbox: "c@example.com", count: 1 }]);
    expect(coverageOf({ mail }, "mail")).toEqual([{ source: "mail:c@example.com", status: "complete" }]);
  });

  test("marks unreadable send dates as partial", () => {
    const mail = {
      ok: true as const,
      value: [
        {
          mailbox: "d@example.com",
          reading: {
            ok: true as const,
            value: {
              sent: [
                { at: "", subject: "No date" },
                { at: "2026-10-29T20:00:00+01:00", subject: "Today" },
              ],
              limitReached: false,
            },
          },
        },
      ],
    };
    expect(metrics({ mail }).dayMetrics.sentMails).toEqual([{ mailbox: "d@example.com", count: 1 }]);
    expect(coverageOf({ mail }, "mail")).toEqual([{ source: "mail:d@example.com", status: "partial" }]);
  });
});

describe("appointments", () => {
  const calendar = (accounts: NonNullable<Extract<Sources["calendar"], { ok: true }>["value"]>["accounts"], limitReached = false): Sources["calendar"] => ({
    ok: true,
    value: { accounts, limitReached },
  });
  const standup = event({ summary: "Standup", start: "2026-10-29T10:00:00+01:00", end: "2026-10-29T11:00:00+01:00" });

  test("ignore all-day events", () => {
    const value = calendar([
      { account: "me@example.com", failure: null, events: [standup, event({ summary: "Trip", start: "2026-10-28", end: "2026-10-30", allDay: true })] },
    ]);
    expect(metrics({ calendar: value }).dayMetrics.appointmentMinutes).toBe(60);
  });

  test("leave out a meeting whose answer couldn't be read and mark its calendar partial", () => {
    const unanswered = event({ summary: "Planning", start: "2026-10-29T16:00:00+01:00", end: "2026-10-29T17:00:00+01:00", declined: null });
    const value = calendar([
      { account: "me@example.com", failure: null, events: [standup, unanswered, { ...unanswered, start: "2026-10-29T18:00:00+01:00" }] },
    ]);
    const { dayMetrics, problems } = metrics({ calendar: value });
    expect(dayMetrics.appointmentMinutes).toBe(60);
    expect(coverageOf({ calendar: value }, "calendar")).toEqual([{ source: "calendar:me@example.com", status: "partial" }]);
    expect(problems).toEqual(
      expect.arrayContaining(["The user's answer to some meetings in the calendar of me@example.com couldn't be read, so they are left out."]),
    );
  });

  test("count an account that failed with some events as partial, and one that failed without any as missing", () => {
    const value = calendar([
      { account: "me@example.com", failure: "one event unreadable", events: [standup] },
      { account: "work@example.com", failure: "timeout", events: [] },
    ]);
    expect(metrics({ calendar: value }).dayMetrics.appointmentMinutes).toBe(60);
    expect(coverageOf({ calendar: value }, "calendar")).toEqual([
      { source: "calendar:me@example.com", status: "partial" },
      { source: "calendar:work@example.com", status: "missing" },
    ]);
  });

  test("are unknown when no account answered", () => {
    const value = calendar([{ account: "work@example.com", failure: "timeout", events: [] }]);
    expect(metrics({ calendar: value }).dayMetrics.appointmentMinutes).toBeNull();
    expect(metrics({ calendar: value }).dayMetrics.appointmentOffScreenMinutes).toBeNull();
  });

  test("mark every account partial when the event limit was reached", () => {
    const value = calendar([{ account: "me@example.com", failure: null, events: [standup] }], true);
    expect(coverageOf({ calendar: value }, "calendar")).toEqual([{ source: "calendar:me@example.com", status: "partial" }]);
  });
});
