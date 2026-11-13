# ctxcap

Token budget linter for prompt and context files. Built for agents: one command, JSON out, zero config.

```bash
npx -y ctxcap --json
```

Two dependencies (`fast-glob`, `gpt-tokenizer`), both audited, neither phones home. Runs offline. No API key. No telemetry.

## Why

Agent context files — `CLAUDE.md`, `AGENTS.md`, `prompts/**`, `.cursor/rules/` — grow every sprint. They get pasted into every request and silently burn your context window. Nothing gates them at the repo level.

`ctxcap` fixes that: it measures context files, tracks token deltas against a committed baseline, fails CI when you define a budget, and exposes an MCP server so agents can check themselves.

## How this differs from `tokenlint`

`tokenlint` hooks your editor and reminds you per turn about wasteful habits. `ctxcap` gates the repo: it measures context files against a committed baseline, reports the delta on every PR, and fails only when you ask it to. Different layer — CI and review, not keystrokes.

No baseline, no SARIF, no MCP surface there. If you want per-turn nudges inside Claude Code, use theirs; if you want a gate on `prompts/**`, use this.

## Install

```bash
npm i -D ctxcap
npx ctxcap --update-baseline
```

Or run without installing:

```bash
npx -y ctxcap --json
```

## CLI

| Flag | Effect |
| --- | --- |
| `--json` | Machine-readable JSON report on stdout |
| `--sarif` | SARIF 2.1.0 on stdout |
| `--suggest` | Include compression suggestions |
| `--fail-on increase\|budget\|never` | When to exit 1 (default: `never`) |
| `--baseline <ref>` | Read baseline from a git ref (CI uses merge base automatically) |
| `--update-baseline` | Write `ctxcap-baseline.json` and exit |
| `--config <path>` | Config file path (default: `.ctxcap.json`) |
| `--root <path>` | Working directory (default: `.`) |

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
  "failOn": "budget"
}
```

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

**Pinned form for reproducibility:** `uses: Naeha-S/ctxcap@v1.0.1`

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `fail-on` | `never` | `increase` \| `budget` \| `never` |
| `config` | `.ctxcap.json` | Path to config file |
| `path` | `.` | Root directory to lint |
| `comment` | `true` | Post sticky PR comment |
| `upload-sarif` | `true` | Upload SARIF to code scanning |

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

**Tools exposed:**

| Tool | Description |
| --- | --- |
| `measure_context` | Returns the full JSON report for the current working directory |
| `trim_to_budget` | Returns the 5 largest files ranked by token count so the agent knows what to compress |

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

Full schema: [`schema/report.schema.json`](schema/report.schema.json).

## Accuracy

Counts use pinned `gpt-tokenizer` — approximate against Claude and Gemini (±5%). Every report carries `"approximate": true` and the tokenizer ID. Compare **deltas**, not absolutes — the delta stays consistent across runs even if the absolute count drifts from your model's exact count.

## Packages

| Package | Description |
| --- | --- |
| [`ctxcap`](https://www.npmjs.com/package/ctxcap) | CLI + GitHub Action + embedded MCP server |
| [`ctxcap-mcp`](https://www.npmjs.com/package/ctxcap-mcp) | Standalone MCP server wrapper (thin bin, pulls ctxcap as a dep) |

MIT.
