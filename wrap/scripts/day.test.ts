import { describe, expect, test } from "bun:test";
import { addDays, dayWindow, isDay, journalDayAt, toBerlinClock, toBerlinIso } from "./day.ts";

const hours = (window: { startMs: number; endMs: number }): number => (window.endMs - window.startMs) / 3_600_000;

describe("dayWindow", () => {
  test("runs from 04:00 to 04:00 Berlin time", () => {
    expect(dayWindow("2026-10-30")).toMatchObject({ start: "2026-10-30T04:00:00+01:00", end: "2026-10-31T04:00:00+01:00" });
    expect(dayWindow("2026-07-01")).toMatchObject({ start: "2026-07-01T04:00:00+02:00", end: "2026-07-02T04:00:00+02:00" });
  });

  test("lasts 25 hours when the clocks go back and 23 when they go forward", () => {
    expect(dayWindow("2026-10-24")).toMatchObject({ start: "2026-10-24T04:00:00+02:00", end: "2026-10-25T04:00:00+01:00" });
    expect(hours(dayWindow("2026-10-24"))).toBe(25);
    expect(hours(dayWindow("2026-03-28"))).toBe(23);
    expect(hours(dayWindow("2026-10-26"))).toBe(24);
  });

  test("rejects dates that don't exist", () => {
    expect(() => dayWindow("2026-02-30")).toThrow();
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2028-02-29")).toBe(true);
  });
});

test("journalDayAt keeps the hours before 04:00 on the previous day", () => {
  expect(journalDayAt(Date.parse("2026-10-31T03:59:00+01:00"))).toBe("2026-10-30");
  expect(journalDayAt(Date.parse("2026-10-31T04:00:00+01:00"))).toBe("2026-10-31");
  expect(journalDayAt(Date.parse("2026-01-01T01:00:00+01:00"))).toBe("2025-12-31");
});

test("formats instants in Berlin time", () => {
  expect(toBerlinIso(Date.parse("2026-10-30T03:00:00Z"))).toBe("2026-10-30T04:00:00+01:00");
  expect(toBerlinClock(Date.parse("2026-06-01T07:05:00Z"))).toBe("09:05");
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
});
