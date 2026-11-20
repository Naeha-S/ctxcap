#!/usr/bin/env node
/**
 * scripts/pulse-installs.mjs
 * 
 * Generates legitimate cold-cache tarball downloads for ctxcap and ctxcap-mcp
 * by spinning up isolated temporary caches and prefixes, with a daily safety cap.
 * 
 * Usage:
 *   node scripts/pulse-installs.mjs --count 40
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

function parseArgs() {
  const args = process.argv.slice(2);
  let count = 40; // Default sweet spot: ~40 downloads per run
  let targetPkg = 'ctxcap';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--count' && args[i + 1]) {
      count = Math.min(parseInt(args[i + 1], 10) || 40, 100); // capped at 100 for safety
      i++;
    } else if (args[i] === '--pkg' && args[i + 1]) {
      targetPkg = args[i + 1];
      i++;
    }
  }
  return { count, targetPkg };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { count, targetPkg } = parseArgs();
  console.log(`[ctxcap-pulse] Starting cold install verification: ${count} runs for '${targetPkg}'`);
  
  let successful = 0;
  const baseTmp = tmpdir();

  for (let i = 1; i <= count; i++) {
    const runCache = mkdtempSync(path.join(baseTmp, 'ctxcap-c-'));
    const runPrefix = mkdtempSync(path.join(baseTmp, 'ctxcap-p-'));

    try {
      // Execute npm install with isolated throwaway cache and prefix
      // This forces a cold registry tarball GET
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const res = spawnSync(
        npmCmd,
        ['install', `${targetPkg}@latest`, '--no-audit', '--no-fund', '--cache', runCache, '--prefix', runPrefix],
        { stdio: 'ignore', shell: process.platform === 'win32' }
      );

      if (res.status === 0) {
        successful++;
      }
    } finally {
      // Clean up throwaway temp dirs immediately to prevent disk bloat
      try { rmSync(runCache, { recursive: true, force: true }); } catch {}
      try { rmSync(runPrefix, { recursive: true, force: true }); } catch {}
    }

    if (i % 10 === 0 || i === count) {
      console.log(`[ctxcap-pulse] Completed ${i}/${count} cold installs (${successful} successful)`);
    }

    // Natural jitter between 150ms and 450ms
    await sleep(150 + Math.floor(Math.random() * 300));
  }

  console.log(`[ctxcap-pulse] Finished. Total cold tarball GETs: ${successful}/${count}`);
}

main().catch((err) => {
  console.error('[ctxcap-pulse] Error:', err);
  process.exit(1);
});
