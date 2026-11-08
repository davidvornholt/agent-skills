import { describe, expect, test } from "bun:test";
import { buildCollected, type Collected } from "./day-report.ts";
import { METRICS_VERSION } from "./metrics.ts";
import { agentAreaPayload, checkSummary, escapeHtml, loadTemplate, renderReport, SUMMARY_MAX_LENGTH } from "./render.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";

const template = await loadTemplate();
const collected = buildCollected(WINDOW, sources);
const SUMMARY = "A quiet day of reviews and garden work.";

const visibleText = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ");

describe("checkSummary", () => {
  test("collapses whitespace", () => {
    expect(checkSummary("  A calm day.\n\nMostly code.  ")).toBe("A calm day. Mostly code.");
  });

  test("rejects digits in any script, empty text, and long text", () => {
    expect(() => checkSummary("Three meetings and 2 reviews.")).toThrow(/digits/);
    expect(() => checkSummary("Meetings: ٣")).toThrow(/digits/);
    expect(() => checkSummary(" \n ")).toThrow(/empty/);
    expect(() => checkSummary("a".repeat(SUMMARY_MAX_LENGTH + 1))).toThrow(/limit/);
  });
});

describe("renderReport", () => {
  const html = renderReport(template, collected, SUMMARY);

  test("keeps the content security policy and fills every slot", () => {
    expect(html).toContain(`content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"`);
    expect(html).toContain(`const METRICS_VERSION = ${METRICS_VERSION};`);
    expect(html).not.toContain("__METRICS_VERSION__");
    expect(html).not.toMatch(/<!--wrap:/);
    expect(html).toContain(`<p class="summary">${SUMMARY}</p>`);
  });

  test("loads nothing from the network", () => {
    expect(html).not.toMatch(/\b(src|href)\s*=|@import|url\(|fetch\(|XMLHttpRequest|WebSocket/);
  });

  test("shows no number that doesn't come from the day metrics", () => {
    const text = visibleText(html);
    expect(text).toContain("Standup");
    expect(text).toContain("Long open");
    expect(text).not.toMatch(/\p{Nd}/u);
    const notice = html.match(/notice\.textContent = (.+);/)?.[1];
    expect(notice).toBeDefined();
    expect(notice).not.toMatch(/\$\{|\p{Nd}/u);
  });

  test("escapes titles from the sources", () => {
    const inputs = {
      ...collected.reportInputs,
      landedPrs: { status: "complete" as const, items: [{ repository: "a/b", title: `<img src=x onerror="alert(1)">` }] },
    };
    const escaped = renderReport(template, { ...collected, reportInputs: inputs }, SUMMARY);
    expect(escaped).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(escaped).not.toContain("<img");
  });

  test("lists each section and explains missing and partial lists", () => {
    expect(html).toContain('<li><span class="time">All day</span>Holiday</li><li>Standup</li><li>Review</li>');
    expect(html).toContain('Garden › Dig <span class="meta">· Home</span>');
    expect(html).toContain('<li>Long open <span class="meta">· dev</span></li>');
    expect(html).toContain("Kontor's bank status was not available.");
    const gaps = renderReport(
      template,
      {
        ...collected,
        reportInputs: { ...collected.reportInputs, landedPrs: { status: "missing", items: [] }, appointments: { status: "partial", items: [] } },
      },
      SUMMARY,
    );
    expect(gaps).toContain('<h2>Pull requests landed</h2><p class="empty">Not available.</p>');
    expect(gaps).toContain('<h2>Appointments</h2><p class="empty">No appointments.</p><p class="meta">Some sources were not available');
  });

  test("shows the Kontor alert only when approval is needed after a sync", () => {
    expect(html).not.toContain('class="alert"');
    const withKontor = (kontor: Collected["reportInputs"]["kontor"]) =>
      renderReport(template, { ...collected, reportInputs: { ...collected.reportInputs, kontor } }, SUMMARY);
    const alert = withKontor({ status: "complete", synced: true, approvalNeeded: true });
    expect(alert).toContain("Kontor needs a new approval for the bank connection.");
    expect(alert).not.toContain("Kontor's bank status was not available.");
    expect(alert).not.toContain("Kontor has not synced with the bank yet.");
    const fine = withKontor({ status: "complete", synced: true, approvalNeeded: false });
    expect(fine).not.toContain('class="alert"');
    expect(fine).not.toContain("Kontor");
  });

  test("says that Kontor has not synced yet instead of asking for an approval", () => {
    const neverSynced = renderReport(
      template,
      { ...collected, reportInputs: { ...collected.reportInputs, kontor: { status: "complete", synced: false, approvalNeeded: true } } },
      SUMMARY,
    );
    expect(neverSynced).not.toContain('class="alert"');
    expect(neverSynced).toContain("Kontor has not synced with the bank yet.");
    expect(neverSynced).not.toContain("Kontor's bank status was not available.");
  });

  test("refuses a template without its slots", () => {
    expect(() => renderReport(template.replace("<!--wrap:lists-->", ""), collected, SUMMARY)).toThrow(/<!--wrap:lists-->/);
    expect(() => renderReport(`${template}<!--wrap:notes-->`, collected, SUMMARY)).toThrow(/exactly one <!--wrap:notes-->/);
  });
});

test("the agent area payload carries the metrics, the report, and the model", () => {
  const payload = agentAreaPayload(collected, "<html></html>", "claude-opus-5-5");
  expect(Object.keys(payload).toSorted()).toEqual(["dayMetrics", "metricsVersion", "reportHtml", "reportModel"]);
  expect(payload.metricsVersion).toBe(collected.dayMetrics.metricsVersion);
  expect(payload.dayMetrics).toBe(collected.dayMetrics);
});

test("escapeHtml escapes every markup character", () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
