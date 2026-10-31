/* Roll detection: a position closed on one contract and reopened on another of the same root and right, read off the
   option tape's prints (FlowPrint, as tradeToPrint maps them).

   DEFINITIONS (every threshold is a named constant below)

   Eligible print. A print takes part only when it is a real, sided, timed fill:
     - not cancelled (the caller's `cancelled` ids, and printsOfRows drops the vendor's canceled rows), counted once
       (duplicates by printKey are dropped, the first kept);
     - side ASK or BID (a MID print, a crossed or stale quote — tradeToPrint already makes those MID — has no
       direction to oppose);
     - not a cross trade, not compression, not a floor package leg, not extended hours;
     - size > 0, epochMs > 0, a strike, an expiry and a ticker.

   Order unit. Prints on the same contract, same side, same millisecond are one order (a sweep split over exchanges,
   a multi-leg leg filled against several resting orders): their sizes and premiums add.

   Pair. Two units A and B form a candidate when
     - same root (the print's underlying ticker) and same right (C/C or P/P);
     - different contract (strike and/or expiry differ);
     - opposite sides (one ASK, one BID);
     - similar size: |sizeA − sizeB| ≤ ROLL_SIZE_TOL × max(sizeA, sizeB) (±10%);
     - and either
         TAGGED   — both at least ROLL_MIN_SIZE (10) contracts, both legs of a multi-leg order (OPRA ML?T / ?ESL
                    family, FlowPrint.legs > 1) stamped in the
                    same millisecond, and that millisecond's multi-leg prints on the root (any side, eligible or
                    not) are on exactly these two contracts (a three- or four-leg structure is a spread, never a
                    roll);
         INFERRED — both at least ROLL_INFERRED_MIN_SIZE (50) contracts, both single-leg prints,
                    |tA − tB| ≤ ROLL_WINDOW_MS (2 s), AND unique (below). A busy tape (SPY prints ~100 a second)
                    pairs small opposite fills by coincidence; an ambiguous match is not called a roll.

   Unique: neither unit of an inferred pair is pairable (the size, side, right and window tests, at any size) with
   any other single-leg unit — a 45-lot rival of a 50-lot counts though it is under the 50-lot line; then no unit
   can be in two candidates.

   Orientation (which leg closed, which opened). A leg X CAN CLOSE when the open interest the session opened on
   covers it (X.oi ≥ X.size — no more can close than stood open) and, when the next session's count is passed in
   `nextOi`, that count fell (next.oi < next.before). X CLOSED BY COUNT when, besides, the next count is known and
   fell. A leg Y CAN OPEN when likelyOpeningOf (traceRows) says so for its contract (day volume past the opening
   interest, or — with the next count — interest that grew by half the day's volume).
     Different expiries: X → Y is valid when X can close and Y can open; exactly one direction valid → that one;
       both valid → nearer expiry → farther (rolling out is the convention); none → not a roll.
     One expiry (up / down): a vertical spread prints the same, so X → Y needs X closed by count, Y can open and Y
       not closed by count — only possible once the next session's counts are in (nextOi); without them, no roll.
   What stays unprovable: a calendar or diagonal spread opened on legs that both pass these tests reads as a roll
   out; that is why every roll says 'inferred' or 'tagged', never more.

   Kind (from → to): later expiry & same strike "out"; later & higher strike "up-and-out"; later & lower "down-and-out";
   same expiry & higher "up"; same expiry & lower "down"; earlier expiry: "in", "up-and-in", "down-and-in".
   Holder: the close was sold (BID) → a long position rolled; the close was bought (ASK) → a short one.
   netPremium = premium of the bought (ASK) leg − premium of the sold (BID) leg: positive is a net debit paid.
   size = min(from.size, to.size). ts = the earlier leg's epochMs.

   Matching is one-to-one: a tagged pair is its millisecond's only two multi-leg contracts and an inferred pair is
   unique, so no unit is in two candidates; the order (time, then key) is only for a deterministic list. Every print of every roll is in `excludeIds`, so a page's
   directional nets can leave a roll's two legs out instead of counting them as two opposite bets. */

import type { FlowPrint } from '../types/trace';
/* through traceLive, as every Trace module does: traceRows is in an import cycle that only resolves in that order */
import { likelyOpeningOf, liveTrades, tradeToPrint } from './traceLive';

/** Two single-leg prints this close in time (ms) can be one roll */
export const ROLL_WINDOW_MS = 2_000;
/** Sizes within this fraction of the larger one are "the same size" */
export const ROLL_SIZE_TOL = 0.1;
/** A tagged leg under this many contracts is too small to call a roll */
export const ROLL_MIN_SIZE = 10;
/** An inferred (single-leg) leg under this many contracts is too small: small fills pair by coincidence */
export const ROLL_INFERRED_MIN_SIZE = 50;

/** A print's identity: the vendor's trade id (FlowPrint.vendorId), else its 53-bit hash */
export const printKey = (p: Pick<FlowPrint, 'vendorId' | 'id'>): string => (p.vendorId != null && p.vendorId !== '' ? p.vendorId : String(p.id));

/** "10/29/2026" → "2026-10-29"; an ISO date passes through; anything else is '' */
export function expiryIsoOf(expiry: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(expiry);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(expiry) ? expiry.slice(0, 10) : '';
}

/** A contract's identity: ticker, right, strike, expiry (the OCC symbol is not on every print) */
export const contractKeyOf = (p: Pick<FlowPrint, 'ticker' | 'right' | 'strike' | 'expiry'>): string => `${p.ticker.toUpperCase()}|${p.right}|${p.strike}|${expiryIsoOf(p.expiry)}`;

/** The vendor's option-trade rows as prints: cancelled rows dropped (liveTrades), each mapped once (tradeToPrint) */
export function printsOfRows(rows: Record<string, unknown>[]): FlowPrint[] {
  return liveTrades(rows).map(r => tradeToPrint(r));
}

/** Prints once each by printKey, the first kept, and none whose key is in `cancelled` */
export function dedupePrints(prints: readonly FlowPrint[], cancelled?: ReadonlySet<string>): FlowPrint[] {
  const seen = new Set<string>();
  const out: FlowPrint[] = [];
  for (const p of prints) {
    const k = printKey(p);
    if (seen.has(k) || cancelled?.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** A sided, timed, real fill (see the header) */
export function sidedFill(p: FlowPrint): boolean {
  return (p.side === 'ASK' || p.side === 'BID') && !p.cross && !p.compression && !p.floorPackage && !p.extended && !p.quoteNoRead && p.size > 0 && (p.epochMs ?? 0) > 0 && p.strike > 0 && !!expiryIsoOf(p.expiry) && !!p.ticker;
}

/** One order on one contract: the prints of one side in one millisecond */
export interface OrderUnit {
  key: string;
  contract: string;
  ticker: string;
  right: 'C' | 'P';
  strike: number;
  expiryIso: string;
  side: 'ASK' | 'BID';
  size: number;
  premium: number;
  ts: number;
  multi: boolean;
  /** Opening interest of the contract (the largest the prints carry) and its day volume (the largest = the latest) */
  oi: number;
  volume: number;
  occ?: string;
  printIds: string[];
  prints: FlowPrint[];
}

/** Eligible prints gathered into order units (same contract, side, millisecond and multi-leg flag) */
export function orderUnits(prints: readonly FlowPrint[]): OrderUnit[] {
  const by = new Map<string, OrderUnit>();
  for (const p of prints) {
    if (!sidedFill(p)) continue;
    const multi = p.legs > 1;
    const contract = contractKeyOf(p);
    const key = `${contract}|${p.side}|${p.epochMs}|${multi ? 'M' : 'S'}`;
    const u = by.get(key);
    if (u) {
      u.size += p.size;
      u.premium += p.premium;
      u.oi = Math.max(u.oi, p.oi);
      u.volume = Math.max(u.volume, p.volume);
      u.printIds.push(printKey(p));
      u.prints.push(p);
      continue;
    }
    by.set(key, {
      key,
      contract,
      ticker: p.ticker.toUpperCase(),
      right: p.right,
      strike: p.strike,
      expiryIso: expiryIsoOf(p.expiry),
      side: p.side as 'ASK' | 'BID',
      size: p.size,
      premium: p.premium,
      ts: p.epochMs as number,
      multi,
      oi: p.oi,
      volume: p.volume,
      occ: p.occ,
      printIds: [printKey(p)],
      prints: [p],
    });
  }
  return [...by.values()].sort((a, b) => a.ts - b.ts || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

export type RollKind = 'out' | 'up-and-out' | 'down-and-out' | 'up' | 'down' | 'in' | 'up-and-in' | 'down-and-in';
export interface RollLeg {
  contract: string;
  occ?: string;
  strike: number;
  expiryIso: string;
  side: 'ASK' | 'BID';
  size: number;
  premium: number;
  ts: number;
  printIds: string[];
}
export interface RollEvent {
  id: string;
  root: string;
  right: 'C' | 'P';
  from: RollLeg;
  to: RollLeg;
  kind: RollKind;
  holder: 'long' | 'short';
  size: number;
  /** Bought leg's premium less the sold leg's: + net debit, − net credit */
  netPremium: number;
  confidence: 'tagged' | 'inferred';
  ts: number;
  gapMs: number;
}
export interface RollRead {
  rolls: RollEvent[];
  /** Every print key of every roll's legs — leave these out of directional nets */
  excludeIds: Set<string>;
}

export function rollKindOf(from: { strike: number; expiryIso: string }, to: { strike: number; expiryIso: string }): RollKind {
  const t = to.expiryIso > from.expiryIso ? 'out' : to.expiryIso < from.expiryIso ? 'in' : '';
  const k = to.strike > from.strike ? 'up' : to.strike < from.strike ? 'down' : '';
  if (!t) return k as 'up' | 'down';
  return (k ? `${k}-and-${t}` : t) as RollKind;
}

type NextOi = (u: OrderUnit) => { oi: number; before: number } | null | undefined;
/** Could close: the opening interest covers it, and — once the next session's count is out — the count fell */
const canClose = (u: OrderUnit, nextOi?: NextOi) => {
  if (!(u.oi >= u.size)) return false;
  const n = nextOi?.(u);
  return n ? n.oi < n.before : true;
};
/** Did close, as far as the counts can say: the next session's count is out and it fell */
const closedByCount = (u: OrderUnit, nextOi?: NextOi) => {
  const n = nextOi?.(u);
  return !!n && u.oi >= u.size && n.oi < n.before;
};
const canOpen = (u: OrderUnit, nextOi?: NextOi) => likelyOpeningOf({ volume: u.volume, oi: u.oi }, nextOi?.(u) ?? null) === true;

/** The close → open direction of a pair, or null when it cannot be told from a spread (see the header) */
export function orientPair(a: OrderUnit, b: OrderUnit, nextOi?: NextOi): [OrderUnit, OrderUnit] | null {
  if (a.expiryIso === b.expiryIso) {
    /* one expiry: a vertical spread looks the same, so only a close the next count shows makes it a roll */
    const ab = closedByCount(a, nextOi) && canOpen(b, nextOi) && !closedByCount(b, nextOi);
    const ba = closedByCount(b, nextOi) && canOpen(a, nextOi) && !closedByCount(a, nextOi);
    return ab && !ba ? [a, b] : ba && !ab ? [b, a] : null;
  }
  const ab = canClose(a, nextOi) && canOpen(b, nextOi);
  const ba = canClose(b, nextOi) && canOpen(a, nextOi);
  if (ab && !ba) return [a, b];
  if (ba && !ab) return [b, a];
  if (ab && ba) return a.expiryIso < b.expiryIso ? [a, b] : [b, a];
  return null;
}

const sizeClose = (a: number, b: number) => Math.abs(a - b) <= ROLL_SIZE_TOL * Math.max(a, b) + 1e-9;

function pairable(a: OrderUnit, b: OrderUnit, minSize: number): boolean {
  return a.ticker === b.ticker && a.right === b.right && a.contract !== b.contract && a.side !== b.side && a.size >= minSize && b.size >= minSize && sizeClose(a.size, b.size);
}

const legOf = (u: OrderUnit): RollLeg => ({ contract: u.contract, occ: u.occ, strike: u.strike, expiryIso: u.expiryIso, side: u.side, size: u.size, premium: u.premium, ts: u.ts, printIds: [...u.printIds] });

export interface RollOptions {
  windowMs?: number;
  /** Tagged legs' minimum contracts (ROLL_MIN_SIZE) */
  minSize?: number;
  /** Inferred legs' minimum contracts (ROLL_INFERRED_MIN_SIZE) */
  inferredMinSize?: number;
  /** Print keys the vendor has since cancelled */
  cancelled?: ReadonlySet<string>;
  /** The next session's open interest for a contract, when published (pairOiFor's count): { oi, before } */
  nextOi?: NextOi;
}

/** The rolls in a set of prints, and the print keys to leave out of directional nets */
export function detectRolls(input: readonly FlowPrint[], opts: RollOptions = {}): RollRead {
  const windowMs = opts.windowMs ?? ROLL_WINDOW_MS;
  const minSize = opts.minSize ?? ROLL_MIN_SIZE;
  const inferredMin = opts.inferredMinSize ?? ROLL_INFERRED_MIN_SIZE;
  const live = dedupePrints(input, opts.cancelled);
  const units = orderUnits(live);
  /* every multi-leg contract on a root in a millisecond, sided or not: a four-leg order with two mid legs is still four */
  const legsAt = new Map<string, Set<string>>();
  for (const p of live) {
    if (!(p.legs > 1) || !(p.epochMs! > 0)) continue;
    const k = `${p.ticker.toUpperCase()}|${p.epochMs}`;
    const set = legsAt.get(k) ?? new Set<string>();
    set.add(contractKeyOf(p));
    legsAt.set(k, set);
  }
  type Cand = { a: OrderUnit; b: OrderUnit; tagged: boolean; gap: number; rel: number };
  const cands: Cand[] = [];

  /* TAGGED: a root's multi-leg legs in one millisecond, exactly two contracts */
  const groups = new Map<string, OrderUnit[]>();
  for (const u of units) {
    if (!u.multi) continue;
    const k = `${u.ticker}|${u.ts}`;
    const g = groups.get(k);
    if (g) g.push(u);
    else groups.set(k, [u]);
  }
  for (const [k, g] of groups) {
    if (g.length !== 2 || new Set(g.map(u => u.contract)).size !== 2 || legsAt.get(k)?.size !== 2) continue;
    const [a, b] = g;
    if (pairable(a, b, minSize)) cands.push({ a, b, tagged: true, gap: 0, rel: Math.abs(a.size - b.size) / Math.max(a.size, b.size) });
  }

  /* INFERRED: single-leg units of one root and right within the window */
  const singles = new Map<string, OrderUnit[]>();
  for (const u of units) {
    if (u.multi) continue;
    const k = `${u.ticker}|${u.right}`;
    const g = singles.get(k);
    if (g) g.push(u);
    else singles.set(k, [u]);
  }
  const partners = new Map<string, number>();
  const inferred: Cand[] = [];
  for (const g of singles.values()) {
    /* units are in time order: each looks forward only as far as the window, so every pair is seen once */
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length && g[j].ts - g[i].ts <= windowMs; j++) {
        const a = g[i];
        const b = g[j];
        /* a rival is any opposite fill within ±10%, whatever its size: a 45-lot beside a 50-lot makes the match as
           ambiguous as another 50-lot would */
        if (!pairable(a, b, 1)) continue;
        partners.set(a.key, (partners.get(a.key) ?? 0) + 1);
        partners.set(b.key, (partners.get(b.key) ?? 0) + 1);
        if (a.size >= inferredMin && b.size >= inferredMin) inferred.push({ a, b, tagged: false, gap: b.ts - a.ts, rel: Math.abs(a.size - b.size) / Math.max(a.size, b.size) });
      }
    }
  }
  /* only a unique match: either unit pairable with a third is ambiguous, and no roll */
  for (const c of inferred) if (partners.get(c.a.key) === 1 && partners.get(c.b.key) === 1) cands.push(c);

  cands.sort((x, y) => Number(y.tagged) - Number(x.tagged) || x.gap - y.gap || x.rel - y.rel || (x.a.key + x.b.key < y.a.key + y.b.key ? -1 : x.a.key + x.b.key > y.a.key + y.b.key ? 1 : 0));
  const used = new Set<string>();
  const rolls: RollEvent[] = [];
  const excludeIds = new Set<string>();
  for (const c of cands) {
    if (used.has(c.a.key) || used.has(c.b.key)) continue;
    const dir = orientPair(c.a, c.b, opts.nextOi);
    if (!dir) continue;
    const [from, to] = dir;
    used.add(c.a.key);
    used.add(c.b.key);
    const ask = from.side === 'ASK' ? from : to;
    const bid = from.side === 'BID' ? from : to;
    rolls.push({
      id: `${from.key}>${to.key}`,
      root: from.ticker,
      right: from.right,
      from: legOf(from),
      to: legOf(to),
      kind: rollKindOf(from, to),
      holder: from.side === 'BID' ? 'long' : 'short',
      size: Math.min(from.size, to.size),
      netPremium: ask.premium - bid.premium,
      confidence: c.tagged ? 'tagged' : 'inferred',
      ts: Math.min(from.ts, to.ts),
      gapMs: Math.abs(to.ts - from.ts),
    });
    for (const id of [...from.printIds, ...to.printIds]) excludeIds.add(id);
  }
  rolls.sort((x, y) => x.ts - y.ts || (x.id < y.id ? -1 : 1));
  return { rolls, excludeIds };
}

/** The prints with every roll leg taken out — what a directional net (summarizeTape) should read */
export function withoutRollLegs<T extends Pick<FlowPrint, 'vendorId' | 'id'>>(prints: readonly T[], read: Pick<RollRead, 'excludeIds'>): T[] {
  return prints.filter(p => !read.excludeIds.has(printKey(p)));
}
