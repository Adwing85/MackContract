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
  // 2: Angebotsvergleich – Konditionen, Preisspiegel, Vergabeempfehlung, automatische Kriterien
  `
  ALTER TABLE documents ADD COLUMN terms TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE projects ADD COLUMN recommendation TEXT NOT NULL DEFAULT '';
  ALTER TABLE projects ADD COLUMN recommended_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;

  CREATE TABLE criteria_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    weight REAL NOT NULL DEFAULT 5,
    kind TEXT NOT NULL DEFAULT 'manual',
    knockout INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO criteria_new (id, project_id, name, description, weight, kind, knockout, position)
    SELECT id, project_id, name, description, weight, kind, knockout, position FROM criteria;
  DROP TABLE criteria;
  ALTER TABLE criteria_new RENAME TO criteria;
  CREATE INDEX idx_criteria_project ON criteria(project_id);

  CREATE TABLE price_positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    ref TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    quantity REAL,
    unit TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_price_positions_project ON price_positions(project_id, position);

  CREATE TABLE price_entries (
    position_id INTEGER NOT NULL REFERENCES price_positions(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    price REAL,
    state TEXT NOT NULL DEFAULT 'priced' CHECK (state IN ('priced', 'included', 'not_offered')),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (position_id, document_id)
  );
  `,
  // 3: Eigene Standards (Regeln + Referenzdokumente), Standardprüfungen und Abweichungsregister
  `
  CREATE TABLE standards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE standard_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    standard_id INTEGER NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Allgemein',
    kind TEXT NOT NULL,
    metric TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL DEFAULT '',
    tolerance TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'major',
    guidance TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX idx_standard_rules ON standard_rules(standard_id, position);

  CREATE TABLE standard_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    standard_id INTEGER NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'agb',
    content TEXT NOT NULL DEFAULT '',
    file_name TEXT,
    file_path TEXT,
    file_mime TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX idx_standard_documents ON standard_documents(standard_id);

  CREATE TABLE standard_checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    standard_id INTEGER NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    checked_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
    summary TEXT NOT NULL DEFAULT '{}',
    findings TEXT NOT NULL DEFAULT '[]'
  );
  CREATE INDEX idx_standard_checks ON standard_checks(document_id, standard_id, checked_at);

  CREATE TABLE deviations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    standard_id INTEGER NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    finding_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '',
    expected TEXT NOT NULL DEFAULT '',
    actual TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '',
    source_line INTEGER,
    severity TEXT NOT NULL DEFAULT 'major',
    result TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    comment TEXT NOT NULL DEFAULT '',
    assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
    due_date TEXT,
    first_detected_at TEXT NOT NULL,
    last_checked_at TEXT NOT NULL,
    resolved_at TEXT,
    decided_by INTEGER REFERENCES people(id) ON DELETE SET NULL,
    decided_at TEXT,
    UNIQUE (document_id, standard_id, finding_key)
  );
  CREATE INDEX idx_deviations_status ON deviations(status);
  CREATE INDEX idx_deviations_assignee ON deviations(assignee_id);

  ALTER TABLE projects ADD COLUMN standard_id INTEGER REFERENCES standards(id) ON DELETE SET NULL;
  `,
];

/** Aktiviert Fremdschlüssel und bringt das Schema auf den neuesten Stand. */
export function initDb<T extends DB>(db: T, options: { wal?: boolean } = {}): T {
  if (options.wal) db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: DB): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  let version = row.user_version;
  if (version > MIGRATIONS.length) throw new Error('Die Datenbank stammt aus einer neueren Programmversion');
  if (version === MIGRATIONS.length) return;
  // Tabellen werden teils neu aufgebaut – Fremdschlüssel währenddessen aus, danach prüfen.
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    while (version < MIGRATIONS.length) {
      transaction(db, () => {
        db.exec(MIGRATIONS[version]);
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length) throw new Error(`Fremdschlüsselfehler nach Migration ${version + 1}`);
        db.exec(`PRAGMA user_version = ${version + 1}`);
      });
      version++;
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

/** Nur für Tests: Schema bis zu einer bestimmten Version anlegen. */
export function migrateTo(db: DB, target: number): void {
  db.exec('PRAGMA foreign_keys = OFF;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < target; v++) {
    db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v + 1}`);
  }
  db.exec('PRAGMA foreign_keys = ON;');
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
