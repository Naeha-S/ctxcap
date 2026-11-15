import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { countTokens } from './tokenize.js';

const SKIP = /[~$:<]|:\/\//;
// A reference is only checked when it is spelled like a path: no spaces,
// quotes, or brackets. `a.b` identifiers, commands, and prose are not paths.
const PATH_CHARS = /^[A-Za-z0-9_.+*\/-]+$/;
// Bare names (no slash) are only treated as files with one of these extensions,
// so `console.log`, `theme.hue`, and `1.2.3` are never reported.
const FILE_EXTENSIONS = new Set(('md mdx txt rst json jsonc json5 yaml yml toml ini cfg conf xml csv lock '
  + 'js mjs cjs jsx ts mts cts tsx vue svelte astro css scss less html htm '
  + 'py pyi ipynb rb go rs java kt kts swift c h cc cpp hpp cs php sh bash zsh ps1 bat '
  + 'sql graphql proto prisma tf nix bzl bazel gradle cmake mk').split(' '));
const IMPERATIVE = /^(add|allow|avoid|build|check|choose|configure|create|delete|do|ensure|follow|keep|never|prefer|put|remove|run|use|write|update|install|set|test|review|verify|refer|place|keep)\b/i;
const BACKTICK = /`([^`\r\n]+)`/g;
const AT_REF = /(?:^|[\s([{])([@#](?:\.?\/)?[A-Za-z0-9_./-]+)/g;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const SCAN_IGNORE = ['**/node_modules/**', '**/.git/**'];

function clean(value) {
  return value.replace(/[),.;:!?]+$/, '');
}

function ignored(line) {
  return line.includes('<!-- ctxcap-ignore -->');
}

function indent(line) {
  return line.match(/^\s*/)[0].length;
}

// The lines a finding on `index` would remove, as a [start, end) range: the
// list item that owns the line (with its nested lines), else the paragraph.
export function blockRange(lines, index) {
  let start = index;
  let end = index + 1;
  while (start > 0 && lines[start - 1].trim() !== '') start--;
  while (end < lines.length && lines[end].trim() !== '') end++;
  let owner = index;
  while (owner >= start && !(LIST_ITEM.test(lines[owner]) && (owner === index || indent(lines[owner]) < indent(lines[index])))) owner--;
  if (owner < start) return [start, end];
  let stop = owner + 1;
  while (stop < end && indent(lines[stop]) > indent(lines[owner])) stop++;
  return index < stop ? [owner, stop] : [start, end];
}

// Resolves a reference against the repo root and the context file's directory.
// Returns 'ok', 'stale', or 'skip'. 'skip' means it is not clearly a path into
// this repo, so it is not reported: precision matters more than recall here.
async function resolve(value, { root, dir, names, staleGlob }) {
  if (!value || SKIP.test(value) || !PATH_CHARS.test(value)) return 'skip';
  const glob = value.includes('*');
  if (glob && !staleGlob) return 'skip';
  const ref = value.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!ref || ref.startsWith('/') || ref.split('/').includes('..')) return 'skip';
  const bases = [...new Set(['', dir])];
  const exists = (candidate) => bases.some((base) => existsSync(path.join(root, base, candidate)));

  if (!ref.includes('/')) {
    const extension = /\.([A-Za-z0-9]+)$/.exec(ref)?.[1].toLowerCase();
    if (!FILE_EXTENSIONS.has(extension)) return 'skip';
    if (glob) return (await fg(`**/${ref}`, { cwd: root, ignore: SCAN_IGNORE, dot: true })).length ? 'ok' : 'stale';
    return exists(ref) || (await names()).has(ref) ? 'ok' : 'stale';
  }

  // With a slash, the first segment must be a real directory here. That keeps
  // `origin/main`, `feat/x`, `application/json`, and `@scope/pkg` out.
  const first = ref.split('/')[0];
  if (first.includes('*') || !exists(first)) return 'skip';
  if (!glob) return exists(ref) ? 'ok' : 'stale';
  for (const base of bases) {
    if ((await fg(ref, { cwd: path.join(root, base), onlyFiles: false, dot: true, ignore: SCAN_IGNORE })).length) return 'ok';
  }
  return 'stale';
}

function addFinding(findings, finding) {
  if (!findings.some((f) => f.path === finding.path && f.line === finding.line && f.rule === finding.rule && f.ref === finding.ref)) {
    findings.push(finding);
  }
}

// Script names from every package.json in the repo (workspaces included), or
// null when there is none and `npm run` references cannot be judged.
async function packageScripts(root) {
  const manifests = await fg('**/package.json', { cwd: root, ignore: SCAN_IGNORE, dot: true });
  if (!manifests.length) return null;
  const scripts = new Set();
  for (const manifest of manifests) {
    try {
      const pkg = JSON.parse(await readFile(path.join(root, manifest), 'utf8'));
      for (const name of Object.keys(pkg.scripts ?? {})) scripts.add(name);
    } catch (err) {
      if (manifest === 'package.json') throw new Error(`invalid package.json: ${err.message}`);
    }
  }
  return scripts;
}

export async function findStale(files, root, config, { staleGlob = false } = {}) {
  const findings = [];
  let scriptSet;
  const scripts = async () => (scriptSet === undefined ? (scriptSet = await packageScripts(root)) : scriptSet);
  let nameSet = null;
  const names = async () => {
    nameSet ??= new Set((await fg('**/*', { cwd: root, ignore: SCAN_IGNORE, dot: true })).map((file) => path.posix.basename(file)));
    return nameSet;
  };
  for (const file of files) {
    const lines = file.text.split('\n');
    const context = { root, dir: path.posix.dirname(file.path) === '.' ? '' : path.posix.dirname(file.path), names, staleGlob };
    let fenced = false;
    let underHeading = false;
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        fenced = !fenced;
        continue;
      }
      if (fenced || ignored(line)) continue;
      if (/^\s*#{1,6}\s+/.test(line)) {
        underHeading = true;
        continue;
      }
      const text = line.trim();
      if (!underHeading && !IMPERATIVE.test(text)) continue;
      const [start, end] = blockRange(lines, index);
      const report = (rule, severity, ref) => addFinding(findings, {
        rule, severity, path: file.path, line: index + 1, ref, text,
        startLine: start + 1, endLine: end,
        reclaimableTokens: countTokens(lines.slice(start, end).join('\n')), fix: 'delete'
      });

      for (const match of line.matchAll(BACKTICK)) {
        const value = clean(match[1].trim());
        const script = /^npm run\s+([^\s`]+)/.exec(value)?.[1];
        if (script) {
          const known = await scripts();
          if (known && !known.has(script)) report('dead-command', 'warning', value);
          continue;
        }
        const result = await resolve(value.replace(/^[@#]/, ''), context);
        if (result === 'stale') report(value.includes('*') ? 'stale-glob' : 'stale-path', value.includes('*') ? 'warning' : 'error', value);
      }

      for (const match of line.matchAll(AT_REF)) {
        const value = clean(match[1]);
        if (value.includes('*')) continue;
        if (await resolve(value.slice(1), context) === 'stale') report('missing-ref', 'warning', value);
      }
    }
  }
  return findings;
}

export function staleDiff(files, findings) {
  const byFile = new Map();
  for (const finding of findings) {
    const lines = files.find((file) => file.path === finding.path)?.text.split('\n') ?? [];
    if (!byFile.has(finding.path)) byFile.set(finding.path, { lines, remove: new Set() });
    const [start, end] = blockRange(lines, finding.line - 1);
    for (let index = start; index < end; index++) byFile.get(finding.path).remove.add(index);
  }
  return [...byFile].map(([file, value]) => {
    const removed = value.lines.filter((_, index) => value.remove.has(index));
    if (!removed.length) return '';
    return [`--- ${file}`, `+++ ${file}`, `@@`, ...removed.map((line) => `- ${line}`)].join('\n');
  }).filter(Boolean).join('\n');
}

// Each block is counted once, however many dead references it holds.
export function reclaimableTotal(findings) {
  const blocks = new Map();
  for (const finding of findings) blocks.set(`${finding.path}:${finding.startLine ?? finding.line}`, finding.reclaimableTokens);
  return [...blocks.values()].reduce((total, tokens) => total + tokens, 0);
}
