import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function fixtureFromDirectory(name) {
  const source = path.join(process.cwd(), 'test', 'fixtures', name);
  const root = await mkdtemp(path.join(tmpdir(), `ctxcap-${name}-`));
  const text = await readFile(path.join(source, 'AGENTS.md'), 'utf8');
  await writeFile(path.join(root, 'AGENTS.md'), text);
  if (name === 'overlapping-findings') {
    await writeFile(path.join(root, 'CLAUDE.md'), await readFile(path.join(source, 'CLAUDE.md'), 'utf8'));
  }
  if (name === 'load-bearing-duplicate') {
    await writeFile(path.join(root, 'CLAUDE.md'), await readFile(path.join(source, 'CLAUDE.md'), 'utf8'));
  }
  const files = [];
  for (const file of ['AGENTS.md', ...(['overlapping-findings', 'load-bearing-duplicate'].includes(name) ? ['CLAUDE.md'] : [])]) {
    const fileText = await readFile(path.join(root, file), 'utf8');
    files.push({ path: file, text: fileText, tokens: countTokens(fileText) });
  }
  return { root, files };
}

test('condense accounting uses net tokens and makes inflated budgets unsatisfiable', async () => {
  const data = await fixtureFromDirectory('condense-savings-accounting');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 4 });
  const finding = plan.plan.find((entry) => entry.action === 'condense');
  assert.ok(finding);
  const fullSpanTokens = countTokens(plan._internal.sources[finding.id]);
  assert.equal(finding.replacementTokens, countTokens(finding.condensedText));
  assert.equal(finding.tokensFreed, fullSpanTokens - finding.replacementTokens);

  await applyPlan(plan, data.root);
  const after = countTokens(await readFile(path.join(data.root, 'AGENTS.md'), 'utf8'));
  assert.equal(plan.minAchievable, after);

  const inflatedMinimum = data.files[0].tokens - fullSpanTokens;
  const between = Math.floor((inflatedMinimum + after) / 2);
  const constrained = await makePlan({ ...data, config: { ignore: [] }, budget: between });
  assert.equal(constrained.satisfiable, false);
});

test('overlapping findings count only the highest-confidence action', async () => {
  const data = await fixtureFromDirectory('overlapping-findings');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 0 });
  assert.equal(plan.plan.filter((entry) => entry.file === 'AGENTS.md').length, 1);
  await applyPlan(plan, data.root);
  const after = countTokens(await readFile(path.join(data.root, 'AGENTS.md'), 'utf8'))
    + countTokens(await readFile(path.join(data.root, 'CLAUDE.md'), 'utf8'));
  assert.equal(plan.minAchievable, after);
});

test('verify checks all finding source text after bottom-up multi-finding apply', async () => {
  const data = await fixtureFromDirectory('offset-aware-verification');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 4 });
  assert.equal(plan.plan.length, 3);
  const result = await applyPlan(plan, data.root);
  assert.equal(result.missed.length, 0);
  const verified = await verifyPlan(plan, data.root);
  assert.deepEqual(verified.missed, []);
  assert.equal(verified.satisfied, true);
});

test('verify reports a re-added source line as missed', async () => {
  const data = await fixtureFromDirectory('offset-aware-verification');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 0 });
  await applyPlan(plan, data.root);
  const first = plan.plan[0];
  await writeFile(path.join(data.root, 'AGENTS.md'), plan._internal.sources[first.id] + '\n');
  const verified = await verifyPlan(plan, data.root);
  assert.ok(verified.missed.includes(first.id));
  assert.equal(verified.satisfied, false);
});

test('load-bearing large paragraphs can be condensed unless strict preserve is enabled', async () => {
  const data = await fixtureFromDirectory('load-bearing-condense');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.ok(plan.plan.some((finding) => finding.action === 'condense' && finding.loadBearing));
  const strict = await makePlan({ ...data, config: { ignore: [] }, budget: 1, strictPreserve: true });
  assert.equal(strict.plan.length, 0);
});

test('load-bearing duplicate keeps the earlier canonical span', async () => {
  const data = await fixtureFromDirectory('load-bearing-duplicate');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  const duplicate = plan.plan.find((finding) => finding.action === 'deleteKeepingCanonical');
  assert.ok(duplicate);
  assert.equal(duplicate.canonical, 'AGENTS.md:3:3');
  assert.match(duplicate.rationale, /AGENTS\.md:3:3/);
  await applyPlan(plan, data.root);
  const verified = await verifyPlan(plan, data.root);
  assert.deepEqual(verified.violations, []);
});
