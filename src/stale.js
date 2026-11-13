import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { countTokens } from './tokenize.js';

const SKIP = /[~$:<]|:\/\//;
const EXTENSION = /\.[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMPERATIVE = /^(add|allow|avoid|build|check|choose|configure|create|delete|do|ensure|follow|keep|never|prefer|put|remove|run|use|write|update|install|set|test|review|verify|refer|place|keep)\b/i;
const BACKTICK = /`([^`\r\n]+)`/g;
const AT_REF = /(?:^|[\s([{])([@#](?:\.?\/)?[A-Za-z0-9_./-]+)/g;

function clean(value) {
  return value.replace(/[),.;:!?]+$/, '');
}

function ignored(line) {
  return line.includes('<!-- ctxcap-ignore -->');
}

function isCandidate(value, staleGlob) {
  return value && !SKIP.test(value) && (value.includes('/') || value.startsWith('./') || EXTENSION.test(value))
    && (!value.includes('*') || staleGlob);
}

function pathCandidate(value) {
  return value.startsWith('@') || value.startsWith('#') ? value.slice(1) : value;
}

function paragraphRanges(lines) {
  const ranges = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].trim() === '') {
      if (start < i) ranges.push([start, i]);
      start = i + 1;
    }
  }
  return ranges;
}

function addFinding(findings, finding) {
  if (!findings.some((f) => f.path === finding.path && f.line === finding.line && f.rule === finding.rule && f.text === finding.text)) {
    findings.push(finding);
  }
}

async function packageScripts(root) {
  try {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    return new Set(Object.keys(pkg.scripts ?? {}));
  } catch (err) {
    if (err.code === 'ENOENT') return new Set();
    throw new Error(`invalid package.json: ${err.message}`);
  }
}

export async function findStale(files, root, config, { staleGlob = false } = {}) {
  const findings = [];
  const scripts = await packageScripts(root);
  for (const file of files) {
    const lines = file.text.split('\n');
    const ranges = paragraphRanges(lines);
    const rangeFor = (index) => ranges.find(([start, end]) => index >= start && index < end) ?? [index, index + 1];
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
      const [start, end] = rangeFor(index);
      const reclaimableTokens = countTokens(lines.slice(start, end).join('\n'));
      const text = line.trim();
      if (!underHeading && !IMPERATIVE.test(text)) continue;

      for (const match of line.matchAll(BACKTICK)) {
        const value = clean(match[1].trim());
        if (/^npm run\s+([^\s`]+)/.test(value)) {
          const script = value.match(/^npm run\s+([^\s`]+)/)[1];
          if (!scripts.has(script)) {
            addFinding(findings, { rule: 'dead-command', severity: 'warning', path: file.path, line: index + 1, text, reclaimableTokens, fix: 'delete' });
          }
          continue;
        }
        if (!isCandidate(value, staleGlob)) continue;
        if (value.includes('*')) {
          if ((await fg(value, { cwd: root, onlyFiles: false, dot: true })).length === 0) {
            addFinding(findings, { rule: 'stale-glob', severity: 'warning', path: file.path, line: index + 1, text, reclaimableTokens, fix: 'delete' });
          }
        } else if (!pathExists(root, pathCandidate(value))) {
          addFinding(findings, { rule: 'stale-path', severity: 'error', path: file.path, line: index + 1, text, reclaimableTokens, fix: 'delete' });
        }
      }

      for (const match of line.matchAll(AT_REF)) {
        const value = clean(match[1]);
        if (!isCandidate(value, staleGlob) || value.includes('*')) continue;
        if (!pathExists(root, pathCandidate(value))) {
          addFinding(findings, { rule: 'missing-ref', severity: 'warning', path: file.path, line: index + 1, text, reclaimableTokens, fix: 'delete' });
        }
      }

    }
  }
  return findings;
}

function pathExists(root, value) {
  if (!value || value.includes('\\') || path.isAbsolute(value) || value.split('/').includes('..')) return false;
  return existsSync(path.join(root, value));
}

export function staleDiff(files, findings) {
  const byFile = new Map();
  for (const finding of findings) {
    const lines = files.find((file) => file.path === finding.path)?.text.split('\n') ?? [];
    if (!byFile.has(finding.path)) byFile.set(finding.path, { lines, remove: new Set() });
    let start = finding.line - 1;
    let end = finding.line;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    while (end < lines.length && lines[end].trim() !== '') end++;
    for (let index = start; index < end; index++) byFile.get(finding.path).remove.add(index);
    if (!byFile.get(finding.path).lines.length) byFile.get(finding.path).lines = lines;
  }
  return [...byFile].map(([file, value]) => {
    const removed = value.lines.filter((_, index) => value.remove.has(index));
    if (!removed.length) return '';
    return [`--- ${file}`, `+++ ${file}`, `@@`, ...removed.map((line) => `- ${line}`)].join('\n');
  }).filter(Boolean).join('\n');
}

export function reclaimableTotal(findings) {
  const paragraphs = new Map();
  for (const finding of findings) paragraphs.set(`${finding.path}:${finding.line}`, finding.reclaimableTokens);
  return [...paragraphs.values()].reduce((total, tokens) => total + tokens, 0);
}
