# Stale-reference receipts

Once a month, the context files of the repositories in the
[Context Budget Index](../leaderboard/) are checked against the repositories
they describe. A reference that does not resolve is a factual defect with a
one-line fix, so each one is read, then published with the exact line and,
where there is one, a pull request that fixes it.

- <https://naeha-s.github.io/ctxcap/receipts/> always shows the newest month.
- <https://naeha-s.github.io/ctxcap/receipts/2026-11/> is the permanent page
  for one month.
- The first month is [2026-11](2026-11.md).

## What counts as a receipt

A row is published only when all three are true:

1. `ctxcap --stale` reports that a path, glob, or `npm run` script named in a
   context file does not resolve on the default branch.
2. A person reads the line and agrees that it is an assertion about the
   repository, not a naming example, a template, a prohibition, or one of two
   alternatives.
3. `reviews.json` records that reading under `<repo>#<reference>`.

The excluded list is published too. Hiding the false positives would make the
true positives worth less.

## Reviews

`reviews.json` is the whole editorial record:

```json
"twbs/bootstrap#CLAUDE.md": {
  "status": "defect",
  "reason": "The sentence asserts that a CLAUDE.md points at this file. There is no CLAUDE.md at the root...",
  "replace": { "from": "Tool-agnostic; `CLAUDE.md` points here.", "to": "Tool-agnostic." }
}
```

`status` is `defect` or `not-a-defect`. `replace` is optional; when it is
present and the exact text appears on the line, `scripts/receipts.mjs` writes a
one-line patch next to the pull request body under `prs/`. A finding with no
review entry is counted as unreviewed and is never called a defect.

## The audit series

`series.md` is the numbered list, ten slots and no more. An audit is the
receipt process run on one repository with the maintainer's consent, plus the
before-and-after counts and the exact edits. Request one with the
[audit form](https://github.com/Naeha-S/ctxcap/issues/new?template=audit.yml).

## Build it

```bash
npm run receipts          # scan, write receipts/<month>.json and .md
npm run leaderboard:page  # rebuild docs/, including docs/receipts/
```

| Flag | Effect |
| --- | --- |
| `--month <yyyy-mm>` | Leaderboard month to scan (default: the newest) |
| `--top <n>` | Only the first n repositories |
| `--offline` | Fail on a cache miss instead of calling the API |
| `--refresh` | Ignore the cache and fetch everything again |
| `--no-prs` | Do not write `receipts/prs/` |

The script reads through `gh api`, so it needs an authenticated `gh`. Every
response is cached under `.ctxcap/receipts-cache/`, which git ignores; a rerun
from a warm cache makes no network calls and writes the same bytes. The script
is not part of the npm package.

For each repository, the file tree is laid out as empty files and the context
files are written with their real contents, so path resolution and glob checks
work without cloning anything. `package.json` files are fetched up to 20 per
repository; if there are more, `dead-command` findings are dropped rather than
guessed. A tree GitHub truncates is listed as not scanned.

## Sending a pull request

`prs/` holds one body and one patch per confirmed defect. Nothing is sent
automatically. To send one:

```bash
gh repo fork twbs/bootstrap --clone --remote
cd bootstrap
git switch -c docs/dead-reference
git apply ../receipts/prs/twbs-bootstrap-CLAUDE-md.patch
git commit -am "docs: remove a dead CLAUDE.md reference"
git push -u origin HEAD
gh pr create --repo twbs/bootstrap --title "docs: remove a dead CLAUDE.md reference" --body-file ../receipts/prs/twbs-bootstrap-CLAUDE-md.md
```

A receipt is not a rebuke. Every repository here is better maintained than
most; two dead references in 25 of the most-starred files is a good rate, and
a one-line fix is the whole ask.

## Every month

`.github/workflows/receipts.yml` runs at 08:00 UTC on the 16th. It scans the
newest index month with the workflow token, writes the data, and commits it.
New findings arrive as unreviewed; the page counts them and does not call them
defects until `reviews.json` says so.
