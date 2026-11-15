import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, rank, CLEAN_BELOW } from '../scripts/leaderboard.mjs';
import { countTokens } from '../src/tokenize.js';

const sha = (text) => createHash('sha1').update(text).digest('hex');
const words = (n) => 'Run the tests before you commit. '.repeat(n);

// A small GitHub: 130 repositories by descending stars, a few with context files.
function github() {
  const special = {
    3: { 'AGENTS.md': words(400) },
    7: { 'AGENTS.md': words(90), 'CLAUDE.md': '@AGENTS.md\n' },
    12: { 'CLAUDE.md': words(5) },
    20: { 'AGENTS.md': words(700), 'CLAUDE.md': words(4) },
    31: { 'AGENTS.md': { link: 'README' }, README: words(150) },
    44: { 'CLAUDE.md': words(60), 'AGENTS.md': { link: 'CLAUDE.md' } },
    58: { 'AGENTS.md': words(8), 'CLAUDE.md': words(9) },
    66: { 'AGENTS.md': words(1000), archived: true },
    71: { 'AGENTS.md': words(33) },
    85: { 'AGENTS.md': words(250) },
    104: { 'CLAUDE.md': words(120) },
    119: { 'AGENTS.md': words(300) },
    125: { 'AGENTS.md': words(20) }
  };
  const repos = Array.from({ length: 130 }, (_, index) => {
    const { archived = false, ...files } = special[index] ?? {};
    return { full_name: `org${index}/repo${index}`, stargazers_count: 500000 - index * 1000, default_branch: 'main', archived, disabled: false, files: { 'README.md': '# readme\n', ...files } };
  });
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const content = (file) => (typeof file === 'string' ? file : file.link);

  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.equal(init.headers.authorization, 'Bearer test-token');
    const { pathname, searchParams } = new URL(url);
    if (pathname === '/search/repositories') {
      const [, low, high] = /^stars:(?:>=(\d+)|\d+\.\.(\d+))$/.exec(searchParams.get('q'));
      const ceiling = high ? Number(high) : Infinity;
      const matching = repos.filter((repo) => repo.stargazers_count <= ceiling && repo.stargazers_count >= (low ? Number(low) : 1000));
      const page = Number(searchParams.get('page'));
      return json({ total_count: matching.length, items: matching.slice((page - 1) * 100, page * 100).map(({ files, ...repo }) => repo) });
    }
    const [, owner, name, ...rest] = pathname.split('/').slice(1);
    const repo = repos.find((entry) => entry.full_name === `${owner}/${name}`);
    if (!repo) return json({ message: 'Not Found' }, 404);
    if (rest[0] === 'git' && rest[1] === 'trees') {
      return json({ tree: Object.entries(repo.files).map(([file, value]) => ({ path: file, type: 'blob', mode: typeof value === 'string' ? '100644' : '120000', sha: sha(content(value)) })) });
    }
    if (rest[0] === 'git' && rest[1] === 'blobs') {
      const file = Object.values(repo.files).find((value) => sha(content(value)) === rest[2]);
      return json({ encoding: 'base64', content: Buffer.from(content(file)).toString('base64') });
    }
    if (rest[0] === 'contents') {
      // Like GitHub: asked for a symlink, answer with the file it points to.
      const target = repo.files[repo.files[rest[1]].link];
      return json({ type: 'file', path: rest[1], sha: sha(target), encoding: 'base64', content: Buffer.from(target).toString('base64') });
    }
    return json({ message: 'Not Found' }, 404);
  };
  return { fetchImpl, calls };
}

const scratch = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-board-'));
  return { cache: path.join(dir, 'cache'), out: path.join(dir, 'leaderboard') };
};
const board = (dirs, ...extra) => ['--top', '10', '--month', '2026-11', '--cache', dirs.cache, '--out', dirs.out, ...extra];
const quiet = { log: () => {} };
const offline = { ...quiet, env: {}, fetchImpl: () => { throw new Error('offline run must not fetch'); } };
const rows = (markdown, heading) => markdown.split(heading)[1].split('\n## ')[0].split('\n').filter((line) => /^\| (\d|\[)/.test(line)).map((line) => line.split('|').map((cell) => cell.trim()).filter(Boolean));

test('leaderboard: ten repositories, ranked by tokens, with clean ones set aside', async () => {
  const dirs = await scratch();
  const { fetchImpl, calls } = github();
  assert.equal(await run(board(dirs), { ...quiet, env: { GITHUB_TOKEN: 'test-token' }, fetchImpl }), 0);

  const data = JSON.parse(await readFile(path.join(dirs.out, '2026-11.json'), 'utf8'));
  // The archived repository is passed over; the tenth match is on the second search page.
  assert.deepEqual([...new Set(data.rows.map((row) => row.repo))].sort(), [3, 7, 12, 20, 31, 44, 58, 71, 85, 104].map((n) => `org${n}/repo${n}`).sort());
  assert.ok(calls.some((url) => url.includes('page=2')));

  const ranked = data.rows.filter((row) => row.rank !== null);
  assert.deepEqual(ranked.map((row) => row.rank), ranked.map((_, index) => index + 1));
  assert.deepEqual(ranked.map((row) => row.tokens), [...ranked.map((row) => row.tokens)].sort((a, b) => b - a));
  assert.deepEqual(ranked[0], { rank: 1, repo: 'org20/repo20', stars: 480000, path: 'AGENTS.md', sha: sha(words(700)), tokens: countTokens(words(700)), delta: 'new' });

  // A symlink counts as its target; a copy or an import of the other file counts once.
  assert.deepEqual(data.rows.filter((row) => row.repo === 'org31/repo31').map((row) => [row.path, row.tokens]), [['AGENTS.md → README', countTokens(words(150))]]);
  assert.deepEqual(data.rows.filter((row) => row.repo === 'org44/repo44').map((row) => row.path), ['CLAUDE.md']);
  assert.deepEqual(data.rows.filter((row) => row.repo === 'org7/repo7').map((row) => row.path), ['AGENTS.md']);

  // Clean: every file under 200 tokens. Listed, never ranked.
  const clean = data.rows.filter((row) => row.clean);
  assert.deepEqual([...new Set(clean.map((row) => row.repo))].sort(), ['org12/repo12', 'org58/repo58']);
  assert.ok(clean.every((row) => row.rank === null && row.tokens < CLEAN_BELOW));
  // A small file beside a large one does not make a repository clean.
  assert.ok(ranked.some((row) => row.repo === 'org20/repo20' && row.tokens < CLEAN_BELOW));

  const markdown = await readFile(path.join(dirs.out, '2026-11.md'), 'utf8');
  assert.match(markdown, /^\| # \| Repository \| Stars \| Path \| Tokens \| Delta \|$/m);
  const table = rows(markdown, '| # |');
  assert.equal(table.length, ranked.length);
  assert.deepEqual(table[0], ['1', '[org20/repo20](https://github.com/org20/repo20)', '480,000', '`AGENTS.md`', countTokens(words(700)).toLocaleString('en-US'), 'new']);
  assert.ok(!table.some((row) => row[1].includes('org12/repo12')));
  assert.deepEqual(rows(markdown, '## Clean').map((row) => row[0]).filter((cell, index, all) => all.indexOf(cell) === index).length, 2);
});

test('leaderboard: with a cache, a run needs no network or token and writes the same bytes', async () => {
  const dirs = await scratch();
  const { fetchImpl } = github();
  await run(board(dirs), { ...quiet, env: { GITHUB_TOKEN: 'test-token' }, fetchImpl, now: new Date('2026-11-15T00:00:00Z') });
  const read = async () => Promise.all(['2026-11.md', '2026-11.json'].map((name) => readFile(path.join(dirs.out, name), 'utf8')));
  const first = await read();
  assert.ok((await readdir(dirs.cache)).length > 10);

  assert.equal(await run(board(dirs, '--offline'), { ...offline, now: new Date('2027-03-01T00:00:00Z') }), 0);
  assert.deepEqual(await read(), first);
  assert.equal(await run(board(dirs), offline), 0);
  assert.deepEqual(await read(), first);

  // Asking for more than the cache holds is an error, not a silent partial board.
  await assert.rejects(run(board(dirs, '--offline', '--top', '12'), offline), /no cached response/);
  const empty = await scratch();
  await assert.rejects(run(board(empty), { ...quiet, env: {}, fetchImpl }), /GitHub token is required/);
});

test('leaderboard: delta is measured against the previous month', async () => {
  const dirs = await scratch();
  const { fetchImpl } = github();
  const big = countTokens(words(700));
  await mkdir(dirs.out, { recursive: true });
  await writeFile(path.join(dirs.out, '2026-10.json'), JSON.stringify({ month: '2026-10', rows: [
    { repo: 'org20/repo20', path: 'AGENTS.md', tokens: big - 1200 },
    { repo: 'org3/repo3', path: 'AGENTS.md', tokens: countTokens(words(400)) + 35 },
    { repo: 'org85/repo85', path: 'AGENTS.md', tokens: countTokens(words(250)) }
  ] }));
  await writeFile(path.join(dirs.out, '2026-12.json'), JSON.stringify({ month: '2026-12', rows: [] }));
  await run(board(dirs), { ...quiet, env: { GH_TOKEN: 'test-token' }, fetchImpl });

  const data = JSON.parse(await readFile(path.join(dirs.out, '2026-11.json'), 'utf8'));
  const delta = (repo) => data.rows.find((row) => row.repo === repo && row.path === 'AGENTS.md').delta;
  assert.deepEqual(['org20/repo20', 'org3/repo3', 'org85/repo85', 'org71/repo71'].map(delta), ['+1,200', '-35', '0', 'new']);
  assert.match(await readFile(path.join(dirs.out, '2026-11.md'), 'utf8'), /Delta is against the 2026-10 leaderboard/);
});

test('leaderboard: the 200-token line is exclusive, and the script stays out of the package', async () => {
  const entry = (tokens) => ({ repo: `o/r${tokens}`, stars: 1, files: [{ path: 'AGENTS.md', sha: 'x', tokens }] });
  const { ranked, clean } = rank([entry(199), entry(200)]);
  assert.deepEqual([ranked.map((row) => row.tokens), clean.map((row) => row.tokens)], [[200], [199]]);

  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(pkg.scripts.leaderboard, 'node scripts/leaderboard.mjs');
  assert.ok(!pkg.files.includes('scripts') && !pkg.files.some((file) => file.includes('leaderboard')));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['fast-glob', 'gpt-tokenizer']);
  assert.ok(!pkg.scripts.postinstall && !pkg.scripts.install && !pkg.scripts.preinstall && !pkg.scripts.prepare);
  assert.equal(spawnSync('node', ['scripts/leaderboard.mjs', '--help'], { encoding: 'utf8' }).status, 0);
});
