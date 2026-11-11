import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollected } from "./day-report.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";

const directory = mkdtempSync(join(tmpdir(), "wrap-cli-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const collectedFile = join(directory, "collected.json");
const collected = buildCollected(WINDOW, sources);
writeFileSync(collectedFile, JSON.stringify(collected));

const TEXT = JSON.stringify({ summary: "A calm day.", parts: ["A quiet morning.", "A quiet afternoon."] });

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

test("render refuses a summary with digits and a paragraph count that doesn't match the parts", async () => {
  const digits = await run(["render", collectedFile, "--model", "claude-opus-5-5"], JSON.stringify({ summary: "Wrote 3 tests.", parts: ["A", "B"] }));
  expect(digits.exitCode).toBe(1);
  expect(JSON.parse(digits.stderr.split("\n")[0] ?? "").error).toMatch(/digits/);
  const count = await run(["render", collectedFile, "--model", "claude-opus-5-5"], JSON.stringify({ summary: "A calm day.", parts: ["A"] }));
  expect(count.exitCode).toBe(1);
  expect(JSON.parse(count.stderr.split("\n")[0] ?? "").error).toMatch(/one paragraph per entry of reportInputs\.parts/);
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
