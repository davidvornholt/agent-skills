import { describe, expect, test } from "bun:test";
import { agentAreaPayload, composeDocument, DATA_BLOCKS, modelDisplayName } from "./compose.ts";
import { buildCollected } from "./day-report.ts";
import type { Block, SectionBlock } from "./report-document.ts";
import { COMPOSITION, PARTS } from "./testing/composition.ts";
import { sources, WINDOW } from "./testing/fixtures.ts";

const collected = buildCollected(WINDOW, sources);
const compose = (blocks: unknown[], extra: object = {}) => composeDocument(JSON.stringify({ blocks, ...extra }), collected).blocks;
const parts = { kind: "parts", parts: PARTS };
// The day has parts, so every report needs its parts block; the tests that are about other blocks put it first.
const withParts = (blocks: unknown[]) => compose([parts, ...blocks]).slice(1);
const fails = (blocks: unknown[], message: RegExp | string) => expect(() => compose(blocks)).toThrow(message);
const headings = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) =>
    block.kind === "section" ? [block.heading, ...headings(block.blocks).map((heading) => `  ${heading}`)] : block.kind === "timeline" ? [block.heading] : [],
  );

describe("the default composition", () => {
  const document = composeDocument(JSON.stringify(COMPOSITION), collected);

  test("gives a versioned document of the agent's blocks and the data blocks in its order", () => {
    expect(document.version).toBe(1);
    expect(document.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "paragraph",
      "tiles",
      "section",
      "timeline",
      "section",
      "section",
      "section",
      "section",
      "section",
      "table",
      "section",
    ]);
    expect(headings(document.blocks)).toEqual([
      "The day in parts",
      "Timeline",
      "How the day went",
      "  Lead times",
      "Appointments",
      "Pull requests landed",
      "Threads open for several days",
      "Tracked in Super Productivity",
      "Sources",
    ]);
  });

  test("gives the parts their times, and the timeline their titles and the agent's names for threads", () => {
    const section = document.blocks[3] as SectionBlock;
    expect(section.blocks).toEqual([
      {
        kind: "parts",
        parts: collected.reportInputs.parts.map((part, index) => ({
          title: PARTS[index]?.title ?? "",
          start: part.start,
          end: part.end,
          text:
            index === 0
              ? [["You read the review on the parser."], ["Then you wrote its tests."]]
              : [["You asked the agent to ", { emphasis: "tidy the tests" }, " and merged ", { code: "sp-cli" }, "."]],
        })),
      },
    ]);
    const timeline = document.blocks.find((block) => block.kind === "timeline");
    const marks = timeline?.groups[0]?.rows[0]?.marks ?? [];
    expect(marks.map((mark) => (mark.kind === "part" ? mark.title : null))).toEqual(["A slow start", "Tidying up"]);
    const rows = timeline?.groups.flatMap((group) => group.rows) ?? [];
    expect(rows.find((row) => row.label === "Parser review")?.note).toMatch(/ · /);
  });

  test("carries a data block's note and folding over to the section its heading makes", () => {
    const pullRequests = document.blocks.find((block) => block.kind === "section" && block.heading === "Pull requests landed");
    expect(pullRequests).toMatchObject({ note: "postlude 1 · sp-cli 1", collapsed: true, blocks: [{ kind: "list" }] });
  });
});

describe("the agent's blocks", () => {
  test("tidy white space, and split a paragraph's text at its blank lines", () => {
    expect(withParts([{ kind: "paragraph", text: "  One\n line.  \n \nTwo.  " }])).toEqual([
      { kind: "paragraph", text: ["One line."] },
      { kind: "paragraph", text: ["Two."] },
    ]);
    expect(withParts([{ kind: "paragraph", text: ["Keep ", { link: "this", href: "https://example.com/a" }, " link."] }])).toEqual([
      { kind: "paragraph", text: ["Keep ", { link: "this", href: "https://example.com/a" }, " link."] },
    ]);
  });

  test("take facts, lists, callouts and tables", () => {
    expect(
      withParts([
        { kind: "facts", items: [{ term: "Weather", details: "Rain.\n\nThen sun." }] },
        {
          kind: "list",
          items: [
            { text: "Call the bank", time: { at: "2026-10-29T09:00+01:00" }, meta: "Phone" },
            { text: "All day", time: { allDay: true } },
          ],
        },
        { kind: "callout", tone: "warning", text: "Check the backup." },
        { kind: "table", caption: "Rooms", columns: ["Room", "Note"], rows: [["Kitchen", ""]] },
      ]),
    ).toEqual([
      { kind: "facts", items: [{ term: "Weather", details: [["Rain."], ["Then sun."]] }] },
      {
        kind: "list",
        items: [
          { text: ["Call the bank"], time: { at: "2026-10-29T09:00+01:00" }, meta: "Phone" },
          { text: ["All day"], time: { allDay: true } },
        ],
      },
      { kind: "callout", tone: "warning", text: ["Check the backup."] },
      { kind: "table", caption: "Rooms", columns: ["Room", "Note"], rows: [[["Kitchen"], []]] },
    ]);
  });

  test("refuse what Postlude couldn't draw, naming where it is", () => {
    fails([parts, { kind: "paragraph", text: [{ link: "x", href: "javascript:alert(1)" }] }], "blocks[1].text[0].href: is not an http(s) URL.");
    fails([parts, { kind: "paragraph", text: [{ html: "<b>x</b>" }] }], /blocks\[1\]\.text\[0\]: is not a span/);
    fails([parts, { kind: "paragraph", text: "x", style: "bold" }], 'blocks[1]: has "style", which it doesn\'t take; it takes kind, text.');
    fails([parts, { kind: "chart" }], /has kind "chart", which is no block; the kinds are section, paragraph/);
    fails([parts, { kind: "tiles", tiles: [] }], 'write {"use": "tiles"} instead');
    fails([parts, { kind: "timeline" }], 'write {"use": "timeline"} instead');
    fails([parts, { kind: "table", columns: ["A", "B"], rows: [["x"]] }], "blocks[1].rows[0]: is not a row of 2 cells, one for each column.");
    fails([parts, { kind: "callout", tone: "loud", text: "x" }], 'blocks[1].tone: is not "note" or "warning".');
    fails([parts, { kind: "list", items: [{ text: "x", time: { at: 9 } }] }], /blocks\[1\]\.items\[0\]\.time: is not a time/);
    fails([parts, { kind: "section", heading: " ", blocks: [] }], "blocks[1].heading: is empty.");
  });

  test("leave out a section whose blocks all come out empty", () => {
    const quiet = { ...collected, reportInputs: { ...collected.reportInputs, appointments: { status: "complete" as const, items: [] } } };
    const blocks = composeDocument(
      JSON.stringify({
        blocks: [parts, { kind: "section", heading: "Elsewhere", blocks: [{ use: "appointments" }] }, { use: "appointments", heading: "Appointments" }],
      }),
      quiet,
    ).blocks;
    expect(blocks.map((block) => block.kind)).toEqual(["parts"]);
  });

  test("refuse an empty report and text that is not JSON", () => {
    expect(() => composeDocument("summary: a calm day", collected)).toThrow("The report is not JSON.");
    expect(() => composeDocument(JSON.stringify({ blocks: [], summary: "x" }), collected)).toThrow('report: has "summary"');
    const noParts = { ...collected, reportInputs: { ...collected.reportInputs, parts: [] } };
    expect(() => composeDocument(JSON.stringify({ blocks: [] }), noParts)).toThrow("blocks: make an empty report.");
  });
});

describe("data blocks", () => {
  test("are placed by name, inline without a heading and in a section of their own with one", () => {
    expect(withParts([{ use: "tiles" }]).map((block) => block.kind)).toEqual(["tiles"]);
    expect(withParts([{ use: "sentMail", heading: "Mail", collapsed: false }])).toMatchObject([
      { kind: "section", heading: "Mail", collapsed: false, blocks: [{ kind: "table" }] },
    ]);
    expect(withParts([{ use: "timeline", heading: "The day on a line" }])).toMatchObject([{ kind: "timeline", heading: "The day on a line" }]);
    expect(DATA_BLOCKS).toContain("figures");
  });

  test("refuse an unknown name, folding without a heading, and a folded timeline", () => {
    fails([parts, { use: "weather" }], /blocks\[1\]\.use: names no data block; the data blocks are timeline, tiles, figures/);
    fails([parts, { use: "sentMail", collapsed: true }], "blocks[1].collapsed: needs a heading");
    fails([parts, { use: "timeline", collapsed: true }], "blocks[1].collapsed: is not for the timeline");
    fails([parts, { use: "tiles", note: "x" }], 'blocks[1]: has "note"');
  });
});

describe("parts", () => {
  const part = PARTS[0];

  test("need one parts block with an entry per part of the day, in order, wherever it sits", () => {
    fails([{ kind: "paragraph", text: "x" }], "blocks: hold no parts block, but the day has 2 parts.");
    fails([{ kind: "parts", parts: [part] }], "blocks[0].parts: has 1 parts, but the day has 2. Write one entry per entry of reportInputs.parts, in order.");
    fails([parts, { kind: "section", heading: "Again", blocks: [parts] }], "blocks[1].blocks[0]: is a second parts block");
    expect(compose([{ kind: "section", heading: "Parts", blocks: [parts] }, { use: "timeline" }])[1]).toMatchObject({ kind: "timeline" });
    const noParts = { ...collected, reportInputs: { ...collected.reportInputs, parts: [] } };
    expect(() => composeDocument(JSON.stringify({ blocks: [parts] }), noParts)).toThrow("blocks[0]: is a parts block, but the day has no parts.");
  });

  test("keep their titles short, because the timeline names the parts by them", () => {
    fails([{ kind: "parts", parts: [{ ...part, title: "A".repeat(61) }, part] }], "blocks[0].parts[0].title: has 61 characters; the limit is 60.");
    fails([{ kind: "parts", parts: [{ text: "x" }, part] }], "blocks[0].parts[0].title: is not a string.");
  });
});

test("thread names are only for the day's threads", () => {
  expect(() => compose([parts], { threads: { "t-elsewhere": "Elsewhere" } })).toThrow("threads.t-elsewhere: is not one of the day's threads.");
  expect(() => compose([parts], { threads: { "t-parser": "" } })).toThrow("threads.t-parser: is empty.");
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

test("the payload is what postlude agent-area check and put take", () => {
  const document = composeDocument(JSON.stringify(COMPOSITION), collected);
  const payload = agentAreaPayload(collected, document, "gpt-5");
  expect(Object.keys(payload).toSorted()).toEqual(["dayMetrics", "metricsVersion", "reportDocument", "reportModel"]);
  expect(payload).toMatchObject({ metricsVersion: collected.dayMetrics.metricsVersion, reportModel: "GPT-5", reportDocument: document });
});
