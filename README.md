# ctxcap

<!-- ctxcap:begin -->
[![context tokens](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FNaeha-S%2Fctxcap%2FHEAD%2F.ctxcap%2Fbadge.json)](https://github.com/Naeha-S/ctxcap)
<!-- ctxcap:end -->

[![npm](https://img.shields.io/npm/v/ctxcap)](https://www.npmjs.com/package/ctxcap)
[![ci](https://github.com/Naeha-S/ctxcap/actions/workflows/ci.yml/badge.svg)](https://github.com/Naeha-S/ctxcap/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/ctxcap)](LICENSE)

`AGENTS.md`, `CLAUDE.md`, and prompt files are loaded into agent sessions over
and over, and they only grow. `ctxcap` counts what they cost in tokens, flags
pull requests that grow them, and finds the references in them that point at
files and scripts that no longer exist.

It runs offline: no API key, network call, telemetry, or config. Node 20 or
newer.

```bash
npx ctxcap --stale
```

```text
TOKENS  DELTA  FILE
45      0      AGENTS.md
---
total 45 (0)
approximate count (gpt-tokenizer@3.0.1)
stale findings 2 (reclaimable 21 tokens)
stale-path     AGENTS.md:6   src/auth/session.js
dead-command   AGENTS.md:7   npm run lint
```

## What it does

- **Measures.** Token counts per file and in total, as text, JSON, or SARIF.
- **Gates pull requests.** A GitHub Action compares against a committed
  baseline, comments the delta on the pull request, and fails only when you
  ask it to.
- **Finds stale references.** Paths and `npm run` scripts named in a context
  file that no longer resolve in the repository.
- **Plans a trim.** A ranked list of edits to get under a budget, with a
  verify step. This is the newest part; review its diffs before you accept
  them. See [Trim to a budget](#trim-to-a-budget).

By default it scans `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`,
`prompts/**`, `*.prompt`, and `.cursor/rules/**`.

## Quick start

Run it in the repository you want to inspect. Nothing is installed or written:

```bash
npx ctxcap              # token table
npx ctxcap --json       # the same as JSON
npx ctxcap --stale      # add dead paths and scripts
```

To track growth, commit a baseline. Later runs report the delta against it:

```bash
npx ctxcap --update-baseline
git add ctxcap-baseline.json
git commit -m "Add ctxcap baseline"
```

To pin it as a dev dependency instead of using `npx`: `npm i -D ctxcap`.

## Wire it up

```bash
npx ctxcap init          # print the diff of every file it would touch
npx ctxcap init --yes    # write them
```

Agents do not search npm. They read the config that is already in the
repository. `init` writes that config for each agent, and you commit it, so
every clone and every teammate's agent has `ctxcap` without running anything.
Nothing is installed, and nothing runs at install time.

| Agent | `--agents` | Files | Cost in the context window |
| --- | --- | --- | --- |
| Claude Code | `claude` | `.claude/skills/ctxcap/SKILL.md`, two hooks in `.claude/settings.json`, a server in `.mcp.json`, `.ctxcap/.gitignore` | 53 tokens per session for the skill's name and description, 292 once the skill loads, and about 500 for the four MCP tool definitions |
| Cursor | `cursor` | `.cursor/rules/ctxcap.mdc`, a server in `.cursor/mcp.json` | 140 tokens when a `CLAUDE.md` or `AGENTS.md` is in the conversation, and the same MCP tool definitions |
| Codex | `codex` | A 2-line block in `AGENTS.md` | 51 tokens per session |
| Copilot | `copilot` | A 3-line block in `.github/copilot-instructions.md` | 101 tokens per session |
| CI | `ci` | `.github/workflows/ctxcap.yml` | None |
| README badge | `badge` | `.ctxcap/badge.json`, one line under the README title | None |

The costs are counted by `ctxcap` itself and are approximate. The blocks in
`AGENTS.md` and the Copilot file, and the Cursor rule, are context files, so
they show up in your own report. The MCP server is the largest item: leave it
out with `--agents` if the skill is enough, since both expose the same steps.

The two Claude Code hooks stay quiet unless there is something to say:

- After an edit to a context file, the agent gets one line with the new count
  and the total. Other edits print nothing.
- When the agent stops, you get one line if the total is over the budget in
  `.ctxcap.json`. It never blocks the agent from stopping.

Each hook starts `npx`, which takes about a second once the package is cached.
That second is added to every edit Claude Code makes.

| Flag | Effect |
| --- | --- |
| `--yes` | Apply the diff. Without it, nothing is written |
| `--print` | Print the diff and exit 0 |
| `--agents <list>` | Comma-separated subset of `claude,cursor,codex,copilot,ci,badge` (default: all) |
| `--remove` | Undo what `init` wrote |
| `--force` | Overwrite a file or entry at a `ctxcap` path that `init` did not write |
| `--no-pin` | Write `npx ctxcap` instead of `npx ctxcap@1.5.0` |

Commands are pinned to the version that wrote them, so a release cannot
change what your agents run until you choose to upgrade. To upgrade, run
`init --yes` with the new version: it brings everything `init` wrote up to
date, pins included. A target that is already current is reported as
`skipped: <path> (already configured)`, and running `init --yes` twice changes
nothing the second time.

`--yes` only ever touches what `init` wrote. If something `init` did not write
sits where a target would go, such as a hand-written workflow or your own
`ctxcap` entry in a JSON file, it is left alone and reported, and the exit code
is 3. `--force` overwrites it. Exit codes: `0` done, `3` when a target was left
alone and needs `--force`, `2` for a bad flag.

A workflow that already runs `ctxcap`, through the action or through `npx`, is
reported as `wired by user`. It counts as wired, `init` does not add a second
workflow beside it, and the exit code stays 0.

### Every write is reversible

- Markdown gets a block between `<!-- ctxcap:begin -->` and
  `<!-- ctxcap:end -->`. Text outside the block is never changed.
- JSON files are parsed and merged, never rewritten. Your keys keep their
  order, indentation, and line endings. A top-level `_ctxcap` key records the
  version that wrote the entries.
- Files that `init` creates whole (the skill, the Cursor rule, the workflow,
  `.ctxcap/.gitignore`) carry a `ctxcap:managed` marker. A file at one of those
  paths without the marker is yours, and `init` leaves it alone.

```bash
npx ctxcap init --remove          # print what would be removed
npx ctxcap init --remove --yes    # remove it
```

`--remove` deletes the blocks, the marked JSON entries, the files `init`
created, and any file or directory that ends up empty. The test suite checks
that `init --yes` followed by `init --remove --yes` leaves the repository
byte-for-byte as it was, including one that already had hooks and an
`AGENTS.md`.

### Check the wiring

```bash
npx ctxcap doctor
```

```text
claude   wired
cursor   not wired
codex    stale pin: AGENTS.md has 1.4.0, current is 1.5.0
copilot  partially wired: missing .github/copilot-instructions.md
ci       wired
badge    wired
```

`doctor` exits 1 when an agent is partially wired or pinned to a different
version than the one running, and 0 otherwise. `--json` prints the same as
JSON. `npx ctxcap init --yes` brings stale pins up to date.

### Badge

```bash
npx ctxcap --badge
```

writes `.ctxcap/badge.json` in the shields.io
[endpoint format](https://shields.io/badges/endpoint-badge):

```json
{"schemaVersion":1,"label":"context","message":"476","color":"green"}
```

Under 500 tokens is green, under 2,000 is yellow, and anything above is red.
`init` adds the badge under the README title, pointing at the raw GitHub URL of
that file on the default branch.

shields.io fetches the file over the public internet, so the badge only works
when the file is committed to a public repository. On a private repository it
shows an error. The number is as fresh as the last commit of `badge.json`: the
Claude Code hook rewrites it after a context file changes, and otherwise you
run `npx ctxcap --badge` before you commit. `init` skips the badge when the
repository has no GitHub remote.

## Gate pull requests

```yaml
name: ctxcap
on: pull_request

permissions:
  contents: read
  pull-requests: write
  security-events: write   # for SARIF upload; drop if you set upload-sarif: false

jobs:
  ctxcap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: Naeha-S/ctxcap@v1
        with: { fail-on: increase }
```

Pin `Naeha-S/ctxcap@v1.5.0` if you want reproducible runs. A complete workflow
is in [`examples/pull-request.yml`](examples/pull-request.yml).

The action posts one comment on the pull request and updates it in place:

> **ctxcap** — +8 tokens (371 total), approximate — growth accepted by the baseline updated in this change
>
> | File | Tokens | Delta |
> | --- | --- | --- |
> | `AGENTS.md` | 287 | +78 |
> | `llms.txt` | 84 | -70 |

`fail-on` decides when the check goes red:

| Value | Fails when |
| --- | --- |
| `never` (default) | Never; the action only reports |
| `increase` | The total grew since the merge base and the baseline was not updated |
| `budget` | A budget in `.ctxcap.json` is exceeded |
| `stale` | The stale pass has findings (needs `stale: true`) |

With `fail-on: increase`, a pull request that grows a context file on purpose
passes when it also commits the refreshed baseline
(`npx ctxcap --update-baseline`). The baseline diff is what the reviewer
approves. The first pull request that adds the action passes the same way.

Inputs:

| Input | Default | Description |
| --- | --- | --- |
| `fail-on` | `never` | `increase` \| `budget` \| `stale` \| `never` |
| `config` | `.ctxcap.json` | Path to config file |
| `path` | `.` | Root directory to lint |
| `comment` | `true` | Post the sticky pull request comment |
| `upload-sarif` | `true` | Upload SARIF to code scanning |
| `stale` | `false` | Run the stale-reference pass |
| `stale-glob` | `false` | Include globs that match no files |

Every run adds a job summary with the token table, and annotations on files
that are over budget.
The comment and the SARIF upload need a token that can write, which pull
requests from forks do not get under plain `pull_request`. For forks, use
`pull_request_target` as shown in
[`examples/pull-request-target.yml`](examples/pull-request-target.yml). On
private repositories, code scanning needs GitHub Advanced Security; without it
the SARIF upload does nothing.

## Find stale references

```bash
npx ctxcap --stale                    # list them
npx ctxcap --stale --fail-on stale    # exit 1 if there are any
npx ctxcap --stale --stale-fix        # print a deletion diff; writes nothing
```

The stale pass prefers silence to guessing. It only checks references that are
spelled like a path into this repository:

- with a slash, the first segment must be an existing directory (`src/gone.js`
  is checked; `origin/main`, `feat/x`, and `@scope/pkg` are not);
- without a slash, the name must end in a known file extension and exist
  nowhere in the repository (`gone.config.ts` is checked; `console.log` and
  `1.2.3` are not);
- `npm run <script>` must be a script in some `package.json` in the repository.

Paths resolve against the repository root and the context file's own
directory. Fenced code blocks, absolute paths, `../` paths, URLs, and anything
containing `~`, `$`, `:`, or `<` are skipped. Each finding names the dead
reference in `ref` and the lines it would remove in `startLine`/`endLine`: the
list item that holds the reference, or the paragraph when it is not in a list.
Add `<!-- ctxcap-ignore -->` to a line to suppress it.

`--stale-fix` leaves out blocks that also hold a rule (`must`, `never`,
`always`, `do not`); fix those by hand. There is deliberately no mode that
deletes stale lines for you.

A clean result means no reference of those shapes failed to resolve. It does
not mean the file is up to date.

## What real repositories spend

Measured with `ctxcap --stale` 1.4.0 on 15 November 2026, at the commit shown:

| Repository | Commit | Context files | Tokens | Stale findings |
| --- | --- | --- | ---: | ---: |
| `langchain-ai/langchain` | `ea17e48` | `AGENTS.md` | 4,685 | 0 |
| `pydantic/pydantic-ai` | `f93bcff` | `AGENTS.md` | 4,658 | 0 |
| `sst/opencode` | `d432a06` | `AGENTS.md` | 4,025 | 0 |
| `modelcontextprotocol/python-sdk` | `77001c9` | `AGENTS.md`, `CLAUDE.md` | 2,223 | 0 |
| `astral-sh/uv` | `d5c3f17` | `AGENTS.md` | 823 | 0 |
| `modelcontextprotocol/typescript-sdk` | `919bb8e` | `CLAUDE.md` | 296 | 0 |

These repositories are how the stale pass was tuned. An earlier version treated
any dotted or slashed inline code as a path and reported 41 findings across
`opencode` and `langchain`, nearly all of them wrong. The rules above are what
was left after removing every false one.

### Leaderboard

[`leaderboard/2026-11.md`](leaderboard/2026-11.md) ranks the 25 most-starred
GitHub repositories that have a root `AGENTS.md` or `CLAUDE.md` by what those
files cost. Repositories that keep every file under 200 tokens are listed as
clean and not ranked. To build it again:

```bash
GITHUB_TOKEN=<token> npm run leaderboard -- --top 25
```

The script, `scripts/leaderboard.mjs`, lives in this repository and is not part
of the npm package. It needs a GitHub token for the API; no scopes are
required. Responses are cached under `.ctxcap/cache/`, so a second run makes no
network calls and writes the same file; pass `--refresh` for new data. Delta is
measured against the previous month's file.

## Trim to a budget

When a file is over budget, agents tend to rewrite it from memory and drop the
`## Never` rules on the way. `--plan` gives the agent line ranges to cut
instead, and `--verify` checks the result.

```bash
npx ctxcap --plan --budget 400              # ranked plan, JSON
npx ctxcap --plan --budget 400 --apply      # apply it
npx ctxcap --verify <planId>                # check what landed
```

Three rules for the agent:

1. Splice by `startLine`/`endLine`. Never rewrite a file from scratch.
2. Never cut a span listed in `preserve`. The one exception is a `condense`
   finding on that span: apply its `condensedText` exactly as given.
3. If `satisfiable` is false, report `minAchievable` and stop.

What a plan can contain:

- **Delete** a block with a stale reference or a repeated block. Never offered
  for a block that holds a rule word (`must`, `never`, `always`, `do not`,
  `don't`).
- **Condense** a prose paragraph over 300 tokens. The replacement is built from
  whole sentences: the leading ones that fit `--max-condense-chars`, plus every
  sentence with a rule word. Lists, tables, quotes, and code are left alone.
  Under a preserve heading (`Never`, `Constraints`, `Must`, `Rules`) or a
  `<!-- ctxcap:preserve -->` marker, only repeated sentences are dropped.

Verification is a guardrail, not a proof. It checks that planned text was
removed, that applied files did not drift, that preserve text remains, and
that every rule sentence of a condensed paragraph is still present. It cannot
tell whether what remains still means the same thing, or whether an unmarked
instruction was important. Review the diff before you commit it.

The plan JSON includes `verifyCommand`, the exact pinned command that checks
that plan, for example `npx ctxcap@1.5.0 --verify 6b8e55`. It is also printed
on its own line on stderr. While no agent in the repository is wired, the plan
carries an `initHint` that points at `ctxcap init`.

Plans are saved to `.ctxcap/plans/<planId>.json` and expire after 24 hours;
after that `--verify` returns `PLAN_EXPIRED`. Keep them out of git:
`ctxcap init` writes a `.ctxcap/.gitignore` that does, or add `.ctxcap/plans/`
to your own `.gitignore`. Run `--apply` on a clean tree, and do not run it in
CI.

[`examples/case-study/`](examples/case-study/) holds a run you can reproduce:
two context files go from 1,504 tokens to 228 at budget 400, both rules
survive, and verification reports no violations. The directory has the report
before and after, the plan, the applied diff, and the verify output. The
context files are committed in their before state:

```bash
npx ctxcap --plan --budget 400 --apply --root examples/case-study
npx ctxcap --verify 6b8e55 --root examples/case-study
git checkout examples/case-study    # restore
```

## Use it from a coding agent

Agents do not go looking for tools. They use what is installed, and what the
repository tells them to run. [`ctxcap init`](#wire-it-up) sets all of this up
for a repository in one step. To set up one piece by hand, or for yourself
rather than for a repository, there are three ways.

**As a skill.** The agent loads it only when you ask about context size or
stale references, and it runs the CLI with `npx`. Nothing is added to the
context window until then.

```bash
# Claude Code
claude plugin install ctxcap --marketplace Naeha-S/ctxcap

# Claude Code, Cursor, Codex, and other agents that read SKILL.md
npx skills add Naeha-S/ctxcap
```

Then ask "how many tokens do my context files cost?" or "is AGENTS.md stale?".

**As an MCP server.** The same measure, plan, and verify steps as tools:

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=ctxcap&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImN0eGNhcC1tY3AiXX0%3D)

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

For Claude Code: `claude mcp add ctxcap -- npx -y ctxcap-mcp`. Codex setup is
in the [MCP package guide](packages/ctxcap-mcp/README.md).

| Tool | Description |
| --- | --- |
| `measure_context` | The JSON report for the current working directory |
| `context_budget_plan` | A ranked plan with safety classes and preserve spans |
| `context_budget_verify` | Missed edits and preserve violations after a plan is applied |
| `trim_to_budget` | Deprecated alias for `context_budget_plan`; never applies |

The server speaks stdio, reads the client's working directory, and makes no
network calls. It never edits files: the agent applies the plan and then calls
verify. Plans are saved under `.ctxcap/plans/`, so verify also works in a later
session. It is tested with the official MCP SDK client. Use `ctxcap-mcp` 0.1.7
or newer; earlier versions do not connect.

**As a line in `AGENTS.md`.** Agents read this file at the start of a session,
so one line is enough:

```markdown
- Before editing AGENTS.md or CLAUDE.md, run `npx -y ctxcap --stale --json` and keep the total from growing.
```

## CLI

| Command | Effect |
| --- | --- |
| `ctxcap` | Measure the context files and print the table |
| `ctxcap init` | Wire `ctxcap` into the repository's coding agents. See [Wire it up](#wire-it-up) |
| `ctxcap init --remove` | Undo that |
| `ctxcap doctor` | Report whether the wiring is complete and current |
| `ctxcap hook post-edit\|stop` | What the Claude Code hooks run. Not meant to be run by hand |

| Flag | Effect |
| --- | --- |
| `--json` | Machine-readable JSON report on stdout |
| `--sarif` | SARIF 2.1.0 on stdout |
| `--suggest` | Include compression suggestions |
| `--stale` | Find dead paths, commands, and references |
| `--stale-glob` | Include globs that match no files |
| `--stale-fix` | Print a deletion diff; never writes files |
| `--fail-on increase\|budget\|stale\|never` | When to exit 1 (default: `never`) |
| `--baseline <ref>` | Read the baseline from a git ref (CI uses the merge base) |
| `--update-baseline` | Write `ctxcap-baseline.json` and exit |
| `--badge` | Write `.ctxcap/badge.json` for a shields.io badge and exit |
| `--config <path>` | Config file path (default: `.ctxcap.json`) |
| `--root <path>` | Working directory (default: `.`) |
| `--plan` | Print a ranked edit plan |
| `--apply` | Apply the generated plan |
| `--verify <planId>` | Verify a saved plan |
| `--budget <n>` | Target budget for `--plan` |
| `--budget-class <class>=<n>` | Budget a conditional or manual load class |
| `--strict-preserve` | Exclude every preserve span from plans |
| `--max-condense-chars <n>` | Maximum replacement length (default: 320) |
| `--min-tokens <n>` | Minimum size of a plan finding (default: 20) |

Exit codes: `0` clean, `1` breach under `--fail-on`, `2` internal error.

## Config

`.ctxcap.json`, all fields optional:

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

`--fail-on budget` uses the budgets in this file; `--budget` on the command
line only sets the target for `--plan`.

Each file gets a load class, and reports total them in `totalByClass`:

| Class | Files |
| --- | --- |
| `always` | `CLAUDE.md` |
| `startup` | `AGENTS.md` |
| `conditional` | `.cursor/rules/**`, `AGENTS.md` in subdirectories |
| `manual` | Everything else |

`budgets.total` counts `always` and `startup` files only. `total` in the report
is the sum of all classes.

## Report format

```json
{
  "schema": "ctxcap/v1",
  "approximate": true,
  "tokenizer": "gpt-tokenizer@3.0.1",
  "total": 371,
  "totalByClass": { "startup": 287, "manual": 84 },
  "totalBudget": 1200,
  "delta": 0,
  "over": false,
  "baselineFound": true,
  "acknowledged": false,
  "files": [
    { "path": "AGENTS.md", "tokens": 287, "delta": 0, "budget": null, "loadClass": "startup" },
    { "path": "llms.txt", "tokens": 84, "delta": 0, "budget": null, "loadClass": "manual" }
  ],
  "suggestions": [],
  "findings": [],
  "reclaimableTotal": 0
}
```

Schemas: [`schema/report.schema.json`](schema/report.schema.json) for reports
and [`schema/plan.schema.json`](schema/plan.schema.json) for plans
(`ctxcap/plan/v2`).

## Accuracy

Token counts use OpenAI's `o200k_base` encoding. They match GPT-4o-family
models and are an estimate for everything else: Claude and Gemini tokenize
differently, and the gap has not been measured here. Every report carries
`"approximate": true` and the tokenizer ID. Compare deltas, not absolutes.
`confidence` on a plan finding is a fixed value per finding kind, not a
measurement.

## What it does not do

It does not decide which instructions are worth their tokens. A useful review
question is whether an agent could infer the line from the repository, its
build scripts, or its linters; if so, it may not need always-loaded space.

## How this differs from `tokenlint`

`tokenlint` hooks your editor and reminds you per turn about wasteful habits.
`ctxcap` works at the repository: it measures context files against a committed
baseline and reports the delta on every pull request. Use the first for nudges
while you type and this one for a gate in CI and review.

## Packages

| Package | Description |
| --- | --- |
| [`ctxcap`](https://www.npmjs.com/package/ctxcap) | CLI, GitHub Action, and MCP server |
| [`ctxcap-mcp`](https://www.npmjs.com/package/ctxcap-mcp) | `npx`-runnable MCP server; depends on `ctxcap` |

## License

MIT.
