import { describe, expect, test } from "bun:test";
import { buildCollected, type Collected } from "./day-report.ts";
import { LABEL_MAX_LENGTH, type TimelineBlock, type TimelineMark } from "./report-document.ts";
import { THREADS_PER_AREA, timelineBlock } from "./report-timeline.ts";
import { APPS_PER_MARK, FOCUS_MIN_MINUTES, SWITCH_GRACE_MINUTES, THREADS_PER_MARK, WINDOWS_PER_MARK } from "./screen-marks.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";
import type { ScreenWindow, TimelineThread } from "./timeline.ts";

const collected = buildCollected(WINDOW, sources);
const TITLES = ["The parser", "Tidying tests"];
const NAMES = new Map([["t-tidy", "Task tool tests"]]);
const NO_NAMES = new Map<string, string>();
const at = (iso: string) => Date.parse(iso);

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
