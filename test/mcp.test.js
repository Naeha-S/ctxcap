import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import packageJson from '../package.json' with { type: 'json' };

const SERVER = path.resolve('mcp/server.js');

function request(proc, message) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(message);
    let output = Buffer.alloc(0);
    const onData = (chunk) => {
      output = Buffer.concat([output, chunk]);
      const end = output.indexOf('\r\n\r\n');
      if (end === -1) return;
      const match = /Content-Length: (\d+)/i.exec(output.subarray(0, end).toString());
      if (!match) return reject(new Error('missing Content-Length'));
      const length = Number(match[1]);
      const start = end + 4;
      if (output.length < start + length) return;
      proc.stdout.off('data', onData);
      resolve(JSON.parse(output.subarray(start, start + length).toString()));
    };
    proc.stdout.on('data', onData);
    proc.once('error', reject);
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
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
    assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['measure_context', 'trim_to_budget']);

    const measured = await request(proc, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'measure_context', arguments: {} }
    });
    const report = JSON.parse(measured.result.content[0].text);
    assert.deepEqual(report.files.map((file) => file.path), ['AGENTS.md']);
  } finally {
    proc.kill();
  }
});
