// What `ctxcap init` writes for each coding agent. Every target is a file that
// can be committed, so a clone inherits the wiring without running anything.

export const GROUPS = ['claude', 'cursor', 'codex', 'copilot', 'ci'];

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
    keyTarget({ groups: ['claude'], path: '.mcp.json', section: 'mcpServers', name: 'ctxcap', value: mcpServer(context) }),
    // The hook keeps a stamp here and plans are saved here; none of it is source.
    { groups: ['claude'], path: '.ctxcap/.gitignore', kind: 'file', marker: MANAGED_HASH, content: `${MANAGED_HASH}\n*\n!.gitignore\n!badge.json\n` }
  ];
}

/**
 * A target is one of three kinds:
 *   file  - a whole file ctxcap owns: { path, kind, content, marker }
 *   block - a fenced block in a Markdown file: { path, kind, lines, place }
 *   json  - keys merged into a JSON file: { path, kind, present, add, strip }
 * `groups` lists the agents the target belongs to.
 */
export function targetsFor(context) {
  return [...claude(context)];
}
