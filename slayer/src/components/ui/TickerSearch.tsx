import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames, type TickerListing } from '../../data/tickers';
import { ensureListed, roomOf, searchRoom, useListedRev } from '../../data/listedNames';
import CompanyLogo from './CompanyLogo';

type TickerModule = typeof import('../../data/tickers');

interface TickerSearchProps {
  value: string;
  onChange: (symbol: string) => void;
}

/** Compact searchable ticker menu — filters the full NASDAQ universe (lazy-loaded). */
const TickerSearch = ({ value, onChange }: TickerSearchProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [mod, setMod] = useState<TickerModule | null>(null);
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  const room = roomOf();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const results: TickerListing[] = useMemo(() => {
    if (!mod) return [];
    if (room === 'listed') return mod.searchTickers(query, 60);
    return searchRoom(room, query, 60, mod.searchTickers('', 40), companyName);
  }, [mod, query, room, listedRev, nameRev]);

  useEffect(() => {
    if (results.length) askCompanyNames(results.map(r => r.symbol));
  }, [results]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      if (!mod) import('../../data/tickers').then(setMod);
      ensureListed();
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, mod]);

  useEffect(() => setHighlight(0), [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
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
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 border border-borderSubtle hover:border-borderMuted bg-panel rounded-md pl-2.5 pr-2 py-1.5 font-mono text-xs transition-colors min-w-[104px]"
      >
        <CompanyLogo ticker={value} size={14} />
        <span className="font-semibold text-textPrimary">{value}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-textMuted ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-40 w-80 border border-borderMuted bg-panel rounded-lg shadow-2xl shadow-black overflow-hidden animate-slide-in"
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center gap-2 px-3 border-b border-borderSubtle">
            <Search className="w-3.5 h-3.5 text-textMuted" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={room === 'equity' ? 'Ticker or company…' : room === 'option' ? 'Ticker or company, options only…' : room === 'compass' ? 'One of the 456…' : 'Search tickers…'}
              className="w-full bg-transparent py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {!mod ? (
              <div className="px-3 py-6 text-center font-mono text-t11 text-textMuted">Loading tickers…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-6 text-center font-mono text-t11 text-textMuted">No matches</div>
            ) : (
              results.map((t, i) => (
                <button
                  key={t.symbol}
                  onClick={() => pick(t.symbol)}
                  onMouseEnter={() => setHighlight(i)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                    i === highlight ? 'bg-ink/[0.05]' : ''
                  }`}
                >
                  <CompanyLogo ticker={t.symbol} size={16} />
                  <span
                    className={`font-mono text-xs font-semibold w-14 shrink-0 ${
                      t.symbol === value ? 'text-silver' : 'text-textPrimary'
                    }`}
                  >
                    {t.symbol}
                  </span>
                  <span className="text-t11 text-textSecondary truncate" title={(() => {
                    const label = companyName(t.symbol);
                    return label.toUpperCase() === t.symbol ? undefined : label;
                  })()}>{(() => {
                    const label = companyName(t.symbol);
                    return label && label.toUpperCase() !== t.symbol ? label : '';
                  })()}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TickerSearch;
