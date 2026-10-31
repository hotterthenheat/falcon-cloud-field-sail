/* The flow pane's arithmetic: which option prints pass the pane's filters, which way each one reads, and the signed net
   premium of the passing prints in each bar of the chart. Pure — no React, no fetch — so a proof can hold it to numbers.

   THE SIGN is the tape's own (data/tape.ts sentimentOf): a call bought at the ask or a put sold at the bid reads up, a
   put bought at the ask or a call sold at the bid reads down; a mid print, an extended-hours print, compression and a
   leg of a multi-leg order read neither and add nothing.

   THE BARS are the chart's own: a print lands in the bar whose open is the last at or before its fill and whose span
   holds it, so an hour bar opened at 9:30 takes 9:30–10:29 and a print in a session gap lands nowhere. */

import type { FlowPrint } from '../types/trace';
import type { FlowFilters } from './deskPrefs';
import type { TapeQuery } from './traceLive';
import { sentimentOf } from './tape';

const PREM_FLOOR: Record<FlowFilters['prem'], number> = { '50k': 50_000, '250k': 250_000, all: 0 };
const DTE_CAP: Record<FlowFilters['dte'], number | null> = { '14': 14, '60': 60, all: null };

/** The filters as the option tape's own query — the vendor narrows the page, so a page of it reaches further back */
export function flowQuery(ticker: string, f: FlowFilters): TapeQuery {
  return {
    ticker,
    single: f.leg === 'single',
    otm: f.mny === 'otm',
    side: f.side === 'ask' ? 'ASK' : null,
    codes: f.kind === 'sweep' ? ['isoi'] : undefined,
    minDte: DTE_CAP[f.dte] != null ? 0 : null,
    maxDte: DTE_CAP[f.dte],
    minPremium: PREM_FLOOR[f.prem] || undefined,
  };
}

/** One key per filter set, for stores and caches */
export const flowKey = (f: FlowFilters): string => `${f.leg}|${f.mny}|${f.side}|${f.kind}|${f.dte}|${f.prem}`;

/** Does a print pass the filters — the same narrowing the query asks of the vendor, held again here for prints that
    came from elsewhere (the tape Trace already read) */
export function passesFlow(p: FlowPrint, f: FlowFilters): boolean {
  if (f.leg === 'single' && p.legs > 1) return false;
  if (f.mny === 'otm' && !(p.otmPct > 0)) return false;
  if (f.side === 'ask' && p.side !== 'ASK') return false;
  if (f.kind === 'sweep' && !p.sweep) return false;
  const cap = DTE_CAP[f.dte];
  if (cap != null && !(p.dte >= 0 && p.dte <= cap)) return false;
  if (!(p.premium >= PREM_FLOOR[f.prem])) return false;
  return true;
}

/** Which way a print reads on the pane: +1 up, −1 down, 0 neither */
export function flowSign(p: FlowPrint): 1 | -1 | 0 {
  const s = sentimentOf(p);
  return s === 'BULLISH' ? 1 : s === 'BEARISH' ? -1 : 0;
}

export interface SignedFlowBar {
  /** the bar's open, unix seconds */
  time: number;
  /** up premium less down premium, dollars */
  net: number;
  up: number;
  down: number;
  count: number;
}

/**
 * The signed net premium of `prints` in each of the chart's bars (`barTimes`, unix seconds, oldest first, each bar
 * `barSec` long at most). Every bar is returned, a quiet one at zero, so the pane's bars line up with the candles.
 */
export function signedFlowBars(prints: readonly FlowPrint[], barTimes: readonly number[], barSec: number): SignedFlowBar[] {
  const out: SignedFlowBar[] = barTimes.map(time => ({ time, net: 0, up: 0, down: 0, count: 0 }));
  const n = barTimes.length;
  if (!n) return out;
  for (const p of prints) {
    const ms = p.epochMs ?? (p.epoch != null ? p.epoch * 1000 : 0);
    if (!(ms > 0) || !(p.premium > 0)) continue;
    const sign = flowSign(p);
    if (sign === 0) continue;
    const t = ms / 1000;
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (barTimes[m] <= t) lo = m + 1;
      else hi = m;
    }
    const i = lo - 1;
    if (i < 0) continue;
    const span = i + 1 < n ? Math.min(barSec, barTimes[i + 1] - barTimes[i]) : barSec;
    if (t >= barTimes[i] + span) continue;
    const b = out[i];
    if (sign > 0) b.up += p.premium;
    else b.down += p.premium;
    b.net = b.up - b.down;
    b.count += 1;
  }
  return out;
}

/** The pane's caption, the way the filters read: "FLOW · SINGLE LEG · OTM · ASK · SWEEP · DTE 0–14 · ≥$50K" */
export function flowCaption(f: FlowFilters): string {
  const parts = ['FLOW'];
  parts.push(f.leg === 'single' ? 'SINGLE LEG' : 'ALL LEGS');
  if (f.mny === 'otm') parts.push('OTM');
  if (f.side === 'ask') parts.push('ASK');
  if (f.kind === 'sweep') parts.push('SWEEP');
  parts.push(f.dte === 'all' ? 'ANY DTE' : `DTE 0–${f.dte}`);
  if (f.prem !== 'all') parts.push(f.prem === '50k' ? '≥$50K' : '≥$250K');
  return parts.join(' · ');
}

/** The chips, each a filter and its two or three settings, in caption order */
export const FLOW_CHIPS: readonly { key: keyof FlowFilters; options: readonly { value: string; label: string; short: string }[]; hint: string }[] = [
  { key: 'leg', options: [{ value: 'single', label: 'Single leg', short: '1-leg' }, { value: 'all', label: 'All legs', short: 'legs' }], hint: 'Single-leg prints only, or legs of multi-leg orders too (a leg reads neither way)' },
  { key: 'mny', options: [{ value: 'otm', label: 'OTM', short: 'OTM' }, { value: 'all', label: 'Any strike', short: 'any K' }], hint: 'Out of the money only, or every strike' },
  { key: 'side', options: [{ value: 'ask', label: 'Ask', short: 'ask' }, { value: 'all', label: 'Both sides', short: 'a+b' }], hint: 'At the ask only, or the bid as well (a call sold at the bid reads down, a put sold there up)' },
  { key: 'kind', options: [{ value: 'sweep', label: 'Sweep', short: 'swp' }, { value: 'all', label: 'Any print', short: 'all' }], hint: 'Sweeps only, or every print' },
  { key: 'dte', options: [{ value: '14', label: 'DTE 0–14', short: '≤14d' }, { value: '60', label: 'DTE 0–60', short: '≤60d' }, { value: 'all', label: 'Any DTE', short: 'any d' }], hint: 'Days to expiry' },
  { key: 'prem', options: [{ value: '50k', label: '≥$50K', short: '50K+' }, { value: '250k', label: '≥$250K', short: '250K+' }, { value: 'all', label: 'Any size', short: 'any $' }], hint: "A print's premium, at least" },
];
