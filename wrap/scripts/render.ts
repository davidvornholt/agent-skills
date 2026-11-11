// The agent's text carries no counts or durations: the template reads the day's figures from Postlude's message, and the times, minutes and counts this script prints come from the collected data, never from the agent. A part's text may name clock times within the part, which render checks against the collected data.

import { compareText } from "./compare.ts";
import { toBerlinClock } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { clockRange, escapeHtml, minutesText } from "./html.ts";
import { METRICS_VERSION } from "./metrics.ts";
import { renderTimeline } from "./render-timeline.ts";
import { type List, median, type ReportInputs } from "./report-inputs.ts";
import { type DayPart, projectLabel } from "./timeline.ts";

// Short sentences and short paragraphs, so the report reads easily for someone without the background.
export const SENTENCE_MAX_WORDS = 25;
export const SUMMARY_MAX_WORDS = 60;
export const PART_TEXT_MAX_WORDS = 90;
export const PART_TITLE_MAX_LENGTH = 60;
/** Open pull requests listed one by one in the loose ends; more collapse into one entry. */
export const WAITING_PRS_LISTED = 3;

const TEMPLATE_URL = new URL("../report/template.html", import.meta.url);

export type AgentPart = { readonly title: string; readonly text: string };

/** What the agent writes: a summary of the day, and a title and a paragraph per part, in order. */
export type AgentText = { readonly summary: string; readonly parts: readonly AgentPart[] };

const TEXT_SHAPE = '{"summary": "...", "parts": [{"title": "...", "text": "..."}, ...]}';
const CLOCK = /\b([01]\d|2[0-3]):([0-5]\d)\b/g;
// "#12", "name#12" or "owner/name#12", not inside a longer word or path.
const REF = /(?<![\w./-])(?:(?:[\w.-]+\/)?[\w.-]+)?#\d+(?!\w)/;

const cleanText = (name: string, text: unknown): string => {
  if (typeof text !== "string") throw new Error(`The ${name} is not a string.`);
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length === 0) throw new Error(`The ${name} is empty.`);
  const ref = REF.exec(clean);
  if (ref !== null)
    throw new Error(
      `The ${name} names a pull request by its number, ${ref[0]}. The reader doesn't know the numbers, so say in everyday words what it changed.`,
    );
  return clean;
};

const words = (text: string): number => text.split(" ").filter((word) => /[\p{L}\p{Nd}]/u.test(word)).length;

/** Checks that the text is whole sentences, none longer than SENTENCE_MAX_WORDS, and at most maxWords words in all. */
const checkSentences = (name: string, text: string, maxWords: number): void => {
  if (!/[.!?…]["'”’)]?$/u.test(text)) throw new Error(`The ${name} doesn't end a sentence. Write whole sentences, not a list or fragments.`);
  const total = words(text);
  if (total > maxWords) throw new Error(`The ${name} has ${total} words; the limit is ${maxWords}. Leave out what matters least.`);
  for (const [index, sentence] of text.split(/(?<=[.!?…]["'”’)]?)\s+/u).entries()) {
    const count = words(sentence);
    if (count > SENTENCE_MAX_WORDS)
      throw new Error(`Sentence ${index + 1} of the ${name} has ${count} words; the limit is ${SENTENCE_MAX_WORDS}. Split it into shorter sentences.`);
  }
};

const NO_DIGITS = "The report prints every count and duration from the collected data, so describe them without numbers.";

const checkNoDigits = (name: string, text: string): void => {
  if (/\p{Nd}/u.test(text)) throw new Error(`The ${name} contains digits. ${NO_DIGITS}`);
};

/** Minutes since the journal day began at 04:00, for a clock time. */
const journalMinute = (hour: number, minute: number): number => (hour * 60 + minute - 4 * 60 + 24 * 60) % (24 * 60);

const clockMinute = (ms: number): number => {
  const [hour = 0, minute = 0] = toBerlinClock(ms).split(":").map(Number);
  return journalMinute(hour, minute);
};

/** Checks a part's text: clock times must fall within the part; no other digits. */
const checkPartText = (name: string, text: string, part: DayPart): void => {
  const first = clockMinute(Date.parse(part.start));
  const last = clockMinute(Date.parse(part.end));
  // A part that ends at 04:00 ends at the end of the journal day.
  const end = last < first ? 24 * 60 : last;
  for (const match of text.matchAll(CLOCK)) {
    const minute = journalMinute(Number(match[1]), Number(match[2]));
    // 04:00 is both the start and the end of the journal day.
    const inPart = (minute >= first && minute <= end) || minute + 24 * 60 === end;
    if (!inPart) throw new Error(`The ${name} mentions ${match[0]}, but the part runs ${part.clock}. Use only times within the part.`);
  }
  if (/\p{Nd}/u.test(text.replace(CLOCK, ""))) throw new Error(`The ${name} contains digits other than HH:MM times. ${NO_DIGITS}`);
};

const checkPart = (part: unknown, index: number, dayPart: DayPart): AgentPart => {
  const { title, text } = (typeof part === "object" && part !== null ? part : {}) as { title?: unknown; text?: unknown };
  const label = `part ${index + 1}`;
  if (typeof title !== "string" || typeof text !== "string") throw new Error(`The ${label} needs a title and a text, as ${TEXT_SHAPE}.`);
  const cleanTitle = cleanText(`title of ${label}`, title);
  if (cleanTitle.length > PART_TITLE_MAX_LENGTH)
    throw new Error(`The title of ${label} has ${cleanTitle.length} characters; the limit is ${PART_TITLE_MAX_LENGTH}.`);
  checkNoDigits(`title of ${label}`, cleanTitle);
  const cleanBody = cleanText(`text of ${label}`, text);
  checkSentences(`text of ${label}`, cleanBody, PART_TEXT_MAX_WORDS);
  checkPartText(`text of ${label}`, cleanBody, dayPart);
  return { title: cleanTitle, text: cleanBody };
};

/** Reads the agent's JSON from stdin and checks it against the collected day. */
export const parseAgentText = (raw: string, collected: Collected): AgentText => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`The report text is not JSON. Pipe ${TEXT_SHAPE}.`);
  }
  if (typeof value !== "object" || value === null) throw new Error("The report text is not a JSON object.");
  const { summary, parts } = value as { summary?: unknown; parts?: unknown };
  if (!Array.isArray(parts)) throw new Error("The report text has no parts list.");
  const dayParts = collected.reportInputs.parts;
  if (parts.length !== dayParts.length)
    throw new Error(
      `The report text has ${parts.length} parts, but the day has ${dayParts.length}. Write one entry per entry of reportInputs.parts, in order.`,
    );
  const clean = cleanText("summary", summary);
  checkSentences("summary", clean, SUMMARY_MAX_WORDS);
  checkNoDigits("summary", clean);
  return { summary: clean, parts: dayParts.map((dayPart, index) => checkPart(parts[index], index, dayPart)) };
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
    const own = text.parts[index] ?? { title: "", text: "" };
    return `<li class="arc"><h3><span class="no">${index + 1}</span><span>${escapeHtml(own.title)}</span><span class="when">${part.clock}</span></h3><p>${escapeHtml(own.text)}</p></li>`;
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
  const focus = inputs.facts.focus;
  if (focus === null || focus.longest === null) return [];
  const { longest } = focus;
  return [
    `${count(focus.blocks, "focus block", "focus blocks")}; the longest was ${minutesText(longest.minutes)} on ${longest.area}, ${clockRange(Date.parse(longest.start), Date.parse(longest.end))}.`,
  ];
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
  html = fillSlot(html, "summary", `<p class="summary">${escapeHtml(text.summary)}</p>`);
  html = fillSlot(html, "alerts", renderAlerts(collected.reportInputs));
  html = fillSlot(html, "tiles", renderTiles(collected.reportInputs));
  html = fillSlot(
    html,
    "timeline",
    renderTimeline(
      collected,
      text.parts.map((part) => part.title),
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
