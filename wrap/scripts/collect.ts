// Every command here must only read: the same tools and credentials can change the user's real accounts.

import { Database } from "bun:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { compareText } from "./compare.ts";
import { addDays, type DayWindow, eventOnDay } from "./day.ts";
import { prSummary } from "./pr-summary.ts";
import type {
  CalendarAccount,
  CalendarEvent,
  ClosedPr,
  ClosedPrData,
  GithubData,
  LandedPr,
  Reading,
  SentMailData,
  Sources,
  SpData,
  SpTask,
  T3Author,
  T3Data,
  T3DayThread,
  T3Message,
  T3Prompt,
  T3PullRequest,
  T3Run,
  T3Thread,
} from "./sources.ts";

const GITHUB_ACCOUNT = "davidvornholt";
// pim reads these test accounts, but their sent mail isn't the user's.
const TEST_MAILBOXES = new Set(["tester.test.legal@gmail.com", "testing.acc.david01@outlook.com"]);
// Both hosts run a Super Productivity copy that syncs through SuperSync, and T3 Code keeps its state on the z890.
const SP_HOSTS = ["david-x1-nixos", "david-z890-nixos"];
const T3_HOST = "david-z890-nixos";
// Kontor's door on prod-1 takes only the z890's key.
const KONTOR_HOST = "david-z890-nixos";
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
const numberOr = <T>(value: unknown, fallback: T): number | T => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

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
    timeSpentOnDay,
    dueDay: stringOr(item.dueDay, null),
    dueWithTime: numberOr(item.dueWithTime, null),
    deadlineDay: stringOr(item.deadlineDay, null),
    deadlineWithTime: numberOr(item.deadlineWithTime, null),
    wontDoOn: numberOr(item.wontDoOn, null),
  };
};

const parseNamed = (item: unknown): { id: string; title: string } => {
  if (!isRecord(item) || typeof item.id !== "string") throw new Error("an entry has no id");
  return { id: item.id, title: stringOr(item.title, "") };
};

const readSpCopy = async (host: readonly string[]): Promise<Reading<SpData>> => {
  const tasks = parseList(await runJson(["sp", "tasks", "list", ...host, "--include-done", "--source", "all"]), "sp tasks", parseTask);
  if (!tasks.ok) return tasks;
  const projects = parseList(await runJson(["sp", "projects", "list", ...host]), "sp projects", parseNamed);
  if (!projects.ok) return projects;
  return ok({ tasks: tasks.value, projects: projects.value });
};

// The local copy comes first. sp itself honours SP_HOST, and a host can't reach itself over SSH.
const readSp = async (localHost: string): Promise<Reading<SpData>> => {
  const local = await readSpCopy([]);
  const other = SP_HOSTS.find((host) => host !== localHost);
  if (local.ok || process.env.SP_HOST || other === undefined) return local;
  const remote = await readSpCopy(["--host", other]);
  return remote.ok ? remote : failed(`${local.error}; on ${other}: ${remote.error}`);
};

const searchPrs = async <T>(
  filter: string,
  parse: (item: Record<string, unknown>, repository: string) => T | null,
): Promise<Reading<{ prs: T[]; incomplete: boolean }>> => {
  const query = `is:pr author:${GITHUB_ACCOUNT} ${filter}`;
  const prs: T[] = [];
  let incomplete = false;
  // The search API returns at most ten pages of one hundred.
  for (let page = 1; page <= 10; page += 1) {
    const reading = await runJson(["gh", "api", "--method", "GET", "search/issues", "-f", `q=${query}`, "-f", "per_page=100", "-f", `page=${page}`]);
    if (!reading.ok) return reading;
    const body = reading.value;
    if (!isRecord(body) || !Array.isArray(body.items)) return failed("the GitHub search returned no items");
    if (body.incomplete_results === true) incomplete = true;
    for (const item of body.items) {
      const pr = isRecord(item) && typeof item.repository_url === "string" ? parse(item, item.repository_url.replace(/^.*\/repos\//, "")) : null;
      if (pr === null) return failed("a GitHub search result has no repository, number, or time");
      prs.push(pr);
    }
    if (body.items.length < 100) break;
  }
  return ok({ prs, incomplete });
};

// The search ranges are inclusive and accept offsets; metrics.ts and report-inputs.ts drop a PR exactly at the end.
const readGithub = (window: DayWindow): Promise<Reading<GithubData>> =>
  searchPrs(`is:merged merged:${window.start}..${window.end}`, (item, repository): LandedPr | null =>
    isRecord(item.pull_request) && typeof item.pull_request.merged_at === "string" && typeof item.number === "number"
      ? { repository, number: item.number, title: stringOr(item.title, ""), summary: prSummary(item.body), mergedAt: item.pull_request.merged_at }
      : null,
  );

const readClosedPrs = (window: DayWindow): Promise<Reading<ClosedPrData>> =>
  searchPrs(`is:closed is:unmerged closed:${window.start}..${window.end}`, (item, repository): ClosedPr | null =>
    typeof item.closed_at === "string" && typeof item.number === "number"
      ? { repository, number: item.number, title: stringOr(item.title, ""), summary: prSummary(item.body), closedAt: item.closed_at }
      : null,
  );

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
    const mails = result.value.hits.map((hit) =>
      isRecord(hit) ? { at: stringOr(hit.date, ""), subject: stringOr(hit.subject, "") } : { at: "", subject: "" },
    );
    const limitReached = mails.length >= limit;
    const oldest = Math.min(...mails.map((mail) => Date.parse(mail.at)).filter((ms) => !Number.isNaN(ms)));
    if (!limitReached || oldest < window.startMs || limit >= MAX_MAIL_LIMIT) return ok({ sent: mails, limitReached });
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

type ProjectRow = { readonly project_id: string; readonly title: string; readonly workspace_root: string; readonly deleted_at: string | null };
type ThreadRow = {
  readonly thread_id: string;
  readonly title: string;
  readonly project_id: string;
  readonly parent_id: string | null;
  readonly relationship: string | null;
};
type RunRow = { readonly thread_id: string; readonly status: string; readonly started_at: string; readonly completed_at: string | null };
type PromptRow = { readonly thread_id: string; readonly created_at: string; readonly source: string };
type MessageRow = {
  readonly thread_id: string;
  readonly created_at: string;
  readonly role: string;
  readonly text: string | null;
  readonly created_by: string | null;
  readonly source: string | null;
  readonly delegated: number;
  readonly scheduled: number;
};

/** Writes the home folder as "~", as the activity summary does for T3 projects. */
export const homeRelative = (path: string, home: string): string => (path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);

// T3 also stores messages it writes for the user, with creationSource "server"; only what the user typed on the computer ("web") or the phone ("mobile") is a prompt.
const PROMPTS = `m.role = 'user' and json_extract(m.payload_json, '$.createdBy') = 'user' and json_extract(m.payload_json, '$.creationSource') in ('web', 'mobile')`;

const PR_STATES = new Set(["open", "merged", "closed"]);

/** Who wrote a message, or null for T3's notices that background work finished and the messages it writes for the user. */
type AuthorRow = Pick<MessageRow, "role" | "created_by" | "source" | "delegated" | "scheduled">;

const authorOf = (row: AuthorRow): T3Author | null => {
  if (row.role === "assistant") return "agent";
  if (row.role === "user" && row.created_by === "user" && (row.source === "web" || row.source === "mobile")) return row.source === "mobile" ? "phone" : "user";
  if (row.created_by !== "agent") return null;
  if (row.delegated === 1) return "delegates";
  if (row.source === "mcp") return row.scheduled === 1 ? "schedule" : "thread";
  return null;
};

const AUTHOR_COLUMNS = `json_extract(m.payload_json, '$.createdBy') as created_by, json_extract(m.payload_json, '$.creationSource') as source,
  json_extract(m.payload_json, '$.delegatedCompletion') is not null as delegated, json_extract(m.payload_json, '$.scheduledTaskId') is not null as scheduled`;

// T3 heads each delegate's report with the task's long node id, as "Delegated task node:delegated-task:… (Title) [completed]:".
const DELEGATE_NODE_ID = /^Delegated task \S+ \(/gm;

const parsePullRequest = (item: unknown): T3PullRequest => {
  if (!isRecord(item) || typeof item.repository !== "string" || typeof item.number !== "number" || typeof item.linkedAt !== "string") {
    throw new Error("a pull request has no repository, number, or link time");
  }
  if (typeof item.state !== "string" || !PR_STATES.has(item.state)) throw new Error("a pull request has no state");
  return {
    repository: item.repository,
    number: item.number,
    title: stringOr(item.title, ""),
    linkedAt: item.linkedAt,
    state: item.state as T3PullRequest["state"],
    isDraft: item.isDraft === true,
    mergedAt: stringOr(item.mergedAt, null),
    closedAt: stringOr(item.closedAt, null),
  };
};

/** A link from a thread's payload, which keeps the pull request's state in a snapshot; null for a link T3 hasn't synced. */
const linkedPullRequest = (link: unknown): T3PullRequest | null => {
  if (!isRecord(link) || !isRecord(link.snapshot)) return null;
  const { snapshot } = link;
  try {
    return parsePullRequest({ ...link, ...snapshot, linkedAt: link.linkedAt });
  } catch {
    return null;
  }
};

/** The thread a thread's runs and pull requests count under: the nearest ancestor that isn't a subagent. */
const foldInto = (threads: ReadonlyMap<string, ThreadRow>, id: string): string => {
  const seen = new Set<string>();
  let current = id;
  for (;;) {
    const row = threads.get(current);
    if (row?.relationship !== "subagent" || row.parent_id === null || !threads.has(row.parent_id) || seen.has(current)) return current;
    seen.add(current);
    current = row.parent_id;
  }
};

/**
 * Reads this machine's T3 Code threads, and the threads the user prompted or agents ran in during the journal day with those runs, prompts and messages.
 * The CLI lists neither projects, runs nor messages, so they come from T3's state database, opened read-only. A run that never started has no time and is left out.
 */
export const readLocalT3 = async (window: DayWindow, nowMs: number): Promise<Reading<T3Data>> => {
  const home = homedir();
  let projects: ProjectRow[];
  let threadRows: ThreadRow[];
  let runRows: RunRow[];
  let promptRows: PromptRow[];
  let messages: T3Message[];
  let dayThreads: T3DayThread[];
  try {
    const database = new Database(join(home, ".t3/userdata/statev2.sqlite"), { readonly: true });
    try {
      projects = database.query("select project_id, title, workspace_root, deleted_at from projection_projects order by project_id").all() as ProjectRow[];
      threadRows = database
        .query(
          `select thread_id, title, project_id, json_extract(payload_json, '$.lineage.parentThreadId') as parent_id,
             json_extract(payload_json, '$.lineage.relationshipToParent') as relationship
           from orchestration_v2_projection_threads`,
        )
        .all() as ThreadRow[];
      // T3 writes its times with toISOString, so they compare as text.
      const [start, end] = [new Date(window.startMs).toISOString(), new Date(window.endMs).toISOString()];
      runRows = database
        .query(
          `select thread_id, status, json_extract(payload_json, '$.startedAt') as started_at, json_extract(payload_json, '$.completedAt') as completed_at
           from orchestration_v2_projection_runs
           where started_at < ?1 and (completed_at >= ?2 or (completed_at is null and status = 'running'))`,
        )
        .all(end, start) as RunRow[];
      promptRows = database
        .query(
          `select m.thread_id, m.created_at, json_extract(m.payload_json, '$.creationSource') as source
           from orchestration_v2_projection_messages m where m.created_at >= ?1 and m.created_at < ?2 and ${PROMPTS}`,
        )
        .all(start, end) as PromptRow[];
      const byThread = new Map(threadRows.map((row) => [row.thread_id, row]));
      const fold = (id: string) => foldInto(byThread, id);
      const ids = [...new Set([...runRows, ...promptRows].map((row) => fold(row.thread_id)))].toSorted(compareText);
      const members = new Map<string, string[]>(ids.map((id) => [id, []]));
      for (const row of threadRows) members.get(fold(row.thread_id))?.push(row.thread_id);
      const projectRoots = new Map(projects.map((project) => [project.project_id, homeRelative(project.workspace_root, home)]));
      const firstPrompt = database.query(`select min(m.created_at) as at from orchestration_v2_projection_messages m where m.thread_id = ?1 and ${PROMPTS}`);
      const firstMessage = database.query(
        `select m.role, ${AUTHOR_COLUMNS} from orchestration_v2_projection_messages m where m.thread_id = ?1 and m.role = 'user' order by m.created_at, m.rowid limit 1`,
      );
      const links = database.query(
        `select json_extract(payload_json, '$.pullRequests') as links from orchestration_v2_projection_threads where thread_id in (select value from json_each(?1))`,
      );
      dayThreads = ids.map((id) => {
        const row = byThread.get(id);
        const first = firstMessage.get(id) as AuthorRow | null;
        const pullRequests = new Map<string, T3PullRequest>();
        for (const { links: raw } of links.all(JSON.stringify(members.get(id) ?? [id])) as { links: string | null }[]) {
          const parsed: unknown = raw === null ? [] : JSON.parse(raw);
          for (const pr of (Array.isArray(parsed) ? parsed : []).map(linkedPullRequest)) {
            if (pr === null) continue;
            const key = `${pr.repository}#${pr.number}`;
            const known = pullRequests.get(key);
            if (known === undefined || compareText(pr.linkedAt, known.linkedAt) < 0) pullRequests.set(key, pr);
          }
        }
        return {
          id,
          title: row?.title ?? "",
          project: projectRoots.get(row?.project_id ?? "") ?? "-",
          firstPromptAt: (firstPrompt.get(id) as { at: string | null } | null)?.at ?? null,
          startedBy: first === null ? null : authorOf(first),
          pullRequests: [...pullRequests.values()].toSorted(
            (a, b) => compareText(a.linkedAt, b.linkedAt) || compareText(a.repository, b.repository) || a.number - b.number,
          ),
        };
      });
      const dayIds = new Set(ids);
      messages = (
        database
          .query(
            `select m.thread_id, m.created_at, m.role, json_extract(m.payload_json, '$.text') as text, ${AUTHOR_COLUMNS}
             from orchestration_v2_projection_messages m where m.created_at >= ?1 and m.created_at < ?2 order by m.created_at, m.rowid`,
          )
          .all(start, end) as MessageRow[]
      ).flatMap((row) => {
        const author = authorOf(row);
        const text = (row.text ?? "").trim();
        if (author === null || text === "" || !dayIds.has(row.thread_id)) return [];
        return [
          { threadId: row.thread_id, at: row.created_at, author, text: author === "delegates" ? text.replace(DELEGATE_NODE_ID, "Delegated task (") : text },
        ];
      });
      runRows = runRows.map((row) => ({ ...row, thread_id: fold(row.thread_id) }));
      promptRows = promptRows.map((row) => ({ ...row, thread_id: fold(row.thread_id) }));
    } finally {
      database.close();
    }
  } catch (error) {
    return failed(`T3 state unreadable: ${messageOf(error)}`);
  }
  const runs: T3Run[] = runRows
    .map((row) => ({
      threadId: row.thread_id,
      start: row.started_at,
      end: row.completed_at ?? new Date(nowMs).toISOString(),
      running: row.completed_at === null,
    }))
    .toSorted((a, b) => compareText(a.start, b.start) || compareText(a.threadId, b.threadId));
  const prompts: T3Prompt[] = promptRows
    .map((row) => ({ threadId: row.thread_id, at: row.created_at, fromPhone: row.source === "mobile" }))
    .toSorted((a, b) => compareText(a.at, b.at) || compareText(a.threadId, b.threadId));
  const live = projects.filter((project) => project.deleted_at === null);
  const perProject = await mapLimited(live, T3_CONCURRENCY, async (project) =>
    parseList(await runJson(["t3", "thread", "list", "--project", project.project_id, "--json"]), `threads of ${project.title}`, (item) =>
      parseThread(isRecord(item) ? { ...item, project: project.title } : item),
    ),
  );
  const threads: T3Thread[] = [];
  for (const reading of perProject) {
    if (!reading.ok) return reading;
    threads.push(...reading.value);
  }
  return ok({ threads, dayThreads, runs, prompts, messages });
};

const AUTHORS = new Set<string>(["user", "phone", "agent", "delegates", "schedule", "thread"] satisfies T3Author[]);

const isAuthor = (value: unknown): value is T3Author => typeof value === "string" && AUTHORS.has(value);

const parseDayThread = (item: unknown): T3DayThread => {
  if (!isRecord(item) || typeof item.id !== "string" || typeof item.project !== "string" || !Array.isArray(item.pullRequests)) {
    throw new Error("a day thread has no id, project, or pull requests");
  }
  if (item.startedBy !== null && !isAuthor(item.startedBy)) throw new Error("a day thread has no author of its first message");
  return {
    id: item.id,
    title: stringOr(item.title, ""),
    project: item.project,
    firstPromptAt: stringOr(item.firstPromptAt, null),
    startedBy: item.startedBy,
    pullRequests: item.pullRequests.map(parsePullRequest),
  };
};

const parseRun = (item: unknown): T3Run => {
  if (!isRecord(item) || typeof item.threadId !== "string" || typeof item.start !== "string" || typeof item.end !== "string") {
    throw new Error("a run has no thread, start, or end");
  }
  return { threadId: item.threadId, start: item.start, end: item.end, running: item.running === true };
};

const parsePrompt = (item: unknown): T3Prompt => {
  if (!isRecord(item) || typeof item.threadId !== "string" || typeof item.at !== "string") throw new Error("a prompt has no thread or time");
  return { threadId: item.threadId, at: item.at, fromPhone: item.fromPhone === true };
};

const parseMessage = (item: unknown): T3Message => {
  if (!isRecord(item) || typeof item.threadId !== "string" || typeof item.at !== "string" || typeof item.text !== "string") {
    throw new Error("a message has no thread, time, or text");
  }
  if (!isAuthor(item.author)) throw new Error("a message has no author");
  return { threadId: item.threadId, at: item.at, author: item.author, text: item.text };
};

const readT3 = async (window: DayWindow, host: string): Promise<Reading<T3Data>> => {
  if (host === T3_HOST) return readLocalT3(window, Date.now());
  const reading = await runJson([
    "ssh",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    `david@${T3_HOST}`,
    `bun ~/.claude/skills/wrap/scripts/wrap.ts t3 ${window.day}`,
  ]);
  const older = `collect ran \`wrap.ts t3\` on ${T3_HOST} over SSH, so a usage error or an unexpected shape means the skill there is older`;
  if (!reading.ok) return failed(`${reading.error} (${older})`);
  const value = isRecord(reading.value) ? reading.value : {};
  const list = <T>(key: string, parse: (item: unknown) => T): Reading<T[]> => {
    const parsed = parseList(ok(value[key]), `T3 ${key} from the z890`, parse);
    return parsed.ok ? parsed : failed(`${parsed.error} (${older})`);
  };
  const threads = list("threads", parseThread);
  if (!threads.ok) return threads;
  const dayThreads = list("dayThreads", parseDayThread);
  if (!dayThreads.ok) return dayThreads;
  const runs = list("runs", parseRun);
  if (!runs.ok) return runs;
  const prompts = list("prompts", parsePrompt);
  if (!prompts.ok) return prompts;
  const messages = list("messages", parseMessage);
  if (!messages.ok) return messages;
  return ok({ threads: threads.value, dayThreads: dayThreads.value, runs: runs.value, prompts: prompts.value, messages: messages.value });
};

const readKontor = (host: string): Promise<Reading<unknown>> =>
  runJson(
    host === KONTOR_HOST
      ? ["kontor", "status", "--json"]
      : ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", `david@${KONTOR_HOST}`, "kontor status --json"],
  );

export const readSources = async (window: DayWindow, host: string): Promise<Sources> => {
  const [summary, sp, github, closedPrs, pim, t3, kontor] = await Promise.all([
    readSummary(window.day),
    readSp(host),
    readGithub(window),
    readClosedPrs(window),
    readPim(window),
    readT3(window, host),
    readKontor(host),
  ]);
  return { summary, sp, github, closedPrs, mail: pim.mail, calendar: pim.calendar, t3, kontor };
};
