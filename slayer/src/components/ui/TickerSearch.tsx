import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronDown } from 'lucide-react';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames, type TickerListing } from '../../data/tickers';
import { ensureListed, roomOf, searchRoom, useListedRev } from '../../data/listedNames';
import CompanyLogo from './CompanyLogo';
import SymbolRowTag, { noOptionsLine } from './SymbolRowTag';
import { Popover, PopoverContent, PopoverTrigger } from '../shadcn/popover';
import { Command, CommandInput, CommandItem, CommandList } from '../shadcn/command';

type TickerModule = typeof import('../../data/tickers');

interface TickerSearchProps {
  value: string;
  onChange: (symbol: string) => void;
}

/** Compact searchable ticker menu — the symbol directory by symbol or company name, each row the symbol and its name.
    shadcn Popover + Command (2026-11-01): the card takes focus into its search box, a combobox naming the row the arrows
    are on; Escape or a press outside closes it and focus goes back to the trigger. */
const TickerSearch = ({ value, onChange }: TickerSearchProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [mod, setMod] = useState<TickerModule | null>(null);
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  const room = roomOf();
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
      if (!mod) import('../../data/tickers').then(setMod);
      ensureListed();
    }
  }, [open, mod]);

  const pick = (symbol: string) => {
    onChange(symbol);
    setOpen(false);
  };

  return (
    <div className="relative">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-ticker-search
          title={(() => {
            const n = companyName(value);
            return n && n.toUpperCase() !== value ? `${value} · ${n} — switch ticker` : 'Switch ticker';
          })()}
          className="flex items-center gap-2 border border-borderSubtle hover:border-borderMuted data-[state=open]:border-borderMuted bg-panel rounded-md pl-2.5 pr-2 py-1.5 font-mono text-xs transition-colors min-w-[104px]"
        >
          <CompanyLogo ticker={value} size={14} />
          <span className="font-semibold text-textPrimary">{value}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-textMuted ml-auto transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-80 p-0 overflow-hidden border-borderMuted bg-panel shadow-2xl shadow-black"
        onOpenAutoFocus={e => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        data-ticker-search-card
      >
        <Command shouldFilter={false} label="Switch ticker">
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            className="py-2.5"
            placeholder={room === 'equity' ? 'Ticker or company…' : room === 'option' ? 'Ticker or company, options only…' : room === 'compass' ? 'One of the 456…' : 'Ticker or company…'}
          />
          <CommandList className="max-h-72 py-1">
            {!mod ? (
              <div className="px-3 py-6 text-center font-mono text-t11 text-textMuted">Loading tickers…</div>
            ) : results.length === 0 ? (
              <div className="px-3 py-6 text-center font-mono text-t11 text-textMuted">{(room === 'option' && noOptionsLine(query)) || 'No symbol or company matches'}</div>
            ) : (
              results.map(t => {
                const label = companyName(t.symbol);
                const named = label && label.toUpperCase() !== t.symbol ? label : '';
                return (
                  <CommandItem key={t.symbol} value={t.symbol} onSelect={() => pick(t.symbol)} className="gap-2 px-3 py-1.5">
                    <CompanyLogo ticker={t.symbol} size={16} />
                    <span className={`font-mono text-xs font-semibold min-w-[3.5rem] shrink-0 ${t.symbol === value ? 'text-silver' : 'text-textPrimary'}`}>{t.symbol}</span>
                    <span className="text-t11 text-textSecondary truncate min-w-0 flex-1" title={named || undefined}>
                      {named}
                    </span>
                    <SymbolRowTag symbol={t.symbol} room={room} />
                  </CommandItem>
                );
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    </div>
  );
};

export default TickerSearch;
