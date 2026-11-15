---
name: context-budget
description: Measure how many tokens agent context files cost (CLAUDE.md, AGENTS.md, Cursor rules, prompt files), find references in them to files or npm scripts that no longer exist, and plan a trim to a token budget. Use when asked how big these files are, whether they are stale or out of date, or to shrink them. Runs the offline ctxcap CLI with npx.
argument-hint: '[budget]'
---

# Context budget with ctxcap

`ctxcap` is an offline CLI. It needs Node 20 or newer and no API key or
config. Run it from the repository root. Counts are approximate (`o200k_base`
encoding), so compare changes rather than absolute numbers.

## Measure

```bash
npx -y ctxcap --json
```

Report `total` and each entry in `files` (`path`, `tokens`, `delta`). `delta`
is the change against `ctxcap-baseline.json`; without a baseline it is the
whole size.

## Find stale references

```bash
npx -y ctxcap --stale --json
```

Each entry in `findings` names a dead reference in `ref` and its place in
`path`, `startLine`, and `endLine`. Before you change anything, confirm that
the reference is really gone: search for the file or script under a new name.
If it moved, fix the reference. Delete the line only when the thing it
describes no longer exists. A run with no findings means no path or
`npm run` script failed to resolve; it does not mean the file is current.

## Trim to a budget

Only when the user asks to get under a token budget.

1. Plan: `npx -y ctxcap --plan --budget <n>`.
2. If `satisfiable` is false, report `minAchievable` and stop.
3. Edit by `startLine`/`endLine` from each `plan` entry. Never rewrite a
   context file from memory. Never cut a span listed in `preserve`; the one
   exception is a `condense` entry on that span, where you apply its
   `condensedText` exactly as given.
4. Verify: `npx -y ctxcap --verify <planId>`. The budget is met only when
   `satisfied` is true and `violations` is empty.
5. Show the user the `git diff` and let them decide. Do not commit it for
   them.

Plans are saved under `.ctxcap/plans/` and expire after 24 hours; a
`PLAN_EXPIRED` error means you make a new plan. Do not run `--apply` in CI.

## Keep it from growing back

Offer these once, do not set them up unasked:

- `npx -y ctxcap --update-baseline`, then commit `ctxcap-baseline.json`.
- The GitHub Action `Naeha-S/ctxcap@v1` with `fail-on: increase`, which
  comments the token change on each pull request.
