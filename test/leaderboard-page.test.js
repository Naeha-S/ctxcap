import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { monthsIn, page, site, SITE } from '../scripts/leaderboard-page.mjs';
import { committed } from './helpers.js';

const row = (rank, repo, tokens, extra = {}) => ({ rank, repo, stars: 1000 - (rank ?? 500), path: 'AGENTS.md', sha: 'x', tokens, delta: 'new', ...extra });
const data = (rows, extra = {}) => ({
  title: 't', month: '2027-01', tokenizer: 'gpt-tokenizer@3.0.1', fetched: '2027-01-02', depth: 1,
  checked: 10, found: 3, hitRate: 0.3, cleanBelow: 200, rows, ...extra
});
const FIRST = [
  row(1, 'big/one', 6000), row(2, 'mid/two', 900, { path: 'AGENTS.md → README' }), row(3, 'mid/two', 300, { path: 'CLAUDE.md' }),
  row(null, 'small/three', 90, { clean: true })
];
// What a reader-mode extractor, a link preview, or an agent keeps of a page.
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('leaderboard page: the committed site is what the data builds, one permanent page per month', async () => {
  const files = await site('leaderboard');
  // Written against whatever months are committed: the monthly workflow adds
  // one, and this test must still pass on the commit it makes.
  const months = (await monthsIn('leaderboard')).map((data) => data.month);
  const newest = months.at(-1);
  assert.ok(months.includes('2026-11'));
  assert.deepEqual(Object.keys(files).sort(), ['.nojekyll', 'index.html', ...months.map((month) => `${month}/index.html`)].sort());
  for (const [file, content] of Object.entries(files)) {
    assert.equal(await committed(`docs/${file}`), content, `${file}: run \`npm run leaderboard:page\` and commit docs/`);
  }
  // A month page names itself as the address to cite, and the root names the newest month.
  for (const month of months) {
    assert.ok(files[`${month}/index.html`].includes(`<link rel="canonical" href="${SITE}/${month}/">`), month);
    assert.ok(files[`${month}/index.html`].includes('<a href="../">'), month);
  }
  assert.ok(files['index.html'].includes(`<link rel="canonical" href="${SITE}/${newest}/">`));
  assert.ok(files['index.html'].includes(`<a href="${newest}/">`));
  // The share image the pages point at exists and is a PNG.
  assert.deepEqual([...(await readFile('docs/og.png')).subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(files['index.html'].includes(`<meta property="og:image" content="${SITE}/og.png">`));
});

test('leaderboard page: one table whose counts add up, a sample with its hit rate, nothing loaded from elsewhere', () => {
  const html = page(data(FIRST), { root: true });
  assert.match(html, /<title>What the most-starred repositories spend on agent instructions, January 2027<\/title>/);
  assert.ok(html.includes('<b>3 of 10</b>'));
  assert.ok(html.includes('<b>30%</b>'));
  assert.ok(html.includes('This is a sample, not a ranking of GitHub'));
  assert.ok(html.includes('A large file is not a bad file'));
  assert.ok(html.includes('The cost is not the money'));

  // One table. Its heading counts every row and every repository in it, and
  // the repository count is the one in the introduction.
  assert.equal(html.match(/<table/g).length, 1);
  assert.ok(html.includes('<h2>4 files in 3 repositories, largest first</h2>'));
  assert.equal(html.match(/<td class="rank">/g).length, 4);
  // The small files follow a labelled divider that states the threshold.
  assert.ok(html.includes('Under 200 tokens: 1 file. <span>In 1 repository, every context file is this small. Not numbered.</span>'));
  assert.ok(html.indexOf('big/one') < html.indexOf('mid/two') && html.indexOf('mid/two') < html.indexOf('Under 200 tokens: 1 file'));
  assert.ok(html.indexOf('Under 200 tokens: 1 file') < html.indexOf('small/three'));
  assert.ok(html.includes('AGENTS.md → README'));
  // No column is empty: the bar sits in the cell with its number.
  assert.ok(html.includes('<td class="tokens"><span class="n">6,000</span><span class="bar" style="width:100.0%"></span></td>'));
  assert.doesNotMatch(html, /<t[dh][^>]*><\/t[dh]>/);

  // Self-contained: no scripts, images, stylesheets, or fonts from another host.
  assert.doesNotMatch(html, /<script|<img|rel="stylesheet"|@import|url\(/);
  // A first month has no change column.
  assert.ok(!html.includes('>Change<'));
  assert.ok(html.includes('This is the first month'));
});

test('leaderboard page: the tool is named where a reader, or a tool that strips footers, will find it', () => {
  const html = page(data(FIRST), { root: true });
  // Not in <footer>: reader modes and text extractors drop it.
  assert.ok(!html.includes('<footer'));
  const read = text(html);
  assert.ok(read.includes('counted with ctxcap'));
  assert.ok(read.includes('Every number here was counted with ctxcap'));
  assert.ok(read.includes('npx ctxcap '));
  assert.ok(html.indexOf('counted with <a href="https://github.com/Naeha-S/ctxcap">ctxcap</a>') < html.indexOf('<h1>'));
  // Names, paths, and commands are marked so a translator leaves them alone.
  assert.ok(html.includes('<a translate="no" class="notranslate" href="https://github.com/big/one">big/one</a>'));
  assert.ok(html.includes('<span class="file" translate="no">AGENTS.md → README</span>'));
  assert.ok(html.includes('<pre translate="no">npx ctxcap'));
  assert.doesNotMatch(html, /<code>/);
});

test('leaderboard page: a later month shows the change, links the others, and escapes names', () => {
  const rows = [row(1, 'a/<b>', 1200, { delta: 150 }), row(2, 'c/d', 800, { delta: -40 }), row(3, 'e/f', 400, { delta: 0 }), row(4, 'g/h', 300)];
  const html = page(data(rows, { depth: 2 }), { months: ['2026-11', '2026-12', '2027-01'] });
  assert.ok(html.includes('>Change<'));
  assert.ok(html.includes('<td class="num delta">+150</td>'));
  assert.ok(html.includes('<td class="num delta">−40</td>'));
  assert.ok(html.includes('<td class="num delta">0</td>'));
  assert.ok(html.includes('<td class="num delta">new</td>'));
  assert.ok(html.includes('a/&lt;b&gt;') && !html.includes('a/<b>'));
  assert.ok(html.includes('within 2 levels of the root'));
  // Nothing under the line: no divider.
  assert.ok(!html.includes('class="divider"'));
  // A month page links up to the newest and across to the others, newest first.
  assert.ok(html.includes('This is the permanent page for January 2027.'));
  assert.ok(html.includes('Other months: <a href="../2026-12/">December 2026</a> · <a href="../2026-11/">November 2026</a>'));
  assert.ok(page(data(rows), { months: ['2026-12', '2027-01'], root: true }).includes('Other months: <a href="2026-12/">December 2026</a>'));
});
