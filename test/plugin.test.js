import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const json = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));

test('plugin manifest version follows package.json', async () => {
  const pkg = await json('package.json');
  const plugin = await json('.claude-plugin/plugin.json');
  assert.equal(plugin.version, pkg.version);
  const marketplace = await json('.claude-plugin/marketplace.json');
  assert.deepEqual(marketplace.plugins.map((entry) => entry.name), [plugin.name]);
});

test('each skill is named after its directory and only uses documented flags', async () => {
  const cli = await readFile(new URL('../src/cli.js', import.meta.url), 'utf8');
  const root = new URL('../skills/', import.meta.url);
  const names = await readdir(root);
  assert.ok(names.length > 0);
  for (const name of names) {
    const text = (await readFile(new URL(`${name}/SKILL.md`, root), 'utf8')).replace(/\r\n/g, '\n');
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `${name}: frontmatter`);
    assert.equal(/^name: (.+)$/m.exec(front[1])?.[1], name);
    assert.ok(/^description: .{40,}$/m.test(front[1]), `${name}: description`);
    for (const flag of new Set(text.match(/--[a-z][a-z-]+/g) ?? [])) {
      assert.ok(cli.includes(`'${flag}'`), `${name}: ${flag} is not a ctxcap flag`);
    }
  }
});
