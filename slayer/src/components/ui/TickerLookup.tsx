/* The compact search body inside picker menus: the symbol directory, by symbol or by name ("nvidia" finds NVDA), each
   row the symbol and its name. On an option desk only names with listed options are offered. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Search } from 'lucide-react';
import type { TickerListing } from '../../data/tickers';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames } from '../../data/tickers';
import { ensureListed, roomCount, roomOf, searchRoom, useListedRev } from '../../data/listedNames';
import CompanyLogo from './CompanyLogo';
import SymbolRowTag, { noOptionsLine } from './SymbolRowTag';

type TickerModule = typeof import('../../data/tickers');

interface TickerLookupProps {
  onPick: (symbol: string) => void;
  /** Currently active symbol — marked in the list */
  active?: string;
  /** Rows shown at once (list scrolls beyond it) */
  limit?: number;
}

const TickerLookup = ({ onPick, active, limit = 80 }: TickerLookupProps) => {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [mod, setMod] = useState<TickerModule | null>(null);
  const [window, setWindow] = useState(limit);
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  const room = useSyncExternalStore(
    () => () => {},
    () => roomOf(),
    () => 'listed' as const,
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    import('../../data/tickers').then(setMod);
    ensureListed();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const results: TickerListing[] = useMemo(() => {
    if (!mod) return [];
    if (room === 'listed') return mod.searchTickers(query, limit);
    return searchRoom(room, query, window, mod.searchTickers('', 40), companyName);
  }, [mod, query, window, room, listedRev, nameRev]);

  useEffect(() => {
    if (results.length) askCompanyNames(results.map(r => r.symbol));
  }, [results]);

  useEffect(() => {
    setWindow(limit);
    setHighlight(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, limit, room]);

  const onListScroll = () => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setWindow(n => n + 120);
  };

  const pick = (symbol: string) => {
    const sym = symbol.trim().toUpperCase();
    if (sym) onPick(sym);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) pick(results[highlight].symbol);
      else if (room === 'listed') pick(query.slice(0, 6));
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <div className="flex items-center gap-1.5 px-2 border-b border-borderSubtle">
        <Search className="w-3 h-3 text-textMuted shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={room === 'equity' ? 'Symbol or company…' : room === 'option' ? 'Symbol or company, with listed options…' : room === 'compass' ? 'Search the 456…' : 'Symbol or company…'}
          className="w-full bg-transparent py-1.5 font-mono text-t11 text-textPrimary placeholder:text-textMuted focus:outline-none"
        />
      </div>
      <div ref={listRef} onScroll={onListScroll} className="max-h-72 overflow-y-auto py-1">
        {!mod ? (
          <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">Loading tickers…</div>
        ) : results.length === 0 ? (
          <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">
            {room === 'option' ? noOptionsLine(query) ?? 'No name with listed options matches.' : room === 'compass' ? 'Not one of the 456.' : room === 'equity' ? 'No listing by that symbol or name.' : `No listing — Enter picks “${query.trim().toUpperCase().slice(0, 6)}”`}
          </div>
        ) : (
          results.map((t, i) => (
            <button
              key={t.symbol}
              onPointerDown={e => {
                e.preventDefault();
                e.stopPropagation();
                pick(t.symbol);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full flex items-center gap-2 px-2.5 py-1 text-left transition-colors ${
                i === highlight ? 'bg-ink/[0.05]' : ''
              }`}
            >
              <CompanyLogo ticker={t.symbol} size={16} />
              <span
                className={`font-mono text-t11 font-semibold min-w-[3.5rem] shrink-0 ${
                  t.symbol === active ? 'text-silver' : 'text-textPrimary'
                }`}
              >
                {t.symbol}
              </span>
              {(() => {
                const label = companyName(t.symbol);
                const named = label && label.toUpperCase() !== t.symbol ? label : '';
                return (
                  <span className="text-t10 text-textSecondary truncate min-w-0 flex-1" title={named ? `${t.symbol} · ${named}` : undefined}>
                    {named}
                  </span>
                );
              })()}
              <SymbolRowTag symbol={t.symbol} room={room} />
            </button>
          ))
        )}
        {room === 'option' && results.length > 0 && !results.some(r => r.symbol === query.trim().toUpperCase()) && noOptionsLine(query) && (
          <div className="px-2.5 py-1.5 font-mono text-t9 text-textMuted border-t border-borderSubtle">{noOptionsLine(query)}</div>
        )}
      </div>
      {roomCount(room) > 0 && (
        <div className="px-2.5 py-1 border-t border-borderSubtle font-mono text-t9 text-textMuted" data-listed-count={roomCount(room)}>
          {roomCount(room).toLocaleString()} {room === 'option' ? 'names with listed options' : room === 'compass' ? 'names' : 'listings'}
          {results.length < roomCount(room) ? ' · scroll for more' : ''}
        </div>
      )}
    </div>
  );
};

export default TickerLookup;
