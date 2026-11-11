---
name: planner
description: The user's rules for Super Productivity. Use whenever the super-productivity skill applies, and when a thread takes over a planned task or leaves something only the user can do.
---

# Planner

Super Productivity holds only the future: the plan, deadlines, and obligations only the user can fulfil. Work in progress and finished work live in T3 Code threads.

- Checking a task off with `sp tasks update <id> --done` means it is out of the user's hands, not that it is done. When a thread takes over a planned task, check the task off as the thread starts.
- Never add a task for unplanned work, for an agent session, or to record finished work. Don't use the "Orchestrierung" tag.
- When a thread leaves something only the user can do, such as renewing a key before it expires, add a task for it with `--deadline`. Keep deadlines on tasks; don't copy them into the calendar.
- Track or log time only when the user asks.
