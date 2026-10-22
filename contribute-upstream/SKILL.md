---
name: contribute-upstream
description: Use when contributing a change to a project the user doesn't maintain, from their fork, including opening the upstream pull request and closing the fork pull request afterwards. Not for the user's own repositories, where their standards apply.
---

# Contributing upstream

The user contributes to projects they don't maintain from a fork. A change gets a pull request in the fork first and is reviewed there, usually with review-fix. It goes upstream only when the user decides to send it. Upstream's conventions apply, not the user's own standards.

Before branching, sync the fork with `gh repo sync <owner>/<fork>`, then branch from upstream's default branch. The fork's default branch only mirrors upstream. If upstream moves on before the upstream pull request is open, rebase onto it and run the checks again.

Write the upstream pull request in upstream's template, and follow its contribution guide, including the checks it asks for. Write as the user, in a friendly tone: open with a short greeting and say why the change matters, then fill in the template. Link the fork pull request as the review record. Say what changed since that review, such as a resolved conflict or code moved to pass a check. For a breaking change, say who is affected and what they should use instead.

Once the upstream pull request is open, close the fork pull request with a one-line comment that links it. Delete the fork branch too, unless the upstream pull request uses it as its head. Delete it with `gh api -X DELETE repos/<owner>/<repo>/git/refs/heads/<branch>`, because `git push --delete` runs the pre-push hook, which can run the whole test suite.
