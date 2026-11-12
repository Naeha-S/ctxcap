#!/usr/bin/env node
// Minimal stdio MCP server (Content-Length framed JSON-RPC). No SDK dependency.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { loadConfig } from '../src/config.js';
import { collectFiles } from '../src/glob.js';
import { countTokens } from '../src/tokenize.js';
import { loadBaseline } from '../src/baseline.js';
import { buildReport } from '../src/report.js';
import { suggest } from '../src/suggest.js';

const PROTOCOL = '2024-11-05';
const ROOT = process.cwd();

const TOOLS = [
  {
    name: 'measure_context',
    description: 'Measure token cost and delta of context files. Returns JSON.',
    inputSchema: { type: 'object', properties: { suggest: { type: 'boolean' } } }
  },
  {
    name: 'trim_to_budget',
    description: 'Report which context files exceed budget, largest first, so they can be compressed.',
    inputSchema: { type: 'object', properties: { total: { type: 'integer' } } }
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
  return buildReport({ files, baseline, config, suggestions: extra?.suggest ? suggest(files) : [] });
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
        serverInfo: { name: 'ctxlint', version: '0.1.0' }
      });
    }
    if (method === 'tools/list') return reply(id, { tools: TOOLS });
    if (method === 'tools/call') {
      const name = params?.name;
      if (name === 'measure_context') {
        const r = await measure({ suggest: params?.arguments?.suggest });
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
      }
      if (name === 'trim_to_budget') {
        const r = await measure({ total: params?.arguments?.total });
        const ranked = [...r.files].sort((a, b) => b.tokens - a.tokens);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify({ over: r.over, total: r.total, largest: ranked.slice(0, 5) }, null, 2) }] });
      }
      return fail(id, `unknown tool: ${name}`, -32602);
    }
    if (id === undefined) return; // notification
    return fail(id, `method not found: ${method}`, -32601);
  } catch (err) {
    if (id !== undefined) fail(id, err.message);
  }
}
