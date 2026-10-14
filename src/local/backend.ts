// Browser-Backend der eigenständigen HTML-Version: SQLite (sql.js) im Browser,
// gespeichert in IndexedDB. Nutzt dieselben Routen und Datenzugriffe wie der Server.

import initSqlJs, { type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { initDb } from '../../server/db';
import { createRoutes, type FileStore, type Route } from '../../server/routes';
import * as store from '../../server/store';
import { HttpError } from '../../server/store';
import { ApiError } from '../apiError';
import { dispatch } from './dispatch';
import { idbClear, idbDelete, idbGet, idbKeys, idbPut, STORE_FILES, STORE_KV } from './idb';
import { SqlJsAdapter } from './sqljs';

interface StoredFile {
  data: Uint8Array;
  mime: string;
}

interface Backend {
  db: SqlJsAdapter;
  routes: Route[];
}

const DB_KEY = 'database';
const BACKUP_FORMAT = 'mackcontract-backup';

let sqlModule: Promise<SqlJsStatic> | null = null;
let backend: Promise<Backend> | null = null;
let persistent = true;
const memoryFiles = new Map<string, StoredFile>();
const listeners = new Set<(persistent: boolean) => void>();

// ------------------------------------------------------------------ Hilfen

function decodeBase64(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeBase64(data: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function loadBinary(url: string): Promise<ArrayBuffer> {
  if (url.startsWith('data:')) {
    const bytes = decodeBase64(url.slice(url.indexOf(',') + 1));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return (await fetch(url)).arrayBuffer();
}

function newFileKey(ext: string): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${id}${ext}`;
}

function setPersistent(value: boolean) {
  if (persistent === value) return;
  persistent = value;
  listeners.forEach((l) => l(value));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ------------------------------------------------------------------ Speicher

const fileStore: FileStore = {
  async save(key, data, mime) {
    memoryFiles.set(key, { data, mime });
    if (!persistent) return;
    try {
      await idbPut(STORE_FILES, key, { data, mime });
      memoryFiles.delete(key);
    } catch {
      setPersistent(false);
    }
  },
  async remove(key) {
    memoryFiles.delete(key);
    if (persistent) await idbDelete(STORE_FILES, key).catch(() => undefined);
  },
};

async function readFile(key: string): Promise<StoredFile | undefined> {
  const mem = memoryFiles.get(key);
  if (mem) return mem;
  if (!persistent) return undefined;
  return idbGet<StoredFile>(STORE_FILES, key).catch(() => undefined);
}

async function persist(db: SqlJsAdapter): Promise<void> {
  if (!persistent) return;
  try {
    await idbPut(STORE_KV, DB_KEY, db.export());
  } catch {
    setPersistent(false);
  }
}

function sql(): Promise<SqlJsStatic> {
  if (!sqlModule) sqlModule = loadBinary(wasmUrl).then((wasmBinary) => initSqlJs({ wasmBinary }));
  return sqlModule;
}

async function createBackend(): Promise<Backend> {
  const SQL = await sql();
  let saved: Uint8Array | undefined;
  try {
    saved = await idbGet<Uint8Array>(STORE_KV, DB_KEY);
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    setPersistent(false);
  }
  const db = new SqlJsAdapter(saved ? new SQL.Database(saved) : new SQL.Database());
  initDb(db);
  return { db, routes: createRoutes(db, fileStore, newFileKey) };
}

function getBackend(): Promise<Backend> {
  if (!backend) {
    backend = createBackend();
    backend.catch(() => {
      backend = null;
    });
  }
  return backend;
}

// Anfragen nacheinander abarbeiten, damit Speichern und Ändern sich nicht überschneiden.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn, fn);
  queue = task.catch(() => undefined);
  return task;
}

// ------------------------------------------------------------------ Öffentliche Schnittstelle

export function localRequest(method: string, url: string, body: unknown, userId: number | null): Promise<unknown> {
  return enqueue(async () => {
    const { db, routes } = await getBackend();
    try {
      return await dispatch(routes, db, method, url, body, userId);
    } finally {
      if (method !== 'GET') await persist(db);
    }
  });
}

export function isPersistent(): boolean {
  return persistent;
}

export function onPersistenceChange(listener: (persistent: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openLocalFile(documentId: number): Promise<void> {
  return enqueue(async () => {
    const { db } = await getBackend();
    let info: { path: string; name: string };
    try {
      info = store.getDocumentFile(db, documentId);
    } catch (err) {
      throw err instanceof HttpError ? new ApiError(err.status, err.message) : err;
    }
    const file = await readFile(info.path);
    if (!file) throw new ApiError(404, 'Die Originaldatei ist in diesem Browser nicht vorhanden');
    const isPdf = /\.pdf$/i.test(info.name);
    const blob = new Blob([file.data as BlobPart], { type: isPdf ? 'application/pdf' : 'application/octet-stream' });
    if (isPdf) {
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank');
      if (!win) downloadBlob(blob, info.name);
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } else downloadBlob(blob, info.name);
  });
}

/** Speichert Datenbank und Originaldateien als eine JSON-Sicherungsdatei. */
export function exportBackup(): Promise<void> {
  return enqueue(async () => {
    const { db } = await getBackend();
    const keys = new Set<string>(memoryFiles.keys());
    if (persistent) for (const k of (await idbKeys(STORE_FILES).catch(() => [])) ?? []) keys.add(String(k));
    const files: Array<{ key: string; mime: string; data: string }> = [];
    for (const key of keys) {
      const f = await readFile(key);
      if (f) files.push({ key, mime: f.mime, data: encodeBase64(f.data) });
    }
    const backup = {
      format: BACKUP_FORMAT,
      version: 1,
      createdAt: new Date().toISOString(),
      database: encodeBase64(db.export()),
      files,
    };
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    downloadBlob(new Blob([JSON.stringify(backup)], { type: 'application/json' }), `MackContract-Sicherung-${stamp}.json`);
  });
}

function isSqliteFile(bytes: Uint8Array): boolean {
  const header = 'SQLite format 3\u0000';
  if (bytes.length < header.length) return false;
  for (let i = 0; i < header.length; i++) if (bytes[i] !== header.charCodeAt(i)) return false;
  return true;
}

async function replaceData(dbBytes: Uint8Array | null, files: Array<{ key: string; mime: string; data: Uint8Array }>) {
  const SQL = await sql();
  const next = new SqlJsAdapter(dbBytes ? new SQL.Database(dbBytes) : new SQL.Database());
  try {
    initDb(next);
    store.listProjects(next);
  } catch {
    next.close();
    throw new ApiError(400, 'Die Datei ist keine gültige MackContract-Sicherung');
  }
  const current = await getBackend();
  current.db.close();
  backend = Promise.resolve({ db: next, routes: createRoutes(next, fileStore, newFileKey) });
  memoryFiles.clear();
  if (persistent) await idbClear(STORE_FILES).catch(() => undefined);
  for (const f of files) await fileStore.save(f.key, f.data, f.mime);
  await persist(next);
  return next;
}

/**
 * Lädt eine Sicherung (JSON aus dieser App) oder eine Datenbankdatei der Server-Version
 * (mackcontract.db) und ersetzt damit alle Daten in diesem Browser.
 */
export function importBackup(file: File): Promise<{ projects: number }> {
  return enqueue(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let dbBytes: Uint8Array;
    let files: Array<{ key: string; mime: string; data: Uint8Array }> = [];
    if (isSqliteFile(bytes)) dbBytes = bytes;
    else {
      let parsed: { format?: string; database?: string; files?: Array<{ key: string; mime: string; data: string }> };
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        throw new ApiError(400, 'Die Datei ist keine gültige MackContract-Sicherung');
      }
      if (parsed.format !== BACKUP_FORMAT || typeof parsed.database !== 'string') {
        throw new ApiError(400, 'Die Datei ist keine gültige MackContract-Sicherung');
      }
      dbBytes = decodeBase64(parsed.database);
      files = (parsed.files ?? []).map((f) => ({ key: f.key, mime: f.mime, data: decodeBase64(f.data) }));
    }
    const db = await replaceData(dbBytes, files);
    return { projects: store.listProjects(db).length };
  });
}

/** Löscht alle Daten dieser Browser-Version. */
export function resetLocalData(): Promise<void> {
  return enqueue(async () => {
    await replaceData(null, []);
  });
}
