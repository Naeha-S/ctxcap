import test from 'node:test';
import assert from 'node:assert';
import { annotations, escProp, summary } from '../scripts/annotate.mjs';

const report = {
  approximate: true, total: 300, totalBudget: 200, delta: 50, over: true,
  files: [{ path: 'prompts/a,b:c.md', tokens: 300, delta: 50, budget: 100 }]
};

test('emits escaped warning per over-budget file plus total', () => {
  const out = annotations(report);
  assert.equal(out.length, 2);
  assert.ok(out[0].startsWith('::warning file=prompts/a%2Cb%3Ac.md,line=1'));
  assert.ok(out[1].includes('exceeds budget 200'));
});

test('escapes newlines', () => {
  assert.equal(escProp('a\nb'), 'a%0Ab');
});

test('summary lists changed files', () => {
  assert.ok(summary(report).includes('| `prompts/a,b:c.md` | 300 | +50 |'));
});
