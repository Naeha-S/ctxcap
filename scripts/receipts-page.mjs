#!/usr/bin/env node
// Builds docs/receipts/: the published, hand-checked dead references. Static,
// no scripts, no third-party anything.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE, SITE, INDEX } from './site-shared.mjs';

export const TITLE = 'Stale-Reference Receipts';
const REPO = 'https://github.com/Naeha-S/ctxcap';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const esc = (value) => String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const number = (value) => Number(value).toLocaleString('en-US');
const monthName = (month) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const KEEP = 'translate="no" class="notranslate"';

export function page(data, { months = [data.month], root = false } = {}) {
  const name = monthName(data.month);
  const title = `${TITLE}, ${name}: dead references in the most-starred context files`;
  const scanned = data.checked - data.totals.notScanned;
  const summary = `${scanned} of the most-starred repositories were scanned. ${data.totals.findings} references did not resolve; ${data.totals.verified} were confirmed as defects after reading each one.`;
  const permalink = `${SITE}/receipts/${data.month}/`;
  const up = root ? '../' : '../../';
  const others = months.filter((month) => month !== data.month).sort().reverse();
  const rows = data.verified.flatMap((repo) => repo.findings.map((finding) => `        <tr>
          <td class="repo"><a ${KEEP} href="https://github.com/${esc(repo.repo)}">${esc(repo.repo)}</a><span class="file" ${KEEP}>${esc(finding.path)}:${finding.line}</span></td>
          <td><code ${KEEP}>${esc(finding.ref)}</code></td>
          <td class="line"><span ${KEEP}>${esc(finding.text)}</span></td>
        </tr>`)).join('\n');
  const excluded = data.excluded.map((finding) => `      <li><a ${KEEP} href="https://github.com/${esc(finding.repo)}">${esc(finding.repo)}</a> · <code ${KEEP}>${esc(finding.ref)}</code> — ${esc(finding.reason)}</li>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(summary)}">
<link rel="canonical" href="${permalink}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${TITLE}">
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
  <p class="kicker"><a href="${up}">${INDEX}</a> · ${TITLE} · ${esc(name)} · counted with <a href="${REPO}">ctxcap</a></p>
  <h1>${TITLE}</h1>
  <p class="lede">An instruction file that names a path which no longer exists is not a style problem. It is a factual defect with a one-line fix. This page scans the context files of the most-starred repositories, reports the references that do not resolve, and states what was done about each one.</p>

  <ul class="stats">
    <li><b>${scanned}</b><span>repositories scanned</span></li>
    <li><b>${data.totals.findings}</b><span>references that did not resolve</span></li>
    <li><b>${data.totals.verified}</b><span>confirmed defects after reading</span></li>
    <li><b>${data.totals.excluded}</b><span>read and excluded as examples</span></li>
  </ul>

  <p class="note">The scanner is deliberately conservative. It checks paths, globs, and <code ${KEEP}>npm run</code> scripts named in a context file against the repository, and stays quiet when a reference could be a name, an example, or one of two alternatives. What it reports is still a candidate, not a verdict: every row below was read before it was called a defect, and <a href="${REPO}/blob/main/receipts/reviews.json"><code ${KEEP}>receipts/reviews.json</code></a> records the reading. The excluded list is published too, because a measurement that hides its false positives is not one.</p>

  <h2>Confirmed defects</h2>
  ${data.verified.length === 0
    ? '<p class="note">None this month.</p>'
    : `<table>
    <thead>
      <tr><th scope="col">Repository and line</th><th scope="col">Reference</th><th scope="col">The line</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>`}

  ${data.excluded.length === 0 ? '' : `<h2>Read and excluded</h2>
  <p class="note">Found by the scanner, and not published as defects. The reason is the reading, not a rule.</p>
  <ul class="method">
${excluded}
  </ul>`}

  ${data.unscanned.length === 0 ? '' : `<h2>Not scanned</h2>
  <p class="note">Absence cannot be proved for these, so they are listed rather than guessed at.</p>
  <ul class="method">
${data.unscanned.map((entry) => `    <li><span ${KEEP}>${esc(entry.repo)}</span> — ${esc(entry.reason)}</li>`).join('\n')}
  </ul>`}

  <h2>How it was counted</h2>
  <ul class="method">
    <li>Each repository's default branch was read through the GitHub API. The file tree was laid out as empty files, the context files were written with their real contents, and <code ${KEEP}>ctxcap --stale</code> ran against that copy. Nothing was cloned and nothing was written to the repository.</li>
    <li>A reference is reported only when it is spelled like a path into the repository and the path does not resolve. Identifiers, commands that are not <code ${KEEP}>npm run</code>, routes, branches, and package names are not paths and are skipped.</li>
    <li>An <code ${KEEP}>npm run</code> script is judged only when every <code ${KEEP}>package.json</code> in the tree was fetched; otherwise command findings are dropped rather than guessed.</li>
    <li>Two repositories in the index are not here: GitHub truncates their file tree, so a missing path cannot be distinguished from an unlisted one.</li>
    <li>Data fetched ${esc(data.measured)}. Selected ${data.checked} repositories holding the files in the <a href="${up}">${INDEX}</a> for ${esc(data.month)}. Counted with <code ${KEEP}>ctxcap</code>, offline.</li>
  </ul>

  <h2>Run it on a repository</h2>
  <pre ${KEEP}>npx ctxcap --stale          # every reference that does not resolve
npx ctxcap --stale-fix      # a deletion diff for the ones it is sure about</pre>
  <p class="note">To send one in: <a href="${REPO}/issues/new?template=audit.yml">open an audit issue</a> with the repository. The series is time-boxed to ten, and the before and after are published here with the line that changed.</p>
  <p class="small">Data for this month: <a href="${REPO}/blob/main/receipts/${esc(data.month)}.json">${esc(data.month)}.json</a>. Pull request drafts: <a href="${REPO}/blob/main/receipts/prs/README.md">receipts/prs</a>. Method: <a href="${REPO}/blob/main/receipts/README.md">receipts/README.md</a>. Something wrong with a row? <a href="${REPO}/issues">Open an issue.</a></p>${others.length === 0 ? '' : `
  <p class="small">Other months: ${others.map((month) => `<a href="${up}receipts/${month}/">${esc(monthName(month))}</a>`).join(' · ')}</p>`}
</main>
</body>
</html>
`;
}

export async function site(from = 'receipts') {
  const names = (await readdir(from).catch(() => [])).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  if (!names.length) return {};
  const all = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(from, name), 'utf8'))));
  const months = all.map((data) => data.month);
  const files = { 'receipts/index.html': page(all.at(-1), { months, root: true }) };
  for (const data of all) files[`receipts/${data.month}/index.html`] = page(data, { months });
  return files;
}

export async function build({ from = 'receipts', out = 'docs' } = {}) {
  const files = await site(from);
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(out, file)), { recursive: true });
    await writeFile(path.join(out, file), content);
  }
  return Object.keys(files).map((file) => path.join(out, file));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const file of await build()) process.stderr.write(`wrote ${file}\n`);
}
