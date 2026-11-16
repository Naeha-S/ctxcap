## What

`AGENTS.md` line 3 tells an agent that `CLAUDE.md` exists.
It does not:

> Guidance for AI coding agents working in this repository. Tool-agnostic; `CLAUDE.md` points here.

## Why it matters

An agent that follows this file will look for `CLAUDE.md`, not find it, and either stop or guess. The rest of the file is unaffected.

## Fix

Replace Tool-agnostic; `CLAUDE.md` points here. with Tool-agnostic. on that line.

## How it was found

[ctxcap](https://github.com/Naeha-S/ctxcap) checks every path and `npm run` script named in a context file against the repository:

```bash
npx ctxcap --stale
```

It is offline and needs no key. This is the only finding in `twbs/bootstrap`.
