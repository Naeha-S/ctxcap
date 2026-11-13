import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { countTokens } from './tokenize.js';
import { findStale } from './stale.js';

const PLAN_DIR = '.ctxcap/plans';
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const PRESERVE_HEADING = /^#{1,6}\s+(Never|Constraints?|Must|Rules?)\b/i;
const LOAD_BEARING = /\b(MUST|NEVER|ALWAYS|do not|never|always)\b/i;

function normalized(line) {
  return line.replace(/[`*_>#-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function paragraphSpans(file) {
  const lines = file.text.split('\n');
  const spans = [];
  let start = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].trim() === '') {
      if (start < i) spans.push({ start: start + 1, end: i, lines: lines.slice(start, i) });
      start = i + 1;
    }
  }
  return spans;
}

function classifySpan(span, file) {
  const before = file.text.split('\n').slice(0, span.start - 1).reverse().find((line) => line.trim());
  const heading = before && PRESERVE_HEADING.test(before.trim());
  const text = span.lines.join('\n');
  return { loadBearing: Boolean(heading || LOAD_BEARING.test(text)), text };
}

function preserveSpans(files) {
  const preserve = [];
  for (const file of files) {
    for (const span of paragraphSpans(file)) {
      const { loadBearing } = classifySpan(span, file);
      if (loadBearing) preserve.push({ file: file.path, startLine: span.start, endLine: span.end, reason: 'load-bearing instruction' });
    }
  }
  return preserve;
}

function overlaps(a, b) {
  return a.file === b.file && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function planId(findings) {
  const input = findings.map((f) => `${f.file}:${f.startLine}:${f.endLine}:${f.kind}`).sort().join('\n');
  return createHash('sha256').update(input).digest('hex').slice(0, 6);
}

function findingFor(file, startLine, endLine, kind, tokensFreed, confidence, rationale, loadBearing = false, action = 'delete', replacementTokens = 0) {
  return { file, startLine, endLine, kind, tokensFreed, replacementTokens, confidence, loadBearing, rationale, action };
}

function attachInternal(plan, internal) {
  Object.defineProperty(plan, '_internal', { value: internal, writable: true, configurable: true });
  return plan;
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

export async function makePlan({ files, root, config, budget, maxFindings = 15, includeDiff = false, apply = false }) {
  if (!Number.isInteger(budget) || budget < 0) {
    const error = new Error('budget must be a non-negative integer');
    error.code = 'BUDGET_INVALID';
    error.fix = 'pass --budget <n>';
    throw error;
  }
  const current = files.reduce((total, file) => total + file.tokens, 0);
  const preserve = preserveSpans(files);
  const preserveText = Object.fromEntries(preserve.map((span) => [
    `${span.file}:${span.startLine}:${span.endLine}`,
    files.find((file) => file.path === span.file).text.split('\n').slice(span.startLine - 1, span.endLine).join('\n')
  ]));
  const candidates = [];
  const globalSeen = new Map();
  const stale = await findStale(files, root, config, { staleGlob: true });
  for (const finding of stale) {
    const paragraph = paragraphSpans(files.find((file) => file.path === finding.path)).find((span) => span.start <= finding.line && span.end >= finding.line);
    if (!paragraph) continue;
    const planned = findingFor(finding.path, paragraph.start, paragraph.end, `${finding.rule[0].toLowerCase()}${finding.rule.slice(1)}Block`, countTokens(paragraph.lines.join('\n')), finding.rule === 'stale-path' ? 0.98 : 0.92, `${finding.text} (${finding.rule})`);
    planned._sourceText = paragraph.lines.join('\n');
    candidates.push(planned);
  }
  for (const file of files) {
    const spans = paragraphSpans(file);
    const seen = new Map();
    for (const span of spans) {
      const key = normalized(span.lines.join(' '));
      if (!key) continue;
      if (seen.has(key) || globalSeen.has(key)) {
        const canonical = seen.get(key) ?? globalSeen.get(key);
        const duplicate = findingFor(file.path, span.start, span.end, 'duplicateRule', countTokens(span.lines.join('\n')), 0.92, `duplicate of ${canonical.file}:${canonical.start}`, false, 'deleteKeepingCanonical');
        duplicate._sourceText = span.lines.join('\n');
        candidates.push(duplicate);
      } else {
        seen.set(key, span);
        globalSeen.set(key, { file: file.path, start: span.start });
      }
      const { loadBearing } = classifySpan(span, file);
      const tokens = countTokens(span.lines.join('\n'));
      if (!loadBearing && tokens > 300) {
        const condensedText = `${span.lines.join(' ').slice(0, 240).trim()}...`;
        const replacementTokens = countTokens(condensedText);
        const finding = findingFor(file.path, span.start, span.end, 'largeParagraph', Math.max(0, tokens - replacementTokens), 0.65, 'non-load-bearing paragraph over 300 tokens', false, 'condense', replacementTokens);
        finding.condensedText = condensedText;
        finding._sourceText = span.lines.join('\n');
        candidates.push(finding);
      }
    }
  }
  const filtered = candidates
    .filter((candidate) => candidate.tokensFreed >= 40)
    .filter((candidate) => !preserve.some((span) => overlaps(candidate, span)))
    .sort((a, b) => (b.tokensFreed / (a.action === 'condense' ? 3 : 1)) - (a.tokensFreed / (b.action === 'condense' ? 3 : 1))
      || a.file.localeCompare(b.file) || a.startLine - b.startLine);
  const id = planId(filtered);
  let selected = filtered.slice(0, maxFindings).map((finding, index) => ({ id: `${id}:${index}`, ...finding }));
  while (selected.length && JSON.stringify(selected).length > 10000) {
    const removable = [...selected].sort((a, b) => (a.action === 'condense') - (b.action === 'condense') || a.confidence - b.confidence)[0];
    selected = selected.filter((finding) => finding !== removable);
  }
  const groups = [];
  for (const finding of filtered.filter((candidate) => !candidate.loadBearing)) {
    const matching = groups.filter((group) => group.some((candidate) => overlaps(candidate, finding)));
    if (!matching.length) {
      groups.push([finding]);
      continue;
    }
    const merged = [finding, ...matching.flat()];
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  const cuttable = groups.map((group) => [...group].sort((a, b) => b.confidence - a.confidence)[0]);
  const simulated = new Map(files.map((file) => [file.path, file.text]));
  const findingsByFile = new Map();
  for (const finding of cuttable) {
    if (!findingsByFile.has(finding.file)) findingsByFile.set(finding.file, []);
    findingsByFile.get(finding.file).push(finding);
  }
  for (const [file, findings] of findingsByFile) {
    const lines = simulated.get(file).split('\n');
    for (const finding of [...findings].sort((a, b) => b.startLine - a.startLine)) {
      lines.splice(finding.startLine - 1, finding.endLine - finding.startLine + 1, ...(finding.action === 'condense' ? [finding.condensedText] : []));
    }
    simulated.set(file, lines.join('\n'));
  }
  const simulatedTotal = [...simulated.values()].reduce((total, text) => total + countTokens(text), 0);
  const minAchievable = Math.max(0, simulatedTotal);
  const baselineTotal = files.reduce((total, file) => total + (file.baselineTokens ?? file.tokens), 0);
  const response = {
    schema: 'ctxcap/plan/v2',
    planId: id,
    satisfiable: minAchievable <= budget,
    budget,
    current,
    minAchievable,
    tokensRemaining: Math.max(0, current - budget),
    truncated: filtered.length > selected.length,
    remainingFindings: Math.max(0, filtered.length - selected.length),
    approximate: true,
    plan: selected,
    preserve,
    diff: { previousTotal: baselineTotal, currentTotal: current, totalDelta: current - baselineTotal }
  };
  while (JSON.stringify(response).length > 12000 && response.plan.length) {
    response.plan.pop();
    response.truncated = true;
    response.remainingFindings = filtered.length - response.plan.length;
  }
  if (includeDiff) response.diffText = selected.map((finding) => `${finding.file}:${finding.startLine}-${finding.endLine} ${finding.action}`).join('\n');
  attachInternal(response, {
    sources: Object.fromEntries(selected.map((finding) => [finding.id, finding._sourceText])),
    preserveText,
    postHashes: {}
  });
  for (const finding of selected) delete finding._sourceText;
  if (apply) {
    const applied = await applyPlan(response, root);
    response.applied = applied.applied;
    response.missed = applied.missed;
  }
  return response;
}

export async function applyPlan(plan, root) {
  const applied = [];
  const missed = [];
  const byFile = new Map();
  for (const finding of plan.plan) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }
  for (const [file, findings] of byFile) {
    const target = path.join(root, file);
    try {
      const original = await readFile(target, 'utf8');
      const lines = original.split('\n');
      const sorted = [...findings].sort((a, b) => b.startLine - a.startLine);
      for (const finding of sorted) {
        if (finding.startLine < 1 || finding.endLine > lines.length) throw new Error('line range drifted');
        if (finding.action === 'condense') {
          lines.splice(finding.startLine - 1, finding.endLine - finding.startLine + 1, finding.condensedText);
        } else {
          lines.splice(finding.startLine - 1, finding.endLine - finding.startLine + 1);
        }
      }
      const temp = `${target}.ctxcap-${plan.planId}.tmp`;
      await writeFile(temp, lines.join('\n'), 'utf8');
      await rename(temp, target);
      plan._internal.postHashes[file] = hashText(lines.join('\n'));
      applied.push(...findings.map((finding) => finding.id));
    } catch {
      try { await unlink(`${target}.ctxcap-${plan.planId}.tmp`); } catch {}
      missed.push(...findings.map((finding) => finding.id));
    }
  }
  return { applied, missed };
}

export async function savePlan(root, plan) {
  await mkdir(path.join(root, PLAN_DIR), { recursive: true });
  const persisted = { ...plan, _internal: plan._internal };
  await writeFile(path.join(root, PLAN_DIR, `${plan.planId}.json`), JSON.stringify(persisted, null, 2) + '\n', 'utf8');
}

export async function loadPlan(root, planId) {
  try {
    const planPath = path.join(root, PLAN_DIR, `${planId}.json`);
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    const age = Date.now() - (await stat(planPath)).mtimeMs;
    if (age > PLAN_TTL_MS) {
      const error = new Error('plan has expired');
      error.code = 'PLAN_EXPIRED';
      error.fix = 'generate a new plan';
      throw error;
    }
    if (plan.planId !== planId) {
      const error = new Error('plan does not match the requested planId');
      error.code = 'PLAN_EXPIRED';
      error.fix = 'generate a new plan';
      throw error;
    }
    const internal = plan._internal ?? { sources: {}, preserveText: {}, postHashes: {} };
    delete plan._internal;
    return attachInternal(plan, internal);
  } catch (error) {
    if (error.code === 'ENOENT') {
      error.code = 'PLAN_EXPIRED';
      error.fix = 'generate a new plan';
    }
    throw error;
  }
}

export async function verifyPlan(plan, root) {
  const applied = [];
  const missed = [];
  const violations = [];
  const postHashes = plan._internal?.postHashes ?? {};
  const driftedFiles = new Set();
  for (const [file, expected] of Object.entries(postHashes)) {
    try {
      const current = await readFile(path.join(root, file), 'utf8');
      if (hashText(current) !== expected) driftedFiles.add(file);
    } catch {
      driftedFiles.add(file);
    }
  }
  for (const finding of plan.plan) {
    if (plan.applied?.includes(finding.id) && driftedFiles.has(finding.file)) {
      missed.push(finding.id);
      continue;
    }
    try {
      const lines = (await readFile(path.join(root, finding.file), 'utf8')).split('\n');
      const original = lines.slice(finding.startLine - 1, finding.endLine).join('\n');
      const sourceText = plan._internal?.sources?.[finding.id] ?? finding.sourceText ?? finding.rationale.split(' (')[0];
      if (original.includes(sourceText)) missed.push(finding.id);
      else applied.push(finding.id);
    } catch {
      missed.push(finding.id);
    }
  }
  for (const span of plan.preserve) {
    try {
      const text = await readFile(path.join(root, span.file), 'utf8');
      const expected = plan._internal?.preserveText?.[`${span.file}:${span.startLine}:${span.endLine}`];
      if (expected && !text.includes(expected)) violations.push({ file: span.file, startLine: span.startLine, endLine: span.endLine, reason: span.reason });
    } catch {
      violations.push({ file: span.file, startLine: span.startLine, endLine: span.endLine, reason: span.reason });
    }
  }
  const removed = plan.plan.filter((finding) => applied.includes(finding.id)).reduce((total, finding) => total + finding.tokensFreed, 0);
  const remaining = Math.max(0, plan.current - removed);
  return { applied, missed, violations, remaining, satisfied: missed.length === 0 && violations.length === 0 && remaining <= plan.budget };
}
