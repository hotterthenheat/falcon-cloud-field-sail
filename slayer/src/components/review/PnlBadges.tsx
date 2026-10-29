/* RP&L · UP&L — the chart's two figures. RP&L is what the name has BANKED today — its trades closed today, and
   what an open one has taken off in pieces, fees in (the engines' `bankedOf`); UP&L is what is OPEN on it, up or
   down, now. */

import { usdSigned } from './words';

const tone = (v: number) => (v >= 0.005 ? 'fill-bull' : v <= -0.005 ? 'fill-bear' : 'bg-panel text-textSecondary border border-borderMuted');
const badge = 'h-6 inline-flex items-center px-2 rounded-[3px] font-mono text-t11 font-semibold tnum whitespace-nowrap shadow-[0_3px_10px_rgba(0,0,0,0.35)]';

interface Props {
  name: string;
  realized: number;
  unrealized: number;
  /** Which day RP&L is of, in words ("today", "Mar 14") */
  dayWord: string;
}

const PnlBadges = ({ name, realized, unrealized, dayWord }: Props) => (
  <span className="inline-flex items-center gap-1 pointer-events-auto cursor-default" data-pnl-badges={name}>
    <span className={`${badge} ${tone(realized)}`} title={`Realized — what ${name} has banked ${dayWord}: the trades closed, and what an open one has taken off in pieces, fees in`} data-pnl-realized>
      RP&amp;L: {usdSigned(realized)}
    </span>
    <span className={`${badge} ${tone(unrealized)}`} title={`Unrealized — what is open on ${name}, up or down, right now, fees in`} data-pnl-open>
      UP&amp;L: {usdSigned(unrealized)}
    </span>
  </span>
);

export default PnlBadges;
