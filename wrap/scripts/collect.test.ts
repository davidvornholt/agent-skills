import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collected } from "./day-report.ts";
import { DAY, spTasks, summary, WINDOW } from "./testing/fixtures.ts";

const COMMANDS = ["activity-digest", "sp", "gh", "pim", "ssh"];
const SECRETS = [
  "SECRET-SUBJECT",
  "secret-recipient@example.com",
  "SECRET-BODY",
  "SECRET-CALENDAR-LINE",
  "SECRET-SEARCH-ERROR",
  "SECRET-STDERR",
  "SECRET-DESCRIPTION",
];

const directory = mkdtempSync(join(tmpdir(), "wrap-collect-"));
const bin = join(directory, "bin");

const key = (...command: string[]) => JSON.stringify(command);
const sp = ["--host", "david-x1-nixos"];
const query = `is:pr is:merged author:davidvornholt merged:${WINDOW.start}..${WINDOW.end}`;
const calendarCall = key("pim", "calendar", "events", "--from", DAY, "--to", "2026-10-30", "--limit", "1000");
const sentSearch = (account: string, folder: string, limit: number) =>
  key("pim", "mail", "search", "--account", account, "--folder", folder, "--since", "2026-10-28", "--limit", String(limit));
const hit = (date: string) => ({ date, subject: "SECRET-SUBJECT", from: "me@example.com", to: ["secret-recipient@example.com"], preview: "SECRET-BODY" });
const standup = {
  account: "me@example.com",
  calendar: "Personal",
  href: "/x",
  uid: "1",
  summary: "Standup",
  start: "2026-10-29T10:00:00+01:00",
  end: "2026-10-29T11:00:00+01:00",
  allDay: false,
};
const review = { ...standup, account: "work@example.com", uid: "2", summary: "Review", start: "2026-10-29T14:00:00+01:00", end: "2026-10-29T15:30:00+01:00" };
const planning = {
  ...standup,
  href: "/planning",
  uid: "3",
  summary: "Planning",
  start: "2026-10-29T16:00:00+01:00",
  end: "2026-10-29T17:00:00+01:00",
  organizer: "boss@example.com",
  attendees: 2,
};
const moved = { ...standup, uid: "4", summary: "Moved call", start: "2026-10-29T18:00:00+01:00", end: "2026-10-29T19:00:00+01:00", status: "cancelled" };
// The work mailbox sends enough mail to fill the first page inside the day, so the search has to grow.
// pim quotes the line it can't parse, so the flaky calendar's failure holds private text.
const unparseable = { account: "flaky@example.com", errorTag: "CalendarDataError", message: "Invalid iCalendar line: DESCRIPTION:SECRET-CALENDAR-LINE" };
const busyDay = Array.from({ length: 200 }, (_, index) => hit(new Date(Date.parse("2026-10-29T20:00:00+01:00") - index * 60_000).toISOString()));

const fixtures = {
  [key("activity-digest", DAY, "--summary-json")]: { stdout: summary },
  [key("sp", "tasks", "list", "--include-done", "--source", "all")]: { stderr: "TokenUnavailable", exitCode: 1 },
  [key("sp", "tasks", "list", ...sp, "--include-done", "--source", "all")]: { stdout: spTasks.map((task) => ({ ...task, notes: "SECRET-BODY", created: 0 })) },
  [key("sp", "tags", "list", ...sp)]: { stdout: [{ id: "t-off", title: "off-computer", color: "#fff" }] },
  [key("sp", "projects", "list", ...sp)]: {
    stdout: [
      { id: "p-home", title: "Home" },
      { id: "p-work", title: "Work" },
    ],
  },
  [key("gh", "api", "--method", "GET", "search/issues", "-f", `q=${query}`, "-f", "per_page=100", "-f", "page=1")]: {
    stdout: {
      total_count: 1,
      incomplete_results: false,
      items: [
        {
          number: 42,
          title: "Add the day report",
          repository_url: "https://api.github.com/repos/davidvornholt/agent-skills",
          pull_request: { merged_at: "2026-10-29T15:00:00Z" },
        },
      ],
    },
  },
  [key("pim", "accounts")]: {
    stdout: [
      { email: "me@example.com", name: "Me", mail: {}, dav: {} },
      { email: "work@example.com", name: "Work", mail: {}, graph: {} },
      { email: "broken@example.com", name: "Broken", mail: {} },
      { email: "flaky@example.com", name: "Flaky", mail: {}, dav: {} },
      { email: "tester.test.legal@gmail.com", name: "Test", mail: {} },
    ],
  },
  // The work calendar fails on the first call and answers on the retry, and the flaky calendar fails both times.
  [calendarCall]: [
    {
      stdout: {
        from: DAY,
        to: "2026-10-30",
        events: [standup, planning, moved],
        failures: [{ account: "work@example.com", errorTag: "Timeout", message: "timed out" }, unparseable],
      },
    },
    { stdout: { from: DAY, to: "2026-10-30", events: [standup, planning, moved, review], failures: [unparseable] } },
  ],
  [key("pim", "calendar", "get", "--account", "me@example.com", "--href", "/planning")]: {
    stdout: {
      ...planning,
      description: "SECRET-DESCRIPTION",
      attendees: [
        { email: "boss@example.com", partstat: "accepted" },
        { email: "Me@Example.com", name: "Me", partstat: "declined" },
      ],
    },
  },
  [key("pim", "mail", "folders", "--account", "me@example.com")]: {
    stdout: [
      { path: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
      { path: "Sent", name: "Sent", specialUse: "\\Sent" },
    ],
  },
  [key("pim", "mail", "folders", "--account", "work@example.com")]: { stdout: [{ path: "Sent Items", name: "Sent Items", specialUse: "\\Sent" }] },
  [key("pim", "mail", "folders", "--account", "broken@example.com")]: { stderr: "Could not read the message SECRET-STDERR\nstack trace", exitCode: 1 },
  [key("pim", "mail", "folders", "--account", "flaky@example.com")]: { stdout: [{ path: "Sent", name: "Sent", specialUse: "\\Sent" }] },
  [sentSearch("me@example.com", "Sent", 200)]: { stdout: { hits: [hit("2026-10-29T09:00:00+01:00"), hit("2026-10-28T09:00:00+01:00")], failures: [] } },
  [sentSearch("flaky@example.com", "Sent", 200)]: {
    stdout: { hits: [], failures: [{ account: "flaky@example.com", errorTag: "MailDataError", message: "Unparseable message SECRET-SEARCH-ERROR" }] },
  },
  [sentSearch("work@example.com", "Sent Items", 200)]: { stdout: { hits: busyDay, failures: [] } },
  [sentSearch("work@example.com", "Sent Items", 800)]: { stdout: { hits: [...busyDay, hit("2026-10-28T22:00:00+01:00")], failures: [] } },
  [key("ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "david@david-z890-nixos", "bun ~/.claude/skills/wrap/scripts/wrap.ts t3-threads")]: {
    stdout: [{ title: "Settled today", project: "postlude", settledAt: "2026-10-29T16:00:00.000Z", snoozedUntil: null, createdAt: "2026-10-28T10:00:00.000Z" }],
  },
};

let collected: Collected;
let calls: string[][];

beforeAll(async () => {
  mkdirSync(bin);
  for (const command of COMMANDS) {
    const shim = join(bin, command);
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "testing/fake-cli.ts")}" ${command} "$@"\n`);
    chmodSync(shim, 0o755);
  }
  writeFileSync(join(directory, "fixtures.json"), JSON.stringify(fixtures));
  // Only the fakes are on PATH, so kontor is a command that doesn't exist, and SP_HOST is unset.
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "testing/collect-day.ts"), DAY, "test-host"], {
    env: { PATH: bin, HOME: directory, FAKE_CLI_FIXTURES: join(directory, "fixtures.json"), FAKE_CLI_STATE: directory },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`collect-day failed: ${stderr}`);
  collected = JSON.parse(stdout) as Collected;
  calls = readFileSync(join(directory, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
}, 60_000);

afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("reads every source into the metrics", () => {
  expect(collected.dayMetrics).toMatchObject({
    activeMinutes: 330,
    offComputerMinutes: 70,
    appointmentMinutes: 150,
    appointmentOffScreenMinutes: null,
    landedPrs: 1,
    sentMails: [
      { mailbox: "broken@example.com", count: null },
      { mailbox: "flaky@example.com", count: null },
      { mailbox: "me@example.com", count: 1 },
      { mailbox: "work@example.com", count: 200 },
    ],
  });
  expect(collected.dayMetrics.coverage.filter((entry) => !entry.source.startsWith("activity"))).toEqual([
    { source: "sp", status: "complete" },
    { source: "github", status: "complete" },
    { source: "mail:broken@example.com", status: "missing" },
    { source: "mail:flaky@example.com", status: "missing" },
    { source: "mail:me@example.com", status: "complete" },
    { source: "mail:work@example.com", status: "complete" },
    { source: "calendar:flaky@example.com", status: "missing" },
    { source: "calendar:me@example.com", status: "complete" },
    { source: "calendar:work@example.com", status: "complete" },
  ]);
  expect(collected.reportInputs.landedPrs.items).toEqual([{ repository: "davidvornholt/agent-skills", title: "Add the day report" }]);
  expect(collected.reportInputs.settledThreads.items).toEqual([{ title: "Settled today", project: "postlude" }]);
});

test("turns a command that doesn't exist into missing coverage", () => {
  expect(collected.reportInputs.kontor).toEqual({ status: "missing", approvalNeeded: null });
  expect(collected.problems.some((problem) => problem.startsWith("Kontor status unavailable: kontor could not run"))).toBe(true);
});

test("says where pim failed but withholds its error text", () => {
  const withheld = "its message is withheld because it can quote mail or calendar text";
  expect(collected.problems).toEqual(
    expect.arrayContaining([
      `Sent mail of broken@example.com unavailable: pim exited with 1; ${withheld}`,
      `Sent mail of flaky@example.com unavailable: pim reported an error; ${withheld}`,
      `Calendar of flaky@example.com unavailable: pim reported an error; ${withheld}`,
    ]),
  );
});

test("never passes on mail subjects, recipients, notes, or pim's error text", () => {
  const output = JSON.stringify(collected);
  for (const secret of SECRETS) expect(output).not.toContain(secret);
});

test("only reads", () => {
  const readOnly = (call: string[]): boolean => {
    const [command, ...args] = call;
    const words = args.join(" ");
    if (command === "gh") return args[0] === "api" && args[1] === "--method" && args[2] === "GET" && args[3] === "search/issues";
    if (command === "sp") return /^(tasks|tags|projects) list\b/.test(words);
    if (command === "pim") return /^(accounts|calendar (events|get)|mail folders|mail search)\b/.test(words);
    if (command === "ssh") return args.at(-1) === "bun ~/.claude/skills/wrap/scripts/wrap.ts t3-threads";
    return command === "activity-digest" && args.includes("--summary-json");
  };
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((call) => !readOnly(call))).toEqual([]);
});

test("leaves out cancelled and declined meetings, asking once for the answer to a meeting someone else organizes", () => {
  expect(collected.reportInputs.appointments.items.map((item) => item.title)).toEqual(["Standup", "Review"]);
  expect(calls.filter((call) => call[1] === "calendar" && call[2] === "get")).toHaveLength(1);
});

test("skips the test mailboxes", () => {
  expect(calls.some((call) => call.includes("tester.test.legal@gmail.com"))).toBe(false);
});

test("reads the other host's Super Productivity copy when the local one fails", () => {
  expect(calls.filter((call) => call[0] === "sp").map((call) => call.slice(1, 3).concat(call.includes("--host") ? ["remote"] : []))).toEqual([
    ["tasks", "list"],
    ["tasks", "list", "remote"],
    ["tags", "list", "remote"],
    ["projects", "list", "remote"],
  ]);
});

test("retries the calendar once and grows the mail search until it reaches before the day", () => {
  expect(calls.filter((call) => call[1] === "calendar" && call[2] === "events")).toHaveLength(2);
  expect(calls.filter((call) => call[2] === "search" && call[4] === "work@example.com").map((call) => call.at(-1))).toEqual(["200", "800"]);
});
