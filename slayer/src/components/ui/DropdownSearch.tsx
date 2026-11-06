/* DropdownSelect for long lists: a search box and matches (arrows and Enter pick). A Popover with a Command (shadcn), because DropdownMenu's typeahead eats typed letters. */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../shadcn/popover';
import { Command, CommandInput, CommandItem, CommandList } from '../shadcn/command';
import { ChevronDown, X, type LucideIcon } from 'lucide-react';
import CompanyLogo from './CompanyLogo';
import { CARD } from './DropdownSelect';
import { askCompanyNames } from '../../data/tickers';

const SILVER = 'rgb(var(--silver))'; /* the silver token (deep steel on the light theme) */

export interface SearchOption<T extends string> {
  value: T;
  label: string;
  /** One line under the label — what picking this means */
  hint?: string;
  /** A name's logo beside it */
  logo?: string;
  /** More words the search should match (the company behind a ticker) */
  keywords?: string;
}

interface DropdownSearchProps<T extends string> {
  label: string;
  value: T;
  options: SearchOption<T>[];
  onChange: (v: T) => void;
  /** A heading inside the card; defaults to the label */
  title?: string;
  placeholder?: string;
  /** A glyph before the label, in the muted ink */
  icon?: LucideIcon;
  /** The glyph's own colour on hover and while open (the sidebar's rule) */
  ink?: string;
  align?: 'start' | 'end';
  testId?: string;
  /** Open on mount: a card that was just asked for goes straight to its search */
  defaultOpen?: boolean;
  /** When set, this decides a hit. The default searches the label, the hint, and the keywords. */
  match?: (option: SearchOption<T>, query: string) => boolean;
  /** The value meaning "everything": when not selected an X beside the chip resets to it, and it stays pinned above a
   long list. */
  clearTo?: T;
  /** Runs each time the card opens, so a caller can fetch what the search needs only once someone looks */
  onOpen?: () => void;
  /** The values that match a query, best first (a ticker list ranked by the symbol directory). Overrides `match`. */
  search?: (query: string) => readonly T[];
}

const DropdownSearch = <T extends string>({ label, value, options, onChange, title, placeholder = 'Search…', icon: Icon, ink, align = 'start', testId, defaultOpen = false, match, clearTo, onOpen, search }: DropdownSearchProps<T>) => {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const current = options.find(o => o.value === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    if (search) {
      const byValue = new Map(options.map(o => [o.value, o] as const));
      const out: SearchOption<T>[] = [];
      for (const v of search(query)) {
        const o = byValue.get(v);
        if (o) out.push(o);
      }
      return out;
    }
    if (match) return options.filter(o => match(o, query));
    return options.filter(o => o.label.toLowerCase().includes(q) || (o.keywords ?? '').toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q));
  }, [options, query, match, search]);

  /* A long book pins "all" above the rest. Every row is in the list (the arrows walk them all), but in a long list only
     the rows near the view draw their logo, so 456 logos do not load at once. */
  const pinned = clearTo != null ? (matches.find(o => o.value === clearTo) ?? null) : null;
  const rest = pinned ? matches.filter(o => o.value !== pinned.value) : matches;
  const long = rest.length > 48;
  const ROW = 42;
  const first = long ? Math.max(0, Math.floor(scrollTop / ROW) - 4) : 0;
  const last = long ? first + 16 : rest.length;

  useEffect(() => {
    if (open) onOpen?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const syms = rest.slice(first, last).map(o => o.logo).filter((s): s is string => !!s && /^[A-Z0-9.]{1,6}$/.test(s));
    if (syms.length) askCompanyNames(syms);
  }, [open, query, scrollTop, options]);

  useEffect(() => {
    setScrollTop(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };

  const row = (o: SearchOption<T>, tall: boolean, logo: boolean) => {
    const on = o.value === value;
    return (
      <CommandItem
        key={o.value}
        value={o.value}
        onSelect={() => pick(o.value)}
        data-search-option={o.value}
        style={tall ? { height: ROW } : undefined}
        className={`gap-2 rounded-md px-2 ${tall ? 'py-0' : 'py-1.5'} data-[selected=true]:bg-ink/[0.06]`}
      >
        {o.logo && logo ? <CompanyLogo ticker={o.logo} size={14} /> : <span className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
        <span className="flex flex-col gap-[1px] min-w-0">
          <span className={`font-mono text-t11 leading-snug ${on ? 'font-semibold' : ''}`} style={on ? { color: SILVER } : undefined}>
            {o.label}
          </span>
          {o.hint && <span className="font-mono text-t9 leading-snug text-textMuted truncate">{o.hint}</span>}
        </span>
      </CommandItem>
    );
  };

  /* shadcn Popover + Command (2026-11-01): the card's search box is a combobox naming the row the arrows are on, the
     rows are options; Escape or a press outside closes it and focus goes back to the trigger. The caller ranks the rows,
     so cmdk does not filter. */
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="inline-flex items-center gap-1">
        <PopoverTrigger asChild>
          <button
            type="button"
            data-dropdown={testId ?? label}
            data-dropdown-search
            aria-label={`${label}: ${current?.label ?? ''}`}
            className="group inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none"
            style={ink ? ({ '--ink': ink } as CSSProperties) : undefined}
          >
            {Icon && (
              <Icon
                className={`w-3 h-3 shrink-0 transition-colors duration-200 ${ink ? 'text-textMuted group-hover:text-ink group-data-[state=open]:text-ink' : 'text-textMuted'}`}
                aria-hidden="true"
                data-dropdown-icon
              />
            )}
            <span className="text-t9 uppercase tracking-widest text-textMuted">{label}</span>
            <span className="text-t11 font-semibold text-textPrimary">{current?.label ?? '—'}</span>
            <ChevronDown className="w-3 h-3 text-textMuted" />
          </button>
        </PopoverTrigger>
        {clearTo != null && value !== clearTo && (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            data-dropdown-clear={testId ?? label}
            onClick={() => onChange(clearTo)}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted text-textMuted hover:text-textPrimary"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </span>
      <PopoverContent
        align={align}
        className={`${CARD} w-[272px] p-0 overflow-hidden`}
        data-dropdown-card={testId ?? label}
        onOpenAutoFocus={e => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Command shouldFilter={false} label={title ?? label}>
          <div className="px-3.5 pt-2.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted" aria-hidden="true">{title ?? label}</div>
          <CommandInput
            ref={inputRef}
            value={query}
            onValueChange={setQuery}
            placeholder={placeholder}
            icon="sm"
            rowClassName="mx-1.5 gap-1.5 px-2 rounded-md border border-borderSubtle bg-panel"
            className="py-1.5 font-mono text-t11"
            data-dropdown-search-input
          />
          {/* one listbox; the pinned "all" stands above the scroller (as before the move), so the scroller keeps its full
              16rem for the rest */}
          <CommandList className="max-h-none overflow-visible">
            {pinned && <div className="px-1.5 pt-1 border-b border-borderSubtle">{row(pinned, false, true)}</div>}
            <div ref={listRef} className={`max-h-64 overflow-y-auto ${long ? '' : 'p-1.5'}`} onScroll={long ? e => setScrollTop(e.currentTarget.scrollTop) : undefined}>
              {matches.length === 0 ? (
                <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">Nothing matches</div>
              ) : (
                rest.map((o, i) => row(o, long, i >= first && i < last))
              )}
            </div>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

export default DropdownSearch;
