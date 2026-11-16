// Percentile against the committed Context Budget Index: the tokens measured
// in context files of the most-starred repositories on GitHub. The data is
// generated from leaderboard/<yyyy-mm>.json and shipped with the package, so
// --compare makes no network call.
import { readFileSync } from 'node:fs';

export const INDEX_NAME = 'The Context Budget Index';
export const INDEX_FILE = new URL('../data/context-index.json', import.meta.url);

export function loadIndex(file = INDEX_FILE) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(data.tokens) || !data.tokens.length) {
    throw new Error(`index has no token counts: ${file}`);
  }
  return data;
}

const ordinal = (n) => {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/**
 * Share of measured files at or below `tokens`, in whole percent, and the
 * file's rank from the largest (1 is the largest). Ties count as at or below,
 * which is the usual "percentile of a value in a sample" reading: the largest
 * file is the 100th percentile, not the (n-1)/n one.
 */
export function percentile(tokens, values) {
  const sorted = [...values].sort((a, b) => a - b);
  const atOrBelow = sorted.filter((value) => value <= tokens).length;
  const rank = sorted.filter((value) => value > tokens).length + 1;
  return {
    percentile: Math.round((atOrBelow / sorted.length) * 100),
    rank,
    measured: sorted.length,
    largerThan: atOrBelow,
    largest: sorted.at(-1),
    smallest: sorted[0]
  };
}

/** The comparison for a run: its largest context file, against the index. */
export function compareFiles(files, index = loadIndex()) {
  if (!files.length) return null;
  const file = files.reduce((largest, candidate) => (candidate.tokens > largest.tokens ? candidate : largest));
  const stats = percentile(file.tokens, index.tokens);
  return {
    index: index.name ?? INDEX_NAME,
    month: index.month,
    file: file.path,
    tokens: file.tokens,
    ...stats
  };
}

export function compareLine(comparison) {
  if (!comparison) return 'no context files to compare';
  const { file, tokens, largerThan, measured, percentile: pct, month } = comparison;
  return `${file}: ${tokens.toLocaleString('en-US')} tokens — larger than ${largerThan} of ${measured} `
    + `context files in ${INDEX_NAME} (${month}), ${ordinal(pct)} percentile.`;
}
