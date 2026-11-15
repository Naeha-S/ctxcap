// `npm test`. Lists the test files itself, because `node --test test/*.test.js`
// relies on the shell to expand the pattern: Node 20 does not, and neither do
// cmd.exe or PowerShell. Extra arguments go to node, e.g.
//   npm test -- --test-name-pattern=badge
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync(new URL('.', import.meta.url))
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => `test/${name}`);

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
