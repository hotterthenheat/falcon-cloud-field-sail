/* Option prices from Unusual Whales' listed contracts: each contract's NBBO, last print, open interest, volume and
   the vendor's greeks, for the readers that mark contracts on Unusual Whales. The Weigher's chain is ThetaData's
   (data/weigherDesk.ts) and never reads this. */

import { useEffect, useSyncExternalStore } from 'react';
import { expiryFor, isoDate, isTradingDay, today as nyToday, MONTHS } from '../core/calendar';
import { nyIsoDate, nyMinutes } from '../core/nyTime';
import { ensureQuote, peekQuote } from './liveQuote';
import { ensureBook } from './book/load';
import { peekSpot } from './book/day';
import { uwCall, whalesOptionContractsPaged, type UwContract } from './whales';
import { atmIvAt, expectedMovePctOf, readContract } from './weigherGate';
import { weekdayDte } from './compassParams';
import type { DeskChain, DeskContract, ListedExpiry } from './weigherDesk';
import type { OptionRight } from '../types/compass';

const INDEX = new Set(['SPX', 'NDX', 'RUT', 'VIX', 'XSP']);
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };

interface ContractMark {
  bid: number;
  ask: number;
  /** The NBBO mid when the quote is two-sided, else the last print */
  mark: number;
  /** Which price `mark` is */
  from: 'mid' | 'last';
  last: number;
  iv: number;
  delta: number;
  gamma: number;
  /** Per calendar day */
  theta: number;
  vega: number;
  oi: number;
  volume: number;
  /** When this read landed, epoch ms */
  at: number;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : NaN;
};

/** "SPY261030C00770000" → root, expiry ISO, right, strike */
function parseOcc(symbol: string): { root: string; expiry: string; right: OptionRight; strike: number } | null {
  const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol.trim().toUpperCase());
  if (!m) return null;
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, right: m[5] as OptionRight, strike: Number(m[6]) / 1000 };
}

/** The underlying's price now: the regular-session price for a stock, the vendor book's spot for an index. */
export function liveSpotOf(ticker: string): number | null {
  const t = ticker.trim().toUpperCase();
  const name = t === 'SPXW' || t === 'XSP' ? 'SPX' : t === 'NDXP' ? 'NDX' : t === 'RUTW' ? 'RUT' : t;
  if (INDEX.has(name)) {
    ensureBook(name);
    return peekSpot(name);
  }
  ensureQuote(name);
  const q = peekQuote(name);
  if (q) {
    const px = q.phase !== 'regular' && q.extPrice != null && q.extPrice > 0 ? q.extPrice : q.spot;
    if (px > 0) return px;
  }
  return peekSpot(name);
}

/* ---- the marks cache: one read per name and expiry, refreshed on the market's own clock ---- */
interface Sheet {
  at: number;
  rows: Map<string, ContractMark>;
}
const sheets = new Map<string, Sheet>();
const inflight = new Map<string, Promise<Sheet | null>>();
const listeners = new Set<() => void>();
let rev = 0;
const emit = () => {
  rev += 1;
  listeners.forEach(fn => fn());
};
const sheetKey = (ticker: string, expiry: string) => `${ticker.toUpperCase()}|${expiry}`;
const markKey = (strike: number, right: OptionRight) => `${Number(strike.toFixed(3))}|${right}`;

/** In the session a sheet is re-read every 20s; outside it every 10 minutes (the quotes do not move). */
function sheetTtl(): number {
  if (!isTradingDay(nyToday())) return 10 * 60_000;
  const m = nyMinutes();
  return m >= 570 && m < 975 ? 20_000 : 10 * 60_000;
}

function markOf(c: UwContract, at: number): ContractMark {
  const bid = num(c.nbbo_bid);
  const ask = num(c.nbbo_ask);
  const last = num(c.last_price);
  const twoSided = bid >= 0 && ask > 0 && ask >= bid;
  const raw = c as Record<string, unknown>;
  return {
    bid: twoSided ? bid : NaN,
    ask: twoSided ? ask : NaN,
    mark: twoSided ? (bid + ask) / 2 : last > 0 ? last : NaN,
    from: twoSided ? 'mid' : 'last',
    last,
    iv: num(c.implied_volatility),
    delta: num(raw.delta),
    gamma: num(c.gamma),
    theta: num(raw.theta),
    vega: num(c.vega),
    oi: num(c.open_interest),
    volume: num(c.volume),
    at,
  };
}

async function readSheet(ticker: string, expiry: string): Promise<Sheet | null> {
  const name = ticker.toUpperCase();
  const rows = await whalesOptionContractsPaged(name, expiry, false, 8);
  if (!rows) return null;
  const at = Date.now();
  const out = new Map<string, ContractMark>();
  for (const c of rows) {
    const id = parseOcc(String(c.option_symbol ?? ''));
    if (!id || id.expiry !== expiry) continue;
    out.set(`${id.root}|${markKey(id.strike, id.right)}`, markOf(c, at));
  }
  return { at, rows: out };
}

/** Ask for a name's expiry sheet; a fresh one is kept. */
export function ensureMarks(ticker: string, expiry: string): Promise<Sheet | null> {
  const key = sheetKey(ticker, expiry);
  const hit = sheets.get(key);
  if (hit && Date.now() - hit.at < sheetTtl()) return Promise.resolve(hit);
  const running = inflight.get(key);
  if (running) return running;
  const p = readSheet(ticker, expiry)
    .then(sheet => {
      if (sheet) {
        sheets.set(key, sheet);
        emit();
      }
      return sheet ?? hit ?? null;
    })
    .catch(() => hit ?? null)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** One contract's last read, or null until its sheet lands. The weekly root is tried first for an index. */
export function peekMark(ticker: string, expiry: string, strike: number, right: OptionRight): ContractMark | null {
  const name = ticker.toUpperCase();
  const sheet = sheets.get(sheetKey(name, expiry));
  if (!sheet) return null;
  const roots = WEEKLY_ROOT[name] ? [WEEKLY_ROOT[name], name] : [name];
  for (const root of roots) {
    const m = sheet.rows.get(`${root}|${markKey(strike, right)}`);
    if (m) return m;
  }
  return null;
}

export function subscribeMarks(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Re-renders when any sheet lands; asks for the sheets named while mounted. */
export function useMarks(wanted: readonly { ticker: string; expiry: string }[]): number {
  const key = [...new Set(wanted.map(w => sheetKey(w.ticker, w.expiry)))].sort().join(',');
  useEffect(() => {
    if (!key) return;
    const list = key.split(',').map(k => k.split('|') as [string, string]);
    const pull = () => list.forEach(([t, e]) => void ensureMarks(t, e));
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => window.clearInterval(id);
  }, [key]);
  return useSyncExternalStore(subscribeMarks, () => rev, () => rev);
}

/* ---- the listed expiries and one expiry's chain ---- */

/** The expiries the vendor lists for a name (with open interest or volume), nearest first. */
export async function listUwExpiries(ticker: string): Promise<ListedExpiry[] | null> {
  const name = ticker.toUpperCase();
  const got = await uwCall(`/stock/${encodeURIComponent(name)}/option/volume-oi-expiry`);
  if (got.error || !Array.isArray(got.data)) return null;
  const todayIso = nyIsoDate();
  const dteOf = new Map<string, number>();
  for (let d = 0; d <= 240; d++) {
    const iso = isoDate(expiryFor(d).date);
    if (!dteOf.has(iso)) dteOf.set(iso, d);
  }
  const out: ListedExpiry[] = [];
  for (const row of got.data as { expires?: string }[]) {
    const iso = String(row.expires ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || iso < todayIso) continue;
    const dte = dteOf.get(iso);
    if (dte == null) continue;
    const e = expiryFor(dte);
    const weekday = Math.max(0, weekdayDte(todayIso.replace(/-/g, ''), iso.replace(/-/g, '')) || 0);
    const label = weekday === 0 ? '0 DTE' : `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))} · ${weekday} DTE`;
    out.push({ iso, dte: e.dte, weekday, label, root: WEEKLY_ROOT[name] ?? name });
  }
  out.sort((a, b) => a.iso.localeCompare(b.iso));
  return out;
}

const listed = new Map<string, { at: number; rows: ListedExpiry[] }>();
const listing = new Set<string>();
/** The listed expiries in hand for a name (asked for when missing or an hour old), or null until they land */
export function listedOf(ticker: string): ListedExpiry[] | null {
  const name = ticker.toUpperCase();
  const hit = listed.get(name);
  if ((!hit || Date.now() - hit.at > 60 * 60_000) && !listing.has(name)) {
    listing.add(name);
    void listUwExpiries(name)
      .then(rows => {
        if (rows) {
          listed.set(name, { at: Date.now(), rows });
          emit();
        }
      })
      .finally(() => listing.delete(name));
  }
  return hit?.rows ?? null;
}

const blankContract = (strike: number, right: OptionRight, spot: number): DeskContract => ({
  strike, right, mark: NaN, delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, itmOdds: NaN, rho: NaN,
  bid: NaN, ask: NaN, high: NaN, low: NaN, prevClose: NaN, last: NaN, volume: NaN, oi: NaN, breakeven: NaN,
  fromSpotPct: spot > 0 ? Number((((strike - spot) / spot) * 100).toFixed(2)) : NaN,
  bidSize: NaN, askSize: NaN, netChange: NaN, netChangePct: NaN, toBreakevenPct: NaN, intrinsic: NaN, extrinsic: NaN,
  touchOdds: NaN, profitOddsLong: NaN, profitOddsShort: NaN,
});

const fixed = (v: number, d: number) => (Number.isFinite(v) ? Number(v.toFixed(d)) : NaN);

/** The chain from the sheet already in hand (empty until it lands), centred on `centre` or spot. */
export function sheetChain(ticker: string, iso: string, range = 18, root?: string, centre?: number): DeskChain {
  const name = ticker.trim().toUpperCase();
  let dte = 0;
  for (let d = 0; d <= 240; d++) {
    if (isoDate(expiryFor(d).date) === iso) {
      dte = d;
      break;
    }
  }
  const expiry = expiryFor(dte);
  const want = (root || WEEKLY_ROOT[name] || name).toUpperCase();
  const sheet = sheets.get(sheetKey(name, iso));
  const spot = liveSpotOf(name) ?? 0;
  const now = Date.now();
  const byStrike = new Map<number, { call?: DeskContract; put?: DeskContract }>();
  let quotedAt = 0;
  for (const [k, m] of sheet?.rows ?? []) {
    const [r, strikeText, right] = k.split('|');
    if (r !== want) continue;
    const strike = Number(strikeText);
    const side = right as OptionRight;
    /* every model number in the row off one vol on one clock: the vendor's calendar-year IV moved onto the trading
       clock, else the mid's own (data/weigherGate readContract); the vendor's own greeks are on its clock and not shown */
    const solved = spot > 0 ? readContract({ ticker: name, root: r, spot, strike, right: side, bid: m.bid, ask: m.ask, expiryIso: iso, vendorIv: m.iv, ivAt: m.at, now }) : null;
    const ivPct = solved ? solved.iv : NaN;
    quotedAt = Math.max(quotedAt, m.at);
    const intrinsic = spot > 0 ? Math.max(0, side === 'C' ? spot - strike : strike - spot) : NaN;
    const breakeven = m.ask > 0 ? (side === 'C' ? strike + m.ask : strike - m.ask) : NaN;
    const row: DeskContract = {
      ...blankContract(strike, side, spot),
      mark: fixed(m.mark, 2),
      delta: solved ? fixed(solved.delta, 4) : Number.isFinite(m.delta) ? fixed(m.delta, 4) : NaN,
      gamma: solved ? fixed(solved.gamma, 4) : Number.isFinite(m.gamma) ? fixed(m.gamma, 4) : NaN,
      /* per trading session, the Weigher's theta (core/greeks thetaPerSession) */
      theta: solved ? fixed(solved.theta, 4) : NaN,
      thetaHour: solved ? fixed(solved.thetaHour, 4) : NaN,
      vega: solved ? fixed(solved.vega, 4) : NaN,
      iv: fixed(ivPct, 2),
      ivFrom: solved?.ivFrom,
      europeanApprox: solved?.europeanApprox,
      itmOdds: solved ? fixed(solved.itm, 2) : NaN,
      rho: solved ? fixed(solved.rho, 4) : NaN,
      bid: m.bid,
      ask: m.ask,
      last: m.last,
      volume: m.volume,
      oi: m.oi,
      breakeven: fixed(breakeven, 2),
      toBreakevenPct: spot > 0 && Number.isFinite(breakeven) ? fixed(((breakeven - spot) / spot) * 100, 2) : NaN,
      intrinsic: fixed(intrinsic, 2),
      extrinsic: Number.isFinite(m.mark) && Number.isFinite(intrinsic) ? fixed(Math.max(0, m.mark - intrinsic), 2) : NaN,
      touchOdds: solved ? fixed(solved.touch, 2) : NaN,
      profitOddsLong: solved ? fixed(solved.profitLong, 2) : NaN,
      profitOddsShort: solved ? fixed(solved.profitShort, 2) : NaN,
      quotedAt: m.at,
    };
    const slot = byStrike.get(strike) ?? {};
    if (side === 'C') slot.call = row;
    else slot.put = row;
    byStrike.set(strike, slot);
  }
  let strikes = [...byStrike.keys()].sort((a, b) => a - b);
  const mid = centre != null && centre > 0 ? centre : spot;
  if (mid > 0 && strikes.length > range * 2 + 1) {
    const at = strikes.reduce((best, k, i) => (Math.abs(k - mid) < Math.abs(strikes[best] - mid) ? i : best), 0);
    strikes = strikes.slice(Math.max(0, at - range), at + range + 1);
  }
  const gaps = strikes.slice(1).map((k, i) => k - strikes[i]).filter(g => g > 1e-9).sort((a, b) => a - b);
  const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const rows = strikes.map(strike => {
    const slot = byStrike.get(strike)!;
    return { strike, call: slot.call ?? blankContract(strike, 'C', spot), put: slot.put ?? blankContract(strike, 'P', spot) };
  });
  /* ATM IV at spot from the strikes around it, then S·σ·√T on the expiry's calendar clock */
  const atm = atmIvAt(rows, spot);
  return {
    ticker: name,
    spot,
    step,
    rows,
    expiry,
    atmIv: atm > 0 ? fixed(atm, 2) : 0,
    expectedMovePct: fixed(expectedMovePctOf(spot, atm, iso, now, quotedAt), 2),
    source: 'live',
    quotedAt,
    expiryIso: iso,
    optRoot: want,
  };
}
