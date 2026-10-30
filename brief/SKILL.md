---
name: brief
description: Morning briefing on yesterday, today's planned tasks, and what's waiting on the user in agent sessions, mail, and GitHub, with a suggested focus when nothing is planned. Read-only.
disable-model-invocation: true
---

# Morning brief

Brief the user on yesterday, today's plan, and everything waiting on them. When the session can show an HTML page, as T3 Code can, present the brief as a visual report. Otherwise write it in the session.

The brief is read-only, so on GitHub run only searches and GET requests. Get today's date with `date +%F`.

## Tasks

Read Super Productivity through `sp`. The app runs on the X1, so pass `--host david-x1-nixos` unless you're on the X1. Don't fall back to backup files, because the z890's stopped updating in August. If the app is unreachable, follow the super-productivity skill.

Today's plan is `sp tasks list --host david-x1-nixos --today --brief`, and the open tasks for a suggestion are the same without `--today`.

For yesterday, take the tasks completed or tracked that day, because the user sometimes logs a day's work afterwards. `--brief` drops `doneOn`, so this query uses the full output:

```sh
Y=<yesterday>
sp tasks list --host david-x1-nixos --include-done --source all | jq -r \
  --arg d "$Y" --argjson s "$(date -d "$Y" +%s)000" --argjson e "$(date -d "$Y +1 day" +%s)000" \
  '.[] | select((.doneOn // 0) >= $s and (.doneOn // 0) < $e or .timeSpentOnDay[$d]) | [.title, (if .doneOn then (.doneOn / 1000 | strflocaltime("%F")) else "open" end)] | @tsv'
```

## Agent sessions

Most of the user's work runs in Claude Code and Codex sessions, and their transcripts are the only record of what an agent left waiting on the user. Start one subagent on them first and read the other sources while it runs. Have it take every session active since the start of yesterday, find and read them as the transcript section of `~/.agents/skills/wrap/SKILL.md` describes, and skip this session. It returns only what's unfinished or waiting on the user, one line per item with its project. A session that may still be running is in progress, not waiting.

## Mail

Search every account's inbox with `pim mail search --folder INBOX --since <yesterday> --limit 100`. Lead with mail that needs the user. Automated mail gets one line at most, and only when it matters. Open a message only when its subject is ambiguous and it's likely important.

## GitHub

Use the `davidvornholt` account and ignore any other. Open pull requests by anyone in the `prosabridge` and `fes-kirchheim` (FESK) organizations count too, because bot and teammate pull requests there wait on the user's decision.

```sh
gh search prs --review-requested=@me --state=open --json repository,title,url,updatedAt --limit 20
gh search prs --author=@me --state=open --json repository,title,url,isDraft --limit 20
gh search prs --owner=prosabridge --owner=fes-kirchheim --state=open --json repository,title,url,author --limit 20
gh api notifications --jq '.[] | [.repository.full_name, .subject.type, .subject.title] | @tsv'
```

Notifications are mostly CheckSuite noise. Keep review requests, mentions, and assigned issues. A failing workflow on `main` or a deploy pipeline is worth one line per repository, and CI failures on feature branches aren't.

## The briefing

Write these parts in order:

1. Yesterday in brief, from the tasks and sessions.
2. Today's plan, with project names.
3. What needs the user, from sessions, mail, and GitHub together: human mail, deadlines, and agents waiting on an answer first, then review requests and the user's own open pull requests, then at most one line about CI trouble on `main`. Merge items about the same pull request.
4. A suggestion, only when nothing is planned for today: one open task and a sentence on why. If a deadline in the inbox outranks the task list, say so.
