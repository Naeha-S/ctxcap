import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cli, committed } from './helpers.js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

test('boilerplate: the action is the moving major, so the template does not go stale', async () => {
  const workflow = await committed('examples/boilerplate/.github/workflows/ctxcap.yml');
  assert.ok(workflow.includes('uses: Naeha-S/ctxcap@v1\n'));
  assert.ok(!workflow.includes('@v1.'), 'the template should not pin a patch version');
  assert.ok(workflow.includes('fetch-depth: 0'), 'the comparison needs history');
  assert.ok(workflow.includes('fail-on: increase'));
});

test('boilerplate: the paste-in block is pinned to this release, and it fits the budget', async () => {
  const agents = await committed('examples/boilerplate/AGENTS.md');
  assert.ok(agents.includes(`npx ctxcap@${pkg.version} why`));
  assert.ok(agents.includes('<!-- ctxcap:begin -->') && agents.includes('<!-- ctxcap:end -->'));

  const report = cli('examples/boilerplate', '--json');
  assert.equal(report.status, 0);
  const data = JSON.parse(report.stdout);
  assert.ok(data.total <= 2000, `boilerplate total: ${data.total}`);
  assert.ok(data.files.some((file) => file.path === 'AGENTS.md'));
  assert.equal(data.over, false);
  // A committed baseline is what makes fail-on: increase meaningful on the
  // first pull request; it must match the file it describes.
  assert.equal(data.delta, 0);
  const baseline = JSON.parse(await committed('examples/boilerplate/ctxcap-baseline.json'));
  assert.equal(baseline['AGENTS.md'], data.total);
});

test('boilerplate: the README offers both paths, copy and init', async () => {
  const readme = await committed('examples/boilerplate/README.md');
  assert.ok(readme.includes('npx ctxcap init --yes'));
  assert.ok(readme.includes('npx ctxcap --update-baseline'));
  assert.ok(readme.includes('npx -y ctxcap why'));
});
