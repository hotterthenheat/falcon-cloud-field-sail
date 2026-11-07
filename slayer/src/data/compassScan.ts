/*
  The Compass scan: one pass per sleeve at every mark of every session the names trade, the Book C sweep from 15:20,
  the cards' quotes between marks, and the settlement of every open call. It runs in the server process
  (data/compassServer.ts), once for every viewer; browsers render what it found (data/thetaBook.ts).

  A mark the scan could not read (the terminal down, the session lost, the previous pass still running past the
  minute) is scored afterwards from the quotes ThetaData recorded at that exact instant (option/at_time/quote), name
  by name, and marked late. A name ThetaData has no quotes for at that mark is recorded as not scored.
*/

import { compassHost, type ThetaAnswer } from './compassHost';
import { nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { setupIdOf } from './compass';
import { BOOK_NAME, GEX_CORE, WEEKLY_STRIKES, inLottery, sessionScanOpen, weekdayDte } from './compassParams';
import { deskPhase, odteAsleep, optionScanOpen, sessionDayOpen, sessionIso, sessionYmd } from './compassSession';
import { MODEL4, model4OnOdte } from './model4Event';
import { COMPASS_TICKERS } from './compassUniverse';
import {
  commitClosest,
  currentPicks,
  noteScanned,
  paintQuotes,
  resetScanReport,
  scanReport,
  scoreBook,
  scoreLottery,
  setScanBusy,
  setScanReport,
  setScoreClose,
  underAt,
  warmSession,
  type ScoreResult,
} from './compassModel';
import { recordPicks, setSessionClose, settleOpen, signals } from './compassLedger';
import { settleTwins } from './compassTwins';
import type { OptionRight, Setup, SleeveKey } from '../types/compass';
import { nyYmd as ymd, sessionCloseMinOn } from '../core/calendar';
import { REGULAR_OPEN_MIN, nextWindow } from '../core/session';
import { emptyTail, type TailPublic } from './modelRisk';
import { tailPass } from './modelRiskScan';
import { bsStates, ivStates } from './compassFeatures';

export const INDEX_OF: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };
export const OPTION_OF: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP' };
/** A snapshot quote older than this is not on the board */
/* COMPASS_FRESH_MS: a live-run override for a lagging snapshot feed (default 90 s) */
/* read through globalThis: vite's define turns a bare process.env into {} (vite.config.ts), server side too */
const serverEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const FRESH_MS = Number(serverEnv.COMPASS_FRESH_MS) || 90 * 1000;

/* ---- the names ---- */

/** Monday–Friday. The chain wins: an empty expiration is not a ticket. */
const DAILY_0DTE = ['SPXW', 'NDXP', 'XSP', 'RUTW', 'VIX', 'SPY', 'QQQ', 'IWM', 'GLD', 'XLF', 'SMH'];
/** Monday, Wednesday, Friday stocks. GOOG is not in this set. */
const MWF_STOCK = ['AAPL', 'AMD', 'AMZN', 'AVGO', 'GOOGL', 'INTC', 'META', 'MSFT', 'MU', 'NVDA', 'TSLA'];
/** Monday, Wednesday, Friday ETFs. EEM and SOXL skip some of those days. */
const MWF_ETF = ['SLV', 'TLT', 'XLE', 'EEM', 'TQQQ', 'SOXL'];
/** Wednesday and Friday. */
const WF_0DTE = ['USO', 'UNG'];

export const ALL = [...new Set(COMPASS_TICKERS.map(t => OPTION_OF[t] ?? t))];
export const ALL_SET = new Set(ALL);
/** The weekly scan's names: the roots with the full feature row (open interest, net gamma and the walls). */
export const WEEKLY_FOCUS = GEX_CORE.filter(t => ALL_SET.has(t));

/** The roots that list a same-day contract on this session. */
export function odteBook(now: number): string[] {
  const session = sessionYmd(now);
  const day = nyParts(nyWallTime(Number(session.slice(0, 4)), Number(session.slice(4, 6)), Number(session.slice(6, 8)), 12, 0)).weekday;
  const names = [...DAILY_0DTE];
  if (day === 1 || day === 3 || day === 5) names.push(...MWF_STOCK, ...MWF_ETF);
  if (day === 3 || day === 5) names.push(...WF_0DTE);
  return names;
}

function odteNames(now: number): string[] {
  if (odteAsleep(now)) return [];
  return odteBook(now).filter(t => optionScanOpen(t, 0, now));
}

/** Model 4 is the same-day event definition. It is not a score, and the scan does not call it. No other sleeve has it. */
export function odteEventModel(sleeve: SleeveKey): typeof MODEL4 | null {
  return model4OnOdte(sleeve);
}

/* COMPASS_WEEKLY_ALL=1: the weekly scan reads every root of the 458-name book, not only the 20 with the full feature
   row. The others score with their open-interest columns missing (the trees read those as missing, not as 0). */
const WEEKLY_ALL = serverEnv.COMPASS_WEEKLY_ALL === '1';
/* COMPASS_MODEL_RISK=1 runs the Model Risk book (the tail-risk fade); off by default. */
const MODEL_RISK_ON = serverEnv.COMPASS_MODEL_RISK === '1';

function weeklyNames(now: number): string[] {
  return (WEEKLY_ALL ? ALL : WEEKLY_FOCUS).filter(t => optionScanOpen(t, 1, now));
}

/* ---- reading the terminal ---- */

export type ThetaState = 'unknown' | 'up' | 'down';

export interface ScanMeta {
  theta: ThetaState;
  /** Since when the terminal has been down, epoch ms (0 while it answers) */
  downSince: number;
  /** A pass is running */
  busy: boolean;
  spots: Record<string, number>;
  sparks: Record<string, number[]>;
  line: string;
  /** Model Risk, the tail-risk fade. All day. No session window. */
  tail: TailPublic;
  /** Whether the live chain's quotes were current at the last mark (FeedHealth) */
  feed: FeedHealth;
}

/** The live chain's freshness at the last mark. The snapshot can answer with rows whose own stamps lag real time by
    minutes (2026-11-06 09:35–10:15 ET and 2026-11-05 11:45–12:10 ET: every name answered, no quote was inside 90 s,
    every mark scored nothing and said "quiet"). Such a name is read again from a source that is current (the quote
    snapshot, else the quotes recorded at this instant, each row with its own stamp, checked the same way); one that
    has no current source is not scored, and says so. */
export interface FeedHealth {
  /** 'fresh': every name's snapshot was current. 'stale': some names' snapshots lagged past FRESH_MS. */
  state: 'fresh' | 'stale';
  /** Since when the snapshots have been stale, epoch ms (0 while fresh) */
  since: number;
  /** How far the stalest snapshot lagged at the last mark, ms */
  lagMs: number;
  /** The names whose snapshot was stale at the last mark */
  names: string[];
  /** Of those, the names scored from a current source instead */
  fallback: string[];
  /** Of those, the names no current source answered for: not scored */
  blind: string[];
  /** The mark this describes, epoch ms */
  at: number;
}

export const freshFeed = (): FeedHealth => ({ state: 'fresh', since: 0, lagMs: 0, names: [], fallback: [], blind: [], at: 0 });

let meta: ScanMeta = { theta: 'unknown', downSince: 0, busy: false, spots: {}, sparks: {}, line: 'Reading the live book.', tail: emptyTail(), feed: freshFeed() };
const metaFns = new Set<() => void>();

export function scanMeta(): ScanMeta {
  return meta;
}

export function setScanMeta(next: Partial<ScanMeta>): void {
  meta = { ...meta, ...next };
  for (const fn of metaFns) fn();
}

export function onScanMeta(fn: () => void): () => void {
  metaFns.add(fn);
  return () => metaFns.delete(fn);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** One ThetaData answer, with the terminal's state noted. A 429 (eight requests already working) waits and asks
    again, up to three times. */
async function theta(path: string, jump = false): Promise<ThetaAnswer> {
  let got = await compassHost().theta(path, jump);
  for (let i = 0; i < 3 && got.status === 429; i++) {
    await sleep(400 * 2 ** i);
    got = await compassHost().theta(path, jump);
  }
  const down = got.error === 'terminal_down';
  if (down && meta.theta !== 'down') setScanMeta({ theta: 'down', downSince: Date.now() });
  else if (!got.error && meta.theta !== 'up') setScanMeta({ theta: 'up', downSince: 0 });
  return got;
}

/** ThetaData's refusal of a day that has not happened yet (a 400: "Date range contains future date; end must be
    before or equal to today"): asked again once the day has come, it answers. */
export function futureDateRefusal(got: Pick<ThetaAnswer, 'status' | 'error'> & { data?: unknown }): boolean {
  if (got.status < 400 || got.status >= 500) return false;
  const text = `${got.error ?? ''} ${typeof got.data === 'string' ? got.data : ''}`;
  return /future date/i.test(text);
}

/** The terminal answered for this name: rows, or its "no data" (472), or a refusal that asking again will not change
    (a 4xx). A busy terminal (429 after the retries), an empty 200, a 5xx or a lost terminal is not an answer: the name
    stays pending and the late pass asks again (they used to read as "no quotes" and mark the name not scored). Nor is
    a 400 for a future date: asking again on that day changes it (the late Book C sweep asked at 20:00 for the next
    day's 15:20, read the refusal as an answer, marked every name not scored and the sweep done). */
export function terminalAnswered(got: Pick<ThetaAnswer, 'status' | 'error'> & { data?: unknown }): boolean {
  if (!got.error || got.error === 'no_data') return true;
  if (got.error === 'terminal_down' || got.error === 'busy' || got.error === 'empty') return false;
  if (futureDateRefusal(got)) return false;
  return got.status >= 400 && got.status < 500 && got.status !== 408 && got.status !== 429;
}

function finite(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
}

function num(v: unknown): number {
  const n = finite(v);
  return Number.isFinite(n) ? n : 0;
}

/** Theta publishes the annual Black-Scholes theta. The model splits, and the desk, are dollars per calendar day. */
export function perDay(theta: number): number {
  return Number.isFinite(theta) ? theta / 365 : NaN;
}

/** Theta says vega and rho are raw partials. Divide by 100 to get the per-point number. */
export function perPoint(v: number): number {
  return Number.isFinite(v) ? v / 100 : NaN;
}

export function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  return [];
}

/** A v3 row: either flat (contract fields and quote fields on one object) or `{ contract, data: [quote] }`. */
export function rowOf(item: Record<string, unknown>): { contract: Record<string, unknown>; quote: Record<string, unknown> } | null {
  const contract = item.contract && typeof item.contract === 'object' ? (item.contract as Record<string, unknown>) : item;
  const quote = Array.isArray(item.data) ? (item.data[0] as Record<string, unknown>) : item;
  if (!quote || typeof quote !== 'object') return null;
  return { contract, quote };
}

function contractWord(symbol: string, strike: number, right: OptionRight): string {
  const k = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2);
  return `${symbol} ${k}${right}`;
}

/** Sessions left to a contract's expiry: whole days ahead, or on its expiry day the share of a session left to the
    close. The close is the day's own (core/calendar sessionCloseMinOn: 13:00 on an early close — it was 16:00 always,
    which overstated a 0DTE contract's time on a half day). On a full day every term is what it was — 16:00 less the
    minute over the 6.5-hour session, and 1 before the open ((960 − 570) / 390) — so a regular day's calls are
    bit-identical (scripts/session-proof.ts checks every minute; compass-golden and lgbm-parity unchanged). */
export function sessionsAhead(expiration: string, now: number): number {
  const dte = Math.max(0, Math.round((Date.parse(`${expiration}T21:00:00Z`) - now) / 86400000));
  if (dte > 0) return dte;
  const p = nyParts(now);
  const mins = p.hour * 60 + p.minute;
  const close = sessionCloseMinOn(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`);
  if (mins < REGULAR_OPEN_MIN) return (close - REGULAR_OPEN_MIN) / (6.5 * 60);
  return Math.max(close - mins, 5) / (6.5 * 60);
}

interface LiveGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  rho: number;
  lambda: number;
  epsilon: number;
}

const NO_GREEKS: LiveGreeks = { delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, rho: NaN, lambda: NaN, epsilon: NaN };

function toSetup(
  symbol: string, strike: number, right: OptionRight, expiration: string,
  bid: number, ask: number, spot: number, sleeve: SleeveKey, quotedAt: number,
  greeks: LiveGreeks, listed: number,
): Setup {
  const mid = (bid + ask) / 2;
  const id = setupIdOf({ ticker: symbol, strike, right, scanner: 'top-setups', sleeve });
  const session = sessionYmd(quotedAt || listed);
  const wd = weekdayDte(session, expiration);
  const dte = Number.isFinite(wd) ? wd : Math.max(0, Math.round((Date.parse(`${expiration}T16:00:00`) - listed) / 86400000));
  const spread = mid > 0 ? (ask - bid) / mid : 1;
  const sessions = sessionsAhead(expiration, quotedAt || listed);
  const sigma = greeks.iv > 0 ? (greeks.iv / 100) * Math.sqrt(sessions / 252) * 100 : 0;
  return {
    id,
    ticker: symbol,
    contract: contractWord(symbol, strike, right),
    right,
    strike,
    expiry: dte === 0 ? '0DTE' : `${dte}DTE`,
    expiryDate: expiration,
    sessionsLeft: sessions,
    sigmaMovePct: Number(sigma.toFixed(2)),
    sleeve,
    score: 0,
    verdict: 'WATCH',
    topRated: false,
    topOpportunity: false,
    expectedMovePct: 0,
    swingTarget: { price: 0, pct: 0 },
    scalpExit: { price: 0, pct: 0 },
    headline: `${contractWord(symbol, strike, right)} · bid ${bid.toFixed(2)} ask ${ask.toFixed(2)}`,
    whyChips: [],
    whyText: 'National bid and ask. Not a call until a book sends it.',
    greeks: { delta: greeks.delta, gamma: greeks.gamma, theta: greeks.theta, vega: greeks.vega, iv: greeks.iv, rho: greeks.rho },
    bid,
    ask,
    mid,
    liveMid: mid,
    highWater: mid,
    confidence: 0,
    health: 0,
    momentum: 'NEUTRAL',
    takeProfits: [],
    priceTargets: [],
    liquidityLabel: spread <= 0.02 ? 'Tight' : spread <= 0.08 ? 'Normal' : 'Wide',
    liquiditySpread: `${(spread * 100).toFixed(1)}% spread`,
    invalidationPrice: 0,
    invalidationReason: '',
    spot,
    seenAt: listed,
    quotedAt,
    lambda: greeks.lambda,
    epsilon: greeks.epsilon,
  };
}

interface Draft {
  root: string;
  strike: number;
  right: OptionRight;
  exp: string;
  bid: number;
  ask: number;
  under: number;
  at: number;
  greeks: LiveGreeks;
  bidSize?: number;
  askSize?: number;
}

/** Book A reaches the span (4 strikes on an index root, up to 12 on a single name). Book B is the band past it,
    max(8, span + 1) to that + 4 strikes out (WEEKLY_STRIKES, 17, at the widest). A long chain keeps that many strikes
    either side of the money, by distance only: a wing and Model 3's ticket are chosen by their shape and their cost,
    not their price (it used to keep 12 strikes and every contract asking $1.65 or less). */
function kept(list: Draft[]): Draft[] {
  if (list.length <= 80) return list;
  const strikes = [...new Set(list.map(d => d.strike))].sort((a, b) => a - b);
  const spot = list.find(d => d.under > 0)?.under ?? 0;
  let atm = 0;
  let best = Infinity;
  strikes.forEach((k, i) => {
    const dist = Math.abs(k - spot);
    if (dist < best) {
      best = dist;
      atm = i;
    }
  });
  const near = new Set(strikes.filter((_, i) => Math.abs(i - atm) <= WEEKLY_STRIKES));
  return list.filter(d => near.has(d.strike));
}

interface Snap {
  setups: Setup[];
  spot: number;
  /** The terminal answered */
  ok: boolean;
  /** ThetaData had quote rows for the name (fresh or not) */
  rows: number;
  /** The snapshot's rows were all older than the freshness limit (their own stamps), however the name was then read */
  stale?: boolean;
  /** How far the snapshot's newest row lagged the ask, ms (stale only) */
  lagMs?: number;
  /** The current source the setups came from when the snapshot was stale: the quote snapshot or the recorded quotes
      at this instant; absent when the greeks snapshot was current (or nothing current answered) */
  source?: 'quote' | 'at_time';
}

/** One row as a draft, or null when it is not a valid quote stamped inside `freshMs` before `now` (the ask). A stamp
    up to a minute past `receivedAt` (when the answer came in; `now` by default) is not from the future: an answer that
    waited for a slot is newer than its ask (it was dropped, and a busy terminal read as a quiet book). */
function draftOf(item: Record<string, unknown>, symbol: string, now: number, freshMs: number, spotFallback: number, receivedAt = now): Draft | null {
  const row = rowOf(item);
  if (!row) return null;
  const bid = num(row.quote.bid);
  const ask = num(row.quote.ask);
  const at = nyWallStamp(row.quote.timestamp);
  if (!(bid > 0) || !(ask >= bid) || !at || now - at > freshMs || at > Math.max(now, receivedAt) + 60_000) return null;
  const strike = num(row.contract.strike);
  const expiry = String(row.contract.expiration || '').slice(0, 10);
  const rightWord = String(row.contract.right || '').toLowerCase();
  const right: OptionRight | null = rightWord.startsWith('c') ? 'C' : rightWord.startsWith('p') ? 'P' : null;
  if (!right || !(strike > 0) || expiry.length < 10) return null;
  const quoted = num(row.quote.underlying_price);
  const under = quoted > 0 ? quoted : spotFallback;
  const iv = finite(row.quote.implied_vol);
  const root = String(row.contract.symbol || row.contract.root || symbol).toUpperCase();
  const greeks: LiveGreeks = 'delta' in row.quote
    ? {
        delta: finite(row.quote.delta),
        gamma: NaN,
        theta: perDay(finite(row.quote.theta)),
        vega: perPoint(finite(row.quote.vega)),
        rho: perPoint(finite(row.quote.rho)),
        iv: iv > 0 ? iv * 100 : iv,
        lambda: finite(row.quote.lambda),
        epsilon: finite(row.quote.epsilon),
      }
    : NO_GREEKS;
  const bidSize = num(row.quote.bid_size);
  const askSize = num(row.quote.ask_size);
  const sizes = row.quote.bid_size != null && row.quote.ask_size != null && Number.isFinite(bidSize) && Number.isFinite(askSize) ? { bidSize, askSize } : {};
  return { root, strike, right, exp: expiry, bid, ask, under, at, greeks, ...sizes };
}

/** A row the snapshot priced without greeks (the quote snapshot, the recorded quotes): its greeks from its own mid
    on the model's Black-Scholes (compassFeatures bsStates, ivStates: the IV the mid solves for, the time to its
    expiry in sessions). For the card only: the trees solve their own IV and greeks from the mid, whatever the row
    carried, so a call does not depend on the vendor's greeks. */
export function localGreeks(d: Pick<Draft, 'bid' | 'ask' | 'under' | 'strike' | 'right' | 'exp' | 'at'>, now: number): LiveGreeks {
  const mid = (d.bid + d.ask) / 2;
  const T = sessionsAhead(d.exp, d.at || now) / 252;
  const call = d.right === 'C';
  const iv = ivStates(mid, d.under, d.strike, T, call);
  if (!(iv > 0)) return NO_GREEKS;
  const g = bsStates(d.under, d.strike, T, iv, call);
  return { delta: g.de, gamma: g.ga, theta: g.th, vega: g.ve, iv: iv * 100, rho: NaN, lambda: Number.isFinite(g.de) && mid > 0 ? (g.de * d.under) / mid : NaN, epsilon: NaN };
}

function build(drafts: Map<string, Draft[]>, expiry: string, sleeve: SleeveKey, listed: number): Setup[] {
  return kept(drafts.get(expiry) ?? []).map(d => {
    const s = toSetup(d.root, d.strike, d.right, d.exp, d.bid, d.ask, d.under, sleeve, d.at, d.greeks, listed);
    return d.bidSize != null && d.askSize != null ? { ...s, bidSize: d.bidSize, askSize: d.askSize } : s;
  });
}

/** One snapshot of one name: today's expiry (0DTE), one named expiry, or '*' for the nearest expiry 1 to 7 sessions
    out (every expiry within 11 calendar days in one ask, the nearest kept). Every read reaches Book B's band
    (WEEKLY_STRIKES, 17): at the old 4 a weekly Book B (8 or more strikes out) could never be read, and at the old 16
    a same-day Book B on a single name at the widest span (13 to 17 strikes out) missed its outer strike. */
export async function once(symbol: string, now: number, only: string, jump = false, freshMs = FRESH_MS): Promise<Snap> {
  const today = sessionIso(now);
  const weekly = only === '*';
  const range = WEEKLY_STRIKES;
  const exp = weekly ? '*' : only.replace(/-/g, '');
  const chain = `symbol=${symbol}&expiration=${exp}&right=both&strike_range=${range}${weekly ? '&max_dte=11' : ''}&format=json`;
  const got = await theta(`/option/snapshot/greeks/first_order?${chain}`, jump);
  if (got.error) return { setups: [], spot: 0, ok: terminalAnswered(got), rows: 0 };
  const items = asRows(got.data);
  let read = readChain(items, symbol, now, freshMs, 0, Date.now());
  let source: Snap['source'];
  /* every row answered, none current: the snapshot lags (its own stamps), so this name is read from a source that is
     current, each row checked the same way, never from the stale rows */
  const stale = read.valid > 0 && read.fresh === 0;
  const lagMs = stale && read.newest > 0 ? Math.max(0, now - read.newest) : 0;
  if (stale) {
    read = { drafts: new Map(), spot: 0, valid: read.valid, fresh: 0, newest: read.newest };
    const spot = await liveSpot(symbol, now);
    for (const [kind, path] of fallbackPaths(symbol, now, chain, exp, range)) {
      const alt = await theta(path, jump);
      if (alt.error) continue;
      const r = readChain(asRows(alt.data), symbol, now, freshMs, spot, Date.now(), true);
      if (r.fresh > 0) {
        read = r;
        source = kind;
        break;
      }
    }
  }
  const tag = { rows: items.length, ...(stale ? { stale: true, lagMs } : {}), ...(source ? { source } : {}) };
  const { drafts, spot } = read;
  if (!weekly) {
    const sleeve: SleeveKey = only.replace(/-/g, '') === sessionYmd(now) ? 'odte' : 'weekly';
    return { setups: build(drafts, only.slice(0, 10), sleeve, now), spot, ok: true, ...tag };
  }
  const nearest = [...drafts.keys()].filter(e => {
    const n = weekdayDte(today, e);
    return n >= 1 && n <= 7;
  }).sort()[0];
  return { setups: nearest ? build(drafts, nearest, 'weekly', now) : [], spot, ok: true, ...tag };
}

interface ChainRead {
  drafts: Map<string, Draft[]>;
  spot: number;
  /** Rows with a valid quote and a stamp, fresh or not */
  valid: number;
  /** Rows kept: valid and stamped inside the freshness limit */
  fresh: number;
  /** The newest stamp of a valid row, epoch ms (0: none) */
  newest: number;
}

/** A chain answer as drafts by expiry. `local`: the rows carry no greeks (the quote snapshot, the recorded quotes), so
    each is priced on the model's Black-Scholes from its own mid, on `spotFallback` when the row has no underlying. */
function readChain(items: Record<string, unknown>[], symbol: string, now: number, freshMs: number, spotFallback: number, receivedAt: number, local = false): ChainRead {
  const drafts = new Map<string, Draft[]>();
  let spot = 0;
  let valid = 0;
  let fresh = 0;
  let newest = 0;
  for (const item of items) {
    const row = rowOf(item);
    if (row) {
      const at = nyWallStamp(row.quote.timestamp);
      const bid = num(row.quote.bid);
      const ask = num(row.quote.ask);
      if (at && bid > 0 && ask >= bid) {
        valid += 1;
        if (at > newest) newest = at;
      }
    }
    const d = draftOf(item, symbol, now, freshMs, spotFallback, receivedAt);
    if (!d) continue;
    if (local && !Number.isFinite(d.greeks.delta) && d.under > 0) d.greeks = localGreeks(d, now);
    fresh += 1;
    if (d.under > 0) spot = d.under;
    const list = drafts.get(d.exp) ?? [];
    list.push(d);
    drafts.set(d.exp, list);
  }
  return { drafts, spot, valid, fresh, newest };
}

/** The current sources for a name whose greeks snapshot lags, cheapest first: the quote snapshot (the same chain, no
    greeks; one ask, about half the bytes), then the quotes recorded at this very instant (option/at_time/quote, two
    seconds back: every row carries the stamp of its own last quote, so a store that lags shows as old stamps and is
    refused, never used). A weekly ask of every expiry within 11 days reads the quote snapshot only: the recorded
    quotes take one expiry. */
function fallbackPaths(symbol: string, now: number, chain: string, exp: string, range: number): ['quote' | 'at_time', string][] {
  const out: ['quote' | 'at_time', string][] = [['quote', `/option/snapshot/quote?${chain}`]];
  if (exp !== '*') {
    const at = nyParts(now - 2_000);
    const day = ymd(now);
    const time = `${two(at.hour)}:${two(at.minute)}:${two(at.second)}.000`;
    out.push(['at_time', `/option/at_time/quote?symbol=${encodeURIComponent(symbol)}&expiration=${exp}&right=both&strike_range=${range}&start_date=${day}&end_date=${day}&time_of_day=${time}&format=json`]);
  }
  return out;
}

/** The underlying's price now, for chain rows that carry none: an index's snapshot price, a stock's quote mid (its
    last trade price when the quote has no sides), each only when stamped inside the freshness limit; 0 when none is. */
async function liveSpot(symbol: string, now: number): Promise<number> {
  const under = INDEX_OF[symbol] ?? symbol;
  const index = Object.prototype.hasOwnProperty.call(INDEX_OF, symbol);
  const got = await theta(index ? `/index/snapshot/price?symbol=${encodeURIComponent(under)}&format=json` : `/stock/snapshot/quote?symbol=${encodeURIComponent(under)}&format=json`);
  if (got.error) return 0;
  for (const item of asRows(got.data)) {
    const row = rowOf(item);
    if (!row) continue;
    const at = nyWallStamp(row.quote.timestamp);
    if (!at || now - at > FRESH_MS) continue;
    const bid = num(row.quote.bid);
    const ask = num(row.quote.ask);
    const px = bid > 0 && ask >= bid ? (bid + ask) / 2 : num(row.quote.price);
    if (px > 0) return px;
  }
  return 0;
}

const two = (n: number) => String(n).padStart(2, '0');
const clockOf = (ms: number) => {
  const p = nyParts(ms);
  return `${two(p.hour)}:${two(p.minute)}`;
};

const expiryMemo = new Map<string, { at: number; list: string[] }>();

/** The name's listed expirations (YYYY-MM-DD), read once an hour. */
async function expirationsOf(symbol: string): Promise<string[] | null> {
  const hit = expiryMemo.get(symbol);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.list;
  const got = await theta(`/option/list/expirations?symbol=${encodeURIComponent(symbol)}&format=json`);
  /* a fault is not an empty listing: it was memoised for an hour, and every weekly late mark of the name read "no
     quotes" */
  if (!terminalAnswered(got)) return null;
  const list = asRows(got.data).map(r => String(r.expiration ?? '').slice(0, 10)).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e));
  expiryMemo.set(symbol, { at: Date.now(), list });
  return list;
}

/** The nearest listed expiry 1 to 7 sessions out (YYYY-MM-DD), from the hourly expirations read, or null. */
export async function weeklyExpiry(symbol: string, at: number): Promise<string | null> {
  const list = await expirationsOf(symbol);
  if (!list) return null;
  const session = sessionIso(at);
  return list.filter(e => {
    const n = weekdayDte(session, e);
    return n >= 1 && n <= 7;
  }).sort()[0] ?? null;
}

/** The quotes that stood at one instant: ThetaData's recorded NBBO for every listed strike near the money, each with
    its own stamp (a quote that had not changed for 90 seconds is not on the board, as live). */
export async function atMark(symbol: string, markAt: number, sleeve: 'odte' | 'weekly'): Promise<Snap> {
  const session = sessionIso(markAt);
  let expiry = session;
  if (sleeve === 'weekly') {
    const list = await expirationsOf(symbol);
    if (!list) return { setups: [], spot: 0, ok: false, rows: 0 };
    const near = await weeklyExpiry(symbol, markAt);
    if (!near) return { setups: [], spot: 0, ok: true, rows: 0 };
    expiry = near;
  }
  const day = ymd(markAt);
  const p = nyParts(markAt);
  const time = `${two(p.hour)}:${two(p.minute)}:${two(p.second)}.000`;
  const range = sleeve === 'weekly' ? WEEKLY_STRIKES : 16;
  const got = await theta(`/option/at_time/quote?symbol=${encodeURIComponent(symbol)}&expiration=${expiry.replace(/-/g, '')}&right=both&strike_range=${range}&start_date=${day}&end_date=${day}&time_of_day=${time}&format=json`);
  if (got.error) return { setups: [], spot: 0, ok: terminalAnswered(got), rows: 0 };
  const items = asRows(got.data);
  if (!items.length) return { setups: [], spot: 0, ok: true, rows: 0 };
  const spot = await underAt(symbol, markAt);
  const drafts = new Map<string, Draft[]>();
  for (const item of items) {
    const d = draftOf(item, symbol, markAt, FRESH_MS, spot > 0 ? spot : 0);
    if (!d) continue;
    const list = drafts.get(d.exp) ?? [];
    list.push(d);
    drafts.set(d.exp, list);
  }
  const listed = sleeve === 'odte' ? 'odte' : 'weekly';
  return { setups: build(drafts, expiry, listed, markAt), spot: spot > 0 ? spot : 0, ok: true, rows: items.length };
}

/* ---- the marks ---- */

export type NameMark = 'pending' | 'live' | 'late' | 'quiet' | 'none' | 'stale';

export interface MarkRow {
  /** The mark's minute, epoch ms */
  at: number;
  /** 'HH:MM' ET */
  clock: string;
  sleeve: 'odte' | 'weekly' | 'lottery';
  /** What happened to each name at this mark: scored live, scored late from recorded quotes, answered with no quote
      fresh enough to score, ThetaData had no quotes, still waiting to be scored, or 'stale': the snapshot's rows were
      all older than the freshness limit and no current source answered (not scored: it is not a quiet book) */
  names: Record<string, NameMark>;
  /** Contracts scored */
  scored: number;
  /** When the last pass over it finished, epoch ms */
  ranAt: number;
}

const marks = new Map<string, MarkRow>();
const markFns = new Set<() => void>();
const markKey = (at: number, sleeve: string) => `${at}|${sleeve}`;

export function onMarks(fn: () => void): () => void {
  markFns.add(fn);
  return () => markFns.delete(fn);
}

function markChanged(): void {
  for (const fn of markFns) fn();
}

export function exportMarks(): MarkRow[] {
  return [...marks.values()].sort((a, b) => a.at - b.at || a.sleeve.localeCompare(b.sleeve));
}

export function importMarks(rows: readonly MarkRow[]): void {
  marks.clear();
  for (const r of rows) if (r && r.at > 0 && r.sleeve && r.names) marks.set(markKey(r.at, r.sleeve), { ...r, names: { ...r.names } });
  markChanged();
}

/** One word for how a mark went: every name live, some scored late, none, or still waiting. */
export function markHow(row: MarkRow): 'live' | 'late' | 'none' | 'pending' | 'quiet' | 'stale' {
  const v = Object.values(row.names);
  if (v.includes('pending')) return 'pending';
  if (v.includes('late')) return 'late';
  if (v.includes('live')) return 'live';
  if (v.length && v.every(x => x === 'none')) return 'none';
  if (v.includes('stale')) return 'stale';
  return 'quiet';
}

/** The feed's health after a live pass: the names whose snapshot lagged, those a current source scored, those not
    scored at all. A pass with no stale name is fresh again. */
export function feedAfter(prev: FeedHealth, at: number, notes: { symbol: string; stale: boolean; lagMs: number; source?: string; scored: boolean }[]): FeedHealth {
  const stale = notes.filter(n => n.stale);
  if (!stale.length) return notes.length ? freshFeed() : prev;
  return {
    state: 'stale',
    since: prev.state === 'stale' && prev.since ? prev.since : at,
    lagMs: Math.max(...stale.map(n => n.lagMs)),
    names: stale.map(n => n.symbol).sort(),
    fallback: stale.filter(n => n.source).map(n => n.symbol).sort(),
    blind: stale.filter(n => !n.source).map(n => n.symbol).sort(),
    at,
  };
}

function markRow(at: number, sleeve: 'odte' | 'weekly' | 'lottery', names: string[]): MarkRow {
  const key = markKey(at, sleeve);
  let row = marks.get(key);
  if (!row) {
    row = { at, clock: clockOf(at), sleeve, names: {}, scored: 0, ranAt: 0 };
    marks.set(key, row);
  }
  for (const n of names) if (!row.names[n]) row.names[n] = 'pending';
  return row;
}

/* ---- one mark ---- */

const minuteStart = (ms: number) => Math.floor(ms / 60_000) * 60_000;

function pickLine(): string {
  const rows = currentPicks();
  const a = rows.filter(s => s.band === 'top').length;
  const b = rows.filter(s => s.band === 'wing').length;
  const c = rows.filter(s => s.band === 'lottery').length;
  return `${BOOK_NAME.A} ${a}. ${BOOK_NAME.B} ${b}. ${BOOK_NAME.C} ${c}.`;
}

function noteSpots(snaps: { symbol: string; spot: number }[]): void {
  const spots = { ...meta.spots };
  for (const { symbol, spot } of snaps) {
    if (!(spot > 0)) continue;
    spots[symbol] = spot;
    if (INDEX_OF[symbol]) spots[INDEX_OF[symbol]] = spot;
  }
  setScanMeta({ spots, line: pickLine() });
}

/* Names whose options are shut keep the chain's last underlying, which can be an hour behind the stock.
   Once a minute, those spots become the terminal's last trade — the same print the name chip reads. */
let tapeSpotsAt = 0;
async function refreshTapeSpots(now: number): Promise<void> {
  if (now - tapeSpotsAt < 60_000) return;
  const want = new Set<string>();
  for (const symbol of Object.keys(meta.spots)) {
    if (optionScanOpen(symbol, 0, now) || optionScanOpen(symbol, 1, now)) continue;
    want.add(INDEX_OF[symbol] ?? symbol);
  }
  if (!want.size) return;
  tapeSpotsAt = now;
  const snaps: { symbol: string; spot: number }[] = [];
  await pool([...want], 4, async symbol => {
    const index = Object.prototype.hasOwnProperty.call(INDEX_OF, symbol);
    const path = index
      ? `/index/snapshot/price?symbol=${encodeURIComponent(symbol)}&format=json`
      : `/stock/snapshot/trade?symbol=${encodeURIComponent(symbol)}&format=json`;
    const got = await theta(path);
    if (got.error) return;
    let px = 0;
    for (const row of asRows(got.data)) {
      const n = num(row.price);
      if (n > 0) px = n;
    }
    if (px > 0) snaps.push({ symbol, spot: px });
  });
  if (snaps.length) noteSpots(snaps);
}

/** Run `fn` over `items`, at most `n` at once. */
async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      const item = items[i++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
}

let running = 0;

/** The live pass of one sleeve at the mark now standing. A name the terminal did not answer stays pending: it is
    scored late once the minute has passed. */
async function liveMark(markAt: number, sleeve: 'odte' | 'weekly'): Promise<void> {
  const at = Date.now();
  if (minuteStart(at) !== markAt) return;
  const names = sleeve === 'odte' ? odteNames(at) : weeklyNames(at);
  const row = markRow(markAt, sleeve, names);
  const todo = names.filter(n => row.names[n] === 'pending');
  if (!todo.length) return;
  running += 1;
  setScanMeta({ busy: true });
  setScanBusy(true);
  try {
    resetScanReport(sleeve);
    const only = sleeve === 'odte' ? sessionIso(at) : '*';
    let answered = false;
    const snaps: { symbol: string; spot: number }[] = [];
    const notes: { symbol: string; stale: boolean; lagMs: number; source?: string; scored: boolean }[] = [];
    await pool(todo, 6, async symbol => {
      const scanAt = Date.now();
      /* the minute has passed: the quotes now are not the mark's, so the name is scored late */
      if (minuteStart(scanAt) !== markAt) return;
      /* a weekly name reads its own nearest expiry (one expiry, Book B's band) */
      const exp = sleeve === 'weekly' ? (await weeklyExpiry(symbol, scanAt)) ?? '*' : only;
      if (minuteStart(Date.now()) !== markAt) return;
      const snap = await once(symbol, scanAt, exp, true);
      if (!snap.ok) return;
      answered = true;
      notes.push({ symbol, stale: !!snap.stale, lagMs: snap.lagMs ?? 0, source: snap.source, scored: snap.setups.length > 0 });
      /* the answer came in after the mark's minute: those are not the mark's quotes, so no call is made on them (they
         used to be scored at the mark all the same). The name is scored late, from the quotes recorded at the mark. */
      if (minuteStart(Date.now()) !== markAt) return;
      snaps.push({ symbol, spot: snap.spot });
      if (snap.setups.length) {
        let result: ScoreResult = 'fault';
        try {
          result = await scoreBook(snap.setups, scanAt, true);
        } catch {
          /* this name, not the rest */
        }
        /* an input the terminal did not answer: the name is scored late from the mark's recorded quotes */
        if (result === 'fault') return;
      }
      recordPicks(scanAt);
      row.names[symbol] = snap.setups.length ? 'live' : snap.stale ? 'stale' : snap.rows ? 'quiet' : 'none';
      row.scored += snap.setups.length;
    });
    row.ranAt = Date.now();
    if (notes.length) setScanMeta({ feed: feedAfter(meta.feed, markAt, notes) });
    if (answered) {
      commitClosest(sleeve, at);
      noteScanned(sleeve, at);
      noteSpots(snaps);
      bg('the sparklines', fillSparks(names));
    }
    markChanged();
  } finally {
    running -= 1;
    if (!running) {
      setScanBusy(false);
      setScanMeta({ busy: false, line: pickLine() });
    }
  }
}

/** One name at a past mark, from the quotes recorded then. */
async function lateName(row: MarkRow, symbol: string): Promise<void> {
  if (row.sleeve === 'lottery') return;
  const sleeve = row.sleeve;
  const snap = await atMark(symbol, row.at, sleeve);
  if (!snap.ok) return;
  if (!snap.rows) {
    row.names[symbol] = 'none';
  } else if (!snap.setups.length) {
    row.names[symbol] = 'quiet';
  } else {
    const report = { ...scanReport(sleeve) };
    let result: ScoreResult = 'fault';
    try {
      result = await scoreBook(snap.setups, row.at, true, true);
    } catch {
      /* this name, not the rest */
    } finally {
      setScanReport(sleeve, report);
    }
    /* an input did not answer: still pending, asked again on the next pass */
    if (result === 'fault') return;
    recordPicks(row.at);
    row.names[symbol] = 'late';
    row.scored += snap.setups.length;
  }
  row.ranAt = Date.now();
  markChanged();
}

/* ---- Book C ---- */

let lotteryDay = '';

/** Book C's window on this session: 15:20–15:50 ET, or 40 to 10 minutes before an early close (compassParams
    inLottery, the one window the scorer's gate reads too). */
function lotteryWindow(mins: number, second: number): boolean {
  return inLottery(mins, second, closeMin);
}

/** The New York calendar date of an instant (YYYY-MM-DD): the session `day` rolls at 20:00 (and over a weekend or a
    holiday reads the next session), so a sweep of `day`'s Book C runs only on `day` itself. */
const wallIso = (ms: number): string => {
  const p = nyParts(ms);
  return `${p.year}-${two(p.month)}-${two(p.day)}`;
};

export async function lotterySweep(now: number, late: boolean): Promise<boolean> {
  const at = late ? now : Date.now();
  const names = odteNames(at);
  /* no same-day root is on (a weekend, a holiday): no sweep, and no empty mark row */
  if (!names.length) return false;
  const row = markRow(minuteStart(at), 'lottery', names);
  const byName = new Map<string, Setup[]>();
  let answered = false;
  await pool(names, 6, async symbol => {
    const snap = late ? await atMark(symbol, at, 'odte') : await once(symbol, at, sessionIso(at), true, 20_000);
    if (!snap.ok) return;
    answered = true;
    row.names[symbol] = !snap.rows && late ? 'none' : snap.setups.length ? (late ? 'late' : 'live') : 'quiet';
    byName.set(symbol, snap.setups);
  });
  if (!answered) return false;
  /* the five go to the roots in the book's own order (odteBook), not in the order the terminal happened to answer:
     the sweep used to hand its seats to whichever names came back first, so the same quotes could pick other roots */
  const found = names.flatMap(n => byName.get(n) ?? []);
  await scoreLottery(found, at, late);
  recordPicks(at);
  row.scored = found.length;
  row.ranAt = Date.now();
  markChanged();
  return true;
}

/* ---- between marks ---- */

let heldAt = 0;

/** Quotes for the cards already up: one snapshot per name and expiry, at most every 15 seconds. No new universe walk. */
async function refreshHeld(now: number): Promise<void> {
  const live = currentPicks();
  if (!live.length || now - heldAt < 15_000 || deskPhase(now) === 'closed') return;
  heldAt = now;
  const byExp = new Map<string, string[]>();
  for (const s of live) {
    if (!s.expiryDate) continue;
    const dte = weekdayDte(sessionYmd(now), s.expiryDate);
    if (!optionScanOpen(s.ticker, Number.isFinite(dte) ? Math.min(dte, 1) : 1, now)) continue;
    const list = byExp.get(s.expiryDate) ?? [];
    if (!list.includes(s.ticker)) list.push(s.ticker);
    byExp.set(s.expiryDate, list);
  }
  const found: Setup[] = [];
  const snaps: { symbol: string; spot: number }[] = [];
  const jobs = [...byExp].flatMap(([exp, symbols]) => symbols.map(symbol => ({ exp, symbol })));
  await pool(jobs, 4, async ({ exp, symbol }) => {
    const got = await once(symbol, Date.now(), exp, false);
    snaps.push({ symbol, spot: got.spot });
    found.push(...got.setups);
  });
  if (found.length) paintQuotes(found);
  noteSpots(snaps);
}

const SPARK_UNDER: Record<string, string> = { SPXW: 'SPX', XSP: 'SPX', RUTW: 'RUT', SPX: 'SPX', RUT: 'RUT', VIX: 'VIX', NDX: 'NDX', NDXP: 'NDX' };

/** Today's five-minute closes of the underlying (the session so far). */
async function closesOf(symbol: string, index: boolean): Promise<number[]> {
  const day = ymd(Date.now());
  const path = index
    ? `/index/history/ohlc?symbol=${symbol}&start_date=${day}&end_date=${day}&interval=5m&format=json`
    : `/stock/history/ohlc?symbol=${symbol}&start_date=${day}&end_date=${day}&interval=5m&format=json`;
  const got = await theta(path);
  return asRows(got.data).flatMap(r => (Array.isArray(r.data) ? asRows(r.data) : [r])).map(r => num(r.close)).filter(n => n > 0);
}

const sparkAt = new Map<string, number>();

async function fillSparks(symbols: string[]): Promise<void> {
  const keys = [...new Set(symbols.map(s => SPARK_UNDER[s] ?? s))].filter(k => Date.now() - (sparkAt.get(k) ?? 0) > 4 * 60_000);
  if (!keys.length) return;
  const fresh: Record<string, number[]> = { ...meta.sparks };
  await pool(keys, 3, async key => {
    sparkAt.set(key, Date.now());
    const series = await closesOf(key, key in SPARK_UNDER || key in INDEX_OF);
    if (series.length >= 2) fresh[key] = series;
  });
  setScanMeta({ sparks: fresh });
}

/* ---- the clock ---- */

/** The session's close when it is early (minute of the day), from ThetaData's calendar; null on a full day. */
let closeMin: number | null = null;
let closeDay = '';

export function sessionClose(): number | null {
  return closeMin;
}

/** The close the calendar in core/calendar.ts gives for a session date (YYYYMMDD): 13:00 on a listed early close,
    else null. Used until ThetaData's calendar answers, so a terminal that is down at the day roll cannot leave an early
    close unknown (and the 13:00 day scanned and flattened as a full one). */
export function calendarClose(day: string): number | null {
  const m = sessionCloseMinOn(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`);
  return m < 16 * 60 ? m : null;
}

let closeAsked = 0;
let closeBusy = false;

/** ThetaData's calendar for the session, asked again every tick (at most every 10 s) until it answers; the
    core/calendar close stands in meanwhile. */
async function readClose(day: string): Promise<void> {
  if (closeDay === day || closeBusy || Date.now() - closeAsked < 10_000) return;
  closeBusy = true;
  closeAsked = Date.now();
  try {
    const got = await theta(`/calendar/on_date?date=${day}&format=json`);
    if (got.error) return;
    const row = asRows(got.data)[0];
    if (!row) return;
    closeDay = day;
    const type = String(row.type ?? '');
    const m = /^(\d{2}):(\d{2})/.exec(String(row.close ?? ''));
    closeMin = type === 'early_close' && m ? Number(m[1]) * 60 + Number(m[2]) : null;
    /* the calls recorded from now on settle against this session's close, and the entries gate on its flat */
    setSessionClose(closeMin);
    setScoreClose(day, closeMin);
  } finally {
    closeBusy = false;
  }
}

/** On an early-close day nothing is scored after the close: the curb and the later marks do not exist. */
function pastEarlyClose(mins: number): boolean {
  return closeMin != null && closeMin < 16 * 60 && mins >= closeMin && mins < 20 * 60 + 15;
}

/** The marks of this session up to now, from `from` (epoch ms), each sleeve with the names it scans then. */
function marksSince(from: number, now: number): { at: number; sleeve: 'odte' | 'weekly'; names: string[] }[] {
  const out: { at: number; sleeve: 'odte' | 'weekly'; names: string[] }[] = [];
  for (let t = minuteStart(from); t < minuteStart(now); t += 60_000) {
    const p = nyParts(t);
    const mins = p.hour * 60 + p.minute;
    if (!sessionScanOpen(mins, p.weekday) || !sessionDayOpen(t) || pastEarlyClose(mins)) continue;
    const odte = odteNames(t);
    if (odte.length) out.push({ at: t, sleeve: 'odte', names: odte });
    const weekly = weeklyNames(t);
    if (weekly.length) out.push({ at: t, sleeve: 'weekly', names: weekly });
  }
  return out;
}

export interface ScanOptions {
  /** A line for the server's log (a pass that threw, a background read that failed) */
  log?: (line: string) => void;
  /** The earliest mark to fill in from recorded quotes, epoch ms (the session's 09:30 by default) */
  backfillFrom?: (day: string) => number;
  /** A new session began: the server starts its file */
  onDay?: (day: string) => void;
}

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let lateBusy = false;
let settleAt = 0;
let lateAt = 0;
let day = '';
let opts: ScanOptions = {};
let stopped = true;

/** The 09:30 ET of a session date (YYYY-MM-DD). */
export function regularOpen(iso: string): number {
  return nyWallTime(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)), 9, 30);
}

/** The first minute of a session date's book (YYYY-MM-DD): the opening of the first index-option window (core/session)
    whose session day is that date, normally 20:15 ET the calendar day before (Sunday 20:15 for a Monday). After a
    holiday with Global Trading Hours it is the evening before the holiday: Sunday 20:15 for the Tuesday after Martin
    Luther King Day, whose GTH run to 11:30 on the Monday and belong to Tuesday's book (it was the holiday's own
    evening, so those marks were never filled). The late fill starts here, so overnight and pre-market marks the engine
    missed are filled too (it used to start at 09:30). */
export function sessionOpenAt(iso: string): number {
  const prev = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) - 86_400_000);
  const eve = nyWallTime(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate(), 20, 15);
  /* from a week before, the index-option windows in order: the first whose session day is `iso` */
  let at = eve - 7 * 86_400_000;
  for (let i = 0; i < 40; i++) {
    const w = nextWindow(at, 'indexOption');
    if (!w || w.from > eve + 86_400_000) break;
    const of = sessionIso(w.from);
    if (of === iso) return w.from;
    if (of > iso) break;
    at = w.from;
  }
  return eve;
}

const said = new Map<string, number>();

/** Logs a failure of one step of the scan, the same line at most once a minute. */
function fault(where: string, e: unknown): void {
  const text = `[compass] ${where} failed: ${e instanceof Error ? e.message : String(e)}`;
  if (Date.now() - (said.get(text) ?? 0) < 60_000) return;
  said.set(text, Date.now());
  if (said.size > 200) said.clear();
  (opts.log ?? console.warn)(text);
}

/** A background step: run, never left unhandled. */
function bg(where: string, job: Promise<unknown>): void {
  job.catch(e => fault(where, e));
}

/** The instant the late Book C sweep reads (15:20:15 ET, or 40 minutes before an early close, of session `day`,
    YYYY-MM-DD), or null while it is not due: only on `day`'s own calendar date, once its window has ended and before
    20:15, and only for an instant already past. From 20:00 `day` is the next session's (and over a weekend or a
    holiday the next session's all afternoon): the sweep used to run then for that session's 15:20, still to come,
    which ThetaData refuses as a future date. */
export function lateLotteryAt(day: string, now: number, close: number | null): number | null {
  if (wallIso(now) !== day) return null;
  const p = nyParts(now);
  const mins = p.hour * 60 + p.minute;
  const early = close != null && close < 16 * 60;
  const end = early ? close - 10 : 15 * 60 + 50;
  if (mins < end || mins >= 20 * 60 + 15) return null;
  const start = early ? close - 40 : 15 * 60 + 20;
  const at = nyWallTime(Number(day.slice(0, 4)), Number(day.slice(5, 7)), Number(day.slice(8, 10)), Math.floor(start / 60), start % 60) + 15_000;
  return at < now ? at : null;
}

function rollDay(now: number): void {
  const next = sessionIso(now);
  if (next !== day) {
    day = next;
    lotteryDay = '';
    /* the close is not known for the new session until its calendar answers */
    closeDay = '';
    closeAsked = 0;
    closeMin = calendarClose(next.replace(/-/g, ''));
    setSessionClose(closeMin);
    setScoreClose(next.replace(/-/g, ''), closeMin);
    opts.onDay?.(next);
    /* the session's one-time reads (prior bars, volume curves, expirations), off the marks' critical path */
    const names = [...new Set([...odteBook(now), ...WEEKLY_FOCUS])];
    bg('the session warm-up', Promise.all([warmSession(names, now), ...WEEKLY_FOCUS.map(n => expirationsOf(n))]));
  }
  if (closeDay !== day.replace(/-/g, '')) bg('the session calendar', readClose(day.replace(/-/g, '')));
}

/** Fill the marks the live pass did not read, oldest first, one name at a time, while no live pass runs. */
let laidFrom = 0;
let laidDay = '';

async function fillLate(now: number): Promise<void> {
  if (lateBusy || running) return;
  lateBusy = true;
  try {
    const from = opts.backfillFrom ? opts.backfillFrom(day) : sessionOpenAt(day);
    /* every mark since the last look gets its row, so a minute nobody scanned is never skipped */
    if (laidDay !== day) {
      laidDay = day;
      laidFrom = from;
    }
    for (const m of marksSince(Math.max(from, laidFrom), now)) markRow(m.at, m.sleeve, m.names);
    laidFrom = Math.max(laidFrom, minuteStart(now));
    const due = exportMarks().filter(r => r.sleeve !== 'lottery' && r.at < minuteStart(Date.now()) && r.at >= from && Object.values(r.names).includes('pending'));
    for (const row of due) {
      if (stopped || running) return;
      const waiting = Object.entries(row.names).filter(([, state]) => state === 'pending').map(([symbol]) => symbol);
      await pool(waiting, 4, symbol => lateName(row, symbol));
      if (meta.theta === 'down') return;
    }
    /* Book C's window passed with no sweep: the 15:20 quotes recorded then */
    const sweepAt = lateLotteryAt(day, now, closeMin);
    if (lotteryDay !== day && sweepAt != null && sweepAt >= from && (await lotterySweep(sweepAt, true))) lotteryDay = day;
  } finally {
    lateBusy = false;
  }
}

async function tick(): Promise<void> {
  if (ticking || stopped) return;
  ticking = true;
  try {
    const now = Date.now();
    rollDay(now);
    const p = nyParts(now);
    const mins = p.hour * 60 + p.minute;
    if (sessionScanOpen(mins, p.weekday) && sessionDayOpen(now) && !pastEarlyClose(mins)) {
      const markAt = minuteStart(now);
      await Promise.all([liveMark(markAt, 'odte'), liveMark(markAt, 'weekly')]);
    }
    if (lotteryDay !== day && lotteryWindow(mins, p.second) && sessionIso(now) === day && wallIso(now) === day) {
      if (await lotterySweep(now, false)) lotteryDay = day;
    }
    bg('the card quotes', refreshHeld(Date.now()));
    bg('the last trades', refreshTapeSpots(Date.now()));
    /* Model Risk is off unless COMPASS_MODEL_RISK=1: on 651 DEV sessions every variant lost (as coded −2.5% a trade,
       7,367 trades, CI below 0 in every year and day type; research/compass-v2/edge-r). Its code stays. */
    if (MODEL_RISK_ON) bg('tail risk', tailPass(Date.now(), tail => setScanMeta({ tail })));
    if (Date.now() - settleAt > 60_000) {
      settleAt = Date.now();
      /* then the calls' random-side twins (the forward test, data/compassTwins.ts), by the same rule, after them */
      bg('settlement', settleOpen(Date.now()).then(() => settleTwins(signals(), Date.now())));
    }
    if (Date.now() - lateAt > 5_000) {
      lateAt = Date.now();
      bg('the late fill', fillLate(Date.now()));
    }
  } finally {
    ticking = false;
  }
}

/** Start the scan. It runs until stopScan(), whether or not anyone is viewing. */
export function startScan(options: ScanOptions = {}): void {
  if (!stopped) return;
  opts = options;
  stopped = false;
  bg('the scan tick', tick());
  timer = setInterval(() => bg('the scan tick', tick()), 1_000);
}

/** Stop at the next step: no new pass starts and the late fill gives up its place. */
export function stopScan(): void {
  stopped = true;
  if (timer != null) clearInterval(timer);
  timer = null;
}

/** Book C has swept this session (restored from the record after a restart). */
export function setLotteryDay(d: string): void {
  lotteryDay = d;
}

export function lotterySwept(): string {
  return lotteryDay;
}
