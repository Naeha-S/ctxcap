import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { committed } from './helpers.js';
import { evidenceFor, markdown, patchFor, prBody, reviewKey } from '../scripts/receipts.mjs';
import { page } from '../scripts/receipts-page.mjs';

const data = JSON.parse(await readFile('receipts/2026-11.json', 'utf8'));
const reviews = JSON.parse(await readFile('receipts/reviews.json', 'utf8'));

test('receipts: the committed markdown is the committed data', async () => {
  assert.equal(await committed('receipts/2026-11.md'), markdown(data));
});

test('receipts: counts add up, every row has a reading, and no tree is stored', () => {
  assert.equal(data.checked, 25);
  assert.equal(data.totals.findings, data.totals.verified + data.totals.excluded + data.totals.unreviewed);
  assert.equal(data.totals.verified, data.verified.reduce((sum, repo) => sum + repo.findings.length, 0));
  assert.equal(data.totals.excluded, data.excluded.length);
  assert.equal(data.totals.unreviewed, 0);
  for (const repo of data.verified) {
    assert.ok(!Array.isArray(repo.path), 'the whole tree must not be stored as a path');
    for (const finding of repo.findings) {
      assert.equal(finding.review.status, 'defect', reviewKey(repo.repo, finding.ref));
      assert.ok(finding.review.reason.length > 30);
      assert.equal(finding.rule, 'stale-path');
    }
  }
  for (const finding of data.excluded) {
    assert.equal(finding.review.status, 'not-a-defect');
    assert.ok(finding.reason.length > 30);
  }
  // Every published finding has a review entry, and every review names a real finding.
  const keys = new Set([
    ...data.verified.flatMap((repo) => repo.findings.map((finding) => reviewKey(repo.repo, finding.ref))),
    ...data.excluded.map((finding) => reviewKey(finding.repo, finding.ref))
  ]);
  for (const key of keys) assert.ok(reviews[key], key);
});

test('receipts: a published defect has a one-line patch and a pull request body', async () => {
  for (const repo of data.verified) {
    for (const finding of repo.findings) {
      const patch = patchFor(finding);
      assert.ok(patch, `${repo.repo} ${finding.ref}: reviewed defect needs a replacement`);
      assert.ok(patch.includes(`-${finding.text}`));
      assert.ok(patch.includes(`@@ -${finding.line - 1},`), 'hunk starts one line above, for context');
      assert.ok(patch.includes(` ${finding.before}`), 'one line of context before, so git apply needs no flags');
      const slug = `${repo.repo.replace('/', '-')}-${finding.ref.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      const body = await committed(`receipts/prs/${slug}.md`);
      assert.ok(body.includes(finding.ref));
      assert.equal(body, prBody(repo.repo, finding, repo.findings.length));
      assert.equal(await committed(`receipts/prs/${slug}.patch`), patch);
    }
  }
});

test('receipts: the evidence lookup finds a directory or a renamed sibling, and is not a verdict', () => {
  const paths = ['.github/scripts/check-quality/main.go', 'turbo.json', 'src/CLAUDE.md'];
  assert.deepEqual(evidenceFor('.github/scripts/check-quality.js', paths).asDirectory, ['.github/scripts/check-quality/main.go']);
  assert.deepEqual(evidenceFor('turbo.jsonc', paths).renamed, ['turbo.json']);
  assert.deepEqual(evidenceFor('CLAUDE.md', paths), { asDirectory: [], renamed: [] });
});

test('receipts page: confirmed rows, the excluded list, and nothing loaded from elsewhere', () => {
  const html = page(data, { root: true });
  assert.match(html, /<title>Stale-Reference Receipts, November 2026: dead references in the most-starred context files<\/title>/);
  assert.ok(html.includes('<h1>Stale-Reference Receipts</h1>'));
  assert.ok(html.includes('<b>2</b><span>confirmed defects after reading</span>'));
  assert.equal(html.match(/<table/g).length, 1);
  assert.ok(html.includes('twbs/bootstrap'));
  assert.ok(html.includes('avelino/awesome-go'));
  assert.ok(html.includes('Read and excluded'));
  assert.ok(html.includes('Significant-Gravitas/AutoGPT'));
  assert.ok(html.includes('Not scanned'));
  assert.ok(html.includes('<link rel="canonical" href="https://naeha-s.github.io/ctxcap/receipts/2026-11/">'));
  assert.doesNotMatch(html, /<script|<img|rel="stylesheet"|@import|url\(/);
});
