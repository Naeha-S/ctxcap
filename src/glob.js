import fg from 'fast-glob';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { IGNORE } from './config.js';

export function loadClassFor(filePath) {
  if (filePath === 'CLAUDE.md') return 'always';
  if (filePath === 'AGENTS.md') return 'startup';
  if (filePath.startsWith('.cursor/rules/') || (filePath.endsWith('/AGENTS.md') && filePath !== 'AGENTS.md')) return 'conditional';
  return 'manual';
}

// Context files can come from an untrusted PR checkout. We only ever read
// regular files that live inside `root`: no symlinks, no `..`, no absolute globs.
export async function collectFiles(root, config) {
  const found = await fg(config.include, {
    cwd: root,
    ignore: [...IGNORE, ...config.ignore],
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false
  });
  const safe = [];
  for (const p of found.sort()) {
    if (path.isAbsolute(p) || p.split('/').includes('..')) continue;
    try {
      const st = await lstat(path.join(root, p));
      if (st.isFile() && !st.isSymbolicLink()) safe.push(p);
    } catch { /* vanished: skip */ }
  }
  return safe;
}
