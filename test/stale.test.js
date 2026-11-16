import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findStale, reclaimableTotal, staleDiff } from '../src/stale.js';

test('finds stale paths, dead commands, missing refs, and stale globs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ctxcap-stale-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'live.js'), '');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const text = [
    '# Instructions',
    'Use `src/live.js` and `src/missing.js`.',
    'Run `npm run legacy` before committing.',
    'See @src/missing.js and #src/live.js.',
    'Check `src/none-*.js`.',
    '',
    '```',
    'Use `src/ignored.js`.',
    '```',
    'Use `src/nope.js`. <!-- ctxcap-ignore -->'
  ].join('\n');
  const files = [{ path: 'AGENTS.md', text, tokens: 50 }];
  const findings = await findStale(files, root, { ignore: [] }, { staleGlob: true });
  assert.deepEqual(findings.map((finding) => finding.rule), [
    'stale-path', 'dead-command', 'missing-ref', 'stale-glob'
  ]);
  assert.equal(findings[0].line, 2);
  assert.ok(reclaimableTotal(findings) > 0);
  assert.match(staleDiff(files, findings), /- Use `src\/live\.js` and `src\/missing\.js`\./);
});

async function repo(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'ctxcap-stale-'));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  return root;
}

test('does not report identifiers, commands, routes, branches, or packages as paths', async () => {
  const root = await repo({ 'src/live.js': '', 'libs/core/pyproject.toml': '', '.github/workflows/release.yml': '' });
  const text = [
    '# Notes',
    '- Avoid `console.log`; read `theme.hue`, `process.env.NODE_ENV`, and `req.body` instead.',
    '- Version `1.2.3`, the `0.x` series, events named `*.updated` and `generate.*`.',
    '- Branch from `origin/main` as `feat/thing`; send `application/json` to `/api/users`.',
    '- Install `@scope/package` and see @someone or @types/node; activate `.venv/bin/activate`.',
    '- Run `pnpm --filter ./apps/web build` or `cd src && make`; docs live in `../docs/`.',
    '- Each package has a `pyproject.toml`; releases use `release.yml`. Keep `.env.local` private.',
    '- Format `.py` and `.tsx` files; run black on `.go` after an edit.'
  ].join('\n');
  const findings = await findStale([{ path: 'AGENTS.md', text, tokens: 1 }], root, { ignore: [] }, { staleGlob: true });
  assert.deepEqual(findings.map((finding) => finding.ref), []);
});

test('names the dead reference and resolves paths relative to a nested context file', async () => {
  const root = await repo({ 'packages/web/src/app.ts': '', 'packages/web/AGENTS.md': '' });
  const text = '# Web\n- Entry is `src/app.ts`; styles were in `src/styles.css`; config is `nowhere.config.ts`.';
  const findings = await findStale([{ path: 'packages/web/AGENTS.md', text, tokens: 1 }], root, { ignore: [] });
  assert.deepEqual(findings.map((finding) => [finding.rule, finding.ref]), [
    ['stale-path', 'src/styles.css'], ['stale-path', 'nowhere.config.ts']
  ]);
});

test('npm scripts are read from every package.json and skipped when there is none', async () => {
  const text = '# Build\n- Run `npm run build:web` then `npm run missing`.';
  const files = [{ path: 'AGENTS.md', text, tokens: 1 }];
  const bare = await findStale(files, await repo({ 'README.md': '' }), { ignore: [] });
  assert.deepEqual(bare, []);
  const workspace = await findStale(files, await repo({
    'package.json': '{}', 'apps/web/package.json': JSON.stringify({ scripts: { 'build:web': 'x' } })
  }), { ignore: [] });
  assert.deepEqual(workspace.map((finding) => finding.ref), ['npm run missing']);
});

test('reclaimable tokens count a block once and cover only the owning list item', async () => {
  const root = await repo({ 'src/live.js': '' });
  const text = '# Layout\n- Old helpers: `src/a.js` and `src/b.js`.\n- Unrelated item that stays in place.';
  const findings = await findStale([{ path: 'AGENTS.md', text, tokens: 1 }], root, { ignore: [] });
  assert.equal(findings.length, 2);
  assert.deepEqual([findings[0].startLine, findings[0].endLine], [2, 2]);
  assert.equal(reclaimableTotal(findings), findings[0].reclaimableTokens);
  assert.equal(staleDiff([{ path: 'AGENTS.md', text }], findings).split('\n').filter((line) => line.startsWith('- ')).length, 1);
});

test('does not report bare extensions, gitignored paths, examples, or forbidden strings', async () => {
  const root = await repo({ 'src/live.js': '', '.gitignore': '.claude/settings.local.json\n' });
  const text = [
    '# Rules',
    '- Format `.py` and `.tsx` files after an edit.',
    '- Keep overrides in `.claude/settings.local.json`.',
    '- Name files with a suffix (e.g. `python-reviewer.md`, `tdd-workflow.md`).',
    '- Forbidden strings: `assets/old-hero.jpeg` and `github.com/old-org/repo`.',
    '- Never link `assets/old-hero.jpeg` in a new document.',
    '- No `rustfmt.toml` or `clippy.toml`; stock defaults only.',
    '- Without `gone.config.ts` the defaults apply.'
  ].join('\n');
  const findings = await findStale([{ path: 'AGENTS.md', text, tokens: 1 }], root, { ignore: [] });
  assert.deepEqual(findings.map((finding) => finding.ref), []);
});
