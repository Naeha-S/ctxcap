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
- `trim_to_budget`: Report which context files exceed budget, largest first.
