// Draws the day's timeline as static HTML: each mark is placed in percent of the drawn hours, and its tooltip gives the times. The parts' paragraphs describe the same day in words, so the drawing is an image to assistive technology.

import { compareText } from "./compare.ts";
import { toBerlinClock } from "./day.ts";
import type { Collected } from "./day-report.ts";
import { clockRange, escapeHtml, minutesText } from "./html.ts";
import { clip, type Interval, joinGaps, totalMinutes, totalMs, union } from "./intervals.ts";
import type { List } from "./report-inputs.ts";
import { type AgentRun, projectLabel, UNCATEGORISED } from "./timeline.ts";

/** The T3 projects drawn as rows of their own; the rest share one row. */
export const TIMELINE_PROJECTS = 6;
/** A row's screen time draws as one mark across gaps shorter than this, because a day has hundreds of pieces, half of them shorter than ten seconds. */
export const MARK_GAP_MINUTES = 2;
/** The thread titles a tooltip names for a stretch of agent work. */
const TIP_THREADS = 3;
const HOUR_MS = 3_600_000;

type Mark = Interval & { readonly kind: "screen" | "focus" | "agent" | "appointment" | "tick"; readonly tip: string };
type Row = { readonly label: string; readonly marks: readonly Mark[] };
type Group = { readonly title: string; readonly rows: readonly Row[]; readonly className?: string };

const spanTip = (label: string, interval: Interval, minutes = (interval.end - interval.start) / 60_000): string =>
  `${label} · ${clockRange(interval.start, interval.end)} (${minutesText(minutes)})`;

// The tooltip counts only the screen time in the mark, not the gaps it spans.
const screenMarks = (label: string, intervals: readonly Interval[]): Mark[] =>
  joinGaps(intervals, MARK_GAP_MINUTES * 60_000).map((mark) => ({
    ...mark,
    kind: "screen",
    tip: spanTip(label, mark, totalMs(clip(intervals, mark)) / 60_000),
  }));

const agentMarks = (runs: readonly AgentRun[]): Mark[] =>
  union(runs).map((interval) => {
    const titles = [...new Set(runs.filter((run) => run.start < interval.end && run.end > interval.start).map((run) => run.threadTitle || "Untitled thread"))];
    const named = titles.slice(0, TIP_THREADS).join("; ");
    const more = titles.length > TIP_THREADS ? `; and ${titles.length - TIP_THREADS} more` : "";
    return { ...interval, kind: "agent", tip: `${spanTip("Agents", interval)} · ${named}${more}` };
  });

const areaGroup = (collected: Collected): Group => {
  const { pieces, focusBlocks, categoryLabels } = collected.timeline;
  const byCategory = new Map<string | null, Interval[]>();
  for (const piece of pieces) byCategory.set(piece.category, [...(byCategory.get(piece.category) ?? []), piece]);
  const label = (category: string | null) => (category === null ? UNCATEGORISED : (categoryLabels[category] ?? category));
  const rows = [...byCategory]
    .map(([category, intervals]) => ({ category, intervals, minutes: totalMinutes(intervals) }))
    .toSorted((a, b) => Number(a.category === null) - Number(b.category === null) || b.minutes - a.minutes || compareText(label(a.category), label(b.category)))
    .map(({ category, intervals }) => ({
      label: label(category),
      marks: [
        ...screenMarks(label(category), intervals),
        ...focusBlocks
          .filter((block) => block.category === category)
          .map((block): Mark => ({ ...block, kind: "focus", tip: spanTip(`Focus on ${label(category)}`, block) })),
      ],
    }));
  return { title: "Your screen time by area", rows };
};

const projectGroup = (collected: Collected): Group => {
  const projects = new Map<string, { screen: Interval[]; runs: AgentRun[] }>();
  const project = (path: string) => {
    const entry = projects.get(path) ?? { screen: [], runs: [] };
    projects.set(path, entry);
    return entry;
  };
  for (const piece of collected.timeline.pieces) if (piece.project !== null) project(piece.project).screen.push(piece);
  for (const run of collected.timeline.agentRuns.items) project(run.project).runs.push(run);
  const ranked = [...projects]
    .map(([path, entry]) => ({ path, ...entry, minutes: totalMinutes(entry.screen) + totalMinutes(entry.runs) }))
    .toSorted((a, b) => b.minutes - a.minutes || compareText(a.path, b.path));
  const shown = ranked.slice(0, TIMELINE_PROJECTS);
  const rest = ranked.slice(TIMELINE_PROJECTS);
  if (rest.length > 0) shown.push({ path: "", screen: rest.flatMap((entry) => entry.screen), runs: rest.flatMap((entry) => entry.runs), minutes: 0 });
  const rows = shown.map(({ path, screen, runs }) => {
    const label = path === "" ? "Other projects" : projectLabel(path);
    return { label, marks: [...agentMarks(runs), ...screenMarks(`You in ${label}`, screen)] };
  });
  return { title: "T3 Code projects", rows, className: "tl-projects" };
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
    rows.push({
      label: "Pull requests",
      marks: landedPrs.items.map((pr) => {
        const at = Date.parse(pr.mergedAt);
        return { start: at, end: at, kind: "tick", tip: `${projectLabel(pr.repository)}: ${pr.title} · ${toBerlinClock(at)}` };
      }),
    });
  }
  return { title: "Appointments and landed pull requests", rows };
};

const percent = (value: number): string => `${Number(value.toFixed(3))}%`;

const renderMark = (mark: Mark, axis: Interval): string => {
  const span = axis.end - axis.start;
  const [shown] = clip([{ start: mark.start, end: Math.max(mark.end, mark.start + 1) }], axis);
  if (shown === undefined) return "";
  const left = percent(((shown.start - axis.start) / span) * 100);
  const width = mark.kind === "tick" ? "" : `;width:${percent(((shown.end - shown.start) / span) * 100)}`;
  return `<span class="tl-mark tl-${mark.kind}" style="left:${left}${width}" data-tip="${escapeHtml(mark.tip)}"></span>`;
};

const renderAxis = (axis: Interval): string => {
  const hours = (axis.end - axis.start) / HOUR_MS;
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : 3;
  const labels: string[] = [];
  for (let hour = 0; hour < hours; hour += step) {
    const at = axis.start + hour * HOUR_MS;
    labels.push(`<span style="left:${percent((hour / hours) * 100)}">${toBerlinClock(at)}</span>`);
  }
  return `<div class="tl-row tl-axis"><span></span><span class="tl-ticks">${labels.join("")}</span></div>`;
};

const renderTracked = (tasks: List<{ readonly title: string; readonly project: string | null; readonly minutes: number }>): string => {
  const heading = "<h3>Tracked in Super Productivity</h3>";
  if (tasks.status === "missing") return `${heading}<p class="empty">Super Productivity was not available.</p>`;
  if (tasks.items.length === 0) return `${heading}<p class="empty">Nothing tracked.</p>`;
  const items = tasks.items.map((task) => {
    const meta = [task.project, minutesText(task.minutes)].filter((part) => part !== null).join(" · ");
    return `<li>${escapeHtml(task.title)} <span class="meta">· ${escapeHtml(meta)}</span></li>`;
  });
  return `${heading}<ul class="items">${items.join("")}</ul>`;
};

export const renderTimeline = (collected: Collected): string => {
  const groups = [areaGroup(collected), projectGroup(collected), eventGroup(collected)].filter((group) => group.rows.length > 0);
  const day = { start: Date.parse(collected.window.start), end: Date.parse(collected.window.end) };
  const marks = groups.flatMap((group) => group.rows.flatMap((row) => row.marks));
  const tracked = renderTracked(collected.reportInputs.trackedTasks);
  const partial =
    collected.timeline.status === "partial"
      ? `<p class="meta">Some computers' activity wasn't fully read, so some screen time may be missing.</p>`
      : collected.timeline.status === "missing"
        ? `<p class="meta">Screen activity was not available.</p>`
        : "";
  const agentsMissing = collected.timeline.agentRuns.status === "missing" ? `<p class="meta">T3 Code was not available, so agent work is missing.</p>` : "";
  if (marks.length === 0) return `<section><h2>Timeline</h2><p class="empty">Nothing recorded.</p>${partial}${agentsMissing}${tracked}</section>`;
  // Whole hours from the first to the last mark, within the journal day.
  const first = Math.min(...marks.map((mark) => mark.start));
  const last = Math.max(...marks.map((mark) => mark.end));
  const axis = {
    start: Math.max(day.start, day.start + Math.floor((first - day.start) / HOUR_MS) * HOUR_MS),
    end: Math.min(day.end, day.start + Math.ceil((last - day.start) / HOUR_MS + 1e-9) * HOUR_MS),
  };
  const hours = (axis.end - axis.start) / HOUR_MS;
  const body = groups
    .map(
      (group) =>
        `<p class="tl-group">${escapeHtml(group.title)}</p>${group.rows
          .map(
            (row) =>
              `<div class="tl-row${group.className ? ` ${group.className}` : ""}"><span class="tl-label">${escapeHtml(row.label)}</span><span class="tl-track">${row.marks.map((mark) => renderMark(mark, axis)).join("")}</span></div>`,
          )
          .join("")}`,
    )
    .join("");
  const legend = [
    ["tl-screen", "Your screen time"],
    ["tl-focus", "Focus"],
    ["tl-agent", "Agents working"],
    ["tl-appointment", "Appointment"],
    ["tl-tick", "Pull request landed"],
  ]
    .map(([kind, label]) => `<li><span class="swatch ${kind}"></span>${label}</li>`)
    .join("");
  return `<section>
    <h2>Timeline</h2>
    <div class="timeline" role="img" aria-label="A timeline of the day; the day in parts describes it in words." style="--hours:${hours}">${renderAxis(axis)}${body}</div>
    <ul class="legend">${legend}</ul>${partial}${agentsMissing}
    ${tracked}
  </section>`;
};
