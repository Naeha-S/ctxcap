# `ctxcap` — v1.3.0 Release Follow-up

## Status

`ctxcap@1.3.0` and `ctxcap-mcp@0.1.6` are published. Use the `@latest` npm
tag for normal usage so the newest published release is selected; keep
explicit versions only for reproducible release checks and pinned actions.

## 1. Confirm the Published Packages

Run from the root of `tokenlint`:

```powershell
npm pack --dry-run
```

Verify propagation:

```powershell
npm view ctxcap version
# Expected: 1.3.0
npm view ctxcap-mcp version
# Expected: 0.1.6
```

---

## 2. Verify Fresh Installation from Cold Directory

In a fresh temp directory:

```powershell
cd $env:TEMP; mkdir cold_test; cd cold_test

# 1. CLI verification; @latest selects the newest published release
npx -y ctxcap@latest --version
# Expected: 1.3.0

# 2. JSON output verification
npx -y ctxcap@latest --json
# Expected: exit 0, empty files: []

npx -y ctxcap@latest --plan --budget 40000
# Expected: schema "ctxcap/plan/v2", deterministic planId, and preserve spans

# 3. Direct MCP runner verification
node -e "const {spawn} = require('child_process'); const p = spawn('npx', ['-y', 'ctxcap-mcp@latest'], {shell: true}); const b = JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {}}); p.stdout.on('data', d => { console.log(d.toString()); process.exit(0); }); p.stdin.write('Content-Length: ' + Buffer.byteLength(b) + '\r\n\r\n' + b); setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 15000);"
# Expected: serverInfo with name: "ctxcap", version: "1.3.0"
```

---

## 3. The 24-Hour Bake Period

- Test `ctxcap` against 1 or 2 real agent repositories you work with.
- Look out for:
  - Repos with large `README.md` or nested docs that might trigger false-positive budget alarms.
  - Action runs on forks (`pull_request_target`) to verify permissions and sticky comments.
  - Any edge cases where `prompts/**` or `.cursor/rules/**` globbing matches unexpectedly.
- If you find any rough edges, fix them before public eyes see the release.

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
> - **One command**: `npx -y ctxcap@latest --json` (outputs machine-readable token counts, deltas against git merge-base, and compression suggestions).
> - **MCP Server**: `npx -y ctxcap-mcp@latest` exposes measurement plus the agent plan/verify loop directly to Claude / Cursor / any MCP client.
> - **GitHub Action**: Sticky PR comments and SARIF code scanning annotations (`uses: Naeha-S/ctxcap@v1.3.0`).
>
> Repo: https://github.com/Naeha-S/ctxcap
> Feedback and bug reports welcome!

## 5. Test on other repositories

From each repository containing agent context files:

```powershell
cd C:\path\to\other-repo
npx -y ctxcap@latest --json
npx -y ctxcap@latest --stale --json
npx -y ctxcap@latest --plan --budget 40000
```

If the output looks useful, create a baseline and add the GitHub Action:

```powershell
npx -y ctxcap@latest --update-baseline
git add ctxcap-baseline.json
git commit -m "Add ctxcap baseline"
```

Use the pinned action reference `Naeha-S/ctxcap@v1.3.0`. For MCP clients, use
`npx -y ctxcap-mcp@latest` from the target repository; pin `@0.1.6` only for
reproducible release checks.

## 6. Share the release

- npm: [ctxcap](https://www.npmjs.com/package/ctxcap) and
  [ctxcap-mcp](https://www.npmjs.com/package/ctxcap-mcp)
- GitHub: <https://github.com/Naeha-S/ctxcap>
- Action: `Naeha-S/ctxcap@v1.3.0`

Share a concrete before/after from another repository rather than only the
token count. Include the stale-reference findings, the ranked plan, and the
verification result so users can see what changed safely.
