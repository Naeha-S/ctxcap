import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { planInit, applySteps, doctor } from '../src/init.js';
import { VERSION } from '../src/version.js';
import { GROUPS } from '../src/wire.js';
import { cli, repo } from './helpers.js';

const EVERYTHING = GROUPS.join(',');

const statuses = (result) => Object.fromEntries(result.agents.map((entry) => [entry.agent, entry.status]));
// MCP is opt-in, so a default init leaves it not wired.
const ALL = (status, mcp = 'not wired') => ({ claude: status, cursor: status, codex: status, copilot: status, ci: status, badge: status, mcp });

test('doctor: nothing wired is fine, and a fresh init is wired everywhere', async () => {
  const dir = await repo({ 'AGENTS.md': '# Notes\n' });
  const bare = cli(dir, 'doctor', '--json');
  assert.equal(bare.status, 0);
  assert.deepEqual(statuses(JSON.parse(bare.stdout)), ALL('not wired'));
  assert.match(cli(dir, 'doctor').stdout, new RegExp(`wire it up: npx ctxcap@${VERSION.replace(/\./g, '\\.')} init`));

  cli(dir, 'init', '--yes');
  const wired = cli(dir, 'doctor', '--json');
  assert.equal(wired.status, 0);
  assert.deepEqual(statuses(JSON.parse(wired.stdout)), ALL('wired'));

  cli(dir, 'init', '--yes', '--agents', 'mcp');
  assert.deepEqual(statuses(JSON.parse(cli(dir, 'doctor', '--json').stdout)), ALL('wired', 'wired'));
});

test('doctor: a pin written by another version is stale, and init --yes brings it current', async () => {
  const dir = await repo({ 'AGENTS.md': '# Notes\n' });
  // What a repository looks like after ctxcap itself moved on a version.
  await applySteps(dir, await planInit({ root: dir, version: '1.2.0', groups: GROUPS }));

  const result = await doctor({ root: dir });
  assert.equal(result.ok, false);
  // The badge carries a count, not a pin, so it cannot go stale this way.
  assert.deepEqual(statuses(result), { ...ALL('stale pin', 'stale pin'), badge: 'wired' });
  for (const entry of result.agents) {
    assert.ok(entry.files.every((file) => file.state === 'stale' ? file.pin === '1.2.0' : file.state === 'wired'), entry.agent);
  }
  // The .gitignore carries no pin, so it is never stale.
  assert.equal(result.agents[0].files.find((file) => file.path === '.ctxcap/.gitignore').state, 'wired');

  const report = cli(dir, 'doctor');
  assert.equal(report.status, 1);
  assert.match(report.stdout, /^codex {4}stale pin: AGENTS\.md has 1\.2\.0, current is /m);
  assert.ok(report.stdout.includes(`fix: npx ctxcap@${VERSION} init --yes\n`));
  assert.equal((await doctor({ root: dir, version: '1.2.0' })).ok, true);

  // A plain init --yes updates the agents it covers; the opt-in one needs naming.
  assert.equal(cli(dir, 'init', '--yes').status, 0);
  assert.deepEqual(statuses(await doctor({ root: dir })), ALL('wired', 'stale pin'));
  assert.equal(cli(dir, 'init', '--yes', '--agents', 'mcp').status, 0);
  assert.equal(cli(dir, 'doctor').status, 0);
});

test('doctor: a missing or broken file makes its agent partially wired', async () => {
  const dir = await repo();
  cli(dir, 'init', '--yes', '--agents', EVERYTHING);
  await rm(path.join(dir, '.claude/skills/ctxcap/SKILL.md'));
  await writeFile(path.join(dir, '.cursor/mcp.json'), '{ not json');

  const result = cli(dir, 'doctor', '--json');
  assert.equal(result.status, 1);
  assert.deepEqual(statuses(JSON.parse(result.stdout)), { ...ALL('wired'), claude: 'partially wired', mcp: 'partially wired' });
  const text = cli(dir, 'doctor').stdout;
  assert.match(text, /^claude {3}partially wired: missing \.claude\/skills\/ctxcap\/SKILL\.md$/m);
  assert.match(text, /^mcp {6}partially wired: not valid JSON: \.cursor\/mcp\.json$/m);

  // A broken file of the user's is not ctxcap's problem where ctxcap was never wired.
  const other = await repo({ '.cursor/mcp.json': '{ not json' });
  cli(other, 'init', '--yes');
  assert.equal(cli(other, 'doctor').status, 0);
  assert.match(cli(other, 'doctor').stdout, /^mcp {6}not wired$/m);
});

test('doctor: unpinned and hand-written wiring both count as wired', async () => {
  const loose = await repo();
  cli(loose, 'init', '--yes', '--no-pin', '--agents', EVERYTHING);
  const result = await doctor({ root: loose, version: '9.9.9' });
  assert.deepEqual(statuses(result), ALL('wired', 'wired'));

  const custom = await repo({ '.github/workflows/ctxcap.yml': 'name: ctxcap\non: pull_request\njobs: {}\n' });
  const report = cli(custom, 'doctor');
  assert.equal(report.status, 0);
  assert.match(report.stdout, /^ci {7}wired: by \.github\/workflows\/ctxcap\.yml, not written by ctxcap init$/m);
});

test('doctor: this repository is wired by its own init, at the current version', async () => {
  const result = await doctor({ root: process.cwd() });
  assert.equal(result.ok, true, JSON.stringify(result.agents.filter((entry) => entry.status !== 'wired')));
  assert.deepEqual(statuses(result), ALL('wired'));
  assert.equal(cli(process.cwd(), 'doctor').status, 0);
  // init agrees with doctor: its own workflow runs the action from the checkout.
  const init = cli(process.cwd(), 'init');
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stderr, /^wired by user: \.github\/workflows\/ctxcap\.yml \(already runs ctxcap\)$/m);
  // And nothing is pending: what is committed is what this version of init writes.
  assert.doesNotMatch(init.stderr, /would (write|delete)/);
  assert.equal(init.stdout, '');
  // The committed badge shows the number the tool reports today.
  const badge = JSON.parse(await readFile('.ctxcap/badge.json', 'utf8'));
  assert.equal(badge.message, String(JSON.parse(cli(process.cwd(), '--json').stdout).total));
});
