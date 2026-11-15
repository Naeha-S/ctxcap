import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };

const SERVER = path.resolve('mcp/server.js');

// MCP stdio transport: one JSON-RPC message per line.
function request(proc, message) {
  return new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      const end = output.indexOf('\n');
      if (end === -1) return;
      proc.stdout.off('data', onData);
      resolve(JSON.parse(output.slice(0, end)));
    };
    proc.stdout.on('data', onData);
    proc.once('error', reject);
    proc.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

test('MCP initialize and tools call return the current package version and report', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-mcp-'));
  await writeFile(path.join(dir, 'AGENTS.md'), 'Use short instructions.');
  const proc = spawn(process.execPath, [SERVER], { cwd: dir });
  try {
    const initialized = await request(proc, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(initialized.result.serverInfo.version, packageJson.version);

    const listed = await request(proc, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['measure_context', 'context_budget_plan', 'context_budget_verify', 'trim_to_budget']);
    assert.match(listed.result.tools[1].description, /CLAUDE\.md/);
    assert.match(listed.result.tools[1].description, /context_budget_verify/);

    const measured = await request(proc, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'measure_context', arguments: {} }
    });
    const report = JSON.parse(measured.result.content[0].text);
    assert.deepEqual(report.files.map((file) => file.path), ['AGENTS.md']);

    const planned = await request(proc, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'context_budget_plan', arguments: { budget: 1 } }
    });
    const plan = JSON.parse(planned.result.content[0].text);
    assert.equal(plan.schema, 'ctxcap/plan/v2');
    assert.equal(Object.hasOwn(plan.plan[0] ?? {}, 'sourceText'), false);
    const verified = await request(proc, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'context_budget_verify', arguments: { planId: plan.planId } }
    });
    assert.equal(JSON.parse(verified.result.content[0].text).satisfied, false);

    const invalid = await request(proc, {
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'context_budget_plan', arguments: { budget: -1 } }
    });
    assert.equal(invalid.result.isError, true);
    assert.equal(JSON.parse(invalid.result.content[0].text).error.code, 'BUDGET_INVALID');

    const alias = await request(proc, {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'trim_to_budget', arguments: { budget: 1 } }
    });
    const aliasPlan = JSON.parse(alias.result.content[0].text);
    assert.equal(aliasPlan.apply, false);
  } finally {
    proc.kill();
  }
});

test('a plan made in one server session can be verified in the next', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-mcp-'));
  await writeFile(path.join(dir, 'AGENTS.md'), 'Use short instructions.');
  const call = async (name, args) => {
    const proc = spawn(process.execPath, [SERVER], { cwd: dir });
    try {
      const response = await request(proc, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
      return JSON.parse(response.result.content[0].text);
    } finally {
      proc.kill();
    }
  };
  const plan = await call('context_budget_plan', { budget: 1 });
  const verified = await call('context_budget_verify', { planId: plan.planId });
  assert.equal(verified.satisfied, false);
  assert.deepEqual(verified.violations, []);
  const missing = await call('context_budget_verify', { planId: 'ffffff' });
  assert.equal(missing.error.code, 'PLAN_EXPIRED');
});

test('release files agree: server.json follows the MCP package, which accepts this CLI', async () => {
  const read = async (file) => JSON.parse(await readFile(path.resolve(file), 'utf8'));
  const mcpPackage = await read('packages/ctxcap-mcp/package.json');
  const server = await read('server.json');

  assert.equal(server.version, mcpPackage.version);
  assert.deepEqual(server.packages.map((entry) => [entry.identifier, entry.version]), [['ctxcap-mcp', mcpPackage.version]]);
  assert.equal(server.name, mcpPackage.mcpName);

  // The wrapper only imports ctxcap/mcp/server.js, so its range decides which
  // server a fresh install gets. It must start at this release, not before it.
  assert.equal(mcpPackage.dependencies.ctxcap, `^${packageJson.version}`);
});
