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
| `ctxcap` npm downloads, 9 to 15 Nov | 1,576 | read 2026-11-16, see below |
| `ctxcap-mcp` npm downloads, 9 to 15 Nov | 1,803 | read 2026-11-16, see below |
| GitHub views, 14 days to 16 Nov | 27 (17 unique) | read 2026-11-16, see below |
| GitHub clones, 14 days to 16 Nov | 324 (97 unique) | read 2026-11-16, see below |

GitHub code search lags behind pushes, so a zero here means "none indexed yet".

The last four rows were read on 2026-11-16, a day after 1.5.0 was published,
because the sandbox the rest was written in could reach neither API. The npm
week ends on 15 November, so it includes the day 1.5.0 went out.

Read the download numbers with care. Sixteen versions of the two packages were
published in that week, and registry mirrors and scanners fetch every new
version, so most of those downloads are probably not people. The 17 unique
visitors are a better guide to how many have seen the project. The first week
with no new version published is the one to compare against.

To read them again (PowerShell; in Windows PowerShell `curl` is an alias that
does not accept `-s`, so use `Invoke-RestMethod` or `curl.exe`):

```powershell
Invoke-RestMethod https://api.npmjs.org/downloads/point/last-week/ctxcap
Invoke-RestMethod https://api.npmjs.org/downloads/point/last-week/ctxcap-mcp
gh api repos/Naeha-S/ctxcap/traffic/views  --jq '{count, uniques}'
gh api repos/Naeha-S/ctxcap/traffic/clones --jq '{count, uniques}'
```

### Re-measure on 2026-12-16

Thirty days after these numbers were read. Not before: a daily look measures
mood, not use. Two numbers decide it.

| Measure | 2026-11-16 | 2026-12-16 |
| --- | ---: | ---: |
| Repositories outside this one that use ctxcap (the four code-search rows above, added up) | 0 | |
| `ctxcap` npm downloads in a week with no new version published | none yet; 1,576 in a week with seven | |

If neither has moved, the conclusion is not that features are missing. Either
the framing did not land or nobody wants a context linter, and more surface
does not tell those two apart.

The GitHub Action runs from its own checkout and never touches npm, so action
use shows up in the code search rows, not in npm downloads.

## 2. Live session validation

**Status: not run.** This has to happen in a real Claude Code session and a
real Cursor window, signed in, with a model answering. The sandbox this work
was done in has neither: no Anthropic credentials, no route to the API, and no
desktop. Nothing below the next heading has been observed in a live session.

`ctxcap@1.5.0` was published and tagged on 2026-11-15 with the two tables at
the end still empty. They are still worth filling in: until then, how Claude
Code and Cursor react to the wiring is untested.

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

### Setup

Use the newest published version; the steps below write it as `<version>`.
The files are written with `node` so the same lines work in PowerShell and
bash. Do not write them with PowerShell's `>` or `Out-File`: Windows
PowerShell saves those as UTF-16 or with a byte-order mark, and ctxcap then
rejects `.ctxcap.json` as invalid.

```bash
mkdir throwaway
cd throwaway
git init
node -e 'const fs=require(`fs`);fs.writeFileSync(`README.md`,`# Throwaway\n`);fs.writeFileSync(`CLAUDE.md`,`# Project rules\n\n`+`Always run the tests before you commit, and keep every answer short. `.repeat(120)+`\n`);fs.writeFileSync(`.ctxcap.json`,JSON.stringify({budgets:{total:500}}))'
npx ctxcap@<version> init --yes
git add -A
git commit -m "wired"
```

That leaves a `CLAUDE.md` of about 1,700 tokens against a budget of 500, so
the repository is over budget from the first message.

To test a version before it is published, run `npm pack` in the ctxcap
checkout and `npm i -D /path/to/ctxcap-<version>.tgz` in the throwaway
repository first. `npx ctxcap@<version>` then resolves to the local install.
This was checked with 1.5.0 while npm's latest was 1.4.0.

### Claude Code

Start `claude` in the throwaway repository. Record the Claude Code version.

| # | Do | Pass when | What happened |
| --- | --- | --- | --- |
| 1 | Type: `my CLAUDE.md is getting long` | Claude loads the `ctxcap` skill and runs `npx ctxcap@<version> --json`, without being told the tool's name | not run |
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
| 1 | Open `CLAUDE.md` and ask the agent: `my CLAUDE.md is getting long` | The `ctxcap` rule is attached to the request, and the agent runs `npx ctxcap@<version> --json` | not run |
| 2 | Ask it to add one line to `CLAUDE.md` | It reports the token count before and after | not run |
| 3 | Ask about `README.md` only, in a new chat | The rule is not attached | not run |
| 4 | Optional: `npx ctxcap@<version> init --yes --agents mcp`, then reload | The `ctxcap` server shows as connected with four tools | not run |

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
