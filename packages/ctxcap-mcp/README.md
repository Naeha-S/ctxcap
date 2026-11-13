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

The server operates on the MCP client's current working directory. Plans are
held in the server process, so call `context_budget_verify` in the same server
session after applying edits.
