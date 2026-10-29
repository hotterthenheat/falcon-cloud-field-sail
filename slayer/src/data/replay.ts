/*
==================================================
  SLAYER TERMINAL - REPLAY (data/replay.ts)

  The Map rewinds (2026-09-08). One position on the
  session — seconds from the open — and every surface
  on the page reads the book as it stood then: the
  chart's bars, the levels, the ladder, the calendar,
  the clock. The simulator keeps one snapshot of the
  book per minute bar (net gamma, delta and vega and
  the open interest at every strike); between two
  minutes the book is read on a FIVE-SECOND grid by
  interpolating them, so a replay at speed shows the
  colours turning through the day rather than
  stepping (Noah: "i should be able to see the
  smoothness in transition of colors").

  What is read at a position:
    the bars      every minute bar up to it, the last
                  one folded to the interpolated close
    spot          between the two bars' closes
    the chain     every strike the book knew at that
                  minute: net gamma, delta, vega and
                  both legs' open interest, the gamma
                  split between the legs by the same
                  weights the simulator uses (dealers
                  net short calls −0.55, short puts
                  −0.53), the live chain's greeks as
                  the template where they are not in
                  the snapshot
  Nothing here is a forecast — it is the day so far,
  at the moment you point at.
==================================================
*/

import { bookHistory, dayBars } from './uwBook';
import { OPEN_MIN, hhmm } from './ahead';
import { sessionBars } from './levelview';
import { sessionMeta, sessionOfMinute, type DeskSession } from './deskSession';
import { nyDay, nyMinutes } from '../core/nyTime';
import { dollarGammaPerContract } from '../core/gammaFlip';
import { bookToday, isoDate } from '../core/calendar';
import { yearsTo } from './flipLevel';
import { registerChainDates } from './chainDates';
import { peekEntry } from './uwBook';
import type { Candle, GexLevel, GexSnapshot, MarketSnapshot, StrikeNode } from '../types/market';

/** The book is read every five seconds of session time */
const FRAME_SEC = 5;
const BAR_SEC = 60;
/** The simulator's dealer weights — the split of net gamma between the legs */
const W_CALL = -0.55;
const W_PUT = 0.53;

export interface ReplayRange {
  ticker: string;
  /** Today's session bars, oldest first */
  bars: Candle[];
  /** The book at each bar, by bar time */
  snaps: Map<number, GexSnapshot>;
  /** Seconds the session covers, from its first bar to its last */
  length: number;
}

function rangeOf(ticker: string, bars: Candle[]): ReplayRange | null {
  if (bars.length < 2) return null;
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const snaps = new Map<number, GexSnapshot>();
  for (const s of bookHistory(ticker) ?? []) if (s.time >= first && s.time <= last) snaps.set(s.time, s);
  /* No book kept for that day — nothing to rewind to */
  if (snaps.size === 0) return null;
  return { ticker, bars, snaps, length: (bars.length - 1) * BAR_SEC };
}

/** The whole tape — every session that printed — so a replay can walk all of them. Falls back to the cash session when the feed has no tape. */
export function replayRange(ticker: string): ReplayRange | null {
  const bars = dayBars(ticker) ?? sessionBars(ticker);
  return bars && bars.length >= 2 ? rangeOf(ticker, bars) : null;
}

interface ReplaySection {
  /** Seconds from the first bar */
  start: number;
  end: number;
  session: DeskSession;
  label: string;
}

/** The sessions on the tape, in the order they printed. Empty stretches are not marked. */
export function replaySections(range: ReplayRange): ReplaySection[] {
  const bars = range.bars;
  const out: ReplaySection[] = [];
  let i = 0;
  while (i < bars.length) {
    const session = sessionOfMinute(nyMinutes(bars[i].time * 1000));
    let j = i;
    while (j + 1 < bars.length && sessionOfMinute(nyMinutes(bars[j + 1].time * 1000)) === session) j++;
    out.push({
      start: i * BAR_SEC,
      end: j >= bars.length - 1 ? range.length : j * BAR_SEC,
      session,
      label: sessionMeta(session).label,
    });
    i = j + 1;
  }
  return out;
}

/** The section a position is standing in. */
function sectionAt(range: ReplayRange, pos: number): ReplaySection | null {
  const all = replaySections(range);
  if (!all.length) return null;
  return all.find(s => pos >= s.start && pos <= s.end) ?? all[all.length - 1];
}

/** Bars of the section the position is in, up to that position. */
export function sectionBarsAt(range: ReplayRange, pos: number): Candle[] {
  const sec = sectionAt(range, pos);
  const upTo = barsAt(range, pos);
  if (!sec) return upTo;
  return upTo.filter(b => sessionOfMinute(nyMinutes(b.time * 1000)) === sec.session);
}

/** New York's minute at the session's first bar — 570 when the tape starts at the open (levelview.ts sessionCut) */
export const replayStart = (range: ReplayRange | null | undefined): number => (range && range.bars.length ? nyMinutes(range.bars[0].time * 1000) : OPEN_MIN);
/** The clock at a position: minutes from midnight, New York's — from the session's own first bar when it is given, else
    as if the session opened at 09:30 (the partner's fix, taken 2026-10-14: a session that began late read 09:30) */
export const replayMinute = (pos: number, range?: ReplayRange | null) => {
  const min = replayStart(range) + Math.floor(pos / BAR_SEC);
  return min >= 24 * 60 || min < 0 ? ((min % (24 * 60)) + 24 * 60) % (24 * 60) : min;
};
export const replayLabel = (pos: number, range?: ReplayRange | null) => hhmm(replayMinute(pos, range));
/** The day the session is — from its first bar, New York's calendar */
export const replayDay = (range: ReplayRange) => nyDay(range.bars[0].time * 1000);
/** THE POSITION OF A NEW YORK MINUTE INSIDE A SESSION (Noah, 2026-10-14, the second name's day box an hour ahead of the
    first's in a replay): a position is seconds from a session's FIRST bar, and two names' sessions need not start on the
    same minute — so another name is rewound to the host's minute, never to the host's position. The last bar at or
    before the minute; 0 before the first, the length past the last. */
export function posAtMinute(range: ReplayRange, min: number): number {
  const bars = range.bars;
  if (!bars.length) return 0;
  const first = nyMinutes(bars[0].time * 1000);
  const last = nyMinutes(bars[bars.length - 1].time * 1000);
  const wraps = last < first;
  const key = (m: number) => (wraps && m < first ? m + 24 * 60 : m);
  const want = key(min);
  let k = -1;
  for (let i = 0; i < bars.length; i++) {
    if (key(nyMinutes(bars[i].time * 1000)) <= want) k = i;
    else break;
  }
  return k < 0 ? 0 : Math.min(range.length, k * BAR_SEC);
}
/** A position snapped to the frame grid */
export const snapPos = (pos: number, length: number) => Math.max(0, Math.min(length, Math.floor(pos / FRAME_SEC) * FRAME_SEC));

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Where a position sits: the bar it is in and how far through it */
function place(range: ReplayRange, pos: number): { k: number; u: number } {
  const k = Math.max(0, Math.min(range.bars.length - 1, Math.floor(pos / BAR_SEC)));
  const u = k >= range.bars.length - 1 ? 0 : Math.max(0, Math.min(1, (pos - k * BAR_SEC) / BAR_SEC));
  return { k, u };
}

/** The bars up to a position, the last one folded to where price was */
function barsAt(range: ReplayRange, pos: number): Candle[] {
  const { k, u } = place(range, pos);
  const out = range.bars.slice(0, k + 1);
  if (u > 0 && k + 1 < range.bars.length) {
    const a = range.bars[k];
    const b = range.bars[k + 1];
    const close = lerp(a.close, b.close, u);
    out[k] = { ...a, close, high: Math.max(a.high, close), low: Math.min(a.low, close) };
  }
  return out;
}

function spotAt(range: ReplayRange, pos: number): number {
  const { k, u } = place(range, pos);
  const a = range.bars[k];
  const b = range.bars[k + 1];
  return b ? lerp(a.close, b.close, u) : a.close;
}

/** The book between two minutes, strike by strike */
function levelsAt(range: ReplayRange, pos: number): GexLevel[] {
  const { k, u } = place(range, pos);
  const a = range.snaps.get(range.bars[k].time);
  const b = k + 1 < range.bars.length ? range.snaps.get(range.bars[k + 1].time) : undefined;
  if (!a && !b) return [];
  if (!a || !b || u === 0) return (a ?? b)!.levels;
  const byStrike = new Map<number, GexLevel>();
  for (const l of a.levels) byStrike.set(l.strike, { ...l, value: l.value * (1 - u), dex: (l.dex ?? 0) * (1 - u), vex: (l.vex ?? 0) * (1 - u), callOI: (l.callOI ?? 0) * (1 - u), putOI: (l.putOI ?? 0) * (1 - u) });
  for (const l of b.levels) {
    const cur = byStrike.get(l.strike);
    if (cur) {
      cur.value += l.value * u;
      cur.dex = (cur.dex ?? 0) + (l.dex ?? 0) * u;
      cur.vex = (cur.vex ?? 0) + (l.vex ?? 0) * u;
      cur.callOI = (cur.callOI ?? 0) + (l.callOI ?? 0) * u;
      cur.putOI = (cur.putOI ?? 0) + (l.putOI ?? 0) * u;
    } else byStrike.set(l.strike, { ...l, value: l.value * u, dex: (l.dex ?? 0) * u, vex: (l.vex ?? 0) * u, callOI: (l.callOI ?? 0) * u, putOI: (l.putOI ?? 0) * u });
  }
  return [...byStrike.values()].sort((x, y) => x.strike - y.strike);
}

/* Vanna and charm are not in the per-minute history, so a rewound node keeps
   the live node's legs for them (the template below) — the replay speaks
   gamma, delta and vega for the moment, and today's vanna and charm. */
const EMPTY_NODE: Omit<StrikeNode, 'strike'> = { callOI: 0, putOI: 0, gamma: 0, callGex: 0, putGex: 0, netGex: 0, callDex: 0, putDex: 0, netDex: 0, callVex: 0, putVex: 0, netVex: 0, vanna: 0, charm: 0, callVanna: 0, putVanna: 0, netVanna: 0, callCharm: 0, putCharm: 0, netCharm: 0 };

/*
  THE LEGS OF A REWOUND STRIKE, BOUNDED (the partner's audit, taken 2026-10-14: at 09:33 DEX at 475 read "$175.4B /
  −$107.0B", thirty times its neighbours). The history keeps each strike's NET and both legs' open interest. The legs
  were the net divided out by the legs' weights — and where the two weighted legs nearly cancel, that divisor is near
  nothing and the legs run to any size. Now each leg is the live leg at that strike scaled by its own open interest
  then and now (what a leg is made of), and the small difference to the kept net is shared between the legs by their
  size, so the two still add to the net exactly and neither can be larger than its contracts allow.
*/
function legsOf(net: number, callEst: number, putEst: number): { call: number; put: number } {
  const size = Math.abs(callEst) + Math.abs(putEst);
  if (size < 1e-9) return { call: net / 2, put: net / 2 };
  const rest = net - (callEst + putEst);
  return { call: callEst + (rest * Math.abs(callEst)) / size, put: putEst + (rest * Math.abs(putEst)) / size };
}

/*
  A PAST MINUTE OF THE VENDOR'S BOOK IS TODAY'S CONTRACTS RE-PRICED (the Pinpoint audit, 2026-10-22: "Each window" and the
  HEAVIEST change column always read "steady" — the rewound snapshot spread `...live` and kept the live per-expiry chains,
  which the profile prefers, so every past window WAS the live book; and the chain it built instead walked today's volume
  onto the open interest, which volume is not). Open interest is counted once, overnight — the contracts at 10:00 are the
  contracts now. What changed is the price and the clock, so each leg's dollar gamma is re-priced with Black-Scholes at
  that minute's spot and time to expiry, at its own vol (data/flipLevel.ts's inputs), vol held where it is now. Every
  per-expiry chain and the whole book move together, so the levels, the matrix and the windows all read the same moment.
*/
const RATIO_CAP = 25;
function repriceDate(chain: readonly StrikeNode[], date: string, s0: number, s1: number, t0: number, t1: number, atmIv: number): StrikeNode[] {
  const T0 = yearsTo(date, t0);
  const T1 = yearsTo(date, t1);
  const ratio = (K: number, iv: number) => {
    if (!(iv > 0)) return 1;
    const a = dollarGammaPerContract(s0, K, T0, iv);
    if (!(a > 0)) return 1;
    return Math.min(RATIO_CAP, dollarGammaPerContract(s1, K, T1, iv) / a);
  };
  return chain.map(n => {
    const callGex = n.callGex * ratio(n.strike, n.callIv && n.callIv > 0 ? n.callIv : atmIv);
    const putGex = n.putGex * ratio(n.strike, n.putIv && n.putIv > 0 ? n.putIv : atmIv);
    return { ...n, callGex, putGex, netGex: callGex + putGex };
  });
}

/** The live vendor book re-priced at a past minute — null when the snapshot is not the vendor's */
function liveBookAt(live: MarketSnapshot, spot: number, atMs: number): Pick<MarketSnapshot, 'chain' | 'uwChains' | 'uwByDate'> | null {
  const by = live.uwByDate;
  const chains = live.uwChains;
  if (!live.liveBook || !by || !chains || !(live.spot > 0)) return null;
  const entry = peekEntry(live.ticker);
  const now = Date.now();
  const floor = isoDate(bookToday());
  const swap = new Map<readonly StrikeNode[], StrikeNode[]>();
  const byAt: Record<string, StrikeNode[]> = {};
  const sums = new Map<number, { c0: number; p0: number; c1: number; p1: number }>();
  for (const d of Object.keys(by)) {
    const src = by[d];
    if (!src?.length || d < floor) {
      byAt[d] = src;
      continue;
    }
    const out = repriceDate(src, d, live.spot, spot, now, atMs, entry?.termIv?.[d] ?? entry?.iv ?? 0);
    byAt[d] = out;
    swap.set(src, out);
    src.forEach((n, i) => {
      const m = sums.get(n.strike) ?? { c0: 0, p0: 0, c1: 0, p1: 0 };
      m.c0 += n.callGex;
      m.p0 += n.putGex;
      m.c1 += out[i].callGex;
      m.p1 += out[i].putGex;
      sums.set(n.strike, m);
    });
  }
  /* the whole book: each strike's legs move as its dated legs did; a strike no loaded date carries stays as it is */
  const reAll = (all: readonly StrikeNode[]): StrikeNode[] => {
    const out = all.map(n => {
      const m = sums.get(n.strike);
      if (!m) return n;
      const callGex = m.c0 ? n.callGex * (m.c1 / m.c0) : n.callGex;
      const putGex = m.p0 ? n.putGex * (m.p1 / m.p0) : n.putGex;
      return { ...n, callGex, putGex, netGex: callGex + putGex };
    });
    registerChainDates(out, 'ALL');
    return out;
  };
  const uwChains: NonNullable<MarketSnapshot['uwChains']> = {};
  for (const [k, c] of Object.entries(chains)) {
    if (!c) continue;
    let next = swap.get(c);
    if (!next) {
      next = k === 'ALL' || c === chains.ALL ? reAll(c) : c;
      swap.set(c, next);
    }
    uwChains[k] = next;
  }
  const chain = swap.get(live.chain) ?? live.chain;
  return { chain, uwChains, uwByDate: byAt };
}

/** The market as it stood at a position — the live snapshot's shape, the book of that moment */
export function snapshotAt(live: MarketSnapshot, range: ReplayRange, pos: number): MarketSnapshot {
  const bars = barsAt(range, pos);
  const spot = spotAt(range, pos);
  const open0 = range.bars[0].open;
  const vendor = liveBookAt(live, spot, (bars[bars.length - 1]?.time ?? range.bars[0].time) * 1000);
  if (vendor) {
    return { ...live, spot, changePercent: open0 > 0 ? ((spot - open0) / open0) * 100 : 0, priceHistory: bars.map(b => b.close), ...vendor, tape: [] };
  }
  const template = new Map(live.chain.map(n => [n.strike, n]));
  const chain: StrikeNode[] = levelsAt(range, pos).map(l => {
    const t = template.get(l.strike);
    const callOI = l.callOI ?? t?.callOI ?? 0;
    const putOI = l.putOI ?? t?.putOI ?? 0;
    /* each leg: the live leg at the strike, per contract, times that moment's contracts (legsOf above) */
    const perC = (leg: number | undefined, oi: number | undefined) => (leg != null && oi ? leg / oi : 0);
    const cGex = t ? perC(t.callGex, t.callOI) * callOI : callOI * W_CALL;
    const pGex = t ? perC(t.putGex, t.putOI) * putOI : putOI * W_PUT;
    const g = legsOf(l.value, cGex, pGex);
    const callGex = g.call;
    const putGex = g.put;
    const dex = l.dex ?? t?.netDex ?? 0;
    const vex = l.vex ?? t?.netVex ?? 0;
    const dx = legsOf(dex, t ? perC(t.callDex, t.callOI) * callOI : dex / 2, t ? perC(t.putDex, t.putOI) * putOI : dex / 2);
    const vx = legsOf(vex, t ? perC(t.callVex, t.callOI) * callOI : vex / 2, t ? perC(t.putVex, t.putOI) * putOI : vex / 2);
    return {
      ...(t ?? { strike: l.strike, ...EMPTY_NODE }),
      strike: l.strike,
      callOI,
      putOI,
      callGex,
      putGex,
      netGex: l.value,
      callDex: dx.call,
      putDex: dx.put,
      netDex: dex,
      callVex: vx.call,
      putVex: vx.put,
      netVex: vex,
    };
  });
  const open = range.bars[0].open;
  return {
    ...live,
    spot,
    changePercent: open > 0 ? ((spot - open) / open) * 100 : 0,
    priceHistory: bars.map(b => b.close),
    chain: chain.length ? chain : live.chain,
    tape: [],
  };
}
