import { getCarry } from './carry';
/* The gamma flip: the spot S* where the book's net gamma, re-priced sticky-strike, is zero. Each leg scales as
   G(S) = G0·Sφ(d1(S))/(S0φ(d1(S0))); a leg below the print's resolution is priced outright from its open interest. */

/** One leg of the book: its dollar gamma at today's spot (house sign), and what re-prices it */
export interface GammaLeg {
  strike: number;
  /** Dollar gamma per 1% at today's spot — house sign (call legs negative, put legs positive) */
  g0: number;
  /** Implied vol, annualised fraction — 0 when unknown (the leg is carried flat) */
  iv: number;
  /** Years to expiry */
  t: number;
  /** The price g0 was priced at, when it is not the search's spot (the vendor's row price — after the close the 4:00
      regular close, not the after-hours last). The leg is re-priced FROM here. */
  s0?: number;
  /** The leg's open interest, when known — its re-priced dollar gamma can never pass what that many contracts hold at
      their peak, OI·K·e^(−qT)/(√(2π)·σ·√T) (the most Γ·S² a contract reaches, near its strike) */
  oi?: number;
  /** House sign of one contract's gamma on this leg (calls −1, puts +1). With `oi`, a leg too far from spot for its
      printed gamma to carry information is priced outright: side·OI·100·Γ(S)·S²·1%. */
  side?: 1 | -1;
  /** True when `iv` is the contract's own printed vol (not the smile's or the at-the-money stand-in) */
  ownIv?: boolean;
  /** The time to expiry g0 was priced at, years, when the leg is re-priced at another moment (`t` is then that moment's —
      an earlier minute of the day, data/flipLevel.ts levelNetPath) */
  t0?: number;
}

export interface FlipRead {
  /** The price where net gamma crosses zero, nearest spot inside the range — null when it does not cross there */
  flip: number | null;
  /** Net gamma at spot, house sign (negative = dealers long gamma = absorbs), re-priced AT spot: the book's own net when its legs were priced there */
  netAtSpot: number;
  /** The sign of net gamma between spot and the flip's far side: what the book becomes beyond the flip */
  beyond: 'long' | 'short' | null;
  /** The range searched, as a fraction of spot either side */
  range: number;
  /** How the flip was found: always the re-priced profile (Black-Scholes at each leg's vol) — there is no second rule */
  method: 'repriced';
  /** Every crossing inside the range, low to high — more than one when the profile crosses zero more than once (the
      flip is then chosen with hysteresis, data/flipLevel.ts) */
  crossings?: number[];
}

const RANGE = 0.1;
const STEPS = 240;
const SQRT2PI = Math.sqrt(2 * Math.PI);
/** A leg's Black-Scholes d₁, with the dividend yield in the carry. */
const d1Of = (S: number, K: number, t: number, iv: number, r: number, q: number): number =>
  (Math.log(S / K) + (r - q + (iv * iv) / 2) * t) / (iv * Math.sqrt(t));

/** Dollar gamma per 1% of one contract at spot S: e^{−qT} · φ(d₁) / (S σ √T) · S² · 0.01 · 100 */
export const dollarGammaPerContract = (S: number, K: number, t: number, iv: number, r?: number, q?: number): number => {
  const carry = getCarry();
  const rate = r ?? carry.r;
  const yld = q ?? carry.q;
  if (!(S > 0 && K > 0 && t > 0 && iv > 0)) return 0;
  const d1 = d1Of(S, K, t, iv, rate, yld);
  const pdf = Math.exp(-(d1 * d1) / 2) / SQRT2PI;
  return Math.exp(-yld * t) * (pdf / (S * iv * Math.sqrt(t))) * S * S * 0.01 * 100;
};

/** The book's net gamma at hypothetical spot S, house sign */
export function netGammaAt(legs: readonly GammaLeg[], S0: number, S: number, r?: number, q?: number): number {
  const carry = getCarry();
  const rate = r ?? carry.r;
  const yld = q ?? carry.q;
  let sum = 0;
  for (const l of legs) {
    if (!l.g0 && !(l.oi && l.side)) continue;
    if (!(l.iv > 0) || !(l.t > 0)) {
      sum += l.g0;
      continue;
    }
    /* re-priced off the leg's own gamma at S₀: the ratio of S·φ(d₁), in logs so a far wing cannot underflow */
    const base = l.s0 && l.s0 > 0 ? l.s0 : S0;
    const tBase = l.t0 && l.t0 > 0 ? l.t0 : l.t;
    const a = d1Of(base, l.strike, tBase, l.iv, rate, yld);
    /* Six deviations from its strike a leg's printed gamma is rounding noise, and the ratio would multiply it by e^30:
       such a leg is priced outright from its open interest, or carried flat without one. */
    if (Math.abs(a) > OUTRIGHT_D1) {
      sum += l.oi && l.oi > 0 && l.side ? l.side * l.oi * dollarGammaPerContract(S, l.strike, l.t, l.iv, rate, yld) : l.g0;
      continue;
    }
    const b = d1Of(S, l.strike, l.t, l.iv, rate, yld);
    /* Γ·S² ∝ e^{−qT}·S·φ(d₁)/(σ√T). The dividend does not cancel when the two moments have different time left. */
    const ln = -yld * (l.t - tBase) + Math.log(S / base) - (b * b) / 2 + (a * a) / 2 + (tBase !== l.t ? 0.5 * Math.log(tBase / l.t) : 0);
    let g = l.g0 * Math.exp(Math.min(ln, 60));
    /* No contract holds more Γ·S² than its peak near the strike: the ceiling binds legs on a stand-in vol, and any leg in
       its last day (a same-day leg priced off a spot dollars away otherwise grows by e^30). */
    if (l.oi && l.oi > 0 && (!l.ownIv || l.t <= 1 / 252)) {
      const cap = Math.max(Math.abs(l.g0), (l.oi * l.strike * Math.exp(-yld * l.t)) / (SQRT2PI * l.iv * Math.sqrt(l.t)));
      if (Math.abs(g) > cap) g = Math.sign(g) * cap;
    }
    sum += g;
  }
  return sum;
}

/** netGammaAt at every price of a path: the same arithmetic in the same order, so each value is bit-identical to
    netGammaAt(legs, S0, prices[i]) — but what does not move with S (each leg's d₁ at its base, its drift, √T, the cap) is
    worked out once per leg rather than once per leg per price. Terrain's dealer-flow ladder re-prices the book at ~320. */
export function netGammaPath(legs: readonly GammaLeg[], S0: number, prices: readonly number[], r?: number, q?: number): number[] {
  const carry = getCarry();
  const rate = r ?? carry.r;
  const yld = q ?? carry.q;
  const n = prices.length;
  const sums = new Array<number>(n).fill(0);
  for (const l of legs) {
    if (!l.g0 && !(l.oi && l.side)) continue;
    if (!(l.iv > 0) || !(l.t > 0)) {
      for (let i = 0; i < n; i++) sums[i] += l.g0;
      continue;
    }
    const base = l.s0 && l.s0 > 0 ? l.s0 : S0;
    const tBase = l.t0 && l.t0 > 0 ? l.t0 : l.t;
    const a = d1Of(base, l.strike, tBase, l.iv, rate, yld);
    if (Math.abs(a) > OUTRIGHT_D1) {
      for (let i = 0; i < n; i++) sums[i] += l.oi && l.oi > 0 && l.side ? l.side * l.oi * dollarGammaPerContract(prices[i], l.strike, l.t, l.iv, rate, yld) : l.g0;
      continue;
    }
    /* d1Of(S, K, t, iv, rate, yld) with its S-free parts held: (log(S/K) + drift) / volT */
    const drift = (rate - yld + (l.iv * l.iv) / 2) * l.t;
    const volT = l.iv * Math.sqrt(l.t);
    const lead = -yld * (l.t - tBase);
    const aTerm = (a * a) / 2;
    const tTerm = tBase !== l.t ? 0.5 * Math.log(tBase / l.t) : 0;
    const capped = !!(l.oi && l.oi > 0 && (!l.ownIv || l.t <= 1 / 252));
    const cap = capped ? Math.max(Math.abs(l.g0), (l.oi! * l.strike * Math.exp(-yld * l.t)) / (SQRT2PI * l.iv * Math.sqrt(l.t))) : 0;
    for (let i = 0; i < n; i++) {
      const S = prices[i];
      const b = (Math.log(S / l.strike) + drift) / volT;
      const ln = lead + Math.log(S / base) - (b * b) / 2 + aTerm + tTerm;
      let g = l.g0 * Math.exp(Math.min(ln, 60));
      if (capped && Math.abs(g) > cap) g = Math.sign(g) * cap;
      sums[i] += g;
    }
  }
  return sums;
}

/** Six deviations from the strike: past this a leg's printed gamma is under e^-18 of its peak (rounding). */
const OUTRIGHT_D1 = 6;

/** Legs whose growth would be rounding are carried flat: under a ten-millionth of the book's gross gamma, or under a
    hundred-thousandth on a stand-in vol. A leg priced outright from its open interest is never rounding. */
export function quietLegs(legs: readonly GammaLeg[]): GammaLeg[] {
  const gross = legs.reduce((a, l) => a + Math.abs(l.g0), 0);
  return legs.map(l => (l.oi && l.side ? l : Math.abs(l.g0) < gross * 1e-7 || (!l.ownIv && Math.abs(l.g0) < gross * 1e-5) ? { ...l, iv: 0 } : l));
}

/** The flip off re-priced legs: the zero of net gamma across hypothetical spots, nearest spot inside ±10% */
export function repricedFlip(legsIn: readonly GammaLeg[], spot: number, r?: number, range: number = RANGE, q?: number): FlipRead {
  const net0 = legsIn.reduce((a, l) => a + l.g0, 0);
  const legs = quietLegs(legsIn);
  if (!(spot > 0) || !legs.length) return { flip: null, netAtSpot: net0, beyond: null, range, method: 'repriced' };
  const lo = spot * (1 - range);
  const hi = spot * (1 + range);
  /* Two grids: broad legs on a 240-step grid read between its points; narrow ones (a contract minutes from expiry) priced
     exactly on a grid finer than half the narrowest material width σ·√T·S. Spot is on both, so the sign at spot is the net. */
  const coarseStep = (hi - lo) / STEPS;
  const broad: GammaLeg[] = [];
  const narrow: GammaLeg[] = [];
  for (const l of legs) {
    const w = l.iv > 0 && l.t > 0 ? l.iv * Math.sqrt(l.t) * spot : Infinity;
    (w >= 4 * coarseStep ? broad : narrow).push(l);
  }
  const cx: number[] = [];
  for (let i = 0; i <= STEPS; i++) cx.push(lo + coarseStep * i);
  cx.push(spot);
  cx.sort((a, b) => a - b);
  const cy = netGammaPath(broad, spot, cx, r, q);
  const broadAt = (S: number): number => {
    let i = 1;
    let j = cx.length - 1;
    if (S <= cx[0]) return cy[0];
    if (S >= cx[j]) return cy[j];
    while (j - i > 1) {
      const m = (i + j) >> 1;
      if (cx[m] >= S) j = m;
      else i = m;
    }
    const k = cx[i] >= S ? i : j;
    const x0 = cx[k - 1];
    const x1 = cx[k];
    const u = x1 > x0 ? (S - x0) / (x1 - x0) : 0;
    return cy[k - 1] + (cy[k] - cy[k - 1]) * u;
  };
  /* a leg priced at another price (the close, read after hours) is NOT its own value at spot: spot is searched from, and
     the book is re-priced there like anywhere else */
  const ownSpot = legs.every(l => !l.s0 || l.s0 === spot);
  const at = (S: number) => (S === spot && ownSpot ? net0 : broadAt(S) + netGammaAt(narrow, spot, S, r, q));
  /* a bracket found on the read-between grid is closed on the exact re-priced net, so the flip does not move with where
     the grid happens to fall (spot is a grid point): the same book gives the same flip from any spot */
  const exact = (S: number) => (S === spot && ownSpot ? net0 : netGammaAt(broad, spot, S, r, q) + netGammaAt(narrow, spot, S, r, q));
  /* The net AT SPOT, re-priced there (spot is on both grids, so this is exact): a book priced at another price — the
     close, read before the open — is not its own net at spot. The regime is read where price is, on the curve the
     crossing is searched on, so the two never disagree. */
  const netAtSpot = at(spot);
  const maxG = narrow.reduce((m, l) => Math.max(m, Math.abs(l.g0)), 0);
  let width = Infinity;
  for (const l of narrow) if (Math.abs(l.g0) >= 0.01 * maxG) width = Math.min(width, l.iv * Math.sqrt(l.t) * spot);
  const steps = Math.max(STEPS, Math.min(8000, Math.ceil((hi - lo) / Math.max(1e-9, width / 2))));
  const xs: number[] = [];
  for (let i = 0; i <= steps; i++) xs.push(lo + ((hi - lo) * i) / steps);
  xs.push(spot);
  xs.sort((a, b) => a - b);
  const ys = xs.map(at);
  let best: number | null = null;
  let bestD = Infinity;
  const all: number[] = [];
  const keep = (x: number) => {
    all.push(x);
    const d = Math.abs(x - spot);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  };
  /* Walk the nonzero points: a change of sign between two of them is a crossing. Across a run of exact zeros it is the
     run's middle (a single zero point: that point) — never skipped; a zero touched without a change of sign is none. */
  let j = -1;
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] === 0) continue;
    if (j >= 0 && Math.sign(ys[j]) !== Math.sign(ys[i])) {
      if (i - j > 1) keep((xs[j + 1] + xs[i - 1]) / 2);
      else {
        let a = xs[j];
        let b = xs[i];
        const ea = exact(a);
        const eb = exact(b);
        /* the exact net brackets too (it nearly always does): bisect it; else the grid's own line */
        const f = ea !== 0 && eb !== 0 && Math.sign(ea) !== Math.sign(eb) ? exact : at;
        let fa = f === exact ? ea : ys[j];
        for (let k = 0; k < 40; k++) {
          const m = (a + b) / 2;
          const fm = f(m);
          if (fm === 0) {
            a = b = m;
            break;
          }
          if (Math.sign(fm) === Math.sign(fa)) {
            a = m;
            fa = fm;
          } else b = m;
        }
        keep((a + b) / 2);
      }
    }
    j = i;
  }
  const flip: number | null = best;
  return { flip, netAtSpot, beyond: flip == null ? null : netAtSpot < 0 ? 'short' : 'long', range, method: 'repriced', crossings: all };
}
