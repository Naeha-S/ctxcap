// Pinned tokenizer (exact version in package.json). Counts must be stable
// across runs or deltas become noise. Falls back to chars/4 if unavailable,
// and the report says so via `tokenizer`.
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
export const TOKENIZER_ID = `gpt-tokenizer@${pkg.dependencies['gpt-tokenizer']}`;
export const APPROXIMATE = true;

let encode = null;
try {
  ({ encode } = await import('gpt-tokenizer'));
} catch {
  encode = null;
}

export function countTokens(text) {
  if (!text) return 0;
  if (encode) {
    try {
      return encode(text).length;
    } catch {
      /* fall through */
    }
  }
  return Math.ceil(text.length / 4);
}
