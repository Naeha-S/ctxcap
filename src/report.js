import { TOKENIZER_ID, APPROXIMATE } from './tokenize.js';

export const TOOL_NAME = 'ctxcap';
export const SCHEMA_ID = 'ctxcap/v1';

export function buildReport({ files, baseline, baselineFound, config, suggestions = [] }) {
  const baseCounts = baseline && typeof baseline === 'object' && 'counts' in baseline ? baseline.counts : (baseline ?? {});
  const isBaselineFound = baselineFound !== undefined
    ? Boolean(baselineFound)
    : (baseline && typeof baseline === 'object' && 'found' in baseline
      ? Boolean(baseline.found)
      : Object.keys(baseCounts).length > 0);

  const entries = files.map((f) => ({
    path: f.path,
    tokens: f.tokens,
    delta: f.tokens - (baseCounts[f.path] ?? 0),
    budget: config.budgets[f.path] ?? null
  }));

  const total = entries.reduce((a, e) => a + e.tokens, 0);
  const baseTotal = Object.values(baseCounts).reduce((a, b) => a + b, 0);
  const delta = total - baseTotal;
  const totalBudget = config.budgets.total ?? null;

  const over =
    entries.some((e) => e.budget !== null && e.tokens > e.budget) ||
    (totalBudget !== null && total > totalBudget);

  return {
    schema: SCHEMA_ID,
    approximate: APPROXIMATE,
    tokenizer: TOKENIZER_ID,
    total,
    totalBudget,
    delta,
    over,
    baselineFound: isBaselineFound,
    files: entries,
    suggestions
  };
}

export function exitCodeFor(report, failOn) {
  if (failOn === 'increase' && report.delta > 0) return 1;
  if (failOn === 'budget' && report.over) return 1;
  return 0;
}

export function renderText(report) {
  const lines = [];
  const sign = (n) => (n > 0 ? `+${n}` : `${n}`);
  lines.push('TOKENS\tDELTA\tFILE');
  for (const f of report.files) {
    const flag = f.budget !== null && f.tokens > f.budget ? ' OVER' : '';
    lines.push(`${f.tokens}\t${sign(f.delta)}\t${f.path}${flag}`);
  }
  lines.push('---');
  lines.push(`total ${report.total} (${sign(report.delta)})`);
  if (!report.baselineFound) {
    lines.push('no baseline found — delta is the full current size');
    lines.push(`run: ${TOOL_NAME} --update-baseline`);
  }
  if (report.approximate) lines.push(`approximate count (${report.tokenizer})`);
  return lines.join('\n');
}

export function renderSarif(report) {
  const results = report.files
    .filter((f) => f.budget !== null && f.tokens > f.budget)
    .map((f) => ({
      ruleId: 'over-budget',
      level: 'warning',
      message: { text: `${f.path} is ${f.tokens} tokens, budget ${f.budget}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: f.path }, region: { startLine: 1 } } }]
    }));

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: TOOL_NAME, informationUri: `https://github.com/Naeha-S/${TOOL_NAME}`, rules: [{
        id: 'over-budget',
        shortDescription: { text: 'Context file exceeds its token budget' }
      }] } },
      results
    }]
  };
}
