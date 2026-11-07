/* A board: one engine mode, one timestamp, one time unit (TWO_BOOK_SPEC_V2 §1.5, §3.6, §4.4, §4.5, §8). Both books use
   it; they never share one. Pure.

   Each line is one contract (root, expiry, strike, right) with its signed C, its M, its T, the S it is priced at, its r
   and b, and an IV with a provenance. A line with no identifiable IV takes the flat-wing IV (the valid IV of the
   nearest strike of the same root, expiry and right; a tie goes to the strike nearer spot, then the lower; only a solved
   or vendor IV is a source, never another flat-wing fill) — never dropped (§1.5); the board
   reports the share of |C| on that modelled IV. EXPIRED lines are excluded and counted; a line with no IV at all after
   the flat wing is UNAVAILABLE, excluded and counted. */

import { contractStatus, greeks, type Right } from './bsm';
import { boardIsRate, boardTimeUnit, EXPOSURE_NAMES, exposures, hedge, totalGexChange1pct, zeroExposures, type Exposures, type TimeUnit } from './exposures';

export type IvProv = 'SOLVED' | 'UW_APPROX' | 'MODELED_FLAT_WING_IV' | 'UNAVAILABLE';
export type EngineMode = 'UW_COMPAT' | 'SLAYER';

export interface BoardLine {
  root: string;
  expiry: string;
  strike: number;
  right: Right;
  C: number;
  M: number;
  T: number;
  S: number;
  r: number;
  b: number;
  iv: number | null;
  ivProv: IvProv;
}

/** §1.5 flat wing, in place on a copy: lines without an IV take the nearest valid strike's IV, same root/expiry/right */
export function fillFlatWing(lines: readonly BoardLine[]): BoardLine[] {
  const valid = new Map<string, { k: number; iv: number }[]>();
  for (const l of lines) {
    if (l.iv == null || !(l.iv > 0)) continue;
    const g = `${l.root}|${l.expiry}|${l.right}`;
    const list = valid.get(g) ?? [];
    list.push({ k: l.strike, iv: l.iv });
    valid.set(g, list);
  }
  return lines.map(l => {
    if (l.iv != null && l.iv > 0) return l;
    const peers = valid.get(`${l.root}|${l.expiry}|${l.right}`);
    if (!peers?.length) return { ...l, iv: null, ivProv: 'UNAVAILABLE' };
    /* nearest strike; on a tie the one nearer the line's spot (inward), then the lower */
    let best = peers[0];
    for (const p of peers) {
      const d = Math.abs(p.k - l.strike);
      const bd = Math.abs(best.k - l.strike);
      const inP = Math.abs(p.k - l.S);
      const inB = Math.abs(best.k - l.S);
      if (d < bd || (d === bd && (inP < inB || (inP === inB && p.k < best.k)))) best = p;
    }
    return { ...l, iv: best.iv, ivProv: 'MODELED_FLAT_WING_IV' };
  });
}

export interface StrikeRow {
  strike: number;
  call: Exposures;
  put: Exposures;
  net: Exposures;
}

export interface BoardTotals {
  unit: TimeUnit;
  /** Some contract has under an hour left: the per-hour figures are instantaneous rates */
  rate: boolean;
  totals: Exposures;
  byStrike: StrikeRow[];
  byExpiry: { expiry: string; root: string; T: number; totals: Exposures; absC: number }[];
  totalGexChange1pct: number;
  hedge: { dealer_delta_units: number; hedge_units: number; dealer_dex: number; hedge_dollars: number; hedge_units_change_1pct: number };
  /** Σ|C| over the priced lines, and the share of it on a modelled (flat-wing) IV, and on an APPROX (vendor) IV */
  absC: number;
  modeledShare: number;
  approxShare: number;
  counts: { lines: number; priced: number; expired: number; unavailable: number; flatWing: number };
}

const addInto = (a: Exposures, b: Exposures) => {
  for (const n of EXPOSURE_NAMES) a[n] += b[n];
};

/** Sum a board. `unit` is fixed by §4.5 from the T of every line that is priced (unless given). */
export function sumBoard(input: readonly BoardLine[], unitIn?: TimeUnit): BoardTotals {
  const lines = fillFlatWing(input);
  const priced: (BoardLine & { iv: number })[] = [];
  let expired = 0;
  let unavailable = 0;
  for (const l of lines) {
    const st = contractStatus(l.S, l.strike, l.iv ?? NaN, l.T);
    if (st === 'EXPIRED') expired++;
    else if (st !== 'OK' || !(l.M > 0) || !Number.isFinite(l.C) || !Number.isFinite(l.r) || !Number.isFinite(l.b)) unavailable++;
    else priced.push(l as BoardLine & { iv: number });
  }
  /* §4.5's "any contract in the board": the contracts that enter the sums (C ≠ 0, priced) */
  const held = priced.filter(l => l.C !== 0).map(l => l.T);
  const unit = unitIn ?? boardTimeUnit(held);
  const rate = boardIsRate(held);
  const totals = zeroExposures();
  const strikes = new Map<number, StrikeRow>();
  const exps = new Map<string, { expiry: string; root: string; T: number; totals: Exposures; absC: number }>();
  const hd = { dealer_delta_units: 0, hedge_units: 0, dealer_dex: 0, hedge_dollars: 0, hedge_units_change_1pct: 0 };
  let tgc = 0;
  let absC = 0;
  let modeled = 0;
  let approx = 0;
  let flatWing = 0;
  for (const l of priced) {
    const g = greeks(l.S, l.strike, l.T, l.iv, l.r, l.b, l.right);
    const e = exposures(g, l.C, l.M, l.S, unit);
    addInto(totals, e);
    let row = strikes.get(l.strike);
    if (!row) strikes.set(l.strike, (row = { strike: l.strike, call: zeroExposures(), put: zeroExposures(), net: zeroExposures() }));
    addInto(l.right === 'C' ? row.call : row.put, e);
    addInto(row.net, e);
    const ek = `${l.root}|${l.expiry}`;
    let ex = exps.get(ek);
    if (!ex) exps.set(ek, (ex = { expiry: l.expiry, root: l.root, T: l.T, totals: zeroExposures(), absC: 0 }));
    addInto(ex.totals, e);
    ex.absC += Math.abs(l.C);
    const h = hedge(g, l.C, l.M, l.S);
    for (const k of Object.keys(hd) as (keyof typeof hd)[]) hd[k] += h[k];
    tgc += totalGexChange1pct(g, l.C, l.M, l.S);
    absC += Math.abs(l.C);
    if (l.ivProv === 'MODELED_FLAT_WING_IV') {
      modeled += Math.abs(l.C);
      flatWing++;
    }
    if (l.ivProv === 'UW_APPROX') approx += Math.abs(l.C);
  }
  return {
    unit,
    rate,
    totals,
    byStrike: [...strikes.values()].sort((a, b) => a.strike - b.strike),
    byExpiry: [...exps.values()].sort((a, b) => a.T - b.T || a.root.localeCompare(b.root)),
    totalGexChange1pct: tgc,
    hedge: hd,
    absC,
    modeledShare: absC > 0 ? modeled / absC : 0,
    approxShare: absC > 0 ? approx / absC : 0,
    counts: { lines: lines.length, priced: priced.length, expired, unavailable, flatWing },
  };
}
