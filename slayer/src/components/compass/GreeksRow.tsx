/* Four greeks in a row, the board's stat grammar: delta, gamma, theta and IV off the contract's own quote. The sign is
   the ink; a greek the quote did not print is a dash, never a stand-in. (Restored from the owner's contract page.) */

import AnimatedNumber from '../ui/AnimatedNumber';
import Term from '../ui/Term';
import { TERMS, type TermKey } from '../../data/terms';

interface GreeksRowProps {
  delta: number;
  gamma: number;
  /** Dollars per calendar day, per share */
  theta: number;
  /** Percent, 20 means 20% */
  iv: number;
  flash?: boolean;
}

const GreeksRow = ({ delta, gamma, theta, iv, flash = false }: GreeksRowProps) => {
  const cells = [
    { label: 'Delta', value: delta, format: (v: number) => v.toFixed(2), tone: delta >= 0 ? 'text-bull' : 'text-bear' },
    { label: 'Gamma', value: gamma, format: (v: number) => v.toFixed(4), tone: 'text-textPrimary' },
    { label: 'Theta', value: theta, format: (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v * 100).toFixed(0)}/day`, tone: 'text-warn' },
    { label: 'IV', value: iv, format: (v: number) => `${v.toFixed(1)}%`, tone: 'text-textPrimary' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3" data-greeks>
      {cells.map(c => (
        <div key={c.label} className="min-w-0">
          <div className="font-mono text-t9 uppercase tracking-widest text-textMuted">{c.label in TERMS ? <Term k={c.label as TermKey} /> : c.label}</div>
          <div className={`mt-0.5 font-mono text-t13 font-semibold tnum ${Number.isFinite(c.value) ? c.tone : 'text-textMuted'}`}>
            {Number.isFinite(c.value) ? <AnimatedNumber value={c.value} format={c.format} flash={flash} /> : '—'}
          </div>
        </div>
      ))}
    </div>
  );
};

export default GreeksRow;
