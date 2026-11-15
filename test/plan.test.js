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

test('condense replacements end at a safe sentence or clause boundary', async () => {
  const data = await fixtureFromDirectory('survivable-condense');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1, maxCondenseChars: 320 });
  const finding = plan.plan.find((entry) => entry.action === 'condense');
  assert.ok(finding);
  assert.ok(finding.condensedText.length <= 320);
  assert.equal((finding.condensedText.match(/`/g) ?? []).length % 2, 0);
  assert.match(finding.condensedText, /[.!?;]$/);
});

test('findings expose explicit scores and sort by score', async () => {
  const data = await fixture();
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.ok(plan.plan.every((finding) => typeof finding.score === 'number'));
  for (let i = 1; i < plan.plan.length; i++) assert.ok(plan.plan[i - 1].score >= plan.plan[i].score);
});

test('default finding floor includes a small reclaimable paragraph', async () => {
  const data = await fixtureFromDirectory('minimum-finding-floor');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.ok(plan.plan.some((finding) => finding.tokensFreed >= 20));
});

test('preserve classification ignores mid-sentence keywords and honors lists and markers', async () => {
  const data = await fixtureFromDirectory('preserve-classification');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.equal(plan.preserve.some((span) => span.startLine === 1), false);
  assert.ok(plan.preserve.some((span) => span.startLine === 3));
  assert.ok(plan.preserve.some((span) => span.startLine === 7));
});

test('apply prepares all files before renaming any file', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ctxcap-atomic-'));
  const first = 'Remove this first file paragraph.\n';
  await writeFile(path.join(root, 'first.md'), first);
  const plan = {
    planId: 'atomic',
    plan: [
      { id: 'first', file: 'first.md', startLine: 1, endLine: 1, action: 'delete' },
      { id: 'second', file: 'missing.md', startLine: 1, endLine: 1, action: 'delete' }
    ],
    _internal: { postHashes: {} }
  };
  const result = await applyPlan(plan, root);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.missed.sort(), ['first', 'second']);
  assert.equal(await readFile(path.join(root, 'first.md'), 'utf8'), first);
});

test('planId changes when condensed replacement text changes', async () => {
  const data = await fixtureFromDirectory('survivable-condense');
  const short = await makePlan({ ...data, config: { ignore: [] }, budget: 1, maxCondenseChars: 200 });
  const long = await makePlan({ ...data, config: { ignore: [] }, budget: 1, maxCondenseChars: 320 });
  assert.notEqual(short.planId, long.planId);
});

async function inlineFixture(text) {
  const root = await mkdtemp(path.join(tmpdir(), 'ctxcap-inline-'));
  await writeFile(path.join(root, 'AGENTS.md'), text);
  return { root, files: [{ path: 'AGENTS.md', text, tokens: countTokens(text) }] };
}

const FILLER = 'The deploy pipeline builds the image, runs the unit suite, and waits for the smoke checks before promoting. ';

test('condense keeps a rule that sits mid-paragraph and verify accepts the result', async () => {
  const rule = 'Whatever happens, NEVER run the migration job against production without a snapshot.';
  const data = await inlineFixture(`# Deploy\n\n${FILLER}${'Each stage reports its own status to the channel. '.repeat(40)}${rule}\n`);
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 100, apply: true });
  const finding = plan.plan.find((entry) => entry.action === 'condense');
  assert.ok(finding);
  assert.equal(finding.loadBearing, true);
  assert.ok(finding.condensedText.endsWith(rule));
  assert.equal(plan.satisfiable, true);
  assert.match(await readFile(path.join(data.root, 'AGENTS.md'), 'utf8'), /NEVER run the migration job/);
  const verified = await verifyPlan(plan, data.root);
  assert.deepEqual(verified.violations, []);
  assert.equal(verified.satisfied, true);
});

test('verify reports a violation when a hand trim drops a rule sentence', async () => {
  const rule = 'Agents must never force-push to the release branch.';
  const data = await inlineFixture(`# Deploy\n\n${FILLER}${'Each stage reports its own status to the channel. '.repeat(40)}${rule}\n`);
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 100 });
  assert.ok(plan.plan[0].condensedText.includes(rule));
  await writeFile(path.join(data.root, 'AGENTS.md'), `# Deploy\n\n${FILLER.trim()}\n`);
  const verified = await verifyPlan(plan, data.root);
  assert.deepEqual(verified.violations.map((violation) => violation.text), [rule]);
  assert.equal(verified.satisfied, false);
});

test('condense is skipped when it would have to cut mid-sentence', async () => {
  const data = await inlineFixture(`# Notes\n\n${'this clause keeps going without ever reaching a full stop, '.repeat(60)}\n`);
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.deepEqual(plan.plan, []);
});

test('a stale block is not deleted when it carries a rule mid-paragraph', async () => {
  const data = await inlineFixture('# Helpers\n\nUse `src/old-helpers.js` for shared utilities when writing new modules in this repository. Whatever the task, NEVER commit credentials or tokens to this repository.\n');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.deepEqual(plan.plan, []);
  assert.ok(plan.preserve.some((span) => span.startLine === 3));
});

test('a heading directly above its body ends the previous preserve section', async () => {
  const data = await inlineFixture('# Never\nPush to main.\n\n# Cleanup\nGeneral housekeeping notes live here.\n');
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.deepEqual(plan.preserve.map((span) => span.startLine), [1]);
});

test('a stale block is not deleted when it carries a lowercase mid-sentence rule', async () => {
  const data = await inlineFixture('# Helpers\n\nUse `src/old-helpers.js` for shared utilities when writing new modules in this repository, and agents must never commit credentials here.\n');
  await mkdir(path.join(data.root, 'src'));
  for (const strictPreserve of [false, true]) {
    const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1, strictPreserve });
    assert.deepEqual(plan.plan, []);
  }
});

test('a stale reference removes only its own list item, once', async () => {
  const text = [
    '# Layout',
    '',
    '- Helpers live in `src/gone-one.js` and `src/gone-two.js`, which every new module in this repository should import first.',
    '  They are shared across all packages in the workspace.',
    '- Tests live next to the code they cover.',
    '- Generated output is written to the build directory.',
    '',
    'Closing paragraph.'
  ].join('\n');
  const data = await inlineFixture(text);
  await mkdir(path.join(data.root, 'src'));
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1, apply: true });
  assert.deepEqual(plan.plan.map((finding) => [finding.startLine, finding.endLine]), [[3, 4]]);
  assert.equal(
    await readFile(path.join(data.root, 'AGENTS.md'), 'utf8'),
    text.split('\n').filter((_, index) => index !== 2 && index !== 3).join('\n')
  );
});

test('apply refuses overlapping line ranges', async () => {
  const data = await inlineFixture('one\ntwo\nthree\nfour\n');
  const plan = {
    planId: 'overlap',
    plan: [
      { id: 'a', file: 'AGENTS.md', startLine: 1, endLine: 2, action: 'delete' },
      { id: 'b', file: 'AGENTS.md', startLine: 1, endLine: 2, action: 'delete' }
    ],
    _internal: { postHashes: {} }
  };
  const result = await applyPlan(plan, data.root);
  assert.deepEqual(result.applied, []);
  assert.equal(await readFile(path.join(data.root, 'AGENTS.md'), 'utf8'), 'one\ntwo\nthree\nfour\n');
});

test('lists, tables, and code are never condensed or deduplicated', async () => {
  const item = '- This list item explains one part of the layout in enough words to matter to a reader.\n';
  const code = '```bash\nnpm ci && npm test -- --runInBand --coverage --reporters=default --reporters=summary\n\nnpm run lint -- --max-warnings 0 --cache --cache-location .cache/eslint --ext .js,.ts,.tsx\n```\n';
  const data = await inlineFixture(`# Layout\n\n${item.repeat(40)}\n## Run\n\n${code}\n## Again\n\n${code}`);
  await writeFile(path.join(data.root, 'package.json'), JSON.stringify({ scripts: { lint: 'x' } }));
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1 });
  assert.deepEqual(plan.plan, []);
});

test('condense leaves a heading that sits directly on its paragraph in place', async () => {
  const data = await inlineFixture(`## Deploy\n${FILLER}${'Each stage reports its own status to the channel. '.repeat(40)}Stages run in order (e.g. build first). Then they stop.\n`);
  const plan = await makePlan({ ...data, config: { ignore: [] }, budget: 1, apply: true });
  assert.deepEqual([plan.plan[0].startLine, plan.plan[0].endLine], [2, 2]);
  const lines = (await readFile(path.join(data.root, 'AGENTS.md'), 'utf8')).split('\n');
  assert.equal(lines[0], '## Deploy');
  assert.doesNotMatch(lines[1], /e\.g\.$/);
  assert.match(lines[1], /\.$/);
});
