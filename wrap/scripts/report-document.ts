// The day report document that `postlude agent-area put` stores and Postlude draws. Postlude owns the schema (apps/web/src/features/journal/schemas/day-report-*.ts in the postlude repository) and `postlude agent-area check` holds a document to it; these types mirror it for the scripts that build one.
//
// A document is a list of blocks. Text is plain or restricted rich text: a list of spans that are each plain, emphasised, inline code, or an http(s) link. There is no markup. Numbers are values, such as { minutes: 65 }, and times ISO instants with their offset, so Postlude writes them.

export const REPORT_DOCUMENT_VERSION = 1;

/** The longest label or heading Postlude takes: a tile's or a row's label, a list item's meta, a section's heading. */
export const LABEL_MAX_LENGTH = 200;

export type Span = string | { readonly emphasis: string } | { readonly code: string } | { readonly link: string; readonly href: string };
export type RichText = readonly Span[];

export type ItemTime = { readonly at: string } | { readonly start: string; readonly end: string } | { readonly allDay: true };
export type TileValue = { readonly minutes: number } | { readonly count: number } | null;

export type PullRequestRef = { readonly repository: string; readonly number: number; readonly title: string };

/**
 * Whether a stretch of screen time counted as focus by the activity summary's rule. counted gives the summary's focus block within it, with its minutes at the computer; short the stretch's minutes at the computer, which fall short of needs; noArea is a stretch in no area, which never counts; notCounted a stretch that didn't count although it was long enough, because its start counted toward a focus block of the area named in within.
 */
export type ScreenFocus =
  | { readonly status: "counted"; readonly start: string; readonly end: string; readonly minutes: number }
  | { readonly status: "short"; readonly minutes: number; readonly needs: number }
  | { readonly status: "noArea" }
  | { readonly status: "notCounted"; readonly within?: string };

export type ScreenMark = {
  readonly kind: "screen";
  readonly start: string;
  readonly end: string;
  /** The row's screen time inside the stretch, without the gaps it joins. */
  readonly minutes: number;
  readonly apps?: readonly { readonly name: string; readonly minutes: number }[];
  /** The T3 projects the stretch went to, most time first. */
  readonly projects?: readonly string[];
  /** The threads of the row's area the user prompted in the stretch, the first prompted first, and how many more there were. */
  readonly threads?: readonly string[];
  readonly moreThreads?: number;
  /** The titles of the user's own windows in front longest, at most three. */
  readonly windows?: readonly string[];
  readonly focus?: ScreenFocus;
};

export type TimelineMark =
  | { readonly kind: "part"; readonly start: string; readonly end: string; readonly number: number; readonly title?: string }
  | ScreenMark
  | { readonly kind: "focus"; readonly start: string; readonly end: string; readonly minutes: number }
  | { readonly kind: "run"; readonly start: string; readonly end: string; readonly pullRequests?: readonly PullRequestRef[] }
  | { readonly kind: "prompt"; readonly at: string; readonly fromPhone?: true }
  | { readonly kind: "appointment"; readonly start: string; readonly end: string; readonly title: string }
  | ({ readonly kind: "pullRequest"; readonly at: string; readonly summary?: string } & PullRequestRef)
  | { readonly kind: "mail"; readonly at: string; readonly mailbox: string; readonly subject?: string };

export type TimelineRow = {
  readonly label: string;
  readonly note?: string;
  readonly total?: { readonly minutes: number };
  readonly marks: readonly TimelineMark[];
};

export type TimelineGroup = { readonly title: string; readonly rows: readonly TimelineRow[] };

export type TimelineBlock = {
  readonly kind: "timeline";
  readonly heading: string;
  readonly groups: readonly TimelineGroup[];
  readonly notes?: readonly string[];
};

export type SectionBlock = {
  readonly kind: "section";
  readonly heading: string;
  readonly note?: string;
  readonly collapsed?: boolean;
  readonly blocks: readonly Block[];
};

export type ParagraphBlock = { readonly kind: "paragraph"; readonly text: RichText };
export type PartsBlock = {
  readonly kind: "parts";
  readonly parts: readonly { readonly title: string; readonly start: string; readonly end: string; readonly text: readonly RichText[] }[];
};
export type FactsBlock = { readonly kind: "facts"; readonly items: readonly { readonly term: string; readonly details: readonly RichText[] }[] };
export type ListItem = { readonly text: RichText; readonly time?: ItemTime; readonly meta?: string };
export type ListBlock = { readonly kind: "list"; readonly items: readonly ListItem[] };
export type CalloutBlock = { readonly kind: "callout"; readonly tone: "note" | "warning"; readonly text: RichText };
export type Tile = { readonly label: string; readonly value: TileValue; readonly note?: RichText };
export type TilesBlock = { readonly kind: "tiles"; readonly label?: string; readonly tiles: readonly Tile[] };
export type TableBlock = {
  readonly kind: "table";
  readonly caption?: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly RichText[])[];
};

export type Block = SectionBlock | ParagraphBlock | PartsBlock | FactsBlock | ListBlock | CalloutBlock | TilesBlock | TimelineBlock | TableBlock;

export type ReportDocument = { readonly version: typeof REPORT_DOCUMENT_VERSION; readonly blocks: readonly Block[] };

/** A label cut to the length Postlude takes, with an ellipsis where it was cut. */
export const label = (text: string): string => (text.length <= LABEL_MAX_LENGTH ? text : `${text.slice(0, LABEL_MAX_LENGTH - 1).trimEnd()}…`);

/** A repository as the report names it: as the pull request's ref ("name#12", or "owner/name#12" when two of the day's repositories share a name) does. */
export const repositoryName = (pr: { readonly ref: string }): string => label(pr.ref.slice(0, pr.ref.lastIndexOf("#")));

export const note = (text: string): CalloutBlock => ({ kind: "callout", tone: "note", text: [text] });
