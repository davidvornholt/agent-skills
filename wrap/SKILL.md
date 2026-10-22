---
name: wrap
description: Review one day of work for a personal journal. Combine Super Productivity, measured screen activity, AI sessions, GitHub, browsing, shell history, and sent mail. Explain what happened, compare tracking with reality, identify loose ends, and rate the day with a fixed rubric. Read-only; output stays in the session.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# End-of-day wrap-up

Review one day of the user's work and write the result in the session as journal-style prose they'll adapt in their own words. Address the user as "you", and don't write in the first person. The review is read-only: don't change Super Productivity, write files, touch drafts, or send mail.

## How the user works

Read the evidence with these facts in mind. They matter most for the rating.

- The user works as a product manager and agent orchestrator. They specify work, dispatch agents, review results, decide, and integrate changes, while agents do most of the implementation. The result of that whole workflow is the user's output, whichever agent wrote the code, so don't favor manual implementation over delegation.
- Super Productivity records only the time the user spent prompting and reviewing, so it's expected to fall well short of machine activity. Mention the difference only when the pattern breaks, such as SP claiming hours on work that appears nowhere in the timeline.
- Moving between repositories, tools, and agent sessions is how the user manages a portfolio. Treat it as neutral unless the evidence shows that lost context caused rework, delayed a decision, or let a thread drop.
- An agent may still be running when the wrap runs, so a transcript that ends without a final answer doesn't show that the work failed or stopped. Report the verified progress and call the outcome in progress or unknown. Pending results don't lower Output or Efficiency. If they cover much of the day, rate **n/e** or lower your confidence instead of guessing.
- The user deliberately runs the same task across several models and tools. Treat parallel sessions on one task as benchmarking unless the transcripts say otherwise.
- Browser history shows only titles and times for ChatGPT, claude.ai, and Gemini. A long research session there may have produced decisions nothing else records, so call it unassessed rather than unproductive.

## Choose the day

The day is today (`date +%F`) unless the argument says `yesterday` or gives a `YYYY-MM-DD` date. Several steps need its local epoch-ms window:

```sh
DAY=<YYYY-MM-DD>
S=$(date -d "$DAY" +%s)000
E=$(date -d "$DAY +1 day" +%s)000
```

## Super Productivity

Read SP through `sp`. The user runs the app on the X1, so the command passes `--host david-x1-nixos`. Drop the flag when running on the X1 itself, which can't SSH to itself. Don't fall back to backup files: the z890's stopped in August and would quietly describe the wrong period. If the app is unreachable, follow the super-productivity skill before collecting the rest of the evidence.

This lists every task, archived ones included, that was completed or tracked on the day, with its project id, the minutes tracked that day, and the day it was marked done:

```sh
sp tasks list --host david-x1-nixos --include-done --source all | jq -r --arg d "$DAY" --argjson s "$S" --argjson e "$E" \
  '.[] | select((.doneOn // 0) >= $s and (.doneOn // 0) < $e or .timeSpentOnDay[$d]) | [.title, (.projectId // "-"), ((.timeSpentOnDay[$d] // 0) / 60000 | round), (if .doneOn then (.doneOn / 1000 | strflocaltime("%F")) else "open" end)] | @tsv'
```

Resolve project ids with `sp projects list --host david-x1-nixos`. The user sometimes logs a day's work afterwards, so a task with time on the day and a later done date usually belongs to the day. The largest tracked items are good anchors for the narrative, but remember that they measure the user's time with agents, not the implementation.

## Machine activity

`activity-digest` reports what was on screen, which complements SP's tracked time:

```sh
activity-digest <DAY> --all-hosts
activity-digest <DAY> --no-browser --no-shell
```

`--all-hosts` reads live evidence from this machine and the latest privacy-filtered snapshots under `~/.local/share/activity-exchange/<HOST>/<DAY>/` for the other one. Host totals overlap when one machine controls the other, so never add them into one screen-time total.

Screen time is already corrected for idle time and suspend, so a window left open overnight counts only the minutes worked. The workspace timeline (`Organization`, `Work 1` to `Work 3`, `Relax`) gives the order of the day and its turns. Browser activity across the Helium profiles and Firefox captures reading and research that leaves no commit, task, or transcript.

When a local section is empty, check `~/.local/state/activity/<DAY>.jsonl`, which `niri-activity-watch.service` writes and `niri-activity-afk.service` annotates with idle and suspend markers. If that file is missing, say the watcher didn't record the day rather than reconstructing screen time from other sources. When a remote section is empty, check its `manifest.json`. If the manifest is missing, say that Syncthing or the publisher hasn't delivered that host and day, and don't substitute this machine's data. The exchange deliberately leaves out raw browser and atuin databases, SP backups, and Claude and Codex sessions.

Three quirks affect how to read the digest:

- `<redacted>` marks an entry that matched `~/.config/activity/exclude`. Count its time, but don't guess the subject or mention the redaction in the draft.
- Chromium dwell time keeps growing in background tabs. Use the window log for browser focus time and dwell time only to rank pages.
- The browser list holds roughly the 200 strongest pages by dwell and visits, so brief but useful pages can be missing. On a research-heavy day with an apparent gap, run `activity-browser-history <DAY> --limit 500`.

## AI transcripts

Transcripts can run to hundreds of files and several multi-megabyte sessions, so keep them out of your own context. Have one Explore or general-purpose subagent inspect them and return a compact report, and give it these instructions:

- The z890 (`david-z890-nixos`) is the always-on transcript host. When the wrap runs elsewhere, run the searches and extraction there through `ssh -o BatchMode=yes david@david-z890-nixos`. Never copy or sync `~/.claude` or `~/.codex` to the client.
- Claude Code candidates: `find ~/.claude/projects -name '*.jsonl' -newermt "<DAY>" ! -newermt "<DAY+2>"`. The extra day catches sessions that started on the day and ran past midnight. For a file last modified on `<DAY+1>`, keep it only if its first line's timestamp falls on the day.
- Codex candidates: `find ~/.codex/sessions/<YYYY>/<MM>/<DD> -type f`, since Codex files sessions under their start date.
- Don't read whole files. Extract user and assistant text with `jq` or `rg`, or look at the first and last 100 lines.
- Collapse Codex review and fix subagent triplets into the underlying work, and drop failed child runs when another agent or the parent delivered the intended result.
- A JSONL file may still be receiving events, so its last lines don't show the final state. Call work blocked, abandoned, or failed only when the transcript says so or later evidence confirms it. Otherwise report the result so far as in progress or unknown.
- For each distinct session, return the project, tool, the user's intent, the concrete results so far, and the outcome the evidence supports: implemented, tested, review-ready, opened as a pull request, merged, blocked, waiting for the user, or still running.

Pass along any days or sessions the user has marked as sensitive or off-limits.

## GitHub

Use the `davidvornholt` account and ignore any other. Its token can write, so run only searches and GET requests.

GitHub date filters default to UTC. Give the range the local offset from `date +%:z` so late-evening work lands on the right day:

```sh
R="<DAY>T00:00:00+02:00..<DAY>T23:59:59+02:00"
gh search prs --author=davidvornholt --created="$R" --json repository,title,state --limit 50
gh search prs --author=davidvornholt --merged-at="$R" --json repository,title --limit 50
gh search issues --author=davidvornholt --created="$R" --json repository,title --limit 50
# Bot pull requests and older pull requests merged that day in either organization
gh search prs --owner=prosabridge --owner=fes-kirchheim --merged-at="$R" --json repository,title,author --limit 50
```

Busy days exceed GitHub's default of 30 results, hence `--limit 50`. GitHub is the authoritative record of pull requests and issues created and merged, but not the only record of useful output. Reconcile it with SP and the session report, and note a pull request with no matching task or session as a tracking gap.

## Sent mail

Run `mailbox search --account <email> --folder Sent --since <DAY>` for each account from `mailbox accounts`, because the global search skips Sent. Some accounts call the folder `INBOX.Sent`; `mailbox folders --account <email>` shows the name. `--since` is only a lower bound, so for a past day drop anything sent after it. Keep only mail a person wrote, and note whom the user contacted and why.

## The analysis

Write it as an observant second-person review in five parts:

1. The day in arcs. Group the work into two to four coherent periods and describe their order, turning points, and concrete results. Take the order from the workspace timeline rather than from artifact timestamps.
2. Completed. Summarize the completed SP tasks and the largest tracked items. Where SP and measured activity cover the same work with different figures, give both.
3. Where tracking and reality diverged. Compare task labels with what the work became, such as a change of scope, a task that grew, or one agent taking over another's work. Plain SP-versus-activity differences, concurrent agents, and model comparisons are expected, so include this part only when the evidence shows a specific gap.
4. Loose ends into tomorrow: open questions, deferred issues, unmerged pull requests, and blocked work. An agent that may still be running is in progress, not a loose end.
5. Productivity rating: one overall score from 1 to 10, anchored in four sub-scores from 1 to 5, or **n/e** when the evidence can't support a number.

The rubric stays fixed so scores remain comparable across days:

- Output counts verified implementation, tests, review-ready changes, opened and merged pull requests, sent mail, verified deploys, and decisions with visible evidence. Agent work is the user's output, and implementation counts before it merges. Rate opaque knowledge work or a substantial still-running result **n/e** rather than low.
- Focus judges the continuity and quality of the user's prompting, decisions, reviews, and follow-through. Working across projects or sessions isn't fragmentation by itself. Deduct only for evidence of disruptive unrelated activity, repeated reorientation, avoidable rework, delayed decisions, or dropped threads. If the timeline can't tell orchestration from distraction, rate **n/e**.
- Direction judges whether the work advanced goals the user was plausibly pursuing, using goals and loose ends from earlier wraps when they're available. SP coverage is not a proxy for direction.
- Efficiency counts only unintended costs to the user: avoidable rework, a blocker the user held, a forgotten review, or abandoning the intended outcome. Judge the whole agent workflow rather than each child run. Agent runtime, background waits, recovered handoffs, speculative failed children, and work still running don't lower it by themselves.

Back every sub-score with one sentence of evidence. The overall score is a judgment informed by the sub-scores, not their average. When the largest block of the day is opaque or still running, say so and lower your confidence in the overall score. If one or two answers from the user could change the score, ask them instead of guessing.
