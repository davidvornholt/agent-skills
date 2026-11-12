// The agent names a pull request by what it changes, so it needs more than the title. The user's pull requests say what changed in a "**Now.**" paragraph, and most others open with a paragraph of prose.

export const PR_SUMMARY_MAX_LENGTH = 320;

/** A block that isn't prose: a heading, a list item, a quote, a table, code, HTML, or a "Stacked on" or "Opened by" note. */
const NOT_PROSE = /^(#|[-*+] |\d+[.)] |>|\||```|~~~|<|(Stacked on|Opened by)\b)/i;
// A bold label that opens a paragraph, such as "**Now.**" or "**Cause.**".
const LABEL = /^\*\*[^*\n]{1,40}?[.:]\*\*\s*/;
const MIN_PROSE_LENGTH = 40;

const plain = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** Cuts at the last sentence that ends within the limit, or else at a word, with an ellipsis. */
const capped = (text: string): string => {
  if (text.length <= PR_SUMMARY_MAX_LENGTH) return text;
  const head = text.slice(0, PR_SUMMARY_MAX_LENGTH + 1);
  const sentenceEnd = Math.max(...[". ", "! ", "? "].map((end) => head.lastIndexOf(end)));
  if (sentenceEnd >= PR_SUMMARY_MAX_LENGTH / 3) return head.slice(0, sentenceEnd + 1);
  const wordEnd = head.lastIndexOf(" ", PR_SUMMARY_MAX_LENGTH - 1);
  return `${head.slice(0, wordEnd > 0 ? wordEnd : PR_SUMMARY_MAX_LENGTH - 1)}…`;
};

/** A plain summary of a pull request's description: its "**Now.**" paragraph, or else its first paragraph of prose, capped at PR_SUMMARY_MAX_LENGTH characters. */
export const prSummary = (body: unknown): string | null => {
  if (typeof body !== "string") return null;
  // A paragraph's prose ends where a list or another block begins without a blank line.
  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((block) => {
      const lines = block.trim().split("\n");
      const end = lines.findIndex((line, index) => index > 0 && NOT_PROSE.test(line.trim()));
      return (end === -1 ? lines : lines.slice(0, end)).join(" ").trim();
    })
    .filter((paragraph) => paragraph !== "" && !NOT_PROSE.test(paragraph));
  const now = paragraphs.find((paragraph) => /^\*\*Now\.\*\*/.test(paragraph));
  const chosen = now ?? paragraphs.map((paragraph) => paragraph.replace(LABEL, "")).find((paragraph) => plain(paragraph).length >= MIN_PROSE_LENGTH);
  if (chosen === undefined) return null;
  const text = plain(chosen.replace(LABEL, ""));
  return text === "" ? null : capped(text);
};

/** The longest summary a pull request's card in the timeline shows. */
export const CARD_SUMMARY_MAX_LENGTH = 240;

/** A summary as a pull request's card shows it: its first two sentences where they fit, or else its first, cut at a word with an ellipsis where it is too long. */
export const cardSummary = (summary: string): string => {
  const sentences = summary.split(/(?<=[.!?])\s+/);
  const [first = summary, second] = sentences;
  const two = second === undefined ? first : `${first} ${second}`;
  if (two.length <= CARD_SUMMARY_MAX_LENGTH) return two;
  if (first.length <= CARD_SUMMARY_MAX_LENGTH) return first;
  const wordEnd = first.lastIndexOf(" ", CARD_SUMMARY_MAX_LENGTH - 1);
  return `${first.slice(0, wordEnd > 0 ? wordEnd : CARD_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
};
