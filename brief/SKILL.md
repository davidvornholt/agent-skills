---
name: brief
description: Use when the user asks for their morning brief.
disable-model-invocation: true
---

# Morning brief

Brief the user on yesterday, today's plan, and everything waiting on them. When the session can show an HTML page, as T3 Code can, present the brief as a visual report. Otherwise write it in the session.

The brief is read-only, so on GitHub run only searches and GET requests.

Get today's date with `date +%F` and derive yesterday from it.

## Tasks

Read Super Productivity through `sp`. The X1 and the z890 each run a copy that syncs through SuperSync, so use the local one. If the local read reports `AppUnreachable` or `TokenUnavailable`, retry once with `--host` set to the other machine, `david-x1-nixos` or `david-z890-nixos`. If it succeeds, use that host for the remaining reads; otherwise follow the super-productivity skill's connection guidance. Don't read the app's data or backup files instead, because they can be stale.

Today's plan is `sp tasks list --today --brief`, and the open tasks are `sp tasks list --brief`. Open tasks with a deadline in the next seven days need the user. Resolve project ids with `sp projects list`.

For yesterday, take the tasks checked off that day and those with time tracked that day. A checked-off task is out of the user's hands, often handed to an agent session, so the sessions say whether its work is finished. Tracked time is work away from the computer. `--brief` drops `doneOn`, so this query uses the full output:

```sh
Y=<yesterday>
sp tasks list --include-done --source all | jq -r \
  --arg d "$Y" --argjson s "$(date -d "$Y" +%s)000" --argjson e "$(date -d "$Y +1 day" +%s)000" \
  '.[] | select((.doneOn // 0) >= $s and (.doneOn // 0) < $e or .timeSpentOnDay[$d]) | [.title, (if .doneOn then (.doneOn / 1000 | strflocaltime("%F")) else "open" end)] | @tsv'
```

## Agent sessions

Most of the user's work runs in Claude Code and Codex sessions, and their transcripts are the only record of what an agent left waiting on the user. Transcripts are large, so start one subagent on them first and read the other sources while it runs. Give it these instructions:

- The z890 (`david-z890-nixos`) holds the transcripts. Elsewhere, run every search there through `ssh -o BatchMode=yes david@david-z890-nixos`, and never copy `~/.claude` or `~/.codex` to this machine.
- Take every session active since the start of yesterday, from `find ~/.claude/projects -name '*.jsonl' -newermt <yesterday>` and `find ~/.codex/sessions -type f -newermt <yesterday>`, and skip this session.
- Don't read whole files. Extract user and assistant text with `jq` or `rg`, or read the first and last 100 lines. Fold Codex review and fix subagent runs into the work they served.
- A file may still be receiving events, so a session that may still be running is in progress, not waiting.
- Return only what's unfinished or waiting on the user, one line per item with its project, and leave out days or sessions the user has marked as off-limits.

## Mail

`pim mail search --folder INBOX --since <yesterday> --limit 100` searches every account's inbox. Without `--folder` it also returns sent and archived mail, and without `--limit` it stops at 20 hits across all accounts. It has no unread filter, so judge relevance from content. Lead with mail that needs the user. Automated mail gets one line at most, and only when it matters. Open a message with `pim mail read --account <account> --folder <folder> --uid <uid>`, taking the values from its search hit, only when its subject is ambiguous and it's likely important.

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
3. What needs the user, from tasks, sessions, mail, and GitHub together: human mail, deadlines, and agents waiting on an answer first, then review requests and the user's own open pull requests, then at most one line about CI trouble on `main`. Merge items about the same pull request.
4. A suggestion, only when nothing is planned for today: one open task and a sentence on why. If a deadline in the inbox outranks the task list, say so.
