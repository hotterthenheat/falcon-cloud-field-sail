/* The two figures over a paper chart, in plain words: what the name has banked today (its trades closed since the
   trading day began at 17:00 ET, and what an open one has taken off in pieces, fees in — engine.ts `bankedOf`), and
   what is open on it now, up or down. */

import { usdSigned } from '../review/words';

const tone = (v: number) => (v >= 0.005 ? 'fill-bull' : v <= -0.005 ? 'fill-bear' : 'bg-panel text-textSecondary border border-borderMuted');
const chip = 'h-6 inline-flex items-center px-2 rounded-[3px] font-mono text-t11 font-semibold tnum whitespace-nowrap shadow-[0_3px_10px_rgba(0,0,0,0.35)]';

const PnlChips = ({ name, banked, open }: { name: string; banked: number; open: number }) => (
  <span className="inline-flex items-center gap-1 pointer-events-auto cursor-default" data-pnl-badges={name}>
    <span className={`${chip} ${tone(banked)}`} title={`What ${name} has banked today (since 17:00 ET): the trades closed, and what an open one has taken off in pieces, fees in`} data-pnl-realized>
      Banked today {usdSigned(banked)}
    </span>
    <span className={`${chip} ${tone(open)}`} title={`What is open on ${name}, up or down, right now, fees in`} data-pnl-open>
      Open {usdSigned(open)}
    </span>
  </span>
);

export default PnlChips;
