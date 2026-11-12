import test from 'node:test';
import assert from 'node:assert';
import { buildReport, exitCodeFor, renderText, renderSarif, TOOL_NAME } from '../src/report.js';

const config = { budgets: {} };

test('delta is against baseline', () => {
  const r = buildReport({ files: [{ path: 'a.md', tokens: 100 }], baseline: { 'a.md': 40 }, config });
  assert.equal(r.delta, 60);
  assert.equal(r.files[0].delta, 60);
});

test('new file counts fully', () => {
  const r = buildReport({ files: [{ path: 'new.md', tokens: 25 }], baseline: {}, config });
  assert.equal(r.delta, 25);
});

test('deleted file is negative delta', () => {
  const r = buildReport({ files: [], baseline: { 'gone.md': 30 }, config });
  assert.equal(r.delta, -30);
});

test('fail-on increase', () => {
  const r = buildReport({ files: [{ path: 'a.md', tokens: 10 }], baseline: {}, config });
  assert.equal(exitCodeFor(r, 'increase'), 1);
  assert.equal(exitCodeFor(r, null), 0);
});

test('fail-on budget', () => {
  const r = buildReport({
    files: [{ path: 'a.md', tokens: 50 }],
    baseline: { 'a.md': 50 },
    config: { budgets: { 'a.md': 40 } }
  });
  assert.equal(r.over, true);
  assert.equal(exitCodeFor(r, 'budget'), 1);
});

test('total budget triggers over', () => {
  const r = buildReport({
    files: [{ path: 'a.md', tokens: 50 }],
    baseline: {},
    config: { budgets: { total: 10 } }
  });
  assert.equal(r.over, true);
});

test('renderText includes column headers and baseline notice when missing', () => {
  const r = buildReport({ files: [{ path: 'a.md', tokens: 10 }], baseline: {}, baselineFound: false, config });
  const text = renderText(r);
  assert.ok(text.startsWith('TOKENS\tDELTA\tFILE'));
  assert.ok(text.includes('no baseline found — delta is the full current size'));
  assert.ok(text.includes(`run: ${TOOL_NAME} --update-baseline`));
});

test('renderSarif driver name matches TOOL_NAME', () => {
  const r = buildReport({
    files: [{ path: 'a.md', tokens: 50 }],
    baseline: { 'a.md': 50 },
    config: { budgets: { 'a.md': 40 } }
  });
  const sarif = renderSarif(r);
  assert.equal(sarif.runs[0].tool.driver.name, TOOL_NAME);
});
