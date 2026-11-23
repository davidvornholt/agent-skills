---
name: contribute-upstream
description: Use when contributing a change to a project the user doesn't maintain from their fork, including sending its pull requests upstream and following up on their reviews. Not for the user's own repositories, where their standards apply.
---

# Contributing upstream

The user contributes to projects they don't maintain from a fork. A change gets a pull request in the fork first and is reviewed there, usually with review-fix. Upstream's conventions apply, not the user's own standards.

Issues that `review-fix` files from a fork pull request go in the fork, with `gh issue create -R <owner>/<fork>`, because `gh` can otherwise default to upstream. Say in the issue whether the defect also exists on upstream. File an issue upstream only when the user decides to.

## Sending a pull request

Send a fork pull request upstream as soon as it's marked ready for review, because one that waits drifts from upstream and the maintainer may fix the problem their own way first. To hold one back, convert it to a draft and say in a comment why and what it waits for.

Before sending, check the change against upstream's current default branch. If upstream fixed the problem or reworked the code in the meantime, close the fork pull request with a comment that names the upstream commit instead.

Before branching, sync the fork with `gh repo sync <owner>/<fork>`, then branch from upstream's default branch. The fork's default branch only mirrors upstream. If upstream moves on before the upstream pull request is open, rebase onto it and run the checks again.

Write the upstream pull request in upstream's template, and follow its contribution guide, including the checks it asks for. Write as the user, in a friendly tone: open with a short greeting and say why the change matters, then fill in the template. Link the fork pull request as the review record. Say what changed since that review, such as a resolved conflict or code moved to pass a check. For a breaking change, say who is affected and what they should use instead.

Once the upstream pull request is open, close the fork pull request with a one-line comment that links it. Delete the fork branch once nothing uses it: right away, unless it's the upstream pull request's head, and otherwise once upstream merges or closes that. Delete it with `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`, because `git push --delete` runs the pre-push hook, which can run the whole test suite.

## Following up

Check the user's open upstream pull requests for reviews, comments, and failed checks since the user's last comment or push. A label the maintainer reviews with, such as `needs work`, counts as a review. Make the changes the maintainer's review asks of the pull request, and nothing else it asks, run upstream's checks, push, and reply once with what changed and in which commit. Don't comment otherwise, and don't remind a maintainer who hasn't responded. When the maintainer pauses or declines a change, leave it as they decided and tell the user.

The user can't re-run upstream's CI jobs, so to start a new run after a failure the change didn't cause, merge upstream's default branch into the branch and push. Merge rather than rebase once the upstream pull request is open, because a force push breaks the links from review comments to their commits.
