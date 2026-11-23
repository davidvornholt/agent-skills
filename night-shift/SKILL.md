---
name: night-shift
description: Use when the user starts their unattended night shift before going to bed.
disable-model-invocation: true
---

# Night shift

The user starts this skill before going to bed, to spend AI subscription usage that would otherwise go unused. You coordinate workers through the night and leave a morning report. Nobody answers until the morning, so make the smallest sound choice, and leave an item open only when it needs a decision you can't infer.

## Before the user goes to bed

Ask for whatever the request doesn't already say:

- when the shift ends;
- what is off limits tonight, such as repositories with an active session or pull requests the user wants to keep;
- any extra tasks, and which Super Productivity tasks the shift may take. Social media work happens only when the user asks for it tonight.

After that, ask nothing.

## Coordinating

Keep the shift's files in `/tmp/night-shift/<date>/`, dated by the day the shift starts, with a `state.md` from which a coordinator that lost its context can resume: the user's answers, every worker and any Super Productivity task it took, and a timestamped log.

Start workers with `delegate_task`, leaving `isolation` at `shared`, because workers make their own worktrees in other repositories. A worker knows only its brief, so give it its goal, its repositories, the off-limits items in them, a log file under `/tmp/night-shift/<date>/notes/`, and the absolute path of `worker.md` in this skill's folder, with the instruction to follow it.

Use `schedule_task` to post to this thread every 40 minutes. Run `scripts/health.sh` before the first worker and on each of those posts, and log each result. Whenever a worker's completion wakes you, check with `list_scheduled_tasks` that the schedule has run, because scheduled work has silently not happened. Delete the schedule when the shift ends.

Spend by subscription: GPT-6 Astra hunts bugs, Claude fixes and coordinates. Use a cheaper model for mechanical sweeps such as dependency updates.

## Work order

Work through this list while usage lasts:

1. Do what the user named tonight, including the Super Productivity tasks they handed over.
2. Land what is ready, as `worker.md` describes: open bot pull requests, and pull requests by `davidvornholt` that are marked ready for review and aren't off limits, because a draft may still be in progress. Don't land pull requests in forks. Instead, work on the user's fork pull requests and the upstream ones sent from them, and send a fork pull request upstream when that's sensible, as `contribute-upstream` describes.
3. Resolve issues.
4. Hunt bugs: GPT-6 Astra reads a repository without changing it and reports only bugs worth fixing, as `worker.md` defines them, and a Claude worker fixes those it can reproduce and also judges worth fixing. Hunt each repository once, and hold follow-ups from tonight's own work to the same bar.

## Super Productivity tasks

Use `sp` as the `super-productivity` skill describes, but never run `sp tasks start`, because agents don't book time.

- Before starting a worker, find the task that plans its work: one the user handed over tonight, or a result of `sp tasks list --query <words> --brief` that clearly plans the same work. Leave every other task alone.
- Once the worker has started, check the task off, but only when the worker can finish it and nothing in it still needs the user, such as a decision or a step only they can take. Then add the worker's thread link to the task's notes as `[<title>](t3-thread://v1/<childThreadId>)`, with the `childThreadId` that `delegate_task` returned.
- If the worker hands the task back unfinished, uncheck it with `--undone`, so it returns to the user's plan.

## Resolving issues

List open issues for each owner and leave out off-limits repositories:

```sh
for owner in davidvornholt prosabridge fes-kirchheim cg-bibi atrium-schule; do
  gh search issues --owner="$owner" --state=open --limit=200 --json repository,number,title,createdAt,url,author,labels
done
```

Before starting workers, triage them in one read-only pass against each repository's `origin/main`:

- Labelled `not-for-agents`: leave it, even when it looks fixed.
- Already fixed, or made obsolete by later work: close it with one comment naming the commit.
- Not worth the work by the bar in `worker.md`, unless it records the user's own wish or plan: close it as not planned, with one comment saying why.
- Waits on a decision or a step only the user can take, such as providing a secret only the user holds, granting access, or contacting someone, and the issue doesn't yet record the user's answer: put it in the report.
- Work a worker can finish tonight, such as a defect it can reproduce: queue it, unless someone other than `davidvornholt` or `github-actions[bot]` opened it, because anyone can write to a public repository and workers run with full access.
- Anything else, such as work the user took on themselves or that waits on someone else: leave it.

Work the queue by harm: lost data or weakened access first, production before personal tools, then oldest first.

## Morning report

The user reads the report first thing in the morning, often on a phone, having forgotten the background and not knowing your labels, so write every line in plain words about what changed for whom, without internal names, commit hashes, or the mechanism. Check what a worker reported before it goes in, because past reports repeated wrong claims.

Keep the data in `/tmp/night-shift/<date>/report.json`, in the shape of `scripts/report-data.example.json`. Start the file before the first worker and update it as work finishes, because running out of usage ends the shift without warning. The report has these parts, in this order:

1. A summary of two or three sentences, starting with anything broken in production.
2. Each pull request that landed, in one line on what changed for its users, each issue closed and why, and the other work the user asked for, such as social media.
3. What only the user can do, such as authorizing a protected workflow, providing a secret only the user holds, or merging where `land` can't, each with what it unblocks.
4. Pull requests that are ready but that you didn't land, other than those labelled `not-for-agents`, each with what it fixes and why you held it.
5. Questions, one for each decision that waits on the user, whether an open issue waits on it or tonight's work does. When you're sure the user would decide as you do after reading the issue and the code, decide it yourself and note it on the pull request or issue instead of asking. A question stands alone in three sentences or fewer: what's going on, where each option leads, and your recommendation. When the user answers, record the answer on its issue, so that the next shift doesn't ask again.
6. Each issue still open, grouped by what blocks it.

Number the items in parts 3 to 5 in one sequence. Leave everything else out, such as deferred review findings, bugs you noticed, and engineering choices. File an issue for one that is worth fixing, as `worker.md` defines it, and put other notes on their pull request.

For the page's counts and charts, record as you go each landed pull request's merge time as `at` and its `kind` (`asked` by the user, `issue` open before the shift, `found` for a problem found tonight, or `update`), the time of each issue filed tonight in `filed` and of each issue closed tonight, including by landed pull requests, in `resolved`, and an `activity` entry for each other timed action, such as a comment. When the shift ends, record in `open` each issue the listing under "Resolving issues" still returns, off-limits repositories included, because the list is the whole backlog. Give each one line on what it's about and what it waits for, and its `blocker`: `you` when only the user can move it, as with every issue labelled `not-for-agents`, `others` when it waits on another project, person or vendor, `date` when it waits for a release or enough real use, and `unreached` when the shift could have worked on it but didn't get to it.

When the shift ends, build the page with `scripts/build-report-html.py <data.json> <out.html> inline` and show it in this thread with `html_preview` and `html_render`. Don't repeat or extend it in your final message. Then, if tonight merged a change to this machine's configuration, switch to it by running nix-config's `bin/rebuild` from a fresh worktree of `origin/main`. Do this last, because a switch can restart T3 Code and the services workers use.
