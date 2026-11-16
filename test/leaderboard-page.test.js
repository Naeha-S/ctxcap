import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { page, latest } from '../scripts/leaderboard-page.mjs';
import { committed } from './helpers.js';

const row = (rank, repo, tokens, extra = {}) => ({ rank, repo, stars: 1000 - (rank ?? 500), path: 'AGENTS.md', sha: 'x', tokens, delta: 'new', ...extra });
const data = (rows, extra = {}) => ({
  title: 't', month: '2027-01', tokenizer: 'gpt-tokenizer@3.0.1', fetched: '2027-01-02', depth: 1,
  checked: 10, found: 3, hitRate: 0.3, cleanBelow: 200, rows, ...extra
});

test('leaderboard page: the committed page is what the newest data builds', async () => {
  const built = page(await latest('leaderboard'));
  assert.equal(await committed('docs/index.html'), built, 'run `npm run leaderboard:page` and commit docs/index.html');
  // Served by GitHub Pages without Jekyll.
  assert.equal(await readFile('docs/.nojekyll', 'utf8'), '');
});

test('leaderboard page: says it is a sample, states the hit rate, and loads nothing from elsewhere', () => {
  const html = page(data([
    row(1, 'big/one', 6000), row(2, 'mid/two', 900, { path: 'AGENTS.md → README' }), row(3, 'mid/two', 300, { path: 'CLAUDE.md' }),
    row(null, 'small/three', 90, { clean: true })
  ]));
  assert.match(html, /<title>What the most-starred repositories spend on agent instructions, January 2027<\/title>/);
  assert.ok(html.includes('<b>3 of 10</b>'));
  assert.ok(html.includes('<b>30%</b>'));
  assert.ok(html.includes('This is a sample, not a ranking of GitHub'));
  assert.ok(html.includes('a large file is not a bad file'));
  // Headings count files and repositories separately: mid/two has two files.
  assert.ok(html.includes('<h2>3 files in 2 repositories, largest first</h2>'));
  assert.ok(html.includes('<h2>The other 1: every file under 200 tokens</h2>'));
  assert.ok(html.includes('AGENTS.md → README'));
  // Largest first, and the bar of the largest is full width.
  assert.ok(html.indexOf('big/one') < html.indexOf('mid/two') && html.indexOf('mid/two') < html.indexOf('small/three'));
  assert.ok(html.includes('style="width:100.0%"'));
  // Self-contained: no scripts, no images, no stylesheets or fonts from another host.
  assert.doesNotMatch(html, /<script|<img|<link|@import|url\(/);
  // A first month has no change column.
  assert.ok(!html.includes('>Change<'));
  assert.ok(html.includes('This is the first month'));
});

test('leaderboard page: a later month shows the change, and names are escaped', () => {
  const html = page(data([
    row(1, 'a/<b>', 1200, { delta: 150 }), row(2, 'c/d', 800, { delta: -40 }), row(3, 'e/f', 400, { delta: 0 }), row(4, 'g/h', 300)
  ], { depth: 2 }));
  assert.ok(html.includes('>Change<'));
  assert.ok(html.includes('<td class="num delta">+150</td>'));
  assert.ok(html.includes('<td class="num delta">−40</td>'));
  assert.ok(html.includes('<td class="num delta">0</td>'));
  assert.ok(html.includes('<td class="num delta">new</td>'));
  assert.ok(html.includes('a/&lt;b&gt;') && !html.includes('a/<b>'));
  assert.ok(html.includes('within 2 levels of the root'));
  // Nothing under the line: no second table.
  assert.ok(!html.includes('every file under'));
});
