/* The flow pane's arithmetic: which option prints pass the pane's filters, which way each one reads, and the signed net
   premium of the passing prints in each bar of the chart. Pure — no React, no fetch — so a proof can hold it to numbers.

   THE SIGN is the tape's own (data/tape.ts sentimentOf): a call bought at the ask or a put sold at the bid reads up, a
   put bought at the ask or a call sold at the bid reads down, on a print that likely opened new positions (tape.ts
   printOpens); a print that may be closing, a mid print, an extended-hours print, compression and a leg of a
   multi-leg order read neither and add nothing — unless the reader counts the legs (the Legs chip, or the Spread legs
   type): then a leg leans by its own side like any print.

   THE TYPE of a print (data/printTags.ts): a sweep, a spread leg, a floor print, a block or a single. The server's tape
   tags each print off its conditions; a print from the vendor's tape is typed from what that tape says of it (its sweep
   flag, its multi-leg legs, a floor package, the block line).

   THE BARS are the chart's own: a print lands in the bar whose open is the last at or before its fill and whose span
   holds it, so an hour bar opened at 9:30 takes 9:30–10:29 and a print in a session gap lands nowhere. */

import type { FlowPrint } from '../types/trace';
import type { FlowFilters } from './deskPrefs';
import type { TapeQuery } from './traceLive';
import { isBlockSized, isSpreadLeg, printOpens, sentimentOf } from './tape';
import { hasType, type OptionTags } from './printTags';

const PREM_FLOOR: Record<FlowFilters['prem'], number> = { '50k': 50_000, '250k': 250_000, all: 0 };
const DTE_CAP: Record<FlowFilters['dte'], number | null> = { '14': 14, '60': 60, all: null };

/** The filters as the option tape's own query — the vendor narrows the page, so a page of it reaches further back */
export function flowQuery(ticker: string, f: FlowFilters): TapeQuery {
  return {
    ticker,
    /* legs left out of the net add nothing to a bar: the vendor may leave them out of the page too */
    single: f.leg === 'single' && f.kind !== 'leg' && f.kind !== 'floor',
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

/** A print with the server tape's tags, or a minute of its small prints folded into one row */
type Tagged = FlowPrint & { tapeTags?: OptionTags; aggregate?: number };

/** A print's tags: the server tape's own, else read off what the vendor's tape says of it */
export function tagsOfPrint(p: FlowPrint): OptionTags {
  const own = (p as Tagged).tapeTags;
  if (own) return own;
  const leg = isSpreadLeg(p);
  return { sweep: !!p.sweep, leg, floor: !!p.floorPackage, block: !leg && isBlockSized(p) };
}

/** Do the legs of multi-leg orders lean in the net: the reader counted them in, or is looking at nothing else */
export const legsInNet = (f: FlowFilters): boolean => f.leg === 'all' || f.kind === 'leg';

/** Does a print pass the filters — the same narrowing the query asks of the vendor, held again here for prints that
    came from elsewhere (the tape Trace already read, the server's tape) */
export function passesFlow(p: FlowPrint, f: FlowFilters): boolean {
  if (f.mny === 'otm' && !(p.otmPct > 0)) return false;
  if (f.side === 'ask' && p.side !== 'ASK') return false;
  if (f.kind !== 'all' && !hasType(tagsOfPrint(p), f.kind)) return false;
  const cap = DTE_CAP[f.dte];
  if (cap != null && !(p.dte >= 0 && p.dte <= cap)) return false;
  /* a folded minute holds only prints under the smallest floor: in at any size, out under a floor */
  if ((p as Tagged).aggregate != null) return f.prem === 'all';
  if (!(p.premium >= PREM_FLOOR[f.prem])) return false;
  return true;
}

/** Which way a print reads on the pane: +1 up, −1 down, 0 neither. With `legs`, a leg of a multi-leg order leans by its
    own side like any other print (still only where it likely opened, never at the mid or after hours). */
export function flowSign(p: FlowPrint, legs = false): 1 | -1 | 0 {
  if (legs && isSpreadLeg(p)) {
    /* a cross trade and a print on a crossed or stale quote have no side; the vendor's tape already marks them MID
       (traceRows printSideOf) and the server tape's quote read does the same, but a print that kept its flag with a
       side from elsewhere still reads neither */
    if (p.side === 'MID' || p.cross || p.quoteNoRead || p.extended || p.compression || !printOpens(p)) return 0;
    return (p.right === 'C' && p.side === 'ASK') || (p.right === 'P' && p.side === 'BID') ? 1 : -1;
  }
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
export function signedFlowBars(prints: readonly FlowPrint[], barTimes: readonly number[], barSec: number, legs = false): SignedFlowBar[] {
  const out: SignedFlowBar[] = barTimes.map(time => ({ time, net: 0, up: 0, down: 0, count: 0 }));
  const n = barTimes.length;
  if (!n) return out;
  for (const p of prints) {
    const ms = p.epochMs ?? (p.epoch != null ? p.epoch * 1000 : 0);
    if (!(ms > 0) || !(p.premium > 0)) continue;
    const sign = flowSign(p, legs);
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

const KIND_CAPTION: Record<Exclude<FlowFilters['kind'], 'all'>, string> = { sweep: 'SWEEPS', leg: 'SPREAD LEGS', floor: 'FLOOR', block: 'BLOCKS', single: 'SINGLES' };

/** The pane's caption, the way the filters read: "FLOW · SINGLE LEG · OTM · ASK · SWEEP · DTE 0–14 · ≥$50K" */
export function flowCaption(f: FlowFilters): string {
  const parts = ['FLOW'];
  if (f.kind !== 'all') parts.push(KIND_CAPTION[f.kind]);
  parts.push(legsInNet(f) ? 'LEGS IN NET' : 'NO LEGS');
  if (f.mny === 'otm') parts.push('OTM');
  if (f.side === 'ask') parts.push('ASK');
  parts.push(f.dte === 'all' ? 'ANY DTE' : `DTE 0–${f.dte}`);
  if (f.prem !== 'all') parts.push(f.prem === '50k' ? '≥$50K' : '≥$250K');
  return parts.join(' · ');
}

/** The chips, each a filter and its two or three settings, in caption order */
export const FLOW_CHIPS: readonly { key: keyof FlowFilters; options: readonly { value: string; label: string; short: string }[]; hint: string }[] = [
  { key: 'kind', options: [{ value: 'all', label: 'Any print', short: 'all' }, { value: 'sweep', label: 'Sweep', short: 'swp' }, { value: 'leg', label: 'Spread legs', short: 'legs' }, { value: 'floor', label: 'Floor', short: 'flr' }, { value: 'block', label: 'Block', short: 'blk' }, { value: 'single', label: 'Single', short: 'sgl' }], hint: 'Which prints: every one, or one type — sweeps, the legs of spreads, floor trades, blocks, or plain single-leg prints' },
  { key: 'leg', options: [{ value: 'single', label: 'Legs out', short: 'no legs' }, { value: 'all', label: 'Legs in', short: '+legs' }], hint: 'Spread legs left out of the net — each is half of a structure, not a bet — or counted by their side' },
  { key: 'mny', options: [{ value: 'otm', label: 'OTM', short: 'OTM' }, { value: 'all', label: 'Any strike', short: 'any K' }], hint: 'Out of the money only, or every strike' },
  { key: 'side', options: [{ value: 'ask', label: 'Ask', short: 'ask' }, { value: 'all', label: 'Both sides', short: 'a+b' }], hint: 'At the ask only, or the bid as well (a call sold at the bid reads down, a put sold there up)' },
  { key: 'dte', options: [{ value: '14', label: 'DTE 0–14', short: '≤14d' }, { value: '60', label: 'DTE 0–60', short: '≤60d' }, { value: 'all', label: 'Any DTE', short: 'any d' }], hint: 'Days to expiry' },
  { key: 'prem', options: [{ value: '50k', label: '≥$50K', short: '50K+' }, { value: '250k', label: '≥$250K', short: '250K+' }, { value: 'all', label: 'Any size', short: 'any $' }], hint: "A print's premium, at least" },
];
