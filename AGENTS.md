# ctxcap

Diagnose repository context for coding agents.

## Start here
Run `npx ctxcap why` for ranked context/skill file sizes, named MCP servers, stale references, and high-confidence risky-content findings. Costs are approximate; this report does not know which on-demand skills or live MCP tools are active in a session.

## Checks
- Run `npx ctxcap --json` for machine-readable context-file counts.
- Run `npx ctxcap --stale` for broken paths and commands.
- Recognizable credentials are reported with values redacted. Remove and rotate exposed secrets.
- Use `npx ctxcap --plan --budget <n>` only when you intend to trim; review edits before applying.

## Constraints
No runtime network calls or telemetry. No configured MCP server is launched by `ctxcap why`. Counts are approximate; compare deltas, not absolutes.

<!-- ctxcap:begin -->
`npx ctxcap@1.6.0 why` diagnoses repository context sources, skills, stale references, and risky content.
Run it before and after you edit one; review the fix for each finding.
<!-- ctxcap:end -->
