/* SLAYER mode's spot and carry (TWO_BOOK_SPEC_V2 §1.2): parity forwards, ONE implied spot S* per timestamp, and each
   expiry's carry against S* (never against the stale index print). Pure.

   F_T  = median over the 6 strikes nearest spot with two-sided call and put quotes of K + e^{r_T·T}(C_mid − P_mid)
   T1   = nearest unexpired expiry with a valid forward; TL = nearest OTHER expiry with T ≥ 7 calendar days and a valid
          forward
   S*   = exp((TL·ln F_T1 − T1·ln F_TL)/(TL − T1))   (ln F extrapolated linearly to T = 0)
   b_T  = ln(F_T/S*)/T for every expiry (each priced off its own forward)
   An expiry without a valid forward: ln F linear in T between the nearest valid nodes on each side (T = 0 is the node
   ln S*); beyond the last valid expiry the last segment's slope (carry) is held flat. No TL (one valid forward, or
   none at 7 days or more): S* = F_T1·e^{−r_T1·T1}, provenance APPROX. */

import { D } from './contracts';

export interface ParityQuote {
  strike: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
}

const twoSided = (b: number, a: number) => Number.isFinite(b) && Number.isFinite(a) && b > 0 && a > b;

/** The parity forward of one expiry, or null when no strike has two-sided quotes on both legs */
export function parityForward(quotes: readonly ParityQuote[], spotRef: number, r: number, T: number, count = 6): { F: number; strikes: number[] } | null {
  if (!(T > 0) || !Number.isFinite(r) || !(spotRef > 0)) return null;
  const ok = quotes
    .filter(q => q.strike > 0 && twoSided(q.callBid, q.callAsk) && twoSided(q.putBid, q.putAsk))
    .map(q => ({ k: q.strike, c: 0.5 * (q.callBid + q.callAsk), p: 0.5 * (q.putBid + q.putAsk) }))
    .sort((a, b) => Math.abs(a.k - spotRef) - Math.abs(b.k - spotRef) || a.k - b.k)
    .slice(0, count);
  if (!ok.length) return null;
  const g = Math.exp(r * T);
  const fs = ok.map(x => x.k + g * (x.c - x.p)).sort((a, b) => a - b);
  const h = fs.length >> 1;
  const F = fs.length % 2 ? fs[h] : 0.5 * (fs[h - 1] + fs[h]);
  return F > 0 ? { F, strikes: ok.map(x => x.k).sort((a, b) => a - b) } : null;
}

export const impliedSpot = (T1: number, F1: number, TL: number, FL: number): number => Math.exp((TL * Math.log(F1) - T1 * Math.log(FL)) / (TL - T1));

export interface ExpiryForward {
  /** Calendar years to the expiry's settlement */
  T: number;
  /** The expiry's parity forward, null when not valid */
  F: number | null;
}
export interface SpotAndCarry {
  S: number;
  prov: 'CALCULATED' | 'APPROX';
  T1: number;
  TL: number | null;
  /** Per input expiry, in input order: the model forward and its carry b_T against S* */
  expiries: { T: number; F: number; b: number; source: 'PARITY' | 'INTERPOLATED' | 'EXTRAPOLATED' }[];
}

/** §1.2 in full; null with no valid forward. `rOf(T)` is the SOFR-curve rate at T. */
export function spotAndCarry(forwards: readonly ExpiryForward[], rOf: (T: number) => number): SpotAndCarry | null {
  const valid = forwards.filter((f): f is { T: number; F: number } => f.F != null && f.F > 0 && f.T > 0).sort((a, b) => a.T - b.T);
  if (!valid.length) return null;
  const t1 = valid[0];
  const week = 7 / D;
  const tl = valid.slice(1).find(v => v.T >= week) ?? null;
  /* Numerics: every log is RELATIVE to F_T1, y = ln(F/F_T1) taken as the log of a ratio, so b_T = (y − yS)/T never
     subtracts two nearly equal logs (a 30-minute expiry's ln(F/S*) is about 1e-6; ln F − ln S* keeps ten digits of it).
     yS = ln(S* ÷ F_T1): the line through (T1, 0) and (TL, ln(F_TL/F_T1)) at T = 0, or −r·T1 with one forward. */
  const y = (F: number) => Math.log(F / t1.F);
  const yS = tl ? (-t1.T * y(tl.F)) / (tl.T - t1.T) : -rOf(t1.T) * t1.T;
  const S = t1.F * Math.exp(yS);
  const nodes = [{ T: 0, l: yS }, ...valid.map(v => ({ T: v.T, l: y(v.F) }))];
  const expiries = forwards.map(f => {
    if (f.F != null && f.F > 0 && f.T > 0) return { T: f.T, F: f.F, b: (y(f.F) - yS) / f.T, source: 'PARITY' as const };
    /* between nodes (T = 0 is ln S*): linear in T; past the last valid expiry the last segment's slope held (with one
       forward that segment is S* → F_T1, so every other expiry carries r_T1) */
    let l: number;
    let lo = nodes[0];
    for (const n of nodes) if (n.T <= f.T && n.T >= lo.T) lo = n;
    const hi = nodes.filter(n => n.T >= f.T && n.T > lo.T).sort((a, b) => a.T - b.T)[0];
    if (hi) l = lo.l + ((hi.l - lo.l) * (f.T - lo.T)) / (hi.T - lo.T);
    else {
      const a = nodes[nodes.length - 2];
      const c = nodes[nodes.length - 1];
      l = c.l + ((c.l - a.l) / (c.T - a.T)) * (f.T - c.T);
    }
    return { T: f.T, F: t1.F * Math.exp(l), b: (l - yS) / f.T, source: hi ? ('INTERPOLATED' as const) : ('EXTRAPOLATED' as const) };
  });
  return { S, prov: tl ? 'CALCULATED' : 'APPROX', T1: t1.T, TL: tl?.T ?? null, expiries };
}
