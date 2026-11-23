import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';
import { loadConfig } from './config.js';
import { collectFiles, loadClassFor } from './glob.js';
import { countTokens, TOKENIZER_ID, APPROXIMATE } from './tokenize.js';
import { findStale } from './stale.js';

const SKILL_GLOBS = [
  '**/.claude/skills/**/SKILL.md',
  '**/.agents/skills/**/SKILL.md',
  '**/.cursor/skills/**/SKILL.md',
  'skills/**/SKILL.md'
];
const DISCOVERY_IGNORE = ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/build/**', '**/.ctxcap/**'];
const MCP_CONFIGS = [
  '.mcp.json',
  '.cursor/mcp.json',
  '.vscode/mcp.json',
  '.claude/settings.json'
];
const SECRET_PATTERNS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['api-token', /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/]
];
const RISKY_FLAGS = [
  ['permission-bypass', /--dangerously-skip-permissions\b/],
  ['sandbox-bypass', /--no-sandbox\b/]
];

function skillName(text, file) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? '';
  const value = /^name:\s*(?:"([^"]+)"|'([^']+)'|([^#\r\n]+))\s*$/m.exec(frontmatter);
  return (value?.[1] ?? value?.[2] ?? value?.[3]?.trim()) || path.posix.basename(path.posix.dirname(file));
}

async function discoverSkills(root, contextPaths) {
  const matches = await fg(SKILL_GLOBS, {
    cwd: root,
    ignore: DISCOVERY_IGNORE,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false
  });
  const byPath = new Map(contextPaths.map((file) => [file.path, file]));
  const skills = [];
  for (const file of matches.sort()) {
    let text;
    try {
      const target = path.join(root, file);
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      text = await readFile(target, 'utf8');
    } catch {
      continue;
    }
    const existing = byPath.get(file);
    skills.push({
      path: file,
      name: skillName(text, file),
      text,
      tokens: existing?.tokens ?? countTokens(text),
      loadClass: existing?.loadClass ?? 'on-demand',
      kind: existing ? 'context-and-skill' : 'skill',
      status: existing ? 'also selected as a context file' : 'available; active use is not observable'
    });
  }
  return skills;
}

function redactSecrets(text) {
  let safe = text;
  for (const [, pattern] of SECRET_PATTERNS) safe = safe.replace(pattern, '[REDACTED]');
  return safe;
}

function scanSecurity(sources) {
  const findings = [];
  for (const source of sources) {
    const lines = source.text.split('\n');
    for (let index = 0; index < lines.length; index++) {
      for (const [rule, pattern] of SECRET_PATTERNS) {
        if (pattern.test(lines[index])) {
          findings.push({
            rule: 'possible-secret',
            severity: 'error',
            path: source.path,
            line: index + 1,
            text: `possible credential detected (${rule}); value redacted`,
            fix: 'remove it from repository context, revoke or rotate it, and load secrets through a secret manager'
          });
          break;
        }
      }
      for (const [rule, pattern] of RISKY_FLAGS) {
        if (pattern.test(lines[index])) {
          findings.push({
            rule: 'risky-execution-flag',
            severity: 'warning',
            path: source.path,
            line: index + 1,
            text: `instruction contains ${rule === 'permission-bypass' ? 'a permissions-bypass flag' : 'a sandbox-bypass flag'}`,
            fix: 'remove the bypass or document a narrowly scoped reason and review the affected workflow'
          });
        }
      }
    }
  }
  return findings;
}

async function discoverMcp(root, sources) {
  const servers = [];
  const findings = [];
  for (const file of MCP_CONFIGS) {
    let raw;
    try {
      const target = path.join(root, file);
      const info = await lstat(target);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      raw = await readFile(target, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') findings.push({
        rule: 'mcp-config-unreadable', severity: 'warning', path: file, line: 1,
        text: 'MCP configuration could not be read', fix: 'check file permissions and JSON syntax'
      });
      continue;
    }
    sources.push({ path: file, text: raw });
    let document;
    try {
      document = JSON.parse(raw);
    } catch {
      findings.push({
        rule: 'mcp-config-invalid', severity: 'error', path: file, line: 1,
        text: 'MCP configuration is not valid JSON', fix: 'fix the JSON syntax so configured server names can be inspected'
      });
      continue;
    }
    const entries = document?.mcpServers ?? document?.servers ?? {};
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    for (const [name, definition] of Object.entries(entries)) {
      const server = definition && typeof definition === 'object' ? definition : {};
      servers.push({
        name,
        configPath: file,
        transport: typeof server.url === 'string' ? 'http' : typeof server.command === 'string' ? 'stdio' : 'unknown',
        status: 'configured; runtime tool schemas and usage are not observable',
        runtimeTokens: null,
        fix: `disable ${name} in ${file} if unused; inspect the connected client's exposed tools for its actual session cost`
      });
    }
  }
  return { servers, findings };
}

function sourceFix(source, findings) {
  const stale = findings.filter((finding) => finding.path === source.path && ['stale-path', 'dead-command', 'missing-ref', 'stale-glob'].includes(finding.rule));
  const risky = findings.filter((finding) => finding.path === source.path && ['possible-secret', 'risky-execution-flag'].includes(finding.rule));
  if (risky.length) return `resolve the ${risky.length} security finding(s) below before sharing this context`;
  if (stale.length) return `fix the ${stale.length} stale reference(s) below; update or remove the named path/command`;
  if (source.kind === 'skill') return 'keep it on-demand; remove it only if the skill is obsolete';
  if (['always', 'startup'].includes(source.loadClass)) return 'move task-specific guidance to an on-demand skill; keep cross-task rules here';
  return 'keep only if this agent uses the file; remove duplicated or obsolete rules';
}

/** Inventory repository context without executing MCP servers or claiming runtime visibility. */
export async function analyzeWhy(root, suppliedConfig = null) {
  const config = suppliedConfig ?? await loadConfig(root);
  const selected = await collectFiles(root, config);
  const sources = [];
  for (const file of selected) {
    const text = await readFile(path.join(root, file), 'utf8');
    sources.push({
      path: file,
      name: file,
      text,
      tokens: countTokens(text),
      kind: 'context-file',
      loadClass: loadClassFor(file),
      status: 'repository file; runtime inclusion depends on the client'
    });
  }
  const skills = await discoverSkills(root, sources);
  for (const skill of skills) {
    const source = sources.find((entry) => entry.path === skill.path);
    if (source) {
      source.kind = 'context-and-skill';
      source.name = `skill: ${skill.name} (${skill.path})`;
      source.status = `${source.status}; also a skill, active use is not observable`;
    } else {
      sources.push(skill);
    }
  }

  const mcpConfigSources = [];
  const { servers, findings: mcpFindings } = await discoverMcp(root, mcpConfigSources);
  const securityInputs = [
    ...sources.map((source) => ({ path: source.path, text: source.text })),
    ...mcpConfigSources
  ];
  const securityFindings = scanSecurity(securityInputs);
  const contextForStale = sources.map((source) => ({
    path: source.path,
    text: source.text,
    tokens: source.tokens,
    loadClass: source.loadClass
  }));
  const staleFindings = await findStale(contextForStale, root, config);
  const findings = [...staleFindings, ...mcpFindings, ...securityFindings]
    .map((finding) => {
      if (finding.rule === 'stale-path') return {
        ...finding,
        text: `\`${finding.ref}\` does not resolve from this repository or the instruction file's directory`,
        fix: `update \`${finding.ref}\` to the current path or remove the reference`
      };
      if (finding.rule === 'dead-command') return {
        ...finding,
        text: `\`${finding.ref}\` is not a script in the repository's package.json files`,
        fix: `replace \`${finding.ref}\` with an existing script or remove the instruction`
      };
      if (finding.rule === 'stale-glob') return {
        ...finding,
        text: `glob \`${finding.ref}\` matches no repository files`,
        fix: `correct \`${finding.ref}\` or remove the obsolete glob`
      };
      if (finding.rule === 'missing-ref') return {
        ...finding,
        text: `reference \`${finding.ref}\` does not resolve`,
        fix: `update \`${finding.ref}\` or remove the reference`
      };
      return {
        ...finding,
        ...(finding.text ? { text: redactSecrets(finding.text) } : {}),
        ...(finding.ref ? { ref: redactSecrets(finding.ref) } : {})
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));

  const reclaimableByPath = new Map();
  for (const finding of findings) {
    if (!Number.isInteger(finding.reclaimableTokens)) continue;
    const blocks = reclaimableByPath.get(finding.path) ?? new Map();
    const line = finding.startLine ?? finding.line;
    blocks.set(line, Math.max(blocks.get(line) ?? 0, finding.reclaimableTokens));
    reclaimableByPath.set(finding.path, blocks);
  }
  const reclaimableTotals = new Map([...reclaimableByPath].map(([file, blocks]) => [
    file,
    [...blocks.values()].reduce((total, tokens) => total + tokens, 0)
  ]));
  const ranked = sources
    .map((source) => ({
      name: source.name,
      path: source.path,
      kind: source.kind,
      tokens: source.tokens,
      reclaimableTokens: reclaimableTotals.get(source.path) ?? 0,
      loadClass: source.loadClass,
      status: source.status,
      fix: sourceFix(source, findings)
    }))
    .sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));
  return {
    schema: 'ctxcap/why/v1',
    approximate: APPROXIMATE,
    tokenizer: TOKENIZER_ID,
    measuredFileTokens: ranked.reduce((total, source) => total + source.tokens, 0),
    sources: ranked,
    mcpServers: servers.sort((a, b) => a.name.localeCompare(b.name) || a.configPath.localeCompare(b.configPath)),
    findings,
    note: 'File counts are approximate full-file sizes, not a complete session total. Skills may be on-demand. MCP servers are listed by name but are never launched; their exposed tool schemas and usage require client/runtime data.'
  };
}

export function renderWhy(report) {
  const lines = [
    'ctxcap why — repository context diagnosis',
    `Measured file total: ${report.measuredFileTokens.toLocaleString('en-US')} tokens (${report.tokenizer}, approximate; includes full skill files)`,
    '',
    'Largest known repository sources (full-file sizes, not confirmed active session usage):'
  ];
  if (!report.sources.length) lines.push('  No matching context files or skills found.');
  for (const [index, source] of report.sources.entries()) {
    const label = source.kind === 'skill' ? `skill: ${source.name}` : source.name;
    const reclaimable = source.reclaimableTokens > 0
      ? `; up to ${source.reclaimableTokens.toLocaleString('en-US')} flagged tokens reclaimable`
      : '';
    lines.push(`  ${index + 1}. ${label} — ${source.tokens.toLocaleString('en-US')} tokens [${source.loadClass}${reclaimable}]`);
    lines.push(`     Fix: ${source.fix}`);
  }
  lines.push('', 'Configured MCP servers (not launched; live tool-schema cost is unknown):');
  if (!report.mcpServers.length) lines.push('  None found in the repository MCP configuration files.');
  for (const server of report.mcpServers) {
    lines.push(`  MCP: ${server.name} — cost unknown (${server.transport}, ${server.configPath})`);
    lines.push(`     Fix: ${server.fix}`);
  }
  lines.push('', `Findings: ${report.findings.length}`);
  for (const finding of report.findings) {
    lines.push(`  ${finding.path}:${finding.line} ${finding.severity.toUpperCase()} ${finding.rule} — ${finding.text}`);
    lines.push(`     Fix: ${finding.fix}`);
  }
  lines.push('', report.note);
  return lines.join('\n');
}

export async function whyCli(argv) {
  let root = '.';
  let configPath;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--root' || arg === '--config') {
      if (index + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      if (arg === '--root') root = argv[++index];
      else configPath = argv[++index];
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: ctxcap why [--json] [--root <path>] [--config <path>]');
      return 0;
    } else throw new Error(`unknown argument: ${arg}. Run ctxcap why --help`);
  }
  const absoluteRoot = path.resolve(root);
  const config = await loadConfig(absoluteRoot, configPath);
  const report = await analyzeWhy(absoluteRoot, config);
  console.log(json ? JSON.stringify(report, null, 2) : renderWhy(report));
  return 0;
}
