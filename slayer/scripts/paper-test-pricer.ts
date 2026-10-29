/*
  A made-up option market for the paper engine's proof (scripts/paper-proof.ts): Black-Scholes at a flat vol with a
  spread that widens away from the money, and a vertical spread at its legs' natural prices. Test input only — the
  desk's quotes are ThetaData's (data/paper/feed.ts).
*/

import { blackScholesGreeks, blackScholesPrice } from '../src/core/greeks';
import { longLeg, spreadWidth, type ContractId, type Quote } from '../src/data/review/quotes';

const cents = (v: number) => Math.round(v * 100) / 100;

export function priceWith(c: ContractId, spot: number, t: number, iv: number): Quote {
  if (c.short != null) return spreadQuote(c, spot, t, iv);
  const intrinsic = Math.max(0, c.right === 'C' ? spot - c.strike : c.strike - spot);
  if (t <= 0) {
    const v = cents(intrinsic);
    return { bid: v, ask: v, mark: v, iv: 0, delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, intrinsic: v, dead: false, spot };
  }
  const mark = Math.max(intrinsic, blackScholesPrice(spot, c.strike, t, iv, c.right));
  const g = blackScholesGreeks(spot, c.strike, t, iv);
  const far = Math.min(1, Math.abs(Math.log(c.strike / spot)) / Math.max(0.02, iv * Math.sqrt(t) * 2));
  const half = Math.max(0.01, mark * (0.008 + 0.05 * far));
  const bid = cents(Math.max(0, mark - half));
  const ask = cents(Math.max(bid + 0.01, mark + half));
  const dayOn = Math.max(0, t - 1 / 252);
  const theta = (dayOn > 0 ? blackScholesPrice(spot, c.strike, dayOn, iv, c.right) : intrinsic) - mark;
  return { bid, ask, mark: cents((bid + ask) / 2), iv, delta: c.right === 'C' ? g.deltaCall : g.deltaPut, gamma: g.gamma, theta, vega: g.vega, rho: c.right === 'C' ? g.rhoCall : g.rhoPut, intrinsic: cents(intrinsic), dead: bid <= 0, spot };
}

function spreadQuote(c: ContractId, spot: number, t: number, iv: number): Quote {
  const bought = priceWith(longLeg(c), spot, t, iv);
  const sold = priceWith({ ...longLeg(c), strike: c.short! }, spot, t, iv);
  const width = spreadWidth(c);
  const inside = (v: number) => Math.max(0, Math.min(width, v));
  const intrinsic = cents(inside(bought.intrinsic - sold.intrinsic));
  if (t <= 0) return { ...bought, bid: intrinsic, ask: intrinsic, mark: intrinsic, intrinsic, delta: 0, dead: false };
  const bid = cents(inside(bought.bid - sold.ask));
  const ask = cents(Math.max(bid + 0.01, inside(bought.ask - sold.bid)));
  return { ...bought, bid, ask, mark: cents((bid + ask) / 2), delta: bought.delta - sold.delta, intrinsic, dead: bought.dead || bid <= 0 };
}
