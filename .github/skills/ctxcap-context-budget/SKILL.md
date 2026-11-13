---
name: ctxcap-context-budget
description: 'Use when CLAUDE.md, AGENTS.md, Cursor rules, or prompts are oversized, stale, duplicated, or consuming too much context. Measure with ctxcap, create a ranked line-range plan, apply safely, and verify drift without rewriting files.'
argument-hint: '[budget]'
---

# ctxcap context-budget workflow

Use this workflow when an agent context file is bloated, contains stale
references, duplicates instructions, or causes context-window pressure.

## CLI workflow

1. Run `npx ctxcap --json` to measure current totals and deltas.
2. Run `npx ctxcap --stale --json` when dead paths, commands, globs, or
   references may be present.
3. Generate a plan with `npx ctxcap --plan --budget <n>`.
4. If `satisfiable` is false, report `minAchievable` and stop.
5. On a clean working tree, apply with
   `npx ctxcap --plan --budget <n> --apply`.
6. Apply entries by `startLine`/`endLine`; never rewrite a context file and
   never cut a span listed in `preserve`.
7. Verify with `npx ctxcap --verify <planId>` and do not consider the budget
   met until `satisfied` is true.

Plans are stored under `.ctxcap/plans/` and expire after 24 hours. Review
`git diff` before committing. Do not apply plans in CI.

## MCP workflow

Call `context_budget_plan` with an integer `budget`, apply its ranked splices,
then call `context_budget_verify` with the returned `planId` in the same MCP
server session. Stop when `tokensRemaining <= 0` or `satisfiable` is false.
