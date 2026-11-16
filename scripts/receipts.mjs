#!/usr/bin/env node
// Dead references in real context files, checked against the repositories they
// point into. One row is a factual claim: this line names a path, and the path
// does not exist on the default branch. Each finding is then read by a person,
// because the scanner is precise but not omniscient; `receipts/reviews.json`
// records that reading, and only reviewed defects are published.
//
//   node scripts/receipts.mjs
//   node scripts/receipts.mjs --month 2026-11 --offline
//   node scripts/receipts.mjs --top 5        # only the top repositories
//
// Uses `gh api`, so it needs an authenticated gh and a GitHub token. Every
// response is cached under .ctxcap/receipts-cache/, which git ignores: a rerun
// from a warm cache is offline and byte-identical. Repositories whose tree
// GitHub truncates are listed as not scanned, not guessed at.
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { findStale } from '../src/stale.js';
import { countTokens } from '../src/tokenize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
export const CACHE = path.join(ROOT, '.ctxcap', 'receipts-cache');
const PACKAGE_LIMIT = 20;

const HELP = `receipts — dead references in the most-starred context files

Usage: node scripts/receipts.mjs [options]

  --month <yyyy-mm>  leaderboard month to read (default: the newest)
  --out <dir>        output directory (default: receipts)
  --cache <dir>      response cache (default: .ctxcap/receipts-cache)
  --top <n>          only the first n repositories in the month
  --offline          fail on a cache miss instead of calling gh
  --refresh          ignore the cache and fetch everything again
  --no-prs           do not write the patches under receipts/prs/

Reads each repository's default branch through the GitHub API. Needs an
authenticated gh. No repository is cloned and no file is written outside the
temporary directory.`;

const cacheFile = (cache, key) => path.join(cache, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);

/** One GitHub API response, from the cache or from gh. */
export function ghApi(endpoint, { cache = CACHE, offline = false, refresh = false } = {}) {
  const file = cacheFile(cache, endpoint);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  if (offline) throw new Error(`offline and not cached: ${endpoint}`);
  const result = spawnSync('gh', ['api', endpoint], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
  if (result.status !== 0) throw new Error(`gh api ${endpoint}: ${(result.stderr || '').trim().slice(0, 300)}`);
  const data = JSON.parse(result.stdout);
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, `${JSON.stringify(data)}\n`);
  return data;
}

const decode = (blob) => Buffer.from(String(blob.content ?? '').replace(/\n/g, ''), 'base64').toString('utf8');
const dirOf = (ref) => (ref.includes('/') ? path.posix.dirname(ref) : '');
const stemOf = (ref) => ref.replace(/\.[^./]+$/, '');
const baseOf = (ref) => path.posix.basename(ref);

/**
 * Why a reference could be dead: a directory with the same stem, or a sibling
 * with the same stem and another extension. Evidence is not a verdict; the
 * review file is.
 */
export function evidenceFor(ref, paths) {
  const value = ref.replace(/^[@#]/, '');
  const stem = stemOf(value);
  const dir = dirOf(value);
  const asDirectory = paths.filter((entry) => entry === stem || entry.startsWith(`${stem}/`)).slice(0, 5);
  const renamed = paths.filter((entry) => dirOf(entry) === dir && stemOf(entry) === stem && entry !== value).slice(0, 5);
  return { asDirectory, renamed };
}

export function reviewKey(repo, ref) {
  return `${repo}#${ref.replace(/^[@#]/, '')}`;
}

/** Human-readable sentence for one finding, used in the page and the PR body. */
export function findingSentence(finding) {
  return `\`${finding.ref}\` does not exist at ${finding.path}:${finding.line}.`;
}

export function datum({ month, date, results, reviews, source, checked, top }) {
  const verified = [];
  const excluded = [];
  const unreviewed = [];
  const unscanned = [];
  for (const result of results) {
    if (result.error) {
      unscanned.push({ repo: result.repo, reason: result.error });
      continue;
    }
    const rows = [];
    for (const finding of result.findings) {
      const key = reviewKey(result.repo, finding.ref);
      const review = reviews[key];
      const record = {
        repo: result.repo,
        stars: result.stars,
        path: finding.path,
        line: finding.line,
        rule: finding.rule,
        ref: finding.ref,
        text: finding.text,
        reclaimableTokens: finding.reclaimableTokens,
        before: finding.before ?? null,
        after: finding.after ?? null,
        evidence: evidenceFor(finding.ref, result.paths),
        ...(review ? { review } : {})
      };
      if (!review) unreviewed.push(record);
      else if (review.status === 'defect') rows.push(record);
      else excluded.push({ ...record, reason: review.reason });
    }
    if (rows.length) {
      verified.push({ repo: result.repo, stars: result.stars, tokens: result.tokens, findings: rows });
    }
  }
  return {
    title: 'Dead references in the most-starred context files',
    month,
    measured: date,
    source,
    top,
    checked,
    repositoriesWithDefects: verified.length,
    totals: {
      findings: results.reduce((sum, result) => sum + (result.findings?.length ?? 0), 0),
      verified: verified.reduce((sum, repo) => sum + repo.findings.length, 0),
      excluded: excluded.length,
      unreviewed: unreviewed.length,
      notScanned: unscanned.length
    },
    verified,
    excluded,
    unreviewed,
    unscanned
  };
}

export function markdown(data) {
  const scanned = data.checked - data.totals.notScanned;
  const lines = [
    `# ${data.title}, ${data.month}`,
    '',
    `${data.checked} repositories were selected; ${scanned} were scanned on their default branch. ${data.totals.findings} references failed to resolve. Each was read by hand: ${data.totals.verified} are defects, ${data.totals.excluded} are naming examples or alternatives.`,
    ''
  ];
  if (!data.verified.length) {
    lines.push('No verified defects this month.', '');
  } else {
    lines.push('## Verified', '', '| Repository | File:line | Reference | The line |', '| --- | --- | --- | --- |');
    for (const repo of data.verified) {
      for (const finding of repo.findings) {
        lines.push(`| [${repo.repo}](https://github.com/${repo.repo}) | \`${finding.path}:${finding.line}\` | \`${finding.ref}\` | ${finding.text.replace(/\|/g, '\\|').slice(0, 160)} |`);
      }
    }
    lines.push('');
  }
  if (data.excluded.length) {
    lines.push('## Read and excluded', '', '| Repository | Reference | Why it is not a defect |', '| --- | --- | --- |',
      ...data.excluded.map((finding) => `| [${finding.repo}](https://github.com/${finding.repo}) | \`${finding.ref}\` | ${finding.reason.replace(/\|/g, '\\|')} |`), '');
  }
  if (data.unreviewed.length) {
    lines.push('## Found, not yet reviewed', '', ...data.unreviewed.map((finding) => `- ${finding.repo} ${finding.path}:${finding.line} \`${finding.ref}\``), '');
  }
  if (data.unscanned.length) {
    lines.push('## Not scanned', '', ...data.unscanned.map((entry) => `- ${entry.repo}: ${entry.reason}`), '');
  }
  lines.push(
    'Found with `ctxcap --stale`, which checks paths, globs, and `npm run`',
    'scripts against the repository. A finding is a reference that does not',
    'resolve; whether the line is wrong is a judgment, which is why every row',
    'above was read and `receipts/reviews.json` records the reading.',
    ''
  );
  return lines.join('\n');
}

/** A unified diff that applies one reviewed replacement, or empty. */
export function patchFor(finding) {
  const { from, to } = finding.review?.replace ?? {};
  if (!from || !to || !finding.text.includes(from)) return null;
  const before = finding.before ?? null;
  const after = finding.after ?? null;
  const start = finding.line - (before === null ? 0 : 1);
  const oldCount = (before === null ? 0 : 1) + 1 + (after === null ? 0 : 1);
  const body = [
    ...(before === null ? [] : [` ${before}`]),
    `-${finding.text}`,
    `+${finding.text.replace(from, to)}`,
    ...(after === null ? [] : [` ${after}`])
  ];
  return [
    `--- a/${finding.path}`,
    `+++ b/${finding.path}`,
    `@@ -${start},${oldCount} +${start},${oldCount} @@`,
    ...body,
    ''
  ].join('\n');
}

export function prBody(repo, finding, count = 1) {
  return `## What

\`${finding.path}\` line ${finding.line} tells an agent that \`${finding.ref}\` exists.
It does not:

> ${finding.text}

## Why it matters

An agent that follows this file will look for \`${finding.ref}\`, not find it, and either stop or guess. The rest of the file is unaffected.

## Fix

${finding.review?.replace?.to
    ? `Replace ${finding.review.replace.from} with ${finding.review.replace.to} on that line.`
    : 'Update or remove the reference on that line.'}

## How it was found

[ctxcap](https://github.com/Naeha-S/ctxcap) checks every path and \`npm run\` script named in a context file against the repository:

\`\`\`bash
npx ctxcap --stale
\`\`\`

It is offline and needs no key. ${count === 1 ? `This is the only finding in \`${repo}\`.` : `There are ${count} findings in \`${repo}\`; this pull request fixes one.`}
`;
}

export async function scan({ month = null, out = 'receipts', cache = CACHE, top = null, offline = false, refresh = false, prs = true } = {}) {
  const names = (await readdir('leaderboard')).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  const file = month ? `${month}.json` : names.at(-1);
  const board = JSON.parse(await readFile(path.join('leaderboard', file), 'utf8'));
  const unique = [...new Map(board.rows.map((row) => [row.repo, row])).values()];
  const selected = top ? unique.slice(0, top) : unique;
  const reviews = JSON.parse(await readFile(path.join('receipts', 'reviews.json'), 'utf8'));
  if (refresh) await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });

  const results = [];
  for (const row of selected) {
    const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-receipts-'));
    try {
      const info = ghApi(`repos/${row.repo}`, { cache, offline, refresh });
      const tree = ghApi(`repos/${row.repo}/git/trees/${encodeURIComponent(info.default_branch)}?recursive=1`, { cache, offline, refresh });
      if (tree.truncated) {
        results.push({ repo: row.repo, stars: row.stars, error: 'GitHub truncated the file tree, so absence cannot be proved' });
        process.stderr.write(`${row.repo}: tree truncated\n`);
        continue;
      }
      const entries = tree.tree.map((entry) => ({ path: entry.path, type: entry.type, sha: entry.sha, mode: entry.mode }));
      const byPath = new Map(entries.map((entry) => [entry.path, entry]));
      for (const entry of entries) {
        if (entry.type !== 'blob') continue;
        const full = path.join(dir, entry.path);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, '');
      }
      const files = [];
      const rows = board.rows.filter((candidate) => candidate.repo === row.repo);
      for (const candidate of rows) {
        const [left, right] = candidate.path.split(' → ');
        const target = right ?? left;
        const entry = byPath.get(target);
        if (!entry) continue;
        const text = decode(ghApi(`repos/${row.repo}/git/blobs/${entry.sha}`, { cache, offline, refresh }));
        const full = path.join(dir, left);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, text);
        files.push({ path: left, text, tokens: countTokens(text) });
      }
      if (!files.length) {
        results.push({ repo: row.repo, stars: row.stars, error: 'the context file named by the leaderboard no longer exists' });
        continue;
      }
      const manifests = entries.filter((entry) => entry.type === 'blob' && entry.path.endsWith('package.json'));
      for (const manifest of manifests.slice(0, PACKAGE_LIMIT)) {
        const text = decode(ghApi(`repos/${row.repo}/git/blobs/${manifest.sha}`, { cache, offline, refresh }));
        const full = path.join(dir, manifest.path);
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, text);
      }
      const ignore = byPath.get('.gitignore');
      if (ignore) await writeFile(path.join(dir, '.gitignore'), decode(ghApi(`repos/${row.repo}/git/blobs/${ignore.sha}`, { cache, offline, refresh })));

      let findings = await findStale(files, dir, {});
      // One line of context on each side, so a patch applies with plain
      // `git apply` rather than needing --unidiff-zero.
      for (const finding of findings) {
        const lines = files.find((entry) => entry.path === finding.path)?.text.split('\n') ?? [];
        finding.before = lines[finding.line - 2] ?? null;
        finding.after = lines[finding.line] ?? null;
      }
      if (manifests.length > PACKAGE_LIMIT) {
        // A script could live in a manifest that was not fetched. Drop the
        // command findings rather than publish a guess.
        findings = findings.filter((finding) => finding.rule !== 'dead-command');
      }
      results.push({
        repo: row.repo,
        stars: row.stars,
        tokens: files.reduce((sum, entry) => sum + entry.tokens, 0),
        paths: entries.filter((entry) => entry.type === 'blob').map((entry) => entry.path),
        findings
      });
      process.stderr.write(`${row.repo}: ${findings.length} findings\n`);
    } catch (error) {
      results.push({ repo: row.repo, stars: row.stars, error: error.message.slice(0, 300) });
      process.stderr.write(`${row.repo}: ${error.message}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const data = datum({ month: board.month, date, results, reviews, source: `leaderboard/${board.month}.json`, checked: selected.length, top });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, `${board.month}.json`), `${JSON.stringify(data, null, 2)}\n`);
  await writeFile(path.join(out, `${board.month}.md`), markdown(data));

  if (prs) {
    const dir = path.join(out, 'prs');
    await mkdir(dir, { recursive: true });
    const written = [];
    for (const repo of data.verified) {
      for (const finding of repo.findings) {
        const patch = patchFor(finding);
        const slug = `${repo.repo.replace('/', '-')}-${finding.ref.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
        await writeFile(path.join(dir, `${slug}.md`), prBody(repo.repo, finding, repo.findings.length));
        if (patch) await writeFile(path.join(dir, `${slug}.patch`), patch);
        written.push(slug);
      }
    }
    await writeFile(path.join(dir, 'README.md'), [
      '# Ready to send',
      '',
      'One directory pair per verified defect: a pull request body and a patch.',
      'Nothing has been sent. To send one, fork the repository, apply the patch on',
      'a branch, and open the pull request with the body:',
      '',
      '```bash',
      'gh repo fork <owner>/<name> --clone --remote',
      'git apply <slug>.patch   # or apply by hand; each patch is one line',
      'git push -u origin HEAD',
      'gh pr create --repo <owner>/<name> --title "docs: fix a dead reference in AGENTS.md" --body-file <slug>.md',
      '```',
      '',
      ...written.map((slug) => `- [${slug}](.)`),
      ''
    ].join('\n'));
  }
  return data;
}

function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--month') options.month = argv[++i];
    else if (flag === '--out') options.out = argv[++i];
    else if (flag === '--cache') options.cache = argv[++i];
    else if (flag === '--top') options.top = Number(argv[++i]);
    else if (flag === '--offline') options.offline = true;
    else if (flag === '--refresh') options.refresh = true;
    else if (flag === '--no-prs') options.prs = false;
    else throw new Error(`unknown argument: ${flag}. ${HELP}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      const data = await scan(options);
      console.error(`wrote receipts/${data.month}.json: ${data.totals.verified} verified, ${data.totals.excluded} excluded, ${data.totals.unreviewed} unreviewed`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
