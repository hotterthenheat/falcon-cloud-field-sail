import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { bookStatus, useBookRev } from '../../data/book/store';
import { ensureBook } from '../../data/book/load';
import { LeaveRead } from './liveRead';

/** The failure card for a dealer book that did not come back. Try again stays. Back (the desk's last name) leaves, so a
    failed read is not a dead end — a host where the name is the pane's own (Terrain) leaves it off. `compact` is the
    card in a narrow column (the Terrain strike rail's place). */
export const ReadMiss = ({ who, onRetry, leave = true, compact = false }: { who?: string; onRetry?: () => void; leave?: boolean; compact?: boolean }) => (
  <div className={`border border-borderSubtle rounded-md bg-panel flex flex-col items-start gap-3 ${compact ? 'px-3 py-4' : 'px-5 py-6'}`} role="status" data-book-down={who || 'book'}>
    <p className="font-mono text-t10 uppercase tracking-widest text-warn">This read did not land</p>
    <p className={`${compact ? 'text-t12' : 'text-t13'} text-textSecondary max-w-prose`}>
      {who ? <>The book for <span className="font-semibold text-textPrimary">{who}</span> did not come back from the feed.</> : <>The book did not come back from the feed.</>}{' '}
      The page asks again on its own every few seconds — or ask now.
    </p>
    <div className="flex items-center gap-2 flex-wrap">
      {onRetry && (
        <button type="button" onClick={onRetry} className="slayer-chip uppercase tracking-widest text-t10" data-book-retry>
          <RotateCcw className="w-3 h-3" /> Try again
        </button>
      )}
      {leave && <LeaveRead />}
    </div>
  </div>
);

/** The skeleton while any of `tickers` is still reading; the failure card once one of them has failed. */
export const BookOrSkeleton = ({ tickers, children }: { tickers: string[]; children: ReactNode }) => {
  useBookRev();
  const failed = tickers.filter(t => t && bookStatus(t) === 'error');
  if (!failed.length) return <>{children}</>;
  return <ReadMiss who={failed.join(' and ')} onRetry={() => failed.forEach(t => ensureBook(t, 'full', true))} />;
};
