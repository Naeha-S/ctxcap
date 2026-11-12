// Deliberately dumb heuristics. No rewriting, no model calls.
const MAX_TOKENS = 4000;

export function suggest(files) {
  const out = [];
  const headingOwners = new Map();

  for (const f of files) {
    if (f.tokens > MAX_TOKENS) {
      out.push({ path: f.path, reason: `large file (${f.tokens} tokens) — split by topic` });
    }
    const lines = f.text.split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith('#') && t.length > 2) {
        const key = t.toLowerCase();
        if (headingOwners.has(key)) {
          out.push({ path: f.path, reason: `duplicate heading "${t}" (also in ${headingOwners.get(key)})` });
        } else {
          headingOwners.set(key, f.path);
        }
      }
    }
    const seen = new Map();
    for (const line of lines) {
      const t = line.trim();
      if (t.length < 12) continue;
      seen.set(t, (seen.get(t) ?? 0) + 1);
    }
    for (const [line, n] of seen) {
      if (n >= 3) out.push({ path: f.path, reason: `line repeated ${n}x: "${line.slice(0, 60)}"` });
    }
  }
  return out;
}
