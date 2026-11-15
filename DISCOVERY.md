# Discovery

Two records for the 1.5.0 release: where distribution stood before the tag,
and what happened when the wiring `ctxcap init` writes was actually run.

## 1. Distribution baseline, before v1.5.0

Taken on 2026-11-15, about 15:10 UTC, three days after the repository was
created. These are the numbers to compare against after `init` ships.

| Measure | Value | How it was read |
| --- | ---: | --- |
| GitHub stars | 3 | `gh api repos/Naeha-S/ctxcap` |
| GitHub forks | 0 | same |
| GitHub watchers | 0 | same |
| Open issues and pull requests | 1 | same (PR #2) |
| Repositories whose workflows use the action | 0 | code search `"Naeha-S/ctxcap@"`: 4 results, all in this repository |
| Repositories that mention `npx ctxcap` | 0 | code search `"npx ctxcap"`: 2 results, all in this repository |
| Repositories that mention `ctxcap-mcp` | 0 | code search `ctxcap-mcp`: 10 results, all in this repository |
| Repositories carrying an `init` block (`ctxcap:begin`) | 0 | code search; `init` is not released yet |
| `ctxcap` on npm | 7 versions, latest 1.4.0 (2026-11-15) | `registry.npmjs.org/ctxcap` |
| `ctxcap-mcp` on npm | 9 versions, latest 0.1.7 (2026-11-15) | `registry.npmjs.org/ctxcap-mcp` |
| npm downloads, last week | not read | see below |
| GitHub views and clones, last 14 days | not read | see below |

GitHub code search lags behind pushes, so a zero here means "none indexed yet".

Two numbers could not be read from the sandbox this was written in. The npm
downloads API is not reachable from it, and the GitHub traffic API refused the
token it had. Read them before tagging and write them into the table:

```bash
curl -s https://api.npmjs.org/downloads/point/last-week/ctxcap
curl -s https://api.npmjs.org/downloads/point/last-week/ctxcap-mcp
gh api repos/Naeha-S/ctxcap/traffic/views  --jq '{count, uniques}'
gh api repos/Naeha-S/ctxcap/traffic/clones --jq '{count, uniques}'
```

The GitHub Action runs from its own checkout and never touches npm, so action
use shows up in the code search rows, not in npm downloads.

## 2. Live session validation

**Status: not run.** This has to happen in a real Claude Code session and a
real Cursor window, signed in, with a model answering. The sandbox this work
was done in has neither: no Anthropic credentials, no route to the API, and no
desktop. Nothing below the next heading has been observed in a live session.
Do not tag v1.5.0 until the two tables at the end are filled in.

### What was run instead, with no model in the loop

On 2026-11-15, in a throwaway repository: a 1,687-token `CLAUDE.md`, a budget
of 500 in `.ctxcap.json`, and `ctxcap` 1.5.0 installed from the packed tarball.

| Check | Result |
| --- | --- |
| `npx ctxcap@1.5.0 init --yes` | Exit 0. Wrote the skill, `.claude/settings.json`, `.ctxcap/.gitignore`, the Cursor rule, `AGENTS.md`, the Copilot file, and the workflow. No badge, because the repository had no GitHub remote. |
| `npx ctxcap@1.5.0 doctor` | Exit 0. Claude, Cursor, Codex, Copilot, and CI wired; badge and MCP not wired. |
| `claude doctor`, Claude Code 2.1.325, in that repository | "No installation issues found." The same command reports a malformed `hooks` value when there is one, so the settings file passes its schema. Not signed in. |
| The PostToolUse command from `settings.json`, run with `sh -c`, given an edit to `README.md` on stdin | Exit 0, no output. |
| The same, given an edit to `CLAUDE.md` | Exit 0. One JSON object: `hookSpecificOutput.additionalContext` = "ctxcap: CLAUDE.md is 1687 tokens. Context files total 1979 tokens, budget 500. Over budget: run npx ctxcap@1.5.0 --plan --budget 500." |
| The Stop command from `settings.json`, three times in a row, over budget | Exit 0 each time. One JSON object each time, with a `systemMessage` and nothing else. No exit code 2, no `decision`. |
| Time for the Stop command through `npx`, package already installed | 0.6 s |

This shows the commands run as written and answer in the documented hook
format. It does not show how Claude Code or Cursor reacts to them.

### Setup, before 1.5.0 is on npm

The wiring runs `npx ctxcap@1.5.0`. Installing the packed tarball into the
throwaway repository makes that resolve locally, so the test does not have to
wait for the release. This was checked: `npx -y ctxcap@1.5.0 --version`
printed `1.5.0` while npm's latest was 1.4.0.

```bash
# in the ctxcap checkout
npm pack                                      # ctxcap-1.5.0.tgz

# the throwaway repository
mkdir throwaway && cd throwaway && git init
printf '# Throwaway\n' > README.md
node -e "console.log('# Project rules\n\n' + 'Always run the tests before you commit, and keep every answer short. '.repeat(120))" > CLAUDE.md
echo '{"budgets":{"total":500}}' > .ctxcap.json
npm init -y && npm i -D /path/to/ctxcap-1.5.0.tgz
npx ctxcap@1.5.0 init --yes
git add -A && git commit -m "wired"
```

### Claude Code

Start `claude` in the throwaway repository. Record the Claude Code version.

| # | Do | Pass when | What happened |
| --- | --- | --- | --- |
| 1 | Type: `my CLAUDE.md is getting long` | Claude loads the `ctxcap` skill and runs `npx ctxcap@1.5.0 --json`, without being told the tool's name | not run |
| 2 | Ask it to add one line to `README.md` | The edit lands. No hook message, no hook error | not run |
| 3 | Ask it to add one line to `CLAUDE.md` | The edit lands and is not blocked or retried. Claude is told the new count (visible in the transcript view, or it mentions the number). The JSON is not shown as an error and not treated as a decision | not run |
| 4 | Let that turn finish | One line appears for you: "ctxcap: context files are at ... tokens, over the 500 budget." The prompt comes back. Claude does not start working again by itself | not run |
| 5 | Send two more short messages | The same as 4, both times. No loop | not run |
| 6 | Note how long the first hook took (it downloads nothing here; on a clean machine it downloads the package) | Under the 60-second hook timeout | not run |

Claude Code version: not run. Date: not run.

### Cursor

`init` writes no hooks for Cursor, only the rule, so there is no PostToolUse or
Stop step to repeat. Open the throwaway repository in Cursor and record the
Cursor version.

| # | Do | Pass when | What happened |
| --- | --- | --- | --- |
| 1 | Open `CLAUDE.md` and ask the agent: `my CLAUDE.md is getting long` | The `ctxcap` rule is attached to the request, and the agent runs `npx ctxcap@1.5.0 --json` | not run |
| 2 | Ask it to add one line to `CLAUDE.md` | It reports the token count before and after | not run |
| 3 | Ask about `README.md` only, in a new chat | The rule is not attached | not run |
| 4 | Optional: `npx ctxcap@1.5.0 init --yes --agents mcp`, then reload | The `ctxcap` server shows as connected with four tools | not run |

Cursor version: not run. Date: not run.

### If a check fails

- Skill does not trigger: the description in `src/wire.js` (`SKILL_DESCRIPTION`)
  is what the agent matches against. Change it there; a test holds it under
  400 characters.
- Hook output is treated as a decision, or the Stop message is not shown: the
  two answers are built in `src/hook.js`. `test/wire.test.js` pins their shape.
- The agent does not stop: that would mean exit code 2 or a `block` decision
  reached Claude Code. Capture the hook's stdout, stderr, and exit code with
  `claude --debug` before changing anything.
