/*
==================================================
  SLAYER TERMINAL - THE MORE DOOR (components/gex/MoreDoor.tsx)

  The band's rarely-pressed doors, behind one (the
  owner, 2026-10-14, after a walk through the Map as
  a user: "15 equally weighted pills with no grouping
  … put the rarely used controls under a More menu"):
  where the book comes from (BookProvenance's card)
  and the two exports (data/exportBook.ts — the book
  as CSV, the levels as JSON). The Names door's menu
  grammar, the old Export door's rows.
==================================================
*/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Database, Download, MoreHorizontal } from 'lucide-react';
import { useAnchoredMenu } from '../ui/useAnchoredMenu';
import { FLAT_DOOR } from '../ui/flatDoor';
import useFocusTrap from '../ui/useFocusTrap';
import { bookCsv, downloadText, levelsJson, stampForName } from '../../data/exportBook';
import { readLevelsScope } from '../../data/levelsScope';
import { sourceWords } from './BookProvenance';
import { freshnessOf } from '../../data/levelSureness';
import type { ExposureSurface, Greek } from '../../data/exposureSurface';

interface Props {
  surface: ExposureSurface;
  greeks: Greek[];
  expiries: number[];
  /** Opens the Data card — where the figures come from */
  onData: () => void;
  /** The icon alone, for a band that measured itself tight */
  compact?: boolean;
}

const MoreDoor = ({ surface, greeks, expiries, onData, compact = false }: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { anchorRef, placed } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', 272, 'start');
  useFocusTrap(open, menuRef);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  const src = sourceWords();
  const stamp = stampForName();
  const take = (what: 'book' | 'levels') => {
    if (what === 'book') downloadText(`${surface.ticker}-book-${stamp}.csv`, bookCsv(surface, greeks, expiries), 'text/csv;charset=utf-8');
    else downloadText(`${surface.ticker}-levels-${stamp}.json`, levelsJson(surface, readLevelsScope(), src.short), 'application/json');
    setOpen(false);
  };
  const row = 'w-full text-left px-2.5 py-2 rounded-md hover:bg-ink/[0.06] transition-colors flex items-start gap-2.5';
  const icon = 'mt-0.5 w-3 h-3 shrink-0 text-textMuted';
  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More"
        title="Where this book comes from · save it as a file"
        className={`${FLAT_DOOR} ${compact ? 'w-7 justify-center px-0' : ''} ${open ? 'bg-ink/[0.06] text-textPrimary' : ''}`}
        data-ledger-more
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
        {!compact && <span>More</span>}
      </button>
      {open &&
        placed &&
        createPortal(
          <div ref={menuRef} role="menu" aria-label="More" style={{ position: 'fixed', ...placed.box }} className="z-[120] w-[272px] border border-borderMuted bg-panel/90 backdrop-blur-xl rounded-md shadow-2xl shadow-black/60 p-1.5 font-mono text-[11px]" data-ledger-more-menu>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onData();
              }}
              className={row}
              data-more="data"
            >
              <Database className={`${icon} ${src.live ? 'text-silver' : ''}`} />
              <span className="min-w-0">
                <span className="block text-textPrimary">Where this book comes from</span>
                <span className="block text-textMuted">
                  {src.live ? `Live · ${src.short}` : src.short} · {freshnessOf(surface.ticker)}
                </span>
              </span>
            </button>
            <div className="my-1 border-t border-borderSubtle/60" aria-hidden />
            <button type="button" role="menuitem" onClick={() => take('book')} className={row} data-export="book">
              <Download className={icon} />
              <span className="min-w-0">
                <span className="block text-textPrimary">Save the book as CSV</span>
                <span className="block text-textMuted">
                  {greeks.length} {greeks.length === 1 ? 'greek' : 'greeks'} · {expiries.length} {expiries.length === 1 ? 'date' : 'dates'} · {surface.strikes.length} strikes
                </span>
              </span>
            </button>
            <button type="button" role="menuitem" onClick={() => take('levels')} className={row} data-export="levels">
              <Download className={icon} />
              <span className="min-w-0">
                <span className="block text-textPrimary">Save the levels as JSON</span>
                <span className="block text-textMuted">call wall · flip · put wall · pin · supreme</span>
              </span>
            </button>
          </div>,
          document.body
        )}
    </span>
  );
};

export default MoreDoor;
