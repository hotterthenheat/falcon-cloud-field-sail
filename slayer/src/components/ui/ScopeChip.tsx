/* Which name a surface reads: following the frame ("follows SPY", a pick moves the frame) or its own name (a pick stays local,
   a broken link rejoins). Surfaces without a link model show the own-name chip alone. */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Link2, Unlink2 } from 'lucide-react';
import { extendedLine, priceWords, useLiveQuote, type LiveQuote } from '../../data/liveQuote';
import { thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { thetaUseHere } from '../../data/theta';
import { DayRef } from '../../data/bookWindow';

/** "Oct 22" */
const shortMonDay = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MON3[m - 1]} ${d}` : iso;
};
const sessionWord = (q: LiveQuote | null | undefined): string => {
  const d = q && q.phase !== 'regular' ? q.regDate : null;
  const w = d ? DayRef(d) : 'Today';
  return `${w}'s`;
};
import CompanyLogo from './CompanyLogo';
import TickerLookup from './TickerLookup';
import useFocusTrap from './useFocusTrap';
import { useAnchoredMenu } from './useAnchoredMenu';
import { MorphingInfinity, useWorking } from './Working';
import { useNameArriving } from '../gex/useSeeded';
import { MONTHS as MON3 } from '../../core/calendar';

const SILVER = 'rgb(var(--silver))'; /* the silver token (deep steel on the light theme) */
/** Matches the `w-72` on the menu — the placement keeps its far edge on screen */
const MENU_W = 288;

interface ScopeChipProps {
  /** The name this surface reads right now */
  ticker: string;
  /** Whether it follows the frame's subject. Omitted = no link model: the
      surface always holds its own name (Terrain panes, the 4-way board). */
  linked?: boolean;
  /** Link ↔ unlink. Only meaningful with `linked`. */
  onToggleLink?: () => void;
  /** A name was picked; the host decides whether it moves the frame or only this surface. */
  onPick: (ticker: string) => void;
  /** Print the live price and change on an own-name chip. Off where the
      host already prints its own price beside the chip. */
  quote?: boolean;
  /** Outside the regular session, print the regular close as the price with the extended-hours move beside it */
  closeOutside?: boolean;
  /** Optionally controlled, like TickerQuickPick — a host with keys owns it */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  /** The following chip dressed as the own-name chip (mark, name, quote) with the link at its end, for surfaces where
      two chips stand side by side. */
  full?: boolean;
  /** Show the spinner while the name's Pinpoint book loads (which starts that load). Off for surfaces that never read it. */
  arrive?: boolean;
}

const ScopeChip = ({ ticker, linked, onToggleLink, onPick, quote, closeOutside = true, open: openProp, onOpenChange, title, full = false, arrive = true }: ScopeChipProps) => {
  const [selfOpen, setSelfOpen] = useState(false);
  const arriving = useWorking(useNameArriving(arrive ? ticker : null));
  const open = openProp ?? selfOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined) setSelfOpen(next);
  };
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { anchorRef, placed } = useAnchoredMenu<HTMLButtonElement>(open, 'bottom', MENU_W, 'start');
  useFocusTrap(open, menuRef);

  /* Outside click and Escape close it; Escape is captured on window so the desk behind never sees it. pointerdown, not
     mousedown: Radix triggers prevent the compatibility mousedown, so two menus could stay open. */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (sym: string) => {
    setOpen(false);
    if (sym) onPick(sym);
  };

  const hasLink = linked !== undefined;
  const follows = linked === true;

  /* The price: ThetaData's last print wherever the page may read it, Unusual Whales' quote where it may not (Trace,
     the Dossier). A dash until it answers. Never the simulator. */
  const shown = !!quote && (!follows || full);
  const theta = thetaUseHere() !== 'none';
  const thetaRead = useThetaPrice(shown && theta ? ticker : null).held;
  const live = useLiveQuote(shown && !theta ? ticker : null);
  const price = closeOutside ? priceWords(live)?.lead : live?.spot;
  /* before the open, the lead is the last session's change named by its date, with the pre-market move beside it */
  const pre = live?.phase === 'pre';
  const change = pre ? live?.lastSessionPct ?? null : live?.changePct;
  const changeDay = pre && live?.regDate ? shortMonDay(live.regDate) : null;

  const menu =
    open &&
    placed &&
    createPortal(
      <div
        ref={menuRef}
        role="dialog"
        aria-label={`Change symbol — currently ${ticker}`}
        style={{ position: 'fixed', ...placed.box }}
        className="z-[120] w-72 border border-borderMuted bg-panel/80 backdrop-blur-xl backdrop-saturate-150 rounded-md shadow-2xl shadow-black/60 overflow-x-hidden overflow-y-auto overscroll-contain animate-slide-in"
      >
        {hasLink && (
          <div className="px-2.5 py-1.5 border-b border-borderSubtle text-t10 text-textMuted">
            {follows ? 'Follows the frame — a name picked here moves the whole terminal' : 'Its own name — a name picked here stays on this panel'}
          </div>
        )}
        <TickerLookup active={ticker} onPick={pick} />
      </div>,
      document.body
    );

  /* one chip for both states: the picker, then the link state behind a hairline */
  return (
    <span
      ref={rootRef}
      /* h-6: the chip sits on 24px title rows, and the page skeletons assume it. No overflow clip: the two buttons round
         their own ends, so their hit areas (hit-24: 24px at a desk, 44 on a phone) reach past the 22px inside */
      className={`relative inline-flex items-stretch h-6 rounded-md border bg-chip transition-colors font-mono select-none ${open ? 'border-silver/50' : 'border-borderSubtle hover:border-borderMuted'}`}
      data-scope={follows ? 'follows' : 'own'}
      data-scope-ticker={ticker}
    >
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={`${follows ? 'Follows' : 'Reads'} ${ticker} — pick another name`}
        title={title ?? (follows ? 'Follows the terminal · pick a name to move the whole terminal' : hasLink ? 'Its own name · pick a name for this panel alone' : 'Switch ticker')}
        className={`hit-24 inline-flex items-center gap-1.5 pl-2 pr-1.5 rounded-l-[5px] ${hasLink ? '' : 'rounded-r-[5px]'} hover:bg-ink/[0.05] transition-colors`}
        data-scope-pick
      >
        <CompanyLogo ticker={ticker} size={14} />
        <span className="text-t12 font-semibold text-textPrimary leading-none">{ticker}</span>
        {theta && thetaRead && (() => {
          const p = thetaRead.value;
          const mv = thetaMove(p);
          const asOf = thetaRead.live ? '' : ` · last print kept from ${new Date(p.read).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
          return (
            <>
              <span className={`text-t11 tnum leading-none ${thetaRead.live ? 'text-textPrimary' : 'text-textSecondary'}`} title={`ThetaData last print${asOf}`} data-scope-price>
                ${p.price.toFixed(2)}
              </span>
              {mv && (
                <span className={`text-t10 tnum leading-none whitespace-nowrap ${Math.abs(mv.pct) < 0.005 ? 'text-textSecondary' : mv.pct > 0 ? 'text-bull' : 'text-bear'}`} title={`Against the prior regular close, ${mv.base.toFixed(2)}${mv.ext != null ? ` · after hours ${mv.ext >= 0 ? '+' : '−'}${Math.abs(mv.ext).toFixed(2)}%` : ''}`} data-scope-change>
                  {`${mv.pct > 0 ? '+' : mv.pct < 0 ? '−' : ''}${Math.abs(mv.pct).toFixed(2)}%`}
                </span>
              )}
            </>
          );
        })()}
        {!theta && price != null && live != null && (
          <>
            <span className="text-t11 tnum text-textPrimary leading-none" data-scope-price>
              ${price.toFixed(2)}
            </span>
            {/* the regular session's change, the extended move beside it (zero is neutral); outside the session it is named by
                its date */}
            <span className={`text-t10 tnum leading-none whitespace-nowrap ${change == null || Math.abs(change) < 0.005 ? 'text-textSecondary' : change > 0 ? 'text-bull' : 'text-bear'}`} title={`${sessionWord(live)} regular-session change (its 4:00 close against the close before)${pre ? ' — the session has not opened' : ''}${closeOutside && live?.phase !== 'regular' && live?.regClose != null ? ` · the price is that ${live.regClose.toFixed(2)} close` : ''}${extendedLine(live) ? ` · ${extendedLine(live)}${live?.extPrice != null ? ` at ${live.extPrice.toFixed(2)}` : ''}, kept apart` : ''}`} data-scope-change>
              {change == null ? '…' : `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(2)}%`}
              {changeDay && <span className="text-textMuted"> {changeDay}</span>}
            </span>
            {extendedLine(live) && (
              <span className="text-t10 tnum leading-none text-textMuted whitespace-nowrap" data-scope-ext>
                {/* the chip's room is a title row's: "pre" and "AH" stand for the words, which the hover spells out */}
                · {pre ? extendedLine(live)!.replace('pre-market', 'pre') : closeOutside && live?.extPrice != null ? `AH ${live.extPrice.toFixed(2)}` : extendedLine(live)!.replace('after hours', 'AH')}
              </span>
            )}
          </>
        )}
        {/* the name is still loading (ui/Working.tsx): the mark takes the chevron's 12px, so nothing on the head moves */}
        {arriving ? (
          <MorphingInfinity viewBox="4 4 16 16" className="w-3 h-3 text-textSecondary" data-scope-arriving />
        ) : (
          <ChevronDown className={`w-3 h-3 text-textMuted transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>
      {hasLink && (
        <button
          type="button"
          onClick={onToggleLink}
          aria-pressed={follows}
          aria-label={follows ? `Follows the terminal's ${ticker} — click to give this panel its own name` : `Holds ${ticker} — click to follow the terminal again`}
          title={follows ? 'Follows the terminal · click to give this panel its own name' : 'Its own name · click to follow the terminal again'}
          className={`hit-24 inline-flex items-center justify-center px-1.5 rounded-r-[5px] border-l border-borderSubtle hover:bg-ink/[0.05] transition-colors ${follows ? '' : 'text-textMuted hover:text-textPrimary'}`}
          style={follows ? { color: SILVER } : undefined}
          data-scope-link
        >
          {follows ? <Link2 className="w-3 h-3" /> : <Unlink2 className="w-3 h-3" />}
        </button>
      )}
      {menu}
    </span>
  );
};

export default ScopeChip;
