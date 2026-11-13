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
