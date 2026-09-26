---
name: wrap
description: Review one day of work for a personal journal. Combine Super Productivity, measured screen activity, AI sessions, GitHub, browsing, shell history, and sent mail. Explain what happened, compare tracking with reality, identify loose ends, and rate the day with a fixed rubric. Read-only; output stays in the session.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# End-of-day wrap-up

Review one day of work and write the result in the session. Address the user as "you" and write journal-style prose they can adapt. Do not write in the first person. Stay read-only: do not modify Super Productivity data, write files, touch drafts, or send mail. This skill is named `/wrap` because `/recap` is a built-in Claude Code command.

## Interpret the evidence

Use these facts about how the user works when reading the evidence and assigning scores:

- The user works as a product manager and agent orchestrator. They specify work, dispatch agents, review results, make decisions, and integrate changes. Agents do most implementation. Count the result of that full workflow as the user's output, regardless of which agent wrote the code. Do not favor manual implementation over delegation.
- Super Productivity records prompt and review time only. The difference between SP time and machine activity is expected. Mention it only when the pattern itself breaks, such as SP claiming hours on work that does not appear anywhere in the timeline.
- Moving between repositories, tools, and agent sessions is normal portfolio management. Treat those switches as neutral unless the evidence shows that lost context caused rework, delayed a decision, or left a thread forgotten.
- An agent may still be running when `/wrap` evaluates the day. A transcript ending without a final answer does not prove that the work failed, stopped, or remained incomplete. Report the verified progress and mark the outcome as in progress or unknown. Do not lower Output or Efficiency because the result is still pending. If the pending result covers much of the day, use **n/e** or lower the rating's confidence instead of guessing.
- The user deliberately runs the same task across models and tools, such as GPT-5.6 Sol, Fable 5, and Opus 5. Treat multiple sessions for the same task as benchmarking unless the transcripts show otherwise.
- Browser history exposes only titles and time for ChatGPT, claude.ai, and Gemini. A long research session there may have produced decisions that the available evidence cannot verify. Mark it unassessed, not unproductive.

## 0. Choose the day

Use today by default with `date +%F`. Resolve `yesterday` to yesterday's date. Accept a `YYYY-MM-DD` argument as written. Compute the local epoch-ms window `[00:00, next 00:00)`:

```sh
S=$(( $(date -d "<DAY> 00:00:00" +%s) * 1000 ))
E=$(( $(date -d "<DAY+1> 00:00:00" +%s) * 1000 ))
```

## 1. Read Super Productivity

Use the newest backup on the current host. SuperSync keeps application state current on each host, but it does not synchronize backup files.

```sh
B="$HOME/.config/superProductivity/backups"
[[ -d "$B" ]] || B="$HOME/.var/app/com.super_productivity.SuperProductivity/config/superProductivity/backups"
L=$(ls -t "$B"/*.json | head -1)
```

Completed tasks move into `.archiveYoung.task.entities` and later `.archiveOld.task.entities`. Check those collections as well as `.task.entities`. The `doneOn` field is epoch ms. `timeSpentOnDay["<DAY>"]` is tracked milliseconds for that day.

```sh
ALLT='(.task.entities, (.archiveYoung.task.entities//{}), (.archiveOld.task.entities//{}))[]'
# Tasks completed during the day, with project id and tracked minutes
jq -r --argjson s $S --argjson e $E "$ALLT"' | select(.doneOn and .doneOn>=$s and .doneOn<$e) | [.title, (.projectId//"-"), ((.timeSpentOnDay["<DAY>"]//0)/60000|round)] | @tsv' "$L"
# Any task with time tracked during the day, including open work
jq -r "$ALLT"' | select(.timeSpentOnDay["<DAY>"]) | [.title, (.timeSpentOnDay["<DAY>"]/60000|round)] | @tsv' "$L"
```

Map project ids through `.project.entities`. Use the largest tracked items to orient the narrative, but remember that SP measures the user's interaction with agents rather than their implementation time.

## 2. Read machine activity

`activity-digest` reports what appeared on screen. It complements SP's tracked time.

```sh
activity-digest <DAY> --all-hosts
activity-digest <DAY> --no-browser --no-shell
```

`--all-hosts` reads live evidence from the current machine and the latest privacy-filtered snapshots under `~/.local/share/activity-exchange/<HOST>/<DAY>/` for the other machine. Each writer owns its hostname directory. Host totals can overlap when one device controls another, so never add them into one screen-time total.

The digest includes:

- AFK-corrected screen time by app and window title. Durations exclude idle periods and suspend. A window left open overnight counts only the minutes worked.
- A workspace timeline. Names such as `Organization`, `Work 1` to `Work 3`, and `Relax` show the order of the day and its main turns.
- Browser activity across Helium profiles and Firefox. This captures reading and research that may leave no commit, task, or transcript.
- Shell commands with their working directory and duration from atuin.

If a local section is empty, inspect `~/.local/state/activity/<DAY>.jsonl`. `niri-activity-watch.service` writes that file, and `niri-activity-afk.service` adds idle and suspend markers. If the file is absent, say that the watcher did not record the day. Do not reconstruct screen time from other sources.

For an empty remote section, inspect its `manifest.json`. If the manifest is absent, say that Syncthing or the publisher has not delivered that host and day. Do not substitute the local machine. The exchange deliberately excludes raw browser and atuin databases, Super Productivity backups, and Claude or Codex sessions.

Apply these cautions:

- `<redacted>` means an entry matched `~/.config/activity/exclude`. Count its time, but do not reconstruct the subject or mention the redaction in the journal draft.
- Chromium dwell time keeps growing in background tabs. Trust the window log for browser focus time. Use dwell time only to rank pages.
- The browser list shows roughly the 200 strongest results by dwell and visit count. Brief but useful pages may be missing. For a research-heavy day with an apparent gap, run `activity-browser-history <DAY> --limit 500`.

## 3. Delegate AI transcript review

AI transcripts can include hundreds of files and several multi-megabyte sessions. Never load them into the main context. Launch one Explore or general-purpose subagent to inspect them and return a compact report.

Give the subagent these instructions:

- Treat `david-z890-nixos` as the canonical, always-on transcript host. When `/wrap` runs elsewhere, execute the search and extraction commands through `ssh -o BatchMode=yes david@david-z890-nixos`. Never copy or synchronize `~/.claude` or `~/.codex` to the client.
- Find Claude Code candidates with `find ~/.claude/projects -name '*.jsonl' -newermt "<DAY>" ! -newermt "<DAY+2>"`. The extra day catches a session that started on `<DAY>` and continued past midnight. For a file modified on `<DAY+1>`, check the first line's timestamp and keep it only if the session started on `<DAY>`.
- Find Codex candidates with `find ~/.codex/sessions/<YYYY>/<MM>/<DD> -type f`. Codex stores sessions under their start date.
- Do not read any file in full. Extract user and assistant text with `jq` or `rg`, or inspect the first and last 100 lines.
- Collapse Codex review and fix subagent triplets into the distinct underlying work. Also collapse failed child runs when another agent or the parent delivered the intended result.
- Do not infer final state from the end of a JSONL file. The file may still be receiving events. Call work blocked, abandoned, or failed only when the transcript says so or later evidence confirms it. Otherwise report the result so far as in progress or unknown.
- For each distinct session, return the project, tool, user intent, concrete agent results so far, and supported outcome. Distinguish implemented, tested, review-ready, opened as a PR, merged, blocked, waiting for the user, and still running.

Pass through any user restriction on sensitive or off-limits days and sessions.

## 4. Read GitHub

Use the authenticated `gh` account `davidvornholt`. Ignore other accounts. The token has write scopes, but this skill is read-only. Use only searches and GET requests. Never comment, merge, close, or edit.

GitHub date filters default to UTC. Use the local UTC offset so late-evening work stays on the right day.

```sh
R="<DAY>T00:00:00+02:00..<DAY>T23:59:59+02:00" # Replace +02:00 with the offset from date +%:z
gh search prs --author=davidvornholt --created="$R" --json repository,title,state --limit 50
gh search prs --author=davidvornholt --merged-at="$R" --json repository,title --limit 50
gh search issues --author=davidvornholt --created="$R" --json repository,title --limit 50
# Catch bot PRs and older PRs merged that day in either organization
gh search prs --owner=prosabridge --owner=fes-kirchheim --merged-at="$R" --json repository,title,author --limit 50
```

Keep `--limit 50`; heavy days exceed GitHub's default of 30. GitHub is the authoritative record of created and merged PRs and issues, but it is not the only record of useful output. Reconcile it with SP and the session report. Note a PR without a matching task or session as a tracking gap.

## 5. Read sent mail

Run `mailbox search --account <email> --folder Sent --since <DAY>` for each account from `mailbox accounts`. Global search excludes Sent. Some accounts use `INBOX.Sent`; try that or run `mailbox folders --account <email>` if `Sent` fails. `since` sets only a lower bound. For a past day, discard messages sent after `<DAY>`. Include only mail written by a person. Note whom the user contacted and why.

## 6. Write the analysis

Write in second person as an observant review of the user's day. The user will adapt it for their journal. Use this structure:

1. **The day in arcs.** Group the work into two to four coherent periods. Describe the order, turning points, and concrete results. Use the workspace timeline rather than guessing from artifact timestamps.
2. **Completed.** Summarize completed SP tasks and the largest tracked items. When SP and measured activity cover the same work, report both figures if they differ.
3. **Where tracking and reality diverged.** Compare the task label with what the work became. Useful examples include scope changes, a task that expanded, or one agent taking over another's work. Bare SP and activity differences, concurrent agent work, and model comparisons are expected. Include this section only when the evidence shows a specific gap.
4. **Loose ends into tomorrow.** List open questions, deferred issues, unmerged PRs, and blocked work. Describe an agent that may still be running as in progress, not as a failed or abandoned loose end.
5. **Productivity rating.** Give one overall score from 1 to 10. Anchor it in the four sub-scores below, each from 1 to 5 or **n/e** when the evidence cannot support a number.

Use this fixed rating rubric:

- **Output.** Count verified implementation, tests, review-ready changes, opened and merged PRs, sent mail, verified deploys, and decisions with visible evidence. Agent work counts as the user's output. Do not require a merge before implementation can count. Mark opaque knowledge work or a substantial still-running result **n/e** rather than low.
- **Focus.** Judge the continuity and quality of the user's prompting, decisions, reviews, and follow-through. Moving across projects or agent sessions does not show fragmentation by itself. Deduct only when the evidence shows disruptive unrelated activity, repeated reorientation, avoidable rework, delayed decisions, or dropped threads. If the timeline cannot distinguish orchestration from distraction, use **n/e**.
- **Direction.** Judge whether the work advanced goals the user was plausibly pursuing. Use goals and loose ends from prior wraps when available. Do not use Super Productivity coverage as a proxy for direction.
- **Efficiency.** Count only unintended costs to the user, such as avoidable rework, a user-held blocker, a forgotten review, or abandonment of the overall intended outcome. Judge the full agent workflow, not each child run. Agent runtime, background waits, recovered handoffs, speculative failed children, and work still running at evaluation time do not lower this score by themselves.

Cite one sentence of evidence for every sub-score. When the largest block is opaque or still running, state that limit and reduce confidence in the overall score. Keep the rubric fixed so scores remain comparable across days. The overall score is a judgment based on the sub-scores, not their average. If one or two user answers could change the score, ask those questions instead of guessing.

Return Markdown in the session. Do not write it to a file. The user transfers it to their journal in their own words.
