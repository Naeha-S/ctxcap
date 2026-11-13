import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePlan, applyPlan, loadPlan, savePlan, verifyPlan } from '../src/plan.js';
import { countTokens } from '../src/tokenize.js';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ctxcap-plan-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'live.js'), '');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const text = [
    '# Never',
    'Always preserve this instruction.',
    '',
    '# Cleanup',
    `Use \`src/missing.js\` before committing. ${'Keep this guidance concise. '.repeat(12)}`,
    '',
    `Run \`npm run legacy\`. ${'Remove obsolete instructions. '.repeat(12)}`
  ].join('\n');
  await writeFile(path.join(root, 'AGENTS.md'), text);
  return { root, files: [{ path: 'AGENTS.md', text, tokens: countTokens(text) }] };
}

test('plan is deterministic, ranked, preserves load-bearing spans, and computes feasibility', async () => {
  const a = await fixture();
  const b = await fixture();
  const config = { ignore: [] };
  const first = await makePlan({ ...a, config, budget: 1, maxFindings: 1 });
  const second = await makePlan({ ...b, config, budget: 1, maxFindings: 1 });
  assert.equal(first.planId, second.planId);
  assert.equal(first.truncated, true);
  assert.equal(first.satisfiable, false);
  assert.ok(first.preserve.some((span) => span.startLine === 1));
  assert.ok(first.plan.every((finding) => finding.startLine > 2));
});

test('apply splices bottom-up and verify reports success', async () => {
  const fixtureData = await fixture();
  const plan = await makePlan({ ...fixtureData, config: { ignore: [] }, budget: 1 });
  const result = await applyPlan(plan, fixtureData.root);
  assert.ok(result.applied.length > 0);
  const verified = await verifyPlan(plan, fixtureData.root);
  assert.deepEqual(verified.missed, []);
  assert.equal(verified.violations.length, 0);
});

test('verify reports drift after an applied plan', async () => {
  const fixtureData = await fixture();
  const plan = await makePlan({ ...fixtureData, config: { ignore: [] }, budget: 1, apply: true });
  await writeFile(path.join(fixtureData.root, 'AGENTS.md'), 'manual drift\n');
  const verified = await verifyPlan(plan, fixtureData.root);
  assert.ok(verified.missed.length > 0);
  assert.equal(verified.satisfied, false);
});

test('plans persist under .ctxcap/plans and can be loaded by id', async () => {
  const fixtureData = await fixture();
  const plan = await makePlan({ ...fixtureData, config: { ignore: [] }, budget: 1 });
  await savePlan(fixtureData.root, plan);
  const loaded = await loadPlan(fixtureData.root, plan.planId);
  assert.equal(loaded.planId, plan.planId);
});
