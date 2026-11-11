// The template reads the day's figures from Postlude's message, and the times, minutes and counts this script prints come from the collected data. The agent writes only the prose: a summary, a title and one or more paragraphs per part, and clearer names for threads whose T3 title is unclear.

import { compareText } from "./compare.ts";
import { toBerlinClock } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { clockRange, escapeHtml, minutesText } from "./html.ts";
import { METRICS_VERSION } from "./metrics.ts";
import { renderTimeline } from "./render-timeline.ts";
import { type List, median, type ReportInputs } from "./report-inputs.ts";
import { projectLabel } from "./timeline.ts";

export const PART_TITLE_MAX_LENGTH = 60;
/** Open pull requests listed one by one in the loose ends; more collapse into one entry. */
export const WAITING_PRS_LISTED = 3;

const TEMPLATE_URL = new URL("../report/template.html", import.meta.url);

export type AgentPart = { readonly title: string; readonly paragraphs: readonly string[] };

/** What the agent writes: a summary of the day in one or more paragraphs, a title and one or more paragraphs per part, in order, and names for some of the day's threads, by thread id. */
export type AgentText = {
  readonly summary: readonly string[];
  readonly parts: readonly AgentPart[];
  readonly threadNames: ReadonlyMap<string, string>;
};

const TEXT_SHAPE = '{"summary": "...", "parts": [{"title": "...", "text": "..."}, ...], "threads": {"<thread id>": "<name>", ...}}';

const tidy = (text: string): string => text.trim().replace(/\s+/g, " ");

const cleanText = (name: string, text: unknown): string => {
  if (typeof text !== "string") throw new Error(`The ${name} is not a string.`);
  const clean = tidy(text);
  if (clean.length === 0) throw new Error(`The ${name} is empty.`);
  return clean;
};

/** Splits a text into paragraphs at blank lines, tidies the white space within each, and drops the empty ones. */
const cleanParagraphs = (name: string, text: unknown): string[] => {
  if (typeof text !== "string") throw new Error(`The ${name} is not a string.`);
  const paragraphs = text
    .split(/\n[^\S\n]*\n/)
    .map(tidy)
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) throw new Error(`The ${name} is empty.`);
  return paragraphs;
};

const checkPart = (part: unknown, index: number): AgentPart => {
  const { title, text } = (typeof part === "object" && part !== null ? part : {}) as { title?: unknown; text?: unknown };
  const label = `part ${index + 1}`;
  if (typeof title !== "string" || typeof text !== "string") throw new Error(`The ${label} needs a title and a text, as ${TEXT_SHAPE}.`);
  const cleanTitle = cleanText(`title of ${label}`, title);
  if (cleanTitle.length > PART_TITLE_MAX_LENGTH)
    throw new Error(`The title of ${label} has ${cleanTitle.length} characters; the limit is ${PART_TITLE_MAX_LENGTH}.`);
  return { title: cleanTitle, paragraphs: cleanParagraphs(`text of ${label}`, text) };
};

// Optional, and only for the day's threads, so a name always has a row or a conversation it belongs to.
const checkThreadNames = (threads: unknown, collected: Collected): Map<string, string> => {
  if (threads === undefined) return new Map();
  if (typeof threads !== "object" || threads === null || Array.isArray(threads)) throw new Error(`The threads are not an object, as ${TEXT_SHAPE}.`);
  const dayIds = new Set([...collected.timeline.threads.items, ...collected.conversations.items].map((thread) => thread.id));
  return new Map(
    Object.entries(threads).map(([id, name]) => {
      if (!dayIds.has(id)) throw new Error(`The threads name ${id}, which is not one of the day's threads.`);
      return [id, cleanText(`name of thread ${id}`, name)];
    }),
  );
};

/** Reads the agent's JSON from stdin and checks that it has one entry per part of the collected day. */
export const parseAgentText = (raw: string, collected: Collected): AgentText => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`The report text is not JSON. Pipe ${TEXT_SHAPE}.`);
  }
  if (typeof value !== "object" || value === null) throw new Error("The report text is not a JSON object.");
  const { summary, parts, threads } = value as { summary?: unknown; parts?: unknown; threads?: unknown };
  if (!Array.isArray(parts)) throw new Error("The report text has no parts list.");
  const dayParts = collected.reportInputs.parts;
  if (parts.length !== dayParts.length)
    throw new Error(
      `The report text has ${parts.length} parts, but the day has ${dayParts.length}. Write one entry per entry of reportInputs.parts, in order.`,
    );
  return {
    summary: cleanParagraphs("summary", summary),
    parts: dayParts.map((_, index) => checkPart(parts[index], index)),
    threadNames: checkThreadNames(threads, collected),
  };
};

/** A model ID as people say it, such as "Claude Opus 5.5" for claude-opus-5-5. An unknown ID stays as it is. */
export const modelDisplayName = (id: string): string => {
  const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(id);
  if (claude) {
    const [, family = "", major, minor] = claude;
    return `Claude ${title(family)} ${minor === undefined ? major : `${major}.${minor}`}`;
  }
  const gpt = /^gpt-([\d.]+)(?:-(.+))?$/.exec(id);
  if (gpt) {
    const [, version, variant] = gpt;
    return variant === undefined ? `GPT-${version}` : `GPT-${version} ${variant.split("-").map(title).join(" ")}`;
  }
  return id;
};

const sectionBody = <T>(list: List<T>, empty: string, body: (items: readonly T[]) => string): string => {
  const content =
    list.status === "missing" ? `<p class="empty">Not available.</p>` : list.items.length === 0 ? `<p class="empty">${empty}</p>` : body(list.items);
  const partial = list.status === "partial" ? `<p class="meta">Some sources were not available, so this list may be incomplete.</p>` : "";
  return `${content}${partial}`;
};

const itemList = <T>(items: readonly T[], item: (entry: T) => string): string =>
  `<ul class="items">${items.map((entry) => `<li>${item(entry)}</li>`).join("")}</ul>`;

const withMeta = (title: string, meta: string | null): string =>
  meta === null || meta === "" ? escapeHtml(title) : `${escapeHtml(title)} <span class="meta">· ${escapeHtml(meta)}</span>`;

const renderAppointments = (inputs: ReportInputs): string =>
  `<section><h2>Appointments</h2>${sectionBody(inputs.appointments, "No appointments.", (items) =>
    itemList(items, (event) => {
      const time = event.start === null || event.end === null ? "All day" : clockRange(Date.parse(event.start), Date.parse(event.end));
      return `<span class="time">${time}</span>${escapeHtml(event.title)}`;
    }),
  )}</section>`;

// Collapsed, because a day can land dozens; the summary line already says where they landed.
const renderPrs = (inputs: ReportInputs): string => {
  const { landedPrs } = inputs;
  const byRepository = new Map<string, (typeof landedPrs.items)[number][]>();
  for (const pr of landedPrs.items) byRepository.set(pr.repository, [...(byRepository.get(pr.repository) ?? []), pr]);
  const groups = [...byRepository].toSorted(([a, left], [b, right]) => right.length - left.length || compareText(a, b));
  const heading = "<h2>Pull requests landed</h2>";
  if (landedPrs.items.length === 0) return `<section>${heading}${sectionBody(landedPrs, "No pull requests landed.", () => "")}</section>`;
  const counts = groups.map(([repository, prs]) => `${escapeHtml(projectLabel(repository))} ${prs.length}`).join(" · ");
  const body = groups
    .map(
      ([repository, prs]) =>
        `<h3>${escapeHtml(projectLabel(repository))} <span class="meta">· ${prs.length}</span></h3>${itemList(
          prs,
          (pr) => `<span class="time">${toBerlinClock(Date.parse(pr.mergedAt))}</span>${withMeta(pr.title, `#${pr.number}`)}`,
        )}`,
    )
    .join("");
  return `<section><details class="prs"><summary>${heading}<span class="meta">${counts}</span></summary>${sectionBody(landedPrs, "", () => body)}</details></section>`;
};

const renderOpenThreads = (inputs: ReportInputs): string =>
  `<section><h2>Threads open for several days</h2>${sectionBody(inputs.openThreads, "No thread has been open for several days.", (items) =>
    itemList(items, (thread) => withMeta(thread.title, `${thread.project}, since ${thread.openSince}`)),
  )}</section>`;

const renderLists = (inputs: ReportInputs): string => [renderAppointments(inputs), renderPrs(inputs), renderOpenThreads(inputs)].join("\n  ");

const renderParts = (collected: Collected, text: AgentText): string => {
  const { parts } = collected.reportInputs;
  if (parts.length === 0) return "";
  const items = parts.map((part, index) => {
    const own = text.parts[index] ?? { title: "", paragraphs: [] };
    const paragraphs = own.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
    return `<li class="arc"><h3><span class="no">${index + 1}</span><span>${escapeHtml(own.title)}</span><span class="when">${part.clock}</span></h3>${paragraphs}</li>`;
  });
  return `<section><h2>The day in parts</h2><ol class="arcs">${items.join("")}</ol></section>`;
};

/** A duration as the report's script writes it: seconds under a minute, days and hours over a day. */
export const durationText = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 24 * 60) return minutesText(minutes);
  const hours = Math.round(minutes / 60);
  return hours % 24 === 0 ? `${hours / 24} d` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
};

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const tile = (label: string, value: string | null, note: string | null): string =>
  `<div class="tile"><p class="tile-label">${label}</p><p class="tile-value">${value ?? `<span class="unmeasured">Not measured</span>`}</p>${
    note === null ? "" : `<p class="tile-note">${escapeHtml(note)}</p>`
  }</div>`;

const renderTiles = (inputs: ReportInputs): string => {
  const { prompts, agents } = inputs.facts;
  const promptNote =
    prompts === null || prompts.count === 0
      ? null
      : [`In ${count(prompts.threads, "thread", "threads")}`, prompts.fromPhone > 0 ? `${prompts.fromPhone} from the phone` : null]
          .filter((part) => part !== null)
          .join(" · ");
  const peak = agents?.peak ?? null;
  const agentNote = peak === null ? null : `Up to ${count(peak.count, "thread", "threads")} at once, at ${toBerlinClock(Date.parse(peak.at))}`;
  return [
    tile("Prompts", prompts === null ? null : String(prompts.count), promptNote),
    tile("Agent time", agents === null ? null : minutesText(agents.minutes), agentNote),
  ].join("");
};

// A div, not a p, because the entry of many pull requests holds a details element.
const looseItem = (tag: string, body: string): string => `<li class="loose"><span class="tag">${tag}</span><div>${body}</div></li>`;

const renderWaitingPrs = (prs: ReportInputs["looseEnds"]["waitingPrs"]["items"]): string[] => {
  const line = (pr: (typeof prs)[number]) => withMeta(`${pr.ref} ${pr.title}`, pr.thread);
  if (prs.length <= WAITING_PRS_LISTED) return prs.map((pr) => looseItem(pr.isDraft ? "Draft" : "Open", line(pr)));
  const drafts = prs.filter((pr) => pr.isDraft).length;
  const byRepository = new Map<string, (typeof prs)[number][]>();
  for (const pr of prs) byRepository.set(pr.repository, [...(byRepository.get(pr.repository) ?? []), pr]);
  const groups = [...byRepository]
    .toSorted(([a, left], [b, right]) => right.length - left.length || compareText(a, b))
    .map(([repository, entries]) => `<h3>${escapeHtml(projectLabel(repository))} <span class="meta">· ${entries.length}</span></h3>${itemList(entries, line)}`)
    .join("");
  const drafted = drafts === 0 ? "" : drafts === prs.length ? ", all of them drafts" : drafts === 1 ? ", one of them a draft" : `, ${drafts} of them drafts`;
  return [
    looseItem(
      "Open",
      `${prs.length} pull requests from the day's threads were still open at its end${drafted}.<details><summary>Show them</summary>${groups}</details>`,
    ),
  ];
};

const WHEN_TAGS = { overdue: "Overdue", today: "Today", tomorrow: "Tomorrow" } as const;

const renderLooseEnds = (inputs: ReportInputs): string => {
  const { waitingPrs, dueTasks, runningThreads } = inputs.looseEnds;
  const items = [
    ...runningThreads.items.map((thread) => looseItem("Running", withMeta(thread.title, thread.project))),
    ...renderWaitingPrs(waitingPrs.items),
    ...dueTasks.items.map((task) =>
      looseItem(
        WHEN_TAGS[task.when],
        withMeta(
          task.title,
          [task.project, task.kind === "deadline" ? "deadline" : null, task.when === "overdue" ? `since ${task.day}` : null]
            .filter((part) => part !== null)
            .join(", "),
        ),
      ),
    ),
  ];
  const gaps = [
    waitingPrs.status === "missing" || runningThreads.status === "missing"
      ? "T3 Code was not available, so open pull requests and running threads are missing."
      : null,
    dueTasks.status === "missing" ? "Super Productivity was not available, so due tasks are missing." : null,
  ].filter((note) => note !== null);
  const body = items.length === 0 ? `<p class="empty">No loose ends.</p>` : `<ul class="loose-ends">${items.join("")}</ul>`;
  return `<section><h2>Loose ends</h2>${body}${gaps.map((note) => `<p class="meta">${note}</p>`).join("")}</section>`;
};

const outputFacts = (inputs: ReportInputs): string[] => {
  const { landedPrs, closedPrs, handedOffTasks, settledThreads, facts } = inputs;
  const repositories = new Set(landedPrs.items.map((pr) => pr.repository)).size;
  const closed = closedPrs.items.length === 0 ? "" : `, and ${closedPrs.items.length} closed without merging`;
  const agents = facts.agents;
  return [
    landedPrs.status === "missing" || landedPrs.items.length === 0
      ? null
      : `${count(landedPrs.items.length, "pull request", "pull requests")} landed in ${count(repositories, "repository", "repositories")}${closed}.`,
    handedOffTasks.items.length === 0 ? null : `${count(handedOffTasks.items.length, "task", "tasks")} marked done in Super Productivity.`,
    settledThreads.items.length === 0 ? null : `${count(settledThreads.items.length, "thread", "threads")} settled in T3 Code.`,
    agents === null || agents.threads === 0
      ? null
      : `Agents ran in ${count(agents.threads, "thread", "threads")} for ${minutesText(agents.minutes)} in all; at least one was running for ${minutesText(agents.wallMinutes)}.`,
  ].filter((line) => line !== null);
};

const focusFacts = (inputs: ReportInputs): string[] => {
  const { focus, split } = inputs.facts;
  const longest = focus?.longest ?? null;
  return [
    split === null
      ? null
      : `${minutesText(split.t3Minutes)} of your screen time was in T3 Code, and agents ran for ${minutesText(split.agentsAloneMinutes)} while you had no screen time.`,
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
  const lead =
    leadTimes.items.length === 0
      ? null
      : `From the first prompt in a thread to the last of its pull requests merging: a median of ${durationText(median(leadTimes.items.map((item) => item.minutes)) * 60)} over ${count(leadTimes.items.length, "thread", "threads")}.<details><summary>Show the threads</summary>${itemList(
          leadTimes.items,
          (item) =>
            `<span class="time">${durationText(item.minutes * 60)}</span>${withMeta(item.thread, `${item.project}, ${count(item.prs, "pull request", "pull requests")}, first prompt ${item.firstPromptAt.slice(0, 10)} ${toBerlinClock(Date.parse(item.firstPromptAt))}`)}`,
        )}</details>`;
  return [
    followUp === null
      ? null
      : escapeHtml(
          `From an agent finishing to your next prompt in that thread: a median of ${durationText(followUp.medianSeconds)} over ${count(followUp.count, "reply", "replies")}.`,
        ),
    lead,
  ].filter((line) => line !== null);
};

// A heading shows only when the day's data gives it a line.
const renderFacts = (inputs: ReportInputs): string => {
  const headings = [
    ["Output", outputFacts(inputs).map(escapeHtml)],
    ["Focus", focusFacts(inputs).map(escapeHtml)],
    ["Direction", directionFacts(inputs).map(escapeHtml)],
    ["Efficiency", efficiencyFacts(inputs)],
  ] as const;
  const shown = headings.filter(([, lines]) => lines.length > 0);
  if (shown.length === 0) return "";
  const body = shown.map(([heading, lines]) => `<dt>${heading}</dt><dd><ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul></dd>`).join("");
  return `<section><h2>The day in figures</h2><dl class="facts">${body}</dl></section>`;
};

// Until its first attempt Kontor always needs an approval, and the note says so instead.
const renderAlerts = (inputs: ReportInputs): string =>
  inputs.kontor.attempted === true && inputs.kontor.approvalNeeded === true
    ? `<div class="alert" role="status"><span class="alert-icon" aria-hidden="true">!</span><p>Kontor needs a new approval for the bank connection.</p></div>`
    : "";

const renderNotes = (inputs: ReportInputs): string => {
  const note =
    inputs.kontor.status === "missing"
      ? "Kontor's bank status was not available."
      : inputs.kontor.attempted === false
        ? "Kontor has not attempted a bank sync yet."
        : null;
  return note === null ? "" : `<section><p class="meta">${note}</p></section>`;
};

const fillSlot = (template: string, slot: string, content: string): string => {
  const marker = `<!--wrap:${slot}-->`;
  if (template.split(marker).length !== 2) throw new Error(`The report template needs exactly one ${marker}.`);
  return template.replace(marker, () => content);
};

export const renderReport = (template: string, collected: Collected, text: AgentText): string => {
  if (template.split("__METRICS_VERSION__").length !== 2) throw new Error("The report template needs exactly one __METRICS_VERSION__.");
  let html = template.replace("__METRICS_VERSION__", String(METRICS_VERSION));
  html = fillSlot(html, "summary", text.summary.map((paragraph) => `<p class="summary">${escapeHtml(paragraph)}</p>`).join(""));
  html = fillSlot(html, "alerts", renderAlerts(collected.reportInputs));
  html = fillSlot(html, "tiles", renderTiles(collected.reportInputs));
  html = fillSlot(
    html,
    "timeline",
    renderTimeline(
      collected,
      text.parts.map((part) => part.title),
      text.threadNames,
    ),
  );
  html = fillSlot(html, "parts", renderParts(collected, text));
  html = fillSlot(html, "looseends", renderLooseEnds(collected.reportInputs));
  html = fillSlot(html, "facts", renderFacts(collected.reportInputs));
  html = fillSlot(html, "lists", renderLists(collected.reportInputs));
  return fillSlot(html, "notes", renderNotes(collected.reportInputs));
};

export const loadTemplate = (): Promise<string> => Bun.file(TEMPLATE_URL).text();

/** The stdin of `postlude agent-area put <day>`. */
export const agentAreaPayload = (collected: Collected, reportHtml: string, model: string) => ({
  dayMetrics: collected.dayMetrics,
  metricsVersion: collected.dayMetrics.metricsVersion,
  reportHtml,
  reportModel: modelDisplayName(model),
});
