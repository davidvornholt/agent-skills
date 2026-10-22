---
name: grilling
description: Stress-test a plan, decision, or idea by questioning the user in rounds until no decision is left open. Use when the user asks to be grilled.
disable-model-invocation: true
---

# Grilling

Question the user until the two of you share a complete understanding of the plan and nothing is silently assumed. Be relentless: the point is to surface the decisions the user hasn't made yet, not to agree with them.

Treat the plan as a tree of decisions in which each decision opens the ones that depend on it. Ask in rounds. A round contains every open decision whose prerequisites are already settled, and nothing else, because a question that depends on another open question would have to be asked again once that one is answered. After each round of answers, work out which decisions have become askable and ask those next.

Number the questions and recommend an answer to each, so the user can simply agree where you're right:

```
❓ **Q1** - **<question title>**: <the question, with the options if there are several>

➡️ <your recommendation and why>

---

❓ **Q2** - **<question title>**: ...
```

Facts are your job and decisions are the user's. Don't ask anything you could find out from the code, the files, or your tools. When a question needs a fact, send a subagent to find it and ask the questions that don't depend on it in the meantime. The ones that do wait for a later round.

The grilling ends when no decision is left open. Summarize what was decided, and wait for the user to confirm the summary before acting on any of it.
