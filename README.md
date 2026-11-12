# ctxcap

Token budget linter for prompt and context files. Built for agents: one command, JSON out, zero config.

```bash
npx -y ctxcap --json
```

Two dependencies (`fast-glob`, `gpt-tokenizer`), both audited, neither phones home. Runs offline. No API key. No telemetry.

## Why

`CLAUDE.md` and `prompts/**` grow every sprint, get pasted into every request, and burn context. Nothing gates them.

## How this differs from `tokenlint`

`tokenlint` hooks your editor and reminds you per turn about wasteful
habits. `ctxcap` gates the repo: it measures context files against a
committed baseline, reports the delta on the PR, and fails only when you
ask it to. Different layer — CI and review, not keystrokes.

No baseline, no SARIF, no MCP surface there. If you want per-turn nudges
inside Claude Code, use theirs; if you want a gate on `prompts/**`, use this.

## Install

```bash
npm i -D ctxcap
npx ctxcap --update-baseline
```

## CLI

| Flag | Effect |
| --- | --- |
| `--json` | machine-readable report |
| `--sarif` | SARIF 2.1.0 |
| `--suggest` | compression suggestions |
| `--fail-on increase\|budget\|never` | default: never fail |
| `--baseline <ref>` | read `ctxcap-baseline.json` from a git ref |
| `--update-baseline` | write `ctxcap-baseline.json` |

Exit codes: `0` clean, `1` breach under `--fail-on`, `2` internal error.

## Config

`.ctxcap.json`, all optional:

```json
{
  "include": ["prompts/**"],
  "budgets": { "total": 40000, "prompts/system.md": 8000 },
  "failOn": "increase"
}
```

## GitHub Action

```yaml
permissions:
  contents: read
  pull-requests: write
  security-events: write   # SARIF upload; omit and set upload-sarif: false to skip

steps:
  - uses: actions/checkout@v4
    with: { fetch-depth: 0 }
  - uses: Naeha-S/ctxcap@v0.1.0
    with: { fail-on: increase }
```

Inputs: `fail-on` (`increase|budget|never`), `config`, `path`, `comment`, `upload-sarif`.

What you get on every run: workflow annotations on over-budget files and a job summary (no token needed).
When the token can write: a sticky PR comment (one comment, updated in place) and a SARIF upload to code scanning.

### Fork PRs

With plain `pull_request`, fork PRs get a read-only token, so ctxcap degrades to annotations, the job summary
and a downloadable `ctxcap` artifact (report + SARIF). For the full experience on forks (sticky comments and SARIF upload),
use `pull_request_target` with `ref: ${{ github.event.pull_request.head.sha }}` and `fetch-depth: 0` as shown in [`examples/pull-request-target.yml`](examples/pull-request-target.yml).
Safe because ctxcap executes only from `github.action_path` on the base branch and reads PR files strictly as data without executing repo scripts.

Code scanning requires GitHub Advanced Security on private repos; SARIF upload silently no-ops without it.

## MCP

Run directly via `npx -y -p ctxcap@latest ctxcap-mcp` or configure in your client:

```json
{ "mcpServers": { "ctxcap": { "command": "npx", "args": ["-y", "-p", "ctxcap@latest", "ctxcap-mcp"] } } }
```

Tools: `measure_context`, `trim_to_budget`.

## Accuracy

Counts use pinned `gpt-tokenizer` — approximate against Claude and Gemini (±5%). Compare deltas, not absolutes. Every report carries `"approximate": true` and the tokenizer id.

MIT.
