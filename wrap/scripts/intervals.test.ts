import { expect, test } from "bun:test";
import { clip, subtract, totalMinutes, union } from "./intervals.ts";

const m = (minutes: number): number => minutes * 60_000;
const span = (start: number, end: number) => ({ start: m(start), end: m(end) });

test("union merges overlapping and touching intervals and drops empty ones", () => {
  expect(union([span(30, 40), span(0, 10), span(5, 20), span(20, 25), span(50, 50)])).toEqual([span(0, 25), span(30, 40)]);
});

test("clip keeps only the part inside the window", () => {
  expect(clip([span(-10, 10), span(20, 30), span(90, 120)], span(0, 100))).toEqual([span(0, 10), span(20, 30), span(90, 100)]);
});

test("subtract removes covered parts", () => {
  expect(subtract([span(0, 60)], [span(10, 20), span(15, 30), span(50, 70)])).toEqual([span(0, 10), span(30, 50)]);
  expect(subtract([span(0, 10), span(20, 30)], [])).toEqual([span(0, 10), span(20, 30)]);
  expect(subtract([span(0, 10)], [span(0, 10)])).toEqual([]);
});

test("totalMinutes counts overlap once and rounds at the end", () => {
  expect(totalMinutes([span(0, 60), span(30, 90)])).toBe(90);
  expect(
    totalMinutes([
      { start: 0, end: 20_000 },
      { start: 40_000, end: 60_000 },
    ]),
  ).toBe(1);
});
