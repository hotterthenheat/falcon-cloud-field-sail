/* A name's book as the pages read it: the chains by scope (Today, the ladder dates, every expiry), the snapshot built
   from them, the share expiring today, and the bars and per-minute history beside them. */

import { bookToday, expiryFor, isoDate, nextSession } from '../../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase } from '../../core/nyTime';
import { pickLegWalls } from '../../core/walls';
import { registerChainDates } from '../chainDates';
import { levelFlip, regimeOfNet } from '../flipLevel';
import { type Candle, type GexSnapshot, type Indicators, type MarketSnapshot, type StrikeNode, type TradePlan } from '../../types/market';
import { getDeskSession, currentSessionBars, minuteInSession, sessionMeta, type DeskSession } from '../deskSession';
import { type LevelsScope } from '../levelsScope';
import { sameName } from '../spotGexBook';
import { expiryOpen } from '../../core/tradingYear';
import { emptyNode, mergeChains } from './scale';
import { BOOK_LISTINGS, LADDER_DTE, chartAll, chartSpan, closestDate, datesComplete, gammaPriced, peekEntry, peekGammaPriced, settledLive, settledRows, type Entry } from './store';
import { blankTapeDay } from './tape';
import { peekTape } from '../thetaTape';
import { setHistoryMaker } from './engineView';


/** The live gamma still carried by contracts that have settled (dates before the book's day), RETAIL sign, dollars per
    1% — what the vendor's whole-book figures (spot-exposures/strike, the minute series) still count after the close.
    0 when nothing settled is listed; null while a settled date's live rows are not in yet. */
export function peekSettledNet(ticker: string): number | null {
  const e = peekEntry(ticker);
  if (!e) return null;
  const floor = isoDate(bookToday());
  const settled = (e.expiries ?? []).map(x => x.date).filter(d => d < floor);
  let sum = 0;
  for (const d of settled) {
    const rows = settledRows(e, d);
    if (!rows) return null;
    for (const v of rows.values()) sum += v.c + v.p;
  }
  return sum;
}

/** The last two cash sessions once the book has landed. Null until then. */
function chartBars(ticker: string): Candle[] | null {
  const rows = chartSpan.get(sameName(ticker));
  return rows && rows.length >= 2 ? rows : null;
}

/** Bars in one session only. Null means that session has no prints. */
function sessionChartBars(ticker: string, session: DeskSession = getDeskSession()): Candle[] | null {
  if (session === 'rth') {
    const span = chartBars(ticker);
    if (span && span.length >= 1) return span;
    const cash = bookCandles(ticker);
    return cash && cash.length >= 1 ? cash : null;
  }
  const all = chartAll.get(sameName(ticker)) ?? peekEntry(ticker)?.tape ?? [];
  if (!all.length) return null;
  const rows = all.filter(c => minuteInSession(nyMinutes(c.time * 1000), session));
  if (rows.length < 1) return null;
  const days: string[] = [];
  for (const c of rows) {
    const d = nyIsoDate(c.time * 1000);
    if (days[days.length - 1] !== d) days.push(d);
  }
  const keep = new Set(days.slice(-2));
  return rows.filter(c => keep.has(nyIsoDate(c.time * 1000)));
}

/** The bars the chart should draw. The asked session wins. If it has no prints, the last session that does is used and named — never a silent swap.
    A strike book priced on a different day, or more than 1.5% away from the last candle, is named too. The nodes and the candles are not two prices. */
export function deskTape(ticker: string, session: DeskSession = getDeskSession()): { bars: Candle[]; drawn: DeskSession; note: string | null } {
  const own = sessionChartBars(ticker, session);
  const drawn = session;
  let note: string | null = null;
  let bars: Candle[] = own ?? [];
  if (!own || own.length < 1) {
    bars = [];
    note = `${sessionMeta(session).label} has no prints.`;
  }
  const last = bars[bars.length - 1];
  const priced = peekGammaPriced(ticker, null);
  const blank = blankTapeDay.get(sameName(ticker));
  if (blank && (!last || nyIsoDate(last.time * 1000) < blank)) {
    note = `${blank} minute bars were empty. Showing ${last ? nyIsoDate(last.time * 1000) : 'nothing'}.`;
  } else if (last && priced && priced.price > 0) {
    const candleDay = nyIsoDate(last.time * 1000);
    const bookDay = nyIsoDate(priced.at);
    if (bookDay && candleDay && bookDay !== candleDay) {
      note = `Candles are ${candleDay}. The strike book is ${bookDay}, priced at ${priced.price.toFixed(2)}.`;
    } else if (Math.abs(priced.price - last.close) / priced.price > 0.015) {
      note = `Candles end at ${last.close.toFixed(2)}. The strike book is priced at ${priced.price.toFixed(2)}.`;
    }
  }
  return { bars, drawn, note };
}

/** Sum the per-expiry vega already on the book onto the aggregate chain (a new aggregate — see paintLegs). */
export function vexOntoAll(entry: Entry): void {
  /* vega and vanna: both priced off the contracts only (book/scale.ts paintLegs), so the whole book's are the live
     painted dates' summed */
  const agg = new Map<number, { call: number; put: number; vc: number; vp: number }>();
  /* the live dates only: a date that settled at the bell holds no vega (its contracts are gone), and summing its last
     painted vex onto the whole book counted dead contracts */
  const floor = isoDate(bookToday());
  for (const [date, chain] of Object.entries(entry.byDate)) {
    if (date < floor || !expiryOpen(date)) continue;
    for (const n of chain) {
      if (!n.callVex && !n.putVex && !n.callVanna && !n.putVanna) continue;
      const cur = agg.get(n.strike) ?? { call: 0, put: 0, vc: 0, vp: 0 };
      cur.call += n.callVex;
      cur.put += n.putVex;
      cur.vc += n.callVanna;
      cur.vp += n.putVanna;
      agg.set(n.strike, cur);
    }
  }
  if (!agg.size) return;
  let changed = false;
  const next = entry.all.map(n => {
    const v = agg.get(n.strike);
    if (!v || (n.callVex === v.call && n.putVex === v.put && n.callVanna === v.vc && n.putVanna === v.vp)) return n;
    changed = true;
    return { ...n, callVex: v.call, putVex: v.put, netVex: v.call + v.put, callVanna: v.vc, putVanna: v.vp, netVanna: v.vc + v.vp };
  });
  if (changed) entry.all = next;
}

/** One book at every bar of the tape. The dollars are the chain's own net gamma, the same figure the strike rail
    shows. Every bar shares one levels array (the book does not change between its reads), registered to its name so a
    reader holding only a snapshot can ask for the name's levels (bookOfLevels). */
const levelsOwner = new WeakMap<object, string>();
/** The name whose book a snapshot's levels array is, or null for one not made here */
export const bookOfLevels = (levels: object): string | null => levelsOwner.get(levels) ?? null;
setHistoryMaker((chain, candles, ticker) => historyFrom(chain, candles, ticker));
export function historyFrom(chain: StrikeNode[], candles: Candle[], ticker: string): GexSnapshot[] {
  if (!chain.length || !candles.length) return [];
  const levels = chain.map(n => ({
    strike: n.strike,
    value: n.netGex,
    dex: n.netDex ?? 0,
    vex: n.netVex ?? 0,
    callOI: n.callOI,
    putOI: n.putOI,
    firm: n.flowFirm !== false,
  }));
  levelsOwner.set(levels, ticker);
  return candles.map(c => ({ time: c.time, levels }));
}

/** Two scales once a same-day expiry and a later one are both in. The front date is the first expiry still open, never the vendor's dte 0 after that day has settled. */
export function noteSplit(entry: Entry): void {
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor && entry.byDate[d]?.length).sort();
  const zeroDate = dates[0];
  const restDates = zeroDate ? dates.filter(d => d !== zeroDate) : [];
  if (!zeroDate || !restDates.length) {
    entry.history0 = undefined;
    entry.historyRest = undefined;
    return;
  }
  const histAll = entry.tape.length >= 2 ? entry.tape : entry.candles;
  const candles = entry.wantFull ? histAll : histAll.filter((c, i) => i === histAll.length - 1 || Math.floor(c.time / 60) % 5 === 0);
  entry.history0 = historyFrom(entry.byDate[zeroDate], candles, entry.ticker);
  entry.historyRest = historyFrom(mergeChains(restDates.map(d => entry.byDate[d])), candles, entry.ticker);
}

function indicatorsOf(closes: number[]): Indicators {
  const ema = (n: number) => {
    if (!closes.length) return 0;
    const k = 2 / (n + 1);
    let e = closes[0];
    for (const c of closes) e = c * k + e * (1 - k);
    return e;
  };
  let rsi = 50;
  if (closes.length > 15) {
    let gain = 0;
    let loss = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      if (d >= 0) gain += d;
      else loss -= d;
    }
    rsi = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return { rsi, ema9: ema(9), ema21: ema(21), ema50: ema(50), squeeze: false };
}

function planFor(ticker: string, spot: number, chain: StrikeNode[], flipAt: number | null): TradePlan {
  const walls = pickLegWalls(chain, n => n.callGex, n => n.putGex);
  const flip = flipAt ?? Number.NaN;
  const callWall = walls.callWall ?? Number.NaN;
  const putWall = walls.putWall ?? Number.NaN;
  return {
    ticker,
    /* set off the one regime below (materializeNow); until the flip is read nothing says bearish */
    direction: 'BULLISH',
    score: 0,
    confidence: 0,
    entry: spot,
    stopLoss: putWall,
    target1: callWall,
    target2: callWall,
    flipZone: flip,
    supportWall: putWall,
    resistanceWall: callWall,
  };
}

/** The date an expiry choice reads on this name's book — the one chainsFor hands the pages — or null when the book is
    not in or the choice is not one date. The expiry cards label themselves with it. */
export function expiryDateFor(ticker: string, choice: string): string | null {
  const entry = peekEntry(ticker);
  if (!entry) return null;
  const dte = LADDER_DTE.find(([label]) => label === choice)?.[1];
  if (dte == null) return null;
  /* the date chainsFor hands the pages, resolved step for step the same way */
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor);
  const hit = closestDate(isoDate(expiryFor(dte, bookToday()).date), dates);
  if (hit && entry.byDate[hit]?.length) return hit;
  if (choice !== '0DTE') return null;
  return [...dates].sort().find(d => entry.byDate[d]?.length) ?? null;
}

const LIVE_KEYS = ['callGex', 'putGex', 'netGex', 'callDex', 'putDex', 'netDex', 'callVex', 'putVex', 'netVex', 'callVanna', 'putVanna', 'netVanna', 'callCharm', 'putCharm', 'netCharm', 'callOI', 'putOI'] as const;

/* The whole book without the day that settled: the vendor's totals still carry it until they roll, so once that date's
   own chain is in it comes off the total, strike by strike. */
export function liveAll(entry: Entry): StrikeNode[] {
  /* the engine's whole book is already its dates added up, the expired population off (book/engineView.ts) */
  if (entry.engine) return entry.all;
  const memo = liveAllMemo.get(entry);
  const floor = isoDate(bookToday());
  if (memo && memo.all === entry.all && memo.byDate === entry.byDate && memo.floor === floor && memo.n === entry.expiries.length) return memo.out;
  const out = oneSnapshot(entry, liveAllOld(entry));
  liveAllMemo.set(entry, { all: entry.all, byDate: entry.byDate, floor, n: entry.expiries.length, out });
  return out;
}
const liveAllMemo = new WeakMap<Entry, { all: StrikeNode[]; byDate: Entry['byDate']; floor: string; n: number; out: StrikeNode[] }>();

/* Once every live listed date's rows are in, the whole book at each strike IS those dates' rows added up — gamma (one
   snapshot for net, walls and flip) and every other greek, each date on its own clock; until then the vendor's whole-book
   rows stand in, provisional. Open interest stays on the whole-book rows. */
const SUMMED = ['Gex', 'Dex', 'Vex', 'Vanna', 'Charm'] as const;
function oneSnapshot(entry: Entry, base: StrikeNode[]): StrikeNode[] {
  const floor = isoDate(bookToday());
  /* every live listing must be one the dates read (the first BOOK_LISTINGS — datesComplete) */
  if (!entry.gammaLive || !datesComplete(entry) || entry.expiries.filter(e => e.date >= floor).length > BOOK_LISTINGS) return base;
  const dates = Object.keys(entry.byDate).filter(d => d >= floor && entry.byDate[d]?.length);
  if (!dates.length) return base;
  type Sum = { c: Record<(typeof SUMMED)[number], number>; p: Record<(typeof SUMMED)[number], number>; px?: number; at?: number };
  const zero = () => ({ Gex: 0, Dex: 0, Vex: 0, Vanna: 0, Charm: 0 });
  const sum = new Map<number, Sum>();
  for (const d of dates)
    for (const n of entry.byDate[d]) {
      const cur = sum.get(n.strike) ?? { c: zero(), p: zero() };
      for (const g of SUMMED) {
        cur.c[g] += n[`call${g}`] ?? 0;
        cur.p[g] += n[`put${g}`] ?? 0;
      }
      if (n.gexAt != null && (cur.at == null || n.gexAt >= cur.at)) {
        cur.at = n.gexAt;
        cur.px = n.gexPx;
      }
      sum.set(n.strike, cur);
    }
  const laid = (n: StrikeNode, v: Sum | undefined): StrikeNode => {
    const out: StrikeNode = { ...n, gexPx: v?.px ?? n.gexPx, gexAt: v?.at ?? n.gexAt };
    for (const g of SUMMED) {
      out[`call${g}`] = v ? v.c[g] : 0;
      out[`put${g}`] = v ? v.p[g] : 0;
      out[`net${g}`] = out[`call${g}`] + out[`put${g}`];
    }
    return out;
  };
  const seen = new Set<number>();
  const out = base.map(n => {
    seen.add(n.strike);
    return laid(n, sum.get(n.strike));
  });
  for (const [k, v] of sum) if (!seen.has(k)) out.push(laid(emptyNode(k), v));
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

/** The book a finished session ran on: the live dates' rows with that session's settled contracts put back — null until
    every date is in. */
export function peekSessionAll(ticker: string, settledDate: string): StrikeNode[] | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.gammaLive) return null;
  const floor = isoDate(bookToday());
  if (!datesComplete(e) || e.expiries.filter(x => x.date >= floor).length > BOOK_LISTINGS) return null;
  const live = liveAll(e);
  const rows = settledRows(e, settledDate);
  if (!rows?.size) return live;
  const seen = new Set<number>();
  const out = live.map(n => {
    seen.add(n.strike);
    const l = rows.get(n.strike);
    if (!l) return n;
    const callGex = n.callGex - l.c;
    const putGex = n.putGex - l.p;
    return { ...n, callGex, putGex, netGex: callGex + putGex };
  });
  for (const [k, l] of rows) if (!seen.has(k)) out.push({ ...emptyNode(k), callGex: -l.c, putGex: -l.p, netGex: -l.c - l.p });
  out.sort((a, b) => a.strike - b.strike);
  return out;
}

function liveAllOld(entry: Entry): StrikeNode[] {
  const floor = isoDate(bookToday());
  const settled = Object.keys(entry.byDate).filter(d => d < floor && entry.byDate[d]?.length);
  if (!settled.length) return entry.all;
  /* the live whole book carries the settled contracts' gamma until the vendor rolls: their own live rows come off */
  const liveOff = new Map<number, { c: number; p: number }>();
  if (entry.gammaLive)
    for (const d of settled) {
      const rows = settledRows(entry, d);
      if (rows) for (const [k, v] of rows) {
        const cur = liveOff.get(k) ?? { c: 0, p: 0 };
        cur.c += v.c;
        cur.p += v.p;
        liveOff.set(k, cur);
      }
    }
  const off = new Map<number, StrikeNode[]>();
  for (const d of settled) for (const n of entry.byDate[d]) off.set(n.strike, [...(off.get(n.strike) ?? []), n]);
  return entry.all.map(n => {
    const gone = off.get(n.strike);
    const lo = liveOff.get(n.strike);
    if (!gone && !lo) return n;
    const out = { ...n };
    if (lo) {
      out.callGex = n.callGex + lo.c;
      out.putGex = n.putGex + lo.p;
      out.netGex = out.callGex + out.putGex;
    }
    if (!gone) return out;
    for (const k of LIVE_KEYS) {
      /* on the live book the settled gamma came off above, from the settled date's own live rows */
      if (entry.gammaLive && (k === 'callGex' || k === 'putGex' || k === 'netGex')) continue;
      const less = gone.reduce((a, g) => a + (g[k] ?? 0), 0);
      if (less) out[k] = (k === 'callOI' || k === 'putOI') ? Math.max(0, out[k] - less) : out[k] - less;
    }
    return out;
  });
}

function chainsFor(entry: Entry): Partial<Record<string, StrikeNode[]>> {
  const dates = Object.keys(entry.byDate).filter(d => d >= isoDate(bookToday()) && expiryOpen(d));
  const all = liveAll(entry);
  registerChainDates(all, 'ALL');
  const out: Partial<Record<string, StrikeNode[]>> = { ALL: all };
  for (const [label, dte] of LADDER_DTE) {
    const want = isoDate(expiryFor(dte, bookToday()).date);
    const hit = closestDate(want, dates);
    if (hit && entry.byDate[hit]?.length) out[label] = entry.byDate[hit];
  }
  const fridays = entry.expiries.filter(e => {
    const dt = new Date(`${e.date}T00:00:00`);
    return dt.getUTCDay() === 5 && e.dte >= 14 && e.dte <= 45;
  });
  const opex = fridays.sort((a, b) => Math.abs(a.dte - 30) - Math.abs(b.dte - 30))[0];
  if (opex && entry.byDate[opex.date]?.length) out.OPEX = entry.byDate[opex.date];
  /* the fallback is the first LIVE date — the sorted list's head after the bell is the day that just settled */
  const firstLive = [...dates].sort().find(d => d >= isoDate(bookToday()));
  if (!out['0DTE'] && firstLive && entry.byDate[firstLive]?.length) out['0DTE'] = entry.byDate[firstLive];
  return out;
}

/* The listing as it stands on the book's day: settled dates leave it, the rest count their days from the book's day. */
function liveListing(expiries: Entry['expiries']): Entry['expiries'] {
  const floor = isoDate(bookToday());
  const settledFront = expiries.find(e => e.dte === 0 && e.date < floor);
  /* the vendor's dte counts calendar days (Oct 21 → Oct 26 is 5), so the shift does too — a Friday's settled front is three days behind Monday */
  const shift = settledFront ? Math.round((Date.parse(`${floor}T00:00:00Z`) - Date.parse(`${settledFront.date}T00:00:00Z`)) / 86_400_000) : 0;
  const live = expiries.filter(e => e.date >= floor && expiryOpen(e.date)).map(e => (shift ? { ...e, dte: Math.max(0, e.dte - shift) } : e));
  return live;
}

/* A name's snapshot is built once per state of its own book (the arrays it is made of, the price, the day's move, the
   session phase) and handed out again until one of them changes. */
const snapMemo = new WeakMap<Entry, Map<LevelsScope, { sig: string; refs: unknown[]; snap: MarketSnapshot }>>();
export function materialize(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const refs: unknown[] = [entry.engine, entry.byDate, entry.all, entry.expiries, entry.candles, entry.termIv, entry.totals, entry.factsDates, entry.state, entry.flow, entry.history];
  const sig = [entry.spot, entry.changePct, entry.extPct, entry.phase, entry.dayKnown, entry.iv, entry.gammaLive, entry.full, entry.frontFacts, entry.factsDates?.size ?? 0, entry.candles.length, entry.candles[entry.candles.length - 1]?.close, isoDate(bookToday()), nySessionPhase(Date.now()), settledLive.size, gammaPriced.size].join('|');
  let byScope = snapMemo.get(entry);
  const hit = byScope?.get(scope);
  if (hit && hit.sig === sig && hit.refs.every((r, i) => r === refs[i])) return hit.snap;
  const snap = materializeNow(entry, scope);
  if (!byScope) {
    byScope = new Map();
    snapMemo.set(entry, byScope);
  }
  byScope.set(scope, { sig, refs, snap });
  return snap;
}
function materializeNow(entry: Entry, scope: LevelsScope): MarketSnapshot {
  const uwChains = chainsFor(entry);
  const today = uwChains['0DTE'];
  const chain = scope === 'ALL' ? (uwChains.ALL ?? entry.all) : today && today.length ? today : (uwChains.ALL ?? entry.all);
  const closes = entry.candles.map(c => c.close);
  const snap: MarketSnapshot = {
    ticker: entry.ticker,
    spot: entry.spot,
    changePercent: entry.changePct,
    dayMove: { extPct: entry.extPct ?? null, phase: entry.phase ?? 'regular', known: entry.dayKnown !== false },
    priceHistory: closes.slice(-120),
    chain,
    indicators: indicatorsOf(closes),
    plan: planFor(entry.ticker, entry.spot, chain, null),
    tape: [],
    liveBook: true,
    uwChains,
    uwByDate: entry.byDate,
    uwExpiries: liveListing(entry.expiries),
    uwFacts: entry.factsDates,
    ...(entry.engine ? { book: { mode: entry.engine.mode, at: entry.engine.at, price: entry.engine.price, why: entry.engine.why }, timeUnit: entry.engine.unit } : {}),
  };
  /* the plan's flip zone is the one flip (data/flipLevel.ts), read off the snapshot's own levels chain */
  const read = levelFlip(snap, chain);
  /* the direction is the one regime (flipLevel.ts regimeOfNet on the net re-priced at spot): long gamma reads bullish,
     short bearish — never "the side of the flip", which a book crossing twice gets wrong */
  snap.plan = { ...snap.plan, flipZone: read.flip ?? Number.NaN, direction: regimeOfNet(read.netAtSpot) === 'SHORT' ? 'BEARISH' : 'BULLISH' };
  return snap;
}

/** A name's call and put walls in a levels scope, off the chain levelsFor reads for it (the front date's own chain for
    "Today", else the live whole book with the settled dates off — liveAll), by the one rule (core/walls.ts). A peek:
    no fetch; null until the book is live. Pages that print a name's walls without its levels (the watchlist) read this. */
export function scopeWalls(ticker: string, scope: LevelsScope): { callWall: number | null; putWall: number | null } | null {
  const entry = peekEntry(ticker);
  if (!entry || entry.status !== 'live' || !entry.all.length) return null;
  const chains = chainsFor(entry);
  const today = chains['0DTE'];
  /* no stand-in: "Today" before its own date's chain is in, or All expiries before every date has landed, has no walls yet
     (levelsFor's wallsFinal) — the whole book's walls are not the day's */
  if (scope === 'ALL' ? !datesComplete(entry) : !today?.length) return null;
  const chain = scope === 'ALL' ? chains.ALL ?? liveAll(entry) : today!;
  return pickLegWalls(chain, n => n.callGex, n => n.putGex);
}

/** Every listed date of a full book has landed once — the Map's matrix window is final */
export const bookDatesIn = (ticker: string): boolean => {
  const e = peekEntry(ticker);
  return !!e && (!!e.everFull || (e.status === 'live' && !e.wantFull));
};

export function bookCandles(ticker: string): Candle[] | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' ? e.candles : null;
}

/** Theta's one-minute bars for this session once that tape has been read. Null only while nobody has asked — an empty live, kept, or offline tape is no prints, not a reason to walk the vendor's closes. */
export function thetaPriceBars(ticker: string, session: DeskSession): Candle[] | null {
  const t = peekTape(ticker, '1m', session);
  if (t.bars.length) return t.bars;
  if (t.takenAt > 0 || t.state === 'live' || t.state === 'kept' || t.state === 'offline') return [];
  return null;
}

/** The day's price in the session the head is set to, or the one you name. Regular hours are the cash bars. An empty list means the feed has no prints in that window — never a made-up chain. When Theta's minute bars have been read, they are the path — the vendor's bars are only the stand-in before that tape is asked. */
export function deskBars(ticker: string, session: DeskSession = getDeskSession()): Candle[] | null {
  const theta = thetaPriceBars(ticker, session);
  if (theta != null) return theta.length ? currentSessionBars(theta, session) : [];
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return null;
  if (session === 'rth') return e.candles.length ? e.candles : null;
  const src = e.tape?.length ? e.tape : e.candles;
  return src.filter(c => minuteInSession(nyMinutes(c.time * 1000), session));
}

/** Every print on the tape, in order — premarket through the close and the overnight that brackets them. */
export function dayBars(ticker: string): Candle[] | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live') return null;
  const src = e.tape?.length >= 2 ? e.tape : e.candles;
  return src.length >= 2 ? src : null;
}

export function bookHistory(ticker: string): GexSnapshot[] | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' ? e.history : null;
}

const BOOK_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function expiryLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  const month = BOOK_MONTHS[(parts[1] ?? 1) - 1] ?? iso;
  return `${month} ${parts[2] ?? ''}`.trim();
}

/** The chain the chart, the header and the calendar column share. A date is that expiry. Null is the first expiry still open. `'book'` is every expiry added together.
    `movedFrom` is set when the date asked for has settled and the chain drawn is the next one still open. */
export function chainForDate(ticker: string, date: string | 'book' | null): { nodes: StrikeNode[]; label: string; kind: 'Flow' | 'OI'; date: string; movedFrom: string | null } | null {
  const entry = peekEntry(ticker);
  if (!entry || entry.status !== 'live') return null;
  const kindOf = (nodes: StrikeNode[]): 'Flow' | 'OI' => (nodes.some(n => n.oiNetGex != null) ? 'Flow' : 'OI');
  if (date === 'book') {
    /* the whole book live in this session: the dates that settled come off (liveAll, the chain Pinpoint's levels read),
       registered as the whole book so the flip and the hedge-flow ladder re-price it */
    const all = liveAll(entry);
    registerChainDates(all, 'ALL');
    return all.length ? { nodes: all, label: 'Whole book', kind: kindOf(all), date: 'book', movedFrom: null } : null;
  }
  const floor = isoDate(bookToday());
  const dates = Object.keys(entry.byDate).filter(d => d >= floor && expiryOpen(d) && entry.byDate[d]?.length).sort();
  const asked = date && date !== 'book' ? date : null;
  const hit = asked && asked >= floor && expiryOpen(asked) && entry.byDate[asked]?.length ? asked : dates[0];
  if (!hit) return null;
  const nodes = entry.byDate[hit];
  const label = expiryLabel(hit);
  const movedFrom = asked && asked !== hit && !expiryOpen(asked) ? expiryLabel(asked) : null;
  return { nodes, label, kind: kindOf(nodes), date: hit, movedFrom };
}

/** Share of the book's dollar gamma that expires today, percent. `none`: nothing on this name expires today. `wait`:
    the dollar book is not in yet. Share gamma (greek-exposure totals) is not this column. */
export function peekBellShare(ticker: string): { share: number } | { share: null; why: 'none' | 'wait' } {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !e.gammaLive) return { share: null, why: 'wait' };
  /* the session the book is on (after Friday's bell bookToday is Saturday, and nothing "expired Saturday") */
  const today = isoDate(nextSession(bookToday()));
  const listedToday = e.expiries.some(x => x.date === today);
  const todayChain = e.byDate[today];
  /* the whole live book is only final once the contracts that settled come off it (liveAll) */
  if (todayChain?.length && peekSettledNet(e.ticker) == null) return { share: null, why: 'wait' };
  if (todayChain?.length) {
    const gross = (ch: readonly StrikeNode[]) => ch.reduce((a, n) => a + Math.abs(n.callGex) + Math.abs(n.putGex), 0);
    const total = gross(liveAll(e));
    const dies = gross(todayChain);
    if (total > 0) return { share: Math.min(100, Math.round((100 * dies) / total)) };
  }
  if (listedToday) return { share: null, why: 'wait' };
  if (e.expiries.length) return { share: null, why: 'none' };
  return { share: null, why: 'wait' };
}
