/*
  THE DOSSIER'S TABLES ON A PHONE (the fourth audit's retail test, 2026-10-23). Under 640px a grid showed its first two
  or three columns — Insiders cut "Who" to "MARAGA…" with Trade, Value and "Chose to?" off-screen; Congress showed only
  Filed and Member; Stocks only Name, Sector and Last. As Trace does, a phone gets a stacked card per row instead: the
  row's own deciding fields (who, what, value, side) on two or three lines, the whole card the row's door. The list
  pages itself, fifty cards a page, so a long book never makes a page tens of thousands of pixels tall.
*/
import { useEffect, useState, type ReactNode } from 'react';
import { PageBar } from '../ui/PageBar';
import { useMediaQuery } from '../ui/useMediaQuery';

/** True under 640px — the width the Dossier's tables turn into cards */
export const usePhoneCards = (): boolean => useMediaQuery('(max-width: 639.98px)');

const PAGE = 50;

export function PhoneCards<T>({ rows, rowKey, card, onOpen, empty, testId, resetKey }: { rows: readonly T[]; rowKey: (r: T) => string; card: (r: T) => ReactNode; onOpen?: (r: T) => void; empty: string; testId: string; resetKey?: unknown }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  useEffect(() => setPage(0), [resetKey]);
  const at = Math.min(page, pages - 1);
  const shown = rows.slice(at * PAGE, at * PAGE + PAGE);
  if (!rows.length) return <div className="px-4 py-6 font-mono text-t10 uppercase tracking-widest text-textMuted" data-phone-cards={testId}>{empty}</div>;
  return (
    <div data-phone-cards={testId}>
      <ul className="divide-y divide-borderSubtle/60">
        {shown.map(r => (
          <li key={rowKey(r)}>
            {onOpen ? (
              <button type="button" onClick={() => onOpen(r)} className="w-full text-left px-4 py-2.5 hover:bg-ink/[0.03] transition-colors" data-phone-card>
                {card(r)}
              </button>
            ) : (
              <div className="px-4 py-2.5" data-phone-card>
                {card(r)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {pages > 1 ? <PageBar page={at} pages={pages} onPage={setPage} testId={`${testId}-pages`} /> : null}
    </div>
  );
}

/** One card's line: the left words and the right figure, each allowed to wrap rather than run off the screen */
export const CardLine = ({ left, right, muted = false }: { left: ReactNode; right?: ReactNode; muted?: boolean }) => (
  <span className={`flex items-baseline justify-between gap-3 min-w-0 ${muted ? 'mt-0.5 text-t105 text-textMuted' : 'text-t12 text-textPrimary'}`}>
    <span className="min-w-0 break-words">{left}</span>
    {right != null ? <span className="shrink-0 font-mono tnum text-right">{right}</span> : null}
  </span>
);
