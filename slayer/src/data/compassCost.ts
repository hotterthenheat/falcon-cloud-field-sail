/* What a long call or put costs to hold, and the move it needs to pay that back (owner, 2026-11-07: "it should risk the
   con that makes the most sense, not one with the most delta or most volume or anything hard-coded").

   For one contract at the moment of a call, from its live quote and nothing assumed beyond Black-Scholes repricing:
     round trip   ask in, bid out: the spread, ask − bid, per share, as the quote stands
     horizon h    from the call to its flat (the latest the model's rules hold it), on the trading-time clock
                  (compassParams.tradingMinutesTo)
     priced move  ATM IV × √h: the move the option market prices over h (the research's unit, PROTOCOL §4 Z)
     level        the underlying level S* at the flat where the contract's bid (repriced at its own IV with the time
                  then left, less half the spread now quoted) equals the ask paid: "needs SPX ≥ S* by 15:55"
     z            that move, sign-aligned (+ the way the contract pays), in priced moves: ln(S* ÷ S) / (ATM IV × √h)
     mu           the mean of the sign-aligned move, in priced moves, at which the expected exit bid equals the ask,
                  with the move Normal around that mean at the priced size (one priced move a standard deviation).
                  It is the contract's own break-even edge: the per-contract version of the research hurdle E[za]*
                  (research/edge0dte/results/HURDLE.md). The smaller it is, the less the model has to be right on
                  average for that contract to pay back what it costs; it counts the spread, the decay to the flat
                  and the contract's vol against the ATM vol, per unit of what the contract pays per move.
   The choice (costPick): among the contracts the model's own rule allows, the one with the smallest mu. No cap, no
   floor and no gate: a call is never blocked here, and a contract this cannot read leaves the choice to the score.
   Every number is CALC on the observed quote; nothing here is a forecast. */

import { blackScholesGreeks, blackScholesPrice, impliedVolFromPrice } from '../core/greeks';
import { Q, R, SESSION_MIN, YEAR_SESSIONS, lotteryShape, strikeDistance, tradingMinutesTo } from './compassParams';
import type { OptionRight } from '../types/compass';

export interface CostQuote {
  strike: number;
  right: OptionRight;
  bid: number;
  ask: number;
  /** The contract's expiration, YYYY-MM-DD */
  expiryDate: string;
}

export interface CostRead {
  /** Ask − bid per share at the live quote: what a round trip at this quote gives up */
  roundTrip: number;
  /** The underlying level at `by` where the exit bid pays back the ask */
  level: number;
  /** The horizon's end: the call's flat, epoch ms */
  by: number;
  /** The move to `level`, sign-aligned, in priced moves (ATM IV × √h) */
  z: number;
  /** The mean sign-aligned move, in priced moves, at which the expected exit bid equals the ask */
  mu: number;
  /** The ATM IV the priced move uses */
  atmIv: number;
  /** The contract's own IV, from its mid */
  iv: number;
  /** h, trading-time years */
  hYears: number;
}

/** What a call records of the choice: the read of the contract it called, how it was chosen, and what the score rule
    would have taken instead. */
export interface CostMark extends CostRead {
  /** 'cost': the smallest mu among the contracts the rule allowed; 'score': the score rule's own pick (the cost
      choice is switched off, or no contract could be read) */
  rule: 'cost' | 'score';
  /** Contracts the rule allowed on that side, and how many of them could be read */
  pool: number;
  read: number;
  /** The contract the score rule would have called, when it differs */
  scorePick?: string;
  /** The contract the cost choice would have called, when it differs (the choice is off) */
  costPick?: string;
  /** Smaller ways into the same call, for a viewer whose budget a contract of the pick does not fit (compassBudget):
      for SPX and SPXW the XSP contract at a tenth of the strike ('mini', the same exposure at a tenth of the size), then
      the other contracts the rule allowed on the side, by their mu ('strike'). At most ALTS_MAX. Never a filter: the
      call is the pick. */
  alts?: CostAlt[];
}

export interface CostAlt {
  contract: string;
  ask: number;
  /** Its mu, held to the same flat; null when it could not be read */
  mu: number | null;
  kind: 'mini' | 'strike';
}

export const ALTS_MAX = 3;

/** The mini of an index root: XSP is a tenth of SPX, on the same expiries (SPXW's dailies included). */
export const MINI_OF: Record<string, { root: string; ratio: number }> = { SPX: { root: 'XSP', ratio: 10 }, SPXW: { root: 'XSP', ratio: 10 } };

/** The alternatives a call carries (CostMark.alts): the mini first (its best-mu contract within one strike of a tenth
    of the pick's strike), then the rest of the allowed contracts by mu, the pick left out. */
export function altsOf<T>(pick: T, allowed: readonly T[], minis: readonly T[], word: (c: T) => string, ask: (c: T) => number, read: (c: T) => CostRead | null): CostAlt[] {
  const out: CostAlt[] = [];
  const mini = costPick(minis, read);
  const miniPick = mini?.pick ?? minis[0];
  if (miniPick) out.push({ contract: word(miniPick), ask: ask(miniPick), mu: mini?.read.mu ?? read(miniPick)?.mu ?? null, kind: 'mini' });
  const rest = allowed.filter(c => c !== pick).map(c => ({ c, mu: read(c)?.mu ?? null }));
  rest.sort((a, b) => (a.mu == null ? 1 : b.mu == null ? -1 : a.mu - b.mu));
  for (const r of rest) out.push({ contract: word(r.c), ask: ask(r.c), mu: r.mu, kind: 'strike' });
  return out.slice(0, ALTS_MAX + (miniPick ? 1 : 0));
}

const yearsOf = (tradingMinutes: number) => Math.max(0, tradingMinutes) / (SESSION_MIN * YEAR_SESSIONS);

/** The years to expiry on the trading clock at an instant, with the clock's floor (never 0: an option at its flat
    still has its last minutes). */
function yearsTo(expiryDate: string, at: number): number {
  const m = tradingMinutesTo(expiryDate, at);
  return Number.isFinite(m) ? yearsOf(m) + 1e-6 : NaN;
}

const price = (S: number, K: number, t: number, v: number, right: OptionRight) => blackScholesPrice(S, K, t, v, right, R, Q);

/** The ATM implied vol at an instant: the call and the put at the strike nearest the spot, each solved from its mid,
    averaged (one of them alone when the other does not solve). Null when neither does. */
export function atmIvOf(list: readonly CostQuote[], spot: number, at: number): number | null {
  if (!(spot > 0) || !list.length) return null;
  const valid = list.filter(q => q.ask > 0 && q.bid >= 0 && q.ask >= q.bid && q.strike > 0);
  if (!valid.length) return null;
  const atm = valid.reduce((m, q) => (Math.abs(q.strike - spot) < Math.abs(m - spot) ? q.strike : m), valid[0].strike);
  const ivs: number[] = [];
  for (const right of ['C', 'P'] as const) {
    const q = valid.find(v => v.strike === atm && v.right === right);
    if (!q) continue;
    const t = yearsTo(q.expiryDate, at);
    const iv = t > 0 ? impliedVolFromPrice((q.bid + q.ask) / 2, spot, atm, t, right, R, Q) : null;
    if (iv != null && iv > 0) ivs.push(iv);
  }
  return ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
}

/** A contract's |delta| at its own IV (solved from the mid) on the trading clock to its expiry: its shape, the same
    number on any root at any price (a wing, Model 3's ticket). NaN when the quote is not two-sided or the IV does not
    solve. */
export function deltaOf(c: CostQuote, spot: number, at: number): number {
  if (!(spot > 0) || !(c.strike > 0) || !(c.ask > 0) || !(c.bid >= 0) || c.ask < c.bid) return NaN;
  const t = yearsTo(c.expiryDate, at);
  if (!(t > 0)) return NaN;
  const iv = impliedVolFromPrice((c.bid + c.ask) / 2, spot, c.strike, t, c.right, R, Q);
  if (iv == null || !(iv > 0)) return NaN;
  const g = blackScholesGreeks(spot, c.strike, t, iv, R, Q);
  return Math.abs(c.right === 'C' ? g.deltaCall : g.deltaPut);
}

/** Model 3's contracts on one root at a sweep minute while COMPASS_M3_SHAPE is off (today's rule, unchanged): of the
    contracts that passed lotteryEntry (`list`, already filtered), the nearest strike's side, nearest the money first
    (ties: the lower strike, then the call). */
export function lotterySideNow<T extends { strike: number; right: OptionRight }>(list: readonly T[], spot: number): T[] {
  const strikes = [...new Set(list.map(s => s.strike))];
  const order = [...list].sort((a, b) => {
    const da = strikeDistance(strikes, spot, a.strike);
    const db = strikeDistance(strikes, spot, b.strike);
    if (da !== db) return da - db;
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.right === b.right ? 0 : a.right === 'C' ? -1 : 1;
  });
  const first = order[0];
  return first ? order.filter(s => s.right === first.right) : [];
}

/** Model 3's contracts with COMPASS_M3_SHAPE on: those in its shape (compassParams lotteryShape: a valid quote at
    the money or out of it, by delta) on the nearest strike's side, nearest the money first (ties: the lower strike,
    then the call). The cost rule picks among them (costPick). No price in it: the same shape on any root. */
export function lotterySide<T extends CostQuote>(list: readonly T[], spot: number, at: number): T[] {
  if (!(spot > 0)) return [];
  const shaped = list.filter(q => lotteryShape(q.bid, q.ask, deltaOf({ ...q, expiryDate: q.expiryDate.slice(0, 10) }, spot, at)));
  const strikes = [...new Set(shaped.map(q => q.strike))];
  const order = [...shaped].sort((a, b) => {
    const da = strikeDistance(strikes, spot, a.strike);
    const db = strikeDistance(strikes, spot, b.strike);
    if (da !== db) return da - db;
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.right === b.right ? 0 : a.right === 'C' ? -1 : 1;
  });
  const first = order[0];
  return first ? order.filter(q => q.right === first.right) : [];
}

/** The first-order cost when the full read cannot be had (no regular-session time in the horizon, say): the round trip
    over |delta|, the move in the underlying's dollars that pays the spread back. Among contracts on one expiry at one
    instant it orders them as mu does to first order (mu ≈ round trip ÷ (delta × priced move)). NaN when unreadable. */
export function firstOrderCost(c: CostQuote, spot: number, at: number): number {
  const d = deltaOf(c, spot, at);
  return d > 0 ? (c.ask - c.bid) / d : NaN;
}

/* The expectation over a Normal move: Simpson's rule on ±6 standard deviations (241 points; the exit bid has a kink at
   the strike near expiry, which a fixed Gauss rule handles badly) */
const GRID_N = 240;
const GRID: { z: number; w: number }[] = (() => {
  const lo = -6;
  const step = 12 / GRID_N;
  const out: { z: number; w: number }[] = [];
  for (let i = 0; i <= GRID_N; i++) {
    const z = lo + i * step;
    const simpson = i === 0 || i === GRID_N ? 1 : i % 2 ? 4 : 2;
    out.push({ z, w: (simpson * step / 3) * Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI) });
  }
  return out;
})();

/** The cost read of one contract for a call at `at` held to `flatAt`, the underlying at `spot`, the priced move set by
    `atmIv`. Null when the quote is not two-sided, the contract's IV does not solve, the horizon is empty, or no level
    pays the ask back within twenty priced moves. */
export function costRead(c: CostQuote, ctx: { spot: number; atmIv: number; at: number; flatAt: number }): CostRead | null {
  const { spot: S, atmIv, at, flatAt } = ctx;
  if (!(S > 0) || !(atmIv > 0) || !(c.ask > 0) || !(c.bid >= 0) || c.ask < c.bid || !(c.strike > 0)) return null;
  const tNow = yearsTo(c.expiryDate, at);
  const tExit = yearsTo(c.expiryDate, flatAt);
  const h = tNow - tExit;
  if (!(tNow > 0) || !(h > 0)) return null;
  const iv = impliedVolFromPrice((c.bid + c.ask) / 2, S, c.strike, tNow, c.right, R, Q);
  if (iv == null || !(iv > 0)) return null;
  const half = (c.ask - c.bid) / 2;
  const sign = c.right === 'C' ? 1 : -1;
  const unit = atmIv * Math.sqrt(h);
  /* the exit bid after a sign-aligned move of z priced moves */
  const exitBid = (z: number) => Math.max(0, price(S * Math.exp(sign * unit * z), c.strike, tExit, iv, c.right) - half);
  /* the level: exitBid(z) = ask, z increasing pays more (monotone for a long option) */
  let lo = -20;
  let hi = 20;
  if (exitBid(hi) < c.ask) return null;
  if (exitBid(lo) >= c.ask) lo = hi = -20;
  for (let i = 0; i < 80 && hi - lo > 1e-7; i++) {
    const mid = (lo + hi) / 2;
    if (exitBid(mid) < c.ask) lo = mid;
    else hi = mid;
  }
  const z = (lo + hi) / 2;
  /* mu: E[exitBid(mu + N(0,1))] = ask */
  const expect = (mu: number) => GRID.reduce((sum, g) => sum + g.w * exitBid(mu + g.z), 0);
  let mlo = -12;
  let mhi = 12;
  if (expect(mhi) < c.ask) return null;
  for (let i = 0; i < 50 && mhi - mlo > 1e-5; i++) {
    const mid = (mlo + mhi) / 2;
    if (expect(mid) < c.ask) mlo = mid;
    else mhi = mid;
  }
  const mu = (mlo + mhi) / 2;
  return {
    roundTrip: Number((c.ask - c.bid).toFixed(4)),
    level: S * Math.exp(sign * unit * z),
    by: flatAt,
    z,
    mu,
    atmIv,
    iv,
    hYears: h,
  };
}

/** The contract that makes the most sense to risk among those the model's rule allows: the smallest mu (the least
    average edge it needs to pay back what it costs). Ties go to the first in the list (the caller's own order). Null
    when no contract could be read: the caller keeps its own rule. */
export function costPick<T>(cands: readonly T[], read: (c: T) => CostRead | null): { pick: T; read: CostRead; readN: number } | null {
  let best: { pick: T; read: CostRead } | null = null;
  let readN = 0;
  for (const c of cands) {
    const r = read(c);
    if (!r) continue;
    readN += 1;
    if (!best || r.mu < best.read.mu - 1e-9) best = { pick: c, read: r };
  }
  return best ? { ...best, readN } : null;
}

/** The cost choice is on unless COMPASS_COST_PICK=0 (then the score rule picks, as before, and the read is still
    recorded). Read through globalThis: vite's define turns a bare process.env into {}. */
let costOverride: boolean | null = null;
export function costPickOn(): boolean {
  if (costOverride != null) return costOverride;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
  return env.COMPASS_COST_PICK !== '0';
}
/** Proofs only: force the cost choice on or off (null: back to the environment). */
export function setCostPick(on: boolean | null): void {
  costOverride = on;
}

/** "needs SPY ≥ 757.40 by 15:55 (0.42× the priced move)": the card's line, in the root's printed name. */
export function needsLine(mark: Pick<CostRead, 'level' | 'by' | 'z'>, right: OptionRight, printName: string, clock: (ms: number) => string): string {
  const lvl = mark.level >= 1000 ? mark.level.toFixed(0) : mark.level >= 100 ? mark.level.toFixed(1) : mark.level.toFixed(2);
  return `needs ${printName} ${right === 'C' ? '≥' : '≤'} ${lvl} by ${clock(mark.by)} (${mark.z.toFixed(2)}× the priced move)`;
}
