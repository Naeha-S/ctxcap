import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
export const BASELINE_FILE = 'ctxlint-baseline.json';
export const LEGACY_BASELINE_FILE = 'tokenlint-baseline.json';

export async function loadBaseline(root, ref) {
  if (ref) {
    try {
      const { stdout } = await exec('git', ['show', `${ref}:${BASELINE_FILE}`], { cwd: root });
      return { counts: JSON.parse(stdout), found: true };
    } catch {
      try {
        const { stdout } = await exec('git', ['show', `${ref}:${LEGACY_BASELINE_FILE}`], { cwd: root });
        return { counts: JSON.parse(stdout), found: true };
      } catch {
        return { counts: {}, found: false };
      }
    }
  }
  try {
    const raw = await readFile(path.join(root, BASELINE_FILE), 'utf8');
    return { counts: JSON.parse(raw), found: true };
  } catch {
    try {
      const raw = await readFile(path.join(root, LEGACY_BASELINE_FILE), 'utf8');
      return { counts: JSON.parse(raw), found: true };
    } catch {
      return { counts: {}, found: false };
    }
  }
}

export async function saveBaseline(root, counts) {
  await writeFile(path.join(root, BASELINE_FILE), JSON.stringify(counts, null, 2) + '\n', 'utf8');
}
