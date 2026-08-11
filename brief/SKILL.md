---
name: brief
description: Morning briefing — what happened yesterday in one line, today's scheduled tasks, inbox items needing attention, and a suggested focus if nothing is scheduled. Read-only; output stays in the session.
disable-model-invocation: true
---

# Morning brief

Produce a short morning briefing (aim for under ~300 words) directly in the session. This is a read-only skill: never modify Super Productivity data, never write files, never touch drafts or send mail.

## 1. Establish dates

Run `date +%F` for today; compute yesterday from it.

## 2. Super Productivity — tasks

Data source is the newest backup JSON (the live store is IndexedDB; backups are the readable mirror):

```
B="$HOME/.var/app/com.super_productivity.SuperProductivity/config/superProductivity/backups"
L=$(ls -t "$B"/*.json | head -1)
```

Mention the backup's timestamp in the briefing if it is older than ~18 hours (data may be stale; Super Productivity may not be running).

Structure notes: top-level keys include `task`, `archiveYoung`, `archiveOld`, `project`, `tag`. Entity maps live at `.<node>.entities` keyed by id. `doneOn` is epoch ms; `dueDay` is `YYYY-MM-DD`; `timeSpentOnDay` maps `YYYY-MM-DD` → ms; subtasks have `parentId`.

Useful extractions (tested):

```
# project id → name
jq -r '.project.entities[] | [.id, .title] | @tsv' "$L"
# open tasks with due day and parent
jq -r '.task.entities[] | select(.isDone|not) | [.title, (.projectId//"-"), (.dueDay//"-"), (.parentId//"-")] | @tsv' "$L"
# tasks in the Today list, resolved to titles (entities are keyed by id)
jq -r '.tag.entities.TODAY.taskIds[] as $id | (.task.entities[$id].title // empty)' "$L"
# done yesterday (epoch-ms window; completed tasks migrate into the archives)
jq -r --argjson s <start_ms> --argjson e <end_ms> '(.task.entities, (.archiveYoung.task.entities//{}))[] | select(.doneOn and .doneOn>=$s and .doneOn<$e) | .title' "$L"
```

Compute the ms window with `$(( $(date -d "<YYYY-MM-DD> 00:00:00" +%s) * 1000 ))` (local time).

## 3. Mail — inbox scan

Use `mcp__mail__search_mail` with `since: <yesterday>` across all accounts (omit `account`). There is no unread filter — judge relevance from content:

- Surface first: human-written mail, anything deadline-bearing, replies the user is waiting on.
- Compress automated noise (GitHub notifications, newsletters) to at most one line, and only if it matters (e.g. a repeatedly failing CI workflow).
- Only call `read_message` if a subject line is ambiguous AND likely important (e.g. to extract a deadline).

## 4. GitHub — review requests and CI

Authenticated `gh` is available (account: davidvornholt; ignore any other account). The orgs `prosabridge` and `fes-kirchheim` (FESK) matter beyond own authorship — bot and teammate PRs there count. The token has write scopes — this skill may only run read/search commands (`gh search`, `gh api` GETs); never comment, merge, close, or edit anything.

```
gh search prs --review-requested=@me --state=open --json repository,title,updatedAt --limit 20
gh search prs --author=@me --state=open --json repository,title,isDraft --limit 20
# anything open in the orgs, any author (catches bot/teammate PRs awaiting a decision)
gh search prs --owner=prosabridge --owner=fes-kirchheim --state=open --json repository,title,author --limit 20
gh api notifications --jq '.[] | [.repository.full_name, .subject.type, .subject.title] | @tsv'
```

Notifications are dominated by CheckSuite noise. Rule: a failing workflow on `main` or a production/deploy pipeline deserves one line (grouped per repo); feature-branch CI failures are noise — drop them. Surface real items: review requests, mentions, issues assigned.

## 5. Compose the briefing

Format, in this order:

1. **Yesterday, in one line** — from tasks completed yesterday (SP). Do NOT read session transcripts; that is /wrap's job, and the brief must stay cheap.
2. **Scheduled for today** — tasks with `dueDay` = today plus the Today-tag list, with project names.
3. **Inbox needing you** — mail and GitHub combined: human mail and deadlines first, then review requests and own PRs sitting open, then at most one line of CI-on-main trouble.
4. **Suggestion** — only if nothing is scheduled for today: propose ONE task from the open list, with a one-sentence rationale (deadline proximity, momentum from yesterday's completions, or an inbox item that maps to an existing task). A deadline in the inbox may override the task list — say so if it does.

Output goes in the session as markdown. Do not write it anywhere.
