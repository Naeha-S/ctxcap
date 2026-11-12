import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const IGNORE = [
  'node_modules/**', 'dist/**', 'build/**', '.git/**',
  '**/*.min.js', '**/*.min.css', 'package-lock.json',
  'pnpm-lock.yaml', 'yarn.lock', '**/*.lock'
];

export const DEFAULTS = {
  include: [
    'CLAUDE.md',
    'AGENTS.md',
    '.github/copilot-instructions.md',
    'prompts/**',
    '*.prompt',
    '.cursor/rules/**'
  ],
  ignore: [],
  budgets: {},
  mode: 'delta',
  failOn: null
};

export function assertSafePatterns(list, field) {
  if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) {
    throw new Error(`"${field}" must be an array of glob strings`);
  }
  for (const pat of list) {
    const clean = pat.replace(/^!/, '');
    if (path.isAbsolute(clean) || clean.split(/[\\/]/).includes('..')) {
      throw new Error(`"${field}" pattern "${pat}" must be relative and may not contain ".."`);
    }
  }
}

export async function loadConfig(root, configPath) {
  let file = path.join(root, configPath ?? '.ctxlint.json');
  if (!configPath) {
    try {
      await readFile(file, 'utf8');
    } catch {
      const legacy = path.join(root, '.tokenlint.json');
      try {
        await readFile(legacy, 'utf8');
        file = legacy;
      } catch {
        file = path.join(root, '.ctxlint.json');
      }
    }
  }

  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.include !== undefined) assertSafePatterns(raw.include, 'include');
    if (raw.ignore !== undefined) assertSafePatterns(raw.ignore, 'ignore');
    return {
      ...DEFAULTS,
      ...raw,
      include: raw.include ?? DEFAULTS.include,
      ignore: raw.ignore ?? DEFAULTS.ignore,
      budgets: raw.budgets ?? {}
    };
  } catch (err) {
    if (err.code === 'ENOENT') return { ...DEFAULTS, budgets: {} };
    throw new Error(`invalid config at ${file}: ${err.message}`);
  }
}
