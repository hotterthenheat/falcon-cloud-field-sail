/* The app's own data paths, as this browser has heard them: every read the quote client (data/theta.ts) and the flow
   client (data/whales.ts) make reports here what came back, so the status page and the outage banner say what the
   reads themselves said, never a guess. Nothing here asks anything; it only remembers.

   - `quotes`: the live-quote path (/api/theta → the market data terminal). Up on any answer the terminal gave (data or
     "no data for this"); down on the terminal-down codes the client already treats as an outage.
   - `flow`:   the options flow, dealer book and record path (/api/uw). Up on a 200; down on a gateway fault, a refusal
     of the key's rate, or no answer.
   - `server`: the app's own server. Up on ANY HTTP answer from /api (even a 503 says the server is there); down only
     when the request never got an answer at all.
   A refusal by the app's own gate (signed out, no plan) is `refused`: the path is not down, it is closed to this reader. */

import { useSyncExternalStore } from 'react';

export type PathId = 'quotes' | 'flow' | 'server';
export type PathCondition = 'unknown' | 'up' | 'down' | 'refused';

export interface PathRead {
  condition: PathCondition;
  /** the last good answer (epoch ms), 0 before any */
  okAt: number;
  /** when the answer on hand was taken at its source, if the server said (the hub's stamp), else null */
  dataAt: number | null;
  /** the last failed answer, 0 before any */
  failAt: number;
  /** since when the path has failed without a good answer between, 0 while it answers */
  failSince: number;
  /** what the last failure was, in the app's own words (never a vendor sentence) */
  why: string;
  /** the quotes path is down because the terminal's login was refused */
  login: boolean;
}

const blank = (): PathRead => ({ condition: 'unknown', okAt: 0, dataAt: null, failAt: 0, failSince: 0, why: '', login: false });

let reads: Record<PathId, PathRead> = { quotes: blank(), flow: blank(), server: blank() };
const subs = new Set<() => void>();
const emit = () => subs.forEach(fn => fn());

/* a good answer every few seconds would re-render every reader; the state is re-published at most once a second
   unless the condition itself changed */
const lastEmit: Record<PathId, number> = { quotes: 0, flow: 0, server: 0 };
const put = (id: PathId, next: PathRead, now: number) => {
  const changed = next.condition !== reads[id].condition || next.login !== reads[id].login;
  reads = { ...reads, [id]: next };
  if (changed || now - lastEmit[id] >= 1000) {
    lastEmit[id] = now;
    emit();
  }
};

/** A good answer on a path; `dataAt` is when its source took it, when the server said. */
export function notePathUp(id: PathId, dataAt: number | null = null, now = Date.now()): void {
  const r = reads[id];
  put(id, { ...r, condition: 'up', okAt: now, dataAt: dataAt ?? r.dataAt, failSince: 0, login: false }, now);
}

/** A failed answer: down (an outage) or refused (the app's gate closed to this reader). */
export function notePathDown(id: PathId, why: string, opts: { refused?: boolean; login?: boolean } = {}, now = Date.now()): void {
  const r = reads[id];
  const condition: PathCondition = opts.refused ? 'refused' : 'down';
  put(id, { ...r, condition, failAt: now, failSince: r.failSince || now, why, login: !!opts.login }, now);
}

export const pathReads = (): Record<PathId, PathRead> => reads;

export function subscribePaths(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** Every path, re-rendering when one changes (at most once a second while they answer). */
export const usePathReads = (): Record<PathId, PathRead> => useSyncExternalStore(subscribePaths, pathReads, pathReads);

/** For the proof: start over. */
export function resetPathReads(): void {
  reads = { quotes: blank(), flow: blank(), server: blank() };
  emit();
}
