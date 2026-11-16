# The ctxcap benchmark, November 2026

### What agents read before they work, measured three ways

**Summary.** `ctxcap` measures the tokens an agent pays before it has read any code. This writeup reports three measurements over one corpus, all reproducible from committed data: the 30 root context files in the 25 most-starred GitHub repositories that have one, the tool definitions of 16 popular MCP servers, and the references in those files that no longer resolve. The median context file is **1,034 tokens**; the largest is **6,249**. The median MCP server costs **1,074 tokens** in tool definitions, and the largest, Sentry, costs **46,512** — 92 times the four-tool `ctxcap` server. Sixteen servers together cost **103,890 tokens**, about 100 median context files. Two of five stale-reference candidates survived review as factual defects. The corpus also answers a popular guess: across these repositories, context size does **not** fall as stars rise (Spearman ρ = 0.269, permutation p = 0.194).

This is a benchmark in the sense of a fixed procedure over a defined corpus, not a competitive ranking: a large context file is not a bad one, and the numbers say what each costs, not whether it is worth it.

## 1. What is measured

Three quantities, all in tokens under OpenAI's `o200k_base` encoding: the **context-file cost** of a root `AGENTS.md` or `CLAUDE.md`, which an agent reads at session start and keeps; the **MCP tool-definition cost** of every tool a server exposes (name, description, input schema); and the **dead-reference count** — paths, globs, and `npm run` scripts in a context file that do not resolve on the default branch.

The unit matters. The context index ranks **files**, not repositories: two files in one repository are two rows, and one file reached through a symlink is one. The MCP index ranks **servers at startup with their default tool list**. Receipts count **references**, then filter them through human review.

## 2. Method

### 2.1 The context corpus

GitHub's search API was queried in descending star order, excluding archived repositories. The 56 most-starred repositories were checked and the first 25 with a root `AGENTS.md` or `CLAUDE.md` kept — **25/56 = 45%** of the repositories checked, a rate for this star band, not for GitHub at large.

- **Depth 1.** Only root files count; a small root beside a 10,000-token package file looks clean.
- **Symlinks read as their target.** `AGENTS.md → README` costs the README's tokens; a copy or a one-line import (`@AGENTS.md`) is counted once.
- **One snapshot**, fetched 2026-11-15 from each default branch; files under 200 tokens are listed but not ranked.
- **Tokenizer:** `gpt-tokenizer@3.0.1`, not Claude's or Gemini's, so counts are approximate and for comparison.

The result is 30 files in 25 repositories.

### 2.2 The MCP harness

Each server is pinned to an exact npm version in [`scripts/mcp-servers.json`](scripts/mcp-servers.json), installed into a cache, started over stdio, sent `initialize` (protocol `2024-11-05`) and `tools/list`, and stopped. Pagination is followed until exhausted. No tool is called; credential placeholders suffice for `tools/list`.

The counted serialization is `[{ "name", "description", "inputSchema" }]`. `title`, `annotations`, and `outputSchema` are omitted because not every client sends them, so **every number is a lower bound** on the default tool list. Servers that expose no tools until configured or connect to a database before answering are listed as **not measured** with the reason.

### 2.3 The receipts pass

For each repository in the corpus, the GitHub tree is laid out as empty files in a temporary directory; the context files, `.gitignore`, and up to 20 `package.json` manifests are written with real contents, and `ctxcap --stale` resolves every reference against that copy. Nothing is cloned or written to the repository.

A finding is a candidate, not a verdict: each line is read, and [`receipts/reviews.json`](receipts/reviews.json) records whether it is a defect, the reason, and, when available, a one-line replacement. Excluded candidates are published too. If more than 20 manifests exist, command findings are dropped rather than guessed; a tree GitHub truncates is not scanned, because absence cannot be proved from an unlisted file.

### 2.4 Statistics

The stars-versus-size question uses Spearman's rank correlation, because both are heavily skewed. Three versions are reported: one repository one vote (files summed), one file one vote, and the file test without sub-200-token files. Significance is a seeded two-sided permutation test (20,000 shuffles); the interval is 2,000 seeded bootstrap resamples.

## 3. Results

### 3.1 Context files

| Measure | Value |
| --- | ---: |
| Repositories checked / with a file | 56 / 25 |
| Files measured / repositories | 30 / 25 |
| Smallest / median / largest | 21 / 1,034 / 6,249 |
| Mean | 1,627.5 |
| Files ≥ 1,000 tokens / ≥ 2,000 tokens | 16 / 11 |
| Files under 200 tokens | 4 |

The five largest are `n8n-io/n8n` (6,249), `deepseek-ai/deepseek-harness` (4,335), `openclaw/openclaw` (4,124), `anomalyco/opencode` (4,025), and `Significant-Gravitas/AutoGPT` (3,665); the smallest is `ollama/ollama` (21).

`ctxcap --compare` places a file in this distribution: 4,100 tokens is larger than 27 of 30 files, the **90th percentile** — percentiles are the share of files at or below a value.

### 3.2 Stars and size

| Question | n | Spearman ρ | permutation p |
| --- | ---: | ---: | ---: |
| Repository total tokens vs stars | 25 | 0.269 | 0.1943 |
| One row per file vs stars | 30 | 0.328 | 0.0774 |
| Without files under 200 tokens | 26 | 0.288 | 0.1552 |

The 95% bootstrap interval for the repository-level ρ is **−0.121 to 0.575**. The association is weakly positive, not inverse, and not distinguishable from zero; with three tests, even the per-file p of 0.0774 does not survive a multiple-comparison correction. The extremes agree: the five smallest files sit in repositories with a median of **194,770** stars, the five largest in repositories with **226,984**. If the best-maintained wrote the least, that would be reversed.

### 3.3 MCP servers

Sixteen servers, 281 tool definitions, **103,890 tokens** in total; mean 6,493 per server, median 1,074.

| Server | Tools | Tokens | Tokens/tool |
| --- | ---: | ---: | ---: |
| Sentry | 73 | 46,512 | 637 |
| Firecrawl | 32 | 17,764 | 555 |
| Notion | 24 | 17,163 | 715 |
| Chrome DevTools | 33 | 6,753 | 205 |
| Playwright | 25 | 3,936 | 157 |
| GitHub | 26 | 3,548 | 137 |
| Filesystem | 14 | 1,695 | 121 |
| Everything | 13 | 1,082 | 83 |
| Context7 | 2 | 1,065 | 533 |
| Exa | 3 | 1,058 | 353 |
| Memory | 9 | 957 | 106 |
| Slack | 8 | 681 | 85 |
| Puppeteer | 7 | 540 | 77 |
| **ctxcap** | **4** | **507** | **127** |
| Brave Search | 2 | 319 | 160 |
| Browserbase | 6 | 310 | 52 |

Ten of 16 servers cost at least 1,000 tokens; four exceed 5,000. The largest is **7.4 times** the largest context file and **91.7 times** the `ctxcap` server. Tool count is a weak proxy: Notion spends 715 tokens per tool and Context7 533 for only two, while Browserbase spends 52. Connecting all sixteen would consume 103,890 tokens — roughly 100 median context files — before the first question.

### 3.4 Receipts

Of 25 selected repositories, **23 were scannable**; `openclaw/openclaw` and `torvalds/linux` have trees GitHub truncates. The pass produced five candidates, all read:

| Outcome | Count |
| --- | ---: |
| Confirmed defects | 2 |
| Excluded as naming examples or alternatives | 3 |
| Repositories with a confirmed defect | 2 |

The defects are `twbs/bootstrap` `AGENTS.md:3` ("Tool-agnostic; `CLAUDE.md` points here." — there is no `CLAUDE.md`) and `avelino/awesome-go` `AGENTS.md:38` (the workflow is said to run `.github/scripts/check-quality.js`; the path is a directory holding a Go program). The other 21 scannable repositories had no finding. Precision here was 2/5; recall is unknown, because the scanner only checks reference shapes it can prove are paths. The pass also fixed three false-positive patterns: `.d.ts` treated as a filename, naming sections and "file name" lines, and an absence stated on the previous line.

## 4. What this does not establish

- **The sample is not random.** It is star-ordered, root-only, and stops at 25 hits, over-representing widely starred repositories and under-representing nested context.
- **MCP numbers are lower bounds on defaults.** Clients differ in what they serialize; servers can hide tools behind configuration or flags; versions move. One `tools/list` at startup is not a configured session. The server set is curated, not a random registry sample.
- **Receipts have unknown recall.** Precision rests on five candidates and human review; two truncated trees are outside the scan.
- **One month, 30 files, 25 repositories.** The correlation is a null result at small n, not proof of no relationship. The interval includes zero; it does not rule out a small one.
- **No causal claim.** Nothing here says a smaller file makes a repository better maintained, or a larger tool list makes a server worse.

## 5. Reproducing it

Every number above is rebuilt from committed JSON:

```bash
npm run leaderboard -- --top 25   # crawl the corpus (needs GITHUB_TOKEN)
npm run index:data                # data/context-index.json for --compare
npm run mcp:index                 # pin, install, handshake, measure
npm run receipts                  # scan the index (needs gh)
npm run leaderboard:page          # rebuild docs/, all three sections
node scripts/analyze.mjs          # the correlation table
npm test                          # 154 tests
```

API responses and installs are cached and the statistical loops are seeded, so a warm rerun is offline. Data: [`leaderboard/2026-11.json`](leaderboard/2026-11.json), [`mcp-index/2026-11.json`](mcp-index/2026-11.json), [`receipts/2026-11.json`](receipts/2026-11.json). Pages: [the Context Budget Index](https://naeha-s.github.io/ctxcap/), [the MCP Context Cost Index](https://naeha-s.github.io/ctxcap/mcp/), [the receipts](https://naeha-s.github.io/ctxcap/receipts/).

## 6. Why measure this way

The numbers are cheap (no model calls), stable (pinned tokenizer and versions, permanent month pages), and auditable (false positives published next to true ones). The most useful result is also the least convenient: the memorable story — the best-maintained repositories write the least — is not in the data. Agent context is a measurable budget, MCP tool definitions can dominate it, and the only way to know is to count.
