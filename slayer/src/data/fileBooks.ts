/*
  THE BOOKS THE DOSSIER DID NOT HAVE.

  Institutions, shorts, and the ETF book — the full field set the filings,
  the short report and the fund endpoints return. Plus the futures tape,
  the rate strip, and the second faces under Congress and Insiders.
  Every row is a SAMPLE with a stable shape, so the page does not change
  when the key replaces the builder.

  The economic calendar, the FDA date and the IPO are not a book of their
  own. They land on the month under News (data/monthCalendar.ts).
*/

import { h01, hPick, hRange } from '../core/rng';
import { dayKey } from '../core/rng';
import type { DeskSession } from './deskSession';
import { UNIVERSE } from './universe';
import { bracketLabel, seatLabel } from './congress';
import type { CongressTrade } from '../types/record';

export const HOUSES = [
  'Vanguard',
  'BlackRock',
  'State Street',
  'Fidelity',
  'Capital Group',
  'Geode',
  'Norges Bank',
  'T. Rowe Price',
  'Berkshire',
  'Bridgewater',
  'Citadel',
  'Millennium',
  'Renaissance',
  'Two Sigma',
  'Point72',
  'Viking',
] as const;

export type PositionStatus = 'new' | 'added' | 'cut' | 'closed' | 'held';

export interface InstitutionRow {
  id: string;
  name: string;
  ticker: string;
  /** The holding's company name as the filing gives it, when the listing does not know the ticker */
  company?: string;
  /** True when the filing gives no listed symbol — `ticker` is then the vendor's own identifier (a CUSIP-like id) */
  unlisted?: boolean;
  sector: string;
  sharesM: number;
  /** Shares on the prior 13F. Zero when the line is new. */
  priorSharesM: number;
  valueB: number;
  changePct: number;
  /** perc_of_share_value — this line as a percent of the house's reported book */
  pctOfBook: number;
  /** perc_of_total — the line as a percent of shares outstanding */
  pctOfShares: number;
  /** Average price the house paid */
  avgPrice: number;
  /** Close on the report date */
  close: number;
  /** price_first_buy — the close on the day of the first buy */
  firstPrice: number;
  /** units_change, in millions of shares */
  unitsChangeM: number;
  firstBuy: string;
  sharesOutM: number;
  book: 'calls' | 'puts' | 'stock';
  /** The filing's security type when it is not plain shares ("Pref", "Note") — one house can file two lines on a ticker */
  security?: string;
  status: PositionStatus;
  /** The quarter the report covers */
  report: string;
  /** Days since the 13F was filed, on the engine clock */
  filedDaysAgo: number;
  /** Eight quarters of units, oldest first. The last one is this report. */
  quarters: { period: string; unitsM: number }[];
}

const STATUS_WORD: Record<PositionStatus, string> = {
  new: 'New',
  added: 'Added',
  cut: 'Cut',
  closed: 'Closed',
  held: 'Held',
};

export const positionWord = (s: PositionStatus) => STATUS_WORD[s];

export function houseSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function houseFromSlug(slug: string): (typeof HOUSES)[number] | null {
  return HOUSES.find(h => houseSlug(h) === slug) ?? null;
}

function sectorOf(ticker: string): string {
  return UNIVERSE.find(u => u.ticker === ticker)?.sector ?? '—';
}

export function buildInstitutions(): InstitutionRow[] {
  const day = dayKey();
  const tickers = UNIVERSE.map(u => u.ticker);
  const rows: InstitutionRow[] = [];
  HOUSES.forEach((house, hi) => {
    for (let i = 0; i < 8; i++) {
      const ticker = tickers[(hi * 5 + i * 3) % tickers.length];
      const roll = h01(`${day}-st-${house}-${i}`);
      const changePct = Number(hRange(`${day}-chg-${house}-${i}`, -18, 14).toFixed(1));
      let status: PositionStatus = 'held';
      if (roll > 0.9) status = 'new';
      else if (roll < 0.07) status = 'closed';
      else if (changePct >= 2) status = 'added';
      else if (changePct <= -2) status = 'cut';
      const sharesM = status === 'closed' ? Number(hRange(`${day}-sh-${house}-${i}`, 0.1, 1.4).toFixed(1)) : Number(hRange(`${day}-sh-${house}-${i}`, 4, 180).toFixed(1));
      const priorSharesM = status === 'new' ? 0 : Number((sharesM / (1 + changePct / 100)).toFixed(1));
      const periods = ['2024 Q4', '2025 Q1', '2025 Q2', '2025 Q3', '2025 Q4', '2026 Q1', '2026 Q2', '2026 Q3'];
      const quarters: { period: string; unitsM: number }[] = [];
      let walked = sharesM;
      for (let q = periods.length - 1; q >= 0; q--) {
        quarters.unshift({ period: periods[q], unitsM: q === periods.length - 1 ? sharesM : Math.max(0, Number(walked.toFixed(1))) });
        walked = status === 'new' && q <= 2 ? 0 : walked * hRange(`${day}-q-${house}-${i}-${q}`, 0.82, 1.16);
      }
      rows.push({
        id: `${house}-${ticker}-${i}`,
        name: house,
        ticker,
        sector: sectorOf(ticker),
        sharesM,
        priorSharesM: Number.isFinite(priorSharesM) ? Math.max(0, priorSharesM) : sharesM,
        valueB: Number(hRange(`${day}-val-${house}-${i}`, 0.2, 42).toFixed(2)),
        changePct: status === 'new' ? 100 : changePct,
        pctOfBook: 0,
        pctOfShares: Number(hRange(`${day}-ps-${house}-${i}`, 0.15, 7.4).toFixed(2)),
        avgPrice: Number(hRange(`${day}-ap-${house}-${i}`, 18, 420).toFixed(2)),
        close: Number(hRange(`${day}-cl-${house}-${i}`, 18, 440).toFixed(2)),
        firstPrice: Number(hRange(`${day}-fp-${house}-${i}`, 12, 280).toFixed(2)),
        unitsChangeM: Number((sharesM - (status === 'new' ? 0 : priorSharesM)).toFixed(1)),
        firstBuy: hPick(`${day}-fb-${house}-${i}`, ['2019-03-31', '2021-06-30', '2023-09-30', '2024-12-31', '2025-06-30']),
        sharesOutM: Number(hRange(`${day}-so-${house}-${i}`, 80, 16000).toFixed(0)),
        book: hPick(`${day}-bk-${house}-${i}`, ['stock', 'stock', 'stock', 'calls', 'puts'] as const),
        status,
        report: '2026 Q3',
        filedDaysAgo: Math.round(hRange(`${day}-fd-${house}-${i}`, 8, 80)),
        quarters,
      });
    }
  });
  const totals = new Map<string, number>();
  rows.forEach(r => totals.set(r.name, (totals.get(r.name) ?? 0) + r.valueB));
  rows.forEach(r => {
    const total = totals.get(r.name) ?? r.valueB;
    r.pctOfBook = Number(((r.valueB / total) * 100).toFixed(1));
  });
  return rows.sort((a, b) => b.valueB - a.valueB);
}

export function institutionBook(house: string): InstitutionRow[] {
  return buildInstitutions().filter(r => r.name === house);
}

export function housesOn(ticker: string): InstitutionRow[] {
  return buildInstitutions().filter(r => r.ticker === ticker);
}

export interface ShortPrint {
  report: string;
  interestPct: number;
  sharesM: number;
}

export interface ShortRow {
  ticker: string;
  /** The company's name from the vendor's file, when the listing has none */
  name?: string;
  sector: string;
  interestPct: number;
  /** Shares sold short, in millions */
  shortSharesM: number;
  daysToCover: number;
  floatM: number;
  /** Versus the prior report. Null when the feed has only the latest print. */
  changePct: number | null;
  /** FINRA short volume that session, in millions of shares. Null when the feed does not carry it. */
  shortVolM: number | null;
  /** Short volume as a percent of that session's volume. Null when the feed does not carry it. */
  shortVolRatio: number | null;
  /** The session the short volume is from, "YYYY-MM-DD" */
  shortVolDate?: string;
  /** The session the short volume by market is from (YYYY-MM-DD) — it can be a day behind the latest short volume */
  exchangesDate?: string;
  /** Fails to deliver, in thousands of shares. Null when the feed does not carry it. */
  ftdK: number | null;
  /** Borrow fee, percent a year. Null when the feed did not price it. */
  feeRate: number | null;
  /** Rebate paid to the lender, percent a year. Null when the feed did not price it. */
  rebateRate: number | null;
  /** Shares available to borrow, in millions. Null when the feed did not say. */
  availableM: number | null;
  history: ShortPrint[];
  exchanges: { exchange: string; shortM: number; totalM: number }[];
  ftdDays: { date: string; quantity: number; price: number }[];
  /** The vendor's issue type is a fund (an ETF, ETN or closed-end fund) — short interest there is creation and hedging, not a squeeze */
  fund?: boolean;
  /** The settlement day the fee and the shares available were read on, when they are the screener's rather than today's */
  borrowAsOf?: string;
}

function shortFrom(ticker: string, sector: string): ShortRow {
  const day = dayKey();
  const interestPct = Number(hRange(`${day}-si-${ticker}`, 0.4, 18).toFixed(2));
  const floatM = Number(hRange(`${day}-fl-${ticker}`, 80, 4200).toFixed(0));
  const reports = ['2026-09-15', '2026-08-15', '2026-07-15', '2026-06-15'];
  return {
    ticker,
    sector,
    interestPct,
    shortSharesM: Number(((interestPct / 100) * floatM).toFixed(1)),
    daysToCover: Number(hRange(`${day}-dtc-${ticker}`, 0.4, 6.5).toFixed(1)),
    floatM,
    changePct: Number(hRange(`${day}-sic-${ticker}`, -12, 9).toFixed(1)),
    shortVolM: Number(hRange(`${day}-sv-${ticker}`, 0.4, 28).toFixed(2)),
    shortVolRatio: Number(hRange(`${day}-svr-${ticker}`, 18, 62).toFixed(1)),
    ftdK: Number(hRange(`${day}-ftd-${ticker}`, 4, 840).toFixed(0)),
    feeRate: Number(hRange(`${day}-bf-${ticker}`, 0.25, 18).toFixed(2)),
    rebateRate: Number(hRange(`${day}-rb-${ticker}`, 0.05, 4.5).toFixed(2)),
    availableM: Number(hRange(`${day}-av-${ticker}`, 0.2, 14).toFixed(2)),
    history: reports.map((report, i) => ({
      report,
      interestPct: Number(hRange(`${day}-sih-${ticker}-${i}`, 0.4, 18).toFixed(2)),
      sharesM: Number(hRange(`${day}-ssh-${ticker}-${i}`, 2, 90).toFixed(1)),
    })),
    exchanges: ['Nasdaq', 'NYSE', 'ARCA', 'BZX', 'IEX', 'Off-exchange'].map(exchange => {
      const totalM = Number(hRange(`${day}-ext-${ticker}-${exchange}`, 0.8, 22).toFixed(2));
      const ratio = hRange(`${day}-exr-${ticker}-${exchange}`, 0.12, 0.62);
      return { exchange, totalM, shortM: Number((totalM * ratio).toFixed(2)) };
    }),
    ftdDays: ['2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-10'].map(date => ({
      date,
      quantity: Math.round(hRange(`${day}-ftdd-${ticker}-${date}`, 200, 12000)),
      price: Number(hRange(`${day}-ftdp-${ticker}-${date}`, 18, 480).toFixed(2)),
    })),
  };
}

export function buildShorts(): ShortRow[] {
  return UNIVERSE.map(u => shortFrom(u.ticker, u.sector)).sort((a, b) => b.interestPct - a.interestPct);
}

export function shortFile(ticker: string): ShortRow {
  return buildShorts().find(r => r.ticker === ticker) ?? shortFrom(ticker, sectorOf(ticker));
}

/** Broad equity index, one sector, Treasuries, corporate credit, or a commodity trust */
export type EtfKind = 'broad' | 'sector' | 'rates' | 'credit' | 'commodity';

export interface EtfFlow {
  day: string;
  flowM: number;
}

export interface EtfRow {
  etf: string;
  name: string;
  kind: EtfKind;
  aumB: number;
  flow5dM: number;
  topHolding: string;
  topWeight: number;
  equityPct: number;
  /** Expense ratio in percent. Null when the feed does not publish one. */
  expensePct: number | null;
  company: string;
  domicile: string;
  holdingsCount: number;
  inception: string;
  hasOptions: boolean;
  avgVolM: number;
  /** Session option volume. Null when the feed does not publish it. */
  callVol: number | null;
  putVol: number | null;
  flows: EtfFlow[];
  /** The window the five-day flow covers — the same dates for every fund (YYYY-MM-DD), and how many days */
  flowFrom?: string | null;
  flowTo?: string | null;
  flowDays?: number;
  /** The latest `updated` date on the fund's holdings — the weights are as of this day */
  holdingsAsOf?: string | null;
}

const ETFS: { etf: string; name: string; kind: EtfKind }[] = [
  { etf: 'SPY', name: 'S&P 500', kind: 'broad' },
  { etf: 'QQQ', name: 'Nasdaq 100', kind: 'broad' },
  { etf: 'IWM', name: 'Russell 2000', kind: 'broad' },
  { etf: 'XLF', name: 'Financials', kind: 'sector' },
  { etf: 'XLK', name: 'Technology', kind: 'sector' },
  { etf: 'XLE', name: 'Energy', kind: 'sector' },
  { etf: 'XLV', name: 'Health care', kind: 'sector' },
  { etf: 'TLT', name: '20+ year Treasuries', kind: 'rates' },
];

export function buildEtfs(): EtfRow[] {
  const day = dayKey();
  return ETFS.map(e => {
    const holdings = etfHoldings(e.etf);
    const top = holdings[0];
    const flows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map(label => {
      const mag = hRange(`${day}-flw-${e.etf}-${label}`, 80, 1100);
      const sign = h01(`${day}-fls-${e.etf}-${label}`) > 0.48 ? 1 : -1;
      return { day: label, flowM: Math.round(mag * sign) };
    });
    return {
      ...e,
      aumB: Number(hRange(`${day}-aum-${e.etf}`, e.kind === 'broad' ? 80 : 18, e.kind === 'broad' ? 620 : 90).toFixed(1)),
      flow5dM: Number(flows.reduce((s, f) => s + f.flowM, 0).toFixed(0)),
      topHolding: top?.ticker ?? '—',
      topWeight: top?.weight ?? 0,
      equityPct: e.kind === 'rates' ? 0 : Number(hRange(`${day}-eq-${e.etf}`, 92, 100).toFixed(0)),
      expensePct: Number(hRange(`${day}-ex-${e.etf}`, e.kind === 'broad' ? 0.03 : 0.08, e.kind === 'broad' ? 0.2 : 0.45).toFixed(2)),
      company: e.etf === 'SPY' || e.etf.startsWith('XL') ? 'State Street' : e.etf === 'TLT' ? 'BlackRock' : 'Invesco',
      domicile: 'United States',
      holdingsCount: e.kind === 'broad' ? (e.etf === 'IWM' ? 1923 : e.etf === 'QQQ' ? 101 : 503) : e.kind === 'rates' ? 48 : 72,
      inception: e.etf === 'SPY' ? '1993-01-22' : e.etf === 'QQQ' ? '1999-03-10' : '2000-06-16',
      hasOptions: true,
      avgVolM: Number(hRange(`${day}-avv-${e.etf}`, 4, 80).toFixed(1)),
      callVol: Math.round(hRange(`${day}-cv-${e.etf}`, 20000, 900000)),
      putVol: Math.round(hRange(`${day}-pv-${e.etf}`, 18000, 800000)),
      flows,
    };
  });
}

export function etfFile(etf: string): EtfRow | null {
  return buildEtfs().find(r => r.etf === etf) ?? null;
}

export interface EtfHolding {
  /** The stock's symbol — a bond line has none, and wears a row key instead (see `bond`) */
  ticker: string;
  /** A bond line (TLT, HYG): no symbol, `name` is the issue and `sharesM` is millions of face value */
  bond?: boolean;
  name?: string;
  weight: number;
  sharesM: number;
  sector: string;
  country: string;
  /** The day the fund's weights were taken (the holdings row's `updated`), YYYY-MM-DD */
  asOf?: string;
}

const COUNTRY: Record<string, string> = {
  TSM: 'Taiwan',
  ASML: 'Netherlands',
  BYDDY: 'China',
  NIO: 'China',
  XPEV: 'China',
  LI: 'China',
};

export function etfHoldings(etf: string): EtfHolding[] {
  if (etf === 'TLT') {
    return [
      { ticker: '30Y', weight: 42.0, sharesM: 18.4, sector: 'Treasury', country: 'United States' },
      { ticker: '20Y', weight: 31.4, sharesM: 12.1, sector: 'Treasury', country: 'United States' },
      { ticker: '10Y', weight: 16.2, sharesM: 9.6, sector: 'Treasury', country: 'United States' },
      { ticker: 'TIPS', weight: 10.4, sharesM: 4.2, sector: 'Treasury', country: 'United States' },
    ];
  }
  const pool = [...UNIVERSE].sort((a, b) => h01(`${etf}-${a.ticker}`) - h01(`${etf}-${b.ticker}`));
  return pool
    .slice(0, 12)
    .map((u, i) => ({
      ticker: u.ticker,
      weight: Number(Math.max(1.1, 14 - i * 0.9 + h01(`${etf}-w-${u.ticker}`) * 0.8).toFixed(1)),
      sharesM: Number(hRange(`${etf}-sh-${u.ticker}`, 1.2, 48).toFixed(1)),
      sector: u.sector,
      country: COUNTRY[u.ticker] ?? 'United States',
    }))
    .sort((a, b) => b.weight - a.weight);
}

export interface WeightSlice {
  name: string;
  weight: number;
}

export function weightSlices(rows: { name: string; weight: number }[]): WeightSlice[] {
  const map = new Map<string, number>();
  rows.forEach(r => map.set(r.name, (map.get(r.name) ?? 0) + r.weight));
  return [...map.entries()]
    .map(([name, weight]) => ({ name, weight: Number(weight.toFixed(1)) }))
    .sort((a, b) => b.weight - a.weight);
}

export function fundsHolding(ticker: string): { etf: string; name: string; weight: number; sharesM: number }[] {
  return ETFS.flatMap(e => {
    const hit = etfHoldings(e.etf).find(h => h.ticker === ticker);
    return hit ? [{ etf: e.etf, name: e.name, weight: hit.weight, sharesM: hit.sharesM }] : [];
  });
}

export interface SeasonRow {
  month: string;
  avgPct: number;
  winPct: number;
  years: number;
}

export interface TideRow {
  callPremB: number;
  putPremB: number;
  netB: number;
  bullishNames: number;
  bearishNames: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function seasonFor(ticker: string): SeasonRow {
  const month = MONTHS[new Date().getMonth()] ?? 'October';
  return {
    month,
    avgPct: Number(hRange(`${ticker}-sea-${month}`, -3.2, 4.4).toFixed(2)),
    winPct: Number(hRange(`${ticker}-win-${month}`, 38, 74).toFixed(0)),
    years: 10,
  };
}

export function marketTide(): TideRow {
  const day = dayKey();
  const callPremB = Number(hRange(`${day}-tide-c`, 18, 46).toFixed(2));
  const putPremB = Number(hRange(`${day}-tide-p`, 16, 44).toFixed(2));
  return {
    callPremB,
    putPremB,
    netB: Number((callPremB - putPremB).toFixed(2)),
    bullishNames: Math.round(hRange(`${day}-tide-b`, 140, 280)),
    bearishNames: Math.round(hRange(`${day}-tide-r`, 120, 260)),
  };
}

export interface FuturePrint {
  id: string;
  contract: string;
  time: string;
  price: number;
  size: number;
  side: 'buy' | 'sell';
}

const CONTRACTS = ['ESZ6', 'NQZ6', 'RTYZ6', 'CLZ6', 'GCZ6'] as const;

/** Which contracts are actually open in the session the desk is reading. */
const OPEN_THEN: Record<DeskSession, readonly (typeof CONTRACTS)[number][]> = {
  rth: CONTRACTS,
  pre: ['ESZ6', 'NQZ6', 'RTYZ6'],
  post: ['ESZ6', 'NQZ6'],
  overnight: ['ESZ6', 'NQZ6'],
};

export function buildFuturesTape(session: DeskSession = 'rth'): FuturePrint[] {
  const day = dayKey();
  const pool = OPEN_THEN[session];
  const span: Record<DeskSession, [number, number]> = {
    rth: [9 * 60 + 30, 16 * 60],
    pre: [7 * 60 + 30, 9 * 60 + 25],
    post: [16 * 60, 16 * 60 + 15],
    overnight: [20 * 60 + 15, 20 * 60 + 15 + 8 * 60],
  };
  const [open, close] = span[session];
  return Array.from({ length: 18 }, (_, i) => {
    const contract = hPick(`${day}-fc-${session}-${i}`, pool);
    const base = contract.startsWith('ES') ? 5820 : contract.startsWith('NQ') ? 20440 : contract.startsWith('RTY') ? 2210 : contract.startsWith('CL') ? 71.4 : 2688;
    const minute = open + Math.round(((close - open) * i) / 18);
    const hh = Math.floor(minute / 60) % 24;
    const mm = minute % 60;
    return {
      id: `${session}-${contract}-${i}`,
      contract,
      time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`,
      price: Number((base + hRange(`${day}-fp-${session}-${i}`, -6, 6)).toFixed(2)),
      size: Math.round(hRange(`${day}-fs-${session}-${i}`, 1, 80)),
      side: h01(`${day}-sd-${session}-${i}`) > 0.48 ? 'buy' : 'sell',
    };
  });
}

export interface RateRow {
  name: string;
  tenor: string;
  rate: number;
  changeBp: number;
}

export function buildRates(): RateRow[] {
  const day = dayKey();
  const rows: { name: string; tenor: string; base: number }[] = [
    { name: 'SOFR', tenor: 'overnight', base: 4.31 },
    { name: 'Treasury', tenor: '2 year', base: 3.92 },
    { name: 'Treasury', tenor: '10 year', base: 4.18 },
    { name: 'Treasury', tenor: '30 year', base: 4.46 },
  ];
  return rows.map(r => ({
    name: r.name,
    tenor: r.tenor,
    rate: Number((r.base + hRange(`${day}-rt-${r.tenor}`, -0.06, 0.06)).toFixed(3)),
    changeBp: Number(hRange(`${day}-bp-${r.tenor}`, -4, 4).toFixed(1)),
  }));
}

export interface SectorFlowRow {
  sector: string;
  buys: number;
  sales: number;
  netM: number;
}

const SECTORS = ['Technology', 'Financial Services', 'Healthcare', 'Energy', 'Industrials', 'Consumer'];

export function buildSectorFlow(): SectorFlowRow[] {
  const day = dayKey();
  return SECTORS.map(sector => {
    const buys = Math.round(hRange(`${day}-sb-${sector}`, 2, 18));
    const sales = Math.round(hRange(`${day}-ss-${sector}`, 4, 28));
    return { sector, buys, sales, netM: Number(hRange(`${day}-sn-${sector}`, -40, 22).toFixed(1)) };
  });
}

export interface HoldingRow {
  member: string;
  memberId: string;
  seat: string;
  ticker: string;
  /** The asset as filed, for an untickered holding */
  asset: string;
  key: string;
  bracket: string;
  owner: string;
}

/** One key per asset: a named stock by its symbol, an untickered asset by its own full name (a T-bill's maturity
    included) — an empty ticker let unrelated T-bills and LLCs cancel each other (the re-audit, 2026-10-22) */
export const holdingAssetKey = (t: CongressTrade): string => {
  const sym = (t.ticker || '').trim().toUpperCase();
  return sym ? `t:${sym}` : `a:${(t.assetDescription || '').trim().toLowerCase().replace(/\s+/g, ' ')}`;
};

/** Purchases with no sale of any kind of the same asset reported since — the vendor's bare "Sell" does not say full or
    partial, so any sale takes the line off rather than claiming what remains. The same roster as the tape. */
export function buildHoldings(source?: CongressTrade[]): HoldingRow[] {
  const trades = [...(source ?? [])].sort((a, b) => b.tradedDaysAgo - a.tradedDaysAgo);
  const open = new Map<string, (typeof trades)[number]>();
  for (const t of trades) {
    if (holdingAssetKey(t) === 'a:' || holdingAssetKey(t) === 'a:undisclosed') continue;
    const key = `${t.member.id}|${holdingAssetKey(t)}|${t.owner}`;
    if (t.type === 'Purchase') open.set(key, t);
    else if (t.type !== 'Exchange') open.delete(key);
  }
  return [...open.values()].slice(0, 16).map(t => ({
    member: t.member.name,
    memberId: t.member.id,
    seat: seatLabel(t.member),
    ticker: t.ticker,
    asset: t.assetDescription,
    key: `${t.member.id}|${holdingAssetKey(t)}|${t.owner}`,
    bracket: bracketLabel(t.bracket),
    owner: t.owner,
  }));
}