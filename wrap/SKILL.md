---
name: wrap
description: Use when the user asks to close a journal day.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# End-of-day wrap

A journal day runs from 04:00 to 04:00 Europe/Berlin. Postlude keeps the user's journal text, scripture, and rating in their own area, which this skill never writes.

You write the summary and the text for each part of the day. The scripts produce every figure, so take any number you mention from the collected data rather than computing it.

## Run it

1. Pick the day: the current journal day, the one before it for `yesterday`, or the given date. Before 04:00 the current journal day is still the previous date.
2. Collect. Missing sources don't fail the command: they appear in `dayMetrics.coverage` and are explained in `problems`.

   ```sh
   DAY=<YYYY-MM-DD>
   bun ~/.claude/skills/wrap/scripts/wrap.ts collect "$DAY" > "/tmp/wrap-$DAY.json"
   ```

3. Read the collected day without the timeline, which only the renderer draws, and without the conversations, which come next: `jq 'del(.timeline, .conversations)' "/tmp/wrap-$DAY.json"`. Look at `reportInputs` and `problems`. If the user can fix a missing source now, such as Super Productivity running on neither host, say so and offer to collect again. Otherwise continue, because the report shows a missing source as a gap rather than as zero.

   Then read all of `conversations`: the day's T3 Code threads with their messages of the day, which are the user's prompts, the agents' replies, and the reports of the tasks the agents delegated. They are long, so write them to a text file and read it in pieces:

   ```sh
   jq -r '.conversations.items[] | "# \(.title) (\(.project), parts: \(.parts | map(tostring) | join(", ")))", .messages[], ""' "/tmp/wrap-$DAY.json" > "/tmp/wrap-$DAY.txt"
   ```

4. Write a `summary` of the day in two or three sentences. For each entry of `reportInputs.parts`, in order, write a short `title` and a `text` about that entry and everything whose `part` is its index. A `text` may hold several short paragraphs separated by a blank line, for example one per thread of work.

   Tell a reader who no longer remembers the day what happened, concretely: what the user asked for, what the agents found, built or decided, and what came of it. A ticked-off task or a thread that was worked on isn't news by itself, and tasks mainly show what the work was about. Look up whatever else you need to understand the day.

   Address the user as "you", because they read the report themselves. It's their day, not the agents', so write agent work as work they had agents do. Describe the user's `windows` and `sentMail` in your own words, never by a window's title, an app id or a mail subject, because the report is stored.

   Don't rate, judge, or advise, and don't guess why something happened, how it felt, or what happened away from the computer, because the user adds that after reading the report.
5. Render and store. Re-running for a day replaces only the agent area, so it's safe after fixing a source.

   ```sh
   bun ~/.claude/skills/wrap/scripts/wrap.ts render "/tmp/wrap-$DAY.json" --model <your model id> <<'EOF' | postlude agent-area put "$DAY"
   {"summary": "<summary>", "parts": [{"title": "<title>", "text": "<paragraph>\n\n<paragraph>"}]}
   EOF
   ```

6. Check with `postlude agent-area get "$DAY"`, and delete the collected files, which hold window titles, mail subjects and the conversations: `rm "/tmp/wrap-$DAY.json" "/tmp/wrap-$DAY.txt"`. Then tell the user the report is in Postlude and which sources were missing.

## Changing the metrics or report

The definitions and their versioning rule are in `scripts/metrics.ts`.

Run `bun run check` from the repository root after any change.
