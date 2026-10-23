/*
==================================================
  SLAYER TERMINAL - THE GAMMA FLIP, AS A TRADER MEANS IT
  (core/gammaFlip.ts)

  The flip is the PRICE where dealers switch from long
  to short gamma: the spot S* at which the whole book's
  net gamma, re-priced at S*, is zero.

  The old rule (core/walls.ts pickFlip) named the
  midpoint of the per-strike sign change nearest spot —
  a fact about two neighbouring strikes, not about the
  book (the Pinpoint audit, 2026-10-22: SPY Today read
  770.50 between 770 and 771 while the book's total
  never crossed zero; TSLA 376.25 against 385).

  HOW. Each leg (strike × expiry × call/put) carries its
  dollar gamma at today's spot, G₀ (the vendor's own
  greek-exposure rows, in the house sign). At a
  hypothetical spot S its gamma is re-priced with
  Black-Scholes at that leg's own implied vol and time
  to expiry:

      G(S) = G₀ · [S·φ(d₁(S))] / [S₀·φ(d₁(S₀))]

  (dollar gamma per 1% is Γ·S²·0.01, and Γ·S² =
  S·φ(d₁)/(σ√T) — the σ√T cancels). G₀ is the vendor's
  live open-interest gamma, OI·100·Γ(S₀)·S₀²·0.01, so this
  IS the contracts priced outright at S — and G(S₀) is
  exactly the book's net at spot, so the flip can never
  contradict the net GEX sign it sits beside. No constant
  rides along: the old outright branch carried the gap
  between a stale vendor snapshot and the model flat to
  every hypothetical spot (≈ +$256M on NVDA's 10/23
  contracts, the second re-audit 2026-10-22), which hid a
  crossing a dollar away. Legs with no vol are carried
  flat (a far listing with no vol on hand).

  A leg carries the price its G₀ was priced at (s0 — after
  the close the vendor's rows are priced at the 4:00 close,
  not the after-hours last), and is re-priced from there.
  The crossing nearest the live spot inside ±10% is the flip;
  none there is a real state ("no flip nearby"), never a
  level invented at spot.
==================================================
*/

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
      their peak, OI·K·e^(−rT)/(√(2π)·σ·√T) (the most Γ·S² a contract reaches, near its strike) */
  oi?: number;
  /** True when `iv` is the contract's own printed vol (not the smile's or the at-the-money stand-in) */
  ownIv?: boolean;
}

export interface FlipRead {
  /** The price where net gamma crosses zero, nearest spot inside the range — null when it does not cross there */
  flip: number | null;
  /** Net gamma at spot, house sign (negative = dealers long gamma = absorbs) — the book's own net */
  netAtSpot: number;
  /** The sign of net gamma between spot and the flip's far side: what the book becomes beyond the flip */
  beyond: 'long' | 'short' | null;
  /** The range searched, as a fraction of spot either side */
  range: number;
  /** How the flip was found — 'repriced' (Black-Scholes at each leg's vol) or 'cumulative' (strike-ordered running net) */
  method: 'repriced' | 'cumulative';
}

const RANGE = 0.1;
const STEPS = 240;
const SQRT2PI = Math.sqrt(2 * Math.PI);
/** A leg's Black-Scholes d₁ */
const d1Of = (S: number, K: number, t: number, iv: number, r: number): number => (Math.log(S / K) + (r + (iv * iv) / 2) * t) / (iv * Math.sqrt(t));

/** Dollar gamma per 1% of one contract at spot S: Γ·S²·0.01·100 */
export const dollarGammaPerContract = (S: number, K: number, t: number, iv: number, r: number): number => {
  if (!(S > 0 && K > 0 && t > 0 && iv > 0)) return 0;
  const d1 = d1Of(S, K, t, iv, r);
  const pdf = Math.exp(-(d1 * d1) / 2) / SQRT2PI;
  return (pdf / (S * iv * Math.sqrt(t))) * S * S * 0.01 * 100;
};

/** The book's net gamma at hypothetical spot S, house sign */
export function netGammaAt(legs: readonly GammaLeg[], S0: number, S: number, r: number): number {
  let sum = 0;
  for (const l of legs) {
    if (!l.g0) continue;
    if (!(l.iv > 0) || !(l.t > 0)) {
      sum += l.g0;
      continue;
    }
    /* re-priced off the leg's own gamma at S₀: the ratio of S·φ(d₁), in logs so a far wing cannot underflow */
    const base = l.s0 && l.s0 > 0 ? l.s0 : S0;
    const a = d1Of(base, l.strike, l.t, l.iv, r);
    const b = d1Of(S, l.strike, l.t, l.iv, r);
    const ln = Math.log(S / base) - (b * b) / 2 + (a * a) / 2;
    /* NO 25× CAP (the second re-audit, 2026-10-22): a wing's gamma legitimately grows a few hundred times as price walks
       to its strike (NVDA's 230 call, 1 day out: $7M at 212, ~$2B at 230), and the cap froze those legs at their spot
       value, which left jitter crossings on SPY's whole book and moved QQQ's by 1%. G₀ is the vendor's live gamma, so the
       ratio is the contract priced outright. Only rounding noise is guarded (repricedFlip carries it flat). */
    let g = l.g0 * Math.exp(Math.min(ln, 60));
    /* THE PHYSICAL CEILING (the fifth audit, 2026-10-23): Γ·S² of one contract peaks near its strike at
       K·e^(−rT)/(√(2π)·σ·√T); a leg's open interest can hold no more than that many times it. Only on a leg whose vol
       stands in (the smile's or the ATM's): a contract with its own printed vol is priced outright, and capping it
       against a vol the vendor's gamma was not computed at would bend a real curve (AAPL's whole book: 326.0 → 317.7) */
    if (!l.ownIv && l.oi && l.oi > 0) {
      const cap = Math.max(Math.abs(l.g0), (l.oi * l.strike * Math.exp(-r * l.t)) / (SQRT2PI * l.iv * Math.sqrt(l.t)));
      if (Math.abs(g) > cap) g = Math.sign(g) * cap;
    }
    sum += g;
  }
  return sum;
}

/** The flip off re-priced legs: the zero of net gamma across hypothetical spots, nearest spot inside ±10% */
export function repricedFlip(legsIn: readonly GammaLeg[], spot: number, r: number, range: number = RANGE): FlipRead {
  const net0 = legsIn.reduce((a, l) => a + l.g0, 0);
  /* the vendor prints gamma to the cent: a leg within a ten-millionth of the book is rounding, and multiplied by a
     wing's growth it would be noise the size of a strike — such legs are carried flat */
  const gross = legsIn.reduce((a, l) => a + Math.abs(l.g0), 0);
  /* A NEGLIGIBLE LEG CANNOT MOVE THE CROSSING (the fifth audit): one with no vol of its own (the smile's or the ATM
     stand-in) that is under a hundred-thousandth of the book at spot is carried flat too — its growth would rest on a
     vol nobody quoted */
  const legs = legsIn.map(l => (Math.abs(l.g0) < gross * 1e-7 || (!l.ownIv && Math.abs(l.g0) < gross * 1e-5) ? { ...l, iv: 0 } : l));
  if (!(spot > 0) || !legs.length) return { flip: null, netAtSpot: net0, beyond: null, range, method: 'repriced' };
  const lo = spot * (1 - range);
  const hi = spot * (1 + range);
  /* TWO GRIDS (a contract minutes from expiry has a gamma bump well under a dollar wide on a $700 name, while a LEAP's
     barely bends across the whole range): the broad legs are priced on a 240-step grid and read between its points; the
     narrow ones — wider than a few coarse steps they are not — are priced exactly on a grid finer than half the
     narrowest material one, σ·√T·S. Spot is a point of both, so the sign at spot is the book's own net. */
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
  const cy = cx.map(S => netGammaAt(broad, spot, S, r));
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
  const at = (S: number) => (S === spot && ownSpot ? net0 : broadAt(S) + netGammaAt(narrow, spot, S, r));
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
  for (let i = 1; i < xs.length; i++) {
    const y0 = ys[i - 1];
    const y1 = ys[i];
    if (y0 === 0 || y1 === 0 || Math.sign(y0) === Math.sign(y1)) continue;
    /* bisection inside the bracket */
    let a = xs[i - 1];
    let b = xs[i];
    let fa = y0;
    for (let k = 0; k < 28; k++) {
      const m = (a + b) / 2;
      const fm = at(m);
      if (Math.sign(fm) === Math.sign(fa)) {
        a = m;
        fa = fm;
      } else b = m;
    }
    const x = (a + b) / 2;
    const d = Math.abs(x - spot);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return { flip: best, netAtSpot: net0, beyond: best == null ? null : net0 < 0 ? 'short' : 'long', range, method: 'repriced' };
}

/** The fallback when no vol is on hand: the price where the strike-ordered running net (from the lowest strike up)
    crosses zero, nearest spot inside the range */
export function cumulativeFlip(points: readonly { strike: number; net: number }[], spot: number, range: number = RANGE): FlipRead {
  const asc = [...points].sort((a, b) => a.strike - b.strike);
  const net0 = asc.reduce((a, p) => a + p.net, 0);
  let cum = 0;
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i < asc.length; i++) {
    const prev = cum;
    cum += asc[i].net;
    if (i === 0 || prev === 0 || cum === 0 || Math.sign(prev) === Math.sign(cum)) continue;
    /* linear inside the strike that tipped it */
    const k0 = asc[i - 1].strike;
    const k1 = asc[i].strike;
    const x = k0 + ((k1 - k0) * Math.abs(prev)) / (Math.abs(prev) + Math.abs(cum));
    if (Math.abs(x - spot) > spot * range) continue;
    const d = Math.abs(x - spot);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return { flip: best, netAtSpot: net0, beyond: best == null ? null : net0 < 0 ? 'short' : 'long', range, method: 'cumulative' };
}
