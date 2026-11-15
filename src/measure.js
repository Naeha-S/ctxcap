import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collectFiles, loadClassFor } from './glob.js';
import { countTokens } from './tokenize.js';

/** Reads and counts every context file the config selects. */
export async function measureFiles(root, config) {
  const files = [];
  for (const p of await collectFiles(root, config)) {
    const text = await readFile(path.join(root, p), 'utf8');
    files.push({ path: p, text, tokens: countTokens(text), loadClass: loadClassFor(p) });
  }
  return files;
}
