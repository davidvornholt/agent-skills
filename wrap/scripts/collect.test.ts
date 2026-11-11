import { Database } from "bun:sqlite";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Collected } from "./day-report.ts";
import { DAY, spTasks, summary, WINDOW } from "./testing/fixtures.ts";

const COMMANDS = ["activity-digest", "sp", "gh", "pim", "ssh", "t3"];
const SUBJECT = "Garden plan for Saturday";
const SECRETS = [
  "secret-recipient@example.com",
  "SECRET-BODY",
  "SECRET-CALENDAR-LINE",
  "SECRET-SEARCH-ERROR",
  "SECRET-STDERR",
  "SECRET-DESCRIPTION",
  "SECRET-SP-DETAIL",
];

const directory = mkdtempSync(join(tmpdir(), "wrap-collect-"));
const bin = join(directory, "bin");

const key = (...command: string[]) => JSON.stringify(command);
const sp = ["--host", "david-x1-nixos"];
const search = (query: string) => key("gh", "api", "--method", "GET", "search/issues", "-f", `q=${query}`, "-f", "per_page=100", "-f", "page=1");
const calendarCall = key("pim", "calendar", "events", "--from", DAY, "--to", "2026-10-30", "--limit", "1000");
const sentSearch = (account: string, folder: string, limit: number) =>
  key("pim", "mail", "search", "--account", account, "--folder", folder, "--since", "2026-10-28", "--limit", String(limit));
const hit = (date: string) => ({ date, subject: SUBJECT, from: "me@example.com", to: ["secret-recipient@example.com"], preview: "SECRET-BODY" });
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
// An occurrence of a weekly series the user accepted, declined on its own.
const weekly = {
  ...planning,
  href: "/weekly",
  uid: "5",
  summary: "Weekly sync",
  start: "2026-10-29T12:00:00+01:00",
  end: "2026-10-29T13:00:00+01:00",
  recurrenceId: "2026-10-29T12:00:00+01:00",
};
// The invitation went to an alias, so the work calendar never holds the user's own answer.
const aliased = {
  ...planning,
  account: "work@example.com",
  href: "/aliased",
  uid: "6",
  summary: "All hands",
  start: "2026-10-29T20:00:00+01:00",
  end: "2026-10-29T21:00:00+01:00",
};
// The work mailbox sends enough mail to fill the first page inside the day, so the search has to grow.
// pim quotes the line it can't parse, so the flaky calendar's failure holds private text.
const unparseable = { account: "flaky@example.com", errorTag: "CalendarDataError", message: "Invalid iCalendar line: DESCRIPTION:SECRET-CALENDAR-LINE" };
const busyDay = Array.from({ length: 200 }, (_, index) => hit(new Date(Date.parse("2026-10-29T20:00:00+01:00") - index * 60_000).toISOString()));

const fixtures = {
  [key("activity-digest", DAY, "--summary-json")]: { stdout: summary },
  [key("sp", "tasks", "list", "--include-done", "--source", "all")]: { stderr: "TokenUnavailable", exitCode: 1 },
  [key("sp", "tasks", "list", ...sp, "--include-done", "--source", "all")]: { stdout: spTasks.map((task) => ({ ...task, notes: "SECRET-BODY", created: 0 })) },
  [key("sp", "projects", "list", ...sp)]: {
    stdout: [
      { id: "p-home", title: "Home" },
      { id: "p-work", title: "Work" },
    ],
  },
  [search(`is:pr author:davidvornholt is:merged merged:${WINDOW.start}..${WINDOW.end}`)]: {
    stdout: {
      total_count: 1,
      incomplete_results: false,
      items: [
        {
          number: 42,
          title: "Add the day report",
          body: "**Before.** The day had no report.\n\n**Now.** The day gets a **report** in `Postlude`.\n\n## Verification\n\n- Tests pass.",
          repository_url: "https://api.github.com/repos/davidvornholt/agent-skills",
          pull_request: { merged_at: "2026-10-29T15:00:00Z" },
        },
      ],
    },
  },
  [search(`is:pr author:davidvornholt is:closed is:unmerged closed:${WINDOW.start}..${WINDOW.end}`)]: {
    stdout: {
      total_count: 1,
      incomplete_results: false,
      items: [
        {
          number: 43,
          title: "Try a second parser",
          body: "Stacked on #42.\n\nThis tries a second parser for the task list, to compare the two.",
          repository_url: "https://api.github.com/repos/davidvornholt/sp-cli",
          closed_at: "2026-10-29T10:45:00Z",
          pull_request: { merged_at: null },
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
        events: [standup, planning, moved, weekly],
        failures: [{ account: "work@example.com", errorTag: "Timeout", message: "timed out" }, unparseable],
      },
    },
    { stdout: { from: DAY, to: "2026-10-30", events: [standup, planning, moved, weekly, review, aliased], failures: [unparseable] } },
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
  [key("pim", "calendar", "get", "--account", "me@example.com", "--href", "/weekly")]: {
    stdout: {
      ...planning,
      href: "/weekly",
      summary: "Weekly sync",
      start: "2026-10-01T12:00:00+02:00",
      end: "2026-10-01T13:00:00+02:00",
      description: "SECRET-DESCRIPTION",
      attendees: [
        { email: "boss@example.com", partstat: "accepted" },
        { email: "me@example.com", partstat: "accepted" },
      ],
      recurrence: {
        rule: "FREQ=WEEKLY",
        excluded: [],
        changed: [
          {
            recurrenceId: "2026-10-22T12:00:00+02:00",
            start: "2026-10-22T12:00:00+02:00",
            end: "2026-10-22T13:00:00+02:00",
            attendees: [
              { email: "boss@example.com", partstat: "accepted" },
              { email: "me@example.com", partstat: "accepted" },
              { email: "guest@example.com", partstat: "accepted" },
            ],
          },
          {
            recurrenceId: weekly.recurrenceId,
            start: weekly.start,
            end: weekly.end,
            attendees: [
              { email: "boss@example.com", partstat: "accepted" },
              { email: "me@example.com", partstat: "declined" },
            ],
          },
        ],
      },
    },
  },
  [key("pim", "calendar", "get", "--account", "work@example.com", "--href", "/aliased")]: {
    stdout: {
      ...aliased,
      description: "SECRET-DESCRIPTION",
      attendees: [
        { email: "boss@example.com", partstat: "accepted" },
        { email: "alias@example.com", partstat: "accepted" },
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
  [key("ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "david@david-z890-nixos", "bun ~/.claude/skills/wrap/scripts/wrap.ts t3 2026-10-29")]: {
    stdout: {
      threads: [
        { title: "Settled today", project: "postlude", settledAt: "2026-10-29T16:00:00.000Z", snoozedUntil: null, createdAt: "2026-10-28T10:00:00.000Z" },
      ],
      dayThreads: [
        {
          id: "t-parser",
          title: "Fix the parser",
          project: "~/dev/postlude",
          firstPromptAt: "2026-10-29T08:20:00.000Z",
          pullRequests: [
            {
              repository: "davidvornholt/postlude",
              number: 14,
              title: "Parse dates",
              linkedAt: "2026-10-29T09:00:00.000Z",
              state: "open",
              isDraft: false,
              mergedAt: null,
              closedAt: null,
            },
          ],
        },
      ],
      runs: [{ threadId: "t-parser", start: "2026-10-29T08:30:00.000Z", end: "2026-10-29T09:15:00.000Z", running: false }],
      prompts: [{ threadId: "t-parser", at: "2026-10-29T08:20:00.000Z", fromPhone: true }],
      messages: [
        { threadId: "t-parser", at: "2026-10-29T08:20:00.000Z", author: "phone", text: "The parser drops dates without a year." },
        { threadId: "t-parser", at: "2026-10-29T09:15:00.000Z", author: "agent", text: "They parse now, and postlude#14 tests them." },
      ],
    },
  },
  [key("t3", "thread", "list", "--project", "p-garden", "--json")]: {
    stdout: [{ title: "Plan the garden", settledAt: null, snoozedUntil: null, createdAt: "2026-10-28T10:00:00.000Z" }],
  },
  // A Kontor that has never attempted a sync.
  [key("ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "david@david-z890-nixos", "kontor status --json")]: {
    stdout: { lastSyncAt: null, approvalExpiresAt: null, daysLeft: 0, approvalNeeded: true, reason: "never-approved", lastSyncOutcome: null },
  },
};

// sp passes Super Productivity's error message and details on as they are.
const spError = (tag: string) => ({
  stderr: `${JSON.stringify({ error: { tag, message: "Task SECRET-SP-DETAIL failed", status: 500, details: { title: "SECRET-SP-DETAIL" } } })}\n`,
  exitCode: 1,
});
const spDownFixtures = {
  ...fixtures,
  [key("sp", "tasks", "list", "--include-done", "--source", "all")]: spError("AppUnreachable"),
  [key("sp", "tasks", "list", ...sp, "--include-done", "--source", "all")]: spError("Ssh"),
  // The z890 still runs a copy of the skill without the t3 command.
  [key("ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "david@david-z890-nixos", "bun ~/.claude/skills/wrap/scripts/wrap.ts t3 2026-10-29")]: {
    stderr: `${JSON.stringify({ error: "Unknown command: t3 2026-10-29" })}\nUsage:\n`,
    exitCode: 1,
  },
};

/** T3 Code's state database on the z890, with a day thread, its subagent, and every kind of message T3 stores. */
const writeT3State = () => {
  mkdirSync(join(directory, ".t3/userdata"), { recursive: true });
  const database = new Database(join(directory, ".t3/userdata/statev2.sqlite"));
  database.run("create table projection_projects (project_id text, title text, workspace_root text, deleted_at text)");
  database.run("create table orchestration_v2_projection_threads (thread_id text, title text, project_id text, payload_json text)");
  database.run("create table orchestration_v2_projection_runs (thread_id text, status text, payload_json text)");
  database.run("create table orchestration_v2_projection_messages (message_id text, thread_id text, role text, created_at text, payload_json text)");
  database.run("insert into projection_projects values ('p-garden', 'Garden', ?1, null)", [join(directory, "dev/garden")]);
  const thread = database.prepare("insert into orchestration_v2_projection_threads values (?1, ?2, 'p-garden', ?3)");
  thread.run("t-garden", "Plan the garden", JSON.stringify({ lineage: { parentThreadId: null, relationshipToParent: null } }));
  thread.run("t-helper", "Measure the beds", JSON.stringify({ lineage: { parentThreadId: "t-garden", relationshipToParent: "subagent" } }));
  const run = database.prepare("insert into orchestration_v2_projection_runs values (?1, 'completed', ?2)");
  run.run("t-garden", JSON.stringify({ startedAt: "2026-10-29T08:00:30.000Z", completedAt: "2026-10-29T08:10:00.000Z" }));
  run.run("t-helper", JSON.stringify({ startedAt: "2026-10-29T08:02:00.000Z", completedAt: "2026-10-29T08:04:00.000Z" }));
  const message = database.prepare("insert into orchestration_v2_projection_messages values (?1, ?2, ?3, ?4, ?5)");
  const add = (threadId: string, role: string, at: string, payload: object) => message.run(`m-${at}`, threadId, role, at, JSON.stringify(payload));
  add("t-garden", "assistant", "2026-10-29T02:00:00.000Z", { text: "Before the day." });
  add("t-garden", "user", "2026-10-29T08:00:00.000Z", { createdBy: "user", creationSource: "web", text: "Plan the garden beds." });
  add("t-garden", "assistant", "2026-10-29T08:01:00.000Z", { createdBy: "agent", text: "I'll have a helper measure the beds first." });
  add("t-helper", "assistant", "2026-10-29T08:02:00.000Z", { createdBy: "agent", text: "Measuring the first bed." });
  add("t-garden", "user", "2026-10-29T08:04:00.000Z", {
    createdBy: "agent",
    creationSource: "server",
    delegatedCompletion: { taskIds: ["node:delegated-task:command%3Amcp%3Aa1"] },
    text: "Delegated task node:delegated-task:command%3Amcp%3Aa1 (Measure the beds) [completed]:\nBoth beds are two metres wide.",
  });
  add("t-garden", "user", "2026-10-29T08:05:00.000Z", {
    createdBy: "agent",
    creationSource: "provider",
    notification: {},
    text: "Background command finished.",
  });
  add("t-garden", "user", "2026-10-29T08:06:00.000Z", { createdBy: "user", creationSource: "server", text: "Written by T3 for the user." });
  add("t-garden", "assistant", "2026-10-29T08:07:00.000Z", { createdBy: "agent", text: "  " });
  add("t-garden", "user", "2026-10-29T08:08:00.000Z", { createdBy: "agent", creationSource: "mcp", scheduledTaskId: "s1", text: "Water the beds." });
  add("t-garden", "user", "2026-10-29T08:09:00.000Z", { createdBy: "agent", creationSource: "mcp", senderThreadId: "t-other", text: "The seeds arrived." });
  add("t-garden", "user", "2026-10-29T08:10:00.000Z", { createdBy: "user", creationSource: "mobile", text: "Add tomatoes." });
  database.close();
};

type Run = { readonly collected: Collected; readonly calls: string[][]; readonly stderr: string };

const collect = async (name: string, answers: object, host = "test-host"): Promise<Run> => {
  const state = join(directory, name);
  mkdirSync(state);
  writeFileSync(join(state, "fixtures.json"), JSON.stringify(answers));
  // Only the fakes are on PATH, so kontor is a command that doesn't exist, and SP_HOST is unset.
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "testing/collect-day.ts"), DAY, host], {
    env: { PATH: bin, HOME: directory, FAKE_CLI_FIXTURES: join(state, "fixtures.json"), FAKE_CLI_STATE: state },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`collect-day failed: ${stderr}`);
  const calls = readFileSync(join(state, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  return { collected: JSON.parse(stdout) as Collected, calls, stderr };
};

let collected: Collected;
let calls: string[][];
let stderr: string;
let spDown: Run;
let onZ890: Run;

beforeAll(async () => {
  mkdirSync(bin);
  for (const command of COMMANDS) {
    const shim = join(bin, command);
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "testing/fake-cli.ts")}" ${command} "$@"\n`);
    chmodSync(shim, 0o755);
  }
  writeT3State();
  [{ collected, calls, stderr }, spDown, onZ890] = await Promise.all([
    collect("all", fixtures),
    collect("sp-down", spDownFixtures),
    collect("z890", fixtures, "david-z890-nixos"),
  ]);
}, 60_000);

afterAll(() => rmSync(directory, { recursive: true, force: true }));

test("reads every source into the metrics", () => {
  expect(collected.dayMetrics).toMatchObject({
    activeMinutes: 330,
    offComputerMinutes: 120,
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
    // The user's answer to the aliased All hands couldn't be read.
    { source: "calendar:work@example.com", status: "partial" },
  ]);
  expect(collected.reportInputs.landedPrs.items).toMatchObject([
    { repository: "davidvornholt/agent-skills", title: "Add the day report", summary: "The day gets a report in Postlude." },
  ]);
  expect(collected.reportInputs.closedPrs).toEqual({
    status: "complete",
    items: [
      {
        repository: "davidvornholt/sp-cli",
        number: 43,
        ref: "sp-cli#43",
        title: "Try a second parser",
        summary: "This tries a second parser for the task list, to compare the two.",
        closedAt: "2026-10-29T11:45:00+01:00",
        part: 0,
      },
    ],
  });
  expect(collected.reportInputs.settledThreads.items).toMatchObject([{ title: "Settled today", project: "postlude" }]);
  expect(collected.timeline.threads).toEqual({
    status: "complete",
    items: [
      {
        id: "t-parser",
        title: "Fix the parser",
        project: "~/dev/postlude",
        category: "code",
        runs: [{ start: Date.parse("2026-10-29T08:30:00.000Z"), end: Date.parse("2026-10-29T09:15:00.000Z") }],
        prompts: [{ at: Date.parse("2026-10-29T08:20:00.000Z"), fromPhone: true }],
      },
    ],
  });
  expect(collected.reportInputs.looseEnds.waitingPrs.items).toMatchObject([{ ref: "postlude#14", thread: "Fix the parser" }]);
  expect(collected.conversations).toEqual({
    status: "complete",
    items: [
      {
        id: "t-parser",
        title: "Fix the parser",
        project: "~/dev/postlude",
        parts: [0],
        messages: ["09:20 User, on the phone: The parser drops dates without a year.", "10:15 Agent: They parse now, and postlude#14 tests them."],
      },
    ],
  });
});

test("reads the day thread's own messages on the z890, with its delegates' reports, but not its subagents' steps or T3's notices", () => {
  expect(onZ890.collected.problems.filter((problem) => problem.startsWith("T3"))).toEqual([]);
  expect(onZ890.collected.conversations).toEqual({
    status: "complete",
    items: [
      {
        id: "t-garden",
        title: "Plan the garden",
        project: "~/dev/garden",
        parts: [0],
        messages: [
          "09:00 User: Plan the garden beds.",
          "09:01 Agent: I'll have a helper measure the beds first.",
          "09:04 Reports of delegated tasks: Delegated task (Measure the beds) [completed]:\nBoth beds are two metres wide.",
          "09:08 Scheduled prompt: Water the beds.",
          "09:09 From another thread: The seeds arrived.",
          "09:10 User, on the phone: Add tomatoes.",
        ],
      },
    ],
  });
  // The subagent's run counts under the thread that started it.
  expect(onZ890.collected.timeline.threads.items.map((thread) => [thread.id, thread.prompts.length, thread.runs.length])).toEqual([["t-garden", 2, 1]]);
});

test("keeps only each part's own windows, not the summary's list of them", () => {
  expect(collected.reportInputs.parts[1]?.windows).toContainEqual({ app: "org.example.Writer", title: "Garden plan - Writer", minutes: 70 });
  const file = JSON.stringify(collected);
  // Below the least time a part lists, and T3 Code's own window.
  for (const title of ["Calculator", "T3 Code (Beta)"]) expect(file).not.toContain(title);
  expect(Object.keys(collected.timeline)).not.toContain("windows");
});

test("says an older copy of the skill on the z890 is why T3 Code is missing", () => {
  expect(spDown.collected.problems).toContain(
    'T3 Code unavailable: ssh exited with 1: {"error":"Unknown command: t3 2026-10-29"} (collect ran `wrap.ts t3` on david-z890-nixos over SSH, so a usage error or an unexpected shape means the skill there is older)',
  );
});

test("asks the z890 for Kontor's status from another host", () => {
  expect(collected.reportInputs.kontor).toEqual({ status: "complete", attempted: false, approvalNeeded: true });
  expect(collected.problems.filter((problem) => problem.startsWith("Kontor"))).toEqual([]);
});

test("turns a command that doesn't exist into missing coverage", () => {
  expect(onZ890.calls.some((call) => call[0] === "ssh")).toBe(false);
  expect(onZ890.collected.reportInputs.kontor).toEqual({ status: "missing", attempted: null, approvalNeeded: null });
  expect(onZ890.collected.problems.some((problem) => problem.startsWith("Kontor status unavailable: kontor could not run"))).toBe(true);
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

test("passes mail subjects on only in the list of sent mail, and never recipients, notes, or pim's or sp's error text", () => {
  expect(collected.reportInputs.sentMail.status).toBe("partial");
  expect(collected.reportInputs.sentMail.items).toHaveLength(201);
  expect(collected.reportInputs.sentMail.items[0]).toEqual({ mailbox: "me@example.com", subject: SUBJECT, sentAt: "2026-10-29T09:00:00+01:00", part: 0 });
  const withoutSentMail = (run: Collected) => JSON.stringify({ ...run, reportInputs: { ...run.reportInputs, sentMail: null } });
  for (const output of [JSON.stringify(collected), stderr, JSON.stringify(spDown.collected), spDown.stderr]) {
    for (const secret of SECRETS) expect(output).not.toContain(secret);
  }
  for (const output of [withoutSentMail(collected), stderr, withoutSentMail(spDown.collected), spDown.stderr]) expect(output).not.toContain(SUBJECT);
});

test("only reads", () => {
  const readOnly = (call: string[]): boolean => {
    const [command, ...args] = call;
    const words = args.join(" ");
    if (command === "gh") return args[0] === "api" && args[1] === "--method" && args[2] === "GET" && args[3] === "search/issues";
    if (command === "sp") return /^(tasks|projects) list\b/.test(words);
    if (command === "pim") return /^(accounts|calendar (events|get)|mail folders|mail search)\b/.test(words);
    if (command === "ssh") return ["bun ~/.claude/skills/wrap/scripts/wrap.ts t3 2026-10-29", "kontor status --json"].includes(args.at(-1) ?? "");
    return command === "activity-digest" && args.includes("--summary-json");
  };
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.filter((call) => !readOnly(call))).toEqual([]);
});

test("leaves out cancelled and declined meetings, asking once for the answer to a meeting someone else organizes", () => {
  expect(collected.reportInputs.appointments.items.map((item) => item.title)).toEqual(["Standup", "Review"]);
  expect(calls.filter((call) => call[1] === "calendar" && call[2] === "get").map((call) => call.at(-1))).toEqual(["/planning", "/weekly", "/aliased"]);
});

test("leaves out a meeting whose answer has no entry for the account, and says why its calendar is partial", () => {
  expect(collected.problems).toContain("The user's answer to some meetings in the calendar of work@example.com couldn't be read, so they are left out.");
});

test("skips the test mailboxes", () => {
  expect(calls.some((call) => call.includes("tester.test.legal@gmail.com"))).toBe(false);
});

test("reads the other host's Super Productivity copy when the local one fails", () => {
  expect(calls.filter((call) => call[0] === "sp").map((call) => call.slice(1, 3).concat(call.includes("--host") ? ["remote"] : []))).toEqual([
    ["tasks", "list"],
    ["tasks", "list", "remote"],
    ["projects", "list", "remote"],
  ]);
});

test("names Super Productivity's error tags but withholds their messages when both copies fail", () => {
  expect(spDown.collected.problems).toContain("Super Productivity unavailable: sp exited with 1: AppUnreachable; on david-x1-nixos: sp exited with 1: Ssh");
});

test("retries the calendar once and grows the mail search until it reaches before the day", () => {
  expect(calls.filter((call) => call[1] === "calendar" && call[2] === "events")).toHaveLength(2);
  expect(calls.filter((call) => call[2] === "search" && call[4] === "work@example.com").map((call) => call.at(-1))).toEqual(["200", "800"]);
});
