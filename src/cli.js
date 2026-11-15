import path from 'node:path';
import process from 'node:process';
import { loadConfig } from './config.js';
import { measureFiles } from './measure.js';
import { loadBaseline, saveBaseline, BASELINE_FILE } from './baseline.js';
import { buildReport, renderText, renderSarif, exitCodeFor } from './report.js';
import { suggest } from './suggest.js';
import { VERSION } from './version.js';
import { findStale, staleDiff } from './stale.js';
import { makePlan, savePlan, loadPlan, verifyPlan, staleBlock } from './plan.js';

const HELP = `ctxcap — token budget linter for context files

Usage: ctxcap [options]
       ctxcap init [--yes] [--print] [--agents <list>] [--remove] [--no-pin] [--force]

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
  --budget-class <class>=<n> budget for a load class
  --strict-preserve    exclude all load-bearing spans from plans
  --max-condense-chars <n>  maximum condensed replacement length (default: 320)
  --min-tokens <n>    minimum size of a plan finding (default: 20)
  --baseline <ref>    read baseline from a git ref (CI uses merge base)
  --update-baseline   write ${BASELINE_FILE} and exit
  --config <path>     config file (default: .ctxcap.json)
  --root <path>       working directory (default: .)
  --help, --version

init wires ctxcap into the coding agents a repository uses. It prints a diff
and writes nothing without --yes. Run ctxcap init --help for its flags.

Exit: 0 clean, 1 breach under --fail-on, 2 internal error.
No network. No telemetry. No API key.`;

function parseArgs(argv) {
  const o = { json: false, sarif: false, suggest: false, stale: false, staleGlob: false, staleFix: false, plan: false, apply: false, verify: null, budget: null, budgetClasses: {}, strictPreserve: false, maxCondenseChars: 320, minTokens: 20, updateBaseline: false, failOn: null, baseline: null, config: null, root: '.' };
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
    else if (a === '--budget-class') {
      const value = need(i++, a);
      const match = /^([^=]+)=(\d+)$/.exec(value);
      if (!match) throw new Error('--budget-class must be <class>=<n>');
      o.budgetClasses[match[1]] = Number(match[2]);
    }
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

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }

  const root = path.resolve(opts.root);
  const config = await loadConfig(root, opts.config);
  if (opts.failOn) config.failOn = opts.failOn;

  const files = await measureFiles(root, config);

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
  // Compared against a git ref (CI), growth counts as acknowledged when the
  // same change also commits a baseline that covers every file. The baseline
  // diff is then what a reviewer approves.
  const committed = opts.baseline ? await loadBaseline(root, null) : null;
  const acknowledged = Boolean(committed?.found) && files.every((file) => file.tokens <= (committed.counts[file.path] ?? -1));
  for (const file of files) file.baselineTokens = baselineCounts[file.path];
  if (opts.plan) {
    const budget = opts.budget ?? config.budgets.total;
    const plan = await makePlan({ files, root, config, budget, budgetClasses: opts.budgetClasses, apply: opts.apply, strictPreserve: opts.strictPreserve, maxCondenseChars: opts.maxCondenseChars, minTokens: opts.minTokens });
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
    acknowledged,
    // The deletion diff leaves out blocks that hold a rule; those need a hand edit.
    staleDiff: opts.staleFix ? staleDiff(files, findings.filter((finding) => staleBlock(files.find((file) => file.path === finding.path), finding.line, config).deletable)) : '',
    budgetClasses: opts.budgetClasses
  });

  if (opts.sarif) console.log(JSON.stringify(renderSarif(report), null, 2));
  else if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderText(report));

  return exitCodeFor(report, config.failOn);
}
