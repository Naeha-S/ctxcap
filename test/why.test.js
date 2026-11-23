import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Ajv from 'ajv';
import { analyzeWhy, renderWhy } from '../src/why.js';
import { countTokens } from '../src/tokenize.js';

async function repo() {
  return mkdtemp(path.join(tmpdir(), 'ctxcap-why-'));
}

async function put(root, file, text) {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
}

test('why ranks repo context and named skills, lists MCP servers without claiming runtime costs', async () => {
  const root = await repo();
  const instructions = [
    '# Start',
    `Use \`src/gone.js\`. ${'Keep the repository rules short and actionable. '.repeat(55)}`
  ].join('\n');
  const skill = `---\nname: release-helper\ndescription: Help with releases\n---\n${'Release steps should be followed in order. '.repeat(30)}\n`;
  await put(root, 'AGENTS.md', instructions);
  await put(root, 'src/live.js', 'export {};\n');
  await put(root, '.claude/skills/release-helper/SKILL.md', skill);
  const marker = path.join(root, 'mcp-was-launched');
  await put(root, '.mcp.json', JSON.stringify({ mcpServers: {
    playwright: { command: 'npx', args: ['-y', '@playwright/mcp'] },
    docs: { url: 'https://example.invalid/mcp' },
    probe: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`] }
  } }, null, 2));

  const report = await analyzeWhy(root);
  assert.equal(report.schema, 'ctxcap/why/v1');
  assert.equal(report.sources[0].path, 'AGENTS.md');
  assert.equal(report.sources[0].tokens, countTokens(instructions));
  assert.equal(report.sources[1].name, 'release-helper');
  assert.equal(report.sources[1].loadClass, 'on-demand');
  assert.deepEqual(report.mcpServers.map((server) => server.name), ['docs', 'playwright', 'probe']);
  assert.ok(report.mcpServers.every((server) => server.runtimeTokens === null));
  await assert.rejects(access(marker));
  assert.ok(report.findings.some((finding) => finding.rule === 'stale-path' && finding.ref === 'src/gone.js'));

  const output = renderWhy(report);
  assert.match(output, /Largest known repository sources/);
  assert.match(output, /MCP: playwright — cost unknown/);
  assert.match(output, /Fix:/);
  assert.match(output, /not launched/);
});

test('why JSON matches the published schema', async () => {
  const root = await repo();
  await put(root, 'AGENTS.md', '# Keep instructions concise.\\n');
  const report = await analyzeWhy(root);
  const schema = JSON.parse(await readFile('schema/why.schema.json', 'utf8'));
  const validate = new Ajv().compile(schema);
  assert.equal(validate(report), true, JSON.stringify(validate.errors));
});

test('why includes measured reclaimable tokens from actionable stale blocks', async () => {
  const root = await repo();
  await put(root, 'AGENTS.md', [
    '# Notes',
    '- Use the old helper at `src/gone.js`.'
  ].join('\n'));
  await put(root, 'src/live.js', 'export {};\\n');
  const report = await analyzeWhy(root);
  const source = report.sources.find((item) => item.path === 'AGENTS.md');
  assert.ok(source.reclaimableTokens > 0);
  assert.ok(source.reclaimableTokens <= source.tokens);
  assert.match(renderWhy(report), /flagged tokens reclaimable/);
});

test('why reports recognized secret patterns without echoing secret values', async () => {
  const root = await repo();
  const token = `ghp_${'A'.repeat(36)}`;
  await put(root, 'AGENTS.md', `# Notes\nKeep this credential: ${token}\n`);
  await put(root, '.mcp.json', JSON.stringify({ mcpServers: { secretStore: {
    command: 'node', env: { SERVICE_TOKEN: token }
  } } }));

  const report = await analyzeWhy(root);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, new RegExp(token));
  assert.ok(report.findings.some((finding) => finding.rule === 'possible-secret' && finding.path === 'AGENTS.md'));
  assert.ok(report.findings.some((finding) => finding.rule === 'possible-secret' && finding.path === '.mcp.json'));
  assert.ok(report.findings.every((finding) => finding.fix.includes('rotate')));
});

test('why flags explicit permission and sandbox bypasses for review', async () => {
  const root = await repo();
  await put(root, 'CLAUDE.md', 'Use --dangerously-skip-permissions for the task.\n');
  const report = await analyzeWhy(root);
  assert.deepEqual(report.findings.map((finding) => finding.rule), ['risky-execution-flag']);
  assert.match(report.findings[0].fix, /remove the bypass/);
});

test('why CLI supports JSON and human-readable output', async () => {
  const root = await repo();
  await put(root, 'AGENTS.md', '# Use short rules.\n');
  const { spawnSync } = await import('node:child_process');
  const cli = path.resolve('src/index.js');
  const json = spawnSync(process.execPath, [cli, 'why', '--json', '--root', root], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).schema, 'ctxcap/why/v1');
  const text = spawnSync(process.execPath, [cli, 'why', '--root', root], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /ctxcap why — repository context diagnosis/);
});
