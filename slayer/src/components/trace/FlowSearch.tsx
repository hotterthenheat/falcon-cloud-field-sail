/* The ticker/contract search every flow page carries: suggestions grouped tickers then contracts, ranked by money,
   keyboard-walkable. Picking a ticker scopes the menu to its contracts; picking a contract or "everything" closes. */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Layers, Search, X } from 'lucide-react';
import { usd as fmtUsd } from '../../data/traceLive';
import CompanyLogo from '../ui/CompanyLogo';
import { CARD } from '../ui/DropdownSelect';

/** The four facts a row must carry — FlowPrint and BookContract both do. */
interface FlowSearchRow {
  ticker: string;
  strike: number;
  right: 'C' | 'P';
  premium: number;
}

export const normSymbol = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/* A contract typed the way people write it: "NVDA 220C 11/20", "NVDA 220 call 2026-11-20" or an OCC symbol; anything
   else keeps the plain letters-and-digits match. */
interface ContractQuery {
  ticker: string;
  strike: number | null;
  right: 'C' | 'P' | null;
  /** MM/DD of the expiry, and its year when typed */
  month: number | null;
  day: number | null;
  year: number | null;
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const CONTRACT_FORMATS = 'NVDA 220C 11/20, NVDA 220 C Nov 20 or NVDA261120C00220000';
/** A search that matched nothing, in one voice on every Trace page: what was asked and the forms the field takes */
export const searchMiss = (q: string, noun: string) => `No ${noun} matches “${q.trim()}” — the search takes a name, or a contract written like ${CONTRACT_FORMATS}`;
export function parseContractQuery(raw: string): ContractQuery | null {
  const q = raw.trim().toUpperCase();
  if (!q) return null;
  /* the OCC symbol: root, YYMMDD, C/P, strike × 1000 in eight digits */
  const occ = q.replace(/\s+/g, '').match(/^([A-Z][A-Z.]{0,5}?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (occ) return { ticker: occ[1], strike: Number(occ[6]) / 1000, right: occ[5] as 'C' | 'P', month: Number(occ[3]), day: Number(occ[4]), year: 2000 + Number(occ[2]) };
  const m = q.match(/^\$?([A-Z][A-Z.]{0,5})(?:\s*(\d+(?:\.\d+)?))?\s*(CALLS?|PUTS?|C|P)?\b\s*(.*)$/);
  if (!m || (!m[2] && !m[4])) return null;
  const rest = (m[4] ?? '').replace(/[,]/g, ' ').trim();
  let month: number | null = null;
  let day: number | null = null;
  let year: number | null = null;
  let right: 'C' | 'P' | null = m[3] ? (m[3].startsWith('C') ? 'C' : 'P') : null;
  let tail = rest;
  /* a right after the date ("NVDA 220 11/20 C") */
  const rt = tail.match(/\s*\b(CALLS?|PUTS?|C|P)$/);
  if (!right && rt) {
    right = rt[1].startsWith('C') ? 'C' : 'P';
    tail = tail.slice(0, rt.index).trim();
  }
  if (tail) {
    const iso = tail.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const slash = tail.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
    const word = tail.match(/^([A-Z]{3})[A-Z]*\.?\s*(\d{1,2})(?:,?\s*'?(\d{2,4}))?$/);
    if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    else if (slash) [month, day, year] = [Number(slash[1]), Number(slash[2]), slash[3] ? Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : null];
    else if (word && MONTHS.includes(word[1])) [month, day, year] = [MONTHS.indexOf(word[1]) + 1, Number(word[2]), word[3] ? Number(word[3].length === 2 ? `20${word[3]}` : word[3]) : null];
    else return null;
  }
  return { ticker: m[1], strike: m[2] ? Number(m[2]) : null, right, month, day, year };
}
/** The name a search asks for ("NVDA", "nvda 220c 11/20", an OCC symbol), so a page reads that name's own rows;
    "505C" names none */
export function searchedName(raw: string): string | null {
  const q = raw.trim().toUpperCase();
  if (!q) return null;
  const c = parseContractQuery(q);
  if (c) return c.ticker;
  return /^\$?[A-Z][A-Z0-9.]{0,5}$/.test(q) ? q.replace(/^\$/, '') : null;
}
/** …once the typing settles, so "N", "NV", "NVD" are not each asked of the feed */
export function useSearchedName(raw: string, settleMs = 350): string | null {
  const want = searchedName(raw);
  const [name, setName] = useState(want);
  useEffect(() => {
    if (want === name) return;
    const t = window.setTimeout(() => setName(want), want ? settleMs : 0);
    return () => window.clearTimeout(t);
  }, [want, name, settleMs]);
  return name;
}
/** A typed contract as the feed's own symbol, when every part of it is typed (the year inferred: the first such date on
    or after `fromIso`) */
export function contractOcc(raw: string, fromIso: string): { occ: string; expiry: string } | null {
  const c = parseContractQuery(raw);
  if (!c || c.strike == null || !c.right || c.month == null || c.day == null) return null;
  const from = fromIso.slice(0, 10);
  let year = c.year ?? Number(from.slice(0, 4));
  const iso = (y: number) => `${y}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
  if (c.year == null && iso(year) < from) year += 1;
  const expiry = iso(year);
  return { occ: `${c.ticker}${String(year).slice(2)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${c.right}${String(Math.round(c.strike * 1000)).padStart(8, '0')}`, expiry };
}
/** Does a row match what was typed: a parsed contract field by field, else the letters-and-digits match */
export function matchesContract(raw: string, r: { ticker: string; strike: number; right: 'C' | 'P'; expiry?: string }): boolean {
  const nq = normSymbol(raw);
  if (nq === '') return true;
  const c = parseContractQuery(raw);
  if (!c) return normSymbol(`${r.ticker}${r.strike}${r.right}`).includes(nq);
  if (r.ticker.toUpperCase() !== c.ticker) return false;
  /* a strike still being typed ("NVDA 2") matches as a prefix; with a side or a date it is the whole strike */
  if (c.strike != null && (c.right || c.month != null ? Math.abs(r.strike - c.strike) > 1e-6 : !String(r.strike).startsWith(String(c.strike)))) return false;
  if (c.right && r.right !== c.right) return false;
  if (c.month != null && r.expiry) {
    const e = r.expiry.match(/^(\d{2})\/(\d{2})\/(\d{4})/) ?? r.expiry.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!e) return false;
    const [mm, dd, yy] = r.expiry.includes('/') ? [Number(e[1]), Number(e[2]), Number(e[3])] : [Number(e[2]), Number(e[3]), Number(e[1])];
    if (mm !== c.month || dd !== c.day || (c.year != null && yy !== c.year)) return false;
  }
  return true;
}

type Suggestion =
  | { key: string; kind: 'ticker'; ticker: string; primary: string; count: string; money: string }
  | { key: string; kind: 'contract'; query: string; ticker: string; strike: string; primary: string; right: 'C' | 'P'; count: string; money: string }
  | { key: string; kind: 'all'; ticker: string; primary: string; count: string; money: string }
  | { key: string; kind: 'back'; primary: string }
  | { key: string; kind: 'door'; primary: string };

/* One wash under the pointer whatever the side: the call/put word carries the side, never a direction ink */
const WASH = { plain: 'bg-ink/[0.06]', C: 'bg-ink/[0.06]', P: 'bg-ink/[0.06]' } as const;
const HEADING = 'px-2 pt-1.5 pb-1 font-mono text-t11 uppercase tracking-widest text-textMuted';

/** A door at the foot of the menu: the search offers only what its page carries, so its last row sends the name to
    the page that does. */
interface SearchDoor {
  /** The row's words, given what is typed (upper-cased, may be empty) */
  label: (query: string) => string;
  onOpen: (query: string) => void;
}

const FlowSearch = ({
  value,
  onChange,
  rows,
  countNoun = 'prints',
  tickersOnly = false,
  compact = false,
  door,
  span = false,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: FlowSearchRow[];
  /** What a ticker's tally counts — "prints" on the tape, "contracts" on a book page. */
  countNoun?: string;
  /** Names only: on a board of names a pick applies and closes, with no contract step */
  tickersOnly?: boolean;
  /** A pane-head fit: a short field the height of a chip, for pane heads already carrying a cut and figures. */
  compact?: boolean;
  /** The menu's last row, a way out to the page that carries the rest. */
  door?: SearchDoor;
  /** On a phone the field takes the controls' whole line (TraceBox's `data-span`) */
  span?: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  /** A picked ticker — the menu is showing that name's contracts. */
  const [scope, setScope] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nq = normSymbol(value);
  const active = value.length > 0;

  const close = () => {
    setOpen(false);
    setScope(null);
  };

  const tallies = useMemo(() => {
    const tick = new Map<string, { count: number; prem: number }>();
    const con = new Map<string, { ticker: string; strike: number; count: number; prem: number; right: 'C' | 'P' }>();
    for (const r of rows) {
      const t = tick.get(r.ticker) ?? { count: 0, prem: 0 };
      t.count += 1;
      t.prem += r.premium;
      tick.set(r.ticker, t);
      const ck = `${r.ticker} ${r.strike}${r.right}`;
      const c = con.get(ck) ?? { ticker: r.ticker, strike: r.strike, count: 0, prem: 0, right: r.right };
      c.count += 1;
      c.prem += r.premium;
      con.set(ck, c);
    }
    return { tick, con };
  }, [rows]);

  const contractRow = ([ck, v]: [string, { ticker: string; strike: number; count: number; prem: number; right: 'C' | 'P' }]): Suggestion => ({
    key: `c-${ck}`,
    kind: 'contract',
    query: ck,
    ticker: v.ticker,
    strike: String(v.strike),
    primary: ck,
    right: v.right,
    // A lone appearance says just its money — "1×" was noise.
    count: v.count > 1 ? `${v.count}×` : '',
    money: fmtUsd(v.prem),
  });

  /* Scoped: the picked ticker's own contracts, "everything" on top, a way back. */
  const scoped = useMemo<Suggestion[]>(() => {
    if (!scope) return [];
    const t = tallies.tick.get(scope);
    const contracts = [...tallies.con.entries()]
      .filter(([, v]) => v.ticker === scope)
      .sort((a, b) => b[1].prem - a[1].prem)
      .slice(0, 8)
      .map(contractRow);
    return [
      { key: 'back', kind: 'back', primary: 'All names' },
      {
        key: `all-${scope}`,
        kind: 'all',
        ticker: scope,
        primary: `Everything on ${scope}`,
        count: t ? `${t.count} ${countNoun}` : '',
        money: t ? fmtUsd(t.prem) : '',
      },
      ...contracts,
    ];
  }, [scope, tallies, countNoun]);

  /* Unscoped: the query against every ticker and contract. */
  const { tickers, contracts } = useMemo(() => {
    const tickers: Suggestion[] = [...tallies.tick.entries()]
      .filter(([tk]) => nq === '' || normSymbol(tk).includes(nq) || parseContractQuery(value)?.ticker === tk)
      .sort((a, b) => b[1].prem - a[1].prem)
      .slice(0, tickersOnly ? 8 : nq === '' ? 5 : 4)
      .map(([tk, v]) => ({ key: `t-${tk}`, kind: 'ticker', ticker: tk, primary: tk, count: `${v.count} ${countNoun}`, money: fmtUsd(v.prem) }));
    const contracts: Suggestion[] = tickersOnly
      ? []
      : [...tallies.con.entries()]
          .filter(([ck, v]) => nq === '' || normSymbol(ck).includes(nq) || (parseContractQuery(value) != null && matchesContract(value, v)))
          .sort((a, b) => b[1].prem - a[1].prem)
          .slice(0, nq === '' ? 4 : 6)
          .map(contractRow);
    return { tickers, contracts };
  }, [tallies, nq, value, countNoun, tickersOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const doorRow: Suggestion | null = door ? { key: 'door', kind: 'door', primary: door.label(value.trim()) } : null;
  /* A strike typed is a contract asked for: the contracts lead and Enter keeps the query itself, never "everything
     on" the name */
  const parsedQ = tickersOnly ? null : parseContractQuery(value);
  const contractAsked = !!parsedQ && parsedQ.strike != null;
  const flat: Suggestion[] = scope ? scoped : contractAsked ? [...contracts, ...tickers, ...(doorRow ? [doorRow] : [])] : [...tickers, ...contracts, ...(doorRow ? [doorRow] : [])];
  const clampedHi = Math.min(hi, Math.max(0, flat.length - 1));

  const pick = (s: Suggestion) => {
    switch (s.kind) {
      case 'door':
        door?.onOpen(value.trim());
        close();
        return;
      case 'ticker':
        if (tickersOnly) {
          onChange(s.ticker);
          close();
          return;
        }
        // Apply at once — the whole name is now on screen — and stay open
        // showing its contracts, so narrowing further is one more click.
        onChange(s.ticker);
        setScope(s.ticker);
        setHi(1);
        return;
      case 'all':
        onChange(s.ticker);
        close();
        return;
      case 'back':
        onChange('');
        setScope(null);
        setHi(0);
        return;
      case 'contract':
        onChange(s.query);
        close();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      else setHi(h => Math.min(h + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && contractAsked && !scope && clampedHi === 0) {
        e.preventDefault();
        close();
      } else if (open && flat[clampedHi]) {
        e.preventDefault();
        pick(flat[clampedHi]);
      } else if (open) {
        /* nothing to pick: Enter keeps what is typed and closes the card */
        e.preventDefault();
        close();
      }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      // Tab walks on to the next control — the card does not stay open behind the reader
      close();
    }
  };

  /* the filter in force: the row that is the field's own words is where you are */
  const inForce = (s: Suggestion): boolean => {
    if (!active || scope) return s.kind === 'all' && normSymbol(value) === normSymbol(s.ticker);
    if (s.kind === 'ticker') return normSymbol(s.ticker) === nq;
    if (s.kind === 'contract') return normSymbol(s.query) === nq;
    return false;
  };
  /* the name the field holds, when it holds one — its logo stands where the glass was */
  const heldName = useMemo(() => {
    const first = value.trim().split(' ')[0];
    return first && tallies.tick.has(first) ? first : null;
  }, [value, tallies]);

  const renderRow = (s: Suggestion, idx: number) => {
    const lit = idx === clampedHi;
    const on = inForce(s);
    const quiet = s.kind === 'back' || s.kind === 'door';
    return (
      <button
        key={s.key}
        type="button"
        role="option"
        aria-selected={lit}
        onMouseEnter={() => setHi(idx)}
        onMouseDown={e => {
          e.preventDefault(); // keep focus; select before the field blurs
          pick(s);
        }}
        className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${lit ? WASH[s.kind === 'contract' ? s.right : 'plain'] : ''}`}
        data-flow-search-row={s.kind}
        data-lit={lit || undefined}
        /* the figures say what they count */
        title={quiet ? undefined : `${s.kind === 'contract' ? `${s.ticker} ${s.strike}${s.right}` : s.kind === 'all' ? `Everything on ${s.ticker}` : s.ticker} — ${s.count ? `${s.count.replace('×', ' times')} ` : ''}on this page${s.money ? `, ${s.money} in premium among them` : ''}`}
      >
        <span className="w-4 h-4 shrink-0 flex items-center justify-center" aria-hidden="true">
          {s.kind === 'back' ? (
            <ArrowLeft className="w-3 h-3 text-textMuted" />
          ) : s.kind === 'door' ? (
            <ArrowUpRight className="w-3 h-3 text-textMuted" />
          ) : s.kind === 'all' ? (
            <Layers className="w-3 h-3 text-textMuted" />
          ) : (
            <CompanyLogo ticker={s.ticker} size={16} />
          )}
        </span>
        {s.kind === 'contract' ? (
          /* written the way the tape under it writes a contract: the name, the strike, the side in its ink */
          <span className="min-w-0 truncate font-mono text-t11 leading-snug">
            <span className={`font-semibold ${on ? 'text-silver' : 'text-textPrimary'}`}>
              {s.ticker} {s.strike}
            </span>{' '}
            <span className={s.right === 'C' ? 'text-bull' : 'text-bear'}>{s.right === 'C' ? 'call' : 'put'}</span>
          </span>
        ) : (
          <span className={`min-w-0 truncate font-mono text-t11 leading-snug ${quiet ? 'text-textSecondary' : `font-semibold ${on ? 'text-silver' : 'text-textPrimary'}`}`}>{s.primary}</span>
        )}
        {!quiet && (
          <span className="ml-auto shrink-0 flex items-center gap-2 pl-2 font-mono tnum">
            {s.count && <span className="text-t11 text-textMuted whitespace-nowrap">{s.count}</span>}
            {/* one column of money down the card — the figures line up whatever stands before them */}
            <span className={`w-[50px] text-right text-t11 ${lit ? 'text-textPrimary' : 'text-textSecondary'}`}>{s.money}</span>
            <span className="w-3 h-3 flex items-center justify-center">
              {on ? <Check className="w-3 h-3 text-silver" /> : s.kind === 'ticker' && !tickersOnly ? <ChevronRight className="w-3 h-3 text-textMuted" /> : null}
            </span>
          </span>
        )}
      </button>
    );
  };

  const nothing = !scope && tickers.length + contracts.length === 0;
  const noneWords = value.trim() ? `Nothing on this page matches “${value.trim()}”` : 'Nothing on this page yet';
  return (
    <Popover.Root
      open={open}
      onOpenChange={o => {
        if (!o) close();
      }}
      modal={false}
    >
      <Popover.Anchor asChild>
        <div
          ref={rootRef}
          /* One of the cards on its line; holding a filter it wears the silver of "where you are" */
          className={`inline-flex items-center gap-1.5 rounded-md border transition-colors font-mono ${compact ? 'h-[22px] pl-2 pr-1.5' : 'h-7 pl-2.5 pr-2'} ${
            active ? 'border-silver bg-silver/[0.07]' : `border-borderSubtle bg-chip hover:border-borderMuted focus-within:border-silver/50 ${open ? 'border-silver/50' : ''}`
          }`}
          data-flow-search={active ? 'armed' : open ? 'open' : 'rest'}
          data-span={span || undefined}
        >
          {/* not in a pane's head (compact): the pane prints the held name's mark itself, right beside this field */}
          {heldName && !compact ? <CompanyLogo ticker={heldName} size={16} /> : <Search className={`w-3 h-3 shrink-0 ${active ? 'text-silver' : 'text-textMuted'}`} aria-hidden="true" />}
          <input
            value={value}
            onChange={e => {
              /* the date's "/" and "-" stay, with room for a whole OCC symbol (21 characters) */
              onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9 ./-]/g, '').slice(0, 28));
              setScope(null); // typing is searching again
              setOpen(true);
              setHi(0);
            }}
            onFocus={() => setOpen(true)}
            // A click on a field that already has focus fires no focus event —
            // after a pick-then-clear the reader would be tapping a dead box.
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={tickersOnly ? 'Ticker' : 'Ticker or contract'}
            aria-label={tickersOnly ? 'Search by ticker' : 'Search by ticker or contract'}
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            className={`${compact ? 'w-[68px]' : 'w-[132px]'} bg-transparent text-t11 font-semibold uppercase tracking-wider text-textPrimary placeholder:text-textMuted placeholder:font-normal placeholder:normal-case placeholder:tracking-normal focus:outline-none`}
          />
          {active && (
            <button
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                onChange('');
                setScope(null);
              }}
              aria-label="Clear search"
              className="text-silver/70 hover:text-silver transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          /* the field keeps the caret: the card never takes focus, and a press on the field is not "outside" */
          onOpenAutoFocus={e => e.preventDefault()}
          onCloseAutoFocus={e => e.preventDefault()}
          onInteractOutside={e => {
            if (rootRef.current?.contains(e.target as Node)) e.preventDefault();
          }}
          className={`${CARD} w-[288px] p-1.5 overflow-y-auto overscroll-contain outline-none`}
          style={{ maxHeight: 'min(var(--radix-popover-content-available-height), 440px)' }}
          role="listbox"
          data-flow-search-card={scope ?? 'all'}
        >
          {nothing && !doorRow ? (
            <div className="px-2.5 py-4 text-center font-mono text-t11 text-textMuted" data-flow-search-none>
              {noneWords}
            </div>
          ) : scope ? (
            <>
              {renderRow(flat[0], 0)}
              <div className={`${HEADING} mt-1 border-t border-borderSubtle/70 pt-2`}>On {scope}</div>
              {flat.slice(1).map((s, i) => renderRow(s, i + 1))}
            </>
          ) : (
            <>
              {contractAsked && contracts.length > 0 && (
                <>
                  <div className={HEADING}>Contracts · Enter keeps “{value.trim()}”</div>
                  {contracts.map((s, i) => renderRow(s, i))}
                </>
              )}
              {tickers.length > 0 && (
                <>
                  <div className={`${HEADING} ${contractAsked && contracts.length > 0 ? 'mt-1 border-t border-borderSubtle/70 pt-2' : ''}`}>{`Names · ${countNoun} on this page · their premium`}</div>
                  {tickers.map((s, i) => renderRow(s, (contractAsked ? contracts.length : 0) + i))}
                </>
              )}
              {!contractAsked && contracts.length > 0 && (
                <>
                  <div className={`${HEADING} ${tickers.length > 0 ? 'mt-1 border-t border-borderSubtle/70 pt-2' : ''}`}>Contracts</div>
                  {contracts.map((s, i) => renderRow(s, tickers.length + i))}
                </>
              )}
              {nothing && doorRow && (
                <div className="px-2 pt-2 pb-1.5 font-mono text-t11 text-textMuted" data-flow-search-none>
                  {noneWords}
                </div>
              )}
              {doorRow && <div className={tickers.length + contracts.length > 0 || nothing ? 'mt-1 border-t border-borderSubtle/70 pt-1' : ''}>{renderRow(doorRow, tickers.length + contracts.length)}</div>}
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default FlowSearch;
