import { DEFAULT_CRITERIA } from '../shared/scoring';
import {
  emptyStats,
  worstRating,
  type Comment,
  type Criterion,
  type DashboardData,
  type DocumentFull,
  type DocumentMeta,
  type NewRequirementInput,
  type Person,
  type Project,
  type ProjectDetail,
  type ProjectSummary,
  type Rating,
  type ReqStats,
  type ReqStatus,
  type Requirement,
  type RequirementDetail,
  type Score,
  type Task,
  type TaskBrief,
  type TaskWithContext,
} from '../shared/types';
import { nowIso, transaction, type DB, type SQLValue } from './db';

type Row = Record<string, any>;
type Params = SQLValue[];

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const all = (db: DB, sql: string, ...params: Params) => db.prepare(sql).all(...params) as Row[];
const get = (db: DB, sql: string, ...params: Params) => db.prepare(sql).get(...params) as Row | undefined;
const run = (db: DB, sql: string, ...params: Params) => db.prepare(sql).run(...params);
const insertId = (db: DB, sql: string, ...params: Params) => Number(run(db, sql, ...params).lastInsertRowid);

function notFound(what: string): never {
  throw new HttpError(404, `${what} nicht gefunden`);
}

/** Baut ein UPDATE aus einem Patch-Objekt; nur erlaubte Felder werden übernommen. */
function updateFields(db: DB, table: string, id: number, patch: Record<string, SQLValue | undefined>, touch = true) {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as Array<[string, SQLValue]>;
  if (touch) entries.push(['updated_at', nowIso()]);
  if (entries.length === 0) return;
  const sets = entries.map(([k]) => `${k} = ?`).join(', ');
  run(db, `UPDATE ${table} SET ${sets} WHERE id = ?`, ...entries.map(([, v]) => v), id);
}

// ---------------------------------------------------------------- Mapper

const mapPerson = (r: Row): Person => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  createdAt: r.created_at,
});

const mapProject = (r: Row): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const mapDocumentMeta = (r: Row, stats: ReqStats): DocumentMeta => ({
  id: r.id,
  projectId: r.project_id,
  title: r.title,
  docType: r.doc_type,
  counterparty: r.counterparty,
  docDate: r.doc_date,
  reference: r.reference,
  amount: r.amount,
  currency: r.currency,
  fileName: r.file_name,
  fileMime: r.file_mime,
  hasFile: Boolean(r.file_path),
  contentLength: r.content_length ?? 0,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  stats,
});

const mapCriterion = (r: Row): Criterion => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  weight: r.weight,
  kind: r.kind,
  knockout: Boolean(r.knockout),
  position: r.position,
});

const mapTask = (r: Row): Task => ({
  id: r.id,
  requirementId: r.requirement_id,
  assigneeId: r.assignee_id,
  assigneeName: r.assignee_name,
  dueDate: r.due_date,
  instruction: r.instruction,
  state: r.state,
  rating: r.rating,
  response: r.response,
  assignedById: r.assigned_by,
  assignedByName: r.assigned_by_name ?? null,
  createdAt: r.created_at,
  completedAt: r.completed_at,
});

const mapTaskWithContext = (r: Row): TaskWithContext => ({
  ...mapTask(r),
  requirementRef: r.requirement_ref,
  requirementText: r.requirement_text,
  requirementStatus: r.requirement_status,
  documentId: r.document_id,
  documentTitle: r.document_title,
  docType: r.doc_type,
  projectId: r.project_id,
  projectName: r.project_name,
});

const mapComment = (r: Row): Comment => ({
  id: r.id,
  requirementId: r.requirement_id,
  authorId: r.author_id,
  authorName: r.author_name ?? null,
  text: r.text,
  createdAt: r.created_at,
});

function mapRequirement(r: Row, tasks: TaskBrief[]): Requirement {
  return {
    id: r.id,
    documentId: r.document_id,
    position: r.position,
    ref: r.ref,
    section: r.section,
    text: r.text,
    category: r.category,
    sourceLine: r.source_line,
    status: r.status,
    statusComment: r.status_comment,
    reviewComment: r.status_source === 'review' ? (r.review_comment ?? null) : null,
    statusSource: r.status_source,
    statusById: r.status_by,
    statusByName: r.status_by_name ?? null,
    statusAt: r.status_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tasks,
    commentCount: r.comment_count ?? 0,
  };
}

// ---------------------------------------------------------------- Personen

export function listPeople(db: DB): Person[] {
  return all(db, 'SELECT * FROM people ORDER BY name COLLATE NOCASE').map(mapPerson);
}

export function getPerson(db: DB, id: number): Person {
  const row = get(db, 'SELECT * FROM people WHERE id = ?', id);
  return row ? mapPerson(row) : notFound('Person');
}

export function createPerson(db: DB, input: { name: string; email: string; role: string }): Person {
  const id = insertId(db, 'INSERT INTO people (name, email, role) VALUES (?, ?, ?)', input.name, input.email, input.role);
  return getPerson(db, id);
}

export function updatePerson(db: DB, id: number, patch: Partial<{ name: string; email: string; role: string }>): Person {
  getPerson(db, id);
  updateFields(db, 'people', id, { name: patch.name, email: patch.email, role: patch.role }, false);
  return getPerson(db, id);
}

export function deletePerson(db: DB, id: number): void {
  getPerson(db, id);
  run(db, 'DELETE FROM people WHERE id = ?', id);
}

// ---------------------------------------------------------------- Statistik

function statsBy(db: DB, keyColumn: string, joinSql: string, whereSql: string, ...params: Params): Map<number, ReqStats> {
  const rows = all(
    db,
    `SELECT ${keyColumn} AS k, r.status AS status, COUNT(*) AS c
     FROM requirements r ${joinSql}
     WHERE ${whereSql}
     GROUP BY ${keyColumn}, r.status`,
    ...params,
  );
  const map = new Map<number, ReqStats>();
  for (const row of rows) {
    const stats = map.get(row.k) ?? emptyStats();
    stats[row.status as ReqStatus] += row.c;
    stats.total += row.c;
    map.set(row.k, stats);
  }
  return map;
}

// ---------------------------------------------------------------- Projekte

function projectSummaries(db: DB, whereSql = '1 = 1', ...params: Params): ProjectSummary[] {
  const rows = all(
    db,
    `SELECT p.*,
       (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id) AS document_count,
       (SELECT COUNT(*) FROM tasks t JOIN requirements r ON r.id = t.requirement_id
          JOIN documents d ON d.id = r.document_id
          WHERE d.project_id = p.id AND t.state = 'open') AS open_task_count
     FROM projects p WHERE ${whereSql}
     ORDER BY p.updated_at DESC`,
    ...params,
  );
  const stats = statsBy(db, 'd.project_id', 'JOIN documents d ON d.id = r.document_id', '1 = 1');
  return rows.map((r) => ({
    ...mapProject(r),
    documentCount: r.document_count,
    openTaskCount: r.open_task_count,
    stats: stats.get(r.id) ?? emptyStats(),
  }));
}

export function listProjects(db: DB): ProjectSummary[] {
  return projectSummaries(db);
}

function getProjectRow(db: DB, id: number): Row {
  return get(db, 'SELECT * FROM projects WHERE id = ?', id) ?? notFound('Projekt');
}

export function getProject(db: DB, id: number): ProjectDetail {
  const project = mapProject(getProjectRow(db, id));
  return {
    ...project,
    documents: listDocuments(db, id),
    criteria: all(db, 'SELECT * FROM criteria WHERE project_id = ? ORDER BY position, id', id).map(mapCriterion),
    scores: all(
      db,
      `SELECT s.* FROM scores s JOIN documents d ON d.id = s.document_id WHERE d.project_id = ?`,
      id,
    ).map((r): Score => ({ documentId: r.document_id, criterionId: r.criterion_id, score: r.score, note: r.note })),
  };
}

export function createProject(db: DB, input: { name: string; description: string; defaultCriteria: boolean }): ProjectDetail {
  const id = transaction(db, () => {
    const projectId = insertId(db, 'INSERT INTO projects (name, description) VALUES (?, ?)', input.name, input.description);
    if (input.defaultCriteria) {
      DEFAULT_CRITERIA.forEach((c, index) => {
        run(
          db,
          'INSERT INTO criteria (project_id, name, description, weight, kind, knockout, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
          projectId,
          c.name,
          c.description,
          c.weight,
          c.kind,
          c.knockout ? 1 : 0,
          index,
        );
      });
    }
    return projectId;
  });
  return getProject(db, id);
}

export function updateProject(db: DB, id: number, patch: Partial<{ name: string; description: string }>): ProjectDetail {
  getProjectRow(db, id);
  updateFields(db, 'projects', id, { name: patch.name, description: patch.description });
  return getProject(db, id);
}

export function deleteProject(db: DB, id: number): string[] {
  getProjectRow(db, id);
  const files = all(db, 'SELECT file_path FROM documents WHERE project_id = ? AND file_path IS NOT NULL', id).map(
    (r) => r.file_path as string,
  );
  run(db, 'DELETE FROM projects WHERE id = ?', id);
  return files;
}

function touchProject(db: DB, projectId: number): void {
  run(db, 'UPDATE projects SET updated_at = ? WHERE id = ?', nowIso(), projectId);
}

function touchProjectOfDocument(db: DB, documentId: number): void {
  run(db, 'UPDATE projects SET updated_at = ? WHERE id = (SELECT project_id FROM documents WHERE id = ?)', nowIso(), documentId);
}

// ---------------------------------------------------------------- Dokumente

const DOC_META_COLUMNS = `d.id, d.project_id, d.title, d.doc_type, d.counterparty, d.doc_date, d.reference, d.amount,
  d.currency, d.file_name, d.file_path, d.file_mime, d.created_at, d.updated_at, LENGTH(d.content) AS content_length`;

export function listDocuments(db: DB, projectId: number): DocumentMeta[] {
  const rows = all(db, `SELECT ${DOC_META_COLUMNS} FROM documents d WHERE d.project_id = ? ORDER BY d.created_at, d.id`, projectId);
  const stats = statsBy(db, 'r.document_id', 'JOIN documents d ON d.id = r.document_id', 'd.project_id = ?', projectId);
  return rows.map((r) => mapDocumentMeta(r, stats.get(r.id) ?? emptyStats()));
}

function getDocumentRow(db: DB, id: number): Row {
  return (
    get(db, `SELECT ${DOC_META_COLUMNS}, d.content, p.name AS project_name FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = ?`, id) ??
    notFound('Dokument')
  );
}

export function getDocument(db: DB, id: number): DocumentFull {
  const row = getDocumentRow(db, id);
  const stats = statsBy(db, 'r.document_id', '', 'r.document_id = ?', id).get(id) ?? emptyStats();
  return { ...mapDocumentMeta(row, stats), content: row.content, projectName: row.project_name };
}

export function getDocumentFile(db: DB, id: number): { path: string; name: string; mime: string } {
  const row = getDocumentRow(db, id);
  if (!row.file_path) throw new HttpError(404, 'Zu diesem Dokument wurde keine Datei hochgeladen');
  return { path: row.file_path, name: row.file_name, mime: row.file_mime ?? 'application/octet-stream' };
}

export interface DocumentInput {
  title: string;
  docType: string;
  counterparty: string;
  docDate: string | null;
  reference: string;
  amount: number | null;
  currency: string;
  content: string;
  fileName: string | null;
  filePath: string | null;
  fileMime: string | null;
}

export function createDocument(db: DB, projectId: number, input: DocumentInput): DocumentFull {
  getProjectRow(db, projectId);
  const id = insertId(
    db,
    `INSERT INTO documents (project_id, title, doc_type, counterparty, doc_date, reference, amount, currency, content, file_name, file_path, file_mime)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId,
    input.title,
    input.docType,
    input.counterparty,
    input.docDate,
    input.reference,
    input.amount,
    input.currency,
    input.content,
    input.fileName,
    input.filePath,
    input.fileMime,
  );
  touchProject(db, projectId);
  return getDocument(db, id);
}

export function updateDocument(
  db: DB,
  id: number,
  patch: Partial<Omit<DocumentInput, 'fileName' | 'filePath' | 'fileMime'>>,
): DocumentFull {
  getDocumentRow(db, id);
  updateFields(db, 'documents', id, {
    title: patch.title,
    doc_type: patch.docType,
    counterparty: patch.counterparty,
    doc_date: patch.docDate,
    reference: patch.reference,
    amount: patch.amount,
    currency: patch.currency,
    content: patch.content,
  });
  touchProjectOfDocument(db, id);
  return getDocument(db, id);
}

export function deleteDocument(db: DB, id: number): string | null {
  const row = getDocumentRow(db, id);
  run(db, 'DELETE FROM documents WHERE id = ?', id);
  touchProject(db, row.project_id);
  return row.file_path ?? null;
}

// ---------------------------------------------------------------- Kriterien & Bewertung

export function createCriterion(
  db: DB,
  projectId: number,
  input: { name: string; description: string; weight: number; kind: string; knockout: boolean },
): Criterion {
  getProjectRow(db, projectId);
  const pos = get(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM criteria WHERE project_id = ?', projectId)!.p;
  const id = insertId(
    db,
    'INSERT INTO criteria (project_id, name, description, weight, kind, knockout, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
    projectId,
    input.name,
    input.description,
    input.weight,
    input.kind,
    input.knockout ? 1 : 0,
    pos,
  );
  touchProject(db, projectId);
  return getCriterion(db, id);
}

export function getCriterion(db: DB, id: number): Criterion {
  const row = get(db, 'SELECT * FROM criteria WHERE id = ?', id);
  return row ? mapCriterion(row) : notFound('Kriterium');
}

export function updateCriterion(
  db: DB,
  id: number,
  patch: Partial<{ name: string; description: string; weight: number; kind: string; knockout: boolean; position: number }>,
): Criterion {
  getCriterion(db, id);
  updateFields(
    db,
    'criteria',
    id,
    {
      name: patch.name,
      description: patch.description,
      weight: patch.weight,
      kind: patch.kind,
      knockout: patch.knockout === undefined ? undefined : patch.knockout ? 1 : 0,
      position: patch.position,
    },
    false,
  );
  return getCriterion(db, id);
}

export function deleteCriterion(db: DB, id: number): void {
  getCriterion(db, id);
  run(db, 'DELETE FROM criteria WHERE id = ?', id);
}

export function setScore(db: DB, input: { documentId: number; criterionId: number; score: number | null; note: string | undefined }): Score {
  const doc = getDocumentRow(db, input.documentId);
  const criterion = getCriterion(db, input.criterionId);
  if (criterion.projectId !== doc.project_id) throw new HttpError(400, 'Kriterium und Dokument gehören zu unterschiedlichen Projekten');
  const existing = get(db, 'SELECT note FROM scores WHERE document_id = ? AND criterion_id = ?', input.documentId, input.criterionId);
  const note = input.note ?? existing?.note ?? '';
  run(
    db,
    `INSERT INTO scores (document_id, criterion_id, score, note) VALUES (?, ?, ?, ?)
     ON CONFLICT (document_id, criterion_id) DO UPDATE SET score = excluded.score, note = excluded.note`,
    input.documentId,
    input.criterionId,
    input.score,
    note,
  );
  touchProject(db, doc.project_id);
  return { documentId: input.documentId, criterionId: input.criterionId, score: input.score, note };
}

// ---------------------------------------------------------------- Anforderungen

const REQ_SELECT = `SELECT r.*, sp.name AS status_by_name,
  (SELECT COUNT(*) FROM comments c WHERE c.requirement_id = r.id) AS comment_count,
  (SELECT t.response FROM tasks t WHERE t.requirement_id = r.id AND t.state = 'done' AND t.rating = r.status AND t.response <> ''
     ORDER BY t.completed_at DESC LIMIT 1) AS review_comment
  FROM requirements r LEFT JOIN people sp ON sp.id = r.status_by`;

function taskBriefs(db: DB, whereSql: string, ...params: Params): Map<number, TaskBrief[]> {
  const rows = all(
    db,
    `SELECT t.id, t.requirement_id, t.assignee_id, p.name AS assignee_name, t.due_date, t.state, t.rating
     FROM tasks t JOIN people p ON p.id = t.assignee_id JOIN requirements r ON r.id = t.requirement_id
     WHERE ${whereSql} ORDER BY t.due_date IS NULL, t.due_date, t.id`,
    ...params,
  );
  const map = new Map<number, TaskBrief[]>();
  for (const r of rows) {
    const list = map.get(r.requirement_id) ?? [];
    list.push({ id: r.id, assigneeId: r.assignee_id, assigneeName: r.assignee_name, dueDate: r.due_date, state: r.state, rating: r.rating });
    map.set(r.requirement_id, list);
  }
  return map;
}

export function listRequirements(db: DB, documentId: number): Requirement[] {
  getDocumentRow(db, documentId);
  const rows = all(db, `${REQ_SELECT} WHERE r.document_id = ? ORDER BY r.position, r.id`, documentId);
  const tasks = taskBriefs(db, 'r.document_id = ?', documentId);
  return rows.map((r) => mapRequirement(r, tasks.get(r.id) ?? []));
}

function getRequirementRow(db: DB, id: number): Row {
  return get(db, `${REQ_SELECT} WHERE r.id = ?`, id) ?? notFound('Anforderung');
}

export function getRequirement(db: DB, id: number): Requirement {
  const row = getRequirementRow(db, id);
  return mapRequirement(row, taskBriefs(db, 'r.id = ?', id).get(id) ?? []);
}

export function getRequirementDetail(db: DB, id: number): RequirementDetail {
  const req = getRequirement(db, id);
  const doc = getDocumentRow(db, req.documentId);
  return {
    ...req,
    documentTitle: doc.title,
    projectId: doc.project_id,
    taskList: listTasksWhere(db, 't.requirement_id = ?', id),
    comments: all(
      db,
      `SELECT c.*, p.name AS author_name FROM comments c LEFT JOIN people p ON p.id = c.author_id
       WHERE c.requirement_id = ? ORDER BY c.created_at, c.id`,
      id,
    ).map(mapComment),
  };
}

export function createRequirements(
  db: DB,
  documentId: number,
  items: NewRequirementInput[],
  options: { replace: boolean },
): Requirement[] {
  getDocumentRow(db, documentId);
  transaction(db, () => {
    if (options.replace) run(db, 'DELETE FROM requirements WHERE document_id = ?', documentId);
    let pos = get(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM requirements WHERE document_id = ?', documentId)!.p as number;
    const stmt = db.prepare(
      'INSERT INTO requirements (document_id, position, ref, section, text, category, source_line) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const item of items) {
      stmt.run(documentId, pos++, item.ref ?? '', item.section ?? '', item.text, item.category ?? 'Allgemein', item.sourceLine ?? null);
    }
    touchProjectOfDocument(db, documentId);
  });
  return listRequirements(db, documentId);
}

export function updateRequirement(
  db: DB,
  id: number,
  patch: Partial<{ ref: string; section: string; text: string; category: string; position: number; status: ReqStatus; statusComment: string }>,
  actorId: number | null,
): Requirement {
  const row = getRequirementRow(db, id);
  transaction(db, () => {
    updateFields(db, 'requirements', id, {
      ref: patch.ref,
      section: patch.section,
      text: patch.text,
      category: patch.category,
      position: patch.position,
      status_comment: patch.statusComment,
    });
    if (patch.status !== undefined) {
      if (patch.status === 'open') {
        // Zurücksetzen: manuelle Entscheidung entfernen und ggf. Prüfergebnis übernehmen.
        run(db, 'UPDATE requirements SET status_source = NULL WHERE id = ?', id);
        recomputeStatusFromReviews(db, id);
      } else {
        run(
          db,
          `UPDATE requirements SET status = ?, status_source = 'manual', status_by = ?, status_at = ?, updated_at = ? WHERE id = ?`,
          patch.status,
          actorId,
          nowIso(),
          nowIso(),
          id,
        );
      }
    }
    touchProjectOfDocument(db, row.document_id);
  });
  return getRequirement(db, id);
}

export function bulkUpdateRequirements(
  db: DB,
  ids: number[],
  patch: { status?: ReqStatus; category?: string },
  actorId: number | null,
): void {
  transaction(db, () => {
    for (const id of ids) updateRequirement(db, id, patch, actorId);
  });
}

export function deleteRequirements(db: DB, ids: number[]): void {
  transaction(db, () => {
    for (const id of ids) {
      const row = getRequirementRow(db, id);
      run(db, 'DELETE FROM requirements WHERE id = ?', id);
      touchProjectOfDocument(db, row.document_id);
    }
  });
}

/**
 * Leitet den Status einer Anforderung aus den abgeschlossenen Prüfaufgaben ab,
 * sofern niemand manuell entschieden hat. Das kritischste Ergebnis gewinnt.
 */
export function recomputeStatusFromReviews(db: DB, requirementId: number): void {
  const req = getRequirementRow(db, requirementId);
  if (req.status_source === 'manual') return;
  const ratings = all(
    db,
    `SELECT rating, assignee_id, completed_at FROM tasks WHERE requirement_id = ? AND state = 'done' AND rating IS NOT NULL
     ORDER BY completed_at DESC`,
    requirementId,
  );
  const worst = worstRating(ratings.map((r) => r.rating as Rating));
  if (worst) {
    const decisive = ratings.find((r) => r.rating === worst)!;
    run(
      db,
      `UPDATE requirements SET status = ?, status_source = 'review', status_by = ?, status_at = ?, updated_at = ? WHERE id = ?`,
      worst,
      decisive.assignee_id,
      decisive.completed_at,
      nowIso(),
      requirementId,
    );
  } else {
    run(
      db,
      `UPDATE requirements SET status = 'open', status_source = NULL, status_by = NULL, status_at = NULL, updated_at = ? WHERE id = ?`,
      nowIso(),
      requirementId,
    );
  }
}

// ---------------------------------------------------------------- Kommentare

export function addComment(db: DB, requirementId: number, authorId: number | null, text: string): Comment {
  const req = getRequirementRow(db, requirementId);
  const id = insertId(db, 'INSERT INTO comments (requirement_id, author_id, text) VALUES (?, ?, ?)', requirementId, authorId, text);
  touchProjectOfDocument(db, req.document_id);
  const row = get(db, 'SELECT c.*, p.name AS author_name FROM comments c LEFT JOIN people p ON p.id = c.author_id WHERE c.id = ?', id)!;
  return mapComment(row);
}

export function deleteComment(db: DB, id: number): void {
  const row = get(db, 'SELECT id FROM comments WHERE id = ?', id) ?? notFound('Kommentar');
  run(db, 'DELETE FROM comments WHERE id = ?', row.id);
}

// ---------------------------------------------------------------- Aufgaben

const TASK_SELECT = `SELECT t.*, a.name AS assignee_name, b.name AS assigned_by_name,
  r.ref AS requirement_ref, r.text AS requirement_text, r.status AS requirement_status,
  d.id AS document_id, d.title AS document_title, d.doc_type, pr.id AS project_id, pr.name AS project_name
  FROM tasks t
  JOIN people a ON a.id = t.assignee_id
  LEFT JOIN people b ON b.id = t.assigned_by
  JOIN requirements r ON r.id = t.requirement_id
  JOIN documents d ON d.id = r.document_id
  JOIN projects pr ON pr.id = d.project_id`;

const TASK_ORDER = `ORDER BY t.state = 'done', t.due_date IS NULL, t.due_date, t.id`;

function listTasksWhere(db: DB, whereSql: string, ...params: Params): TaskWithContext[] {
  return all(db, `${TASK_SELECT} WHERE ${whereSql} ${TASK_ORDER}`, ...params).map(mapTaskWithContext);
}

export function listTasks(
  db: DB,
  filter: { assigneeId?: number; state?: string; projectId?: number; documentId?: number },
): TaskWithContext[] {
  const where: string[] = ['1 = 1'];
  const params: Params = [];
  if (filter.assigneeId !== undefined) {
    where.push('t.assignee_id = ?');
    params.push(filter.assigneeId);
  }
  if (filter.state) {
    where.push('t.state = ?');
    params.push(filter.state);
  }
  if (filter.projectId !== undefined) {
    where.push('pr.id = ?');
    params.push(filter.projectId);
  }
  if (filter.documentId !== undefined) {
    where.push('d.id = ?');
    params.push(filter.documentId);
  }
  return listTasksWhere(db, where.join(' AND '), ...params);
}

export function getTask(db: DB, id: number): TaskWithContext {
  return listTasksWhere(db, 't.id = ?', id)[0] ?? notFound('Aufgabe');
}

export function createTasks(
  db: DB,
  input: { requirementIds: number[]; assigneeId: number; dueDate: string | null; instruction: string },
  actorId: number | null,
): TaskWithContext[] {
  getPerson(db, input.assigneeId);
  const ids = transaction(db, () =>
    input.requirementIds.map((requirementId) => {
      const req = getRequirementRow(db, requirementId);
      const existing = get(
        db,
        `SELECT id FROM tasks WHERE requirement_id = ? AND assignee_id = ? AND state = 'open'`,
        requirementId,
        input.assigneeId,
      );
      touchProjectOfDocument(db, req.document_id);
      if (existing) {
        // Bereits offene Aufgabe für diese Person: Termin und Hinweis aktualisieren statt doppelt anzulegen.
        updateFields(db, 'tasks', existing.id, { due_date: input.dueDate, instruction: input.instruction || undefined }, false);
        return existing.id as number;
      }
      return insertId(
        db,
        'INSERT INTO tasks (requirement_id, assignee_id, due_date, instruction, assigned_by) VALUES (?, ?, ?, ?, ?)',
        requirementId,
        input.assigneeId,
        input.dueDate,
        input.instruction,
        actorId,
      );
    }),
  );
  return ids.map((id) => getTask(db, id));
}

export function updateTask(
  db: DB,
  id: number,
  patch: Partial<{ assigneeId: number; dueDate: string | null; instruction: string; state: 'open' | 'done'; rating: Rating | null; response: string }>,
): TaskWithContext {
  const task = getTask(db, id);
  if (patch.assigneeId !== undefined) getPerson(db, patch.assigneeId);
  const nextState = patch.state ?? task.state;
  const nextRating = patch.rating === undefined ? task.rating : patch.rating;
  if (nextState === 'done' && !nextRating) throw new HttpError(400, 'Zum Abschließen bitte eine Bewertung wählen');
  transaction(db, () => {
    updateFields(
      db,
      'tasks',
      id,
      {
        assignee_id: patch.assigneeId,
        due_date: patch.dueDate,
        instruction: patch.instruction,
        rating: patch.rating,
        response: patch.response,
        state: patch.state,
        completed_at: patch.state === undefined ? undefined : patch.state === 'done' ? nowIso() : null,
      },
      false,
    );
    recomputeStatusFromReviews(db, task.requirementId);
    touchProjectOfDocument(db, task.documentId);
  });
  return getTask(db, id);
}

export function deleteTask(db: DB, id: number): void {
  const task = getTask(db, id);
  transaction(db, () => {
    run(db, 'DELETE FROM tasks WHERE id = ?', id);
    recomputeStatusFromReviews(db, task.requirementId);
  });
}

// ---------------------------------------------------------------- Übersicht

export function getDashboard(db: DB, userId: number | null, today: string): DashboardData {
  const count = (sql: string, ...params: Params) => Number(get(db, sql, ...params)!.c);
  return {
    counts: {
      projects: count('SELECT COUNT(*) AS c FROM projects'),
      documents: count('SELECT COUNT(*) AS c FROM documents'),
      requirements: count('SELECT COUNT(*) AS c FROM requirements'),
      openRequirements: count(`SELECT COUNT(*) AS c FROM requirements WHERE status = 'open'`),
      openTasks: count(`SELECT COUNT(*) AS c FROM tasks WHERE state = 'open'`),
      overdueTasks: count(`SELECT COUNT(*) AS c FROM tasks WHERE state = 'open' AND due_date IS NOT NULL AND due_date < ?`, today),
    },
    myTasks: userId === null ? [] : listTasksWhere(db, `t.assignee_id = ? AND t.state = 'open'`, userId).slice(0, 8),
    recentProjects: projectSummaries(db).slice(0, 6),
  };
}
