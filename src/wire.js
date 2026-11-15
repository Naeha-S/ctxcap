// What `ctxcap init` writes for each coding agent. Every target is a file that
// can be committed, so a clone inherits the wiring without running anything.

import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const GROUPS = ['claude', 'cursor', 'codex', 'copilot', 'ci', 'badge', 'mcp'];
// The MCP server costs about 500 tokens of tool definitions in every session,
// for steps the skill already covers, so it is written only when asked for.
export const DEFAULT_GROUPS = GROUPS.filter((group) => group !== 'mcp');

export const BEGIN = '<!-- ctxcap:begin -->';
export const END = '<!-- ctxcap:end -->';
export const MANAGED_MD = '<!-- ctxcap:managed -->';
export const MANAGED_HASH = '# ctxcap:managed';

const npx = ({ version, pin }) => (pin ? `npx ctxcap@${version}` : 'npx ctxcap');
const npxYes = ({ version, pin }) => (pin ? `npx -y ctxcap@${version}` : 'npx -y ctxcap');

// ---------------------------------------------------------------- JSON targets

const isEmpty = (value) => value !== null && typeof value === 'object' && Object.keys(value).length === 0;

/** One key ctxcap owns: `doc[section][name]`. */
function keyTarget({ groups, path, section, name, value }) {
  return {
    groups, path, kind: 'json',
    present: (doc) => Boolean(doc[section]) && Object.hasOwn(doc[section], name),
    add: (doc) => { doc[section] ??= {}; doc[section][name] = value; },
    strip: (doc) => {
      if (!doc[section]) return;
      delete doc[section][name];
      if (isEmpty(doc[section])) delete doc[section];
    }
  };
}

// A hook group is ours when every command in it runs ctxcap.
const ownsGroup = (group) => Array.isArray(group?.hooks) && group.hooks.length > 0
  && group.hooks.every((hook) => typeof hook?.command === 'string' && /\bctxcap\b/.test(hook.command));

/** Hook groups appended to `doc.hooks[event]`, next to whatever is there. */
function hooksTarget({ groups, path, events }) {
  return {
    groups, path, kind: 'json',
    present: (doc) => Object.values(doc.hooks ?? {}).some((list) => Array.isArray(list) && list.some(ownsGroup)),
    add: (doc) => {
      doc.hooks ??= {};
      for (const [event, group] of Object.entries(events)) (doc.hooks[event] ??= []).push(group);
    },
    strip: (doc) => {
      for (const [event, list] of Object.entries(doc.hooks ?? {})) {
        if (!Array.isArray(list)) continue;
        doc.hooks[event] = list.filter((group) => !ownsGroup(group));
        if (doc.hooks[event].length === 0) delete doc.hooks[event];
      }
      if (isEmpty(doc.hooks)) delete doc.hooks;
    }
  };
}

const mcpServer = ({ version, pin }) => ({
  command: 'npx',
  args: pin ? ['-y', '-p', `ctxcap@${version}`, 'ctxcap-mcp'] : ['-y', 'ctxcap-mcp']
});

// .ctxcap/ holds the hook stamp and saved plans, which are not source, and the
// badge, which is. The Claude hooks and the badge both need this file.
const stateIgnore = (groups) => ({
  groups, path: '.ctxcap/.gitignore', kind: 'file', marker: MANAGED_HASH, content: `${MANAGED_HASH}\n*\n!.gitignore\n!badge.json\n`
});

// ---------------------------------------------------------------- Claude Code

export const SKILL_DESCRIPTION = 'Measure and trim agent context files (CLAUDE.md, AGENTS.md, .cursor/rules). Use before editing a context file, when it has grown past budget, or when a rule has stopped being followed.';

// The three rules are the ones the README gives; a test keeps them identical.
export const AGENT_RULES = `1. Splice by \`startLine\`/\`endLine\`. Never rewrite a file from scratch.
2. Never cut a span listed in \`preserve\`. The one exception is a \`condense\`
   finding on that span: apply its \`condensedText\` exactly as given.
3. If \`satisfiable\` is false, report \`minAchievable\` and stop.`;

function skill(context) {
  const run = npx(context);
  return `---
name: ctxcap
description: ${SKILL_DESCRIPTION}
---

${MANAGED_MD}
# ctxcap

Measure first. Trim only when the total is over budget.

\`\`\`bash
${run} --json                        # tokens per context file
${run} --stale --json                # references that no longer resolve
\`\`\`

The loop:

\`\`\`bash
${run} --plan --budget <n>           # ranked plan, JSON
${run} --plan --budget <n> --apply   # apply it
${run} --verify <planId>             # check what landed
\`\`\`

Three rules:

${AGENT_RULES}

Show the user the diff before anything is committed.
`;
}

function claude(context) {
  const run = npxYes(context);
  const command = (event) => ({ type: 'command', command: `${run} hook ${event}`, timeout: 60 });
  return [
    { groups: ['claude'], path: '.claude/skills/ctxcap/SKILL.md', kind: 'file', marker: MANAGED_MD, content: skill(context) },
    hooksTarget({
      groups: ['claude'], path: '.claude/settings.json',
      events: {
        PostToolUse: { matcher: 'Edit|Write|MultiEdit', hooks: [command('post-edit')] },
        Stop: { hooks: [command('stop')] }
      }
    }),
    // The hook keeps a stamp here and plans are saved here; none of it is source.
    stateIgnore(['claude', 'badge']),
    { groups: ['claude'], path: '.ctxcap/stamp', kind: 'state' }
  ];
}

// ---------------------------------------------------------------- Cursor

// The spec glob `**/{CLAUDE,AGENTS}.md` is not valid YAML unquoted (a leading
// `*` starts an alias), so the same files are listed the way Cursor writes
// several globs itself: comma-separated, starting with a plain name.
export const CURSOR_GLOBS = 'CLAUDE.md,AGENTS.md,**/CLAUDE.md,**/AGENTS.md';

function cursorRule(context) {
  const run = npx(context);
  return `---
description: Measure agent context files with ctxcap before and after editing them
alwaysApply: false
globs: ${CURSOR_GLOBS}
---

${MANAGED_MD}
Before and after you edit this file, run \`${run} --json\` and report the token change.
If the total is over budget, run \`${run} --plan --budget <n>\`, cut only the line ranges it lists, then run the \`${run} --verify <planId>\` it names.
`;
}

function cursor(context) {
  return [
    { groups: ['cursor'], path: '.cursor/rules/ctxcap.mdc', kind: 'file', marker: MANAGED_MD, content: cursorRule(context) }
  ];
}

// ---------------------------------------------------------------- MCP (opt-in)

// The same server entry for Claude Code and for Cursor, so both get the same tools.
const mcp = (context) => ['.mcp.json', '.cursor/mcp.json'].map((file) => keyTarget({
  groups: ['mcp'], path: file, section: 'mcpServers', name: 'ctxcap', value: mcpServer(context)
}));

// ---------------------------------------------------------------- Codex, Copilot

function pointers(context) {
  const run = npx(context);
  return [
    {
      groups: ['codex'], path: 'AGENTS.md', kind: 'block', place: 'append',
      lines: [
        `\`${run} --json\` counts the tokens in agent context files such as this one.`,
        'Run it before and after you edit one, and report the change.'
      ]
    },
    {
      groups: ['copilot'], path: '.github/copilot-instructions.md', kind: 'block', place: 'append',
      lines: [
        `\`${run} --json\` counts the tokens in agent context files: this file, AGENTS.md, CLAUDE.md, and .cursor/rules.`,
        'Run it before and after you edit one, and report the change in the pull request.',
        `When the total is over budget, \`${run} --plan --budget <n>\` lists the line ranges to cut.`
      ]
    }
  ];
}

// ---------------------------------------------------------------- CI

function workflow({ version, pin }) {
  return `${MANAGED_HASH}
# Written by "ctxcap init". Reports what agent context files cost on each pull request.
name: ctxcap
on: pull_request

permissions:
  contents: read
  pull-requests: write
  security-events: write

jobs:
  ctxcap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: Naeha-S/ctxcap@${pin ? `v${version}` : 'v1'}
        with:
          fail-on: never
          # To enforce a budget, add "budgets": { "total": 2000 } to .ctxcap.json
          # and change the line above to: fail-on: budget
`;
}

const WORKFLOWS = '.github/workflows';
const USES_ACTION = /^\s*-?\s*uses:\s*["']?Naeha-S\/ctxcap@/im;
const USES_LOCAL = /^\s*-?\s*uses:\s*["']?\.\/?["']?\s*$/m;
const RUNS_CLI = /\bnpx\s+(?:-\S+\s+)*ctxcap(?:@[\w.-]+)?(?=\s|$)/m;

/**
 * The workflow, if any, in which the user already runs ctxcap: the action by
 * name, the CLI through npx, or `uses: ./` in the repository that is the action.
 */
export async function userWorkflow(root) {
  let names;
  try {
    names = (await readdir(path.join(root, WORKFLOWS))).filter((name) => /\.ya?ml$/.test(name)).sort();
  } catch {
    return null;
  }
  let isAction = false;
  try { isAction = /ctxcap/i.test(await readFile(path.join(root, 'action.yml'), 'utf8')); } catch { /* not the action's own repository */ }
  for (const name of names) {
    const text = await readFile(path.join(root, WORKFLOWS, name), 'utf8');
    if (text.includes(MANAGED_HASH)) continue;
    const code = text.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
    if (USES_ACTION.test(code) || RUNS_CLI.test(code) || (isAction && USES_LOCAL.test(code))) return `${WORKFLOWS}/${name}`;
  }
  return null;
}

const ci = (context) => [
  {
    groups: ['ci'], path: `${WORKFLOWS}/ctxcap.yml`, kind: 'file', marker: MANAGED_HASH, content: workflow(context),
    userWired: userWorkflow, userReason: 'already runs ctxcap'
  }
];

// ---------------------------------------------------------------- badge

/** owner/name of the GitHub repository at `root`, or null. */
export async function githubRepo(root) {
  const sources = [];
  const remote = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (remote.status === 0) sources.push(remote.stdout.trim());
  try {
    const { repository } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    sources.push(typeof repository === 'string' ? repository : repository?.url);
  } catch { /* no package.json: the remote is the only source */ }
  for (const source of sources) {
    const match = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(source ?? '');
    if (match) return { owner: match[1], name: match[2] };
  }
  return null;
}

const README_NAMES = ['README.md', 'readme.md', 'Readme.md', 'README.markdown'];

async function existing(root, names) {
  for (const name of names) {
    try { await readFile(path.join(root, name)); return name; } catch { /* try the next spelling */ }
  }
  return null;
}

// The badge should show the total as it will be once init has written the
// other targets, some of which are context files themselves.
async function totalAfter({ root, version, pin, groups, force }, others) {
  const [{ loadConfig }, { collectFiles }, { countTokens }, { planInit }] = await Promise.all([
    import('./config.js'), import('./glob.js'), import('./tokenize.js'), import('./init.js')
  ]);
  const config = await loadConfig(root, null);
  const planned = new Map((await planInit({ root, version, pin, groups, force, targets: others })).map((step) => [step.path, step.after]));

  // Which of the files init creates does the config count? Ask the same glob,
  // on an empty copy of the names.
  const created = [...planned.keys()];
  const probe = await mkdtemp(path.join(tmpdir(), 'ctxcap-probe-'));
  let counted = [];
  try {
    for (const file of created) {
      await mkdir(path.dirname(path.join(probe, file)), { recursive: true });
      await writeFile(path.join(probe, file), '');
    }
    counted = await collectFiles(probe, config);
  } finally {
    await rm(probe, { recursive: true, force: true });
  }

  let total = 0;
  for (const file of new Set([...await collectFiles(root, config), ...counted])) {
    const text = planned.has(file) ? planned.get(file) : await readFile(path.join(root, file), 'utf8');
    if (text !== null) total += countTokens(text);
  }
  return total;
}

async function badge(context, others) {
  const repo = await githubRepo(context.root);
  if (!repo) return [];
  const { BADGE_FILE, badgeText, badgeMarkdown } = await import('./badge.js');
  const readme = await existing(context.root, README_NAMES);
  return [
    // Measured only when init is about to write it: doctor and remove never need the number.
    { groups: ['badge'], path: BADGE_FILE, kind: 'file', marker: '"schemaVersion"', content: async () => badgeText(await totalAfter(context, others)) },
    ...(readme ? [{ groups: ['badge'], path: readme, kind: 'block', place: 'after-h1', lines: [badgeMarkdown(repo)] }] : []),
    stateIgnore(['claude', 'badge'])
  ];
}

/**
 * A target is one of four kinds:
 *   file  - a whole file ctxcap owns: { path, kind, content, marker }
 *   block - a fenced block in a Markdown file: { path, kind, lines, place }
 *   json  - keys merged into a JSON file: { path, kind, present, add, strip }
 *   state - working state init never writes and remove clears: { path, kind }
 * `groups` lists the agents the target belongs to.
 */
export async function targetsFor(context) {
  const agents = [...claude(context), ...cursor(context), ...pointers(context), ...ci(context), ...mcp(context)];
  const extra = await badge(context, agents);
  // The Claude hooks and the badge share .ctxcap/.gitignore: list it once.
  return [...agents, ...extra.filter((target) => !agents.some((other) => other.path === target.path))];
}
