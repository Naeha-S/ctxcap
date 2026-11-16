# What popular repositories spend on agent context files

One file per month. Each takes the most-starred GitHub repositories in star
order, keeps the first N that have an `AGENTS.md` or `CLAUDE.md`, and counts
what those files cost in tokens with [ctxcap](https://github.com/Naeha-S/ctxcap).

- [2026-11](2026-11.md)

It is a sample, not a ranking of GitHub: each file states how many repositories
were checked to find its N, and that hit rate is as much the finding as the
table is. Repositories whose context files are all under 200 tokens are listed
as clean and not ranked.

## Build it

```bash
GITHUB_TOKEN=<token> npm run leaderboard -- --top 25
```

| Flag | Effect |
| --- | --- |
| `--top <n>` | Repositories to include (default: 25) |
| `--depth <n>` | How deep to look for context files. `1`, the default, is the repository root; `2` adds files one directory down, and so on |
| `--month <yyyy-mm>` | Month in the file name (default: this month, UTC) |
| `--refresh` | Ignore the cache and fetch everything again |
| `--offline` | Fail on a cache miss instead of calling the API |

The script is `scripts/leaderboard.mjs`. It is not part of the npm package. It
needs a GitHub token for the API; no scopes are required for public
repositories. Every response is cached under `.ctxcap/cache/`, so a second run
makes no network calls and writes the same bytes. Delta is measured against
the previous month's `.json` file in this directory.

## How files are counted

- Depth 1 counts only files at the repository root. Nested files, files these
  import, and other rule files are not counted.
- A symlink is counted as the file it points to, because that is what an agent
  that opens it reads. `torvalds/linux` has `AGENTS.md → README`: an agent that
  opens `AGENTS.md` there is given the kernel README, so the README's tokens
  are what that file costs.
- A file that is a copy of the one beside it, or that only imports it
  (`@AGENTS.md`), is counted once.
- Archived repositories are skipped.
- The counts are approximate: `gpt-tokenizer`, not each model's own tokenizer.
