import test from 'node:test';
import assert from 'node:assert';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const CLI = path.resolve('src/index.js');

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'tl-'));
  await mkdir(path.join(dir, 'prompts'));
  await writeFile(path.join(dir, 'prompts/a.md'), 'hello world '.repeat(50));
  return dir;
}

test('json output, exit 0 by default', async () => {
  const dir = await fixture();
  const r = spawnSync('node', [CLI, '--json', '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.schema, 'ctxcap/v1');
  assert.equal(rep.files.length, 1);
});

test('baseline then growth fails under --fail-on increase', async () => {
  const dir = await fixture();
  spawnSync('node', [CLI, '--update-baseline', '--root', dir]);
  await writeFile(path.join(dir, 'prompts/a.md'), 'hello world '.repeat(200));
  const r = spawnSync('node', [CLI, '--json', '--fail-on', 'increase', '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.ok(JSON.parse(r.stdout).delta > 0);
});

test('bad flag exits 2', () => {
  const r = spawnSync('node', [CLI, '--nope'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('plan and verify use the saved plan contract', async () => {
  const dir = await fixture();
  const plan = spawnSync('node', [CLI, '--plan', '--budget', '1', '--root', dir], { encoding: 'utf8' });
  assert.equal(plan.status, 0);
  const payload = JSON.parse(plan.stdout);
  assert.equal(payload.schema, 'ctxcap/plan/v2');
  const verify = spawnSync('node', [CLI, '--verify', payload.planId, '--root', dir], { encoding: 'utf8' });
  assert.equal(verify.status, 1);
  assert.equal(JSON.parse(verify.stdout).satisfied, false);
});

function git(dir, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

test('growth against a git ref passes only when the change also commits the baseline', async () => {
  const dir = await fixture();
  git(dir, 'init', '-q');
  spawnSync('node', [CLI, '--update-baseline', '--root', dir]);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  await writeFile(path.join(dir, 'prompts/a.md'), 'hello world '.repeat(200));
  const run = () => spawnSync('node', [CLI, '--json', '--fail-on', 'increase', '--baseline', 'HEAD', '--root', dir], { encoding: 'utf8' });

  const grown = run();
  assert.equal(grown.status, 1);
  assert.equal(JSON.parse(grown.stdout).acknowledged, false);

  spawnSync('node', [CLI, '--update-baseline', '--root', dir]);
  const accepted = run();
  assert.equal(accepted.status, 0);
  const report = JSON.parse(accepted.stdout);
  assert.ok(report.delta > 0);
  assert.equal(report.acknowledged, true);
});

test('the first run against a ref with no baseline passes once a baseline is committed alongside', async () => {
  const dir = await fixture();
  git(dir, 'init', '-q');
  git(dir, 'commit', '-qm', 'empty', '--allow-empty');
  const run = () => spawnSync('node', [CLI, '--json', '--fail-on', 'increase', '--baseline', 'HEAD', '--root', dir], { encoding: 'utf8' });
  assert.equal(run().status, 1);
  spawnSync('node', [CLI, '--update-baseline', '--root', dir]);
  assert.equal(run().status, 0);
});

test('--stale-fix leaves a block that holds a rule out of the deletion diff', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tl-'));
  await mkdir(path.join(dir, 'src'));
  await writeFile(path.join(dir, 'AGENTS.md'), [
    '# Helpers',
    '',
    '- Shared code lives in `src/old.js`; agents must never commit secrets there.',
    '- Fixtures live in `src/fixtures.js`.',
    ''
  ].join('\n'));
  const r = spawnSync('node', [CLI, '--stale-fix', '--json', '--root', dir], { encoding: 'utf8' });
  const report = JSON.parse(r.stdout);
  assert.deepEqual(report.findings.map((finding) => finding.ref), ['src/old.js', 'src/fixtures.js']);
  assert.match(report.staleDiff, /src\/fixtures\.js/);
  assert.doesNotMatch(report.staleDiff, /never commit secrets/);
});
