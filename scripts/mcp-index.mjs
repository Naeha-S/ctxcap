#!/usr/bin/env node
// The MCP Context Cost Index: how many tokens each MCP server's tool
// definitions add to a session before the model has been asked anything.
//
//   node scripts/mcp-index.mjs
//   node scripts/mcp-index.mjs --month 2026-11 --refresh
//
// Every server is installed from npm at the version pinned in
// scripts/mcp-servers.json, started over stdio, sent initialize and
// tools/list, and stopped. The count is the tokens in the definitions a
// client puts in the prompt: name, description, and inputSchema, for every
// tool. Section 4 of the README explains why those fields and not others.
//
// Installs are cached under .ctxcap/mcp-cache/, which git ignores. A rerun
// with the cache warm does not touch the network.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { countTokens, TOKENIZER_ID } from '../src/tokenize.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
export const CACHE = path.join(ROOT, '.ctxcap', 'mcp-cache');
export const PROTOCOL = '2024-11-05';
const TIMEOUT = 20000;

const HELP = `mcp-index — measure what MCP servers cost in tool definitions

Usage: node scripts/mcp-index.mjs [options]

  --month <yyyy-mm>  month in the output file name (default: this month, UTC)
  --out <dir>        output directory (default: mcp-index)
  --cache <dir>      install cache (default: .ctxcap/mcp-cache)
  --servers <file>   server list (default: scripts/mcp-servers.json)
  --only <name>      measure one server by name (repeatable)
  --refresh          delete the cache and install everything again
  --offline          fail instead of installing anything
  --date <yyyy-mm-dd>  date recorded as measured (default: today, UTC)

Counts name, description, and inputSchema for every tool returned by
tools/list. It does not start a conversation and does not call a tool.`;

/** The fields a client includes when it sends a tool definition to a model. */
export function definitions(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {}
  }));
}

export function measureTools(tools) {
  const json = JSON.stringify(definitions(tools));
  return { tools: tools.length, bytes: Buffer.byteLength(json), tokens: countTokens(json) };
}

const env = (extra = {}) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  APPDATA: process.env.APPDATA,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  SystemRoot: process.env.SystemRoot,
  TMPDIR: process.env.TMPDIR,
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  ...extra
});

/** Starts a stdio server, performs the MCP handshake, and returns its tools. */
export async function probe({ command, args = [], cwd = ROOT, env: extra = {}, timeout = TIMEOUT }) {
  const child = spawn(command, args, { cwd, env: env(extra), stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map();
  let next = 1;
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });

  const send = (method, params) => new Promise((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out on ${method}`));
    }, timeout);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method}: ${message.error.message ?? 'error'}`));
      else resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  lines.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const settle = pending.get(message.id);
      pending.delete(message.id);
      settle(message);
    }
  });

  try {
    const initialized = await send('initialize', {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: 'ctxcap-mcp-index', version: '1' }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = [];
    let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await send('tools/list', cursor ? { cursor } : {});
      tools.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return { tools, serverInfo: initialized?.serverInfo ?? null };
  } catch (error) {
    error.stderr = stderr.split('\n').filter(Boolean).at(-1) ?? '';
    throw error;
  } finally {
    child.kill();
  }
}

async function install(entries, { cache, offline, refresh }) {
  const packages = entries.filter((entry) => entry.package).map((entry) => `${entry.package}@${entry.version}`);
  if (!packages.length) return;
  if (refresh) await rm(cache, { recursive: true, force: true });
  const present = packages.every((spec) => {
    const at = spec.lastIndexOf('@');
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1);
    try {
      const manifest = JSON.parse(readFileSync(path.join(cache, 'node_modules', name, 'package.json'), 'utf8'));
      return manifest.version === version;
    } catch { return false; }
  });
  if (present) return;
  if (offline) throw new Error(`offline and the cache is missing one of: ${packages.join(', ')}`);
  await mkdir(cache, { recursive: true });
  await writeFile(path.join(cache, 'package.json'), `${JSON.stringify({ name: 'ctxcap-mcp-index-cache', private: true }, null, 2)}\n`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await new Promise((resolve, reject) => {
    const child = spawn(npm, ['install', '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', ...packages], {
      cwd: cache,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: process.env,
      // npm is a .cmd on Windows, which cannot be spawned without a shell.
      shell: process.platform === 'win32'
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm install exited ${code}: ${stderr.slice(-800)}`))));
  });
}

/** Resolves the executable to start for one entry, after install. */
export async function commandFor(entry, cache) {
  if (entry.local) {
    return { command: process.execPath, args: [path.join(ROOT, entry.local), ...(entry.args ?? [])], cwd: ROOT };
  }
  const dir = path.join(cache, 'node_modules', entry.package);
  const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  const bin = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin ?? {})[0];
  if (!bin) throw new Error(`${entry.package} has no bin entry`);
  const args = (entry.args ?? []).map((arg) => (arg === '{tmp}' ? tmpdir() : arg));
  return { command: process.execPath, args: [path.join(dir, bin), ...args], cwd: ROOT };
}

export function buildIndex({ results, unmeasured = [], month, date, version }) {
  const rows = [...results]
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
    .map((row, index) => ({ rank: index + 1, ...row }));
  return {
    title: 'The MCP Context Cost Index',
    month,
    measured: date,
    tokenizer: TOKENIZER_ID,
    ctxcapVersion: version,
    method: {
      transport: 'stdio',
      protocol: PROTOCOL,
      counted: ['name', 'description', 'inputSchema'],
      excluded: ['title', 'annotations', 'outputSchema'],
      note: 'One tools/list call per server at startup, with placeholder credentials. Tool sets that require configuration to appear are not counted.'
    },
    servers: rows.length,
    tools: rows.reduce((sum, row) => sum + row.tools, 0),
    rows,
    unmeasured
  };
}

export function markdown(data) {
  const lines = [
    `# ${data.title}, ${data.month}`,
    '',
    `Tool definitions returned by \`tools/list\`, counted with \`${data.tokenizer}\`. Measured ${data.measured}.`,
    '',
    '| # | Server | Package | Tools | Tokens |',
    '| ---: | --- | --- | ---: | ---: |',
    ...data.rows.map((row) => `| ${row.rank} | ${row.name} | ${row.package ? `\`${row.package}@${row.version}\`` : 'this repository'} | ${row.tools} | ${row.tokens.toLocaleString('en-US')} |`),
    ''
  ];
  if (data.unmeasured.length) {
    lines.push('## Not measured', '', '| Server | Package | Why |', '| --- | --- | --- |',
      ...data.unmeasured.map((entry) => `| ${entry.name} | \`${entry.package}@${entry.version}\` | ${entry.reason} |`), '');
  }
  lines.push(
    'Counts include name, description, and inputSchema. They leave out `title`,',
    '`annotations`, and `outputSchema`, which some clients also send, so read',
    'them as a lower bound. One tools/list call at startup with placeholder',
    'credentials: a server that hides tools until it is configured shows fewer.',
    ''
  );
  return lines.join('\n');
}

export async function crawl({ month = new Date().toISOString().slice(0, 7), out = 'mcp-index', cache = CACHE,
  servers: listFile = path.join(HERE, 'mcp-servers.json'), only = [], refresh = false, offline = false,
  date = new Date().toISOString().slice(0, 10) } = {}) {
  const spec = JSON.parse(await readFile(listFile, 'utf8'));
  const entries = only.length ? spec.servers.filter((entry) => only.includes(entry.name)) : spec.servers;
  if (!entries.length) throw new Error('no servers selected');
  await install(entries, { cache, offline, refresh });

  const results = [];
  const failures = [];
  for (const entry of entries) {
    const version = entry.versionFrom
      ? JSON.parse(await readFile(path.join(ROOT, entry.versionFrom), 'utf8')).version
      : entry.version;
    try {
      const target = await commandFor(entry, cache);
      const { tools } = await probe({ ...target, env: entry.env ?? {} });
      const measured = measureTools(tools);
      results.push({
        name: entry.name,
        package: entry.package,
        version,
        ...measured,
        ...(entry.note ? { note: entry.note } : {})
      });
      process.stderr.write(`${entry.name}: ${measured.tools} tools, ${measured.tokens} tokens\n`);
    } catch (error) {
      failures.push({ name: entry.name, package: entry.package, version, reason: error.message });
      process.stderr.write(`${entry.name}: not measured (${error.message})\n`);
    }
  }

  const version = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8')).version;
  const data = buildIndex({ results, unmeasured: [...(spec.unmeasured ?? []), ...failures], month, date, version });
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, `${month}.json`), `${JSON.stringify(data, null, 2)}\n`);
  await writeFile(path.join(out, `${month}.md`), markdown(data));
  return data;
}

function parse(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') options.help = true;
    else if (flag === '--month') options.month = argv[++i];
    else if (flag === '--out') options.out = argv[++i];
    else if (flag === '--servers') options.servers = argv[++i];
    else if (flag === '--cache') options.cache = argv[++i];
    else if (flag === '--date') options.date = argv[++i];
    else if (flag === '--only') (options.only ??= []).push(argv[++i]);
    else if (flag === '--refresh') options.refresh = true;
    else if (flag === '--offline') options.offline = true;
    else throw new Error(`unknown argument: ${flag}. ${HELP}`);
  }
  return options;
}

export async function mcpMonthsIn(dir = 'mcp-index') {
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((name) => /^\d{4}-\d{2}\.json$/.test(name)).sort();
  return Promise.all(names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), 'utf8'))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    if (options.help) console.log(HELP);
    else {
      const data = await crawl(options);
      console.error(`wrote mcp-index/${data.month}.json: ${data.servers} servers, ${data.rows.length} rows`);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
