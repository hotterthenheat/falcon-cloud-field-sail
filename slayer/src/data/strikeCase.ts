/*
==================================================
  SLAYER TERMINAL - THE CASE FOR A STRIKE
  (data/strikeCase.ts)

  Noah, 2026-10-07: "we want weigher to be sort of
  weigher similar to compass but more in detail with
  things, exp ranges, why we would choose this or not
  choose this. wether its a good idea to take a look
  at or not. reasons as to why we think what we think
  in detail but organized for the user to see. if not
  that strike then what strike would we recommend".

  Everything here is built from what the desk already
  computes — the chain's pricing, the dealer book at
  the strike, the key levels, the name's own bars, the
  calendar of events. No new data source.

  THE WORD: strong · good · caution · poor — the four
  public words (no score is ever shown; the number
  under them is this file's own and stays here). It
  is for a BUYER of the contract: a call wants the
  price up, a put wants it down.

  THE REASONS: plain sentences, each tied to one fact.
  The same sentences grade the alternatives, so the
  dropdown cannot contradict itself.
==================================================
*/

import Simulator from '../core/simulator';
import type { OptionRight } from '../types/compass';
import type { ExposureProfileData, StrikeExposure } from '../types/gex';
import type { Grade } from './stockOverview';
import { gradeOfConfidence } from './compass';
import { buildDeskChain, deskExpiries, type DeskChain, type DeskContract } from './weigherDesk';
import type { Book, BookAtStrike } from './bookAtStrike';
import { buildEarningsCalendar } from './earnings';
import { macroWindow, tradingDaysSigned } from './events';
import { fmtUsd } from './gex';

export type Word = Grade;

export interface PathLevel {
  name: string;
  price: number;
  /** the odds the close lands past it in the contract's direction, 0–10; null when the book cannot say */
  inTen: number | null;
}
export interface Alt {
  strike: number;
  right: OptionRight;
  /** the chain's resolved horizon, calendar days */
  dte: number;
  /** "Fri Oct 10" */
  expiry: string;
  word: Word;
  mark: number;
  /** why it instead — one sentence */
  reason: string;
}
export interface CalRow {
  dte: number;
  /** "Fri Oct 10" */
  label: string;
  /** "today" · "this week" · "next weeks" · "the month" · "long dates" */
  horizon: string;
  sessions: number;
  mark: number;
  breakeven: number;
  /** dollars a contract loses a day */
  decayDay: number;
  /** ± percent the options price for the window */
  expectedMovePct: number;
  word: Word;
  current: boolean;
}
export interface HorizonItem {
  k: string;
  v: string;
  sub?: string;
}
export interface StrikeEvent {
  label: string;
  when: string;
}
export interface StrikeCase {
  word: Word;
  /** the word's reason in one breath */
  line: string;
  forIt: string[];
  againstIt: string[];
  needs: {
    /** the move to breakeven, signed percent */
    movePct: number;
    sessions: number;
    usualDayPct: number | null;
    /** the move in days of the name's usual range */
    daysOfRange: number | null;
    expectedMovePct: number;
    sentence: string;
    path: PathLevel[];
  };
  instead: { strike: Alt | null; expiry: Alt | null };
  calendar: CalRow[];
  horizon: { name: string; items: HorizonItem[] };
  events: StrikeEvent[];
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const fmtK = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(Math.round(v)));
const inTen = (pct: number | null): number | null => (pct == null ? null : Math.max(0, Math.min(10, Math.round(pct / 10))));
const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const dayLabel = (d: Date, weekday: string) => `${weekday} ${MONTH_DAY.format(d)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "today" · "this week" · "next weeks" · "the month" · "long dates" */
export const horizonWord = (sessions: number): string => (sessions <= 1 ? 'today' : sessions <= 5 ? 'this week' : sessions <= 15 ? 'next weeks' : sessions <= 35 ? 'the month' : 'long dates');

/* ---- the name's own bars: its usual day, and today so far ---------------------------------------------------------- */

interface DayRange {
  /** the average (high − low) / close over the last sessions, percent */
  usualPct: number | null;
  /** today's (high − low) / open so far, percent */
  todayPct: number | null;
}
function dayRanges(ticker: string): DayRange {
  const candles = Simulator.peekCandles(ticker) ?? Simulator.getCandles(ticker);
  if (!candles?.length) return { usualPct: null, todayPct: null };
  const days = new Map<number, { hi: number; lo: number; open: number; close: number }>();
  for (const c of candles) {
    const k = Math.floor(c.time / 86400);
    const d = days.get(k);
    if (!d) days.set(k, { hi: c.high, lo: c.low, open: c.open, close: c.close });
    else {
      d.hi = Math.max(d.hi, c.high);
      d.lo = Math.min(d.lo, c.low);
      d.close = c.close;
    }
  }
  const list = [...days.values()];
  const todayD = list[list.length - 1];
  const past = list.length > 1 ? list.slice(0, -1).slice(-10) : list;
  const usual = past.length ? past.reduce((s, d) => s + ((d.hi - d.lo) / d.close) * 100, 0) / past.length : null;
  return { usualPct: usual, todayPct: todayD ? ((todayD.hi - todayD.lo) / todayD.open) * 100 : null };
}

/* ---- what the calendar holds inside the window ------------------------------------------------------------------- */

function eventsWithin(ticker: string, sessions: number): StrikeEvent[] {
  const out: StrikeEvent[] = [];
  const when = (k: number) => (k <= 0 ? 'today' : k === 1 ? 'next session' : `in ${k} sessions`);
  const e = buildEarningsCalendar().find(x => x.ticker === ticker.toUpperCase());
  if (e && e.daysOut <= sessions) out.push({ label: `${ticker.toUpperCase()} earnings · ${e.slot}${e.confirmed ? '' : ' · estimated'}`, when: when(e.daysOut) });
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (const ev of macroWindow(now, 0, 70)) {
    const k = tradingDaysSigned(todayIso, ev.iso);
    if (k >= 0 && k <= sessions) out.push({ label: ev.label, when: when(k) });
  }
  return out.slice(0, 4);
}

/* ---- the grading ---------------------------------------------------------------------------------------------------- */

interface Ctx {
  ticker: string;
  spot: number;
  profile: ExposureProfileData | null;
  book: Book | null;
  baseIv: number;
  usualDayPct: number | null;
  /** the chain's medians, so "alive" means against its own strikes */
  medOi: number;
  medVol: number;
  events: StrikeEvent[];
}
interface Graded {
  score: number;
  word: Word;
  forIt: string[];
  againstIt: string[];
}

function medianOf(v: number[]): number {
  const s = [...v].filter(Number.isFinite).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/** The word and the reasons for ONE contract, as a buyer of it */
function grade(c: DeskContract, right: OptionRight, chain: DeskChain, ctx: Ctx): Graded {
  const up = right === 'C';
  const L = ctx.profile?.levels ?? null;
  const row: StrikeExposure | undefined = ctx.profile?.strikes.find(s => eq(s.strike, c.strike));
  const at: BookAtStrike | null = ctx.book?.rows.get(c.strike) ?? null;
  const forIt: string[] = [];
  const againstIt: string[] = [];
  let score = 55;
  const sessions = Math.max(0, chain.expiry.sessions);
  const by = sessions <= 0 ? 'by the bell' : sessions === 1 ? 'by tomorrow' : `by ${dayLabel(chain.expiry.date, chain.expiry.weekday)}`;

  /* the hedging: which side of the flip spot is on, and a wall in the way */
  if (L) {
    const flip = fmtStrike(L.flip);
    const absorbing = ctx.spot > L.flip;
    if (up) {
      if (!absorbing) {
        score += 14;
        forIt.push(`Spot is under the flip at ${flip}, so dealers chase rallies — the hedging works for a call.`);
      } else {
        score -= 12;
        againstIt.push(`Spot is above the flip at ${flip}, so dealers sell into rallies — the hedging works against a call.`);
      }
      if (c.strike > L.callWall && L.callWall > ctx.spot) {
        score -= 12;
        againstIt.push(`The call wall at ${fmtStrike(L.callWall)} stands between spot and the strike; rallies tend to slow there.`);
      }
      if (eq(c.strike, L.callWall)) {
        score -= 5;
        againstIt.push('The strike is the call wall itself, where a rise tends to stall.');
      }
      if (eq(c.strike, L.putWall) && c.strike <= ctx.spot) {
        score += 6;
        forIt.push('The strike is the put wall, the floor under spot, so the premium has the book under it.');
      }
    } else {
      if (absorbing) {
        score -= 12;
        againstIt.push(`Spot is above the flip at ${flip}, so dealers buy the dips — the hedging works against a put until price is under it.`);
      } else {
        score += 14;
        forIt.push(`Spot is under the flip at ${flip}, so dealers chase the move down — the hedging works for a put.`);
      }
      if (c.strike < L.putWall && L.putWall < ctx.spot) {
        score -= 12;
        againstIt.push(`The put wall at ${fmtStrike(L.putWall)} stands between spot and the strike; falls tend to slow there.`);
      }
      if (eq(c.strike, L.putWall)) {
        score -= 5;
        againstIt.push('The strike is the put wall itself, where a fall tends to stall.');
      }
      if (eq(c.strike, L.callWall) && c.strike >= ctx.spot) {
        score += 6;
        forIt.push('The strike is the call wall, the ceiling over spot, so the premium has the book over it.');
      }
    }
    if (eq(c.strike, L.supreme)) {
      score += 3;
      forIt.push('The strike is the supreme, the one with the most hedging in the book — price tends to be drawn to it near expiry.');
    }
  }

  /* the book at the strike: its lean, its record, the close's odds */
  if (at) {
    if (at.lean === 'push along') {
      score += 6;
      forIt.push(`At ${fmtStrike(c.strike)} dealers push a move along through the strike.`);
    } else if (at.share >= 0.25) {
      score -= 6;
      againstIt.push(`At ${fmtStrike(c.strike)} dealers push back on a move through the strike.`);
    }
    const odds = up ? at.oddsAbove : at.oddsBelow;
    if (odds != null) {
      const n = inTen(odds) ?? 0;
      if (odds >= 50) {
        score += 8;
        forIt.push(`${n} in 10 closes land ${up ? 'at or above' : 'at or below'} the strike today, by the book.`);
      } else if (odds <= 25) {
        score -= 8;
        againstIt.push(`Only ${n} in 10 closes land ${up ? 'at or above' : 'at or below'} the strike today, by the book.`);
      }
    }
    if (at.held && at.held.tests >= 2 && at.role) {
      const held = at.held.held / at.held.tests;
      if (held >= 0.6) {
        if ((up && at.role === 'call wall') || (!up && at.role === 'put wall')) {
          score -= 5;
          againstIt.push(`The ${at.role} has held ${at.held.held} of ${at.held.tests} tests — it is hard to get through.`);
        }
      }
    }
  }

  /* the move it needs, against what the options price and what the name usually does */
  const need = Math.abs(c.toBreakevenPct);
  const priced = Math.max(0.05, chain.expectedMovePct);
  const r = need / priced;
  if (r <= 0.5) {
    score += 12;
    forIt.push(`Breakeven needs ${need.toFixed(2)}%, under half the ±${priced.toFixed(2)}% the options price ${by}.`);
  } else if (r <= 1) {
    score += 4;
    forIt.push(`Breakeven needs ${need.toFixed(2)}%, inside the ±${priced.toFixed(2)}% the options price ${by}.`);
  } else if (r <= 1.5) {
    score -= 8;
    againstIt.push(`Breakeven needs ${need.toFixed(2)}%, more than the ±${priced.toFixed(2)}% the options price ${by}.`);
  } else {
    score -= 16;
    againstIt.push(`Breakeven needs ${need.toFixed(2)}%, well past the ±${priced.toFixed(2)}% the options price ${by}.`);
  }
  if (ctx.usualDayPct != null && ctx.usualDayPct > 0) {
    const days = need / ctx.usualDayPct;
    const left = Math.max(0.5, sessions);
    if (days <= left * 0.5) {
      score += 6;
      forIt.push(`The name moves ${ctx.usualDayPct.toFixed(2)}% in a usual day; the move needed is ${days.toFixed(1)} days of that, with ${left} to go.`);
    } else if (days > left) {
      score -= 10;
      againstIt.push(`The name moves ${ctx.usualDayPct.toFixed(2)}% in a usual day; the move needed is ${days.toFixed(1)} days of that, with only ${left} to go.`);
    }
  }

  /* what the clock takes */
  const decayDay = Math.abs(c.theta) * 100;
  const decayShare = c.mark > 0 ? Math.abs(c.theta) / c.mark : 0;
  if (decayShare >= 0.12) {
    score -= 12;
    againstIt.push(`It loses $${decayDay.toFixed(2)} a contract a day, ${(decayShare * 100).toFixed(0)}% of its price — the clock is the enemy.`);
  } else if (decayShare >= 0.06) {
    score -= 5;
    againstIt.push(`It loses $${decayDay.toFixed(2)} a contract a day, ${(decayShare * 100).toFixed(0)}% of its price.`);
  } else if (decayShare <= 0.02 && decayDay > 0) {
    score += 4;
    forIt.push(`The clock is light here: $${decayDay.toFixed(2)} a contract a day, ${(decayShare * 100).toFixed(1)}% of its price.`);
  }

  /* is it alive */
  if (ctx.medOi > 0) {
    if (c.oi >= ctx.medOi * 1.5) {
      score += 5;
      forIt.push(`The strike is alive: ${fmtK(c.oi)} open, ${fmtK(c.volume)} traded today.`);
    } else if (c.oi < ctx.medOi * 0.3) {
      score -= 8;
      againstIt.push(`The strike is thin: ${fmtK(c.oi)} open against the chain's ${fmtK(ctx.medOi)} — a wide market to get out of.`);
    }
  }

  /* the price of the premium itself */
  if (ctx.baseIv > 0) {
    const iv = c.iv / ctx.baseIv;
    if (iv >= 1.25) {
      score -= 6;
      againstIt.push(`Priced rich: IV ${c.iv.toFixed(0)}% against the name's ${ctx.baseIv.toFixed(0)}%.`);
    } else if (iv <= 0.95) {
      score += 4;
      forIt.push(`Priced plainly: IV ${c.iv.toFixed(0)}% against the name's ${ctx.baseIv.toFixed(0)}%.`);
    }
  }
  const d = Math.abs(c.delta);
  if (d < 0.1) {
    score -= 10;
    againstIt.push(`A lottery ticket: delta ${d.toFixed(2)}, the contract barely moves with the stock.`);
  } else if (d >= 0.3 && d <= 0.6) {
    score += 4;
    forIt.push(`Delta ${d.toFixed(2)}: the contract moves with the stock and the premium is not all time.`);
  }
  if (c.itmOdds >= 50) {
    score += 6;
    forIt.push(`${inTen(c.itmOdds)} in 10 it finishes in the money, by the pricing.`);
  } else if (c.itmOdds <= 20) {
    score -= 6;
    againstIt.push(`${inTen(c.itmOdds)} in 10 it finishes in the money, by the pricing.`);
  }
  if (ctx.events.length) {
    score -= 4;
    againstIt.push(`${ctx.events.length === 1 ? 'An event lands' : `${ctx.events.length} events land`} inside the window: ${ctx.events.map(e => `${e.label} ${e.when}`).join(' · ')}.`);
  }

  /* the dealer gamma at the strike — what a move through it meets */
  if (row && ctx.profile && ctx.profile.maxAbs.gex > 0 && Math.abs(row.gex.net) >= 0.35 * ctx.profile.maxAbs.gex) {
    if (row.gex.net > 0) {
      score += 3;
      forIt.push(`Dealer gamma at the strike speeds a move up through it (${fmtUsd(Math.abs(row.gex.net))} per 1%).`);
    } else {
      score -= 3;
      againstIt.push(`Dealer gamma at the strike slows a move through it (${fmtUsd(Math.abs(row.gex.net))} per 1%).`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, word: gradeOfConfidence(score), forIt, againstIt };
}

/* ---- the path from spot to the strike --------------------------------------------------------------------------- */

function pathFor(c: DeskContract, right: OptionRight, spot: number, profile: ExposureProfileData | null, book: Book | null): PathLevel[] {
  if (!profile) return [];
  const up = right === 'C';
  const L = profile.levels;
  const end = up ? Math.max(c.strike, c.breakeven) : Math.min(c.strike, c.breakeven);
  const between = (p: number) => (up ? p > spot && p <= end : p < spot && p >= end);
  const named = new Map<number, string>();
  const name = (p: number, n: string) => {
    if (!Number.isFinite(p) || p <= 0 || !between(p)) return;
    named.set(p, named.has(p) ? `${named.get(p)} · ${n}` : n);
  };
  name(L.callWall, 'call wall');
  name(L.putWall, 'put wall');
  name(L.supreme, 'supreme');
  name(L.flip, 'flip');
  if (book) {
    for (const [k, r] of book.rows) {
      if (named.has(k) || !r.shape) continue;
      if (r.shape === 'wall' || r.shape === 'shelf') name(k, r.shape);
    }
  }
  const out: PathLevel[] = [...named.entries()].map(([price, n]) => {
    const r = book?.rows.get(price) ?? null;
    const odds = r ? (up ? r.oddsAbove : r.oddsBelow) : null;
    return { name: n, price, inTen: inTen(odds) };
  });
  out.sort((a, b) => Math.abs(a.price - spot) - Math.abs(b.price - spot));
  return out.slice(0, 4);
}

/* ---- the case ------------------------------------------------------------------------------------------------------ */

export function buildStrikeCase(args: { ticker: string; c: DeskContract; right: OptionRight; chain: DeskChain; profile: ExposureProfileData | null; book: Book | null }): StrikeCase {
  const { ticker, c, right, chain, profile, book } = args;
  const sym = Simulator.ensureTicker(ticker);
  const spot = chain.spot;
  /* the name's base vol is a fraction; the chain prints IV in percent */
  const baseIv = (Simulator.TICKERS[sym]?.iv ?? 0) * 100;
  const ranges = dayRanges(sym);
  const sameSide = chain.rows.map(r => (right === 'C' ? r.call : r.put));
  const medOi = medianOf(sameSide.map(x => x.oi));
  const medVol = medianOf(sameSide.map(x => x.volume));
  const sessions = Math.max(0, chain.expiry.sessions);
  const events = eventsWithin(sym, sessions);
  const ctx: Ctx = { ticker: sym, spot, profile, book, baseIv, usualDayPct: ranges.usualPct, medOi, medVol, events };

  const me = grade(c, right, chain, ctx);

  /* what has to happen */
  const need = Math.abs(c.toBreakevenPct);
  const daysOfRange = ranges.usualPct && ranges.usualPct > 0 ? need / ranges.usualPct : null;
  const byWords = sessions <= 0 ? 'by the bell today' : sessions === 1 ? 'by tomorrow' : `by ${dayLabel(chain.expiry.date, chain.expiry.weekday)}, ${sessions} sessions`;
  const sentence = `Needs ${c.toBreakevenPct >= 0 ? '+' : '−'}${need.toFixed(2)}% to ${fmtStrike(c.breakeven)} ${byWords}${
    ranges.usualPct ? `. The name moves ${ranges.usualPct.toFixed(2)}% in a usual day: ${daysOfRange!.toFixed(1)} days of that` : ''
  }.`;
  const path = pathFor(c, right, spot, profile, book);

  /* the same strike on every expiry the desk lists */
  const expiries = deskExpiries();
  const depth = Math.max(10, Math.ceil(Math.abs(c.strike - spot) / Math.max(chain.step, 1e-9)) + 2);
  const chains = new Map<number, DeskChain>();
  for (const e of expiries) chains.set(e.dte, e.dte === chain.expiry.dte ? chain : buildDeskChain(sym, e.dte, depth));
  const calendar: CalRow[] = [];
  let bestExpiry: { alt: Alt; score: number } | null = null;
  for (const e of expiries) {
    const ch = chains.get(e.dte)!;
    const r = ch.rows.find(x => eq(x.strike, c.strike));
    if (!r) continue;
    const cc = right === 'C' ? r.call : r.put;
    const ectx: Ctx = { ...ctx, events: eventsWithin(sym, Math.max(0, ch.expiry.sessions)) };
    const g = e.dte === chain.expiry.dte ? me : grade(cc, right, ch, ectx);
    calendar.push({
      dte: e.dte,
      label: dayLabel(e.date, e.weekday),
      horizon: horizonWord(e.sessions),
      sessions: e.sessions,
      mark: cc.mark,
      breakeven: cc.breakeven,
      decayDay: Math.abs(cc.theta) * 100,
      expectedMovePct: ch.expectedMovePct,
      word: g.word,
      current: e.dte === chain.expiry.dte,
    });
    if (e.dte !== chain.expiry.dte && g.score > me.score + 3 && (!bestExpiry || g.score > bestExpiry.score)) {
      /* why that one: what it has going for it that this one lacks — else the plain differences */
      const fresh = g.forIt.find(t => !me.forIt.includes(t));
      const gone = me.againstIt.find(t => !g.againstIt.includes(t));
      const why =
        fresh ??
        (gone ? `Not against it there: ${gone.charAt(0).toLowerCase()}${gone.slice(1)}` : `${ch.expiry.sessions} sessions instead of ${sessions}, and $${(Math.abs(cc.theta) * 100).toFixed(2)} a day of decay instead of $${(Math.abs(c.theta) * 100).toFixed(2)}.`);
      bestExpiry = { score: g.score, alt: { strike: c.strike, right, dte: e.dte, expiry: dayLabel(e.date, e.weekday), word: g.word, mark: cc.mark, reason: why } };
    }
  }

  /* another strike on this expiry, within six of it */
  let bestStrike: { alt: Alt; score: number } | null = null;
  for (const cc of sameSide) {
    if (eq(cc.strike, c.strike) || Math.abs(cc.strike - c.strike) > chain.step * 6 + 1e-9) continue;
    const g = grade(cc, right, chain, ctx);
    if (g.score > me.score + 3 && (!bestStrike || g.score > bestStrike.score || (g.score === bestStrike.score && Math.abs(cc.strike - spot) < Math.abs(bestStrike.alt.strike - spot)))) {
      const fresh = g.forIt.find(t => !me.forIt.includes(t));
      const gone = me.againstIt.find(t => !g.againstIt.includes(t));
      const why =
        fresh ??
        (gone
          ? `Not against it there: ${gone.charAt(0).toLowerCase()}${gone.slice(1)}`
          : `Needs ${Math.abs(cc.toBreakevenPct).toFixed(2)}% instead of ${Math.abs(c.toBreakevenPct).toFixed(2)}%, for $${cc.mark.toFixed(2)} instead of $${c.mark.toFixed(2)}.`);
      bestStrike = { score: g.score, alt: { strike: cc.strike, right, dte: chain.expiry.dte, expiry: dayLabel(chain.expiry.date, chain.expiry.weekday), word: g.word, mark: cc.mark, reason: why } };
    }
  }

  /* the word's line — the case in one breath, built from the facts, not a reason repeated */
  const L0 = profile?.levels ?? null;
  const up = right === 'C';
  const hedge = !L0 ? '' : (up ? spot <= L0.flip : spot > L0.flip) ? 'with the hedging for it' : 'with the hedging against it';
  const wallWay = L0 && (up ? c.strike > L0.callWall && L0.callWall > spot : c.strike < L0.putWall && L0.putWall < spot);
  const priced = Math.max(0.05, chain.expectedMovePct);
  const ratioWords = need / priced <= 0.5 ? 'under half what the options price' : need / priced <= 1 ? 'inside what the options price' : 'more than the options price';
  const byShort = sessions <= 0 ? 'by the bell' : sessions === 1 ? 'by tomorrow' : `by ${dayLabel(chain.expiry.date, chain.expiry.weekday)}`;
  const line = `${cap(me.word)}. A ${up ? 'call' : 'put'} ${hedge}${wallWay ? ' and a wall in the way' : ''}, needing ${need.toFixed(2)}% ${byShort} — ${ratioWords}.`;

  /* for the horizon the expiry sets */
  const row = profile?.strikes.find(s => eq(s.strike, c.strike));
  const L = profile?.levels ?? null;
  const decayDay = Math.abs(c.theta) * 100;
  const items: HorizonItem[] = [];
  const ivItem = (): HorizonItem => ({ k: 'IV against the usual', v: `${c.iv.toFixed(0)}% · ${baseIv.toFixed(0)}%`, sub: c.iv >= baseIv * 1.25 ? 'rich: the premium carries a scare' : c.iv <= baseIv * 0.95 ? 'plain: nothing extra in the premium' : 'about the name’s usual' });
  const eventsItem = (): HorizonItem => ({ k: 'Events in the window', v: events.length ? String(events.length) : 'none', sub: events.length ? events.map(e => `${e.label}, ${e.when}`).join(' · ') : 'no report, no scheduled release' });
  const decayItem = (): HorizonItem => ({ k: 'Decay a day', v: `$${decayDay.toFixed(2)}`, sub: c.mark > 0 ? `${((Math.abs(c.theta) / c.mark) * 100).toFixed(1)}% of the premium, every session` : undefined });
  let name: string;
  if (sessions <= 2) {
    name = sessions <= 0 ? 'For a day trade, today' : 'For a day trade';
    if (L) items.push({ k: 'The flip', v: fmtStrike(L.flip), sub: spot > L.flip ? 'spot is above it: dealers sell into rallies and buy the dips' : 'spot is under it: dealers chase the move either way' });
    if (row && profile) {
      const big = profile.maxAbs.gex > 0 && Math.abs(row.gex.net) >= 0.35 * profile.maxAbs.gex;
      items.push({ k: 'Gamma at the strike', v: `${fmtUsd(Math.abs(row.gex.net))} per 1%`, sub: !big ? 'little hedging here — price passes through' : row.gex.net > 0 ? 'speeds a move up through the strike' : 'slows a move through the strike' });
    }
    if (ranges.todayPct != null) items.push({ k: 'Today’s range so far', v: `${ranges.todayPct.toFixed(2)}%`, sub: ranges.usualPct ? `${(ranges.todayPct / ranges.usualPct).toFixed(1)}× its usual day` : undefined });
    const today0 = chains.get(expiries[0]?.dte ?? 0);
    if (today0) items.push({ k: 'The options price by the bell', v: `±${today0.expectedMovePct.toFixed(2)}%`, sub: `±${(spot * today0.expectedMovePct / 100).toFixed(2)} either way` });
    items.push({ k: 'Volume at the strike', v: fmtK(c.volume), sub: `against ${fmtK(c.oi)} open` });
    items.push({ k: 'Decay an hour', v: `$${(decayDay / 6.5).toFixed(2)}`, sub: 'a contract, while the market is open' });
  } else if (sessions <= 15) {
    name = 'For a week or two';
    const at = book?.rows.get(c.strike) ?? null;
    if (at?.held && at.role) items.push({ k: `The ${at.role}’s record`, v: `held ${at.held.held} of ${at.held.tests}`, sub: 'tests in the window the book keeps' });
    else if (L) items.push({ k: 'The walls', v: `${fmtStrike(L.putWall)} · ${fmtStrike(L.callWall)}`, sub: 'the floor and the ceiling of the book today' });
    items.push(eventsItem());
    items.push(ivItem());
    if (row) {
      items.push({ k: 'Vanna at the strike', v: fmtUsd(Math.abs(row.vanna.net)), sub: row.vanna.net > 0 ? 'a drop in vol makes dealers buy here' : 'a drop in vol makes dealers sell here' });
      items.push({ k: 'Charm at the strike', v: fmtUsd(Math.abs(row.charm.net)), sub: row.charm.net < 0 ? 'each session the clock makes dealers buy here' : 'each session the clock makes dealers sell here' });
    }
    items.push(decayItem());
  } else {
    name = 'For a month or more';
    if (L) {
      items.push({ k: 'The supreme', v: fmtStrike(L.supreme), sub: 'the strike with the most hedging in the book; price is drawn to it near expiry' });
      items.push({ k: 'The walls', v: `${fmtStrike(L.putWall)} · ${fmtStrike(L.callWall)}`, sub: 'the floor and the ceiling of the book today — they move as the book does' });
    }
    items.push(eventsItem());
    items.push(ivItem());
    items.push({ k: 'Time value', v: c.mark > 0 ? `${((c.extrinsic / c.mark) * 100).toFixed(0)}%` : '—', sub: 'of the premium is time; the rest is already in the money' });
    items.push(decayItem());
  }

  return {
    word: me.word,
    line,
    forIt: me.forIt,
    againstIt: me.againstIt,
    needs: { movePct: c.toBreakevenPct, sessions, usualDayPct: ranges.usualPct, daysOfRange, expectedMovePct: chain.expectedMovePct, sentence, path },
    instead: { strike: bestStrike?.alt ?? null, expiry: bestExpiry?.alt ?? null },
    calendar,
    horizon: { name, items },
    events,
  };
}
