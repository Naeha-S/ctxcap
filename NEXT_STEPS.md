# `ctxcap` — Next Steps & Launch Checklist

## 1. Publish `ctxcap@1.0.1` and `ctxcap-mcp@0.1.1`

All docs (`README.md`, `AGENTS.md`, `llms.txt`), version numbers, and workspaces are updated and committed. The tarball is verified (12.3 kB, 19 files, no test leaks).

Run from the root of `tokenlint`:

```powershell
npm publish --access public
npm publish --workspace packages/ctxcap-mcp --access public
```

Verify propagation:

```powershell
npm view ctxcap version
# Expected: 1.0.1
npm view ctxcap-mcp version
# Expected: 0.1.1
```

---

## 2. Verify Fresh Installation from Cold Directory

In a fresh temp directory:

```powershell
cd $env:TEMP; mkdir cold_test; cd cold_test

# 1. CLI verification
npx -y ctxcap@1.0.1 --version
# Expected: 1.0.1

# 2. JSON output verification
npx -y ctxcap@1.0.1 --json
# Expected: exit 0, empty files: []

# 3. Direct MCP runner verification
node -e "const {spawn} = require('child_process'); const p = spawn('npx', ['-y', 'ctxcap-mcp'], {shell: true}); const b = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}); p.stdout.on('data', d => { console.log(d.toString()); process.exit(0); }); p.stdin.write('Content-Length: ' + Buffer.byteLength(b) + '\r\n\r\n' + b); setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 15000);"
# Expected: serverInfo with name: "ctxcap", version: "1.0.1"
```

---

## 3. The 24-Hour Bake Period

- Test `ctxcap` against 1 or 2 real agent repositories you work with.
- Look out for:
  - Repos with large `README.md` or nested docs that might trigger false-positive budget alarms.
  - Action runs on forks (`pull_request_target`) to verify permissions and sticky comments.
  - Any edge cases where `prompts/**` or `.cursor/rules/**` globbing matches unexpectedly.
- If you find any rough edges, fix them and ship `0.1.2` quietly before public eyes see it.

---

## 4. Launch: r/ClaudeAI & Agent Communities

Once the 24 hours have passed and cold-shell tests remain rock-solid:

### Post Pitch Draft

**Title**: *I built `ctxcap` — an offline, zero-config token budget linter for prompt and context files (with direct MCP server)*

**Body**:
> If you build with Claude Code, Cursor, or agentic frameworks, you know context files (`CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `prompts/`) tend to creep silently over time until they eat half your context window.
>
> I built **`ctxcap`** to gate repositories in CI and provide MCP tools for agents:
> - **Zero config, offline, zero network / telemetry**: pins `gpt-tokenizer`, no API keys required.
> - **One command**: `npx -y ctxcap --json` (outputs machine-readable token counts, deltas against git merge-base, and compression suggestions).
> - **MCP Server**: `npx -y ctxcap-mcp` exposes `measure_context` and `trim_to_budget` directly to Claude / Cursor / any MCP client.
> - **GitHub Action**: Sticky PR comments and SARIF code scanning annotations (`uses: Naeha-S/ctxcap@v1.0.1`).
>
> Repo: https://github.com/Naeha-S/ctxcap
> Feedback and bug reports welcome!
