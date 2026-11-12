// The report's blocks that carry data, which the agent places with {"use": name} and never writes itself, so their numbers are what was collected. The timeline is in report-timeline.ts.
//
// Each gives its blocks and, for a section around them, a few words such as a count. A day without data for one gives no blocks, so the section is left out; a source that wasn't read gives a note saying so.

import { compareText } from "./compare.ts";
import { toBerlinClock, toBerlinIso } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { clockRange, count, durationText, minutesText } from "./format.ts";
import type { DayMetrics } from "./metrics.ts";
import {
  type Block,
  type FactsBlock,
  type ItemTime,
  type ListItem,
  label,
  note,
  type RichText,
  repositoryName,
  type Tile,
  type TileValue,
} from "./report-document.ts";
import { type List, median, type ReportInputs } from "./report-inputs.ts";

export type DataBlocks = { readonly blocks: readonly Block[]; readonly note?: string };

const none: DataBlocks = { blocks: [] };

const iso = (at: string): string => toBerlinIso(Date.parse(at));

const minutes = (value: number | null): TileValue => (value === null ? null : { minutes: value });
const counted = (value: number | null): TileValue => (value === null ? null : { count: value });
const withNote = (tile: Omit<Tile, "note">, text: string | null): Tile => (text === null ? tile : { ...tile, note: [text] });

/** A list's items with a note when its source was missing or partly read, and nothing when it is empty. */
const listOf = <T>(list: List<T>, missing: string, item: (entry: T) => ListItem, sectionNote?: string): DataBlocks => {
  if (list.status === "missing") return { blocks: [note(missing)] };
  if (list.items.length === 0) return none;
  const partial = list.status === "partial" ? [note("Some sources were not available, so this list may be incomplete.")] : [];
  return { blocks: [{ kind: "list", items: list.items.map(item) }, ...partial], ...(sectionNote === undefined ? {} : { note: sectionNote }) };
};

const sentMailTotal = (metrics: DayMetrics): { readonly total: number | null; readonly note: string | null } => {
  const read = metrics.sentMails.filter((mailbox) => mailbox.count !== null);
  if (read.length === 0) return { total: null, note: null };
  return {
    total: read.reduce((sum, mailbox) => sum + (mailbox.count ?? 0), 0),
    note: read.length < metrics.sentMails.length ? "Without the mailboxes that weren't read" : "Across all mailboxes",
  };
};

/** The day in numbers. Agent time is the time at least one agent was running, and its note what the threads' runs add up to. */
export const tiles = (collected: Collected): DataBlocks => {
  const metrics = collected.dayMetrics;
  const { prompts, agents } = collected.reportInputs.facts;
  const first = metrics.firstActivityAt;
  const last = metrics.lastActivityAt;
  const promptNote =
    prompts === null || prompts.count === 0
      ? null
      : [`In ${count(prompts.threads, "thread", "threads")}`, prompts.fromPhone > 0 ? `${prompts.fromPhone} from the phone` : null]
          .filter((part) => part !== null)
          .join(" · ");
  const agentNote =
    agents === null || agents.threads === 0
      ? null
      : [
          `${minutesText(agents.minutes)} across ${count(agents.threads, "thread", "threads")}`,
          agents.peak === null ? null : `up to ${agents.peak.count} at once`,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  const mail = sentMailTotal(metrics);
  const offScreen = metrics.appointmentOffScreenMinutes;
  return {
    blocks: [
      {
        kind: "tiles",
        tiles: [
          withNote(
            { label: "Screen time", value: minutes(metrics.activeMinutes) },
            first === null || last === null ? null : `From ${toBerlinClock(Date.parse(first))} to ${toBerlinClock(Date.parse(last))}`,
          ),
          withNote(
            { label: "Focus", value: minutes(metrics.focusMinutes) },
            metrics.scatteredMinutes === null ? null : `Short stretches: ${minutesText(metrics.scatteredMinutes)}`,
          ),
          withNote({ label: "Agent time", value: agents === null ? null : { minutes: agents.wallMinutes } }, agentNote),
          withNote({ label: "Prompts", value: prompts === null ? null : { count: prompts.count } }, promptNote),
          withNote(
            { label: "Appointments", value: minutes(metrics.appointmentMinutes) },
            offScreen === null || metrics.appointmentMinutes === 0 ? null : `Away from the screen: ${minutesText(offScreen)}`,
          ),
          { label: "Pull requests landed", value: counted(metrics.landedPrs) },
          withNote({ label: "Sent mail", value: counted(mail.total) }, mail.note),
        ],
      },
    ],
  };
};

const outputFacts = (inputs: ReportInputs): string[] => {
  const { landedPrs, closedPrs, handedOffTasks, settledThreads, facts } = inputs;
  const repositories = new Set(landedPrs.items.map((pr) => pr.repository)).size;
  const closed = closedPrs.items.length === 0 ? "" : `, and ${closedPrs.items.length} closed without merging`;
  const { agents } = facts;
  return [
    landedPrs.items.length === 0
      ? null
      : `${count(landedPrs.items.length, "pull request", "pull requests")} landed in ${count(repositories, "repository", "repositories")}${closed}.`,
    handedOffTasks.items.length === 0 ? null : `${count(handedOffTasks.items.length, "task", "tasks")} marked done in Super Productivity.`,
    settledThreads.items.length === 0 ? null : `${count(settledThreads.items.length, "thread", "threads")} settled in T3 Code.`,
    agents === null || agents.threads === 0
      ? null
      : `At least one agent was running for ${minutesText(agents.wallMinutes)}; added up across ${count(agents.threads, "thread", "threads")}, agents ran for ${minutesText(agents.minutes)}.`,
  ].filter((line) => line !== null);
};

const focusFacts = (inputs: ReportInputs): string[] => {
  const { focus, split, agents } = inputs.facts;
  const longest = focus?.longest ?? null;
  const alone =
    split === null || agents === null || agents.wallMinutes === 0
      ? ""
      : ` Of the ${minutesText(agents.wallMinutes)} with an agent running, you had no screen time for ${minutesText(split.agentsAloneMinutes)}.`;
  return [
    split === null ? null : `${minutesText(split.t3Minutes)} of your screen time was in T3 Code.${alone}`,
    focus === null || longest === null
      ? null
      : `${count(focus.blocks, "focus block", "focus blocks")}; the longest was ${minutesText(longest.minutes)} on ${longest.area}, ${clockRange(Date.parse(longest.start), Date.parse(longest.end))}.`,
  ].filter((line) => line !== null);
};

const directionFacts = (inputs: ReportInputs): string[] => {
  const { promptsByArea, dueToday } = inputs.facts;
  return [
    promptsByArea.length === 0 ? null : `Prompts by area: ${promptsByArea.map((area) => `${area.area} ${area.prompts}`).join(" · ")}.`,
    dueToday === null || dueToday.count === 0
      ? null
      : `${dueToday.done} of ${count(dueToday.count, "task", "tasks")} due on the day ${dueToday.done === 1 ? "was" : "were"} done by its end.`,
  ].filter((line) => line !== null);
};

const efficiencyFacts = (inputs: ReportInputs): string[] => {
  const { followUp, leadTimes } = inputs.facts;
  return [
    followUp === null
      ? null
      : `From an agent finishing to your next prompt in that thread: a median of ${durationText(followUp.medianSeconds)} over ${count(followUp.count, "reply", "replies")}.`,
    leadTimes.items.length === 0
      ? null
      : `From the first prompt in a thread to the last of its pull requests merging: a median of ${durationText(median(leadTimes.items.map((item) => item.minutes)) * 60)} over ${count(leadTimes.items.length, "thread", "threads")}.`,
  ].filter((line) => line !== null);
};

/** The day's figures under Output, Focus, Direction and Efficiency. A term shows only when the day's data gives it a line. */
export const figures = (collected: Collected): DataBlocks => {
  const inputs = collected.reportInputs;
  const items = (
    [
      ["Output", outputFacts(inputs)],
      ["Focus", focusFacts(inputs)],
      ["Direction", directionFacts(inputs)],
      ["Efficiency", efficiencyFacts(inputs)],
    ] as const
  )
    .filter(([, lines]) => lines.length > 0)
    .map(([term, lines]) => ({ term, details: lines.map((line): RichText => [line]) }));
  return items.length === 0 ? none : { blocks: [{ kind: "facts", items } satisfies FactsBlock] };
};

/** Per thread, from its first prompt to the last of its pull requests merging, the quickest first. */
export const leadTimes = (collected: Collected): DataBlocks =>
  listOf(
    collected.reportInputs.facts.leadTimes,
    "T3 Code or GitHub was not available.",
    (item) => ({
      text: [`${durationText(item.minutes * 60)} · ${item.thread}`],
      time: { at: iso(item.firstPromptAt) },
      meta: label(`${item.project}, ${count(item.prs, "pull request", "pull requests")}`),
    }),
    count(collected.reportInputs.facts.leadTimes.items.length, "thread", "threads"),
  );

export const appointments = (collected: Collected): DataBlocks => {
  const list = collected.reportInputs.appointments;
  return listOf(
    list,
    "The calendar was not available.",
    (event) => {
      const time: ItemTime = event.start === null || event.end === null ? { allDay: true } : { start: iso(event.start), end: iso(event.end) };
      return { text: [event.title], time };
    },
    String(list.items.length),
  );
};

/** The pull requests landed, those of the repository with the most first, each linked to GitHub. The section's note counts them by repository. */
export const pullRequests = (collected: Collected): DataBlocks => {
  const list = collected.reportInputs.landedPrs;
  const byRepository = new Map<string, (typeof list.items)[number][]>();
  for (const pr of list.items) byRepository.set(repositoryName(pr), [...(byRepository.get(repositoryName(pr)) ?? []), pr]);
  const groups = [...byRepository].toSorted(([a, left], [b, right]) => right.length - left.length || compareText(a, b));
  return listOf(
    { status: list.status, items: groups.flatMap(([, prs]) => prs) },
    "GitHub was not available.",
    (pr) => ({
      text: [{ link: pr.title, href: `https://github.com/${pr.repository}/pull/${pr.number}` }],
      time: { at: iso(pr.mergedAt) },
      meta: `${repositoryName(pr)} #${pr.number}`,
    }),
    label(groups.map(([name, prs]) => `${name} ${prs.length}`).join(" · ")),
  );
};

export const openThreads = (collected: Collected): DataBlocks =>
  listOf(
    collected.reportInputs.openThreads,
    "T3 Code was not available.",
    (thread) => ({ text: [thread.title], meta: label(`${thread.project}, since ${thread.openSince}`) }),
    String(collected.reportInputs.openThreads.items.length),
  );

/** Time tracked in Super Productivity, which keeps only a total per task and day, so it has no time of day. */
export const trackedTasks = (collected: Collected): DataBlocks =>
  listOf(collected.reportInputs.trackedTasks, "Super Productivity was not available.", (task) => ({
    text: [task.title],
    meta: label([task.project, minutesText(task.minutes)].filter((part) => part !== null).join(" · ")),
  }));

/** The mail sent from each mailbox, with the ones that couldn't be read as not measured. */
export const sentMail = (collected: Collected): DataBlocks => {
  const mailboxes = collected.dayMetrics.sentMails;
  if (mailboxes.length === 0) return { blocks: [note("Mail was not available.")] };
  return {
    blocks: [
      {
        kind: "table",
        caption: "Sent mail by mailbox",
        columns: ["Mailbox", "Sent"],
        rows: mailboxes.map(({ mailbox, count: sent }) => [[mailbox], [sent === null ? "Not measured" : String(sent)]]),
      },
    ],
  };
};

const SOURCE_NAMES: Readonly<Record<string, string>> = {
  activity: "Screen activity",
  sp: "Super Productivity",
  github: "GitHub",
  mail: "Mail",
  calendar: "Calendar",
};
const STATUS_NAMES = { complete: "read", partial: "partly read", missing: "not read" } as const;

const sourceName = (source: string): string => {
  const [kind = "", ...rest] = source.split(":");
  const detail = rest.join(":");
  return `${SOURCE_NAMES[kind] ?? kind}${detail === "" ? "" : ` (${detail})`}`;
};

// Until its first attempt Kontor always reports that it needs an approval, so the note says it hasn't tried yet instead.
const kontorNote = (inputs: ReportInputs): string | null =>
  inputs.kontor.status === "missing"
    ? "Kontor's bank status was not available."
    : inputs.kontor.attempted === false
      ? "Kontor has not attempted a bank sync yet."
      : null;

/** Which sources were read and how completely, and what Kontor couldn't say. */
export const sources = (collected: Collected): DataBlocks => {
  const { coverage } = collected.dayMetrics;
  const kontor = kontorNote(collected.reportInputs);
  const gaps = coverage.filter((entry) => entry.status !== "complete").length;
  const blocks: Block[] = [
    ...(coverage.length === 0
      ? []
      : [{ kind: "list" as const, items: coverage.map((entry) => ({ text: [sourceName(entry.source)], meta: STATUS_NAMES[entry.status] })) }]),
    ...(kontor === null ? [] : [note(kontor)]),
  ];
  return { blocks, note: gaps === 0 ? "All read" : `${gaps} not fully read` };
};

/** A warning when Kontor tried to sync and the bank connection needs a new approval. */
export const kontor = (collected: Collected): DataBlocks =>
  collected.reportInputs.kontor.attempted === true && collected.reportInputs.kontor.approvalNeeded === true
    ? { blocks: [{ kind: "callout", tone: "warning", text: ["Kontor needs a new approval for the bank connection."] }] }
    : none;
