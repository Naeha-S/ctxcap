import test from 'node:test';
import assert from 'node:assert';
import { countTokens } from '../src/tokenize.js';

test('counts scale with text', () => {
  assert.ok(countTokens('hello world') > 0);
  assert.ok(countTokens('hello world hello world') > countTokens('hello world'));
});

test('empty is zero', () => {
  assert.equal(countTokens(''), 0);
});

test('counts are deterministic', () => {
  const s = 'The quick brown fox jumps over the lazy dog.';
  assert.equal(countTokens(s), countTokens(s));
});
