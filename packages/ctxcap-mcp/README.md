# ctxcap-mcp

Model Context Protocol (MCP) server for [ctxcap](https://github.com/Naeha-S/ctxcap) — token budget linter for prompt and context files.

## Run directly

```bash
npx -y ctxcap-mcp
```

Or configure in your MCP client:

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

## Tools

- `measure_context`: Measure token cost and delta of context files.
- `context_budget_plan`: Return a ranked, deterministic splice plan with safety classifications and preserve spans.
- `context_budget_verify`: Verify that a plan landed without drift or preserve-span violations.
- `trim_to_budget`: Deprecated alias for `context_budget_plan`; always returns `apply: false`.
