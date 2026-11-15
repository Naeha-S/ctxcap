# ctxcap-mcp

Model Context Protocol (MCP) server for [ctxcap](https://github.com/Naeha-S/ctxcap) — token budget linter for prompt and context files.

## Run directly

```bash
npx -y ctxcap-mcp
```

Requirements: Node.js 20 or newer. The server uses stdio, needs no API key,
environment variables, build step, or configuration, and does not make
network calls.

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

### Claude Code

```bash
claude mcp add ctxcap -- npx -y ctxcap-mcp
```

### Codex

```toml
[mcp_servers.ctxcap]
command = "npx"
args = ["-y", "ctxcap-mcp"]
```

### Cursor

Add the same stdio server to Cursor's MCP settings:

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

The server operates on the MCP client's current working directory and never
edits files: the agent applies the plan, then calls `context_budget_verify`.
Plans are saved under `.ctxcap/plans/` for 24 hours, so verify also works in a
later session. Use version 0.1.7 or newer; earlier versions do not connect.
