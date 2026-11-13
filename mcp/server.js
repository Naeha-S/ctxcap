#!/usr/bin/env node
// Minimal stdio MCP server (Content-Length framed JSON-RPC). No SDK dependency.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../src/config.js';
import { collectFiles } from '../src/glob.js';
import { countTokens } from '../src/tokenize.js';
import { loadBaseline } from '../src/baseline.js';
import { buildReport, TOOL_NAME } from '../src/report.js';
import { suggest } from '../src/suggest.js';
import { VERSION } from '../src/version.js';
import { findStale } from '../src/stale.js';
import { makePlan, verifyPlan } from '../src/plan.js';

const PROTOCOL = '2024-11-05';
const ROOT = process.cwd();
const plans = new Map();

const TOOLS = [
  {
    name: 'measure_context',
    description: 'Measure token cost and delta of context files. Returns JSON.',
    inputSchema: { type: 'object', properties: { suggest: { type: 'boolean' }, stale: { type: 'boolean' }, staleGlob: { type: 'boolean' } } }
  },
  {
    name: 'context_budget_plan',
    description: 'Call before appending more than ~50 lines to a context file, or when a file exceeds its budget. Returns a ranked splice plan. Apply entries in order by line range; never rewrite the file from scratch. If satisfiable is false, report minAchievable and stop. Never cut spans listed in preserve.',
    inputSchema: { type: 'object', required: ['budget'], properties: { budget: { type: 'integer' }, maxFindings: { type: 'integer' }, includeDiff: { type: 'boolean' }, apply: { type: 'boolean' } } }
  },
  {
    name: 'context_budget_verify',
    description: 'Call after applying a plan. Reports missed edits and preserve-span violations. Do not consider the budget met until satisfied is true.',
    inputSchema: { type: 'object', required: ['planId'], properties: { planId: { type: 'string' } } }
  },
  {
    name: 'trim_to_budget',
    description: 'Deprecated alias for context_budget_plan. Returns a ranked plan with apply false.',
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
    files.push({ path: p, text, tokens: countTokens(text) });
  }
  const baseline = await loadBaseline(ROOT, null);
  const findings = extra?.stale ? await findStale(files, ROOT, config, { staleGlob: extra.staleGlob }) : [];
  return buildReport({ files, baseline, config, suggestions: extra?.suggest ? suggest(files) : [], findings });
}

function send(msg) {
  const body = JSON.stringify(msg);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, message, code = -32603) => send({ jsonrpc: '2.0', id, error: { code, message } });

let buf = Buffer.alloc(0);
process.stdin.on('data', async (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const idx = buf.indexOf('\r\n\r\n');
    if (idx === -1) return;
    const m = /Content-Length: (\d+)/i.exec(buf.subarray(0, idx).toString('utf8'));
    if (!m) { buf = buf.subarray(idx + 4); continue; }
    const len = Number(m[1]);
    const start = idx + 4;
    if (buf.length < start + len) return;
    const raw = buf.subarray(start, start + len).toString('utf8');
    buf = buf.subarray(start + len);
    let msg;
    try { msg = JSON.parse(raw); } catch { continue; }
    await handle(msg);
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
          files.push({ path: p, text, tokens: countTokens(text) });
        }
        const plan = await makePlan({
          files, root: ROOT, config, budget: args.budget,
          maxFindings: args.maxFindings ?? 15,
          includeDiff: args.includeDiff ?? false,
          apply: name === 'context_budget_plan' && args.apply === true
        });
        if (name === 'trim_to_budget') plan.apply = false;
        plans.set(plan.planId, plan);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(plan) }] });
      }
      if (name === 'context_budget_verify') {
        const plan = plans.get(params?.arguments?.planId);
        if (!plan) return fail(id, 'plan not found', -32602);
        return reply(id, await verifyPlan(plan, ROOT));
      }
      return fail(id, `unknown tool: ${name}`, -32602);
    }
    if (id === undefined) return; // notification
    return fail(id, `method not found: ${method}`, -32601);
  } catch (err) {
    if (id !== undefined) {
      const error = { error: { code: err.code ?? 'TOKENIZER_FAILED', message: err.message, ...(err.fix ? { fix: err.fix } : {}) } };
      return reply(id, error);
    }
  }
}
