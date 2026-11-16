import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cli } from './helpers.js';
import { roastFor } from '../src/roast.js';
import { countTokens } from '../src/tokenize.js';

const file = (tokens, path = 'AGENTS.md') => ({ path, tokens, text: '' });

test('roast: one deterministic line per size band', () => {
  assert.equal(roastFor({ files: [] }).roast, 'No context files. The agent is working from vibes.');
  assert.equal(roastFor({ files: [file(90)] }).roast, '90 tokens. Short enough to read and too short to say anything.');
  assert.equal(roastFor({ files: [file(338)] }).roast, '338 tokens. A sticky note with delusions of governance.');
  assert.equal(roastFor({ files: [file(1000)] }).roast, '1,000 tokens. Half of it is a table of contents.');
  assert.equal(roastFor({ files: [file(6249)] }).roast, '6,249 tokens. This is a short story, not an instruction file.');
  assert.equal(roastFor({ files: [file(12000)] }).roast, '12,000 tokens. This is a novella, and the agent is only pretending to have read it.');
});

test('roast: the largest file is the one being roasted, and callers are not mutated', () => {
  const files = [file(90, 'CLAUDE.md'), file(3100, 'AGENTS.md')];
  const before = JSON.stringify(files);
  const result = roastFor({ files });
  assert.equal(result.file, 'AGENTS.md');
  assert.equal(result.tokens, 3100);
  assert.equal(JSON.stringify(files), before);
});

test('roast: a dead reference outranks size, and the count is the finding count', () => {
  const result = roastFor({ files: [file(6249)], findings: [{}, {}] });
  assert.equal(result.roast, '6,249 tokens and 2 references that no longer resolve. Confident and wrong.');
  assert.equal(roastFor({ files: [file(6249)], findings: [{}] }).roast, '6,249 tokens and 1 reference that no longer resolve. Confident and wrong.');
});

test('roast: the same repository gets the same line every run', () => {
  const twice = [roastFor({ files: [file(2100)] }), roastFor({ files: [file(2100)] })];
  assert.deepEqual(twice[0], twice[1]);
});

test('roast: CLI prints one line, exits 0, and --json has the fields', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-roast-'));
  const text = 'word '.repeat(3000);
  await writeFile(path.join(dir, 'AGENTS.md'), text);
  const tokens = countTokens(text).toLocaleString('en-US');

  const plain = cli(dir, 'roast');
  assert.equal(plain.status, 0);
  assert.equal(plain.stdout.trim().split('\n').length, 1);
  assert.ok(plain.stdout.startsWith(`${tokens} tokens.`));

  const json = cli(dir, 'roast', '--json');
  assert.equal(json.status, 0);
  const result = JSON.parse(json.stdout);
  assert.equal(result.file, 'AGENTS.md');
  assert.equal(result.tokens, countTokens(text));
  assert.ok(result.roast.startsWith(`${tokens} tokens.`));
});

test('roast: --stale counts dead scripts, and an empty repository still exits 0', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ctxcap-roast-stale-'));
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  await writeFile(path.join(dir, 'AGENTS.md'), '# Rules\n\n- Run `npm run lint` before you commit.\n');
  const stale = cli(dir, 'roast', '--stale');
  assert.equal(stale.status, 0);
  assert.match(stale.stdout, /1 reference that no longer resolve/);

  const empty = await mkdtemp(path.join(tmpdir(), 'ctxcap-roast-empty-'));
  const none = cli(empty, 'roast');
  assert.equal(none.status, 0);
  assert.equal(none.stdout.trim(), 'No context files. The agent is working from vibes.');
});
