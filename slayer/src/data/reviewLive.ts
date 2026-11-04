/// <reference types="node" />
/*
  The review scanner. It runs all day and all night, on every name in the 458, and only while that name's own option
  book is open (regular, pre-market, curb, or the index overnight). A turn is a minute whose bid stopped falling
  and whose next minute rose. That bid is the print. The run is the highest bid after it, until the bid comes back
  to that print or the session ends. Under 60% is not stored. A later turn, after the bid came back, is another run.
  Nothing here is a model call, and a missing greek stays missing.
*/

import fs from 'node:fs';
import path from 'node:path';
import { chainRoot } from '../../shared/optionChain.mjs';
import { productOf, sessionAt, type WindowKind } from '../core/session';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { weekdayDte } from './compassParams';
import { compassHost } from './compassHost';
import { reviewFile } from './compassReview';

export const REVIEW_LIVE = 4;

export type ReviewSleeve = '0' | '1-7' | '8-30';
export type ReviewBand = 0 | 1 | 2 | 3;
export type RunEnd = 'open' | 'back' | 'session';

/** One pullback from a peak inside the run. `through` means the bid came back to the turn or under it. */
export interface ReviewDraw {
  peak: number;
  low: number;
  pct: number;
  at: number;
  through: boolean;
}

export interface ReviewHit {
  id: string;
  root: string;
  contract: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  sleeve: ReviewSleeve;
  dte: number;
  band: ReviewBand;
  /** Peak ran past 5,000%. Still band 3. */
  over: boolean;
  /** The option session this move belongs to */
  session: WindowKind;
  sessionDay: string;
  /** The turn. The minute the bid stopped falling, before the next minute rose. */
  baseAsk: number;
  baseAt: number;
  /** This run's own turn. */
  baseFrom: 'turn';
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  pct: number;
  peakBid: number;
  peakPct: number;
  peakAt: number;
  crossedAt: number;
  /** Pullbacks from a peak during the run. The one that comes back to the turn ends it. */
  draws: ReviewDraw[];
  /** The deepest pullback, as a percent of the peak it fell from. */
  maxDraw: number;
  /** A pullback came back to the turn. */
  through: boolean;
  end: RunEnd;
  endAt: number | null;
  endBid: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  volume: number | null;
  oi: number | null;
  under: number | null;
  updatedAt: number;
}

export interface LiveReview {
  version: typeof REVIEW_LIVE;
  day: string;
  updatedAt: number;
  line: string;
  /** Names whose option book was open on the last pass */
  open: number;
  /** Names in the universe, after the weekly root is folded in */
  names: number;
  passAt: number;
  rows: ReviewHit[];
}

/** 60–99 is its own band. 100–300, 301–800, 801 and up. Past 5,000 stays in the top band. Under 60 is not a run. */
export function bandOf(pct: number): ReviewBand | null {
  if (!(pct >= 60)) return null;
  if (pct >= 801) return 3;
  if (pct >= 301) return 2;
  if (pct >= 100) return 1;
  return 0;
}

/** Weekday sessions from the session day to the expiry. Same day is 0. Past 30 is not this scan. */
export function sleeveOf(dte: number): ReviewSleeve | null {
  if (dte === 0) return '0';
  if (dte >= 1 && dte <= 7) return '1-7';
  if (dte >= 8 && dte <= 30) return '8-30';
  return null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const px = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const iso = (v: unknown): string | null => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
const rightOf = (v: unknown): 'C' | 'P' | null => {
  const s = String(v ?? '').toUpperCase();
  return s.startsWith('C') ? 'C' : s.startsWith('P') ? 'P' : null;
};
const clock = (ms: number) => {
  const p = nyParts(ms);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
};

export function emptyReview(day: string, line: string): LiveReview {
  return { version: REVIEW_LIVE, day, updatedAt: Date.now(), line, open: 0, names: 0, passAt: 0, rows: [] };
}

interface MinuteBid {
  minute: number;
  bid: number;
  at: number;
  session: WindowKind;
  sessionDay: string;
  sessionTo: number;
}

interface OpenRun {
  turn: number;
  turnAt: number;
  peak: number;
  peakAt: number;
  /** The peak the current pullback fell from. */
  ddPeak: number;
  ddLow: number;
  ddAt: number;
  draws: ReviewDraw[];
  session: WindowKind;
  sessionDay: string;
  sessionTo: number;
}

interface Seen {
  /** The minute before the last one that closed. */
  prev: MinuteBid | null;
  /** The last minute that closed. */
  last: MinuteBid | null;
  /** The minute still taking bids. */
  forming: MinuteBid | null;
  run: OpenRun | null;
  quote: Quote | null;
}

const runPct = (turn: number, peak: number) => ((peak - turn) / turn) * 100;

function liveDraws(run: OpenRun): ReviewDraw[] {
  const out = run.draws.map(d => ({ ...d }));
  if (run.ddLow < run.ddPeak) {
    const pct = ((run.ddPeak - run.ddLow) / run.ddPeak) * 100;
    out.push({ peak: run.ddPeak, low: run.ddLow, pct: Number(pct.toFixed(1)), at: run.ddAt, through: run.ddLow <= run.turn });
  }
  return out;
}

function closeDraw(run: OpenRun): void {
  if (!(run.ddLow < run.ddPeak)) return;
  const pct = ((run.ddPeak - run.ddLow) / run.ddPeak) * 100;
  run.draws.push({
    peak: run.ddPeak,
    low: run.ddLow,
    pct: Number(pct.toFixed(1)),
    at: run.ddAt,
    through: run.ddLow <= run.turn,
  });
  run.ddLow = run.ddPeak;
}

function publish(rows: Map<string, ReviewHit>, index: Map<string, ReviewHit[]>, key: string, run: OpenRun, q: QuoteIn, quote: Quote | null, end: RunEnd, endBid: number | null, endAt: number | null): boolean {
  const pct = runPct(run.turn, run.peak);
  const band = bandOf(pct);
  const id = `${key}|${run.turnAt}`;
  if (band == null) {
    if (rows.delete(id)) {
      const list = index.get(key);
      if (list) index.set(key, list.filter(h => h.id !== id));
    }
    return false;
  }
  const draws = liveDraws(run);
  const maxDraw = draws.reduce((m, d) => Math.max(m, d.pct), 0);
  const through = draws.some(d => d.through);
  const prev = rows.get(id);
  if (prev) {
    prev.band = band;
    prev.over = pct > 5000;
    prev.pct = Number(pct.toFixed(1));
    prev.peakBid = run.peak;
    prev.peakPct = Number(pct.toFixed(1));
    prev.peakAt = run.peakAt;
    prev.draws = draws;
    prev.maxDraw = Number(maxDraw.toFixed(1));
    prev.through = through;
    prev.end = end;
    prev.endAt = endAt;
    prev.endBid = endBid;
    prev.updatedAt = q.at;
    paint(prev, quote);
    return false;
  }
  const dte = weekdayDte(run.sessionDay, q.expiry);
  const sleeve = sleeveOf(dte);
  if (!sleeve) return false;
  const hit: ReviewHit = {
    id,
    root: q.root,
    contract: `${q.root} ${Number.isInteger(q.strike) ? q.strike.toFixed(0) : q.strike}${q.right}`,
    expiry: q.expiry,
    strike: q.strike,
    right: q.right,
    sleeve,
    dte,
    band,
    over: pct > 5000,
    session: run.session,
    sessionDay: run.sessionDay,
    baseAsk: run.turn,
    baseAt: run.turnAt,
    baseFrom: 'turn',
    bid: null,
    ask: null,
    bidSize: null,
    askSize: null,
    pct: Number(pct.toFixed(1)),
    peakBid: run.peak,
    peakPct: Number(pct.toFixed(1)),
    peakAt: run.peakAt,
    crossedAt: run.turnAt,
    draws,
    maxDraw: Number(maxDraw.toFixed(1)),
    through,
    end,
    endAt,
    endBid,
    iv: null,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    volume: null,
    oi: null,
    under: null,
    updatedAt: q.at,
  };
  paint(hit, quote);
  rows.set(id, hit);
  const list = index.get(key);
  if (list) list.push(hit);
  else index.set(key, [hit]);
  return true;
}

function finish(rows: Map<string, ReviewHit>, index: Map<string, ReviewHit[]>, key: string, seen: Seen, q: QuoteIn, why: RunEnd, bid: number, at: number): boolean {
  const run = seen.run;
  if (!run) return false;
  closeDraw(run);
  seen.run = null;
  return publish(rows, index, key, run, q, seen.quote, why, bid, at);
}

function applyMinute(rows: Map<string, ReviewHit>, index: Map<string, ReviewHit[]>, key: string, seen: Seen, minute: MinuteBid, q: QuoteIn): boolean {
  const run = seen.run;
  if (!run) return false;
  if (minute.bid <= run.turn) {
    if (minute.bid < run.ddLow) {
      run.ddLow = minute.bid;
      run.ddAt = minute.at;
    }
    return finish(rows, index, key, seen, q, 'back', minute.bid, minute.at);
  }
  if (minute.bid > run.peak) {
    closeDraw(run);
    run.peak = minute.bid;
    run.peakAt = minute.at;
    run.ddPeak = minute.bid;
    run.ddLow = minute.bid;
    run.ddAt = minute.at;
  } else if (minute.bid < run.ddLow) {
    run.ddLow = minute.bid;
    run.ddAt = minute.at;
  }
  return publish(rows, index, key, run, q, seen.quote, 'open', null, null);
}

/**
 * One bid, in time order. The minute's bid is its last bid. A turn is a closed minute whose bid is at or under
 * the minute before it, and whose next minute rose. The run keeps the high until a later minute's bid is back at
 * that print, or the session changes. Returns true when this bid opens a new row.
 */
export function noteBid(seenMap: Map<string, Seen>, rows: Map<string, ReviewHit>, index: Map<string, ReviewHit[]>, q: QuoteIn, bid: number, sessionTo: number): boolean {
  const sleeve = sleeveOf(weekdayDte(q.sessionDay, q.expiry));
  if (!sleeve || !(q.at > 0) || !(bid > 0)) return false;
  const key = contractId(q.sessionDay, q.root, q.expiry, q.strike, q.right);
  let seen = seenMap.get(key);
  if (!seen) {
    seen = { prev: null, last: null, forming: null, run: null, quote: quoteOf(q) };
    seenMap.set(key, seen);
  }
  seen.quote = quoteOf(q);
  let opened = false;
  const minute = Math.floor(q.at / 60_000);
  const stamp: MinuteBid = { minute, bid, at: q.at, session: q.session, sessionDay: q.sessionDay, sessionTo };
  if (seen.forming && minute < seen.forming.minute) return opened;
  if (!seen.forming || seen.forming.minute === minute) {
    seen.forming = stamp;
    return opened;
  }
  const closed = seen.forming;
  seen.forming = stamp;
  const a = seen.prev;
  const b = seen.last;
  if (seen.run && (closed.session !== seen.run.session || closed.sessionDay !== seen.run.sessionDay || closed.at >= seen.run.sessionTo)) {
    const last = seen.last;
    if (finish(rows, index, key, seen, q, 'session', last?.bid ?? closed.bid, last?.at ?? closed.at)) opened = true;
  } else if (seen.run) {
    if (applyMinute(rows, index, key, seen, closed, q)) opened = true;
  }
  const same = a && b && a.session === b.session && b.session === closed.session && a.sessionDay === closed.sessionDay;
  if (!seen.run && same && b.bid <= a.bid && closed.bid > b.bid) {
    seen.run = {
      turn: b.bid,
      turnAt: b.at,
      peak: closed.bid,
      peakAt: closed.at,
      ddPeak: closed.bid,
      ddLow: closed.bid,
      ddAt: closed.at,
      draws: [],
      session: b.session,
      sessionDay: b.sessionDay,
      sessionTo: b.sessionTo,
    };
    if (publish(rows, index, key, seen.run, q, seen.quote, 'open', null, null)) opened = true;
  }
  if (seen.run && (stamp.session !== seen.run.session || stamp.at >= seen.run.sessionTo)) {
    if (finish(rows, index, key, seen, q, 'session', closed.bid, closed.at)) opened = true;
  }
  seen.prev = b;
  seen.last = closed;
  return opened;
}

interface Quote {
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  volume: number | null;
  oi: number | null;
  under: number | null;
}

interface QuoteIn {
  root: string;
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  session: WindowKind;
  sessionFrom: number;
  sessionDay: string;
  at: number;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  volume: number | null;
  oi: number | null;
  under: number | null;
}

const contractId = (day: string, root: string, expiry: string, strike: number, right: 'C' | 'P') =>
  `${day}|${root}|${expiry}|${strike}|${right}`;

const quoteOf = (q: QuoteIn): Quote => ({
  bid: q.bid, ask: q.ask, bidSize: q.bidSize, askSize: q.askSize,
  iv: q.iv, delta: q.delta, gamma: q.gamma, theta: q.theta, vega: q.vega,
  volume: q.volume, oi: q.oi, under: q.under,
});

function paint(hit: ReviewHit, quote: Quote | null): void {
  if (!quote) return;
  hit.bid = quote.bid;
  hit.ask = quote.ask;
  hit.bidSize = quote.bidSize;
  hit.askSize = quote.askSize;
  hit.iv = quote.iv;
  hit.delta = quote.delta;
  hit.gamma = quote.gamma;
  hit.theta = quote.theta;
  hit.vega = quote.vega;
  if (quote.volume != null) hit.volume = quote.volume;
  if (quote.oi != null) hit.oi = quote.oi;
  if (quote.under != null) hit.under = quote.under;
}

export function noteQuote(seenMap: Map<string, Seen>, index: Map<string, ReviewHit[]>, q: QuoteIn): void {
  if (q.ask != null && q.bid != null && q.ask < q.bid) return;
  const key = contractId(q.sessionDay, q.root, q.expiry, q.strike, q.right);
  const quote = quoteOf(q);
  const seen = seenMap.get(key);
  if (seen) seen.quote = quote;
  const list = index.get(key);
  if (!list) return;
  for (const hit of list) paint(hit, quote);
}

const baseFile = (dir: string, day: string) => {
  const live = reviewFile(dir, day);
  return live.replace(/[^/]+$/, `base-${day}.json`);
};

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function loadBook(dir: string, day: string): { doc: LiveReview; bases: Map<string, Seen>; rows: Map<string, ReviewHit>; index: Map<string, ReviewHit[]>; cursor: Map<string, number> } {
  const raw = readJson(reviewFile(dir, day)) as Partial<LiveReview> | null;
  const doc = raw && raw.version === REVIEW_LIVE && Array.isArray(raw.rows) ? (raw as LiveReview) : emptyReview(day, 'The scan is starting.');
  if (raw && raw.version !== REVIEW_LIVE) {
    const parked = reviewFile(dir, day).replace(/\.json$/, '.autopsy.json');
    try {
      if (!fs.existsSync(parked)) fs.renameSync(reviewFile(dir, day), parked);
    } catch {
      /* the live file is written over a copy the study no longer reads */
    }
  }
  const sameVersion = raw?.version === REVIEW_LIVE;
  const rows = new Map(doc.rows.filter(r => r.baseFrom === 'turn' && Array.isArray(r.draws)).map(r => [r.id, r]));
  doc.rows = [...rows.values()];
  const index = new Map<string, ReviewHit[]>();
  for (const hit of rows.values()) {
    const key = contractId(hit.sessionDay, hit.root, hit.expiry, hit.strike, hit.right);
    const list = index.get(key);
    if (list) list.push(hit);
    else index.set(key, [hit]);
  }
  const bases = new Map<string, Seen>();
  const cursor = new Map<string, number>();
  const saved = readJson(baseFile(dir, day)) as { bases?: Record<string, Seen>; cursor?: Record<string, number> } | null;
  if (sameVersion && saved?.bases) {
    for (const [k, v] of Object.entries(saved.bases)) {
      if (v && !('bases' in v) && (v.forming !== undefined || v.last !== undefined || v.run !== undefined)) bases.set(k, v);
    }
  }
  if (sameVersion && saved?.cursor) {
    for (const [k, v] of Object.entries(saved.cursor)) if (typeof v === 'number' && v > 0) cursor.set(k, v);
  }
  return { doc, bases, rows, index, cursor };
}

function flatRows(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  const out: Record<string, unknown>[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const bag = item as Record<string, unknown>;
    if (bag.contract && typeof bag.contract === 'object') {
      const nested = bag.data && typeof bag.data === 'object' && !Array.isArray(bag.data) ? (bag.data as Record<string, unknown>) : {};
      out.push({ ...(bag.contract as Record<string, unknown>), ...nested });
    } else out.push(bag);
  }
  return out;
}

let generation = 0;
let stopped = true;
let running: Promise<void> | null = null;

/** Walks the universe until stopReviewScan. One chain at a time, so the model scan keeps the hub. */
export function startReviewScan(dir: string, log: (line: string) => void = () => {}): void {
  const gen = ++generation;
  stopped = false;
  running = loop(dir, log, gen).finally(() => {
    if (generation === gen) running = null;
  });
  log('[review] scanner on, every open book, all night');
}

export function stopReviewScan(): void {
  generation += 1;
  stopped = true;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (ms: number) => {
  const p = nyParts(ms);
  return `${p.year}${pad(p.month)}${pad(p.day)}`;
};
const hms = (ms: number) => {
  const p = nyParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
};
/** A slice that crosses midnight is two requests. Theta takes one date at a time. */
function slices(from: number, to: number): { date: string; start: string; end: string }[] {
  const out: { date: string; start: string; end: string }[] = [];
  let t = from;
  while (t < to && out.length < 3) {
    const p = nyParts(t);
    const midnight = nyWallTime(p.year, p.month, p.day + 1, 0, 0);
    const end = Math.min(to, midnight);
    out.push({ date: ymd(t), start: hms(t), end: hms(end - 1000) });
    t = end;
  }
  return out;
}

/* The terminal will not serve today's trade tape with expiration=*. A past day still takes the wildcard.
   The list is the root's whole history, so it is kept and only the 0–30 day sleeve is asked. */
const expCache = new Map<string, { at: number; days: string[] }>();
const EXP_HOLD_MS = 30 * 60_000;

function expiryDays(data: unknown): string[] {
  const rows = Array.isArray(data) ? data : [];
  const out: string[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const exp = String((item as { expiration?: unknown }).expiration ?? '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) out.push(exp);
  }
  return out;
}

async function liveExpiries(root: string, sessionYmd: string): Promise<string[] | null> {
  const hit = expCache.get(root);
  let days = hit && Date.now() - hit.at < EXP_HOLD_MS ? hit.days : null;
  if (!days) {
    const got = await compassHost().theta(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`, true);
    if (got.error || !Array.isArray(got.data)) return hit ? hit.days : null;
    days = expiryDays(got.data);
    expCache.set(root, { at: Date.now(), days });
  }
  return days.filter(e => {
    const n = weekdayDte(sessionYmd, e.replace(/-/g, ''));
    return n >= 0 && n <= 30;
  });
}

/** One path per expiration on the current day. One wildcard path on a day that has already closed. Null when the list could not be read. */
async function quotePaths(root: string, slice: { date: string; start: string; end: string }, known: string[] | null): Promise<string[] | null> {
  const q = (exp: string) => `/option/history/trade_quote?symbol=${encodeURIComponent(root)}&expiration=${exp}&date=${slice.date}&start_time=${slice.start}&end_time=${slice.end}&strike_range=50&exclusive=true&format=csv`;
  if (slice.date !== ymd(Date.now())) return [q('*')];
  const exps = known && known.length ? known : await liveExpiries(root, slice.date);
  if (!exps) return null;
  return exps.map(e => q(e.replace(/-/g, '')));
}

/** How many expirations one name is allowed on a single pass, so SPXW does not hold the terminal. */
const EXP_BATCH = 4;
const expAt = new Map<string, number>();

async function roots(): Promise<string[]> {
  const buf = await compassHost().asset('/config/universe_458.json');
  if (!buf) return [];
  let names: unknown;
  try {
    names = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return [];
  }
  if (!Array.isArray(names)) return [];
  const out = new Set<string>();
  for (const n of names) {
    const s = String(n ?? '').trim().toUpperCase();
    if (/^[A-Z][A-Z.]{0,7}$/.test(s)) out.add(chainRoot(s));
  }
  return [...out];
}

type Book = { doc: LiveReview; bases: Map<string, Seen>; rows: Map<string, ReviewHit>; index: Map<string, ReviewHit[]>; cursor: Map<string, number>; dirty: boolean; saved: number };

const CANCELLED = new Set([40, 41, 42, 43, 44]);

function take(data: unknown, book: (day: string) => Book, root: string, product: ReturnType<typeof productOf>, kind: 'print' | 'quote'): number {
  let added = 0;
  const prints: { r: Record<string, unknown>; at: number }[] = [];
  for (const r of flatRows(data)) {
    if (kind === 'quote') {
      prints.push({ r, at: nyWallStamp(r.timestamp) || Date.now() });
      continue;
    }
    const conds = [r.condition, r.ext_condition1, r.ext_condition2, r.ext_condition3, r.ext_condition4];
    if (conds.some(c => CANCELLED.has(Number(c)))) continue;
    const at = nyWallStamp(r.trade_timestamp || r.timestamp);
    if (!(at > 0) || px(r.price) == null) continue;
    prints.push({ r, at });
  }
  if (kind === 'print') prints.sort((a, b) => a.at - b.at);
  for (const { r, at } of prints) {
    const exp = iso(r.expiration);
    const strike = num(r.strike);
    const right = rightOf(r.right);
    if (!exp || strike == null || strike <= 0 || !right) continue;
    const sess = sessionAt(at, product);
    if (!sess.open || !sess.window) continue;
    const b = book(sess.tradingDay);
    const fields = {
      root,
      expiry: exp,
      strike,
      right,
      session: sess.window.kind,
      sessionFrom: sess.window.from,
      sessionDay: sess.tradingDay,
      at,
      bid: px(r.bid),
      ask: px(r.ask),
      bidSize: num(r.bid_size),
      askSize: num(r.ask_size),
      iv: num(r.implied_vol),
      delta: num(r.delta),
      gamma: num(r.gamma),
      theta: num(r.theta),
      vega: num(r.vega),
      volume: num(r.volume),
      oi: num(r.open_interest),
      under: px(r.underlying_price),
    };
    if (kind === 'print') {
      const bid = px(r.bid);
      if (bid == null || !sess.window) continue;
      if (noteBid(b.bases, b.rows, b.index, fields, bid, sess.window.to)) added += 1;
    } else noteQuote(b.bases, b.index, fields);
    b.dirty = true;
  }
  return added;
}

function sealRuns(b: { bases: Map<string, Seen>; rows: Map<string, ReviewHit>; index: Map<string, ReviewHit[]> }, now: number): void {
  for (const [key, seen] of b.bases) {
    const run = seen.run;
    if (!run || now < run.sessionTo) continue;
    const [, root, expiry, strike, right] = key.split('|');
    const q: QuoteIn = {
      root, expiry, strike: Number(strike), right: right === 'P' ? 'P' : 'C',
      session: run.session, sessionFrom: 0, sessionDay: run.sessionDay, at: now,
      bid: null, ask: null, bidSize: null, askSize: null,
      iv: null, delta: null, gamma: null, theta: null, vega: null,
      volume: null, oi: null, under: null,
    };
    const last = seen.last ?? seen.forming;
    finish(b.rows, b.index, key, seen, q, 'session', last?.bid ?? run.peak, last?.at ?? now);
  }
}

async function loop(dir: string, log: (line: string) => void, gen: number): Promise<void> {
  const universe = await roots();
  const books = new Map<string, Book>();
  const book = (day: string): Book => {
    let b = books.get(day);
    if (!b) {
      const loaded = loadBook(dir, day);
      b = { ...loaded, dirty: false, saved: 0 };
      books.set(day, b);
    }
    return b;
  };
  let cursor = 0;
  while (gen === generation && !stopped) {
    const now = Date.now();
    const open = universe.filter(r => sessionAt(now, productOf(r, true)).open);
    if (!open.length) {
      const idleDay = sessionAt(now).tradingDay;
      const idle = book(idleDay);
      idle.doc.line = 'No option book is open.';
      idle.doc.open = 0;
      idle.doc.names = universe.length;
      idle.doc.updatedAt = now;
      sealRuns(idle, now);
      idle.dirty = true;
      flush(dir, books);
      await sleep(30_000);
      continue;
    }
    const root = open[cursor % open.length];
    cursor += 1;
    const product = productOf(root, true);
    const sessNow = sessionAt(now, product);
    const win = sessNow.window;
    const b0 = book(sessNow.tradingDay);
    const closed = Math.floor(now / 60_000) * 60_000;
    const from = b0.cursor.get(root) ?? win?.from ?? closed;
    /* Two minutes, not fifteen. A fifteen-minute SPXW tape holds the terminal and every other read waits. */
    const to = Math.min(closed, from + 2 * 60_000);
    let error: string | null = null;
    let added = 0;
    if (win && to > from) {
      for (const slice of slices(from, to)) {
        const paths = await quotePaths(root, slice, null);
        if (!paths) {
          error = 'terminal_down';
          break;
        }
        const start = paths.length > 1 ? (expAt.get(root) ?? 0) : 0;
        const batch = paths.slice(start, start + (paths.length > 1 ? EXP_BATCH : paths.length));
        let failed = 0;
        for (const pathP of batch) {
          try {
            const got = await compassHost().theta(pathP, true);
            if (got.error === 'terminal_down' || got.error === 'terminal_busy') {
              error = got.error === 'terminal_busy' ? 'busy' : 'terminal_down';
              break;
            }
            if (got.error === 'no_data') continue;
            if (got.error) {
              failed += 1;
              continue;
            }
            if (got.data) added += take(got.data, book, root, product, 'print');
          } catch {
            error = 'terminal_down';
            break;
          }
        }
        if (error) break;
        if (batch.length > 0 && failed === batch.length) {
          error = 'unavailable';
          break;
        }
        const next = start + batch.length;
        if (next < paths.length) {
          expAt.set(root, next);
          error = 'partial';
          break;
        }
        expAt.set(root, 0);
      }
      if (error === 'terminal_down' || error === 'busy') {
        b0.doc.line = error === 'busy' ? 'The terminal is busy. The scan is waiting.' : 'The terminal is down. The scan is waiting.';
        b0.doc.updatedAt = Date.now();
        b0.doc.open = open.length;
        b0.doc.names = universe.length;
        b0.dirty = true;
        flush(dir, books);
        log(`[review] ${root} ${error}; waiting`);
        await sleep(error === 'busy' ? 2_000 : 8_000);
        continue;
      }
      if (error === 'partial') {
        /* this name still has expirations in the same window; the next pass takes them */
      } else if (!error) {
        b0.cursor.set(root, to);
        b0.dirty = true;
      } else log(`[review] ${root} ${error}`);
    }
    const pathQ = `/option/snapshot/greeks/all?symbol=${encodeURIComponent(root)}&expiration=*&max_dte=30&strike_range=50&format=csv`;
    const wantGreeks = added > 0 || [...b0.rows.values()].some(r => r.root === root);
    if (wantGreeks) {
      try {
        const got = await compassHost().theta(pathQ, true);
        if (!got.error && got.data) take(got.data, book, root, product, 'quote');
      } catch {
        /* the prints still stand; the greeks stay blank */
      }
    }
    const b = book(sessNow.tradingDay);
    sealRuns(b, now);
    b.doc.rows = [...b.rows.values()].sort((a, c) => c.peakPct - a.peakPct);
    b.doc.open = open.length;
    b.doc.names = universe.length;
    b.doc.passAt = Date.now();
    b.doc.updatedAt = b.doc.passAt;
    b.doc.line = `${root} ${clock(now)} ET · ${open.length} books open · ${b.doc.rows.length} runs off a turn`;
    b.dirty = true;
    if (added) log(`[review] ${root} ${added} new`);
    flush(dir, books);
    await sleep(open.length < 8 ? 400 : 120);
  }
  flush(dir, books, true);
}

function flush(dir: string, books: Map<string, Book>, force = false): void {
  const now = Date.now();
  for (const [, b] of books) {
    if (!b.dirty) continue;
    if (!force && b.saved && now - b.saved < 2_000) continue;
    b.doc.rows = [...b.rows.values()].sort((a, c) => c.peakPct - a.peakPct);
    try {
      writeAtomic(reviewFile(dir, b.doc.day), JSON.stringify(b.doc));
      const bases: Record<string, Seen> = {};
      const cursor: Record<string, number> = {};
      for (const [k, v] of b.bases) bases[k] = v;
      for (const [k, v] of b.cursor) cursor[k] = v;
      writeAtomic(baseFile(dir, b.doc.day), JSON.stringify({ bases, cursor }));
      b.saved = now;
      b.dirty = false;
    } catch {
      /* a read-only disk: the next pass tries again */
    }
  }
}
