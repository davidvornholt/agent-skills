// The HTML carries no numbers of its own: the template reads them from Postlude's message (PLAN.md Contract 5).

import type { Collected } from "./day-report.ts";
import { METRICS_VERSION } from "./metrics.ts";
import type { List, ReportInputs } from "./report-inputs.ts";

export const SUMMARY_MAX_LENGTH = 600;

const TEMPLATE_URL = new URL("../report/template.html", import.meta.url);

export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);

/** The summary may not contain digits, because the report's numbers come only from the day metrics. */
export const checkSummary = (text: string): string => {
  const summary = text.trim().replace(/\s+/g, " ");
  if (summary.length === 0) throw new Error("The summary is empty.");
  if (summary.length > SUMMARY_MAX_LENGTH) throw new Error(`The summary has ${summary.length} characters; the limit is ${SUMMARY_MAX_LENGTH}.`);
  if (/\p{Nd}/u.test(summary))
    throw new Error("The summary contains digits. The report shows numbers only from the day metrics, so describe the day without them.");
  return summary;
};

const listSection = <T>(title: string, list: List<T>, empty: string, item: (entry: T) => string): string => {
  const body =
    list.status === "missing"
      ? `<p class="empty">Not available.</p>`
      : list.items.length === 0
        ? `<p class="empty">${empty}</p>`
        : `<ul class="items">${list.items.map((entry) => `<li>${item(entry)}</li>`).join("")}</ul>`;
  const partial = list.status === "partial" ? `<p class="meta">Some sources were not available, so this list may be incomplete.</p>` : "";
  return `<section><h2>${escapeHtml(title)}</h2>${body}${partial}</section>`;
};

const withMeta = (title: string, meta: string | null): string =>
  meta === null || meta === "" ? escapeHtml(title) : `${escapeHtml(title)} <span class="meta">· ${escapeHtml(meta)}</span>`;

const renderLists = (inputs: ReportInputs): string =>
  [
    listSection("Appointments", inputs.appointments, "No appointments.", (event) =>
      event.time === null ? `<span class="time">All day</span>${escapeHtml(event.title)}` : escapeHtml(event.title),
    ),
    listSection("Tasks checked off", inputs.handedOffTasks, "No tasks checked off.", (task) => withMeta(task.title, task.project)),
    listSection("Threads settled", inputs.settledThreads, "No threads settled.", (thread) => withMeta(thread.title, thread.project)),
    listSection("Pull requests landed", inputs.landedPrs, "No pull requests landed.", (pr) => withMeta(pr.title, pr.repository)),
    listSection("Threads open for several days", inputs.openThreads, "No thread has been open for several days.", (thread) =>
      withMeta(thread.title, thread.project),
    ),
  ].join("\n  ");

const renderAlerts = (inputs: ReportInputs): string =>
  inputs.kontor.approvalNeeded === true
    ? `<div class="alert" role="status"><span class="alert-icon" aria-hidden="true">!</span><p>Kontor needs a new approval for the bank connection.</p></div>`
    : "";

const renderNotes = (inputs: ReportInputs): string => (inputs.kontor.status === "missing" ? `<p class="meta">Kontor's bank status was not available.</p>` : "");

const fillSlot = (template: string, slot: string, content: string): string => {
  const marker = `<!--wrap:${slot}-->`;
  if (template.split(marker).length !== 2) throw new Error(`The report template needs exactly one ${marker}.`);
  return template.replace(marker, () => content);
};

export const renderReport = (template: string, collected: Collected, summary: string): string => {
  if (template.split("__METRICS_VERSION__").length !== 2) throw new Error("The report template needs exactly one __METRICS_VERSION__.");
  let html = template.replace("__METRICS_VERSION__", String(METRICS_VERSION));
  html = fillSlot(html, "summary", `<p class="summary">${escapeHtml(checkSummary(summary))}</p>`);
  html = fillSlot(html, "alerts", renderAlerts(collected.reportInputs));
  html = fillSlot(html, "lists", renderLists(collected.reportInputs));
  return fillSlot(html, "notes", renderNotes(collected.reportInputs));
};

export const loadTemplate = (): Promise<string> => Bun.file(TEMPLATE_URL).text();

/** The stdin of `postlude agent-area put <day>` (PLAN.md Contract 3). */
export const agentAreaPayload = (collected: Collected, reportHtml: string, model: string) => ({
  dayMetrics: collected.dayMetrics,
  metricsVersion: collected.dayMetrics.metricsVersion,
  reportHtml,
  reportModel: model,
});
