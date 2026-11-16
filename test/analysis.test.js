import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze, pearson, perRepo, permutationP, rank, spearman } from '../scripts/analyze.mjs';
import { committed } from './helpers.js';

const data = JSON.parse(await readFile('leaderboard/2026-11.json', 'utf8'));

test('analysis: ranks handle ties by average, and correlation has the right sign', () => {
  assert.deepEqual(rank([30, 10, 20, 10]), [4, 1.5, 3, 1.5]);
  assert.equal(pearson([1, 2, 3], [2, 4, 6]), 1);
  assert.equal(spearman([1, 2, 3], [30, 20, 10]), -1);
  assert.equal(spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1);
});

test('analysis: permutation p is deterministic and two-sided', () => {
  const first = permutationP([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1], 500);
  const second = permutationP([1, 2, 3, 4, 5, 6], [6, 5, 4, 3, 2, 1], 500);
  assert.deepEqual(first, second);
  assert.ok(first.p <= 0.01, `a perfect inverse of six points: ${first.p}`);
});

test('analysis: one repository is one row, and its files are added up', () => {
  const repos = perRepo([
    { repo: 'a/one', stars: 10, tokens: 100 },
    { repo: 'a/one', stars: 10, tokens: 50 },
    { repo: 'b/two', stars: 20, tokens: 300 }
  ]);
  assert.deepEqual(repos, [
    { repo: 'a/one', stars: 10, tokens: 150, files: 2 },
    { repo: 'b/two', stars: 20, tokens: 300, files: 1 }
  ]);
});

test('analysis: the committed document states the computed result', async () => {
  const result = analyze(data, { iterations: 20000 });
  assert.equal(result.repositories, 25);
  assert.equal(result.files, 30);
  assert.equal(result.perRepo.spearman, 0.269);
  assert.equal(result.perRepo.p, 0.1943);
  assert.equal(result.perFile.spearman, 0.328);
  assert.equal(result.withoutClean.spearman, 0.288);
  // The interval crosses zero: the document must not claim an inverse effect.
  assert.ok(result.perRepo.ci.low < 0 && result.perRepo.ci.high > 0);
  const doc = await committed('leaderboard/2026-11-analysis.md');
  assert.ok(doc.includes('| 25 | 0.269 | 0.1943 |'));
  assert.ok(doc.includes('| 30 | 0.328 | 0.0774 |'));
  assert.ok(doc.includes('−0.121 to 0.575'));
  assert.ok(doc.includes('It does not hold in this sample'));
  assert.ok(doc.includes('median of 194,770 stars'));
  assert.ok(doc.includes('median of 226,984'));
});
