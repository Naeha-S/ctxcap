// Pinned tokenizer (exact version in package.json). Counts must be stable
// across runs or deltas become noise. Falls back to chars/4 if unavailable,
// and the report says so via `tokenizer`.
import { readFileSync } from 'node:fs';

let encode = null;
let pkgVersion = null;
try {
  ({ encode } = await import('gpt-tokenizer'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  pkgVersion = pkg.dependencies?.['gpt-tokenizer'];
} catch {
  encode = null;
}

export const TOKENIZER_ID = encode ? `gpt-tokenizer@${pkgVersion || '3.0.1'}` : 'chars/4';
export const APPROXIMATE = true;

export function countTokens(text) {
  if (!text) return 0;
  if (encode) {
    try { return encode(text).length; } catch { /* fall through */ }
  }
  return Math.ceil(text.length / 4);
}
