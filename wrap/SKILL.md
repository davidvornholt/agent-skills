---
name: wrap
description: Close one journal day by storing its metrics and a visual day report in Postlude's agent area. A versioned script computes every number, and the agent writes only a short neutral summary. Never touches journal text or ratings.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# End-of-day wrap

/wrap stores one journal day's metrics and report in Postlude's agent area. A journal day runs from 04:00 to 04:00 Europe/Berlin. Postlude keeps the user's journal text, scripture, and rating in their own area, which this skill never writes.

The scripts own every number and list. `collect` reads the sources without changing them and computes the day metrics, and `render` fills the report template. You write only the summary. Don't compute, estimate, or correct numbers yourself, because Postlude compares days only when the same script version produced them.

## Run it

1. Pick the day: the current journal day, the one before it for `yesterday`, or the given date. Before 04:00 the current journal day is still the previous date.
2. Collect. Missing sources don't fail the command: they appear in `dayMetrics.coverage` and are explained in `problems`.

   ```sh
   DAY=<YYYY-MM-DD>
   bun ~/.claude/skills/wrap/scripts/wrap.ts collect "$DAY" > "/tmp/wrap-$DAY.json"
   ```

3. Read `reportInputs` and `problems`. If the user can fix a missing source now, such as Super Productivity not running on the X1, say so and offer to collect again. Otherwise continue, because the report shows a missing source as a gap rather than as zero.
4. Write two to four plain sentences that describe what the day held, based on the lists. Don't rate, judge, or advise, and don't use digits: `render` rejects them, because the report takes its numbers only from the metrics.
5. Render and store. Re-running for a day replaces only the agent area, so it's safe after fixing a source.

   ```sh
   bun ~/.claude/skills/wrap/scripts/wrap.ts render "/tmp/wrap-$DAY.json" --model <your model id> <<'EOF' | postlude agent-area put "$DAY"
   <summary>
   EOF
   ```

6. Check with `postlude agent-area get "$DAY"`, then tell the user the report is in Postlude and which sources were missing.

## Sources

`collect` reaches Super Productivity on the X1 with `--host david-x1-nixos` unless `SP_HOST` is set or it runs on the X1, and it reads T3 Code threads from the z890 over SSH when it runs elsewhere.

Off-computer time is the time tracked in Super Productivity on tasks tagged `off-computer`, or on subtasks of a task with that tag. Without the tag, the metric is null and `sp` coverage is partial.

## Changing the metrics or report

The definitions are in `scripts/metrics.ts`. Bump `METRICS_VERSION` with any change to a definition, even when the output shape stays the same, because Postlude doesn't compare days of different versions.

`report/template.html` follows Postlude's report contract: one self-contained file with no network access, whose numbers appear only in `data-metric` elements filled from Postlude's `postlude:day-metrics` message. Run `bun run check` from the repository root after any change.
