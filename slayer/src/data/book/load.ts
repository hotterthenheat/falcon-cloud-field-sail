/* Reading a name's book from Unusual Whales: the core (state, whole-book rows, bars, vols), the front date, every listed
   date and its contracts, the live gamma walk, and when a shut market's book is held rather than read again. */

import { bookToday, expiryFor, isoDate, isTradingDay, nextSession, MONTHS as MON3 } from '../../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase, nyWallTime } from '../../core/nyTime';
import { keptOf } from '../../core/dealerSign';
import { dayChangeOf, noteBarCloses } from '../dayChange';
import { type GexSnapshot, type StrikeNode } from '../../types/market';
import { levelsForName, readLevelsScope, type LevelsScope } from '../levelsScope';
import { sameName } from '../spotGexBook';
import { SIM_DESK } from '../deskMode';
import { uwCall, whalesBars, whalesFlowStrike, whalesGreekExpiry, whalesGreekStrike, whalesGreekStrikeExpiry, whalesIvRank, whalesInterpIv, whalesOiStrike, whalesOptionContractsPaged, whalesScreener, whalesState, whalesTermStructure, type UwBar, type UwFlowStrike, type UwGreekStrike, type UwInterp, type UwIv, type UwTerm, type UwState } from '../whales';
import { applyDay, needDay } from './day';
import { historyFrom, noteSplit, vexOntoAll } from './levels';
import { dayFracOf, dayIvOf, impliedMoveOf, termDteOf, termIvOf, termKOf, termMoveOf } from './move';
import { carryFacts, chainFrom, flowMap, foldContracts, liveGammaRows, num, oiMap, paintLegs, pricedClockOf, type LiveGamma, withLiveGamma } from './scale';
import { BOARD_MS, FULL_MS, LIVE_GAMMA_MS, cache, chartAll, chartSpan, closestDate, datesComplete, emit, emptyDates, gammaPriced, gen, horizonFactsMissing, hotGet, isHot, keptBooks, liveGammaCache, liveGammaWait, peekEntry, recordAsked, recordIso, settledLive, type BookMode, type Entry } from './store';
import { readKept } from './kept';
import { CLOSE_MIN, INDEX_TAPE, candlesFrom, cashToOf, closesFromTape, parseTape, quoteFromBars, regularCloseOf, thetaTape, twoCashSessions } from './tape';


/** The live open-interest gamma per strike (retail sign: calls +, puts −, dollars per 1%) — every expiry when `date` is
    null, else that one date. Null when the vendor has none. Kept a minute. */
function liveGamma(ticker: string, date: string | null, priority = false): Promise<LiveGamma | null> {
  const key = `${ticker}|${date ?? 'ALL'}`;
  const hit = liveGammaCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_GAMMA_MS) return Promise.resolve(hit.rows);
  const running = liveGammaWait.get(key);
  if (running) return running;
  const job = (async (): Promise<LiveGamma | null> => {
    const out: LiveGamma = new Map();
    const t = encodeURIComponent(ticker);
    const stamp = { price: 0, at: 0 };
    if (date) {
      const res = await uwCall(`/stock/${t}/spot-exposures/expiry-strike?expirations[]=${encodeURIComponent(date)}&limit=500`, priority);
      if (res.error) return hit?.rows ?? null;
      liveGammaRows(res.data, out, stamp);
    } else {
      for (let page = 0; page < 6; page++) {
        const res = await uwCall(`/stock/${t}/spot-exposures/strike?limit=500&page=${page}`, priority);
        if (res.error) {
          if (out.size) break;
          return hit?.rows ?? null;
        }
        if (liveGammaRows(res.data, out, stamp) < 500) break;
      }
    }
    if (stamp.price > 0 && stamp.at > 0) gammaPriced.set(`${ticker.toUpperCase()}|${date ?? 'ALL'}`, stamp);
    liveGammaCache.set(key, { at: Date.now(), rows: out });
    return out;
  })().finally(() => liveGammaWait.delete(key));
  liveGammaWait.set(key, job);
  return job;
}

/* Every date's live gamma in one walk of spot-exposures/expiry-strike without `expirations[]` (500 rows a page); each
   date's rows are kept exactly as the per-date ask keeps them. Null when a page fails. */
/* One walk shared: a walk in flight, or finished within WALK_REUSE_MS, answers a second caller. */
const WALK_REUSE_MS = 15_000;
const walks = new Map<string, { at: number; p: Promise<Map<string, LiveGamma> | null> }>();
function liveGammaAll(ticker: string, priority = false): Promise<Map<string, LiveGamma> | null> {
  const key = ticker.toUpperCase();
  const hit = walks.get(key);
  if (hit && Date.now() - hit.at < WALK_REUSE_MS) return hit.p;
  const p = liveGammaWalk(ticker, priority);
  const entry = { at: Date.now(), p };
  walks.set(key, entry);
  void p.then(got => {
    if (got == null) walks.delete(key);
    else entry.at = Date.now();
  });
  return p;
}
/* No read waits forever: a walk page or a date's chain that has not answered in its time is taken as failed, and the
   date is asked on its own (or on the next pass). */
const WALK_PAGE_MS = 25_000;
const DATE_READ_MS = 40_000;
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise(resolve => {
    const id = setTimeout(() => resolve(null), ms);
    p.then(
      v => {
        clearTimeout(id);
        resolve(v);
      },
      () => {
        clearTimeout(id);
        resolve(null);
      },
    );
  });
}
async function liveGammaWalk(ticker: string, priority = false): Promise<Map<string, LiveGamma> | null> {
  const t = encodeURIComponent(ticker);
  const rowsBy = new Map<string, Record<string, unknown>[]>();
  for (let page = 0; page < 60; page++) {
    const res = await within(uwCall(`/stock/${t}/spot-exposures/expiry-strike?limit=500&page=${page}`, priority), WALK_PAGE_MS);
    if (!res || res.error || !Array.isArray(res.data)) return null;
    const rows = res.data as Record<string, unknown>[];
    for (const r of rows) {
      const d = String(r.expiry ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      const list = rowsBy.get(d) ?? [];
      list.push(r);
      rowsBy.set(d, list);
    }
    if (rows.length < 500) break;
  }
  const out = new Map<string, LiveGamma>();
  const now = Date.now();
  for (const [date, rows] of rowsBy) {
    const live: LiveGamma = new Map();
    const stamp = { price: 0, at: 0 };
    liveGammaRows(rows, live, stamp);
    if (stamp.price > 0 && stamp.at > 0) gammaPriced.set(`${ticker.toUpperCase()}|${date}`, stamp);
    liveGammaCache.set(`${ticker}|${date}`, { at: now, rows: live });
    out.set(date, live);
  }
  return out;
}

/* The dates' gamma kept live: every live date's rows are re-read in one walk (kept a minute) whenever the book
   refreshes, and laid onto the chains in hand; other greeks and contract facts stay. */
const datesGammaAt = new Map<string, number>();
async function refreshDatesGamma(entry: Entry, token: number): Promise<void> {
  if (!entry.gammaLive) return;
  const t = entry.ticker;
  if (Date.now() - (datesGammaAt.get(t) ?? 0) < LIVE_GAMMA_MS) return;
  datesGammaAt.set(t, Date.now());
  const walked = await liveGammaAll(t, isHot(t)).catch(() => null);
  if (!walked || gen.get(t) !== token) return;
  const cur = cache.get(t);
  if (!cur) return;
  const floor = isoDate(bookToday());
  const byDate = { ...cur.byDate };
  let changed = false;
  for (const [d, live] of walked) {
    if (d < floor || !byDate[d]?.length) continue;
    byDate[d] = withLiveGamma(byDate[d], live, d);
    changed = true;
  }
  if (!changed) return;
  cur.byDate = byDate;
  cur.at = Date.now();
  cache.set(t, cur);
  emit();
}

/** One date's chain. With the greeks: the vendor's strike rows (delta, vanna, charm) carrying the live gamma. Without:
    the live gamma alone (one call — the Board reads nothing else off a date), the strike rows only if it fails. */
async function dateChain(ticker: string, date: string, spot: number, withGreeks: boolean, priority = false): Promise<StrikeNode[] | null> {
  const settled = date < isoDate(bookToday());
  const [rows, live] = await Promise.all([
    withGreeks || settled ? whalesGreekStrikeExpiry(ticker, date).catch(() => null) : Promise.resolve(null),
    liveGamma(ticker, date, priority).catch(() => null),
  ]);
  let base = Array.isArray(rows) ? chainFrom(rows, spot, new Map(), undefined, date) : [];
  /* A date that settled at 4:00: its live rows are kept to come off the whole book (liveAll); its chain is the vendor's
     morning rows — the book the session ran on, for the session's report. */
  if (settled) {
    if (live) settledLive.set(`${ticker}|${date}`, live);
    if (base.length) return base;
    return live ? withLiveGamma([], live, date) : null;
  }
  if (live) return withLiveGamma(base, live, date);
  if (!withGreeks) {
    const again = await whalesGreekStrikeExpiry(ticker, date).catch(() => null);
    /* both asks failed: null, so the date is asked again rather than marked empty for good */
    if (!Array.isArray(again)) return null;
    base = chainFrom(again, spot, new Map(), undefined, date);
  } else if (!Array.isArray(rows)) return null;
  return base;
}

/** A handful at a time. Forty expiry books at once stall the page that is trying to paint. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Math.max(1, Math.min(limit, items.length || 1));
  await Promise.all(
    Array.from({ length: items.length ? workers : 0 }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Open interest and vega the greek-by-expiry rows do not carry. One request a date. */
async function fillExpiryFacts(entry: Entry, token: number, only?: readonly string[]): Promise<void> {
  /* laid onto the book's current copy, so a refresh while the contracts were read does not throw them away */
  void token;
  const still = () => cache.get(entry.ticker)?.status === 'live';
  const dates = only ? only.filter(d => d in entry.byDate) : Object.keys(entry.byDate);
  if (!dates.length) return;
  /* One expiry at a time (the whole-name walk of option-contracts pages unstably); a date whose read fails is left unread
     so it is asked again, never taken as having no contracts. */
  const hot = isHot(entry.ticker);
  const books = await mapLimit(dates, 3, async date => {
    try {
      const rows = await whalesOptionContractsPaged(entry.ticker, date, hot);
      return [date, Array.isArray(rows) ? foldContracts(rows, date, pricedClockOf(entry.byDate[date] ?? []).at) : null] as const;
    } catch {
      return [date, null] as const;
    }
  });
  if (!still()) return;
  const current = cache.get(entry.ticker);
  if (!current) return;
  const byDate = { ...current.byDate };
  const facts = new Set(current.factsDates ?? []);
  for (const [date, book] of books) {
    if (!book) continue;
    const chain = byDate[date];
    if (chain && book.size) byDate[date] = paintLegs(chain, book, true, current.spot, date, current.ticker);
    facts.add(date);
  }
  current.byDate = byDate;
  current.factsDates = facts;
  vexOntoAll(current);
  current.at = Date.now();
  cache.set(current.ticker, current);
  emit();
}

/** One close-of-day strike book. A past date is the session's close, not a minute trail. Rows whose stamp is not that date are refused. */
async function spxCloseGamma(date: string): Promise<LiveGamma | null> {
  const out: LiveGamma = new Map();
  const seen = new Set<number>();
  for (let page = 0; page < 8; page++) {
    const res = await uwCall(`/stock/SPX/spot-exposures/strike?date=${encodeURIComponent(date)}&limit=500&page=${page}`);
    if (res.error) return out.size ? out : null;
    const rows = Array.isArray(res.data) ? res.data as Record<string, unknown>[] : [];
    const fresh = rows.filter(r => {
      const k = num(r.strike);
      if (!(k > 0) || seen.has(k)) return false;
      const stamp = String(r.time ?? '');
      if (stamp) {
        const at = Date.parse(stamp);
        const same = stamp.startsWith(date) || (Number.isFinite(at) && nyIsoDate(at) === date);
        if (!same) return false;
      }
      seen.add(k);
      return true;
    });
    if (!fresh.length) break;
    liveGammaRows(fresh, out);
    if (rows.length < 500) break;
  }
  return out.size ? out : null;
}

function snapOfClose(time: number, live: LiveGamma): GexSnapshot {
  const levels: GexSnapshot['levels'] = [];
  for (const [strike, leg] of live) {
    const value = keptOf(leg.c + leg.p);
    if (!value) continue;
    levels.push({ strike, value });
  }
  levels.sort((a, b) => a.strike - b.strike);
  return { time, levels };
}

/** The two sessions before today, each as the vendor's close book on that session's last bar. */
async function attachSpxCloses(ticker: string, token: number): Promise<void> {
  if (sameName(ticker) !== 'SPX') return;
  const span = chartSpan.get('SPX');
  if (!span?.length) return;
  const days: string[] = [];
  for (const c of span) {
    const d = nyIsoDate(c.time * 1000);
    if (days[days.length - 1] !== d) days.push(d);
  }
  const prior = days.filter(d => d < nyIsoDate()).slice(-2);
  const snaps: GexSnapshot[] = [];
  for (const date of prior) {
    if (gen.get(ticker) !== token) return;
    const live = await spxCloseGamma(date);
    if (!live) continue;
    const last = span.filter(c => nyIsoDate(c.time * 1000) === date).pop();
    if (!last) continue;
    snaps.push(snapOfClose(last.time, live));
  }
  const cur = cache.get(ticker);
  if (!cur || gen.get(ticker) !== token || !snaps.length) return;
  cur.closes = snaps;
  emit();
}

async function loadCore(ticker: string, mode: BookMode, token: number): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const hot = isHot(ticker);
  const t = encodeURIComponent(ticker);
  /* a name read for the Board alone skips what only the Map draws: the whole book's volume by strike, and its open
     interest unless the name's levels read every expiry */
  const boardOnly = mode === 'board' && !cache.get(ticker)?.wantFull;
  const [stateRaw, strikeRaw, oiRows, flowRows, ivRows, termRows, interpRows, stockBars, live] = await Promise.all([
    (hot ? hotGet<UwState>(`/stock/${t}/stock-state`, true) : whalesState(ticker)).catch(() => null),
    (hot ? hotGet<UwGreekStrike[]>(`/stock/${t}/greek-exposure/strike`, true) : whalesGreekStrike(ticker)).catch(() => [] as UwGreekStrike[]),
    boardOnly && levelsForName(ticker) !== 'ALL' ? Promise.resolve([] as UwGreekStrike[]) : whalesOiStrike(ticker).catch(() => [] as UwGreekStrike[]),
    boardOnly ? Promise.resolve([] as UwFlowStrike[]) : whalesFlowStrike(ticker).catch(() => [] as UwFlowStrike[]),
    whalesIvRank(ticker, hot).catch(() => []),
    (hot ? hotGet<UwTerm[]>(`/stock/${t}/volatility/term-structure`, true) : whalesTermStructure(ticker)).catch(() => [] as UwTerm[]),
    whalesInterpIv(ticker).catch(() => [] as UwInterp[]),
    /* a whole day of one-minute bars (pre-market, the session and the evening) */
    /* one-minute bars for every name, the same URL the full book and the Dossier read (one proxy copy) */
    /* Two cash sessions for the chart (yesterday and today). 1800 one-minute bars
       reach the prior open; the book's own candles stay today's session. */
    whalesBars(ticker, '1m', 1800).catch(() => [] as UwBar[]),
    liveGamma(ticker, null, hot).catch(() => null),
  ]);
  if (!still()) return;
  /* An index has no stock bars on this key (SPX /ohlc/1m is 422): its price and bars are ThetaData's where the page may read
     them (book/tape.ts thetaTape); a stock whose bars did not come back likewise — the last trade, not a bid. */
  let bars: UwBar[] = Array.isArray(stockBars) ? stockBars : [];
  let tapeKind: 'vendor' | 'index' | 'stock' = 'vendor';
  if (bars.length === 0 && INDEX_TAPE.has(ticker)) {
    bars = await thetaTape(ticker, true);
    if (bars.length) tapeKind = 'index';
    if (!still()) return;
  } else if (bars.length === 0) {
    bars = await thetaTape(ticker, false);
    if (bars.length) tapeKind = 'stock';
    if (!still()) return;
  }
  let state = stateRaw;
  let strikes = Array.isArray(strikeRaw) ? strikeRaw : [];
  /* An index has no stock-state or quote: the live gamma rows carry the price they were marked at, and greek-exposure has
     the strikes. */
  if ((!state || strikes.length === 0) && live && live.size) {
    if (strikes.length === 0) {
      strikes = [...live.keys()].filter(k => k > 0).map(strike => ({ strike }));
    }
    if (!state) {
      const px = gammaPriced.get(`${ticker.toUpperCase()}|ALL`)?.price ?? 0;
      if (px > 0) {
        const phase = nySessionPhase();
        /* the price the rows were marked at; the close before it is unknown here (0), so the day's change reads "—" */
        state = { close: px, prev_close: 0, market_time: phase === 'open' ? 'regular' : phase === 'before' ? 'premarket' : 'postmarket' };
      }
    }
  }
  /* Still no price: the screener's close. Indexes often have one when stock-state does not. */
  if (!state && strikes.length > 0) {
    const rows = await whalesScreener([ticker], true).catch(() => [] as Record<string, unknown>[]);
    const row = Array.isArray(rows) ? rows.find(r => String(r.ticker || '').toUpperCase() === ticker) ?? rows[0] : null;
    const px = num(row?.close) || num(row?.prev_close);
    if (px > 0) state = { close: px, prev_close: num(row?.prev_close), market_time: 'postmarket' };
  }
  /* No strikes from the vendor: no book (never another vendor's open interest in their place). */
  /* No stock-state. The tape's own print is the price: today's close stays today's close, and yesterday is only the change. */
  if (tapeKind !== 'vendor' && !stateRaw && bars.length) {
    const quoted = quoteFromBars(ticker, bars);
    if (quoted) state = quoted;
  }
  if (!state || strikes.length === 0) throw new Error('shape');
  /* Outside the session the price is the regular close (the levels were priced there); the after-hours or pre-market
     print is kept apart (`last`) and labelled where shown. */
  /* A stalled stock-state is not the price: in the session a bar newer than the state's tape time by over two minutes is. */
  const barsSplit = candlesFrom(Array.isArray(bars) ? bars : [], cashToOf(ticker));
  const name = sameName(ticker);
  chartSpan.set(name, twoCashSessions(Array.isArray(bars) ? bars : [], cashToOf(ticker), name === 'SPX' ? 3 : 2));
  chartAll.set(name, parseTape(Array.isArray(bars) ? bars : []));
  const tapeMs = Date.parse(String((state as { tape_time?: string }).tape_time ?? ''));
  const newest = barsSplit.tape[barsSplit.tape.length - 1] ?? barsSplit.cash[barsSplit.cash.length - 1];
  /* …only inside the session (after the close the newest bar is an after-hours print). */
  const [ty, tm, td] = nyIsoDate().split('-').map(Number);
  const sessionOpen = isTradingDay(new Date(ty, tm - 1, td)) && nySessionPhase() === 'open';
  const stateStalled = sessionOpen && state.market_time === 'regular' && !!newest && Number.isFinite(tapeMs) && newest.time * 1000 + 60_000 - tapeMs > 120_000;
  /* Outside the session a "regular" state is not believed: the price is the last regular close (the last 'r' minute bar or the daily close),
     the newest extended bar kept apart (liveQuote.ts's convention). */
  const offRegular = tapeKind === 'vendor' && !sessionOpen && state.market_time === 'regular' ? regularCloseOf(ticker, Array.isArray(bars) ? bars : []) : null;
  const barOrState = stateStalled ? newest!.close : offRegular ? offRegular.last : num(state.close);
  const readAt = stateStalled ? newest!.time * 1000 + 60_000 : offRegular ? offRegular.at : Number.isFinite(tapeMs) ? tapeMs : Date.now();
  /* a newer price already in hand (the Board's ten-second refresh, refreshBoardPrices) is not stepped back by a reload */
  const held = cache.get(ticker);
  const keepHeld = sessionOpen && state.market_time === 'regular' && held?.status === 'live' && !!held.priceAt && held.priceAt > readAt && held.spot > 0;
  const last = keepHeld ? held!.spot : barOrState;
  const mt = offRegular ? offRegular.marketTime : typeof state.market_time === 'string' ? state.market_time : undefined;
  const statePrev = offRegular ? offRegular.close : num(state.prev_close);
  const offPhase = dayChangeOf({ close: last, prev_close: statePrev, market_time: mt }, null).phase;
  const regClose = statePrev;
  const spot = (offPhase === 'post' || offPhase === 'pre') && regClose > 0 ? regClose : last;
  /* the close before that session: the daily rows', else the state's own prev_close when its print is of that session */
  const prevOff = offRegular ? offRegular.prevClose || (Number.isFinite(tapeMs) && nyIsoDate(tapeMs) === nyIsoDate(offRegular.at - 60_000) ? num(state.prev_close) : 0) : 0;
  /* unknown stays 0: the day's change then reads "—", never a made-up 0.00% */
  const prev = offRegular ? prevOff : num(state.prev_close);
  if (!(spot > 0)) throw new Error('spot');
  const ivList = Array.isArray(ivRows) ? ivRows : [];
  const ivRow = ivList.reduce<UwIv | undefined>((best, row) => (!best || String(row.date ?? '') > String(best.date ?? '') ? row : best), undefined);
  const ivRaw = num(ivRow?.volatility);
  const iv = ivRaw > 3 ? ivRaw / 100 : ivRaw;
  const prevEntry = cache.get(ticker);
  const split = barsSplit;
  const entry: Entry = {
    ticker,
    status: 'live',
    at: Date.now(),
    /* a refresh never downgrades or blanks: a full book read again stays full */
    full: !!prevEntry?.full && (mode === 'full' || !!prevEntry?.wantFull),
    wantFull: mode === 'full' || !!prevEntry?.wantFull,
    spot,
    prev,
    changePct: prev > 0 ? ((spot - prev) / prev) * 100 : 0,
    state: { close: last, prev_close: statePrev, market_time: mt },
    last,
    priceAt: keepHeld ? held!.priceAt : readAt,
    iv: iv > 0 ? iv : 0,
    impliedMove: impliedMoveOf(Array.isArray(termRows) ? termRows : [], nyIsoDate(), spot),
    termIv: termIvOf(Array.isArray(termRows) ? termRows : []) ?? prevEntry?.termIv,
    termMove: termMoveOf(Array.isArray(termRows) ? termRows : [], spot) ?? prevEntry?.termMove,
    termK: termKOf(Array.isArray(termRows) ? termRows : [], spot) ?? prevEntry?.termK,
    termDte: termDteOf(Array.isArray(termRows) ? termRows : []) ?? prevEntry?.termDte,
    dayMoveFrac: dayFracOf(Array.isArray(interpRows) ? interpRows : []),
    dayIv: dayIvOf(Array.isArray(interpRows) ? interpRows : []) ?? prevEntry?.dayIv,
    all: (() => {
      const base = chainFrom(strikes, spot, oiMap(Array.isArray(oiRows) ? oiRows : []), flowMap(Array.isArray(flowRows) ? flowRows : []));
      return live && live.size ? withLiveGamma(base, live) : base;
    })(),
    gammaLive: !!(live && live.size),
    byDate: prevEntry?.byDate ?? {},
    expiries: prevEntry?.expiries ?? [],
    expiriesAt: prevEntry?.expiriesAt,
    totals: prevEntry?.totals,
    totalsAt: prevEntry?.totalsAt,
    frontFacts: prevEntry?.frontFacts,
    factsDates: prevEntry?.factsDates,
    everFull: prevEntry?.everFull,
    flow: flowMap(Array.isArray(flowRows) ? flowRows : []),
    candles: split.cash,
    tape: split.tape,
    history: [],
  };
  entry.history = prevEntry?.history?.length ? prevEntry.history : [];
  if (tapeKind !== 'vendor') noteBarCloses(ticker, closesFromTape(bars), tapeKind === 'index');
  applyDay(entry);
  needDay(entry);
  vexOntoAll(entry);
  cache.set(ticker, entry);
  emit();
  /* The per-minute book is for the replay. Building it is one object per strike
     per bar — do it after the page has the live book, not in front of the paint. */
  const histTicker = ticker;
  const histChain = entry.all;
  const histAll = entry.tape.length >= 2 ? entry.tape : entry.candles;
  /* a name read for the Board alone keeps its replay book at five minutes (one object per strike per bar) — the bars
     are one-minute for the counts, the book it never draws need not be */
  const histCandles = entry.wantFull ? histAll : histAll.filter((c, i) => i === histAll.length - 1 || Math.floor(c.time / 60) % 5 === 0);
  const buildHist = () => {
    if (gen.get(histTicker) !== token) return;
    const cur = cache.get(histTicker);
    if (!cur) return;
    cur.history = historyFrom(histChain, histCandles, histTicker);
    emit();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(buildHist, { timeout: 700 });
  else window.setTimeout(buildHist, 32);
  void attachSpxCloses(ticker, token);
  if (entry.wantFull) {
    void loadFront(entry, token);
    await loadExpiries(entry, token);
  } else await loadFront(entry, token);
}

/** The vendor's expiry listing, nearest first */
function listingOf(rows: unknown): { date: string; dte: number }[] {
  if (!Array.isArray(rows)) return [];
  return (rows as UwGreekStrike[])
    .map(r => ({ date: String(r.expiry || ''), dte: num(r.dte) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Gamma per expiry, gross (calls and puts both counted) — what each date's hedging weighs */
function keepTotals(entry: Entry, rows: unknown): void {
  if (!Array.isArray(rows)) return;
  const totals = (rows as UwGreekStrike[])
    .map(r => ({ date: String(r.expiry || ''), gross: Math.abs(num(r.call_gex)) + Math.abs(num(r.put_gex)) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (!totals.length) return;
  entry.totals = totals;
  entry.totalsAt = Date.now();
  const cur = cache.get(entry.ticker);
  if (cur && cur !== entry) {
    cur.totals = totals;
    cur.totalsAt = entry.totalsAt;
  }
}

const FRONT_MS = 180_000;

/* A Board name's front date: the listing with each date's gamma and the first live date's own strikes (two calls, kept
   three minutes), so its "Today" levels are today's, not the whole book's. */
async function loadFront(entry: Entry, token: number): Promise<void> {
  const still = () => gen.get(entry.ticker) === token;
  const today = isoDate(bookToday());
  const allScope = levelsForName(entry.ticker) === 'ALL';
  const haveFront = Object.keys(entry.byDate).some(d => d >= today && entry.byDate[d]?.length);
  const fresh = !!entry.totalsAt && Date.now() - entry.totalsAt < FRONT_MS;
  if (fresh && haveFront && !!entry.frontFacts && (!allScope || datesComplete(entry))) {
    if (allScope) await refreshDatesGamma(entry, token);
    return;
  }
  /* the calls that fill a Board row's "Today" levels jump the key's queue */
  let listed: { date: string; dte: number }[] = [];
  const hot = isHot(entry.ticker);
  const got = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/expiry`, hot);
  if (got.error) return;
  listed = listingOf(got.data);
  keepTotals(entry, got.data);
  if (!still() || !listed.length) return;
  /* the first live listing when nothing is within four days */
  const front = closestDate(isoDate(expiryFor(0, bookToday()).date), listed.map(r => r.date)) ?? listed.map(r => r.date).filter(d => d >= today).sort()[0];
  if (!front) return;
  let chain: StrikeNode[] = entry.byDate[front] ?? [];
  if (!chain.length || !fresh) {
    /* the front date's live gamma (one call); a chain the full book already holds keeps its other greeks */
    const live = await liveGamma(entry.ticker, front, hot).catch(() => null);
    if (live) chain = withLiveGamma(chain, live, front);
    else {
      const rows = await uwCall(`/stock/${encodeURIComponent(entry.ticker)}/greek-exposure/strike-expiry?expiry=${encodeURIComponent(front)}`, hot);
      chain = !rows.error && Array.isArray(rows.data) ? chainFrom(rows.data as UwGreekStrike[], entry.spot, new Map(), undefined, front) : chain;
    }
  }
  if (!still()) return;
  let current = cache.get(entry.ticker);
  if (!current || current.full) return;
  if (chain.length) current.byDate = { ...current.byDate, [front]: chain };
  if (!current.expiries.length) current.expiries = listed;
  cache.set(entry.ticker, current);
  emit();
  /* the front date's contracts: open interest, each contract's own vol and gamma — the flip re-prices with them and
     Building values the open-interest change with them (one call a name) */
  if (chain.length) {
    const rows = await whalesOptionContractsPaged(entry.ticker, front, hot).catch(() => null);
    if (!still()) return;
    current = cache.get(entry.ticker);
    if (!current || current.full) return;
    if (rows) {
      /* in only once read — a failed read is asked again on the next pass, never taken as "no contracts" */
      current.factsDates = new Set([...(current.factsDates ?? []), front]);
      const have = current.byDate[front] ?? chain;
      const book = foldContracts(rows, front, pricedClockOf(have).at);
      if (book.size && have.length) current.byDate = { ...current.byDate, [front]: paintLegs(have, book, true, current.spot, front, current.ticker) };
      current.frontFacts = true;
      current.at = Date.now();
      cache.set(entry.ticker, current);
      emit();
    }
  }
  /* After the close, today's own contracts (names with a same-day expiry) are the book the session ran on; the vendor still serves this morning's rows. */
  /* …and before today's open, the last session's own contracts (the session on record): "How the levels held" and "Flip
     crossed" grade that session against its own book */
  const ny = recordIso();
  if (today > ny && listed.some(r => r.date === ny)) {
    const cur = cache.get(entry.ticker);
    if (cur && !cur.byDate[ny]?.length && !emptyDates.get(entry.ticker)?.has(ny)) {
      /* this morning's rows for the session's report, and their live rows to come off the whole book (dateChain) */
      const chain = await dateChain(entry.ticker, ny, cur.spot, false).catch(() => null);
      recordAsked.add(`${entry.ticker}|${ny}`);
      if (!still()) return;
      const after = cache.get(entry.ticker);
      if (after && chain) {
        if (chain.length) after.byDate = { ...after.byDate, [ny]: chain };
        else emptyDates.set(entry.ticker, new Set([...(emptyDates.get(entry.ticker) ?? []), ny]));
        emit();
      }
    }
    /* …and that session's own contracts: its flip is final only once they are read */
    const had = cache.get(entry.ticker);
    if (had && had.byDate[ny]?.length && !had.factsDates?.has(ny)) {
      const rows = await whalesOptionContractsPaged(entry.ticker, ny, hot).catch(() => null);
      if (!still()) return;
      const after = cache.get(entry.ticker);
      if (after && rows) {
        const have = after.byDate[ny];
        const book = foldContracts(rows, ny, pricedClockOf(have ?? []).at);
        if (book.size && have?.length) after.byDate = { ...after.byDate, [ny]: paintLegs(have, book, true, after.spot, ny, after.ticker) };
        after.factsDates = new Set([...(after.factsDates ?? []), ny]);
        after.at = Date.now();
        emit();
      }
    }
  }
  /* "All expiries" on the Board: every live date's strikes, so the flip can re-price each date at its own clock */
  if (levelsForName(entry.ticker) === 'ALL') await loadBoardDates(entry.ticker, token, listed);
}

const datesWait = new Set<string>();
/* One Board name's dates at a time, the name on screen first, so rows land one after another; chains already read are
   kept and never asked again. */
const datesQueue: { ticker: string; run: () => Promise<void>; done: () => void }[] = [];
let datesRunning = 0;
/* five names at a time (each name's walk is one page after another), the name on screen first */
const DATES_AT_ONCE = 5;
function pumpDates(): void {
  while (datesRunning < DATES_AT_ONCE && datesQueue.length) {
    const i = Math.max(0, datesQueue.findIndex(q => isHot(q.ticker)));
    const job = datesQueue.splice(i, 1)[0];
    datesRunning++;
    void job.run().finally(() => {
      datesRunning--;
      job.done();
      pumpDates();
    });
  }
}
function loadBoardDates(ticker: string, token: number, listed?: { date: string; dte: number }[]): Promise<void> {
  if (datesQueue.some(q => q.ticker === ticker)) return Promise.resolve();
  return new Promise(resolve => {
    datesQueue.push({ ticker, run: () => loadBoardDatesNow(ticker, gen.get(ticker) ?? token, listed), done: resolve });
    pumpDates();
  });
}
async function loadBoardDatesNow(ticker: string, token: number, listed?: { date: string; dte: number }[]): Promise<void> {
  const still = () => gen.get(ticker) === token;
  const e = cache.get(ticker);
  if (!e || datesWait.has(ticker)) return;
  const today = isoDate(bookToday());
  void today;
  const want = (listed ?? e.expiries).slice(0, 40).map(x => x.date).filter(d => !e.byDate[d]?.length && !emptyDates.get(ticker)?.has(d));
  if (!want.length) {
    if (horizonFactsMissing(e).length && !e.full) {
      datesWait.add(ticker);
      try {
        await fillExpiryFacts(e, token, horizonFactsMissing(e));
      } finally {
        datesWait.delete(ticker);
      }
    }
    return;
  }
  datesWait.add(ticker);
  try {
    /* the live dates in one walk of every expiry's rows (liveGammaAll); a date the walk does not carry, a settled one,
       or a walk that failed is asked on its own as before */
    const floorDay = isoDate(bookToday());
    const liveWant = want.filter(d => d >= floorDay);
    const walked = liveWant.length >= 3 ? await liveGammaAll(ticker, isHot(ticker)).catch(() => null) : null;
    if (!still()) return;
    const fetched = await mapLimit(want, 3, async date => {
      const got = date >= floorDay ? walked?.get(date) : undefined;
      if (got) return [date, withLiveGamma([], got, date)] as const;
      try {
        return [date, await within(dateChain(ticker, date, e.spot, false, isHot(ticker)), DATE_READ_MS)] as const;
      } catch {
        return [date, null] as const;
      }
    });
    if (!still()) return;
    const current = cache.get(ticker);
    if (!current) return;
    const byDate = { ...current.byDate };
    const empty = emptyDates.get(ticker) ?? new Set<string>();
    for (const [date, chain] of fetched) {
      if (chain == null) continue;
      if (chain.length && !byDate[date]?.length) byDate[date] = chain;
      else if (!chain.length) empty.add(date);
    }
    emptyDates.set(ticker, empty);
    current.byDate = byDate;
    if (listed?.length) current.expiries = listed;
    cache.set(ticker, current);
    emit();
    /* the own-vol horizon's contracts (the flip re-prices those dates with each contract's own vol — data/flipLevel.ts),
       the ones not read yet; the front date's came with loadFront */
    const need = horizonFactsMissing(current);
    if (need.length && !current.full) await fillExpiryFacts(current, token, need);
  } finally {
    datesWait.delete(ticker);
  }
}

/** The Levels card reads "All expiries": a name read for the Board alone loads every live date's strikes (the flip
    re-prices each at its own clock). A no-op for a full book or one already complete. */
export function ensureScopeDates(ticker: string, scope: LevelsScope = readLevelsScope()): void {
  const e = cache.get(sameName(ticker));
  if (!e || e.status !== 'live' || e.full || scope !== 'ALL' || (datesComplete(e) && !horizonFactsMissing(e).length)) return;
  void loadBoardDates(e.ticker, gen.get(e.ticker) ?? 0);
}

/** True while the "All expiries" scope still waits on some live date's strikes */
export function scopeDatesPending(ticker: string, scope: LevelsScope = readLevelsScope()): boolean {
  const e = peekEntry(ticker);
  return !!e && e.status === 'live' && scope === 'ALL' && !datesComplete(e);
}

/** A page shows contract greeks (vega, the higher greeks) on these dates: read their contracts once, the dates not read yet */
const factsAsked = new Set<string>();
export function wantDateFacts(ticker: string, dates: readonly string[]): void {
  const e = cache.get(sameName(ticker));
  if (!e || e.status !== 'live') return;
  const need = dates.filter(d => e.byDate[d]?.length && !e.factsDates?.has(d) && !factsAsked.has(`${e.ticker}|${d}`));
  if (!need.length) return;
  for (const d of need) factsAsked.add(`${e.ticker}|${d}`);
  void fillExpiryFacts(e, gen.get(e.ticker) ?? 0, need).finally(() => {
    for (const d of need) factsAsked.delete(`${e.ticker}|${d}`);
  });
}

/* One full walk a name at a time, never abandoned by a refresh: it lays what it reads onto the current copy of the book;
   a failed date is asked once more at the end, and an empty answer is taken as empty. */
const expWalking = new Set<string>();
export async function loadExpiries(entry: Entry, token: number): Promise<void> {
  if (expWalking.has(entry.ticker)) return;
  expWalking.add(entry.ticker);
  try {
    await loadExpiriesNow(entry, token);
  } finally {
    expWalking.delete(entry.ticker);
  }
}
async function loadExpiriesNow(entry: Entry, token: number): Promise<void> {
  void token;
  /* the walk lays onto the book's current copy (a refresh replaces the object, never the walk) */
  const still = () => cache.get(entry.ticker)?.status === 'live';
  const liveToken = () => gen.get(entry.ticker) ?? token;
  if (entry.expiriesAt && Date.now() - entry.expiriesAt < 180_000 && Object.keys(entry.byDate).length > 0) {
    entry.full = true;
    entry.everFull = true;
    vexOntoAll(entry);
    /* an own-vol date whose contracts failed to read is asked again here, not left provisional until the next listing */
    const missing = horizonFactsMissing(entry);
    if (missing.length) void fillExpiryFacts(entry, liveToken(), missing);
    void refreshDatesGamma(entry, liveToken());
    return;
  }
  let listed: { date: string; dte: number }[] = [];
  try {
    const rows = await whalesGreekExpiry(entry.ticker);
    listed = listingOf(rows);
    keepTotals(entry, rows);
  } catch {
    listed = [];
  }
  if (!still()) return;
  /* Every listed expiry. The old cut kept eight horizons and stamped the WHOLE book's
     open interest onto each of them, so a November column wore October's contracts. */
  const dates = listed.map(r => r.date).slice(0, 40);
  const near = dates.slice(0, 6);
  /* null: the read failed (asked again); []: the vendor has no strikes on that date */
  /* the near dates with their greek rows; a far date's gamma, delta, vanna and charm are the walk's rows (no call of its own) */
  const pull = (list: string[], first = list === near, greeks = true) =>
    mapLimit(list, 3, async date => {
      try {
        return [date, await within(dateChain(entry.ticker, date, entry.spot, greeks, isHot(entry.ticker) && first), DATE_READ_MS)] as const;
      } catch {
        return [date, null] as const;
      }
    });
  const apply = (fetched: readonly (readonly [string, StrikeNode[] | null])[], done: boolean) => {
    if (!still()) return;
    const current = cache.get(entry.ticker);
    if (!current) return;
    const byDate = { ...current.byDate };
    const empty = emptyDates.get(entry.ticker) ?? new Set<string>();
    for (const [date, chain] of fetched) {
      if (chain?.length) byDate[date] = carryFacts(chain, byDate[date]);
      else if (chain && !byDate[date]?.length) empty.add(date);
    }
    emptyDates.set(entry.ticker, empty);
    current.byDate = byDate;
    current.expiries = listed;
    if (done) {
      current.full = true;
      current.everFull = true;
      current.expiriesAt = Date.now();
    }
    current.at = Date.now();
    vexOntoAll(current);
    if (done) noteSplit(current);
    cache.set(entry.ticker, current);
    emit();
  };
  /* The dates on screen first, then the rest of the listed book. */
  /* the near dates' open interest as soon as they are in, not after all ~40 dates */
  /* the far dates' live gamma in one walk (liveGammaAll); each far date then asks only its greek rows */
  /* the front date first, on its own: "Today" is final once its chain and contracts are in */
  const front = near.slice(0, 1);
  const frontGot = await pull(front, true);
  if (!still()) return;
  apply(frontGot, false);
  const atFront = cache.get(entry.ticker);
  /* the front date's contracts before the rest: "Today" is final with them */
  const frontFacts = atFront ? fillExpiryFacts(atFront, liveToken(), front) : null;
  const walk = dates.length > 6 ? liveGammaAll(entry.ticker, isHot(entry.ticker)).catch(() => null) : null;
  const nearGot = await pull(near.slice(1), true);
  if (!still()) return;
  const retryNear = dates.length <= 6 ? nearGot.filter(([, c]) => c == null).map(([d]) => d) : [];
  apply(nearGot, dates.length <= 6 && !retryNear.length);
  if (retryNear.length) {
    apply(await pull(retryNear, true), true);
    if (!still()) return;
  }
  const first = cache.get(entry.ticker);
  if (first) void fillExpiryFacts(first, liveToken(), near.slice(1));
  if (dates.length > 6) {
    await walk;
    if (!still()) return;
    const farGot = await pull(dates.slice(6), false, false);
    if (!still()) return;
    /* a far date whose read failed is asked once more before the walk calls the book whole */
    const retry = [...nearGot, ...farGot].filter(([, c]) => c == null).map(([d]) => d);
    apply(farGot, !retry.length);
    if (retry.length) {
      apply(await pull(retry), true);
      if (!still()) return;
    }
    const current = cache.get(entry.ticker);
    /* a far date's contracts are read when the flip needs its own vols (ownIvDates) or a page shows its contract greeks
       (wantDateFacts) */
    const far = new Set(dates.slice(6));
    if (current) void fillExpiryFacts(current, liveToken(), horizonFactsMissing(current).filter(d => far.has(d)));
  }
  await frontFacts;
}

function load(ticker: string, mode: BookMode) {
  const token = (gen.get(ticker) ?? 0) + 1;
  gen.set(ticker, token);
  const prev = cache.get(ticker);
  if (!prev) {
    cache.set(ticker, {
      ticker,
      status: 'loading',
      at: Date.now(),
      full: false,
      wantFull: mode === 'full',
      spot: 0,
      prev: 0,
      changePct: 0,
      iv: 0,
      impliedMove: 0,
      dayMoveFrac: 0,
      all: [],
      byDate: {},
      expiries: [],
      flow: new Map(),
      candles: [],
      tape: [],
      history: [],
    });
    queueMicrotask(emit);
    /* paint this browser's kept copy while the fresh read runs (store.ts peekEntry serves it until the front date is in) */
    void readKept(ticker).then(kept => {
      const fresh = cache.get(ticker);
      if (!kept || (fresh?.status === 'live' && (fresh.frontFacts || fresh.everFull))) return;
      kept.history = historyFrom(kept.all, kept.tape.length >= 2 ? kept.tape : kept.candles, kept.ticker);
      keptBooks.set(ticker, kept);
      emit();
    });
  } else if (mode === 'full') prev.wantFull = true;
  void loadCore(ticker, mode, token).catch((err: unknown) => {
    if (gen.get(ticker) !== token) return;
    const cur = cache.get(ticker);
    if (cur?.status === 'live') return;
    const msg = err instanceof Error ? err.message : '';
    const http = /not configured/i.test(msg) ? 503 : Number(msg.match(/\b([45]\d{2})\b/)?.[1] ?? 0) || undefined;
    cache.set(ticker, {
      ticker,
      status: 'error',
      at: Date.now(),
      http,
      full: false,
      wantFull: false,
      spot: 0,
      prev: 0,
      changePct: 0,
      iv: 0,
      impliedMove: 0,
      dayMoveFrac: 0,
      all: [],
      byDate: {},
      expiries: [],
      flow: new Map(),
      candles: [],
      tape: [],
      history: [],
    });
    emit();
  });
}

/* A shut market's book is read once: from BOOK_SETTLED_MIN on a trading day to PREMARKET_MIN on the next, a book that
   landed whole is held (bookSettled); one that has not keeps being read until it has. */
const BOOK_SETTLED_MIN = 16 * 60 + 30;
export const PREMARKET_MIN = 7 * 60;
/** When a book read at `at` is next read: null in the live window (07:00 → 16:30 ET on a trading day), else the next
    trading day's 07:00 ET (epoch ms) */
function bookFixedUntil(at: number = Date.now()): number | null {
  const [y, m, d] = nyIsoDate(at).split('-').map(Number);
  const mins = nyMinutes(at);
  const trading = isTradingDay(new Date(y, m - 1, d));
  if (trading && mins >= PREMARKET_MIN && mins < BOOK_SETTLED_MIN) return null;
  const day = trading && mins < PREMARKET_MIN ? new Date(y, m - 1, d) : nextSession(new Date(y, m - 1, d + 1));
  return nyWallTime(day.getFullYear(), day.getMonth() + 1, day.getDate(), 7, 0);
}
/** The market is between the settled close and the next pre-market — the book, the prices and the counts stand still */
export const bookFixed = (now: number = Date.now()): boolean => bookFixedUntil(now) != null;
/** "the Oct 23 close" — the session a fixed book is as of */
export function fixedAsOfWords(now: number = Date.now()): string {
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  let day = new Date(y, m - 1, d);
  if (!(isTradingDay(day) && nyMinutes(now) >= CLOSE_MIN))
    for (let back = 1; back < 12; back++) {
      const p = new Date(y, m - 1, d - back);
      if (isTradingDay(p)) {
        day = p;
        break;
      }
    }
  return `the ${MON3[day.getMonth()]} ${day.getDate()} close`;
}
/** Every piece of a name's book has landed — the only book a closed market holds */
function bookSettled(e: Entry): boolean {
  if (e.status !== 'live' || !e.gammaLive || !e.termIv || !e.all.length) return false;
  if (e.wantFull ? !e.everFull : !e.frontFacts) return false;
  if ((e.wantFull || levelsForName(e.ticker) === 'ALL') && horizonFactsMissing(e).length) return false;
  return true;
}

export function ensureBook(ticker: string, mode: BookMode = 'board', force = false): void {
  if (typeof window === 'undefined') return;
  const t = sameName(ticker);
  if (!t) return;
  if (SIM_DESK) return;
  const e = cache.get(t);
  if (e?.status === 'loading') {
    if (mode === 'full') e.wantFull = true;
    return;
  }
  /* never a downgrade: a name held in full is refreshed in full whoever asks */
  if (e && (e.full || e.wantFull)) mode = 'full';
  /* a closed market's settled book is held until the next pre-market (bookFixedUntil) — an upgrade to the full book
     still loads what the board read lacks */
  const heldTo = e && bookSettled(e) ? bookFixedUntil(e.at) : null;
  const upgrading = mode === 'full' && !!e && e.status === 'live' && !e.full && !e.wantFull;
  if (heldTo != null && Date.now() < heldTo && !upgrading) return;
  const age = e ? Date.now() - e.at : Infinity;
  const limit = e?.status === 'error' ? 15_000 : e?.full ? FULL_MS : BOARD_MS;
  const stale = !e || age > limit;
  const upgrade = mode === 'full' && !!e && e.status === 'live' && !e.full && !e.wantFull;
  if (!force && !stale && !upgrade) return;
  if (upgrade && e) {
    e.wantFull = true;
    const token = (gen.get(t) ?? 0) + 1;
    gen.set(t, token);
    void loadExpiries(e, token);
    return;
  }
  load(t, mode);
}
