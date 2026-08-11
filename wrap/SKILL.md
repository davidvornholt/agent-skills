---
name: wrap
description: End-of-day wrap-up for a personal journal — narrates the day across Super Productivity completions, measured screen time from the niri activity log, today's Claude Code + Codex sessions, GitHub PRs/issues, browsing, shell history and sent mail, then highlights where tracked tasks and actual work diverged, rates the day's productivity against a fixed rubric, and lists loose ends for tomorrow. Read-only; output stays in the session to reword by hand.
disable-model-invocation: true
argument-hint: [yesterday | YYYY-MM-DD]
---

# Wrap-up (day analysis)

Produce a personalized analysis and recap of a day's work, straight into the session, written in second person ("you") as an observant reviewer of the day — journal-style prose the user can adapt, never first person. Read-only: never modify Super Productivity data, never write files, never touch drafts or send mail. `/recap` is a built-in Claude Code command — this skill is deliberately named `/wrap` to avoid the clash.

## Standing interpretation notes

Facts about how this user works; interpret all evidence through them instead of rediscovering (or mis-scoring) them each day:

- Super Productivity records prompt-and-review time only; agents do the bulk of the work. Divergence between SP and machine activity is the normal state, not a finding — flag it only when the pattern itself breaks (e.g. SP claims hours on something the timeline never shows).
- The user deliberately runs the same task across models and tools (e.g. GPT-5.6 Sol vs. Fable 5 vs. Opus 5). Multiple same-task sessions are benchmarking by default, not redundancy.
- AI chat content (ChatGPT, claude.ai, Gemini) is invisible — only thread titles and time are known, via browser history. Long research sessions there may have produced real decisions and conclusions; report them as unassessed, never as unproductive.

## 0. Which day

Default: today (`date +%F`). If the argument is `yesterday`, use yesterday; if it is a `YYYY-MM-DD`, use that. Compute the local epoch-ms window [00:00, next-00:00):
`S=$(( $(date -d "<DAY> 00:00:00" +%s) * 1000 )); E=$(( $(date -d "<DAY+1> 00:00:00" +%s) * 1000 ))`.

## 1. Super Productivity — what was completed and where time went

Newest backup:
```
B="$HOME/.var/app/com.super_productivity.SuperProductivity/config/superProductivity/backups"
L=$(ls -t "$B"/*.json | head -1)
```
Completed tasks land in `.archiveYoung.task.entities` (and eventually `.archiveOld.task.entities`), not just `.task.entities` — the recipes below check all three (archiveOld matters when wrapping an older date).

`doneOn` is epoch ms; `timeSpentOnDay["<DAY>"]` is ms tracked that day.

```
ALLT='(.task.entities, (.archiveYoung.task.entities//{}), (.archiveOld.task.entities//{}))[]'
# completed in the day's window, with project id and minutes tracked
jq -r --argjson s $S --argjson e $E "$ALLT"' | select(.doneOn and .doneOn>=$s and .doneOn<$e) | [.title, (.projectId//"-"), ((.timeSpentOnDay["<DAY>"]//0)/60000|round)] | @tsv' "$L"
# any task with time tracked that day (may include still-open work)
jq -r "$ALLT"' | select(.timeSpentOnDay["<DAY>"]) | [.title, (.timeSpentOnDay["<DAY>"]/60000|round)] | @tsv' "$L"
```
Map project ids to names via `.project.entities`. Note the biggest time sinks — they anchor the narrative.

## 2. Machine activity — what was actually on screen

Super Productivity records what was *tracked*; this records what happened.
`activity-digest` prints a pre-aggregated report — a few hundred lines, still
safe to read straight into context:

```
activity-digest <DAY>                            # today by default
activity-digest <DAY> --no-browser --no-shell    # window log only
```

It covers four things:

- **AFK-corrected screen time** per app and per window title. Durations exclude
  idle spans and suspend, so they are time in front of the machine, not
  wall-clock. A window left focused overnight scores only the minutes worked.
- **A workspace timeline.** The workspace names carry intent — `Organization`,
  `Work 1`–`Work 3`, `Relax` — so this is usually the fastest way to see the
  shape of a day and where it turned.
- **Browsing**, across every Helium profile and Firefox. This is the only
  source that captures reading and research, which otherwise leaves no commit,
  no task and no transcript behind.
- **Shell commands** with their working directory and duration, from atuin.

If a section is empty, the cause is upstream: the window log lives at
`~/.local/state/activity/<DAY>.jsonl` and is written by
`niri-activity-watch.service`, with idle and suspend markers from
`niri-activity-afk.service`. No file means the watcher was not running that
day — say so plainly rather than inferring screen time from other sources.

Two cautions when reading it:

- Entries shown as `<redacted>` matched `~/.config/activity/exclude`. The time
  is still counted; the subject is deliberately withheld. Never try to
  reconstruct what a redacted entry was from surrounding evidence, and never
  mention the redaction in the journal draft.
- Chromium's dwell times keep accruing in background tabs, so a forgotten tab
  can show hours. Trust the window log for how long the browser was focused,
  and use dwell only to rank pages within that.
- The browsing list is capped at the ~200 most substantial pages, ranked by
  dwell plus visit count — a ranking that favors long-lived tabs, so brief but
  meaningful visits (a checkout page, a one-off sign-in) sink first. If the
  day looks research-heavy and something seems missing, rerun
  `activity-browser-history <DAY> --limit 500` for the tail.

## 3. AI sessions — delegate to a subagent (critical for context safety)

Transcripts are enormous (a single day can be 100+ Codex files plus a dozen Claude Code sessions, some multi-MB). NEVER read them into this context directly. Launch ONE subagent (Explore or general-purpose) to sweep them and return only a compact per-session report. Instruct the subagent to:

- Find candidate files:
  - Claude Code: `find ~/.claude/projects -name '*.jsonl' -newermt "<DAY>" ! -newermt "<DAY+2>"` — the window deliberately extends one extra day because mtime is the *last* write: a session that started on <DAY> evening and ran past midnight has mtime <DAY+1> and a strict one-day filter would miss it. For files with mtime on <DAY+1>, cheaply check the first line's timestamp (each jsonl line has one) and keep the file only if it started on <DAY>.
  - Codex: `find ~/.codex/sessions/<YYYY>/<MM>/<DD> -type f` (sessions nest by start date year/month/day, so no mtime issue)
- NOT read any file whole — extract signal cheaply (jq/grep on message roles and text, or first/last ~100 lines).
- Dedup: Codex spawns review-fix subagents in triplets; collapse them to the distinct underlying work.
- Return per distinct session: project (from cwd/dir slug), tool, what was worked on (1–2 sentences, concrete — PRs, files, features), and outcome/where it left off (merged? blocked? loose ends?).

If the user has flagged specific days/sessions as sensitive or off-limits, pass that constraint through explicitly and have the subagent honor it.

## 4. GitHub — ground truth of what shipped

Authenticated `gh` is available (account: davidvornholt; ignore any other account). The token has write scopes — only read/search commands are allowed (`gh search`, `gh api` GETs); never comment, merge, close, or edit anything.

Plain `--created=<DAY>` is interpreted in UTC, which misfiles late-evening local work — use the offset-range form (tested):

```
R="<DAY>T00:00:00+02:00..<DAY>T23:59:59+02:00"   # use the current local UTC offset (date +%:z)
gh search prs --author=davidvornholt --created="$R" --json repository,title,state --limit 50
gh search prs --author=davidvornholt --merged-at="$R" --json repository,title --limit 50
gh search issues --author=davidvornholt --created="$R" --json repository,title --limit 50
# org repos (prosabridge, fes-kirchheim), any author — catches bot PRs and older PRs merged that day
gh search prs --owner=prosabridge --owner=fes-kirchheim --merged-at="$R" --json repository,title,author --limit 50
```

Keep `--limit 50`: heavy days really do exceed the default 30 (2026-07-26 had 30 PRs). This list is the authoritative record of what shipped — reconcile it against SP tasks and the session reports; a PR with no matching task or session is exactly the kind of gap the divergence section below wants.

## 5. Sent mail

`mcp__mail__search_mail` per account with `scope: folder`, `folder: Sent`, `since: <DAY>` (global search excludes Sent). Account folder names vary — some use `Sent`, some `INBOX.Sent`; if one errors, try the other or `list_folders`. `since` is only a lower bound: when wrapping a past day, discard results dated after <DAY>. Only human-written mail matters; note who was contacted and why.

## 6. Compose the analysis

Write it as second-person prose addressed to the user — an analyst's recap of *their* day, not a status report and not a first-person journal entry. The user rewords it into their own journal; your job is observation and judgment, their job is voice. Structure:

1. **The day in arcs** — group the work into 2–4 narrative arcs (e.g. late-night personal project, work-repo shipping, an afternoon on one thing), each a few sentences with the concrete wins. The workspace timeline in §2 usually gives the arcs directly; use it to get the order and the turning points right rather than guessing from artefact timestamps.
2. **Completed** — brief roll-up from Super Productivity with the notable time sinks. Where SP tracked time and §2 measured it, give both when they disagree — the measured figure is what actually happened at the machine.
3. **Where tracking and reality diverged** — the most journal-worthy part: compare what the SP task said versus what the session actually became (scope reversals, a task that ballooned, one tool picking up another's abandoned work). §2 is the strongest evidence here, because it is the only source that shows time spent on things that produced no artefact at all: an hour of reading before a ten-minute commit, a task tracked to one project while the timeline sat in another workspace, an afternoon of research that shipped nothing visible. Filter through the standing interpretation notes: bare SP-vs-activity divergence and parallel model runs are the normal pattern, not findings. Only include a real, specific gap — do not manufacture one.
4. **Loose ends into tomorrow** — unmerged PRs, open questions left for the user, deferred issues, blocked work.
5. **Productivity rating** — score the day 1–10 overall, from sub-scores (1–5 each, or **n/e** for "not enough evidence" — never guess a number):
   - **Output**: what verifiably shipped or got decided — merged PRs, sent mail, deploys verified, decisions with visible traces. Knowledge work that plausibly concluded inside an AI thread scores n/e, not low; name it as unassessable.
   - **Focus**: deep-work blocks versus fragmentation, from the §2 timeline only.
   - **Direction**: did the day's time go toward things the user was plausibly trying to do? Judged against goals and loose ends from prior wraps when available, never against Super Productivity coverage (see the standing notes).
   - **Efficiency**: only *unintended* waste counts — rework, blocked-and-forgotten sessions, work abandoned halfway. Parallel sessions on the same task across tools or models are presumed deliberate comparison unless the sessions themselves show otherwise.

   Every sub-score cites its evidence in one sentence. Where the day's biggest time block is opaque (AI-thread research, off-machine work), say so and qualify the overall score's confidence rather than letting the invisible part default to zero. Keep the rubric fixed so ratings are comparable across days; the overall score is your judgment anchored by the sub-scores, not their average. If one or two user answers would materially change the rating (e.g. "was that parallel run a benchmark?"), end the section with those questions instead of pretending to certainty.

Output as markdown in the session. Do not write it to any file — the user transfers it to their journal by hand, in their own words.
