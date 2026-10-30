// Half-open intervals [start, end) in epoch milliseconds.

export type Interval = { readonly start: number; readonly end: number };

export const union = (intervals: readonly Interval[]): Interval[] => {
  const sorted = intervals.filter((interval) => interval.end > interval.start).toSorted((a, b) => a.start - b.start || a.end - b.end);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, interval.end) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
};

export const clip = (intervals: readonly Interval[], window: Interval): Interval[] =>
  intervals
    .map((interval) => ({ start: Math.max(interval.start, window.start), end: Math.min(interval.end, window.end) }))
    .filter((interval) => interval.end > interval.start);

export const subtract = (from: readonly Interval[], remove: readonly Interval[]): Interval[] => {
  const removals = union(remove);
  const result: Interval[] = [];
  for (const interval of union(from)) {
    let cursor = interval.start;
    for (const removal of removals) {
      if (removal.end <= cursor) continue;
      if (removal.start >= interval.end) break;
      if (removal.start > cursor) result.push({ start: cursor, end: removal.start });
      cursor = Math.max(cursor, removal.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }
  return result;
};

/** Whole minutes covered by the union of the intervals, rounded once at the end. */
export const totalMinutes = (intervals: readonly Interval[]): number =>
  Math.round(union(intervals).reduce((sum, interval) => sum + interval.end - interval.start, 0) / 60_000);
