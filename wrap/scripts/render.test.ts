import { describe, expect, test } from "bun:test";
import { buildCollected, type Collected } from "./day-report.ts";
import { escapeHtml } from "./html.ts";
import { METRICS_VERSION } from "./metrics.ts";
import {
  type AgentText,
  agentAreaPayload,
  DAY_LOG_MAX_LENGTH,
  dayLog,
  loadTemplate,
  modelDisplayName,
  parseAgentText,
  renderReport,
  SUMMARY_MAX_LENGTH,
} from "./render.ts";
import { MARK_GAP_MINUTES, renderTimeline, TIMELINE_PROJECTS } from "./render-timeline.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";

const template = await loadTemplate();
const collected = buildCollected(WINDOW, sources);
const TEXT: AgentText = {
  summary: "A quiet day of reviews and garden work.",
  parts: ["The morning went to the parser.", "The afternoon went to tidying tests."],
};
const at = (iso: string) => Date.parse(iso);

describe("parseAgentText", () => {
  const parse = (value: unknown) => parseAgentText(typeof value === "string" ? value : JSON.stringify(value), collected);

  test("reads the summary and one paragraph per part", () => {
    expect(parse({ summary: " A calm day. ", parts: ["Morning.", "Afternoon\n work."] })).toEqual({
      summary: "A calm day.",
      parts: ["Morning.", "Afternoon work."],
    });
  });

  test("refuses text that isn't the expected JSON", () => {
    expect(() => parse("A calm day.")).toThrow(/not JSON/);
    expect(() => parse({ summary: "A calm day." })).toThrow(/no parts list/);
    expect(() => parse({ summary: "A calm day.", parts: ["Only one."] })).toThrow(/has 1 parts, but the day has 2/);
    expect(() => parse({ summary: "A calm day.", parts: ["Morning.", 3] })).toThrow(/part 2 is not a string/);
  });

  test("refuses empty and long text", () => {
    expect(() => parse({ summary: " \n ", parts: ["Morning.", "Afternoon."] })).toThrow(/summary is empty/);
    expect(() => parse({ summary: "a".repeat(SUMMARY_MAX_LENGTH + 1), parts: ["Morning.", "Afternoon."] })).toThrow(/limit/);
  });

  test("refuses digits in any script, because the report prints every number and time itself", () => {
    expect(() => parse({ summary: "Three meetings and 2 reviews.", parts: ["Morning.", "Afternoon."] })).toThrow(/summary contains digits/);
    expect(() => parse({ summary: "Meetings: ٣", parts: ["Morning.", "Afternoon."] })).toThrow(/digits/);
    expect(() => parse({ summary: "A calm day.", parts: ["Morning.", "From noon on."] })).not.toThrow();
    expect(() => parse({ summary: "A calm day.", parts: ["Morning.", "From 13:00 on."] })).toThrow(/part 2 contains digits/);
  });
});

describe("renderReport", () => {
  const html = renderReport(template, collected, TEXT);

  test("keeps the content security policy and fills every slot", () => {
    expect(html).toContain(`content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"`);
    expect(html).toContain(`const METRICS_VERSION = ${METRICS_VERSION};`);
    expect(html).not.toContain("__METRICS_VERSION__");
    expect(html).not.toMatch(/<!--wrap:/);
    expect(html).toContain(`<p class="summary">${TEXT.summary}</p>`);
  });

  test("loads nothing from the network", () => {
    expect(html).not.toMatch(/\b(src|href)\s*=|@import|url\(|fetch\(|XMLHttpRequest|WebSocket/);
  });

  test("keeps numbers out of the version notice, which the template writes itself", () => {
    const notice = html.match(/notice\.textContent = (.+);/)?.[1];
    expect(notice).toBeDefined();
    expect(notice).not.toMatch(/\$\{|\p{Nd}/u);
  });

  test("shows each part's paragraph under its time range", () => {
    expect(html).toContain(
      '<h2>The day in parts</h2><ol class="parts"><li><p class="part-time">04:00–13:00</p><p>The morning went to the parser.</p></li><li><p class="part-time">13:00–04:00</p>',
    );
  });

  test("leaves out the parts section on a day without parts", () => {
    const noParts = { ...collected, reportInputs: { ...collected.reportInputs, parts: [] } };
    expect(renderReport(template, noParts, { summary: TEXT.summary, parts: [] })).not.toContain("The day in parts");
  });

  test("escapes titles from the sources", () => {
    const title = `<img src=x onerror="alert(1)">`;
    const inputs = {
      ...collected.reportInputs,
      landedPrs: { status: "complete" as const, items: [{ repository: "a/b", title, mergedAt: "2026-10-29T10:00:00+01:00", part: 0 }] },
    };
    const escaped = renderReport(template, { ...collected, reportInputs: inputs }, TEXT);
    expect(escaped).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(escaped).not.toContain("<img");
  });

  test("lists appointments with their times, and the open threads", () => {
    expect(html).toContain(
      '<li><span class="time">All day</span>Holiday</li><li><span class="time">10:00–11:00</span>Standup</li><li><span class="time">10:30–11:30</span>Review</li>',
    );
    expect(html).toContain('<li>Long open <span class="meta">· dev, since 2026-10-25</span></li>');
    expect(html).toContain("Kontor's bank status was not available.");
  });

  test("leaves the checked-off tasks and settled threads to the agent's paragraphs", () => {
    expect(html).not.toContain("Tasks checked off");
    expect(html).not.toContain("Threads settled");
    expect(html).not.toContain("Settled today");
  });

  test("collapses the landed pull requests, grouped by repository", () => {
    expect(html).toContain(
      '<details class="prs"><summary><h2>Pull requests landed</h2><span class="meta">postlude 1 · sp-cli 1</span></summary><h3>postlude <span class="meta">· 1</span></h3><ul class="items"><li><span class="time">04:00</span>Start of day</li></ul>',
    );
  });

  test("explains missing and partial lists", () => {
    const gaps = renderReport(
      template,
      {
        ...collected,
        reportInputs: { ...collected.reportInputs, landedPrs: { status: "missing", items: [] }, appointments: { status: "partial", items: [] } },
      },
      TEXT,
    );
    expect(gaps).toContain('<h2>Pull requests landed</h2><p class="empty">Not available.</p>');
    expect(gaps).toContain('<h2>Appointments</h2><p class="empty">No appointments.</p><p class="meta">Some sources were not available');
    const partialPrs = renderReport(
      template,
      { ...collected, reportInputs: { ...collected.reportInputs, landedPrs: { ...collected.reportInputs.landedPrs, status: "partial" } } },
      TEXT,
    );
    expect(partialPrs).toContain('Start of day</li></ul><h3>sp-cli <span class="meta">· 1</span></h3>');
    expect(partialPrs).toContain('Afternoon</li></ul><p class="meta">Some sources were not available');
  });

  test("shows the Kontor alert only when approval is needed after an attempt", () => {
    expect(html).not.toContain('class="alert"');
    const withKontor = (kontor: Collected["reportInputs"]["kontor"]) =>
      renderReport(template, { ...collected, reportInputs: { ...collected.reportInputs, kontor } }, TEXT);
    const alert = withKontor({ status: "complete", attempted: true, approvalNeeded: true });
    expect(alert).toContain("Kontor needs a new approval for the bank connection.");
    expect(alert).not.toContain("Kontor's bank status was not available.");
    expect(alert).not.toContain("Kontor has not attempted a bank sync yet.");
    const fine = withKontor({ status: "complete", attempted: true, approvalNeeded: false });
    expect(fine).not.toContain('class="alert"');
    expect(fine).not.toContain("Kontor");
  });

  // `kontor status --json` before anyone ran a sync or login, and after a first login that stopped at an unanswered approval.
  const fromKontorStatus = (status: object) => renderReport(template, buildCollected(WINDOW, { ...sources, kontor: { ok: true, value: status } }), TEXT);

  test("notes a Kontor that has never attempted a sync instead of asking for an approval", () => {
    const neverAttempted = fromKontorStatus({
      lastSyncAt: null,
      approvalExpiresAt: null,
      daysLeft: 0,
      approvalNeeded: true,
      reason: "never-approved",
      lastSyncOutcome: null,
    });
    expect(neverAttempted).not.toContain('class="alert"');
    expect(neverAttempted).toContain("Kontor has not attempted a bank sync yet.");
    expect(neverAttempted).not.toContain("Kontor's bank status was not available.");
  });

  test("asks for an approval after an attempt that never completed a sync", () => {
    const incomplete = fromKontorStatus({
      lastSyncAt: null,
      approvalExpiresAt: "2027-02-06T10:00:00.000Z",
      daysLeft: 0,
      approvalNeeded: true,
      reason: "bank-asked",
      lastSyncOutcome: "approval_required",
    });
    expect(incomplete).toContain("Kontor needs a new approval for the bank connection.");
    expect(incomplete).not.toContain("Kontor has not attempted a bank sync yet.");
    expect(incomplete).not.toContain("Kontor's bank status was not available.");
  });

  test("refuses a template without its slots", () => {
    expect(() => renderReport(template.replace("<!--wrap:lists-->", ""), collected, TEXT)).toThrow(/<!--wrap:lists-->/);
    expect(() => renderReport(`${template}<!--wrap:notes-->`, collected, TEXT)).toThrow(/exactly one <!--wrap:notes-->/);
    expect(() => renderReport(template.replace("<!--wrap:timeline-->", ""), collected, TEXT)).toThrow(/<!--wrap:timeline-->/);
  });
});

describe("renderTimeline", () => {
  const html = renderTimeline(collected);
  const withTimeline = (changes: Partial<Collected["timeline"]>, inputs: Partial<Collected["reportInputs"]> = {}): Collected => ({
    ...collected,
    timeline: { ...collected.timeline, ...changes },
    reportInputs: { ...collected.reportInputs, ...inputs },
  });
  const quiet = { appointments: { status: "complete" as const, items: [] }, landedPrs: { status: "complete" as const, items: [] } };

  test("draws a row per area, per T3 project, for the calendar, and for pull requests", () => {
    const labels = [...html.matchAll(/<span class="tl-label">([^<]*)<\/span>/g)].map((match) => match[1]);
    expect(labels).toEqual(["Code", "Admin", "Mail", "Not categorised", "postlude", "sp-cli", "nix-config", "Calendar", "Pull requests"]);
    expect(html).toContain('role="img"');
  });

  test("places marks in percent of whole hours from the first to the last mark", () => {
    const pieces = [{ start: at("2026-10-29T09:00:00+01:00"), end: at("2026-10-29T09:30:00+01:00"), category: "code", project: null }];
    const drawn = renderTimeline(withTimeline({ pieces, focusBlocks: [], agentRuns: { status: "complete", items: [] } }, quiet));
    expect(drawn).toContain("--hours:1");
    expect(drawn).toContain('<span class="tl-mark tl-screen" style="left:0%;width:50%" data-tip="Code · 09:00–09:30 (30 min)"></span>');
    expect(drawn).toContain('<span style="left:0%">09:00</span>');
  });

  test(`joins a row's screen time across gaps shorter than ${MARK_GAP_MINUTES} minutes, and counts only the screen time`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    // Forty pieces of half a minute, one minute apart.
    const short = Array.from({ length: 40 }, (_, index) => ({ start: nine + index * 90_000, end: nine + index * 90_000 + 30_000 }));
    // Begins exactly that gap after the last short piece ends, so it stays a mark of its own.
    const apart = { start: at("2026-10-29T09:59:00+01:00") + MARK_GAP_MINUTES * 60_000, end: at("2026-10-29T10:05:00+01:00") };
    const pieces = [...short, apart].map((piece) => ({ ...piece, category: "code", project: "~/dev/postlude" }));
    const drawn = renderTimeline(withTimeline({ pieces, focusBlocks: [], agentRuns: { status: "complete", items: [] } }, quiet));
    const tips = [...drawn.matchAll(/class="tl-mark tl-screen" style="[^"]*" data-tip="([^"]*)"/g)].map((match) => match[1]);
    expect(tips).toEqual([
      "Code · 09:00–09:59 (20 min)",
      "Code · 10:01–10:05 (4 min)",
      "You in postlude · 09:00–09:59 (20 min)",
      "You in postlude · 10:01–10:05 (4 min)",
    ]);
  });

  test("names at most three threads in an agent tooltip and counts the rest", () => {
    const runs = ["One", "Two", "Three", "Four", "Five"].map((threadTitle) => ({
      start: at("2026-10-29T09:00:00+01:00"),
      end: at("2026-10-29T10:00:00+01:00"),
      project: "~/dev/postlude",
      threadTitle,
    }));
    const drawn = renderTimeline(withTimeline({ pieces: [], focusBlocks: [], agentRuns: { status: "complete", items: runs } }, quiet));
    expect(drawn).toContain('data-tip="Agents · 09:00–10:00 (1 h) · One; Two; Three; and 2 more"');
  });

  test(`draws the ${TIMELINE_PROJECTS} busiest projects and the rest in one row`, () => {
    const runs = Array.from({ length: TIMELINE_PROJECTS + 2 }, (_, index) => ({
      start: at("2026-10-29T09:00:00+01:00"),
      end: at("2026-10-29T09:00:00+01:00") + (index + 1) * 60_000,
      project: `~/dev/project-${String.fromCharCode(97 + index)}`,
      threadTitle: "A thread",
    }));
    const drawn = renderTimeline(withTimeline({ pieces: [], focusBlocks: [], agentRuns: { status: "complete", items: runs } }, quiet));
    const labels = [...drawn.matchAll(/<span class="tl-label">([^<]*)<\/span>/g)].map((match) => match[1]);
    expect(labels).toEqual(["project-h", "project-g", "project-f", "project-e", "project-d", "project-c", "Other projects"]);
  });

  test("escapes titles in tooltips", () => {
    const runs = [{ start: at("2026-10-29T09:00:00+01:00"), end: at("2026-10-29T10:00:00+01:00"), project: "~/dev/x", threadTitle: `"><script>` }];
    const drawn = renderTimeline(withTimeline({ pieces: [], focusBlocks: [], agentRuns: { status: "complete", items: runs } }, quiet));
    expect(drawn).toContain("&quot;&gt;&lt;script&gt;");
    expect(drawn).not.toContain("<script>");
  });

  test("lists the time tracked away from the computer", () => {
    expect(html).toContain('<h3>Tracked away from the computer</h3><ul class="items"><li>Write tests <span class="meta">· Work · 50 min</span></li>');
  });

  test("says what is missing, also on a day with nothing to draw", () => {
    const missing = renderTimeline(withTimeline({ status: "missing", pieces: [], focusBlocks: [], agentRuns: { status: "missing", items: [] } }, quiet));
    expect(missing).toContain('<p class="empty">Nothing recorded.</p>');
    expect(missing).toContain("Screen activity was not available.");
    expect(missing).toContain("T3 Code was not available, so agent work is missing.");
    const partial = renderTimeline(withTimeline({ status: "partial" }));
    expect(partial).toContain("some screen time may be missing");
  });
});

describe("dayLog", () => {
  test("puts the summary first and each paragraph after its part's time range", () => {
    expect(dayLog(collected, TEXT)).toBe(
      "A quiet day of reviews and garden work.\n\n04:00–13:00 The morning went to the parser.\n\n13:00–04:00 The afternoon went to tidying tests.",
    );
  });

  test("refuses a log longer than Postlude stores", () => {
    const long = { summary: TEXT.summary, parts: ["a".repeat(DAY_LOG_MAX_LENGTH), "b"] };
    expect(() => dayLog(collected, long)).toThrow(/limit/);
  });
});

test("modelDisplayName writes model IDs as people say them", () => {
  expect(modelDisplayName("claude-opus-5-5")).toBe("Claude Opus 5.5");
  expect(modelDisplayName("claude-opus-5-5[1m]")).toBe("Claude Opus 5.5");
  expect(modelDisplayName("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
  expect(modelDisplayName("claude-sonnet-4-20250514")).toBe("Claude Sonnet 4");
  expect(modelDisplayName("gpt-6-astra")).toBe("GPT-6 Astra");
  expect(modelDisplayName("gpt-5.1-codex-max")).toBe("GPT-5.1 Codex Max");
  expect(modelDisplayName("gpt-5")).toBe("GPT-5");
  expect(modelDisplayName("claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet-20241022");
  expect(modelDisplayName("local-model")).toBe("local-model");
});

test("the agent area payload carries the metrics, the report, the day log, and the model's name", () => {
  const payload = agentAreaPayload(collected, "<html></html>", "The log.", "claude-opus-5-5");
  expect(Object.keys(payload).toSorted()).toEqual(["dayLog", "dayMetrics", "metricsVersion", "reportHtml", "reportModel"]);
  expect(payload.metricsVersion).toBe(collected.dayMetrics.metricsVersion);
  expect(payload.dayMetrics).toBe(collected.dayMetrics);
  expect(payload.reportModel).toBe("Claude Opus 5.5");
  expect(payload.dayLog).toBe("The log.");
});

test("escapeHtml escapes every markup character", () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
