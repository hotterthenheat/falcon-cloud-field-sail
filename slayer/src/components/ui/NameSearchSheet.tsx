/* THE NAME SEARCH (ported from the partner tree's ui/NameSearchSheet.tsx, 2026-11-02 — "the search in Terrain …
   make it work and fire up perfectly").

   ONE SHEET FOR EVERY NAME DOOR ON TERRAIN: the tab strip's "+" opens it to ADD a tab, the ticker bar's symbol chip
   (and `s`, ⌘K, or a letter typed on the desk) to SWITCH the active pane's name — one search body, the mode its words.

   A row is the mark, the symbol, the company, the kind (ETF · Index · no listed options), the last price and the day's
   change where this browser already holds the name's quote (free to show — a row never asks for one), and a star that
   keeps the name on the watchlist (data/nameWatch.ts). The right column (ui/NameSearchRead.tsx) reads the name the
   pointer or the arrows SETTLED on, in two beats (ui/useNameRead.ts): what the browser holds at once, the name's card
   — its report, its wire, its insiders, Congress, one request to our server — only after a longer rest, and once.

   At rest the list opens on the watchlist's own names, then the featured names and every listing by popularity
   (data/nameSearch.ts). ↑↓ walk, Enter picks (in watch mode toggles the watch), Esc closes; the keyboard is trapped
   inside. A key typed while the field is not focused lands in the field. On a phone it is a bottom sheet with the
   list alone. */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CornerDownLeft, Search, Star, X } from 'lucide-react';
import { companyNamesRev, subscribeCompanyNames, askCompanyNames, type TickerListing } from '../../data/tickers';
import { ensureListed, useListedRev } from '../../data/listedNames';
import { useDirectoryRev } from '../../data/symbolDirectory';
import { searchNames } from '../../data/nameSearch';
import { MAX_NAMES, isWatchedName, unwatchName, useNameWatch, watchName } from '../../data/nameWatch';
import { peekThetaPrice, subscribeThetaPrices, thetaMove, thetaPriceRev } from '../../data/thetaQuote';
import { peekQuote, sessionPrice } from '../../data/liveQuote';
import { thetaUseHere } from '../../data/theta';
import { signedPct } from '../../data/dayChange';
import { phaseAt, printIsCurrent, whenWords } from '../../core/session';
import CompanyLogo from './CompanyLogo';
import SymbolRowTag from './SymbolRowTag';
import NameSearchRead from './NameSearchRead';
import { useNameRead } from './useNameRead';
import useFocusTrap from './useFocusTrap';
import { useIsPhone } from './useMediaQuery';

export type NameSearchMode = 'switch' | 'add' | 'watch';

interface NameSearchSheetProps {
  open: boolean;
  onClose: () => void;
  mode: NameSearchMode;
  /** The name in hand — a chip in the head, silver in the list */
  current?: string;
  /** switch · add: the name picked (the sheet closes itself) */
  onPick?: (symbol: string) => void;
  /** What the field opens holding — the letter typed on the desk that opened it */
  seed?: string;
  /** add: the tabs already open and how many fit, for the head's words */
  tabsLine?: string;
  /** A door in the foot to the shell's palette (pages and tools) — Terrain, where ⌘K is this sheet */
  onPages?: () => void;
  /** watch: the section a watched name lands in */
  sectionId?: string;
  sectionName?: string;
}

const FIRST_ROWS = 16;
const fmtPrice = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const noSub = () => () => {};
const zero = () => 0;

/** A row's quote, from what this browser already holds — never asked for here */
function rowQuote(symbol: string): { price: number; pct: number | null; current: boolean; at: number } | null {
  if (thetaUseHere() !== 'none') {
    const h = peekThetaPrice(symbol);
    if (!h || !(h.value.price > 0)) return null;
    const mv = thetaMove(h.value);
    return { price: h.value.price, pct: mv?.pct ?? null, current: h.live && printIsCurrent(h.value.at) && phaseAt(Date.now()) !== 'overnight', at: h.value.at };
  }
  const q = peekQuote(symbol);
  const p = sessionPrice(q);
  if (!q || p == null) return null;
  return { price: p, pct: q.phase === 'pre' ? q.lastSessionPct : Number.isFinite(q.changePct) ? q.changePct : null, current: printIsCurrent(q.tapeAt) && phaseAt(Date.now()) !== 'overnight', at: q.tapeAt };
}

/* ONE ROW, MEMOISED: a hover re-renders the two rows the highlight left and reached, not all forty */
interface NameRowProps {
  symbol: string;
  name: string;
  index: number;
  on: boolean;
  here: boolean;
  watched: boolean;
  /** "price|pct|current" — the row's quote as a primitive so the memo holds */
  quote: string;
  onHover: (i: number) => void;
  onPick: (symbol: string) => void;
  onStar: (symbol: string) => void;
}
const NameRow = memo(({ symbol, name, index, on, here, watched, quote, onHover, onPick, onStar }: NameRowProps) => {
  const [p, pct, cur, at] = quote ? quote.split('|') : [];
  const price = p ? Number(p) : null;
  const move = pct ? Number(pct) : null;
  const current = cur === '1';
  return (
    <div role="option" id={`name-row-${symbol}`} aria-selected={on} onMouseMove={() => !on && onHover(index)} className={`group flex items-center gap-2.5 pl-3.5 pr-2 h-9 ${on ? 'bg-ink/[0.05]' : ''} transition-colors`} data-name-row={symbol} data-on={on || undefined}>
      <button type="button" tabIndex={-1} onClick={() => onPick(symbol)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left h-full outline-none" data-name-pick={symbol}>
        <CompanyLogo ticker={symbol} size={18} />
        <span className={`font-mono text-t12 font-bold w-16 shrink-0 ${here ? 'text-silver' : 'text-textPrimary'}`}>{symbol}</span>
        <span className="flex-1 min-w-0 text-t11 text-textSecondary truncate">{name && name.toUpperCase() !== symbol ? name : ''}</span>
        <span className="hidden sm:contents">
          <SymbolRowTag symbol={symbol} room="equity" />
        </span>
        {price != null && (
          <span className="inline-flex shrink-0 items-baseline justify-end gap-2 font-mono" data-name-price title={current ? 'The last print' : `The last print, as of ${whenWords(Number(at))}`}>
            <span className={`text-t12 tnum w-[64px] sm:w-[72px] text-right ${current ? 'text-textPrimary' : 'text-textSecondary'}`}>{fmtPrice(price)}</span>
            <span className={`text-t105 tnum w-[50px] sm:w-[56px] text-right ${move == null || Math.abs(move) < 0.005 ? 'text-textMuted' : move > 0 ? 'text-bull' : 'text-bear'}`}>{move == null ? '' : signedPct(move)}</span>
          </span>
        )}
      </button>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onStar(symbol)}
        aria-pressed={watched}
        aria-label={watched ? `Take ${symbol} off the watchlist` : `Watch ${symbol}`}
        title={watched ? 'On the watchlist — press to take it off' : 'Keep it on the watchlist'}
        className={`shrink-0 ml-1 w-7 h-7 inline-flex items-center justify-center rounded transition-colors ${watched ? 'text-silver' : `text-textMuted/50 hover:text-textPrimary ${on ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} hover:bg-ink/[0.06]`}
        data-name-star={symbol}
        data-on={watched || undefined}
      >
        <Star className="w-3.5 h-3.5" fill={watched ? 'currentColor' : 'none'} />
      </button>
    </div>
  );
});
NameRow.displayName = 'NameRow';

const NameSearchSheet = ({ open, onClose, mode, current, onPick, seed = '', tabsLine, onPages, sectionId, sectionName }: NameSearchSheetProps) => {
  const [query, setQuery] = useState(seed);
  const [highlight, setHighlight] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  /* THE FIRST FRAME DRAWS A SCREEN OF ROWS, the rest the frame after — the sheet is up in one paint, the list fills in
     under the fold before anyone can scroll to it */
  const [rowsShown, setRowsShown] = useState(FIRST_ROWS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const isPhone = useIsPhone();
  const watch = useNameWatch();
  const dirRev = useDirectoryRev();
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(open ? subscribeCompanyNames : noSub, companyNamesRev, zero);
  /* the rows' prices move with the quote store while the sheet is open; shut, it hears nothing */
  const priceRev = useSyncExternalStore(open ? subscribeThetaPrices : noSub, open ? thetaPriceRev : zero, zero);
  useFocusTrap(open, panelRef);

  /* the field takes the seed and the focus in the same frame the sheet paints */
  useLayoutEffect(() => {
    if (!open) return;
    setQuery(seed);
    setHighlight(0);
    setSaid(null);
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(seed.length, seed.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    ensureListed();
    setRowsShown(FIRST_ROWS);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setRowsShown(Infinity)));
    return () => cancelAnimationFrame(id);
  }, [open]);

  /* Escape closes — on capture, so the pane or the drawer behind never sees the key. A printable key pressed while the
     field has lost the focus (a row clicked, the scrim) is put back in the field, where it lands. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
        return;
      }
      const el = inputRef.current;
      if (el && document.activeElement !== el && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) el.focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const watched = useMemo(() => {
    const out: string[] = [];
    for (const s of watch.sections) for (const n of s.names) out.push(n.symbol);
    return out;
  }, [watch]);

  const results: TickerListing[] = useMemo(
    () => (open ? searchNames(query, watched) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, query, watched, dirRev, listedRev, nameRev]
  );
  useEffect(() => {
    if (open && results.length) askCompanyNames(results.slice(0, 40).map(r => r.symbol));
  }, [open, results]);

  useEffect(() => {
    setHighlight(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);

  const hiIndex = Math.min(highlight, Math.max(0, results.length - 1));
  const hi = results[hiIndex];
  const hiSym = hi?.symbol ?? null;
  /* a phone shows the list alone: nothing is read for a column it does not draw */
  const { settled, asked, card } = useNameRead(open && !isPhone, hiSym);
  const settledRow = settled ? results.find(r => r.symbol === settled) ?? null : null;

  useEffect(() => {
    if (!hiSym) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-name-row="${CSS.escape(hiSym)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [hiSym]);

  const toggleWatch = (sym: string) => {
    if (isWatchedName(sym)) {
      unwatchName(sym);
      setSaid(`${sym} is off the list`);
      return;
    }
    const r = watchName(sym, sectionId);
    setSaid(
      r === 'added' ? `${sym} is on the list${sectionName ? `, in ${sectionName}` : ''}`
      : r === 'already' ? `${sym} is on the list already`
      : r === 'full' ? `The list holds ${MAX_NAMES} names`
      : 'That is not a name'
    );
  };
  const choose = (symRaw: string) => {
    const sym = symRaw.trim().toUpperCase();
    if (!sym) return;
    if (mode === 'watch') {
      toggleWatch(sym);
      return;
    }
    onClose();
    onPick?.(sym);
  };
  /* the rows' callbacks hold still across renders (the memo above) and reach the newest choose / toggleWatch */
  const actions = useRef({ choose, toggleWatch });
  actions.current = { choose, toggleWatch };
  const onHover = useCallback((i: number) => setHighlight(i), []);
  const onPickRow = useCallback((sym: string) => actions.current.choose(sym), []);
  const onStarRow = useCallback((sym: string) => actions.current.toggleWatch(sym), []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setHighlight(h => Math.max(0, Math.min(results.length - 1, h + (e.key === 'PageDown' ? 8 : -8))));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (hi) choose(hi.symbol);
    }
  };

  if (!open) return null;

  const words = mode === 'add' ? 'Add a tab — another name on this pane' : mode === 'watch' ? `Watch names${sectionName ? ` — ${sectionName}` : ''}` : 'Switch the name';
  const enterWords = mode === 'watch' ? 'Enter watches the name; the star does the same on any row.' : mode === 'add' ? 'Enter adds it as a tab on this pane.' : 'Enter puts it on the chart.';
  const onList = watched.length;
  void priceRev;

  return createPortal(
    <div className={`fixed inset-0 z-[130] flex justify-center ${isPhone ? 'items-end' : 'items-start pt-[10vh] px-4'}`} onKeyDown={onKeyDown} data-name-search={mode}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden data-name-search-scrim />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={words}
        className={`relative w-full flex flex-col border border-borderMuted bg-panel/85 backdrop-blur-xl backdrop-saturate-150 shadow-2xl shadow-black overflow-hidden animate-slide-in ${
          isPhone ? 'h-[85dvh] rounded-t-lg' : 'max-w-[900px] h-[min(640px,84vh)] rounded-lg'
        }`}
        data-name-search-panel
      >
        {/* THE HEAD: the search, the name in hand as a chip, the way out */}
        <div className="shrink-0 flex items-center gap-2.5 px-3.5 h-12 border-b border-borderSubtle">
          <Search className="w-4 h-4 text-textMuted shrink-0" />
          {current && (
            <span className="shrink-0 inline-flex items-center gap-1.5 pl-1.5 pr-2 h-6 rounded bg-ink/[0.08] font-mono text-t11 font-bold text-textPrimary" title={mode === 'add' ? `The pane holds ${current}` : `On the chart: ${current}`} data-name-search-current={current}>
              <CompanyLogo ticker={current} size={14} />
              {current}
            </span>
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search a name or a company…"
            aria-label="Search a name or a company"
            aria-controls="name-search-list"
            aria-activedescendant={hiSym ? `name-row-${hiSym}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="flex-1 min-w-0 bg-transparent font-mono text-t13 text-textPrimary placeholder:text-textMuted focus:outline-none"
            data-name-search-input
          />
          <button type="button" onClick={onClose} aria-label="Close" title="Close (Esc)" className="shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          {/* THE LIST */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="shrink-0 flex items-center justify-between px-3.5 py-1.5 font-mono text-t9 uppercase tracking-wider text-textMuted">
              <span>{query.trim() ? 'Every listing' : onList ? 'Your watchlist, then every listing' : 'Every listing'}{mode === 'add' && tabsLine ? ` · ${tabsLine}` : ''}</span>
              <span className="tnum" data-name-search-count={results.length}>{results.length} shown</span>
            </div>
            <div ref={listRef} id="name-search-list" role="listbox" aria-label="Names" className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-1" data-name-search-list>
              {results.length === 0 ? (
                <p className="px-3.5 py-6 text-center font-mono text-t10 text-textMuted" data-name-search-none>
                  No listing by “{query.trim().toUpperCase().slice(0, 12)}” — try the company’s name
                </p>
              ) : (
                results.slice(0, rowsShown).map((t, i) => {
                  const q = rowQuote(t.symbol);
                  return (
                      <NameRow
                        key={t.symbol}
                        symbol={t.symbol}
                        name={t.name}
                        index={i}
                        on={i === hiIndex}
                        here={t.symbol === current}
                        watched={isWatchedName(t.symbol, watch)}
                        quote={q ? `${q.price}|${q.pct ?? ''}|${q.current ? 1 : 0}|${q.at}` : ''}
                        onHover={onHover}
                        onPick={onPickRow}
                        onStar={onStarRow}
                      />
                  );
                })
              )}
            </div>
          </div>

          {/* THE READ: the highlighted name, ours */}
          {!isPhone && (
            <aside className="w-[300px] shrink-0 border-l border-borderSubtle/60 px-4 py-3 flex flex-col overflow-y-auto overscroll-contain" aria-label="The highlighted name's read" data-name-search-read={settled ?? undefined}>
              {settledRow ? (
                <NameSearchRead symbol={settledRow.symbol} name={settledRow.name} asked={asked} card={card} enterWords={enterWords} />
              ) : (
                <p className="font-mono text-t10 text-textMuted">Walk the list — the highlighted name reads here.</p>
              )}
            </aside>
          )}
        </div>

        {/* THE FOOT: the keys, what was said, the way out of watch mode — on a phone only when it has something to say */}
        {(!isPhone || mode === 'watch' || said) && (
          <div className="shrink-0 flex items-center gap-3 px-3.5 h-9 border-t border-borderSubtle font-mono text-t9 text-textMuted">
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <kbd className="px-1 rounded border border-borderSubtle text-t9">↑↓</kbd> Walk
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <kbd className="px-1 rounded border border-borderSubtle inline-flex items-center">
                <CornerDownLeft className="w-2.5 h-2.5" />
              </kbd>{' '}
              {mode === 'watch' ? 'Watch' : mode === 'add' ? 'Add' : 'Pick'}
            </span>
            <span className="hidden sm:inline-flex items-center gap-1.5">
              <kbd className="px-1 rounded border border-borderSubtle text-t9">Esc</kbd> Close
            </span>
            {said && (
              <span role="status" className="truncate text-textSecondary" data-name-search-said>
                {said}
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-3">
              {onPages && !isPhone && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onPages();
                  }}
                  className="h-6 px-2 rounded border border-borderSubtle text-t9 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors"
                  data-name-search-pages
                >
                  Pages and tools
                </button>
              )}
              {mode === 'watch' && <span className="tnum">{onList} on the list</span>}
              {mode === 'watch' && (
                <button type="button" onClick={onClose} className="h-6 px-2.5 rounded border border-borderSubtle text-t9 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-name-search-done>
                  Done
                </button>
              )}
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default NameSearchSheet;
