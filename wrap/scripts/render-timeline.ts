// Draws the day's timeline as static HTML: each mark is placed in percent of the drawn hours, and its tooltip gives the times. The parts' lines describe the same day in words, so the drawing is an image to assistive technology.

import { compareText } from "./compare.ts";
import { toBerlinClock } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { clockRange, escapeHtml, minutesText } from "./html.ts";
import { clip, type Interval, joinGaps, totalMinutes, totalMs, union } from "./intervals.ts";
import type { List } from "./report-inputs.ts";
import { projectLabel, type TimelineThread, UNCATEGORISED } from "./timeline.ts";

/** The threads drawn as rows of their own per area, those with the most prompts and then the most agent time; the rest share one row. */
export const THREADS_PER_AREA = 5;
/** A row's screen time draws as one mark across gaps shorter than this, because a day has hundreds of pieces, half of them shorter than ten seconds. */
export const MARK_GAP_MINUTES = 2;
/** The thread titles the tooltip of an area's shared row names. */
const TIP_THREADS = 5;
const HOUR_MS = 3_600_000;

type MarkKind = "screen" | "focus" | "run" | "prompt" | "phone" | "appointment" | "tick" | "mail" | "part";
type Mark = Interval & { readonly kind: MarkKind; readonly tip: string; readonly text?: string };
type Row = { readonly label: string; readonly tip?: string; readonly marks: readonly Mark[] };
type Group = { readonly title: string; readonly rows: readonly Row[] };

const spanTip = (label: string, interval: Interval, minutes = (interval.end - interval.start) / 60_000): string =>
  `${label} · ${clockRange(interval.start, interval.end)} (${minutesText(minutes)})`;

const instant = (kind: MarkKind, at: number, tip: string): Mark => ({ start: at, end: at, kind, tip: `${tip} · ${toBerlinClock(at)}` });

// The tooltip counts only the screen time in the mark, not the gaps it spans.
const screenMarks = (label: string, intervals: readonly Interval[]): Mark[] =>
  joinGaps(intervals, MARK_GAP_MINUTES * 60_000).map((mark) => ({
    ...mark,
    kind: "screen",
    tip: spanTip(label, mark, totalMs(clip(intervals, mark)) / 60_000),
  }));

const areaLabel = (collected: Collected, category: string | null): string =>
  category === null ? UNCATEGORISED : (collected.timeline.categoryLabels[category] ?? category);

const areaGroup = (collected: Collected): Group => {
  const { pieces, focusBlocks } = collected.timeline;
  const byCategory = new Map<string | null, Interval[]>();
  for (const piece of pieces) byCategory.set(piece.category, [...(byCategory.get(piece.category) ?? []), piece]);
  const rows = [...byCategory]
    .map(([category, intervals]) => ({ category, intervals, label: areaLabel(collected, category), minutes: totalMinutes(intervals) }))
    .toSorted((a, b) => Number(a.category === null) - Number(b.category === null) || b.minutes - a.minutes || compareText(a.label, b.label))
    .map(({ category, intervals, label }) => ({
      label,
      marks: [
        ...screenMarks(label, intervals),
        ...focusBlocks
          .filter((block) => block.category === category)
          .map((block): Mark => ({ ...block, kind: "focus", tip: spanTip(`Focus on ${label}`, block) })),
      ],
    }));
  return { title: "Your screen time by area", rows };
};

const eventGroup = (collected: Collected): Group => {
  const { appointments, landedPrs } = collected.reportInputs;
  const rows: Row[] = [];
  const timed = appointments.items.flatMap((event) =>
    event.start === null || event.end === null ? [] : [{ title: event.title, start: Date.parse(event.start), end: Date.parse(event.end) }],
  );
  if (timed.length > 0) {
    rows.push({
      label: "Calendar",
      marks: timed.map((event) => ({ start: event.start, end: event.end, kind: "appointment", tip: spanTip(event.title, event) })),
    });
  }
  if (landedPrs.items.length > 0) {
    rows.push({ label: "Pull requests", marks: landedPrs.items.map((pr) => instant("tick", Date.parse(pr.mergedAt), `Landed ${pr.ref}: ${pr.title}`)) });
  }
  const mail = collected.timeline.sentMail.times;
  if (mail.length > 0) rows.push({ label: "Sent mail", marks: mail.map((at) => instant("mail", at, "Mail sent")) });
  return { title: "Appointments, pull requests and mail", rows };
};

const threadMarks = (runs: readonly Interval[], prompts: TimelineThread["prompts"]): Mark[] => [
  ...union(runs).map((run): Mark => ({ ...run, kind: "run", tip: spanTip("Agent running", run) })),
  ...prompts.map((prompt) => (prompt.fromPhone ? instant("phone", prompt.at, "Prompt from the phone") : instant("prompt", prompt.at, "Prompt"))),
];

const firstActivity = (thread: TimelineThread): number => Math.min(...thread.runs.map((run) => run.start), ...thread.prompts.map((prompt) => prompt.at));

/** One group per area, in the order of the screen time rows, so a thread sits under the screen time its project got. */
const threadGroups = (collected: Collected, areaOrder: readonly string[]): Group[] => {
  const byArea = new Map<string, TimelineThread[]>();
  for (const thread of collected.timeline.threads.items) {
    const label = areaLabel(collected, thread.category);
    byArea.set(label, [...(byArea.get(label) ?? []), thread]);
  }
  const rank = (label: string) =>
    label === UNCATEGORISED ? Number.POSITIVE_INFINITY : areaOrder.indexOf(label) === -1 ? areaOrder.length : areaOrder.indexOf(label);
  return [...byArea]
    .toSorted(([a], [b]) => rank(a) - rank(b) || compareText(a, b))
    .map(([label, threads]) => {
      const ranked = threads.toSorted(
        (a, b) => b.prompts.length - a.prompts.length || totalMs(b.runs) - totalMs(a.runs) || compareText(a.title, b.title) || compareText(a.id, b.id),
      );
      const shown = ranked.slice(0, THREADS_PER_AREA).toSorted((a, b) => firstActivity(a) - firstActivity(b) || compareText(a.id, b.id));
      const rest = ranked.slice(THREADS_PER_AREA);
      const rows: Row[] = shown.map((thread) => ({
        label: thread.title || "Untitled thread",
        tip: `${thread.title || "Untitled thread"} · ${projectLabel(thread.project)}`,
        marks: threadMarks(thread.runs, thread.prompts),
      }));
      if (rest.length > 0) {
        const titles = rest.map((thread) => thread.title || "Untitled thread");
        const more = titles.length > TIP_THREADS ? `; and ${titles.length - TIP_THREADS} more` : "";
        rows.push({
          label: rest.length === 1 ? "One other thread" : `${rest.length} other threads`,
          tip: `${titles.slice(0, TIP_THREADS).join("; ")}${more}`,
          marks: threadMarks(
            rest.flatMap((thread) => thread.runs),
            rest.flatMap((thread) => thread.prompts).toSorted((a, b) => a.at - b.at),
          ),
        });
      }
      return { title: `Threads · ${label}`, rows };
    });
};

const percent = (value: number): string => `${Number(value.toFixed(3))}%`;

const POINT_KINDS: ReadonlySet<MarkKind> = new Set(["tick", "mail", "prompt", "phone"]);

const renderMark = (mark: Mark, axis: Interval): string => {
  const span = axis.end - axis.start;
  const [shown] = clip([{ start: mark.start, end: Math.max(mark.end, mark.start + 1) }], axis);
  if (shown === undefined) return "";
  const left = percent(((shown.start - axis.start) / span) * 100);
  const width = POINT_KINDS.has(mark.kind) ? "" : `;width:${percent(((shown.end - shown.start) / span) * 100)}`;
  return `<span class="tl-mark tl-${mark.kind}" style="left:${left}${width}" data-tip="${escapeHtml(mark.tip)}">${escapeHtml(mark.text ?? "")}</span>`;
};

// A label every hour or two where the report is wide, and fewer where it is narrow: the template shows the minor labels only from its wide breakpoint.
const renderAxis = (axis: Interval): string => {
  const hours = (axis.end - axis.start) / HOUR_MS;
  const wideStep = hours <= 16 ? 1 : 2;
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : 4;
  const labels: string[] = [];
  for (let hour = 0; hour < hours; hour += wideStep) {
    const at = axis.start + hour * HOUR_MS;
    const minor = hour % step === 0 ? "" : ' class="minor"';
    labels.push(`<span${minor} style="left:${percent((hour / hours) * 100)}">${toBerlinClock(at)}</span>`);
  }
  return `<div class="tl-row tl-axis"><span></span><span class="tl-ticks">${labels.join("")}</span></div>`;
};

const renderTracked = (tasks: List<{ readonly title: string; readonly project: string | null; readonly minutes: number }>): string => {
  const heading = "<h2>Tracked in Super Productivity</h2>";
  if (tasks.status === "missing") return `<section>${heading}<p class="empty">Super Productivity was not available.</p></section>`;
  if (tasks.items.length === 0) return `<section>${heading}<p class="empty">Nothing tracked.</p></section>`;
  const items = tasks.items.map((task) => {
    const meta = [task.project, minutesText(task.minutes)].filter((part) => part !== null).join(" · ");
    return `<li>${escapeHtml(task.title)} <span class="meta">· ${escapeHtml(meta)}</span></li>`;
  });
  return `<section>${heading}<ul class="items">${items.join("")}</ul></section>`;
};

const LEGEND: readonly (readonly [string, string])[] = [
  ["tl-screen", "Your screen time"],
  ["tl-focus", "Focus"],
  ["tl-run", "Agent running"],
  ["tl-prompt", "Prompt"],
  ["tl-phone", "Prompt from the phone"],
  ["tl-appointment", "Appointment"],
  ["tl-tick", "Pull request landed"],
  ["tl-mail", "Mail sent"],
];

/** The timeline, as a section that may use the report's full width, and the time tracked in Super Productivity, which has no time of day, below it. titles holds the agent's title for each part, in order. */
export const renderTimeline = (collected: Collected, titles: readonly string[]): string => {
  const areas = areaGroup(collected);
  const partRow: Row = {
    label: "Parts",
    marks: collected.reportInputs.parts.map((part, index) => {
      const interval = { start: Date.parse(part.start), end: Date.parse(part.end) };
      return { ...interval, kind: "part", text: String(index + 1), tip: `${index + 1} · ${titles[index] ?? ""} · ${part.clock}` };
    }),
  };
  const groups = [
    { title: "The day in parts", rows: partRow.marks.length > 0 ? [partRow] : [] },
    areas,
    eventGroup(collected),
    ...threadGroups(
      collected,
      areas.rows.map((row) => row.label),
    ),
  ].filter((group) => group.rows.length > 0);
  const day = { start: Date.parse(collected.window.start), end: Date.parse(collected.window.end) };
  const marks = groups.flatMap((group) => group.rows.flatMap((row) => row.marks));
  const tracked = renderTracked(collected.reportInputs.trackedTasks);
  const partial =
    collected.timeline.status === "partial"
      ? `<p class="meta">Some computers' activity wasn't fully read, so some screen time may be missing.</p>`
      : collected.timeline.status === "missing"
        ? `<p class="meta">Screen activity was not available.</p>`
        : "";
  const threadsMissing = collected.timeline.threads.status === "missing" ? `<p class="meta">T3 Code was not available, so its threads are missing.</p>` : "";
  if (marks.length === 0) return `<section class="wide"><h2>Timeline</h2><p class="empty">Nothing recorded.</p>${partial}${threadsMissing}</section>${tracked}`;
  // Whole hours from the first to the last mark, within the journal day.
  const first = Math.min(...marks.map((mark) => mark.start));
  const last = Math.max(...marks.map((mark) => mark.end));
  const axis = {
    start: Math.max(day.start, day.start + Math.floor((first - day.start) / HOUR_MS) * HOUR_MS),
    end: Math.min(day.end, day.start + Math.ceil((last - day.start) / HOUR_MS + 1e-9) * HOUR_MS),
  };
  const hours = (axis.end - axis.start) / HOUR_MS;
  // A dashed line where each part after the first begins, through every row.
  const dividers = partRow.marks
    .slice(1)
    .map((mark) => `<span class="tl-divider" style="left:${percent(((mark.start - axis.start) / (axis.end - axis.start)) * 100)}"></span>`)
    .join("");
  const body = groups
    .map(
      (group) =>
        `<p class="tl-group">${escapeHtml(group.title)}</p>${group.rows
          .map((row) => {
            const tip = row.tip === undefined ? "" : ` data-tip="${escapeHtml(row.tip)}"`;
            return `<div class="tl-row"><span class="tl-label"${tip}>${escapeHtml(row.label)}</span><span class="tl-track">${dividers}${row.marks.map((mark) => renderMark(mark, axis)).join("")}</span></div>`;
          })
          .join("")}`,
    )
    .join("");
  const legend = LEGEND.map(([kind, label]) => `<li><span class="swatch ${kind}"></span>${label}</li>`).join("");
  return `<section class="wide">
    <h2>Timeline</h2>
    <div class="timeline" role="img" aria-label="A timeline of the day; the day in parts describes it in words." style="--hours:${hours}">${renderAxis(axis)}${body}</div>
    <ul class="legend">${legend}</ul>${partial}${threadsMissing}
  </section>
  ${tracked}`;
};
