import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv from 'ajv';
import { badgeColor, badgeFor, BADGE_FILE } from '../src/badge.js';
import { CLI, cli, git, repo, tree } from './helpers.js';

const schema = JSON.parse(await readFile('schema/badge.schema.json', 'utf8'));
const valid = new Ajv({ allErrors: true }).compile(schema);
const total = (dir) => JSON.parse(cli(dir, '--json').stdout).total;
const WORDS = 'Keep answers short and cite the file you changed. ';

test('badge: colour bands change exactly at 500 and 2000', () => {
  assert.deepEqual([0, 499].map(badgeColor), ['green', 'green']);
  assert.deepEqual([500, 1999].map(badgeColor), ['yellow', 'yellow']);
  assert.deepEqual([2000, 250000].map(badgeColor), ['red', 'red']);
});

test('badge: the JSON is what the shields.io endpoint schema accepts', () => {
  assert.deepEqual(badgeFor(476), { schemaVersion: 1, label: 'context', message: '476', color: 'green' });
  for (const tokens of [0, 476, 500, 1999, 2000, 48213]) assert.ok(valid(badgeFor(tokens)), JSON.stringify(valid.errors));
  // The schema is strict the way shields is: no extra keys, message is a string.
  assert.equal(valid({ ...badgeFor(1), _ctxcap: {} }), false);
  assert.equal(valid({ ...badgeFor(1), message: 1 }), false);
  assert.equal(valid({ ...badgeFor(1), schemaVersion: 2 }), false);
});

test('badge: --badge writes the current total and says when git would ignore it', async () => {
  const dir = await repo({ 'AGENTS.md': WORDS.repeat(60) });
  const written = cli(dir, '--badge');
  assert.equal(written.status, 0);
  const badge = JSON.parse((await tree(dir))[BADGE_FILE]);
  assert.ok(valid(badge));
  assert.deepEqual(badge, badgeFor(total(dir)));
  assert.equal(badge.color, 'yellow');
  assert.doesNotMatch(written.stderr, /git ignores/);

  await writeFile(path.join(dir, '.gitignore'), '.ctxcap/\n');
  assert.match(cli(dir, '--badge').stderr, /git ignores \.ctxcap\/badge\.json/);
});

test('badge: init puts the badge under the README title, pointing at the raw file', async () => {
  const readme = '# Widgets\n\nA small library.\n';
  for (const remote of ['https://github.com/acme/widgets.git', 'git@github.com:acme/widgets.git', 'https://github.com/acme/widgets']) {
    const dir = await repo({ 'README.md': readme, 'AGENTS.md': WORDS.repeat(5) }, { remote });
    assert.equal(cli(dir, 'init', '--yes', '--agents', 'badge').status, 0);
    const files = await tree(dir);
    assert.deepEqual(Object.keys(files).sort(), ['.ctxcap/.gitignore', '.ctxcap/badge.json', '.ctxcap/badge.owned', 'AGENTS.md', 'README.md']);

    const lines = files['README.md'].split('\n');
    assert.deepEqual(lines.slice(0, 2), ['# Widgets', '']);
    assert.deepEqual([lines[2], lines[4]], ['<!-- ctxcap:begin -->', '<!-- ctxcap:end -->']);
    const url = /https:\/\/img\.shields\.io\/endpoint\?url=([^)]+)\)/.exec(lines[3])[1];
    assert.equal(decodeURIComponent(url), 'https://raw.githubusercontent.com/acme/widgets/HEAD/.ctxcap/badge.json');
    assert.equal(files['README.md'].replace(/<!-- ctxcap:begin -->[\s\S]*<!-- ctxcap:end -->\n\n/, ''), readme);

    // The file git must track, and nothing else in that directory.
    await writeFile(path.join(dir, '.ctxcap/stamp'), '');
    git(dir, 'add', '-A');
    assert.deepEqual(git(dir, 'ls-files', '.ctxcap').stdout.trim().split('\n').sort(), ['.ctxcap/.gitignore', '.ctxcap/badge.json', '.ctxcap/badge.owned']);

    cli(dir, 'init', '--remove', '--yes', '--agents', 'badge');
    assert.equal((await tree(dir))['README.md'], readme);
  }
});

test('badge: the count is the total after init has written everything else', async () => {
  const dir = await repo({ 'README.md': '# Widgets\n', 'AGENTS.md': WORDS.repeat(5) });
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'badge,codex').status, 0);
  assert.equal(JSON.parse((await tree(dir))[BADGE_FILE]).message, String(total(dir)));

  // Wiring more agents adds context files, and the badge follows.
  const more = cli(dir, 'init', '--yes');
  assert.match(more.stderr, /^wrote: \.ctxcap\/badge\.json$/m);
  assert.equal(JSON.parse((await tree(dir))[BADGE_FILE]).message, String(total(dir)));
  assert.match(cli(dir, 'init', '--yes').stderr, /^skipped: \.ctxcap\/badge\.json \(already configured\)$/m);

  // A config that counts other files is respected.
  const custom = await repo({ 'README.md': '# W\n', 'docs/prompt.md': WORDS.repeat(30), '.ctxcap.json': JSON.stringify({ include: ['docs/**'] }) });
  cli(custom, 'init', '--yes');
  assert.equal(JSON.parse((await tree(custom))[BADGE_FILE]).message, String(total(custom)));
});

test('badge: without a GitHub remote or a README, init leaves the badge out', async () => {
  const offline = await repo({ 'README.md': '# W\n' }, { remote: null });
  assert.equal(cli(offline, 'init', '--yes').status, 0);
  const files = await tree(offline);
  assert.ok(!(BADGE_FILE in files));
  assert.equal(files['README.md'], '# W\n');
  assert.match(cli(offline, 'doctor').stdout, /^badge {4}not wired$/m);

  const fromPackage = await repo({ 'README.md': '# W\n', 'package.json': JSON.stringify({ repository: { url: 'git+https://github.com/acme/from-package.git' } }) }, { remote: null });
  cli(fromPackage, 'init', '--yes', '--agents', 'badge');
  assert.ok((await tree(fromPackage))['README.md'].includes('raw.githubusercontent.com%2Facme%2Ffrom-package%2FHEAD'));

  const bare = await repo();
  cli(bare, 'init', '--yes', '--agents', 'badge');
  assert.deepEqual(Object.keys(await tree(bare)).sort(), ['.ctxcap/.gitignore', '.ctxcap/badge.json', '.ctxcap/badge.owned']);
});

test('badge: the Claude hook keeps a committed badge current', async () => {
  const dir = await repo({ 'README.md': '# W\n', 'AGENTS.md': WORDS.repeat(5) });
  cli(dir, 'init', '--yes', '--agents', 'badge,claude');
  await writeFile(path.join(dir, 'AGENTS.md'), WORDS.repeat(90));
  const hook = spawnSync('node', [CLI, 'hook', 'post-edit'], {
    cwd: dir, encoding: 'utf8', input: JSON.stringify({ tool_input: { file_path: 'AGENTS.md' } }), env: { ...process.env, CLAUDE_PROJECT_DIR: dir }
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.deepEqual(JSON.parse((await tree(dir))[BADGE_FILE]), badgeFor(total(dir)));
});

test('badge: the sentinel beside badge.json is what lets remove delete it', async () => {
  const readme = '# Widgets\n\nA small library.\n';
  const dir = await repo({ 'README.md': readme, 'AGENTS.md': WORDS.repeat(5) });
  const before = await tree(dir);
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'badge').status, 0);
  const wired = await tree(dir);
  assert.ok(BADGE_FILE in wired && '.ctxcap/badge.owned' in wired);
  // The badge itself stays exactly what shields.io accepts: no ownership key in it.
  assert.ok(valid(JSON.parse(wired[BADGE_FILE])));
  assert.match(wired['.ctxcap/.gitignore'], /^!badge\.owned$/m);

  // Rewriting the number, as the hook and --badge do, keeps the ownership.
  await writeFile(path.join(dir, 'AGENTS.md'), WORDS.repeat(80));
  assert.equal(cli(dir, '--badge').status, 0);
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'badge').status, 0);
  await writeFile(path.join(dir, 'AGENTS.md'), before['AGENTS.md']);

  const removed = cli(dir, 'init', '--remove', '--yes');
  assert.equal(removed.status, 0);
  for (const file of [BADGE_FILE, '.ctxcap/badge.owned', 'README.md']) assert.match(removed.stderr, new RegExp(`^(deleted|wrote): ${file.replace(/[.]/g, '\\.')}$`, 'm'));
  assert.deepEqual(await tree(dir), before);
});

test('badge: a badge.json that init did not write is left alone until --force adopts it', async () => {
  const dir = await repo({ 'README.md': '# Widgets\n', 'AGENTS.md': WORDS.repeat(5) });
  // Written by hand with the CLI: no sentinel, so not init's to delete.
  assert.equal(cli(dir, '--badge').status, 0);
  const own = (await tree(dir))[BADGE_FILE];

  const blocked = cli(dir, 'init', '--yes', '--agents', 'badge');
  assert.equal(blocked.status, 3);
  assert.match(blocked.stderr, /^skipped: \.ctxcap\/badge\.json \(not written by ctxcap init; --force overwrites it\)$/m);
  assert.ok(!('.ctxcap/badge.owned' in await tree(dir)));
  assert.match(cli(dir, 'doctor').stdout, /^badge {4}wired: by \.ctxcap\/badge\.json, not written by ctxcap init$/m);

  const removed = cli(dir, 'init', '--remove', '--yes');
  assert.match(removed.stderr, /^left: \.ctxcap\/badge\.json \(not written by ctxcap init\)$/m);
  assert.equal((await tree(dir))[BADGE_FILE], own);
  assert.ok(!(await tree(dir))['README.md'].includes('ctxcap:begin'));

  assert.equal(cli(dir, 'init', '--yes', '--agents', 'badge', '--force').status, 0);
  assert.ok('.ctxcap/badge.owned' in await tree(dir));
  cli(dir, 'init', '--remove', '--yes');
  assert.deepEqual(Object.keys(await tree(dir)).sort(), ['AGENTS.md', 'README.md']);

  // A sentinel left behind without its file goes too.
  const orphan = await repo({ '.ctxcap/badge.owned': 'x\n', 'README.md': '# W\n' });
  assert.match(cli(orphan, 'init', '--remove', '--yes').stderr, /^deleted: \.ctxcap\/badge\.owned$/m);
  assert.deepEqual(Object.keys(await tree(orphan)), ['README.md']);
});
