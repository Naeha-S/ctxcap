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

// CRLF is counted as LF. Git checks the same commit out with either, and the
// count has to be the same on a Windows checkout as it is in CI.
export function countTokens(raw) {
  if (!raw) return 0;
  const text = raw.includes('\r\n') ? raw.replace(/\r\n/g, '\n') : raw;
  if (encode) {
    try {
      return encode(text).length;
    } catch {
      /* fall through */
    }
  }
  return Math.ceil(text.length / 4);
}
