import { describe, expect, test } from "bun:test";
import { sources, summary, WINDOW } from "./testing/fixtures.ts";
import { buildParts, buildTimeline, PART_GAP_MINUTES, PART_MIN_MINUTES, partAt, partBounds, type Timeline } from "./timeline.ts";

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
  return buildParts(built, partBounds(WINDOW, built), []).map((part) => part.clock);
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
    expect(buildParts(timeline([]), [], [])).toEqual([]);
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
