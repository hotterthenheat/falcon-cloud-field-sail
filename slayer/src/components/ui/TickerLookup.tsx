/* The compact search body inside picker menus: the symbol directory, by symbol or by name ("nvidia" finds NVDA), each
   row the symbol and its name. On an option desk only names with listed options are offered. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Command, CommandInput, CommandItem, CommandList } from '../shadcn/command';
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
  /* a row is taken on the pointer's press (a host that closes on the press outside never sees a click); the click
     that follows is that press's, not a second pick */
  const pressed = useRef<{ sym: string; at: number } | null>(null);
  const pickByKey = (sym: string) => {
    const p = pressed.current;
    if (p && p.sym === sym && Date.now() - p.at < 1000) return;
    pick(sym);
  };

  /* THE LOOKUP (shadcn Command, 2026-11-01): the search box is a combobox naming the row the arrows are on, the rows are
     options. The directory ranks the rows, so cmdk does not filter; Enter on no row takes the typed symbol where any
     listing goes. */
  return (
    <Command
      shouldFilter={false}
      label="Find a symbol"
      onKeyDown={e => {
        if (e.key === 'Enter' && results.length === 0 && room === 'listed') {
          e.preventDefault();
          pick(query.slice(0, 6));
        }
      }}
    >
      <CommandInput
        ref={inputRef}
        value={query}
        onValueChange={setQuery}
        icon="sm"
        rowClassName="gap-1.5 px-2"
        className="py-1.5 font-mono text-t11"
        placeholder={room === 'equity' ? 'Symbol or company…' : room === 'option' ? 'Symbol or company, with listed options…' : room === 'compass' ? 'Search the 456…' : 'Symbol or company…'}
      />
      <CommandList ref={listRef} onScroll={onListScroll} className="max-h-72 py-1">
        {!mod ? (
          <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">Loading tickers…</div>
        ) : results.length === 0 ? (
          <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">
            {room === 'option' ? noOptionsLine(query) ?? 'No name with listed options matches.' : room === 'compass' ? 'Not one of the 456.' : room === 'equity' ? 'No listing by that symbol or name.' : `No listing — Enter picks “${query.trim().toUpperCase().slice(0, 6)}”`}
          </div>
        ) : (
          results.map(t => {
            const label = companyName(t.symbol);
            const named = label && label.toUpperCase() !== t.symbol ? label : '';
            return (
              <CommandItem
                key={t.symbol}
                value={t.symbol}
                onSelect={() => pickByKey(t.symbol)}
                onPointerDown={e => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  e.stopPropagation();
                  pressed.current = { sym: t.symbol, at: Date.now() };
                  pick(t.symbol);
                }}
                className="gap-2 px-2.5 py-1"
              >
                <CompanyLogo ticker={t.symbol} size={16} />
                <span className={`font-mono text-t11 font-semibold min-w-[3.5rem] shrink-0 ${t.symbol === active ? 'text-silver' : 'text-textPrimary'}`}>{t.symbol}</span>
                <span className="text-t10 text-textSecondary truncate min-w-0 flex-1" title={named ? `${t.symbol} · ${named}` : undefined}>
                  {named}
                </span>
                <SymbolRowTag symbol={t.symbol} room={room} />
              </CommandItem>
            );
          })
        )}
        {room === 'option' && results.length > 0 && !results.some(r => r.symbol === query.trim().toUpperCase()) && noOptionsLine(query) && (
          <div className="px-2.5 py-1.5 font-mono text-t9 text-textMuted border-t border-borderSubtle">{noOptionsLine(query)}</div>
        )}
      </CommandList>
      {roomCount(room) > 0 && (
        <div className="px-2.5 py-1 border-t border-borderSubtle font-mono text-t9 text-textMuted" data-listed-count={roomCount(room)}>
          {roomCount(room).toLocaleString()} {room === 'option' || room === 'pinpoint' ? 'names with listed options' : room === 'compass' ? 'names' : 'listings'}
          {results.length < roomCount(room) ? ' · scroll for more' : ''}
        </div>
      )}
    </Command>
  );
};

export default TickerLookup;
