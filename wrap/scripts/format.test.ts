import { expect, test } from "bun:test";
import { durationText, minutesText } from "./format.ts";

test("durationText writes seconds under a minute, and days and hours over a day", () => {
  expect(durationText(45)).toBe("45 s");
  expect(durationText(450)).toBe("8 min");
  expect(durationText(5 * 3600)).toBe("5 h");
  expect(durationText(25 * 3600 + 20 * 60)).toBe("1 d 1 h");
  expect(durationText(2 * 86_400)).toBe("2 d");
});

test("minutesText writes hours and minutes", () => {
  expect(minutesText(235)).toBe("3 h 55 min");
  expect(minutesText(45)).toBe("45 min");
  expect(minutesText(120)).toBe("2 h");
});
