#!/usr/bin/env node
import process from 'node:process';

// Subcommands load their own modules, so the ones an agent hook runs on every
// edit do not pay for the tokenizer unless they need it.
async function run(argv) {
  if (argv[0] === 'init') return (await import('./init.js')).initCli(argv.slice(1));
  if (argv[0] === 'doctor') return (await import('./init.js')).doctorCli(argv.slice(1));
  if (argv[0] === 'hook') return (await import('./hook.js')).hookCli(argv.slice(1));
  return (await import('./cli.js')).main(argv);
}

run(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    const code = err.code ?? 'TOKENIZER_FAILED';
    const output = { error: { code, message: err.message, ...(err.fix ? { fix: err.fix } : {}) } };
    if (process.stdout.isTTY) console.error(JSON.stringify(output));
    else console.log(JSON.stringify(output));
    process.exit(code === 'GIT_UNAVAILABLE' || code === 'TOKENIZER_FAILED' || code === 'USAGE' ? 2 : 1);
  });
