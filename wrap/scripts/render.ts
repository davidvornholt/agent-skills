// The agent's text carries no numbers: the template reads the day's figures from Postlude's message (PLAN.md Contract 5), and the times and minutes this script prints come from the collected data, never from the agent.

import { compareText } from "./compare.ts";
import { toBerlinClock } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { clockRange, escapeHtml } from "./html.ts";
import { METRICS_VERSION } from "./metrics.ts";
import { renderTimeline } from "./render-timeline.ts";
import type { List, ReportInputs } from "./report-inputs.ts";
import { projectLabel } from "./timeline.ts";

export const SUMMARY_MAX_LENGTH = 600;
export const PART_MAX_LENGTH = 900;
/** Postlude's limit for the day log. */
export const DAY_LOG_MAX_LENGTH = 20_000;

const TEMPLATE_URL = new URL("../report/template.html", import.meta.url);

/** What the agent writes: a summary of the day and one paragraph per part, in order. */
export type AgentText = { readonly summary: string; readonly parts: readonly string[] };

const checkText = (name: string, text: unknown, limit: number): string => {
  if (typeof text !== "string") throw new Error(`The ${name} is not a string.`);
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length === 0) throw new Error(`The ${name} is empty.`);
  if (clean.length > limit) throw new Error(`The ${name} has ${clean.length} characters; the limit is ${limit}.`);
  if (/\p{Nd}/u.test(clean))
    throw new Error(`The ${name} contains digits. The report prints every number and time from the collected data, so describe the day without them.`);
  return clean;
};

/** Reads the agent's JSON from stdin and checks it against the collected day. */
export const parseAgentText = (raw: string, collected: Collected): AgentText => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('The report text is not JSON. Pipe {"summary": "...", "parts": ["...", ...]}.');
  }
  if (typeof value !== "object" || value === null) throw new Error("The report text is not a JSON object.");
  const { summary, parts } = value as { summary?: unknown; parts?: unknown };
  if (!Array.isArray(parts)) throw new Error("The report text has no parts list.");
  const expected = collected.reportInputs.parts.length;
  if (parts.length !== expected)
    throw new Error(`The report text has ${parts.length} parts, but the day has ${expected}. Write one paragraph per entry of reportInputs.parts, in order.`);
  return {
    summary: checkText("summary", summary, SUMMARY_MAX_LENGTH),
    parts: parts.map((part, index) => checkText(`paragraph of part ${index + 1}`, part, PART_MAX_LENGTH)),
  };
};

/** The plain text Postlude stores and searches: the summary, then each part's paragraph after its time range. */
export const dayLog = (collected: Collected, text: AgentText): string => {
  const log = [text.summary, ...collected.reportInputs.parts.map((part, index) => `${part.clock} ${text.parts[index]}`)].join("\n\n");
  if (log.length > DAY_LOG_MAX_LENGTH) throw new Error(`The day log has ${log.length} characters; Postlude's limit is ${DAY_LOG_MAX_LENGTH}.`);
  return log;
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
          (pr) => `<span class="time">${toBerlinClock(Date.parse(pr.mergedAt))}</span>${escapeHtml(pr.title)}`,
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
  const items = parts.map((part, index) => `<li><p class="part-time">${part.clock}</p><p>${escapeHtml(text.parts[index] ?? "")}</p></li>`);
  return `<section><h2>The day in parts</h2><ol class="parts">${items.join("")}</ol></section>`;
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
  html = fillSlot(html, "timeline", renderTimeline(collected));
  html = fillSlot(html, "parts", renderParts(collected, text));
  html = fillSlot(html, "lists", renderLists(collected.reportInputs));
  return fillSlot(html, "notes", renderNotes(collected.reportInputs));
};

export const loadTemplate = (): Promise<string> => Bun.file(TEMPLATE_URL).text();

/** The stdin of `postlude agent-area put <day>` (PLAN.md Contract 3). */
export const agentAreaPayload = (collected: Collected, reportHtml: string, log: string, model: string) => ({
  dayMetrics: collected.dayMetrics,
  metricsVersion: collected.dayMetrics.metricsVersion,
  reportHtml,
  reportModel: modelDisplayName(model),
  dayLog: log,
});
