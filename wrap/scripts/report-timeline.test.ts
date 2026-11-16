import { describe, expect, test } from "bun:test";
import { toBerlinIso } from "./day.ts";
import { buildCollected, type Collected } from "./day-report.ts";
import { LABEL_MAX_LENGTH, PULL_REQUESTS_PER_RUN, type TimelineBlock, type TimelineMark } from "./report-document.ts";
import { THREADS_PER_AREA, timelineBlock } from "./report-timeline.ts";
import { APPS_PER_MARK, FOCUS_MIN_MINUTES, SWITCH_GRACE_MINUTES, THREADS_PER_MARK, WINDOWS_PER_MARK } from "./screen-marks.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";
import type { ScreenWindow, TimelineThread } from "./timeline.ts";

const collected = buildCollected(WINDOW, sources);
const TITLES = ["The parser", "Tidying tests"];
const NAMES = new Map([["t-tidy", "Task tool tests"]]);
const NO_NAMES = new Map<string, string>();
const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => toBerlinIso(ms);

const block = timelineBlock(collected, "Timeline", TITLES, NAMES);

const withTimeline = (changes: Partial<Collected["timeline"]>, inputs: Partial<Collected["reportInputs"]> = {}): Collected => ({
  ...collected,
  timeline: { ...collected.timeline, ...changes },
  reportInputs: { ...collected.reportInputs, ...inputs },
});
const none = { status: "complete" as const, items: [] };
const quiet = { appointments: none, landedPrs: none, parts: [] };
const bare = { status: "complete" as const, pieces: [], focusBlocks: [], windows: [], threads: none, sentMail: { status: "complete" as const, items: [] } };
const thread = (fields: Partial<TimelineThread> & Pick<TimelineThread, "id" | "title">): TimelineThread => ({
  project: "~/dev/postlude",
  category: "code",
  runs: [],
  prompts: [],
  pullRequests: [],
  ...fields,
});

const rowsOf = (drawn: TimelineBlock) => drawn.groups.flatMap((group) => group.rows);
const row = (drawn: TimelineBlock, label: string) => {
  const found = rowsOf(drawn).find((entry) => entry.label === label);
  if (found === undefined) throw new Error(`No row ${label}.`);
  return found;
};
const marksOf = (drawn: TimelineBlock, kind: TimelineMark["kind"]) => rowsOf(drawn).flatMap((entry) => entry.marks.filter((mark) => mark.kind === kind));

describe("timelineBlock", () => {
  test("has the parts, a row per area, the calendar, pull requests and mail, and each area's threads", () => {
    expect(block.heading).toBe("Timeline");
    expect(block.groups.map((group) => group.title)).toEqual([
      "The day in parts",
      "Your screen time by area",
      "Appointments, pull requests and mail",
      "Threads · Code",
      "Threads · Not categorised",
    ]);
    expect(rowsOf(block).map((entry) => entry.label)).toEqual([
      "Parts",
      "Code",
      "Admin",
      "Mail",
      "Not categorised",
      "Calendar",
      "Pull requests",
      "Sent mail",
      "Fix the parser",
      "Task tool tests",
      "Write docs",
      "Night build",
      "Watch the deploy",
    ]);
    // A thread the agent named keeps its T3 title in the note, so it can still be found in T3 Code.
    expect(row(block, "Task tool tests").note).toBe("Tidy tests · sp-cli");
    expect(row(block, "Fix the parser").note).toBe("postlude");
  });

  test("numbers the parts, with the agent's titles and the parts' times", () => {
    expect(row(block, "Parts").marks).toEqual(
      collected.reportInputs.parts.map((part, index) => ({ kind: "part", start: part.start, end: part.end, number: index + 1, title: TITLES[index] ?? "" })),
    );
    expect(row(block, "Parts").marks[0]).toMatchObject({ start: "2026-10-29T04:00:00+01:00", end: "2026-10-29T13:00:00+01:00" });
  });

  test("gives each stretch of screen time its minutes, apps, projects, prompted threads, window titles, and whether it counted as focus", () => {
    expect(row(block, "Code").total).toEqual({ minutes: 389 });
    expect(row(block, "Code").marks).toEqual([
      // A minute away at 09:40 lies inside the stretch, so it has a minute less on screen than its span.
      {
        kind: "screen",
        start: "2026-10-29T08:00:00+01:00",
        end: "2026-10-29T11:30:00+01:00",
        minutes: 209,
        apps: [{ name: "T3 Code", minutes: 209 }],
        projects: ["postlude"],
        threads: ["Fix the parser"],
        focus: { status: "counted", start: "2026-10-29T08:00:00+01:00", end: "2026-10-29T11:30:00+01:00", minutes: 209 },
      },
      {
        kind: "screen",
        start: "2026-10-29T14:00:00+01:00",
        end: "2026-10-29T17:00:00+01:00",
        minutes: 180,
        apps: [{ name: "T3 Code", minutes: 180 }],
        projects: ["sp-cli"],
        threads: ["Task tool tests"],
        focus: { status: "counted", start: "2026-10-29T14:00:00+01:00", end: "2026-10-29T17:00:00+01:00", minutes: 180 },
      },
      { kind: "focus", start: "2026-10-29T08:00:00+01:00", end: "2026-10-29T11:30:00+01:00", minutes: 209 },
      { kind: "focus", start: "2026-10-29T14:00:00+01:00", end: "2026-10-29T17:00:00+01:00", minutes: 180 },
    ]);
    // Seven minutes of admin end the first stretch of mail at 18 minutes, short of focus. The calculator was in front for exactly a minute, and the redacted window is left out.
    expect(row(block, "Mail").marks).toEqual([
      {
        kind: "screen",
        start: "2026-10-29T11:30:00+01:00",
        end: "2026-10-29T11:48:00+01:00",
        minutes: 18,
        apps: [
          { name: "Mail", minutes: 17 },
          { name: "Calculator", minutes: 1 },
        ],
        windows: ["Inbox - Mail", "Split the bill - Calculator"],
        focus: { status: "short", minutes: 18, needs: FOCUS_MIN_MINUTES },
      },
      {
        kind: "screen",
        start: "2026-10-29T11:55:00+01:00",
        end: "2026-10-29T12:00:00+01:00",
        minutes: 5,
        apps: [{ name: "Mail", minutes: 5 }],
        windows: ["Inbox - Mail"],
        focus: { status: "short", minutes: 5, needs: FOCUS_MIN_MINUTES },
      },
    ]);
    // A window with a redacted title is left out with its app, and time in no area never counts as focus.
    expect(row(block, "Not categorised").marks).toEqual([
      {
        kind: "screen",
        start: "2026-10-29T17:00:00+01:00",
        end: "2026-10-29T18:30:00+01:00",
        minutes: 90,
        apps: [{ name: "Writer", minutes: 70 }],
        windows: ["Garden plan - Writer"],
        focus: { status: "noArea" },
      },
    ]);
    const text = JSON.stringify(block);
    for (const hidden of ["T3 Code (Beta)", "org.example.Mail", "accounts.exe", "<redacted>"]) expect(text).not.toContain(hidden);
  });

  test(`names at most ${APPS_PER_MARK} apps and ${WINDOWS_PER_MARK} window titles in a mark, those in front longest first`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    const windows: ScreenWindow[] = Array.from({ length: APPS_PER_MARK + 1 }, (_, index) => ({
      start: nine + index * 600_000,
      end: nine + index * 600_000 + (index + 1) * 60_000,
      app: `App ${index + 1}`,
      title: `Window ${index + 1}`,
    }));
    const pieces = [{ start: nine, end: nine + 3_600_000, category: "code", project: null }];
    const drawn = timelineBlock(withTimeline({ ...bare, pieces, windows }, quiet), "Timeline", [], NO_NAMES);
    expect(marksOf(drawn, "screen")).toEqual([
      {
        kind: "screen",
        start: "2026-10-29T09:00:00+01:00",
        end: "2026-10-29T10:00:00+01:00",
        minutes: 60,
        apps: [6, 5, 4, 3, 2].map((number) => ({ name: `App ${number}`, minutes: number })),
        windows: ["Window 6", "Window 5", "Window 4"],
        // An hour, but the summary has no focus block for it.
        focus: { status: "notCounted" },
      },
    ]);
  });

  test(`joins a row's screen time across gaps shorter than ${SWITCH_GRACE_MINUTES} minutes, and counts only the screen time`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    // Forty pieces of half a minute, one minute apart.
    const short = Array.from({ length: 40 }, (_, index) => ({ start: nine + index * 90_000, end: nine + index * 90_000 + 30_000 }));
    // Begins exactly that gap after the last short piece ends, so it stays a mark of its own.
    const apart = { start: at("2026-10-29T09:59:00+01:00") + SWITCH_GRACE_MINUTES * 60_000, end: at("2026-10-29T10:05:00+01:00") };
    const pieces = [...short, apart].map((piece) => ({ ...piece, category: "code", project: "~/dev/postlude" }));
    const drawn = timelineBlock(withTimeline({ ...bare, pieces }, quiet), "Timeline", [], NO_NAMES);
    expect(marksOf(drawn, "screen")).toEqual([
      {
        kind: "screen",
        start: "2026-10-29T09:00:00+01:00",
        end: "2026-10-29T09:59:00+01:00",
        minutes: 20,
        projects: ["postlude"],
        focus: { status: "short", minutes: 20, needs: FOCUS_MIN_MINUTES },
      },
      {
        kind: "screen",
        start: "2026-10-29T10:01:00+01:00",
        end: "2026-10-29T10:05:00+01:00",
        minutes: 4,
        projects: ["postlude"],
        focus: { status: "short", minutes: 4, needs: FOCUS_MIN_MINUTES },
      },
    ]);
  });

  test("says a stretch counted as focus only where the summary has a focus block, and why not where it doesn't", () => {
    const piece = (start: string, end: string, category: string) => ({
      start: at(`2026-10-29T${start}:00+01:00`),
      end: at(`2026-10-29T${end}:00+01:00`),
      category,
      project: null,
    });
    const block = (start: string, end: string, category: string) => ({
      start: at(`2026-10-29T${start}:00+01:00`),
      end: at(`2026-10-29T${end}:00+01:00`),
      category,
    });
    const focusOf = (pieces: ReturnType<typeof piece>[], focusBlocks: ReturnType<typeof block>[], label: string) =>
      timelineBlock(withTimeline({ ...bare, pieces, focusBlocks, categoryLabels: { code: "Code", mail: "Mail" } }, quiet), "Timeline", [], NO_NAMES)
        .groups.flatMap((group) => group.rows)
        .filter((entry) => entry.label === label)
        .flatMap((entry) => entry.marks.flatMap((mark) => (mark.kind === "screen" ? [mark.focus] : [])));
    // A minute of mail inside a focus block on code, then 30 more: the summary's scan resumed after the code block, so only the mail after it counted.
    const pieces = [piece("09:00", "09:30", "code"), piece("09:30", "09:31", "mail"), piece("09:31", "09:32", "code"), piece("09:32", "10:02", "mail")];
    expect(focusOf(pieces, [block("09:00", "09:32", "code"), block("09:32", "10:02", "mail")], "Mail")).toEqual([
      { status: "counted", start: "2026-10-29T09:32:00+01:00", end: "2026-10-29T10:02:00+01:00", minutes: 30 },
    ]);
    // Long enough, but the summary has no block of its own: its start counted toward the code block.
    expect(focusOf(pieces, [block("09:00", "09:32", "code")], "Mail")).toEqual([{ status: "notCounted", within: "Code" }]);
    // Without any block there, the card claims no reason it can't show.
    expect(focusOf(pieces, [], "Mail")).toEqual([{ status: "notCounted" }]);
  });

  test(`names the threads of the row's area prompted in a stretch, at most ${THREADS_PER_MARK}, and counts the rest`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    const pieces = [{ start: nine, end: nine + 3_600_000, category: "code", project: null }];
    const items = [
      ...Array.from({ length: THREADS_PER_MARK + 2 }, (_, index) =>
        thread({ id: `t-${index}`, title: `Thread ${index + 1}`, prompts: [{ at: nine + index * 60_000, fromPhone: false }] }),
      ),
      thread({ id: "t-home", title: "Garden", category: "home", prompts: [{ at: nine, fromPhone: false }] }),
      thread({ id: "t-later", title: "Later", prompts: [{ at: nine + 7_200_000, fromPhone: false }] }),
    ];
    const drawn = timelineBlock(withTimeline({ ...bare, pieces, threads: { status: "complete", items } }, quiet), "Timeline", [], new Map([["t-0", "First"]]));
    expect(marksOf(drawn, "screen")[0]).toMatchObject({ threads: ["First", "Thread 2", "Thread 3", "Thread 4", "Thread 5"], moreThreads: 2 });
  });

  test("gives a thread's runs, joined where they overlap, with the pull requests they landed, and its prompts", () => {
    expect(row(block, "Task tool tests").marks).toEqual([
      { kind: "run", start: "2026-10-29T15:00:00+01:00", end: "2026-10-29T15:40:00+01:00" },
      // sp-cli#7 merged at 16:00, so it goes to the last run that had started by then.
      {
        kind: "run",
        start: "2026-10-29T15:45:00+01:00",
        end: "2026-10-29T16:00:00+01:00",
        pullRequests: [{ repository: "sp-cli", number: 7, title: "Afternoon" }],
      },
      { kind: "prompt", at: "2026-10-29T14:50:00+01:00" },
      { kind: "prompt", at: "2026-10-29T15:45:00+01:00" },
    ]);
    expect(row(block, "Fix the parser").marks).toContainEqual({ kind: "prompt", at: "2026-10-29T10:25:00+01:00", fromPhone: true });

    const runs = [
      { start: at("2026-10-29T09:00:00+01:00"), end: at("2026-10-29T09:40:00+01:00") },
      { start: at("2026-10-29T09:30:00+01:00"), end: at("2026-10-29T10:00:00+01:00") },
    ];
    const landed = { repository: "davidvornholt/postlude", number: 12, mergedAt: at("2026-10-29T08:00:00+01:00") };
    const drawn = timelineBlock(
      withTimeline(
        { ...bare, threads: { status: "complete", items: [thread({ id: "a", title: "", runs, pullRequests: [landed] })] } },
        {
          ...quiet,
          landedPrs: collected.reportInputs.landedPrs,
        },
      ),
      "Timeline",
      [],
      NO_NAMES,
    );
    expect(row(drawn, "Untitled thread").note).toBe("postlude");
    // Merged before any run had started, so it goes to the first.
    expect(marksOf(drawn, "run")).toEqual([
      {
        kind: "run",
        start: "2026-10-29T09:00:00+01:00",
        end: "2026-10-29T10:00:00+01:00",
        pullRequests: [{ repository: "postlude", number: 12, title: "Start of day" }],
      },
    ]);
  });

  describe("a run that landed more pull requests than Postlude takes on one run", () => {
    // Postlude's pullRequestsPerRun, written out here so that a wrong mirror in the code is caught.
    const POSTLUDE_LIMIT = 40;
    const start = at("2026-10-29T21:34:00+01:00");
    const end = at("2026-10-30T03:26:00+01:00");
    const drawRuns = (mergedAts: readonly number[], run = { start, end }) => {
      const landed = mergedAts.map((mergedAt, index) => ({ repository: "davidvornholt/postlude", number: index + 1, mergedAt }));
      const landedPrs = {
        status: "complete" as const,
        items: landed.map((pr) => ({
          repository: pr.repository,
          number: pr.number,
          ref: `${pr.repository}#${pr.number}`,
          part: null,
          title: `PR ${pr.number}`,
          summary: null,
          mergedAt: new Date(pr.mergedAt).toISOString(),
        })),
      };
      const drawn = timelineBlock(
        withTimeline(
          { ...bare, threads: { status: "complete", items: [thread({ id: "a", title: "Night shift", runs: [run], pullRequests: landed })] } },
          { ...quiet, landedPrs },
        ),
        "Timeline",
        [],
        NO_NAMES,
      );
      return row(drawn, "Night shift").marks.flatMap((mark) => (mark.kind === "run" ? [mark] : []));
    };
    const numbersOf = (marks: ReturnType<typeof drawRuns>) => marks.flatMap((mark) => (mark.pullRequests ?? []).map((pr) => pr.number));

    test("splits the run at merge times, so that no run holds more than Postlude takes and none is dropped", () => {
      // 63 pull requests, one every five minutes from 21:40.
      const mergedAts = Array.from({ length: 63 }, (_, index) => start + (6 + index * 5) * 60_000);
      const runs = drawRuns(mergedAts);
      expect(runs.map((mark) => mark.pullRequests?.length)).toEqual([POSTLUDE_LIMIT, 23]);
      expect(numbersOf(runs)).toEqual(Array.from({ length: 63 }, (_, index) => index + 1));
      // Together the runs still cover the stretch, without a gap or an overlap, and each pull request sits in the run it merged in.
      expect(runs[0]?.start).toBe("2026-10-29T21:34:00+01:00");
      expect(runs.at(-1)?.end).toBe("2026-10-30T03:26:00+01:00");
      expect(runs[0]?.end).toBe(runs[1]?.start);
      expect(runs[1]?.start).toBe(iso(mergedAts[POSTLUDE_LIMIT] ?? 0));
    });

    test("leaves a run of exactly the limit whole", () => {
      const runs = drawRuns(Array.from({ length: POSTLUDE_LIMIT }, (_, index) => start + (index + 1) * 60_000));
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ start: "2026-10-29T21:34:00+01:00", end: "2026-10-30T03:26:00+01:00" });
      expect(runs[0]?.pullRequests).toHaveLength(POSTLUDE_LIMIT);
    });

    test("keeps the runs in order and gapless when the pull requests merged in the same second or after the run ended", () => {
      const sameSecond = drawRuns(Array.from({ length: 2 * POSTLUDE_LIMIT + 1 }, () => start + 60_000));
      expect(sameSecond.map((mark) => mark.pullRequests?.length)).toEqual([POSTLUDE_LIMIT, POSTLUDE_LIMIT, 1]);
      const afterwards = drawRuns(Array.from({ length: POSTLUDE_LIMIT + 5 }, (_, index) => end + (index + 1) * 60_000));
      expect(afterwards.map((mark) => mark.pullRequests?.length)).toEqual([POSTLUDE_LIMIT, 5]);
      for (const marks of [sameSecond, afterwards]) {
        expect(marks[0]?.start).toBe("2026-10-29T21:34:00+01:00");
        expect(marks.at(-1)?.end).toBe("2026-10-30T03:26:00+01:00");
        for (const [index, mark] of marks.entries()) {
          expect(Date.parse(mark.end)).toBeGreaterThanOrEqual(Date.parse(mark.start));
          const before = marks[index - 1];
          if (before !== undefined) expect(mark.start).toBe(before.end);
        }
      }
    });

    test("splits a run that lasted a second, as Postlude allows a run with no length", () => {
      const short = { start, end: start + 1000 };
      const mergedAts = Array.from({ length: POSTLUDE_LIMIT + 1 }, (_, index) => short.end + (index + 1) * 60_000);
      const runs = drawRuns(mergedAts, short);
      expect(runs.map((mark) => mark.pullRequests?.length)).toEqual([POSTLUDE_LIMIT, 1]);
      expect(runs[0]?.start).toBe("2026-10-29T21:34:00+01:00");
      expect(runs[0]?.end).toBe("2026-10-29T21:34:01+01:00");
      expect(runs[1]).toMatchObject({ start: "2026-10-29T21:34:01+01:00", end: "2026-10-29T21:34:01+01:00" });
    });
  });

  describe("a row with more marks than Postlude takes on one row", () => {
    // Postlude's marksPerRow, written out here so that a wrong mirror in the code is caught.
    const POSTLUDE_LIMIT = 2000;
    const nine = at("2026-10-29T09:00:00+01:00");
    const run = { start: nine, end: nine + 3_600_000 };
    const prompts = (count: number) => Array.from({ length: count }, (_, index) => ({ at: nine + index * 1000, fromPhone: false }));
    const busy = (count: number, fields: Partial<TimelineThread> = {}) =>
      thread({ id: "busy", title: "Busy thread", runs: [run], prompts: prompts(count), ...fields });
    const draw = (items: readonly TimelineThread[], inputs: Partial<Collected["reportInputs"]> = quiet) =>
      rowsOf(timelineBlock(withTimeline({ ...bare, threads: { status: "complete", items } }, inputs), "Timeline", [], NO_NAMES));

    test("draws it as consecutive rows of at most that many, the earliest marks first, and drops none", () => {
      const rows = draw([busy(POSTLUDE_LIMIT + 1)]);
      expect(rows.map((entry) => [entry.label, entry.note, entry.marks.length])).toEqual([
        ["Busy thread (1 of 2)", "postlude", POSTLUDE_LIMIT],
        ["Busy thread (2 of 2)", "postlude", 2],
      ]);
      expect(rows.flatMap((entry) => entry.marks)).toEqual([
        { kind: "run", start: "2026-10-29T09:00:00+01:00", end: "2026-10-29T10:00:00+01:00" },
        ...prompts(POSTLUDE_LIMIT + 1).map((prompt) => ({ kind: "prompt" as const, at: iso(prompt.at) })),
      ]);
    });

    test("leaves a row of exactly the limit whole", () => {
      const rows = draw([busy(POSTLUDE_LIMIT - 1)]);
      expect(rows.map((entry) => [entry.label, entry.marks.length])).toEqual([["Busy thread", POSTLUDE_LIMIT]]);
    });

    test("splits a row that a run split for its pull requests pushed over the limit", () => {
      // 1,999 prompts and a run that landed 41 pull requests, which becomes two runs: 2,001 marks.
      const landed = Array.from({ length: PULL_REQUESTS_PER_RUN + 1 }, (_, index) => ({
        repository: "davidvornholt/postlude",
        number: index + 1,
        mergedAt: nine + (index + 1) * 60_000,
      }));
      const landedPrs = {
        status: "complete" as const,
        items: landed.map((pr) => ({
          repository: pr.repository,
          number: pr.number,
          ref: `postlude#${pr.number}`,
          part: null,
          title: `PR ${pr.number}`,
          summary: null,
          mergedAt: new Date(pr.mergedAt).toISOString(),
        })),
      };
      const rows = draw([busy(POSTLUDE_LIMIT - 1, { pullRequests: landed })], { ...quiet, landedPrs }).filter((entry) => entry.label.startsWith("Busy thread"));
      expect(rows.map((entry) => entry.marks.length)).toEqual([POSTLUDE_LIMIT, 1]);
      const runs = rows.flatMap((entry) => entry.marks.flatMap((mark) => (mark.kind === "run" ? [mark] : [])));
      expect(runs.flatMap((mark) => (mark.pullRequests ?? []).map((pr) => pr.number))).toEqual(landed.map((pr) => pr.number));
      expect(rows.flatMap((entry) => entry.marks).filter((mark) => mark.kind === "prompt")).toHaveLength(POSTLUDE_LIMIT - 1);
    });

    test("cuts a long label so that its number still fits", () => {
      const rows = draw([busy(POSTLUDE_LIMIT + 1, { title: "x".repeat(LABEL_MAX_LENGTH) })]);
      for (const [index, entry] of rows.entries()) {
        expect(entry.label.length).toBeLessThanOrEqual(LABEL_MAX_LENGTH);
        expect(entry.label).toEndWith(`… (${index + 1} of 2)`);
      }
    });

    test("shows a row's total only on its first row, because it is the whole row's", () => {
      // No day has room for this many stretches of one area, a minute each and three apart, but the rule holds for every row.
      const pieces = Array.from({ length: POSTLUDE_LIMIT + 1 }, (_, index) => ({
        start: nine + index * 240_000,
        end: nine + index * 240_000 + 60_000,
        category: "code",
        project: null,
      }));
      const rows = rowsOf(timelineBlock(withTimeline({ ...bare, pieces }, quiet), "Timeline", [], NO_NAMES));
      expect(rows.map((entry) => [entry.label, entry.total, entry.marks.length])).toEqual([
        ["Code (1 of 2)", { minutes: POSTLUDE_LIMIT + 1 }, POSTLUDE_LIMIT],
        ["Code (2 of 2)", undefined, 1],
      ]);
    });
  });

  test(`draws the ${THREADS_PER_AREA} threads of an area with the most prompts, in order of their first activity, and the rest in one row named by its threads`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    const items = Array.from({ length: THREADS_PER_AREA + 2 }, (_, index) =>
      thread({
        id: `t-${index}`,
        title: `Thread ${String.fromCharCode(65 + index)}`,
        // Thread A starts last and has the most prompts; the last two have the fewest.
        prompts: Array.from({ length: THREADS_PER_AREA + 2 - index }, (_, prompt) => ({ at: nine - index * 600_000 + prompt * 60_000, fromPhone: false })),
      }),
    );
    const drawn = timelineBlock(withTimeline({ ...bare, threads: { status: "complete", items } }, quiet), "Timeline", [], new Map([["t-6", "Garden"]]));
    expect(rowsOf(drawn).map((entry) => entry.label)).toEqual(["Thread E", "Thread D", "Thread C", "Thread B", "Thread A", "2 other threads"]);
    expect(row(drawn, "2 other threads").note).toBe("Thread F; Garden");
  });

  test("names as many of the other threads as fit in a note, and counts the rest", () => {
    const items = Array.from({ length: THREADS_PER_AREA + 20 }, (_, index) =>
      thread({
        id: `t-${index}`,
        title: `A thread with a rather long title, number ${index}`,
        prompts: [{ at: at("2026-10-29T09:00:00+01:00"), fromPhone: false }],
      }),
    );
    const drawn = timelineBlock(withTimeline({ ...bare, threads: { status: "complete", items } }, quiet), "Timeline", [], NO_NAMES);
    const note = row(drawn, "20 other threads").note ?? "";
    expect(note.length).toBeLessThanOrEqual(LABEL_MAX_LENGTH);
    expect(note).toMatch(/^A thread with a rather long title, number \d+; .*; and \d+ more$/);
  });

  test("gives mail its time, mailbox and subject, and pull requests their repository as the report names it and their summary", () => {
    expect(row(block, "Sent mail").marks).toEqual([
      { kind: "mail", at: "2026-10-29T09:00:00+01:00", mailbox: "b@example.com", subject: "Garden plan for Saturday" },
      { kind: "mail", at: "2026-10-29T19:00:00+01:00", mailbox: "c@example.com", subject: "Invoice for October" },
      { kind: "mail", at: "2026-10-29T20:00:00+01:00", mailbox: "c@example.com", subject: "Re: Invoice for October" },
      { kind: "mail", at: "2026-10-30T02:00:00+01:00", mailbox: "b@example.com", subject: "Late reply" },
    ]);
    expect(row(block, "Pull requests").marks).toEqual([
      {
        kind: "pullRequest",
        at: "2026-10-29T04:00:00+01:00",
        repository: "postlude",
        number: 12,
        title: "Start of day",
        summary: "The morning page now opens with the weather.",
      },
      { kind: "pullRequest", at: "2026-10-29T16:00:00+01:00", repository: "sp-cli", number: 7, title: "Afternoon" },
    ]);
    // No word of a prompt or a conversation reaches the timeline.
    for (const message of sources.t3.ok ? sources.t3.value.messages : []) expect(JSON.stringify(block)).not.toContain(message.text.slice(0, 30));
    // An all-day appointment has no place on the timeline.
    expect(row(block, "Calendar").marks.map((mark) => (mark.kind === "appointment" ? mark.title : ""))).toEqual(["Standup", "Review", "Lunch", "Night train"]);
  });

  test("says what is missing, also on a day with nothing to draw", () => {
    expect(block.notes).toEqual([
      "Some computers' activity wasn't fully read, so some screen time may be missing.",
      "Some mailboxes could not be read in full, so some sent mail may be missing.",
    ]);
    const missing = timelineBlock(withTimeline({ ...bare, status: "missing", threads: { status: "missing", items: [] } }, quiet), "On the clock", [], NO_NAMES);
    expect(missing).toEqual({
      kind: "timeline",
      heading: "On the clock",
      groups: [],
      notes: ["Screen activity was not available.", "T3 Code was not available, so its threads are missing."],
    });
    expect(timelineBlock(withTimeline(bare, quiet), "Timeline", [], NO_NAMES)).toEqual({ kind: "timeline", heading: "Timeline", groups: [] });
  });
});
