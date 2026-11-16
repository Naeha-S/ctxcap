# The MCP Context Cost Index

One file per month. Each starts the most widely used MCP servers over stdio,
asks each for its tool list, and counts what those definitions cost in tokens
before a session has said anything.

The first month is [2026-11](2026-11.md). The pages are served from `docs/mcp/`:

- <https://naeha-s.github.io/ctxcap/mcp/> always shows the newest month.
- <https://naeha-s.github.io/ctxcap/mcp/2026-11/> is the permanent page for one
  month. Cite that form; it keeps meaning what it meant after the next month
  is published.

## What is counted

`tools/list` returns a definition per tool. Clients put the name, description,
and input schema in the model's prompt. The count is the tokens in exactly
those three fields for every tool, serialized as JSON with
`gpt-tokenizer@3.0.1`:

```json
[{ "name": "...", "description": "...", "inputSchema": { } }]
```

`title`, `annotations`, and `outputSchema` are left out because not every
client sends them. The number is therefore a lower bound.

- One `initialize` and one `tools/list` per server. No tool is called and no
  conversation starts.
- Credentials are placeholders. These servers answer `tools/list` without a
  valid token.
- The measurement is the default tool list. A server that hides tools until it
  is configured shows fewer; a server that offers toolsets can show fewer when
  they are narrowed. Both are noted where they apply.
- A server that will not start without a database, a project, or a product
  subcommand is listed as not measured, with the reason, rather than dropped.

## Build it

```bash
npm run mcp:index        # install pinned versions, measure, write mcp-index/<month>.json and .md
npm run leaderboard:page # rebuild docs/, including docs/mcp/
```

| Flag | Effect |
| --- | --- |
| `--month <yyyy-mm>` | Month in the file name (default: this month, UTC) |
| `--out <dir>` | Output directory (default: `mcp-index`) |
| `--servers <file>` | Server list (default: `scripts/mcp-servers.json`) |
| `--only <name>` | Measure one server by name (repeatable) |
| `--refresh` | Delete the install cache and install again |
| `--offline` | Fail instead of installing anything |
| `--date <yyyy-mm-dd>` | Date recorded as measured (default: today, UTC) |

Versions are pinned in `scripts/mcp-servers.json`, so a rerun measures the same
code. Installs are cached under `.ctxcap/mcp-cache/`, which git ignores; a
second run makes no network calls. The script is not part of the npm package.

## Every month

`.github/workflows/mcp-index.yml` runs at 07:00 UTC on the 16th, an hour after
the Context Budget Index. It measures the pinned versions, rebuilds the pages,
runs the tests, and commits `mcp-index/` and `docs/` to `main`. A month that
already has a `.json` is not measured again, so a link to a month page keeps
its meaning. The workflow can be started by hand with
`gh workflow run mcp-index.yml`; in a month that is already published that does
nothing. `-f dry_run=true` measures into a scratch directory and commits
nothing.

## Adding a server

Add an entry to `scripts/mcp-servers.json` with a pinned version, any
placeholder environment variables it needs to start, and arguments. Run
`npm run mcp:index -- --only <name> --month <yyyy-mm>` to check it, then
rebuild the page. A server that exposes thousands of tokens of schema is not a
bad server; the index says what it costs, not whether it is worth it.
