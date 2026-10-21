/*
  A NET FIGURE IN ITS MEANING'S INK (2026-10-13, the partner's rule at Noah's word): net puts bought (+) lean bearish and
  sold (−) lean bullish, so a figure inked by its sign alone paints put buying as bullish. `put` turns the ink round; a
  zero is no lean at all, in the plain ink. Inked by direction it carries the mark too (`dir-up` / `dir-down`,
  theme/tokens.css): ▲ or ▼ under the colour-vision choices, so a direction never rests on hue alone.
*/

import { fmtUsd } from '../../data/gex';

const Lean = ({ v, put = false, className = '' }: { v: number; put?: boolean; className?: string }) => {
  const up = put ? v < 0 : v > 0;
  const down = put ? v > 0 : v < 0;
  return (
    <span className={`font-semibold tnum ${up ? 'text-bull dir-up' : down ? 'text-bear dir-down' : 'text-textPrimary'} ${className}`}>
      {v > 0 ? '+' : v < 0 ? '−' : ''}
      {fmtUsd(Math.abs(v))}
    </span>
  );
};

export default Lean;
