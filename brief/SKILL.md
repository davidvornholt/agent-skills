---
name: brief
description: Morning briefing — yesterday in brief, today's planned tasks, the agent sessions, mail, and GitHub items that need the user, and a suggested focus when nothing is planned. Read-only.
disable-model-invocation: true
---

# Morning brief

Brief the user on yesterday, today's plan, and everything waiting on them. When the session can show an HTML page, as T3 Code can, present the brief as a visual report. Otherwise write it in the session.

The brief is read-only, so on GitHub run only searches and GET requests.

Get today's date with `date +%F` and derive yesterday from it.

## Tasks

Read Super Productivity through `sp`. The user runs the app on the X1, so the commands pass `--host david-x1-nixos`. Drop the flag when running on the X1 itself. Don't fall back to backup files, because the z890's stopped updating in August. If the app is unreachable, follow the super-productivity skill.

Today's plan is `sp tasks list --host david-x1-nixos --today --brief`, and the open tasks for a suggestion are `sp tasks list --host david-x1-nixos --brief`. Resolve project ids with `sp projects list --host david-x1-nixos`.

For yesterday, take the tasks completed or tracked that day. `--brief` drops `doneOn`, so this query uses the full output:

```sh
Y=<yesterday>
sp tasks list --host david-x1-nixos --include-done --source all | jq -r \
  --arg d "$Y" --argjson s "$(date -d "$Y" +%s)000" --argjson e "$(date -d "$Y +1 day" +%s)000" \
  '.[] | select((.doneOn // 0) >= $s and (.doneOn // 0) < $e or .timeSpentOnDay[$d]) | [.title, (if .doneOn then (.doneOn / 1000 | strflocaltime("%F")) else "open" end)] | @tsv'
```

Tracked time counts because the user sometimes logs a day's work afterwards. Those tasks get `doneOn` on the day they were marked done but keep their time on the day it was spent.

## Agent sessions

Most of the user's work runs in Claude Code and Codex sessions, and their transcripts are the only record of what an agent left waiting on the user. Transcripts are large, so start one subagent on them first and read the other sources while it runs. Have it take every session active since the start of yesterday, find and read them as the transcript section of `~/.agents/skills/wrap/SKILL.md` describes, and skip this session. It returns only what's unfinished or waiting on the user, one line per item with its project. A session that may still be running is in progress, not waiting.

## Mail

`mailbox search --since <yesterday>` searches every account's inbox. It has no unread filter, so judge relevance from content. Lead with mail that needs the user. Automated mail gets one line at most, and only when it matters. Open a message with `mailbox read` only when its subject is ambiguous and it's likely important.

## GitHub

Use the `davidvornholt` account and ignore any other. Besides the user's own pull requests, open pull requests by anyone in the `prosabridge` and `fes-kirchheim` (FESK) organizations count, because bot and teammate pull requests there wait on the user's decision.

```sh
gh search prs --review-requested=@me --state=open --json repository,title,url,updatedAt --limit 20
gh search prs --author=@me --state=open --json repository,title,url,isDraft --limit 20
gh search prs --owner=prosabridge --owner=fes-kirchheim --state=open --json repository,title,url,author --limit 20
gh api notifications --jq '.[] | [.repository.full_name, .subject.type, .subject.title] | @tsv'
```

Notifications are mostly CheckSuite noise. A failing workflow on `main` or a deploy pipeline is worth one line per repository. CI failures on feature branches aren't. Keep review requests, mentions, and assigned issues.

## The briefing

Write these parts in order:

1. Yesterday in brief, from the tasks and sessions.
2. Today's plan, with project names.
3. What needs the user, from sessions, mail, and GitHub together: human mail, deadlines, and agents waiting on an answer first, then review requests and the user's own open pull requests, then at most one line about CI trouble on `main`. Merge items about the same pull request.
4. A suggestion, only when nothing is planned for today: one open task and a sentence on why. If a deadline in the inbox outranks the task list, say so.
