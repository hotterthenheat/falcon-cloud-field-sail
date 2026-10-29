/*
==================================================
  SLAYER TERMINAL - THE OPTIONS CHAIN AS A GRID
  (components/weigher/ChainGrid.tsx)

  The Weigher's chain — its column catalog, the grid, the
  market's hairline between strikes, the weigh-up (Stats ·
  The Greeks) unfolding under a picked strike — lifted out
  of pages/weigher/WeigherDesk.tsx on 2026-09-22 so the
  Paper Live Chart could stand the SAME chain beside its
  chart (Noah: "use the Weigher's chain … like we have for
  the dropdown of the weigher options chain"). Nothing in
  it changed for the Weigher; the Live Chart asks for three
  things the Weigher does not: `drillExtra` (the order,
  inside the dropdown), `held` (a HELD mark on a strike the
  reader holds), and the catalog's "Decay a day" column.
==================================================
*/

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronRight, Plus } from 'lucide-react';
import { ShapeChip } from './BookBlock';
import type { BookAtStrike } from '../../data/bookAtStrike';
import { type ColDef, type ICellRendererParams, type RowClickedEvent, type RowDoubleClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME } from '../ui/houseGrid';
import type { MultiGroup } from '../ui/DropdownMulti';
import Term from '../ui/Term';
import type { DeskContract, DeskChain } from '../../data/weigherDesk';
import type { OptionRight } from '../../types/compass';

export const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const grouped = (v: number, digits: number) => v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
/** Whole counts with commas. A missing count stays blank — never a zero that was not sent. */
export const fmtCount = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString('en-US') : '—');
const money = (v: number) => (Number.isFinite(v) ? `$${grouped(v, 2)}` : '—');
const signedMoney = (v: number) => (Number.isFinite(v) ? `${v >= 0 ? '+' : '-'}$${grouped(Math.abs(v), 2)}` : '—');
const signedPct = (v: number, dp = 1) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${grouped(v, dp)}%` : '—');
const fixed = (v: number, d: number) => (Number.isFinite(v) ? grouped(v, d) : '—');
const pct0 = (v: number) => (Number.isFinite(v) ? `${grouped(v, 0)}%` : '—');
const strikeText = (v: number) => (Number.isFinite(v) ? grouped(v, v % 1 === 0 ? 0 : 2) : '—');

/* ---- the chain's column catalog -------------------------------------------
   Every face of the contract the reference offers that is a FACT (Noah,
   2026-08-26, the customize-columns screenshots). The four return-on-…
   entries stayed out on purpose: a projected yield on a position is strategy
   advice wearing a stat's clothes, and we are not a broker. Order here IS
   column order; the menu speaks the reference's wording, the header speaks
   compact, and every jargon head carries its Term. */
export interface ChainCol {
  key: string;
  /** The menu's wording - the reference's own names */
  label: string;
  /** The column header's compact wording */
  head: string;
  term?: string;
  render: (c: DeskContract) => { text: string; ink?: string; bold?: boolean };
}

export const CHAIN_COLUMNS: ChainCol[] = [
  { key: 'mark', label: 'Mark', head: 'Mark', term: 'Mark', render: c => ({ text: money(c.mark), bold: true }) },
  { key: 'bid', label: 'Bid', head: 'Bid', render: c => ({ text: money(c.bid) }) },
  { key: 'ask', label: 'Ask', head: 'Ask', render: c => ({ text: money(c.ask) }) },
  { key: 'bidSize', label: 'Bid size', head: 'Bid size', render: c => ({ text: fmtCount(c.bidSize) }) },
  { key: 'askSize', label: 'Ask size', head: 'Ask size', render: c => ({ text: fmtCount(c.askSize) }) },
  { key: 'last', label: 'Last', head: 'Last', render: c => ({ text: money(c.last) }) },
  {
    key: 'netChange',
    label: 'Net change',
    head: 'Net chg',
    render: c => ({
      text: signedMoney(c.netChange),
      ink: !Number.isFinite(c.netChange) ? undefined : c.netChange >= 0 ? 'text-bull' : 'text-bear',
    }),
  },
  {
    key: 'changePct',
    label: 'Change %',
    head: 'Chg %',
    render: c => ({ text: signedPct(c.netChangePct), ink: !Number.isFinite(c.netChangePct) ? undefined : c.netChangePct >= 0 ? 'text-bull' : 'text-bear' }),
  },
  { key: 'high', label: 'High', head: 'High', render: c => ({ text: money(c.high) }) },
  { key: 'low', label: 'Low', head: 'Low', render: c => ({ text: money(c.low) }) },
  { key: 'prevClose', label: 'Prev close', head: 'Prev close', render: c => ({ text: money(c.prevClose) }) },
  { key: 'delta', label: 'Delta', head: 'Delta', term: 'Delta', render: c => ({ text: fixed(c.delta, 2) }) },
  { key: 'gamma', label: 'Gamma', head: 'Gamma', term: 'Gamma', render: c => ({ text: fixed(c.gamma, 4) }) },
  { key: 'theta', label: 'Theta', head: 'Theta', term: 'Theta', render: c => ({ text: fixed(c.theta, 4) }) },
  { key: 'vega', label: 'Vega', head: 'Vega', term: 'Vega', render: c => ({ text: fixed(c.vega, 4) }) },
  { key: 'rho', label: 'Rho', head: 'Rho', term: 'Rho', render: c => ({ text: fixed(c.rho, 4) }) },
  /* what the contract loses a day in DOLLARS a contract — theta × 100, the figure a buyer feels (the Live Chart's chain,
     2026-09-22: "you would need the actual options chain to see the vol, decay etc") */
  { key: 'decay', label: 'Decay a calendar day', head: 'Decay/day', term: 'Theta', render: c => ({ text: Number.isFinite(c.theta) ? money(Math.abs(c.theta * 100)) : '—', ink: 'text-bear' }) },
  { key: 'iv', label: 'IV', head: 'IV', term: 'IV', render: c => ({ text: Number.isFinite(c.iv) ? `${grouped(c.iv, 1)}%` : '—' }) },
  { key: 'itm', label: 'Probability ITM (model)', head: 'ITM · model', term: 'ITM odds', render: c => ({ text: pct0(c.itmOdds) }) },
  { key: 'otm', label: 'Probability OTM (model)', head: 'OTM · model', term: 'OTM odds', render: c => ({ text: Number.isFinite(c.itmOdds) ? pct0(100 - c.itmOdds) : '—' }) },
  {
    key: 'touch',
    label: 'Probability of touching (model)',
    head: 'Touch · model',
    term: 'Touch odds',
    render: c => ({ text: pct0(c.touchOdds) }),
  },
  {
    key: 'copLong',
    label: 'Chance of profit, long (model)',
    head: 'Profit L · model',
    term: 'Profit odds',
    render: c => ({ text: pct0(c.profitOddsLong) }),
  },
  {
    key: 'copShort',
    label: 'Chance of profit, short (model)',
    head: 'Profit S · model',
    term: 'Profit odds',
    render: c => ({ text: pct0(c.profitOddsShort) }),
  },
  { key: 'breakeven', label: 'Breakeven', head: 'Breakeven', term: 'Breakeven', render: c => ({ text: money(c.breakeven) }) },
  { key: 'toBreakeven', label: 'To breakeven', head: 'To B/E', term: 'To breakeven', render: c => ({ text: signedPct(c.toBreakevenPct) }) },
  { key: 'intrinsic', label: 'Intrinsic value', head: 'Intrinsic', term: 'Intrinsic value', render: c => ({ text: money(c.intrinsic) }) },
  { key: 'extrinsic', label: 'Extrinsic value', head: 'Extrinsic', term: 'Extrinsic value', render: c => ({ text: money(c.extrinsic) }) },
  { key: 'vol', label: 'Volume', head: 'Vol', term: 'Volume', render: c => ({ text: Number.isFinite(c.volume) ? fmtCount(c.volume) : '—' }) },
  { key: 'oi', label: 'Open interest', head: 'OI', term: 'Open interest', render: c => ({ text: Number.isFinite(c.oi) ? fmtCount(c.oi) : '—' }) },
];

/** The chain as it has always opened. */
export const DEFAULT_COLS = ['mark', 'delta', 'iv', 'itm', 'vol', 'oi'];
/** The catalog as the Columns card's one group — the reference's own names */
export const COLUMN_GROUPS: MultiGroup[] = [{ title: 'Facts', options: CHAIN_COLUMNS.map(c => ({ value: c.key, label: c.label })) }];

/* ---- the chain as a grid ----------------------------------------------------
   THE HOUSE GRID (the walk, 2026-09-11): AG Grid on the house theme at 30px
   rows — only the rows in the window exist, so a ±400 chain scrolls and
   re-inks like a short one (the Trace walk's scroll fix, the one Noah asked
   for here: "the sidebar drag being laggy"). The market's hairline and
   Pulse's inline weigh-up ride as FULL-WIDTH rows; the picked strike is the
   grid's selection (index.css .slayer-chain re-inks it, no re-render); the
   chain still opens centred on the market and the back-to-price pill still
   floats up when the spot row leaves the window. The progressive first paint
   (forty rows, then sixty a frame) is gone with the table: the grid never
   renders a row nobody can see. */
const CHAIN_THEME = GRID_THEME.withParams({ rowHeight: 30, headerHeight: 28, fontSize: 11, cellHorizontalPadding: 8 });
const CHAIN_COL: ColDef<ChainGridRow> = { sortable: false, resizable: true, suppressMovable: true };
type ChainGridRow =
  | { kind: 'row'; key: string; c: DeskContract }
  | { kind: 'divider'; key: string; spot: number }
  | { kind: 'drill'; key: string; c: DeskContract; head?: (c: DeskContract) => ReactNode; extra?: (c: DeskContract) => ReactNode };
const CHAIN_ROW_H = 30;
const DIVIDER_H = 22;
const DRILL_H = 210;

/* The strike cell — the chevron turns on the picked row (CSS, off the selection); a strike the reader HOLDS says so (the
   Live Chart's chain — `held`).
   THE STRIKE CARRIES ITS BOOK (the desk's chain — `book`): the Map's shape chip after the figure, and the strike's net
   gamma as a short bar along the cell's foot on the house ramp — the weight of hedging there. A column of its own was
   built first and pushed the watch door off the chain's right edge at 1440 (2026-09-28); in the strike's cell the chain
   keeps every column it had. The whole read waits in the strike's weigh-up (BookBlock). */
const StrikeCell = ({ data, held, book }: ICellRendererParams<ChainGridRow> & { held?: ReadonlySet<number>; book?: (strike: number) => BookAtStrike | null }) => {
  if (data?.kind !== 'row') return null;
  const read = book?.(data.c.strike) ?? null;
  return (
    <span className="inline-flex items-center gap-1 font-mono text-t11 font-semibold tnum text-textPrimary" data-chain-strike data-book-cell={read ? read.shape ?? 'none' : undefined}>
      <ChevronRight aria-hidden className="w-3 h-3 shrink-0 text-textMuted" data-chain-chevron />
      {strikeText(data.c.strike)}
      {held?.has(data.c.strike) && (
        <span className="ml-1 inline-flex items-center h-[14px] px-1 rounded-sm bg-silver/[0.15] text-t8 font-bold uppercase tracking-wider text-silver leading-none" data-chain-held>
          Held
        </span>
      )}
      {read?.shape && (
        <span className="ml-0.5 inline-flex">
          <ShapeChip shape={read.shape} />
        </span>
      )}
      {read && (
        /* the cell is the containing block (the grid lays its cells out absolutely): the bar rides its foot */
        <span className="absolute left-2 right-2 bottom-[3px] h-[3px] rounded-full bg-ink/[0.06] overflow-hidden" aria-hidden data-book-bar>
          <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(3, read.share * 100)}%`, background: read.net < 0 ? 'rgb(var(--bull))' : 'rgb(var(--bear))' }} />
        </span>
      )}
    </span>
  );
};

/* A catalog column's cell: the fact in its ink */
const factCell =
  (col: ChainCol) =>
  ({ data }: ICellRendererParams<ChainGridRow>) => {
    if (data?.kind !== 'row') return null;
    const v = col.render(data.c);
    return <span className={`font-mono whitespace-nowrap tnum ${v.bold ? 'text-t11 font-bold' : 'text-t10'} ${v.ink ?? (v.bold ? 'text-textPrimary' : 'text-textSecondary')}`}>{v.text}</span>;
  };

/* The two full-width rows: the market's hairline, and (Pulse) the weigh-up
   unfolding under the picked strike — its height is its content's, measured
   once it paints and handed to the grid */
const FullRow = (p: ICellRendererParams<ChainGridRow>) => {
  const data = p.data;
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (data?.kind !== 'drill' || !ref.current) return;
    const el = ref.current;
    const set = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 0 && p.node.rowHeight !== h) {
        p.node.setRowHeight(h);
        p.api.onRowHeightChanged();
      }
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data, p.node, p.api]);
  if (!data) return null;
  if (data.kind === 'divider') {
    return (
      <div className="h-full px-2 flex items-center select-none" data-chain-divider>
        <span className="flex-1 h-px bg-textPrimary/25" />
        <span className="mx-2 font-mono text-t9 font-semibold tnum text-textPrimary bg-ink/[0.06] rounded px-1.5 py-0.5">{strikeText(data.spot)}</span>
        <span className="flex-1 h-px bg-textPrimary/25" />
      </div>
    );
  }
  return (
    <div ref={ref} className="bg-silver/[0.04] animate-soft-in" data-chain-drill>
      <div className="px-3 py-2.5 border-b border-ink/[0.05] flex flex-col gap-3">
        {/* THE CASE FIRST (the Weigher, 2026-10-07): the word, the reasons, the alternatives — then the figures */}
        {data.kind === 'drill' && data.head?.(data.c)}
        <WeighGrids c={data.c} />
        {data.kind === 'drill' && data.extra?.(data.c)}
      </div>
    </div>
  );
};

/* memo, deliberately: this is the desk's whale — 301 rows by up to 29
   columns. It re-renders when its OWN facts change (a chain sweep, a
   selection, a column pick) and sits out everything else. */
/* THE DOOR TO THE WATCHLIST ON EVERY STRIKE (Noah, 2026-09-14: "there should be some sort
   of add to watchlist on the chain like a plus button or something") — a + at the row's end,
   shown on the row's hover; once watched it stays, a check in the where-you-are ink */
const WatchCell = ({ strike, on, onWatch }: { strike: number; on: boolean; onWatch: (strike: number) => void }) => (
  <button
    type="button"
    onClick={e => {
      e.stopPropagation();
      onWatch(strike);
    }}
    title={on ? 'On your watchlist — open it' : "Add to your watchlist — marked at this tick's price"}
    aria-label={on ? 'On your watchlist' : 'Add to your watchlist'}
    className={`inline-flex items-center justify-center w-4 h-4 rounded transition-colors ${on ? 'text-silver hover:bg-silver/[0.10]' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.08]'}`}
    data-chain-watch={strike}
    data-on={on || undefined}
  >
    {on ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
  </button>
);

export const ChainCard = memo(function ChainCard({
  chain,
  right,
  sel,
  onSelect,
  cols,
  centerKey,
  inlineDrill,
  reveal,
  watched,
  onWatch,
  drillExtra,
  drillHead,
  held,
  book,
}: {
  chain: DeskChain;
  right: OptionRight;
  sel: number | null;
  onSelect: (strike: number, clicks?: number) => void;
  cols: ChainCol[];
  /** The strikes on the watchlist for this ladder, and the door that adds one (the desk; Pulse's tile has neither) */
  watched?: ReadonlySet<number>;
  onWatch?: (strike: number) => void;
  /** Changes when the ladder itself changes (name, expiry, depth) — the cue
      to re-centre the scroll on the market. A moving spot alone must NOT
      re-centre; it would fight the user's own scrolling every tick. */
  centerKey: string;
  /** Pulse's grammar (Noah, 2026-08-26: "it drops down just right under
      that strike and not all the way at the bottom") — the selected row
      unfolds its weigh-up inline, Robinhood-style. The desk page leaves
      this off; its weigh-up owns the bottom-right card. */
  inlineDrill?: boolean;
  /** A strike to bring into view — a contract carried in by a deep link
      (Noah, 2026-09-12: "instead of taking me to the spot it should take me
      to the dropdown view of that specific strike"). `n` bumps per ask so
      the same strike asked twice scrolls twice; the row lands at the top
      third, its weigh-up unfolding beneath it. */
  reveal?: { strike: number; n: number } | null;
  /** What the inline dropdown carries under the weigh-up — the Live Chart's order for the contract */
  drillExtra?: (c: DeskContract) => ReactNode;
  /** What it carries ABOVE the weigh-up — the Weigher's case for the strike (StrikeCase, 2026-10-07) */
  drillHead?: (c: DeskContract) => ReactNode;
  /** The strikes the reader holds on this side and expiry: marked on their rows */
  held?: ReadonlySet<number>;
  /** OUR TWO CENTS ON EVERY STRIKE (2026-09-28): the dealer book's read of it — the shape word and the net bar as a
      column, "The book" (data/bookAtStrike.ts); the desk hands it, Pulse's tile does not */
  book?: (strike: number) => BookAtStrike | null;
}) {
  const gridRef = useRef<AgGridReact<ChainGridRow>>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [away, setAway] = useState<'above' | 'below' | null>(null);
  const [ready, setReady] = useState(false);

  /* High strikes at the top, like a price axis; the market's hairline slots
     between the strikes that bracket it; the weigh-up under the picked one */
  const { rows, dividerIdx } = useMemo(() => {
    const contracts = chain.rows.map(r => (right === 'C' ? r.call : r.put));
    const ordered = [...contracts].reverse();
    const out: ChainGridRow[] = [];
    let divider = -1;
    ordered.forEach((c, i) => {
      out.push({ kind: 'row', key: `s${c.strike}`, c });
      if (inlineDrill && sel != null && Math.abs(c.strike - sel) < 1e-9) out.push({ kind: 'drill', key: `d${c.strike}`, c, head: drillHead, extra: drillExtra });
      const next = ordered[i + 1];
      if (c.strike > chain.spot && next && next.strike <= chain.spot) {
        divider = out.length;
        out.push({ kind: 'divider', key: 'divider', spot: chain.spot });
      }
    });
    return { rows: out, dividerIdx: divider };
  }, [chain, right, sel, inlineDrill, drillExtra, drillHead]);

  const columnDefs = useMemo<ColDef<ChainGridRow>[]>(
    () => [
      {
        colId: 'strike',
        headerName: 'Strike',
        headerTooltip: book ? 'The strike, with what the dealer book says about it — its shape (wall · cliff · shelf · void) and, as the bar under it, the weight of hedging there; open the strike for the whole read' : undefined,
        width: held || book ? 104 : 84,
        cellRenderer: StrikeCell,
        cellRendererParams: { held, book },
        resizable: false,
      },
      ...cols.map<ColDef<ChainGridRow>>(col => ({
        colId: col.key,
        headerName: col.head,
        headerTooltip: col.label,
        flex: 1,
        minWidth: 84,
        type: 'rightAligned',
        cellRenderer: factCell(col),
      })),
      /* the watchlist door, a narrow last column — the desk's chain only */
      ...(onWatch
        ? [
            {
              colId: 'watch',
              headerName: '',
              headerTooltip: 'Add a contract to your watchlist',
              /* Pinned so a full set of columns cannot scroll it under the bar. */
              pinned: 'right',
              lockPinned: true,
              width: 28,
              resizable: false,
              suppressNavigable: true,
              cellStyle: { padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
              cellRenderer: ({ data }: ICellRendererParams<ChainGridRow>) => (data?.kind === 'row' ? <WatchCell strike={data.c.strike} on={!!watched?.has(data.c.strike)} onWatch={onWatch} /> : null),
            } satisfies ColDef<ChainGridRow>,
          ]
        : []),
    ],
    [cols, watched, onWatch, held, book]
  );

  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || !ready) return;
    api.refreshCells({ force: true });
  }, [chain.quotedAt, chain.spot, chain.expiryIso, chain.ticker, chain.optRoot, chain.rows, right, ready]);

  /* The picked strike is the grid's selection — synced, never clicked into
     (a click is the desk's: one weighs, two chart) */
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || !ready) return;
    api.forEachNode(n => {
      const on = n.data?.kind === 'row' && sel != null && Math.abs(n.data.c.strike - sel) < 1e-9;
      if (n.isSelected() !== on) n.setSelected(on);
    });
  }, [sel, rows, ready]);

  const viewport = (): HTMLElement | null => {
    const all = wrapRef.current?.querySelectorAll<HTMLElement>('.ag-grid-viewport');
    if (!all?.length) return null;
    let best: HTMLElement | null = null;
    for (const el of Array.from(all)) {
      if (!best || el.clientHeight > best.clientHeight) best = el;
    }
    return best;
  };
  /* Pixel offset of the price row from the row heights we already know. AG Grid's
     ensureIndexVisible('middle') lands on the top when it is asked before the
     body has a height, and then the ladder stays there. */
  const dividerTop = useCallback(() => {
    let y = 0;
    for (let i = 0; i < dividerIdx && i < rows.length; i++) {
      const k = rows[i].kind;
      y += k === 'divider' ? DIVIDER_H : k === 'drill' ? DRILL_H : CHAIN_ROW_H;
    }
    return y;
  }, [dividerIdx, rows]);
  /* Once the spot row leaves the window, the pill floats up with the live
     price and an arrow pointing back the way it went (Noah, 2026-08-25) */
  const locate = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api || dividerIdx < 0) return setAway(null);
    const node = api.getDisplayedRowAtIndex(dividerIdx);
    if (!node || node.rowTop == null) return setAway(null);
    const range = api.getVerticalPixelRange();
    const mid = node.rowTop + (node.rowHeight ?? DIVIDER_H) / 2;
    setAway(mid < range.top + 34 ? 'above' : mid > range.bottom - 8 ? 'below' : null);
  }, [dividerIdx]);
  const centerOnSpot = useCallback(
    (smooth: boolean) => {
      if (dividerIdx < 0) return false;
      const vp = viewport();
      const dest = vp && vp.clientHeight >= 40 ? Math.max(0, dividerTop() - vp.clientHeight / 2 + DIVIDER_H / 2) : null;
      if (vp && dest != null) {
        if (smooth) vp.scrollTo({ top: dest, behavior: 'smooth' });
        else vp.scrollTop = dest;
        return dest === 0 || Math.abs(vp.scrollTop - dest) < 8;
      }
      gridRef.current?.api?.ensureIndexVisible(dividerIdx, 'middle');
      return false;
    },
    [dividerIdx, dividerTop]
  );
  /* A new ladder opens on the price, in the middle of the window. The first
     paint often has no height yet, so this retries until the price row is
     actually there. A moving spot does not re-centre. */
  const centred = useRef('');
  useEffect(() => {
    if (!ready || dividerIdx < 0 || centred.current === centerKey) return;
    let n = 0;
    let raf = 0;
    const tick = () => {
      n += 1;
      const landed = centerOnSpot(false);
      locate();
      if (landed || n > 24) centred.current = centerKey;
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, dividerIdx, centerKey, centerOnSpot, locate]);
  /* …unless a contract was carried in: its row is brought to the top third
     (the market's centring above runs first, this lands after it). Waits for
     the ladder that holds the strike — a name switch lands its rows a render
     later — and asks once per `n`. */
  const revealed = useRef(0);
  useEffect(() => {
    if (!reveal || !ready || revealed.current === reveal.n) return;
    const idx = rows.findIndex(r => r.kind === 'row' && Math.abs(r.c.strike - reveal.strike) < 1e-9);
    if (idx < 0) return;
    const raf = requestAnimationFrame(() => {
      const api = gridRef.current?.api;
      if (!api) return;
      const node = api.getDisplayedRowAtIndex(idx);
      const vp = viewport();
      if (!node || node.rowTop == null || !vp) {
        api.ensureIndexVisible(idx, 'top');
      } else {
        vp.scrollTo({ top: Math.max(0, node.rowTop - vp.clientHeight * 0.28), behavior: 'smooth' });
      }
      revealed.current = reveal.n;
      locate();
    });
    return () => cancelAnimationFrame(raf);
  }, [reveal, ready, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={wrapRef} className="slayer-board slayer-chain relative h-full" data-chain-grid={centerKey}>
      <AgGridProvider modules={GRID_MODULES}>
        <AgGridReact<ChainGridRow>
          ref={gridRef}
          theme={CHAIN_THEME}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={CHAIN_COL}
          getRowId={p => p.data.key}
          isFullWidthRow={p => p.rowNode.data?.kind !== 'row'}
          fullWidthCellRenderer={FullRow}
          getRowHeight={p => (p.data?.kind === 'divider' ? DIVIDER_H : p.data?.kind === 'drill' ? DRILL_H : CHAIN_ROW_H)}
          /* One click weighs, two chart: the grid hands the single click through
             as 1 and the double through its own event as 2 (a second click's
             detail is not relied on — the grid may fold it into the double) */
          onRowClicked={(e: RowClickedEvent<ChainGridRow>) => {
            if (e.data?.kind !== 'row') return;
            /* the watch door's click is its own — React's stopPropagation never reaches the grid's native listener */
            if ((e.event?.target as HTMLElement | null)?.closest?.('[data-chain-watch]')) return;
            if (((e.event as MouseEvent | null)?.detail ?? 1) > 1) return;
            onSelect(e.data.c.strike, 1);
          }}
          onRowDoubleClicked={(e: RowDoubleClickedEvent<ChainGridRow>) => {
            if (e.data?.kind !== 'row') return;
            if ((e.event?.target as HTMLElement | null)?.closest?.('[data-chain-watch]')) return;
            onSelect(e.data.c.strike, 2);
          }}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: false }}
          suppressCellFocus
          animateRows={false}
          /* The scrollbar's room is reserved from the first sizing pass, so the
             flex columns never lay out under it (the last column was clipped) */
          alwaysShowVerticalScroll
          onFirstDataRendered={() => setReady(true)}
          onBodyScroll={locate}
          onViewportChanged={locate}
          tooltipShowDelay={350}
        />
      </AgGridProvider>
      {away && (
        <button
          onClick={() => centerOnSpot(true)}
          title="Back to the market price"
          className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 rounded-full border border-ink/10 px-3 py-1 font-mono text-t10 font-semibold tnum text-textPrimary backdrop-blur-[3px] transition-colors hover:bg-ink/[0.08]"
          style={{ background: 'rgb(var(--panel) / 0.85)' }}
          data-chain-away={away}
        >
          {away === 'above' ? <ArrowUp className="w-3 h-3 text-textSecondary" aria-hidden /> : <ArrowDown className="w-3 h-3 text-textSecondary" aria-hidden />}{money(chain.spot)}
        </button>
      )}
    </div>
  );
});


/** One labeled figure in the drilldown - silver label, bright number. */
export const StatCell = ({ label, value, term, ink }: { label: string; value: string; term?: string; ink?: string }) => (
  <span className="flex flex-col gap-0.5 min-w-0">
    <span className="font-mono text-t9 uppercase tracking-widest text-silver whitespace-nowrap">
      {term ? <Term k={term as never}>{label}</Term> : label}
    </span>
    <span className={`font-mono text-t11 font-semibold tnum ${ink ?? 'text-textPrimary'}`}>{value}</span>
  </span>
);

/** The weigh-up's two sections — Stats and The Greeks — shared verbatim by
    the desk's Strike card and Pulse's inline drilldown, so the two surfaces
    can never drift apart. A fragment on purpose: hosts that SPREAD the
    sections (justify-evenly) need them as direct children. */
export const WeighGrids = ({ c }: { c: DeskContract }) => (
  <>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-t9 font-bold uppercase tracking-widest text-textSecondary">Stats</span>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-2.5">
            <StatCell label="Bid" value={money(c.bid)} />
            <StatCell label="Mark" term="Mark" value={money(c.mark)} />
            <StatCell label="High" value={money(c.high)} />
            <StatCell label="Last trade" value={money(c.last)} />
            <StatCell label="Volume" term="Volume" value={fmtCount(c.volume)} />
            <StatCell label="Ask" value={money(c.ask)} />
            <StatCell label="Prev close" value={money(c.prevClose)} />
            <StatCell label="Low" value={money(c.low)} />
            <StatCell label="IV" term="IV" value={Number.isFinite(c.iv) ? `${grouped(c.iv, 1)}%` : '—'} />
            <StatCell label="Open interest" term="Open interest" value={fmtCount(c.oi)} />
            <StatCell label="Breakeven" term="Breakeven" value={money(c.breakeven)} />
            <StatCell
              label="From spot"
              value={signedPct(c.fromSpotPct)}
              ink={!Number.isFinite(c.fromSpotPct) ? undefined : c.fromSpotPct >= 0 ? 'text-bull' : 'text-bear'}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-mono text-t9 font-bold uppercase tracking-widest text-textSecondary">The Greeks</span>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-x-4 gap-y-2.5">
            <StatCell label="Delta" term="Delta" value={fixed(c.delta, 4)} />
            <StatCell label="Gamma" term="Gamma" value={fixed(c.gamma, 4)} />
            <StatCell label="Theta / calendar day" term="Theta" value={fixed(c.theta, 4)} />
            <StatCell label="Vega" term="Vega" value={fixed(c.vega, 4)} />
            <StatCell label="Rho" term="Rho" value={fixed(c.rho, 4)} />
          </div>
        </div>
  </>
);

