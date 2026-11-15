import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cli, git, repo, tree, treeHash } from './helpers.js';

const ignored = (dir, file) => git(dir, 'check-ignore', '-q', file).status === 0;
const FILES = { 'README.md': '# Widgets\n', 'AGENTS.md': '# Notes\n\nUse pnpm.\n' };
const BLOCK = (line, eol = '\n') => ['# ctxcap:begin', `# ctxcap:was ${line}`, '.ctxcap/plans/', '.ctxcap/*.stamp', '# ctxcap:end'].join(eol);

test('gitignore: a .ctxcap/ rule is narrowed so the badge can be committed, and remove puts it back', async () => {
  const original = 'node_modules/\n.ctxcap/\n*.log\n';
  const dir = await repo({ ...FILES, '.gitignore': original });
  const before = await treeHash(dir);
  assert.ok(ignored(dir, '.ctxcap/badge.json'), 'the fixture hides the whole directory');

  // The dry run shows the change and does not warn about what it is about to fix.
  const preview = cli(dir, 'init');
  assert.match(preview.stdout, /^-\.ctxcap\/$/m);
  assert.match(preview.stdout, /^\+\.ctxcap\/plans\/$/m);
  assert.doesNotMatch(preview.stderr, /warning:/);
  assert.equal(await treeHash(dir), before);

  const result = cli(dir, 'init', '--yes');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /^wrote: \.gitignore$/m);
  assert.doesNotMatch(result.stderr, /warning:/);
  const files = await tree(dir);
  assert.equal(files['.gitignore'], `node_modules/\n${BLOCK('.ctxcap/')}\n*.log\n`);

  // The badge and the inner .gitignore are trackable; plans and the stamp are not.
  await mkdir(path.join(dir, '.ctxcap/plans'), { recursive: true });
  await writeFile(path.join(dir, '.ctxcap/plans/abc123.json'), '{}');
  await writeFile(path.join(dir, '.ctxcap/post-edit.stamp'), '');
  assert.ok(!ignored(dir, '.ctxcap/badge.json') && !ignored(dir, '.ctxcap/badge.owned') && !ignored(dir, '.ctxcap/.gitignore'));
  assert.ok(ignored(dir, '.ctxcap/plans/abc123.json') && ignored(dir, '.ctxcap/post-edit.stamp'));
  assert.ok(ignored(dir, 'node_modules/x.js') && ignored(dir, 'debug.log'));
  git(dir, 'add', '-A');
  assert.deepEqual(git(dir, 'ls-files', '.ctxcap').stdout.trim().split('\n').sort(), ['.ctxcap/.gitignore', '.ctxcap/badge.json', '.ctxcap/badge.owned']);
  git(dir, 'reset', '-q');

  assert.equal(cli(dir, 'doctor').status, 0);
  assert.match(cli(dir, 'init', '--yes').stderr, /^skipped: \.gitignore \(already configured\)$/m);

  const removed = cli(dir, 'init', '--remove', '--yes');
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal((await tree(dir))['.gitignore'], original);
  // Plans are the user's working files, not init's: clear them before comparing.
  assert.deepEqual(Object.keys(await tree(dir)).filter((file) => file.startsWith('.ctxcap/')), ['.ctxcap/plans/abc123.json']);
  assert.equal(git(dir, 'status', '--porcelain').stdout, '');
});

test('gitignore: the original line comes back byte for byte, whatever its spelling', async () => {
  const variants = {
    'in the middle': 'dist/\n.ctxcap/\ncoverage/\n',
    'last line, no newline': 'dist/\n.ctxcap/',
    'only line': '.ctxcap\n',
    'anchored': '/.ctxcap/\n',
    'contents glob': '.ctxcap/*\n',
    'trailing spaces': 'dist/\n.ctxcap/  \n',
    'CRLF': 'dist/\r\n.ctxcap/\r\ncoverage/\r\n',
    'twice': '.ctxcap/\n# local\n/.ctxcap\n',
    'beside a comment that mentions it': '# .ctxcap/ holds plans\n.ctxcap/\n'
  };
  for (const [name, original] of Object.entries(variants)) {
    const dir = await repo({ ...FILES, '.gitignore': original });
    const before = await treeHash(dir);
    assert.equal(cli(dir, 'init', '--yes').status, 0, name);
    const wired = (await tree(dir))['.gitignore'];
    assert.notEqual(wired, original, name);
    assert.ok(!ignored(dir, '.ctxcap/badge.json'), name);
    assert.ok(ignored(dir, '.ctxcap/plans/x.json'), name);
    if (name === 'CRLF') assert.equal(wired, `dist/\r\n${BLOCK('.ctxcap/', '\r\n')}\r\ncoverage/\r\n`);
    if (name === 'last line, no newline') assert.equal(wired, `dist/\n${BLOCK('.ctxcap/')}`);
    if (name === 'twice') assert.equal(wired.match(/^# ctxcap:begin$/gm).length, 2);

    assert.equal(cli(dir, 'init', '--remove', '--yes').status, 0, name);
    assert.equal((await tree(dir))['.gitignore'], original, name);
    assert.equal(await treeHash(dir), before, name);
    assert.equal(git(dir, 'status', '--porcelain', '--ignored').stdout, '', name);
  }
});

test('gitignore: left alone when it does not hide .ctxcap/, and never created', async () => {
  for (const original of ['node_modules/\n', '.ctxcap/plans/\n', '!.ctxcap/\n', '# .ctxcap/\n', 'docs/.ctxcap/x\n']) {
    const dir = await repo({ ...FILES, '.gitignore': original });
    const result = cli(dir, 'init', '--yes');
    assert.equal(result.status, 0);
    assert.doesNotMatch(result.stderr, /: \.gitignore/);
    assert.equal((await tree(dir))['.gitignore'], original);
  }
  const none = await repo(FILES);
  cli(none, 'init', '--yes');
  assert.ok(!('.gitignore' in await tree(none)));
  // Only the agents that keep files in .ctxcap/ need the rule changed.
  const codex = await repo({ ...FILES, '.gitignore': '.ctxcap/\n' });
  cli(codex, 'init', '--yes', '--agents', 'codex,cursor');
  assert.equal((await tree(codex))['.gitignore'], '.ctxcap/\n');
});

test('gitignore: doctor notices when the rule comes back, and init --yes narrows it again', async () => {
  const dir = await repo({ ...FILES, '.gitignore': 'dist/\n' });
  cli(dir, 'init', '--yes');
  await writeFile(path.join(dir, '.gitignore'), 'dist/\n.ctxcap/\n');
  const report = cli(dir, 'doctor');
  assert.equal(report.status, 1);
  assert.match(report.stdout, /^badge {4}partially wired: \.gitignore still ignores \.ctxcap\/$/m);
  assert.equal(cli(dir, 'init', '--yes').status, 0);
  assert.equal(cli(dir, 'doctor').status, 0);
  assert.ok(!ignored(dir, '.ctxcap/badge.json'));

  // Removing one of the two agents that need it keeps the narrowed rule for the other.
  cli(dir, 'init', '--remove', '--yes', '--agents', 'badge');
  assert.match((await tree(dir))['.gitignore'], /^# ctxcap:begin$/m);
  cli(dir, 'init', '--remove', '--yes');
  assert.equal((await tree(dir))['.gitignore'], 'dist/\n.ctxcap/\n');
});
