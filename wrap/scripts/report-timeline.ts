// The report's timeline block, built from the collected timeline. Every mark is a value that Postlude lays out and explains on hover, and a mark holds only what its card says. A card may name a mail's subject and the titles of the user's own windows, but never a word of a prompt or a conversation.

import { compareText } from "./compare.ts";
import { toBerlinIso } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { type Interval, totalMinutes, totalMs, union } from "./intervals.ts";
import type { TimelinePiece } from "./metrics.ts";
import { cardSummary } from "./pr-summary.ts";
import {
  LABEL_MAX_LENGTH,
  label,
  type PullRequestRef,
  repositoryName,
  type TimelineBlock,
  type TimelineGroup,
  type TimelineMark,
  type TimelineRow,
} from "./report-document.ts";
import { areaMarks } from "./screen-marks.ts";
import { projectLabel, type TimelineThread, threadTitle, UNCATEGORISED } from "./timeline.ts";

/** The threads drawn as rows of their own per area, those with the most prompts and then the most agent time; the rest share one row. */
export const THREADS_PER_AREA = 5;
const iso = (ms: number): string => toBerlinIso(ms);
const span = (interval: Interval) => ({ start: iso(interval.start), end: iso(interval.end) });

const areaLabel = (collected: Collected, category: string | null): string =>
  category === null ? UNCATEGORISED : (collected.timeline.categoryLabels[category] ?? category);

const areaGroup = (collected: Collected, names: ReadonlyMap<string, string>): TimelineGroup => {
  const { pieces } = collected.timeline;
  const byCategory = new Map<string | null, TimelinePiece[]>();
  for (const piece of pieces) byCategory.set(piece.category, [...(byCategory.get(piece.category) ?? []), piece]);
  const rows = [...byCategory]
    .map(([category, intervals]) => ({ category, intervals, label: areaLabel(collected, category), minutes: totalMinutes(intervals) }))
    .toSorted((a, b) => Number(a.category === null) - Number(b.category === null) || b.minutes - a.minutes || compareText(a.label, b.label))
    .map(
      ({ category, intervals, label: area, minutes }): TimelineRow => ({
        label: label(area),
        total: { minutes },
        marks: areaMarks({ category, pieces: intervals, areaLabel: (other) => areaLabel(collected, other) }, collected.timeline, names),
      }),
    );
  return { title: "Your screen time by area", rows };
};

const pullRequestRef = (pr: Collected["reportInputs"]["landedPrs"]["items"][number]): PullRequestRef => ({
  repository: repositoryName(pr),
  number: pr.number,
  title: label(pr.title),
});

const eventGroup = (collected: Collected): TimelineGroup => {
  const { appointments, landedPrs } = collected.reportInputs;
  const rows: TimelineRow[] = [];
  const timed = appointments.items.flatMap((event): TimelineMark[] =>
    event.start === null || event.end === null
      ? []
      : [{ kind: "appointment", ...span({ start: Date.parse(event.start), end: Date.parse(event.end) }), title: label(event.title) }],
  );
  if (timed.length > 0) rows.push({ label: "Calendar", marks: timed });
  if (landedPrs.items.length > 0) {
    rows.push({
      label: "Pull requests",
      marks: landedPrs.items.map(
        (pr): TimelineMark => ({
          kind: "pullRequest",
          at: iso(Date.parse(pr.mergedAt)),
          ...pullRequestRef(pr),
          ...(pr.summary === null ? {} : { summary: cardSummary(pr.summary) }),
        }),
      ),
    });
  }
  const mail = collected.timeline.sentMail.items;
  if (mail.length > 0)
    rows.push({
      label: "Sent mail",
      marks: mail.map(
        ({ at, mailbox, subject }): TimelineMark => ({
          kind: "mail",
          at: iso(at),
          mailbox: label(mailbox),
          ...(subject.trim() === "" ? {} : { subject: label(subject.trim()) }),
        }),
      ),
    });
  return { title: "Appointments, pull requests and mail", rows };
};

type Landed = TimelineThread["pullRequests"][number];

/** Each pull request goes to the last run that started by the time it merged, or to the first run when none had. */
const runMarks = (runs: readonly Interval[], landed: readonly Landed[], refs: ReadonlyMap<string, PullRequestRef>): TimelineMark[] => {
  const joined = union(runs);
  const byRun = joined.map((): PullRequestRef[] => []);
  for (const pr of landed) {
    const ref = refs.get(`${pr.repository}#${pr.number}`);
    if (ref === undefined) continue;
    const at = joined.findLastIndex((run) => run.start <= pr.mergedAt);
    byRun[Math.max(at, 0)]?.push(ref);
  }
  return joined.map((run, index): TimelineMark => {
    const pullRequests = byRun[index] ?? [];
    return { kind: "run", ...span(run), ...(pullRequests.length === 0 ? {} : { pullRequests }) };
  });
};

const threadMarks = (threads: readonly TimelineThread[], refs: ReadonlyMap<string, PullRequestRef>): TimelineMark[] => [
  ...runMarks(
    threads.flatMap((thread) => thread.runs),
    threads.flatMap((thread) => thread.pullRequests),
    refs,
  ),
  ...threads
    .flatMap((thread) => thread.prompts)
    .toSorted((a, b) => a.at - b.at)
    .map((prompt): TimelineMark => ({ kind: "prompt", at: iso(prompt.at), ...(prompt.fromPhone ? { fromPhone: true } : {}) })),
];

const firstActivity = (thread: TimelineThread): number => Math.min(...thread.runs.map((run) => run.start), ...thread.prompts.map((prompt) => prompt.at));

/** The names of the threads a shared row holds, as many as fit in a label, and how many more there are. */
const namesOf = (names: readonly string[]): string => {
  const text = (shown: number) => {
    const rest = names.length - shown;
    return [...names.slice(0, shown), ...(rest > 0 ? [`and ${rest} more`] : [])].join("; ");
  };
  let shown = 0;
  while (shown < names.length && text(shown + 1).length <= LABEL_MAX_LENGTH) shown += 1;
  return label(text(shown));
};

/**
 * One group per area, in the order of the screen time rows, so a thread sits under the screen time its project got. A row shows the agent's name for a thread where it gave one, and its note the T3 title, so the thread can still be found in T3 Code.
 */
const threadGroups = (collected: Collected, areaOrder: readonly string[], names: ReadonlyMap<string, string>): TimelineGroup[] => {
  const refs = new Map(collected.reportInputs.landedPrs.items.map((pr) => [`${pr.repository}#${pr.number}`, pullRequestRef(pr)]));
  const byArea = new Map<string, TimelineThread[]>();
  for (const thread of collected.timeline.threads.items) {
    const area = areaLabel(collected, thread.category);
    byArea.set(area, [...(byArea.get(area) ?? []), thread]);
  }
  const rank = (area: string) =>
    area === UNCATEGORISED ? Number.POSITIVE_INFINITY : areaOrder.indexOf(area) === -1 ? areaOrder.length : areaOrder.indexOf(area);
  return [...byArea]
    .toSorted(([a], [b]) => rank(a) - rank(b) || compareText(a, b))
    .map(([area, threads]) => {
      const ranked = threads.toSorted(
        (a, b) => b.prompts.length - a.prompts.length || totalMs(b.runs) - totalMs(a.runs) || compareText(a.title, b.title) || compareText(a.id, b.id),
      );
      const shown = ranked.slice(0, THREADS_PER_AREA).toSorted((a, b) => firstActivity(a) - firstActivity(b) || compareText(a.id, b.id));
      const rest = ranked.slice(THREADS_PER_AREA);
      const rows: TimelineRow[] = shown.map((thread) => {
        const name = names.get(thread.id);
        const project = projectLabel(thread.project);
        return {
          label: label(name ?? threadTitle(thread)),
          note: label(name === undefined ? project : `${threadTitle(thread)} · ${project}`),
          marks: threadMarks([thread], refs),
        };
      });
      if (rest.length > 0) {
        rows.push({
          label: rest.length === 1 ? "One other thread" : `${rest.length} other threads`,
          note: namesOf(rest.map((thread) => names.get(thread.id) ?? threadTitle(thread))),
          marks: threadMarks(rest, refs),
        });
      }
      return { title: label(`Threads · ${area}`), rows };
    });
};

const notesOf = (collected: Collected): string[] =>
  [
    collected.timeline.status === "partial"
      ? "Some computers' activity wasn't fully read, so some screen time may be missing."
      : collected.timeline.status === "missing"
        ? "Screen activity was not available."
        : null,
    collected.timeline.threads.status === "missing" ? "T3 Code was not available, so its threads are missing." : null,
    collected.timeline.sentMail.status === "partial" ? "Some mailboxes could not be read in full, so some sent mail may be missing." : null,
  ].filter((line) => line !== null);

/** The day's timeline, under its heading. titles holds the agent's title for each part, in order, and names its names for threads, by id. */
export const timelineBlock = (collected: Collected, heading: string, titles: readonly string[], names: ReadonlyMap<string, string>): TimelineBlock => {
  const areas = areaGroup(collected, names);
  const parts: TimelineRow = {
    label: "Parts",
    marks: collected.reportInputs.parts.map((part, index): TimelineMark => {
      const title = titles[index];
      return { kind: "part", start: part.start, end: part.end, number: index + 1, ...(title === undefined ? {} : { title }) };
    }),
  };
  const groups = [
    { title: "The day in parts", rows: parts.marks.length > 0 ? [parts] : [] },
    areas,
    eventGroup(collected),
    ...threadGroups(
      collected,
      areas.rows.map((row) => row.label),
      names,
    ),
  ].filter((group) => group.rows.length > 0);
  const notes = notesOf(collected);
  return { kind: "timeline", heading, groups, ...(notes.length === 0 ? {} : { notes }) };
};
