/* Repeat-buyer (repeat-seller) detection: one contract hit again and again on one side, in similar size, within
   minutes — the shape of a single participant working an order through the tape.

   DEFINITIONS (every threshold is a named constant below)

   Eligible print: flowRolls' sidedFill — ASK or BID, not a cross / compression / floor-package leg / extended-hours
   print, size > 0, timed — counted once by printKey, none the caller says was cancelled. Also left out: legs of a
   multi-leg order (FlowPrint.legs > 1: half a structure, not an order on its own) and the caller's `exclude` keys
   (pass a RollRead's excludeIds so a roll's legs are not also a "repeat").

   Hit: the prints on one contract and one side that follow each other within REPEAT_BURST_MS (250 ms) — order
   units (flowRolls.orderUnits: one millisecond) chained while each starts at most 250 ms after the last one's fill,
   sizes added. A sweep split over five exchanges, or one order filling over 8 ms (NVDA 210C 12/18, 2026-10-30
   13:57:57.996–.004: 76 + 13 + 17 + 16 lots), is one hit, not several. A hit under REPEAT_MIN_SIZE (10) contracts
   (after chaining) is not counted: 1- and 2-lots on a liquid contract run all day from many hands (SPY's 0DTE puts:
   300 one-lot lifts in two hours).

   Cluster (kind 'contract'): the hits of one contract and one side, in time order, such that
     (1) each hit is at most REPEAT_GAP_MS (10 min) after the one before it;
     (2) every hit's size is within ±REPEAT_SIZE_TOL (30%) of the cluster's median hit size
         (median of an even count = mean of the middle two);
     (3) there are at least REPEAT_MIN_HITS (3) hits.
   Built by: split the time-ordered hits wherever a gap exceeds 10 min; in each run take the median size and drop
   the hits off ±30% of it; if any dropped, split the rest by the gap again and repeat (the set only shrinks, so this
   ends); a run that keeps all its hits and has ≥ 3 is a cluster.

   Strip (kind 'strip'): the same rule over hits of one ticker, right, strike and side across expiries, kept only when
   its hits span ≥ 2 expiries and those expiries are consecutive among the expiries the input shows for that ticker
   (the listed chain as far as the tape reveals it). A strip can share hits with a contract cluster; the two lists
   are reported apart and never added together.

   Figures: totalSize and totalPremium sum the cluster's prints; firstTs / lastTs are its first and last hit (epoch
   ms); avgFillPos is the size-weighted mean of the prints' fillPos (0 at the bid, 1 at the ask); sweepShare is the
   swept contracts over all its contracts (0–1). */

import type { FlowPrint } from '../types/trace';
import { dedupePrints, expiryIsoOf, orderUnits, printKey, type OrderUnit } from './flowRolls';

export const REPEAT_MIN_HITS = 3;
export const REPEAT_GAP_MS = 10 * 60_000;
export const REPEAT_SIZE_TOL = 0.3;
export const REPEAT_MIN_SIZE = 10;
export const REPEAT_BURST_MS = 250;

/** Units of one contract and side chained into hits: a unit within `burstMs` of the previous one's last fill joins it */
export function burstHits(units: readonly OrderUnit[], burstMs = REPEAT_BURST_MS): OrderUnit[] {
  const by = new Map<string, OrderUnit[]>();
  for (const u of units) {
    const k = `${u.contract}|${u.side}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(u);
  }
  const out: OrderUnit[] = [];
  for (const list of by.values()) {
    list.sort((a, b) => a.ts - b.ts || (a.key < b.key ? -1 : 1));
    let cur: OrderUnit | null = null;
    let last = 0;
    for (const u of list) {
      if (cur && u.ts - last <= burstMs) {
        cur.size += u.size;
        cur.premium += u.premium;
        cur.oi = Math.max(cur.oi, u.oi);
        cur.volume = Math.max(cur.volume, u.volume);
        cur.printIds.push(...u.printIds);
        cur.prints.push(...u.prints);
      } else {
        cur = { ...u, printIds: [...u.printIds], prints: [...u.prints] };
        out.push(cur);
      }
      last = u.ts;
    }
  }
  return out.sort((a, b) => a.ts - b.ts || (a.key < b.key ? -1 : 1));
}

export interface RepeatCluster {
  kind: 'contract' | 'strip';
  key: string;
  ticker: string;
  right: 'C' | 'P';
  strike: number;
  /** The expiries the cluster's hits are on, ISO, ascending (one for a contract cluster) */
  expiries: string[];
  /** The contract key (ticker|right|strike|expiry) — a contract cluster's only; a strip's is null */
  contract: string | null;
  side: 'ASK' | 'BID';
  hits: number;
  prints: string[];
  totalSize: number;
  totalPremium: number;
  medianSize: number;
  firstTs: number;
  lastTs: number;
  avgFillPos: number;
  sweepShare: number;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function splitByGap(units: OrderUnit[], gapMs: number): OrderUnit[][] {
  const out: OrderUnit[][] = [];
  let cur: OrderUnit[] = [];
  for (const u of units) {
    if (cur.length && u.ts - cur[cur.length - 1].ts > gapMs) {
      out.push(cur);
      cur = [];
    }
    cur.push(u);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The runs of hits that satisfy all three rules (see the header) */
export function clusterRuns(units: OrderUnit[], opts: { gapMs?: number; sizeTol?: number; minHits?: number } = {}): OrderUnit[][] {
  const gapMs = opts.gapMs ?? REPEAT_GAP_MS;
  const tol = opts.sizeTol ?? REPEAT_SIZE_TOL;
  const minHits = opts.minHits ?? REPEAT_MIN_HITS;
  const out: OrderUnit[][] = [];
  const work = (list: OrderUnit[]) => {
    for (const run of splitByGap(list, gapMs)) {
      if (run.length < minHits) continue;
      const m = median(run.map(u => u.size));
      const kept = run.filter(u => Math.abs(u.size - m) <= tol * m + 1e-9);
      if (kept.length === run.length) out.push(run);
      else work(kept);
    }
  };
  work([...units].sort((a, b) => a.ts - b.ts || (a.key < b.key ? -1 : 1)));
  return out;
}

function clusterOf(kind: 'contract' | 'strip', key: string, run: OrderUnit[]): RepeatCluster {
  const prints = run.flatMap(u => u.prints);
  const totalSize = prints.reduce((a, p) => a + p.size, 0);
  const totalPremium = prints.reduce((a, p) => a + p.premium, 0);
  const fillW = prints.reduce((a, p) => a + p.fillPos * p.size, 0);
  const swept = prints.reduce((a, p) => a + (p.sweep ? p.size : 0), 0);
  const u0 = run[0];
  return {
    kind,
    key,
    ticker: u0.ticker,
    right: u0.right,
    strike: u0.strike,
    expiries: [...new Set(run.map(u => u.expiryIso))].sort(),
    contract: kind === 'contract' ? u0.contract : null,
    side: u0.side,
    hits: run.length,
    prints: run.flatMap(u => u.printIds),
    totalSize,
    totalPremium,
    medianSize: median(run.map(u => u.size)),
    firstTs: run[0].ts,
    lastTs: run[run.length - 1].ts,
    avgFillPos: totalSize > 0 ? fillW / totalSize : NaN,
    sweepShare: totalSize > 0 ? swept / totalSize : 0,
  };
}

export interface RepeatOptions {
  gapMs?: number;
  sizeTol?: number;
  minHits?: number;
  minSize?: number;
  burstMs?: number;
  /** Print keys the vendor has since cancelled */
  cancelled?: ReadonlySet<string>;
  /** Print keys to leave out (a RollRead's excludeIds) */
  exclude?: ReadonlySet<string>;
}
export interface RepeatRead {
  clusters: RepeatCluster[];
  strips: RepeatCluster[];
}

export function detectRepeats(input: readonly FlowPrint[], opts: RepeatOptions = {}): RepeatRead {
  const live = dedupePrints(input, opts.cancelled);
  /* the expiries the tape shows for each ticker, any right — "adjacent" is read against these */
  const chain = new Map<string, string[]>();
  for (const p of live) {
    const iso = expiryIsoOf(p.expiry);
    if (!iso || !p.ticker) continue;
    const t = p.ticker.toUpperCase();
    const l = chain.get(t) ?? [];
    l.push(iso);
    chain.set(t, l);
  }
  for (const [t, l] of chain) chain.set(t, [...new Set(l)].sort());
  const minSize = opts.minSize ?? REPEAT_MIN_SIZE;
  const units = burstHits(orderUnits(live.filter(p => !(p.legs > 1) && !opts.exclude?.has(printKey(p)))), opts.burstMs).filter(u => u.size >= minSize);
  const by = new Map<string, OrderUnit[]>();
  const byStrike = new Map<string, OrderUnit[]>();
  for (const u of units) {
    const k = `${u.contract}|${u.side}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(u);
    const s = `${u.ticker}|${u.right}|${u.strike}|${u.side}`;
    (byStrike.get(s) ?? byStrike.set(s, []).get(s)!).push(u);
  }
  const clusters: RepeatCluster[] = [];
  for (const [k, list] of by) for (const run of clusterRuns(list, opts)) clusters.push(clusterOf('contract', `${k}|${run[0].ts}`, run));
  const strips: RepeatCluster[] = [];
  for (const [k, list] of byStrike) {
    if (new Set(list.map(u => u.expiryIso)).size < 2) continue;
    for (const run of clusterRuns(list, opts)) {
      const exp = [...new Set(run.map(u => u.expiryIso))].sort();
      if (exp.length < 2) continue;
      const listed = chain.get(run[0].ticker) ?? [];
      const at = exp.map(e => listed.indexOf(e));
      if (at.some((x, i) => x < 0 || (i > 0 && x !== at[i - 1] + 1))) continue;
      strips.push(clusterOf('strip', `${k}|${run[0].ts}`, run));
    }
  }
  const order = (a: RepeatCluster, b: RepeatCluster) => a.firstTs - b.firstTs || (a.key < b.key ? -1 : 1);
  return { clusters: clusters.sort(order), strips: strips.sort(order) };
}

