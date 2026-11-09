import { describe, expect, test } from "bun:test";
import type { WindowPiece } from "./metrics.ts";
import { sources, summary, WINDOW } from "./testing/fixtures.ts";
import {
  buildParts,
  buildTimeline,
  dayWindows,
  PART_GAP_MINUTES,
  PART_MIN_MINUTES,
  PART_WINDOW_MIN_MINUTES,
  PART_WINDOWS,
  partAt,
  partBounds,
  type Timeline,
} from "./timeline.ts";

const at = (clock: string): number => Date.parse(`2026-10-29T${clock}:00+01:00`);
const piece = (start: string, end: string) => ({ start: at(start), end: at(end), category: "code", project: null });
const timeline = (pieces: Timeline["pieces"]): Timeline => ({
  status: "complete",
  pieces,
  focusBlocks: [],
  categoryLabels: { code: "Code" },
  agentRuns: { status: "complete", items: [] },
});
const clocks = (pieces: Timeline["pieces"]) => {
  const built = timeline(pieces);
  return buildParts(built, partBounds(WINDOW, built), [], []).map((part) => part.clock);
};

describe("parts", () => {
  test(`join screen time across gaps shorter than ${PART_GAP_MINUTES} minutes`, () => {
    expect(clocks([piece("09:00", "10:00"), piece("10:29", "11:00"), piece("11:30", "12:00")])).toEqual(["09:00–11:00", "11:30–12:00"]);
  });

  test(`fold a stretch with less than ${PART_MIN_MINUTES} minutes of screen time into the one before it`, () => {
    expect(clocks([piece("09:00", "10:00"), piece("22:00", "22:05")])).toEqual(["09:00–22:05"]);
  });

  test("compare a stretch's screen time with the minimum before rounding it", () => {
    const almostTen = { start: at("22:00"), end: at("22:00") + (PART_MIN_MINUTES - 1) * 60_000 + 31_000, category: "code", project: null };
    expect(clocks([piece("09:00", "10:00"), almostTen])).toEqual(["09:00–22:09"]);
  });

  test("fold a short first stretch into the one after it", () => {
    expect(clocks([piece("05:00", "05:05"), piece("09:00", "10:00"), piece("14:00", "15:00")])).toEqual(["05:00–10:00", "14:00–15:00"]);
  });

  test("don't exist without screen time", () => {
    expect(partBounds(WINDOW, timeline([]))).toEqual([]);
    expect(buildParts(timeline([]), [], [], [])).toEqual([]);
  });

  test("place an instant in the part whose stretch it follows, from the start to the end of the journal day", () => {
    const bounds = partBounds(WINDOW, timeline([piece("09:00", "10:00"), piece("14:00", "15:00")]));
    expect(partAt(bounds, WINDOW.startMs)).toBe(0);
    expect(partAt(bounds, at("12:00"))).toBe(0);
    expect(partAt(bounds, at("14:00"))).toBe(1);
    expect(partAt(bounds, WINDOW.endMs - 1)).toBe(1);
    expect(partAt(bounds, WINDOW.endMs)).toBeNull();
    expect(partAt([], at("12:00"))).toBeNull();
  });
});

describe("part windows", () => {
  const window = (start: string, end: string, app: string | null, title: string | null): WindowPiece => ({ start: at(start), end: at(end), app, title });
  const windows = (pieces: readonly WindowPiece[]) => {
    const built = timeline([piece("09:00", "10:00"), piece("14:00", "15:00")]);
    return buildParts(built, partBounds(WINDOW, built), [], pieces).map((part) => part.windows);
  };

  test("add up each window's time within the part, splitting a window that crosses into the next one", () => {
    expect(
      windows([
        window("09:00", "09:20", "org.example.Notes", "Seed list"),
        window("09:40", "09:50", "org.example.Notes", "Seed list"),
        window("13:50", "14:20", "org.example.Notes", "Seed list"),
      ]),
    ).toEqual([[{ app: "org.example.Notes", title: "Seed list", minutes: 40 }], [{ app: "org.example.Notes", title: "Seed list", minutes: 20 }]]);
  });

  test(`list the ${PART_WINDOWS} windows in front longest`, () => {
    const many = Array.from({ length: PART_WINDOWS + 2 }, (_, index) => {
      const start = at("09:00") + index * 4 * 60_000;
      return { start, end: start + (index + 1) * 10_000 + 2 * 60_000, app: "org.example.Notes", title: `Page ${String.fromCharCode(65 + index)}` };
    });
    const [listed] = windows(many);
    expect(listed?.map((entry) => entry.title)).toEqual(
      many
        .toReversed()
        .slice(0, PART_WINDOWS)
        .map((entry) => entry.title),
    );
  });

  test(`need at least ${PART_WINDOW_MIN_MINUTES} minutes in a part before rounding`, () => {
    const lasting = (start: string, seconds: number, title: string): WindowPiece => ({
      start: at(start),
      end: at(start) + seconds * 1_000,
      app: "org.example.Notes",
      title,
    });
    // One second short of the minimum rounds up to it, so only a comparison before rounding leaves it out.
    const [listed] = windows([lasting("09:00", PART_WINDOW_MIN_MINUTES * 60 - 1, "Short note"), lasting("09:10", PART_WINDOW_MIN_MINUTES * 60, "Long note")]);
    expect(listed).toEqual([{ app: "org.example.Notes", title: "Long note", minutes: PART_WINDOW_MIN_MINUTES }]);
  });

  test("leave out T3 Code's and redacted windows, and moments with no window in front, but keep a known app without a title", () => {
    const [listed] = windows([
      window("09:00", "09:10", "com.t3tools.T3Code", "T3 Code"),
      window("09:10", "09:20", "t3code", "Some thread"),
      window("09:20", "09:30", "org.example.Browser", "T3 Code (Beta)"),
      window("09:30", "09:40", "<redacted>", "<redacted>"),
      window("09:40", "09:45", "org.example.Browser", "<redacted>"),
      window("09:45", "09:50", null, null),
      window("09:50", "09:55", "accounts.exe", null),
      window("09:55", "10:00", null, "Untitled"),
    ]);
    expect(listed).toEqual([
      { app: null, title: "Untitled", minutes: 5 },
      { app: "accounts.exe", title: null, minutes: 5 },
    ]);
  });

  test("come only from a usable summary, clipped to the journal day", () => {
    const late = { start: "2026-10-30T03:50:00.000+01:00", end: "2026-10-30T04:10:00.000+01:00", app: "org.example.Notes", title: "Seed list" };
    expect(dayWindows(WINDOW, { ...sources, summary: { ok: true, value: { ...summary, windows: [late] } } })).toEqual([
      { start: Date.parse(late.start), end: WINDOW.endMs, app: late.app, title: late.title },
    ]);
    expect(dayWindows(WINDOW, { ...sources, summary: { ok: true, value: { ...summary, summaryVersion: 8 } } })).toEqual([]);
  });
});

describe("buildTimeline", () => {
  test("is partial when an activity host wasn't fully read, and clips agent runs to the journal day", () => {
    const built = buildTimeline(WINDOW, sources);
    expect(built.status).toBe("partial");
    expect(built.categoryLabels).toEqual({ mail: "Mail", code: "Code", admin: "Admin" });
    expect(built.agentRuns.items[0]).toMatchObject({ threadTitle: "Night build", start: WINDOW.startMs });
  });

  test("is missing without a usable summary, but keeps the agent runs", () => {
    const built = buildTimeline(WINDOW, { ...sources, summary: { ok: true, value: { ...summary, summaryVersion: 8 } } });
    expect(built).toMatchObject({ status: "missing", pieces: [], focusBlocks: [] });
    expect(built.agentRuns.items).toHaveLength(3);
    expect(buildTimeline(WINDOW, { ...sources, t3: { ok: false, error: "unreachable" } }).agentRuns).toEqual({ status: "missing", items: [] });
  });
});
