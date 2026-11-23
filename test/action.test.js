import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

test('pull_request_target example isolates the PR checkout and passes its path to the action', async () => {
  const action = parseYaml(await readFile('action.yml', 'utf8'));
  const workflow = parseYaml(await readFile('examples/pull-request-target.yml', 'utf8'));
  const steps = workflow.jobs.ctxcap.steps;
  const checkout = steps.find((step) => step.uses === 'actions/checkout@v4');
  const ctxcap = steps.find((step) => step.uses === 'Naeha-S/ctxcap@v1');

  assert.equal(workflow.on, 'pull_request_target');
  assert.equal(checkout.with.path, 'pr');
  assert.equal(ctxcap.with.path, checkout.with.path);
  assert.equal(action.inputs.path.default, '.');
  assert.ok(action.runs.steps.some((step) => step['working-directory'] === '${{ inputs.path }}'));
});

test('composite action keeps fork permissions and merge-base fallbacks wired', async () => {
  const action = parseYaml(await readFile('action.yml', 'utf8'));
  const steps = action.runs.steps;
  const capability = steps.find((step) => step.name === 'Decide capabilities');
  const mergeBase = steps.find((step) => step.name === 'Resolve merge base');
  const measure = steps.find((step) => step.name === 'Measure');
  const upload = steps.find((step) => step.name === 'Upload SARIF to code scanning');
  const artifact = steps.find((step) => step.name === 'Upload report artifact (read-only fallback)');
  const comment = steps.find((step) => step.name === 'Sticky PR comment');

  assert.match(capability.run, /EVENT.*pull_request/);
  assert.match(capability.run, /IS_FORK.*true/);
  assert.match(capability.run, /can_write=false/);
  assert.match(mergeBase.run, /git merge-base HEAD/);
  assert.match(mergeBase.run, /BASE_SHA/);
  assert.match(measure.run, /--baseline "\$BASE"/);
  assert.match(upload.if, /can_write.*true/);
  assert.match(artifact.if, /can_write.*true/);
  assert.match(comment.if, /is_pr.*true/);
  assert.match(comment.if, /can_write.*true/);
});

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
