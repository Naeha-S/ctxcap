#!/usr/bin/env node
// Builds docs/index.html, the public page for the newest leaderboard/<yyyy-mm>.json.
// No network and no dependencies: it only reads the committed data, so the
// page can be rebuilt and checked offline. GitHub Pages serves docs/ as is.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

function tableRows(rows, { max, showDelta, ranked }) {
  return rows.map((row) => `        <tr>
          ${ranked ? `<td class="num rank">${row.rank}</td>\n          ` : ''}<td class="repo"><a href="https://github.com/${esc(row.repo)}">${esc(row.repo)}</a><span class="file">${esc(row.path)}</span></td>
          <td class="num stars">${number(row.stars)}</td>
          <td class="num tokens">${number(row.tokens)}</td>${showDelta ? `\n          <td class="num delta">${delta(row.delta)}</td>` : ''}
          <td class="bar" aria-hidden="true"><span style="width:${Math.max(0.5, (row.tokens / max) * 100).toFixed(1)}%"></span></td>
        </tr>`).join('\n');
}

/** The whole page for one month's data (the JSON the crawler writes). */
export function page(data) {
  const ranked = data.rows.filter((row) => row.rank !== null);
  const clean = data.rows.filter((row) => row.rank === null);
  const max = Math.max(...data.rows.map((row) => row.tokens));
  const rate = Math.round(data.hitRate * 100);
  // A first month has nothing to compare against; the column would say "new" 30 times.
  const showDelta = data.rows.some((row) => typeof row.delta === 'number');
  const where = data.depth === 1 ? 'at the root' : `within ${data.depth} levels of the root`;
  const head = (isRanked) => `        <tr>${isRanked ? '<th class="num rank" scope="col">#</th>' : ''}<th scope="col">Repository and file</th><th class="num stars" scope="col">Stars</th><th class="num" scope="col">Tokens</th>${showDelta ? '<th class="num" scope="col">Change</th>' : ''}<th class="bar" aria-hidden="true"></th></tr>`;
  const title = `What the most-starred repositories spend on agent instructions, ${monthName(data.month)}`;
  const summary = `${data.checked} of GitHub's most-starred repositories were checked. ${data.found} have an AGENTS.md or CLAUDE.md ${where}. This is what those files cost in tokens.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(summary)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(summary)}">
<meta property="og:type" content="article">
<style>
  :root { --bg:#fbfaf7; --fg:#1c1b19; --muted:#6b675f; --line:#e4e0d8; --bar:#c2410c; --bar-clean:#4d7c0f; --link:#1d4ed8; --card:#ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#141413; --fg:#ecebe7; --muted:#a09c93; --line:#2e2d2a; --bar:#fb923c; --bar-clean:#a3e635; --link:#93c5fd; --card:#1c1c1a; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 56px 20px 80px; }
  a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
  .kicker { color: var(--muted); font-size: 14px; letter-spacing: .04em; text-transform: uppercase; margin: 0 0 12px; }
  h1 { font-size: clamp(30px, 5.2vw, 46px); line-height: 1.12; letter-spacing: -.02em; margin: 0 0 20px; }
  h2 { font-size: 22px; letter-spacing: -.01em; margin: 56px 0 8px; }
  p { margin: 0 0 16px; }
  .lede { font-size: 20px; line-height: 1.5; max-width: 40em; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 32px 0 8px; padding: 0; list-style: none; }
  .stats li { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
  .stats b { display: block; font-size: 28px; line-height: 1.15; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .stats span { color: var(--muted); font-size: 14px; line-height: 1.35; display: block; margin-top: 4px; }
  .note { color: var(--muted); font-size: 15px; max-width: 46em; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0 0; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: .03em; text-transform: uppercase; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--line); }
  td { padding: 10px 10px 10px 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
  .num { text-align: right; white-space: nowrap; }
  .rank { width: 2.2em; color: var(--muted); text-align: left; }
  .repo a { font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  .repo a:hover { text-decoration: underline; }
  .file { display: block; color: var(--muted); font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
  .stars { color: var(--muted); }
  .tokens { font-weight: 600; }
  .bar { width: 34%; padding-right: 0; }
  .bar span { display: block; height: 10px; border-radius: 3px; background: var(--bar); }
  .clean .bar span { background: var(--bar-clean); }
  ul.method { padding-left: 1.2em; margin: 0 0 16px; }
  ul.method li { margin: 0 0 10px; max-width: 46em; }
  code { font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--card); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
  footer { margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--line); color: var(--muted); font-size: 15px; }
  @media (max-width: 640px) {
    body { font-size: 16px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .stars { display: none; }
    .bar { width: 22%; }
  }
</style>
</head>
<body>
<main>
  <p class="kicker">${esc(monthName(data.month))} · updated monthly</p>
  <h1>What the most-starred repositories spend on agent instructions</h1>
  <p class="lede">An <code>AGENTS.md</code> or <code>CLAUDE.md</code> is read by a coding agent at the start of every session. Whatever it weighs is spent again each time, before the agent has looked at a line of code. This page counts that weight for the most-starred repositories on GitHub that have one.</p>

  <ul class="stats">
    <li><b>${data.found} of ${data.checked}</b><span>most-starred repositories have one ${where}</span></li>
    <li><b>${rate}%</b><span>hit rate, checking in star order</span></li>
    <li><b>${number(median(data.rows.map((row) => row.tokens)))}</b><span>tokens in the median file, of ${data.rows.length} files</span></li>
    <li><b>${number(max)}</b><span>tokens in the largest</span></li>
  </ul>
  <p class="note">This is a sample, not a ranking of GitHub: it is the first ${data.found} repositories with such a file, going down from the most stars. And a large file is not a bad file. Six thousand tokens of rules an agent needs are well spent. The table says what each file costs, not whether it is worth it.</p>

  <h2>${ranked.length} files in ${repos(ranked)} repositories, largest first</h2>
  <table>
    <thead>
${head(true)}
    </thead>
    <tbody>
${tableRows(ranked, { max, showDelta, ranked: true })}
    </tbody>
  </table>
${clean.length === 0 ? '' : `
  <h2>The other ${repos(clean)}: every file under ${data.cleanBelow} tokens</h2>
  <p class="note">Listed, not ordered with the rest.</p>
  <table class="clean">
    <thead>
${head(false)}
    </thead>
    <tbody>
${tableRows(clean, { max, showDelta, ranked: false })}
    </tbody>
  </table>
`}
  <h2>How it was counted</h2>
  <ul class="method">
    <li>The ${data.checked} most-starred repositories that are not archived were checked in star order, stopping at the ${data.found}th with a context file. Stopping on a hit slightly overstates the ${rate}% rate.</li>
    <li>${data.depth === 1 ? 'Only files at the repository root are counted. Nested <code>AGENTS.md</code> and <code>CLAUDE.md</code> files, files these import, and other rule files are not.' : `Files up to ${data.depth} levels deep are counted. Files these import, and other rule files, are not.`}</li>
    <li>A symlink is counted as the file it points to, because that is what an agent that opens it reads. <code>AGENTS.md → README</code> means the agent is given the README.</li>
    <li>A file that is a copy of the one beside it, or that only imports it, is counted once. A repository with both files appears twice when they differ.</li>
    <li>Tokens are counted with <code>${esc(data.tokenizer)}</code> (OpenAI's o200k encoding). Other models tokenize differently, so read these as approximate and compare them with each other.</li>
    <li>Fetched on ${esc(data.fetched)} from each repository's default branch.${showDelta ? ' Change is against the previous month.' : ' This is the first month, so there is nothing yet to compare against; changes appear from the next one.'}</li>
  </ul>

  <footer>
    <p>Data: <a href="${REPO}/blob/main/leaderboard/${esc(data.month)}.json">${esc(data.month)}.json</a> · <a href="${REPO}/blob/main/leaderboard/README.md">method and how to rebuild it</a>. Something wrong with your repository's row? <a href="${REPO}/issues">Open an issue</a>.</p>
    <p>Counted with <a href="${REPO}">ctxcap</a>, a linter that measures agent context files and gates their growth in CI.</p>
  </footer>
</main>
</body>
</html>
`;
}

/** The newest <yyyy-mm>.json in a leaderboard directory. */
export async function latest(dir) {
  const months = (await readdir(dir)).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  if (months.length === 0) throw new Error(`no <yyyy-mm>.json in ${dir}`);
  return JSON.parse(await readFile(path.join(dir, months.at(-1)), 'utf8'));
}

export async function build({ from = 'leaderboard', out = 'docs' } = {}) {
  const data = await latest(from);
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'index.html'), page(data));
  // Tells GitHub Pages to serve the directory as it is, without Jekyll.
  await writeFile(path.join(out, '.nojekyll'), '');
  return { month: data.month, file: path.join(out, 'index.html') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { month, file } = await build();
  process.stderr.write(`wrote ${file} from the ${month} data\n`);
}
