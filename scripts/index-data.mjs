#!/usr/bin/env node
// Builds data/context-index.json, the offline copy of the leaderboard that
// `ctxcap --compare` reads. Shipping it with the package is what makes
// --compare work with no network call; a test keeps it in step with
// leaderboard/<yyyy-mm>.json.
//
//   node scripts/index-data.mjs
//   node scripts/index-data.mjs --month 2026-11 --out data
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const NAME = 'The Context Budget Index';

const HELP = `index-data — build data/context-index.json from a monthly leaderboard

Usage: node scripts/index-data.mjs [options]

  --from <dir>       leaderboard directory (default: leaderboard)
  --out <dir>        output directory (default: data)
  --month <yyyy-mm>  month to read (default: the newest .json there)
`;

export function indexFrom(data) {
  const files = data.rows.map((row) => ({ repo: row.repo, path: row.path, tokens: row.tokens }));
  return {
    name: NAME,
    month: data.month,
    fetched: data.fetched,
    tokenizer: data.tokenizer,
    unit: 'file',
    measured: files.length,
    repositories: new Set(files.map((file) => file.repo)).size,
    source: `leaderboard/${data.month}.json`,
    files,
    tokens: files.map((file) => file.tokens).sort((a, b) => a - b)
  };
}

export async function readMonth({ from = 'leaderboard', month = null } = {}) {
  const names = (await readdir(from)).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  if (!names.length) throw new Error(`no <yyyy-mm>.json in ${from}`);
  const name = month ? `${month}.json` : names.at(-1);
  if (!names.includes(name)) throw new Error(`no ${name} in ${from}`);
  return JSON.parse(await readFile(path.join(from, name), 'utf8'));
}

export async function build({ from = 'leaderboard', out = 'data', month = null } = {}) {
  const data = await readMonth({ from, month });
  const index = indexFrom(data);
  await mkdir(out, { recursive: true });
  const file = path.join(out, 'context-index.json');
  await writeFile(file, `${JSON.stringify(index, null, 2)}\n`);
  return { file, index };
}

function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--from') options.from = argv[++i];
    else if (flag === '--out') options.out = argv[++i];
    else if (flag === '--month') options.month = argv[++i];
    else throw new Error(`unknown argument: ${flag}. ${HELP}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      const { file, index } = await build(options);
      console.error(`wrote ${file}: ${index.measured} files from ${index.repositories} repositories, ${index.month}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
