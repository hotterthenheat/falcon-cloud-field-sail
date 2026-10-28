import AnimatedNumber from '../ui/AnimatedNumber';
import Term from '../ui/Term';
import { TERMS, type TermKey } from '../../data/terms';
import type { SetupGreeks } from '../../types/compass';

interface GreeksRowProps {
  greeks: SetupGreeks;
  /** show vega (monitor) vs iv (compact card) in the 4th slot */
  fourth?: 'vega' | 'iv';
  /** Robinhood change stamp on value swaps (browse card wants it; monitor doesn't) */
  flash?: boolean;
}

/* Four greeks in a row, the board's stat grammar — not a second hairline
   ledger stacked under the quote. The sign is the ink. No arrow. */
const GreeksRow = ({ greeks, fourth = 'vega', flash = false }: GreeksRowProps) => {
  const cells = [
    {
      label: 'Delta',
      value: greeks.delta,
      format: (v: number) => v.toFixed(2),
      tone: greeks.delta >= 0 ? 'text-bull' : 'text-bear',
    },
    { label: 'Gamma', value: greeks.gamma, format: (v: number) => v.toFixed(4), tone: 'text-textPrimary' },
    { label: 'Theta', value: greeks.theta, format: (v: number) => v.toFixed(2), tone: 'text-warn' },
    fourth === 'vega'
      ? { label: 'Vega', value: greeks.vega, format: (v: number) => v.toFixed(2), tone: 'text-textPrimary' }
      : { label: 'IV', value: greeks.iv, format: (v: number) => `${v.toFixed(1)}%`, tone: 'text-textPrimary' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3" data-greeks>
      {cells.map(c => (
        <div key={c.label} className="min-w-0">
          <div className="font-mono text-[9px] uppercase tracking-widest text-textMuted">
            {c.label in TERMS ? <Term k={c.label as TermKey} /> : c.label}
          </div>
          <div className={`mt-0.5 font-mono text-[13px] font-semibold tnum ${c.tone}`}>
            <AnimatedNumber value={c.value} format={c.format} flash={flash} />
          </div>
        </div>
      ))}
    </div>
  );
};

export default GreeksRow;