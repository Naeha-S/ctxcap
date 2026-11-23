import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { countTokens } from './tokenize.js';
import { findStale, blockRange } from './stale.js';

const PLAN_DIR = '.ctxcap/plans';
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;
const HEADING = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/;
const LOAD_BEARING = /(?:^|\n)\s*(?:[-*+]|\d+[.)])?\s*(MUST|NEVER|ALWAYS|do not|never|always)\b/i;

function normalized(line) {
  return line.replace(/[`*_>#-]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Directive words. A sentence containing one is never dropped by a condense.
const DIRECTIVE = /\b(?:must|never|always|do\s+not|don['’]t)\b/i;
// Stricter test used to mark a whole paragraph load-bearing: the sentence
// starts with a directive, or shouts one. Lowercase mid-sentence use stays editable.
const RULE_START = /^\W*(?:must|never|always|do\s+not|don['’]t)\b/i;
const RULE_EMPHATIC = /\b(?:MUST|NEVER|ALWAYS|DO\s+NOT|DON['’]T)\b/;

// Split after `.`, `!`, or `?` when the next word does not start lowercase,
// outside inline code and not after `e.g.`, `i.e.`, `vs.`, or `cf.`.
function sentences(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const out = [];
  let start = 0;
  let ticks = 0;
  for (let i = 0; i < flat.length; i++) {
    if (flat[i] === '`') ticks++;
    if (!'.!?'.includes(flat[i]) || ticks % 2 !== 0) continue;
    const last = i + 1 === flat.length;
    if (!last && (flat[i + 1] !== ' ' || /[a-z]/.test(flat[i + 2] ?? '') || /\b(?:e\.g|i\.e|vs|cf)$/i.test(flat.slice(0, i)))) continue;
    out.push(flat.slice(start, i + 1).trim());
    start = i + 1;
  }
  if (start < flat.length) out.push(flat.slice(start).trim());
  return out.filter(Boolean);
}

// A condense keeps whole leading sentences up to the limit, plus every
// sentence it is not allowed to drop: directive sentences, or all of them when
// `keepAll` is set (the paragraph sits under a preserve heading or marker).
// Repeated sentences are dropped. It never cuts mid-sentence, and returns null
// when the result would not fit the limit or nothing would be dropped.
function safeCondense(text, maxChars, keepAll = false) {
  const all = sentences(text);
  const parts = all.filter((part, i) => all.indexOf(part) === i);
  const limit = Math.min(maxChars, 400);
  const required = parts.filter((part) => keepAll || DIRECTIVE.test(part));
  const keep = parts.map((part) => required.includes(part));
  let length = required.reduce((total, part) => total + part.length + 1, 0);
  for (let i = 0; i < parts.length; i++) {
    if (keep[i]) continue;
    if (length + parts[i].length > limit) break;
    keep[i] = true;
    length += parts[i].length + 1;
  }
  if (!keep[0] || length - 1 > limit) return null;
  if (keep.every(Boolean) && parts.length === all.length) return null;
  return { text: parts.filter((_, i) => keep[i]).join(' '), required };
}

function paragraphSpans(file) {
  const lines = file.text.split('\n');
  const spans = [];
  let start = 0;
  let fenced = false;
  let code = false;
  for (let i = 0; i <= lines.length; i++) {
    if (i === lines.length || lines[i].trim() === '') {
      if (start < i) spans.push({ start: start + 1, end: i, lines: lines.slice(start, i), code });
      start = i + 1;
      code = fenced;
      continue;
    }
    if (/^\s*(?:```|~~~)/.test(lines[i])) {
      fenced = !fenced;
      code = true;
    }
  }
  return spans;
}

// The prose part of a span that a condense may rewrite: the lines after any
// leading headings, and only when none of them is a list item, table row,
// quote, HTML, or code. Flattening those into one line would wreck them.
function proseBody(span) {
  if (span.code) return null;
  let skip = 0;
  while (skip < span.lines.length && HEADING.test(span.lines[skip])) skip++;
  const lines = span.lines.slice(skip);
  if (!lines.length || lines.some((line) => /^\s*(?:[-*+]\s|\d+[.)]\s|[|>#<]|```|~~~)|^(?: {4}|\t)/.test(line))) return null;
  return { start: span.start + skip, end: span.end, lines };
}

function classifySpan(span, file, config = {}) {
  const lines = file.text.split('\n');
  const headingPatterns = config.preserveHeadings ?? ['Never', 'Constraint', 'Constraints', 'Must', 'Rule', 'Rules'];
  let protectedHeadingLevel = null;
  let underProtectedHeading = false;
  // Scan through the span itself: a heading with no blank line below it is
  // part of the paragraph and must open or close protection for that body.
  for (let index = 0; index < span.end; index++) {
    const match = lines[index].match(HEADING);
    if (match) {
      const level = match[1].length;
      if (protectedHeadingLevel !== null && level <= protectedHeadingLevel) protectedHeadingLevel = null;
      const headingText = match[2].trim();
      const protectedHeading = headingPatterns.some((source) => {
        try { return new RegExp(`^${source}$`, 'i').test(headingText); } catch { return false; }
      });
      if (protectedHeading) protectedHeadingLevel = level;
    }
    if (index >= span.start - 1 && !match && protectedHeadingLevel !== null) underProtectedHeading = true;
  }
  const text = span.lines.join('\n');
  const body = span.lines.filter((line) => !HEADING.test(line)).join('\n');
  const marker = lines.slice(0, span.start - 1).reverse().find((line) => line.trim())?.trim() === '<!-- ctxcap:preserve -->';
  const rule = LOAD_BEARING.test(text) || sentences(body).some((part) => RULE_START.test(part) || RULE_EMPHATIC.test(part));
  const wholeSpan = Boolean(underProtectedHeading || marker);
  return { loadBearing: wholeSpan || rule, wholeSpan, text };
}

// The lines a stale finding on `line` would delete, and whether deleting them
// is safe: not when the block is load-bearing or holds any directive sentence.
export function staleBlock(file, line, config) {
  const lines = file.text.split('\n');
  const [start, end] = blockRange(lines, line - 1);
  const span = { start: start + 1, end, lines: lines.slice(start, end) };
  const text = span.lines.join('\n');
  return { ...span, text, deletable: !classifySpan(span, file, config).loadBearing && !DIRECTIVE.test(text) };
}

function preserveSpans(files, config) {
  const preserve = [];
  for (const file of files) {
    for (const span of paragraphSpans(file)) {
      const { loadBearing } = classifySpan(span, file, config);
      if (loadBearing) preserve.push({ file: file.path, startLine: span.start, endLine: span.end, reason: 'load-bearing instruction' });
    }
  }
  return preserve;
}

function overlaps(a, b) {
  return a.file === b.file && a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function bestNonOverlappingCandidates(candidates) {
  const groups = [];
  for (const finding of candidates) {
    const matching = groups.filter((group) => group.some((candidate) => overlaps(candidate, finding)));
    if (!matching.length) {
      groups.push([finding]);
      continue;
    }
    const merged = [finding, ...matching.flat()];
    for (const group of matching) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups.map((group) => [...group].sort((a, b) =>
    b.confidence - a.confidence || a.file.localeCompare(b.file) || a.startLine - b.startLine
  )[0]);
}

function scoreFor(tokensFreed, confidence, action, loadBearing) {
  return tokensFreed * confidence * (action === 'condense' ? 0.7 * (loadBearing ? 0.8 : 1) : 1);
}

function compareFindings(a, b) {
  return b.score - a.score || a.file.localeCompare(b.file) || a.startLine - b.startLine;
}

function planId(findings) {
  const input = findings.map((f) =>
    `${f.file}:${f.startLine}:${f.endLine}:${f.kind}:${hashText(f.condensedText ?? '')}`
  ).sort().join('\n');
  return createHash('sha256').update(input).digest('hex').slice(0, 6);
}

function findingFor(file, startLine, endLine, kind, tokensFreed, confidence, rationale, loadBearing = false, action = 'delete', replacementTokens = 0) {
  return { file, startLine, endLine, kind, tokensFreed, replacementTokens, confidence, loadBearing, rationale, action, score: scoreFor(tokensFreed, confidence, action, loadBearing) };
}

function attachInternal(plan, internal) {
  Object.defineProperty(plan, '_internal', { value: internal, writable: true, configurable: true });
  return plan;
}

function hashText(text) {
  return createHash('sha256').update(text).digest('hex');
}

function occurrenceCount(text, needle) {
  if (!needle) return 0;
  let count = 0;
  for (let index = 0; (index = text.indexOf(needle, index)) !== -1; index += needle.length) count++;
  return count;
}

export async function makePlan({ files, root, config, budget, budgetClasses = {}, maxFindings = 15, includeDiff = false, apply = false, strictPreserve = false, maxCondenseChars = 320, minTokens = 20 }) {
  if (!Number.isInteger(budget) || budget < 0) {
    const error = new Error('budget must be a non-negative integer');
    error.code = 'BUDGET_INVALID';
    error.fix = 'pass --budget <n>';
    throw error;
  }
  if (!Number.isInteger(minTokens) || minTokens < 0) {
    const error = new Error('minTokens must be a non-negative integer');
    error.code = 'MIN_TOKENS_INVALID';
    error.fix = 'pass --min-tokens <n>';
    throw error;
  }
  const current = files.reduce((total, file) => total + file.tokens, 0);
  const preserve = preserveSpans(files, config);
  const preserveText = Object.fromEntries(preserve.map((span) => [
    `${span.file}:${span.startLine}:${span.endLine}`,
    files.find((file) => file.path === span.file).text.split('\n').slice(span.startLine - 1, span.endLine).join('\n')
  ]));
  const candidates = [];
  const globalSeen = new Map();
  const stale = await findStale(files, root, config, { staleGlob: true });
  for (const finding of stale) {
    const file = files.find((candidate) => candidate.path === finding.path);
    const block = staleBlock(file, finding.line, config);
    const planned = findingFor(finding.path, block.start, block.end, `${finding.rule[0].toLowerCase()}${finding.rule.slice(1)}Block`, countTokens(block.text), finding.rule === 'stale-path' ? 0.98 : 0.92, `\`${finding.ref}\` does not resolve (${finding.rule})`, !block.deletable);
    planned._sourceText = block.text;
    candidates.push(planned);
  }
  for (const file of files) {
    const spans = paragraphSpans(file);
    const seen = new Map();
    for (const span of spans) {
      const key = normalized(span.lines.join(' '));
      if (!key || span.code) continue;
      if (seen.has(key) || globalSeen.has(key)) {
        const canonical = seen.get(key) ?? globalSeen.get(key);
        const { loadBearing } = classifySpan(span, file, config);
        const canonicalKey = `${canonical.file}:${canonical.start}:${canonical.end}`;
        const duplicate = findingFor(file.path, span.start, span.end, 'duplicateRule', countTokens(span.lines.join('\n')), 0.92, `duplicate of ${canonicalKey}`, loadBearing, 'deleteKeepingCanonical');
        duplicate.canonical = canonicalKey;
        duplicate._canonicalSpan = canonical;
        duplicate._sourceText = span.lines.join('\n');
        candidates.push(duplicate);
      } else {
        const canonical = { file: file.path, start: span.start, end: span.end };
        seen.set(key, canonical);
        globalSeen.set(key, canonical);
      }
      const { loadBearing, wholeSpan } = classifySpan(span, file, config);
      const body = proseBody(span);
      const tokens = body ? countTokens(body.lines.join('\n')) : 0;
      const condensed = tokens > 300 ? safeCondense(body.lines.join(' '), maxCondenseChars, wholeSpan) : null;
      if (condensed) {
        const condensedText = condensed.text;
        const replacementTokens = countTokens(condensedText);
        const finding = findingFor(file.path, body.start, body.end, 'largeParagraph', Math.max(0, tokens - replacementTokens), loadBearing ? 0.5 : 0.65, loadBearing ? 'load-bearing paragraph over 300 tokens' : 'non-load-bearing paragraph over 300 tokens', loadBearing, 'condense', replacementTokens);
        finding.condensedText = condensedText;
        finding._required = condensed.required;
        finding._sourceText = body.lines.join('\n');
        candidates.push(finding);
      }
    }
  }
  const filtered = candidates
    .filter((candidate) => candidate.tokensFreed >= minTokens)
    .filter((candidate) => {
      const touchesPreserve = preserve.some((span) => overlaps(candidate, span));
      if (candidate.action === 'delete') return !candidate.loadBearing && !touchesPreserve;
      if (strictPreserve) return !touchesPreserve;
      if (candidate.action === 'deleteKeepingCanonical') return Boolean(candidate._canonicalSpan && !overlaps(candidate._canonicalSpan, candidate));
      return true;
    })
    .sort(compareFindings);
  // One finding per span: overlapping line ranges cannot both be spliced.
  const ranked = bestNonOverlappingCandidates(filtered).sort(compareFindings);
  const id = planId(ranked);
  let selected = ranked.slice(0, maxFindings).map((finding, index) => ({ id: `${id}:${index}`, ...finding }));
  while (selected.length && JSON.stringify(selected).length > 10000) {
    const removable = [...selected].sort((a, b) => (a.action === 'condense') - (b.action === 'condense') || a.confidence - b.confidence)[0];
    selected = selected.filter((finding) => finding !== removable);
  }
  // A condense keeps every rule sentence, so it is safe on a load-bearing span.
  const cuttable = bestNonOverlappingCandidates(filtered.filter((candidate) => !candidate.loadBearing || candidate.action === 'condense'));
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
  const gatedClasses = new Set(['always', 'startup', ...Object.keys(budgetClasses)]);
  const gateCurrent = files
    .filter((file) => gatedClasses.has(file.loadClass ?? 'always'))
    .reduce((total, file) => total + file.tokens, 0);
  const gateMinAchievable = [...simulated.entries()]
    .filter(([file]) => gatedClasses.has(files.find((candidate) => candidate.path === file)?.loadClass ?? 'always'))
    .reduce((total, [, text]) => total + countTokens(text), 0);
  const classBudgetsSatisfied = Object.entries(budgetClasses).every(([loadClass, classBudget]) =>
    files.filter((file) => (file.loadClass ?? 'always') === loadClass)
      .reduce((total, file) => total + countTokens(simulated.get(file.path)), 0) <= classBudget
  );
  const baselineTotal = files.reduce((total, file) => total + (file.baselineTokens ?? file.tokens), 0);
  const response = {
    schema: 'ctxcap/plan/v2',
    planId: id,
    satisfiable: gateMinAchievable <= budget && classBudgetsSatisfied,
    budget,
    current,
    minAchievable,
    tokensRemaining: Math.max(0, gateCurrent - budget),
    truncated: ranked.length > selected.length,
    remainingFindings: Math.max(0, ranked.length - selected.length),
    approximate: true,
    plan: selected,
    preserve,
    diff: { previousTotal: baselineTotal, currentTotal: current, totalDelta: current - baselineTotal }
  };
  while (JSON.stringify(response).length > 12000 && response.plan.length) {
    response.plan.pop();
    response.truncated = true;
    response.remainingFindings = ranked.length - response.plan.length;
  }
  if (includeDiff) response.diffText = selected.map((finding) => `${finding.file}:${finding.startLine}-${finding.endLine} ${finding.action}`).join('\n');
  attachInternal(response, {
    sources: Object.fromEntries(selected.map((finding) => [finding.id, finding._sourceText])),
    sourceCounts: Object.fromEntries(selected.map((finding) => {
      const source = finding._sourceText ?? '';
      const original = files.find((file) => file.path === finding.file)?.text ?? '';
      return [finding.id, occurrenceCount(original, source)];
    })),
    required: Object.fromEntries(selected.filter((finding) => finding._required?.length).map((finding) => [finding.id, finding._required])),
    preserveText,
    postHashes: {},
    fileTokens: Object.fromEntries(files.map((file) => [file.path, file.tokens]))
  });
  for (const finding of selected) delete finding._sourceText;
  for (const finding of selected) delete finding._canonicalSpan;
  for (const finding of selected) delete finding._required;
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
  const prepared = [];
  try {
    for (const [file, findings] of byFile) {
      const target = path.join(root, file);
      const originalStat = await stat(target);
      const original = await readFile(target, 'utf8');
      const lines = original.split('\n');
      const sorted = [...findings].sort((a, b) => b.startLine - a.startLine);
      for (const [index, finding] of sorted.entries()) {
        if (finding.startLine < 1 || finding.endLine > lines.length) throw new Error('line range drifted');
        if (index > 0 && finding.endLine >= sorted[index - 1].startLine) throw new Error('overlapping line ranges');
        if (finding.action === 'condense') {
          lines.splice(finding.startLine - 1, finding.endLine - finding.startLine + 1, finding.condensedText);
        } else {
          lines.splice(finding.startLine - 1, finding.endLine - finding.startLine + 1);
        }
      }
      const temp = `${target}.ctxcap-${plan.planId}.tmp`;
      await writeFile(temp, lines.join('\n'), 'utf8');
      // rename replaces the original inode, so preserve its permission bits on
      // the replacement instead of inheriting the process umask defaults.
      await chmod(temp, originalStat.mode & 0o777);
      prepared.push({ file, findings, target, temp, original, text: lines.join('\n') });
    }
    const renamed = [];
    for (const item of prepared) {
      await rename(item.temp, item.target);
      renamed.push(item);
      plan._internal.postHashes[item.file] = hashText(item.text);
      applied.push(...item.findings.map((finding) => finding.id));
    }
  } catch {
    for (const item of prepared) {
      try { await unlink(item.temp); } catch {}
    }
    for (const item of prepared.filter((candidate) => applied.some((id) => candidate.findings.some((finding) => finding.id === id)))) {
      try { await writeFile(item.target, item.original, 'utf8'); } catch {}
    }
    applied.length = 0;
    missed.push(...plan.plan.map((finding) => finding.id));
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
    const internal = plan._internal ?? { sources: {}, preserveText: {}, postHashes: {}, fileTokens: {} };
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
  const fileTexts = new Map();
  for (const [file, expected] of Object.entries(postHashes)) {
    try {
      const current = await readFile(path.join(root, file), 'utf8');
      fileTexts.set(file, current);
      if (hashText(current) !== expected) driftedFiles.add(file);
    } catch {
      driftedFiles.add(file);
    }
  }
  for (const finding of plan.plan) {
    if (!fileTexts.has(finding.file) && !driftedFiles.has(finding.file)) {
      try {
        fileTexts.set(finding.file, await readFile(path.join(root, finding.file), 'utf8'));
      } catch {
        driftedFiles.add(finding.file);
      }
    }
  }
  const sourceGroups = new Map();
  for (const finding of plan.plan) {
    if (driftedFiles.has(finding.file)) {
      missed.push(finding.id);
      continue;
    }
    const fileText = fileTexts.get(finding.file);
    if (fileText === undefined) {
      missed.push(finding.id);
      continue;
    }
    const sourceText = plan._internal?.sources?.[finding.id] ?? finding.sourceText ?? finding.rationale.split(' (')[0];
    const originalCount = plan._internal?.sourceCounts?.[finding.id];
    if (!Number.isInteger(originalCount)) {
      // Compatibility for plans saved before occurrence counts were recorded.
      if (fileText.includes(sourceText)) missed.push(finding.id);
      else applied.push(finding.id);
      continue;
    }
    const key = JSON.stringify([finding.file, sourceText, originalCount]);
    if (!sourceGroups.has(key)) sourceGroups.set(key, { fileText, sourceText, originalCount, findings: [] });
    sourceGroups.get(key).findings.push(finding);
  }
  for (const group of sourceGroups.values()) {
    // Count occurrences rather than asking whether the text survives anywhere:
    // a same-file duplicate is successful when one copy remains as canonical.
    const removed = Math.max(0, group.originalCount - occurrenceCount(group.fileText, group.sourceText));
    group.findings.forEach((finding, index) => {
      (index < removed ? applied : missed).push(finding.id);
    });
  }
  for (const finding of plan.plan) {
    const fileText = fileTexts.get(finding.file);
    if (fileText === undefined) continue;
    const flat = fileText.replace(/\s+/g, ' ');
    for (const sentence of plan._internal?.required?.[finding.id] ?? []) {
      if (!flat.includes(sentence)) violations.push({ file: finding.file, startLine: finding.startLine, endLine: finding.endLine, reason: 'rule sentence removed', text: sentence });
    }
  }
  for (const span of plan.preserve) {
    // A condensed span is checked by its rule sentences above, not verbatim.
    const intentionallyRemoved = plan.plan.some((finding) =>
      (finding.action === 'deleteKeepingCanonical' || finding.action === 'condense') &&
      applied.includes(finding.id) &&
      overlaps(finding, span)
    );
    if (intentionallyRemoved) continue;
    try {
      const text = await readFile(path.join(root, span.file), 'utf8');
      const expected = plan._internal?.preserveText?.[`${span.file}:${span.startLine}:${span.endLine}`];
      if (expected && !text.includes(expected)) violations.push({ file: span.file, startLine: span.startLine, endLine: span.endLine, reason: span.reason });
    } catch {
      violations.push({ file: span.file, startLine: span.startLine, endLine: span.endLine, reason: span.reason });
    }
  }
  const changedFiles = new Set(plan.plan.map((finding) => finding.file));
  const changedTokens = [...changedFiles].reduce((total, file) => {
    const before = plan._internal?.fileTokens?.[file];
    const current = fileTexts.get(file);
    return before === undefined || current === undefined ? total : total + before - countTokens(current);
  }, 0);
  const remaining = Math.max(0, plan.current - changedTokens);
  return { applied, missed, violations, remaining, satisfied: missed.length === 0 && violations.length === 0 && remaining <= plan.budget };
}
