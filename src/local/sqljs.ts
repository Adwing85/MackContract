import type { Database, SqlValue } from 'sql.js';
import type { DB, SQLValue, Statement } from '../../server/db';

const toSql = (params: SQLValue[]): SqlValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'bigint' ? Number(p) : p)) as SqlValue[];

/** Stellt eine sql.js-Datenbank mit derselben Schnittstelle wie node:sqlite bereit. */
export class SqlJsAdapter implements DB {
  constructor(public raw: Database) {}

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  prepare(sql: string): Statement {
    const raw = this.raw;
    return {
      run: (...params) => {
        const stmt = raw.prepare(sql);
        try {
          stmt.run(toSql(params));
        } finally {
          stmt.free();
        }
        const changes = raw.getRowsModified();
        const id = raw.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0;
        return { changes, lastInsertRowid: Number(id) };
      },
      get: (...params) => {
        const stmt = raw.prepare(sql);
        try {
          stmt.bind(toSql(params));
          return stmt.step() ? stmt.getAsObject() : undefined;
        } finally {
          stmt.free();
        }
      },
      all: (...params) => {
        const stmt = raw.prepare(sql);
        try {
          stmt.bind(toSql(params));
          const rows: unknown[] = [];
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
        }
      },
    };
  }

  /** Exportiert die Datenbank. sql.js öffnet sie dabei neu, daher Pragmas erneut setzen. */
  export(): Uint8Array {
    const data = this.raw.export();
    this.raw.exec('PRAGMA foreign_keys = ON;');
    return data;
  }

  close(): void {
    this.raw.close();
  }
}
