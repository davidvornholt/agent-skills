---
name: land
description: Use when merging or landing a pull request.
---

# Land

Merge pull requests with `land` (`scripts/land` in this skill's folder), never with `gh pr merge`. It waits until the checks on the pull request's current head have passed, squash-merges exactly that head, deletes the local branch, and waits for the runs the merge starts, such as a deploy. GitHub can't require checks in private repositories on its free plan, and there `land`'s wait is the only gate. It needs `git`, Python 3, and a signed-in `gh`.

```sh
land 123            # From any checkout of the repository, or inside the pull request's worktree.
land                # The current branch's pull request.
land 123 --no-wait  # Don't wait for pending checks.
```

## Before landing

In a repository without `.github/workflows`, `land` merges at once, so run the repository's own checks on the final commit first.

Use `--no-wait` only when the change can't affect the checks, as for a change to documentation only, or when the repository's workflows don't run on pull requests. It still refuses a failed check, still waits for a check skipped before the pull request was marked ready, and never overrides the repository's rules.

`land` refuses merge options such as `--auto` or `--admin`. Where nothing requires checks, `--auto` merges before CI has run.

## What it waits for

`land` marks a draft ready, updates the branch when GitHub requires it to be up to date, and waits up to 45 minutes. It doesn't trust a result that may not be final yet:

- A pull request that changed less than a minute ago counts as not yet checked, because CI starts with a delay.
- A cancelled check counts as pending in that minute, because the run that cancelled it may not show yet.
- A check skipped before the pull request was marked ready counts as pending when its workflow runs again on the ready event, because nothing ran for it.

After the merge, it waits up to 60 minutes for the push runs on the merge commit and for every run started through `workflow_run` after the merge, until they have stayed green for a minute. Stopping it then leaves the merge in place.

## Exit codes

- **0:** merged, and the runs after the merge passed or there were none. Cleanup problems are only warnings.
- **1:** nothing merged; the message says why. When a check failed because of a problem already fixed on the base branch, run `gh pr update-branch <pr>` and then `land` again.
- **2:** merged, but a run after the merge isn't green or couldn't be read. Check the linked run now. GitHub files a run started through `workflow_run` under the default branch's newest commit, so `land` counts every such run after the merge, and a red one may come from another pull request.

## Cleanup

`land` deletes only the pull request's local branch, and only when every commit on it is part of the merged pull request. It never deletes remote branches; GitHub's "Automatically delete head branches" setting does, and `land` warns when it's off. When it lands the current branch, it needs a clean working tree, then switches to the base branch and fast-forwards it. Inside a worktree whose base branch is checked out elsewhere, `land` leaves the worktree detached; remove it with `git worktree remove <path>`. Running `land` on a merged pull request only cleans up, so it's safe to repeat.
