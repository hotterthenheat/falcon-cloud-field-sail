/*
  The tab strip across the top of Terrain: one tab per name the ACTIVE pane holds (logo, name, price, change), the
  active tab lit, a close on each, and a "+" that opens the ticker lookup and adds the pick as a new tab. Five at most —
  the sixth press is disabled and says so. On a multi-pane desk the active pane's number leads the strip, so a tab
  pressed renames the pane you are in.
*/

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { ensureBook } from '../../data/uwBook';
import { peekPrint, usePrintRev, wantPrint } from '../../data/thetaTape';
import { etClock } from '../../data/thetaFeed';
import CompanyLogo from '../ui/CompanyLogo';
import TickerLookup from '../ui/TickerLookup';
import useFocusTrap from '../ui/useFocusTrap';
import { useAnchoredMenu } from '../ui/useAnchoredMenu';

export const TAB_MAX = 5;
const MENU_W = 288;

interface TickerTabStripProps {
  /** Every name the pane holds, the active one among them */
  tabs: string[];
  active: string;
  /** A tab pressed: show that name */
  onPick: (ticker: string) => void;
  /** A tab's close pressed */
  onClose: (ticker: string) => void;
  /** A name picked in the "+" lookup */
  onAdd: (ticker: string) => void;
  /** The pane the tabs belong to, on a desk of more than one — "2" */
  paneLabel?: string;
  /** The name alone on a tab — a phone's strip */
  compact?: boolean;
  max?: number;
}

const fmtPrice = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const TickerTabStrip = ({ tabs, active, onPick, onClose, onAdd, paneLabel, compact = false, max = TAB_MAX }: TickerTabStripProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { anchorRef, placed } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', MENU_W, 'start');
  useFocusTrap(open, menuRef);

  /* outside press and Escape close the lookup — the ScopeChip's rule, pointerdown so a Radix trigger's press is heard */
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

  const full = tabs.length >= max;
  /* each tab's price is ThetaData's print, read with the other panes' in one call */
  usePrintRev();
  const tabKey = tabs.join(',');
  useEffect(() => {
    /* the exposure book of every tab is warmed, so a switch draws at once */
    for (const t of tabKey.split(',').filter(Boolean)) ensureBook(t, 'board');
    const offs = tabKey.split(',').filter(Boolean).map(t => wantPrint(t));
    return () => offs.forEach(off => off());
  }, [tabKey]);

  const menu =
    open &&
    placed &&
    createPortal(
      <div
        ref={menuRef}
        role="dialog"
        aria-label="Add a tab — another name on this pane"
        style={{ position: 'fixed', ...placed.box }}
        className="z-[120] w-72 border border-borderMuted bg-panel/80 backdrop-blur-xl backdrop-saturate-150 rounded-md shadow-2xl shadow-black/60 overflow-x-hidden overflow-y-auto overscroll-contain animate-slide-in"
        data-ticker-tabs-menu
      >
        <div className="px-2.5 py-1.5 border-b border-borderSubtle text-t10 text-textMuted">
          A new tab on this pane — {tabs.length} of {max} open
        </div>
        <TickerLookup
          active={active}
          onPick={sym => {
            setOpen(false);
            if (sym) onAdd(sym);
          }}
        />
      </div>,
      document.body
    );

  return (
    <div ref={rootRef} className="shrink-0 flex items-stretch h-8 min-w-0 border-b border-borderSubtle/60 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="The names on this pane" data-ticker-tab-strip={tabs.length}>
      {paneLabel && (
        <span className="shrink-0 inline-flex items-center px-2.5 border-r border-borderSubtle/60 font-mono text-t9 uppercase tracking-widest text-textMuted whitespace-nowrap" title={`The tabs of pane ${paneLabel} — the one in hand`} data-ticker-tab-pane={paneLabel}>
          Pane {paneLabel}
        </span>
      )}
      {tabs.map(t => {
        const on = t === active;
        const print = peekPrint(t);
        const price = print?.price ?? null;
        const change = print && print.prev > 0 ? (print.price / print.prev - 1) * 100 : null;
        return (
          <span
            key={t}
            role="tab"
            aria-selected={on}
            className={`group relative shrink-0 inline-flex items-stretch border-r border-borderSubtle/60 font-mono select-none transition-colors ${on ? 'bg-panel text-textPrimary' : 'text-textSecondary hover:bg-ink/[0.04] hover:text-textPrimary'}`}
            data-ticker-tab={t}
            data-active={on || undefined}
          >
            {/* the tab in hand carries the silver at its top edge — where you are */}
            {on && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-silver/70" />}
            <button type="button" onClick={() => onPick(t)} title={on ? `${t} — on the tape` : `Show ${t} on this pane`} className="pl-2.5 pr-1.5 inline-flex items-center gap-2 min-w-0">
              <CompanyLogo ticker={t} size={14} />
              <span className="text-t11 font-bold tracking-wide">{t}</span>
              {!compact && price != null && (
                <>
                  <span className="text-t11 tnum text-textPrimary" title={print?.kept ? `Live print, as of ${etClock(print.readAt)}` : 'Live print'}>
                    {fmtPrice(price)}
                  </span>
                  {change != null && (
                    <span className={`text-t105 tnum ${change >= 0 ? 'text-bull' : 'text-bear'}`} title="From the prior regular close">
                      {change >= 0 ? '+' : '−'}
                      {Math.abs(change).toFixed(2)}%
                    </span>
                  )}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onClose(t)}
              aria-label={`Close the ${t} tab`}
              title={tabs.length === 1 ? 'The last tab stays' : `Close ${t}`}
              disabled={tabs.length === 1}
              className={`w-5 mr-1 inline-flex items-center justify-center rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-opacity disabled:opacity-0 ${on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
              data-ticker-tab-close={t}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
      <button
        ref={anchorRef}
        type="button"
        onClick={() => !full && setOpen(!open)}
        disabled={full}
        aria-disabled={full}
        aria-label={full ? 'Five tabs at most — close one to add another' : 'Add a tab — another name on this pane'}
        title={full ? 'Five tabs at most — close one to add another' : `Add a tab — another name on this pane (${tabs.length} of ${max})`}
        className={`shrink-0 inline-flex items-center justify-center w-8 transition-colors ${full ? 'text-textMuted/40 cursor-not-allowed' : open ? 'bg-ink/[0.1] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]'}`}
        data-ticker-tab-add
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      {menu}
    </div>
  );
};

export default TickerTabStrip;
