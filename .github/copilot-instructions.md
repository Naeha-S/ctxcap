<!-- ctxcap:begin -->
`npx ctxcap@1.5.1 --json` counts the tokens in agent context files: this file, AGENTS.md, CLAUDE.md, and .cursor/rules.
Run it before and after you edit one, and report the change in the pull request.
When the total is over budget, `npx ctxcap@1.5.1 --plan --budget <n>` lists the line ranges to cut.
<!-- ctxcap:end -->
