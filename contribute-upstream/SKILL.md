---
name: contribute-upstream
description: Use when contributing a change to a project the user doesn't maintain, from their fork, including sending the fork's pull requests upstream, following up on their reviews, and closing the fork pull requests afterwards. Not for the user's own repositories, where their standards apply.
---

# Contributing upstream

The user contributes to projects they don't maintain from a fork. A change gets a pull request in the fork first and is reviewed there, usually with review-fix. It goes upstream only when the user decides to send it. Upstream's conventions apply, not the user's own standards.

Issues that `review-fix` files from a fork pull request go in the fork, with `gh issue create -R <owner>/<fork>`, because `gh` can otherwise default to upstream. Say in the issue whether the defect also exists on upstream. File an issue upstream only when the user decides to.

## Sending a pull request

When the user has handed a fork's pull requests over, send each open one that is ready for review without waiting, starting with those in code that upstream is changing most, because a pull request that waits drifts from upstream and the maintainer may fix the problem their own way first. To hold one back, say in a comment on it why and what it waits for, so that the next session doesn't check it again.

Before sending, check the change against upstream's current default branch. If upstream fixed the problem or reworked the code in the meantime, close the fork pull request with a comment that names the upstream commit, instead of sending it.

Before branching, sync the fork with `gh repo sync <owner>/<fork>`, then branch from upstream's default branch. The fork's default branch only mirrors upstream. If upstream moves on before the upstream pull request is open, rebase onto it and run the checks again.

Write the upstream pull request in upstream's template, and follow its contribution guide, including the checks it asks for. Write as the user, in a friendly tone: open with a short greeting and say why the change matters, then fill in the template. Link the fork pull request as the review record. Say what changed since that review, such as a resolved conflict or code moved to pass a check. For a breaking change, say who is affected and what they should use instead.

Once the upstream pull request is open, close the fork pull request with a one-line comment that links it. Delete the fork branch too, unless the upstream pull request uses it as its head. Delete it with `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`, because `git push --delete` runs the pre-push hook, which can run the whole test suite.

## Following up

Check the fork's open pull requests and each of the user's open upstream pull requests for reviews, comments, and failed checks since the user's last comment or push. A label or bot comment that the maintainer uses to review, such as `needs work`, counts as a review. Address what a review asks for in the pull request's branch, run upstream's checks, push, and reply once with what changed and in which commit. Comment only to answer a review or to report such a change, and don't remind a maintainer who hasn't responded yet. When the maintainer pauses or declines a change, leave it as they decided and tell the user.

The user can't re-run upstream's CI jobs, so to start a new run, such as after a failure the change didn't cause, merge upstream's default branch into the branch and push. Once the upstream pull request is open, merge instead of rebasing, because a force push breaks the links from review comments to their commits.

Once upstream merges or closes the pull request, delete its branch in the fork and remove its worktree.
