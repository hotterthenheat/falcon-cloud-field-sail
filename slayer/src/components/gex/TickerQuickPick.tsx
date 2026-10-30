/* The compact in-header ticker switcher: a full-universe search (S&P 500 and Nasdaq listings); an unknown symbol still picks on Enter. */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from '../ui/useAnchoredMenu';

/** Matches the `w-72` on the menu below. Passed to the placement so it can
    keep the menu's far edge on screen; assuming a narrower default put this
    one 162px off the left of the window in a left-column pane. */
const MENU_W = 288;
import { ChevronDown } from 'lucide-react';
import TickerLookup from '../ui/TickerLookup';
import useFocusTrap from '../ui/useFocusTrap';

interface TickerQuickPickProps {
  /* The slim cut for a strip of quiet chips: no fill, chip height, hover reveal. */
  slim?: boolean;
  /** What the capsule SAYS when that is more than the ticker — the Weigher's
      contract lens prints the whole contract ("SPY 507 Call") while the
      button stays the same ticker door it always was. */
  label?: string;
  ticker: string;
  onPick: (ticker: string) => void;
  /* The button's tooltip; a host with keys on this control names them here (Terrain's `s`, ↑/↓). */
  title?: string;
  /* Optionally controlled: pass both to own the open state; there is no half-controlled mode. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const TickerQuickPick = ({ ticker, onPick, open: openProp, onOpenChange, slim, label, title = 'Switch ticker' }: TickerQuickPickProps) => {
  const [selfOpen, setSelfOpen] = useState(false);
  const open = openProp ?? selfOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined) setSelfOpen(next);
  };
  const rootRef = useRef<HTMLDivElement | null>(null);
  /* Portalled and placed, same as the toolbar's menus — see useAnchoredMenu
     for why this could not stay `absolute` inside the pane. */
  /* 'start': the capsule lives at a pane's LEFT edge, so the menu opens
     rightward INTO that pane instead of reaching back over its neighbour. */
  const { anchorRef, placed } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', MENU_W, 'start');
  const menuRef = useRef<HTMLDivElement | null>(null);
  /* A focus trap (as CompareControl): the menu covers the pane's controls, and the trap returns focus to the trigger on close. */
  useFocusTrap(open, menuRef);

  // Outside click / Escape closes the picker
  useEffect(() => {
    if (!open) return;
    /* pointerdown, not mousedown: a Radix trigger's pointerdown cancels the compatibility mousedown. */
    const onDown = (e: PointerEvent) => {
      /* The menu is PORTALLED to the body, so it is not inside rootRef any
         more — without the menuRef clause every click on the menu counted as
         an outside click and closed it before it could act. */
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    /* Capture phase, and the key stops here: the desk behind also closes on Escape at window level,
       so the innermost open thing takes the key first. */
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

  const pick = (sym: string) => {
    setOpen(false);
    if (sym && sym !== ticker) onPick(sym);
  };

  return (
    <div ref={rootRef} className="relative">
      {/* TradingView's symbol button: a capsule a shade greyer than its bar (~112×28), the one control with its own surface. */}
      <button
        ref={anchorRef}
        onClick={() => setOpen(!open)}
        title={title}
        className={
          slim
            ? 'hit-24 inline-flex items-center gap-1 px-2 py-0.5 rounded font-mono text-t10 font-semibold text-textPrimary hover:bg-ink/[0.04] transition-colors'
            : 'inline-flex items-center justify-between gap-2 h-7 min-w-[112px] px-3 rounded-full bg-ink/[0.06] hover:bg-ink/[0.10] font-mono text-t11 font-bold text-textPrimary transition-colors'
        }
      >
        {label ?? ticker}
        <ChevronDown className={`w-3 h-3 text-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && placed && createPortal(
        <div
          ref={menuRef}
          role="dialog"
          aria-label={`Change symbol — currently ${ticker}`}
          style={{ position: 'fixed', ...placed.box }}
          className="z-[120] w-72 border border-borderMuted bg-panel/80 backdrop-blur-xl backdrop-saturate-150 rounded-md shadow-2xl shadow-black/60 overflow-x-hidden overflow-y-auto overscroll-contain animate-slide-in"
        >
          <TickerLookup active={ticker} onPick={pick} />
        </div>,
        document.body
      )}
    </div>
  );
};

export default TickerQuickPick;
