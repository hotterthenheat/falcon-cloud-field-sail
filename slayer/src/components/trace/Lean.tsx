/* A net figure in its meaning's ink: net puts bought lean bearish, so `put` turns the ink round; zero is plain. The
   ▲/▼ mark carries direction under the colour-vision choices. */

import { usd as fmtUsd } from '../../data/traceLive';

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
