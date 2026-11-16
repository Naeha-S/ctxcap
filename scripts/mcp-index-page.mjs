#!/usr/bin/env node
// Builds the public pages for the MCP Context Cost Index under docs/mcp/.
// Static and dependency-free, like the Context Budget Index pages.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STYLE, SITE, INDEX } from './site-shared.mjs';

export const TITLE = 'The MCP Context Cost Index';
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
const KEEP = 'translate="no" class="notranslate"';

const multiple = (tokens, base) => {
  if (!base) return '';
  const ratio = tokens / base;
  return ratio < 10 ? `${ratio.toFixed(1)}×` : `${Math.round(ratio)}×`;
};

/**
 * One page for one month. `data` is mcp-index/<month>.json. The root page at
 * mcp/index.html shows the newest month; the month page is the permanent one.
 */
export function page(data, { months = [data.month], root = false } = {}) {
  const self = data.rows.find((row) => row.name === 'ctxcap');
  const base = self?.tokens ?? null;
  const max = Math.max(...data.rows.map((row) => row.tokens));
  const name = monthName(data.month);
  const title = `${TITLE}, ${name}: what MCP servers cost in context`;
  const summary = `${data.rows.length} MCP servers start a session with ${number(data.tools)} tool definitions between them. The largest costs ${number(max)} tokens before the first message.`;
  const permalink = `${SITE}/mcp/${data.month}/`;
  const up = root ? '../' : '../../';
  const others = months.filter((month) => month !== data.month).sort().reverse();
  const largest = data.rows[0];
  const cheapest = [...data.rows].sort((a, b) => a.tokens - b.tokens)[0];

  const rows = data.rows.map((row) => `        <tr>
          <td class="rank">${row.rank}</td>
          <td class="repo"><span ${KEEP}>${esc(row.name)}</span><span class="file" ${KEEP}>${esc(row.package ? `${row.package}@${row.version}` : 'this repository')}</span></td>
          <td class="num">${row.tools}</td>
          <td class="tokens"><span class="n">${number(row.tokens)}</span><span class="bar" style="width:${Math.max(0.5, (row.tokens / max) * 100).toFixed(1)}%"></span></td>
          <td class="num">${multiple(row.tokens, base)}</td>
        </tr>`).join('\n');

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
  <p class="kicker"><a href="${up}">${INDEX}</a> · ${TITLE} · ${esc(name)} · updated monthly · counted with <a href="${REPO}">ctxcap</a></p>
  <h1>${TITLE}</h1>
  <p class="lede">Every MCP server a client connects sends its tool definitions in every session, before the model has been asked anything. The definitions are billed to the context window, and most people never see the bill. This page is the bill.</p>

  <ul class="stats">
    <li><b>${data.rows.length}</b><span>servers measured over stdio</span></li>
    <li><b>${number(data.tools)}</b><span>tool definitions between them</span></li>
    <li><b>${number(median(data.rows.map((row) => row.tokens)))}</b><span>tokens in the median server</span></li>
    <li><b>${number(max)}</b><span>in the largest, ${esc(largest.name)}</span></li>
  </ul>

  <p class="note">This is not a ranking of quality. A server with 73 tools can do more than one with two, and a large schema is sometimes the honest way to describe a large API. What the table measures is what it costs to have that server switched on: tokens that sit in the context window for the whole session. A server nobody calls still pays.</p>
  <p class="note">The comparison column is against <a href="${REPO}">ctxcap's own server</a>, which exposes four tools: measure, plan, verify, and trim. It exposes four tools and sits near the bottom of the table at ${number(self?.tokens ?? 0)} tokens. That is the point of the reference in the README: a server that answers four questions can cost 507 tokens, while one that answers many can cost ${number(largest.tokens)} before it is asked anything.</p>
  <p class="small">${root
    ? `This address always shows the newest month. To cite these numbers, use the permanent page for ${esc(name)}: <a href="${data.month}/">${permalink}</a>`
    : `This is the permanent page for ${esc(name)}. <a href="../">The newest month is here.</a>`}</p>

  <h2>${data.rows.length} servers, largest first</h2>
  <table>
    <thead>
      <tr><th class="rank" scope="col">#</th><th scope="col">Server and package</th><th class="num" scope="col">Tools</th><th scope="col">Tokens</th><th class="num" scope="col">× ctxcap</th></tr>
    </thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="small">Measured ${esc(data.measured)}. ${number(cheapest.tokens)} tokens is the smallest: ${esc(cheapest.name)}. The largest is ${number(largest.tokens)}, ${multiple(largest.tokens, base)} ctxcap's server. <a href="${REPO}/blob/main/mcp-index/${esc(data.month)}.json">The data.</a></p>

  ${data.unmeasured.length === 0 ? '' : `<h2>Not measured</h2>
  <p class="note">These are popular servers, but there is no honest single number for them. They are listed with the reason rather than dropped.</p>
  <ul class="method">
${data.unmeasured.map((entry) => `    <li><span ${KEEP}>${esc(entry.name)}</span> (<code ${KEEP}>${esc(entry.package)}@${esc(entry.version)}</code>) — ${esc(entry.reason)}</li>`).join('\n')}
  </ul>`}

  <h2>How it was counted</h2>
  <ul class="method">
    <li>Each server was installed from npm at the version pinned in <a href="${REPO}/blob/main/scripts/mcp-servers.json"><code ${KEEP}>scripts/mcp-servers.json</code></a>, started over stdio, sent <code ${KEEP}>initialize</code> and <code ${KEEP}>tools/list</code>, and stopped. No tool was called and no conversation was started.</li>
    <li>The count covers <code ${KEEP}>name</code>, <code ${KEEP}>description</code>, and <code ${KEEP}>inputSchema</code> for every tool. It leaves out <code ${KEEP}>title</code>, <code ${KEEP}>annotations</code>, and <code ${KEEP}>outputSchema</code>, which some clients also send, so every number here is a lower bound.</li>
    <li>Credentials were placeholders. <code ${KEEP}>tools/list</code> is answered without a real token by these servers; an API call is not needed to learn what the tools cost.</li>
    <li>Some servers can hide tools behind configuration or a selected toolset. The number is the default tool list, which is what a session pays before anyone tunes it. ${esc(largest.name)} notes that it can be narrowed.</li>
    <li>Tokens are counted with <code ${KEEP}>${esc(data.tokenizer)}</code>, the same tokenizer as the <a href="${up}">${INDEX}</a>. Other models tokenize differently, so read these as approximate and compare them with each other.</li>
    <li>Servers that connect to a database before answering, expose nothing until configured, or require a product subcommand are in the list above, not silently absent.</li>
  </ul>

  <h2>What to do about it</h2>
  <p class="note">The cheapest MCP server is the one that is not connected. The second cheapest is one that exposes the tools a session needs and no more: disable toolsets you do not use, and prefer a server that can return its tool list on demand rather than one that sends all 73 at startup.</p>
  <pre ${KEEP}>npx ctxcap --compare     # your AGENTS.md, against the Context Budget Index
npx ctxcap init --agents mcp   # four tools, about 500 tokens</pre>
  <p class="small">Data for this month: <a href="${REPO}/blob/main/mcp-index/${esc(data.month)}.json">${esc(data.month)}.json</a>. <a href="${REPO}/blob/main/mcp-index/README.md">Method and how to rebuild it.</a> Found a server that should be here? <a href="${REPO}/issues">Open an issue.</a></p>${others.length === 0 ? '' : `
  <p class="small">Other months: ${others.map((month) => `<a href="${up}mcp/${month}/">${esc(monthName(month))}</a>`).join(' · ')}</p>`}
</main>
</body>
</html>
`;
}

/** Every file the MCP part of the site consists of, as { 'relative/path': content }. */
export async function site(from = 'mcp-index') {
  const names = (await readdir(from).catch(() => [])).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  if (!names.length) return {};
  const all = await Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(from, name), 'utf8'))));
  const months = all.map((data) => data.month);
  const files = { 'mcp/index.html': page(all.at(-1), { months, root: true }) };
  for (const data of all) files[`mcp/${data.month}/index.html`] = page(data, { months });
  return files;
}

export async function build({ from = 'mcp-index', out = 'docs' } = {}) {
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
