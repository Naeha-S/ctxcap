// Emits GitHub workflow-command annotations and a job summary from the report.
// Workflow commands need no token, so this works on read-only fork PRs.
import { readFile, appendFile } from 'node:fs/promises';

export const escData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
export const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function annotations(report) {
  const out = [];
  for (const f of report.files) {
    if (f.budget !== null && f.tokens > f.budget) {
      out.push(`::warning file=${escProp(f.path)},line=1,title=ctxcap::${escData(`${f.tokens} tokens, budget ${f.budget} (${f.tokens - f.budget} over)`)}`);
    }
  }
  if (report.totalBudget !== null && report.total > report.totalBudget) {
    out.push(`::warning title=ctxcap::${escData(`total ${report.total} tokens exceeds budget ${report.totalBudget}`)}`);
  }
  return out;
}

export function summary(report) {
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  const rows = report.files
    .filter((f) => f.delta !== 0 || (f.budget !== null && f.tokens > f.budget))
    .map((f) => `| \`${f.path.replace(/[`|]/g, '')}\` | ${f.tokens} | ${sign(f.delta)} |`);
  return [
    `### ctxcap: ${sign(report.delta)} tokens (${report.total} total)${report.approximate ? ', approximate' : ''}`,
    '',
    rows.length ? ['| File | Tokens | Delta |', '| --- | --- | --- |', ...rows].join('\n') : '_No token change._',
    ''
  ].join('\n');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const file = process.env.REPORT_PATH ?? 'ctxcap-report.json';
  try {
    const report = JSON.parse(await readFile(file, 'utf8'));
    for (const line of annotations(report)) console.log(line);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary(report));
  } catch (err) {
    console.log(`::notice title=ctxcap::no report to annotate (${escData(err.message)})`);
  }
}
