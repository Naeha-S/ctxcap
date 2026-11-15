#!/usr/bin/env node
// Minimal stdio MCP server (newline-delimited JSON-RPC, per the MCP stdio transport). No SDK dependency.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../src/config.js';
import { collectFiles, loadClassFor } from '../src/glob.js';
import { countTokens } from '../src/tokenize.js';
import { loadBaseline } from '../src/baseline.js';
import { buildReport, TOOL_NAME } from '../src/report.js';
import { suggest } from '../src/suggest.js';
import { VERSION } from '../src/version.js';
import { findStale } from '../src/stale.js';
import { makePlan, savePlan, loadPlan, verifyPlan } from '../src/plan.js';

const PROTOCOL = '2024-11-05';
const ROOT = process.cwd();
const plans = new Map();

const TOOLS = [
  {
    name: 'measure_context',
    description: 'Use when CLAUDE.md, AGENTS.md, Cursor rules, or prompts may be too large or consuming too much context. Input: optional suggest, stale, and staleGlob booleans. Returns JSON token totals, per-file counts, baseline deltas, budget status, suggestions, and optional stale-reference findings. Runs offline and only reads the current working directory.',
    inputSchema: { type: 'object', properties: { suggest: { type: 'boolean' }, stale: { type: 'boolean' }, staleGlob: { type: 'boolean' } } }
  },
  {
    name: 'context_budget_plan',
    description: 'Use before appending more than ~50 lines or when CLAUDE.md, AGENTS.md, Cursor rules, or prompts exceed budget. Input: required integer budget plus optional maxFindings, includeDiff, and apply. Returns a deterministic ranked plan with file line ranges, tokensFreed, confidence, safety actions, preserve spans, and satisfiable/minAchievable stop state. Apply entries in order by startLine/endLine, never rewrite a file, never cut preserve spans except by applying the condensedText of a condense entry exactly as given, stop when satisfiable is false, and call context_budget_verify after edits. The plan is saved under .ctxcap/plans for 24 hours.',
    inputSchema: { type: 'object', required: ['budget'], properties: { budget: { type: 'integer' }, maxFindings: { type: 'integer' }, includeDiff: { type: 'boolean' }, apply: { type: 'boolean' } } }
  },
  {
    name: 'context_budget_verify',
    description: 'Use after applying a context-budget plan to catch missed edits, manual drift, or preserve-span violations. Input: the planId returned by context_budget_plan. Returns applied and missed finding IDs, violations with file and line ranges, remaining tokens, and satisfied. Do not consider the budget met until satisfied is true.',
    inputSchema: { type: 'object', required: ['planId'], properties: { planId: { type: 'string' } } }
  },
  {
    name: 'trim_to_budget',
    description: 'Deprecated alias for context_budget_plan for clients using the old name. Input: required integer budget and optional maxFindings. Returns the same ranked, safety-classified plan with apply false; it never edits context files. Follow line ranges, preserve spans, satisfiable stop rules, and verification guidance from context_budget_plan.',
    inputSchema: { type: 'object', required: ['budget'], properties: { budget: { type: 'integer' }, maxFindings: { type: 'integer' } } }
  }
];

async function measure(extra) {
  const config = await loadConfig(ROOT);
  if (extra?.total) config.budgets.total = extra.total;
  const paths = await collectFiles(ROOT, config);
  const files = [];
  for (const p of paths) {
    const text = await readFile(path.join(ROOT, p), 'utf8');
    files.push({ path: p, text, tokens: countTokens(text), loadClass: loadClassFor(p) });
  }
  const baseline = await loadBaseline(ROOT, null);
  const findings = extra?.stale ? await findStale(files, ROOT, config, { staleGlob: extra.staleGlob }) : [];
  return buildReport({ files, baseline, config, suggestions: extra?.suggest ? suggest(files) : [], findings });
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, message, code = -32603) => send({ jsonrpc: '2.0', id, error: { code, message } });
const toolResult = (value, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) });

// One JSON-RPC message per line, handled in arrival order.
let buf = '';
let queue = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  for (let idx = buf.indexOf('\n'); idx !== -1; idx = buf.indexOf('\n')) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { fail(null, 'parse error', -32700); continue; }
    queue = queue.then(() => handle(msg));
  }
});

async function handle(msg) {
  const { id, method, params } = msg;
  try {
    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: TOOL_NAME, version: VERSION }
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params?.name;
      if (name === 'measure_context') {
        const r = await measure({ suggest: params?.arguments?.suggest, stale: params?.arguments?.stale, staleGlob: params?.arguments?.staleGlob });
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
      }
      if (name === 'context_budget_plan' || name === 'trim_to_budget') {
        const args = params?.arguments ?? {};
        const config = await loadConfig(ROOT);
        const paths = await collectFiles(ROOT, config);
        const files = [];
        for (const p of paths) {
          const text = await readFile(path.join(ROOT, p), 'utf8');
          files.push({ path: p, text, tokens: countTokens(text), loadClass: loadClassFor(p) });
        }
        const plan = await makePlan({
          files, root: ROOT, config, budget: args.budget,
          maxFindings: args.maxFindings ?? 15,
          includeDiff: args.includeDiff ?? false,
          apply: name === 'context_budget_plan' && args.apply === true
        });
        if (name === 'trim_to_budget') plan.apply = false;
        plans.set(plan.planId, plan);
        await savePlan(ROOT, plan);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(plan) }] });
      }
      if (name === 'context_budget_verify') {
        // Plans are also saved to .ctxcap/plans, so they survive a restart and
        // are shared with `ctxcap --verify`.
        const planId = String(params?.arguments?.planId ?? '');
        const plan = plans.get(planId) ?? (/^[0-9a-f]{6}$/.test(planId) ? await loadPlan(ROOT, planId).catch(() => null) : null);
        if (!plan) return reply(id, toolResult({ error: { code: 'PLAN_EXPIRED', message: 'plan not found or expired', fix: 'generate a new plan' } }, true));
        return reply(id, toolResult(await verifyPlan(plan, ROOT)));
      }
      return fail(id, `unknown tool: ${name}`, -32602);
    }
    if (id === undefined) return; // notification
    return fail(id, `method not found: ${method}`, -32601);
  } catch (err) {
    if (id !== undefined) {
      const error = { error: { code: err.code ?? 'TOKENIZER_FAILED', message: err.message, ...(err.fix ? { fix: err.fix } : {}) } };
      return method === 'tools/call' ? reply(id, toolResult(error, true)) : fail(id, err.message);
    }
  }
}
