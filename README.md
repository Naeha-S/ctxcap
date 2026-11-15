# ctxcap

Offline token-budget linter for agent context files. It measures `CLAUDE.md`,
`AGENTS.md`, `prompts/**`, and `.cursor/rules/**`, finds references that no
longer resolve, and hands your agent a ranked, verifiable plan to get back
under budget.

No config, API key, network, or telemetry. Node >= 20. Two runtime
dependencies: `fast-glob` and `gpt-tokenizer`.

```bash
npx ctxcap --json
```

## The loop

Context files get trimmed by agents badly: the agent rewrites the file from
memory, drops the `## Never` rules, hits the budget, and ships a worse file.
`ctxcap` closes that loop with line ranges, safety flags, and verification.

```bash
npx ctxcap --plan --budget 40000              # ranked plan, JSON
npx ctxcap --plan --budget 40000 --apply      # splice atomically
npx ctxcap --verify <planId>                  # catch drift and violations
```

Three rules for the agent:

1. Splice by `startLine`/`endLine`. Never rewrite a file from scratch.
2. Never cut a span listed in `preserve`. The one exception is a `condense`
   finding on that span: apply its `condensedText` exactly as given.
3. If `satisfiable` is false, report `minAchievable` and stop.

Verification is a guardrail, not a semantic proof. It checks whether planned
source text was removed, whether applied files drifted, whether recorded
preserve text remains, and whether every rule sentence of a condensed
paragraph is still present. It cannot tell whether a replacement still means the
same thing or whether an unmarked instruction was important. Review the diff
and the surrounding scope, exceptions, and qualifiers before accepting a trim.

For higher-risk instructions, keep a small task-specific regression case that
captures the failure the rule prevents and run it before and after trimming.
`ctxcap` does not generate or evaluate these behavioral cases; each repository
needs its own way to check expected behavior.

### Where plans live

CLI plans are written to `.ctxcap/plans/<planId>.json`. Add `.ctxcap/` to
`.gitignore`; plans are local working state, not source. Plans expire after
24 hours. If a plan is missing or expired, verification returns the structured
`PLAN_EXPIRED` error and you should generate a new plan. Run `--apply` on a
clean tree, then review with `git diff` before committing. Do not run
`--apply` in CI.

Agents can fetch the five-line loop from [`llms.txt`](llms.txt).

## Measured case study

[`examples/case-study/`](examples/case-study/) contains a reproducible
multi-file run. It starts with 1,504 tokens (1,473 startup-loaded and 31
always-loaded), applies plan `6b8e55` at budget 400, and finishes at 228
tokens. The plan's `minAchievable` is 228 and two condenses apply. One of them
is on a load-bearing paragraph in `AGENTS.md`: its replacement keeps the
`Do not silently drop a requirement` sentence. The preserve span in
`CLAUDE.md` is untouched, and verification reports zero missed findings or
violations.

The committed [`before.json`](examples/case-study/before.json),
[`plan.json`](examples/case-study/plan.json), [`apply.json`](examples/case-study/apply.json),
[`apply.diff`](examples/case-study/apply.diff), [`verify.json`](examples/case-study/verify.json),
and [`after.json`](examples/case-study/after.json) show every number. The
context files in that directory are committed in their "before" state. Re-run
the commands below from the repository root to reproduce it, then restore the
files with `git checkout examples/case-study`:

```bash
npx ctxcap --json --root examples/case-study
npx ctxcap --plan --budget 400 --root examples/case-study
npx ctxcap --plan --budget 400 --apply --root examples/case-study
npx ctxcap --verify 6b8e55 --root examples/case-study
```

Both replacements end at sentence boundaries, and verification confirmed them
by content rather than trusting shifted line numbers. The 1,276-token
reduction is useful because the remaining 228 tokens still include both rules:
the `Do not` sentence in `AGENTS.md` and the `# Never` rule in `CLAUDE.md`.

Context can be stale as well as large. Run the dead-reference pass to find
paths, commands, globs, and `@path`/`#path` references that no longer resolve:

```bash
npx ctxcap --stale --json
```

It reports reclaimable tokens and emits inline SARIF annotations with
`--sarif`. Use `--fail-on stale` to gate CI, or `--stale-fix` to print a
deletion diff without modifying files.

The stale pass prefers silence to guessing. It only checks references that are
spelled like a path into this repository:

- with a slash, the first segment must be an existing directory (`src/gone.js`
  is checked; `origin/main`, `feat/x`, and `@scope/pkg` are not);
- without a slash, the name must end in a known file extension and exist
  nowhere in the repository (`gone.config.ts` is checked; `console.log` and
  `1.2.3` are not);
- `npm run <script>` must be a script in some `package.json` in the repository.

Paths resolve against the repository root and the context file's own
directory. Fenced code blocks, commands, absolute paths, `../` paths, URLs, and
anything containing `~`, `$`, `:`, or `<` are skipped. Each finding names the
dead reference in `ref` and the lines it would remove in `startLine`/`endLine`:
the list item that holds the reference, or the paragraph when it is not in a
list. Add `<!-- ctxcap-ignore -->` to a line to suppress it.

`--stale-fix` prints a deletion diff and leaves out blocks that also hold a
rule; fix those by hand. There is deliberately no `--stale --apply` mode.

## Why

Agent context files — `CLAUDE.md`, `AGENTS.md`, `prompts/**`, `.cursor/rules/` — grow every sprint. They get pasted into every request and silently burn your context window. Nothing gates them at the repo level.

`ctxcap` fixes that: it measures context files, tracks token deltas against a committed baseline, finds stale references, produces ranked plans, verifies edits, fails CI when you define a budget, and exposes an MCP server so agents can check themselves.

It is for maintainers who already use repository-level agent context and want
repeatable measurements and reviewable trim plans. It does not decide which
instructions are valuable. Keep durable behavior rules and non-inferable
landmines in always-loaded files; move task decisions and their rationale to
issues, ADRs, or PRs, and detailed repo facts to focused docs or manifests
that agents can load when relevant. Prefer actionable instructions, and leave
general style rules to linters when they can enforce them. A useful review
question is: could an agent infer this from the repository, build scripts, or
linters? If so, it may not need always-loaded space. Keep one source of truth
for each topic and prune or archive short-lived TODOs and notes.

## How this differs from `tokenlint`

`tokenlint` hooks your editor and reminds you per turn about wasteful habits. `ctxcap` gates the repo: it measures context files against a committed baseline, reports the delta on every PR, and fails only when you ask it to. Different layer — CI and review, not keystrokes.

No baseline, stale-reference pass, ranked plan, verify step, SARIF, or MCP surface there. If you want per-turn nudges inside Claude Code, use theirs; if you want a gate on `prompts/**`, use this.

## Install

```bash
npm i -D ctxcap
npx ctxcap --update-baseline
```

Or run without installing:

```bash
npx ctxcap --json
```

## Test another repository

Run the unpinned latest `ctxcap` from the repository you want to inspect. It reads the current
working directory, so no files need to be copied into the `ctxcap` repository:

```bash
cd path/to/your-repo
npx ctxcap --json
npx ctxcap --stale --json
npx ctxcap --plan --budget 40000
```

Use the pinned version in release checks or reproducible CI. For a real edit
loop, review the plan, apply it, then verify the saved plan:

```bash
npx -y ctxcap@1.4.0 --plan --budget 40000
npx -y ctxcap@1.4.0 --plan --budget 40000 --apply
npx -y ctxcap@1.4.0 --verify <planId>
```

Start with a baseline when you want pull requests to report growth:

```bash
npx -y ctxcap@1.4.0 --update-baseline
git add ctxcap-baseline.json
git commit -m "Add ctxcap baseline"
```

Add a `.ctxcap.json` file to customize included paths, ignored paths, or
budgets. The default scan is intentionally limited to common agent context
files.

## CLI

| Flag | Effect |
| --- | --- |
| `--json` | Machine-readable JSON report on stdout |
| `--sarif` | SARIF 2.1.0 on stdout |
| `--suggest` | Include compression suggestions |
| `--stale` | Find dead paths, commands, globs, and references |
| `--stale-glob` | Include globs that match zero files |
| `--stale-fix` | Print a deletion diff; never writes files |
| `--fail-on increase\|budget\|stale\|never` | When to exit 1 (default: `never`) |
| `--baseline <ref>` | Read baseline from a git ref (CI uses merge base automatically) |
| `--update-baseline` | Write `ctxcap-baseline.json` and exit |
| `--config <path>` | Config file path (default: `.ctxcap.json`) |
| `--root <path>` | Working directory (default: `.`) |
| `--plan` | Print a ranked context-budget edit plan |
| `--apply` | Apply the generated plan atomically |
| `--verify <planId>` | Verify a saved plan and preserve spans |
| `--budget <n>` | Target budget for `--plan` |
| `--budget-class <class>=<n>` | Budget a conditional or manual load class |
| `--strict-preserve` | Restore exclusion of all preserve spans |
| `--max-condense-chars <n>` | Set the maximum replacement length (default: 320) |
| `--min-tokens <n>` | Set the minimum reclaimable finding size (default: 20) |

Exit codes: `0` clean, `1` breach under `--fail-on`, `2` internal error.

## Config

`.ctxcap.json` — all fields optional:

```json
{
  "include": ["AGENTS.md", "prompts/**", ".cursor/rules/**"],
  "ignore": ["prompts/archive/**"],
  "budgets": {
    "total": 40000,
    "AGENTS.md": 500,
    "prompts/system.md": 8000
  },
  "preserveHeadings": ["Never", "Constraints", "Must", "Rules"],
  "failOn": "budget"
}
```

Reports include `totalByClass` for `always`, `startup`, `conditional`, and
`manual` files. `total` remains for compatibility and is the sum of all
classes; the `--budget` gate applies only to always and startup files.
Condense findings report net `tokensFreed`, `replacementTokens`, and a score.
A replacement is built from whole sentences: the leading ones that fit
`--max-condense-chars`, plus every sentence containing `must`, `never`,
`always`, `do not`, or `don't`. Repeated sentences are dropped. Under a
preserve heading or `<!-- ctxcap:preserve -->` marker only repeated sentences
are dropped. Only prose paragraphs are condensed; lists, tables, quotes, and
code are left alone, and a paragraph that cannot be shortened this way gets no
condense finding. A delete finding is never offered for a block that holds
one of those rule words. Plan output uses schema `ctxcap/plan/v2`.

**Defaults** (when no config exists): scans `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `prompts/**`, `*.prompt`, `.cursor/rules/**`.

## GitHub Action

```yaml
permissions:
  contents: read
  pull-requests: write
  security-events: write   # for SARIF upload; drop if you set upload-sarif: false

steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }
  - uses: Naeha-S/ctxcap@v1
    with: { fail-on: increase }
```

**Pinned form for reproducibility:** `uses: Naeha-S/ctxcap@v1.4.0`

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `fail-on` | `never` | `increase` \| `budget` \| `stale` \| `never` |
| `config` | `.ctxcap.json` | Path to config file |
| `path` | `.` | Root directory to lint |
| `comment` | `true` | Post sticky PR comment |
| `upload-sarif` | `true` | Upload SARIF to code scanning |
| `stale` | `false` | Run the stale-reference pass |
| `stale-glob` | `false` | Include zero-match globs |

`fail-on: increase` compares against the baseline at the merge base. A pull
request that grows a context file on purpose passes when it also commits the
refreshed baseline (`npx ctxcap --update-baseline`); the baseline diff is what
the reviewer approves. The first pull request that adds the action passes the
same way.

**What you get on every run:**
- Workflow annotations on over-budget files
- Job step summary with token table and delta

**When the token can write (non-fork PRs):**
- Sticky PR comment, updated in place (one comment, not a new one each run)
- SARIF upload to GitHub code scanning

### Fork PRs

With plain `pull_request`, fork PRs get a read-only token: annotations and job summary only. For the full experience on forks, use `pull_request_target` as shown in [`examples/pull-request-target.yml`](examples/pull-request-target.yml).

Code scanning requires GitHub Advanced Security on private repos; SARIF upload silently no-ops without it.

## MCP

Run the MCP server directly — no config needed:

```bash
npx -y ctxcap-mcp
```

Configure in your MCP client:

```json
{
  "mcpServers": {
    "ctxcap": {
      "command": "npx",
      "args": ["-y", "ctxcap-mcp"]
    }
  }
}
```

The same stdio command works with Claude Code, Codex, and Cursor. See the
[MCP package guide](packages/ctxcap-mcp/README.md) for client-specific setup.
The server reads the MCP client's current working directory and makes no
network calls.
Registry metadata is prepared in [`server.json`](server.json); publication is
manual and intentionally not performed by this repository workflow.

**Tools exposed:**

| Tool | Description |
| --- | --- |
| `measure_context` | Returns the full JSON report for the current working directory |
| `context_budget_plan` | Returns a deterministic ranked splice plan with safety classifications and preserve spans |
| `context_budget_verify` | Reports missed edits and preserve-span violations after applying a plan |
| `trim_to_budget` | Deprecated alias for `context_budget_plan`; always returns `apply: false` |

The agent loop is also available as the five-line [`llms.txt`](llms.txt)
contract. The standalone MCP wrapper keeps plan verification in the same
server process; the CLI persists plans under `.ctxcap/plans/`.

## Output schema

```json
{
  "schema": "ctxcap/v1",
  "approximate": true,
  "tokenizer": "gpt-tokenizer@3.0.1",
  "total": 1247,
  "totalBudget": 40000,
  "delta": +82,
  "over": false,
  "baselineFound": true,
  "files": [
    { "path": "AGENTS.md", "tokens": 420, "delta": +12, "budget": 500 }
  ],
  "suggestions": []
}
```

Full report schema: [`schema/report.schema.json`](schema/report.schema.json).
Plan schema: [`schema/plan.schema.json`](schema/plan.schema.json). Plan
responses include ranked `plan` entries, `preserve` spans, and a `diff`
summary.

## Accuracy

Token counts use OpenAI's `o200k_base` encoding. They match GPT-4o-family
models and are an estimate for everything else: Claude and Gemini tokenize
differently, and the gap has not been measured here. Every report carries
`"approximate": true` and the tokenizer ID. Compare **deltas**, not absolutes.
`confidence` is a fixed heuristic per finding kind; review the plan before
applying it.

## Packages

| Package | Description |
| --- | --- |
| [`ctxcap`](https://www.npmjs.com/package/ctxcap) | CLI + GitHub Action + embedded MCP server |
| [`ctxcap-mcp`](https://www.npmjs.com/package/ctxcap-mcp) | Standalone MCP server wrapper (thin bin, pulls ctxcap as a dep) |

## License

MIT.
