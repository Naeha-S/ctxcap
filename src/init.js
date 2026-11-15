import { readFile, writeFile, mkdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { unifiedDiff } from './diff.js';
import { VERSION } from './version.js';
import { GROUPS, BEGIN, END, targetsFor } from './wire.js';

const HELP = `ctxcap init — wire ctxcap into the coding agents a repository uses

Usage: ctxcap init [options]

  --yes               write the files (without it, nothing is written)
  --print             print the diff and exit 0
  --agents <list>     comma-separated subset of ${GROUPS.join(',')} (default: all)
  --remove            undo what init wrote
  --force             rewrite targets that are already configured
  --no-pin            write "npx ctxcap" instead of "npx ctxcap@${VERSION}"
  --root <path>       repository root (default: .)

The diff goes to stdout and the per-file status to stderr.
Exit: 0 done, 3 when a target was skipped without --force, 2 bad usage.`;

// ---------------------------------------------------------------- text helpers

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
 */
function inspect(target, text) {
  if (target.kind === 'file') {
    if (text === null) return { state: 'absent', pins: [] };
    return text.includes(target.marker) ? { state: 'managed', pins: pinsIn(text) } : { state: 'custom', pins: [] };
  }
  if (target.kind === 'block') {
    const span = text === null ? null : blockSpan(text);
    return span ? { state: 'managed', pins: pinsIn(text.slice(span.start, span.end)) } : { state: 'absent', pins: [] };
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

function wired(target, text, context) {
  if (target.kind === 'file') return target.content;
  if (target.kind === 'block') return text !== null && blockSpan(text) ? replaceBlock(text, target) : addBlock(text, target);
  const parsed = text === null ? { doc: {}, ...NEW_JSON } : parseJson(text);
  const { doc } = parsed;
  // Rewriting takes ours out first, so the entry and the marker always end up
  // last and in the same order as on a first write.
  if (isObject(doc._ctxcap)) target.strip(doc);
  delete doc._ctxcap;
  target.add(doc);
  doc._ctxcap = { version: context.version, ...(context.pin ? {} : { pin: false }) };
  return serialize(doc, parsed);
}

function unwired(target, text) {
  if (target.kind === 'file') return null;
  if (target.kind === 'block') return stripBlock(text) || null;
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

async function survey({ root, version = VERSION, pin = true, groups = GROUPS, force = false, targets }) {
  const context = { root, version, pin, groups, force };
  const list = targets ?? await targetsFor(context);
  const items = [];
  for (const target of list) {
    const before = await read(root, target.path);
    items.push({ target, before, ...(target.kind === 'state' ? { state: 'state', pins: [] } : inspect(target, before)) });
  }
  return { context, items };
}

const groupState = (items, group, { exclusive = false } = {}) => {
  const own = items.filter((item) => item.state !== 'state' && item.target.groups.includes(group) && (!exclusive || item.target.groups.length === 1));
  if (own.every((item) => item.state === 'absent')) return 'not wired';
  if (own.some((item) => item.state === 'absent' || item.state === 'invalid')) return 'partially wired';
  return 'wired';
};

/**
 * Works out what init or remove would do, without touching the disk.
 * Each step is { path, before, after, action, reason } where action is
 * write | delete | skip | unchanged | leave.
 */
export async function planInit({ root, groups = GROUPS, remove = false, force = false, version, pin, targets }) {
  const { context, items } = await survey({ root, version, pin, groups, force, targets });
  const steps = [];
  for (const item of items) {
    const { target, before, state } = item;
    if (!target.groups.some((group) => groups.includes(group))) continue;
    const step = { path: target.path, before, after: before, action: 'unchanged', reason: '' };

    // Working state (the hook stamp) is never written by init, only cleared by remove.
    if (state === 'state' && !(remove && before !== null)) continue;

    if (remove) {
      // A file shared by two agents stays while the other one still needs it.
      const needed = target.groups.some((group) => !groups.includes(group) && groupState(items, group, { exclusive: true }) !== 'not wired');
      if (state === 'absent' || needed) continue;
      if (state === 'state') Object.assign(step, { after: null, action: 'delete' });
      else if (state !== 'managed') Object.assign(step, { action: 'leave', reason: 'not written by ctxcap init' });
      else {
        step.after = unwired(target, before);
        step.action = step.after === null ? 'delete' : 'write';
      }
    } else if (state === 'invalid') Object.assign(step, { action: 'skip', reason: 'not valid JSON, left alone' });
    else if (state === 'custom' && (target.kind !== 'file' || !force)) Object.assign(step, { action: 'skip', reason: 'already configured' });
    else if (state === 'managed' && !force && !target.refresh) Object.assign(step, { action: 'skip', reason: 'already configured' });
    else {
      if (typeof target.content === 'function') target.content = await target.content();
      step.after = wired(target, before, context);
      // A refreshed target holds data, not configuration (the badge count): it
      // is brought up to date on every run and only skipped when it is current.
      if (step.after !== before) step.action = 'write';
      else if (state === 'managed' && !force) Object.assign(step, { action: 'skip', reason: 'already configured' });
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
  const { items } = await survey({ root, version, targets });
  const agents = GROUPS.map((agent) => {
    const files = items
      .filter((item) => item.state !== 'state' && item.target.groups.includes(agent))
      .map((item) => {
        const stale = item.pins.find((pin) => pin !== version);
        const state = item.state === 'absent' ? 'missing'
          : item.state === 'managed' ? (stale ? 'stale' : 'wired')
          : item.state;
        return { path: item.target.path, state, ...(stale ? { pin: stale } : {}) };
      });
    const present = files.filter((file) => file.state !== 'missing' && file.state !== 'invalid');
    // A file shared with another agent does not make this one wired by itself.
    const own = items.filter((item) => item.state !== 'state' && item.target.groups.length === 1 && item.target.groups[0] === agent);
    const status = own.every((item) => item.state === 'absent') ? 'not wired'
      : present.length < files.length ? 'partially wired'
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
    return parts.join('; ');
  }
  if (entry.status === 'stale pin') {
    return entry.files.filter((file) => file.state === 'stale').map((file) => `${file.path} has ${file.pin}`).join(', ') + `, current is ${version}`;
  }
  const custom = paths('custom');
  return custom.length ? `${custom.join(', ')} not written by ctxcap init` : '';
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
    if (!result.ok) console.log(`\nfix: npx ctxcap@${version} init --yes --force`);
    else if (result.agents.every((entry) => entry.status === 'not wired')) console.log(`\nwire it up: npx ctxcap@${version} init`);
  }
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------- CLI

function usage(message) {
  return Object.assign(new Error(message), { code: 'USAGE' });
}

function parseArgs(argv) {
  const o = { yes: false, print: false, remove: false, force: false, pin: true, groups: GROUPS, root: '.', help: false };
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

  const verb = { write: write ? 'wrote' : 'would write', delete: write ? 'deleted' : 'would delete', skip: 'skipped', unchanged: 'unchanged', leave: 'left' };
  for (const step of steps) {
    console.error(`${verb[step.action]}: ${step.path}${step.reason ? ` (${step.reason})` : ''}`);
  }
  const pending = steps.some((step) => step.action === 'write' || step.action === 'delete');
  if (steps.length === 0) console.error(opts.remove ? 'nothing to remove' : 'nothing to do');
  else if (!write && pending && !opts.print) console.error('nothing written; re-run with --yes to apply');

  if (opts.print) return 0;
  return !opts.force && steps.some((step) => step.action === 'skip') ? 3 : 0;
}
