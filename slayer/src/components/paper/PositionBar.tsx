/* The position on its chart's foot: where it came in, where it is, what it is up or down, where it breaks even
   with fees, the target and stop riding it, and Reverse and Close. */

import { useState } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { dirInk, rWords, usdSigned } from '../review/words';

export interface BarLine {
  key: string;
  /** "Long 2 · ESZ6" · "1 × SPY 495C" */
  label: string;
  tone: 'bull' | 'bear';
  /** The figures, in order: in at, now, breaks even, the ways out, reward to risk */
  facts: { label: string; value: string; ink?: string }[];
  pnl: number;
  r: number | null;
  onClose: () => void;
  /** A future's: close and open the same size the other way */
  onReverse?: () => void;
  /** Why the hands wait (another tab holds the account, the account is closed) */
  locked?: string | null;
}

const MAX_LINES = 2;

const PositionBar = ({ lines }: { lines: BarLine[] }) => {
  const [open, setOpen] = useState(false);
  if (!lines.length) return null;
  const shown = open ? lines : lines.slice(0, MAX_LINES);
  const rest = lines.length - MAX_LINES;
  return (
    <div className="inline-flex flex-col gap-1 pointer-events-auto max-w-full" data-paper-position-bar={lines.length}>
      {shown.map(l => (
        <div key={l.key} className="inline-flex items-center gap-3 h-8 pl-1.5 pr-1.5 max-w-full overflow-hidden rounded-lg border border-borderMuted bg-panel/80 backdrop-blur-md backdrop-saturate-150 shadow-[0_8px_24px_rgba(0,0,0,0.35)] font-mono text-t10 tnum whitespace-nowrap" data-paper-position-line={l.key}>
          <span className={`h-5 px-1.5 inline-flex items-center rounded font-bold text-t11 ${l.tone === 'bull' ? 'bg-bull/[0.14] text-bull' : 'bg-bear/[0.14] text-bear'}`}>{l.label}</span>
          <span className={`text-t12 font-semibold ${dirInk(l.pnl)}`}>
            {usdSigned(l.pnl)} {l.r != null && <span className="text-t10 font-normal opacity-80">{rWords(l.r)}</span>}
          </span>
          {/* the facts in whole: a narrow pane shows as many as fit, never one cut to "sol…" (the line's title has all) */}
          <span className="min-w-0 flex-1 inline-flex items-center gap-3 overflow-hidden" title={l.facts.map(f => `${f.label} ${f.value}`).join(' · ')}>
            {l.facts.map(f => (
              <span key={f.label} className="shrink-0">
                <span className="text-textMuted">{f.label}</span> <span className={f.ink ?? 'text-textPrimary'}>{f.value}</span>
              </span>
            ))}
          </span>
          <span className="ml-1 inline-flex items-center gap-1 shrink-0">
            {l.onReverse && (
              <button type="button" onClick={l.onReverse} disabled={!!l.locked} title={l.locked ?? 'Reverse — close it and open the same size the other way, at the market'} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle text-textSecondary hover:text-textPrimary hover:border-borderMuted disabled:opacity-30 transition-colors" data-paper-reverse={l.key}>
                <ArrowLeftRight className="w-3 h-3" /> Reverse
              </button>
            )}
            <button type="button" onClick={l.onClose} disabled={!!l.locked} title={l.locked ?? 'Close all of it at the market — what is working on it goes first'} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle text-textSecondary hover:text-bear hover:border-bear/50 disabled:opacity-30 transition-colors" data-paper-bar-close={l.key}>
              <X className="w-3 h-3" /> Close
            </button>
          </span>
        </div>
      ))}
      {rest > 0 && (
        <button type="button" onClick={() => setOpen(v => !v)} className="self-start px-2 h-5 inline-flex items-center rounded border border-borderSubtle bg-panel/80 font-mono text-t9 text-textMuted hover:text-textPrimary" data-paper-position-more={open ? 'open' : 'shut'}>
          {open ? 'Hide' : `+${rest} more in the book`}
        </button>
      )}
    </div>
  );
};

export default PositionBar;
