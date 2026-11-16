#!/usr/bin/env node
// Builds the public leaderboard pages under docs/ from leaderboard/<yyyy-mm>.json:
//   docs/<yyyy-mm>/index.html  one permanent page per month, never overwritten
//   docs/index.html            the newest month
// No network and no dependencies: it only reads the committed data, so the
// pages can be rebuilt and checked offline. GitHub Pages serves docs/ as is.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE, SITE, INDEX } from './site-shared.mjs';
export { STYLE, SITE, INDEX };

const REPO = 'https://github.com/Naeha-S/ctxcap';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const number = (value) => Number(value).toLocaleString('en-US');
const monthName = (month) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

const repos = (rows) => new Set(rows.map((row) => row.repo)).size;
const delta = (value) => (typeof value !== 'number' ? esc(value) : value === 0 ? '0' : `${value > 0 ? '+' : '−'}${number(Math.abs(value))}`);

// Names, paths, and commands must survive a translator untouched, whether
// that is the browser's own or a script: translate="no" is the standard
// attribute and notranslate the class most tools also honour.
const KEEP = 'translate="no" class="notranslate"';

function tableRow(row, { max, showDelta }) {
  return `        <tr>
          <td class="rank">${row.rank ?? '–'}</td>
          <td class="repo"><a ${KEEP} href="https://github.com/${esc(row.repo)}">${esc(row.repo)}</a><span class="file" translate="no">${esc(row.path)}</span></td>
          <td class="num stars">${number(row.stars)}</td>
          <td class="tokens"><span class="n">${number(row.tokens)}</span><span class="bar" style="width:${Math.max(0.5, (row.tokens / max) * 100).toFixed(1)}%"></span></td>${showDelta ? `\n          <td class="num delta">${delta(row.delta)}</td>` : ''}
        </tr>`;
}

/**
 * One page for one month's data (the JSON the crawler writes).
 * `months` lists every month that has a page, for the archive links;
 * `root` is true for docs/index.html, which shows the newest month.
 */
export function page(data, { months = [data.month], root = false } = {}) {
  // One table, largest first. Rank breaks ties the way the crawler ordered them.
  const rows = [...data.rows].sort((a, b) => b.tokens - a.tokens || (a.rank ?? Infinity) - (b.rank ?? Infinity));
  const small = rows.filter((row) => row.tokens < data.cleanBelow);
  const large = rows.filter((row) => row.tokens >= data.cleanBelow);
  const cleanRepos = repos(data.rows.filter((row) => row.rank === null));
  const max = Math.max(...rows.map((row) => row.tokens));
  const rate = Math.round(data.hitRate * 100);
  // A first month has nothing to compare against; the column would say "new" 30 times.
  const showDelta = rows.some((row) => typeof row.delta === 'number');
  const columns = showDelta ? 5 : 4;
  const where = data.depth === 1 ? 'at the root' : `within ${data.depth} levels of the root`;
  const name = monthName(data.month);
  const title = `${INDEX}: what the most-starred repositories spend on agent instructions, ${name}`;
  const summary = `${data.checked} of GitHub's most-starred repositories were checked. ${data.found} have an AGENTS.md or CLAUDE.md ${where}. This is what those files cost in tokens.`;
  const permalink = `${SITE}/${data.month}/`;
  const up = root ? '' : '../';
  const elsewhere = `<p class="small">Also in this index: <a href="${up}mcp/">the MCP Context Cost Index</a> — what tool definitions cost before the first message — and <a href="${up}receipts/">stale-reference receipts</a> — dead paths in other repositories' context files, checked by hand.</p>`;
  const others = months.filter((month) => month !== data.month).sort().reverse();

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(summary)}">
<link rel="canonical" href="${permalink}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${INDEX}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(summary)}">
<meta property="og:url" content="${permalink}">
<meta property="og:image" content="${SITE}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLE}</style>
</head>
<body>
<main>
  <p class="kicker">${INDEX} · ${esc(name)} · updated monthly · counted with <a href="${REPO}">ctxcap</a></p>
  <h1>${INDEX}</h1>
  <p class="lede">What the most-starred repositories on GitHub spend on agent instructions. An <code translate="no">AGENTS.md</code> or <code translate="no">CLAUDE.md</code> is read by a coding agent at the start of every session. Whatever it weighs is spent again each time, before the agent has looked at a line of code. This page counts that weight.</p>
  <p class="small">A named index, rebuilt once a month. The address above always shows the newest month; every month has a permanent page. Cite the month, not the front page.</p>

  <ul class="stats">
    <li><b>${data.found} of ${data.checked}</b><span>most-starred repositories have one ${where}</span></li>
    <li><b>${rate}%</b><span>hit rate, checking in star order</span></li>
    <li><b>${number(median(rows.map((row) => row.tokens)))}</b><span>tokens in the median file, of ${rows.length} files</span></li>
    <li><b>${number(max)}</b><span>tokens in the largest</span></li>
  </ul>
  <p class="note">This is a sample, not a ranking of GitHub: it is the first ${data.found} repositories with such a file, going down from the most stars. A large file is not a bad file. Six thousand tokens of rules an agent needs are well spent, and the table says what each file costs, not whether it is worth it.</p>
  <p class="note">The cost is not the money, which comes to cents. It is the room: these tokens sit in the context window for the whole session, taken before the agent has read any code.</p>
  <section class="compare" aria-labelledby="compare-title">
    <h2 id="compare-title">Where does your file sit?</h2>
    <p>Enter the token count of one context file. It is placed against the ${rows.length} files in this month's index. The same lookup is built into the tool: <code translate="no">npx ctxcap --compare</code>.</p>
    <form id="percentile-form">
      <div><label for="tokens">Tokens</label><input id="tokens" name="tokens" type="number" min="0" step="1" inputmode="numeric" placeholder="4100" required></div>
      <button type="submit">Find the percentile</button>
      <output id="percentile-result" for="tokens" aria-live="polite"></output>
    </form>
    <noscript><p>This form needs JavaScript. In your repository, <code translate="no">npx ctxcap --compare</code> prints the same line without a browser.</p></noscript>
  </section>
  <p class="small">${root
    ? `This address always shows the newest month. To cite these numbers, use the permanent page for ${esc(name)}: <a href="${data.month}/">${permalink}</a>`
    : `This is the permanent page for ${esc(name)}. <a href="../">The newest month is here.</a>`}</p>

  <h2>${rows.length} files in ${repos(rows)} repositories, largest first</h2>
  <table>
    <thead>
        <tr><th class="rank" scope="col">#</th><th scope="col">Repository and file</th><th class="num stars" scope="col">Stars</th><th scope="col">Tokens</th>${showDelta ? '<th class="num" scope="col">Change</th>' : ''}</tr>
    </thead>
    <tbody>
${large.map((row) => tableRow(row, { max, showDelta })).join('\n')}
    </tbody>${small.length === 0 ? '' : `
    <tbody class="under">
        <tr class="divider"><th colspan="${columns}" scope="rowgroup">Under ${data.cleanBelow} tokens: ${small.length} ${small.length === 1 ? 'file' : 'files'}. <span>${cleanRepos === 0 ? 'Not numbered.' : `In ${cleanRepos} ${cleanRepos === 1 ? 'repository' : 'repositories'}, every context file is this small. Not numbered.`}</span></th></tr>
${small.map((row) => tableRow(row, { max, showDelta })).join('\n')}
    </tbody>`}
  </table>

  <p class="small">A common guess is that the best-maintained projects write the least. <a href="${REPO}/blob/main/leaderboard/README.md#the-correlation">The numbers do not support it</a>: size and stars move together weakly, if at all.</p>

  ${elsewhere}

  <h2>How it was counted</h2>
  <ul class="method">
    <li>The ${data.checked} most-starred repositories that are not archived were checked in star order, stopping at the ${data.found}th with a context file. Stopping on a hit slightly overstates the ${rate}% rate.</li>
    <li>${data.depth === 1 ? 'Only files at the repository root are counted. Nested <code translate="no">AGENTS.md</code> and <code translate="no">CLAUDE.md</code> files, files these import, and other rule files are not.' : `Files up to ${data.depth} levels deep are counted. Files these import, and other rule files, are not.`}</li>
    <li>A symlink is counted as the file it points to, because that is what an agent that opens it reads. <code translate="no">AGENTS.md → README</code> means the agent is given the README.</li>
    <li>A file that is a copy of the one beside it, or that only imports it, is counted once. A repository with both files appears twice when they differ.</li>
    <li>Tokens are counted with <code translate="no">${esc(data.tokenizer)}</code> (OpenAI's o200k encoding). Other models tokenize differently, so read these as approximate and compare them with each other.</li>
    <li>Fetched on ${esc(data.fetched)} from each repository's default branch.${showDelta ? ' Change is against the previous month.' : ' This is the first month, so there is nothing yet to compare against; changes appear from the next one.'}</li>
  </ul>

  <h2>Count your own repository</h2>
  <p class="note">Every number here was counted with <a href="${REPO}">ctxcap</a>, an open-source linter for these files. It runs on your machine and makes no network calls. Two lines, in any repository:</p>
  <pre translate="no">npx ctxcap            # tokens in each context file
npx ctxcap --stale    # references in them that no longer resolve</pre>
  <p class="small">Data for this month: <a href="${REPO}/blob/main/leaderboard/${esc(data.month)}.json">${esc(data.month)}.json</a>. <a href="${REPO}/blob/main/leaderboard/README.md">Method and how to rebuild it.</a> Something wrong with your repository's row? <a href="${REPO}/issues">Open an issue.</a></p>${others.length === 0 ? '' : `
  <p class="small">Other months: ${others.map((month) => `<a href="${up}${month}/">${esc(monthName(month))}</a>`).join(' · ')}</p>`}
</main>
<script>
(() => {
  // The same values and the same rule as src/compare.js: a file's percentile
  // is the share of measured files at or below it. No network, no dependency.
  const values = ${JSON.stringify(rows.map((row) => row.tokens))};
  const month = ${JSON.stringify(name)};
  const form = document.getElementById('percentile-form');
  const input = document.getElementById('tokens');
  const output = document.getElementById('percentile-result');
  if (!form || !input || !output) return;
  const ordinal = (n) => (n % 100 >= 11 && n % 100 <= 13 ? n + 'th' : n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th'));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const tokens = Number(input.value);
    if (!Number.isFinite(tokens) || tokens < 0) return;
    const atOrBelow = values.filter((value) => value <= tokens).length;
    const percentile = Math.round((atOrBelow / values.length) * 100);
    output.textContent = tokens.toLocaleString('en-US') + ' tokens — larger than ' + atOrBelow + ' of ' + values.length
      + ' context files measured, the ' + ordinal(percentile) + ' percentile. (' + month + ')';
  });
})();
</script>
</body>
</html>
`;
}

/** Every month in a leaderboard directory, oldest first, as parsed data. */
export async function monthsIn(dir) {
  const names = (await readdir(dir)).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  if (names.length === 0) throw new Error(`no <yyyy-mm>.json in ${dir}`);
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), 'utf8'))));
}

/** Every file the site consists of, as { 'relative/path': content }. */
export async function site(from = 'leaderboard') {
  const all = await monthsIn(from);
  const months = all.map((data) => data.month);
  const files = { 'index.html': page(all.at(-1), { months, root: true }) };
  for (const data of all) files[`${data.month}/index.html`] = page(data, { months });
  // Both sibling sections are built from their own data directories. They are
  // imported at call time because their page modules import this one's style.
  const { site: mcpSite } = await import('./mcp-index-page.mjs');
  const { site: receiptsSite } = await import('./receipts-page.mjs');
  Object.assign(files, await mcpSite('mcp-index'), await receiptsSite('receipts'));
  // Tells GitHub Pages to serve the directory as it is, without Jekyll.
  files['.nojekyll'] = '';
  return files;
}

export async function build({ from = 'leaderboard', out = 'docs' } = {}) {
  const files = await site(from);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(out, file)), { recursive: true });
    await writeFile(path.join(out, file), content);
  }
  return Object.keys(files).filter((file) => file.endsWith('.html')).map((file) => path.join(out, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of await build()) process.stderr.write(`wrote ${file}\n`);
}
