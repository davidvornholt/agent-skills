import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollected } from "./day-report.ts";
import { COMPOSITION, PARTS } from "./testing/composition.ts";
import { sources, summary, WINDOW } from "./testing/fixtures.ts";

const directory = mkdtempSync(join(tmpdir(), "wrap-cli-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const collectedFile = join(directory, "collected.json");
const collected = buildCollected(WINDOW, sources);
writeFileSync(collectedFile, JSON.stringify(collected));

const TEXT = JSON.stringify(COMPOSITION);

const run = async (args: string[], stdin = "") => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "wrap.ts"), ...args], { stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
};

test("compose prints the stdin for postlude agent-area check and put", async () => {
  const result = await run(["compose", collectedFile, "--model", "claude-opus-5-5"], `${TEXT}\n`);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.dayMetrics).toEqual(collected.dayMetrics);
  expect(payload.metricsVersion).toBe(7);
  expect(payload.reportModel).toBe("Claude Opus 5.5");
  expect(payload.reportDocument.version).toBe(1);
  expect(payload.reportDocument.blocks[0]).toEqual({ kind: "paragraph", text: ["A calm day."] });
});

/** The JSON of the timeline blocks in a payload, and of everything else. */
const splitTimeline = (payload: unknown) => {
  const timelines: unknown[] = [];
  const rest = JSON.stringify(payload, (_, value) => {
    if (typeof value === "object" && value !== null && "kind" in value && value.kind === "timeline") {
      timelines.push(value);
      return undefined;
    }
    return value;
  });
  return { timeline: JSON.stringify(timelines), rest };
};

test("compose names the user's own window titles only on the timeline's cards, and never an app id, T3 Code's own title or a redacted one", async () => {
  const result = await run(["compose", collectedFile, "--model", "claude-opus-5-5"], TEXT);
  expect(result.exitCode).toBe(0);
  const { timeline, rest } = splitTimeline(JSON.parse(result.stdout));
  // The collected file holds titles in its parts too, so the test would notice if compose passed them on outside the timeline.
  expect(JSON.stringify(collected.reportInputs.parts)).toContain("Garden plan - Writer");
  for (const title of ["Garden plan - Writer", "Inbox - Mail"]) {
    expect(timeline).toContain(title);
    expect(rest).not.toContain(title);
  }
  expect(rest).not.toContain('"windows"');
  const ids = summary.windows.flatMap((window) => (window.app === null || window.app === "<redacted>" ? [] : [`"${window.app}"`]));
  expect(ids).toContain('"org.example.Writer"');
  for (const text of [...new Set(ids), "T3 Code (Beta)", "<redacted>"]) expect(result.stdout).not.toContain(text);
});

test("compose names mail subjects only on the timeline's cards, and never a message of a thread", async () => {
  const result = await run(["compose", collectedFile, "--model", "claude-opus-5-5"], TEXT);
  expect(result.exitCode).toBe(0);
  const { timeline, rest } = splitTimeline(JSON.parse(result.stdout));
  const subjects = collected.reportInputs.sentMail.items.map((mail) => mail.subject);
  const messages = sources.t3.ok ? sources.t3.value.messages.map((message) => message.text.split("\n")[0] ?? "") : [];
  expect(subjects).toContain("Garden plan for Saturday");
  expect(messages).toContain("Merge it once the checks pass.");
  expect(JSON.stringify(collected.conversations)).toContain("Merge it once the checks pass.");
  for (const subject of subjects) {
    expect(timeline).toContain(subject);
    expect(rest).not.toContain(subject);
  }
  for (const message of messages) expect(result.stdout).not.toContain(message);
});

test("compose refuses a report whose part count doesn't match the day's", async () => {
  const blocks = COMPOSITION.blocks.map((block) =>
    "kind" in block && block.kind === "section" && block.heading === "The day in parts"
      ? { ...block, blocks: [{ kind: "parts", parts: PARTS.slice(1) }] }
      : block,
  );
  const count = await run(["compose", collectedFile, "--model", "claude-opus-5-5"], JSON.stringify({ ...COMPOSITION, blocks }));
  expect(count.exitCode).toBe(1);
  expect(JSON.parse(count.stderr.split("\n")[0] ?? "").error).toMatch(/one entry per entry of reportInputs\.parts/);
});

test("compose refuses a collected file of another metrics version", async () => {
  const stale = join(directory, "stale.json");
  writeFileSync(stale, JSON.stringify({ ...collected, dayMetrics: { ...collected.dayMetrics, metricsVersion: 0 } }));
  const result = await run(["compose", stale, "--model", "claude-opus-5-5"], TEXT);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Run collect again.");
});

test("prints usage for wrong arguments", async () => {
  for (const args of [[], ["compose", collectedFile], ["collect", "29.10.2026"], ["t3"], ["t3", "yesterday"], ["delete"]]) {
    const result = await run(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
  }
});
