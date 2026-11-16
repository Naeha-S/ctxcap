## What

`AGENTS.md` line 38 tells an agent that `.github/scripts/check-quality.js` exists.
It does not:

> - The `PR Quality Checks` workflow will run `.github/scripts/check-quality.js`; ensure referenced links in PR bodies are reachable.

## Why it matters

An agent that follows this file will look for `.github/scripts/check-quality.js`, not find it, and either stop or guess. The rest of the file is unaffected.

## Fix

Replace `.github/scripts/check-quality.js` with `.github/scripts/check-quality/` on that line.

## How it was found

[ctxcap](https://github.com/Naeha-S/ctxcap) checks every path and `npm run` script named in a context file against the repository:

```bash
npx ctxcap --stale
```

It is offline and needs no key. This is the only finding in `avelino/awesome-go`.
