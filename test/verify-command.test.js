import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import { VERSION } from '../src/version.js';
import { cli, committed, repo } from './helpers.js';

const STUDY = 'examples/case-study';
const snapshot = await committed(`${STUDY}/plan.json`);
const study = async () => repo({
  [`${STUDY}/AGENTS.md`]: await committed(`${STUDY}/AGENTS.md`),
  [`${STUDY}/CLAUDE.md`]: await committed(`${STUDY}/CLAUDE.md`)
});
// Run a command the CLI printed, with this checkout standing in for the npm package.
const run = (dir, command) => {
  const [npx, pkg, ...args] = command.split(' ');
  assert.deepEqual([npx, pkg], ['npx', `ctxcap@${VERSION}`]);
  return cli(dir, ...args);
};

test('plan output: matches the committed snapshot and names its own verify command', async () => {
  const dir = await study();
  const result = cli(dir, '--plan', '--budget', '400', '--root', STUDY);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, snapshot);

  const plan = JSON.parse(result.stdout);
  assert.match(plan.planId, /^[0-9a-f]{6}$/);
  assert.equal(plan.verifyCommand, `npx ctxcap@${VERSION} --verify ${plan.planId} --root ${STUDY}`);
  assert.deepEqual(Object.keys(plan).slice(0, 3), ['schema', 'planId', 'verifyCommand']);

  const schema = JSON.parse(await readFile('schema/plan.schema.json', 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.ok(validate(plan), JSON.stringify(validate.errors));

  // Human output: the command sits alone on a line.
  assert.ok(result.stderr.split('\n').includes(plan.verifyCommand));
});

test('plan output: the verify command is the real one for that plan', async () => {
  const dir = await study();
  const plan = JSON.parse(cli(dir, '--plan', '--budget', '400', '--apply', '--root', STUDY).stdout);
  const verified = run(dir, plan.verifyCommand);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).satisfied, true);

  // Any other id is not a plan.
  const other = run(dir, plan.verifyCommand.replace(plan.planId, '000000'));
  assert.notEqual(other.status, 0);
  assert.equal(JSON.parse(other.stdout || other.stderr).error.code, 'PLAN_EXPIRED');

  // At the repository root the command needs no --root.
  const root = await repo({ 'AGENTS.md': await readFile(`${STUDY}/AGENTS.md`, 'utf8') });
  const here = JSON.parse(cli(root, '--plan', '--budget', '200').stdout);
  assert.equal(here.verifyCommand, `npx ctxcap@${VERSION} --verify ${here.planId}`);
});

test('plan output: initHint appears once, and only while nothing is wired', async () => {
  const dir = await repo({ 'AGENTS.md': await readFile(`${STUDY}/AGENTS.md`, 'utf8') });
  const before = cli(dir, '--plan', '--budget', '200');
  const hint = JSON.parse(before.stdout).initHint;
  assert.ok(hint.startsWith(`npx ctxcap@${VERSION} init `));
  assert.equal(before.stdout.split(hint).length - 1, 1);
  assert.equal(before.stderr.split(hint).length - 1, 1);

  cli(dir, 'init', '--yes', '--agents', 'codex');
  const after = cli(dir, '--plan', '--budget', '200');
  assert.ok(!('initHint' in JSON.parse(after.stdout)));
  assert.doesNotMatch(after.stderr, /init wires/);
  assert.match(after.stderr, /--verify [0-9a-f]{6}$/m);
});
