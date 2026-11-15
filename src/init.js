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
  if (isObject(doc._ctxcap)) target.strip(doc);
  target.add(doc);
  const marker = { version: context.version, ...(context.pin ? {} : { pin: false }) };
  if (Object.hasOwn(doc, '_ctxcap')) doc._ctxcap = marker;
  else Object.assign(doc, { _ctxcap: marker });
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

async function survey({ root, version = VERSION, pin = true, targets }) {
  const context = { root, version, pin };
  const list = targets ?? await targetsFor(context);
  const items = [];
  for (const target of list) {
    const before = await read(root, target.path);
    items.push({ target, before, ...inspect(target, before) });
  }
  return { context, items };
}

const groupState = (items, group, { exclusive = false } = {}) => {
  const own = items.filter((item) => item.target.groups.includes(group) && (!exclusive || item.target.groups.length === 1));
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
  const { context, items } = await survey({ root, version, pin, targets });
  const steps = [];
  for (const item of items) {
    const { target, before, state } = item;
    if (!target.groups.some((group) => groups.includes(group))) continue;
    const step = { path: target.path, before, after: before, action: 'unchanged', reason: '' };

    if (remove) {
      // A file shared by two agents stays while the other one still needs it.
      const needed = target.groups.some((group) => !groups.includes(group) && groupState(items, group, { exclusive: true }) !== 'not wired');
      if (state === 'absent' || needed) continue;
      if (state !== 'managed') Object.assign(step, { action: 'leave', reason: 'not written by ctxcap init' });
      else {
        step.after = unwired(target, before);
        step.action = step.after === null ? 'delete' : 'write';
      }
    } else if (state === 'invalid') Object.assign(step, { action: 'skip', reason: 'not valid JSON, left alone' });
    else if (state === 'custom' && (target.kind !== 'file' || !force)) Object.assign(step, { action: 'skip', reason: 'already configured' });
    else if (state === 'managed' && !force) Object.assign(step, { action: 'skip', reason: 'already configured' });
    else {
      step.after = wired(target, before, context);
      step.action = step.after === before ? 'unchanged' : 'write';
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
