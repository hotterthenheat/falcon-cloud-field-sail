/*
  Institutions, shorts, ETFs, the stock screen and the day's option tide.
  The browser asks /api/uw. Rows stay empty until the vendor answers.
  Nothing here is filled from the house generator.
*/

import { useEffect, useState, useSyncExternalStore } from 'react';
import { houseSector, houseSlug, type EtfHolding, type EtfKind, type EtfRow, type InstitutionRow, type PositionStatus, type ShortRow } from './fileBooks';
import { pickFromLive, type StockPick } from './stocks';
import { UNIVERSE, type Sector } from './universe';
import { nyDayOfUtcStamp, nyDaysAgo } from './nyDate';
import { companyName, hasVendorName, isListed, rememberCompanyName, subscribeCompanyNames } from './tickers';
import { screenerNeedsCloses, screenerRead } from './liveQuote';
import { loadRegularCloses } from './dayChange';
import {
  whalesEtfFlow,
  whalesEtfHoldings,
  whalesEtfInfo,
  whalesHoldings,
  whalesInstitutions,
  whalesScreener,
  whalesStock,
  whalesTide,
  uwCall,
  type UwEtfFlow,
  type UwEtfHolding,
  type UwEtfInfo,
  type UwHolding,
  type UwInstitution,
  type UwShort,
  type UwTide,
} from './whales';

export type FileStatus = 'loading' | 'live' | 'error';

export interface TidePrint {
  call: number;
  put: number;
  net: number;
  volume: number;
}

export interface StockCard {
  ticker: string;
  name: string;
  sector: string;
  description: string;
  marketCap: number | null;
  beta: number | null;
  avgVolume: number | null;
  nextEarnings: string | null;
  hasDividend: boolean | null;
  outstanding: number | null;
  /** The vendor's issue type ("Common Stock", "ETF") */
  issueType: string | null;
}

const ETF_LIST: { etf: string; kind: EtfKind }[] = [
  { etf: 'SPY', kind: 'broad' },
  { etf: 'QQQ', kind: 'broad' },
  { etf: 'IWM', kind: 'broad' },
  { etf: 'DIA', kind: 'broad' },
  { etf: 'XLK', kind: 'sector' },
  { etf: 'XLF', kind: 'sector' },
  { etf: 'XLE', kind: 'sector' },
  { etf: 'XLV', kind: 'sector' },
  { etf: 'XLY', kind: 'sector' },
  { etf: 'XLP', kind: 'sector' },
  { etf: 'XLI', kind: 'sector' },
  { etf: 'XLB', kind: 'sector' },
  { etf: 'XLU', kind: 'sector' },
  { etf: 'XLRE', kind: 'sector' },
  { etf: 'SMH', kind: 'sector' },
  { etf: 'TLT', kind: 'rates' },
  /* a high-yield corporate bond fund is credit, not rates; a gold trust holds bullion, not an index (the data audit) */
  { etf: 'HYG', kind: 'credit' },
  { etf: 'GLD', kind: 'commodity' },
];

const SECTORS = new Set<string>([
  'Technology',
  'Communication',
  'Consumer Discretionary',
  'Financials',
  'Energy',
  'Health Care',
  'Industrials',
  'Consumer Staples',
  'Utilities',
  'Materials',
]);

interface Snap {
  instStatus: FileStatus;
  institutions: InstitutionRow[];
  /** Houses read so far of those asked, while the book is still landing; null once whole */
  instProgress: { done: number; total: number } | null;
  /** True while the book holds its first houses only, the rest waiting for the reader to want them (round 8) */
  instHeld: boolean;
  shortStatus: FileStatus;
  shorts: ShortRow[];
  etfStatus: FileStatus;
  etfs: EtfRow[];
  holdings: Record<string, EtfHolding[]>;
  /** Each fund's file as read: the lines on it, and the fund's own count of holdings */
  holdingsCover: Record<string, { lines: number; weight: number; fundCount: number | null }>;
  /** Each house's whole 13F value as Unusual Whales totals it, dollars — the grid shows the top lines only */
  houseTotals: Record<string, number>;
  /** Each house's whole-13F call and put values, dollars, as Unusual Whales totals them (call_value, put_value) */
  houseOptions: Record<string, { calls: number; puts: number }>;
  stockStatus: FileStatus;
  stocks: StockPick[];
  tide: TidePrint | null;
  cards: Record<string, StockCard | null>;
}

const empty: Snap = {
  instStatus: 'loading',
  instProgress: null,
  instHeld: false,
  institutions: [],
  shortStatus: 'loading',
  shorts: [],
  etfStatus: 'loading',
  etfs: [],
  holdings: {},
  holdingsCover: {},
  houseTotals: {},
  houseOptions: {},
  stockStatus: 'loading',
  stocks: [],
  tide: null,
  cards: {},
};

let snap: Snap = empty;
const listeners = new Set<() => void>();

const emit = (next: Partial<Snap>) => {
  snap = { ...snap, ...next };
  listeners.forEach(fn => fn());
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOr = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** A vendor fraction (0.04) is a percent. A number already above 1.5 is left alone. */
/** perc_of_share_value and perc_of_total are fractions (BlackRock's $45.8B line: 0.0068 of its book) — read as such */
const asPct = (v: unknown): number => num(v) * 100;
/* a filing day is a New York calendar day, counted in calendar days (data/nyDate.ts) — never UTC midnight rounded */
const daysAgo = (iso?: string): number => nyDaysAgo(iso, 999);
const quarterOf = (iso?: string): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
};
const sectorOf = (ticker: string, raw?: string): string => {
  const known = UNIVERSE.find(u => u.ticker === ticker)?.sector;
  if (known) return known;
  if (raw && SECTORS.has(raw)) return raw;
  return raw && raw.trim() ? houseSector(raw) : '—';
};
const asSector = (ticker: string, raw?: string): Sector => {
  const s = sectorOf(ticker, raw);
  return (SECTORS.has(s) ? s : UNIVERSE.find(u => u.ticker === ticker)?.sector ?? 'Technology') as Sector;
};

const bookOf = (h: UwHolding): InstitutionRow['book'] => {
  const pc = (h.put_call || '').toLowerCase();
  const st = (h.security_type || '').toLowerCase();
  if (pc.startsWith('c') || st.includes('call')) return 'calls';
  if (pc.startsWith('p') || st.includes('put')) return 'puts';
  return 'stock';
};

const statusOf = (units: number, change: number): PositionStatus => {
  const prior = units - change;
  if (prior <= 0 && units > 0) return 'new';
  if (units <= 0 && prior > 0) return 'closed';
  const pct = prior > 0 ? (change / prior) * 100 : 0;
  if (pct >= 2) return 'added';
  if (pct <= -2) return 'cut';
  return 'held';
};

const quartersOf = (h: UwHolding, sharesM: number, report: string): InstitutionRow['quarters'] => {
  const raw = h.historical_units;
  if (Array.isArray(raw) && raw.length) {
    const rows = raw
      .map(item => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const units = numOr(o.units ?? o.close ?? o.value);
          const period = typeof o.date === 'string' ? quarterOf(o.date) : typeof o.period === 'string' ? o.period : '';
          return units == null ? null : { period: period || report, unitsM: units / 1e6 };
        }
        return null;
      })
      .filter((x): x is { period: string; unitsM: number } => !!x);
    if (rows.length) return rows.slice(-8);
    /* A bare list of unit counts, NEWEST FIRST (the vendor's historical_units: [this filing, the quarter before, …]).
       Each one was stamped with this filing's quarter, so eight quarters collapsed into one row and the sentence read
       "1009.8M then, 945.7M now" — backwards. Each count now gets its own quarter, oldest to newest. */
    const counts = raw.map(numOr).filter((n): n is number => n != null);
    const base = Date.parse(h.date ?? '');
    if (counts.length && Number.isFinite(base)) {
      const d0 = new Date(base);
      return counts
        .slice(0, 8)
        .map((units, i) => {
          const d = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() - 3 * i, 15));
          return { period: quarterOf(d.toISOString()), unitsM: units / 1e6 };
        })
        .reverse();
    }
  }
  return [{ period: report, unitsM: sharesM }];
};

function rowFromHolding(house: string, filed: string, h: UwHolding): InstitutionRow | null {
  /* A LINE WITH NO SYMBOL IS KEPT (the fourth audit, 2026-10-23): AMD's options lines filed as "00002488" and BlackRock's
     $45.8B "9666655D" were dropped, so the page read 3,194 lines against the vendor's 3,200 and "79 largest" against 80.
     Such a line is kept under the vendor's own identifier, named by the filing's issuer name when it gives one, and marked
     unlisted — it opens no stock page and draws no logo. */
  const raw = (h.ticker || '').trim().toUpperCase();
  if (!raw) return null;
  const unlisted = !/^[A-Z][A-Z0-9.]{0,5}$/.test(raw);
  const ticker = raw;
  const units = num(h.units);
  const change = num(h.units_change);
  const sharesM = units / 1e6;
  const prior = Math.max(0, units - change) / 1e6;
  const valueB = num(h.value) / 1e9;
  const changePct = prior > 0 ? ((sharesM - prior) / prior) * 100 : sharesM > 0 ? 100 : 0;
  const report = quarterOf(h.date);
  const book = bookOf(h);
  const sec = typeof h.security_type === 'string' ? h.security_type.trim() : '';
  const security = sec && !/^share/i.test(sec) ? sec : undefined;
  /* A FIRST BUY THE FILING ITSELF CONTRADICTS IS NOT SHOWN (audit round 7: BlackRock's NVDA read "First buy 2026-06-30 ·
     First price $15.14 · Avg price $15.14" — the house's change of CIK reset the vendor's history, while the same row's
     eight quarters of units show it held NVDA all along, and NVDA's price on 06/30 was $200.09, the filing's own value
     over units). A share line whose first buy is the filing's own quarter must have its first and average price at the
     filing's price; when it does not, or when earlier quarters hold units, the first buy, its price and the average are
     the vendor's artifact and read "—". */
  const filingPrice = book === 'stock' && units > 0 ? num(h.value) / units : 0;
  const counts = Array.isArray(h.historical_units) ? (h.historical_units as unknown[]).map(numOr).filter((n): n is number => n != null) : [];
  const heldBefore = counts.slice(1).some(n => n > 0);
  const firstIsThisQuarter = !!h.first_buy && !!h.date && quarterOf(h.first_buy) === quarterOf(h.date);
  const near = (p: number) => filingPrice > 0 && p > 0 && Math.abs(p - filingPrice) / filingPrice <= 0.25;
  const firstUntrusted = book === 'stock' && firstIsThisQuarter && (heldBefore || !near(num(h.price_first_buy)));
  const avgUntrusted = firstUntrusted && !near(num(h.avg_price));
  return {
    /* the security type is part of the key: CAPITAL WORLD filed GOOGL as shares AND as "Pref" — two lines, one id */
    id: `${house}-${ticker}-${book}${security ? `-${security}` : ''}`,
    security,
    name: house,
    ticker,
    sector: sectorOf(ticker, h.sector),
    sharesM,
    priorSharesM: prior,
    valueB,
    changePct,
    pctOfBook: asPct(h.perc_of_share_value),
    pctOfShares: asPct(h.perc_of_total),
    avgPrice: avgUntrusted ? 0 : num(h.avg_price),
    close: num(h.close),
    firstPrice: firstUntrusted ? 0 : num(h.price_first_buy),
    unitsChangeM: change / 1e6,
    firstBuy: firstUntrusted ? '—' : h.first_buy || '—',
    sharesOutM: num(h.shares_outstanding) / 1e6,
    book,
    status: statusOf(units, change),
    report,
    filedDaysAgo: daysAgo(filed),
    company: typeof h.full_name === 'string' && h.full_name.trim() ? titleName(h.full_name) : unlisted ? `No symbol on the filing · vendor id ${raw}` : undefined,
    unlisted: unlisted || undefined,
    quarters: quartersOf(h, sharesM, report),
  };
}

/** Run `job` over `items`, `size` at a time, calling `after` once each batch has landed */
async function inBatches<T>(items: readonly T[], size: number, job: (item: T) => Promise<void>, after?: () => void): Promise<void> {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(it => job(it).catch(() => undefined)));
    after?.();
  }
}

/** The lines read per house — the largest by value; the house's whole book is far longer */
export const HOUSE_LINES = 80;

/** The houses' own totals off the list rows: the whole 13F, and its calls and puts */
function houseFacts(list: readonly UwInstitution[]): Pick<Snap, 'houseTotals' | 'houseOptions'> {
  const totals: Record<string, number> = { ...snap.houseTotals };
  const options: Record<string, { calls: number; puts: number }> = { ...snap.houseOptions };
  for (const h of list) {
    const name = (h.name || h.short_name || '').trim();
    if (!name) continue;
    const v = num(h.total_value);
    if (v > 0) totals[name] = v;
    const raw = h as unknown as { call_value?: unknown; put_value?: unknown };
    options[name] = { calls: num(raw.call_value), puts: num(raw.put_value) };
  }
  return { houseTotals: totals, houseOptions: options };
}

/* ONE HOUSE'S PAGE READS ONE HOUSE (audit round 7: opening BlackRock read all 40 houses' holdings, 46 calls). The house
   list (one call — it maps the page's address to the house and its CIK, and carries its totals) and that house's own
   lines; the whole book is read only by the Institutions page. */
const houseList: { p: Promise<UwInstitution[]> | null } = { p: null };
const houseRead = new Map<string, { status: FileStatus; rows: InstitutionRow[]; name: string | null }>();
function listHouses(): Promise<UwInstitution[]> {
  houseList.p ??= whalesInstitutions(40)
    .then(rows => (Array.isArray(rows) ? (rows as UwInstitution[]) : []))
    .catch(() => {
      houseList.p = null;
      return [] as UwInstitution[];
    });
  return houseList.p;
}
function ensureHouse(slug: string): void {
  if (houseRead.has(slug) || typeof window === 'undefined') return;
  houseRead.set(slug, { status: 'loading', rows: [], name: null });
  void (async () => {
    const list = await listHouses();
    emit(houseFacts(list));
    const house = list.find(h => houseSlug((h.name || h.short_name || '').trim()) === slug);
    if (!house) {
      houseRead.set(slug, { status: list.length ? 'live' : 'error', rows: [], name: null });
      emit({});
      return;
    }
    const name = (house.name || house.short_name || '').trim();
    const filed = house.filing_date || house.date || '';
    const got = await whalesHoldings(house.cik?.trim() || name, HOUSE_LINES).catch(() => null);
    const rows: InstitutionRow[] = [];
    for (const h of Array.isArray(got) ? got : []) {
      const row = rowFromHolding(name, filed, h);
      if (row) rows.push(row);
    }
    houseRead.set(slug, { status: got ? 'live' : 'error', rows: rows.sort((a, b) => b.valueB - a.valueB), name });
    emit({});
  })();
}

/* THE NEWEST FILERS FIRST, THE REST WHEN WANTED (round 8: the Institutions index made 40 house-holdings calls on open).
   The grid opens on the newest filings, so the houses are read newest filing first: the first INST_FIRST of them, then
   the book holds until the reader goes further — scrolls to the grid's pages, picks a house, a filter or a window, or
   asks for the rest — and only then reads the other houses, ten at a time. */
export const INST_FIRST = 10;
let instMore: (() => void) | null = null;
let instWanted = false;
/** Read the houses the book is holding back */
export function wantAllHouses(): void {
  instWanted = true;
  const go = instMore;
  instMore = null;
  go?.();
}
async function pullInstitutions() {
  try {
    const houses = await listHouses();
    if (!Array.isArray(houses) || houses.length === 0) throw new Error('shape');
    const rows: InstitutionRow[] = [];
    /* ten houses at a time, the book published once whole — one by one, the head counted "6 houses · 0 calls" for the
       half-minute the rest took (the ship pass, 2026-10-22) */
    const list = [...(houses as UwInstitution[])].sort((a, b) => String(b.filing_date || b.date || '').localeCompare(String(a.filing_date || a.date || '')));
    emit(houseFacts(list));
    let done = 0;
    const readHouse = async (house: UwInstitution) => {
      done += 1;
      const name = (house.name || house.short_name || '').trim();
      if (!name) return;
      const filed = house.filing_date || house.date || '';
      /* by the filer's CIK when it has one: a few long names ("UBS AM, A DISTINCT BUSINESS UNIT OF …") 404 by name */
      const got = await whalesHoldings(house.cik?.trim() || name, HOUSE_LINES).catch(() => [] as UwHolding[]);
      for (const h of Array.isArray(got) ? got : []) {
        const row = rowFromHolding(name, filed, h);
        if (row) rows.push(row);
      }
    };
    const publish = (held: boolean) => {
      /* the rows land a batch at a time, so the grid fills in seconds; the head says how many houses are in */
      if (rows.length) emit({ instStatus: 'live', institutions: rows.slice().sort((a, b) => b.valueB - a.valueB), instProgress: done < list.length ? { done, total: list.length } : null, instHeld: held });
    };
    const first = list.slice(0, INST_FIRST);
    const rest = list.slice(INST_FIRST);
    await inBatches(first, 10, readHouse, () => publish(false));
    if (rest.length) {
      if (!instWanted) {
        publish(true);
        await new Promise<void>(res => {
          instMore = res;
        });
      }
      emit({ instHeld: false, instProgress: { done, total: list.length } });
      await inBatches(rest, 10, readHouse, () => publish(false));
    }
    if (rows.length === 0) throw new Error('no house landed');
    emit({ instStatus: 'live', institutions: rows.sort((a, b) => b.valueB - a.valueB), instProgress: null, instHeld: false });
  } catch {
    if (snap.institutions.length === 0) emit({ instStatus: 'error' });
  }
}

/** The vendor's sector words, said in the universe's ten */
const UW_SECTOR: Record<string, Sector> = {
  technology: 'Technology',
  'communication services': 'Communication',
  communication: 'Communication',
  'consumer cyclical': 'Consumer Discretionary',
  'consumer discretionary': 'Consumer Discretionary',
  'financial services': 'Financials',
  financial: 'Financials',
  financials: 'Financials',
  energy: 'Energy',
  healthcare: 'Health Care',
  'health care': 'Health Care',
  industrials: 'Industrials',
  'consumer defensive': 'Consumer Staples',
  'consumer staples': 'Consumer Staples',
  utilities: 'Utilities',
  'basic materials': 'Materials',
  materials: 'Materials',
};
const uwSector = (raw: string): Sector | null => UW_SECTOR[raw.trim().toLowerCase()] ?? null;
/** "SOUNDHOUND AI" → "Soundhound AI": the file shouts; the page does not */
const titleName = (raw: string): string =>
  raw
    .trim()
    .split(/\s+/)
    .map(w => (w.length <= 3 && /^[A-Z&.]+$/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase()))
    .join(' ');

function shortFrom(r: UwShort): ShortRow | null {
  const ticker = (r.symbol || '').toUpperCase();
  const si = num(r.si_float);
  const floatShares = num(r.total_float);
  if (!/^[A-Z][A-Z0-9.]{0,5}$/.test(ticker)) return null;
  if (!(floatShares > 1e6) || !(si > 0)) return null;
  const interestPct = si * 100;
  const shortSharesM = num(r.short_interest) / 1e6;
  const available = numOr(r.short_shares_available);
  return {
    ticker,
    sector: sectorOf(ticker),
    interestPct,
    shortSharesM,
    daysToCover: num(r.days_to_cover),
    floatM: floatShares / 1e6,
    changePct: null,
    shortVolM: null,
    shortVolRatio: null,
    ftdK: null,
    feeRate: numOr(r.fee_rate),
    rebateRate: numOr(r.rebate_rate),
    availableM: available == null ? null : available / 1e6,
    history: r.market_date ? [{ report: r.market_date, interestPct, sharesM: shortSharesM }] : [],
    exchanges: [],
    ftdDays: [],
  };
}

/* A SHORT FILE FOR ANY NAME (the retail pass, 2026-10-22). The short book lists the 80 largest short positions by
   share count, so GME, a name every squeeze reader asks for, read "That record is not on this book". The file's own
   reads — /shorts/{t}/interest-float/v2 (every settlement), /shorts/{t}/data (today's borrow), the fails to deliver,
   the short volume and the short volume by market — build the row instead, and fill what the screener row lacks. */
export function shortRowFromFile(
  ticker: string,
  base: ShortRow | null,
  reads: { si?: unknown; rebate?: unknown; ftd?: unknown; svr?: unknown; svx?: unknown },
): ShortRow | null {
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const prints = arr(reads.si).filter(r => r.market_date).sort((a, b) => String(b.market_date).localeCompare(String(a.market_date)));
  let row = base;
  if (!row && prints.length) {
    const made = shortFrom({ ...(prints[0] as UwShort), symbol: ticker });
    if (made) {
      const prior = prints[1] ? shortFrom({ ...(prints[1] as UwShort), symbol: ticker }) : null;
      row = { ...made, history: [...made.history, ...(prior?.history ?? [])] };
      const h = row.history;
      if (h.length >= 2 && h[1].sharesM > 0) row.changePct = Number((((h[0].sharesM - h[1].sharesM) / h[1].sharesM) * 100).toFixed(1));
    }
  }
  if (!row) return null;
  const out: ShortRow = { ...row };
  const borrow = arr(reads.rebate).sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')))[0];
  if (borrow) {
    out.feeRate = numOr(borrow.fee_rate) ?? out.feeRate;
    out.rebateRate = numOr(borrow.rebate_rate) ?? out.rebateRate;
    const avail = numOr(borrow.short_shares_available);
    if (avail != null) out.availableM = avail / 1e6;
  }
  const svrBox = reads.svr && typeof reads.svr === 'object' && !Array.isArray(reads.svr) ? (reads.svr as { si?: unknown }).si : reads.svr;
  const session = arr(svrBox).sort((a, b) => String(b.market_date ?? '').localeCompare(String(a.market_date ?? '')))[0];
  if (session) {
    const ratio = num(session.short_volume_ratio);
    if (ratio > 0) out.shortVolRatio = ratio <= 1.5 ? ratio * 100 : ratio;
    if (session.market_date) out.shortVolDate = String(session.market_date).slice(0, 10);
    const sv = num(session.short_volume);
    if (sv > 0) out.shortVolM = sv / 1e6;
    out.shortVolSource = 'Unusual Whales short volume and ratio (FINRA CNMS, the consolidated tape)';
  }
  const fails = arr(reads.ftd).filter(f => f.date).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (fails.length && !out.ftdDays.length) {
    out.ftdDays = fails.slice(0, 20).map(f => ({ date: String(f.date).slice(0, 10), quantity: num(f.quantity), price: num(f.price) }));
    out.ftdK = num(fails[0].quantity) / 1000;
  }
  const venues = arr(reads.svx);
  if (venues.length && !out.exchanges.length) {
    const day = venues.reduce((m, v) => (String(v.date ?? '') > m ? String(v.date ?? '') : m), '');
    if (day) out.exchangesDate = day.slice(0, 10);
    out.exchanges = venues
      .filter(v => String(v.date ?? '') === day)
      .map(v => ({ exchange: String(v.exchange_name || v.market_center || '—'), shortM: num(v.short_volume) / 1e6, totalM: num(v.total_volume) / 1e6 }));
  }
  /* THE SOURCE ON THE CARD (audit round 6: WOLF's "Short volume 55% · Oct 22" was FINRA CNMS alone — the ratio read came
     back empty and the by-market rows stood in, unsaid). When the ratio read is empty the by-market rows' latest day is
     the figure, and the card names them */
  if (out.shortVolRatio == null && out.exchanges.length) {
    const short = out.exchanges.reduce((a, v) => a + v.shortM, 0);
    const total = out.exchanges.reduce((a, v) => a + v.totalM, 0);
    if (total > 0) {
      out.shortVolRatio = (short / total) * 100;
      out.shortVolM = short;
      out.shortVolDate = out.exchangesDate;
      out.shortVolSource = `the by-market short volume (${[...new Set(out.exchanges.map(v => v.exchange))].join(', ')}) — the vendor's short volume and ratio came back empty`;
    }
  }
  return out;
}

/** The screener returns the same symbol more than once. One row per name, the later report facing, both dates kept. */
function collapseShorts(rows: ShortRow[]): ShortRow[] {
  const by = new Map<string, ShortRow>();
  const day = (r: ShortRow) => r.history[0]?.report ?? '';
  for (const r of rows) {
    const prev = by.get(r.ticker);
    if (!prev) {
      by.set(r.ticker, r);
      continue;
    }
    const face = day(r) >= day(prev) ? r : prev;
    const other = face === r ? prev : r;
    const seen = new Set(face.history.map(h => h.report));
    by.set(r.ticker, {
      ...face,
      feeRate: face.feeRate ?? other.feeRate,
      rebateRate: face.rebateRate ?? other.rebateRate,
      availableM: face.availableM ?? other.availableM,
      history: [...face.history, ...other.history.filter(h => !seen.has(h.report))],
    });
    /* two settlements on file: the change in shares short since the prior one */
    const merged = by.get(r.ticker)!;
    const prints = [...merged.history].sort((a, b) => b.report.localeCompare(a.report));
    if (prints.length >= 2 && prints[1].sharesM > 0) merged.changePct = Number((((prints[0].sharesM - prints[1].sharesM) / prints[1].sharesM) * 100).toFixed(1));
  }
  return [...by.values()].sort((a, b) => b.interestPct - a.interestPct);
}

/* THE SHORT BOOK AS A SCREEN (the data audit, 2026-10-22). It was /short_screener ordered by shares short — the
   largest 40 positions by share count — so "HYG is the heaviest short" and "28 names at 8%+" described that slice and
   GME (8.46% of its float) was not on it. It is now the screen the page names: the latest settlement's names ordered
   by short interest as a share of the float, the SHORTS_SCREEN heaviest, among floats of SHORTS_MIN_FLOAT shares or
   more (below that the vendor's ratios run past 100% on a few thousand shares), and none over 100% of the float. The
   prior settlement is read for the same names (the change since), and the stock screener names each one's sector and
   whether it is a fund. Every row is one settlement, so none carries an older figure under a newer date. */
export const SHORTS_SCREEN = 200;
export const SHORTS_MIN_FLOAT = 20_000_000;
let shortsSettlement: string | null = null;
export const shortsSettlementDay = () => shortsSettlement;

export const FUND_TYPES = /\b(?:etf|etn|fund|trust|closed[- ]end)\b/i;

async function pullShorts() {
  try {
    /* the latest settlement on file */
    const head = await uwCall('/short_screener?order_by=market_date&order_direction=desc&limit=1');
    const newest = Array.isArray(head.data) ? String((head.data as UwShort[])[0]?.market_date ?? '').slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newest)) throw new Error(head.error || 'no settlement');
    shortsSettlement = newest;
    const rows = await uwCall(`/short_screener?order_by=si_float&order_direction=desc&limit=${SHORTS_SCREEN}&min_market_date=${newest}&max_si_float=1&min_total_float=${SHORTS_MIN_FLOAT}`);
    if (rows.error || !Array.isArray(rows.data)) throw new Error(rows.error || 'shape');
    const face = (rows.data as UwShort[]).map(shortFrom).filter((r): r is ShortRow => !!r).map(r => ({ ...r, borrowAsOf: newest }));
    let out = collapseShorts(face);
    const tickers = out.map(r => r.ticker);
    /* sector and issue type, forty names a call, BEFORE the book is shown: until a name is known to be a fund or a
       stock, the head would call an ETF "the heaviest stock short" (KBE, the ship check) */
    const facts = new Map<string, Record<string, unknown>>();
    await inBatches(
      Array.from({ length: Math.ceil(tickers.length / 40) }, (_, i) => tickers.slice(i * 40, i * 40 + 40)),
      2,
      async part => {
        const got = await whalesScreener(part).catch(() => null);
        /* the same rows carry each name's full_name — kept, so the name cells do not ask the screener for the same
           ~190 names again in chunks of fifty (audit round 7: the Shorts page read the screener twice) */
        for (const r of Array.isArray(got) ? got : []) {
          const sym = String(r.ticker || '').toUpperCase();
          facts.set(sym, r);
          /* a name the screener gives is kept (it now comes back empty — the name cells ask the stock's info) */
          if (sym && r.full_name) rememberCompanyName(sym, String(r.full_name));
        }
      },
    );
    out = out.map(r => {
      const f = facts.get(r.ticker);
      if (!f) return r;
      const rawSector = typeof f.sector === 'string' ? f.sector.trim() : '';
      const fund = FUND_TYPES.test(String(f.issue_type ?? ''));
      return { ...r, sector: uwSector(rawSector) ?? (houseSector(rawSector) || (fund ? 'Fund' : r.sector)), fund };
    });
    /* ONE READ, SHOWN WHOLE (the retail test, 2026-10-23: "2 strong · 22 building", then "19 building" minutes apart on
       a Sep 30 settlement). The book was shown before the prior settlement landed, so the change-in-shares point arrived
       later for some names and not others. It is shown once the prior settlement has been read for every batch (each
       asked twice before it is given up) — the same data, the same counts, every load. */
    /* the settlement before, for the same names — the change in shares short; forty names a call (the proxy takes
       paths under 400 characters) */
    const prior = new Date(Date.parse(`${newest}T12:00:00Z`) - 25 * 86_400_000).toISOString().slice(0, 10);
    const before = new Date(Date.parse(`${newest}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const older: ShortRow[] = [];
    for (let i = 0; i < tickers.length; i += 40) {
      const path = `/short_screener?tickers=${tickers.slice(i, i + 40).map(encodeURIComponent).join(',')}&min_market_date=${prior}&max_market_date=${before}&limit=200`;
      let back = await uwCall(path).catch(() => null);
      if (!back || back.error || !Array.isArray(back.data)) back = await uwCall(path).catch(() => null);
      if (back && !back.error && Array.isArray(back.data)) older.push(...(back.data as UwShort[]).map(shortFrom).filter((r): r is ShortRow => !!r));
    }
    if (older.length) {
      /* the face row keeps its facts; the older settlement only adds history and the change */
      const merged = collapseShorts([...out, ...older]);
      const byT = new Map(out.map(r => [r.ticker, r]));
      out = merged.map(r => ({ ...r, sector: byT.get(r.ticker)?.sector ?? r.sector, fund: byT.get(r.ticker)?.fund, borrowAsOf: newest }));
    }
    out.sort((a, b) => b.interestPct - a.interestPct || a.ticker.localeCompare(b.ticker));
    emit({ shortStatus: 'live', shorts: out });
  } catch {
    if (snap.shorts.length === 0) emit({ shortStatus: 'error' });
  }
}

/* ONE WINDOW FOR EVERY FUND (audit round 5, 2026-10-23: "Five-day flow −$6.14B" summed each fund's own latest five rows —
   some funds' through 10/22, others' through 10/21 — so the total mixed windows). The five most recent dates every fund
   with flows carries are the window; each fund's flow is summed over exactly those days. */
const flow5 = (rows: UwEtfFlow[], days?: Set<string>): { flow5dM: number; flows: EtfRow['flows'] } => {
  const sorted = [...rows].filter(r => r.date && (!days || days.has(String(r.date).slice(0, 10)))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = sorted.slice(0, 5);
  const flows = last.map(r => ({ day: String(r.date).slice(5, 10).replace('-', '/'), flowM: Math.round(num(r.change_prem) / 1e6) })).reverse();
  return { flow5dM: flows.reduce((s, f) => s + f.flowM, 0), flows };
};

/* A BOND FUND'S LINES CARRY NO SYMBOL (the ship pass, 2026-10-22: TLT's 47 Treasury lines and HYG's 250 issues were
   all dropped, and the fund read "no holding on file"). They keep their name and face amount, keyed by position. */
/* an issue name in title case, with the short capitals that are names kept ("1261229 BC LTD SR SECURED 144A" →
   "1261229 BC Ltd Sr Secured 144A" — 1261229 B.C. Ltd. is a real issuer, Bausch Health's) */
const KEEP_CAPS = new Set(['BC', 'US', 'USA', 'LP', 'LLC', 'PLC', 'NV', 'SA', 'AG', 'SE', 'AB', 'ASA', 'REIT', 'II', 'III', 'IV', 'UK', 'MLP', 'CO2']);
const titleIssue = (raw: string) =>
  raw
    .trim()
    .split(/\s+/)
    .map(w => (KEEP_CAPS.has(w.toUpperCase()) || /\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
const holdingOf = (h: UwEtfHolding, i: number): EtfHolding | null => {
  const ticker = (h.ticker || '').toUpperCase();
  const weight = num(h.weight);
  if (!ticker) {
    const name = (h.name || '').trim();
    if (!name || !(weight > 0)) return null;
    return {
      ticker: `#${i + 1}`,
      bond: true,
      name: titleIssue(name),
      weight,
      sharesM: num(h.shares) / 1e6,
      sector: houseSector(h.sector) || (/treasury|t-bill|t-note/i.test(name) ? 'Treasury' : String(h.type || '').toLowerCase() === 'bond' ? 'Corporate bond' : '—'),
      /* a Treasury is the United States' own paper; any other issue keeps what the feed said */
      country: h.country_name || (/treasury|t-bill|t-note/i.test(name) ? 'United States' : 'Not stated'),
      asOf: nyDayOfUtcStamp(h.updated ? String(h.updated) : null) ?? undefined,
    };
  }
  return {
    ticker,
    weight,
    sharesM: num(h.shares) / 1e6,
    sector: houseSector(h.sector) || '—',
    country: h.country_name || 'Not stated',
    asOf: nyDayOfUtcStamp(h.updated ? String(h.updated) : null) ?? undefined,
  };
};

type FundReads = [UwEtfInfo | null, UwEtfHolding[], UwEtfFlow[]];
const readFund = (etf: string): Promise<FundReads> =>
  Promise.all([
    whalesEtfInfo(etf).catch(() => null as UwEtfInfo | null),
    whalesEtfHoldings(etf).catch(() => [] as UwEtfHolding[]),
    whalesEtfFlow(etf).catch(() => [] as UwEtfFlow[]),
  ]);
const flowDates = (flowR: unknown): Set<string> => (Array.isArray(flowR) ? new Set((flowR as UwEtfFlow[]).map(x => String(x.date || '').slice(0, 10)).filter(Boolean)) : new Set<string>());
/** One fund's row and lines off its three reads, its flow summed over `common` (the newest five dates) */
function fundRow(e: { etf: string; kind: EtfKind }, [infoR, holdR, flowR]: FundReads, common: string[]): { row: EtfRow; held: EtfHolding[] } | null {
  /* a fund none of whose three reads landed is not a $0 fund — it stays off the book */
  if (!infoR && !(Array.isArray(holdR) && holdR.length) && !(Array.isArray(flowR) && flowR.length)) return null;
  const info = infoR && !Array.isArray(infoR) ? infoR : null;
  const held = (Array.isArray(holdR) ? holdR : []).map(holdingOf).filter((h): h is EtfHolding => !!h).sort((a, b) => b.weight - a.weight);
  const top = held[0];
  const window = new Set(common);
  const flow = flow5(Array.isArray(flowR) ? flowR : [], common.length ? window : undefined);
  const equity = held.filter(h => !/bond|treasury|fixed/i.test(h.sector)).reduce((s, h) => s + h.weight, 0);
  const row: EtfRow = {
    etf: e.etf,
    name: info?.name || e.etf,
    kind: e.kind,
    aumB: num(info?.aum) / 1e9,
    flow5dM: flow.flow5dM,
    topHolding: top ? (top.bond ? (top.name ?? '—') : top.ticker) : '—',
    topWeight: top?.weight ?? 0,
    equityPct: held.length ? Math.min(100, Math.round(equity)) : e.kind === 'rates' ? 0 : 0,
    expensePct: numOr(info?.expense_ratio),
    company: info?.etf_company || '—',
    domicile: info?.domicile || '—',
    /* the fund's own count; a dash-free 0 for a trust that holds no securities (GLD holds bullion) */
    holdingsCount: info?.holdings_count != null ? num(info.holdings_count) : held.length,
    inception: info?.inception_date || '—',
    hasOptions: !!info?.has_options,
    avgVolM: num(info?.avg30_volume) / 1e6,
    callVol: numOr(info?.call_vol),
    putVol: numOr(info?.put_vol),
    flows: flow.flows,
    flowFrom: common.length ? common[common.length - 1] : null,
    flowTo: common.length ? common[0] : null,
    flowDays: common.length,
    holdingsAsOf: held.reduce<string | null>((m, h) => (h.asOf && (!m || h.asOf > m) ? h.asOf : m), null),
  };
  return { row, held };
}
async function pullEtfs() {
  try {
    const rows: EtfRow[] = [];
    const holdings: Record<string, EtfHolding[]> = {};
    /* every fund asked at once — one by one, the head read "6 funds" for the half-minute the rest took to land */
    const reads = await Promise.all(ETF_LIST.map(e => readFund(e.etf)));
    const dateSets = reads.map(r => flowDates(r[2])).filter(d => d.size > 0);
    const common = dateSets.length ? [...dateSets[0]].filter(d => dateSets.every(set => set.has(d))).sort().reverse().slice(0, 5) : [];
    for (let k = 0; k < ETF_LIST.length; k++) {
      const got = fundRow(ETF_LIST[k], reads[k], common);
      if (!got) continue;
      holdings[ETF_LIST[k].etf] = got.held;
      rows.push(got.row);
    }
    if (rows.length === 0) throw new Error('no fund landed');
    /* what each fund's file covers: the lines read (the route sends the largest 250), their weight, the fund's own count */
    const holdingsCover: Snap['holdingsCover'] = {};
    for (const r of rows) {
      const held = holdings[r.etf] ?? [];
      holdingsCover[r.etf] = { lines: held.length, weight: held.reduce((a, h) => a + h.weight, 0), fundCount: r.holdingsCount > 0 ? r.holdingsCount : null };
    }
    emit({ etfStatus: 'live', etfs: rows, holdings, holdingsCover });
  } catch {
    if (snap.etfs.length === 0) emit({ etfStatus: 'error' });
  }
}

/* ONE FUND'S PAGE READS ONE FUND (round 8: etfs/SPY read the info, the flows and the holdings of all 18 funds to draw
   one). The fund's own three reads; its five-day flow is its own five newest dates (the index's common window is for
   adding the funds up, which one fund's page does not do). */
const oneFund = new Map<string, { status: FileStatus; row: EtfRow | null; holdings: EtfHolding[]; cover: HoldingsCover | null }>();
function ensureOneFund(etf: string): void {
  if (!etf || oneFund.has(etf) || typeof window === 'undefined') return;
  oneFund.set(etf, { status: 'loading', row: null, holdings: [], cover: null });
  const e = ETF_LIST.find(x => x.etf === etf) ?? { etf, kind: 'broad' as EtfKind };
  void readFund(etf)
    .then(reads => {
      const common = [...flowDates(reads[2])].sort().reverse().slice(0, 5);
      const got = fundRow(e, reads, common);
      oneFund.set(etf, got ? { status: 'live', row: got.row, holdings: got.held, cover: { lines: got.held.length, weight: got.held.reduce((a, h) => a + h.weight, 0), fundCount: got.row.holdingsCount > 0 ? got.row.holdingsCount : null } } : { status: 'error', row: null, holdings: [], cover: null });
      emit({});
    })
    .catch(() => {
      oneFund.set(etf, { status: 'error', row: null, holdings: [], cover: null });
      emit({});
    });
}

/* THE FIELD'S OWN UNIT (the fourth audit, 2026-10-23): one_day_perc, one_week_perc and one_month_perc are fractions
   (META 10/22 −0.074 = −7.4%); guessing by size (|v| ≤ 1.5 a fraction) would read a +200% month as +2% */
const frac = (v: unknown): number | null => {
  const n = numOr(v);
  return n == null ? null : n * 100;
};

async function pullStocks() {
  try {
    const tickers = UNIVERSE.map(u => u.ticker);
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < tickers.length; i += 12) {
      const part = await whalesScreener(tickers.slice(i, i + 12));
      if (Array.isArray(part)) rows.push(...part);
    }
    /* THE REGULAR CLOSE FROM THE DAILY ROWS (audit round 6): the screener has none — its close is the last print and its
       intraday_change is off the OPEN — so outside the session each name's regular closes are read (loadRegularCloses,
       the quote's and the top bar's source; the list's quotes read the same cached rows) */
    const closesOf = new Map<string, readonly { date: string; close: number }[] | null>();
    await Promise.all(
      rows.map(row => {
        const t = String(row.ticker || '').toUpperCase();
        if (!t || !screenerNeedsCloses(row)) return Promise.resolve();
        return loadRegularCloses(t)
          .then(c => void closesOf.set(t, c))
          .catch(() => void closesOf.set(t, null));
      }),
    );
    const picks: StockPick[] = [];
    for (const row of rows) {
      const ticker = String(row.ticker || '').toUpperCase();
      const u = UNIVERSE.find(x => x.ticker === ticker);
      const read = screenerRead(row, closesOf.get(ticker) ?? null);
      /* the REGULAR price — the after-hours print kept apart, as every row and the quote read it */
      const price = read?.regular ?? null;
      if (!ticker || price == null || !(price > 0)) continue;
      const weekClose = numOr(row.one_week_close);
      const monthClose = numOr(row.one_month_close);
      /* the week and the month off the REGULAR price too — the screener's own percents run to the last print */
      const off = (ref: number | null) => (ref != null && ref > 0 ? ((price - ref) / ref) * 100 : null);
      const pick = pickFromLive({
          ticker,
          name: u?.name || String(row.full_name || ticker),
          sector: asSector(ticker, typeof row.sector === 'string' ? row.sector : undefined),
          price,
          /* the regular session's change, off the daily rows (0 only when no prior close is in hand) */
          changePct: read?.pct ?? 0,
          weekPct: off(weekClose) ?? frac(row.one_week_perc),
          monthPct: off(monthClose) ?? frac(row.one_month_perc),
          rsi: numOr(row.rsi_14),
          epsGrowth: numOr(row.eps_growth_4q),
          yearClose: numOr(row.one_year_close),
          sixClose: numOr(row.six_month_close),
          threeClose: numOr(row.three_month_close),
          monthClose,
          weekClose,
          bullish: numOr(row.bullish_premium),
          bearish: numOr(row.bearish_premium),
          sma50: numOr(row.sma_50),
          row: row as Record<string, unknown>,
        });
      picks.push({ ...pick, extPrice: read?.ext ?? null, extPct: read?.extPct ?? null });
    }
    picks.sort((a, b) => b.composite - a.composite);
    emit({ stockStatus: picks.length ? 'live' : 'error', stocks: picks });
  } catch {
    if (snap.stocks.length === 0) emit({ stockStatus: 'error' });
  }
}

async function pullTide() {
  try {
    const rows = await whalesTide();
    if (!Array.isArray(rows) || rows.length === 0) return;
    const list = rows as UwTide[];
    const dates = list.map(r => r.date).filter((d): d is string => !!d).sort();
    const day = dates[dates.length - 1];
    const today = list.filter(r => !day || r.date === day);
    const call = today.reduce((s, r) => s + num(r.net_call_premium), 0);
    const put = today.reduce((s, r) => s + num(r.net_put_premium), 0);
    const volume = today.reduce((s, r) => s + num(r.net_volume), 0);
    emit({ tide: { call, put, net: call + put, volume } });
  } catch {
    /* the tide line stays a dash */
  }
}

const cardInflight = new Set<string>();

export function ensureStockCard(ticker: string): void {
  const t = ticker.toUpperCase();
  if (!t || cardInflight.has(t) || t in snap.cards) return;
  cardInflight.add(t);
  whalesStock(t)
    .then(info => {
      if (!info || typeof info !== 'object') {
        emit({ cards: { ...snap.cards, [t]: null } });
        return;
      }
      const row = info as Record<string, unknown>;
      rememberCompanyName(t, String(row.full_name || row.short_name || ''));
      emit({
        cards: {
          ...snap.cards,
          [t]: {
            ticker: t,
            name: String(row.full_name || row.short_name || t),
            sector: houseSector(String(row.sector || '')) || '—',
            /* the vendor's copy, its one recurring slip mended ("Apple is the worlds largest…", the retail test round 7) */
            description: String(row.short_description || '').replace(/\bworlds\b(?=\s+(?:largest|biggest|leading|first|most|top|second|third|largest|premier|only|best))/gi, m => `${m.slice(0, -1)}'s`),
            marketCap: numOr(row.marketcap),
            beta: numOr(row.beta),
            avgVolume: numOr(row.avg30_volume),
            nextEarnings: typeof row.next_earnings_date === 'string' ? row.next_earnings_date : null,
            hasDividend: typeof row.has_dividend === 'boolean' ? row.has_dividend : null,
            outstanding: numOr(row.outstanding),
            issueType: typeof row.issue_type === 'string' ? row.issue_type : null,
          },
        },
      });
    })
    .catch(() => emit({ cards: { ...snap.cards, [t]: null } }))
    .finally(() => cardInflight.delete(t));
}

/* ONLY WHAT THE PAGE SHOWS (Dossier audit round 6: every Dossier page fired 250–450 reads — a single name cell on the
   Congress page started the institutions, the shorts screen, every fund's book, the stock screen and the tide). Each
   part of the store starts when a hook that reads it is mounted, and never before. */
type Part = 'inst' | 'shorts' | 'etfs' | 'stocks' | 'tide';
const partStarted = new Set<Part>();
function ensurePart(part: Part) {
  if (partStarted.has(part) || typeof window === 'undefined') return;
  partStarted.add(part);
  if (part === 'inst') void pullInstitutions();
  else if (part === 'shorts') void pullShorts();
  else if (part === 'etfs') void pullEtfs();
  else if (part === 'stocks') void pullStocks();
  else void pullTide();
}

function subscribeTo(parts: readonly Part[]): (fn: () => void) => () => void {
  return fn => {
    listeners.add(fn);
    parts.forEach(ensurePart);
    return () => listeners.delete(fn);
  };
}
const SUBS: Record<string, (fn: () => void) => () => void> = {};
const subFor = (parts: readonly Part[]) => (SUBS[parts.join(',')] ??= subscribeTo(parts));

const peek = () => snap;

/** The file store, starting only the parts named (none: the store as it stands, starting nothing) */
function useFiles(...parts: Part[]): Snap {
  return useSyncExternalStore(subFor(parts), peek, peek);
}

/** Every part — kept for callers that read the whole store */
export function useLiveFiles(): Snap {
  return useFiles('inst', 'shorts', 'etfs', 'stocks', 'tide');
}

export function useInstitutions(): { status: FileStatus; rows: InstitutionRow[]; houses: string[]; progress: { done: number; total: number } | null; held: boolean } {
  const s = useFiles('inst');
  /* every listed house, read or still held back (round 8) */
  const houses = [...new Set([...s.institutions.map(r => r.name), ...Object.keys(s.houseTotals)])];
  return { status: s.instStatus, rows: s.institutions, houses, progress: s.instProgress, held: s.instHeld };
}

export function houseNameFromSlug(slug: string): string | null {
  const names = new Set(snap.institutions.map(r => r.name));
  for (const name of names) if (houseSlug(name) === slug) return name;
  return null;
}

export function useHouseBook(slug: string): { status: FileStatus; name: string | null; rows: InstitutionRow[]; totalB: number | null; linesRead: number; optionsB: { calls: number; puts: number } | null } {
  /* the whole book when the Institutions page has read it; this one house otherwise */
  const s = useFiles();
  const bookName = houseNameFromSlug(slug);
  useEffect(() => {
    if (!bookName) ensureHouse(slug);
  }, [slug, bookName]);
  const own = houseRead.get(slug);
  const name = bookName ?? own?.name ?? null;
  const rows = bookName ? s.institutions.filter(r => r.name === bookName) : (own?.rows ?? []);
  const total = name ? s.houseTotals[name] : undefined;
  const opts = name ? s.houseOptions[name] : undefined;
  const status: FileStatus = bookName ? s.instStatus : (own?.status ?? 'loading');
  return { status, name, rows, totalB: total ? total / 1e9 : null, linesRead: HOUSE_LINES, optionsB: opts ? { calls: opts.calls / 1e9, puts: opts.puts / 1e9 } : null };
}

export function useShorts(): { status: FileStatus; rows: ShortRow[] } {
  const s = useFiles('shorts');
  return { status: s.shortStatus, rows: s.shorts };
}

/* ONE NAME'S SHORT PRINT, NOT THE WHOLE SCREEN (the round-8 audit: the stock page and shorts/GME walked the whole
   most-shorted screen — seven /short_screener calls and four screener batches — for one name's figure). The name's own
   two newest settlements (/short_screener?tickers=T, newest first) are read; the screen's row stands in only when the
   Shorts page has already read the screen. */
const oneShort = new Map<string, { status: FileStatus; row: ShortRow | null }>();
const oneShortAsked = new Set<string>();
function ensureOneShort(t: string): void {
  if (!t || oneShortAsked.has(t)) return;
  oneShortAsked.add(t);
  oneShort.set(t, { status: 'loading', row: null });
  void uwCall(`/short_screener?tickers=${encodeURIComponent(t)}&order_by=market_date&order_direction=desc&limit=2`)
    .then(res => {
      const rows = Array.isArray(res.data) ? (res.data as UwShort[]) : [];
      if (res.error && !rows.length) {
        oneShort.set(t, { status: 'error', row: null });
      } else {
        const own = rows
          .filter(r => String(r.symbol ?? (r as { ticker?: string }).ticker ?? t).toUpperCase() === t)
          .sort((a, b) => String(b.market_date ?? '').localeCompare(String(a.market_date ?? '')))
          .slice(0, 2)
          .map(r => shortFrom({ ...r, symbol: t }))
          .filter((r): r is ShortRow => !!r);
        const merged = own.length ? collapseShorts(own)[0] ?? null : null;
        oneShort.set(t, { status: 'live', row: merged ? { ...merged, borrowAsOf: merged.history[0]?.report } : null });
      }
      emit({});
    })
    .catch(() => {
      oneShort.set(t, { status: 'error', row: null });
      emit({});
    });
}
export function useShortRow(ticker: string): { status: FileStatus; row: ShortRow | null } {
  const s = useFiles();
  const t = ticker.toUpperCase();
  const fromScreen = s.shortStatus === 'live' ? s.shorts.find(r => r.ticker === t) ?? null : null;
  useEffect(() => {
    if (!fromScreen) ensureOneShort(t);
  }, [t, fromScreen]);
  if (fromScreen) return { status: 'live', row: fromScreen };
  return oneShort.get(t) ?? { status: 'loading', row: null };
}

export type HoldingsCover = { lines: number; weight: number; fundCount: number | null };
export function useEtfs(): { status: FileStatus; rows: EtfRow[]; holdingsOf: (etf: string) => EtfHolding[]; coverOf: (etf: string) => HoldingsCover | null } {
  const s = useFiles('etfs');
  return { status: s.etfStatus, rows: s.etfs, holdingsOf: etf => s.holdings[etf.toUpperCase()] ?? [], coverOf: etf => s.holdingsCover[etf.toUpperCase()] ?? null };
}

export function useEtfFile(etf: string): { status: FileStatus; row: EtfRow | null; holdings: EtfHolding[]; cover: HoldingsCover | null } {
  /* the index's book when the ETFs page has read it; this one fund otherwise (round 8) */
  const s = useFiles();
  const t = etf.toUpperCase();
  const fromBook = s.etfStatus === 'live' ? s.etfs.find(r => r.etf === t) ?? null : null;
  useEffect(() => {
    if (!fromBook) ensureOneFund(t);
  }, [t, fromBook]);
  if (fromBook) return { status: 'live', row: fromBook, holdings: s.holdings[t] ?? [], cover: s.holdingsCover[t] ?? null };
  return oneFund.get(t) ?? { status: 'loading', row: null, holdings: [], cover: null };
}

/** A fund's whole-book sector and country weights (/etfs/{t}/weights) — the fund's own split, not the lines read */
export function useEtfWeights(etf: string): { status: FileStatus; sectors: { name: string; weight: number }[]; countries: { name: string; weight: number }[] } {
  const t = etf.toUpperCase();
  const [got, setGot] = useState<{ status: FileStatus; sectors: { name: string; weight: number }[]; countries: { name: string; weight: number }[] }>({ status: 'loading', sectors: [], countries: [] });
  useEffect(() => {
    if (!t) return;
    let dead = false;
    void uwCall(`/etfs/${encodeURIComponent(t)}/weights`).then(res => {
      if (dead) return;
      const d = (res.data && typeof res.data === 'object' ? res.data : {}) as { sector?: { sector?: string; weight?: string }[]; country?: { country?: string; weight?: string }[] };
      const list = (rows: { name?: string; weight?: string }[]) =>
      {
        /* the vendor's finer sectors fold into one house name ("Electronic Technology" and "Technology Services" are
           both Technology) — add them up, never two rows under one name (the sixth sweep: duplicate grid rows on SPY) */
        const sum = new Map<string, number>();
        for (const r of rows) {
          const name = houseSector(String(r.name || '')) || '—';
          sum.set(name, (sum.get(name) ?? 0) + num(r.weight) * 100);
        }
        return [...sum.entries()].map(([name, weight]) => ({ name, weight })).filter(r => r.weight >= 0.05).sort((a, b) => b.weight - a.weight);
      };
      setGot({
        status: res.error ? 'error' : 'live',
        sectors: list((d.sector ?? []).map(r => ({ name: r.sector, weight: r.weight }))),
        countries: list((d.country ?? []).map(r => ({ name: r.country, weight: r.weight }))),
      });
    });
    return () => {
      dead = true;
    };
  }, [t]);
  return got;
}

export function useFundsHolding(ticker: string): { etf: string; name: string; weight: number; sharesM: number }[] {
  const s = useFiles('etfs');
  const t = ticker.toUpperCase();
  return s.etfs.flatMap(e => {
    const hit = (s.holdings[e.etf] ?? []).find(h => h.ticker === t);
    return hit ? [{ etf: e.etf, name: e.name, weight: hit.weight, sharesM: hit.sharesM }] : [];
  });
}

export function useHousesOn(ticker: string): InstitutionRow[] {
  const s = useFiles('inst');
  const t = ticker.toUpperCase();
  return s.institutions.filter(r => r.ticker === t).sort((a, b) => b.valueB - a.valueB);
}

export function useLiveStocks(): { status: FileStatus; picks: StockPick[] } {
  const s = useFiles('stocks');
  return { status: s.stockStatus, picks: s.stocks };
}

export function useLiveTide(): TidePrint | null {
  return useFiles('tide').tide;
}

/* NAMES FROM THE STOCK'S OWN INFO (round 8: SERV still read "ServiceMaster Global Holdings, Inc." on the Shorts grid).
   Round 6 asked the screener for names in bulk, but the screener's full_name now comes back empty for every row, so
   the old bundled listing stood under every grid. The vendor's name is on /stock/{t}/info alone: it is asked only for a
   name a reader can see (the name cells ask once they scroll into view), two at a time behind the page's own reads,
   and remembered for a fortnight in this browser (tickers.ts). While a name is being asked the cell holds its name
   rather than print the stale listing; the listing's name stands only when the vendor has none. */
let namesRev = 0;
const companyNamesRev = () => namesRev;
const nameAsked = new Set<string>();
const nameDone = new Set<string>();
const nameQueue: string[] = [];
let nameBusy = 0;
const bumpNames = () => {
  namesRev += 1;
  nameRevListeners.forEach(fn => fn());
};
const nameRevListeners = new Set<() => void>();
function pumpNames(): void {
  while (nameBusy < 2 && nameQueue.length) {
    const t = nameQueue.shift()!;
    nameBusy += 1;
    void whalesStock(t)
      .then(info => {
        const row = info && typeof info === 'object' ? (info as Record<string, unknown>) : null;
        if (row) rememberCompanyName(t, String(row.full_name || row.short_name || ''));
      })
      .catch(() => undefined)
      .finally(() => {
        nameBusy -= 1;
        nameDone.add(t);
        bumpNames();
        pumpNames();
      });
  }
}
function askName(t: string): void {
  if (nameAsked.has(t)) return;
  nameAsked.add(t);
  nameQueue.push(t);
  pumpNames();
}
const subscribeNames = (fn: () => void) => {
  const off = subscribeCompanyNames(fn);
  nameRevListeners.add(fn);
  return () => {
    off();
    nameRevListeners.delete(fn);
  };
};
const askable = (t: string, fromVendorFeed: boolean) => /^[A-Z][A-Z0-9.]{0,6}$/.test(t) && (fromVendorFeed || isListed(t));

/** The company's name as the vendor gives it (its stock info). `seen` gates the ask (a name cell asks once it is on
    screen). While the ask is out the name is '' — never the stale listing's, which stands only once the vendor has
    answered without one, or for a symbol the vendor is not asked about. */
export function useCompanyName(ticker: string, fromVendorFeed = false, seen = true): string {
  const t = (ticker || '').toUpperCase();
  useSyncExternalStore(subscribeNames, companyNamesRev, companyNamesRev);
  const ask = !!t && askable(t, fromVendorFeed) && !hasVendorName(t);
  useEffect(() => {
    if (ask && seen) askName(t);
  }, [t, ask, seen]);
  if (!t) return '';
  if (hasVendorName(t)) return companyName(t);
  if (ask && !nameDone.has(t)) return '';
  return companyName(t);
}

export function useStockCard(ticker: string): StockCard | null | undefined {
  const t = ticker.toUpperCase();
  const s = useFiles();
  useEffect(() => {
    ensureStockCard(t);
  }, [t]);
  return t in s.cards ? s.cards[t] : undefined;
}
