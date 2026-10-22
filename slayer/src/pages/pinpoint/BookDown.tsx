/*
==================================================
  SLAYER TERMINAL - WHEN THE BOOK DOES NOT LAND
  (pages/pinpoint/BookDown.tsx)

  Map, Agenda and Compare stood in as their skeleton
  until the first read walked in — and when the read
  FAILED, the skeleton stood forever (the UI sweep,
  2026-10-22: twenty seconds of grey bars with every
  call refused). The Board already said so in words.
  This is the same news for the pages that wait on a
  whole book: the skeleton while the read is on its
  way, a plain card the moment it has failed, and a
  way to ask again (the feed re-asks on its own too).
==================================================
*/

import type { ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import { bookStatus, ensureBook, useBookRev } from '../../data/uwBook';

/** The skeleton while any of `tickers` is still reading; the failure card once one of them has failed. */
export const BookOrSkeleton = ({ tickers, children }: { tickers: string[]; children: ReactNode }) => {
  useBookRev();
  const failed = tickers.filter(t => t && bookStatus(t) === 'error');
  if (!failed.length) return <>{children}</>;
  return (
    <div className="border border-borderSubtle rounded-md bg-panel px-5 py-6 flex flex-col items-start gap-3" role="status" data-book-down={failed.join(' ')}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-warn">This read did not land</p>
      <p className="text-[13px] text-textSecondary max-w-prose">
        The book for <span className="font-semibold text-textPrimary">{failed.join(' and ')}</span> did not come back from the feed. The page asks again on its own every few seconds — or ask now.
      </p>
      <button
        type="button"
        onClick={() => failed.forEach(t => ensureBook(t, 'full'))}
        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle hover:border-borderMuted font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors"
        data-book-retry
      >
        <RotateCcw className="w-3 h-3" /> Try again
      </button>
    </div>
  );
};
