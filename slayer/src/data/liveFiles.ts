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
  shortStatus: FileStatus;
  shorts: ShortRow[];
  etfStatus: FileStatus;
  etfs: EtfRow[];
  holdings: Record<string, EtfHolding[]>;
  /** Each fund's file as read: the lines on it, and the fund's own count of holdings */
  holdingsCover: Record<string, { lines: number; weight: number; fundCount: number | null }>;
  /** Each house's whole 13F value as Unusual Whales totals it, dollars — the grid shows the top lines only */
  houseTotals: Record<string, number>;
  stockStatus: FileStatus;
  stocks: StockPick[];
  tide: TidePrint | null;
  cards: Record<string, StockCard | null>;
}

const empty: Snap = {
  instStatus: 'loading',
  instProgress: null,
  institutions: [],
  shortStatus: 'loading',
  shorts: [],
  etfStatus: 'loading',
  etfs: [],
  holdings: {},
  holdingsCover: {},
  houseTotals: {},
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
    avgPrice: num(h.avg_price),
    close: num(h.close),
    firstPrice: num(h.price_first_buy),
    unitsChangeM: change / 1e6,
    firstBuy: h.first_buy || '—',
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

async function pullInstitutions() {
  try {
    const houses = await whalesInstitutions(40);
    if (!Array.isArray(houses) || houses.length === 0) throw new Error('shape');
    const rows: InstitutionRow[] = [];
    /* ten houses at a time, the book published once whole — one by one, the head counted "6 houses · 0 calls" for the
       half-minute the rest took (the ship pass, 2026-10-22) */
    const list = houses as UwInstitution[];
    const totals: Record<string, number> = {};
    for (const h of list) {
      const name = (h.name || h.short_name || '').trim();
      const v = num(h.total_value);
      if (name && v > 0) totals[name] = v;
    }
    emit({ houseTotals: totals });
    let done = 0;
    await inBatches(list, 10, async house => {
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
    }, () => {
      /* the rows land a batch at a time, so the grid fills in seconds; the head says how many houses are in */
      if (rows.length) emit({ instStatus: 'live', institutions: rows.slice().sort((a, b) => b.valueB - a.valueB), instProgress: done < list.length ? { done, total: list.length } : null });
    });
    if (rows.length === 0) throw new Error('no house landed');
    emit({ instStatus: 'live', institutions: rows.sort((a, b) => b.valueB - a.valueB), instProgress: null });
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
        for (const r of Array.isArray(got) ? got : []) facts.set(String(r.ticker || '').toUpperCase(), r);
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

async function pullEtfs() {
  try {
    const rows: EtfRow[] = [];
    const holdings: Record<string, EtfHolding[]> = {};
    /* every fund asked at once — one by one, the head read "6 funds" for the half-minute the rest took to land */
    const reads = await Promise.all(ETF_LIST.map(e => Promise.all([
        whalesEtfInfo(e.etf).catch(() => null as UwEtfInfo | null),
        whalesEtfHoldings(e.etf).catch(() => [] as UwEtfHolding[]),
        whalesEtfFlow(e.etf).catch(() => [] as UwEtfFlow[]),
      ])));
    const dateSets = reads.map(r => (Array.isArray(r[2]) ? new Set(r[2].map(x => String(x.date || '').slice(0, 10)).filter(Boolean)) : new Set<string>())).filter(d => d.size > 0);
    const common = dateSets.length ? [...dateSets[0]].filter(d => dateSets.every(set => set.has(d))).sort().reverse().slice(0, 5) : [];
    const window = new Set(common);
    const flowFrom = common.length ? common[common.length - 1] : null;
    const flowTo = common.length ? common[0] : null;
    for (let k = 0; k < ETF_LIST.length; k++) {
      const e = ETF_LIST[k];
      const [infoR, holdR, flowR] = reads[k];
      /* a fund none of whose three reads landed is not a $0 fund — it stays off the book */
      if (!infoR && !(Array.isArray(holdR) && holdR.length) && !(Array.isArray(flowR) && flowR.length)) continue;
      const info = infoR && !Array.isArray(infoR) ? infoR : null;
      const held = (Array.isArray(holdR) ? holdR : []).map(holdingOf).filter((h): h is EtfHolding => !!h).sort((a, b) => b.weight - a.weight);
      holdings[e.etf] = held;
      const top = held[0];
      const flow = flow5(Array.isArray(flowR) ? flowR : [], common.length ? window : undefined);
      const equity = held.filter(h => !/bond|treasury|fixed/i.test(h.sector)).reduce((s, h) => s + h.weight, 0);
      rows.push({
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
        flowFrom,
        flowTo,
        flowDays: common.length,
        holdingsAsOf: held.reduce<string | null>((m, h) => (h.asOf && (!m || h.asOf > m) ? h.asOf : m), null),
      });
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
            description: String(row.short_description || ''),
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

export function useInstitutions(): { status: FileStatus; rows: InstitutionRow[]; houses: string[]; progress: { done: number; total: number } | null } {
  const s = useFiles('inst');
  const houses = [...new Set(s.institutions.map(r => r.name))];
  return { status: s.instStatus, rows: s.institutions, houses, progress: s.instProgress };
}

export function houseNameFromSlug(slug: string): string | null {
  const names = new Set(snap.institutions.map(r => r.name));
  for (const name of names) if (houseSlug(name) === slug) return name;
  return null;
}

export function useHouseBook(slug: string): { status: FileStatus; name: string | null; rows: InstitutionRow[]; totalB: number | null; linesRead: number } {
  const s = useFiles('inst');
  const name = houseNameFromSlug(slug);
  const total = name ? s.houseTotals[name] : undefined;
  /* still landing while houses are being read — a house not read yet is not "missing" */
  const status: FileStatus = !name && s.instProgress ? 'loading' : s.instStatus;
  return { status, name, rows: name ? s.institutions.filter(r => r.name === name) : [], totalB: total ? total / 1e9 : null, linesRead: HOUSE_LINES };
}

export function useShorts(): { status: FileStatus; rows: ShortRow[] } {
  const s = useFiles('shorts');
  return { status: s.shortStatus, rows: s.shorts };
}

export function useShortRow(ticker: string): { status: FileStatus; row: ShortRow | null } {
  const s = useFiles('shorts');
  const t = ticker.toUpperCase();
  return { status: s.shortStatus, row: s.shorts.find(r => r.ticker === t) ?? null };
}

export type HoldingsCover = { lines: number; weight: number; fundCount: number | null };
export function useEtfs(): { status: FileStatus; rows: EtfRow[]; holdingsOf: (etf: string) => EtfHolding[]; coverOf: (etf: string) => HoldingsCover | null } {
  const s = useFiles('etfs');
  return { status: s.etfStatus, rows: s.etfs, holdingsOf: etf => s.holdings[etf.toUpperCase()] ?? [], coverOf: etf => s.holdingsCover[etf.toUpperCase()] ?? null };
}

export function useEtfFile(etf: string): { status: FileStatus; row: EtfRow | null; holdings: EtfHolding[]; cover: HoldingsCover | null } {
  const s = useFiles('etfs');
  const t = etf.toUpperCase();
  return { status: s.etfStatus, row: s.etfs.find(r => r.etf === t) ?? null, holdings: s.holdings[t] ?? [], cover: s.holdingsCover[t] ?? null };
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

/* NAMES IN BULK (round 6): the Shorts page asked /stock/{t}/info two hundred times for the names alone. A name is asked
   of the screener (its full_name), up to sixty a call, gathered over a beat; a name the screener does not carry is
   left on the bundled listing's. */
let namesRev = 0;
const companyNamesRev = () => namesRev;
const nameAsked = new Set<string>();
let nameQueue: string[] = [];
let nameTimer: number | null = null;
function askName(t: string): void {
  if (nameAsked.has(t)) return;
  nameAsked.add(t);
  nameQueue.push(t);
  if (nameTimer != null) return;
  nameTimer = window.setTimeout(() => {
    nameTimer = null;
    const all = nameQueue;
    nameQueue = [];
    for (let i = 0; i < all.length; i += 50) {
      const chunk = all.slice(i, i + 50);
      void whalesScreener(chunk)
        .then(rows => {
          /* the revision first: the name store's listeners re-read it as each name lands */
          namesRev += 1;
          for (const r of Array.isArray(rows) ? rows : []) rememberCompanyName(String(r.ticker ?? ''), String(r.full_name || ''));
        })
        .catch(() => undefined);
    }
  }, 120);
}

/** The company's name as the vendor gives it (its stock info), the bundled listing's until that lands — every Dossier
    name cell reads this (the re-audit, 2026-10-22: the listing called SERV "ServiceMaster") */
export function useCompanyName(ticker: string, fromVendorFeed = false): string {
  const t = (ticker || '').toUpperCase();
  /* A LIGHT LOOKUP (round 6): subscribed to the names alone — it starts none of the store's books — and asked in bulk */
  useSyncExternalStore(subscribeCompanyNames, companyNamesRev, companyNamesRev);
  useEffect(() => {
    /* a symbol the vendor's own feed sent is asked of it; any other only when it is a listed one (an OTC symbol on a
       Congress filing answers 404) */
    if (t && /^[A-Z][A-Z0-9.]{0,6}$/.test(t) && !hasVendorName(t) && (fromVendorFeed || isListed(t))) askName(t);
  }, [t, fromVendorFeed]);
  return t ? companyName(t) : '';
}

export function useStockCard(ticker: string): StockCard | null | undefined {
  const t = ticker.toUpperCase();
  const s = useFiles();
  useEffect(() => {
    ensureStockCard(t);
  }, [t]);
  return t in s.cards ? s.cards[t] : undefined;
}
