// What `ctxcap init` writes for each coding agent. Every target is a file that
// can be committed, so a clone inherits the wiring without running anything.

export const GROUPS = ['claude', 'cursor', 'codex', 'copilot', 'ci'];

export const BEGIN = '<!-- ctxcap:begin -->';
export const END = '<!-- ctxcap:end -->';
export const MANAGED_MD = '<!-- ctxcap:managed -->';
export const MANAGED_HASH = '# ctxcap:managed';

/**
 * A target is one of three kinds:
 *   file  - a whole file ctxcap owns: { path, kind, content, marker }
 *   block - a fenced block in a Markdown file: { path, kind, lines, place }
 *   json  - keys merged into a JSON file: { path, kind, present, add, strip }
 * `groups` lists the agents the target belongs to.
 */
export function targetsFor(_context) {
  return [];
}
