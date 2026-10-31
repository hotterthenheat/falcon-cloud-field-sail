/*
  ONE CHAIN STORE, keyed by (root, expiry) (audit D10, 2026-10-31). The Weigher's chain (data/weigherDesk.ts
  loadLiveChain and readLegs), the warm-up's copy of it (data/warmData.ts) and Paper's desk (data/paper/thetaFeed.ts)
  each read an expiry's NBBO and greeks on their own — Paper the whole expiry every two seconds. Every one of those reads
  now comes here: a reader says how many strikes either side of the money it needs (`range`; null for the whole expiry)
  and how old a copy it takes, and a read in flight or held that covers it — the same strikes or more, young enough —
  answers it instead of a request of its own.
*/

import { thetaGet, type ThetaAnswer } from './thetaFeed';

export type ChainPart = 'quote' | 'greeks';

interface Read {
  /** Strikes either side of the money; Infinity for the whole expiry */
  range: number;
  /** When it answered (0 while in flight) */
  at: number;
  p: Promise<ThetaAnswer>;
}

/** A read held this long at most, whoever asks */
const KEEP_MS = 60_000;
const reads = new Map<string, Read[]>();
const keyOf = (part: ChainPart, root: string, expiration: string) => `${part}|${root.trim().toUpperCase()}|${expiration.replace(/-/g, '')}`;

const pathOf = (part: ChainPart, root: string, expiration: string, range: number): string =>
  `/option/snapshot/${part === 'quote' ? 'quote' : 'greeks/first_order'}?symbol=${encodeURIComponent(root.trim().toUpperCase())}&expiration=${expiration.replace(/-/g, '')}&right=both${Number.isFinite(range) ? `&strike_range=${range}` : ''}&format=json`;

/** An expiry's NBBO (`quote`) or greeks snapshot: a held or in-flight read that covers `range` strikes (null: the whole
    expiry) and is younger than `maxAgeMs`, else a new read. */
export function chainSnapshot(part: ChainPart, root: string, expiration: string, range: number | null, maxAgeMs: number, jump = true): Promise<ThetaAnswer> {
  const want = range == null ? Infinity : range;
  const key = keyOf(part, root, expiration);
  const now = Date.now();
  const list = (reads.get(key) ?? []).filter(r => r.at === 0 || now - r.at < KEEP_MS);
  const fit = list.filter(r => r.range >= want && (r.at === 0 || now - r.at < maxAgeMs)).sort((a, b) => (b.at || Infinity) - (a.at || Infinity))[0];
  if (fit) {
    reads.set(key, list);
    return fit.p;
  }
  const read: Read = { range: want, at: 0, p: thetaGet(pathOf(part, root, expiration, want), jump) };
  list.push(read);
  reads.set(key, list);
  void read.p.then(a => {
    if (a.error) {
      const cur = reads.get(key);
      if (cur) reads.set(key, cur.filter(r => r !== read));
    } else read.at = Date.now();
  });
  if (reads.size > 200) for (const [k, v] of reads) if (v.every(r => r.at && Date.now() - r.at > KEEP_MS)) reads.delete(k);
  return read.p;
}

/** A quote read of the expiry covering `range` strikes answered within `maxAgeMs` (a warm-up need not read it again) */
export function chainHeld(root: string, expiration: string, range: number | null, maxAgeMs: number): boolean {
  const want = range == null ? Infinity : range;
  return (reads.get(keyOf('quote', root, expiration)) ?? []).some(r => r.at > 0 && r.range >= want && Date.now() - r.at < maxAgeMs);
}
