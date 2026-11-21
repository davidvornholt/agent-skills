import { expect, test } from "bun:test";
import { buildCollected } from "./day-report.ts";
import { sources, summary, WINDOW } from "./testing/fixtures.ts";

const pausedAt = (...pausedIntervals: { readonly start: string; readonly end: string }[]) =>
  buildCollected(WINDOW, { ...sources, summary: { ok: true, value: { ...summary, pausedIntervals } } });

const full = buildCollected(WINDOW, sources);
const threadIds = (collected: typeof full) => collected.timeline.threads.items.map((thread) => thread.id);
const tidyMessages = (collected: typeof full) => collected.conversations.items.find((conversation) => conversation.id === "t-tidy")?.messages ?? [];

test("leaves out the T3 Code messages in a pause, whoever wrote them, and the threads settled in one", () => {
  // Over the docs thread's only run and a report in the tidy thread, and over a thread being settled.
  const paused = pausedAt(
    { start: "2026-10-29T15:15:00.000+01:00", end: "2026-10-29T15:35:00.000+01:00" },
    { start: "2026-10-29T16:55:00.000+01:00", end: "2026-10-29T17:05:00.000+01:00" },
  );

  expect(threadIds(full)).toEqual(["t-night", "t-parser", "t-tidy", "t-docs", "t-deploy"]);
  expect(threadIds(paused)).toEqual(["t-night", "t-parser", "t-tidy", "t-deploy"]);
  expect(tidyMessages(full).map((message) => message.slice(0, 6))).toEqual(["14:50 ", "15:30 ", "15:40 "]);
  expect(tidyMessages(paused).map((message) => message.slice(0, 6))).toEqual(["14:50 ", "15:40 "]);
  expect(full.reportInputs.settledThreads.items.map((thread) => thread.title)).toEqual(["Settled today"]);
  expect(paused.reportInputs.settledThreads.items).toEqual([]);
});

test("leaves out the prompts in a pause, and a thread with no prompt or run outside one", () => {
  // Over the prompts and runs of the tidy and docs threads.
  const paused = pausedAt({ start: "2026-10-29T14:45:00.000+01:00", end: "2026-10-29T16:05:00.000+01:00" });

  expect(threadIds(paused)).toEqual(["t-night", "t-parser", "t-deploy"]);
  expect(paused.conversations.items.map((conversation) => conversation.id)).toEqual(["t-parser", "t-deploy"]);
  expect(full.reportInputs.facts.prompts).toEqual({ count: 4, fromPhone: 1, threads: 2 });
  expect(paused.reportInputs.facts.prompts).toEqual({ count: 2, fromPhone: 1, threads: 1 });
});
