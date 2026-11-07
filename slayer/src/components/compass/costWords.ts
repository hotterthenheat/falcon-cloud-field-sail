/* A call's cost read in a reader's words (data/compassCost.ts): the card's "Needs SPX ≥ 7431 by 15:55 (0.42× the
   priced move)" line and its hover, with the research hurdle beside it when the research measured that root
   (data/compassHurdle.ts). Words only: no score, no fee. */

import type { OptionRight } from '../../types/compass';
import { needsLine, type CostMark } from '../../data/compassCost';
import { hurdleFor } from '../../data/compassHurdle';
import { printOf } from '../../data/compassParams';
import { nyClock, nyParts } from '../../core/nyTime';

const signed = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}` : '—');

export function costWords(mark: CostMark | undefined, ticker: string, right: OptionRight, calledAt: number): { line: string; hover: string } | null {
  if (!mark || !(mark.level > 0) || !Number.isFinite(mark.z)) return null;
  const line = needsLine(mark, right, printOf(ticker), ms => nyClock(ms));
  const hold = calledAt > 0 ? (mark.by - calledAt) / 60_000 : 0;
  const p = calledAt > 0 ? nyParts(calledAt) : null;
  const research = p ? hurdleFor(ticker, p.hour * 60 + p.minute, hold) : null;
  const how = mark.rule === 'cost'
    ? `Chosen as the contract that needs the least of the ${mark.pool} the model's rule allowed on this side${mark.scorePick ? ` (the score rule would have taken ${mark.scorePick})` : ''}.`
    : `The model's own pick${mark.costPick ? `; ${mark.costPick} would have needed less` : ''}.`;
  const hover = [
    `Ask in, bid out at the call's quote: $${(mark.roundTrip * 100).toFixed(0)} a contract round trip.`,
    `To break even on average it needs a mean move of ${signed(mark.mu)} priced moves its way by the flat.`,
    research && research.hz != null
      ? `Research, for scale: a 0.30-delta ${printOf(research.root)} 0DTE option needed ${signed(research.hz)} [${signed(research.lo ?? NaN)}, ${signed(research.hi ?? NaN)}] at ${research.h === 'close' ? 'the close' : `${research.h} minutes`} (2020–2023, ${research.sessions} sessions${research.pooled ? ', all times of day' : ''}).`
      : '',
    how,
  ].filter(Boolean).join(' ');
  return { line: line.charAt(0).toUpperCase() + line.slice(1), hover };
}
