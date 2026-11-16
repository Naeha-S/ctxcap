import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cli } from './helpers.js';
import { compareFiles, compareLine, loadIndex, percentile } from '../src/compare.js';
import { indexFrom, readMonth } from '../scripts/index-data.mjs';
import { countTokens } from '../src/tokenize.js';

test('compare: percentile counts ties as at or below, and rank counts from the largest', () => {
  const values = [10, 20, 30, 40];
  assert.deepEqual(
    (({ percentile: p, rank, largerThan }) => ({ p, rank, largerThan }))(percentile(25, values)),
    { p: 50, rank: 3, largerThan: 2 }
  );
  assert.deepEqual(
    (({ percentile: p, rank, largerThan }) => ({ p, rank, largerThan }))(percentile(30, values)),
    { p: 75, rank: 2, largerThan: 3 }
  );
  assert.equal(percentile(40, values).percentile, 100);
  assert.equal(percentile(40, values).rank, 1);
  assert.equal(percentile(5, values).percentile, 0);
  assert.equal(percentile(5, values).rank, 5);
});

test('compare: the shipped index is exactly what the committed leaderboard builds', async () => {
  const data = await readMonth({ from: 'leaderboard' });
  const committed = JSON.parse(await readFile('data/context-index.json', 'utf8'));
  assert.deepEqual(committed, indexFrom(data), 'run `npm run index:data` and commit data/context-index.json');
  // Sorted ascending, because the lookup is a filter and readers expect order.
  assert.deepEqual(committed.tokens, [...committed.tokens].sort((a, b) => a - b));
  assert.equal(committed.measured, committed.files.length);
  assert.equal(committed.repositories, new Set(committed.files.map((file) => file.repo)).size);
  // The package has to carry it, or `npx ctxcap --compare` has nothing to read.
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(pkg.files.includes('data'), 'package.json files must include data');
});

test('compare: a repository gets its largest file percentiled, in text and JSON', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-compare-'));
  const text = 'word '.repeat(4000);
  await writeFile(path.join(dir, 'AGENTS.md'), text);
  const expected = percentile(countTokens(text), loadIndex().tokens);

  const json = cli(dir, '--compare', '--json');
  assert.equal(json.status, 0);
  const report = JSON.parse(json.stdout);
  assert.equal(report.comparison.file, 'AGENTS.md');
  assert.equal(report.comparison.tokens, countTokens(text));
  assert.equal(report.comparison.measured, 30);
  assert.equal(report.comparison.month, '2026-11');
  assert.equal(report.comparison.percentile, expected.percentile);
  assert.equal(report.comparison.index, 'The Context Budget Index');

  const plain = cli(dir, '--compare');
  assert.equal(plain.status, 0);
  assert.ok(plain.stdout.includes(`AGENTS.md: ${countTokens(text).toLocaleString('en-US')} tokens — larger than ${expected.largerThan} of 30 context files`));
  assert.match(plain.stdout, /The Context Budget Index \(2026-11\), \d+(st|nd|rd|th) percentile\./);
});

test('compare: no context files means no comparison, not a crash', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-compare-empty-'));
  const json = cli(dir, '--compare', '--json');
  assert.equal(json.status, 0);
  assert.equal(JSON.parse(json.stdout).comparison, null);
  assert.equal(compareLine(null), 'no context files to compare');
});

test('compare: the line names the file, the count, the sample, and the month', () => {
  const line = compareLine({
    file: 'AGENTS.md', tokens: 4100, largerThan: 27, measured: 30, percentile: 90, month: '2026-11'
  });
  assert.equal(
    line,
    'AGENTS.md: 4,100 tokens — larger than 27 of 30 context files in The Context Budget Index (2026-11), 90th percentile.'
  );
  assert.ok(compareFiles([]) === null);
});
