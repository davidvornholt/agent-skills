import { expect, test } from "bun:test";
import { parseSummary } from "./metrics.ts";
import { DAY, summary } from "./testing/fixtures.ts";
import { focusBlocks } from "./testing/focus-rule.ts";

const minutes = (ms: number): number => Math.round(ms / 60_000);

test("the test summary's focus blocks and totals follow from its timeline by the summary's rules", () => {
  const parsed = parseSummary(summary, DAY);
  const blocks = focusBlocks(parsed.timeline);
  expect(parsed.focusBlocks).toEqual(blocks.map(({ start, end, category }) => ({ start, end, category })));
  const activeMs = parsed.timeline.reduce((sum, piece) => sum + piece.end - piece.start, 0);
  const focusMs = blocks.reduce((sum, block) => sum + block.activeMs, 0);
  expect({ active: parsed.activeMinutes, focus: parsed.focusMinutes, scattered: parsed.scatteredMinutes }).toEqual({
    active: minutes(activeMs),
    focus: minutes(focusMs),
    scattered: minutes(activeMs) - minutes(focusMs),
  });
  const byCategory = (category: string | null) =>
    minutes(parsed.timeline.filter((piece) => piece.category === category).reduce((sum, piece) => sum + piece.end - piece.start, 0));
  expect(parsed.categories.map((category) => category.minutes)).toEqual(parsed.categories.map((category) => byCategory(category.id)));
  expect(summary.unattributedMinutes).toBe(byCategory(null));
  expect([parsed.firstActivityAt, parsed.lastActivityAt].map((at) => Date.parse(at ?? ""))).toEqual([
    parsed.timeline[0]?.start ?? Number.NaN,
    parsed.timeline.at(-1)?.end ?? Number.NaN,
  ]);
});
