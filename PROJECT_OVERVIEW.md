# ctxcap — In-Depth Architecture, Capabilities & Use Cases

`ctxcap` is a fast, offline token budget linter and context-governance engine built specifically for AI coding agents (Claude Code, Cursor, Codex, Copilot, Windsurf) and CI/CD pipelines.

---

## 1. Executive Summary & Core Philosophy

Every modern engineering repository is becoming an agent harness: developers write `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, and `.github/copilot-instructions.md`. 

These files carry two fundamental problems:
1. **Silent Context Creep:** Context files grow monotonically with every sprint, bug fix, and onboarding instruction. Every token loaded upfront reduces the agent's reasoning headroom, triggers middle-loss retrieval degradation, and inflates API / cache costs on every interaction.
2. **Context Rot / Stale References:** Context files frequently instruct agents to run outdated commands (`npm run test:legacy`) or read files that were renamed or refactored away months ago. Agents hallucinate or fail attempts based on dead guidance.

`ctxcap` solves this at the repo level:
- **Zero Configuration & Instant Execution:** Runs in `< 5ms` with zero config files required.
- **Offline & Autonomous:** Zero network calls, zero telemetry, zero LLM dependencies or API keys. Uses a deterministic, pinned BPE tokenizer (`gpt-tokenizer@3.0.1`).
- **Continuous Enforcement:** PR sticky comments, GitHub Actions failure gates, and SARIF 2.1.0 reporting.
- **Dead-Reference Detection (`--stale`):** Statically analyzes paths, globs, and npm scripts in prompt files against the actual git tree.
- **Agent Self-Regulation via MCP:** Exposes native Model Context Protocol tools (`measure_context`, `trim_to_budget`) so agents can measure and compress their own files.

---

## 2. Architecture & Components

```
┌─────────────────────────────────────────────────────────────┐
│                       ctxcap Core                           │
├───────────────┬─────────────────────────────┬───────────────┤
│ CLI Engine    │ Static Analysis & Globbing  │ BPE Tokenizer │
│ (src/index.js)│ (fast-glob, src/stale.mjs)  │ (o200k_base)  │
└───────┬──────────────────────┬──────────────────────┬───────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────┐
│ GitHub Action │      │  MCP Server   │      │ Agent Config  │
│  (Action.yml) │      │ (packages/    │      │  (ctxcap init)│
│  Sticky PR    │      │  ctxcap-mcp)  │      │ Hooks, Skills,│
│  Comments     │      │ stdio JSON-RPC│      │ .cursor/rules │
└───────────────┘      └───────────────┘      └───────────────┘
```

### 2.1 Engine & Scanning
- Defaults to scanning standard agent paths: `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `prompts/**`, `*.prompt`, `.cursor/rules/**`.
- Supports custom inclusions, exclusions, and hierarchical budgets via `.ctxcap.json`.
- Measures exact token costs under `o200k_base` and diffs against git commit baselines (`ctxcap-baseline.json`).

### 2.2 Stale Reference Engine (`--stale`)
- Parses markdown links, code blocks, backticked paths, and shell command invocations.
- Cross-references paths against the real repository file tree.
- Verifies `npm run <script>` against scripts declared in root and workspace `package.json` files.
- Computes reclaimable token estimates for immediate pruning.

### 2.3 The Benchmark Corpus & Percentile Scoring (`--compare`)
- Pre-computed token distribution across the 30 root context files of the 25 most-starred GitHub repositories (n8n, AutoGPT, Ollama, OpenCode, DeepSeek Harness, etc.).
- Compares local context size against the ecosystem: provides an exact percentile ranking (e.g. *"90th percentile: larger than 27 of 30 top repos"*).
- Verified empirical finding: Star count does **not** correlate with smaller context files (Spearman $\rho = 0.269$).

### 2.4 MCP Integration (`ctxcap-mcp`)
- Standard stdio Model Context Protocol (MCP) server with zero SDK bloat.
- Exposes:
  - `measure_context`: Outputs structured token breakdown, delta, and breach status.
  - `trim_to_budget`: Ranks context files by token size to direct compression passes.
  - `context_budget_plan` & `context_budget_verify`: Deterministic dry-run and validation for automated cleanup.

---

## 3. Real-World Use Cases

### Use Case 1: Automated PR Gating in CI
Prevent PRs from bloating agent instructions:
```yaml
- uses: Naeha-S/ctxcap@v1
  with:
    fail-on: increase
```
- Fork PRs: Emits workflow annotations and summary tables safely with read-only tokens.
- Same-repo PRs: Automatically writes and updates an in-place sticky comment showing exact delta per file.
- Fails the build immediately if someone adds unbudgeted prompt bloat.

### Use Case 2: Removing Hallucination Vectors in Prompts
Run `npx ctxcap --stale` in pre-commit or CI:
- Catches paths that changed during refactors.
- Prevents agents from endlessly searching for files that no longer exist.
- Saves 20–30% of wasted prompt tokens instantly.

### Use Case 3: Autonomous Agent Self-Correction
Configure `ctxcap-mcp` in Claude Code, Cursor, or Cline:
- When an agent updates `AGENTS.md` or a prompt template, it runs `measure_context` before finalizing.
- If over budget, the agent calls `trim_to_budget` to compress repetitive instructions without human intervention.

### Use Case 4: Enterprise Repo Standardization (`npx ctxcap init`)
One command provisions the entire developer environment:
- Writes Claude Code pre-commit hooks (`.claude/settings.json`) to warn before bloat lands.
- Configures Cursor `.cursor/rules/ctxcap.mdc`.
- Sets up live SVG README badge (`[![context tokens]...]`).

---

## 4. Key Metrics & Specs

- **CLI Execution:** < 10ms for standard repos
- **Dependencies:** 2 (`fast-glob`, `gpt-tokenizer`)
- **Supported Encodings:** `o200k_base` (GPT-4o, Claude 3.5 Sonnet / Haiku proxy)
- **Node Requirement:** `>= 20.0.0`
- **License:** MIT
