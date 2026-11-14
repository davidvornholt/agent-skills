---
name: wrap
description: Use when the user asks to close a journal day.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# End-of-day wrap

A journal day runs from 04:00 to 04:00 Europe/Berlin. Postlude keeps the user's journal text, scripture, and rating in their own area, which this skill never writes.

You compose the report: which blocks it has, in what order, under what headings, and all of its words. Postlude draws it. The scripts build the blocks that carry data, such as the tiles and the timeline, and you place them by name, so take any number you mention in your own words from the collected data rather than computing it.

## Run it

1. Pick the day: the current journal day, the one before it for `yesterday`, or the given date. Before 04:00 the current journal day is still the previous date.
2. Collect. Missing sources don't fail the command: they appear in `dayMetrics.coverage` and are explained in `problems`.

   ```sh
   DAY=<YYYY-MM-DD>
   bun ~/.claude/skills/wrap/scripts/wrap.ts collect "$DAY" > "/tmp/wrap-$DAY.json"
   ```

3. Read the collected day without the timeline, which only compose uses, and without the conversations, which come next: `jq 'del(.timeline, .conversations)' "/tmp/wrap-$DAY.json"`. Look at `reportInputs` and `problems`. If the user can fix a missing source now, such as Super Productivity running on neither host, say so and offer to collect again. Otherwise continue, because the report shows a missing source as a gap rather than as zero.

   Then read all of `conversations`: the day's T3 Code threads with their messages of the day, which are the user's prompts, the agents' replies, and the reports of the tasks the agents delegated. They are long, so write them to a text file and read it in pieces:

   ```sh
   jq -r '.conversations.items[] | "# \(.title) [\(.id)] (\(.project), started by \(.startedBy // "unknown"), parts: \(.parts | map(tostring) | join(", ")))", .messages[], ""' "/tmp/wrap-$DAY.json" > "/tmp/wrap-$DAY.txt"
   ```

4. Write the report as JSON: `{"threads": {"<thread id>": "<name>"}, "blocks": [<block>, ...]}`. Start from this composition, and change it where the day calls for it: add sections, lists, tables or callouts of your own, reorder, or leave out a data block that says nothing on this day.

   ```json
   {"threads": {}, "blocks": [
     {"kind": "paragraph", "text": "<paragraph>\n\n<paragraph>"},
     {"use": "kontor"},
     {"use": "tiles"},
     {"kind": "section", "heading": "The day in parts", "blocks": [{"kind": "parts", "parts": [{"title": "<title>", "text": "<paragraph>\n\n<paragraph>"}]}]},
     {"use": "timeline"},
     {"kind": "section", "heading": "How the day went", "blocks": [{"use": "figures"}, {"use": "leadTimes", "heading": "Lead times", "collapsed": true}]},
     {"use": "appointments", "heading": "Appointments"},
     {"use": "pullRequests", "heading": "Pull requests landed", "collapsed": true},
     {"use": "openThreads", "heading": "Threads open for several days"},
     {"use": "trackedTasks", "heading": "Tracked in Super Productivity"},
     {"use": "sentMail"},
     {"use": "sources", "heading": "Sources", "collapsed": true}
   ]}
   ```

   The blocks you write:

   - `{"kind": "paragraph", "text": <text>}`. A string with blank lines makes a paragraph each.
   - `{"kind": "section", "heading": "...", "note": "...", "collapsed": true, "blocks": [...]}`, with `note` and `collapsed` optional. Sections nest three deep, and a section whose blocks all come out empty, such as appointments on a day without any, is left out.
   - `{"kind": "parts", "parts": [{"title": "...", "text": <paragraphs>}]}`: exactly one when the day has parts, with an entry for each entry of `reportInputs.parts`, in order, and a title of at most 60 characters. Compose adds the times, and the timeline names the parts by these titles.
   - `{"kind": "facts", "items": [{"term": "...", "details": <paragraphs>}]}`
   - `{"kind": "list", "items": [{"text": <text>, "time": ..., "meta": "..."}]}`, with `time` optional as `{"at": instant}`, `{"start": instant, "end": instant}` or `{"allDay": true}`, and instants such as `"2026-10-29T14:05+01:00"`.
   - `{"kind": "callout", "tone": "note" | "warning", "text": <text>}`
   - `{"kind": "table", "caption": "...", "columns": ["..."], "rows": [[<text>, ...]]}`, with `""` for an empty cell.
   - `{"use": "<name>", "heading": "...", "collapsed": true}` places a block that compose builds from the collected data. With a heading it gets a section of its own, which also shows the block's counts; without one it stands where you put it. The names: `tiles` (the day in numbers), `timeline` (always shown, under "Timeline" unless you give a heading), `figures` (the day's figures by output, focus, direction and efficiency), `leadTimes`, `appointments`, `pullRequests`, `openThreads`, `trackedTasks`, `sentMail` (a table by mailbox), `sources` (what was read), and `kontor` (a warning only when the bank connection needs an approval).

   A `<text>` is a string, or a list of spans: strings, `{"emphasis": "..."}`, `{"code": "..."}` and `{"link": "...", "href": "https://..."}`. `<paragraphs>` is a string, split at its blank lines, or a list of texts. There is no HTML or Markdown: an asterisk shows as an asterisk.

   Open with a few short paragraphs about what the parts can't show:

   - the shape of the day: start and stop, the main stretches, and how the screen time split between steering agents (`t3Minutes`) and everything else the user did, which the windows show, and how long agents ran alone (`agentsAloneMinutes`)
   - patterns worth noticing
   - at most one or two outcomes that defined the day

   You may compare with the previous days' reports, which `postlude agent-area get <date>` prints.

   Give each part a short title and a text about that entry and everything whose `part` is its index. A text may hold several short paragraphs, for example one per thread of work.

   Tell a reader who no longer remembers the day what happened, concretely: what the user asked for, what the agents found, built or decided, and what came of it. A ticked-off task or a thread that was worked on isn't news by itself, and tasks mainly show what the work was about. Look up whatever else you need to understand the day.

   Keep what you write to about 700 to 800 words, so the report reads in a few minutes: tell what came of each thread of work rather than every step on the way, and leave the details to the data blocks.

   The report looks back. A part may say where a thread of work ended, such as a fix that is in a pull request, but nothing reads as a to-do for the user, because the brief skill covers what's ahead.

   Say who started each thing: the user by hand, agents the user asked from the desk or the phone, or agents on their own, such as scheduled tasks, the night shift, the curator, and delegated work. `startedBy` and the message authors tell them apart.

   Name threads with unclear T3 titles in `threads`, by id, and use those names in your text. The timeline shows them too.

   Address the user as "you", because they read the report themselves. It's their day, not the agents', so write agent work as work they had agents do. Describe the user's `windows` and `sentMail` in your own words. The timeline's cards already show the window titles and mail subjects, so name one only where it says what the work was, and never name an app by its id.

   Don't rate, judge, or advise, and don't guess why something happened, how it felt, or what happened away from the computer, because the user adds that after reading the report.
5. Compose, check and store. Compose and Postlude's check name the place of every problem, so fix the JSON and run them again. Re-running for a day replaces only the agent area, so it's safe after fixing a source.

   ```sh
   bun ~/.claude/skills/wrap/scripts/wrap.ts compose "/tmp/wrap-$DAY.json" --model <your model id> > "/tmp/wrap-$DAY-put.json" <<'EOF'
   <the report>
   EOF
   postlude agent-area check "$DAY" < "/tmp/wrap-$DAY-put.json" && postlude agent-area put "$DAY" < "/tmp/wrap-$DAY-put.json"
   ```

6. Check with `postlude agent-area get "$DAY"`, and delete the collected files, which hold window titles, mail subjects and the conversations: `rm "/tmp/wrap-$DAY.json" "/tmp/wrap-$DAY.txt" "/tmp/wrap-$DAY-put.json"`. Then tell the user the report is in Postlude and which sources were missing.

## Changing the metrics or report

The definitions and their versioning rule are in `scripts/metrics.ts`. The report document's schema is Postlude's, in `apps/web/src/features/journal/schemas/day-report-*.ts`, and `scripts/report-document.ts` mirrors its types. A new kind of block needs Postlude to draw it first; a new data block is a function in `scripts/report-blocks.ts` and a name in `scripts/compose.ts`.

Run `bun run check` from the repository root after any change.
