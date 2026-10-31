/* Which book the desk's levels read: the open-interest book (yesterday's open interest — the default), or the flow book
   (open interest plus today's signed volume) that the exposure field's "Open interest / Flow" toggle draws
   (data/book/scale.ts stampFlow, StrikeNode.flow). One toggle for the field, the walls, the flip, the regime and the
   Terrain strike rail, kept in this browser.

   With the toggle on Open interest every function here hands back what it was given — the same objects — so nothing
   downstream can change. On Flow a node's gex, dex, vex, vanna and charm legs are its flow figures (a held strike's flow
   figures ARE its open-interest figures); a chain that is a sum of dates (the whole book, a scope) adds each date's
   flow-minus-open-interest per strike to its own rows, so the dates it carries without a loaded chain stay as they are. */

import { useSyncExternalStore } from 'react';
import { bookToday, isoDate } from '../core/calendar';
import { expiryOpen } from '../core/tradingYear';
import { registerChainDates, registeredDates } from './chainDates';
import type { MarketSnapshot, StrikeNode } from '../types/market';

export type BookMode = 'oi' | 'flow';

/** The two books' names wherever a reader sees them — the chart's key, the rail's toggle, the cards and the guides. They
    say what each book shows, never how it is made: Live is the book as the session trades, Settled the book as of the
    last close. One constant for every label. */
export const BOOK_MODE_WORDS: Record<BookMode, { label: string; line: string }> = {
  flow: { label: 'Live', line: 'The book as the session trades' },
  oi: { label: 'Settled', line: 'The book as of the last close' },
};

const KEY = 'slayer_book_mode_v1';
const listeners = new Set<() => void>();
const read = (): BookMode => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'flow' ? 'flow' : 'oi';
  } catch {
    return 'oi';
  }
};
let mode: BookMode = read();

export const bookMode = (): BookMode => mode;

export function setBookMode(next: BookMode): void {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* the choice still holds for this page */
  }
  listeners.forEach(fn => fn());
}

export function subscribeBookMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBookMode(): BookMode {
  return useSyncExternalStore(subscribeBookMode, bookMode, bookMode);
}

/* ---- the flow book ---- */

type Legs = { call: number; put: number };
const LEGS = [
  ['gex', 'callGex', 'putGex', 'netGex'],
  ['dex', 'callDex', 'putDex', 'netDex'],
  ['vex', 'callVex', 'putVex', 'netVex'],
  ['vanna', 'callVanna', 'putVanna', 'netVanna'],
  ['charm', 'callCharm', 'putCharm', 'netCharm'],
] as const;

/** One strike in the flow book: its flow legs where it carries them, else itself (the same object). */
export function flowNode(n: StrikeNode): StrikeNode {
  const f = n.flow;
  if (!f) return n;
  let same = true;
  for (const [g, c, p] of LEGS) {
    const l = f[g] as Legs;
    if (l.call !== n[c] || l.put !== n[p]) same = false;
  }
  if (same) return n;
  const out: StrikeNode = { ...n };
  for (const [g, c, p, net] of LEGS) {
    const l = f[g] as Legs;
    out[c] = l.call;
    out[p] = l.put;
    out[net] = l.call + l.put;
  }
  return out;
}

/** Per strike, what the flow book adds to the open-interest book on these date chains */
function flowGaps(chains: readonly (readonly StrikeNode[])[]): Map<number, StrikeNode> | null {
  let gaps: Map<number, StrikeNode> | null = null;
  for (const chain of chains) {
    for (const n of chain) {
      const f = flowNode(n);
      if (f === n) continue;
      gaps ??= new Map();
      const cur = gaps.get(n.strike) ?? ({ strike: n.strike } as StrikeNode);
      for (const [, c, p, net] of LEGS) {
        cur[c] = (cur[c] ?? 0) + (f[c] - n[c]);
        cur[p] = (cur[p] ?? 0) + (f[p] - n[p]);
        cur[net] = (cur[net] ?? 0) + (f[net] - n[net]);
      }
      gaps.set(n.strike, cur);
    }
  }
  return gaps;
}

/* one flow chain per (chain, date chains it sums), kept while neither moves */
const sums = new WeakMap<readonly StrikeNode[], { parts: readonly (readonly StrikeNode[])[] | null; out: StrikeNode[] }>();
const sameParts = (a: readonly (readonly StrikeNode[])[] | null, b: readonly (readonly StrikeNode[])[] | null): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((p, i) => p === b[i]));

/** A chain in the flow book. `dates` are the expiry chains it is the sum of (itself, for one date); without them the
    chain's own nodes are read. The same array back when the flow book does not differ from it. */
export function flowChainOf(chain: StrikeNode[], parts?: readonly (readonly StrikeNode[])[], dates?: string[] | 'ALL'): StrikeNode[] {
  const hit = sums.get(chain);
  if (hit && sameParts(hit.parts, parts ?? null)) return hit.out;
  let out: StrikeNode[];
  if (!parts || (parts.length === 1 && parts[0] === chain)) {
    const mapped = chain.map(flowNode);
    out = mapped.some((n, i) => n !== chain[i]) ? mapped : chain;
  } else {
    const gaps = flowGaps(parts);
    if (!gaps) out = chain;
    else {
      out = chain.map(n => {
        const g = gaps.get(n.strike);
        if (!g) return n;
        const m: StrikeNode = { ...n };
        for (const [, c, p, net] of LEGS) {
          m[c] = n[c] + g[c];
          m[p] = n[p] + g[p];
          m[net] = n[net] + g[net];
        }
        return m;
      });
    }
  }
  /* the flip re-prices a chain by the dates it is (data/chainDates.ts): the flow chain is the same dates */
  const reg = dates ?? registeredDates(chain);
  if (out !== chain && reg) registerChainDates(out, reg);
  sums.set(chain, { parts: parts ?? null, out });
  return out;
}

/** The dates the whole live book holds: today's and later, still open (book/levels.ts liveAll takes the settled off) */
const liveDates = (by: Record<string, StrikeNode[]>): string[] => {
  const floor = isoDate(bookToday());
  return Object.keys(by).filter(d => d >= floor && expiryOpen(d) && by[d]?.length);
};

/** A chain of a name's book in the flow book, reading its dates off the book's per-date rows `by`. */
export function flowChainIn(chain: StrikeNode[], by: Record<string, StrikeNode[]> | undefined, allChain?: readonly StrikeNode[]): StrikeNode[] {
  if (!by) return flowChainOf(chain);
  for (const d of Object.keys(by)) if (by[d] === chain) return flowChainOf(chain, [chain], [d]);
  const reg = registeredDates(chain) ?? (allChain && chain === allChain ? 'ALL' : undefined);
  if (!reg) return flowChainOf(chain);
  const dates = reg === 'ALL' ? liveDates(by) : reg.filter(d => by[d]?.length);
  return flowChainOf(chain, dates.map(d => by[d]), reg);
}

/** The chain in the mode asked: on Open interest the chain itself. */
export const chainInMode = (chain: StrikeNode[], by: Record<string, StrikeNode[]> | undefined, m: BookMode = mode, allChain?: readonly StrikeNode[]): StrikeNode[] =>
  m === 'flow' ? flowChainIn(chain, by, allChain) : chain;

const snaps = new WeakMap<MarketSnapshot, MarketSnapshot>();

/** A name's snapshot in the mode asked: its chain, its scope chains and its per-date rows in the flow book, the identities
    between them kept (a scope chain that is a date's rows stays that date's flow rows). On Open interest — or when the
    flow book does not differ — the snapshot itself. */
export function bookInMode(snapshot: MarketSnapshot, m: BookMode = mode): MarketSnapshot {
  if (m !== 'flow') return snapshot;
  const hit = snaps.get(snapshot);
  if (hit) return hit;
  const by = snapshot.uwByDate;
  const all = snapshot.uwChains?.ALL;
  let changed = false;
  let byOut: Record<string, StrikeNode[]> | undefined;
  if (by) {
    byOut = {};
    for (const d of Object.keys(by)) {
      byOut[d] = flowChainOf(by[d], [by[d]], [d]);
      if (byOut[d] !== by[d]) changed = true;
    }
  }
  const conv = (c: StrikeNode[]): StrikeNode[] => {
    if (by && byOut) for (const d of Object.keys(by)) if (by[d] === c) return byOut[d];
    const out = flowChainIn(c, by, all);
    if (out !== c) changed = true;
    return out;
  };
  const chains = snapshot.uwChains ? Object.fromEntries(Object.entries(snapshot.uwChains).map(([k, c]) => [k, c ? conv(c) : c])) : undefined;
  const chain = conv(snapshot.chain);
  const out = changed ? { ...snapshot, chain, ...(chains ? { uwChains: chains } : {}), ...(byOut ? { uwByDate: byOut } : {}) } : snapshot;
  snaps.set(snapshot, out);
  return out;
}
