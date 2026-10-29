/* The pieces the Pulse tiles share, so every tile reads as one desk: the read line at a tile's foot, rows under
   hairlines, a row that is a door, the empty state, a short bar, and the name's live price. */

import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import SpotPrice from '../../../components/gex/SpotPrice';
import { useThetaPrice } from '../../../data/thetaQuote';
import { fmtStrike } from '../../../core/format';
import { EmptyBox, asOfText } from '../../../components/ui/states';

/** A row's own door: the page it leads to, carrying the way back to Pulse (components/layout/WayBack) */
export const useDoor = () => {
  const navigate = useNavigate();
  return useCallback((path: string, state?: Record<string, unknown>) => navigate(path, { state: { ...state, wayBack: '/pulse' } }), [navigate]);
};

/** A name's real-time price off the ThetaData terminal; with the terminal down, the last one it gave, dimmed and
    stamped with when (the amber dot says it is not live), else a dash */
export const LiveSpot = ({ ticker, className }: { ticker: string; className?: string }) => {
  const { held, status } = useThetaPrice(ticker);
  if (held?.live) return <SpotPrice value={held.value.price} className={className} />;
  const stamp = held ? asOfText(held.value.at) : null;
  return (
    <span className="inline-flex items-center gap-1" title={status === 'down' ? `ThetaData offline${stamp ? ` · ${stamp}` : ''}` : stamp ?? 'Waiting on ThetaData'} data-live-spot={held ? 'kept' : 'none'}>
      <span className={`${className ?? ''} !text-textMuted`}>{held ? `$${held.value.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
      {status === 'down' && <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />}
    </span>
  );
};

/** A tile with no book to read for its name */
export const TileNoBook = ({ ticker, why }: { ticker: string; why?: string }) => <EmptyBox title={`No book for ${ticker} yet`} reason={why ?? 'The dealer book has not landed from Unusual Whales.'} />;

/** The one read line at the tile's foot */
export const TileRead = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p className="shrink-0 px-3 py-2 border-t border-ink/[0.06] text-t11 leading-snug text-textSecondary" data-tile-read={testId ?? ''}>
    {/* the clamp is on an inner box: clamped text in a padded box shows the top of the next line in the padding */}
    <span className="line-clamp-2">{children}</span>
  </p>
);

/** The column heads over a list of rows */
export const TileHeads = ({ columns, children }: { columns: string; children: ReactNode }) => (
  <div className="shrink-0 grid items-center gap-x-3 px-3 h-6 border-b border-ink/[0.06] bg-panel font-mono text-t85 uppercase tracking-widest text-textMuted whitespace-nowrap" style={{ gridTemplateColumns: columns }}>
    {children}
  </div>
);

/** A list of rows that scrolls inside its tile */
export const TileRows = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${className}`} data-tile-rows>
    {children}
  </div>
);

/** One row — a door when it leads somewhere */
export const TileRow = ({ columns, onClick, title, children, height = 30, testId, style }: { columns: string; onClick?: () => void; title?: string; children: ReactNode; height?: number; testId?: string; style?: CSSProperties }) => {
  const cls = `w-full grid items-center gap-x-3 px-3 border-b border-borderSubtle/40 last:border-0 text-left font-mono text-t11 tnum whitespace-nowrap ${onClick ? 'cursor-pointer hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04] outline-none transition-colors' : ''}`;
  const st = { gridTemplateColumns: columns, minHeight: height, ...style };
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={cls} style={st} data-tile-row={testId ?? ''}>
      {children}
    </button>
  ) : (
    <div title={title} className={cls} style={st} data-tile-row={testId ?? ''}>
      {children}
    </div>
  );
};

/** Nothing to show yet — said plainly, with the way to change it */
export const TileEmpty = ({ words, door, onDoor }: { words: string; door?: string; onDoor?: () => void }) => (
  <div className="h-full flex flex-col items-center justify-center gap-2 px-4 text-center" data-tile-empty>
    <span className="text-t115 leading-snug text-textSecondary max-w-[280px]">{words}</span>
    {door && onDoor && (
      <button type="button" onClick={onDoor} className="inline-flex items-center h-6 px-2.5 rounded-md border border-borderSubtle hover:border-borderMuted font-mono text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
        {door}
      </button>
    )}
  </div>
);

export const signedPct = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
export const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textSecondary');
export { fmtStrike };
