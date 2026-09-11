// Storage wrappers (plan §14.1): IndexedDB for saves (one record per character, single
// transaction per write), localStorage for settings and bindings. Everything is wrapped so a
// blocked or missing storage never throws into game code.
const DB_NAME = 'solitude-springs';
const DB_VERSION = 1;
const STORE = 'saves';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

/** Raw records as stored; validation happens in sim/save. */
export interface StoredSave {
  id: string;
  /** The JSON text of the save (kept as text so a damaged record can still be exported). */
  json: string;
  savedAt: string;
}

export async function listStoredSaves(): Promise<StoredSave[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const all = (await request(tx.objectStore(STORE).getAll())) as unknown[];
  return all
    .filter((r): r is StoredSave => typeof r === 'object' && r !== null && typeof (r as StoredSave).id === 'string' && typeof (r as StoredSave).json === 'string')
    .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
}

export async function getStoredSave(id: string): Promise<StoredSave | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const r = (await request(tx.objectStore(STORE).get(id))) as StoredSave | undefined;
  return r ?? null;
}

/** One transaction: a crash mid-write can't corrupt the previous record (§14.5). */
export async function putStoredSave(record: StoredSave): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    tx.objectStore(STORE).put(record);
  });
}

export async function deleteStoredSave(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
    tx.objectStore(STORE).delete(id);
  });
}

// ---- localStorage (settings, bindings) -------------------------------------------------------
const PREFIX = 'solitude-springs:';

export function readLocal<T>(key: string, validate: (v: unknown) => T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return validate(raw === null ? undefined : JSON.parse(raw));
  } catch {
    return validate(undefined);
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage may be full or blocked: settings just don't persist */
  }
}
