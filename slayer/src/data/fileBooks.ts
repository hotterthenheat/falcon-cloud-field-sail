/* The types and helpers behind the Institutions, Shorts and ETF books and Congress's holdings face. Every row comes
   off the vendor (liveFiles.ts, liveRecord.ts); nothing here is invented. */

import { bracketLabel, seatLabel } from './congress';
import type { CongressTrade } from '../types/record';

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
  /** Where the short volume was read: the vendor's short volume and ratio, or the by-market rows (FINRA CNMS) when that
      read came back empty */
  shortVolSource?: string;
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

/** One key per asset: a named stock by its symbol, an untickered asset by its full name (a T-bill's maturity included) */
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
/* Every vendor sector spelling in the house's GICS-style words; a word that is not a sector ("Cash") is left as is. */
const HOUSE_SECTOR: Record<string, string> = {
  technology: 'Technology',
  'information technology': 'Technology',
  'communication services': 'Communication',
  communication: 'Communication',
  telecommunications: 'Communication',
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
  'real estate': 'Real Estate',
};
export const houseSector = (raw: string | null | undefined): string => {
  const t = (raw ?? '').trim();
  return t ? HOUSE_SECTOR[t.toLowerCase()] ?? t : t;
};
