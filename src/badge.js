// A shields.io endpoint badge for the context total. shields fetches the JSON
// from a public URL, so the file has to be committed to a public repository.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BADGE_FILE = '.ctxcap/badge.json';

/** Under 500 tokens green, under 2000 yellow, otherwise red. */
export const badgeColor = (tokens) => (tokens < 500 ? 'green' : tokens < 2000 ? 'yellow' : 'red');

export const badgeFor = (tokens) => ({ schemaVersion: 1, label: 'context', message: String(tokens), color: badgeColor(tokens) });

export const badgeText = (tokens) => JSON.stringify(badgeFor(tokens)) + '\n';

export async function writeBadge(root, tokens) {
  const file = path.join(root, BADGE_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, badgeText(tokens), 'utf8');
  return badgeFor(tokens);
}

/** The Markdown image line, linking the badge to the tool that made it. */
export function badgeMarkdown({ owner, name }) {
  const raw = `https://raw.githubusercontent.com/${owner}/${name}/HEAD/${BADGE_FILE}`;
  return `[![context tokens](https://img.shields.io/endpoint?url=${encodeURIComponent(raw)})](https://github.com/Naeha-S/ctxcap)`;
}
