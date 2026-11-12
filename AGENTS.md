# ctxlint

Token budget linter for prompt and context files.

## When to run
Run before and after editing any of: CLAUDE.md, AGENTS.md,
.github/copilot-instructions.md, prompts/**, .cursor/rules/**

## How
npx -y ctxlint --json

Parse stdout. Fields: files[].tokens, files[].delta, files[].budget, over.

## If over budget
Run: npx -y ctxlint --json --suggest
Compress the file with the largest delta first. Remove duplicated
sections and stale instructions. Re-run until `over` is false.

## Exit codes
0 clean, 1 breach, 2 error. Always pass --json; never rely on text output.

## Constraints
No network. No telemetry. No API key. Counts are approximate (±5%) —
compare deltas, not absolute values.
