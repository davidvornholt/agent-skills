// The activity summary's focus rule, ported from focus_blocks in nix-config's bin/activity-digest so the tests can hold the test summary to it. The scripts never apply it themselves: they read the summary's focus blocks.

import type { TimelinePiece } from "../metrics.ts";

const FOCUS_MIN_MS = 25 * 60_000;
const SWITCH_GRACE_MS = 2 * 60_000;

export type RuleBlock = { readonly start: number; readonly end: number; readonly category: string; readonly activeMs: number };

/**
 * A run starts at a piece of some category and extends to the next piece of that category that starts less than two minutes after the run's current end, taking in whatever lies between. It is a focus block if its active time, what it took in included, is at least 25 minutes; the scan then goes on after it, and otherwise at the next piece. Time in no category never starts a run.
 */
export const focusBlocks = (timeline: readonly TimelinePiece[]): RuleBlock[] => {
  const blocks: RuleBlock[] = [];
  let index = 0;
  while (index < timeline.length) {
    const first = timeline[index] as TimelinePiece;
    if (first.category === null) {
      index += 1;
      continue;
    }
    let last = index;
    let runEnd = first.end;
    for (let probe = index + 1; probe < timeline.length; probe += 1) {
      const piece = timeline[probe] as TimelinePiece;
      if (piece.start - runEnd >= SWITCH_GRACE_MS) break;
      if (piece.category === first.category) {
        last = probe;
        runEnd = piece.end;
      }
    }
    const activeMs = timeline.slice(index, last + 1).reduce((sum, piece) => sum + piece.end - piece.start, 0);
    if (activeMs >= FOCUS_MIN_MS) {
      blocks.push({ start: first.start, end: runEnd, category: first.category, activeMs });
      index = last + 1;
    } else {
      index += 1;
    }
  }
  return blocks;
};
