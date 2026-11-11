---
name: wrap
description: Use when the user asks to close a journal day.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# End-of-day wrap

A journal day runs from 04:00 to 04:00 Europe/Berlin. Postlude keeps the user's journal text, scripture, and rating in their own area, which this skill never writes.

You write only the summary and a short paragraph for each part of the day. Don't compute, estimate, or correct numbers yourself, because the scripts produce every number and Postlude compares days only when the same script version produced them.

## Run it

1. Pick the day: the current journal day, the one before it for `yesterday`, or the given date. Before 04:00 the current journal day is still the previous date.
2. Collect. Missing sources don't fail the command: they appear in `dayMetrics.coverage` and are explained in `problems`.

   ```sh
   DAY=<YYYY-MM-DD>
   bun ~/.claude/skills/wrap/scripts/wrap.ts collect "$DAY" > "/tmp/wrap-$DAY.json"
   ```

3. Read the collected day without the timeline, which only the renderer draws: `jq 'del(.timeline)' "/tmp/wrap-$DAY.json"`. Look at `reportInputs` and `problems`. If the user can fix a missing source now, such as Super Productivity running on neither host, say so and offer to collect again. Otherwise continue, because the report shows a missing source as a gap rather than as zero.
4. Write a `summary` of the day in two or three sentences. For each entry of `reportInputs.parts`, in order, write a short `title` and a `text` of three to five sentences about that entry and everything whose `part` is its index.

   Write for a reader who no longer remembers the work: say in everyday words what each thread, task or pull request you mention was about and what it changed, using a pull request's `summary` where it has one. Name projects, but not pull request numbers, files, commands or other jargon, because the reader can't look them up in the report. Keep the sentences short and plain, and tell the few things that mattered most rather than listing each one.

   It's the user's day, not the agents'. Describe what the user did in a part's `windows`, such as writing, mail or reading, in your own words and never by a window's title or app id, because the report is stored, and write agent work as work the user had agents do. Tasks marked done within a few minutes of each other were ticked off then, not done then.

   Describe only what the data shows. Don't rate, judge, or advise, and don't guess why something happened, how it felt, or what happened away from the computer, because the user writes that in the journal. Leave counts and durations to the report, which prints every number from the collected data: `render` rejects digits, except clock times as HH:MM within a part's `text`, and rejects a sentence over 25 words, a summary over 60 words and a `text` over 90.
5. Render and store. Re-running for a day replaces only the agent area, so it's safe after fixing a source.

   ```sh
   bun ~/.claude/skills/wrap/scripts/wrap.ts render "/tmp/wrap-$DAY.json" --model <your model id> <<'EOF' | postlude agent-area put "$DAY"
   {"summary": "<summary>", "parts": [{"title": "<title>", "text": "<text>"}]}
   EOF
   ```

6. Check with `postlude agent-area get "$DAY"`, and delete the collected file, which holds window titles: `rm "/tmp/wrap-$DAY.json"`. Then tell the user the report is in Postlude and which sources were missing.

## Changing the metrics or report

The definitions and their versioning rule are in `scripts/metrics.ts`.

Run `bun run check` from the repository root after any change.
