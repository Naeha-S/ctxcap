import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { countTokens, TOKENIZER_ID } from '../src/tokenize.js';
import { buildIndex, definitions, markdown, measureTools } from '../scripts/mcp-index.mjs';
import { page } from '../scripts/mcp-index-page.mjs';
import { committed } from './helpers.js';

const data = JSON.parse(await readFile('mcp-index/2026-11.json', 'utf8'));

test('mcp index: the count is name, description, and inputSchema, and nothing a client does not send', () => {
  const tools = [
    { name: 'a', description: 'does a thing', inputSchema: { type: 'object' }, title: 'A', annotations: { readOnlyHint: true }, outputSchema: { type: 'object' } },
    { name: 'b', description: '', inputSchema: {} }
  ];
  const expected = JSON.stringify([
    { name: 'a', description: 'does a thing', inputSchema: { type: 'object' } },
    { name: 'b', description: '', inputSchema: {} }
  ]);
  assert.equal(JSON.stringify(definitions(tools)), expected);
  const measured = measureTools(tools);
  assert.equal(measured.tools, 2);
  assert.equal(measured.tokens, countTokens(expected));
  assert.equal(measured.bytes, Buffer.byteLength(expected));
  // A title and annotations are not part of the cost this index claims.
  const withExtras = tools.map((tool) => ({ ...tool, title: 'a much longer title '.repeat(20) }));
  assert.equal(measureTools(withExtras).tokens, measured.tokens);
});

test('mcp index: rows are ranked by tokens, ties by name, and totals add up', () => {
  const rows = [
    { name: 'b', tokens: 10, tools: 1 },
    { name: 'a', tokens: 10, tools: 1 },
    { name: 'c', tokens: 90, tools: 2 }
  ];
  const index = buildIndex({ results: rows, month: '2027-01', date: '2027-01-01', version: '9.9.9' });
  assert.deepEqual(index.rows.map((row) => `${row.rank}:${row.name}`), ['1:c', '2:a', '3:b']);
  assert.equal(index.tools, 4);
  assert.equal(index.servers, 3);
  assert.equal(index.tokenizer, TOKENIZER_ID);
  // buildIndex must not reorder the caller's array in place.
  assert.equal(rows[0].name, 'b');
});

test('mcp index: the committed markdown is the committed data', async () => {
  assert.equal(await committed('mcp-index/2026-11.md'), markdown(data));
});

test('mcp index: the committed data is plausible, and every pin is in the manifest', async () => {
  assert.equal(data.title, 'The MCP Context Cost Index');
  assert.equal(data.month, '2026-11');
  assert.equal(data.rows.length, 16);
  const self = data.rows.find((row) => row.name === 'ctxcap');
  assert.equal(self.tools, 4);
  assert.ok(self.tokens > 400 && self.tokens < 600, `ctxcap tool definitions: ${self.tokens}`);
  assert.deepEqual([...data.rows].sort((a, b) => b.tokens - a.tokens).map((row) => row.name), data.rows.map((row) => row.name));
  for (const row of data.rows) {
    assert.ok(row.tokens > 0, row.name);
    assert.ok(row.tools > 0, row.name);
    assert.ok(row.tokens >= row.tools, `${row.name}: every tool costs at least one token`);
  }
  // A month is measured once. Later releases may bump the pins, so a
  // historical row is not required to equal today's pin; every measured
  // server must still have an entry, which is what keeps the manifest honest.
  const spec = JSON.parse(await committed('scripts/mcp-servers.json'));
  for (const row of data.rows) {
    const pinned = spec.servers.find((entry) => entry.name === row.name);
    assert.ok(pinned, `${row.name} is not in scripts/mcp-servers.json`);
    assert.match(row.version, /^\d+\.\d+\.\d+/, row.name);
  }
});

test('mcp index page: ranked table, lower-bound method, and nothing loaded from elsewhere', () => {
  const html = page(data, { root: true });
  assert.match(html, /<title>The MCP Context Cost Index, November 2026: what MCP servers cost in context<\/title>/);
  assert.ok(html.includes('<h1>The MCP Context Cost Index</h1>'));
  assert.ok(html.includes('<b>16</b><span>servers measured over stdio</span>'));
  assert.equal(html.match(/<table/g).length, 1);
  assert.equal(html.match(/<td class="rank">/g).length, 16);
  assert.ok(html.indexOf('Sentry') < html.indexOf('Browserbase'));
  assert.ok(html.includes('46,512'));
  assert.ok(html.includes('lower bound'));
  assert.ok(html.includes('Not measured'));
  assert.ok(html.includes('Supabase'));
  assert.ok(html.includes('<a href="../">The Context Budget Index</a>'));
  assert.ok(html.includes('mcp/2026-11/') || html.includes('2026-11/'));
  // Static, self-contained, and no third-party anything.
  assert.doesNotMatch(html, /<script|<img|rel="stylesheet"|@import|url\(/);
  assert.ok(!html.includes('<footer'));
});

test('mcp index page: a month page is permanent and links the others', () => {
  const html = page(data, { months: ['2026-10', '2026-11'], root: false });
  assert.ok(html.includes('<link rel="canonical" href="https://naeha-s.github.io/ctxcap/mcp/2026-11/">'));
  assert.ok(html.includes('<a href="../">The newest month is here.</a>'));
  assert.ok(html.includes('2026-10/'));
});
