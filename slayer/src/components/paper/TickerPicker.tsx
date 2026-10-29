/* What is on the paper chart: index options and stocks, with one search over all of them; the arrow keys walk the
   matches and Enter picks. A plan that trades only some names offers only those. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search } from 'lucide-react';
import CompanyLogo from '../ui/CompanyLogo';
import { CARD } from '../ui/DropdownSelect';
import type { PaperIndex } from '../../data/paper/products';
import { ensureListed, isOptionRoot, optionSymbols, useListedRev } from '../../data/listedNames';
import { askCompanyNames, companyName, companyNamesRev, subscribeCompanyNames } from '../../data/tickers';

const SILVER = 'rgb(var(--silver))';
interface Row {
  value: string;
  /** What the row is called — the ticker */
  code: string;
  name: string;
  /** What else a search finds it by */
  keywords: string;
  price: number | null;
  decimals: number;
}

interface Props {
  /** The name on the chart */
  value: string;
  onChange: (name: string) => void;
  /** The only names the account's plan may trade — null: any listed name */
  allowed: string[] | null;
  /** The indexes whose options the feed carries, and where one stands now */
  indexes: PaperIndex[];
  indexPrice: (symbol: string) => number;
}

const TickerPicker = ({ value, onChange, allowed, indexes, indexPrice }: Props) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [stockWindow, setStockWindow] = useState(80);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listedRev = useListedRev();
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  useEffect(() => { ensureListed(); }, []);

  const indexRows: Row[] = indexes.map(x => ({ value: x.symbol, code: x.symbol, name: `${x.name} options`, keywords: `${x.symbol} ${x.name} index options ${x.fund}`, price: open ? indexPrice(x.symbol) : null, decimals: 2 }));
  const stocks: Row[] = useMemo(() => {
    /* the list's company names are asked for only once it is open: a closed picker asks for nothing */
    if (!open) return [];
    const roots = optionSymbols();
    const skip = new Set(indexes.map(x => x.symbol));
    const label = (ticker: string) => {
      const named = companyName(ticker);
      return named;
    };
    const toRow = (ticker: string): Row => ({ value: ticker, code: ticker, name: label(ticker), keywords: `${ticker} ${label(ticker)}`, price: null, decimals: 2 });
    const q = query.trim().toUpperCase();
    if (!roots.length) return ['SPY', 'QQQ', 'IWM'].map(toRow);
    if (!q) {
      const pinned = ['SPY', 'QQQ', 'IWM', 'SPX', 'NDX', 'RUT', 'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD'];
      const out: string[] = [];
      const seen = new Set<string>();
      for (const symbol of pinned) {
        if (!isOptionRoot(symbol) || skip.has(symbol) || seen.has(symbol)) continue;
        seen.add(symbol);
        out.push(symbol);
      }
      for (const symbol of roots) {
        if (out.length >= stockWindow) break;
        if (seen.has(symbol) || skip.has(symbol)) continue;
        seen.add(symbol);
        out.push(symbol);
      }
      return out.map(toRow);
    }
    const prefix: string[] = [];
    const contains: string[] = [];
    for (const symbol of roots) {
      if (skip.has(symbol)) continue;
      const name = label(symbol);
      if (symbol.startsWith(q) || name.toUpperCase().startsWith(q)) prefix.push(symbol);
      else if (symbol.includes(q) || name.toUpperCase().includes(q)) contains.push(symbol);
      if (prefix.length >= 80) break;
    }
    return [...prefix, ...contains].slice(0, 80).map(toRow);
  }, [open, query, listedRev, nameRev, stockWindow, indexes]);
  const q = query.trim().toLowerCase();
  const may = (r: Row) => !allowed || allowed.includes(r.value.toUpperCase());
  const hit = (r: Row) => may(r) && (!q || r.code.toLowerCase().includes(q) || r.value.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.keywords.toLowerCase().includes(q));
  /* a plan's own list: its names, whether or not the listing has loaded them yet */
  const planRows: Row[] = allowed ? allowed.filter(t => !indexes.some(x => x.symbol === t)).map(t => ({ value: t, code: t, name: companyName(t), keywords: t, price: null, decimals: 2 })) : [];
  const groups = [
    { key: 'indexes', title: 'Index options · the chain', rows: indexRows.filter(hit) },
    { key: 'stocks', title: allowed ? 'The names this plan trades' : 'Stocks & funds · their options', rows: allowed ? planRows.filter(hit) : stocks.filter(hit) },
  ];
  /** Every match in the order the card shows them — what the arrow keys walk */
  const flat = groups.flatMap(g => g.rows);
  const current = [...indexRows, ...stocks, ...planRows].find(r => r.value === value);

  useEffect(() => {
    if (stocks.length) askCompanyNames(stocks.map(s => s.value));
  }, [stocks]);
  useEffect(() => {
    setHighlight(0);
    setStockWindow(80);
    listRef.current?.scrollTo({ top: 0 });
  }, [query]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  /* the highlighted row stays in sight while the keys walk */
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-ticker-row-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = flat[highlight];
      if (r) pick(r.value);
    }
  };

  let index = -1;
  return (
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`What is on the chart: ${current?.code ?? value} — ${current?.name ?? companyName(value)}`}
          title={current ? `${current.code} · ${current.name}` : `${value} · ${companyName(value)}`}
          className="group inline-flex items-center gap-1.5 h-7 pl-1.5 pr-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none"
          data-paper-ticker={value}
        >
          <CompanyLogo ticker={value} size={14} />
          <span className="text-t12 font-bold text-textPrimary">{current?.code ?? value}</span>
          <ChevronDown className="w-3 h-3 text-textMuted transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={`${CARD} w-[380px] p-0 overflow-hidden`}
          onOpenAutoFocus={e => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          data-paper-ticker-card
        >
          <div className="p-2 border-b border-borderSubtle/70" onKeyDown={onKeyDown}>
            <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-borderSubtle bg-panel focus-within:border-silver/50 transition-colors">
              <Search className="w-3.5 h-3.5 text-textMuted shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search a ticker or a company…"
                aria-label="Search what to put on the chart"
                className="w-full bg-transparent font-mono text-t12 text-textPrimary placeholder:text-textMuted focus:outline-none"
                data-paper-ticker-search
              />
            </div>
          </div>
          <div
            ref={listRef}
            className="max-h-[420px] overflow-y-auto overscroll-contain py-1.5"
            role="listbox"
            aria-label="What to put on the chart"
            onScroll={() => {
              const el = listRef.current;
              if (!el || query.trim()) return;
              if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48) setStockWindow(n => n + 160);
            }}
          >
            {flat.length === 0 ? (
              <div className="px-4 py-6 text-center font-mono text-t10 text-textMuted" data-paper-ticker-none>
                {allowed ? `This plan trades ${allowed.join(', ')} only` : 'Nothing matches — try a ticker or a company'}
              </div>
            ) : (
              groups.map(g =>
                g.rows.length === 0 ? null : (
                  <div key={g.key} className="pb-1" data-paper-ticker-group={g.key}>
                    <div className="px-4 pt-2 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">{g.title}</div>
                    {g.rows.map(r => {
                        index += 1;
                        const i = index;
                        const on = r.value === value;
                        return (
                          <button
                            key={r.value}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => pick(r.value)}
                            onMouseEnter={() => setHighlight(i)}
                            className={`w-[calc(100%-12px)] mx-1.5 grid grid-cols-[18px_62px_minmax(0,1fr)_auto] items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${i === highlight ? 'bg-ink/[0.06]' : ''}`}
                            data-ticker-row={r.value}
                            data-ticker-row-index={i}
                          >
                            <CompanyLogo ticker={r.value} size={14} />
                            <span className={`font-mono text-t12 font-bold ${on ? '' : 'text-textPrimary'}`} style={on ? { color: SILVER } : undefined}>
                              {r.code}
                            </span>
                            <span className="text-t11 text-textSecondary truncate">{r.name}</span>
                            <span className="font-mono text-t11 tnum text-textPrimary">{r.price != null ? r.price.toLocaleString('en-US', { minimumFractionDigits: r.decimals, maximumFractionDigits: r.decimals }) : ''}</span>
                          </button>
                        );
                      })}
                  </div>
                )
              )
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default TickerPicker;
