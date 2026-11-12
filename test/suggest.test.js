import test from 'node:test';
import assert from 'node:assert';
import { suggest } from '../src/suggest.js';

test('flags repeated lines and duplicate headings', () => {
  const text = '# Deploy\nrun the deploy script now\nrun the deploy script now\nrun the deploy script now\n';
  const out = suggest([
    { path: 'a.md', text, tokens: 20 },
    { path: 'b.md', text: '# Deploy\nx', tokens: 5 }
  ]);
  assert.ok(out.some((s) => s.reason.includes('repeated 3x')));
  assert.ok(out.some((s) => s.reason.includes('duplicate heading')));
});
