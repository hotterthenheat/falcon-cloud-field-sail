/* The implied forward of one expiry, from put-call parity on the chain's own quotes: at each strike near the money
   F_K = K + e^{rT}·(C_mid − P_mid), and the forward is the median of up to four of them. Pure math, no state.

   From the forward, the expiry's implied net carry b = ln(F/S)/T (r − q), and with the rate the implied yield q = r − b.
   Pricing that expiry at q puts the model's forward S·e^{(r−q)T} exactly on the market's, whatever the name pays (a cash
   index has no yield in our data: SPX priced at q = 0 put its January forward 7.9 points too high). American puts (SPY,
   single names) make the parity an approximation, closest at the money and on short expiries. */

export interface ParityPair {
  strike: number;
  callBid: number;
  callAsk: number;
  putBid: number;
  putAsk: number;
}

export interface ParityForward {
  /** The forward, the median of the strikes' parity forwards */
  F: number;
  /** Strikes used (3 or 4) */
  n: number;
  strikes: number[];
  /** The lowest and highest strike forward: their spread is how well the strikes agree */
  lo: number;
  hi: number;
  /** Implied net carry r − q, continuous, annualised on `t` */
  b: number;
  /** Implied yield at `r`: r − b */
  q: number;
  r: number;
  /** Calendar years to the expiry the parity was taken on */
  t: number;
  spot: number;
}

/** A quote fit for a parity mid: two-sided, not crossed, the spread at most 25% of the mid */
const MAX_SPREAD_OF_MID = 0.25;
function mid(bid: number, ask: number): number {
  if (!(bid > 0) || !(ask >= bid) || !Number.isFinite(ask)) return NaN;
  const m = (bid + ask) / 2;
  return (ask - bid) / m <= MAX_SPREAD_OF_MID ? m : NaN;
}

/** The parity forward of one expiry: the `count` strikes nearest the money (S·e^{rT}) with valid call and put quotes (at least 3),
    each strike's F_K, their median. Null with fewer than 3 such strikes, no spot or no time, or a forward more than 10%
    from spot (a broken book). */
export function parityForward(pairs: readonly ParityPair[], spot: number, r: number, t: number, count = 4): ParityForward | null {
  if (!(spot > 0) || !(t > 0) || !Number.isFinite(r)) return null;
  const grow = Math.exp(r * t);
  /* at the money is around the forward, first guessed at the rate alone */
  const atm = spot * grow;
  const usable = pairs
    .map(p => ({ k: p.strike, c: mid(p.callBid, p.callAsk), p: mid(p.putBid, p.putAsk) }))
    .filter(x => x.k > 0 && Number.isFinite(x.c) && Number.isFinite(x.p))
    .sort((a, b) => Math.abs(a.k - atm) - Math.abs(b.k - atm) || a.k - b.k)
    .slice(0, Math.max(3, count));
  if (usable.length < 3) return null;
  const fs = usable.map(x => x.k + grow * (x.c - x.p)).sort((a, b) => a - b);
  const h = fs.length >> 1;
  const F = fs.length % 2 ? fs[h] : (fs[h - 1] + fs[h]) / 2;
  if (!(F > 0) || Math.abs(F / spot - 1) > 0.1) return null;
  const b = Math.log(F / spot) / t;
  return { F, n: fs.length, strikes: usable.map(x => x.k).sort((a, c) => a - c), lo: fs[0], hi: fs[fs.length - 1], b, q: r - b, r, t, spot };
}
