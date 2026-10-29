/* Compare symbols, TradingView's "+": a search over the universe; hovering a row shows the three ways onto the chart
   (same % scale, new price scale, new pane). Added symbols list at the top with their ink and an ✕. */

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, X } from 'lucide-react';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames, type TickerListing } from '../../data/tickers';
import { ensureListed, roomOf, searchRoom, useListedRev } from '../../data/listedNames';
import CompanyLogo from '../ui/CompanyLogo';
import type { CompareEntry, CompareMode } from './StrikeChart';
import useFocusTrap from '../ui/useFocusTrap';

type TickerModule = typeof import('../../data/tickers');

const MODE_LABEL: Record<CompareMode, string> = {
  percent: 'Same % scale',
  scale: 'New price scale',
  pane: 'New pane',
};
const MODES = Object.keys(MODE_LABEL) as CompareMode[];

interface CompareControlProps {
  /** The chart's own name — excluded from the list */
  current: string;
  compares: CompareEntry[];
  onAdd: (ticker: string, mode: CompareMode) => void;
  onRemove: (ticker: string, mode: CompareMode) => void;
  /** Roster cap — the + dims when reached */
  max?: number;
  /* OPTIONALLY CONTROLLED — see TickerQuickPick for the same shim and why. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const CompareControl = ({
  current, compares, onAdd, onRemove, max = 4, open: openProp, onOpenChange,
}: CompareControlProps) => {
  const [selfOpen, setSelfOpen] = useState(false);
  const open = openProp ?? selfOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (openProp === undefined) setSelfOpen(next);
  };
  const [query, setQuery] = useState('');
  const [mod, setMod] = useState<TickerModule | null>(null);
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  const room = roomOf();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const full = compares.length >= max;

  /* A combobox with one tab stop: Up/Down choose the row and Left/Right the scale, both from the search box, which keeps focus
     to keep filtering. The scale buttons stay for the pointer but leave the tab order. */
  const [highlight, setHighlight] = useState(0);
  const [modeIdx, setModeIdx] = useState(0);
  const uid = useId();

  // Outside click / Escape closes — the TickerQuickPick contract
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    /* Capture phase, and the key stops here: the desk behind also closes on Escape at window level,
       so the innermost open thing takes the key first (as the date picker does). */
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

  useEffect(() => {
    if (!open) return;
    import('../../data/tickers').then(setMod);
    if (room !== 'listed') ensureListed();
    requestAnimationFrame(() => inputRef.current?.focus());
    setHighlight(0);
    setModeIdx(0);
  }, [open]);

  /* A new search is a new list — keeping the old index would leave the
     highlight on whatever row happens to sit at that position now. */
  useEffect(() => setHighlight(0), [query]);

  /* One focusable inside, so the trap pins Tab to the search box rather than
     letting it land on a control hidden behind this menu — and hands focus
     back to the + button on the way out, which did not happen before. */
  useFocusTrap(open, menuRef);

  const taken = useMemo(() => new Set(compares.map(c => c.ticker)), [compares]);
  const results: TickerListing[] = useMemo(() => {
    if (!mod) return [];
    const rows = room === 'listed' ? mod.searchTickers(query, 24) : searchRoom(room, query, 24, mod.searchTickers('', 40), companyName);
    return rows.filter(t => t.symbol !== current && !taken.has(t.symbol));
  }, [mod, query, current, taken, room, listedRev, nameRev]);

  useEffect(() => {
    if (open && results.length) askCompanyNames(results.map(r => r.symbol));
  }, [open, results]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(results.length - 1, highlight + (e.key === 'ArrowDown' ? 1 : -1)));
      setHighlight(next);
      rowRefs.current[next]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setModeIdx(cur => Math.max(0, Math.min(MODES.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = results[highlight];
      if (!full && pick) add(pick.symbol, MODES[modeIdx]);
    }
  };

  const add = (symbol: string, mode: CompareMode) => {
    onAdd(symbol.trim().toUpperCase(), mode);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        title={full ? `Compare (${max} max — remove one first)` : 'Compare symbol'}
        aria-label="Compare symbol"
        className="inline-flex items-center justify-center w-7 h-7 max-sm:w-10 max-sm:h-10 rounded-md border border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          ref={menuRef}
          tabIndex={-1}
          className="absolute left-0 top-full mt-1 z-40 w-[380px] border border-borderMuted bg-panel rounded-md shadow-2xl shadow-black/60 overflow-hidden animate-slide-in"
        >
          <div className="flex items-center gap-1.5 px-2 border-b border-borderSubtle">
            <Search className="w-3 h-3 text-textMuted shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls={`${uid}-list`}
              aria-autocomplete="list"
              aria-activedescendant={results[highlight] ? `${uid}-opt-${highlight}` : undefined}
              placeholder={room === 'compass' ? 'Compare one of the 456…' : room === 'option' ? 'Compare a name with options…' : 'Compare symbols…'}
              title="Up and down to choose a symbol, left and right for the scale, Enter to add"
              className="w-full bg-transparent py-1.5 font-mono text-t11 text-textPrimary placeholder:text-textMuted focus:outline-none"
            />
          </div>

          {compares.length > 0 && (
            <div className="border-b border-borderSubtle/60 py-1">
              <div className="px-2.5 pt-1 pb-0.5 font-mono text-t9 uppercase tracking-wider text-textMuted">
                Added symbols
              </div>
              {compares.map(c => (
                <div key={`${c.ticker}:${c.mode}`} className="flex items-center gap-2 px-2.5 py-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.ink }} aria-hidden />
                  <span className="font-mono text-t11 font-semibold text-textPrimary w-14 shrink-0">{c.ticker}</span>
                  <span className="font-mono text-t10 text-textMuted">{MODE_LABEL[c.mode]}</span>
                  <button
                    onClick={() => onRemove(c.ticker, c.mode)}
                    aria-label={`Remove ${c.ticker} comparison`}
                    title="Remove comparison"
                    className="ml-auto inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* tabIndex is not decorative: Chrome makes an overflowing scroll
              container focusable, which showed up as an unnamed tab stop. */}
          <div id={`${uid}-list`} role="listbox" tabIndex={-1} aria-label="Symbols to compare" className="max-h-64 overflow-y-auto py-1">
            {!mod ? (
              <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">Loading tickers…</div>
            ) : results.length === 0 ? (
              <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">No matches</div>
            ) : (
              results.map((t, i) => (
                <div
                  key={t.symbol}
                  id={`${uid}-opt-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  ref={el => { rowRefs.current[i] = el; }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`group relative flex items-center gap-2 px-2.5 py-1.5 hover:bg-ink/[0.04] transition-colors ${
                    i === highlight ? 'bg-ink/[0.05]' : ''
                  }`}
                >
                  <CompanyLogo ticker={t.symbol} size={16} />
                  <span className="font-mono text-t11 font-semibold text-textPrimary w-14 shrink-0">{t.symbol}</span>
                  <span className="text-t10 text-textSecondary truncate" title={companyName(t.symbol) !== t.symbol ? companyName(t.symbol) : undefined}>{companyName(t.symbol).toUpperCase() === t.symbol ? '' : companyName(t.symbol)}</span>
                  {/* The TV move: the row's right side becomes the three
                      scale choices on hover — how the line joins the chart */}
                  {!full && (
                    <span
                      className={`touch-reveal absolute right-1.5 top-1/2 -translate-y-1/2 items-center gap-1 bg-panel pl-1.5 ${
                        i === highlight ? 'flex' : 'hidden group-hover:flex'
                      }`}
                    >
                      {MODES.map((mode, mi) => {
                        const ringed = i === highlight && mi === modeIdx;
                        return (
                          <button
                            key={mode}
                            /* Out of the tab order, not the DOM: pointer and touch are unchanged; a keyboard steers these from the search box. */
                            tabIndex={-1}
                            onClick={() => add(t.symbol, mode)}
                            /* The ring follows the pointer: hover moves the same modeIdx the arrows steer, so Enter always adds what the ring marks. */
                            onMouseEnter={() => setModeIdx(mi)}
                            aria-label={`Add ${t.symbol} — ${MODE_LABEL[mode]}`}
                            className={`relative px-1.5 py-0.5 rounded border bg-inset font-mono text-t9 whitespace-nowrap transition-colors duration-150 ${
                              ringed
                                ? 'border-transparent text-textPrimary'
                                : 'border-borderSubtle text-textSecondary hover:text-textPrimary'
                            }`}
                          >
                            {/* One shared ring that GLIDES between the chips —
                                the FilterTabs pill grammar via layoutId. */}
                            {ringed && (
                              <motion.span
                                layoutId={`${uid}-mode-ring`}
                                className="absolute -inset-px rounded border border-select pointer-events-none"
                                transition={{ type: 'spring', bounce: 0.18, duration: 0.28 }}
                                aria-hidden
                              />
                            )}
                            {MODE_LABEL[mode]}
                          </button>
                        );
                      })}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CompareControl;
