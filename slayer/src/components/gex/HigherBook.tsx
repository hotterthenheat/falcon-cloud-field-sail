import { fmtGexUsd } from '../../data/gex';
import { readHigherBook } from '../../data/liveHigher';
import type { MarketSnapshot } from '../../types/market';

/** Color, vomma, speed, veta and zomma off the live contracts. The card stays up while contract vol is still being read. */
const HigherBook = ({ snapshot }: { snapshot: MarketSnapshot | null }) => {
  const read = readHigherBook(snapshot);
  if (!snapshot) return null;
  return (
    <div className="border border-borderSubtle rounded-md bg-panel px-4 py-2.5" data-higher-greeks={snapshot.ticker}>
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <h3 className="text-[13px] font-semibold text-textPrimary">Higher greeks</h3>
        <p className="text-[10.5px] text-textMuted">
          {read
            ? `${snapshot.ticker} · ${read.expiries} ${read.expiries === 1 ? 'expiry' : 'expiries'} · ${read.legs} contracts${read.leftOut > 0 ? ` · ${read.leftOut} ${read.leftOut === 1 ? 'leg' : 'legs'} skipped, no vol` : ''} · at current spot · ${read.carry}. Not a morning snapshot.`
            : `${snapshot.ticker} · contract vol is still being read. Color, vomma, speed, veta and zomma fill in from each contract's own vol — nothing is copied from a morning greek.`}
        </p>
      </div>
      {read && (
      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {read.rows.map(row => (
          <div key={row.key} className="min-w-[7.5rem]" title={`${row.about} Heaviest strike ${row.strike || '—'}. ${row.unit}. ${read.carry}.`}>
            <div className="font-mono text-[9px] uppercase tracking-widest text-textMuted">{row.label}</div>
            <div className="font-mono text-[12px] font-semibold tnum text-textPrimary">{fmtGexUsd(row.net)}</div>
            <div className="font-mono text-[9px] text-textMuted tnum">{row.unit}{row.strike ? ` · ${row.strike}` : ''}</div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
};

export default HigherBook;
