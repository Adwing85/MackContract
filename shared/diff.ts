// Zeilen-/Satzvergleich zweier Dokumente (LCS) inkl. Wortmarkierung.

export type DiffOp<T> =
  | { type: 'equal'; a: T; b: T }
  | { type: 'del'; a: T }
  | { type: 'add'; b: T };

/** Maximale Matrixgröße, damit der Vergleich im Browser schnell bleibt. */
export const MAX_DIFF_CELLS = 9_000_000;

export function diffSequences<T>(
  a: T[],
  b: T[],
  equals: (x: T, y: T) => boolean = (x, y) => x === y,
): DiffOp<T>[] | null {
  let start = 0;
  while (start < a.length && start < b.length && equals(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && equals(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }

  const n = endA - start;
  const m = endB - start;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) return null;

  // lcs[i][j] = LCS-Länge von a[start+i..] und b[start+j..]
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = equals(a[start + i], b[start + j])
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const ops: DiffOp<T>[] = [];
  for (let k = 0; k < start; k++) ops.push({ type: 'equal', a: a[k], b: b[k] });
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (equals(a[start + i], b[start + j])) {
      ops.push({ type: 'equal', a: a[start + i], b: b[start + j] });
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      ops.push({ type: 'del', a: a[start + i] });
      i++;
    } else {
      ops.push({ type: 'add', b: b[start + j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: 'del', a: a[start + i++] });
  while (j < m) ops.push({ type: 'add', b: b[start + j++] });
  for (let k = 0; k < a.length - endA; k++) ops.push({ type: 'equal', a: a[endA + k], b: b[endB + k] });
  return ops;
}

export interface DiffRow {
  kind: 'equal' | 'changed' | 'removed' | 'added';
  left: string | null;
  right: string | null;
}

export function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').replace(/[„“”"]/g, '"').trim();
}

/** Vergleicht zwei Segmentlisten und paart Lösch-/Einfügeblöcke zu „geändert“. */
export function diffRows(left: string[], right: string[]): DiffRow[] | null {
  const ops = diffSequences(left, right, (x, y) => normalizeForCompare(x) === normalizeForCompare(y));
  if (!ops) return null;
  const rows: DiffRow[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = () => {
    const pairs = Math.max(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      const l = dels[k] ?? null;
      const r = adds[k] ?? null;
      rows.push({ kind: l !== null && r !== null ? 'changed' : l !== null ? 'removed' : 'added', left: l, right: r });
    }
    dels = [];
    adds = [];
  };
  for (const op of ops) {
    if (op.type === 'equal') {
      flush();
      rows.push({ kind: 'equal', left: op.a, right: op.b });
    } else if (op.type === 'del') dels.push(op.a);
    else adds.push(op.b);
  }
  flush();
  return rows;
}

export interface WordPart {
  text: string;
  changed: boolean;
}

/** Wortweise Markierung innerhalb einer geänderten Zeile. */
export function diffWords(left: string, right: string): { left: WordPart[]; right: WordPart[] } {
  const tokenize = (s: string) => s.split(/(\s+)/).filter((t) => t.length > 0);
  const a = tokenize(left);
  const b = tokenize(right);
  const ops = diffSequences(a, b, (x, y) => x.toLowerCase() === y.toLowerCase());
  if (!ops) return { left: [{ text: left, changed: true }], right: [{ text: right, changed: true }] };
  const l: WordPart[] = [];
  const r: WordPart[] = [];
  const push = (arr: WordPart[], text: string, changed: boolean) => {
    const last = arr[arr.length - 1];
    if (last && last.changed === changed) last.text += text;
    else arr.push({ text, changed: changed && text.trim().length > 0 });
  };
  for (const op of ops) {
    if (op.type === 'equal') {
      push(l, op.a, false);
      push(r, op.b, false);
    } else if (op.type === 'del') push(l, op.a, true);
    else push(r, op.b, true);
  }
  return { left: l, right: r };
}

export function diffSummary(rows: DiffRow[]): { equal: number; changed: number; removed: number; added: number; similarity: number } {
  const counts = { equal: 0, changed: 0, removed: 0, added: 0 };
  for (const row of rows) counts[row.kind]++;
  const total = rows.length || 1;
  return { ...counts, similarity: counts.equal / total };
}
