import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('GitHub Action metadata and annotation script are wired', async () => {
  const action = await readFile('action.yml', 'utf8');
  assert.match(action, /runs:\s*$/m);
  assert.match(action, /src\/index\.js/);
  assert.match(action, /scripts\/annotate\.mjs/);
  assert.match(action, /scripts\/comment\.mjs/);

  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-action-'));
  const report = path.join(dir, 'report.json');
  await writeFile(report, JSON.stringify({
    approximate: true,
    total: 250,
    totalBudget: 200,
    delta: 10,
    files: [{ path: 'prompts/a.md', tokens: 250, delta: 10, budget: 100 }]
  }));
  const result = spawnSync(process.execPath, ['scripts/annotate.mjs'], {
    encoding: 'utf8',
    env: { ...process.env, REPORT_PATH: report }
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /::warning file=prompts\/a\.md/);
  assert.match(result.stdout, /exceeds budget 200/);
});
