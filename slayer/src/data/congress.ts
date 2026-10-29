/* STOCK Act reports: amounts are brackets (a total is a low–high range, open-topped above the last rung), the owner is
   on every row, and the lag from trade to filing is a column against the 45-day deadline. */

import type { AmountBracket, CongressFeed, CongressTrade } from '../types/record';

/** The ten statutory rungs, in the form's checkbox order A–J */
export const AMOUNT_BRACKETS: AmountBracket[] = [
  { column: 'A', low: 1_001, high: 15_000, label: '$1,001 – $15,000' },
  { column: 'B', low: 15_001, high: 50_000, label: '$15,001 – $50,000' },
  { column: 'C', low: 50_001, high: 100_000, label: '$50,001 – $100,000' },
  { column: 'D', low: 100_001, high: 250_000, label: '$100,001 – $250,000' },
  { column: 'E', low: 250_001, high: 500_000, label: '$250,001 – $500,000' },
  { column: 'F', low: 500_001, high: 1_000_000, label: '$500,001 – $1,000,000' },
  { column: 'G', low: 1_000_001, high: 5_000_000, label: '$1,000,001 – $5,000,000' },
  { column: 'H', low: 5_000_001, high: 25_000_000, label: '$5,000,001 – $25,000,000' },
  { column: 'I', low: 25_000_001, high: 50_000_000, label: '$25,000,001 – $50,000,000' },
  { column: 'J', low: 50_000_001, high: null, label: 'Over $50,000,000' },
];
/** The STOCK Act's outer bound: no later than 45 days after the trade */
export const STOCK_ACT_DEADLINE_DAYS = 45;

/** A bracket's label, with the unparsed case named rather than blanked */
export const bracketLabel = (i: number | null): string => (i === null ? 'not disclosed' : AMOUNT_BRACKETS[i].label);
const kShort = (v: number) => (v >= 1_000_000 ? `$${v / 1_000_000}M` : `$${Math.round(v / 1_000)}K`);
/** The bracket in short form for the cards ("$250K – $500K"): the full rungs ran past a card at six across */
export const bracketShort = (i: number | null): string => {
  if (i === null) return 'not disclosed';
  const b = AMOUNT_BRACKETS[i];
  return b.high == null ? `Over ${kShort(b.low - 1)}` : `${kShort(b.low - 1)} – ${kShort(b.high)}`;
};

export const EMPTY_CONGRESS: CongressFeed = { trades: [], totalLow: 0, totalHigh: 0, unknownAmounts: 0, purchases: 0, sales: 0, lateFilings: 0, medianLag: 0, windowDays: 0 };

/** A Treasury bill report: parked cash, not an equity bet. The pages hide them by default and count them. */
export const isTreasuryBill = (t: CongressTrade): boolean => {
  const d = `${t.assetDescription || ''} ${t.ticker || ''}`;
  /* the filers' own spellings: Treasury, Treas, Tres or Trsy, then Bill(s) */
  return /\b(?:treasury|treas|tres|trsy|tsy)\.?\s*bills?\b|\bt-?bills?\b|\bus treasury bill|\bunited states treasury bill/i.test(d);
};

/* A note, bond, municipal or asset-backed report is counted apart from the stock-focused figures, and said apart. */
export const isBondReport = (t: CongressTrade): boolean => {
  if (isTreasuryBill(t)) return false;
  if (t.assetKind === 'Corporate Bond' || t.assetKind === 'Municipal Security' || t.assetKind === 'Asset-Backed Security') return true;
  if (t.assetKind !== 'Other') return false;
  const d = `${t.assetDescription || ''} ${t.ticker || ''}`;
  return /\b(?:treasury|treas|tres|trsy|tsy|govt|government|agency|fnma|fhlmc|fhlb|gnma|freddie|fannie)\b[^\n]{0,40}\b(?:notes?|bonds?|tips|strips|debentures?)\b|\b(?:notes?|bonds?)\b[^\n]{0,20}\b(?:due|mat(?:ures)?)\b|\b\d+(?:\.\d+)?%\s/i.test(d);
};

/** The feed's figures over any set of reports — the page re-sums whatever its cards leave */
export function summariseCongress(trades: CongressTrade[], windowDays: number): CongressFeed {
  let totalLow = 0;
  let totalHigh: number | null = 0;
  let unknownAmounts = 0;
  let purchases = 0;
  let sales = 0;
  let lateFilings = 0;
  for (const t of trades) {
    if (t.bracket === null) unknownAmounts += 1;
    else {
      const b = AMOUNT_BRACKETS[t.bracket];
      totalLow += t.amountOver != null ? t.amountOver + 1 : b.low;
      /* An open-ended top rung — or an open-ended amount as filed ("over $1,000,000") — makes the ceiling unknowable */
      if (totalHigh !== null) totalHigh = b.high === null || t.amountOver != null ? null : totalHigh + b.high;
    }
    if (t.type === 'Purchase') purchases += 1;
    else if (t.type !== 'Exchange') sales += 1;
    if (t.late) lateFilings += 1;
  }
  const lags = trades.map(t => t.lagDays).sort((a, b) => a - b);
  const medianLag = lags.length === 0 ? 0 : lags[Math.floor(lags.length / 2)];
  return { trades, totalLow, totalHigh, unknownAmounts, purchases, sales, lateFilings, medianLag, windowDays };
}

const fmtMoney = (v: number) => `$${v.toLocaleString('en-US')}`;

/** The feed's sentence — the brackets summed, the late ones counted */
export function congressSentence(f: CongressFeed): string {
  if (f.trades.length === 0) return `No report on this cut of trades made in the last ${f.windowDays} days.`;
  const range = f.totalHigh === null ? `at least ${fmtMoney(f.totalLow)}` : `between ${fmtMoney(f.totalLow)} and ${fmtMoney(f.totalHigh)}`;
  const parts = [`${f.trades.length.toLocaleString('en-US')} reports covering ${range} — the brackets summed, not a point estimate.`];
  if (f.lateFilings > 0) parts.push(`${f.lateFilings.toLocaleString('en-US')} missed the 45-day deadline.`);
  if (f.unknownAmounts > 0) parts.push(`${f.unknownAmounts.toLocaleString('en-US')} carried no amount the filing could be read for.`);
  return parts.join(' ');
}

/** A member's seat as one short tag — "R-AR", "D-TX-35", "R" — joining only what the roster knows ("I-" and "-AR" never) */
export const seatLabel = (m: { party: string; state?: string; district?: string | null }): string =>
  [m.party, m.district || m.state].filter(Boolean).join('-');
