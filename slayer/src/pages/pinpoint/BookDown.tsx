import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { bookStatus, ensureBook, useBookRev } from '../../data/uwBook';
import { LeaveRead } from '../../components/ui/liveRead';

/** The failure card. Try again stays. Back leaves, so a failed read is not a dead end. */
export const ReadMiss = ({ who, onRetry }: { who?: string; onRetry?: () => void }) => (
  <div className="border border-borderSubtle rounded-md bg-panel px-5 py-6 flex flex-col items-start gap-3" role="status" data-book-down={who || 'book'}>
    <p className="font-mono text-[10px] uppercase tracking-widest text-warn">This read did not land</p>
    <p className="text-[13px] text-textSecondary max-w-prose">
      {who ? <>The book for <span className="font-semibold text-textPrimary">{who}</span> did not come back from the feed.</> : <>The book did not come back from the feed.</>}{' '}
      The page asks again on its own every few seconds — or ask now.
    </p>
    <div className="flex items-center gap-2 flex-wrap">
      {onRetry && (
        <button type="button" onClick={onRetry} className="slayer-chip uppercase tracking-widest text-[10px]" data-book-retry>
          <RotateCcw className="w-3 h-3" /> Try again
        </button>
      )}
      <LeaveRead />
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
