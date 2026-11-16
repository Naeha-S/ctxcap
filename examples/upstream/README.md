# The two upstream PRs, and what was wrong with them

Both are open:

| Repo | PR | Files in it | Why it would not have worked |
| --- | --- | ---: | --- |
| `affaan-m/ECC` | [#3943](https://github.com/affaan-m/ECC/pull/3943) | 1 | No `ctxcap-baseline.json`, so the first context-file PR after merge goes red on the file's whole size. Its own PR never ran the check either — the `paths:` filter excludes `.github/workflows/**`. |
| `ultraworkers/claw-code` | [#3392](https://github.com/ultraworkers/claw-code/pull/3392) | 1 | Same two problems, plus it measures 1,893 of the repo's **9,008** tokens: the nine nested `AGENTS.md`/`CLAUDE.md` files under `rust/` and `src/` are invisible to it. |

Both were verified by running the workflow's exact command against a real
checkout of each repo. This directory holds the files that fix them, ready to
commit onto the branches.

## Why the baseline matters

`--baseline <ref>` reads `ctxcap-baseline.json` **at that ref**. With no such
file, the baseline is empty and the delta becomes the file's entire size, so
every PR that touches a context file fails — including a PR that only adds the
workflow:

```
$ npx ctxcap@1.5.1 --baseline <merge-base> --fail-on increase
TOKENS  DELTA  FILE
723     +723   AGENTS.md          # not growth: there was nothing to compare against
9       +9     CLAUDE.md
total 732 (+732)
no baseline found — delta is the full current size
```

The intended pattern, which the tool supports directly, is to commit the
baseline in the same PR that adds the workflow. Growth is then counted as
acknowledged when the same change also updates the baseline, so the baseline
diff is what a reviewer approves. Measured on the real checkouts:

```
ECC        13,286 tokens / 42 files    delta 0 -> exit 0
claw-code   9,008 tokens / 11 files    delta 0 -> exit 0
```

and a PR that adds ~400 tokens of guidance to either one still fails:

```
$ ... --fail-on increase
3184  +390  AGENTS.md          exit 1     # ECC
1242  +480  rust/crates/api/AGENTS.md  exit 1     # claw-code, a nested file
```

## What to commit on each branch

### `affaan-m/ECC`, branch `ci/ctxcap-context-budget`

| Path | File here |
| --- | --- |
| `.github/workflows/ctxcap.yml` | [`ECC/.github/workflows/ctxcap.yml`](ECC/.github/workflows/ctxcap.yml) |
| `ctxcap-baseline.json` | [`ECC/ctxcap-baseline.json`](ECC/ctxcap-baseline.json) |

The workflow also gains `workflow_dispatch` and three more `paths:` entries
(`ctxcap-baseline.json`, `.ctxcap.json`, the workflow itself) so that a PR
touching only the baseline or the workflow still gets checked.

### `ultraworkers/claw-code`, branch `ci/ctxcap-context-budget`

| Path | File here |
| --- | --- |
| `.github/workflows/ctxcap.yml` | [`claw-code/.github/workflows/ctxcap.yml`](claw-code/.github/workflows/ctxcap.yml) |
| `.ctxcap.json` | [`claw-code/.ctxcap.json`](claw-code/.ctxcap.json) |
| `ctxcap-baseline.json` | [`claw-code/ctxcap-baseline.json`](claw-code/ctxcap-baseline.json) |

`.ctxcap.json` is what makes the nested files count. The default include set is
root-level only, which is correct for most repos and wrong for a monorepo whose
per-crate instructions are the ones an agent actually loads:

```json
{ "include": ["AGENTS.md", "CLAUDE.md", "**/AGENTS.md", "**/CLAUDE.md"] }
```

With it the measured total goes from 1,893 to 9,008, and the `paths:` filter
becomes `**/AGENTS.md` / `**/CLAUDE.md` so a change to any of the eleven files
triggers the check.

## Comment to post on #3943

> Pushed a follow-up to this branch: `ctxcap-baseline.json`, plus the workflow
> now also triggers on changes to the baseline and to the workflow file itself.
>
> Without the baseline this would have failed the first PR that touched any
> context file after merge, because `--baseline <merge-base>` reads the baseline
> at that ref, and with no baseline file the delta is the file's entire size
> rather than its growth. The baseline pins today's state — 13,286 tokens across
> 42 files — so growth is measured against it, and an intentional increase is
> approved by reviewing the baseline diff. Verified against `main` at the commit
> in this branch: delta 0, exit 0; and with 30 added lines to `AGENTS.md`:
> `+390`, exit 1.
>
> The `paths:` filter also excluded this PR's own file, so the check never ran
> here. It runs now.

## Comment to post on #3392

> Pushed a follow-up: `.ctxcap.json`, `ctxcap-baseline.json`, and a widened
> `paths:` filter.
>
> Two things were wrong with the first version.
>
> **It only measured 2 of the 11 files.** The default include set is root-level
> only, but this repo keeps per-crate instructions in `rust/crates/*/AGENTS.md`
> and `src/AGENTS.md`, which is what a harness working in those directories is
> actually given. `.ctxcap.json` switches the scope to `**/AGENTS.md` and
> `**/CLAUDE.md`, so the measured total is 9,008 tokens rather than 1,893, and
> the workflow triggers on a change to any of the eleven.
>
> **It would have failed the next context-file PR for the wrong reason.**
> `--baseline <merge-base>` reads `ctxcap-baseline.json` at that ref; with no
> baseline file, the delta is the file's whole size instead of its growth. The
> baseline is committed here so growth is measured against it, and an intended
> increase is approved by reviewing the baseline diff.
>
> Verified against `main` at the commit in this branch: delta 0, exit 0. With 30
> lines added to `rust/crates/api/AGENTS.md`: `+480` on that file, exit 1.

## Branch status

The follow-ups are now pushed to both branches and the explanatory comments
are posted:

- [ECC #3943](https://github.com/affaan-m/ECC/pull/3943), commit `151d512e`
- [claw-code #3392](https://github.com/ultraworkers/claw-code/pull/3392),
  commit `1660f76c`

The committed-baseline checks return delta 0 and exit 0. Their workflow runs
may still need the upstream repository's normal first-time/action approval.
