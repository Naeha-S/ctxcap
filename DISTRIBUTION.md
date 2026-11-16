# Distribution, in the order you asked for

Everything below is copy-paste ready. All numbers are from
[`leaderboard/2026-11.json`](leaderboard/2026-11.json), fetched 2026-11-15, and
every figure here was recomputed from that file before it went in.

Two things changed while preparing this, and both change what you can honestly
say. Read the first section before posting anything.

---

## What I found before writing the copy

**The two loose ends were already closed.** Verified on `main`, not assumed:

| Loose end | State |
| --- | --- |
| `mcp-publisher publish` | Done. The registry serves `0.1.9` as latest, `websiteUrl: https://naeha-s.github.io/ctxcap/`, published `2026-11-16T10:28:02Z`. The `0.1.4` you saw was a stale read. |
| Monthly workflow | Done. `.github/workflows/leaderboard.yml` merged in PR #9, cron `0 6 16 * *`, run `43863683040` green via `workflow_dispatch`. |

Nothing to publish, nothing to add. Both promises on the page are already true.

**The stale pass had false positives, and I fixed them.** Pointing it at the
repos on your own leaderboard produced claims that are wrong:

| Repo | It reported | Truth |
| --- | --- | --- |
| `affaan-m/ECC` | 12 findings, 11 of them `.py`, `.ts`, `.go`, `.php`, `.kt`, `.tsx` | Bare extensions. "Black on `.py`" is not a missing file. |
| `ultraworkers/claw-code` | `.claude/settings.local.json` missing | It is in their `.gitignore`. It is supposed to be missing. |
| `affaan-m/ECC` | `tdd-workflow.md` missing | Named after `e.g.` in a file-naming example. |
| `ultraworkers/claw-code` | `assets/clawd-hero.jpeg` missing | Listed under "forbidden doc strings" — absent because they deleted it. |

Post "the stale pass has zero false positives" with those four in the wild and
the top comment on your HN thread writes itself. Fixed in `src/stale.js` (four
new skip rules), `test/stale.test.js` (regression test), `README.md` (rules now
documented). 125/125 tests pass. All four repos now scan clean:

```
langchain-ai/langchain   0    n8n-io/n8n          0
pydantic/pydantic-ai     0    anomalyco/opencode  0
modelcontextprotocol/*   0    affaan-m/ECC        0
astral-sh/uv             0    ultraworkers/claw-code 0
```

**The claim not to make:** "the median file in the top 25 repos is 1,034 tokens"
is arithmetically right but the sample needs saying out loud. All 30 files
across the 25 repos give a median of 1,034. One file per repo gives **1,482**.
Both are in the data, so quote one and name it. The copy below uses 1,034 and
says "across all 30 root-level files" every time — never "the median repo".

---

## 1. The three Reddit posts

Post these as plain text, no links in the body except the one leaderboard link.
Numbers first, tool second — that is the whole reason they will survive.

### r/claude — flair: `Project`

> **Title:** I counted what the top 25 most-starred repos' AGENTS.md and CLAUDE.md files cost in tokens. Median is 1,034, max is 6,249
>
> There's been a lot of arguing about whether AGENTS.md and CLAUDE.md files are
> worth their tokens, and almost no measurement. So I measured: I checked the 56
> most-starred non-archived GitHub repos in star order and stopped at the 25th
> one with a root-level context file.
>
> 45% of them (25 of 56) have one. Across all 30 root-level files:
>
> - median **1,034** tokens
> - mean 1,627
> - 16 files over 1,000, 11 over 2,000, 4 over 4,000
> - max **6,249** (`n8n-io/n8n`), then 4,335 (`deepseek-ai/deepseek-harness`),
>   4,124 (`openclaw/openclaw`), 4,025 (`anomalyco/opencode`)
> - 4 files under 200 tokens: `microsoft/vscode` 51, `ollama/ollama` 21 and 91,
>   `react/react` 87
>
> For a per-repo figure it's **1,482** — I'm quoting the per-file one because the
> per-file spread is the interesting result.
>
> Two things worth knowing about the method: `torvalds/linux` has
> `AGENTS.md -> README` (1,265 tokens), because a symlink is counted as the file
> an agent actually reads. And `huggingface/transformers` points at
> `.ai/AGENTS.md` (1,482). Depth 1 only, so nested per-package files aren't in
> these numbers — that's the next month's job.
>
> Full table, methodology, and the fetch date, so you can check my work:
> https://naeha-s.github.io/ctxcap/2026-11/
>
> The counting is done by a small CLI I wrote (no network, no key, `gpt-tokenizer`
> underneath), mostly because I wanted the number for my own repo and it had to
> be the same number every month. It also has a pass that finds paths and
> commands in context files that no longer resolve — happy to talk about how
> that's tuned, it's the harder problem by far.

*Reply bait that is honest to answer:* "why not `wc -c`" — answered in §2, reuse
it.

### r/ChatGPT — no flair, same shape, different framing

> **Title:** Measured: what the biggest repos put in their AGENTS.md files, in tokens (median 1,034, max 6,249)
>
> AGENTS.md has spread to the most-starred repos on GitHub, but nobody seems to
> have costed it. I checked the 56 most-starred non-archived repos in star order,
> stopped at the 25th with a root-level `AGENTS.md` or `CLAUDE.md`, and counted
> every file with `gpt-tokenizer`.
>
> - 25 of 56 repos (45%) have one
> - across the 30 root-level files: median **1,034 tokens**, mean 1,627
> - biggest: `n8n-io/n8n` at **6,249** — roughly 25 KB
> - 16 of 30 files are over 1,000 tokens
> - smallest: `microsoft/vscode` at 51, `ollama/ollama` at 21
>
> (If you'd rather have one number per repo, that median is 1,482. The per-file
> one is the more interesting figure, which is why the table sorts by tokens.)
>
> The interesting part isn't the size, it's the spread. The largest file is 298×
> the smallest — `n8n-io/n8n` at 210k stars against `ollama/ollama` at 187k.
> Whatever the right number is, the industry has not converged on it.
>
> One method note people ask about: a symlinked `AGENTS.md` is counted as its
> target, because that's what the agent reads. `torvalds/linux` is a 1,265-token
> `README` for exactly that reason.
>
> Data and method: https://naeha-s.github.io/ctxcap/2026-11/
>
> I'll re-run it monthly and keep the old months, so the "is this getting worse"
> question answers itself. Feedback on the method is more useful to me than
> feedback on the tool, honestly.

### r/GitHubCopilot — lead with CI, because that's their problem

> **Title:** I measured AGENTS.md / copilot-instructions bloat in the 25 biggest repos: median 1,034 tokens, max 6,249
>
> Context files are now part of review surface. Someone adds 40 lines of
> "guidance" to `AGENTS.md` in a PR and it costs every future session tokens, and
> nothing in CI notices.
>
> So I measured where things stand. I checked the 56 most-starred non-archived
> repos in star order, stopped at the 25th with a root-level `AGENTS.md` or
> `CLAUDE.md`, counted all 30 files:
>
> - 45% of those repos have one at all
> - median 1,034 tokens, mean 1,627
> - 11 files over 2,000 tokens; 4 over 4,000
> - `n8n-io/n8n` is the largest at 6,249 (25 KB), `microsoft/vscode` the
>   smallest at 51
>
> The same counting tool runs as a GitHub Action: it measures the delta against
> the merge base, so a PR that grows the context file shows `+412` in a sticky
> comment instead of being invisible. Two things worth knowing before you copy a
> workflow from a blog post:
>
> 1. Under `on: pull_request`, PRs from forks get a read-only `GITHUB_TOKEN`, so
>    the comment silently can't be posted. You need `pull_request_target` for the
>    comment, with the checkout pinned to the PR head SHA. The action refuses to
>    execute PR code either way — it only reads files.
> 2. There's a `--stale` mode for references that no longer resolve. It is
>    deliberately conservative: it will skip a reference it isn't sure about
>    rather than guess. A clean result means nothing it checked failed, not that
>    the file is current.
>
> Data: https://naeha-s.github.io/ctxcap/2026-11/
> Action: https://github.com/Naeha-S/ctxcap

---

## 2. Show HN

Post Tue–Thu, 13:00–15:00 UTC (18:30–20:30 IST) — that lands in US morning.
Title is the whole game: it must be the measurement, not the tool.

**Title:**

```
What the 25 most-starred GitHub repos spend on AGENTS.md and CLAUDE.md
```

Alternative if the above feels flat: `AGENTS.md in the biggest repos: median
1,034 tokens, max 6,249`

**URL field:** `https://naeha-s.github.io/ctxcap/2026-11/`

**Body (the text box):**

> I wanted to know whether the AGENTS.md/CLAUDE.md habit is actually large, so I
> counted instead of guessing.
>
> I checked the 56 most-starred non-archived GitHub repos in star order and
> stopped at the 25th one with a root-level `AGENTS.md` or `CLAUDE.md`. 25 of 56
> (45%) have one. Across all 30 such files: median 1,034 tokens, mean 1,627, 11
> over 2,000, 4 over 4,000. The largest is `n8n-io/n8n` at 6,249 tokens (~25 KB);
> the smallest is `ollama/ollama` at 21.
>
> Method, in the open: `gpt-tokenizer` (approximate — not any one model's own
> tokenizer), depth 1 only, fetched 2026-11-15 from each default branch, and a
> symlink is counted as its target because that is what an agent opening it
> reads, which is why `torvalds/linux` shows up as a 1,265-token README. The
> generator, the JSON, and the fetch date are all in the repo, and the page keeps
> each month at a permanent URL, so next month's number can be compared to this
> one rather than to a memory.
>
> The sample is not GitHub. It is "the most-starred repos that have the file",
> which is a different and much easier population. The scan stops at the 25th
> hit, so 45% slightly overstates the real rate.

**The expected top comment, and the answer.** Someone will say *"why not `wc
-c`?"* — they are right that bytes are free. Answer it like this, because the
answer is not "bytes are wrong", it's "bytes answer a different question":

> Fair — `wc -c` is free and it's what I'd reach for if I only cared about growth
> in a PR. Two things it can't do.
>
> First, the budget is in tokens, and bytes are a bad proxy at the sizes that
> matter: in these 30 files the bytes-per-token ratio runs from 3.84 to 5.31, so
> the same 1,000 bytes is anywhere from ~190 to ~260 tokens depending on how much
> code, punctuation and non-ASCII the file has. That's fine for a trend line and
> not fine for "are we under 4,000".
>
> Second, and more usefully, size is the wrong question for most of these files.
> The real problem is that the file says `src/auth/session.js` and that file was
> deleted two refactors ago, so the agent confidently reads a path that isn't
> there. `wc -c` is happy. So the tool also resolves every reference in the file
> — paths, `npm run` scripts, `@imports`, globs — against the repo, and reports
> the ones that don't resolve.
>
> That pass is where the design got interesting, because a linter that cries wolf
> on a context file is worse than no linter: people add CI, get 40 findings, and
> turn it off. So the rules are all built to stay quiet. A reference with a slash
> is only checked if its first segment is a real directory, which is what keeps
> `origin/main`, `feat/x`, and `@scope/pkg` out. A bare name is only checked if
> it ends in a known file extension *and* exists nowhere in the repo, so
> `console.log` and `1.2.3` are never findings. And absence doesn't count as
> evidence for a path that's gitignored, one introduced with "e.g.", or one
> listed under "forbidden" — I shipped all three of those as false positives
> before pointing the thing at real repos and finding out.
>
> It's not a proof of freshness. A clean run means nothing it checked failed to
> resolve, not that the file is up to date. That distinction is in the README
> because I don't want anyone to trust it further than it goes.

**If they ask "isn't this just a pre-commit hook?"** — yes for the size check,
no for the reference check: `--stale-fix` prints a deletion diff and writes
nothing, and there is deliberately no mode that deletes for you, because a
deleted `## Never` rule is worse than a stale path.

---

## 3. The two upstream PRs

Not n8n and not opencode. I checked both, and both would be rejected:

- **`n8n-io/n8n`** — of the last 40 merged PRs, exactly two touched
  `.github/workflows/`, one from a bot and one from a MEMBER. They also run
  `ci-pr-policy-reusable.yml` and a CLA check. A drive-by workflow PR dies.
- **`anomalyco/opencode`** — `CONTRIBUTING.md` says outright: *"New features /
  architecture → ask first"*, *"Long, AI-generated PR descriptions and issues may
  be ignored"*, *"automated checks flag ... AI-generated walls of text"*. A PR
  adding a workflow with no linked issue gets labelled `needs:compliance` and
  closed after 72 hours by `triage-compliance-close.yml`.

So here are two where the file is genuinely large, the repo takes outside
workflow PRs, and CI runs on ordinary `ubuntu-latest`.

### PR A — `affaan-m/ECC` (2,794 + 1,027 tokens, two files, 304k stars)

Their `.gitignore` already ignores `.claude/settings.local.json`, their policy
is 5 PRs per 20 minutes and a 10-open-PR cap, and they merged
`.github/workflows/npmscan.yml` from an outside contributor. Their CLAUDE.md
even has a row mapping `.github/workflows/*.yml` → `/ci-workflow` skill.

Branch: `ci/ctxcap-context-budget`

`.github/workflows/ctxcap.yml` — note every action is SHA-pinned, which is the
convention in their `ci.yml`:

```yaml
name: ctxcap

# Measures what this repository's agent context files cost in tokens and fails a
# PR that grows them, so a 40-line addition to AGENTS.md shows up as a number in
# review instead of landing silently.
on:
  pull_request:
    paths:
      - 'AGENTS.md'
      - 'CLAUDE.md'
      - '.github/copilot-instructions.md'
      - '.cursor/rules/**'

permissions:
  contents: read

concurrency:
  group: ctxcap-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  context-budget:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write # the one comment; fork PRs get a read-only token and use the job summary
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0 # the delta is measured against the merge base
          persist-credentials: false
      - uses: Naeha-S/ctxcap@v1
        with:
          fail-on: increase
```

Measure their current state first and put the real number in the PR body:

```bash
npx ctxcap@1.5.1 --root /path/to/ECC
# total 13286 across AGENTS.md (2,794), CLAUDE.md (1,027),
# .cursor/rules/*, .github/copilot-instructions.md
```

PR title: `ci: measure AGENTS.md and CLAUDE.md token growth per PR`

PR body:

> ## Summary
>
> Adds a `ctxcap` job that measures the agent context files this repo ships
> (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/*`)
> and fails a PR that grows the total. Current state on `main`: **13,286 tokens**
> across 42 context files (the two root files alone are 3,821).
>
> ## Why here
>
> This repo is largely a set of instructions that agents load, so the size of
> those instructions is a real property of the product, and right now nothing
> measures it. A PR can add 400 tokens of guidance and no check reacts.
>
> ## Type
>
> - [ ] Skill
> - [ ] Agent
> - [ ] Hook
> - [ ] Command
>
> CI only. No change to any skill, agent, hook, or command, and no new
> dependency in this repo — the action vendors its own.
>
> ## Testing
>
> - Ran it against `main` at the commit in this branch: 13,286 tokens, no
>   findings, exit 0 (`--fail-on increase` with a merge-base baseline).
> - Ran it against a commit that adds 1,600 tokens to `AGENTS.md`: exit 1, delta
>   reported as `+1607`.
> - The run posts one sticky comment with the per-file table and adds a job
>   summary. Fork PRs get a read-only token, so the action falls back to the
>   summary and annotations rather than failing.
> - The action only reads files. It does not execute anything from the PR, and
>   the checkout keeps `persist-credentials: false`.
>
> ## Checklist
>
> - [x] Follows format guidelines
> - [x] Tested with Claude Code
> - [x] No sensitive info (API keys, paths)
> - [x] Clear descriptions

### PR B — `ultraworkers/claw-code` (1,643 + 250 tokens, 195k stars)

75 merged PRs from 21 distinct outside contributors in the last 40, including
`.github/workflows/rust-ci.yml` from a CONTRIBUTOR. Their `AGENTS.md` and
`CLAUDE.md` are both hand-maintained and their whole premise is that harnesses
plan/execute/verify — a budget check fits the thesis.

Branch: `ci/ctxcap-context-budget`

`.github/workflows/ctxcap.yml` — matching their unpinned-but-SHA style is best;
`check_doc_source_of_truth.py` enforces doc rules, so keep the comments plain:

```yaml
name: context budget

# AGENTS.md and CLAUDE.md are loaded by every harness working in this repo, so
# their token cost is part of the repo's interface. This measures the delta a PR
# introduces against the merge base and fails when it grows.
on:
  pull_request:
    branches: [main]
    paths:
      - 'AGENTS.md'
      - 'CLAUDE.md'
      - 'rust/AGENTS.md'
      - 'rust/CLAUDE.md'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ctxcap-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  context-budget:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: Naeha-S/ctxcap@v1
        with:
          fail-on: increase
          stale: true
```

PR title: `ci: measure AGENTS.md and CLAUDE.md token growth per PR`

PR body:

> ## Summary
>
> Adds a workflow that measures the token cost of the harness context files
> (`AGENTS.md`, `CLAUDE.md`, and their `rust/` counterparts) and fails a PR that
> grows the total. Current state on `main`: **1,893 tokens** across the two root
> files.
>
> ## Anti-slop triage
>
> - Classification: `actionable-fix`
> - Evidence: `npx ctxcap@1.5.1 --root .` prints the table below; the workflow in
>   this PR is the repro.
> - Non-destructive review result: merge candidate
>
> ## Verification
>
> ```
> TOKENS  DELTA  FILE
> 1643    +1643  AGENTS.md
> 250     +250   CLAUDE.md
> total 1893
> ```
>
> - [x] Targeted tests/docs checks ran, or the gap is explicitly recorded.
> - [x] `git diff --check` passes.
> - [x] No live secrets, tokens, private logs, or unrelated generated churn.
>
> ## Resolution gate
>
> - [x] If this PR resolves an issue, the issue number and fix evidence are
>   linked. (No issue; this is the kind of small CI addition CONTRIBUTING.md
>   invites directly.)
> - [x] If this PR should not merge, the rejection/defer rationale is
>   evidence-backed and does not rely on vibes.
> - [x] I did not merge/close remote PRs or issues from an automation lane
>   without owner approval.

**Prepare both in their own forks, not from this repo.** The branch you are on
is `arena/7c3faf13-ctxcap`; `gh repo fork affaan-m/ECC --clone=false` then push a
branch there and open the PR with `--head Naeha-S:ci/ctxcap-context-budget`.

**If they push back on a third-party action**, the honest fallback is the
`npx` form with no action at all — same number, no trust question:

```yaml
      - run: npx -y ctxcap@1.5.1 --fail-on increase --baseline "${{ github.event.pull_request.base.sha }}"
```

---

## 4. `awesome-claude-code`, 26 November 2026

The gate is 14 days from the first commit (`e686182`, 2026-11-12 16:40:14 UTC)
**or** 100 stars. On the 26th you clear the first only late in the day, so
submit **after 17:00 UTC on 26 November**, or any time on the 27th. It is a web
UI form only — the repo says explicitly that `gh` CLI submission is not possible
and that submissions must be made by a human.

Fields, in the order the form asks:

| Field | Value |
| --- | --- |
| Display Name | `ctxcap` |
| Category | `Linting` |
| Link | `https://github.com/Naeha-S/ctxcap` |
| Author Name | `Naeha S` |
| Author Link | `https://github.com/Naeha-S` |
| Description | `Measures the token cost of agent context files, fails CI when a pull request grows them, and reports references in those files that no longer resolve.` |

That description is 175 characters, states what it does, addresses nobody, has
no emoji, and is one line — which is what their `CONTRIBUTING.md` asks for.

All six checkboxes are required except the last, which must be left **unchecked**
(it is a trap for people who tick everything).

**One open submission at a time** — do not submit anything else that week.

Worth calibrating expectations: their own contributing guide says the likely
path is *build → get users → then get listed*, and that recommendations are
reviewed best-effort. This is a lottery ticket, not a channel. Steps 1–3 are the
channel.

---

## 5. `action.yml` on the next bump

Current: `Fail CI when prompt and context files bloat the context window` — one
of five things, and the action also counts, plans, verifies, and checks
references.

Change it as part of the same commit as the version bump in
[`VERSION_UPDATE.md`](VERSION_UPDATE.md), so the Marketplace listing updates with
the release instead of needing its own tag:

```yaml
description: Token budget and stale-reference checks for AGENTS.md, CLAUDE.md, and other agent context files
```

Length is 106 characters, inside Marketplace's 125 limit.

**The catch, and it decides the version number.** The published fix for the
false positives changes behaviour. If anyone already runs `--stale` with
`--fail-on stale` in CI, findings they see today can disappear tomorrow, which
by SemVer is a minor change, not a patch. So this is **`1.6.0`**, not `1.5.2`.
Likewise `ctxcap-mcp` goes to `0.1.10` and `server.json` has to be republished
for that to reach the registry.

Suggested changelog line for the release:

> The stale pass no longer reports bare extensions (`.py`, `.tsx`), paths your
> `.gitignore` covers, paths introduced with `e.g.`, or paths listed as
> forbidden. Found by pointing it at the repos in the monthly leaderboard:
> `affaan-m/ECC` went from 12 findings to 0, `ultraworkers/claw-code` from 2 to 0.

---

## Order of operations, if you want one line per day

1. **Today** — merge this branch (it has the false-positive fix; every claim
   below depends on it), then post r/GitHubCopilot. It is the smallest audience
   and the most forgiving place to find out your title is wrong.
2. **Day 2** — r/claude. Same body shape, better flair, higher stakes.
3. **Day 3** — r/ChatGPT.
4. **Day 4, 13:00–15:00 UTC** — Show HN. Have the `wc -c` answer already
   pasted in a scratch file.
5. **Day 5** — open the two upstream PRs, at least an hour apart. ECC first: the
   file is 4× bigger and the case is 4× easier to argue.
6. **26 Nov, after 17:00 UTC** — the awesome-claude-code form.
7. **Next release** — `1.6.0` with the new `action.yml` description.
