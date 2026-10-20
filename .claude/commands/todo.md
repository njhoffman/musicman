---
description: Status of TODO.md, or one section's full notes
argument-hint: "[section heading text]"
allowed-tools: Bash(.claude/scripts/todo-status:*)
---

Output of `.claude/scripts/todo-status "$ARGUMENTS"`:

!`.claude/scripts/todo-status "$ARGUMENTS"`

Arguments: "$ARGUMENTS"

With no arguments, the output above is the overview: open items per section,
done/total counts, and due dates. Give a short status: totals, which sections
have the most open work, and every item marked OVERDUE or due within a week.
Keep it short rather than reprinting every item.

With an argument, the output above is that section's full text from TODO.md.
Summarize where it stands: open vs done items, what looks like the next
concrete step, and anything blocked or waiting on a decision.

Items take a due date as `(due YYYY-MM-DD)` anywhere in their text.
