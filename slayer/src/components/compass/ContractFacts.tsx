/* The contract in dollars, as a ledger: cost, breakeven, time value, decay, what a dollar of the underlying does, and
   the spread. Every figure is the quote's own (the bid, the ask, the underlying and the greeks it printed); a figure
   the quote did not give is a dash. (Restored from the owner's contract page; the old pricer fallback is gone.) */

import RichRead from '../ui/RichRead';
import type { OptionRight } from '../../types/compass';

const LedgerFact = ({ label, value, sub, ink = 'text-textPrimary' }: { label: string; value: string; sub: string; ink?: string }) => (
  <div className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
    <span className="flex flex-col gap-0.5 min-w-0">
      <span className="font-mono text-t9 uppercase tracking-wider text-silver">{label}</span>
      {sub ? (
        <span className="font-mono text-t10 text-textSecondary leading-snug">
          <RichRead text={sub} />
        </span>
      ) : null}
    </span>
    <span className={`font-mono text-t13 font-bold tnum text-right shrink-0 ${value === '—' ? 'text-textMuted' : ink}`}>{value}</span>
  </div>
);

interface ContractFactsProps {
  ticker: string;
  right: OptionRight;
  strike: number;
  /** What one contract is in at: the fill, or the ask before a fill */
  entry: number;
  bid: number;
  ask: number;
  /** The underlying on the quote */
  spot: number;
  delta: number;
  /** Dollars per calendar day, per share */
  theta: number;
}

const usd0 = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

const ContractFacts = ({ ticker, right, strike, entry, bid, ask, spot, delta, theta }: ContractFactsProps) => {
  const mid = bid > 0 && ask >= bid ? (bid + ask) / 2 : NaN;
  const breakeven = entry > 0 ? (right === 'C' ? strike + entry : strike - entry) : NaN;
  const travel = spot > 0 && Number.isFinite(breakeven) ? ((breakeven - spot) / spot) * 100 : NaN;
  const intrinsic = spot > 0 ? (right === 'C' ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0)) : NaN;
  const timeValue = Number.isFinite(mid) && mid > 0 && Number.isFinite(intrinsic) ? Math.max(0, 1 - intrinsic / mid) * 100 : NaN;
  const side = right === 'C' ? 'rise' : 'fall';
  const facts = [
    { label: 'Cost', value: entry > 0 ? usd0(entry * 100) : '—', sub: entry > 0 ? `$${entry.toFixed(2)} × 100 · the whole of it is at risk` : 'No entry yet' },
    {
      label: 'Breakeven',
      value: Number.isFinite(breakeven) ? `$${breakeven.toFixed(2)}` : '—',
      sub: Number.isFinite(travel) ? `${ticker} has to travel ${Math.abs(travel).toFixed(2)}% to reach it at expiry` : 'the strike plus the entry',
      ink: 'text-warn',
    },
    {
      label: 'Time value',
      value: Number.isFinite(timeValue) ? `${Math.round(timeValue)}%` : '—',
      sub: Number.isFinite(timeValue) && timeValue >= 99.5 ? 'none of the price is exercise value — all of it expires' : 'of the mid expires — the rest is exercise value',
    },
    { label: 'Decay', value: Number.isFinite(theta) ? `${usd0(Math.abs(theta) * 100)}/day` : '—', sub: 'what a day costs one contract, off the quote’s theta', ink: 'text-warn' },
    {
      label: 'Delta',
      value: Number.isFinite(delta) ? usd0(Math.abs(delta) * 100) : '—',
      sub: `what one contract gains on a $1 ${side} in ${ticker}`,
      ink: right === 'C' ? 'text-bull' : 'text-bear',
    },
    {
      label: 'Spread',
      value: Number.isFinite(mid) ? usd0((ask - bid) * 100) : '—',
      sub: Number.isFinite(mid) && mid > 0 ? `round trip across the book · ${(((ask - bid) / mid) * 100).toFixed(1)}% of the mid` : 'no two-sided quote',
    },
  ];
  return (
    <div className="divide-y divide-borderSubtle" data-contract-facts>
      {facts.map(f => (
        <LedgerFact key={f.label} {...f} />
      ))}
    </div>
  );
};

export default ContractFacts;
