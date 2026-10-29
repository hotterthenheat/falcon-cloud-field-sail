/* One squeeze rule for the Shorts list and a name's file; the rungs are printed in the Shorts guide. Short
   volume and fails to deliver are shown beside the read, never scored. */

import type { ShortRow } from './fileBooks';

/** 'fund': an ETF or other fund — not a squeeze candidate at all */
type SqueezeWord = 'weak' | 'building' | 'strong' | 'fund';

interface SqueezeFact {
  /** Plain words, e.g. "24% of the float is short" */
  text: string;
  points: number;
}

interface SqueezeRead {
  word: SqueezeWord;
  points: number;
  /** The two or three facts that drive the word — the scoring ones first; for a weak read, what holds it back */
  facts: SqueezeFact[];
  /** Facts a name's file adds beside the read (short volume, fails to deliver) — shown, not scored */
  context: SqueezeFact[];
  /** The settlement date of the short-interest figure (YYYY-MM-DD), or null */
  asOf: string | null;
  /** True when a newer settlement should already be published */
  stale: boolean;
}

/** Facts only a name's own file carries; shown beside the read, never scored */
interface SqueezeExtras {
  /** Latest session's short volume as a percent of the OFF-EXCHANGE volume FINRA reports (its own ratio) */
  shortVolPct?: number | null;
  /** The same short volume as a percent of the session's full volume (the screener's day volume, same session) */
  shortVolFullPct?: number | null;
  /** The largest single fail-to-deliver day in the last 30 days, in shares */
  maxFtdShares?: number | null;
}

const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PUBLISH_LAG_DAYS = 11;

/** The newest settlement date whose figures should already be published, on New York's today */
function latestPublishedSettlement(today = nyToday()): string {
  const t = Date.parse(`${today}T12:00:00Z`);
  const [y, m] = today.split('-').map(Number);
  const candidates: string[] = [];
  for (let k = 0; k < 3; k++) {
    const yy = y + Math.floor((m - 1 - k) / 12);
    const mm = (((m - 1 - k) % 12) + 12) % 12;
    candidates.push(iso(new Date(Date.UTC(yy, mm + 1, 0, 12))), iso(new Date(Date.UTC(yy, mm, 15, 12))));
  }
  return candidates.sort().reverse().find(c => Date.parse(`${c}T12:00:00Z`) + PUBLISH_LAG_DAYS * 86_400_000 <= t) ?? candidates[candidates.length - 1];
}

/** The prior report's change in shares short, percent — from the two settlements the screener sends */
function shortChangePct(row: ShortRow): number | null {
  const prints = [...row.history].sort((a, b) => b.report.localeCompare(a.report));
  if (prints.length < 2 || !(prints[1].sharesM > 0)) return null;
  return ((prints[0].sharesM - prints[1].sharesM) / prints[1].sharesM) * 100;
}

export function squeezeRead(row: ShortRow, extras: SqueezeExtras = {}): SqueezeRead {
  const asOfFund = [...row.history].sort((a, b) => b.report.localeCompare(a.report))[0]?.report?.slice(0, 10) ?? null;
  /* a fund's short interest is creation and hedging, met by issuing new shares: no squeeze read */
  if (row.fund) {
    const expectedF = latestPublishedSettlement();
    const staleF = asOfFund ? Date.parse(`${asOfFund}T12:00:00Z`) < Date.parse(`${expectedF}T12:00:00Z`) - 3 * 86_400_000 : false;
    return { word: 'fund', points: 0, facts: [{ text: 'a fund — new shares are created to meet shorts, so no squeeze read', points: 0 }], context: [], asOf: asOfFund, stale: staleF };
  }
  const facts: SqueezeFact[] = [];
  const quiet: SqueezeFact[] = [];
  const add = (points: number, text: string, quietText?: string) => {
    if (points > 0) facts.push({ text, points });
    else if (quietText) quiet.push({ text: quietText, points: 0 });
  };
  const si = row.interestPct;
  add(si >= 40 ? 3 : si >= 30 ? 2 : si >= 20 ? 1 : 0, `${pct(si)} of the float is short`, `${pct(si)} of the float is short — under the 20% rung`);
  const dtc = row.daysToCover;
  /* two places near a threshold, so 3.98 never reads "4.0" beside a rule that starts at 4 */
  const dtcText = dtc.toFixed(dtc < 10 ? 2 : 1);
  if (dtc > 0) add(dtc >= 10 ? 2 : dtc >= 5 ? 1 : 0, `${dtcText} days of normal volume to buy it back`, `shorts can cover in ${dtcText} days`);
  if (row.feeRate != null) add(row.feeRate >= 50 ? 2 : row.feeRate >= 10 ? 1 : 0, `borrowing costs ${pct(row.feeRate)} a year`, `cheap to borrow at ${pct(row.feeRate, 2)} a year`);
  if (row.availableM != null) add(row.availableM < 0.5 ? 1 : 0, `only ${row.availableM >= 0.1 ? `${row.availableM.toFixed(2)}M` : `${Math.round(row.availableM * 1000)}K`} shares left to borrow`, row.availableM >= 10 - 1e-9 ? 'plenty of shares left to borrow (10M+)' : undefined);
  const change = row.changePct ?? shortChangePct(row);
  if (change != null) add(change >= 20 ? 1 : 0, `shares short up ${pct(change, 0)} since the prior report`, change <= -10 ? `shares short down ${pct(Math.abs(change), 0)} since the prior report` : undefined);
  const context: SqueezeFact[] = [];
  if (extras.shortVolFullPct != null) {
    const off = extras.shortVolPct != null ? `${pct(extras.shortVolPct, 0)} of off-exchange volume was short sales, ` : '';
    context.push({ text: `${off}${pct(extras.shortVolFullPct, 0)} of the last session's full volume`, points: 0 });
  }
  if (extras.maxFtdShares != null && extras.maxFtdShares > 0 && row.floatM > 0) {
    context.push({ text: `the largest fail-to-deliver day in 30 days: ${Math.round(extras.maxFtdShares / 1000).toLocaleString('en-US')}K shares`, points: 0 });
  }
  const points = facts.reduce((s, f) => s + f.points, 0);
  const tight = (row.feeRate != null && row.feeRate >= 10) || (row.availableM != null && row.availableM < 0.5);
  const word: SqueezeWord = points >= 6 && facts.length >= 3 && si >= 20 && tight ? 'strong' : points >= 4 && facts.length >= 2 ? 'building' : 'weak';
  const drivers = [...facts].sort((a, b) => b.points - a.points);
  /* a weak read names what scored, then what holds it back; the others name what drives them */
  const shown = word === 'weak' ? [...drivers.slice(0, 1), ...quiet].slice(0, 3) : drivers.slice(0, 3);
  const asOf = [...row.history].sort((a, b) => b.report.localeCompare(a.report))[0]?.report?.slice(0, 10) ?? null;
  /* settlement dates drift a day or two around weekends, so a figure within three days of the expected one is current */
  const expected = latestPublishedSettlement();
  const stale = asOf ? Date.parse(`${asOf}T12:00:00Z`) < Date.parse(`${expected}T12:00:00Z`) - 3 * 86_400_000 : false;
  return { word, points, facts: shown, context, asOf, stale };
}

export const SQUEEZE_INK: Record<SqueezeWord, string> = { weak: 'text-textSecondary', building: 'text-warn', strong: 'text-bear', fund: 'text-textMuted' };

export const SQUEEZE_TIP = 'A rule-based setup, not a forecast: short interest, days to cover, the borrow and the change in shares short. The rules are in the guide.';
