/* The premium chart's capsule. Every contract this name has on the board. The menu is the house popover: portal,
   Escape, click-away, and it stays on screen. Rows load the first time it opens. */

import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import PopoverCard from '../ui/PopoverCard';
import type { OptionRight, SleeveKey } from '../../types/compass';

export interface ConPickRow {
  key: string;
  strike: number;
  right: OptionRight;
  sleeve: SleeveKey;
  /** The contract, e.g. "AAPL 185.50C" */
  title: string;
  /** The distinguishing word — the sleeve's label (0DTE / Weekly / …) */
  tag: string;
  /** Right-side whisper, e.g. the live mid */
  sub: string;
}

const ContractPick = ({
  label,
  current,
  loadRows,
  onPick,
}: {
  label: string;
  current: { strike: number; right: OptionRight; sleeve: SleeveKey };
  /** Called on first open — the sweeps run when the reader asks, not per tick. */
  loadRows: () => ConPickRow[];
  onPick: (strike: number, right: OptionRight, sleeve: SleeveKey) => void;
}) => {
  const [rows, setRows] = useState<ConPickRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => setRows(null), [loadRows]);

  return (
    <PopoverCard
      width={288}
      align="start"
      onOpenChange={next => {
        setOpen(next);
        if (next && rows === null) setRows(loadRows());
      }}
      trigger={
        <button
          type="button"
          aria-label="Every contract this name has on the board"
          className="group inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-ink/[0.06] hover:bg-ink/[0.10] font-mono text-t11 font-bold text-textPrimary transition-colors shrink-0"
        >
            {label}
            <ChevronDown className={`w-3 h-3 text-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
      }
    >
      <div className="p-1" role="listbox" aria-label="Contracts on this name">
        {rows === null && (
          <div className="px-3 py-2 font-mono text-t10 uppercase tracking-widest text-textMuted">Sweeping the book…</div>
        )}
        {rows?.map(r => {
          const isCur = Math.abs(r.strike - current.strike) < 1e-9 && r.right === current.right && r.sleeve === current.sleeve;
          return (
            <button
              key={r.key}
              type="button"
              role="option"
              aria-selected={isCur}
              onClick={() => {
                if (!isCur) onPick(r.strike, r.right, r.sleeve);
              }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left transition-colors ${
                isCur ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.04]'
              }`}
            >
              <span className="font-mono text-t11 font-bold text-textPrimary">{r.title}</span>
              <span className="px-1 py-px rounded border border-borderSubtle bg-ink/[0.05] font-mono text-t8 font-semibold uppercase tracking-wider text-textSecondary">
                {r.tag}
              </span>
              <span className="ml-auto font-mono text-t10 tnum text-textSecondary">{r.sub}</span>
            </button>
          );
        })}
        {rows !== null && rows.length === 0 && (
          <div className="px-3 py-2 font-mono text-t10 text-textMuted">Nothing else surfaced for this name today</div>
        )}
      </div>
    </PopoverCard>
  );
};

export default ContractPick;
