# ctxcap discovery audit

## Surfaces updated

- npm metadata: root `ctxcap` description and keywords target Claude Code,
  Cursor, agents, context engineering, MCP, SARIF, and GitHub Actions.
- npm metadata: `ctxcap-mcp` now has an agent-facing description, keywords,
  and the registry ownership field `mcpName`.
- MCP tools: descriptions explain the symptoms, inputs, response fields,
  line-range safety rules, satisfiability stop condition, and verification.
- README and MCP README: CLI, MCP, Claude Code, Codex, Cursor, offline
  requirements, plan lifecycle, and links to schemas and `llms.txt`.
- `llms.txt`: five-line agent discovery contract.
- Workspace skill:
  [`.github/skills/ctxcap-context-budget/SKILL.md`](.github/skills/ctxcap-context-budget/SKILL.md).
- GitHub metadata: description and ten discovery topics are configured.

## MCP Registry preparation

[`server.json`](server.json) uses the current official schema URL,
`io.github.Naeha-S/ctxcap` as the server namespace, and the next
`ctxcap-mcp@0.1.4` package metadata. The currently published `0.1.3` cannot
be overwritten; publish `0.1.4` before submitting the registry entry. The
official registry requires:

- a namespace the publisher can authenticate;
- ownership metadata matching the package (`mcpName`);
- the public npm registry URL;
- an npm package and version matching `server.json`.

The registry is currently a preview. This repository is prepared for
submission but no registry publication was performed.

## Distribution candidates

Prepare small, targeted contributions for approval to:

- awesome-claude-code collections;
- awesome-mcp-servers collections;
- Claude Code starter repositories;
- Cursor rules and setup collections;
- agentic development boilerplates and MCP client templates.

Each contribution should show the offline constraint, one install command, the
plan/verify loop, and a real before/after measurement. Do not mass-submit
duplicate entries or open PRs without selecting and reviewing each target.

## Manual steps requiring approval

1. Authenticate the GitHub namespace if the MCP Registry requests proof.
2. Submit `server.json` through the official MCP Registry publishing workflow.
3. Publish `ctxcap-mcp@0.1.4`, which includes the corrected `mcpName`, before registry
   submission.
4. Choose one public repository with a large context file, run the documented
   before/after workflow, and publish the resulting case study.
5. Select specific distribution repositories, adapt their contribution rules,
   and request approval before opening any external PR.
6. Enable npm provenance on a future release only after verifying the current
   npm trusted-publishing workflow and CI permissions.
