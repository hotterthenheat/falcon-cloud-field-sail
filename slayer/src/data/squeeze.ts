/*
  THE SQUEEZE READ (the retail pass, 2026-10-22). A retail reader looking at a short book wants one question answered:
  could the shorts be forced to buy back in a hurry? This file answers it with fixed, public rules on the fields
  Unusual Whales already sends — nothing is modelled and nothing is guessed. Every threshold below is also printed in
  the Shorts guide (components/record/FileGuides.tsx), so the page and the rule never drift apart.

  POINTS (more points, more pressure on the shorts) — RECALIBRATED (the re-audit, 2026-10-22): the Shorts screen is the
  200 heaviest names by share of the float, so every one already had 18%+ short and the old rungs (10% and 15%) called
  60 "strong" and 130 "building" of about 190. The rungs now sit above the screen's own floor, and strong needs several
  facts at once, including a tight borrow:
    Short interest, % of float   ≥ 40% → 3    ≥ 30% → 2    ≥ 20% → 1
    Days to cover                ≥ 10  → 2    ≥ 5   → 1
    Borrow fee, % a year         ≥ 50% → 2    ≥ 10% → 1
    Shares left to borrow        under 500K → 1
    Shares short vs prior report up 20% or more → 1
    Short volume, latest session ≥ 65% of volume → 1     (file page only)
    Fails to deliver, last 30d   a day of ≥ 0.1% of the float → 1   (file page only)

  THE WORD
    strong    6 points or more from at least three different facts, with 20%+ of the float short AND a tight borrow
              (a fee of 10%+ or under 500K shares left) — on the 2026-09-30 settlement, 2 of the 200
    building  4 points or more from at least two facts
    weak      anything else

  Short interest settles twice a month (the 15th and month-end) and FINRA publishes it about seven business days later,
  so the as-of date always rides with the read. It is marked stale only when a newer settlement should already be out
  (settlement + 11 calendar days has passed) and the figure is older than that one.
*/

import type { ShortRow } from './fileBooks';

/** 'fund': an ETF or other fund — not a squeeze candidate at all */
export type SqueezeWord = 'weak' | 'building' | 'strong' | 'fund';

export interface SqueezeFact {
  /** Plain words, e.g. "24% of the float is short" */
  text: string;
  points: number;
}

export interface SqueezeRead {
  word: SqueezeWord;
  points: number;
  /** The two or three facts that drive the word — the scoring ones first; for a weak read, what holds it back */
  facts: SqueezeFact[];
  /** The settlement date of the short-interest figure (YYYY-MM-DD), or null */
  asOf: string | null;
  /** True when a newer settlement should already be published */
  stale: boolean;
}

/** Extra facts only a name's own file carries */
export interface SqueezeExtras {
  /** Latest session's short volume as a percent of total volume */
  shortVolPct?: number | null;
  /** The largest single fail-to-deliver day in the last 30 days, in shares */
  maxFtdShares?: number | null;
}

const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;

const nyToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PUBLISH_LAG_DAYS = 11;

/** The newest settlement date whose figures should already be published, on New York's today */
export function latestPublishedSettlement(today = nyToday()): string {
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
export function shortChangePct(row: ShortRow): number | null {
  const prints = [...row.history].sort((a, b) => b.report.localeCompare(a.report));
  if (prints.length < 2 || !(prints[1].sharesM > 0)) return null;
  return ((prints[0].sharesM - prints[1].sharesM) / prints[1].sharesM) * 100;
}

export function squeezeRead(row: ShortRow, extras: SqueezeExtras = {}): SqueezeRead {
  const asOfFund = [...row.history].sort((a, b) => b.report.localeCompare(a.report))[0]?.report?.slice(0, 10) ?? null;
  /* A FUND IS NOT A SQUEEZE (the data audit, 2026-10-22): HYG and KBE read "squeeze building" — an ETF's short interest
     is market makers' creation and hedging, met by issuing new shares, so the rule does not apply to it at all */
  if (row.fund) {
    const expectedF = latestPublishedSettlement();
    const staleF = asOfFund ? Date.parse(`${asOfFund}T12:00:00Z`) < Date.parse(`${expectedF}T12:00:00Z`) - 3 * 86_400_000 : false;
    return { word: 'fund', points: 0, facts: [{ text: 'a fund — new shares are created to meet shorts, so no squeeze read', points: 0 }], asOf: asOfFund, stale: staleF };
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
  if (extras.shortVolPct != null) add(extras.shortVolPct >= 65 ? 1 : 0, `${pct(extras.shortVolPct, 0)} of the last session's volume was short sales`);
  if (extras.maxFtdShares != null && row.floatM > 0) {
    const ftdPct = (extras.maxFtdShares / (row.floatM * 1e6)) * 100;
    add(ftdPct >= 0.1 ? 1 : 0, `a day of ${Math.round(extras.maxFtdShares / 1000).toLocaleString('en-US')}K shares failed to deliver in the last 30 days`);
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
  return { word, points, facts: shown, asOf, stale };
}

export const SQUEEZE_INK: Record<SqueezeWord, string> = { weak: 'text-textSecondary', building: 'text-warn', strong: 'text-bear', fund: 'text-textMuted' };

export const SQUEEZE_TIP =
  'A rule-based read, not a forecast. Points: short interest ≥40% of float 3 (≥30% 2, ≥20% 1) · days to cover ≥10 2 (≥5 1) · borrow fee ≥50%/yr 2 (≥10% 1) · under 500K shares left to borrow 1 · shares short up 20%+ since the prior report 1 (a name\'s file adds: short volume ≥65% of the last session 1, a fail-to-deliver day ≥0.1% of the float 1). Strong: 6+ points from three or more facts, 20%+ of the float short and a tight borrow (fee 10%+ or under 500K left). Building: 4+ points from two or more facts. Weak: the rest. A fund (an ETF) gets no read: its shorts are met by creating new shares.';
