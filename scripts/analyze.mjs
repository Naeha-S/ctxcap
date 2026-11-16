#!/usr/bin/env node
// Does a repository's star count predict what its context files cost? The
// leaderboard invites the guess that the best-maintained projects write the
// least. This checks it instead of asserting it.
//
//   node scripts/analyze.mjs
//   node scripts/analyze.mjs --month 2026-11 --iterations 20000
//
// Uses only committed data. The permutation and bootstrap loops use a fixed
// seed, so two runs print the same numbers.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const monthPath = (month) => path.join('leaderboard', `${month}.json`);

export const rank = (values) => {
  const order = values.map((value, index) => [value, index]).sort((a, b) => a[0] - b[0]);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = average;
    i = j + 1;
  }
  return ranks;
};

export const pearson = (x, y) => {
  const n = x.length;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    covariance += (x[i] - meanX) * (y[i] - meanY);
    varianceX += (x[i] - meanX) ** 2;
    varianceY += (y[i] - meanY) ** 2;
  }
  return covariance / Math.sqrt(varianceX * varianceY);
};

export const spearman = (x, y) => pearson(rank(x), rank(y));

// A small deterministic generator: mulberry32 seeded by 0x63747863 ("ctxc").
const random = (seed = 0x63747863) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Two-sided permutation p for |rho| under the null of no association. */
export function permutationP(x, y, iterations = 20000, next = random()) {
  const observed = Math.abs(spearman(x, y));
  let atLeast = 0;
  for (let i = 0; i < iterations; i++) {
    const shuffled = [...y];
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(next() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    if (Math.abs(spearman(x, shuffled)) >= observed) atLeast++;
  }
  return { observed, p: (atLeast + 1) / (iterations + 1) };
}

/** Percentile bootstrap interval for Spearman's rho, resampling pairs. */
export function bootstrap(x, y, iterations = 2000, next = random(0x9e3779b9)) {
  const values = [];
  for (let i = 0; i < iterations; i++) {
    const xs = [];
    const ys = [];
    for (let j = 0; j < x.length; j++) {
      const k = Math.floor(next() * x.length);
      xs.push(x[k]);
      ys.push(y[k]);
    }
    values.push(spearman(xs, ys));
  }
  values.sort((a, b) => a - b);
  const at = (q) => values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
  return { low: at(0.025), high: at(0.975) };
}

export function perRepo(rows) {
  const byRepo = new Map();
  for (const row of rows) {
    const entry = byRepo.get(row.repo) ?? { repo: row.repo, stars: row.stars, tokens: 0, files: 0 };
    entry.tokens += row.tokens;
    entry.files++;
    byRepo.set(row.repo, entry);
  }
  return [...byRepo.values()];
}

const round = (value, places = 3) => Number(value.toFixed(places));

export function analyze(data, { iterations = 20000 } = {}) {
  const repos = perRepo(data.rows);
  const repoResult = permutationP(repos.map((row) => row.stars), repos.map((row) => row.tokens), iterations);
  const fileResult = permutationP(data.rows.map((row) => row.stars), data.rows.map((row) => row.tokens), iterations);
  const noSmall = data.rows.filter((row) => row.tokens >= data.cleanBelow);
  const noSmallResult = permutationP(noSmall.map((row) => row.stars), noSmall.map((row) => row.tokens), iterations);
  return {
    month: data.month,
    cleanBelow: data.cleanBelow,
    files: data.rows.length,
    repositories: repos.length,
    medianTokens: [...data.rows].map((row) => row.tokens).sort((a, b) => a - b)[Math.floor(data.rows.length / 2)],
    perRepo: {
      n: repos.length,
      spearman: round(repoResult.observed),
      p: round(repoResult.p, 4),
      ci: Object.fromEntries(Object.entries(bootstrap(repos.map((row) => row.stars), repos.map((row) => row.tokens))).map(([k, v]) => [k, round(v)]))
    },
    perFile: { n: data.rows.length, spearman: round(fileResult.observed), p: round(fileResult.p, 4) },
    withoutClean: { n: noSmall.length, spearman: round(noSmallResult.observed), p: round(noSmallResult.p, 4) },
    sorted: repos.sort((a, b) => b.tokens - a.tokens)
  };
}

export function markdown(result) {
  const lines = [
    `# Stars and context cost, ${result.month}`,
    '',
    `Measured on ${result.files} context files in ${result.repositories} repositories.`,
    '',
    '| Question | n | Spearman ρ | permutation p |',
    '| --- | ---: | ---: | ---: |',
    `| Repository total tokens vs stars | ${result.perRepo.n} | ${result.perRepo.spearman} | ${result.perRepo.p} |`,
    `| One row per file vs stars | ${result.perFile.n} | ${result.perFile.spearman} | ${result.perFile.p} |`,
    `| Without files under ${result.cleanBelow} tokens | ${result.withoutClean.n} | ${result.withoutClean.spearman} | ${result.withoutClean.p} |`,
    '',
    `95% bootstrap interval for the repository-level ρ: ${result.perRepo.ci.low} to ${result.perRepo.ci.high}.`,
    ''
  ];
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);
  const names = (await readdir('leaderboard')).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  const month = flag('--month') ?? names.at(-1).slice(0, 7);
  const iterations = Number(flag('--iterations') ?? 20000);
  const data = JSON.parse(await readFile(monthPath(month), 'utf8'));
  console.log(markdown(analyze(data, { iterations })));
}
