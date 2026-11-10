import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollected } from "./day-report.ts";
import { sources, summary, WINDOW } from "./testing/fixtures.ts";

const directory = mkdtempSync(join(tmpdir(), "wrap-cli-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const collectedFile = join(directory, "collected.json");
const collected = buildCollected(WINDOW, sources);
writeFileSync(collectedFile, JSON.stringify(collected));

const PART = { title: "Quiet", lines: ["Reviews.", "Tests."] };
const TEXT = JSON.stringify({ summary: "A calm day.", parts: [PART, PART] });

const run = async (args: string[], stdin = "") => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "wrap.ts"), ...args], { stdin: new Blob([stdin]), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
};

test("render prints the stdin for postlude agent-area put", async () => {
  const result = await run(["render", collectedFile, "--model", "claude-opus-5-5"], `${TEXT}\n`);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout);
  expect(payload.dayMetrics).toEqual(collected.dayMetrics);
  expect(payload.metricsVersion).toBe(7);
  expect(payload.reportModel).toBe("Claude Opus 5.5");
  expect(payload.reportHtml).toContain('<p class="summary">A calm day.</p>');
});

test("render passes on no window title and no list of windows", async () => {
  const result = await run(["render", collectedFile, "--model", "claude-opus-5-5"], TEXT);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout);
  // The collected file holds some titles in its parts, so the test would notice if render passed them on.
  expect(JSON.stringify(collected.reportInputs.parts)).toContain("Garden plan - Writer");
  const keys = (value: unknown): string[] =>
    typeof value === "object" && value !== null ? Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)]) : [];
  expect(keys(payload)).not.toContain("windows");
  // Every made-up title and app id in the fixture; T3 Code's own and the redacted ones also appear in the report's own words.
  const made = summary.windows
    .flatMap((window) => [window.app, window.title])
    .filter((text) => text !== null && !/^(T3 Code|t3code|com\.t3tools|<redacted>)/.test(text));
  expect(made).toContain("Garden plan - Writer");
  for (const text of new Set(made)) expect(result.stdout).not.toContain(text);
  for (const text of new Set(made)) expect(payload.reportHtml).not.toContain(text);
});

test("render refuses a summary with digits and a part count that doesn't match the day's", async () => {
  const digits = await run(["render", collectedFile, "--model", "claude-opus-5-5"], JSON.stringify({ summary: "Wrote 3 tests.", parts: [PART, PART] }));
  expect(digits.exitCode).toBe(1);
  expect(JSON.parse(digits.stderr.split("\n")[0] ?? "").error).toMatch(/digits/);
  const count = await run(["render", collectedFile, "--model", "claude-opus-5-5"], JSON.stringify({ summary: "A calm day.", parts: [PART] }));
  expect(count.exitCode).toBe(1);
  expect(JSON.parse(count.stderr.split("\n")[0] ?? "").error).toMatch(/one entry per entry of reportInputs\.parts/);
});

test("render refuses a collected file of another metrics version", async () => {
  const stale = join(directory, "stale.json");
  writeFileSync(stale, JSON.stringify({ ...collected, dayMetrics: { ...collected.dayMetrics, metricsVersion: 0 } }));
  const result = await run(["render", stale, "--model", "claude-opus-5-5"], TEXT);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Run collect again.");
});

test("prints usage for wrong arguments", async () => {
  for (const args of [[], ["render", collectedFile], ["collect", "29.10.2026"], ["t3"], ["t3", "yesterday"], ["delete"]]) {
    const result = await run(args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Usage:");
  }
});
