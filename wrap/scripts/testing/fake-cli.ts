// Stands in for a command line tool in collect.test.ts. Each call is answered from the fixture file and logged, and a key with several answers gives the next one on each call.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Answer = { readonly stdout?: unknown; readonly stderr?: string; readonly exitCode?: number };

const [name = "", ...args] = Bun.argv.slice(2);
const state = process.env.FAKE_CLI_STATE ?? "";
const key = JSON.stringify([name, ...args]);
appendFileSync(join(state, "calls.jsonl"), `${key}\n`);

const fixtures = JSON.parse(readFileSync(process.env.FAKE_CLI_FIXTURES ?? "", "utf8")) as Record<string, Answer | Answer[]>;
const entry = fixtures[key];
if (entry === undefined) {
  process.stderr.write(`unexpected call: ${key}\n`);
  process.exit(2);
}
let answer = entry as Answer;
if (Array.isArray(entry)) {
  const counter = join(state, `${Bun.hash(key).toString(16)}.count`);
  const count = existsSync(counter) ? Number(readFileSync(counter, "utf8")) : 0;
  writeFileSync(counter, String(count + 1));
  answer = entry[Math.min(count, entry.length - 1)] as Answer;
}
if (answer.stdout !== undefined) process.stdout.write(typeof answer.stdout === "string" ? answer.stdout : JSON.stringify(answer.stdout));
if (answer.stderr !== undefined) process.stderr.write(answer.stderr);
process.exit(answer.exitCode ?? 0);
