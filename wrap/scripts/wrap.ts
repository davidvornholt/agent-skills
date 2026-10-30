#!/usr/bin/env bun
// The /wrap command line. Run with no arguments for usage.

import { hostname } from "node:os";
import { readLocalT3, readSources } from "./collect.ts";
import { dayWindow, isDay, journalDayAt } from "./day.ts";
import { buildCollected, type Collected } from "./day-report.ts";
import { METRICS_VERSION } from "./metrics.ts";
import { agentAreaPayload, loadTemplate, renderReport } from "./render.ts";

const USAGE = `Usage:
  wrap.ts collect [YYYY-MM-DD]                    Read every source for the journal day (default: the current one) and print the metrics and report lists as JSON.
  wrap.ts render <collected.json> --model <id>    Read the summary on stdin and print the stdin for \`postlude agent-area put <day>\`.
  wrap.ts t3-threads                              Print this machine's T3 Code threads as JSON (collect runs it on the z890 over SSH).`;

class UsageError extends Error {}

const parseCollected = (raw: unknown): Collected => {
  const collected = raw as Partial<Collected> | null;
  if (typeof collected !== "object" || collected === null || typeof collected.dayMetrics !== "object" || typeof collected.reportInputs !== "object") {
    throw new Error("The collected file is not the output of `wrap.ts collect`.");
  }
  if (collected.dayMetrics?.metricsVersion !== METRICS_VERSION) {
    throw new Error(
      `The collected file has metrics version ${String(collected.dayMetrics?.metricsVersion)}, but this script writes version ${METRICS_VERSION}. Run collect again.`,
    );
  }
  return collected as Collected;
};

const main = async (args: readonly string[]): Promise<string> => {
  const [command, ...rest] = args;
  if (command === "collect") {
    const day = rest[0] ?? journalDayAt(Date.now());
    if (rest.length > 1 || !isDay(day)) throw new UsageError(`collect takes one optional date as YYYY-MM-DD, not: ${rest.join(" ")}`);
    const window = dayWindow(day);
    return JSON.stringify(buildCollected(window, await readSources(window, hostname())), null, 2);
  }
  if (command === "render") {
    const file = rest[0];
    const modelIndex = rest.indexOf("--model");
    const model = modelIndex === -1 ? undefined : rest[modelIndex + 1];
    if (file === undefined || file.startsWith("--") || model === undefined || model.trim() === "" || rest.length !== 3) {
      throw new UsageError("render takes the collected file and --model <id>.");
    }
    const collected = parseCollected(JSON.parse(await Bun.file(file).text()));
    const reportHtml = renderReport(await loadTemplate(), collected, await Bun.stdin.text());
    return JSON.stringify(agentAreaPayload(collected, reportHtml, model.trim()));
  }
  if (command === "t3-threads" && rest.length === 0) {
    const reading = await readLocalT3();
    if (!reading.ok) throw new Error(reading.error);
    return JSON.stringify(reading.value);
  }
  throw new UsageError(command === undefined ? "No command given." : `Unknown command: ${args.join(" ")}`);
};

if (import.meta.main) {
  try {
    console.log(await main(Bun.argv.slice(2)));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ error: message }));
    if (error instanceof UsageError) console.error(USAGE);
    process.exit(1);
  }
}
