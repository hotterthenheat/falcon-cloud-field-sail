/*
  The last good Unusual Whales answer for each path, kept in IndexedDB so a page opened again paints its last data at
  once while the fresh answer loads. Nothing here is ever shown as current: readers get the saved instant with it.
*/

export type SavedAnswer = { at: number; status: number; data: unknown };

const DB = 'slayer-uw';
const STORE = 'answers';
const MAX_ROWS = 800;
/* an answer this large is not worth the write: the option-contract walks of a whole name */
const MAX_CHARS = 1_500_000;

let opening: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE);
        s.createIndex('at', 'at');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** The saved answer for a path, or null. Never throws. */
export async function readSaved(path: string): Promise<SavedAnswer | null> {
  const d = await db();
  if (!d) return null;
  return new Promise(resolve => {
    try {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(path);
      req.onsuccess = () => resolve((req.result as SavedAnswer | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let writes = 0;
/** Keep a good answer (fire and forget; storage that is full or blocked just skips it). `at` is when the server took it
    from the vendor (x-hub-at), else now. */
export function save(path: string, status: number, data: unknown, at?: number | null): void {
  if (status !== 200 || data == null) return;
  void db().then(d => {
    if (!d) return;
    try {
      if (JSON.stringify(data).length > MAX_CHARS) return;
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ at: at ?? Date.now(), status, data } satisfies SavedAnswer, path);
      if (++writes % 50 === 0) trim(d);
    } catch {
      /* quota or a structured-clone failure: the answer is simply not kept */
    }
  });
}

function trim(d: IDBDatabase): void {
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE);
    const count = store.count();
    count.onsuccess = () => {
      let extra = count.result - MAX_ROWS;
      if (extra <= 0) return;
      const cur = store.index('at').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || extra <= 0) return;
        c.delete();
        extra -= 1;
        c.continue();
      };
    };
  } catch {
    /* trimming is best effort */
  }
}
