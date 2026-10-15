// Datenzugriff für eigene Standards, Standardprüfungen und das Abweichungsregister.

import {
  EXAMPLE_AGB,
  isTracked,
  runCheck,
  STANDARD_TEMPLATES,
  summarize,
  type Deviation,
  type DeviationStatus,
  type DeviationWithContext,
  type Finding,
  type ReferenceKind,
  type RuleKind,
  type Severity,
  type StandardCheck,
  type StandardDetail,
  type StandardDocument,
  type StandardDocumentFull,
  type StandardRule,
  type StandardScope,
  type StandardSummary,
} from '../shared/standards';
import { nowIso, transaction, type DB } from './db';
import {
  all,
  get,
  getDocument,
  getPerson,
  HttpError,
  insertId,
  listRules,
  mapRule,
  run,
  touchProjectOfDocument,
  updateFields,
  type Params,
  type Row,
} from './store';

function notFound(what: string): never {
  throw new HttpError(404, `${what} nicht gefunden`);
}

const mapStandard = (r: Row) => ({
  id: r.id as number,
  name: r.name as string,
  description: r.description as string,
  scope: r.scope as StandardScope,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const mapStandardDocument = (r: Row): StandardDocument => ({
  id: r.id,
  standardId: r.standard_id,
  title: r.title,
  kind: r.kind,
  fileName: r.file_name,
  hasFile: Boolean(r.file_path),
  contentLength: r.content_length ?? (r.content ? String(r.content).length : 0),
  createdAt: r.created_at,
});

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const mapDeviation = (r: Row): DeviationWithContext => ({
  id: r.id,
  documentId: r.document_id,
  standardId: r.standard_id,
  findingKey: r.finding_key,
  kind: r.kind,
  title: r.title,
  category: r.category,
  expected: r.expected,
  actual: r.actual,
  evidence: r.evidence,
  sourceLine: r.source_line,
  severity: r.severity,
  result: r.result,
  status: r.status,
  comment: r.comment,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name ?? null,
  dueDate: r.due_date,
  firstDetectedAt: r.first_detected_at,
  lastCheckedAt: r.last_checked_at,
  resolvedAt: r.resolved_at,
  decidedById: r.decided_by,
  decidedByName: r.decided_by_name ?? null,
  decidedAt: r.decided_at,
  documentTitle: r.document_title,
  projectId: r.project_id,
  projectName: r.project_name,
  standardName: r.standard_name,
});

function touchStandard(db: DB, id: number) {
  run(db, 'UPDATE standards SET updated_at = ? WHERE id = ?', nowIso(), id);
}

function getStandardRow(db: DB, id: number): Row {
  return get(db, 'SELECT * FROM standards WHERE id = ?', id) ?? notFound('Standard');
}

// ------------------------------------------------------------------ Standards

export function listStandards(db: DB): StandardSummary[] {
  return all(
    db,
    `SELECT s.*,
       (SELECT COUNT(*) FROM standard_rules r WHERE r.standard_id = s.id) AS rule_count,
       (SELECT COUNT(*) FROM standard_documents d WHERE d.standard_id = s.id) AS document_count,
       (SELECT COUNT(*) FROM deviations v WHERE v.standard_id = s.id AND v.status IN ('open', 'negotiate')) AS open_deviations,
       (SELECT COUNT(DISTINCT c.document_id) FROM standard_checks c WHERE c.standard_id = s.id) AS checked_documents
     FROM standards s ORDER BY s.name COLLATE NOCASE`,
  ).map((r) => ({
    ...mapStandard(r),
    ruleCount: r.rule_count,
    documentCount: r.document_count,
    openDeviations: r.open_deviations,
    checkedDocuments: r.checked_documents,
  }));
}

export function getStandard(db: DB, id: number): StandardDetail {
  const s = mapStandard(getStandardRow(db, id));
  return {
    ...s,
    rules: listRules(db, id),
    documents: all(
      db,
      `SELECT id, standard_id, title, kind, file_name, file_path, created_at, LENGTH(content) AS content_length
       FROM standard_documents WHERE standard_id = ? ORDER BY created_at, id`,
      id,
    ).map(mapStandardDocument),
  };
}

export interface RuleInput {
  title: string;
  category: string;
  kind: RuleKind;
  metric: string;
  target: string;
  tolerance: string;
  severity: Severity;
  guidance: string;
  active: boolean;
}

export function createStandard(
  db: DB,
  input: { name: string; description: string; scope: StandardScope; template: 'sales' | 'purchase' | null; exampleDocument: boolean },
): StandardDetail {
  const id = transaction(db, () => {
    const standardId = insertId(db, 'INSERT INTO standards (name, description, scope) VALUES (?, ?, ?)', input.name, input.description, input.scope);
    if (input.template) {
      createRules(
        db,
        standardId,
        STANDARD_TEMPLATES[input.template].rules.map((r) => ({ ...r, active: true })),
      );
    }
    if (input.exampleDocument) {
      createStandardDocument(db, standardId, {
        title: 'Allgemeine Lieferbedingungen (Beispiel)',
        kind: 'agb',
        content: EXAMPLE_AGB,
        fileName: null,
        filePath: null,
        fileMime: null,
      });
    }
    return standardId;
  });
  return getStandard(db, id);
}

export function updateStandard(db: DB, id: number, patch: Partial<{ name: string; description: string; scope: StandardScope }>): StandardDetail {
  getStandardRow(db, id);
  updateFields(db, 'standards', id, { name: patch.name, description: patch.description, scope: patch.scope });
  return getStandard(db, id);
}

export function deleteStandard(db: DB, id: number): string[] {
  getStandardRow(db, id);
  const files = all(db, 'SELECT file_path FROM standard_documents WHERE standard_id = ? AND file_path IS NOT NULL', id).map(
    (r) => r.file_path as string,
  );
  run(db, 'DELETE FROM standards WHERE id = ?', id);
  return files;
}

// ------------------------------------------------------------------ Regeln

export function createRules(db: DB, standardId: number, items: RuleInput[]): StandardRule[] {
  getStandardRow(db, standardId);
  const ids = transaction(db, () => {
    let pos = get(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM standard_rules WHERE standard_id = ?', standardId)!.p as number;
    return items.map((r) =>
      insertId(
        db,
        `INSERT INTO standard_rules (standard_id, position, title, category, kind, metric, target, tolerance, severity, guidance, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        standardId,
        pos++,
        r.title,
        r.category,
        r.kind,
        r.metric,
        r.target,
        r.tolerance,
        r.severity,
        r.guidance,
        r.active ? 1 : 0,
      ),
    );
  });
  touchStandard(db, standardId);
  return ids.map((id) => mapRule(get(db, 'SELECT * FROM standard_rules WHERE id = ?', id)!));
}

export function updateRule(db: DB, id: number, patch: Partial<RuleInput & { position: number }>): StandardRule {
  const row = get(db, 'SELECT * FROM standard_rules WHERE id = ?', id) ?? notFound('Regel');
  updateFields(
    db,
    'standard_rules',
    id,
    {
      title: patch.title,
      category: patch.category,
      kind: patch.kind,
      metric: patch.metric,
      target: patch.target,
      tolerance: patch.tolerance,
      severity: patch.severity,
      guidance: patch.guidance,
      active: patch.active === undefined ? undefined : patch.active ? 1 : 0,
      position: patch.position,
    },
    false,
  );
  touchStandard(db, row.standard_id);
  return mapRule(get(db, 'SELECT * FROM standard_rules WHERE id = ?', id)!);
}

export function deleteRule(db: DB, id: number): void {
  const row = get(db, 'SELECT * FROM standard_rules WHERE id = ?', id) ?? notFound('Regel');
  run(db, 'DELETE FROM standard_rules WHERE id = ?', id);
  touchStandard(db, row.standard_id);
}

// ------------------------------------------------------------------ Referenzdokumente

export function createStandardDocument(
  db: DB,
  standardId: number,
  input: { title: string; kind: ReferenceKind; content: string; fileName: string | null; filePath: string | null; fileMime: string | null },
): StandardDocumentFull {
  getStandardRow(db, standardId);
  const id = insertId(
    db,
    'INSERT INTO standard_documents (standard_id, title, kind, content, file_name, file_path, file_mime) VALUES (?, ?, ?, ?, ?, ?, ?)',
    standardId,
    input.title,
    input.kind,
    input.content,
    input.fileName,
    input.filePath,
    input.fileMime,
  );
  touchStandard(db, standardId);
  return getStandardDocument(db, id);
}

export function getStandardDocument(db: DB, id: number): StandardDocumentFull {
  const row = get(db, 'SELECT * FROM standard_documents WHERE id = ?', id) ?? notFound('Referenzdokument');
  return { ...mapStandardDocument(row), content: row.content };
}

export function updateStandardDocument(db: DB, id: number, patch: Partial<{ title: string; kind: ReferenceKind; content: string }>): StandardDocumentFull {
  const row = get(db, 'SELECT * FROM standard_documents WHERE id = ?', id) ?? notFound('Referenzdokument');
  updateFields(db, 'standard_documents', id, { title: patch.title, kind: patch.kind, content: patch.content }, false);
  touchStandard(db, row.standard_id);
  return getStandardDocument(db, id);
}

export function getStandardDocumentFile(db: DB, id: number): { path: string; name: string } {
  const row = get(db, 'SELECT * FROM standard_documents WHERE id = ?', id) ?? notFound('Referenzdokument');
  if (!row.file_path) throw new HttpError(404, 'Zu diesem Referenzdokument wurde keine Datei hochgeladen');
  return { path: row.file_path, name: row.file_name };
}

export function deleteStandardDocument(db: DB, id: number): string | null {
  const row = get(db, 'SELECT * FROM standard_documents WHERE id = ?', id) ?? notFound('Referenzdokument');
  run(db, 'DELETE FROM standard_documents WHERE id = ?', id);
  touchStandard(db, row.standard_id);
  return row.file_path ?? null;
}

// ------------------------------------------------------------------ Prüfung & Abweichungen

const CHECK_SELECT = `SELECT c.*, s.name AS standard_name, p.name AS checked_by_name
  FROM standard_checks c JOIN standards s ON s.id = c.standard_id LEFT JOIN people p ON p.id = c.checked_by`;

const mapCheck = (r: Row): StandardCheck => ({
  id: r.id,
  documentId: r.document_id,
  standardId: r.standard_id,
  standardName: r.standard_name,
  checkedAt: r.checked_at,
  checkedByName: r.checked_by_name ?? null,
  summary: parseJson(r.summary, summarize([])),
  findings: parseJson<Finding[]>(r.findings, []),
});

/**
 * Prüft ein Dokument gegen einen Standard und gleicht das Abweichungsregister ab:
 * neue Abweichungen werden angelegt, behobene geschlossen, wieder auftretende neu geöffnet.
 * Ändert sich der Ist-Wert einer bereits entschiedenen Abweichung, wird sie erneut offen.
 */
export function runDocumentCheck(db: DB, documentId: number, standardId: number, actorId: number | null): StandardCheck {
  const doc = getDocument(db, documentId);
  const standard = getStandard(db, standardId);
  const references = standard.documents.map((d) => {
    const full = getStandardDocument(db, d.id);
    return { id: d.id, title: d.title, content: full.content };
  });
  const findings = runCheck({ rules: standard.rules, references, content: doc.content, terms: doc.terms });
  const summary = summarize(findings);
  const now = nowIso();

  const checkId = transaction(db, () => {
    const existing = new Map(
      all(db, 'SELECT * FROM deviations WHERE document_id = ? AND standard_id = ?', documentId, standardId).map((r) => [r.finding_key as string, r]),
    );
    const seen = new Set<string>();
    for (const f of findings.filter(isTracked)) {
      seen.add(f.key);
      const prev = existing.get(f.key);
      if (prev) {
        const reopen = prev.status === 'resolved' || (prev.actual !== f.actual && prev.status !== 'open' && prev.status !== 'negotiate');
        run(
          db,
          `UPDATE deviations SET title = ?, category = ?, expected = ?, actual = ?, evidence = ?, source_line = ?, severity = ?, result = ?,
             last_checked_at = ?, status = ?, resolved_at = ? WHERE id = ?`,
          f.title,
          f.category,
          f.expected,
          f.actual,
          f.evidence,
          f.sourceLine,
          f.severity,
          f.result,
          now,
          reopen ? 'open' : prev.status,
          reopen ? null : prev.resolved_at,
          prev.id,
        );
      } else {
        run(
          db,
          `INSERT INTO deviations (document_id, standard_id, finding_key, kind, title, category, expected, actual, evidence, source_line,
             severity, result, status, first_detected_at, last_checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
          documentId,
          standardId,
          f.key,
          f.kind,
          f.title,
          f.category,
          f.expected,
          f.actual,
          f.evidence,
          f.sourceLine,
          f.severity,
          f.result,
          now,
          now,
        );
      }
    }
    for (const [key, prev] of existing) {
      if (seen.has(key) || prev.status === 'resolved') continue;
      run(db, `UPDATE deviations SET status = 'resolved', resolved_at = ?, last_checked_at = ? WHERE id = ?`, now, now, prev.id);
    }
    const id = insertId(
      db,
      'INSERT INTO standard_checks (document_id, standard_id, checked_at, checked_by, summary, findings) VALUES (?, ?, ?, ?, ?, ?)',
      documentId,
      standardId,
      now,
      actorId,
      JSON.stringify(summary),
      JSON.stringify(findings),
    );
    touchProjectOfDocument(db, documentId);
    return id;
  });
  return mapCheck(get(db, `${CHECK_SELECT} WHERE c.id = ?`, checkId)!);
}

/** Letzte Prüfung je Standard für ein Dokument. */
export function listChecks(db: DB, documentId: number): StandardCheck[] {
  return all(
    db,
    `${CHECK_SELECT} WHERE c.document_id = ? AND c.id IN (SELECT MAX(id) FROM standard_checks WHERE document_id = ? GROUP BY standard_id)
     ORDER BY c.checked_at DESC`,
    documentId,
    documentId,
  ).map(mapCheck);
}

/** Verlauf: Kennzahlen aller Prüfläufe eines Dokuments gegen einen Standard. */
export function checkHistory(db: DB, documentId: number, standardId: number): Array<{ id: number; checkedAt: string; checkedByName: string | null; summary: StandardCheck['summary'] }> {
  return all(
    db,
    `SELECT c.id, c.checked_at, c.summary, p.name AS checked_by_name FROM standard_checks c LEFT JOIN people p ON p.id = c.checked_by
     WHERE c.document_id = ? AND c.standard_id = ? ORDER BY c.checked_at, c.id`,
    documentId,
    standardId,
  ).map((r) => ({ id: r.id, checkedAt: r.checked_at, checkedByName: r.checked_by_name ?? null, summary: parseJson(r.summary, summarize([])) }));
}

const DEVIATION_SELECT = `SELECT v.*, a.name AS assignee_name, b.name AS decided_by_name, d.title AS document_title,
  d.project_id, pr.name AS project_name, s.name AS standard_name
  FROM deviations v
  JOIN documents d ON d.id = v.document_id
  JOIN projects pr ON pr.id = d.project_id
  JOIN standards s ON s.id = v.standard_id
  LEFT JOIN people a ON a.id = v.assignee_id
  LEFT JOIN people b ON b.id = v.decided_by`;

export function listDeviations(
  db: DB,
  filter: { documentId?: number; standardId?: number; projectId?: number; assigneeId?: number; status?: string; open?: boolean },
): DeviationWithContext[] {
  const where: string[] = ['1 = 1'];
  const params: Params = [];
  const add = (sql: string, value: number | string) => {
    where.push(sql);
    params.push(value);
  };
  if (filter.documentId !== undefined) add('v.document_id = ?', filter.documentId);
  if (filter.standardId !== undefined) add('v.standard_id = ?', filter.standardId);
  if (filter.projectId !== undefined) add('d.project_id = ?', filter.projectId);
  if (filter.assigneeId !== undefined) add('v.assignee_id = ?', filter.assigneeId);
  if (filter.status) add('v.status = ?', filter.status);
  if (filter.open) where.push(`v.status IN ('open', 'negotiate')`);
  return all(
    db,
    `${DEVIATION_SELECT} WHERE ${where.join(' AND ')}
     ORDER BY v.status = 'resolved', CASE v.severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 ELSE 2 END, v.first_detected_at, v.id`,
    ...params,
  ).map(mapDeviation);
}

export function getDeviation(db: DB, id: number): DeviationWithContext {
  const row = get(db, `${DEVIATION_SELECT} WHERE v.id = ?`, id);
  return row ? mapDeviation(row) : notFound('Abweichung');
}

export function updateDeviation(
  db: DB,
  id: number,
  patch: Partial<{ status: DeviationStatus; comment: string; assigneeId: number | null; dueDate: string | null }>,
  actorId: number | null,
): Deviation {
  const dev = getDeviation(db, id);
  if (patch.assigneeId) getPerson(db, patch.assigneeId);
  updateFields(
    db,
    'deviations',
    id,
    {
      status: patch.status,
      comment: patch.comment,
      assignee_id: patch.assigneeId,
      due_date: patch.dueDate,
      decided_by: patch.status !== undefined ? actorId : undefined,
      decided_at: patch.status !== undefined ? nowIso() : undefined,
      resolved_at: patch.status === undefined ? undefined : patch.status === 'resolved' ? nowIso() : null,
    },
    false,
  );
  touchProjectOfDocument(db, dev.documentId);
  return getDeviation(db, id);
}
