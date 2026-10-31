/* Option prices from Unusual Whales' listed contracts: each contract's NBBO, last print, open interest, volume and
   the vendor's greeks, for the readers that mark contracts on Unusual Whales. The Weigher's chain is ThetaData's
   (data/weigherDesk.ts) and never reads this. */

import { expiryFor, isoDate, isTradingDay, today as nyToday, MONTHS } from '../core/calendar';
import { nyIsoDate, nyMinutes } from '../core/nyTime';
import { ensureQuote, peekQuote } from './liveQuote';
import { ensureBook } from './book/load';
import { peekSpot } from './book/day';
import { uwCall, whalesOptionContractsPaged, type UwContract } from './whales';
import { weekdayDte } from './compassParams';
import type { ListedExpiry } from './weigherDesk';
import type { OptionRight } from '../types/compass';

import { isCashIndex } from './symbolDirectory';
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
  if (isCashIndex(name)) {
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


