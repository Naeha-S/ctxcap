// `ctxcap hook <event>` is what the Claude Code hooks written by `ctxcap init`
// run. It answers in the hook protocol: silent when there is nothing to say,
// one JSON object on stdout otherwise. It never exits 2, which on a Stop hook
// would keep the agent from stopping.
import { stat, mkdir, writeFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from './config.js';
import { collectFiles } from './glob.js';
import { VERSION } from './version.js';

export const STAMP = '.ctxcap/stamp';

async function stdinJson() {
  if (process.stdin.isTTY) return {};
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw) ?? {}; } catch { return {}; }
}

const mtime = async (file) => {
  try { return (await stat(file)).mtimeMs; } catch { return null; }
};

async function report(root, config) {
  const [{ measureFiles }, { loadBaseline }, { buildReport }] = await Promise.all([
    import('./measure.js'), import('./baseline.js'), import('./report.js')
  ]);
  return buildReport({ files: await measureFiles(root, config), baseline: await loadBaseline(root, null), config });
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

function overBudget(result) {
  if (!result.over) return '';
  const target = result.totalBudget ?? result.files.find((file) => file.budget !== null && file.tokens > file.budget)?.budget;
  return ` Over budget: run npx ctxcap@${VERSION} --plan --budget ${target}.`;
}

/** After an edit: report only when a context file changed since the stamp. */
async function postEdit(root, input) {
  const config = await loadConfig(root, null);
  const watched = await collectFiles(root, config);
  const stampFile = path.join(root, STAMP);
  const stamp = await mtime(stampFile);

  const changed = [];
  for (const file of watched) {
    const time = await mtime(path.join(root, file));
    if (stamp !== null && time !== null && time > stamp) changed.push(file);
  }
  // The edited path is authoritative when the clock is too coarse to tell.
  const edited = typeof input.tool_input?.file_path === 'string'
    ? path.relative(root, path.resolve(root, input.tool_input.file_path)).split(path.sep).join('/')
    : null;
  if (edited && watched.includes(edited) && !changed.includes(edited)) changed.push(edited);

  if (stamp === null || changed.length > 0) {
    await mkdir(path.dirname(stampFile), { recursive: true });
    if (stamp === null) await writeFile(stampFile, '');
    const now = new Date();
    await utimes(stampFile, now, now);
  }
  if (changed.length === 0) return null;

  const result = await report(root, config);
  const parts = result.files
    .filter((file) => changed.includes(file.path))
    .map((file) => `${file.path} is ${file.tokens} tokens${result.baselineFound ? ` (${signed(file.delta)} against the baseline)` : ''}`);
  const budget = result.totalBudget === null ? '' : `, budget ${result.totalBudget}`;
  const message = `ctxcap: ${parts.join('; ')}. Context files total ${result.total} tokens${budget}.${overBudget(result)}`;
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: message } };
}

/** When the agent stops: the same check as `--json --fail-on budget`. */
async function stop(root) {
  const config = await loadConfig(root, null);
  const result = await report(root, config);
  if (!result.over) return null;
  const budget = result.totalBudget === null ? 'a file budget' : `the ${result.totalBudget} budget`;
  return { systemMessage: `ctxcap: context files are at ${result.total} tokens, over ${budget}.${overBudget(result)}` };
}

export async function hookCli(argv) {
  try {
    const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || '.');
    let output;
    if (argv[0] === 'post-edit') output = await postEdit(root, await stdinJson());
    else if (argv[0] === 'stop') output = await stop(root);
    else throw new Error(`unknown hook "${argv[0] ?? ''}"; expected post-edit or stop`);
    if (output) process.stdout.write(JSON.stringify(output) + '\n');
    return 0;
  } catch (error) {
    console.error(`ctxcap hook: ${error.message}`);
    return 1;
  }
}
