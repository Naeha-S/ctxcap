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
  assert.equal(rep.schema, 'ctxlint/v1');
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
