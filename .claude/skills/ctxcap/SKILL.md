---
name: ctxcap
description: Diagnose repository context costs and stale references. Use when an agent seems to miss repo rules, a context file has grown, or you need to find a broken instruction. Typical requests are "what is eating my context window", "why is my coding agent following stale instructions", "what MCP servers are configured".
---

<!-- ctxcap:managed -->
# ctxcap

Diagnose first. `why` ranks repository context files and skills, names configured MCP servers, and reports stale references and risky content. It does not know which skills are active or measure live MCP tool schemas.

```bash
npx ctxcap@1.6.0 why                           # ranked diagnosis with a fix per finding
npx ctxcap@1.6.0 --json                        # token counts per configured context file
npx ctxcap@1.6.0 --stale --json                # references that no longer resolve
```

The loop:

```bash
npx ctxcap@1.6.0 --plan --budget <n>           # ranked plan, JSON
npx ctxcap@1.6.0 --plan --budget <n> --apply   # apply it
npx ctxcap@1.6.0 --verify <planId>             # check what landed
```

Three rules:

1. Splice by `startLine`/`endLine`. Never rewrite a file from scratch.
2. Never cut a span listed in `preserve`. The one exception is a `condense`
   finding on that span: apply its `condensedText` exactly as given.
3. If `satisfiable` is false, report `minAchievable` and stop.

Show the user the diff before anything is committed.
