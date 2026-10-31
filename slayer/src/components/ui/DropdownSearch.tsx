/* DropdownSelect for long lists: a search box and matches (arrows and Enter pick). Radix Popover, because DropdownMenu's typeahead eats typed letters. */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search, X, type LucideIcon } from 'lucide-react';
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
  const [highlight, setHighlight] = useState(0);
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

  /* A long book pins "all" above the scroller. The rest window so 456 logos do not mount at once. */
  const pinned = clearTo != null ? (matches.find(o => o.value === clearTo) ?? null) : null;
  const rest = pinned ? matches.filter(o => o.value !== pinned.value) : matches;
  const rows = pinned ? [pinned, ...rest] : rest;
  const windowed = rest.length > 48;
  const ROW = 42;
  const start = windowed ? Math.max(0, Math.floor(scrollTop / ROW) - 4) : 0;
  const shown = windowed ? rest.slice(start, Math.min(rest.length, start + 16)) : rest;

  useEffect(() => {
    if (open) onOpen?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const syms = shown.map(o => o.logo).filter((s): s is string => !!s && /^[A-Z0-9.]{1,6}$/.test(s));
    if (syms.length) askCompanyNames(syms);
  }, [open, query, scrollTop, options]);

  useEffect(() => {
    setHighlight(0);
    setScrollTop(0);
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !windowed) return;
    const idx = pinned ? highlight - 1 : highlight;
    if (idx < 0) return;
    const top = idx * ROW;
    const view = el.clientHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW > el.scrollTop + view) el.scrollTop = top + ROW - view;
  }, [highlight, windowed, pinned?.value]);

  const pick = (v: T) => {
    onChange(v);
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = rows[highlight];
      if (hit) pick(hit.value);
    }
  };

  const row = (o: SearchOption<T>, at: number, tall: boolean) => {
    const on = o.value === value;
    return (
      <button
        key={o.value}
        type="button"
        role="option"
        aria-selected={on}
        onClick={() => pick(o.value)}
        onMouseEnter={() => setHighlight(at)}
        data-search-option={o.value}
        style={tall ? { height: ROW } : undefined}
        className={`w-full flex items-center gap-2 rounded-md px-2 text-left transition-colors ${tall ? '' : 'py-1.5'} ${at === highlight ? 'bg-ink/[0.06]' : ''}`}
      >
        {o.logo ? <CompanyLogo ticker={o.logo} size={14} /> : <span className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
        <span className="flex flex-col gap-[1px] min-w-0">
          <span className={`font-mono text-t11 leading-snug ${on ? 'font-semibold' : ''}`} style={on ? { color: SILVER } : undefined}>
            {o.label}
          </span>
          {o.hint && <span className="font-mono text-t9 leading-snug text-textMuted truncate">{o.hint}</span>}
        </span>
      </button>
    );
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <span className="inline-flex items-center gap-1">
        <Popover.Trigger asChild>
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
        </Popover.Trigger>
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
      <Popover.Portal>
        <Popover.Content align={align} sideOffset={6} className={`${CARD} w-[272px] p-0 overflow-hidden`} data-dropdown-card={testId ?? label} onOpenAutoFocus={e => { e.preventDefault(); inputRef.current?.focus(); }}>
          <div className="px-3.5 pt-2.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{title ?? label}</div>
          <div className="mx-1.5 flex items-center gap-1.5 px-2 rounded-md border border-borderSubtle bg-panel" onKeyDown={onKeyDown}>
            <Search className="w-3 h-3 text-textMuted shrink-0" aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={placeholder}
              className="w-full bg-transparent py-1.5 font-mono text-t11 text-textPrimary placeholder:text-textMuted focus:outline-none"
              data-dropdown-search-input
            />
          </div>
          {pinned && <div className="px-1.5 pt-1 border-b border-borderSubtle">{row(pinned, 0, false)}</div>}
          <div
            ref={listRef}
            className={`max-h-64 overflow-y-auto ${windowed ? '' : 'p-1.5'}`}
            role="listbox"
            onScroll={windowed ? e => setScrollTop(e.currentTarget.scrollTop) : undefined}
          >
            {rows.length === 0 ? (
              <div className="px-2.5 py-4 text-center font-mono text-t10 text-textMuted">Nothing matches</div>
            ) : windowed ? (
              <div style={{ height: rest.length * ROW, position: 'relative' }}>
                <div style={{ position: 'absolute', top: start * ROW, left: 0, right: 0 }}>
                  {shown.map((o, i) => row(o, start + i + (pinned ? 1 : 0), true))}
                </div>
              </div>
            ) : (
              rest.map((o, i) => row(o, i + (pinned ? 1 : 0), false))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default DropdownSearch;
