/* The wind field's pool: the chart asks for a field, the worker runs it (core/windWorker.ts), the chart hears it land.
   Latest wins per key: an older ask's answer is kept in the cache (it is true for its own signature) but not handed
   back. Answers are kept by signature (name, minute, spot step, σ, book revision), so a repaint on the same book costs
   nothing. Without workers (a test) the field runs on the calling thread. */
import { runWind, type WindField, type WindInputs } from './windField';
import type { WindAsk, WindReply } from './windWorker';

const CACHE_MAX = 48;
const cache = new Map<string, WindField>();
let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, { key: string; sig: string; resolve: (f: WindField | null) => void }>();
const latest = new Map<string, number>();

const ensureWorker = (): Worker | null => {
  if (broken) return null;
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof window === 'undefined') {
    broken = true;
    return null;
  }
  try {
    worker = new Worker(new URL('./windWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    broken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<WindReply>) => {
    const { id, field } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    remember(p.sig, field);
    p.resolve(latest.get(p.key) === id ? field : null);
  };
  worker.onerror = () => {
    /* a worker that cannot run leaves the field off — it never falls back to blocking the page */
    broken = true;
    const stale = [...pending.values()];
    pending.clear();
    for (const p of stale) p.resolve(null);
  };
  return worker;
};

const remember = (sig: string, field: WindField): void => {
  cache.set(sig, field);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
};

/** The field for these inputs — from memory when this signature ran before, else from the worker; null when a newer
    ask for the same key superseded it or no worker can run */
export function askWind(key: string, signature: string, inputs: WindInputs): Promise<WindField | null> {
  const sig = `${key}|${signature}`;
  const hit = cache.get(sig);
  if (hit) return Promise.resolve(hit);
  const w = ensureWorker();
  if (!w) {
    /* no Worker at all (node, a test): the run is the caller's own */
    if (typeof window !== 'undefined') return Promise.resolve(null);
    const field = runWind(inputs);
    remember(sig, field);
    return Promise.resolve(field);
  }
  const id = nextId++;
  latest.set(key, id);
  return new Promise(resolve => {
    pending.set(id, { key, sig, resolve });
    const ask: WindAsk = { id, inputs };
    w.postMessage(ask);
  });
}
