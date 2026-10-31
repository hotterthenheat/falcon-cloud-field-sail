/* Multi-leg structures: the vendor's multi-leg rows, their legs settled to the one set of buys and sells that adds up to
   the net, and the name, risk and read the settled legs give. */

import type { SpreadKind, SpreadLeg, SpreadTrade } from './flowBook';
import { clock, COMPRESSION_CODES, dteFrom, dteOf, expiryLabel, indexLevel, num, nyDateOf, SESSION_OPEN, sessionEndMin, tapeSessionIso, usd } from './traceRows';

/* No exchange breakdown: /option-trades/exchange-breakdown is not on this key (docs/DATA_SOURCES.md). */

/* Each vendor shape name maps to the shape it is (a diagonal is not custom; a time butterfly is a calendar), and the
   vendor's own name rides along spelled out. */
export function spreadKind(strategy: string): SpreadKind {
  const s = strategy.toLowerCase();
  if (s.includes('time_butterfly') || s.includes('calendar')) return 'calendar';
  if (s.includes('diagonal')) return 'diagonal';
  if (s.includes('butterfly')) return 'butterfly';
  if (s.includes('condor')) return 'condor';
  if (s.includes('straddle')) return 'straddle';
  if (s.includes('strangle')) return 'strangle';
  if (s.includes('ratio') || s.includes('frontspread') || s.includes('backspread') || s.includes('ladder')) return 'ratio';
  if (s.includes('vertical')) return 'vertical';
  if (s.includes('risk_reversal')) return 'riskReversal';
  if (s.includes('synthetic')) return 'synthetic';
  return 'custom';
}
export const shapeName = (strategy: string) => {
  const s = strategy.trim().toLowerCase();
  if (!s || s === 'other') return 'unnamed';
  return s.replace(/_/g, ' ');
};

export function spreadLeg(leg: Record<string, unknown>, fallbackExpiry: string, structSize = 1): SpreadLeg {
  const expiryIso = String(leg.expiry || leg.expiration || fallbackExpiry || '').slice(0, 10);
  /* The legs route speaks its own way: `side` is where the leg's print sat, `size` its contracts, the strike in
     thousandths. Direction is settled by resolveLegs, never guessed here. */
  const occ = String(leg.option_symbol || '').match(/(\d{8})$/);
  const rawStrike = num(leg.strike);
  const contracts = num(leg.size) || structSize;
  return {
    side: null,
    ratio: Math.max(1, Math.round(contracts / Math.max(1, structSize))),
    contracts,
    strike: occ ? Number(occ[1]) / 1000 : rawStrike >= 100000 ? rawStrike / 1000 : rawStrike,
    right: String(leg.type || leg.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C',
    expiry: expiryLabel(expiryIso),
    /* the vendor's own days to run where the leg carries them, else from the session */
    dte: leg.dte != null && leg.dte !== '' && Number.isFinite(Number(leg.dte)) ? Math.max(0, Number(leg.dte)) : dteOf(expiryIso),
    fill: num(leg.price || leg.fill || leg.avg_price),
    theta: leg.theta != null ? num(leg.theta) : undefined,
    occ: leg.option_symbol ? String(leg.option_symbol) : undefined,
    volume: leg.volume != null ? num(leg.volume) : undefined,
    oi: leg.open_interest != null ? num(leg.open_interest) : undefined,
    iv: leg.implied_volatility != null ? num(leg.implied_volatility) * 100 : undefined,
    bid: leg.nbbo_bid != null ? num(leg.nbbo_bid) : undefined,
    ask: leg.nbbo_ask != null ? num(leg.nbbo_ask) : undefined,
  };
}

/* A leg's print side is not its direction: directions are settled by the one set of buys and sells whose fills add
   up to the net (within 3%). None or several fits: no direction. */
export function resolveLegs(raw: Record<string, unknown>[], structSize: number, netPremium: number): SpreadLeg[] {
  const base = raw.map(l => spreadLeg(l, '', structSize));
  if (!base.length || !Number.isFinite(netPremium) || netPremium === 0) return base;
  /* the route's leg `size` is the leg's contracts on most rows and its ratio on some (a 2-lot fly's legs read 1 / 2 / 1);
     the money says which: both readings are tried */
  const readings: SpreadLeg[][] = [base];
  if (structSize > 1 && base.some(l => (l.contracts ?? 0) < structSize)) {
    readings.push(base.map(l => ({ ...l, contracts: (l.contracts ?? 1) * structSize, ratio: l.contracts ?? 1 })));
  }
  const tagged = raw.map(l => (String(l.side) === 'ask' ? 1 : String(l.side) === 'bid' ? -1 : 0));
  for (const legs of readings) {
    const fits = (dirs: number[]) => Math.abs(legs.reduce((a, l, i) => a + dirs[i] * l.fill * (l.contracts ?? 1) * 100, 0) - netPremium) <= Math.max(1, Math.abs(netPremium) * 0.03);
    let pick: number[] | null = !tagged.includes(0) && fits(tagged) ? tagged : null;
    if (!pick && legs.length <= 6) {
      const found: number[][] = [];
      for (let m = 0; m < 1 << legs.length; m++) {
        const dirs = legs.map((_, i) => (m & (1 << i) ? -1 : 1));
        if (fits(dirs)) found.push(dirs);
        if (found.length > 1) break;
      }
      if (found.length === 1) pick = found[0];
    }
    if (pick) return legs.map((l, i) => ({ ...l, side: pick![i] > 0 ? 'BUY' : 'SELL' }));
  }
  return base;
}

/* A day of theta cannot take more than the position is worth: each leg's day is capped at its own fill, and the
   position's at the debit paid or credit collected. */
export function positionThetaCapped(legs: SpreadLeg[], netPremium?: number): { value: number; capped: boolean } | null {
  if (!legs.length || legs.some(l => l.side == null || l.theta == null)) return null;
  let capped = false;
  let v = legs.reduce((a, l) => {
    const rate = l.theta as number;
    const fill = Number.isFinite(l.fill) && l.fill > 0 ? l.fill : Infinity;
    const day = Math.abs(rate) > fill ? Math.sign(rate) * fill : rate;
    if (day !== rate) capped = true;
    return a + (l.side === 'BUY' ? 1 : -1) * day * (l.contracts ?? 1) * 100;
  }, 0);
  if (netPremium != null && Number.isFinite(netPremium) && netPremium !== 0) {
    const worth = Math.abs(netPremium);
    /* a bought structure loses to time at most what it cost; a sold one gains at most what it collected */
    if (netPremium > 0 && v < -worth) {
      v = -worth;
      capped = true;
    } else if (netPremium < 0 && v > worth) {
      v = worth;
      capped = true;
    }
  }
  return { value: v, capped };
}

/** Profit and loss at expiry from settled legs on ONE expiry: the payoff is piecewise straight between strikes, so its
    extremes sit at a strike, at zero, or run off past the top strike (the slope there). */
export function payoffRange(legs: SpreadLeg[], netPremium: number): { maxLoss: number | 'uncapped'; maxProfit: number | 'uncapped' } | null {
  if (!legs.length || legs.some(l => l.side == null) || new Set(legs.map(l => l.expiry)).size !== 1) return null;
  const at = (S: number) =>
    legs.reduce((a, l) => {
      const intrinsic = l.right === 'C' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      return a + (l.side === 'BUY' ? 1 : -1) * intrinsic * (l.contracts ?? 1) * 100;
    }, 0) - netPremium;
  const strikes = [...new Set(legs.map(l => l.strike))].sort((x, y) => x - y);
  const pts = [0, ...strikes].map(at);
  const top = strikes[strikes.length - 1];
  const slope = at(top * 2 + 1) - at(top * 2);
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  return {
    maxLoss: slope < -1e-9 ? 'uncapped' : Math.max(0, -Math.min(lo, at(top * 2))),
    maxProfit: slope > 1e-9 ? 'uncapped' : Math.max(0, Math.max(hi, at(top * 2))),
  };
}

/* One structure from its own legs (net_price is wrong on ratio'd shapes): size is units (the legs' GCD), net is net
   premium over units × 100, risk the legs' expiry payoff. */

export const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
/** The P&L at expiry of settled legs on one expiry, at underlying S, dollars */
export function payoffAt(legs: SpreadLeg[], netPremium: number): (S: number) => number {
  return (S: number) =>
    legs.reduce((a, l) => {
      const intrinsic = l.right === 'C' ? Math.max(0, S - l.strike) : Math.max(0, l.strike - S);
      return a + (l.side === 'BUY' ? 1 : -1) * intrinsic * (l.contracts ?? 1) * 100;
    }, 0) - netPremium;
}

/* The shape's canonical signs, used only when the vendor left the net out and no leg settles: the net's size is the
   same either way round, so the row can still say it; the way stays unknown. */
export function canonicalDirs(kind: SpreadKind, legs: SpreadLeg[]): number[] | null {
  const n = legs.length;
  if (n === 2) return kind === 'straddle' || kind === 'strangle' ? [1, 1] : kind === 'ratio' || kind === 'custom' ? null : [1, -1];
  const strikes = legs.map(l => l.strike);
  const lo = Math.min(...strikes);
  const hi = Math.max(...strikes);
  if (n === 3 && kind === 'butterfly' && new Set(legs.map(l => l.right)).size === 1 && new Set(strikes).size === 3) {
    const sorted = [...legs].sort((a, b) => a.strike - b.strike);
    const [w1, b, w2] = sorted.map(l => l.contracts ?? 1);
    if (w1 !== w2 || b !== 2 * w1) return null;
    return legs.map(l => (l.strike === lo || l.strike === hi ? 1 : -1));
  }
  /* a double calendar (two strikes, each on a near and a far expiry, one right, equal sizes): near one way, far the
     other — the net's size is the same whichever way it went */
  if (n === 4 && new Set(legs.map(l => l.right)).size === 1 && new Set(legs.map(l => l.expiry)).size === 2 && new Set(strikes).size === 2 && new Set(legs.map(l => l.contracts ?? 1)).size === 1) {
    const far = Math.max(...legs.map(l => l.dte));
    return legs.map(l => (l.dte === far ? 1 : -1));
  }
  if (n === 4 && (kind === 'condor' || kind === 'butterfly')) {
    if (strikes.filter(k => k === lo).length !== 1 || strikes.filter(k => k === hi).length !== 1) return null;
    if (new Set(legs.map(l => l.contracts ?? 1)).size !== 1) return null;
    return legs.map(l => (l.strike === lo || l.strike === hi ? 1 : -1));
  }
  return null;
}

export const strikeWord = (k: number) => (Number.isInteger(k) ? String(k) : k.toFixed(2));
/** "7650" / "7650–7675" */
export function whereOf(at: { kind: 'below' | 'above' | 'strikes' | 'falls' | 'rises' | 'outside' | 'anywhere'; a?: number; b?: number }): string {
  if (at.kind === 'anywhere') return 'wherever it settles';
  if (at.kind === 'outside') return `at or below ${strikeWord(at.a!)} or at or above ${strikeWord(at.b!)}`;
  if (at.kind === 'below') return `below ${strikeWord(at.a!)}`;
  if (at.kind === 'above') return `above ${strikeWord(at.a!)}`;
  if (at.kind === 'falls') return 'the further it falls';
  if (at.kind === 'rises') return 'the further it rises';
  return at.a === at.b ? `at ${strikeWord(at.a!)}` : `between ${strikeWord(at.a!)} and ${strikeWord(at.b!)}`;
}

/* The sentence comes from the settled legs: what was bought and sold, the money, where the expiry payoff is best and
   worst, and which way it gains. */
/** A shape's name without its directional verdict — "bull put spread" → "put spread", "bullish risk reversal" → "risk
    reversal" — for a structure that is shown but not read (a compression package, an after-hours fill) */
export function neutralShape(name: string): string {
  return name.replace(/\b(bullish|bearish|bull|bear)\s+/gi, '').trim();
}

export function describeStructure(legs: SpreadLeg[], netPremium: number, units: number, unread = false): string {
  if (!legs.length) return '';
  if (legs.some(l => l.side == null)) return 'The record does not say which legs were bought and which were sold — no single set of buys and sells adds up to its net — so its risk is not drawn. Read the legs.';
  const word = (l: SpreadLeg) => `${l.contracts ?? 1} ${strikeWord(l.strike)} ${l.right === 'C' ? 'call' : 'put'}${(l.contracts ?? 1) === 1 ? '' : 's'}`;
  const bought = legs.filter(l => l.side === 'BUY').map(word);
  const sold = legs.filter(l => l.side === 'SELL').map(word);
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
  const strikes = [...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const lo = strikes[0];
  const hi = strikes[strikes.length - 1];
  let lead = `${bought.length ? `Bought ${list(bought)}` : ''}${bought.length && sold.length ? '; ' : ''}${sold.length ? `${bought.length ? 'sold' : 'Sold'} ${list(sold)}` : ''}`;
  const one = new Set(legs.map(l => l.right)).size === 1 ? (legs[0].right === 'C' ? 'call' : 'put') : '';
  if (legs.length === 3 && one && strikes.length === 3) {
    const wingsBought = legs.filter(l => l.strike === lo || l.strike === hi).every(l => l.side === 'BUY');
    const bodySold = legs.filter(l => l.strike !== lo && l.strike !== hi).every(l => l.side === 'SELL');
    if (wingsBought && bodySold) lead = `A long ${one} butterfly — the ${strikeWord(lo)} and ${strikeWord(hi)} wings bought, the ${strikeWord(strikes[1])} body sold`;
    else if (!wingsBought && !bodySold && legs.filter(l => l.strike === lo || l.strike === hi).every(l => l.side === 'SELL')) lead = `A short ${one} butterfly — the ${strikeWord(lo)} and ${strikeWord(hi)} wings sold, the ${strikeWord(strikes[1])} body bought`;
  }
  /* the money in words, never a sign to decode: "collected $3.90 a unit ($780 in all)", "paid $29.80 a unit" */
  const money = netPremium === 0 ? '' : ` — ${netPremium > 0 ? 'paid' : 'collected'} $${(Math.abs(netPremium) / (Math.max(1, units) * 100)).toFixed(2)}${units > 1 ? ` a unit on ${units} units (${usd(Math.abs(netPremium))} in all)` : ''}`;
  if (new Set(legs.map(l => l.expiry)).size !== 1) {
    return `${lead}${money}. Its legs run to different expiries, so what it is worth at the near one depends on the far leg's price then — no expiry payoff is drawn.`;
  }
  const pnl = payoffAt(legs, netPremium);
  const far = hi * 2 + 1;
  const deep = pnl(0);
  const atLo = pnl(lo);
  const atHi = pnl(hi);
  const top = pnl(far);
  const eps = Math.max(1, Math.abs(netPremium) * 0.001);
  const pts = strikes.map(k => ({ k, v: pnl(k) }));
  const best = Math.max(deep, top, ...pts.map(p => p.v));
  const worst = Math.min(deep, top, ...pts.map(p => p.v));
  const locate = (target: number): Parameters<typeof whereOf>[0] => {
    const hitDeep = Math.abs(deep - target) <= eps;
    const hitTop = Math.abs(top - target) <= eps;
    if (hitTop && Math.abs(atHi - target) > eps) return { kind: 'rises' };
    if (hitDeep && Math.abs(atLo - target) > eps) return { kind: 'falls' };
    if (hitDeep && hitTop) {
      /* flat at both ends: the low run of strikes that hit, and the high run — "below 7690 or above 7750" */
      let a = -1;
      while (a + 1 < pts.length && Math.abs(pts[a + 1].v - target) <= eps) a++;
      let b = pts.length;
      while (b - 1 > a && Math.abs(pts[b - 1].v - target) <= eps) b--;
      if (b <= a + 1) return { kind: 'anywhere' };
      return { kind: 'outside', a: pts[a].k, b: pts[b].k };
    }
    if (hitDeep && !hitTop) return { kind: 'below', a: pts.filter(p => Math.abs(p.v - target) <= eps).map(p => p.k).pop() ?? lo };
    if (hitTop && !hitDeep) return { kind: 'above', a: pts.filter(p => Math.abs(p.v - target) <= eps).map(p => p.k)[0] ?? hi };
    const at = pts.filter(p => Math.abs(p.v - target) <= eps).map(p => p.k);
    return { kind: 'strikes', a: at[0] ?? lo, b: at[at.length - 1] ?? hi };
  };
  const bestAt = locate(best);
  const worstAt = locate(worst);
  const sign = (v: number) => (v >= 0 ? `+${usd(v)}` : usd(v));
  const bestWords = bestAt.kind === 'rises' || bestAt.kind === 'falls' ? `gains without a cap ${whereOf(bestAt)}` : `makes most (${sign(best)}) ${whereOf(bestAt)}`;
  const worstWords =
    worstAt.kind === 'rises' && deep < -eps
      ? `loses on a big move either way — without a cap on a rise, ${sign(deep)} if it went to zero`
      : worstAt.kind === 'rises' || worstAt.kind === 'falls'
        ? `loses without a cap ${whereOf(worstAt)}`
        : `loses most (${sign(worst)}) ${whereOf(worstAt)}`;
  /* The shape's way first: a payoff that peaks inside its strikes bets on where it settles, one that troughs pays on
     a move, but only on a side where the payoff past the wing is a gain. */
  const pctOfLoss = (v: number) => (worst < 0 ? `${Math.round((Math.abs(v) / Math.abs(worst)) * 100)}% of the max loss` : '');
  const way = (() => {
    if (best > Math.max(deep, top) + eps) return `a bet that the name settles ${bestAt.kind === 'strikes' ? (bestAt.a === bestAt.b ? `near ${strikeWord(bestAt.a!)}` : whereOf(bestAt)) : `near ${strikeWord(lo)}`}`;
    if (worst < Math.min(deep, top) - eps) {
      const downPays = deep > eps;
      const upPays = top > eps;
      if (downPays && upPays) return 'a bet on a move away, either way';
      if (downPays) return `a bet on a fall — ${sign(deep)} at or below ${strikeWord(lo)}, while a rise to ${strikeWord(hi)} or beyond still loses ${usd(Math.abs(top))}${top < -eps ? ` (${pctOfLoss(top)})` : ''}`;
      if (upPays) return `a bet on a rise — ${sign(top)} at or above ${strikeWord(hi)}, while a fall to ${strikeWord(lo)} or below still loses ${usd(Math.abs(deep))}${deep < -eps ? ` (${pctOfLoss(deep)})` : ''}`;
      return `it loses wherever it settles at expiry — least on a ${deep > top ? 'fall' : 'rise'}`;
    }
    if (top > deep + eps) return 'it gains on a rise';
    if (deep > top + eps) return 'it gains on a fall';
    return 'its payoff is flat';
  })();
  /* a structure shown but not read (compression, after hours) keeps its payoff and drops the verdict */
  return unread ? `${lead}${money}. At expiry it ${bestWords} and ${worstWords}.` : `${lead}${money}. At expiry it ${bestWords} and ${worstWords} — ${way}.`;
}

/* The name comes from settled legs on one expiry (or a two-leg calendar / diagonal); otherwise the vendor's, kept
   beside the legs' name when the two disagree. */
export function nameFromLegs(legs: SpreadLeg[]): { name: string; kind: SpreadKind } | null {
  if (!legs.length || legs.some(l => l.side == null)) return null;
  const B = (l: SpreadLeg) => l.side === 'BUY';
  const by = (xs: SpreadLeg[]) => [...xs].sort((a, b) => a.strike - b.strike);
  const rw = (r: 'C' | 'P') => (r === 'C' ? 'call' : 'put');
  const eq = new Set(legs.map(l => l.contracts ?? 1)).size === 1;
  if (new Set(legs.map(l => l.expiry)).size > 1) {
    if (legs.length === 2 && legs[0].right === legs[1].right && B(legs[0]) !== B(legs[1])) return legs[0].strike === legs[1].strike ? { name: `${rw(legs[0].right)} calendar`, kind: 'calendar' } : { name: `${rw(legs[0].right)} diagonal`, kind: 'diagonal' };
    return null;
  }
  const calls = by(legs.filter(l => l.right === 'C'));
  const puts = by(legs.filter(l => l.right === 'P'));
  if (legs.length === 2) {
    if (calls.length === 2 || puts.length === 2) {
      const [a, b] = calls.length === 2 ? calls : puts;
      if (a.strike === b.strike || B(a) === B(b)) return null;
      if (!eq) return { name: `${rw(a.right)} ratio spread`, kind: 'ratio' };
      const bull = a.right === 'C' ? B(a) : !B(b);
      return { name: `${bull ? 'bull' : 'bear'} ${rw(a.right)} spread`, kind: 'vertical' };
    }
    const c = calls[0];
    const q = puts[0];
    if (B(c) === B(q)) return c.strike === q.strike ? { name: `${B(c) ? 'long' : 'short'} straddle`, kind: 'straddle' } : { name: `${B(c) ? 'long' : 'short'} strangle`, kind: 'strangle' };
    if (c.strike === q.strike) return { name: B(c) ? 'synthetic long' : 'synthetic short', kind: 'synthetic' };
    return { name: B(c) ? 'bullish risk reversal' : 'bearish risk reversal', kind: 'riskReversal' };
  }
  if (legs.length === 3 && (calls.length === 3 || puts.length === 3)) {
    const [a, m, b] = calls.length === 3 ? calls : puts;
    if (new Set([a.strike, m.strike, b.strike]).size !== 3) return null;
    const ca = a.contracts ?? 1;
    const cm = m.contracts ?? 1;
    const cb = b.contracts ?? 1;
    if (B(a) === B(b) && B(a) !== B(m)) {
      if (cb === ca && cm === 2 * ca) return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} butterfly${m.strike - a.strike !== b.strike - m.strike ? ' (uneven wings)' : ''}`, kind: 'butterfly' };
      if (cm === ca + cb) return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} ratio butterfly`, kind: 'butterfly' };
      return null;
    }
    /* a ladder: the leg nearest the money on one side, the two further out on the other, equal sizes */
    const near = a.right === 'C' ? a : b;
    const far = a.right === 'C' ? [m, b] : [a, m];
    if (eq && B(far[0]) === B(far[1]) && B(near) !== B(far[0])) return { name: `${B(near) ? 'long' : 'short'} ${rw(a.right)} ladder`, kind: 'ratio' };
    return null;
  }
  if (legs.length === 4 && calls.length === 2 && puts.length === 2 && eq) {
    const [cl, ch] = calls;
    const [pl, ph] = puts;
    if (cl.strike === ch.strike || pl.strike === ph.strike || B(cl) === B(ch) || B(pl) === B(ph)) return null;
    const callBull = B(cl);
    const putBull = !B(ph);
    const uneven = ph.strike - pl.strike !== ch.strike - cl.strike ? ' (uneven wings)' : '';
    if (ph.strike <= cl.strike && putBull !== callBull) {
      const short = putBull && !callBull;
      return ph.strike === cl.strike ? { name: `${short ? 'short' : 'long'} iron butterfly${uneven}`, kind: 'butterfly' } : { name: `${short ? 'short' : 'long'} iron condor${uneven}`, kind: 'condor' };
    }
    if (pl.strike === cl.strike && ph.strike === ch.strike && callBull !== putBull) return { name: callBull ? 'long box' : 'short box', kind: 'custom' };
    if (callBull === putBull) return { name: `${callBull ? 'bullish' : 'bearish'} call + put spreads`, kind: 'vertical' };
    return null;
  }
  if (legs.length === 4 && (calls.length === 4 || puts.length === 4) && eq) {
    const [a, b, c, d] = calls.length === 4 ? calls : puts;
    if (new Set([a.strike, b.strike, c.strike, d.strike]).size !== 4 || B(a) !== B(d) || B(b) !== B(c) || B(a) === B(b)) return null;
    return { name: `${B(a) ? 'long' : 'short'} ${rw(a.right)} condor`, kind: 'condor' };
  }
  return null;
}

/** A double calendar is a shape whatever way it went (two strikes, near and far, one right, equal sizes), so it is
    named even unsettled */
export function doubleCalendarOf(legs: SpreadLeg[]): { name: string; kind: SpreadKind } | null {
  if (legs.length !== 4 || new Set(legs.map(l => l.right)).size !== 1 || new Set(legs.map(l => l.expiry)).size !== 2 || new Set(legs.map(l => l.strike)).size !== 2) return null;
  if (new Set(legs.map(l => l.contracts ?? 1)).size !== 1) return null;
  return { name: `${legs[0].right === 'C' ? 'call' : 'put'} double calendar`, kind: 'calendar' };
}

/* The vendor's name checked against the legs: a settled set with no textbook shape says what it did ("2 puts
   bought"); an unsettled one keeps the vendor's word, corrected where strikes or money prove it wrong. */
export function vendorChecked(vendor: string, legs: SpreadLeg[], net: number): { name: string; kind?: SpreadKind; by: 'legs' | 'vendor' } | null {
  if (!legs.length) return null;
  const v = vendor === 'unnamed' ? '' : vendor;
  const rights = new Set(legs.map(l => l.right));
  const strikes = [...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const settled = legs.every(l => l.side != null);
  if (settled) {
    const sides = new Set(legs.map(l => l.side));
    if (sides.size === 1) {
      const way = legs[0].side === 'BUY' ? 'bought' : 'sold';
      const what = rights.size === 1 ? (legs[0].right === 'C' ? 'calls' : 'puts') : 'calls and puts';
      const exp = new Set(legs.map(l => l.expiry)).size;
      return { name: `${what} ${way} · ${exp > 1 ? `${exp} expiries` : `${strikes.length} strikes`}`, kind: 'custom', by: 'legs' };
    }
    /* settled, but no textbook shape: what the legs did, never the vendor's word unchecked (a "iron condor" that bought
       two puts and a call against one call sold) */
    const nb = legs.filter(l => l.side === 'BUY').length;
    return { name: `custom · ${nb} bought, ${legs.length - nb} sold`, kind: 'custom', by: 'legs' };
  }
  if (/butterfly/.test(v) && !/iron/.test(v) && legs.length === 3 && rights.size === 1 && strikes.length === 3 && strikes[1] - strikes[0] !== strikes[2] - strikes[1] && !/uneven/.test(v)) return { name: `${v} (uneven wings)`, by: 'vendor' };
  if (/iron (condor|butterfly)/.test(v) && !/\b(long|short)\b/.test(v) && net !== 0) return { name: `${net > 0 ? 'long' : 'short'} ${v}`, by: 'vendor' };
  return null;
}

/** Off by more than 2% (and $5) of the larger figure */
export const offBy = (a: number | 'uncapped', b: number | 'uncapped') => (a === 'uncapped' || b === 'uncapped' ? a !== b : Math.abs(a - b) > Math.max(5, 0.02 * Math.max(Math.abs(a), Math.abs(b))));
/** The settled legs disagree with the vendor: its stated risk when it gave a direction, else its family */
export function contradictsVendor(t: SpreadTrade, range: { maxLoss: number | 'uncapped'; maxProfit: number | 'uncapped' } | null, legsKind: SpreadKind): boolean {
  const vk = t.vendorKind ?? t.kind;
  if (t.vendorDirection === 'unknown') return vk !== 'custom' && legsKind !== vk;
  if (!range || !t.vendorRisk) return false;
  return offBy(range.maxLoss, t.vendorRisk.loss) || offBy(range.maxProfit, t.vendorRisk.profit);
}

/** A structure settled from its raw legs (the legs route's rows; 'none' when it has none; undefined while unread) */
export function settleSpreadWith(t: SpreadTrade, raw: Record<string, unknown>[] | 'none' | undefined): SpreadTrade {
  if (raw === undefined) return t.legsState === 'in' ? t : { ...t, legsState: 'pending' };
  if (raw === 'none') return { ...t, legsState: 'none' };
  const known = t.netKnown !== false && Number.isFinite(t.netPremium) && t.netPremium !== 0;
  let legs = known ? resolveLegs(raw, t.size, t.netPremium) : raw.map(l => spreadLeg(l, '', t.size));
  /* the route's leg size is the leg's contracts (the multi-leg row's `size` is its largest leg) */
  const units = Math.max(1, legs.reduce((g, l) => gcd(g, Math.round(l.contracts ?? 1)), 0));
  legs = legs.map(l => ({ ...l, ratio: Math.max(1, Math.round((l.contracts ?? units) / units)) }));
  const settled = legs.every(l => l.side != null);
  const oneExpiry = new Set(legs.map(l => l.expiry)).size === 1;
  const range = settled && known && oneExpiry ? payoffRange(legs, t.netPremium) : null;
  let netAbs: number | undefined;
  if (!known) {
    const dirs = canonicalDirs(t.kind, legs);
    if (dirs) netAbs = Math.abs(legs.reduce((a, l, i) => a + dirs[i] * l.fill * (l.contracts ?? 1) * 100, 0));
  }
  const ratioLabel = legs.length ? [...legs].sort((a, b) => a.strike - b.strike || a.right.localeCompare(b.right)).map(l => `${l.side === 'BUY' ? 'B' : l.side === 'SELL' ? 'S' : ''}${l.ratio}`).join('/') : undefined;
  /* every distinct strike the legs carry (the vendor's strikes list had 2 for a 4-leg structure) and the name the
     settled legs give it */
  const legStrikes = [...new Set(legs.map(l => l.strike))].sort((a, b) => a - b);
  const vendor0 = t.shapeOfVendor ?? t.shape;
  const fromLegs = settled ? nameFromLegs(legs) : doubleCalendarOf(legs);
  const checked = fromLegs ? null : vendorChecked(vendor0, legs, known ? t.netPremium : 0);
  const named0 = fromLegs ?? (checked ? { name: checked.name, kind: checked.kind ?? t.kind } : null);
  const namedBy: 'legs' | 'vendor' = fromLegs || checked?.by === 'legs' ? 'legs' : 'vendor';
  /* A compression package or an after-hours fill keeps its shape's name without bull or bear */
  const unread = !!t.compression || !!t.extended;
  const named = named0 && unread ? { ...named0, name: neutralShape(named0.name) } : named0;
  const vendor = t.shapeOfVendor ?? t.shape;
  const unverified = contradictsVendor(t, range, named?.kind ?? t.kind) || undefined;
  const sideTagged = raw.filter(l => String(l.side) === 'ask' || String(l.side) === 'bid').length;
  return {
    ...t,
    strikesLabel: legStrikes.length ? legStrikes.map(k => strikeWord(k)).join(' / ') : t.strikesLabel,
    shape: named ? named.name : t.shape,
    kind: named ? named.kind : t.kind,
    vendorShape: named && vendor !== 'unnamed' && !named.name.includes(vendor) ? vendor : undefined,
    namedBy,
    legs,
    units,
    contracts: legs.reduce((a, l) => a + (l.contracts ?? 0), 0),
    ratioLabel,
    net: known ? t.netPremium / (units * 100) : 0,
    netAbs,
    maxLoss: range ? range.maxLoss : null,
    maxProfit: range ? range.maxProfit : null,
    riskNote: !settled ? 'unsettled' : !oneExpiry ? 'expiries' : !known ? 'no-net' : undefined,
    unverified,
    ...(() => {
      const th = positionThetaCapped(legs, known ? t.netPremium : undefined);
      return { theta: th ? th.value : NaN, thetaCapped: th?.capped || undefined };
    })(),
    /* what the legs' side tags say: the count, and why a partial set cannot settle it */
    read: known
      ? `${describeStructure(legs, t.netPremium, units, unread)}${t.compression ? ` A compression package (OPRA ${t.code ?? 'cbmo'}) — a floor package that nets open interest down between members, not a bet: shown, never read bullish or bearish.` : t.extended ? ' Filled after hours, against thin post-market quotes — the shape is shown, not read for direction.' : ''}`
      : `The vendor left the net out${sideTagged === 0 ? ' and its legs print no side' : sideTagged < raw.length ? `, and only ${sideTagged} of its ${raw.length} legs print a side` : ''}, so which way it went is not known — a leg's print side is where it filled, not whether the structure was bought or sold.${netAbs != null ? ` Its legs net ${usd(netAbs)}${units > 1 ? ` (${units} units, $${(netAbs / (units * 100)).toFixed(2)} a unit)` : ''} either way — paid if it was bought, collected if it was sold.` : ' What it risks is not on the record. Read the legs.'}`,
    legsState: 'in',
  };
}

export function spreadOf(row: Record<string, unknown>): SpreadTrade {
  const ticker = String(row.ticker || '').toUpperCase();
  const when = clock(row.executed_at);
  const strikes = Array.isArray(row.strikes) ? row.strikes.map(s => num(s)).filter(n => n > 0) : [];
  const size = num(row.size) || 1;
  const strategy = String(row.strategy || '');
  const kind = spreadKind(strategy);
  const netKnown = row.net_premium != null && row.net_premium !== '';
  const netPremium = netKnown ? num(row.net_premium) : 0;
  /* no legs on the row (txns is a count) — the legs come from the legs route; the row carries its strikes and its near
     expiry, the trade's own New York day plus its days to run */
  const dteAtTrade = num(row.min_dte);
  const tradeDay = when.epoch > 0 ? nyDateOf(when.epoch * 1000) : '';
  const expiryIso = tradeDay ? new Date(Date.parse(`${tradeDay}T00:00:00Z`) + dteAtTrade * 86_400_000).toISOString().slice(0, 10) : '';
  const code = String(row.code || '').toLowerCase();
  const dir = String(row.direction || '');
  const vendorDirection = dir === 'long' || dir === 'short' || dir === 'unknown' ? dir : undefined;
  /* the vendor's max_loss is negative dollars; a null max_profit beside a stated loss is uncapped */
  const vLoss = row.max_loss != null && row.max_loss !== '' ? Math.abs(num(row.max_loss)) : null;
  const vendorRisk = vendorDirection && vendorDirection !== 'unknown' && vLoss != null ? { loss: vLoss, profit: row.max_profit != null && row.max_profit !== '' ? Math.abs(num(row.max_profit)) : ('uncapped' as const) } : null;
  /* the far leg's expiry, from max_dte */
  const farDte = row.max_dte != null && row.max_dte !== '' ? num(row.max_dte) : dteAtTrade;
  const farIso = tradeDay && farDte > dteAtTrade ? new Date(Date.parse(`${tradeDay}T00:00:00Z`) + farDte * 86_400_000).toISOString().slice(0, 10) : '';
  return {
    id: String(row.id || `${ticker}-${when.epoch}-${strikes.join('-')}`),
    /* OPRA's condition on the structure (mlet, mlat, cbmo…); cbmo / mctp is a compression package, not a bet */
    code: code || undefined,
    compression: COMPRESSION_CODES.has(code) || undefined,
    minute: when.minute,
    day: tradeDay || undefined,
    epochMs: when.ms || undefined,
    extended: when.minute > 0 && (when.minute < SESSION_OPEN || when.minute >= sessionEndMin(ticker)) ? true : undefined,
    time: when.time,
    ticker,
    kind,
    vendorKind: kind,
    vendorDirection,
    vendorRisk,
    shape: shapeName(strategy),
    shapeOfVendor: shapeName(strategy),
    strikesLabel: strikes.length ? strikes.join(' / ') : '—',
    expiry: expiryIso ? expiryLabel(expiryIso) : '—',
    farExpiry: farIso ? expiryLabel(farIso) : undefined,
    farDte: farIso ? farDte : undefined,
    /* the vendor's min_dte, counted from the trade's own day */
    dte: row.min_dte != null && row.min_dte !== '' ? dteAtTrade : expiryIso ? dteFrom(expiryIso, tradeDay || tapeSessionIso()) : 0,
    /* the vendor's size is its largest leg — the units come from the legs (settleSpread) */
    size,
    net: 0,
    netKnown,
    netPremium,
    /* the gross of every leg's money — the hover's "across every leg"; the net is netPremium */
    premium: num(row.total_premium),
    maxLoss: null,
    maxProfit: null,
    iv: num(row.avg_iv) * 100,
    delta: num(row.net_delta),
    theta: NaN,
    spot: num(row.underlying_price) || indexLevel(ticker),
    legs: [],
    legCount: num(row.leg_count) || undefined,
    legsState: 'pending',
    namedBy: 'vendor',
  };
}

/* One structure once: the vendor can send the same structure under two ids, so rows fold by id, then by ticker,
   second, strategy, strikes, size and money; the repeat count rides on the row. */
export function dedupeSpreads(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byKey = new Map<string, Record<string, unknown>>();
  const ids = new Set<string>();
  for (const r of rows) {
    const id = String(r.id ?? '');
    if (id && ids.has(id)) continue;
    if (id) ids.add(id);
    const k = [r.ticker, r.executed_at, r.strategy, Array.isArray(r.strikes) ? r.strikes.join('/') : '', r.size, r.net_premium, r.total_premium, r.leg_count].join('|');
    const had = byKey.get(k);
    if (had) had.__repeats = num(had.__repeats) + 1;
    else byKey.set(k, { ...r });
  }
  return [...byKey.values()];
}

