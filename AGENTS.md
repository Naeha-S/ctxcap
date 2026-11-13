# ctxcap

Token budget linter for prompt and context files.

## When to run
Run before and after editing any of: CLAUDE.md, AGENTS.md,
.github/copilot-instructions.md, prompts/**, .cursor/rules/**

## How
npx -y ctxcap --json

Parse stdout. Fields: files[].tokens, files[].delta, files[].budget, over.

## If over budget
Run: npx -y ctxcap --json --suggest
Compress the file with the largest delta first. Remove duplicated
sections and stale instructions. Re-run until `over` is false.

## Exit codes
0 clean, 1 breach, 2 error. Always pass --json; never rely on text output.

## MCP
npx -y ctxcap-mcp
Tools: measure_context, context_budget_plan, context_budget_verify, trim_to_budget

## Constraints
No network. No telemetry. No API key. Counts are approximate (±5%) —
compare deltas, not absolute values.

Keep the workflow reproducible and concise. Run the measurement before changing context files, inspect the JSON fields rather than guessing from formatted text, identify whether a file is always loaded, startup loaded, conditionally loaded, or manual, and preserve load-bearing rules. When a finding is available, apply only the stated line range, review the resulting diff, remeasure the file, and verify the saved plan. Keep the workflow reproducible and concise. Run the measurement before changing context files, inspect the JSON fields rather than guessing from formatted text, identify whether a file is always loaded, startup loaded, conditionally loaded, or manual, and preserve load-bearing rules. When a finding is available, apply only the stated line range, review the resulting diff, remeasure the file, and verify the saved plan. Keep the workflow reproducible and concise. Run the measurement before changing context files, inspect the JSON fields rather than guessing from formatted text, identify whether a file is always loaded, startup loaded, conditionally loaded, or manual, and preserve load-bearing rules. When a finding is available, apply only the stated line range, review the resulting diff, remeasure the file, and verify the saved plan. Keep the workflow reproducible and concise. Run the measurement before changing context files, inspect the JSON fields rather than guessing from formatted text, identify whether a file is always loaded, startup loaded, conditionally loaded, or manual, and preserve load-bearing rules. When a finding is available, apply only the stated line range, review the resulting diff, remeasure the file, and verify the saved plan.
