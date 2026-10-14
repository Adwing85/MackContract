// Umgebungsunabhängiges Schema und Hilfsfunktionen. Die konkrete SQLite-Anbindung
// liefert server/sqlite-node.ts (node:sqlite) bzw. src/local/sqljs.ts (sql.js im Browser).

export type SQLValue = null | number | bigint | string | Uint8Array;

export interface Statement {
  run(...params: SQLValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SQLValue[]): unknown;
  all(...params: SQLValue[]): unknown[];
}

export interface DB {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL CHECK (doc_type IN ('contract', 'offer', 'order_confirmation', 'other')),
    counterparty TEXT NOT NULL DEFAULT '',
    doc_date TEXT,
    reference TEXT NOT NULL DEFAULT '',
    amount REAL,
    currency TEXT NOT NULL DEFAULT 'EUR',
    content TEXT NOT NULL DEFAULT '',
    file_name TEXT,
    file_path TEXT,
    file_mime TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_documents_project ON documents(project_id);

  CREATE TABLE criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    weight REAL NOT NULL DEFAULT 5,
    kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'requirements')),
    knockout INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX idx_criteria_project ON criteria(project_id);

  CREATE TABLE scores (
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    score REAL,
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (document_id, criterion_id)
  );

  CREATE TABLE requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    ref TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Allgemein',
    source_line INTEGER,
    status TEXT NOT NULL DEFAULT 'open'
      CHECK (status IN ('open', 'accepted', 'accepted_with_comments', 'declined')),
    status_comment TEXT NOT NULL DEFAULT '',
    status_source TEXT CHECK (status_source IN ('manual', 'review')),
    status_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
    status_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_requirements_document ON requirements(document_id, position);

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    assignee_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    due_date TEXT,
    instruction TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done')),
    rating TEXT CHECK (rating IN ('accepted', 'accepted_with_comments', 'declined')),
    response TEXT NOT NULL DEFAULT '',
    assigned_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    completed_at TEXT
  );
  CREATE INDEX idx_tasks_requirement ON tasks(requirement_id);
  CREATE INDEX idx_tasks_assignee ON tasks(assignee_id, state);

  CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requirement_id INTEGER NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
    author_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_comments_requirement ON comments(requirement_id);
  `,
];

/** Aktiviert Fremdschlüssel und bringt das Schema auf den neuesten Stand. */
export function initDb<T extends DB>(db: T, options: { wal?: boolean } = {}): T {
  db.exec('PRAGMA foreign_keys = ON;');
  if (options.wal) db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  while (version < MIGRATIONS.length) {
    transaction(db, () => {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    });
    version++;
  }
}

let savepointCounter = 0;

/** Verschachtelbare Transaktion über SAVEPOINTs. */
export function transaction<T>(db: DB, fn: () => T): T {
  const name = `sp_${++savepointCounter}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
