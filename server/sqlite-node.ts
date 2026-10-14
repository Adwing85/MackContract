import { DatabaseSync } from 'node:sqlite';
import { initDb, type DB } from './db';

/** Öffnet die SQLite-Datei über das in Node.js eingebaute Modul node:sqlite. */
export function openDb(file: string): DB {
  return initDb(new DatabaseSync(file), { wal: file !== ':memory:' });
}
