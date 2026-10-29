/* Page numbers under a long list: the first, the current and the last, so a far page is one click; the gap takes a number. */

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const windowOf = (page: number, pages: number): (number | 'gap')[] => {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const out: (number | 'gap')[] = [0];
  const lo = Math.max(1, page - 1);
  const hi = Math.min(pages - 2, page + 1);
  if (lo > 1) out.push('gap');
  for (let i = lo; i <= hi; i++) out.push(i);
  if (hi < pages - 2) out.push('gap');
  out.push(pages - 1);
  return out;
};

export function PageBar({ page, pages, onPage, testId }: { page: number; pages: number; onPage: (page: number) => void; testId?: string }) {
  const [jump, setJump] = useState<{ at: number; draft: string } | null>(null);
  if (pages <= 1) return null;
  const go = (n: number) => onPage(Math.max(0, Math.min(pages - 1, n)));
  const commit = () => {
    const n = Number(jump?.draft);
    if (Number.isInteger(n) && n >= 1 && n <= pages) go(n - 1);
    setJump(null);
  };
  return (
    <div className="bg-panel px-3 min-h-10 border-t border-borderSubtle/50 flex items-center gap-1 font-mono text-t11 tnum" data-page-bar={testId} data-page={page + 1} data-pages={pages}>
      <button type="button" onClick={() => go(page - 1)} disabled={page === 0} className="inline-flex items-center justify-center w-7 h-7 rounded text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] disabled:opacity-30 disabled:pointer-events-none" aria-label="Previous page">
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      {windowOf(page, pages).map((n, i) =>
        n === 'gap' ? (
          jump?.at === i ? (
            <input
              key={`g-${i}`}
              autoFocus
              inputMode="numeric"
              value={jump.draft}
              onChange={e => setJump({ at: i, draft: e.target.value.replace(/\D/g, '').slice(0, 4) })}
              onBlur={commit}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setJump(null);
              }}
              aria-label={`Page number, 1 to ${pages}`}
              placeholder="Page"
              className="w-12 h-7 px-1 rounded bg-chip text-center text-textPrimary outline-none border border-borderMuted"
            />
          ) : (
            <button key={`g-${i}`} type="button" onClick={() => setJump({ at: i, draft: '' })} className="inline-flex items-center justify-center min-w-7 h-7 px-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]" aria-label="Go to page">
              …
            </button>
          )
        ) : (
          <button key={n} type="button" onClick={() => go(n)} aria-current={n === page ? 'page' : undefined} className={`inline-flex items-center justify-center min-w-7 h-7 px-1.5 rounded ${n === page ? 'bg-chip text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}>
            {n + 1}
          </button>
        )
      )}
      <button type="button" onClick={() => go(page + 1)} disabled={page >= pages - 1} className="inline-flex items-center justify-center w-7 h-7 rounded text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06] disabled:opacity-30 disabled:pointer-events-none" aria-label="Next page">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
      <span className="ml-2 text-textMuted">
        {page + 1} of {pages}
      </span>
    </div>
  );
}
