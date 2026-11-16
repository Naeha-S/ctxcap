// One deterministic line about a repository's context files. No random
// choice, no network, no model: the same repository gets the same sentence on
// every machine, forever, which is what makes it quotable.
import path from 'node:path';
import { loadConfig } from './config.js';
import { measureFiles } from './measure.js';
import { findStale } from './stale.js';

const number = (n) => n.toLocaleString('en-US');

// Ordered by size. The boundaries are the ones that change the sentence, not
// round numbers chosen for looks; 1,000 tokens is roughly the median file in
// the Context Budget Index, so the line changes character around there.
export const ROASTS = [
  [200, 'Short enough to read and too short to say anything.'],
  [500, 'A sticky note with delusions of governance.'],
  [1000, 'A polite suggestion wearing the word "rules".'],
  [2000, 'Half of it is a table of contents.'],
  [4000, 'The rules are longer than most of the tasks.'],
  [8000, 'This is a short story, not an instruction file.'],
  [Infinity, 'This is a novella, and the agent is only pretending to have read it.']
];

export function roastFor({ files = [], findings = [] } = {}) {
  const largest = files.reduce((biggest, file) => (file.tokens > biggest.tokens ? file : biggest), { path: null, tokens: 0 });
  const tokens = largest.tokens;
  if (!files.length) {
    return { tokens: 0, file: null, roast: 'No context files. The agent is working from vibes.' };
  }
  if (findings.length) {
    const refs = findings.length === 1 ? 'reference' : 'references';
    return {
      tokens,
      file: largest.path,
      roast: `${number(tokens)} tokens and ${findings.length} ${refs} that no longer resolve. Confident and wrong.`
    };
  }
  const [, line] = ROASTS.find(([limit]) => tokens < limit) ?? ROASTS.at(-1);
  return { tokens, file: largest.path, roast: `${number(tokens)} tokens. ${line}` };
}

const HELP = `ctxcap roast — one line about this repository's context files

Usage: ctxcap roast [--json] [--stale] [--root <path>] [--config <path>]

  --json    {"tokens", "file", "roast"} on stdout
  --stale   count references that no longer resolve, and say so

Deterministic: no randomness and no network. Exit code is always 0.
`;

export async function roastCli(argv) {
  const options = { json: false, stale: false, root: '.', config: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--stale') options.stale = true;
    else if (arg === '--root') options.root = argv[++i];
    else if (arg === '--config') options.config = argv[++i];
    else if (arg === '--help' || arg === '-h') { console.log(HELP); return 0; }
    else throw Object.assign(new Error(`unknown argument: ${arg}. Run ctxcap roast --help`), { code: 'USAGE' });
  }
  const root = path.resolve(options.root);
  const config = await loadConfig(root, options.config);
  const files = await measureFiles(root, config);
  const findings = options.stale && files.length ? await findStale(files, root, config) : [];
  const result = roastFor({ files, findings });
  if (options.json) console.log(JSON.stringify(result));
  else console.log(result.roast);
  return 0;
}
