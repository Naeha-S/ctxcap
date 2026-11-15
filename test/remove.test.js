import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CLI, cli, git, repo, tree, treeHash } from './helpers.js';

const FIXTURE = {
  'README.md': '# Widgets\n\nA small library.\n',
  'AGENTS.md': '# Agent notes\n\nUse pnpm.\n\n## Never\n\n- Never commit secrets.\n',
  'package.json': JSON.stringify({ name: 'widgets', scripts: { test: 'node --test' } }, null, 2) + '\n',
  '.claude/settings.json': JSON.stringify({
    hooks: { PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'npx prettier --write .' }] }] },
    permissions: { deny: ['Read(.env)'] }
  }, null, 2) + '\n',
  '.cursor/mcp.json': JSON.stringify({ mcpServers: { linear: { url: 'https://mcp.linear.app' } } }, null, 4) + '\n',
  '.github/copilot-instructions.md': 'Prefer small pull requests.',
  'src/index.js': 'export const widget = 1;\n'
};

test('remove: init then remove leaves the tree hash unchanged and git status clean', async () => {
  const dir = await repo(FIXTURE);
  const before = await treeHash(dir);

  assert.equal(cli(dir, 'init', '--yes').status, 0);
  assert.notEqual(await treeHash(dir), before);
  // The Claude hook leaves a stamp behind; remove has to clear that as well.
  spawnSync('node', [CLI, 'hook', 'post-edit'], { cwd: dir, input: '', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
  assert.ok('.ctxcap/stamp' in await tree(dir));

  const preview = cli(dir, 'init', '--remove');
  assert.equal(preview.status, 0);
  assert.match(preview.stdout, /^deleted file mode 100644$/m);
  assert.ok('.mcp.json' in await tree(dir), 'remove without --yes writes nothing');

  const removed = cli(dir, 'init', '--remove', '--yes');
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(await treeHash(dir), before);
  assert.equal(git(dir, 'status', '--porcelain', '--ignored').stdout, '');
  assert.match(cli(dir, 'init', '--remove', '--yes').stderr, /nothing to remove/);
});

test('remove: a subset leaves the other agents wired, and shared files with them', async () => {
  const dir = await repo(FIXTURE);
  cli(dir, 'init', '--yes');
  const wired = await tree(dir);

  assert.equal(cli(dir, 'init', '--remove', '--yes', '--agents', 'cursor,codex').status, 0);
  const files = await tree(dir);
  assert.equal(files['AGENTS.md'], FIXTURE['AGENTS.md']);
  assert.equal(files['.cursor/mcp.json'], FIXTURE['.cursor/mcp.json']);
  assert.ok(!('.cursor/rules/ctxcap.mdc' in files));
  for (const kept of ['.claude/settings.json', '.claude/skills/ctxcap/SKILL.md', '.mcp.json', '.ctxcap/.gitignore', '.github/workflows/ctxcap.yml', '.github/copilot-instructions.md']) {
    assert.equal(files[kept], wired[kept], kept);
  }
});

test('remove: hand-written files at ctxcap paths and edits around the block survive', async () => {
  const workflow = 'name: ctxcap\non: pull_request\njobs: {}\n';
  const dir = await repo({ ...FIXTURE, '.github/workflows/ctxcap.yml': workflow });
  const first = cli(dir, 'init', '--yes');
  assert.equal(first.status, 3);
  assert.match(first.stderr, /skipped: \.github\/workflows\/ctxcap\.yml \(not written by ctxcap init; --force overwrites it\)/);

  const agents = path.join(dir, 'AGENTS.md');
  const wired = (await tree(dir))['AGENTS.md'];
  await writeFile(agents, wired.replace('Use pnpm.', 'Use pnpm 9.') + '\n## Added later\n\n- Keep changelogs.\n');

  const removed = cli(dir, 'init', '--remove', '--yes');
  assert.match(removed.stderr, /left: \.github\/workflows\/ctxcap\.yml \(not written by ctxcap init\)/);
  const files = await tree(dir);
  assert.equal(files['.github/workflows/ctxcap.yml'], workflow);
  assert.equal(files['AGENTS.md'], FIXTURE['AGENTS.md'].replace('Use pnpm.', 'Use pnpm 9.') + '\n## Added later\n\n- Keep changelogs.\n');
});
