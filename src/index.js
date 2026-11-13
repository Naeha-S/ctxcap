#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from './config.js';
import { collectFiles } from './glob.js';
import { countTokens } from './tokenize.js';
import { loadBaseline, saveBaseline, BASELINE_FILE } from './baseline.js';
import { buildReport, renderText, renderSarif, exitCodeFor } from './report.js';
import { suggest } from './suggest.js';
import { VERSION } from './version.js';
import { findStale, staleDiff } from './stale.js';
import { makePlan, savePlan, loadPlan, verifyPlan } from './plan.js';

const HELP = `ctxcap — token budget linter for context files

Usage: ctxcap [options]

  --json              machine-readable report on stdout
  --sarif             SARIF 2.1.0 on stdout
  --suggest           include compression suggestions
  --fail-on <mode>    increase | budget | stale | never  (default: never)
  --stale             find dead paths, commands, globs, and references
  --stale-glob        include globs that match no files
  --stale-fix         print a deletion diff for stale findings (never writes)
  --plan              print a ranked context-budget edit plan
  --apply             apply the generated plan atomically
  --verify <planId>   verify a previously saved plan
  --budget <n>        target budget for --plan
  --strict-preserve    exclude all load-bearing spans from plans
  --max-condense-chars <n>  maximum condensed replacement length (default: 320)
  --baseline <ref>    read baseline from a git ref (CI uses merge base)
  --update-baseline   write ${BASELINE_FILE} and exit
  --config <path>     config file (default: .ctxcap.json)
  --root <path>       working directory (default: .)
  --help, --version

Exit: 0 clean, 1 breach under --fail-on, 2 internal error.
No network. No telemetry. No API key.`;

function parseArgs(argv) {
  const o = { json: false, sarif: false, suggest: false, stale: false, staleGlob: false, staleFix: false, plan: false, apply: false, verify: null, budget: null, strictPreserve: false, maxCondenseChars: 320, minTokens: 20, updateBaseline: false, failOn: null, baseline: null, config: null, root: '.' };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--sarif') o.sarif = true;
    else if (a === '--suggest') o.suggest = true;
    else if (a === '--stale') o.stale = true;
    else if (a === '--stale-glob') { o.stale = true; o.staleGlob = true; }
    else if (a === '--stale-fix') { o.stale = true; o.staleFix = true; }
    else if (a === '--plan') o.plan = true;
    else if (a === '--apply') o.apply = true;
    else if (a === '--verify') o.verify = need(i++, a);
    else if (a === '--budget') o.budget = Number(need(i++, a));
    else if (a === '--strict-preserve') o.strictPreserve = true;
    else if (a === '--max-condense-chars') o.maxCondenseChars = Number(need(i++, a));
    else if (a === '--min-tokens') o.minTokens = Number(need(i++, a));
    else if (a === '--update-baseline') o.updateBaseline = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version') o.version = true;
    else if (a === '--fail-on') o.failOn = need(i++, a);
    else if (a === '--baseline') o.baseline = need(i++, a);
    else if (a === '--config') o.config = need(i++, a);
    else if (a === '--root') o.root = need(i++, a);
    else throw new Error(`unknown argument: ${a}. Run ctxcap --help`);
  }
  if (o.failOn && !['increase', 'budget', 'stale', 'never'].includes(o.failOn)) {
    throw new Error(`--fail-on must be increase | budget | stale | never, got "${o.failOn}"`);
  }
  if (o.failOn === 'never') o.failOn = null;
  if (o.failOn === 'stale') o.stale = true;
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }

  const root = path.resolve(opts.root);
  const config = await loadConfig(root, opts.config);
  if (opts.failOn) config.failOn = opts.failOn;

  const paths = await collectFiles(root, config);
  const files = [];
  for (const p of paths) {
    const text = await readFile(path.join(root, p), 'utf8');
    files.push({ path: p, text, tokens: countTokens(text) });
  }

  if (opts.verify) {
    const plan = await loadPlan(root, opts.verify);
    const result = await verifyPlan(plan, root);
    console.log(JSON.stringify(result, null, 2));
    return result.satisfied ? 0 : 1;
  }

  if (opts.updateBaseline) {
    const counts = Object.fromEntries(files.map((f) => [f.path, f.tokens]));
    await saveBaseline(root, counts);
    console.error(`baseline written: ${files.length} files`);
    return 0;
  }

  const baseline = await loadBaseline(root, opts.baseline);
  const baselineCounts = baseline?.counts ?? {};
  for (const file of files) file.baselineTokens = baselineCounts[file.path];
  if (opts.plan) {
    const budget = opts.budget ?? config.budgets.total;
    const plan = await makePlan({ files, root, config, budget, apply: opts.apply, strictPreserve: opts.strictPreserve, maxCondenseChars: opts.maxCondenseChars, minTokens: opts.minTokens });
    await savePlan(root, plan);
    console.log(JSON.stringify(plan, null, 2));
    return plan.satisfiable && (!opts.apply || plan.missed?.length === 0) ? 0 : 1;
  }
  const findings = opts.stale
    ? await findStale(files, root, config, { staleGlob: opts.staleGlob })
    : [];

  const report = buildReport({
    files,
    baseline,
    config,
    suggestions: opts.suggest ? suggest(files) : [],
    findings,
    staleDiff: opts.staleFix ? staleDiff(files, findings) : ''
  });

  if (opts.sarif) console.log(JSON.stringify(renderSarif(report), null, 2));
  else if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderText(report));

  return exitCodeFor(report, config.failOn);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    const code = err.code ?? 'TOKENIZER_FAILED';
    const output = { error: { code, message: err.message, ...(err.fix ? { fix: err.fix } : {}) } };
    if (process.stdout.isTTY) console.error(JSON.stringify(output));
    else console.log(JSON.stringify(output));
    process.exit(code === 'GIT_UNAVAILABLE' || code === 'TOKENIZER_FAILED' ? 2 : 1);
  });
