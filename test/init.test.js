import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { unifiedDiff } from '../src/diff.js';
import { planInit, applySteps, renderDiff } from '../src/init.js';
import { MANAGED_MD } from '../src/wire.js';
import { cli, git, repo, tree, treeHash } from './helpers.js';

// One target of each kind, so the engine is tested apart from any agent.
const sample = ({ version }) => [
  { groups: ['claude'], path: 'tool/owned.md', kind: 'file', marker: MANAGED_MD, content: `${MANAGED_MD}\nrun npx ctxcap@${version}\n` },
  { groups: ['codex'], path: 'NOTES.md', kind: 'block', place: 'append', lines: [`npx ctxcap@${version} --json`, 'Run it before editing.'] },
  {
    groups: ['cursor'], path: 'conf.json', kind: 'json',
    present: (doc) => Boolean(doc.servers && Object.hasOwn(doc.servers, 'ctxcap')),
    add: (doc) => { doc.servers ??= {}; doc.servers.ctxcap = { command: 'npx', args: [`ctxcap@${version}`] }; },
    strip: (doc) => { delete doc.servers.ctxcap; if (Object.keys(doc.servers).length === 0) delete doc.servers; }
  }
];
const run = (root, options = {}) => planInit({ root, version: '1.0.0', ...options, targets: sample({ version: options.version ?? '1.0.0' }) });

const NOTES = '# Notes\n\n## Never\n\n- Never commit secrets.\n';
const CONF = JSON.stringify({ editor: { tabSize: 2 }, servers: { other: { command: 'x' } } }, null, 2) + '\n';

test('unified diffs apply with git for new, changed, shortened, and deleted files', async () => {
  const cases = {
    'new.md': [null, 'one\ntwo\n'],
    'changed.md': ['a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n', 'a\nB\nc\nd\ne\nf\ng\nh\ni\nj\nk\n'],
    'noeol.md': ['first\nlast', 'first\nlast\nadded'],
    'gains-eol.md': ['only', 'only\n'],
    'gone.md': ['bye\nnow\n', null]
  };
  const dir = await repo(Object.fromEntries(Object.entries(cases).filter(([, [before]]) => before !== null).map(([file, [before]]) => [file, before])));
  const patch = Object.entries(cases).map(([file, [before, after]]) => unifiedDiff(file, before, after)).join('');
  await writeFile(path.join(dir, 'p.patch'), patch);
  const applied = git(dir, 'apply', 'p.patch');
  assert.equal(applied.status, 0, applied.stderr);
  const files = await tree(dir);
  for (const [file, [, after]] of Object.entries(cases)) assert.equal(files[file] ?? null, after, file);
  assert.equal(unifiedDiff('same.md', 'x\n', 'x\n'), '');
});

test('planning writes nothing, applying writes every target, a second run is a no-op', async () => {
  const dir = await repo({ 'NOTES.md': NOTES, 'conf.json': CONF });
  const before = await treeHash(dir);

  const steps = await run(dir);
  assert.deepEqual(steps.map((step) => step.action), ['write', 'write', 'write']);
  assert.equal(await treeHash(dir), before);

  await applySteps(dir, steps);
  const files = await tree(dir);
  assert.ok(files['tool/owned.md'].includes('npx ctxcap@1.0.0'));
  assert.ok(files['NOTES.md'].startsWith(NOTES));
  assert.deepEqual(Object.keys(JSON.parse(files['conf.json'])), ['editor', 'servers', '_ctxcap']);
  assert.deepEqual(JSON.parse(files['conf.json'])._ctxcap, { version: '1.0.0' });
  assert.deepEqual(Object.keys(JSON.parse(files['conf.json']).servers), ['other', 'ctxcap']);

  const wired = await treeHash(dir);
  const again = await run(dir);
  assert.deepEqual(again.map((step) => [step.action, step.reason]), Array(3).fill(['skip', 'already configured']));
  await applySteps(dir, again);
  assert.equal(await treeHash(dir), wired);
});

test('the printed diff is exactly what gets written', async () => {
  const dir = await repo({ 'NOTES.md': NOTES, 'conf.json': CONF });
  const twin = await repo({ 'NOTES.md': NOTES, 'conf.json': CONF });
  await writeFile(path.join(twin, 'p.patch'), renderDiff(await run(twin)));
  const applied = git(twin, 'apply', 'p.patch');
  assert.equal(applied.status, 0, applied.stderr);
  await applySteps(dir, await run(dir));
  const patched = await tree(twin);
  delete patched['p.patch'];
  assert.deepEqual(patched, await tree(dir));
});

test('--yes brings what init wrote up to date without --force, and is a no-op when current', async () => {
  const dir = await repo({ 'NOTES.md': NOTES + '\nTrailing section.\n', 'conf.json': CONF });
  await applySteps(dir, await run(dir));
  for (const force of [false, true]) {
    const same = await run(dir, { force });
    assert.deepEqual(same.map((step) => [step.action, step.reason, step.blocked]), Array(3).fill(['skip', 'already configured', undefined]));
  }

  await writeFile(path.join(dir, 'NOTES.md'), (await readFile(path.join(dir, 'NOTES.md'), 'utf8')) + '\nAdded by the user afterwards.\n');
  const upgrade = await run(dir, { version: '2.0.0' });
  assert.deepEqual(upgrade.map((step) => step.action), ['write', 'write', 'write']);
  await applySteps(dir, upgrade);
  const files = await tree(dir);
  assert.ok(files['tool/owned.md'].includes('ctxcap@2.0.0'));
  assert.ok(files['NOTES.md'].includes('ctxcap@2.0.0') && !files['NOTES.md'].includes('ctxcap@1.0.0'));
  assert.ok(files['NOTES.md'].endsWith('\nAdded by the user afterwards.\n'));
  assert.equal(JSON.parse(files['conf.json'])._ctxcap.version, '2.0.0');
  assert.deepEqual(Object.keys(JSON.parse(files['conf.json']).servers), ['other', 'ctxcap']);
});

test('remove restores every byte, whatever the line endings and indentation', async () => {
  const variants = {
    'trailing newline': { 'NOTES.md': NOTES, 'conf.json': CONF },
    'no trailing newline': { 'NOTES.md': NOTES.trimEnd(), 'conf.json': CONF.trimEnd() },
    'CRLF': { 'NOTES.md': NOTES.replace(/\n/g, '\r\n'), 'conf.json': CONF.replace(/\n/g, '\r\n') },
    'tab indent': { 'NOTES.md': NOTES, 'conf.json': JSON.stringify(JSON.parse(CONF), null, '\t') + '\n' },
    'four spaces': { 'NOTES.md': NOTES, 'conf.json': JSON.stringify(JSON.parse(CONF), null, 4) + '\n' },
    'nothing there': {}
  };
  for (const [name, files] of Object.entries(variants)) {
    const dir = await repo(files);
    const before = await treeHash(dir);
    await applySteps(dir, await run(dir));
    assert.notEqual(await treeHash(dir), before, name);
    if (name === 'CRLF') assert.ok(!/[^\r]\n/.test((await tree(dir))['NOTES.md']), 'block uses the file line ending');
    await applySteps(dir, await run(dir, { remove: true }));
    assert.equal(await treeHash(dir), before, name);
    assert.equal(git(dir, 'status', '--porcelain').stdout, '', name);
  }
});

test('targets without a ctxcap marker are left alone unless --force is given', async () => {
  const custom = { 'tool/owned.md': 'written by hand\n', 'conf.json': JSON.stringify({ servers: { ctxcap: { command: 'mine' }, other: { command: 'x' } } }, null, 2) + '\n' };
  const dir = await repo({ ...custom, 'bad.json': '{ nope' });
  const steps = await run(dir);
  assert.deepEqual(steps.map((step) => [step.action, Boolean(step.blocked)]), [['skip', true], ['write', false], ['skip', true]]);
  assert.ok(steps.filter((step) => step.blocked).every((step) => step.reason === 'not written by ctxcap init; --force overwrites it'));
  await applySteps(dir, steps);
  await applySteps(dir, await run(dir, { remove: true }));
  const files = await tree(dir);
  assert.equal(files['tool/owned.md'], custom['tool/owned.md']);
  assert.equal(files['conf.json'], custom['conf.json']);

  // --force overwrites them: the whole file, and in JSON only the entry that is ours by name.
  const forced = await run(dir, { force: true });
  assert.deepEqual(forced.map((step) => step.action), ['write', 'write', 'write']);
  await applySteps(dir, forced);
  const after = await tree(dir);
  assert.ok(after['tool/owned.md'].includes(MANAGED_MD));
  const conf = JSON.parse(after['conf.json']);
  assert.deepEqual(conf.servers, { other: { command: 'x' }, ctxcap: { command: 'npx', args: ['ctxcap@1.0.0'] } });
  assert.deepEqual(conf._ctxcap, { version: '1.0.0' });
  // Once overwritten they are ours, and remove takes them out again.
  await applySteps(dir, await run(dir, { remove: true }));
  assert.deepEqual(JSON.parse((await tree(dir))['conf.json']), { servers: { other: { command: 'x' } } });

  // A file that does not parse is never rewritten, with or without --force.
  for (const force of [false, true]) {
    const broken = await planInit({ root: dir, force, targets: [{ groups: ['cursor'], path: 'bad.json', kind: 'json', present: () => false, add: () => {}, strip: () => {} }] });
    assert.deepEqual(broken.map((step) => [step.action, step.reason, step.blocked]), [['skip', 'not valid JSON, left alone', true]]);
  }
});

test('init --print and a plain init write nothing; bad usage exits 2', async () => {
  const dir = await repo({ 'AGENTS.md': NOTES });
  const before = await treeHash(dir);
  const printed = cli(dir, 'init', '--print');
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(await treeHash(dir), before);
  cli(dir, 'init');
  assert.equal(await treeHash(dir), before);
  assert.equal(cli(dir, 'init', '--agents', 'claude,emacs').status, 2);
  assert.equal(cli(dir, 'init', '--bogus').status, 2);
  assert.equal(cli(dir, 'init', '--help').status, 0);
});
