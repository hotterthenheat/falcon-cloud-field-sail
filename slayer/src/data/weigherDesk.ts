/*
  The Weigher's chain: listed expiries and the live chain from ThetaData (the vendor's listed contracts when
  ThetaData does not answer), the session's volume and open interest, and yesterday's close.
*/

import { expiryFor, isoDate, type Expiry } from '../core/calendar';
import { estimatePremium } from './compass';
import { thetaCall } from './theta';
import { THETA_DAYS, bsOnMark, yearFracLeft } from './weigherGate';
import { ivNear, listUwExpiries, liveSpotOf, loadUwChain } from './weigherChain';
import { peekChange, peekIv, snapshotOf } from './uwBook';
import { weekdayDte } from './compassParams';
import { nameTape } from './compassSession';
import { nyIsoDate, nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { blackScholesGreeks } from '../core/greeks';
import type { OptionRight } from '../types/compass';
import type { MarketSnapshot } from '../types/market';

// ---- deterministic hash noise (the house pattern) ---------------------------
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const h01 = (s: string) => hash(s) / 4294967295;

/** Today's key, so day-stable noise rolls at midnight like the sim's quotes.
    Remembered for a second at a time: it is asked ten times per contract,
    and a whole book of chains asked it ninety thousand times per build —
    a Date and an ISO string each (5ms of every Ledger open, profiled). */
let dayKeyAt = 0;
let dayKeyMemo = '';
const dayKey = () => {
  const t = Date.now();
  if (t - dayKeyAt > 1000) {
    dayKeyAt = t;
    dayKeyMemo = new Date(t).toISOString().slice(0, 10);
  }
  return dayKeyMemo;
};

// ---- the chain --------------------------------------------------------------

export interface DeskContract {
  strike: number;
  right: OptionRight;
  /** Modeled mid, the same estimator every Compass surface prices with */
  mark: number;
  delta: number;
  gamma: number;
  /** Per DAY, the convention every retail chain prints */
  theta: number;
  vega: number;
  iv: number;
  /** Risk-neutral odds the contract finishes in the money — N(d2) family */
  itmOdds: number;
  rho: number;
  /** The quote around the mark — bid under, ask over, by a moneyness-wide spread */
  bid: number;
  ask: number;
  /** Session extremes and reference prints for the drilldown */
  high: number;
  low: number;
  prevClose: number;
  last: number;
  volume: number;
  oi: number;
  breakeven: number;
  /** Strike distance from spot, signed percent */
  fromSpotPct: number;
  /* The column-catalog facts (Noah, 2026-08-26, the customize-columns ask):
     everything below is derived from the same pricing above — no new model,
     just more of its faces. */
  /** Day-stable resting size on each side of the quote, contracts */
  bidSize: number;
  askSize: number;
  /** Last print against yesterday's close — dollars, then percent */
  netChange: number;
  netChangePct: number;
  /** The move the stock needs to reach this contract's breakeven, signed % */
  toBreakevenPct: number;
  /** The mark split at parity: already-in-the-money value, and the rest */
  intrinsic: number;
  extrinsic: number;
  /** Odds the tape touches this strike before expiry. Not twice the finish odds. */
  touchOdds: number;
  /** Odds the contract closes past its breakeven. Long uses the ask. Short uses the bid. */
  profitOddsLong: number;
  profitOddsShort: number;
  /** The ask 30 minutes earlier, when the feed had one. 0 means it was not there. */
  priorAsk?: number;
  /** Exchange time of this quote, epoch ms. 0 means the feed did not stamp it. */
  quotedAt?: number;
}

export interface DeskChainRow {
  strike: number;
  call: DeskContract;
  put: DeskContract;
}

export interface DeskChain {
  ticker: string;
  spot: number;
  step: number;
  rows: DeskChainRow[];
  expiry: Expiry;
  /** The move the options are charging for by this expiry, ± percent */
  expectedMovePct: number;
  /** Live is this contract's own NBBO. Simulated is the desk model, and it says so. */
  source: 'live' | 'simulated';
  /** Newest quote time on the chain, epoch ms. */
  quotedAt: number;
  /** Listed expiration, YYYY-MM-DD. */
  expiryIso: string;
  /** Option symbol the quotes were requested on. Absent means the chain's own ticker. */
  optRoot?: string;
}

/** Abramowitz–Stegun N(x) — same approximation core/greeks uses. */
function normalCDF(x: number): number {
  const k = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804 * Math.exp((-x * x) / 2);
  const p = k * (0.31938153 + k * (-0.356563782 + k * (1.781477937 + k * (-1.821255978 + k * 1.330274429))));
  return x >= 0 ? 1 - d * p : d * p;
}

/** Contract IV off the name's base vol: a gentle smile plus put skew, all
    deterministic so the chain doesn't shimmer between renders. */
function contractIv(baseIv: number, spot: number, strike: number, right: OptionRight): number {
  const m = (strike - spot) / spot;
  const smile = 1 + 2.2 * m * m;
  const skew = right === 'P' ? 1 + Math.max(0, -m) * 0.35 : 1 + Math.max(0, -m) * 0.15;
  return baseIv * smile * skew;
}

/** The expiry rail: requested horizons resolved to REAL sessions, deduped —
    two horizons that land on the same Friday are one door, not two. */
export const DESK_DTES = [0, 2, 4, 7, 14, 21, 30, 45] as const;

export function deskExpiries(): Expiry[] {
  const seen = new Set<string>();
  const out: Expiry[] = [];
  for (const dte of DESK_DTES) {
    const e = expiryFor(dte);
    const key = isoDate(e.date);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** The desk's horizon (calendar days, what `expiryFor` walks) for a REAL
    expiry date ("2026-09-18") — a deep link carries the date, never a count
    (the Record sent sessions once and the desk read them as days: a Friday
    print landed on the Wednesday, 2026-09-12). A listed horizon that resolves
    to the date wins, so the rail's own door is the one that lights; otherwise
    the first horizon inside ninety days that lands there; null past that.
    What comes back is the RESOLVED horizon (`Expiry.dte`, the calendar days
    to the real date) — the value the rail's options carry and the desk
    stores — never the requested one (a "7" asked on a Saturday resolves to
    Friday, six days out; storing 7 would list the Friday twice). */
export function dteForDate(key: string): number | null {
  for (const dte of DESK_DTES) {
    const e = expiryFor(dte);
    if (isoDate(e.date) === key) return e.dte;
  }
  for (let dte = 0; dte <= 90; dte++) {
    const e = expiryFor(dte);
    if (isoDate(e.date) === key) return e.dte;
  }
  return null;
}

/** A single contract's IV on the same smile the chain prices with —
    exported so the premium pane and the chain can never disagree. */
export function contractIvFor(ticker: string, strike: number, right: OptionRight): number {
  const own = ivNear(ticker, strike, right);
  if (own != null) return own;
  /* no quote for this contract yet: the name's live at-the-money IV on the desk's smile, else a plain 30% */
  const base = peekIv(ticker) ?? FALLBACK_IV;
  const spot = liveSpotOf(ticker);
  return spot != null && spot > 0 ? contractIv(base, spot, strike, right) : base;
}
const FALLBACK_IV = 0.3;

/** `snap`: price the chain off THIS snapshot's spot and open interest instead of the live simulator's — the book at
    the session's open (levelview's `snapshotAtOpen`), for the calendar's "since the open" (2026-10-12) */
export function buildDeskChain(ticker: string, dte: number, depth = 10, snap?: MarketSnapshot): DeskChain {
  const snapshot = snap ?? snapshotOf(ticker);
  if (!snapshot) return blankChain(ticker, dte);
  const { spot, chain } = snapshot;
  const expiry = expiryFor(dte);
  // Sessions, floored at half a day — a listed contract has at least that
  const t = Math.max(expiry.sessions, 0.5) / 252;
  const baseIv = peekIv(ticker) ?? FALLBACK_IV;

  /* Yesterday's close for every contract is yesterday's spot run through the same estimator. */
  const prevSpot = spot / (1 + (peekChange(ticker) ?? 0) / 100);

  const sorted = [...chain].sort((a, b) => a.strike - b.strike);
  const spotIdx = Math.max(0, sorted.findIndex(n => n.strike >= spot));
  let step = Infinity;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].strike - sorted[i - 1].strike;
    if (d > 1e-9) step = Math.min(step, d);
  }
  if (!Number.isFinite(step) || step <= 0) step = 1;

  /*
    THE LADDER IS NOT CAPPED BY THE BOOK (Noah, 2026-08-25: "there should be
    way more strikes"). The sim maintains ~30 strikes a side for the GEX
    machinery; a quote table reaches further. Strikes are laid on the chain's
    own grid centred at the book's spot strike, real nodes hand over their
    open interest, and the wings past the book get a deterministic, day-stable
    OI that decays with distance — priced by the same estimator either way.
  */
  const byStrike = new Map(sorted.map(n => [n.strike, n]));
  const center = sorted[spotIdx]?.strike ?? Math.round(spot / step) * step;
  const wingOI = (strike: number, right: OptionRight): number => {
    const decay = Math.exp(-Math.abs(strike - spot) / (spot * 0.08));
    return Math.round(h01(`${ticker}-${strike}-${right}-${dayKey()}-boi`) * 9000 * decay + 40);
  };
  const window: { strike: number; callOI: number; putOI: number }[] = [];
  for (let i = -depth; i <= depth; i++) {
    const strike = Number((center + i * step).toFixed(2));
    if (strike <= 0) continue;
    const node = byStrike.get(strike);
    window.push({
      strike,
      callOI: node ? node.callOI : wingOI(strike, 'C'),
      putOI: node ? node.putOI : wingOI(strike, 'P'),
    });
  }

  const side = (strike: number, right: OptionRight, oi: number): DeskContract => {
    const iv = contractIv(baseIv, spot, strike, right);
    const mark = Number(estimatePremium(spot, strike, right, iv, t).toFixed(2));
    const g = blackScholesGreeks(spot, strike, t, iv);
    const r = 0.05;
    const d1 = (Math.log(spot / strike) + (r + (iv * iv) / 2) * t) / (iv * Math.sqrt(t));
    const d2 = d1 - iv * Math.sqrt(t);
    const nd2 = normalCDF(d2);
    // Black-Scholes theta, stated per SESSION day
    const pdf = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
    const thetaYear =
      -(spot * pdf * iv) / (2 * Math.sqrt(t)) -
      (right === 'C' ? r * strike * Math.exp(-r * t) * nd2 : -r * strike * Math.exp(-r * t) * (1 - nd2));
    // Day-stable, contract-deterministic volume that leans toward the money
    const near = Math.exp(-Math.abs(strike - spot) / (spot * 0.03));
    const seed = `${ticker}-${strike}-${right}-${dayKey()}`;
    const volume = Math.round(h01(`${seed}-dvol`) * 40000 * near + 120 * near);
    /* The spread widens as the contract leaves the money — a $12 ATM name is
       penny-wide, a lotto is not. Floored at a cent. */
    const m = Math.abs(strike - spot) / spot;
    const spread = Math.max(0.01, mark * (0.015 + 0.06 * Math.min(1, m * 5)) * (0.6 + 0.8 * h01(`${seed}-spr`)));
    const bid = Math.max(0, Number((mark - spread / 2).toFixed(2)));
    const ask = Number((mark + spread / 2).toFixed(2));
    const last = Number((bid + (ask - bid) * h01(`${seed}-fill`)).toFixed(2));
    const prevClose = Math.max(0.01, Number(estimatePremium(prevSpot, strike, right, iv, t + 1 / 252).toFixed(2)));
    const high = Number((Math.max(mark, last, prevClose) * (1 + 0.04 + 0.09 * h01(`${seed}-hi`))).toFixed(2));
    const low = Math.max(0.01, Number((Math.min(mark, last) * (1 - 0.04 - 0.09 * h01(`${seed}-lo`))).toFixed(2)));
    const rho = Number(
      (((right === 'C' ? 1 : -1) * strike * t * Math.exp(-r * t) * (right === 'C' ? nd2 : 1 - nd2)) / 100).toFixed(4)
    );

    // ---- the column-catalog facts, all from the machinery already here ----
    const breakeven = Number((right === 'C' ? strike + ask : strike - ask).toFixed(2));
    // Size leans toward the money like volume does, on its own hash lane
    const sizeDecay = Math.exp(-Math.abs(strike - spot) / (spot * 0.1));
    const bidSize = Math.round(h01(`${seed}-bsz`) * 380 * sizeDecay + 3);
    const askSize = Math.round(h01(`${seed}-asz`) * 380 * sizeDecay + 3);
    const netChange = Number((last - prevClose).toFixed(2));
    const netChangePct = prevClose > 0 ? Number(((netChange / prevClose) * 100).toFixed(1)) : 0;
    const intrinsic = Number(Math.max(0, right === 'C' ? spot - strike : strike - spot).toFixed(2));
    const extrinsic = Number(Math.max(0, mark - intrinsic).toFixed(2));
    const solved = bsOnMark(spot, strike, right, bid, ask, t);
    const touchOdds = solved ? Number(solved.touch.toFixed(2)) : NaN;
    const profitOddsLong = solved ? Number(solved.profitLong.toFixed(2)) : NaN;
    const profitOddsShort = solved ? Number(solved.profitShort.toFixed(2)) : NaN;

    return {
      strike,
      right,
      mark,
      delta: Number((right === 'C' ? g.deltaCall : g.deltaPut).toFixed(4)),
      gamma: Number(g.gamma.toFixed(4)),
      theta: Number((thetaYear / THETA_DAYS).toFixed(4)),
      vega: Number(g.vega.toFixed(4)),
      iv: Number((iv * 100).toFixed(2)),
      itmOdds: Number(((right === 'C' ? nd2 : 1 - nd2) * 100).toFixed(2)),
      rho,
      bid,
      ask,
      high,
      low,
      prevClose,
      last,
      volume,
      oi,
      breakeven,
      fromSpotPct: Number((((strike - spot) / spot) * 100).toFixed(2)),
      bidSize,
      askSize,
      netChange,
      netChangePct,
      toBreakevenPct: Number((((breakeven - spot) / spot) * 100).toFixed(2)),
      intrinsic,
      extrinsic,
      touchOdds,
      profitOddsLong,
      profitOddsShort,
    };
  };

  const rows: DeskChainRow[] = window.map(node => ({
    strike: node.strike,
    call: side(node.strike, 'C', node.callOI),
    put: side(node.strike, 'P', node.putOI),
  }));

  return {
    ticker,
    spot,
    step,
    rows,
    expiry,
    expectedMovePct: Number((baseIv * Math.sqrt(t) * 100).toFixed(2)),
    source: 'simulated',
    quotedAt: 0,
    expiryIso: isoDate(expiry.date),
  };
}

function numOr(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function stampMs(v: unknown): number {
  return nyWallStamp(v);
}

function ymd(iso: string): string {
  return iso.replace(/\D/g, '').slice(0, 8);
}

function contractKey(contract: Record<string, unknown>): string | null {
  const strike = numOr(contract.strike);
  const word = String(contract.right || '').toLowerCase();
  const right: OptionRight | null = word.startsWith('c') ? 'C' : word.startsWith('p') ? 'P' : null;
  if (!right || strike == null || !(strike > 0)) return null;
  return `${Number(strike.toFixed(4))}|${right}`;
}

function snapRows(data: unknown): { contract: Record<string, unknown>; data: Record<string, unknown> }[] {
  if (!Array.isArray(data)) return [];
  const out: { contract: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const bag = item as Record<string, unknown>;
    const contract = bag.contract && typeof bag.contract === 'object' ? (bag.contract as Record<string, unknown>) : bag;
    const row = Array.isArray(bag.data) ? bag.data[0] : bag.data;
    if (!row || typeof row !== 'object') continue;
    out.push({ contract, data: row as Record<string, unknown> });
  }
  return out;
}

export interface LegQuote {
  mark: number | null;
  prev: number | null;
  low: number | null;
  high: number | null;
}

const legCache = new Map<string, { at: number; q: LegQuote }>();

function legMark(data: unknown): number | null {
  for (const item of snapRows(data)) {
    const bid = numOr(item.data.bid);
    const ask = numOr(item.data.ask);
    if (bid != null && ask != null && ask >= bid && ask > 0) return Number(((bid + ask) / 2).toFixed(2));
  }
  return null;
}

function legDay(data: unknown): { close: number | null; low: number | null; high: number | null } {
  let close: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  for (const item of snapRows(data)) {
    const c = numOr(item.data.close);
    const lo = numOr(item.data.low);
    const hi = numOr(item.data.high);
    if (c != null && c > 0) close = c;
    if (lo != null && lo > 0) low = lo;
    if (hi != null && hi > 0) high = hi;
  }
  return { close, low, high };
}

/** The live mark and yesterday's close for one contract, whatever chain is on screen. */
export async function readLeg(ticker: string, expiry: string, strike: number, right: OptionRight): Promise<LegQuote> {
  const id = `${ticker}|${expiry}|${strike}|${right}`;
  const hit = legCache.get(id);
  if (hit && Date.now() - hit.at < 4000) return hit.q;
  const exp = ymd(expiry);
  const word = right === 'C' ? 'call' : 'put';
  const day = priorWeekdayYmd();
  let mark: number | null = null;
  let prev: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  for (const symbol of optionRoots(ticker)) {
    const base = `symbol=${encodeURIComponent(symbol)}&expiration=${exp}&strike=${strike}&right=${word}`;
    const [quote, eod, ohlc] = await Promise.all([
      thetaCall(`/option/snapshot/quote?${base}&format=json`, true),
      thetaCall(`/option/history/eod?${base}&start_date=${day}&end_date=${day}&format=json`),
      thetaCall(`/option/snapshot/ohlc?${base}&format=json`, true),
    ]);
    if (mark == null && !quote.error && quote.status !== 472 && quote.status !== 478) mark = legMark(quote.data);
    if (prev == null && !eod.error && eod.status !== 472 && eod.status !== 478) prev = legDay(eod.data).close;
    if ((low == null || high == null) && !ohlc.error && ohlc.status !== 472 && ohlc.status !== 478) {
      const session = legDay(ohlc.data);
      if (low == null) low = session.low;
      if (high == null) high = session.high;
    }
    if (mark != null) break;
  }
  const q = { mark, prev, low, high };
  legCache.set(id, { at: Date.now(), q });
  return q;
}

/** The low and high of the session they say they entered. Today is the live session. A past day is that day's print. */
export async function entryRange(ticker: string, expiry: string, strike: number, right: OptionRight, day: string): Promise<{ low: number; high: number } | null> {
  const exp = ymd(expiry);
  const word = right === 'C' ? 'call' : 'put';
  const y = day.replace(/\D/g, '').slice(0, 8);
  const today = ymd(nyIsoDate());
  for (const symbol of optionRoots(ticker)) {
    const base = `symbol=${encodeURIComponent(symbol)}&expiration=${exp}&strike=${strike}&right=${word}`;
    const got = y === today
      ? await thetaCall(`/option/snapshot/ohlc?${base}&format=json`, true)
      : await thetaCall(`/option/history/eod?${base}&start_date=${y}&end_date=${y}&format=json`);
    if (got.error || got.status === 472 || got.status === 478 || got.status === 0) continue;
    const session = legDay(got.data);
    if (session.low != null && session.high != null && session.high >= session.low) return { low: session.low, high: session.high };
  }
  return null;
}
function priorWeekdayYmd(now = Date.now()): string {
  const p = nyParts(now);
  let t = nyWallTime(p.year, p.month, p.day, 12, 0) - 86_400_000;
  for (let i = 0; i < 6; i++) {
    const q = nyParts(t);
    if (q.weekday !== 0 && q.weekday !== 6) return `${q.year}${String(q.month).padStart(2, '0')}${String(q.day).padStart(2, '0')}`;
    t -= 86_400_000;
  }
  const q = nyParts(t);
  return `${q.year}${String(q.month).padStart(2, '0')}${String(q.day).padStart(2, '0')}`;
}

const eodCache = new Map<string, { at: number; rows: Map<string, number> }>();
const priorCache = new Map<string, { at: number; rows: Map<string, number> }>();

async function eodCloses(symbol: string, expiration: string): Promise<Map<string, number>> {
  const key = `${symbol}|${expiration}|${priorWeekdayYmd()}`;
  const hit = eodCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.rows;
  const day = priorWeekdayYmd();
  const got = await thetaCall(`/option/history/eod?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&start_date=${day}&end_date=${day}&format=json`);
  const rows = new Map<string, number>();
  if (got.error || got.status === 472 || got.status === 478 || got.status === 0) return rows;
  for (const item of snapRows(got.data)) {
    const k = contractKey(item.contract);
    const close = numOr(item.data.close);
    if (k && close != null && close > 0) rows.set(k, close);
  }
  eodCache.set(key, { at: Date.now(), rows });
  return rows;
}

/** The ask 30 minutes earlier. A stamp more than two minutes off that clock is not that quote. */
async function priorAsks(symbol: string, expiration: string): Promise<Map<string, number>> {
  const target = Date.now() - 30 * 60 * 1000;
  const p = nyParts(target);
  const date = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  const tod = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
  const key = `${symbol}|${expiration}|${date}${tod.slice(0, 5)}`;
  const hit = priorCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const got = await thetaCall(`/option/at_time/quote?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&start_date=${date}&end_date=${date}&time_of_day=${encodeURIComponent(tod)}&format=json`);
  const rows = new Map<string, number>();
  if (got.error || got.status === 472 || got.status === 478 || got.status === 0) return rows;
  for (const item of snapRows(got.data)) {
    const k = contractKey(item.contract);
    const ask = numOr(item.data.ask);
    const at = stampMs(item.data.timestamp);
    if (!k || ask == null || !(ask > 0) || !at) continue;
    if (Math.abs(at - target) > 120_000) continue;
    rows.set(k, ask);
  }
  priorCache.set(key, { at: Date.now(), rows });
  return rows;
}

export interface ListedExpiry {
  iso: string;
  /** The desk's horizon, the value `expiryFor` resolves to this date. */
  dte: number;
  /** Weekday sessions after today through this expiration. Same day is 0. */
  weekday: number;
  label: string;
  /** The option symbol this date is listed on. SPX's today is SPXW. */
  root: string;
}

/** Standard index monthlies do not list the same-day contract. That chain is the weekly root. */
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };

/** Roots to read, weekly first so a shared date keeps the contract people actually trade that day. */
function optionRoots(ticker: string): string[] {
  const name = ticker.trim().toUpperCase();
  const weekly = WEEKLY_ROOT[name];
  return weekly ? [weekly, name] : [name];
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(iso: string, weekday: number): string {
  if (weekday === 0) return '0 DTE';
  const month = MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? '';
  const day = Number(iso.slice(8, 10));
  return `${month} ${day} · ${weekday} DTE`;
}

/** Every expiration the feed lists for this name. A standard index includes its weekly root, so SPX has a today. `down` means the feed did not answer. An empty list with down false means the name has no options. */
export async function listLiveExpiries(ticker: string): Promise<{ rows: ListedExpiry[]; down: boolean }> {
  const roots = optionRoots(ticker);
  const got = await Promise.all(roots.map(root => thetaCall(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`)));
  const up = got.map(g => !g.error && g.status !== 472 && g.status !== 478 && g.status !== 0);
  if (!up.some(Boolean)) {
    /* ThetaData did not answer: the expiries Unusual Whales lists stand in */
    const uw = await listUwExpiries(ticker);
    return uw && uw.length ? { rows: uw.filter(e => !(e.weekday === 0 && nameTape(e.root, true).done)), down: false } : { rows: [], down: true };
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const byIso = new Map<number, string>();
  for (let d = 0; d <= 240; d++) {
    const e = expiryFor(d);
    byIso.set(e.dte, isoDate(e.date));
  }
  const dteOf = new Map<string, number>();
  for (const [dte, iso] of byIso) if (!dteOf.has(iso)) dteOf.set(iso, dte);
  const out: ListedExpiry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < roots.length; i++) {
    if (!up[i]) continue;
    const raw = got[i].data;
    const rows = Array.isArray(raw) ? raw : [];
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      let iso = String((item as { expiration?: unknown }).expiration ?? '').slice(0, 10);
      if (/^\d{8}$/.test(iso)) iso = `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || seen.has(iso) || iso < today) continue;
      const dte = dteOf.get(iso);
      if (dte == null) continue;
      seen.add(iso);
      const e = expiryFor(dte);
      const weekday = weekdayCount(today, iso);
      /* A finished 0 DTE is not a choice. The next same-day contract appears when that day is today and its tape is still open. */
      if (weekday === 0 && nameTape(roots[i], true).done) continue;
      out.push({ iso, dte: e.dte, weekday, label: dayLabel(iso, weekday), root: roots[i] });
    }
  }
  out.sort((a, b) => a.iso.localeCompare(b.iso));
  return { rows: out, down: false };
}

function weekdayCount(todayIso: string, expIso: string): number {
  const n = weekdayDte(todayIso.replace(/-/g, ''), expIso.replace(/-/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** The desk's own horizons, used only when the expiration feed did not answer. */
export function fallbackListed(): ListedExpiry[] {
  const today = nyIsoDate();
  const dead = nameTape('SPY', true).done;
  return deskExpiries().flatMap(e => {
    const iso = isoDate(e.date);
    const weekday = weekdayCount(today, iso);
    if (weekday === 0 && dead) return [];
    return [{ iso, dte: e.dte, weekday, label: dayLabel(iso, weekday), root: '' }];
  });
}

/** The listed chain for this name and expiry. `root` is the option symbol when it is not the name (SPX today is SPXW). Bid and ask are that contract's NBBO. A field the feed did not send stays blank. */
export async function loadLiveChain(ticker: string, dte: number, range = 18, root?: string): Promise<DeskChain> {
  const expiry = expiryFor(dte);
  const iso = isoDate(expiry.date);
  const name = ticker.trim().toUpperCase();
  const symbol = (root || name).trim().toUpperCase();
  const span = Math.min(40, Math.max(8, range));
  const expiration = ymd(iso);
  const [got, quote] = await Promise.all([
    thetaCall(`/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&right=both&strike_range=${span}&format=json`, true),
    thetaCall(`/option/snapshot/quote?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&right=both&strike_range=${span}&format=json`, true),
  ]);
  const nbbo = new Map<string, { bid: number; ask: number; bidSize: number; askSize: number; at: number }>();
  if (!quote.error && quote.status !== 472 && quote.status !== 478) {
    for (const item of snapRows(quote.data)) {
      const k = contractKey(item.contract);
      if (!k) continue;
      const bid = numOr(item.data.bid);
      const ask = numOr(item.data.ask);
      const bidSize = numOr(item.data.bid_size);
      const askSize = numOr(item.data.ask_size);
      nbbo.set(k, {
        bid: bid == null ? NaN : bid,
        ask: ask == null ? NaN : ask,
        bidSize: bidSize == null ? NaN : Math.round(bidSize),
        askSize: askSize == null ? NaN : Math.round(askSize),
        at: stampMs(item.data.timestamp),
      });
    }
  }
  const byStrike = new Map<number, { call?: DeskContract; put?: DeskContract }>();
  let spot = 0;
  let quotedAt = 0;
  const ivs: number[] = [];
  const tYears = yearFracLeft(iso);
  const down = !!got.error || got.status === 472 || got.status === 478 || got.status === 0;
  /* ThetaData did not answer: the vendor's listed contracts (their NBBO and greeks) stand in */
  if (down) return loadUwChain(ticker, dte, range, root);
  {
    for (const item of snapRows(got.data)) {
      const strike = numOr(item.contract.strike);
      const word = String(item.contract.right || '').toLowerCase();
      const right: OptionRight | null = word.startsWith('c') ? 'C' : word.startsWith('p') ? 'P' : null;
      if (!right || strike == null || !(strike > 0)) continue;
      const under = numOr(item.data.underlying_price);
      if (under != null && under > 0) spot = under;
      const key = contractKey(item.contract);
      const book = key ? nbbo.get(key) : undefined;
      const bid = book && Number.isFinite(book.bid) ? book.bid : numOr(item.data.bid);
      const ask = book && Number.isFinite(book.ask) ? book.ask : numOr(item.data.ask);
      const bidN = bid == null ? NaN : bid;
      const askN = ask == null ? NaN : ask;
      const at = (book && book.at) || stampMs(item.data.timestamp);
      if (at > quotedAt) quotedAt = at;
      const solved = spot > 0 ? bsOnMark(spot, strike, right, bidN, askN, tYears) : null;
      const feed = (key: string) => numOr(item.data[key]);
      const feedIv = feed('implied_vol');
      const ivPct = feedIv != null && feedIv > 0 ? (feedIv < 3 ? feedIv * 100 : feedIv) : solved ? solved.iv : NaN;
      if (ivPct > 0) ivs.push(ivPct);
      const feedTheta = feed('theta');
      const feedVega = feed('vega');
      const feedRho = feed('rho');
      const feedDelta = feed('delta');
      const feedGamma = feed('gamma');
      const mark = bidN >= 0 && askN >= bidN && askN > 0 ? (bidN + askN) / 2 : NaN;
      const intrinsic = spot > 0 ? Math.max(0, right === 'C' ? spot - strike : strike - spot) : NaN;
      const breakeven = askN > 0 ? (right === 'C' ? strike + askN : strike - askN) : NaN;
      const row: DeskContract = {
        strike,
        right,
        mark: Number.isFinite(mark) ? Number(mark.toFixed(2)) : NaN,
        delta: feedDelta != null ? Number(feedDelta.toFixed(4)) : solved ? Number(solved.delta.toFixed(4)) : NaN,
        gamma: feedGamma != null ? Number(feedGamma.toFixed(4)) : solved ? Number(solved.gamma.toFixed(4)) : NaN,
        theta: feedTheta != null ? Number((feedTheta / THETA_DAYS).toFixed(4)) : solved ? Number(solved.theta.toFixed(4)) : NaN,
        vega: feedVega != null ? Number((feedVega / 100).toFixed(4)) : solved ? Number(solved.vega.toFixed(4)) : NaN,
        iv: Number.isFinite(ivPct) ? Number(ivPct.toFixed(2)) : NaN,
        itmOdds: solved ? Number(solved.itm.toFixed(2)) : NaN,
        rho: feedRho != null ? Number((feedRho / 100).toFixed(4)) : solved ? Number(solved.rho.toFixed(4)) : NaN,
        bid: bidN,
        ask: askN,
        high: NaN,
        low: NaN,
        prevClose: NaN,
        last: NaN,
        volume: NaN,
        oi: NaN,
        breakeven: Number.isFinite(breakeven) ? Number(breakeven.toFixed(2)) : NaN,
        fromSpotPct: spot > 0 ? Number((((strike - spot) / spot) * 100).toFixed(2)) : NaN,
        bidSize: book ? book.bidSize : NaN,
        askSize: book ? book.askSize : NaN,
        netChange: NaN,
        netChangePct: NaN,
        toBreakevenPct: spot > 0 && Number.isFinite(breakeven) ? Number((((breakeven - spot) / spot) * 100).toFixed(2)) : NaN,
        intrinsic: Number.isFinite(intrinsic) ? Number(intrinsic.toFixed(2)) : NaN,
        extrinsic: Number.isFinite(mark) && Number.isFinite(intrinsic) ? Number(Math.max(0, mark - intrinsic).toFixed(2)) : NaN,
        touchOdds: solved ? Number(solved.touch.toFixed(2)) : NaN,
        profitOddsLong: solved ? Number(solved.profitLong.toFixed(2)) : NaN,
        profitOddsShort: solved ? Number(solved.profitShort.toFixed(2)) : NaN,
        quotedAt: at,
      };
      const slot = byStrike.get(strike) ?? {};
      if (right === 'C') slot.call = row;
      else slot.put = row;
      byStrike.set(strike, slot);
    }
  }
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  if (!strikes.length) {
    return {
      ticker: name,
      spot,
      step: 1,
      rows: [],
      expiry,
      expectedMovePct: 0,
      source: 'live',
      quotedAt,
      expiryIso: iso,
      optRoot: symbol,
    };
  }
  const gaps = strikes.slice(1).map((k, i) => k - strikes[i]).filter(g => g > 1e-9).sort((a, b) => a - b);
  const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const blank = (strike: number, right: OptionRight): DeskContract => ({
    strike, right, mark: NaN, delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, itmOdds: NaN, rho: NaN,
    bid: NaN, ask: NaN, high: NaN, low: NaN, prevClose: NaN, last: NaN, volume: NaN, oi: NaN, breakeven: NaN,
    fromSpotPct: spot > 0 ? Number((((strike - spot) / spot) * 100).toFixed(2)) : NaN,
    bidSize: NaN, askSize: NaN, netChange: NaN, netChangePct: NaN, toBreakevenPct: NaN, intrinsic: NaN, extrinsic: NaN,
    touchOdds: NaN, profitOddsLong: NaN, profitOddsShort: NaN,
  });
  const rows = strikes.map(strike => {
    const slot = byStrike.get(strike)!;
    return { strike, call: slot.call ?? blank(strike, 'C'), put: slot.put ?? blank(strike, 'P') };
  });
  const atm = ivs.length ? ivs[Math.floor(ivs.length / 2)] : 0;
  return {
    ticker: name,
    spot,
    step,
    rows,
    expiry,
    expectedMovePct: atm > 0 ? Number((atm * Math.sqrt(Math.max(tYears, 1e-6))).toFixed(2)) : 0,
    source: 'live',
    quotedAt,
    expiryIso: iso,
    optRoot: symbol,
  };
}

/** Keep the slow fields (volume, open interest, yesterday) on a chain that just got a new quote. */
export function keepSlow(fresh: DeskChain, slow: DeskChain): DeskChain {
  if (fresh.ticker !== slow.ticker || fresh.expiryIso !== slow.expiryIso) return fresh;
  if (fresh.optRoot && slow.optRoot && fresh.optRoot !== slow.optRoot) return fresh;
  const bag = new Map<string, DeskContract>();
  for (const r of slow.rows) {
    bag.set(`${r.strike}|C`, r.call);
    bag.set(`${r.strike}|P`, r.put);
  }
  const take = (c: DeskContract): DeskContract => {
    const old = bag.get(`${c.strike}|${c.right}`);
    if (!old) return c;
    const prevClose = Number.isFinite(old.prevClose) ? old.prevClose : c.prevClose;
    const last = Number.isFinite(old.last) ? old.last : c.last;
    return {
      ...c,
      volume: Number.isFinite(old.volume) ? old.volume : c.volume,
      oi: Number.isFinite(old.oi) ? old.oi : c.oi,
      high: Number.isFinite(old.high) ? old.high : c.high,
      low: Number.isFinite(old.low) ? old.low : c.low,
      last,
      prevClose,
      priorAsk: old.priorAsk ?? c.priorAsk,
      netChange: last > 0 && prevClose > 0 ? Number((last - prevClose).toFixed(2)) : NaN,
      netChangePct: last > 0 && prevClose > 0 ? Number((((last - prevClose) / prevClose) * 100).toFixed(1)) : NaN,
    };
  };
  return { ...fresh, rows: fresh.rows.map(r => ({ strike: r.strike, call: take(r.call), put: take(r.put) })) };
}

/** A new NBBO for the chain already on screen. A down feed returns null — the last live quote stays. */
export async function refreshLiveChain(prev: DeskChain, range = 18): Promise<DeskChain | null> {
  if (prev.source !== 'live' || !prev.rows.length) return null;
  const next = await loadLiveChain(prev.ticker, prev.expiry.dte, range, prev.optRoot);
  if (next.source !== 'live' || !next.rows.length || next.expiryIso !== prev.expiryIso) return null;
  return keepSlow(next, prev);
}

/** Volume, last, high, low, and open interest. Does not move the quote. */
export async function attachSession(chain: DeskChain): Promise<DeskChain> {
  if (chain.source !== 'live' || !chain.expiryIso || !chain.rows.length) return chain;
  const symbol = (chain.optRoot || chain.ticker).trim().toUpperCase();
  const q = `symbol=${encodeURIComponent(symbol)}&expiration=${ymd(chain.expiryIso)}&format=json`;
  const [ohlc, oi] = await Promise.all([
    thetaCall(`/option/snapshot/ohlc?${q}`, true),
    thetaCall(`/option/snapshot/open_interest?${q}`, true),
  ]);
  const volumeOf = new Map<string, { volume: number; high: number; low: number; close: number }>();
  if (!ohlc.error && ohlc.status !== 472 && ohlc.status !== 478) {
    for (const item of snapRows(ohlc.data)) {
      const k = contractKey(item.contract);
      if (!k) continue;
      const volume = numOr(item.data.volume);
      const high = numOr(item.data.high);
      const low = numOr(item.data.low);
      const close = numOr(item.data.close);
      volumeOf.set(k, {
        volume: volume == null ? NaN : Math.round(volume),
        high: high != null && high > 0 ? high : NaN,
        low: low != null && low > 0 ? low : NaN,
        close: close != null && close > 0 ? close : NaN,
      });
    }
  }
  const oiOf = new Map<string, number>();
  if (!oi.error && oi.status !== 472 && oi.status !== 478) {
    for (const item of snapRows(oi.data)) {
      const k = contractKey(item.contract);
      const v = numOr(item.data.open_interest);
      if (k && v != null) oiOf.set(k, Math.round(v));
    }
  }
  const paint = (c: DeskContract): DeskContract => {
    const key = `${Number(c.strike.toFixed(4))}|${c.right}`;
    const session = volumeOf.get(key);
    const last = session && Number.isFinite(session.close) ? session.close : c.last;
    const prevClose = c.prevClose;
    return {
      ...c,
      high: session?.high ?? c.high,
      low: session?.low ?? c.low,
      last,
      volume: session && Number.isFinite(session.volume) ? session.volume : c.volume,
      oi: oiOf.has(key) ? oiOf.get(key)! : c.oi,
      netChange: last > 0 && prevClose > 0 ? Number((last - prevClose).toFixed(2)) : c.netChange,
      netChangePct: last > 0 && prevClose > 0 ? Number((((last - prevClose) / prevClose) * 100).toFixed(1)) : c.netChangePct,
    };
  };
  return { ...chain, rows: chain.rows.map(r => ({ strike: r.strike, call: paint(r.call), put: paint(r.put) })) };
}

/** Yesterday's close. Does not wait on the 30-minute ask, and does not carry last or volume — those stay with the session. */
export async function attachHistory(chain: DeskChain): Promise<DeskChain> {
  if (chain.source !== 'live' || !chain.rows.length || !chain.expiryIso) return chain;
  const symbol = (chain.optRoot || chain.ticker).trim().toUpperCase();
  const closes = await eodCloses(symbol, ymd(chain.expiryIso));
  const paint = (c: DeskContract): DeskContract => {
    const prev = closes.get(`${Number(c.strike.toFixed(4))}|${c.right}`);
    const prevClose = prev != null && prev > 0 ? prev : NaN;
    return { ...c, volume: NaN, oi: NaN, high: NaN, low: NaN, last: NaN, prevClose, netChange: NaN, netChangePct: NaN };
  };
  return { ...chain, rows: chain.rows.map(r => ({ strike: r.strike, call: paint(r.call), put: paint(r.put) })) };
}

/** The ask from 30 minutes ago. Book B only. A late answer cannot wipe the quote, the session, or yesterday. */
export async function attachPrior(chain: DeskChain): Promise<DeskChain> {
  if (chain.source !== 'live' || !chain.rows.length || !chain.expiryIso) return chain;
  const symbol = (chain.optRoot || chain.ticker).trim().toUpperCase();
  const priors = await priorAsks(symbol, ymd(chain.expiryIso));
  const paint = (c: DeskContract): DeskContract => {
    const prior = priors.get(`${Number(c.strike.toFixed(4))}|${c.right}`);
    return {
      ...c,
      volume: NaN,
      oi: NaN,
      high: NaN,
      low: NaN,
      last: NaN,
      prevClose: NaN,
      netChange: NaN,
      netChangePct: NaN,
      priorAsk: prior != null && prior > 0 ? prior : undefined,
    };
  };
  return { ...chain, rows: chain.rows.map(r => ({ strike: r.strike, call: paint(r.call), put: paint(r.put) })) };
}

export function blankChain(ticker: string, dte: number): DeskChain {
  const expiry = expiryFor(dte);
  return { ticker, spot: 0, step: 1, rows: [], expiry, expectedMovePct: 0, source: 'simulated', quotedAt: 0, expiryIso: isoDate(expiry.date) };
}

/** The Weigher's name lists: the session's movers and the busiest option tapes */
export type ScanPreset = 'gainers' | 'losers' | 'voliv';

export interface ScanRow {
  ticker: string;
  last: number;
  changePct: number;
  /** Contracts traded today across the name's chain */
  optVolume: number;
  ivPct: number;
}

/** Whether New York is trading right now — 9:30 to 16:00 ET on a weekday.
    Everything else is the overnight session. */
export function marketSession(): 'open' | 'overnight' {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(x => x.type === t)?.value ?? '';
  const mins = (Number(get('hour')) % 24) * 60 + Number(get('minute'));
  const weekday = !['Sat', 'Sun'].includes(get('weekday'));
  return weekday && mins >= 570 && mins < 960 ? 'open' : 'overnight';
}

