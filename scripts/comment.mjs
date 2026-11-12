import { readFile } from 'node:fs/promises';

const MARKER = '<!-- ctxlint -->';
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const issue = process.env.PR_NUMBER;
const api = process.env.GITHUB_API_URL ?? 'https://api.github.com';

if (!token || !repo || !issue) {
  console.error('missing env: GITHUB_TOKEN, GITHUB_REPOSITORY, PR_NUMBER');
  process.exit(0);
}

const report = JSON.parse(await readFile(process.env.REPORT_PATH ?? 'ctxlint-report.json', 'utf8'));
const sign = (n) => (n > 0 ? `+${n}` : `${n}`);

const rows = report.files
  .filter((f) => f.delta !== 0 || (f.budget !== null && f.tokens > f.budget))
  .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  .map((f) => {
    const flag = f.budget !== null && f.tokens > f.budget ? ' :warning:' : '';
    return `| \`${f.path.replace(/[`|]/g, '')}\` | ${f.tokens} | ${sign(f.delta)}${flag} |`;
  });

const body = [
  MARKER,
  `**ctxlint** — ${sign(report.delta)} tokens (${report.total} total)${report.approximate ? ', approximate' : ''}`,
  '',
  rows.length
    ? ['| File | Tokens | Delta |', '| --- | --- | --- |', ...rows].join('\n')
    : '_No token change._',
  report.suggestions?.length
    ? ['', '<details><summary>Suggestions</summary>', '', ...report.suggestions.map((s) => `- \`${s.path.replace(/[`|]/g, '')}\` — ${s.reason.replace(/[<>`]/g, '')}`), '', '</details>'].join('\n')
    : ''
].join('\n');

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'Content-Type': 'application/json',
  'User-Agent': 'ctxlint'
};

// Find-then-update so we never post more than one comment.
const list = await fetch(`${api}/repos/${repo}/issues/${issue}/comments?per_page=100`, { headers });
const existing = (await list.json()).find((c) => c.body?.startsWith(MARKER));

const url = existing
  ? `${api}/repos/${repo}/issues/comments/${existing.id}`
  : `${api}/repos/${repo}/issues/${issue}/comments`;

const res = await fetch(url, {
  method: existing ? 'PATCH' : 'POST',
  headers,
  body: JSON.stringify({ body })
});

if (!res.ok) console.error(`comment failed: ${res.status} ${await res.text()}`);
