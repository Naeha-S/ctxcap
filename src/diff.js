// A small line diff that prints what `git apply` reads. Context files and
// agent config are short, so a plain LCS table is enough.

const NO_EOL = '\\ No newline at end of file';

function split(text) {
  if (text === null || text === '') return [];
  const eol = text.endsWith('\n');
  const lines = (eol ? text.slice(0, -1) : text).split('\n').map((line) => ({ line, eol: true }));
  lines[lines.length - 1].eol = eol;
  return lines;
}

const same = (a, b) => a.line === b.line && a.eol === b.eol;

function operations(a, b) {
  let head = 0;
  while (head < a.length && head < b.length && same(a[head], b[head])) head++;
  let tailA = a.length;
  let tailB = b.length;
  while (tailA > head && tailB > head && same(a[tailA - 1], b[tailB - 1])) { tailA--; tailB--; }

  const n = tailA - head;
  const m = tailB - head;
  const ops = [];
  for (let i = 0; i < head; i++) ops.push({ type: ' ', entry: a[i] });
  if (n * m > 4_000_000) {
    for (let i = head; i < tailA; i++) ops.push({ type: '-', entry: a[i] });
    for (let j = head; j < tailB; j++) ops.push({ type: '+', entry: b[j] });
  } else {
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * width + j] = same(a[head + i], b[head + j])
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (same(a[head + i], b[head + j])) { ops.push({ type: ' ', entry: a[head + i] }); i++; j++; }
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) ops.push({ type: '-', entry: a[head + i++] });
      else ops.push({ type: '+', entry: b[head + j++] });
    }
    while (i < n) ops.push({ type: '-', entry: a[head + i++] });
    while (j < m) ops.push({ type: '+', entry: b[head + j++] });
  }
  for (let i = tailA; i < a.length; i++) ops.push({ type: ' ', entry: a[i] });
  return ops;
}

/**
 * Unified diff of one file. `before` or `after` is null when the file does
 * not exist on that side. Returns '' when nothing changes.
 */
export function unifiedDiff(file, before, after, context = 3) {
  if (before === after) return '';
  const ops = operations(split(before), split(after));
  const changed = ops.map((op, index) => (op.type === ' ' ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return '';

  const ranges = [];
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last.to + 1) last.to = Math.max(last.to, to);
    else ranges.push({ from, to });
  }

  const out = [`diff --git a/${file} b/${file}`];
  if (before === null) out.push('new file mode 100644');
  if (after === null) out.push('deleted file mode 100644');
  out.push(before === null ? '--- /dev/null' : `--- a/${file}`);
  out.push(after === null ? '+++ /dev/null' : `+++ b/${file}`);

  let lineA = 0;
  let lineB = 0;
  let cursor = 0;
  for (const range of ranges) {
    for (; cursor < range.from; cursor++) {
      if (ops[cursor].type !== '+') lineA++;
      if (ops[cursor].type !== '-') lineB++;
    }
    const body = [];
    let countA = 0;
    let countB = 0;
    for (; cursor <= range.to; cursor++) {
      const op = ops[cursor];
      if (op.type !== '+') countA++;
      if (op.type !== '-') countB++;
      body.push(op.type + op.entry.line);
      if (!op.entry.eol) body.push(NO_EOL);
    }
    const startA = countA === 0 ? lineA : lineA + 1;
    const startB = countB === 0 ? lineB : lineB + 1;
    out.push(`@@ -${startA},${countA} +${startB},${countB} @@`, ...body);
    lineA += countA;
    lineB += countB;
  }
  return out.join('\n') + '\n';
}
