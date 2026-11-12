// Composes the report document from what the agent writes on stdin. The agent chooses the blocks, their order and their headings, and writes the words; it places the blocks that carry data with {"use": name}, and this script builds those from the collected data, so every figure in the report is one that was collected. Postlude's `agent-area check` then holds the document to Postlude's schema, which sets the limits.

import type { Collected } from "./day-report.ts";
import {
  appointments,
  type DataBlocks,
  figures,
  kontor,
  leadTimes,
  openThreads,
  pullRequests,
  sentMail,
  sources,
  tiles,
  trackedTasks,
} from "./report-blocks.ts";
import {
  type Block,
  type ItemTime,
  type ListItem,
  type PartsBlock,
  REPORT_DOCUMENT_VERSION,
  type ReportDocument,
  type RichText,
  type Span,
} from "./report-document.ts";
import { timelineBlock } from "./report-timeline.ts";

/** Part titles stay short, because the timeline names each part by its title. */
export const PART_TITLE_MAX_LENGTH = 60;

const SHAPE = '{"threads": {"<thread id>": "<name>"}, "blocks": [<block>, ...]}';

const DATA = { tiles, figures, leadTimes, appointments, pullRequests, openThreads, trackedTasks, sentMail, sources, kontor } as const satisfies Record<
  string,
  (collected: Collected) => DataBlocks
>;

const DATA_NAMES = Object.keys(DATA) as (keyof typeof DATA)[];

/** What {"use": name} may name: the timeline and the blocks of report-blocks.ts. */
export const DATA_BLOCKS: readonly string[] = ["timeline", ...DATA_NAMES];

const KINDS = ["section", "paragraph", "parts", "facts", "list", "callout", "table"] as const;

type Fields = Readonly<Record<string, unknown>>;

type Context = { readonly collected: Collected; readonly names: ReadonlyMap<string, string>; readonly parts: PartsBlock | null };

function fail(path: string, message: string): never {
  throw new Error(`${path}: ${message}`);
}

const isObject = (value: unknown): value is Fields => typeof value === "object" && value !== null && !Array.isArray(value);

/** An object with only the given keys, so a misspelt key is an error rather than text that silently goes missing. */
const fieldsOf = (value: unknown, path: string, allowed: readonly string[]): Fields => {
  if (!isObject(value)) fail(path, "is not an object.");
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) fail(path, `has ${extra.map((key) => JSON.stringify(key)).join(", ")}, which it doesn't take; it takes ${allowed.join(", ")}.`);
  return value;
};

const listOf = <T>(value: unknown, path: string, entry: (item: unknown, path: string) => T): T[] => {
  if (!Array.isArray(value) || value.length === 0) fail(path, "is not a list with at least one entry.");
  return value.map((item, index) => entry(item, `${path}[${index}]`));
};

const tidy = (text: string): string => text.replace(/\s+/g, " ");

const textOf = (value: unknown, path: string): string => {
  if (typeof value !== "string") fail(path, "is not a string.");
  const clean = tidy(value).trim();
  if (clean === "") fail(path, "is empty.");
  return clean;
};

const optional = <T>(value: unknown, read: (value: unknown) => T): T | undefined => (value === undefined ? undefined : read(value));

const booleanOf = (value: unknown, path: string): boolean => {
  if (typeof value !== "boolean") fail(path, "is not true or false.");
  return value;
};

const hrefOf = (value: unknown, path: string): string => {
  if (typeof value !== "string" || !URL.canParse(value) || !["http:", "https:"].includes(new URL(value).protocol)) fail(path, "is not an http(s) URL.");
  return value;
};

const SPAN_SHAPE = 'a string, {"emphasis": text}, {"code": text}, or {"link": text, "href": "https://..."}';

// White space runs become one space, but a span keeps a space at its edge, which separates it from the next.
const spanOf = (value: unknown, path: string): Span => {
  if (typeof value === "string") {
    if (value === "") fail(path, "is empty.");
    return tidy(value);
  }
  if (isObject(value)) {
    const keys = Object.keys(value).toSorted().join(",");
    if (keys === "emphasis") return { emphasis: textOf(value.emphasis, `${path}.emphasis`) };
    if (keys === "code") return { code: textOf(value.code, `${path}.code`) };
    if (keys === "href,link") return { link: textOf(value.link, `${path}.link`), href: hrefOf(value.href, `${path}.href`) };
  }
  return fail(path, `is not a span, which is ${SPAN_SHAPE}.`);
};

/** One paragraph or line: a string, or a list of spans for emphasis, code and links. */
const richText = (value: unknown, path: string): RichText => {
  if (typeof value === "string") return [textOf(value, path)];
  if (Array.isArray(value) && value.length > 0) return value.map((span, index) => spanOf(span, `${path}[${index}]`));
  return fail(path, `is not text: a string, or a list of spans, each ${SPAN_SHAPE}.`);
};

/** Several paragraphs or lines: a string, split at its blank lines, or a list with a string or a list of spans for each. */
const paragraphs = (value: unknown, path: string): RichText[] => {
  if (Array.isArray(value)) return listOf(value, path, richText);
  if (typeof value !== "string") fail(path, "is not text: a string, or a list of paragraphs.");
  const split = value
    .split(/\n[^\S\n]*\n/)
    .map((paragraph) => tidy(paragraph).trim())
    .filter((paragraph) => paragraph !== "");
  if (split.length === 0) fail(path, "is empty.");
  return split.map((paragraph) => [paragraph]);
};

const itemTime = (value: unknown, path: string): ItemTime => {
  if (isObject(value)) {
    const keys = Object.keys(value).toSorted().join(",");
    if (keys === "at" && typeof value.at === "string") return { at: value.at };
    if (keys === "end,start" && typeof value.start === "string" && typeof value.end === "string") return { start: value.start, end: value.end };
    if (keys === "allDay" && value.allDay === true) return { allDay: true };
  }
  return fail(path, 'is not a time: {"at": instant}, {"start": instant, "end": instant}, or {"allDay": true}, with instants such as "2026-10-29T14:05+01:00".');
};

const listItem = (value: unknown, path: string): ListItem => {
  const fields = fieldsOf(value, path, ["text", "time", "meta"]);
  const time = optional(fields.time, (time) => itemTime(time, `${path}.time`));
  const meta = optional(fields.meta, (meta) => textOf(meta, `${path}.meta`));
  return { text: richText(fields.text, `${path}.text`), ...(time === undefined ? {} : { time }), ...(meta === undefined ? {} : { meta }) };
};

const tableBlock = (value: unknown, path: string): Block => {
  const fields = fieldsOf(value, path, ["kind", "caption", "columns", "rows"]);
  const caption = optional(fields.caption, (caption) => textOf(caption, `${path}.caption`));
  const columns = listOf(fields.columns, `${path}.columns`, textOf);
  const rows = listOf(fields.rows, `${path}.rows`, (row, at) => {
    if (!Array.isArray(row) || row.length !== columns.length) fail(at, `is not a row of ${columns.length} cells, one for each column.`);
    // An empty string is an empty cell.
    return row.map((cell, index): RichText => (cell === "" ? [] : richText(cell, `${at}[${index}]`)));
  });
  return { kind: "table", ...(caption === undefined ? {} : { caption }), columns, rows };
};

/** {"use": name}: a block the scripts build from the collected data, with a heading in a section of its own, or the timeline under its own heading. */
const dataBlock = (value: unknown, path: string, context: Context): Block[] => {
  const fields = fieldsOf(value, path, ["use", "heading", "collapsed"]);
  const heading = optional(fields.heading, (heading) => textOf(heading, `${path}.heading`));
  const collapsed = optional(fields.collapsed, (collapsed) => booleanOf(collapsed, `${path}.collapsed`));
  if (fields.use === "timeline") {
    if (collapsed !== undefined) fail(`${path}.collapsed`, "is not for the timeline, which always shows.");
    const titles = context.parts?.parts.map((part) => part.title) ?? [];
    return [timelineBlock(context.collected, heading ?? "Timeline", titles, context.names)];
  }
  const name = DATA_NAMES.find((known) => known === fields.use);
  if (name === undefined) fail(`${path}.use`, `names no data block; the data blocks are ${DATA_BLOCKS.join(", ")}.`);
  const { blocks, note } = DATA[name](context.collected);
  if (heading === undefined) {
    if (collapsed !== undefined) fail(`${path}.collapsed`, "needs a heading, because only a section folds away.");
    return [...blocks];
  }
  if (blocks.length === 0) return [];
  return [{ kind: "section", heading, ...(note === undefined ? {} : { note }), ...(collapsed === undefined ? {} : { collapsed }), blocks }];
};

const composeBlocks = (value: unknown, path: string, context: Context): Block[] => {
  if (!Array.isArray(value)) fail(path, "is not a list of blocks.");
  return value.flatMap((block, index) => composeBlock(block, `${path}[${index}]`, context));
};

// A section whose blocks all came out empty, such as a list of appointments on a day without any, is left out.
const sectionBlock = (value: unknown, path: string, context: Context): Block[] => {
  const fields = fieldsOf(value, path, ["kind", "heading", "note", "collapsed", "blocks"]);
  const heading = textOf(fields.heading, `${path}.heading`);
  const note = optional(fields.note, (note) => textOf(note, `${path}.note`));
  const collapsed = optional(fields.collapsed, (collapsed) => booleanOf(collapsed, `${path}.collapsed`));
  const blocks = composeBlocks(fields.blocks, `${path}.blocks`, context);
  if (blocks.length === 0) return [];
  return [{ kind: "section", heading, ...(note === undefined ? {} : { note }), ...(collapsed === undefined ? {} : { collapsed }), blocks }];
};

const composeBlock = (value: unknown, path: string, context: Context): Block[] => {
  if (!isObject(value)) fail(path, `is not a block: an object with a kind, or {"use": name}.`);
  if ("use" in value) return dataBlock(value, path, context);
  switch (value.kind) {
    case "section":
      return sectionBlock(value, path, context);
    case "paragraph": {
      // A text with blank lines makes a paragraph each.
      const fields = fieldsOf(value, path, ["kind", "text"]);
      const texts = typeof fields.text === "string" ? paragraphs(fields.text, `${path}.text`) : [richText(fields.text, `${path}.text`)];
      return texts.map((text) => ({ kind: "paragraph", text }));
    }
    case "parts":
      // partsOf has read and checked it.
      return context.parts === null ? [] : [context.parts];
    case "facts": {
      const fields = fieldsOf(value, path, ["kind", "items"]);
      const items = listOf(fields.items, `${path}.items`, (item, at) => {
        const fact = fieldsOf(item, at, ["term", "details"]);
        return { term: textOf(fact.term, `${at}.term`), details: paragraphs(fact.details, `${at}.details`) };
      });
      return [{ kind: "facts", items }];
    }
    case "list":
      return [{ kind: "list", items: listOf(fieldsOf(value, path, ["kind", "items"]).items, `${path}.items`, listItem) }];
    case "callout": {
      const fields = fieldsOf(value, path, ["kind", "tone", "text"]);
      if (fields.tone !== "note" && fields.tone !== "warning") fail(`${path}.tone`, 'is not "note" or "warning".');
      return [{ kind: "callout", tone: fields.tone, text: richText(fields.text, `${path}.text`) }];
    }
    case "table":
      return [tableBlock(value, path)];
    case "tiles":
    case "timeline":
      return fail(path, `is a ${value.kind} block, which the scripts build from the collected data; write {"use": "${value.kind}"} instead.`);
    default:
      return fail(
        path,
        `has kind ${JSON.stringify(value.kind)}, which is no block; the kinds are ${KINDS.join(", ")}, and {"use": name} places a data block: ${DATA_BLOCKS.join(", ")}.`,
      );
  }
};

/** Where the agent's blocks hold a parts block, also within sections. */
const partsBlocksIn = (value: unknown, path: string): { readonly value: Fields; readonly path: string }[] =>
  Array.isArray(value)
    ? value.flatMap((block, index) => {
        const at = `${path}[${index}]`;
        if (!isObject(block)) return [];
        if (block.kind === "parts") return [{ value: block, path: at }];
        return block.kind === "section" ? partsBlocksIn(block.blocks, `${at}.blocks`) : [];
      })
    : [];

/**
 * The day's one parts block, with a title and text for each entry of reportInputs.parts, in order, and the parts' times added. It is read before the other blocks, because the timeline names the parts by their titles wherever it is placed.
 */
const partsOf = (blocks: unknown, collected: Collected): PartsBlock | null => {
  const [found, second] = partsBlocksIn(blocks, "blocks");
  const dayParts = collected.reportInputs.parts;
  if (found === undefined) {
    if (dayParts.length === 0) return null;
    fail("blocks", `hold no parts block, but the day has ${dayParts.length} parts. Write one, with an entry per entry of reportInputs.parts, in order.`);
  }
  if (dayParts.length === 0) fail(found.path, "is a parts block, but the day has no parts.");
  if (second !== undefined) fail(second.path, "is a second parts block; the day's parts all go in one.");
  const written = fieldsOf(found.value, found.path, ["kind", "parts"]).parts;
  if (!Array.isArray(written)) fail(`${found.path}.parts`, "is not a list of parts.");
  if (written.length !== dayParts.length)
    fail(`${found.path}.parts`, `has ${written.length} parts, but the day has ${dayParts.length}. Write one entry per entry of reportInputs.parts, in order.`);
  return {
    kind: "parts",
    parts: dayParts.map((part, index) => {
      const at = `${found.path}.parts[${index}]`;
      const fields = fieldsOf(written[index], at, ["title", "text"]);
      const title = textOf(fields.title, `${at}.title`);
      if (title.length > PART_TITLE_MAX_LENGTH) fail(`${at}.title`, `has ${title.length} characters; the limit is ${PART_TITLE_MAX_LENGTH}.`);
      return { title, start: part.start, end: part.end, text: paragraphs(fields.text, `${at}.text`) };
    }),
  };
};

// Optional, and only for the day's threads, so a name always has a row or a conversation it belongs to.
const threadNames = (threads: unknown, collected: Collected): Map<string, string> => {
  if (threads === undefined) return new Map();
  if (!isObject(threads)) fail("threads", "is not an object of names by thread id.");
  const dayIds = new Set([...collected.timeline.threads.items, ...collected.conversations.items].map((thread) => thread.id));
  return new Map(
    Object.entries(threads).map(([id, name]) => {
      if (!dayIds.has(id)) fail(`threads.${id}`, "is not one of the day's threads.");
      return [id, textOf(name, `threads.${id}`)];
    }),
  );
};

/** Reads the agent's JSON and composes the day's report document from it. */
export const composeDocument = (raw: string, collected: Collected): ReportDocument => {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`The report is not JSON. Pipe ${SHAPE}.`);
  }
  const report = fieldsOf(value, "report", ["threads", "blocks"]);
  const names = threadNames(report.threads, collected);
  const parts = partsOf(report.blocks, collected);
  const blocks = composeBlocks(report.blocks, "blocks", { collected, names, parts });
  if (blocks.length === 0) fail("blocks", "make an empty report.");
  return { version: REPORT_DOCUMENT_VERSION, blocks };
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

/** The stdin of `postlude agent-area check <day>` and `postlude agent-area put <day>`. */
export const agentAreaPayload = (collected: Collected, reportDocument: ReportDocument, model: string) => ({
  dayMetrics: collected.dayMetrics,
  metricsVersion: collected.dayMetrics.metricsVersion,
  reportDocument,
  reportModel: modelDisplayName(model),
});
