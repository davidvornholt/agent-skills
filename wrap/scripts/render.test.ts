import { describe, expect, test } from "bun:test";
import { buildCollected, type Collected } from "./day-report.ts";
import { escapeHtml } from "./html.ts";
import { METRICS_VERSION } from "./metrics.ts";
import {
  type AgentText,
  agentAreaPayload,
  durationText,
  loadTemplate,
  modelDisplayName,
  PART_TITLE_MAX_LENGTH,
  parseAgentText,
  renderReport,
  WAITING_PRS_LISTED,
} from "./render.ts";
import { MARK_GAP_MINUTES, renderTimeline, THREADS_PER_AREA } from "./render-timeline.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";
import type { TimelineThread } from "./timeline.ts";

const template = await loadTemplate();
const collected = buildCollected(WINDOW, sources);
const TEXT: AgentText = {
  summary: ["A quiet day of reviews and garden work.", "You started both threads yourself."],
  parts: [
    { title: "The parser", paragraphs: ["You had agents fix how the journal reads dates. The fix for the morning page landed at 04:00."] },
    {
      title: "Tidying tests",
      paragraphs: ["You tidied the tests of the task tool.", "You dropped a second way of reading the task list, because nothing <used> it."],
    },
  ],
  threadNames: new Map([["t-tidy", "Task tool tests"]]),
};
const TITLES = TEXT.parts.map((part) => part.title);
const NO_NAMES = new Map<string, string>();
const at = (iso: string) => Date.parse(iso);

describe("parseAgentText", () => {
  const parse = (value: unknown, day: Collected = collected) => parseAgentText(typeof value === "string" ? value : JSON.stringify(value), day);
  const morning = "You read the news.";
  const withText = (first: string, second = "You wrote tests.", summary = "A calm day.") => ({
    summary,
    parts: [
      { title: "Morning", text: first },
      { title: "Afternoon", text: second },
    ],
  });

  test("reads the summary's paragraphs and a title and paragraph per part, with the white space tidied", () => {
    expect(
      parse({
        summary: " A calm day.\n\nYou wrote. ",
        parts: [
          { title: " Morning ", text: "You read the news.\n  Then you wrote." },
          { title: "Afternoon", text: "You wrote tests." },
        ],
      }),
    ).toEqual({
      summary: ["A calm day.", "You wrote."],
      parts: [
        { title: "Morning", paragraphs: ["You read the news. Then you wrote."] },
        { title: "Afternoon", paragraphs: ["You wrote tests."] },
      ],
      threadNames: new Map(),
    });
  });

  test("splits a text into paragraphs at blank lines and drops the empty ones", () => {
    const text = "\n\nYou read the news.\n  Then you wrote.\n\nYou went for a walk.\r\n \t \r\nYou cooked.\n\n\n \n\nYou slept.\n\n";
    expect(parse(withText(text)).parts[0]?.paragraphs).toEqual(["You read the news. Then you wrote.", "You went for a walk.", "You cooked.", "You slept."]);
  });

  test("reads names for the day's threads, a thread with messages or one the timeline draws", () => {
    // t-deploy has a conversation; t-docs has only a run, so only the timeline draws it.
    const named = parse({ ...withText(morning), threads: { "t-deploy": " The deploy\nwatch ", "t-docs": "Docs" } });
    expect(named.threadNames).toEqual(
      new Map([
        ["t-deploy", "The deploy watch"],
        ["t-docs", "Docs"],
      ]),
    );
    expect(() => parse({ ...withText(morning), threads: { "t-elsewhere": "Elsewhere" } })).toThrow(/t-elsewhere, which is not one of the day's threads/);
    expect(() => parse({ ...withText(morning), threads: { "t-deploy": " " } })).toThrow(/name of thread t-deploy is empty/);
    expect(() => parse({ ...withText(morning), threads: { "t-deploy": 3 } })).toThrow(/name of thread t-deploy is not a string/);
    expect(() => parse({ ...withText(morning), threads: [["t-deploy", "The deploy"]] })).toThrow(/threads are not an object/);
  });

  test("refuses text that isn't the expected JSON", () => {
    expect(() => parse("A calm day.")).toThrow(/not JSON/);
    expect(() => parse({ summary: "A calm day." })).toThrow(/no parts list/);
    expect(() => parse({ summary: "A calm day.", parts: [{ title: "Only one", text: morning }] })).toThrow(/has 1 parts, but the day has 2/);
    expect(() => parse({ summary: "A calm day.", parts: [{ title: "Morning", text: morning }, "Afternoon."] })).toThrow(/part 2 needs a title and a text/);
    expect(() =>
      parse({
        summary: "A calm day.",
        parts: [
          { title: "Morning", lines: [morning] },
          { title: "Afternoon", text: morning },
        ],
      }),
    ).toThrow(/part 1 needs a title and a text/);
  });

  test("refuses empty text and a long title", () => {
    expect(() => parse(withText(morning, morning, " \n "))).toThrow(/summary is empty/);
    expect(() => parse(withText(" "))).toThrow(/text of part 1 is empty/);
    expect(() => parse(withText("\n\n \n\n"))).toThrow(/text of part 1 is empty/);
    const long = withText(morning);
    expect(() => parse({ ...long, parts: [{ title: "a".repeat(PART_TITLE_MAX_LENGTH + 1), text: morning }, long.parts[1]] })).toThrow(/title of part 1 has/);
  });

  test("leaves the wording to the agent: long sentences, numbers and pull request refs pass", () => {
    const long = `You ${Array.from({ length: 40 }, () => "read").join(" and ")}.`;
    expect(() => parse(withText(long, "You landed postlude#12 at 14:00, which fixed 2 dates.", "A calm day with 3 reviews"))).not.toThrow();
  });
});

test("durationText writes seconds under a minute, and days and hours over a day", () => {
  expect(durationText(45)).toBe("45 s");
  expect(durationText(450)).toBe("8 min");
  expect(durationText(5 * 3600)).toBe("5 h");
  expect(durationText(25 * 3600 + 20 * 60)).toBe("1 d 1 h");
  expect(durationText(2 * 86_400)).toBe("2 d");
});

describe("renderReport", () => {
  const html = renderReport(template, collected, TEXT);

  test("keeps the content security policy and fills every slot", () => {
    expect(html).toContain(`content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:"`);
    expect(html).toContain(`const METRICS_VERSION = ${METRICS_VERSION};`);
    expect(html).not.toContain("__METRICS_VERSION__");
    expect(html).not.toMatch(/<!--wrap:/);
    expect(html).toContain(`<p class="summary">${TEXT.summary[0]}</p><p class="summary">${TEXT.summary[1]}</p>`);
  });

  test("loads nothing from the network", () => {
    expect(html).not.toMatch(/\b(src|href)\s*=|@import|url\(|fetch\(|XMLHttpRequest|WebSocket/);
  });

  test("keeps numbers out of the version notice, which the template writes itself", () => {
    const notice = html.match(/notice\.textContent = (.+);/)?.[1];
    expect(notice).toBeDefined();
    expect(notice).not.toMatch(/\$\{|\p{Nd}/u);
  });

  test("shows each part's number, title and time range over its paragraphs", () => {
    expect(html).toContain(
      `<h2>The day in parts</h2><ol class="arcs"><li class="arc"><h3><span class="no">1</span><span>The parser</span><span class="when">04:00–13:00</span></h3><p>${TEXT.parts[0]?.paragraphs[0]}</p></li><li class="arc"><h3><span class="no">2</span>`,
    );
    expect(html).toContain(
      "</h3><p>You tidied the tests of the task tool.</p><p>You dropped a second way of reading the task list, because nothing &lt;used&gt; it.</p></li>",
    );
  });

  test("lets the timeline use the full width and keeps every other section in the text column", () => {
    const sections = [...html.matchAll(/<section( class="wide")?[^>]*>\s*<h2>([^<]*)<\/h2>/g)].map((match) => [match[2], match[1] !== undefined]);
    expect(sections.filter(([, wide]) => wide)).toEqual([["Timeline", true]]);
    expect(sections.map(([heading]) => heading)).toContain("Tracked in Super Productivity");
    expect(template).toMatch(/main > \* \{ max-width: 720px; margin-inline: auto; \}/);
    expect(template).toMatch(/main > \.wide \{ max-width: none; \}/);
  });

  test("leaves the pull requests' summaries to the agent", () => {
    expect(collected.reportInputs.landedPrs.items.map((pr) => pr.summary)).toContain("The morning page now opens with the weather.");
    expect(html).not.toContain("The morning page now opens with the weather.");
    expect(html).not.toContain("Reads the task list with a second parser.");
  });

  test("leaves out the parts section on a day without parts", () => {
    const noParts = { ...collected, reportInputs: { ...collected.reportInputs, parts: [] } };
    expect(renderReport(template, noParts, { ...TEXT, parts: [] })).not.toContain("The day in parts");
  });

  test("escapes titles from the sources", () => {
    const title = `<img src=x onerror="alert(1)">`;
    const inputs = {
      ...collected.reportInputs,
      landedPrs: {
        status: "complete" as const,
        items: [{ repository: "a/b", number: 1, ref: "b#1", title, summary: null, mergedAt: "2026-10-29T10:00:00+01:00", part: 0 }],
      },
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
      '<details class="prs"><summary><h2>Pull requests landed</h2><span class="meta">postlude 1 · sp-cli 1</span></summary><h3>postlude <span class="meta">· 1</span></h3><ul class="items"><li><span class="time">04:00</span>Start of day <span class="meta">· #12</span></li></ul>',
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
    expect(partialPrs).toContain('#12</span></li></ul><h3>sp-cli <span class="meta">· 1</span></h3>');
    expect(partialPrs).toContain('#7</span></li></ul><p class="meta">Some sources were not available');
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

  test("shows prompts and agent time in tiles, and says when they weren't measured", () => {
    expect(html).toContain(
      '<div class="tile"><p class="tile-label">Prompts</p><p class="tile-value">4</p><p class="tile-note">In 2 threads · 1 from the phone</p></div>',
    );
    expect(html).toContain(
      '<div class="tile"><p class="tile-label">Agent time</p><p class="tile-value">3 h 55 min</p><p class="tile-note">Up to 2 threads at once, at 15:20</p></div>',
    );
    const unmeasured = renderReport(template, buildCollected(WINDOW, { ...sources, t3: { ok: false, error: "unreachable" } }), TEXT);
    expect(unmeasured).toContain('<p class="tile-label">Prompts</p><p class="tile-value"><span class="unmeasured">Not measured</span></p></div>');
  });

  test("lists the loose ends: running threads, open pull requests, and tasks due or overdue", () => {
    const loose = (tag: string, body: string) => `<li class="loose"><span class="tag">${tag}</span><div>${body}</div></li>`;
    expect(html).toContain(
      `<h2>Loose ends</h2><ul class="loose-ends">${[
        loose("Running", 'Watch the deploy <span class="meta">· nix-config</span>'),
        loose("Draft", 'nix-config#5 Build at night <span class="meta">· Night build</span>'),
        loose("Open", 'pim#3 End of day belongs to the next day <span class="meta">· Fix the parser</span>'),
        loose("Open", 'postlude#14 Parse dates <span class="meta">· Fix the parser</span>'),
        loose("Overdue", 'Pay the bill <span class="meta">· Home, since 2026-10-27</span>'),
        loose("Today", 'Call the plumber <span class="meta">· Home</span>'),
        loose("Today", 'Next day <span class="meta">· Home</span>'),
        loose("Tomorrow", 'Pack <span class="meta">· Home, deadline</span>'),
      ].join("")}</ul></section>`,
    );
  });

  test(`collapses more than ${WAITING_PRS_LISTED} open pull requests into one entry, grouped by repository`, () => {
    const waiting = Array.from({ length: WAITING_PRS_LISTED + 1 }, (_, index) => ({
      repository: index === 0 ? "davidvornholt/pim" : "davidvornholt/postlude",
      number: 20 + index,
      ref: `${index === 0 ? "pim" : "postlude"}#${20 + index}`,
      title: `Change ${String.fromCharCode(65 + index)}`,
      isDraft: index < 2,
      thread: "Fix the parser",
    }));
    const { looseEnds } = collected.reportInputs;
    const many = renderReport(
      template,
      { ...collected, reportInputs: { ...collected.reportInputs, looseEnds: { ...looseEnds, waitingPrs: { status: "complete", items: waiting } } } },
      TEXT,
    );
    expect(many).toContain(
      '<li class="loose"><span class="tag">Open</span><div>4 pull requests from the day\'s threads were still open at its end, 2 of them drafts.<details><summary>Show them</summary><h3>postlude <span class="meta">· 3</span></h3>',
    );
    expect(many).not.toContain('<span class="tag">Draft</span>');
  });

  test("says when there are no loose ends, and which sources were missing", () => {
    const none = { status: "complete" as const, items: [] };
    const quiet = renderReport(
      template,
      { ...collected, reportInputs: { ...collected.reportInputs, looseEnds: { waitingPrs: none, dueTasks: none, runningThreads: none } } },
      TEXT,
    );
    expect(quiet).toContain('<h2>Loose ends</h2><p class="empty">No loose ends.</p></section>');
    const unavailable = { ok: false as const, error: "unreachable" };
    const missing = renderReport(template, buildCollected(WINDOW, { ...sources, t3: unavailable, sp: unavailable }), TEXT);
    expect(missing).toContain("T3 Code was not available, so open pull requests and running threads are missing.");
    expect(missing).toContain("Super Productivity was not available, so due tasks are missing.");
  });

  test("gives the day's figures under the headings its data supports", () => {
    const facts = (lines: readonly string[]) => `<dd><ul>${lines.map((line) => `<li>${line}</li>`).join("")}</ul></dd>`;
    expect(html).toContain(
      `<h2>The day in figures</h2><dl class="facts"><dt>Output</dt>${facts([
        "2 pull requests landed in 2 repositories, and 1 closed without merging.",
        "3 tasks marked done in Super Productivity.",
        "1 thread settled in T3 Code.",
        "Agents ran in 5 threads for 3 h 55 min in all; at least one was running for 3 h 45 min.",
      ])}<dt>Focus</dt>${facts([
        "6 h 30 min of your screen time was in T3 Code, and agents ran for 1 h 30 min while you had no screen time.",
        "1 focus block; the longest was 3 h 20 min on Code, 08:12–11:32.",
      ])}<dt>Direction</dt>${facts([
        "Prompts by area: Code 4.",
        "1 of 3 tasks due on the day was done by its end.",
      ])}<dt>Efficiency</dt><dd><ul><li>From an agent finishing to your next prompt in that thread: a median of 8 min over 2 replies.</li><li>From the first prompt in a thread to the last of its pull requests merging: a median of 1 h 10 min over 1 thread.<details><summary>Show the threads</summary><ul class="items"><li><span class="time">1 h 10 min</span>Tidy tests <span class="meta">· sp-cli, 1 pull request, first prompt 2026-10-29 14:50</span></li></ul></details></li></ul></dd></dl>`,
    );
    const unavailable = { ok: false as const, error: "unreachable" };
    const sparse = renderReport(
      template,
      buildCollected(WINDOW, { ...sources, t3: unavailable, sp: unavailable, github: unavailable, closedPrs: unavailable }),
      TEXT,
    );
    expect(sparse).toContain('<dl class="facts"><dt>Focus</dt><dd><ul><li>1 focus block;');
    expect(sparse).not.toContain("<dt>Output</dt>");
    expect(sparse).not.toContain("<dt>Direction</dt>");
    expect(sparse).not.toContain("<dt>Efficiency</dt>");
  });

  test("refuses a template without its slots", () => {
    for (const slot of ["lists", "tiles", "looseends", "facts"]) {
      expect(() => renderReport(template.replace(`<!--wrap:${slot}-->`, ""), collected, TEXT)).toThrow(`<!--wrap:${slot}-->`);
    }
    expect(() => renderReport(`${template}<!--wrap:notes-->`, collected, TEXT)).toThrow(/exactly one <!--wrap:notes-->/);
    expect(() => renderReport(template.replace("<!--wrap:timeline-->", ""), collected, TEXT)).toThrow(/<!--wrap:timeline-->/);
  });
});

describe("renderTimeline", () => {
  const html = renderTimeline(collected, TITLES, TEXT.threadNames);
  const withTimeline = (changes: Partial<Collected["timeline"]>, inputs: Partial<Collected["reportInputs"]> = {}): Collected => ({
    ...collected,
    timeline: { ...collected.timeline, ...changes },
    reportInputs: { ...collected.reportInputs, ...inputs },
  });
  const none = { status: "complete" as const, items: [] };
  const quiet = { appointments: none, landedPrs: none, parts: [] };
  const bare = { pieces: [], focusBlocks: [], threads: none, sentMail: { status: "complete" as const, times: [] } };
  const labels = (drawn: string) => [...drawn.matchAll(/<span class="tl-label"[^>]*>([^<]*)<\/span>/g)].map((match) => match[1]);
  const thread = (fields: Partial<TimelineThread> & Pick<TimelineThread, "id" | "title">): TimelineThread => ({
    project: "~/dev/postlude",
    category: "code",
    runs: [],
    prompts: [],
    ...fields,
  });

  test("draws the parts, a row per area, the calendar, pull requests and mail, and each area's threads", () => {
    expect(labels(html)).toEqual([
      "Parts",
      "Code",
      "Admin",
      "Mail",
      "Not categorised",
      "Calendar",
      "Pull requests",
      "Sent mail",
      "Fix the parser",
      "Task tool tests",
      "Write docs",
      "Night build",
      "Watch the deploy",
    ]);
    const groups = [...html.matchAll(/<p class="tl-group">([^<]*)<\/p>/g)].map((match) => match[1]);
    expect(groups).toEqual([
      "The day in parts",
      "Your screen time by area",
      "Appointments, pull requests and mail",
      "Threads · Code",
      "Threads · Not categorised",
    ]);
    expect(html).toContain('role="img"');
    // The tooltip keeps the T3 title of a thread the agent named, so it can still be found in T3 Code.
    expect(html).toContain('<span class="tl-label" data-tip="Tidy tests · sp-cli">Task tool tests</span>');
  });

  test("numbers the parts with their titles, and divides every row where a part begins", () => {
    expect(html).toContain('<span class="tl-mark tl-part" style="left:0%;width:37.5%" data-tip="1 · The parser · 04:00–13:00">1</span>');
    expect(html).toContain('<span class="tl-mark tl-part" style="left:37.5%;width:62.5%" data-tip="2 · Tidying tests · 13:00–04:00">2</span>');
    const rows = labels(html).length;
    expect(html.split('<span class="tl-divider" style="left:37.5%"></span>')).toHaveLength(rows + 1);
  });

  test("places marks in percent of whole hours from the first to the last mark", () => {
    const pieces = [{ start: at("2026-10-29T09:00:00+01:00"), end: at("2026-10-29T09:30:00+01:00"), category: "code", project: null }];
    const drawn = renderTimeline(withTimeline({ ...bare, pieces }, quiet), [], NO_NAMES);
    expect(drawn).toContain("--hours:1");
    expect(drawn).toContain('<span class="tl-mark tl-screen" style="left:0%;width:50%" data-tip="Code · 09:00–09:30 (30 min)"></span>');
    expect(drawn).toContain('<span style="left:0%">09:00</span>');
    expect(drawn).not.toContain("tl-divider");
  });

  test("labels the axis every hour or two on a wide report, and half as often on a narrow one", () => {
    const axisLabels = (hours: number) => {
      const start = at("2026-10-29T04:00:00+01:00");
      const pieces = [{ start, end: start + (hours - 0.5) * 3_600_000, category: "code", project: null }];
      const drawn = renderTimeline(withTimeline({ ...bare, pieces }, quiet), [], NO_NAMES);
      return [...drawn.matchAll(/<span( class="minor")? style="left:[^"]*">(\d\d):00<\/span>/g)].map((match) => `${match[2]}${match[1] ? "·" : ""}`);
    };
    expect(axisLabels(6)).toEqual(["04", "05", "06", "07", "08", "09"]);
    expect(axisLabels(12)).toEqual(["04", "05·", "06", "07·", "08", "09·", "10", "11·", "12", "13·", "14", "15·"]);
    expect(axisLabels(24)).toEqual(["04", "06·", "08", "10·", "12", "14·", "16", "18·", "20", "22·", "00", "02·"]);
    expect(template).toMatch(/\.tl-ticks \.minor \{ display: none; \}[\s\S]*@media \(min-width: 1100px\) \{[^}]*\}\s*\.tl-ticks \.minor \{ display: block; \}/);
  });

  test(`joins a row's screen time across gaps shorter than ${MARK_GAP_MINUTES} minutes, and counts only the screen time`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    // Forty pieces of half a minute, one minute apart.
    const short = Array.from({ length: 40 }, (_, index) => ({ start: nine + index * 90_000, end: nine + index * 90_000 + 30_000 }));
    // Begins exactly that gap after the last short piece ends, so it stays a mark of its own.
    const apart = { start: at("2026-10-29T09:59:00+01:00") + MARK_GAP_MINUTES * 60_000, end: at("2026-10-29T10:05:00+01:00") };
    const pieces = [...short, apart].map((piece) => ({ ...piece, category: "code", project: "~/dev/postlude" }));
    const drawn = renderTimeline(withTimeline({ ...bare, pieces }, quiet), [], NO_NAMES);
    const tips = [...drawn.matchAll(/class="tl-mark tl-screen" style="[^"]*" data-tip="([^"]*)"/g)].map((match) => match[1]);
    expect(tips).toEqual(["Code · 09:00–09:59 (20 min)", "Code · 10:01–10:05 (4 min)"]);
  });

  test("draws a thread's runs as bars, joined where they overlap, and its prompts as dots", () => {
    const runs = [
      { start: at("2026-10-29T09:00:00+01:00"), end: at("2026-10-29T09:40:00+01:00") },
      { start: at("2026-10-29T09:30:00+01:00"), end: at("2026-10-29T10:00:00+01:00") },
    ];
    const prompts = [
      { at: at("2026-10-29T08:55:00+01:00"), fromPhone: false },
      { at: at("2026-10-29T09:50:00+01:00"), fromPhone: true },
    ];
    const drawn = renderTimeline(
      withTimeline({ ...bare, threads: { status: "complete", items: [thread({ id: "a", title: "", runs, prompts })] } }, quiet),
      [],
      NO_NAMES,
    );
    expect(drawn).toContain('<span class="tl-label" data-tip="Untitled thread · postlude">Untitled thread</span>');
    expect(drawn).toContain('data-tip="Agent running · 09:00–10:00 (1 h)"');
    expect(drawn).not.toContain("09:30");
    expect(drawn).toContain('class="tl-mark tl-prompt" style="left:30.556%" data-tip="Prompt · 08:55"');
    expect(drawn).toContain('class="tl-mark tl-phone" style="left:61.111%" data-tip="Prompt from the phone · 09:50"');
  });

  test(`draws the ${THREADS_PER_AREA} threads of an area with the most prompts, in order of their first activity, and the rest in one row`, () => {
    const nine = at("2026-10-29T09:00:00+01:00");
    const items = Array.from({ length: THREADS_PER_AREA + 2 }, (_, index) =>
      thread({
        id: `t-${index}`,
        title: `Thread ${String.fromCharCode(65 + index)}`,
        // Thread A starts last and has the most prompts; the last two have the fewest.
        prompts: Array.from({ length: THREADS_PER_AREA + 2 - index }, (_, prompt) => ({ at: nine - index * 600_000 + prompt * 60_000, fromPhone: false })),
      }),
    );
    const drawn = renderTimeline(withTimeline({ ...bare, threads: { status: "complete", items } }, quiet), [], new Map([["t-6", "Garden"]]));
    expect(labels(drawn)).toEqual(["Thread E", "Thread D", "Thread C", "Thread B", "Thread A", "2 other threads"]);
    expect(drawn).toContain('<span class="tl-label" data-tip="Thread F; Garden (Thread G)">2 other threads</span>');
  });

  test("escapes titles in tooltips and labels", () => {
    const runs = [{ start: at("2026-10-29T09:00:00+01:00"), end: at("2026-10-29T10:00:00+01:00") }];
    const drawn = renderTimeline(
      withTimeline({ ...bare, threads: { status: "complete", items: [thread({ id: "a", title: `"><script>`, runs })] } }, quiet),
      [],
      NO_NAMES,
    );
    expect(drawn).toContain("&quot;&gt;&lt;script&gt;");
    expect(drawn).not.toContain("<script>");
  });

  test("lists the time tracked in Super Productivity in a section of its own, after the timeline", () => {
    expect(html).toMatch(
      /<\/section>\s*<section><h2>Tracked in Super Productivity<\/h2><ul class="items"><li>Write tests <span class="meta">· Work · 50 min<\/span><\/li>/,
    );
  });

  test("says what is missing, also on a day with nothing to draw", () => {
    const missing = renderTimeline(withTimeline({ ...bare, status: "missing", threads: { status: "missing", items: [] } }, quiet), [], NO_NAMES);
    expect(missing).toContain('<p class="empty">Nothing recorded.</p>');
    expect(missing).toContain("Screen activity was not available.");
    expect(missing).toContain("T3 Code was not available, so its threads are missing.");
    const partial = renderTimeline(withTimeline({ status: "partial" }), TITLES, NO_NAMES);
    expect(partial).toContain("some screen time may be missing");
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

test("the agent area payload carries the metrics, the report, and the model's name", () => {
  const payload = agentAreaPayload(collected, "<html></html>", "claude-opus-5-5");
  expect(Object.keys(payload).toSorted()).toEqual(["dayMetrics", "metricsVersion", "reportHtml", "reportModel"]);
  expect(payload.metricsVersion).toBe(collected.dayMetrics.metricsVersion);
  expect(payload.dayMetrics).toBe(collected.dayMetrics);
  expect(payload.reportModel).toBe("Claude Opus 5.5");
});

test("escapeHtml escapes every markup character", () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
});
