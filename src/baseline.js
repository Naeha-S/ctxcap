import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const exec = promisify(execFile);
export const BASELINE_FILE = 'ctxcap-baseline.json';
export const LEGACY_BASELINE_FILES = ['ctxlint-baseline.json', 'tokenlint-baseline.json'];

export async function loadBaseline(root, ref) {
  const filesToTry = [BASELINE_FILE, ...LEGACY_BASELINE_FILES];
  if (ref) {
    for (const file of filesToTry) {
      try {
        const { stdout } = await exec('git', ['show', `${ref}:${file}`], { cwd: root });
        return { counts: JSON.parse(stdout), found: true };
      } catch {
        // try next
      }
    }
    return { counts: {}, found: false };
  }

  for (const file of filesToTry) {
    try {
      const raw = await readFile(path.join(root, file), 'utf8');
      return { counts: JSON.parse(raw), found: true };
    } catch {
      // try next
    }
  }
  return { counts: {}, found: false };
}

export async function saveBaseline(root, counts) {
  await writeFile(path.join(root, BASELINE_FILE), JSON.stringify(counts, null, 2) + '\n', 'utf8');
}
