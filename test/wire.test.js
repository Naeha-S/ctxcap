import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, utimes, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { countTokens } from '../src/tokenize.js';
import { SKILL_DESCRIPTION, SKILL_TRIGGERS, AGENT_RULES, GROUPS, DEFAULT_GROUPS } from '../src/wire.js';
import { VERSION } from '../src/version.js';
import { CLI, cli, repo, tree } from './helpers.js';

const frontmatter = (text) => {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(match, 'frontmatter');
  return { raw: match[0], data: parseYaml(match[1]), body: text.slice(match[0].length) };
};

const USER_SETTINGS = {
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'npx prettier --write .' }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: './scripts/guard.sh' }] }]
  }
};

// ------------------------------------------------------------------ Claude Code

test('claude: the skill description is short, names three requests, and the commands are pinned', async () => {
  const dir = await repo();
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'claude').status, 0);
  const skill = (await tree(dir))['.claude/skills/ctxcap/SKILL.md'];
  const { raw, data, body } = frontmatter(skill);
  assert.deepEqual(data, { name: 'ctxcap', description: SKILL_DESCRIPTION });

  // The description is what the agent matches a request against.
  assert.ok(data.description.length < 400, `description is ${data.description.length} characters`);
  assert.ok(data.description.startsWith('Measure and trim agent context files (CLAUDE.md, AGENTS.md, .cursor/rules). Use before editing a context file, when it has grown past budget, or when a rule has stopped being followed.'));
  const phrases = data.description.match(/"[^"]+"/g).map((phrase) => phrase.slice(1, -1));
  assert.deepEqual(phrases, SKILL_TRIGGERS);
  assert.equal(phrases.length, 3);
  assert.ok(phrases.includes('my CLAUDE.md is getting long'));
  // Its cost in every session, which the README states.
  assert.ok(countTokens(raw) < 100, `frontmatter is ${countTokens(raw)} tokens`);
  const readme = await readFile('README.md', 'utf8');
  assert.ok(readme.includes(`${countTokens(raw)} tokens per session for the skill's name and description, ${countTokens(skill)} once the skill loads`));

  for (const command of ['--plan --budget <n>', '--plan --budget <n> --apply', '--verify <planId>', '--json', '--stale --json']) {
    assert.ok(body.includes(`npx ctxcap@${VERSION} ${command}`), command);
  }
  const source = await readFile('src/cli.js', 'utf8');
  for (const flag of new Set(body.match(/--[a-z][a-z-]+/g))) assert.ok(source.includes(`'${flag}'`), `${flag} is a ctxcap flag`);
});

test('claude: the three agent rules are the ones in the README, word for word', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.ok(readme.includes(AGENT_RULES));
  const dir = await repo();
  cli(dir, 'init', '--yes', '--agents', 'claude');
  assert.ok((await tree(dir))['.claude/skills/ctxcap/SKILL.md'].includes(AGENT_RULES));
});

test('claude: hooks merge into settings that already have a user hook, and come back out', async () => {
  const original = JSON.stringify(USER_SETTINGS, null, 2) + '\n';
  const dir = await repo({ '.claude/settings.json': original });
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'claude').status, 0);
  const files = await tree(dir);
  const settings = JSON.parse(files['.claude/settings.json']);

  assert.deepEqual(settings.permissions, USER_SETTINGS.permissions);
  assert.deepEqual(settings.hooks.PreToolUse, USER_SETTINGS.hooks.PreToolUse);
  assert.deepEqual(settings.hooks.PostToolUse[0], USER_SETTINGS.hooks.PostToolUse[0]);
  assert.deepEqual(Object.keys(settings), ['permissions', 'hooks', '_ctxcap']);
  assert.deepEqual(settings._ctxcap, { version: VERSION });

  // The documented shape: event -> [{ matcher?, hooks: [{ type, command }] }].
  assert.deepEqual(settings.hooks.PostToolUse[1], {
    matcher: 'Edit|Write|MultiEdit',
    hooks: [{ type: 'command', command: `npx -y ctxcap@${VERSION} hook post-edit`, timeout: 60 }]
  });
  assert.deepEqual(settings.hooks.Stop, [{ hooks: [{ type: 'command', command: `npx -y ctxcap@${VERSION} hook stop`, timeout: 60 }] }]);

  // No MCP server unless it is asked for.
  assert.ok(!('.mcp.json' in files));

  assert.equal(cli(dir, 'init', '--remove', '--yes', '--agents', 'claude').status, 0);
  assert.equal((await tree(dir))['.claude/settings.json'], original);
});

test('claude: --no-pin writes commands without a version', async () => {
  const dir = await repo();
  cli(dir, 'init', '--yes', '--no-pin', '--agents', 'claude,mcp');
  const files = await tree(dir);
  assert.ok(!Object.values(files).some((text) => /ctxcap@\d/.test(text)));
  assert.ok(files['.claude/skills/ctxcap/SKILL.md'].includes('npx ctxcap --json'));
  assert.deepEqual(JSON.parse(files['.mcp.json']).mcpServers.ctxcap.args, ['-y', 'ctxcap-mcp']);
  assert.deepEqual(JSON.parse(files['.claude/settings.json'])._ctxcap, { version: VERSION, pin: false });
});

// ------------------------------------------------------------------ hooks

const hook = (dir, event, input) => spawnSync('node', [CLI, 'hook', event], {
  cwd: dir, encoding: 'utf8', input: input ? JSON.stringify(input) : '', env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
});
const WORDS = 'Keep answers short and cite the file you changed. ';

test('hook post-edit: silent until a context file is newer than the stamp', async () => {
  const dir = await repo({ 'AGENTS.md': WORDS.repeat(4), 'src/app.js': 'export {};\n' });

  // First call only lays down the stamp: an edit elsewhere is not news.
  const first = hook(dir, 'post-edit', { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src/app.js') } });
  assert.deepEqual([first.status, first.stdout], [0, '']);
  const stamp = path.join(dir, '.ctxcap/post-edit.stamp');
  assert.ok((await stat(stamp)).isFile());
  assert.deepEqual([hook(dir, 'post-edit').status, hook(dir, 'post-edit').stdout], [0, '']);

  // A context file touched after the stamp is reported once.
  await writeFile(path.join(dir, 'AGENTS.md'), WORDS.repeat(8));
  const past = new Date(Date.now() - 60_000);
  await utimes(stamp, past, past);
  const changed = hook(dir, 'post-edit');
  assert.equal(changed.status, 0, changed.stderr);
  const output = JSON.parse(changed.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(output.hookSpecificOutput.additionalContext, /^ctxcap: AGENTS\.md is \d+ tokens\. Context files total \d+ tokens\.$/);
  assert.equal(hook(dir, 'post-edit').stdout, '');

  // The edited path counts even when the clock cannot tell the two apart.
  const direct = hook(dir, 'post-edit', { tool_name: 'Write', tool_input: { file_path: 'AGENTS.md' } });
  assert.match(JSON.parse(direct.stdout).hookSpecificOutput.additionalContext, /AGENTS\.md is \d+ tokens/);
});

test('hook stop: silent under budget, one message for the user over it, never exit 2', async () => {
  const dir = await repo({ 'AGENTS.md': WORDS.repeat(40), '.ctxcap.json': JSON.stringify({ budgets: { total: 5000 } }) });
  assert.deepEqual([hook(dir, 'stop').status, hook(dir, 'stop').stdout], [0, '']);

  await writeFile(path.join(dir, '.ctxcap.json'), JSON.stringify({ budgets: { total: 100 } }));
  const over = hook(dir, 'stop');
  assert.equal(over.status, 0);
  const message = JSON.parse(over.stdout).systemMessage;
  assert.match(message, /over the 100 budget/);
  assert.ok(message.includes(`npx ctxcap@${VERSION} --plan --budget 100`));
  // It reports what `--json --fail-on budget` fails on.
  assert.equal(cli(dir, '--json', '--fail-on', 'budget').status, 1);

  await writeFile(path.join(dir, '.ctxcap.json'), '{ broken');
  assert.equal(hook(dir, 'stop').status, 1);
  assert.equal(hook(dir, 'nonsense').status, 1);
});

// ------------------------------------------------------------------ Cursor

test('hook stop: three stops in a row over budget never send the agent back to work', async () => {
  const dir = await repo({ 'AGENTS.md': WORDS.repeat(40), '.ctxcap.json': JSON.stringify({ budgets: { total: 100 } }) });
  cli(dir, 'init', '--yes', '--agents', 'claude');
  const before = await tree(dir);
  const input = { session_id: 'abc', hook_event_name: 'Stop', cwd: dir, stop_hook_active: false };

  // What would make Claude Code continue instead of stopping: exit code 2, or
  // a "block" decision. The hook does neither, however often it is asked.
  for (let turn = 1; turn <= 3; turn++) {
    const result = hook(dir, 'stop', input);
    assert.equal(result.status, 0, `turn ${turn}`);
    assert.equal(result.stderr, '', `turn ${turn}`);
    const output = JSON.parse(result.stdout);
    assert.deepEqual(Object.keys(output), ['systemMessage'], `turn ${turn}`);
    assert.match(output.systemMessage, /^ctxcap: context files are at \d+ tokens, over the 100 budget\./);
  }
  // Nothing accumulates between stops that a later one could trip over.
  assert.deepEqual(await tree(dir), before);

  // Had another Stop hook already sent the agent back once, ours has said its line: silence.
  for (let turn = 1; turn <= 3; turn++) {
    const again = hook(dir, 'stop', { ...input, stop_hook_active: true });
    assert.deepEqual([again.status, again.stdout, again.stderr], [0, '', ''], `turn ${turn}`);
  }
  // No input, or input that is not JSON, is still a clean exit.
  assert.equal(hook(dir, 'stop').status, 0);
  const junk = spawnSync('node', [CLI, 'hook', 'stop'], { cwd: dir, encoding: 'utf8', input: 'not json', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.equal(junk.status, 0);

  // The hook as written to settings.json is a plain command with a timeout: no prompt or agent hook that could decide to block.
  const stop = JSON.parse(before['.claude/settings.json']).hooks.Stop;
  assert.deepEqual(stop, [{ hooks: [{ type: 'command', command: `npx -y ctxcap@${VERSION} hook stop`, timeout: 60 }] }]);
});

test('cursor: the rule has valid YAML frontmatter that attaches to context files only', async () => {
  const servers = JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app' } } }, null, 2) + '\n';
  const dir = await repo({ '.cursor/mcp.json': servers });
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'cursor').status, 0);
  const files = await tree(dir);
  assert.deepEqual(Object.keys(files).sort(), ['.cursor/mcp.json', '.cursor/rules/ctxcap.mdc']);
  assert.equal(files['.cursor/mcp.json'], servers);

  const { data, body } = frontmatter(files['.cursor/rules/ctxcap.mdc']);
  assert.deepEqual(Object.keys(data), ['description', 'alwaysApply', 'globs']);
  assert.equal(typeof data.description, 'string');
  assert.equal(data.alwaysApply, false);
  assert.deepEqual(data.globs.split(','), ['CLAUDE.md', 'AGENTS.md', '**/CLAUDE.md', '**/AGENTS.md']);
  assert.ok(body.includes(`npx ctxcap@${VERSION} --json`));

});

// ------------------------------------------------------------------ MCP (opt-in)

test('mcp: off by default, and --agents claude,mcp adds the same server for Claude Code and Cursor', async () => {
  assert.deepEqual(DEFAULT_GROUPS, GROUPS.filter((group) => group !== 'mcp'));
  const servers = (extra) => JSON.stringify({ mcpServers: extra }, null, 2) + '\n';
  const fixture = { '.mcp.json': servers({ github: { command: 'gh-mcp' } }), '.cursor/mcp.json': servers({ linear: { url: 'https://mcp.linear.app' } }) };

  const plain = await repo(fixture);
  assert.equal(cli(plain, 'init', '--yes').status, 0);
  const untouched = await tree(plain);
  assert.equal(untouched['.mcp.json'], fixture['.mcp.json']);
  assert.equal(untouched['.cursor/mcp.json'], fixture['.cursor/mcp.json']);
  assert.match(cli(plain, 'doctor').stdout, /^mcp {6}not wired$/m);

  const dir = await repo(fixture);
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'claude,mcp').status, 0);
  const files = await tree(dir);
  const entry = { command: 'npx', args: ['-y', '-p', `ctxcap@${VERSION}`, 'ctxcap-mcp'] };
  assert.deepEqual(JSON.parse(files['.mcp.json']), { mcpServers: { github: { command: 'gh-mcp' }, ctxcap: entry }, _ctxcap: { version: VERSION } });
  assert.deepEqual(JSON.parse(files['.cursor/mcp.json']), { mcpServers: { linear: { url: 'https://mcp.linear.app' }, ctxcap: entry }, _ctxcap: { version: VERSION } });
  assert.ok('.claude/skills/ctxcap/SKILL.md' in files && !('.cursor/rules/ctxcap.mdc' in files));
  assert.match(cli(dir, 'doctor').stdout, /^mcp {6}wired$/m);

  // Remove without --agents takes out everything init can write, MCP included.
  assert.equal(cli(dir, 'init', '--remove', '--yes').status, 0);
  assert.deepEqual(await tree(dir), fixture);
});

// ------------------------------------------------------------------ Codex, Copilot

const AGENTS = '# Agent notes\n\nUse pnpm, not npm.\n\n## Never\n\n- Never commit secrets.\n- Never edit generated files under `dist/`.\n';

test('codex: an existing AGENTS.md is byte-identical outside the fenced block', async () => {
  const dir = await repo({ 'AGENTS.md': AGENTS });
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'codex').status, 0);
  const wired = (await tree(dir))['AGENTS.md'];

  const begin = wired.indexOf('<!-- ctxcap:begin -->');
  const end = wired.indexOf('<!-- ctxcap:end -->') + '<!-- ctxcap:end -->'.length;
  assert.ok(begin > 0 && end > begin);
  assert.equal(wired.slice(0, begin), AGENTS + '\n');
  assert.equal(wired.slice(end), '\n');

  const block = wired.slice(begin, end).split('\n').slice(1, -1);
  assert.equal(block.length, 2);
  assert.ok(block[0].includes(`npx ctxcap@${VERSION} --json`));

  cli(dir, 'init', '--remove', '--yes', '--agents', 'codex');
  assert.equal((await tree(dir))['AGENTS.md'], AGENTS);
});

test('codex and copilot: missing files are created holding only the block', async () => {
  const dir = await repo();
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'codex,copilot').status, 0);
  const files = await tree(dir);
  assert.deepEqual(Object.keys(files).sort(), ['.github/copilot-instructions.md', 'AGENTS.md']);
  for (const [file, lines] of [['AGENTS.md', 2], ['.github/copilot-instructions.md', 3]]) {
    const all = files[file].trimEnd().split('\n');
    assert.deepEqual([all[0], all.at(-1)], ['<!-- ctxcap:begin -->', '<!-- ctxcap:end -->'], file);
    assert.equal(all.length - 2, lines, file);
    assert.ok(all[1].includes(`npx ctxcap@${VERSION} --json`), file);
  }
  cli(dir, 'init', '--remove', '--yes');
  assert.deepEqual(await tree(dir), {});
});

// ------------------------------------------------------------------ CI

test('ci: the workflow parses and pins the action to the package version', async () => {
  const dir = await repo();
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'ci').status, 0);
  const text = (await tree(dir))['.github/workflows/ctxcap.yml'];
  const doc = parseYaml(text);
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(doc.on, 'pull_request');
  const [checkout, action] = doc.jobs.ctxcap.steps;
  assert.equal(checkout.uses, 'actions/checkout@v4');
  assert.equal(checkout.with['fetch-depth'], 0);
  assert.equal(action.uses, `Naeha-S/ctxcap@v${pkg.version}`);
  assert.deepEqual(action.with, { 'fail-on': 'never' });
  assert.match(text, /^ +# .*"budgets": \{ "total": \d+ \}.*\n +# .*fail-on: budget$/m);

  const inputs = parseYaml(await readFile('action.yml', 'utf8')).inputs;
  for (const name of Object.keys(action.with)) assert.ok(name in inputs, `${name} is an action input`);

  const loose = await repo();
  cli(loose, 'init', '--yes', '--no-pin', '--agents', 'ci');
  assert.equal(parseYaml((await tree(loose))['.github/workflows/ctxcap.yml']).jobs.ctxcap.steps[1].uses, 'Naeha-S/ctxcap@v1');
});

// ------------------------------------------------------------------ all five

const WIRED = [
  '.claude/settings.json', '.claude/skills/ctxcap/SKILL.md', '.ctxcap/.gitignore', '.ctxcap/badge.json', '.ctxcap/badge.owned', '.cursor/rules/ctxcap.mdc',
  '.github/copilot-instructions.md', '.github/workflows/ctxcap.yml', 'AGENTS.md'
];

test('init: --print writes nothing, --yes writes every target, a second --yes is a byte-identical no-op', async () => {
  const dir = await repo({ 'AGENTS.md': AGENTS, '.claude/settings.json': JSON.stringify(USER_SETTINGS, null, 2) + '\n' });
  const before = await tree(dir);

  const printed = cli(dir, 'init', '--print');
  assert.equal(printed.status, 0);
  assert.deepEqual(await tree(dir), before);
  assert.equal(printed.stdout.match(/^diff --git /gm).length, WIRED.length);

  const first = cli(dir, 'init', '--yes');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.stdout, printed.stdout);
  const wired = await tree(dir);
  assert.deepEqual(Object.keys(wired).sort(), WIRED);
  assert.deepEqual(first.stderr.trim().split('\n').sort(), WIRED.map((file) => `wrote: ${file}`).sort());

  // Nothing is left to do, which is success: the exit code says so.
  const second = cli(dir, 'init', '--yes');
  assert.equal(second.status, 0);
  assert.equal(second.stdout, '');
  // One line per target; the badge's ownership sentinel travels with the badge.
  assert.deepEqual(second.stderr.trim().split('\n').sort(), WIRED.filter((file) => file !== '.ctxcap/badge.owned').map((file) => `skipped: ${file} (already configured)`).sort());
  assert.deepEqual(await tree(dir), wired);

  const forced = cli(dir, 'init', '--yes', '--force');
  assert.equal(forced.status, 0);
  assert.deepEqual(await tree(dir), wired);
});

test('init: --agents limits what is written', async () => {
  const dir = await repo();
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'codex, ci').status, 0);
  assert.deepEqual(Object.keys(await tree(dir)).sort(), ['.github/workflows/ctxcap.yml', 'AGENTS.md']);
});

test('init: warns when git would ignore a file it writes', async () => {
  const dir = await repo({ '.gitignore': '.ctxcap/\n.claude/\n' });
  const result = cli(dir, 'init', '--yes', '--agents', 'claude,codex');
  assert.equal(result.status, 0);
  const warned = result.stderr.split('\n').filter((line) => line.startsWith('warning: git ignores ')).map((line) => line.split(' ')[3].replace(/,$/, ''));
  // .ctxcap/ is not in the list: init narrows that rule itself.
  assert.deepEqual(warned.sort(), ['.claude/settings.json', '.claude/skills/ctxcap/SKILL.md']);
  assert.doesNotMatch(cli(await repo(), 'init', '--yes').stderr, /warning:/);
});

test('ci: a workflow that already runs ctxcap is reported as wired by the user, and init exits 0', async () => {
  const job = (step) => `name: context\non: pull_request\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n${step}\n`;
  const wiredByUser = {
    'the action by name': { '.github/workflows/context.yml': job('      - uses: Naeha-S/ctxcap@v1\n        with: { fail-on: budget }') },
    'the action, quoted and pinned to a commit': { '.github/workflows/lint.yaml': job('      - uses: "naeha-s/ctxcap@2b2d4cb4183549de9383d599a37d9eb48b303ab0"') },
    'the CLI through npx': { '.github/workflows/context.yml': job('      - run: npx -y ctxcap@1.4.0 --fail-on budget') },
    'the action from its own checkout': { '.github/workflows/ctxcap.yml': job('      - uses: ./'), 'action.yml': 'name: ctxcap\nruns:\n  using: composite\n' }
  };
  for (const [name, files] of Object.entries(wiredByUser)) {
    const dir = await repo(files);
    const before = await tree(dir);
    const file = Object.keys(files)[0];
    const result = cli(dir, 'init', '--yes', '--agents', 'ci');
    assert.equal(result.status, 0, name);
    assert.equal(result.stderr.trim(), `wired by user: ${file} (already runs ctxcap)`, name);
    assert.deepEqual(await tree(dir), before, name);
    assert.match(cli(dir, 'doctor').stdout, new RegExp(`^ci {7}wired: by ${file.replace(/[.]/g, '\\.')}, not written by ctxcap init$`, 'm'), name);
    assert.equal(cli(dir, 'doctor').status, 0, name);
    assert.match(cli(dir, 'init', '--remove', '--yes', '--agents', 'ci').stderr, /^left: .* \(not written by ctxcap init\)$/m, name);
    assert.deepEqual(await tree(dir), before, name);
  }

  const notWired = {
    'a commented-out step': { '.github/workflows/context.yml': job('      # - uses: Naeha-S/ctxcap@v1\n      - run: npm test') },
    'the MCP server, not the CLI': { '.github/workflows/context.yml': job('      - run: npx -y ctxcap-mcp --help') },
    'a local action in some other repository': { '.github/workflows/context.yml': job('      - uses: ./'), 'action.yml': 'name: widgets\n' }
  };
  for (const [name, files] of Object.entries(notWired)) {
    const dir = await repo(files);
    const result = cli(dir, 'init', '--yes', '--agents', 'ci');
    assert.equal(result.status, 0, name);
    assert.equal(result.stderr.trim(), 'wrote: .github/workflows/ctxcap.yml', name);
  }
});

test('ci: --force replaces a hand-written workflow only at the path init writes', async () => {
  const own = 'name: ctxcap\non: pull_request\njobs:\n  ctxcap:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: Naeha-S/ctxcap@v1\n';
  const atPath = await repo({ '.github/workflows/ctxcap.yml': own });
  assert.equal(cli(atPath, 'init', '--yes', '--agents', 'ci').status, 0);
  assert.equal((await tree(atPath))['.github/workflows/ctxcap.yml'], own);
  const forced = cli(atPath, 'init', '--yes', '--agents', 'ci', '--force');
  assert.equal(forced.status, 0);
  assert.ok((await tree(atPath))['.github/workflows/ctxcap.yml'].startsWith('# ctxcap:managed\n'));

  const elsewhere = await repo({ '.github/workflows/context.yml': own });
  const kept = cli(elsewhere, 'init', '--yes', '--agents', 'ci', '--force');
  assert.equal(kept.status, 0);
  assert.deepEqual(Object.keys(await tree(elsewhere)), ['.github/workflows/context.yml']);

  // A file at the path that does not run ctxcap is not wiring: it blocks, and exits 3.
  const unrelated = await repo({ '.github/workflows/ctxcap.yml': 'name: ctxcap\non: push\njobs: {}\n' });
  const blocked = cli(unrelated, 'init', '--yes', '--agents', 'ci');
  assert.equal(blocked.status, 3);
  assert.match(blocked.stderr, /^skipped: \.github\/workflows\/ctxcap\.yml \(not written by ctxcap init; --force overwrites it\)$/m);
});

test('README: "What it runs" lists every command init writes, word for word', async () => {
  const dir = await repo({ 'README.md': '# W\n' });
  assert.equal(cli(dir, 'init', '--yes', '--agents', GROUPS.join(',')).status, 0);
  const files = await tree(dir);
  const found = new Map();
  const note = (file, command) => found.set(`${file}  ${command}`, { file, command });

  for (const [file, text] of Object.entries(files)) {
    if (file.endsWith('.json')) {
      const doc = JSON.parse(text);
      for (const groups of Object.values(doc.hooks ?? {})) for (const group of groups) for (const entry of group.hooks) note(file, entry.command);
      for (const server of Object.values(doc.mcpServers ?? {})) note(file, [server.command, ...server.args].join(' '));
    } else if (/\.ya?ml$/.test(file)) {
      for (const match of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) note(file, match[1]);
    } else {
      for (const match of text.matchAll(/npx (?:-\S+ )*ctxcap@\d+\.\d+\.\d+(?: [^`#\n]*)?/g)) note(file, match[0].trim());
    }
  }
  // Every agent writes at least one command, apart from the badge, which runs nothing.
  const sources = [...new Set([...found.values()].map((entry) => entry.file))].sort();
  assert.deepEqual(sources, ['.claude/settings.json', '.claude/skills/ctxcap/SKILL.md', '.cursor/mcp.json', '.cursor/rules/ctxcap.mdc', '.github/copilot-instructions.md', '.github/workflows/ctxcap.yml', '.mcp.json', 'AGENTS.md']);

  const readme = await readFile('README.md', 'utf8');
  const section = readme.slice(readme.indexOf('### What it runs'), readme.indexOf('| Flag | Effect |'));
  assert.ok(section.length > 500);
  const documented = [];
  let current = '';
  for (const line of section.split('\n').filter((row) => row.startsWith('|') && !row.startsWith('| ---') && !row.startsWith('| Written to'))) {
    const [where, command] = line.split('|').slice(1).map((cell) => cell.trim());
    current = where || current;
    for (const file of current.match(/`[^`]+`/g)) documented.push(`${file.slice(1, -1)}  ${command.slice(1, -1)}`);
  }
  // Nothing written is missing from the table, and the table lists nothing that is not written.
  assert.deepEqual(documented.sort(), [...found.keys()].sort());
});
