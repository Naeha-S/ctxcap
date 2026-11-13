import { TOKENIZER_ID, APPROXIMATE } from './tokenize.js';

export const TOOL_NAME = 'ctxcap';
export const SCHEMA_ID = 'ctxcap/v1';

export function buildReport({ files, baseline, baselineFound, config, suggestions = [], findings = [], staleDiff = '', budgetClasses = {} }) {
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
    budget: config.budgets[f.path] ?? null,
    loadClass: f.loadClass ?? 'always'
  }));

  const total = entries.reduce((a, e) => a + e.tokens, 0);
  const baseTotal = Object.values(baseCounts).reduce((a, b) => a + b, 0);
  const delta = total - baseTotal;
  const totalBudget = config.budgets.total ?? null;
  const totalByClass = entries.reduce((totals, entry) => {
    totals[entry.loadClass] = (totals[entry.loadClass] ?? 0) + entry.tokens;
    return totals;
  }, {});
  const startupTotal = (totalByClass.always ?? 0) + (totalByClass.startup ?? 0);
  const classOver = Object.entries(budgetClasses).some(([loadClass, budget]) =>
    (totalByClass[loadClass] ?? 0) > budget
  );

  const over =
    entries.some((e) => e.budget !== null && e.tokens > e.budget) ||
    (totalBudget !== null && startupTotal > totalBudget) || classOver;

  return {
    schema: SCHEMA_ID,
    approximate: APPROXIMATE,
    tokenizer: TOKENIZER_ID,
    total,
    totalByClass,
    totalBudget,
    delta,
    over,
    baselineFound: isBaselineFound,
    files: entries,
    suggestions,
    findings,
    reclaimableTotal: findings.reduce((total, finding) => total + finding.reclaimableTokens, 0),
    ...(staleDiff ? { staleDiff } : {})
  };
}

export function exitCodeFor(report, failOn) {
  if (failOn === 'increase' && report.delta > 0) return 1;
  if (failOn === 'budget' && report.over) return 1;
  if (failOn === 'stale' && report.findings?.length) return 1;
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
  if (report.findings?.length) {
    lines.push(`stale findings ${report.findings.length} (reclaimable ${report.reclaimableTotal} tokens)`);
    for (const finding of report.findings) lines.push(`${finding.rule}\t${finding.path}:${finding.line}\t${finding.text}`);
  }
  if (report.staleDiff) lines.push(report.staleDiff);
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
    }))
    .concat((report.findings ?? []).map((finding) => ({
      ruleId: finding.rule,
      level: finding.severity === 'error' ? 'error' : 'warning',
      message: { text: `${finding.text} (${finding.reclaimableTokens} reclaimable tokens)` },
      locations: [{ physicalLocation: { artifactLocation: { uri: finding.path }, region: { startLine: finding.line } } }]
    })));

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: TOOL_NAME, informationUri: `https://github.com/Naeha-S/${TOOL_NAME}`, rules: [{
        id: 'over-budget',
        shortDescription: { text: 'Context file exceeds its token budget' }
      }, ...['stale-path', 'dead-command', 'stale-glob', 'missing-ref'].map((id) => ({
        id,
        shortDescription: { text: `Context reference matches no repository file: ${id}` }
      }))] } },
      results
    }]
  };
}
