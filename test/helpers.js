import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CLI = path.resolve('src/index.js');

/**
 * A file from this repository, with LF line endings. .gitattributes asks for
 * LF, but a checkout made before it existed keeps CRLF until it is redone.
 */
export const committed = async (file) => (await readFile(path.resolve(file), 'utf8')).replace(/\r\n/g, '\n');

export const cli = (dir, ...args) => spawnSync('node', [CLI, ...args], { cwd: dir, encoding: 'utf8' });

export const git = (dir, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });

/** A committed git repository holding `files` ({ 'path': 'content' }). */
export async function repo(files = {}, { remote = 'https://github.com/acme/widgets.git' } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-init-'));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), content);
  }
  git(dir, 'init', '-q');
  // Git for Windows defaults to core.autocrlf=true, which makes `git apply`
  // and checkouts write CRLF. The fixtures state their line endings exactly.
  git(dir, 'config', 'core.autocrlf', 'false');
  if (remote) git(dir, 'remote', 'add', 'origin', remote);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'fixture');
  return dir;
}

/** Every file under `dir` except `.git`, as { path: content }. */
export async function tree(dir, base = dir, out = {}) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await tree(full, base, out);
    else out[path.relative(base, full).split(path.sep).join('/')] = await readFile(full, 'utf8');
  }
  return out;
}

export const treeHash = async (dir) => createHash('sha256').update(JSON.stringify(await tree(dir))).digest('hex');
