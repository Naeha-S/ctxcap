# Release version update map

Use this checklist for every release so version changes do not depend on a
repository search.

## Files to update

1. `package.json` — update the CLI package `version`.
2. `packages/ctxcap-mcp/package.json` — update the MCP package `version` and
   its `ctxcap` dependency range.
3. `server.json` — update the MCP Registry `version` and npm package version.
4. `package-lock.json` — regenerate with `npm install --package-lock-only`;
   never edit the resolved package integrity by hand.
5. `src/version.js` — no literal version is needed; it reads `package.json`.
6. `README.md`, `NEXT_STEPS.md`, and `DISCOVERY.md` — update pinned npm,
   MCP, and GitHub Action examples.
7. `.github/workflows/ctxcap.yml` and release examples — update pinned
   `Naeha-S/ctxcap@vX.Y.Z`; keep `@v1` only as the moving major alias.
8. Git tags — create `vX.Y.Z`, then move `v1` to the same release commit.

## Required checks

```powershell
npm install --package-lock-only --ignore-scripts
npm ci
npm test
npm pack --dry-run
npm view ctxcap version
npm view ctxcap-mcp version
```

For a release, verify the CLI and MCP server from a cold directory with
`npx -y ctxcap@VERSION --version` and `npx -y ctxcap-mcp@MCP_VERSION`.
