#!/usr/bin/env bash
# Usage: land.sh <owner/repo> <pr> [health]
# Marks a draft ready, updates the branch, waits for green CI, squash-merges the exact head, then waits for every push run on the merge commit.
# A head without a .github/workflows folder runs no CI, so the script merges it once no check has appeared for three polls in a row.
# Exit 0: merged, and its push runs are green or it has none. Exit 1: nothing merged. Exit 2: merged, but a push run isn't green.
# With a third argument, health.sh runs after the push runs finish.
set -uo pipefail
R=$1; P=$2; HEALTH=${3:-}
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
log() { printf '%s [%s#%s] %s\n' "$(date +%H:%M:%S)" "${R#*/}" "$P" "$*"; }
health() { if [[ -n $HEALTH ]]; then bash "$SCRIPTS/health.sh"; fi; }
# True only when GitHub answers 404 for the folder. Any other error counts as a folder, so the script keeps waiting for checks.
no_workflows() { local err; err=$(gh api "repos/$R/contents/.github/workflows?ref=$1" --silent 2>&1) && return 1; [[ $err == *"HTTP 404"* ]]; }

state=$(gh pr view "$P" -R "$R" --json state -q .state)
[[ $state == OPEN ]] || { log "not open ($state)"; exit 1; }
if [[ $(gh pr view "$P" -R "$R" --json isDraft -q .isDraft) == true ]]; then
  gh pr ready "$P" -R "$R" >/dev/null && log "marked ready"
fi
gh pr update-branch "$P" -R "$R" >/dev/null 2>&1 && log "branch update requested"
sleep 90
head=$(gh pr view "$P" -R "$R" --json headRefOid -q .headRefOid); log "head $head"

s=""; m=""; quiet=0
for _ in $(seq 1 45); do
  n=$(gh pr view "$P" -R "$R" --json statusCheckRollup -q '.statusCheckRollup | length')
  # A check run that hasn't finished has an empty conclusion, so read its status first.
  s=$(gh pr view "$P" -R "$R" --json statusCheckRollup -q '[.statusCheckRollup[] | if .__typename == "CheckRun" then (if .status == "COMPLETED" then .conclusion else "PENDING" end) else (.state // "PENDING") end] | map(select(. != "SKIPPED" and . != "NEUTRAL")) | unique | join(",")')
  m=$(gh pr view "$P" -R "$R" --json mergeStateStatus -q .mergeStateStatus)
  log "checks: ${s:-none} merge: $m"
  if [[ $m == BEHIND ]]; then
    gh pr update-branch "$P" -R "$R" >/dev/null 2>&1 && log "behind main again, branch update requested"
    sleep 60
    head=$(gh pr view "$P" -R "$R" --json headRefOid -q .headRefOid); log "head $head"
    quiet=0
    continue
  fi
  case "$s" in *FAILURE*|*CANCELLED*|*TIMED_OUT*|*ERROR*|*ACTION_REQUIRED*) log "CI failed, not merging"; exit 1;; esac
  [[ $s == SUCCESS && $m == CLEAN ]] && break
  if [[ $n == 0 && $m == CLEAN ]] && no_workflows "$head"; then quiet=$((quiet + 1)); else quiet=0; fi
  (( quiet >= 3 )) && { log "no workflows and no checks on the head, merging without CI"; break; }
  sleep 60
done
[[ ($s == SUCCESS || $quiet -ge 3) && $m == CLEAN ]] || { log "CI not green and clean within 45 min"; exit 1; }
[[ -n $head ]] || { log "no head commit read, not merging"; exit 1; }
[[ $(gh pr view "$P" -R "$R" --json headRefOid -q .headRefOid) == "$head" ]] || { log "head moved, not merging"; exit 1; }

gh pr merge "$P" -R "$R" --squash --match-head-commit "$head" >/dev/null || { log "merge failed"; exit 1; }
sleep 20
sha=$(gh pr view "$P" -R "$R" --json mergeCommit -q .mergeCommit.oid)
[[ -n $sha ]] || { log "merged, but no merge commit is visible yet, so check its push runs by hand"; exit 2; }
log "MERGED $sha"

verdict='if length == 0 then "none" elif any(.[]; .status != "completed") then "running" elif all(.[]; .conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral") then "green" else "red" end'
result=none
for i in $(seq 1 60); do
  sleep 60
  log "push runs: $(gh run list -R "$R" --commit "$sha" --event push --json workflowName,status,conclusion -q '[.[] | "\(.workflowName)=\(.status)/\(.conclusion)"] | join("; ")')"
  result=$(gh run list -R "$R" --commit "$sha" --event push --json status,conclusion -q "$verdict")
  [[ $result == green || $result == red ]] && break
  # A repository without push workflows never gets a run, so stop waiting after a few minutes.
  [[ $result == none && $i -ge 5 ]] && break
done
health
case "$result" in
  green) log "push runs green"; exit 0;;
  none) log "no push runs"; exit 0;;
  *) log "PUSH RUNS NOT GREEN ($result)"; exit 2;;
esac
