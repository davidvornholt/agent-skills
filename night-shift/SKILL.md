---
name: night-shift
description: Run the user's unattended night shift across their repositories. Lands ready pull requests, resolves open issues, hunts bugs with leftover usage, and leaves a morning report of the decisions left for them. The user starts it by hand before going to bed.
disable-model-invocation: true
---

# Night shift

The user starts this skill before going to bed, when their AI subscriptions have usage left that would otherwise go unused. You coordinate workers through the night and leave a morning report. Nobody answers until the morning, so make the smallest sound choice or leave an item open with a note.

Scripts below are in this skill's `scripts` folder. Read one before using it for the first time.

## Before the user goes to bed

Ask once, in one message, for whatever the request doesn't already say:

- when the shift ends;
- how much usage each subscription has left, and when it resets;
- what is off limits tonight, such as repositories with an active session or pull requests the user wants to keep;
- any extra tasks. Social media work happens only when the user asks for it tonight.

After that, ask nothing. Record the answers and a first `scripts/health.sh` result in the state file.

## Coordinating

Keep `~/dev/night-shift-worktrees/STATE-night-<date>.md`, using the date the shift starts, with the user's instructions, the off-limits list, every worker, and a timestamped log, so that a coordinator that loses its context can resume from it.

Write a draft of the morning report before starting the first worker and keep it current, because running out of usage ends the shift without warning.

Start workers with `delegate_task` and follow the `next` it returns: a worker's completion wakes you, so end your turn rather than waiting on or polling a running worker. A worker knows only its brief, so give it its goal, its repositories, a log file under `~/dev/night-shift-worktrees/notes/`, and the absolute path of `worker.md` in this skill's folder, with the instruction to follow it.

Nothing else wakes you while workers run, so use `schedule_task` to post to this thread every 40 minutes. On each run, run `scripts/health.sh`, read each running worker's `pendingRequestCount` with `t3_thread_read`, because a worker once waited an hour on a permission prompt, and log the result. Confirm from the schedule's last run status that it ran, because scheduled work has silently not happened. Delete the schedule with `delete_scheduled_task` when the shift ends.

Spend by subscription: GPT-6 Astra hunts and reviews, Claude fixes and coordinates. Use a cheaper model for mechanical sweeps such as dependency updates. Stop starting workers as a limit nears, and keep enough usage to finish the report. If the reviewer model's subscription runs out, leave pull requests that need its review in draft instead of substituting another model.

## Work order

Work through this list while usage lasts:

1. Do what the user named tonight.
2. Land what is ready, as `worker.md` describes: bot pull requests, such as Dependabot updates and standards syncs, and finished pull requests that aren't off limits. Scan for new bot pull requests again before the shift ends.
3. Resolve issues.
4. Hunt bugs: GPT-6 Astra reads a repository without changing it, and a Claude worker fixes what it can reproduce, because hunts report stale and wrong findings too.

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

Judge each issue on its own. Never close one only because it's old or as part of a bulk sweep.

Work the queue by harm: lost data or weakened access first, production before personal tools, then oldest first. A worker opens one pull request per issue with `Closes #<number>`. An issue in the `super-productivity` fork follows the `contribute-upstream` skill, and nothing goes upstream tonight unless the user asked.

## Morning report

Write `/home/david/documents/reports/Night shift <date>.md` and `.html`, using the date the shift started. Build the HTML with `scripts/build-report-html.py`, whose data file follows `scripts/report-data.example.json`. Open the Markdown with a status line, such as `Status: final, 08:02 CET.`, and the time zone, then use these sections:

- `## Overview`: merged count, fixes with tests, dependencies, health, and usage spent per subscription.
- `## Needs you`: numbered decisions. Each gives the background, what happened, what you checked afterwards, the options as (a), (b), and a recommendation, written for someone who has forgotten the context.
- `## Smaller decisions`
- `## Merged tonight`
- `## Issues`: fixed, closed as already fixed, left open as stale, and skipped with the reason.
- `## Super Productivity upstream`, only when that work happened.
- `## Still open`
- `## Deploys and health`
- `## Social`, only when that work happened.
- `## Cleanup`
- `## Not touched`

Verify every claim yourself before it goes in, including what a merge publishes and what a worker reported, because past reports got both wrong.

The user answers with numbered choices, such as `1 a, 2 explain`. Act on them in the same session and land what they approve.
