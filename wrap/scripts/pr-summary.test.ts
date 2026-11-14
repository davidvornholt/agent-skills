import { expect, test } from "bun:test";
import { CARD_SUMMARY_MAX_LENGTH, cardSummary, PR_SUMMARY_MAX_LENGTH, prSummary } from "./pr-summary.ts";

test("takes the Now paragraph, without its label and markdown", () => {
  const body = [
    "**Before.** The garden page had no map.",
    "**Now.** The garden page shows a **map** of the beds, with `links` to [each bed](https://example.com/beds).",
    "## Implementation",
    "- Draws the map.",
  ].join("\n\n");
  expect(prSummary(body)).toBe("The garden page shows a map of the beds, with links to each bed.");
});

test("takes the first paragraph of prose when there is no Now paragraph", () => {
  const body = [
    "Stacked on #3.",
    "## What it fixes",
    "Short.",
    "The watering reminder fired twice on Sundays. It now fires once.\n- First item of a list that follows without a blank line",
    "Another paragraph that comes later and is long enough to be chosen.",
  ].join("\n\n");
  expect(prSummary(body)).toBe("The watering reminder fired twice on Sundays. It now fires once.");
});

test("drops a bold label that opens the paragraph", () => {
  expect(prSummary("**Cause.** The reminder read the wrong time zone on the last day of the month.")).toBe(
    "The reminder read the wrong time zone on the last day of the month.",
  );
});

test("cuts a long summary at a sentence end, or else at a word with an ellipsis", () => {
  const sentence = "The garden page now lists every bed with its plants and when each was last watered. ";
  const summary = prSummary(`**Now.** ${sentence.repeat(6)}`);
  expect(summary).toBe(sentence.repeat(3).trim());
  const words = prSummary(`**Now.** ${"seedling ".repeat(60)}`) ?? "";
  expect(words.length).toBeLessThanOrEqual(PR_SUMMARY_MAX_LENGTH);
  expect(words).toEndWith("seedling…");
});

test("gives null for a body without prose", () => {
  expect(prSummary(null)).toBeNull();
  expect(prSummary("")).toBeNull();
  expect(prSummary("## Changes\n\n- One\n- Two\n\nOpened by an agent in a tool that writes this line.")).toBeNull();
});

test("a card shows the first two sentences where they fit, or else the first, cut at a word", () => {
  expect(cardSummary("The garden page shows a map. Each bed links to its plants. The map prints too.")).toBe(
    "The garden page shows a map. Each bed links to its plants.",
  );
  const long = `The garden page shows ${"a very long ".repeat(25)}map.`;
  expect(cardSummary(`Short first. ${long}`)).toBe("Short first.");
  const cut = cardSummary(long);
  expect(cut.length).toBeLessThanOrEqual(CARD_SUMMARY_MAX_LENGTH);
  // Cut before a space, so no word is cut in half.
  expect(`${long.slice(0, cut.length - 1)}…`).toBe(cut);
  expect(long.charAt(cut.length - 1)).toBe(" ");
  expect(cardSummary("One sentence without an end")).toBe("One sentence without an end");
});
