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

const HELP = `ctxcap — token budget linter for context files

Usage: ctxcap [options]

  --json              machine-readable report on stdout
  --sarif             SARIF 2.1.0 on stdout
  --suggest           include compression suggestions
  --fail-on <mode>    increase | budget | never  (default: never)
  --baseline <ref>    read baseline from a git ref (CI uses merge base)
  --update-baseline   write ${BASELINE_FILE} and exit
  --config <path>     config file (default: .ctxcap.json)
  --root <path>       working directory (default: .)
  --help, --version

Exit: 0 clean, 1 breach under --fail-on, 2 internal error.
No network. No telemetry. No API key.`;

function parseArgs(argv) {
  const o = { json: false, sarif: false, suggest: false, updateBaseline: false, failOn: null, baseline: null, config: null, root: '.' };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--sarif') o.sarif = true;
    else if (a === '--suggest') o.suggest = true;
    else if (a === '--update-baseline') o.updateBaseline = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version') o.version = true;
    else if (a === '--fail-on') o.failOn = need(i++, a);
    else if (a === '--baseline') o.baseline = need(i++, a);
    else if (a === '--config') o.config = need(i++, a);
    else if (a === '--root') o.root = need(i++, a);
    else throw new Error(`unknown argument: ${a}. Run ctxcap --help`);
  }
  if (o.failOn && !['increase', 'budget', 'never'].includes(o.failOn)) {
    throw new Error(`--fail-on must be increase | budget | never, got "${o.failOn}"`);
  }
  if (o.failOn === 'never') o.failOn = null;
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log('1.0.1'); return 0; }

  const root = path.resolve(opts.root);
  const config = await loadConfig(root, opts.config);
  if (opts.failOn) config.failOn = opts.failOn;

  const paths = await collectFiles(root, config);
  const files = [];
  for (const p of paths) {
    const text = await readFile(path.join(root, p), 'utf8');
    files.push({ path: p, text, tokens: countTokens(text) });
  }

  if (opts.updateBaseline) {
    const counts = Object.fromEntries(files.map((f) => [f.path, f.tokens]));
    await saveBaseline(root, counts);
    console.error(`baseline written: ${files.length} files`);
    return 0;
  }

  const baseline = await loadBaseline(root, opts.baseline);
  const report = buildReport({
    files,
    baseline,
    config,
    suggestions: opts.suggest ? suggest(files) : []
  });

  if (opts.sarif) console.log(JSON.stringify(renderSarif(report), null, 2));
  else if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderText(report));

  return exitCodeFor(report, config.failOn);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => { console.error(`ctxcap: ${err.message}`); process.exit(2); });
