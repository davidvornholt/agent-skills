---
name: handoff
description: Write a handoff document that lets a fresh agent continue the work of the current conversation.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Write a document that lets a fresh agent, which has none of this conversation's context, continue the work. If the user passed arguments, they describe what the next session will focus on, so shape the document around that.

The next agent can read specs, plans, issues, pull requests, commits, and diffs itself, so link to them by path or URL instead of restating them. Spend the words on what exists only in this conversation: the decisions made and why, approaches that were tried and failed, open questions, and the next concrete step. End with the skills the next agent should load, by name.

Save the document in the system's temporary directory (`${TMPDIR:-/tmp}`), not in the workspace, so it can't end up in a commit, and tell the user its path. Leave out secrets and personal data such as API keys, passwords, and email addresses, because the document is meant to be passed along.
