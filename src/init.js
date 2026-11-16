import { readFile, writeFile, mkdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { unifiedDiff } from './diff.js';
import { VERSION } from './version.js';
import { GROUPS, DEFAULT_GROUPS, BEGIN, END, targetsFor } from './wire.js';

const HELP = `ctxcap init — wire ctxcap into the coding agents a repository uses

Usage: ctxcap init [options]

  --yes               apply the diff (without it, nothing is written)
  --print             print the diff and exit 0
  --agents <list>     comma-separated subset of ${GROUPS.join(',')}
                      (default: ${DEFAULT_GROUPS.join(',')}; mcp is opt-in)
  --remove            undo what init wrote, for every agent unless --agents is given
  --force             overwrite targets that ctxcap init did not write
  --no-pin            write "npx ctxcap" instead of "npx ctxcap@${VERSION}"
  --root <path>       repository root (default: .)

--yes brings everything init wrote up to date, including pins from an older
version. A file or entry at a ctxcap path that init did not write is left
alone and reported; --force overwrites it.

The diff goes to stdout and the per-file status to stderr.
Exit: 0 done, 3 when a target was left alone and needs --force, 2 bad usage.`;

// ---------------------------------------------------------------- text helpers

const sameText = (a, b) => a === b || a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
const eolOf = (text) => (text && text.includes('\r\n') ? '\r\n' : '\n');
const PIN = /ctxcap@v?(\d+\.\d+\.\d+)/g;
const pinsIn = (text) => [...new Set([...text.matchAll(PIN)].map((match) => match[1]))];

function blockSpan(text) {
  const start = text.indexOf(BEGIN.slice(0, -4));
  if (start < 0) return null;
  const close = text.indexOf(END, start);
  if (close < 0) return null;
  const open = text.slice(start, text.indexOf('-->', start) + 3);
  return { start, end: close + END.length, noeol: open.includes('noeol') };
}

function renderBlock(lines, eol, noeol = false) {
  const begin = noeol ? BEGIN.replace(' -->', ' noeol -->') : BEGIN;
  return [begin, ...lines, END].join(eol);
}

function addBlock(text, target) {
  if (text === null || text === '') return renderBlock(target.lines, '\n') + '\n';
  const eol = eolOf(text);
  if (target.place === 'after-h1' && /^# .*\r?\n/.test(text)) {
    const cut = text.indexOf('\n') + 1;
    return text.slice(0, cut) + eol + renderBlock(target.lines, eol) + eol + text.slice(cut);
  }
  if (text.endsWith('\n')) return text + eol + renderBlock(target.lines, eol) + eol;
  return text + eol + eol + renderBlock(target.lines, eol, true) + eol;
}

function replaceBlock(text, target) {
  const span = blockSpan(text);
  return text.slice(0, span.start) + renderBlock(target.lines, eolOf(text), span.noeol) + text.slice(span.end);
}

// Removes the block and exactly the separators addBlock put around it.
function stripBlock(text) {
  const span = blockSpan(text);
  let { start, end } = span;
  end += /^\r?\n/.exec(text.slice(end))?.[0].length ?? 0;
  for (let i = 0; i < (span.noeol ? 2 : 1); i++) {
    if (text.slice(0, start).endsWith('\r\n')) start -= 2;
    else if (text.slice(0, start).endsWith('\n')) start -= 1;
  }
  return text.slice(0, start) + text.slice(end);
}

// ---------------------------------------------------------------- .gitignore

// A `.ctxcap/` line in the root .gitignore hides the whole directory, and a
// .gitignore inside an ignored directory is never read. init narrows that line
// to the two things that are not source, and keeps the original inside the
// block so that remove can put it back byte for byte.
const IGNORE_BEGIN = '# ctxcap:begin';
const IGNORE_END = '# ctxcap:end';
const IGNORE_WAS = '# ctxcap:was ';
const SHADOW = /^\s*\/?\.ctxcap(?:\/|\/\*{1,2})?\s*$/;
const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const bare = (line) => line.replace(/\r?\n$/, '');
const eolAt = (line) => /\r?\n$/.exec(line)?.[0] ?? '';

function restoreIgnore(text) {
  const lines = linesOf(text);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (bare(lines[i]) === IGNORE_BEGIN) {
      const end = lines.findIndex((line, j) => j > i && bare(line) === IGNORE_END);
      const was = end > i ? lines.slice(i + 1, end).find((line) => line.startsWith(IGNORE_WAS)) : undefined;
      if (was !== undefined) {
        out.push(bare(was).slice(IGNORE_WAS.length) + eolAt(lines[end]));
        i = end;
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out.join('');
}

function narrowIgnore(text, target) {
  const fallback = eolOf(text);
  return linesOf(restoreIgnore(text)).map((line) => {
    if (!SHADOW.test(bare(line))) return line;
    const eol = eolAt(line) || fallback;
    return [IGNORE_BEGIN, IGNORE_WAS + bare(line), ...target.lines].map((entry) => entry + eol).join('') + IGNORE_END + eolAt(line);
  }).join('');
}

// ---------------------------------------------------------------- json helpers

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(text) {
  try {
    const doc = JSON.parse(text);
    if (!isObject(doc)) return null;
    return { doc, indent: /^[{[]\r?\n([ \t]+)/.exec(text)?.[1] ?? 2, eol: eolOf(text), final: /\n$/.test(text) };
  } catch {
    return null;
  }
}

function serialize(doc, format) {
  const body = JSON.stringify(doc, null, format.indent);
  return (format.eol === '\n' ? body : body.replace(/\n/g, format.eol)) + (format.final ? format.eol : '');
}

const NEW_JSON = { indent: 2, eol: '\n', final: true };

// ---------------------------------------------------------------- per target

/**
 * state: absent  - nothing of ours is there
 *        managed - ours, and marked as ours
 *        custom  - something sits where ours would go, without our marker
 *        invalid - a JSON file that does not parse
 *        none    - the target does not apply to this repository
 * survey() adds two more: `state` for working files, and `user` for a target
 * the user has already covered some other way.
 */
function inspect(target, text, sentinel) {
  if (target.kind === 'file') {
    if (text === null) return { state: 'absent', pins: [] };
    // A file that cannot carry a marker is owned through the sentinel beside it.
    const owned = target.sentinel ? sentinel !== null : text.includes(target.marker);
    return owned ? { state: 'managed', pins: pinsIn(text) } : { state: 'custom', pins: [] };
  }
  if (target.kind === 'block') {
    const span = text === null ? null : blockSpan(text);
    return span ? { state: 'managed', pins: pinsIn(text.slice(span.start, span.end)) } : { state: 'absent', pins: [] };
  }
  if (target.kind === 'ignore') {
    if (text === null) return { state: 'none', pins: [] };
    if (restoreIgnore(text) !== text) return { state: 'managed', pins: [] };
    return { state: linesOf(text).some((line) => SHADOW.test(bare(line))) ? 'absent' : 'none', pins: [] };
  }
  if (text === null) return { state: 'absent', pins: [] };
  const parsed = parseJson(text);
  if (!parsed) return { state: 'invalid', pins: [] };
  const marker = parsed.doc._ctxcap;
  const present = target.present(parsed.doc);
  if (isObject(marker)) {
    if (!present) return { state: 'absent', pins: [] };
    return { state: 'managed', pins: marker.pin === false || typeof marker.version !== 'string' ? [] : [marker.version] };
  }
  return { state: present ? 'custom' : 'absent', pins: [] };
}

function wired(target, text, context, { adopt = false } = {}) {
  // A checkout with CRLF line endings (git's default on Windows) is still the
  // file init wrote; rewriting it would show a change on every run.
  if (target.kind === 'file') return text !== null && sameText(text, target.content) ? text : target.content;
  if (target.kind === 'block') return text !== null && blockSpan(text) ? replaceBlock(text, target) : addBlock(text, target);
  if (target.kind === 'ignore') return narrowIgnore(text, target);
  const parsed = text === null ? { doc: {}, ...NEW_JSON } : parseJson(text);
  const { doc } = parsed;
  // Rewriting takes ours out first, so the entry and the marker always end up
  // last and in the same order as on a first write. With --force the same
  // goes for an entry of ours that somebody wrote by hand.
  if (isObject(doc._ctxcap) || adopt) target.strip(doc);
  delete doc._ctxcap;
  target.add(doc);
  doc._ctxcap = { version: context.version, ...(context.pin ? {} : { pin: false }) };
  return serialize(doc, parsed);
}

function unwired(target, text) {
  if (target.kind === 'file') return null;
  if (target.kind === 'block') return stripBlock(text) || null;
  if (target.kind === 'ignore') return restoreIgnore(text);
  const parsed = parseJson(text);
  target.strip(parsed.doc);
  delete parsed.doc._ctxcap;
  return Object.keys(parsed.doc).length === 0 ? null : serialize(parsed.doc, parsed);
}

// ---------------------------------------------------------------- planning

async function read(root, file) {
  try {
    return await readFile(path.join(root, file), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function survey({ root, version = VERSION, pin = true, groups = DEFAULT_GROUPS, force = false, targets }) {
  const context = { root, version, pin, groups, force };
  const list = targets ?? await targetsFor(context);
  const items = [];
  for (const target of list) {
    const before = await read(root, target.path);
    if (target.kind === 'state') { items.push({ target, before, state: 'state', pins: [] }); continue; }
    const sentinel = target.sentinel ? await read(root, target.sentinel.path) : null;
    let info = inspect(target, before, sentinel);
    // Ours wins; otherwise the user may already have this covered elsewhere.
    if (target.userWired && info.state !== 'managed') {
      const via = await target.userWired(root);
      if (via) info = { state: 'user', pins: [], via };
    }
    items.push({ target, before, sentinel, ...info });
  }
  return { context, items };
}

const real = (item) => item.state !== 'state' && item.state !== 'none';

const groupState = (items, group, { exclusive = false } = {}) => {
  const own = items.filter((item) => real(item) && item.target.groups.includes(group) && (!exclusive || item.target.groups.length === 1));
  if (own.every((item) => item.state === 'absent')) return 'not wired';
  if (own.some((item) => item.state === 'absent' || item.state === 'invalid')) return 'partially wired';
  return 'wired';
};

/**
 * Works out what init or remove would do, without touching the disk.
 * Each step is { path, before, after, action, reason } where action is
 * write | delete | skip | user | leave. A skip with `blocked` set is a target
 * that was left alone and still needs attention; the others are already fine.
 */
export async function planInit({ root, groups, remove = false, force = false, version, pin, targets }) {
  // Remove covers every agent unless told otherwise, so nothing is left behind.
  groups ??= remove ? GROUPS : DEFAULT_GROUPS;
  const { context, items } = await survey({ root, version, pin, groups, force, targets });
  const steps = [];
  for (const item of items) {
    const { target, before, state } = item;
    if (!target.groups.some((group) => groups.includes(group)) || state === 'none') continue;
    const step = { path: target.path, before, after: before, action: 'skip', reason: 'already configured' };
    const sentinel = target.sentinel && { path: target.sentinel.path, before: item.sentinel, reason: '' };

    // Working state (the hook stamp) is never written by init, only cleared by remove.
    if (state === 'state' && !(remove && before !== null)) continue;

    if (remove) {
      // A file shared by two agents stays while the other one still needs it.
      const needed = target.groups.some((group) => !groups.includes(group) && groupState(items, group, { exclusive: true }) !== 'not wired');
      if (needed) continue;
      // A sentinel without its file still goes.
      if (state === 'absent') {
        if (sentinel && sentinel.before !== null) steps.push({ ...sentinel, after: null, action: 'delete' });
        continue;
      }
      if (state === 'state') Object.assign(step, { after: null, action: 'delete', reason: '' });
      else if (state === 'user') Object.assign(step, { path: item.via, action: 'leave', reason: 'not written by ctxcap init' });
      else if (state !== 'managed') Object.assign(step, { action: 'leave', reason: 'not written by ctxcap init' });
      else {
        step.after = unwired(target, before);
        Object.assign(step, { action: step.after === null ? 'delete' : 'write', reason: '' });
      }
      steps.push(step);
      if (state === 'managed' && sentinel) steps.push({ ...sentinel, after: null, action: 'delete' });
      continue;
    }

    if (state === 'invalid') Object.assign(step, { blocked: true, reason: 'not valid JSON, left alone' });
    else if (state === 'user' && !(force && item.via === target.path)) Object.assign(step, { path: item.via, action: 'user', reason: target.userReason ?? 'already set up by hand' });
    else if ((state === 'custom' || state === 'user') && !force) Object.assign(step, { blocked: true, reason: 'not written by ctxcap init; --force overwrites it' });
    else {
      if (typeof target.content === 'function') target.content = await target.content();
      step.after = wired(target, before, context, { adopt: state === 'custom' });
      if (step.after !== before) Object.assign(step, { action: 'write', reason: '' });
      steps.push(step);
      if (sentinel && !(sentinel.before !== null && sameText(sentinel.before, target.sentinel.content))) steps.push({ ...sentinel, after: target.sentinel.content, action: 'write' });
      continue;
    }
    steps.push(step);
  }
  return steps;
}

export async function applySteps(root, steps) {
  for (const step of steps) {
    const file = path.join(root, step.path);
    if (step.action === 'write') {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, step.after, 'utf8');
    } else if (step.action === 'delete') {
      await rm(file, { force: true });
      // Drop the directories this left empty, never the root itself.
      for (let dir = path.dirname(file); dir !== root && dir.startsWith(root); dir = path.dirname(dir)) {
        try { await rmdir(dir); } catch { break; }
      }
    }
  }
}

export const renderDiff = (steps) => steps
  .filter((step) => step.action === 'write' || step.action === 'delete')
  .map((step) => unifiedDiff(step.path, step.before, step.after))
  .join('');

// ---------------------------------------------------------------- doctor

/**
 * Reports, per agent, whether its wiring is complete and pinned to `version`.
 * `ok` is false when any agent is partially wired or carries a stale pin.
 */
export async function doctor({ root, version = VERSION, targets }) {
  const { items } = await survey({ root, version, groups: GROUPS, targets });
  const agents = GROUPS.map((agent) => {
    const mine = items.filter((item) => real(item) && item.target.groups.includes(agent));
    const files = mine.map((item) => {
      const stale = item.pins.find((pin) => pin !== version);
      const state = item.state === 'absent' ? (item.target.kind === 'ignore' ? 'shadowed' : 'missing')
        : item.state === 'managed' ? (stale ? 'stale' : 'wired')
        : item.state;
      return { path: item.via ?? item.target.path, state, ...(stale ? { pin: stale } : {}) };
    });
    const broken = files.filter((file) => ['missing', 'invalid', 'shadowed'].includes(file.state));
    // A file shared with another agent does not make this one wired by itself.
    const own = mine.filter((item) => item.target.groups.length === 1);
    // Nor does a file of the user's that does not parse, where nothing of ours can be.
    const status = own.every((item) => item.state === 'absent' || item.state === 'invalid') ? 'not wired'
      : broken.length > 0 ? 'partially wired'
      : files.some((file) => file.state === 'stale') ? 'stale pin'
      : 'wired';
    return { agent, status, files };
  });
  return { version, ok: agents.every((entry) => entry.status === 'wired' || entry.status === 'not wired'), agents };
}

function describe(entry, version) {
  const paths = (state) => entry.files.filter((file) => file.state === state).map((file) => file.path);
  if (entry.status === 'partially wired') {
    const parts = [];
    if (paths('missing').length) parts.push(`missing ${paths('missing').join(', ')}`);
    if (paths('invalid').length) parts.push(`not valid JSON: ${paths('invalid').join(', ')}`);
    if (paths('shadowed').length) parts.push('.gitignore still ignores .ctxcap/');
    return parts.join('; ');
  }
  if (entry.status === 'stale pin') {
    return entry.files.filter((file) => file.state === 'stale').map((file) => `${file.path} has ${file.pin}`).join(', ') + `, current is ${version}`;
  }
  if (entry.status !== 'wired') return '';
  const custom = [...paths('custom'), ...paths('user')];
  return custom.length ? `by ${custom.join(', ')}, not written by ctxcap init` : '';
}

const DOCTOR_HELP = `ctxcap doctor — check the wiring ctxcap init wrote

Usage: ctxcap doctor [--json] [--root <path>]

Reports each agent as wired, not wired, partially wired, or stale pin.
Exit: 0 fine, 1 when an agent is partially wired or pinned to another version.`;

export async function doctorCli(argv, { version = VERSION } = {}) {
  let json = false;
  let root = '.';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--root' && i + 1 < argv.length) root = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') { console.log(DOCTOR_HELP); return 0; }
    else throw usage(`unknown argument: ${argv[i]}. Run ctxcap doctor --help`);
  }
  const result = await doctor({ root: path.resolve(root), version });
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const entry of result.agents) {
      const detail = describe(entry, version);
      console.log(`${entry.agent.padEnd(9)}${entry.status}${detail ? `: ${detail}` : ''}`);
    }
    if (!result.ok) console.log(`\nfix: npx ctxcap@${version} init --yes`);
    else if (result.agents.every((entry) => entry.status === 'not wired')) console.log(`\nwire it up: npx ctxcap@${version} init`);
  }
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------- CLI

function usage(message) {
  return Object.assign(new Error(message), { code: 'USAGE' });
}

function parseArgs(argv) {
  const o = { yes: false, print: false, remove: false, force: false, pin: true, groups: undefined, root: '.', help: false };
  const need = (i, flag) => {
    if (i + 1 >= argv.length) throw usage(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--print') o.print = true;
    else if (a === '--remove') o.remove = true;
    else if (a === '--force') o.force = true;
    else if (a === '--no-pin') o.pin = false;
    else if (a === '--root') o.root = need(i++, a);
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--agents') {
      o.groups = need(i++, a).split(',').map((name) => name.trim()).filter(Boolean);
      const unknown = o.groups.filter((name) => !GROUPS.includes(name));
      if (unknown.length > 0 || o.groups.length === 0) {
        throw usage(`--agents takes a comma-separated subset of ${GROUPS.join(',')}${unknown.length ? `, got "${unknown.join(',')}"` : ''}`);
      }
    }
    else throw usage(`unknown argument: ${a}. Run ctxcap init --help`);
  }
  return o;
}

export async function initCli(argv, { version = VERSION } = {}) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(HELP); return 0; }

  const root = path.resolve(opts.root);
  const steps = await planInit({ root, groups: opts.groups, remove: opts.remove, force: opts.force, version, pin: opts.pin });
  const write = opts.yes && !opts.print;
  const diff = renderDiff(steps);
  if (diff) process.stdout.write(diff);
  if (write) await applySteps(root, steps);

  const verb = { write: write ? 'wrote' : 'would write', delete: write ? 'deleted' : 'would delete', skip: 'skipped', user: 'wired by user', leave: 'left' };
  for (const step of steps) {
    console.error(`${verb[step.action]}: ${step.path}${step.reason ? ` (${step.reason})` : ''}`);
  }
  // The wiring only reaches other clones if git tracks it.
  if (!opts.remove) {
    // In a dry run the root .gitignore has not been narrowed yet, so git would
    // still report what the narrowing is about to fix.
    const pendingNarrow = !write && steps.some((step) => step.path === '.gitignore' && step.action === 'write');
    const written = steps
      .filter((step) => step.action === 'write' && step.before === null && !(pendingNarrow && step.path.startsWith('.ctxcap/')))
      .map((step) => step.path);
    const ignored = written.length ? spawnSync('git', ['-C', root, 'check-ignore', ...written], { encoding: 'utf8' }) : null;
    for (const file of ignored?.status === 0 ? ignored.stdout.split(/\r?\n/).filter(Boolean) : []) {
      console.error(`warning: git ignores ${file}, so it will not ship with the repository. Remove the rule that matches it from .gitignore.`);
    }
  }
  const pending = steps.some((step) => step.action === 'write' || step.action === 'delete');
  if (steps.length === 0) console.error(opts.remove ? 'nothing to remove' : 'nothing to do');
  else if (!write && pending && !opts.print) console.error('nothing written; re-run with --yes to apply');

  if (opts.print) return 0;
  return steps.some((step) => step.blocked) ? 3 : 0;
}
