---
name: night-shift
description: Use when the user starts their unattended night shift before going to bed.
disable-model-invocation: true
---

# Night shift

The user starts this skill before going to bed, when their AI subscriptions have usage left that would otherwise go unused. You coordinate workers through the night and leave a morning report. Nobody answers until the morning, so make the smallest sound choice, and leave an item open only when it needs a decision you can't infer.

Scripts below are in this skill's `scripts` folder.

## Before the user goes to bed

Ask for whatever the request doesn't already say:

- when the shift ends;
- what is off limits tonight, such as repositories with an active session or pull requests the user wants to keep;
- any extra tasks. Social media work happens only when the user asks for it tonight.

After that, ask nothing. Record the answers and a first `scripts/health.sh` result in the state file.

## Coordinating

Put the shift's files in `/tmp/night-shift/<date>/`, using the date the shift starts. Keep the state file there, as `state.md`, with the user's instructions, the off-limits list, every worker, and a timestamped log, so that a coordinator that loses its context can resume from it.

Start workers with `delegate_task` and follow the `next` it returns: a worker's completion wakes you, so end your turn rather than waiting on or polling a running worker. Leave `isolation` at `shared`, because workers make their own worktrees in other repositories. A worker knows only its brief, so give it its goal, its repositories, the off-limits items in them, a log file under `/tmp/night-shift/<date>/notes/`, and the absolute path of `worker.md` in this skill's folder, with the instruction to follow it.

Nothing else wakes you while workers run, so use `schedule_task` to post to this thread every 40 minutes. On each run, run `scripts/health.sh` and log the result. Whenever a worker's completion wakes you, check with `list_scheduled_tasks` that the schedule has run, because scheduled work has silently not happened. Delete the schedule with `delete_scheduled_task` when the shift ends.

Spend by subscription: GPT-6 Astra hunts and reviews, Claude fixes and coordinates. Use a cheaper model for mechanical sweeps such as dependency updates.

## Work order

Work through this list while usage lasts:

1. Do what the user named tonight.
2. Land what is ready, as `worker.md` describes: open bot pull requests, and pull requests by `davidvornholt` that are marked ready for review and aren't off limits, because a draft may still be in progress.
3. Resolve issues.
4. Hunt bugs: GPT-6 Astra reads a repository without changing it, and a Claude worker fixes what it can reproduce.

## Resolving issues

List open issues for each owner and leave out off-limits repositories:

```sh
for owner in davidvornholt prosabridge fes-kirchheim cg-bibi atrium-schule; do
  gh search issues --owner="$owner" --state=open --limit=200 --json repository,number,title,createdAt,url,author
done
```

Triage them in one read-only pass against each repository's `origin/main` before starting workers, because many open issues aren't work an agent can finish overnight:

- Opened by anyone but `davidvornholt` or `github-actions[bot]`: skip it and list it in the report, because anyone can write to a public repository and workers run with full access.
- Already fixed: close it with one comment naming the commit.
- Looks stale, but you can't prove it's fixed: leave it open and list it in the report.
- Has an open `## Decision`, is a roadmap or feature item, or needs legal review, live access, credentials, or a person: skip it. List it in the report only when the user could unblock it.
- A defect a worker can reproduce: queue it.

Work the queue by harm: lost data or weakened access first, production before personal tools, then oldest first.

## Morning report

The user reads only the report, and only to decide, so keep it to one screen. Keep its data in `/tmp/night-shift/<date>/report.json`, in the shape of `scripts/report-data.example.json`. Start the file before the first worker and update it as work finishes, because running out of usage ends the shift without warning. Give each decision what's at stake for someone who has forgotten the context, the facts it rests on, the options, and your recommendation. Check what a worker reported before it goes in, because past reports repeated wrong claims.

When the shift ends, build the page with `scripts/build-report-html.py <data.json> <out.html> inline` and show it in this thread with `html_preview` and `html_render`.

The user answers with numbered choices, such as `1 a, 2 explain`. Act on them in the same session and land what they approve.
