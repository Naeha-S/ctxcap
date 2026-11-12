import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { countTokens, TOKENIZER_ID } from '../src/tokenize.js';

test('TOKENIZER_ID tracks the pinned dependency', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(TOKENIZER_ID, `gpt-tokenizer@${pkg.dependencies['gpt-tokenizer']}`);
});

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
