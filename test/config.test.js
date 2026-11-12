import test from 'node:test';
import assert from 'node:assert';
import { loadConfig, DEFAULTS } from '../src/config.js';

test('missing config yields defaults', async () => {
  const c = await loadConfig(process.cwd(), 'nope.json');
  assert.deepEqual(c.include, DEFAULTS.include);
  assert.equal(c.failOn, null);
});

import { assertSafePatterns } from '../src/config.js';

test('rejects escaping and absolute patterns', () => {
  assert.throws(() => assertSafePatterns(['../secrets/**'], 'include'));
  assert.throws(() => assertSafePatterns(['/etc/*'], 'include'));
  assert.throws(() => assertSafePatterns('prompts/**', 'include'));
  assert.doesNotThrow(() => assertSafePatterns(['prompts/**', '!prompts/old/**'], 'include'));
});
