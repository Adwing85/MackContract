// Minimale IndexedDB-Hilfen für die Browser-Version.

const DB_NAME = 'mackcontract';
const VERSION = 1;
export const STORE_KV = 'kv';
export const STORE_FILES = 'files';

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
        if (!db.objectStoreNames.contains(STORE_FILES)) db.createObjectStore(STORE_FILES);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blockiert'));
    });
    opening.catch(() => {
      opening = null;
    });
  }
  return opening;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB-Transaktion abgebrochen'));
      }),
  );
}

export const idbGet = <T>(store: string, key: string) => run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
export const idbPut = (store: string, key: string, value: unknown) => run(store, 'readwrite', (s) => void s.put(value, key));
export const idbDelete = (store: string, key: string) => run(store, 'readwrite', (s) => void s.delete(key));
export const idbClear = (store: string) => run(store, 'readwrite', (s) => void s.clear());
export const idbKeys = (store: string) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
