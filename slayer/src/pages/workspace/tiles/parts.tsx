/*
==================================================
  SLAYER TERMINAL - PULSE · WHAT EVERY TILE IS MADE OF
  (pages/workspace/tiles/parts.tsx)

  The few pieces the tiles share, so twenty-one of
  them read as one desk:

    TileRead    the ONE read line at a tile's foot —
                a sentence, two lines at most
    TileRows    a list of rows under hairlines, the
                house's table grammar at a tile's
                size, scrolling inside the tile
    TileRow     one row: a door when it leads
                somewhere, plain when it does not
    TileEmpty   a tile with nothing to show yet says
                so, and where to go to change that
    TileBar     a short bar on the house's track — a
                size beside a figure, never a chart
==================================================
*/

import { useCallback, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

/** A row's own door: the page it leads to, carrying the way back to Pulse (components/layout/WayBack) */
export const useDoor = () => {
  const navigate = useNavigate();
  return useCallback((path: string, state?: Record<string, unknown>) => navigate(path, { state: { ...state, wayBack: '/pulse' } }), [navigate]);
};

/** A tile with no book to read for its name */
export const TileNoBook = ({ ticker }: { ticker: string }) => <div className="h-full grid place-items-center font-mono text-[10px] text-textMuted uppercase tracking-widest">No book for {ticker} yet</div>;

/** The one read line at the tile's foot */
export const TileRead = ({ children, testId }: { children: ReactNode; testId?: string }) => (
  <p className="shrink-0 px-3 py-2 border-t border-ink/[0.06] text-[11px] leading-snug text-textSecondary" data-tile-read={testId ?? ''}>
    {/* the clamp is on an inner box: clamped text in a padded box shows the top of the next line in the padding */}
    <span className="line-clamp-2">{children}</span>
  </p>
);

/** The column heads over a list of rows */
export const TileHeads = ({ columns, children }: { columns: string; children: ReactNode }) => (
  <div className="shrink-0 grid items-center gap-x-3 px-3 h-6 border-b border-ink/[0.06] bg-panel font-mono text-[8.5px] uppercase tracking-widest text-textMuted whitespace-nowrap" style={{ gridTemplateColumns: columns }}>
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
  const cls = `w-full grid items-center gap-x-3 px-3 border-b border-borderSubtle/40 last:border-0 text-left font-mono text-[11px] tnum whitespace-nowrap ${onClick ? 'cursor-pointer hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04] outline-none transition-colors' : ''}`;
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
    <span className="text-[11.5px] leading-snug text-textSecondary max-w-[280px]">{words}</span>
    {door && onDoor && (
      <button type="button" onClick={onDoor} className="inline-flex items-center h-6 px-2.5 rounded-md border border-borderSubtle hover:border-borderMuted font-mono text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
        {door}
      </button>
    )}
  </div>
);

/** A short bar on the house's track: `share` 0..1, in an ink class or a colour */
export const TileBar = ({ share, ink, color, width = 56 }: { share: number; ink?: string; color?: string; width?: number }) => (
  <span className="relative inline-block h-[4px] rounded-full bg-ink/[0.07] overflow-hidden align-middle" style={{ width }} aria-hidden>
    <span className={`absolute inset-y-0 left-0 rounded-full ${ink ?? ''}`} style={{ width: `${Math.max(3, Math.min(1, share) * 100)}%`, background: color, transition: 'width 520ms cubic-bezier(0.16, 1, 0.3, 1)' }} />
  </span>
);

export const signedPct = (v: number, d = 2) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
export const dirInk = (v: number) => (v > 0 ? 'text-bull' : v < 0 ? 'text-bear' : 'text-textSecondary');
export const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
