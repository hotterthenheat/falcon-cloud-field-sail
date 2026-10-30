/* The Map rewinds: one position (seconds from the session's first bar), and every surface reads the book as it stood then — bars up to it,
   spot between two closes, the chain from the book history (bookHistory), read on a five-second grid between minutes so colours turn smoothly. */

import { bookHistory, dayBars } from './uwBook';
import { OPEN_MIN, hhmm } from './ahead';
import { sessionBars } from './levelview';
import { sessionMeta, sessionOfMinute, type DeskSession } from './deskSession';
import { nyDay, nyMinutes } from '../core/nyTime';
import { dollarGammaPerContract } from '../core/gammaFlip';
import { bookToday, isoDate } from '../core/calendar';
import { yearsTo } from './flipLevel';
import { registerChainDates } from './chainDates';
import type { Candle, GexLevel, GexSnapshot, MarketSnapshot, StrikeNode } from '../types/market';

/** The book is read every five seconds of session time */
const FRAME_SEC = 5;
const BAR_SEC = 60;

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
/** The clock at a position, New York minutes from midnight, from the session's own first bar when given, else from 09:30. */
export const replayMinute = (pos: number, range?: ReplayRange | null) => {
  const min = replayStart(range) + Math.floor(pos / BAR_SEC);
  return min >= 24 * 60 || min < 0 ? ((min % (24 * 60)) + 24 * 60) % (24 * 60) : min;
};
export const replayLabel = (pos: number, range?: ReplayRange | null) => hhmm(replayMinute(pos, range));
/** The day the session is — from its first bar, New York's calendar */
export const replayDay = (range: ReplayRange) => nyDay(range.bars[0].time * 1000);
/** A New York minute's position in a session: another name is rewound to the host's minute, never its position (sessions can start on different minutes). */
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

/* The legs of a rewound strike, bounded: each leg is the live leg scaled by its own OI then and now, and the small difference to the kept net
   is shared by size, so the legs add to the net and neither exceeds its contracts (dividing the net by near-cancelling weights blew up). */
function legsOf(net: number, callEst: number, putEst: number): { call: number; put: number } {
  const size = Math.abs(callEst) + Math.abs(putEst);
  /* No estimate of the legs: the net stays on the level, and neither leg is invented. */
  if (size < 1e-9) return { call: 0, put: 0 };
  const rest = net - (callEst + putEst);
  return { call: callEst + (rest * Math.abs(callEst)) / size, put: putEst + (rest * Math.abs(putEst)) / size };
}

/* A past minute of the vendor's book is today's contracts re-priced: OI is counted overnight, so each leg's dollar gamma is re-priced
   (Black-Scholes at that minute's spot and time, own vol) and every chain moves together. */
const RATIO_CAP = 25;
function repriceDate(chain: readonly StrikeNode[], date: string, s0: number, s1: number, t0: number, t1: number): StrikeNode[] {
  const T0 = yearsTo(date, t0);
  const T1 = yearsTo(date, t1);
  const ratio = (K: number, iv: number) => {
    if (!(iv > 0)) return 1;
    const a = dollarGammaPerContract(s0, K, T0, iv);
    if (!(a > 0)) return 1;
    return Math.min(RATIO_CAP, dollarGammaPerContract(s1, K, T1, iv) / a);
  };
  return chain.map(n => {
    /* A leg with no printed vol is not scaled by another expiry's vol or the name's 30-day vol. */
    const callIv = n.callIv && n.callIv > 0 ? n.callIv : 0;
    const putIv = n.putIv && n.putIv > 0 ? n.putIv : 0;
    const callGex = n.callGex * ratio(n.strike, callIv);
    const putGex = n.putGex * ratio(n.strike, putIv);
    return { ...n, callGex, putGex, netGex: callGex + putGex };
  });
}

/** The live vendor book re-priced at a past minute — null when the snapshot is not the vendor's */
function liveBookAt(live: MarketSnapshot, spot: number, atMs: number): Pick<MarketSnapshot, 'chain' | 'uwChains' | 'uwByDate'> | null {
  const by = live.uwByDate;
  const chains = live.uwChains;
  if (!live.liveBook || !by || !chains || !(live.spot > 0)) return null;
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
    const out = repriceDate(src, d, live.spot, spot, now, atMs);
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
    const known = !!t;
    const perC = (leg: number | undefined, oi: number | undefined) => (leg != null && oi ? leg / oi : 0);
    const cGex = known ? perC(t!.callGex, t!.callOI) * callOI : 0;
    const pGex = known ? perC(t!.putGex, t!.putOI) * putOI : 0;
    const g = known ? legsOf(l.value, cGex, pGex) : { call: 0, put: 0 };
    const callGex = g.call;
    const putGex = g.put;
    const dex = l.dex ?? (known ? t!.netDex : 0) ?? 0;
    const vex = l.vex ?? (known ? t!.netVex : 0) ?? 0;
    const dx = known ? legsOf(dex, perC(t!.callDex, t!.callOI) * callOI, perC(t!.putDex, t!.putOI) * putOI) : { call: 0, put: 0 };
    const vx = known ? legsOf(vex, perC(t!.callVex, t!.callOI) * callOI, perC(t!.putVex, t!.putOI) * putOI) : { call: 0, put: 0 };
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
