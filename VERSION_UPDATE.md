# Release version update map

Use this checklist for every release so version changes do not depend on a
repository search.

## Files to update

1. `package.json` — update the CLI package `version`.
2. `packages/ctxcap-mcp/package.json` — update the MCP package `version` and
   set its `ctxcap` dependency range to `^X.Y.Z`; a test fails when the range
   does not start at the CLI version.
3. `server.json` — update the MCP Registry `version` and npm package version;
   a test fails when either differs from the MCP package.
4. `package-lock.json` — regenerate with `npm install --package-lock-only`;
   never edit the resolved package integrity by hand.
5. `src/version.js` — no literal version is needed; it reads `package.json`.
   `.claude-plugin/plugin.json` — update the plugin `version`; a test fails
   when it differs from `package.json`.
6. `README.md` — update pinned npm, MCP, and GitHub Action examples.
7. Release examples — update pinned `Naeha-S/ctxcap@vX.Y.Z`; keep `@v1` only
   as the moving major alias. This includes the paste-in block in
   `examples/boilerplate/AGENTS.md`, which a test checks against
   `package.json`. The repository's own workflow runs the action from the
   checkout (`uses: ./`) and needs no change.
8. The repository's own wiring — run `node src/index.js init --yes` so the
   pins in `.claude/`, `.cursor/`, `AGENTS.md`, and
   `.github/copilot-instructions.md` move to the new version, then
   `node src/index.js --update-baseline`. Both `init` and
   `node src/index.js doctor` must exit 0; a test fails when they do not. Do
   not pass `--force`: it would replace the hand-written workflow.
9. `DISCOVERY.md` — before the tag, fill in the baseline numbers it could not
   read and the two live-session tables (Claude Code and Cursor).
10. Publish to npm before merging to `main`, or straight after. The wiring that
   `init` writes runs `npx ctxcap@X.Y.Z` and `Naeha-S/ctxcap@vX.Y.Z`, and both
   fail until that version and tag exist.
11. Git tags — create `vX.Y.Z`, then move `v1` to the same release commit.
12. MCP Registry — after `ctxcap-mcp` is on npm, run `mcp-publisher publish`
    from the repository root. It sends `server.json`, and the registry checks
    that the npm package of that version exists and carries the same
    `mcpName`. npm does not do this for you: the listing stayed at 0.1.4
    while npm went to 0.1.9.

## Before publishing

A published npm version cannot be replaced. If `npm view ctxcap version`
already prints the version in `package.json`, that version is taken: anything
merged since needs a new version number, starting again from step 1. The same
goes for `ctxcap-mcp`.

Publish from a commit where `npm test` passes, and tag that same commit.

The MCP Registry keeps every version too, and a published one cannot be
edited. A change to `server.json` alone (the description, `websiteUrl`) only
reaches the listing under a version the registry has not seen, which means the
next `ctxcap-mcp` release.

## Required checks

```powershell
npm install --package-lock-only --ignore-scripts
npm ci
npm test
npm pack --dry-run
npm view ctxcap version
npm view ctxcap-mcp version
mcp-publisher validate
```

For a release, verify the CLI and MCP server from a cold directory with
`npx -y ctxcap@VERSION --version` and `npx -y ctxcap-mcp@MCP_VERSION`.
