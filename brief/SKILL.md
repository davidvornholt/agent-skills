---
name: brief
description: Morning briefing in the session — yesterday in one line, today's planned tasks, the mail and GitHub items that need the user, and a suggested focus when nothing is planned. Read-only.
disable-model-invocation: true
---

# Morning brief

Write a short briefing, under about 300 words, directly in the session. The brief should stay cheap, so read only what the sections below need. Transcripts and activity logs belong to `/wrap`.

The brief is read-only. The `gh` token and the mailbox accounts can write, so this restraint is yours to keep: on GitHub, run only searches and GET requests.

Get today's date with `date +%F` and derive yesterday from it.

## Tasks

Read Super Productivity through `sp`. The user runs the app on the X1, so the commands pass `--host david-x1-nixos`. Drop the flag when running on the X1 itself, which can't SSH to itself. Don't fall back to backup files. The z890's stopped in August, so they'd quietly describe the wrong period. If the app is unreachable, follow the super-productivity skill.

Today's plan is `sp tasks list --host david-x1-nixos --today --brief`, and the open tasks for a suggestion are `sp tasks list --host david-x1-nixos --brief`. Resolve project ids with `sp projects list --host david-x1-nixos`.

For yesterday, take the tasks completed or tracked that day. `--brief` drops `doneOn`, so this query uses the full output:

```sh
Y=<yesterday>
sp tasks list --host david-x1-nixos --include-done --source all | jq -r \
  --arg d "$Y" --argjson s "$(date -d "$Y" +%s)000" --argjson e "$(date -d "$Y +1 day" +%s)000" \
  '.[] | select((.doneOn // 0) >= $s and (.doneOn // 0) < $e or .timeSpentOnDay[$d]) | [.title, (if .doneOn then (.doneOn / 1000 | strflocaltime("%F")) else "open" end)] | @tsv'
```

Tracked time counts because the user sometimes logs a day's work afterwards. Those tasks get `doneOn` on the day they were marked done but keep their time on the day it was spent.

## Mail

`mailbox search --since <yesterday>` searches every account's inbox. It has no unread filter, so judge relevance from content. Lead with mail that needs the user. Automated mail gets one line at most, and only when it matters. Open a message with `mailbox read` only when its subject is ambiguous and it's likely important.

## GitHub

Use the `davidvornholt` account and ignore any other. Besides the user's own pull requests, open pull requests by anyone in the `prosabridge` and `fes-kirchheim` (FESK) organizations count, because bot and teammate pull requests there wait on the user's decision.

```sh
gh search prs --review-requested=@me --state=open --json repository,title,updatedAt --limit 20
gh search prs --author=@me --state=open --json repository,title,isDraft --limit 20
gh search prs --owner=prosabridge --owner=fes-kirchheim --state=open --json repository,title,author --limit 20
gh api notifications --jq '.[] | [.repository.full_name, .subject.type, .subject.title] | @tsv'
```

Notifications are mostly CheckSuite noise. A failing workflow on `main` or a deploy pipeline is worth one line per repository. CI failures on feature branches aren't. Keep review requests, mentions, and assigned issues.

## The briefing

Write these parts in order:

1. Yesterday in one line, from the tasks above.
2. Today's plan, with project names.
3. What needs the user, mail and GitHub together: human mail and deadlines first, then review requests and the user's own open pull requests, then at most one line about CI trouble on `main`.
4. A suggestion, only when nothing is planned for today: one open task and a sentence on why. If a deadline in the inbox outranks the task list, say so.
