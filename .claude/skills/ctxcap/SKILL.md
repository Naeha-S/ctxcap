---
name: ctxcap
description: Measure and trim agent context files (CLAUDE.md, AGENTS.md, .cursor/rules). Use before editing a context file, when it has grown past budget, or when a rule has stopped being followed. Typical requests are "my CLAUDE.md is getting long", "how many tokens does AGENTS.md cost", "the agent stopped following a rule".
---

<!-- ctxcap:managed -->
# ctxcap

Measure first. Trim only when the total is over budget.

```bash
npx ctxcap@1.5.1 --json                        # tokens per context file
npx ctxcap@1.5.1 --stale --json                # references that no longer resolve
```

The loop:

```bash
npx ctxcap@1.5.1 --plan --budget <n>           # ranked plan, JSON
npx ctxcap@1.5.1 --plan --budget <n> --apply   # apply it
npx ctxcap@1.5.1 --verify <planId>             # check what landed
```

Three rules:

1. Splice by `startLine`/`endLine`. Never rewrite a file from scratch.
2. Never cut a span listed in `preserve`. The one exception is a `condense`
   finding on that span: apply its `condensedText` exactly as given.
3. If `satisfiable` is false, report `minAchievable` and stop.

Show the user the diff before anything is committed.
