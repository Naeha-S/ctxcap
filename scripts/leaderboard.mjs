#!/usr/bin/env node
// What the most-starred GitHub repositories that have agent context files
// spend on them. A sample taken in star order, not a ranking of GitHub. Separate from the CLI: it talks to the GitHub API, needs a
// token, and is not part of the published package.
//
//   GITHUB_TOKEN=... npm run leaderboard -- --top 25
//
// Every API response is cached under .ctxcap/cache/. A run that finds
// everything in the cache makes no network calls and writes the same bytes.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { countTokens } from '../src/tokenize.js';
import { TOKENIZER_ID } from '../src/tokenize.js';
import { VERSION } from '../src/version.js';

export const API = 'https://api.github.com';
export const CONTEXT_FILES = ['AGENTS.md', 'CLAUDE.md'];
export const CLEAN_BELOW = 200;
const PAGE = 100;
const PAGES = 10; // the search API serves at most 1,000 results per query

const HELP = `leaderboard — what the most-starred repositories with agent context files spend on them

Usage: node scripts/leaderboard.mjs [options]

  --top <n>        repositories to include (default: 25)
  --depth <n>      how deep to look for context files (default: 1, the
                   repository root; 2 adds files one directory down, and so on)
  --month <yyyy-mm>  month in the output file name (default: this month, UTC)
  --out <dir>      output directory (default: leaderboard)
  --cache <dir>    API response cache (default: .ctxcap/cache)
  --offline        fail on a cache miss instead of calling the API
  --refresh        ignore the cache and fetch everything again
  --min-stars <n>  stop below this star count (default: 1000)
  --max-scan <n>   give up after checking this many repositories (default: 3000)

Reads the token from GITHUB_TOKEN or GH_TOKEN. Counts ${CONTEXT_FILES.join(' and ')}
on each repository's default branch.`;

export const cacheKey = (url) => `${createHash('sha256').update(url).digest('hex').slice(0, 24)}.json`;

export const searchUrl = ({ minStars, ceiling, page }) => {
  const stars = ceiling === null ? `stars:>=${minStars}` : `stars:${minStars}..${ceiling}`;
  return `${API}/search/repositories?q=${encodeURIComponent(stars)}&sort=stars&order=desc&per_page=${PAGE}&page=${page}`;
};
export const treeUrl = (repo, branch, depth = 1) => `${API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}${depth > 1 ? '?recursive=1' : ''}`;
export const contentsUrl = (repo, file, branch) => `${API}/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`;
export const blobUrl = (repo, sha) => `${API}/repos/${repo}/git/blobs/${sha}`;

const fail = (message) => Object.assign(new Error(message), { expected: true });

function parseArgs(argv) {
  const opts = { top: 25, depth: 1, month: null, out: 'leaderboard', cache: '.ctxcap/cache', offline: false, refresh: false, minStars: 1000, maxScan: 3000, help: false };
  const number = (flag, value) => {
    if (!/^\d+$/.test(value ?? '') || Number(value) < 1) throw fail(`${flag} needs a positive integer`);
    return Number(value);
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--offline') opts.offline = true;
    else if (arg === '--refresh') opts.refresh = true;
    else if (arg === '--top') opts.top = number(arg, argv[++i]);
    else if (arg === '--depth') opts.depth = number(arg, argv[++i]);
    else if (arg === '--min-stars') opts.minStars = number(arg, argv[++i]);
    else if (arg === '--max-scan') opts.maxScan = number(arg, argv[++i]);
    else if (arg === '--out' && argv[i + 1]) opts.out = argv[++i];
    else if (arg === '--cache' && argv[i + 1]) opts.cache = argv[++i];
    else if (arg === '--month') {
      opts.month = argv[++i];
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month ?? '')) throw fail('--month needs yyyy-mm');
    } else throw fail(`unknown argument: ${arg}. Run with --help`);
  }
  if (opts.offline && opts.refresh) throw fail('--offline and --refresh cannot be combined');
  return opts;
}

/** A GET that answers from the cache when it can, and records what it fetches. */
export function client({ cache, offline = false, refresh = false, token = null, fetchImpl = globalThis.fetch, log = () => {} }) {
  const stats = { cached: 0, fetched: 0, latest: '' };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function get(url) {
    const file = path.join(cache, cacheKey(url));
    if (!refresh) {
      try {
        const entry = JSON.parse(await readFile(file, 'utf8'));
        if (entry.url === url) {
          stats.cached++;
          if (entry.fetchedAt > stats.latest) stats.latest = entry.fetchedAt;
          return entry;
        }
      } catch { /* not cached, or unreadable: fetch it */ }
    }
    if (offline) throw fail(`--offline: no cached response for ${url}`);
    if (!token) throw fail('a GitHub token is required: set GITHUB_TOKEN (any token works; no scopes are needed for public repositories)');

    for (let attempt = 1; ; attempt++) {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28', 'user-agent': `ctxcap-leaderboard/${VERSION}` }
      });
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
      if (limited && attempt <= 4) {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
        const wait = Math.min(Math.max(Number(response.headers.get('retry-after')) * 1000 || reset || 0, 2000) + 1000, 90_000);
        log(`rate limited, waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (response.status >= 500 && attempt <= 3) { await sleep(1000 * attempt); continue; }
      // 404 and 451 are answers (a repository can vanish or be blocked); cache them too.
      if (!response.ok && ![404, 409, 451].includes(response.status)) {
        throw fail(`GitHub answered ${response.status} for ${url}: ${(await response.text()).slice(0, 200)}`);
      }
      const entry = { url, status: response.status, fetchedAt: new Date().toISOString(), body: response.ok ? await response.json() : null };
      await mkdir(cache, { recursive: true });
      await writeFile(file, JSON.stringify(entry) + '\n');
      stats.fetched++;
      if (entry.fetchedAt > stats.latest) stats.latest = entry.fetchedAt;
      return entry;
    }
  }
  return { get, stats };
}

const decode = (blob) => Buffer.from(blob.content ?? '', blob.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');

// "@AGENTS.md" as the whole of CLAUDE.md is Claude Code's import syntax: the
// file stands for the one beside it and costs nothing on top of it.
const importsOther = (name, text) => {
  const match = /^@(?:\.\/)?(AGENTS\.md|CLAUDE\.md)$/.exec(text.trim());
  return Boolean(match) && match[1] !== name;
};

const dirOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const baseOf = (file) => file.slice(file.lastIndexOf('/') + 1);

/** Context files of one repository down to `depth`, measured. Null when it has none. */
async function measureRepo(api, repo, depth) {
  const tree = await api.get(treeUrl(repo.full_name, repo.default_branch, depth));
  if (tree.status !== 200 || !Array.isArray(tree.body?.tree)) return null;
  const files = [];
  const aliases = [];
  const counted = new Set();
  // Real files first, so that a symlink to one of them is the alias.
  const entries = tree.body.tree
    .filter((item) => item.type === 'blob' && CONTEXT_FILES.includes(baseOf(item.path)) && item.path.split('/').length <= depth)
    .sort((a, b) => Number(a.mode === '120000') - Number(b.mode === '120000') || a.path.localeCompare(b.path, 'en'));
  for (const entry of entries) {
    const name = entry.path;
    const blob = await api.get(blobUrl(repo.full_name, entry.sha));
    if (blob.status !== 200) continue;
    let text = decode(blob.body);
    let shown = name;
    if (entry.mode === '120000') {
      // A symlink: its blob is the target path, and the contents API follows
      // it to the file an agent that opens this one would read.
      shown = `${name} → ${text.trim()}`;
      const target = await api.get(contentsUrl(repo.full_name, name, repo.default_branch));
      if (target.status !== 200 || target.body?.type !== 'file' || typeof target.body.content !== 'string') continue;
      text = decode(target.body);
    }
    // The same content under both names in one directory, or one importing
    // the other, is one file.
    const key = `${dirOf(name)}\n${createHash('sha256').update(text).digest('hex')}`;
    if (counted.has(key) || importsOther(baseOf(name), text)) { aliases.push(name); continue; }
    counted.add(key);
    files.push({ path: shown, sha: entry.sha, tokens: countTokens(text) });
  }
  if (files.length === 0) return null;
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  // GitHub cuts very large recursive listings short; nested files may be missing then.
  return { repo: repo.full_name, stars: repo.stargazers_count, files, aliases, ...(tree.body.truncated ? { truncated: true } : {}) };
}

/** Walks repositories from the most stars down until `top` of them have a context file. */
export async function collect(api, { top, depth = 1, minStars = 1000, maxScan = 3000, log = () => {} }) {
  const found = [];
  const visited = new Set();
  let ceiling = null;
  let scanned = 0;

  search: for (;;) {
    let lowest = null;
    let fresh = 0;
    for (let page = 1; page <= PAGES; page++) {
      const { body } = await api.get(searchUrl({ minStars, ceiling, page }));
      const items = body?.items ?? [];
      for (const repo of items) {
        lowest = repo.stargazers_count;
        if (visited.has(repo.full_name)) continue;
        visited.add(repo.full_name);
        fresh++;
        if (repo.archived || repo.disabled) continue;
        scanned++;
        const entry = await measureRepo(api, repo, depth);
        if (entry) {
          found.push(entry);
          log(`${String(found.length).padStart(3)}/${top}  ${entry.repo}  ${entry.files.map((file) => `${file.path} ${file.tokens}`).join(', ')}`);
        }
        if (found.length >= top || scanned >= maxScan) break search;
      }
      if (items.length < PAGE) break search;
    }
    // Past 1,000 results: continue from the lowest star count reached. Stop if
    // that makes no progress (a whole window of repositories with equal stars).
    if (fresh === 0 || lowest === null || lowest === ceiling) break;
    ceiling = lowest;
  }
  return { entries: found, scanned };
}

const number = (value) => value.toLocaleString('en-US');

function delta(tokens, earlier) {
  if (earlier === undefined) return 'new';
  const change = tokens - earlier;
  return change > 0 ? `+${number(change)}` : change < 0 ? `-${number(-change)}` : '0';
}

/** Rows ranked by tokens, with repositories that keep every file small set aside. */
export function rank(entries, previous = null) {
  const earlier = new Map((previous?.rows ?? []).map((row) => [`${row.repo}:${row.path}`, row.tokens]));
  const row = (entry, file) => ({ repo: entry.repo, stars: entry.stars, path: file.path, sha: file.sha, tokens: file.tokens, delta: delta(file.tokens, earlier.get(`${entry.repo}:${file.path}`)) });
  const order = (a, b) => b.tokens - a.tokens || a.repo.localeCompare(b.repo, 'en') || a.path.localeCompare(b.path, 'en');
  const ranked = [];
  const clean = [];
  for (const entry of entries) {
    const target = entry.files.every((file) => file.tokens < CLEAN_BELOW) ? clean : ranked;
    for (const file of entry.files) target.push(row(entry, file));
  }
  return { ranked: ranked.sort(order), clean: clean.sort(order) };
}

export const title = ({ repos, depth, month }) =>
  `The ${repos} most-starred repositories containing ${depth === 1 ? 'root context files' : `context files to depth ${depth}`}, ${month}`;

export function render({ month, ranked, clean, repos, scanned, depth, truncated, fetched, previousMonth }) {
  const link = (repo) => `[${repo}](https://github.com/${repo})`;
  const rate = scanned ? Math.round((repos / scanned) * 100) : 0;
  const where = depth === 1 ? 'at the root' : `within ${depth} levels of the root`;
  const lines = [
    `# ${title({ repos, depth, month })}`,
    '',
    `This is a sample, not a ranking of GitHub. The ${number(scanned)} most-starred repositories that are not archived were checked in star order, and ${repos} of them (${rate}%) have an \`AGENTS.md\` or \`CLAUDE.md\` ${where}. The table sorts those ${repos} by what the files cost in tokens.`,
    '',
    `- Hit rate: ${repos} of ${number(scanned)} repositories checked, ${rate}%. The scan stops at hit number ${repos}, so this slightly overstates the rate.`,
    depth === 1
      ? '- Depth 1: only files at the repository root are counted. Nested `AGENTS.md` and `CLAUDE.md` files, files these import, and other rule files are not; run with `--depth 2` or more to include nested ones.'
      : `- Depth ${depth}: \`AGENTS.md\` and \`CLAUDE.md\` files up to ${depth} levels deep are counted, each as its own row. Files these import and other rule files are not.`,
    '- A symlink is counted as the file it points to, because that is what an agent that opens it reads: `AGENTS.md → README` means the agent is given the README. A file that is a copy of the one beside it, or only imports it, is counted once.',
    `- Counted with [ctxcap](https://github.com/Naeha-S/ctxcap), which uses \`${TOKENIZER_ID}\`. The counts are approximate: this is not each model's own tokenizer.`,
    `- Data fetched ${fetched || 'from cache'}, from each repository's default branch.`,
    `- Delta is against ${previousMonth ? `the ${previousMonth} file` : 'an earlier month; there is none yet, so every row is new'}.`,
    ...(truncated ? [`- ${truncated} ${truncated === 1 ? 'repository is' : 'repositories are'} too large for GitHub to list in full, so nested files there may be missing.`] : []),
    '',
    '| # | Repository | Stars | Path | Tokens | Delta |',
    '| ---: | --- | ---: | --- | ---: | ---: |',
    ...ranked.map((row, index) => `| ${index + 1} | ${link(row.repo)} | ${number(row.stars)} | \`${row.path}\` | ${number(row.tokens)} | ${row.delta} |`),
    ''
  ];
  if (ranked.length === 0) lines.splice(lines.length - 1, 0, `| | No repository has a context file of ${CLEAN_BELOW} tokens or more | | | | |`);
  if (clean.length) {
    lines.push(
      '## Clean',
      '',
      `Every context file in these repositories is under ${CLEAN_BELOW} tokens, so they are listed here and not ranked.`,
      '',
      '| Repository | Stars | Path | Tokens | Delta |',
      '| --- | ---: | --- | ---: | ---: |',
      ...clean.map((row) => `| ${link(row.repo)} | ${number(row.stars)} | \`${row.path}\` | ${number(row.tokens)} | ${row.delta} |`),
      ''
    );
  }
  return lines.join('\n');
}

async function previousBoard(out, month) {
  let names = [];
  try { names = await readdir(out); } catch { return null; }
  const earlier = names.filter((name) => /^\d{4}-\d{2}\.json$/.test(name) && name.slice(0, 7) < month).sort().pop();
  if (!earlier) return null;
  try { return JSON.parse(await readFile(path.join(out, earlier), 'utf8')); } catch { return null; }
}

export async function run(argv, { env = process.env, fetchImpl = globalThis.fetch, now = new Date(), log = (line) => console.error(line) } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  const month = opts.month ?? now.toISOString().slice(0, 7);
  const api = client({ cache: opts.cache, offline: opts.offline, refresh: opts.refresh, token: env.GITHUB_TOKEN || env.GH_TOKEN || null, fetchImpl, log });

  const { entries, scanned } = await collect(api, { top: opts.top, depth: opts.depth, minStars: opts.minStars, maxScan: opts.maxScan, log });
  const previous = await previousBoard(opts.out, month);
  const { ranked, clean } = rank(entries, previous);
  const fetched = api.stats.latest.slice(0, 10);

  const data = {
    title: title({ repos: entries.length, depth: opts.depth, month }),
    month, tokenizer: TOKENIZER_ID, fetched, depth: opts.depth, checked: scanned, found: entries.length,
    hitRate: scanned ? Number((entries.length / scanned).toFixed(3)) : 0, cleanBelow: CLEAN_BELOW,
    rows: [...ranked.map((row, index) => ({ rank: index + 1, ...row })), ...clean.map((row) => ({ rank: null, clean: true, ...row }))]
  };
  await mkdir(opts.out, { recursive: true });
  const base = path.join(opts.out, month);
  await writeFile(`${base}.md`, render({
    month, ranked, clean, repos: entries.length, scanned, depth: opts.depth, fetched,
    truncated: entries.filter((entry) => entry.truncated).length, previousMonth: previous?.month ?? null
  }));
  await writeFile(`${base}.json`, JSON.stringify(data, null, 2) + '\n');

  log(`${entries.length} repositories (${clean.length ? `${new Set(clean.map((row) => row.repo)).size} clean` : 'none clean'}), ${scanned} checked; ${api.stats.fetched} API calls, ${api.stats.cached} from cache`);
  log(`wrote ${base}.md and ${base}.json`);
  if (entries.length < opts.top) log(`note: found ${entries.length} of ${opts.top}; raise --max-scan or lower --min-stars`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(error.expected ? `leaderboard: ${error.message}` : error);
    process.exitCode = 1;
  });
}
