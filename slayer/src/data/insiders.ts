/* Insider filings: most selling is on a 10b5-1 plan and carries no view; a purchase someone chose has one obvious
   motive. Grants, conversions and withholdings are kept one toggle away from the trades. */

import { dollars3 } from '../pages/record/money';
import type { InsiderFlow, InsiderSignal, InsiderTrade, PlanState, TxCode, TxCodeMeta } from '../types/record';

export const TX_CODES: Record<TxCode, TxCodeMeta> = {
  P: { code: 'P', label: 'Purchase', discretionary: true, openMarket: true, acquires: true, note: 'A purchase on the open market or in a private placement, at a price the buyer accepted. Bought by a person, it is the one row here with a single obvious motive behind it; bought by a company or fund, it is a strategic stake and is counted apart.' },
  S: { code: 'S', label: 'Open-market sale', discretionary: true, openMarket: true, acquires: false, note: 'A real sale into the market — though a sale has many motives a purchase does not: tax, diversification, a house.' },
  A: { code: 'A', label: 'Grant or award', discretionary: false, openMarket: false, acquires: true, note: 'The compensation committee acted, not the insider. No decision, no purchase, no price paid.' },
  M: { code: 'M', label: 'Option or RSU conversion', discretionary: false, openMarket: false, acquires: true, note: 'A derivative converting to shares under a plan. Mechanical — a sale the same day is usually funding the exercise, not an exit.' },
  F: { code: 'F', label: 'Shares withheld for tax', discretionary: false, openMarket: false, acquires: false, note: 'Shares withheld at vesting to cover withholding. They never reached the market; the price shown is the valuation used to compute it.' },
  G: { code: 'G', label: 'Gift', discretionary: true, openMarket: false, acquires: false, note: 'Chosen, but not a market transaction and no proceeds.' },
  D: { code: 'D', label: 'Returned to the company', discretionary: false, openMarket: false, acquires: false, note: 'Shares returned to the issuer under a plan — a buyback or a settlement, not a market sale.' },
};
export const OPEN_MARKET_CODES: TxCode[] = ['P', 'S'];
export const ALL_CODES: TxCode[] = ['P', 'S', 'A', 'M', 'F', 'G', 'D'];

/** An open-market buy someone chose: the filing ticked "not a 10b5-1 plan". A planned or unstated buy is not counted. */
export const isChosenBuy = (t: { code: TxCode; plan: PlanState; entity?: boolean }): boolean => {
  const m = TX_CODES[t.code];
  /* a company or fund buying (a strategic stake, a private placement) is counted apart as a corporate purchase */
  return m.openMarket && m.acquires && m.discretionary && t.plan === 'discretionary' && !t.entity;
};

/** A code-P purchase by a company or a fund: a strategic stake or a private placement, not a person's chosen buy */
export const isCorporateBuy = (t: { code: TxCode; entity?: boolean }): boolean => t.code === 'P' && !!t.entity;
/** An open-market trade either way by a company or fund; its sales are classed the same way as its buys */
export const isCorporateTrade = (t: { code: TxCode; entity?: boolean }): boolean => !!t.entity && !!TX_CODES[t.code]?.openMarket;

/** Roll a set of filings into the window's totals and its signal */
export function summariseFlow(ticker: string, trades: InsiderTrade[], windowDays: number): InsiderFlow {
  let bought = 0;
  let sold = 0;
  let plannedValue = 0;
  let openMarketBuys = 0;
  let compValue = 0;
  let chosenSold = 0;
  for (const t of trades) {
    const meta = TX_CODES[t.code];
    if (!meta) continue;
    if (meta.openMarket) {
      if (t.kind === 'BUY') {
        bought += t.value;
        if (isChosenBuy(t)) openMarketBuys += t.value;
      } else {
        sold += t.value;
        if (t.plan === 'discretionary' && !t.entity) chosenSold += t.value;
      }
      if (t.plan === 'plan' && t.kind === 'SELL') plannedValue += t.value;
    } else compValue += t.value;
  }
  const net = bought - sold;
  /* chosen on one rule both ways: only what the filing marks chosen counts, buys and sales alike */
  const discretionarySold = chosenSold;
  let signal: InsiderSignal = 'quiet';
  /* chosen buying and chosen selling within a tenth of each other is flat */
  const evenly = openMarketBuys > 0 && discretionarySold > 0 && Math.abs(openMarketBuys - discretionarySold) <= 0.1 * Math.max(openMarketBuys, discretionarySold);
  if (trades.length === 0) signal = 'quiet';
  else if (evenly) signal = 'flat';
  else if (openMarketBuys > 0 && openMarketBuys >= discretionarySold) signal = 'accumulating';
  else if (discretionarySold > 0 && discretionarySold >= sold * 0.4) signal = 'distributing';
  else if (sold > 0) signal = 'scheduled selling';
  const recentBuyers = new Set(trades.filter(t => t.code === 'P' && t.daysAgo <= 30).map(t => t.person));
  return { ticker, trades, bought, sold, net, plannedValue, compValue, buyerCluster: recentBuyers.size, openMarketBuys, chosenSold, signal, windowDays };
}

/** A stable address for a person. Names are unique across the book. */
export const personSlug = (name: string) =>
  name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const fmtM = dollars3;

/** When the smaller sales cover less of the window than the large ones: the cut and the days the smaller ones cover */
export interface SalesSplit {
  /** Sales of this value or more are read over the whole window */
  big: number;
  /** The smaller sales are only the latest filings', from this day to that (YYYY-MM-DD) */
  from: string;
  to: string;
}
const dayWord = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
/** The cut as said: "$1M", never "$1.00M" */
export const bigWord = (v: number): string => (v >= 1e6 && v % 1e6 === 0 ? `$${v / 1e6}M` : fmtM(v));
/** "Oct 21–22", "Sep 30–Oct 2" */
export const spanWords = (from: string, to: string): string => {
  if (from === to) return dayWord(from);
  const a = dayWord(from);
  const b = dayWord(to);
  return a.split(' ')[0] === b.split(' ')[0] ? `${a}–${b.split(' ')[1]}` : `${a}–${b}`;
};
export const splitWords = (split: SalesSplit, windowDays: number): string => `sales of ${bigWord(split.big)}+ over ${windowDays} days, smaller sales ${spanWords(split.from, split.to)} only`;

/** What the window adds up to across the feed shown */
export function insidersSentence(rows: InsiderTrade[], windowDays: number, split: SalesSplit | null = null): string {
  if (rows.length === 0) return `No insider filed a trade in the last ${windowDays} days.`;
  const market = rows.filter(t => TX_CODES[t.code].openMarket);
  const chosenBuys = market.filter(t => isChosenBuy(t));
  const allSales = market.filter(t => t.kind === 'SELL');
  /* When the large and small sales cover different spans, the figure is the large sales' and the smaller are said apart. */
  const sales = split ? allSales.filter(t => t.value >= split.big) : allSales;
  const small = split ? allSales.filter(t => t.value < split.big) : [];
  const planned = sales.filter(t => t.plan === 'plan');
  const buyValue = chosenBuys.reduce((s, t) => s + t.value, 0);
  const saleValue = sales.reduce((s, t) => s + t.value, 0);
  const byName = new Map<string, number>();
  for (const t of chosenBuys) byName.set(t.ticker, (byName.get(t.ticker) ?? 0) + t.value);
  const ranked = [...byName.entries()].sort((a, b) => b[1] - a[1]);
  const names = ranked.slice(0, 4).map(([n]) => n);
  const rest = ranked.length - names.length;
  const parts: string[] = [];
  if (chosenBuys.length) parts.push(`${chosenBuys.length.toLocaleString('en-US')} ${chosenBuys.length === 1 ? 'purchase' : 'purchases'} someone chose to make, ${fmtM(buyValue)} — the most in ${names.join(', ')}${rest > 0 ? ` and ${rest.toLocaleString('en-US')} more ${rest === 1 ? 'name' : 'names'}` : ''}. These are the rows on this page with one obvious motive.`);
  else parts.push('No insider chose to buy in this window.');
  if (sales.length) {
    const pct = Math.round((planned.length / sales.length) * 100);
    parts.push(`${sales.length.toLocaleString('en-US')} ${split ? `sales of ${bigWord(split.big)} or more` : sales.length === 1 ? 'sale' : 'sales'} for ${fmtM(saleValue)}, ${pct}% of them on a 10b5-1 plan adopted months earlier — those carry no view on the day.`);
  }
  if (split && small.length) parts.push(`Smaller sales are read for ${spanWords(split.from, split.to)} only: ${small.length.toLocaleString('en-US')} for ${fmtM(small.reduce((s, t) => s + t.value, 0))}, kept out of the figure above.`);
  const plumbing = rows.length - market.length;
  if (plumbing) parts.push(`${plumbing.toLocaleString('en-US')} grants, conversions and withholdings shown — not trades.`);
  return parts.join(' ');
}
