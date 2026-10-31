// Every command here must only read: the same tools and credentials can change the user's real accounts.

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { addDays, type DayWindow, eventOnDay } from "./day.ts";
import type { CalendarAccount, CalendarEvent, GithubData, LandedPr, Reading, SentMailData, Sources, SpData, SpTask, T3Thread } from "./sources.ts";

const GITHUB_ACCOUNT = "davidvornholt";
// pim reads these test accounts, but their sent mail isn't the user's.
const TEST_MAILBOXES = new Set(["tester.test.legal@gmail.com", "testing.acc.david01@outlook.com"]);
// Both hosts run a Super Productivity copy that syncs through SuperSync, and T3 Code keeps its state on the z890.
const SP_HOSTS = ["david-x1-nixos", "david-z890-nixos"];
const T3_HOST = "david-z890-nixos";
const COMMAND_TIMEOUT_MS = 120_000;
const CALENDAR_LIMIT = 1000;
const FIRST_MAIL_LIMIT = 200;
const MAX_MAIL_LIMIT = 3200;
const T3_CONCURRENCY = 6;
// pim's error text can quote mail or calendar text, so only these fixed diagnostics stand in for it.
const PIM_WITHHELD = "its message is withheld because it can quote mail or calendar text";
const PIM_FAILURE = `pim reported an error; ${PIM_WITHHELD}`;
// sp prints Super Productivity's error message and details as they are, so only the tag of its JSON error, such as AppUnreachable, passes.
const SP_UNTAGGED = "; it printed no error tag, and its error text is withheld";

const ok = <T>(value: T): Reading<T> => ({ ok: true, value });
const failed = <T>(error: string): Reading<T> => ({ ok: false, error });

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const firstLine = (text: string): string => text.trim().split("\n")[0]?.slice(0, 300) ?? "";

const spFailureDetail = (stderr: string): string => {
  try {
    const tag: unknown = JSON.parse(stderr)?.error?.tag;
    return typeof tag === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(tag) ? `: ${tag}` : SP_UNTAGGED;
  } catch {
    return SP_UNTAGGED;
  }
};

/** The command's stdout never appears in an error, because it may hold mail details. */
export const runJson = async (command: readonly string[]): Promise<Reading<unknown>> => {
  try {
    const child = Bun.spawn([...command], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: COMMAND_TIMEOUT_MS });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) {
      const detail = command[0] === "pim" ? `; ${PIM_WITHHELD}` : command[0] === "sp" ? spFailureDetail(stderr) : `: ${firstLine(stderr)}`;
      return failed(`${command[0]} exited with ${exitCode}${child.signalCode ? ` (${child.signalCode})` : ""}${detail}`);
    }
    try {
      return ok(JSON.parse(stdout));
    } catch {
      return failed(`${command[0]} printed output that is not JSON`);
    }
  } catch (error) {
    return failed(`${command[0]} could not run: ${messageOf(error)}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const stringOr = <T>(value: unknown, fallback: T): string | T => (typeof value === "string" ? value : fallback);
const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const parseList = <T>(reading: Reading<unknown>, what: string, parse: (item: unknown) => T): Reading<T[]> => {
  if (!reading.ok) return reading;
  if (!Array.isArray(reading.value)) return failed(`${what} is not a list`);
  try {
    return ok(reading.value.map(parse));
  } catch (error) {
    return failed(`${what}: ${messageOf(error)}`);
  }
};

const readSummary = (day: string): Promise<Reading<unknown>> => runJson(["activity-digest", day, "--summary-json"]);

const parseTask = (item: unknown): SpTask => {
  if (!isRecord(item) || typeof item.id !== "string") throw new Error("a task has no id");
  const timeSpentOnDay: Record<string, number> = {};
  if (isRecord(item.timeSpentOnDay)) {
    for (const [day, ms] of Object.entries(item.timeSpentOnDay)) if (typeof ms === "number" && Number.isFinite(ms)) timeSpentOnDay[day] = ms;
  }
  return {
    id: item.id,
    title: stringOr(item.title, ""),
    isDone: item.isDone === true,
    doneOn: typeof item.doneOn === "number" ? item.doneOn : null,
    projectId: stringOr(item.projectId, null),
    parentId: stringOr(item.parentId, null),
    subTaskIds: stringList(item.subTaskIds),
    tagIds: stringList(item.tagIds),
    timeSpentOnDay,
  };
};

const parseNamed = (item: unknown): { id: string; title: string } => {
  if (!isRecord(item) || typeof item.id !== "string") throw new Error("an entry has no id");
  return { id: item.id, title: stringOr(item.title, "") };
};

const readSpCopy = async (host: readonly string[]): Promise<Reading<SpData>> => {
  const tasks = parseList(await runJson(["sp", "tasks", "list", ...host, "--include-done", "--source", "all"]), "sp tasks", parseTask);
  if (!tasks.ok) return tasks;
  const tags = parseList(await runJson(["sp", "tags", "list", ...host]), "sp tags", parseNamed);
  if (!tags.ok) return tags;
  const projects = parseList(await runJson(["sp", "projects", "list", ...host]), "sp projects", parseNamed);
  if (!projects.ok) return projects;
  return ok({ tasks: tasks.value, tags: tags.value, projects: projects.value });
};

// The local copy comes first. sp itself honours SP_HOST, and a host can't reach itself over SSH.
const readSp = async (localHost: string): Promise<Reading<SpData>> => {
  const local = await readSpCopy([]);
  const other = SP_HOSTS.find((host) => host !== localHost);
  if (local.ok || process.env.SP_HOST || other === undefined) return local;
  const remote = await readSpCopy(["--host", other]);
  return remote.ok ? remote : failed(`${local.error}; on ${other}: ${remote.error}`);
};

const readGithub = async (window: DayWindow): Promise<Reading<GithubData>> => {
  // The search range is inclusive and accepts offsets; metrics.ts drops a PR merged exactly at the end.
  const query = `is:pr is:merged author:${GITHUB_ACCOUNT} merged:${window.start}..${window.end}`;
  const prs: LandedPr[] = [];
  let incomplete = false;
  // The search API returns at most ten pages of one hundred.
  for (let page = 1; page <= 10; page += 1) {
    const reading = await runJson(["gh", "api", "--method", "GET", "search/issues", "-f", `q=${query}`, "-f", "per_page=100", "-f", `page=${page}`]);
    if (!reading.ok) return reading;
    const body = reading.value;
    if (!isRecord(body) || !Array.isArray(body.items)) return failed("the GitHub search returned no items");
    if (body.incomplete_results === true) incomplete = true;
    for (const item of body.items) {
      if (!isRecord(item) || !isRecord(item.pull_request) || typeof item.pull_request.merged_at !== "string" || typeof item.repository_url !== "string") {
        return failed("a GitHub search result has no merge time or repository");
      }
      prs.push({ repository: item.repository_url.replace(/^.*\/repos\//, ""), title: stringOr(item.title, ""), mergedAt: item.pull_request.merged_at });
    }
    if (body.items.length < 100) break;
  }
  return ok({ prs, incomplete });
};

type PimAccount = { readonly email: string; readonly mail: boolean; readonly calendar: boolean };

const readPimAccounts = async (): Promise<Reading<PimAccount[]>> =>
  parseList(await runJson(["pim", "accounts"]), "pim accounts", (item) => {
    if (!isRecord(item) || typeof item.email !== "string") throw new Error("an account has no address");
    return { email: item.email, mail: isRecord(item.mail), calendar: isRecord(item.dav) || isRecord(item.graph) };
  });

const readSentMail = async (email: string, window: DayWindow): Promise<Reading<SentMailData>> => {
  const folders = await runJson(["pim", "mail", "folders", "--account", email]);
  if (!folders.ok) return folders;
  if (!Array.isArray(folders.value)) return failed("pim mail folders returned no list");
  const sent = folders.value.find((folder) => isRecord(folder) && folder.specialUse === "\\Sent");
  if (!isRecord(sent) || typeof sent.path !== "string") return failed("no folder is marked as Sent");
  // --since is a date and only a lower bound, and the search returns the newest mail first, so a page must reach back past the start of the day.
  for (let limit = FIRST_MAIL_LIMIT; ; limit *= 4) {
    const result = await runJson([
      "pim",
      "mail",
      "search",
      "--account",
      email,
      "--folder",
      sent.path,
      "--since",
      addDays(window.day, -1),
      "--limit",
      String(limit),
    ]);
    if (!result.ok) return result;
    if (!isRecord(result.value) || !Array.isArray(result.value.hits)) return failed("pim mail search returned no hits");
    if (Array.isArray(result.value.failures) && result.value.failures.length > 0) return failed(PIM_FAILURE);
    const sentAt = result.value.hits.map((hit) => (isRecord(hit) ? stringOr(hit.date, "") : ""));
    const limitReached = sentAt.length >= limit;
    const oldest = Math.min(...sentAt.map((date) => Date.parse(date)).filter((ms) => !Number.isNaN(ms)));
    if (!limitReached || oldest < window.startMs || limit >= MAX_MAIL_LIMIT) return ok({ sentAt, limitReached });
  }
};

type ListedEvent = Omit<CalendarEvent, "declined"> & { readonly href: string; readonly recurrenceId: string | null; readonly needsAnswer: boolean };

type CalendarCall = {
  readonly events: readonly (ListedEvent & { readonly account: string })[];
  readonly failures: ReadonlyMap<string, string>;
  readonly limitReached: boolean;
};

const callCalendar = async (window: DayWindow): Promise<Reading<CalendarCall>> => {
  // --to is the last day, inclusive, so this covers both dates the journal day touches.
  const result = await runJson(["pim", "calendar", "events", "--from", window.day, "--to", addDays(window.day, 1), "--limit", String(CALENDAR_LIMIT)]);
  if (!result.ok) return result;
  const body = result.value;
  if (!isRecord(body) || !Array.isArray(body.events)) return failed("pim calendar events returned no events");
  const events = [];
  for (const event of body.events) {
    if (!isRecord(event) || typeof event.account !== "string" || typeof event.start !== "string" || typeof event.end !== "string") {
      return failed("a calendar event has no account, start, or end");
    }
    const listed = { summary: stringOr(event.summary, ""), start: event.start, end: event.end, allDay: event.allDay === true };
    const cancelled = stringOr(event.status, "").toLowerCase() === "cancelled";
    // Only a meeting someone else organizes has an answer from the user.
    const invited = typeof event.attendees === "number" && event.attendees > 0 && stringOr(event.organizer, "").toLowerCase() !== event.account.toLowerCase();
    events.push({
      ...listed,
      account: event.account,
      href: stringOr(event.href, ""),
      recurrenceId: stringOr(event.recurrenceId, null),
      cancelled,
      needsAnswer: invited && !cancelled && eventOnDay(listed, window),
    });
  }
  const failures = new Map<string, string>();
  for (const failure of Array.isArray(body.failures) ? body.failures : []) {
    if (isRecord(failure)) failures.set(stringOr(failure.account, "unknown account"), PIM_FAILURE);
  }
  return ok({ events, failures, limitReached: events.length >= CALENDAR_LIMIT });
};

// The event list doesn't say how the user answered, so a meeting someone else organizes is read once more.
const isDeclined = async (account: string, event: Pick<ListedEvent, "href" | "recurrenceId" | "needsAnswer">): Promise<boolean | null> => {
  if (!event.needsAnswer) return false;
  if (event.href === "") return null;
  const detail = await runJson(["pim", "calendar", "get", "--account", account, "--href", event.href]);
  if (!detail.ok || !isRecord(detail.value)) return null;
  // A CalDAV href holds the whole series; an occurrence answered on its own lists its attendees under recurrence.changed.
  const { recurrence } = detail.value;
  const changed = isRecord(recurrence) && Array.isArray(recurrence.changed) ? recurrence.changed : [];
  const occurrence = changed.find((change) => isRecord(change) && change.recurrenceId === event.recurrenceId && Array.isArray(change.attendees));
  const attendees = isRecord(occurrence) ? occurrence.attendees : detail.value.attendees;
  if (!Array.isArray(attendees)) return null;
  const own = attendees.find((attendee) => isRecord(attendee) && stringOr(attendee.email, "").toLowerCase() === account.toLowerCase());
  return isRecord(own) ? own.partstat === "declined" : null;
};

const readCalendar = async (window: DayWindow, accounts: readonly string[]): Promise<Reading<{ accounts: CalendarAccount[]; limitReached: boolean }>> => {
  const first = await callCalendar(window);
  // A server that fails once often answers the second time, so failed accounts get one more try.
  const second = !first.ok || first.value.failures.size > 0 ? await callCalendar(window) : first;
  if (!first.ok && !second.ok) return first;
  const names = new Set(accounts);
  for (const call of [first, second]) {
    if (!call.ok) continue;
    for (const event of call.value.events) names.add(event.account);
    for (const account of call.value.failures.keys()) names.add(account);
  }
  const perAccount: CalendarAccount[] = [];
  let limitReached = false;
  for (const account of [...names].toSorted()) {
    const call = first.ok && !first.value.failures.has(account) ? first.value : second.ok ? second.value : first.ok ? first.value : null;
    if (call === null) continue;
    limitReached ||= call.limitReached;
    const events: CalendarEvent[] = [];
    for (const listed of call.events.filter((event) => event.account === account)) {
      const { account: _, href: __, recurrenceId: ___, needsAnswer: ____, ...event } = listed;
      events.push({ ...event, declined: await isDeclined(account, listed) });
    }
    perAccount.push({ account, events, failure: call.failures.get(account) ?? null });
  }
  return ok({ accounts: perAccount, limitReached });
};

type PimReadings = { readonly mail: Sources["mail"]; readonly calendar: Sources["calendar"] };

// pim commands run one after another, because parallel processes could race to refresh the same Microsoft login.
const readPim = async (window: DayWindow): Promise<PimReadings> => {
  const accounts = await readPimAccounts();
  if (!accounts.ok) return { mail: accounts, calendar: accounts };
  const calendar = await readCalendar(
    window,
    accounts.value.filter((account) => account.calendar).map((account) => account.email),
  );
  const mailboxes = [];
  for (const account of accounts.value.filter((candidate) => candidate.mail && !TEST_MAILBOXES.has(candidate.email.toLowerCase()))) {
    mailboxes.push({ mailbox: account.email, reading: await readSentMail(account.email, window) });
  }
  return { mail: ok(mailboxes), calendar };
};

const mapLimited = async <T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

const parseThread = (item: unknown): T3Thread => {
  if (!isRecord(item) || typeof item.createdAt !== "string" || typeof item.project !== "string") throw new Error("a thread has no project or creation time");
  return {
    title: stringOr(item.title, ""),
    project: item.project,
    settledAt: stringOr(item.settledAt, null),
    snoozedUntil: stringOr(item.snoozedUntil, null),
    createdAt: item.createdAt,
  };
};

/** Reads every top-level thread of every T3 Code project on this machine. The CLI has no project list, so the ids come from T3's state database, opened read-only. */
export const readLocalT3 = async (): Promise<Reading<T3Thread[]>> => {
  let projects: { project_id: string; title: string }[];
  try {
    const database = new Database(join(homedir(), ".t3/userdata/statev2.sqlite"), { readonly: true });
    try {
      projects = database.query("select project_id, title from projection_projects where deleted_at is null order by project_id").all() as typeof projects;
    } finally {
      database.close();
    }
  } catch (error) {
    return failed(`T3 projects unreadable: ${messageOf(error)}`);
  }
  const perProject = await mapLimited(projects, T3_CONCURRENCY, async (project) =>
    parseList(await runJson(["t3", "thread", "list", "--project", project.project_id, "--json"]), `threads of ${project.title}`, (item) =>
      parseThread(isRecord(item) ? { ...item, project: project.title } : item),
    ),
  );
  const threads: T3Thread[] = [];
  for (const reading of perProject) {
    if (!reading.ok) return reading;
    threads.push(...reading.value);
  }
  return ok(threads);
};

const readT3 = async (host: string): Promise<Reading<readonly T3Thread[]>> => {
  if (host === T3_HOST) return readLocalT3();
  return parseList(
    await runJson(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", `david@${T3_HOST}`, "bun ~/.claude/skills/wrap/scripts/wrap.ts t3-threads"]),
    "T3 threads from the z890",
    parseThread,
  );
};

const readKontor = (): Promise<Reading<unknown>> => runJson(["kontor", "status", "--json"]);

export const readSources = async (window: DayWindow, host: string): Promise<Sources> => {
  const [summary, sp, github, pim, t3, kontor] = await Promise.all([
    readSummary(window.day),
    readSp(host),
    readGithub(window),
    readPim(window),
    readT3(host),
    readKontor(),
  ]);
  return { summary, sp, github, mail: pim.mail, calendar: pim.calendar, t3, kontor };
};
