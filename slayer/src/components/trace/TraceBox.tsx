/* The one box every Trace page stands in (title, facts, one line of cards, a plain lead, the body) and the grid it
   holds: AG Grid fed by the pages' own Column<T> definitions. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { type BodyScrollEvent, type ColDef, type ICellRendererParams, type PaginationChangedEvent, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME } from '../ui/houseGrid';
import { PageBar } from '../ui/PageBar';
import { useIsPhone } from '../ui/useMediaQuery';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import type { Column } from '../ui/DataTable';

/** The tape's rows: 39px on a 32px head (the house grid's feed pages run 44 on 30) */
const TRACE_GRID_THEME = GRID_THEME.withParams({ rowHeight: 39, headerHeight: 32, fontSize: 12 });
/** A phone's row: two lines, the contract over its figures (see PhoneRow) */
const TRACE_PHONE_THEME = GRID_THEME.withParams({ rowHeight: 58, headerHeight: 0, fontSize: 12 });

/** The cards line: a wrapping row at a desk, a grid of two equal cells on a phone (Dossier wears it too) */
export const CONTROLS_LINE = 'flex items-center gap-2 flex-wrap max-sm:grid max-sm:grid-cols-2 max-sm:[&>*]:min-w-0 max-sm:[&>*]:w-full max-sm:[&>[data-dropdown]]:justify-between max-sm:[&>[data-span]]:col-span-2 max-sm:[&>[data-span]]:order-first max-sm:[&>[data-cut-doors]]:col-span-2 max-sm:[&>[data-cut-doors]>*]:flex-1 max-sm:[&>[data-cut-doors]>*]:justify-center max-sm:[&>.ml-auto]:col-span-1 max-sm:[&>.ml-auto>*]:w-full max-sm:[&>.ml-auto>*>button]:w-full max-sm:[&>.ml-auto>*>button]:justify-between max-sm:[&>[data-scope]]:col-span-2 max-sm:[&>[data-scope]]:h-auto max-sm:[&>[data-scope]]:min-h-6 max-sm:[&>[data-scope]_[data-scope-pick]]:flex-wrap max-sm:[&>[data-scope]_[data-scope-pick]]:py-1 max-sm:[&>[data-scope]_[data-scope-pick]]:gap-y-1 max-sm:[&>[data-live-hold]]:order-last max-sm:[&>[data-live-hold]]:col-span-2 max-sm:[&>[data-live-hold]>button]:flex-1 max-sm:[&>[data-live-hold]>button]:w-full max-sm:[&>[data-live-hold]>button]:justify-center max-sm:[&>.ml-2]:col-span-2 max-sm:[&>.ml-2]:order-last';

/* ---- the head's facts ------------------------------------------------------------ */

export const Fact = ({ label, children, testId, title, wrap = false }: { label: string; children: ReactNode; testId?: string; title?: string; wrap?: boolean }) => (
  /* `wrap`: a fact that is a sentence takes the line's width */
  <div className={wrap ? 'min-w-0 basis-full' : 'min-w-0'} title={title}>
    <dt className="text-t11 text-textMuted whitespace-nowrap max-sm:whitespace-normal">{label}</dt>
    <dd className={`mt-0.5 font-mono text-t12 tnum text-textPrimary ${wrap ? 'whitespace-normal break-words' : 'whitespace-nowrap max-sm:whitespace-normal max-sm:break-words'}`} data-trace-fact={testId}>
      {children}
    </dd>
  </div>
);

/* 'plain' for a champion with no direction (the busiest name): orange is the sweep's ink.
   Magenta across Trace marks one figure that earned it (a column's top value), never a label: the standout
   champion ('supreme' — the most premium, the largest cross) wears the neutral label, its value carries the weight. */
type Ink = 'supreme' | 'bull' | 'bear' | 'warn' | 'plain';
const INK: Record<Ink, string> = { supreme: 'text-textSecondary', bull: 'text-bull', bear: 'text-bear', warn: 'text-warn', plain: 'text-textSecondary' };

/** A champion: the label in its ink, the row's words as a door onto the row */
export const Champion = ({ label, ink, onOpen, children, testId, title = "Open the contract's card" }: { label: string; ink: Ink; onOpen: () => void; children: ReactNode; testId?: string; title?: string }) => (
  <div className="min-w-0">
    <dt className={`text-t11 whitespace-nowrap max-sm:whitespace-normal ${INK[ink]}`}>{label}</dt>
    <dd className="mt-0.5 whitespace-nowrap max-sm:whitespace-normal" data-trace-champion={testId}>
      {/* the padding is the hit area (24px at a desk, 44px on a phone); the negative margin keeps the line where it was */}
      <button type="button" onClick={onOpen} title={title} className="inline-block py-[3px] -my-[3px] max-sm:py-[13px] max-sm:-my-[13px] font-mono text-t12 tnum font-semibold text-textPrimary hover:text-silver transition-colors text-left max-sm:break-words">
        {children}
      </button>
    </dd>
  </div>
);

/* ---- the box ---------------------------------------------------------------------- */

interface TraceBoxProps {
  title: string;
  sub: ReactNode;
  /** The dl of facts and champions */
  facts: ReactNode;
  /** The one line of cards */
  controls: ReactNode;
  /** With `lead`, what stands above it (the saved cuts); without, the page's line */
  sentence: ReactNode;
  /** One plain line of what happened; the full read (`detail`) waits behind "more" */
  lead?: ReactNode;
  detail?: ReactNode;
  guide?: { title: string; door: string; body: ReactNode; testId: string; open: boolean; onOpen: (v: boolean) => void };
  children: ReactNode;
  testId: string;
  className?: string;
  /** Attributes for the probes */
  data?: Record<string, string | number | undefined>;
  /** On a phone: the cards fold behind one button, the sub hides and the facts wrap two to a line, so every figure
      shows and the first row still stands above the fold */
  foldOnPhone?: boolean;
}

const TraceBox = ({ title, sub, facts, controls, sentence, lead, detail, guide, children, testId, className = '', data, foldOnPhone = false }: TraceBoxProps) => {
  const attrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  const phone = useIsPhone();
  const [unfolded, setUnfolded] = useState(false);
  const [more, setMore] = useState(false);
  const folded = foldOnPhone && phone && !unfolded;
  const tight = foldOnPhone && phone;
  return (
    /* overflow-clip, not hidden: hidden makes the box a scroll container and a sticky rail would stick to it */
    <div className={`relative border border-borderSubtle rounded-xs overflow-clip bg-panel flex flex-col ${className}`} {...attrs} data-trace-box={testId}>
      {guide && (
        <GuideFocus open={guide.open} onClose={() => guide.onOpen(false)} title={guide.title} testId={guide.testId} viewport>
          {guide.body}
        </GuideFocus>
      )}
      <div className={`px-5 flex items-start flex-wrap ${tight ? 'pt-3 pb-2 gap-2' : 'pt-4 pb-3 gap-6'}`}>
        {/* the title keeps a floor so the facts wrap under it rather than squeeze it */}
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary whitespace-nowrap">{title}</h3>
            {guide && <GuideDoor open={guide.open} onClick={() => guide.onOpen(!guide.open)} title={guide.door} testId={guide.testId} />}
          </div>
          {!tight && <p className="mt-0.5 text-t11 text-textMuted break-words sm:whitespace-nowrap sm:truncate">{sub}</p>}
        </div>
        {/* tight: two to a line, every figure whole — nothing runs off the right edge */}
        <dl className={tight ? 'w-full grid grid-cols-2 gap-x-4 gap-y-3' : 'flex flex-wrap gap-x-6 gap-y-2'} data-trace-facts>
          {facts}
        </dl>
      </div>
      {controls != null && controls !== false && foldOnPhone && phone && (
        <div className="px-5 pb-2">
          <button
            type="button"
            onClick={() => setUnfolded(v => !v)}
            aria-expanded={!folded}
            className="w-full h-8 rounded-md border border-borderSubtle bg-chip font-mono text-t11 uppercase tracking-widest text-textSecondary hover:text-textPrimary"
            data-trace-fold
          >
            {folded ? 'Filters & cards ▾' : 'Hide filters ▴'}
          </button>
        </div>
      )}
      {controls != null && controls !== false && !folded && (
        <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-trace-controls>
          {controls}
        </div>
      )}
      {/* a div, not a p: the saved cuts' chips stand inside the sentence */}
      {lead != null ? (
        <div className={`px-5 text-t12 leading-relaxed text-textSecondary ${tight ? 'pb-2' : 'pb-3'}`} data-trace-sentence>
          {sentence}
          <p className="text-t13 leading-snug text-textPrimary" data-trace-lead>
            {lead}
            {detail != null && detail !== false && (
              <>
                {' '}
                <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} className="inline-block px-1 -mx-1 py-[5px] -my-[5px] max-sm:py-[15px] max-sm:-my-[15px] font-mono text-t11 text-textSecondary underline decoration-dotted underline-offset-2 hover:text-textPrimary" data-trace-more>
                  {more ? 'less' : 'more'}
                </button>
              </>
            )}
          </p>
          {more && detail != null && detail !== false && (
            <div className="mt-1.5" data-trace-detail>
              {detail}
            </div>
          )}
        </div>
      ) : (
        sentence != null &&
        sentence !== false && (
          <div className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-trace-sentence>
            {sentence}
          </div>
        )
      )}
      {children}
    </div>
  );
};

/** A phone's row: who and what on top, the figures that matter under it, so nothing needs a sideways swipe */
export const PhoneRow = ({ lead, title, aside, figures }: { lead?: ReactNode; title: ReactNode; aside?: ReactNode; figures: ReactNode[] }) => (
  <span className="flex flex-col gap-1 py-1.5 w-full leading-none">
    <span className="flex items-center gap-2 min-w-0">
      {lead}
      {/* the title gives way to the time at its right — it clips, never runs under it */}
      <span className="min-w-0 flex-1 overflow-hidden flex items-center gap-1.5 font-mono text-t12 text-textPrimary whitespace-nowrap [&>*:first-child]:shrink-0">{title}</span>
      {aside && <span className="ml-auto shrink-0 font-mono text-t11 tnum text-textSecondary">{aside}</span>}
    </span>
    <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap font-mono text-t11 tnum text-textSecondary pl-5">
      {figures.map((f, i) => (
        <span key={i} className="whitespace-nowrap">
          {f}
        </span>
      ))}
    </span>
  </span>
);

/* ---- the grid in its window ------------------------------------------------------ */

/** A words column's floor: it gives way to the figures first, wrapping to two lines with its full words in a title */
const PROSE_FLOOR = 140;

/** A page's Column<T> definitions as AG Grid columns — the cells, inks and doors untouched. `fit` is the width a
    column's widest figure and its header were measured to need (TraceGrid's fit pass): the column's floor, so no
    figure is ever cut, and a column with room to spare can give it up before the box runs out. */
function columnsToColDefs<T>(columns: Column<T>[], hidden: Set<string>, widths: Record<string, number> = {}, tooltips: Record<string, string> = {}, flexes: Record<string, number> = {}, lock = false, fit: Record<string, number> = {}, prose: Set<string> = new Set()): ColDef<T>[] {
  return columns.map(c => {
    const set = widths[c.key] ?? (c.width ? parseInt(c.width, 10) : undefined);
    const need = prose.has(c.key) ? undefined : fit[c.key];
    const fixed = set != null && need ? Math.max(set, need) : set;
    const def: ColDef<T> = {
      colId: c.key,
      headerName: typeof c.header === 'string' ? c.header : c.key.charAt(0).toUpperCase() + c.key.slice(1),
      headerTooltip: tooltips[c.key],
      hide: hidden.has(c.key),
      sortable: !!c.sortValue,
      valueGetter: c.sortValue ? p => (p.data ? c.sortValue!(p.data) : null) : undefined,
      cellRenderer: (p: ICellRendererParams<T>) => (p.data ? c.render(p.data) : null),
      type: c.align === 'right' ? 'rightAligned' : undefined,
      resizable: true,
      suppressMovable: true,
    };
    /* a set width is a floor and a share of the room, so fixed widths never run past the box; a words column's share
       is its width times its flex, and its floor gives way first */
    if (fixed) {
      def.width = fixed;
      def.minWidth = prose.has(c.key) ? Math.min(fixed, PROSE_FLOOR) : need ?? fixed;
      def.flex = fixed * (flexes[c.key] ?? 1);
      if (lock) {
        def.resizable = false;
        def.minWidth = fixed;
      }
    } else {
      def.flex = flexes[c.key] ?? 1;
      /* the widest standard cell (the Lean bar, 64px) plus the grid's 24px padding, or the cell paints a clipped ".." */
      def.minWidth = need ?? 92;
    }
    return def;
  });
}

/* A grid that grows with the page draws every row it holds, so at rest it holds the first 80 and a foot opens the rest
   (never for fewer than 20 hidden). The page's figures still read every row. */
export const ROWS_AT_REST = 80;
const CAP_SLACK = 20;
interface RestCap<T> {
  shown: T[];
  capped: boolean;
  /** Is there a foot at all */
  door: boolean;
  total: number;
  toggle: () => void;
}
export function useRestCap<T>(rows: T[]): RestCap<T> {
  const [all, setAll] = useState(false);
  const door = rows.length > ROWS_AT_REST + CAP_SLACK;
  const capped = door && !all;
  const shown = useMemo(() => (capped ? rows.slice(0, ROWS_AT_REST) : rows), [rows, capped]);
  return { shown, capped, door, total: rows.length, toggle: () => setAll(v => !v) };
}
export const RestFoot = <T,>({ cap, noun = 'contracts', testId }: { cap: RestCap<T>; noun?: string; testId: string }) =>
  cap.door ? (
    <div className="px-5 py-2.5 border-t border-borderSubtle flex items-center gap-2 text-t11 text-textSecondary" data-rest-foot={testId} data-capped={cap.capped || undefined}>
      <span>{cap.capped ? `The first ${ROWS_AT_REST} of ${cap.total.toLocaleString('en-US')} ${noun}` : `All ${cap.total.toLocaleString('en-US')} ${noun}`}</span>
      <span className="text-textSecondary" aria-hidden>
        ·
      </span>
      <button type="button" onClick={cap.toggle} className="font-semibold text-textPrimary hover:text-silver transition-colors" data-rest-door>
        {cap.capped ? 'Show all' : `Show the first ${ROWS_AT_REST}`}
      </button>
    </div>
  ) : null;

/** A page of the tape. Longer than this, the foot carries page numbers — a fiftieth page is a click, not a scroll. */
const TRACE_PAGE = 40;
const CUT_JUMP = 8;
/** The crossfade: how far the rows step back, how long that takes, how long they take to come up */
const CUT_DIM = 0.3;
const CUT_OUT_MS = 120;
const CUT_IN_MS = 420;

interface TraceGridProps<T> {
  rows: T[];
  columns: Column<T>[];
  hidden?: Set<string>;
  widths?: Record<string, number>;
  /** A wide text column's share of the room (the default is 1) */
  flexes?: Record<string, number>;
  /** Widths are walls, not shares — the columns do not grow, shrink, or slide */
  lockColumns?: boolean;
  /** Words columns (a reason, a strategy, a read): they give way to the figures first, wrapping to two lines with their
      full words in a title, and the fit pass never widens them */
  prose?: string[];
  tooltips?: Record<string, string>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** A window's height — a screen less the chrome above it (a host that keeps a window) */
  height?: string;
  /** No window: the grid grows with its rows and the page scrolls */
  autoHeight?: boolean;
  /** The first sort: a column key and its direction */
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** Extra classes for a row — the tape's arrival fade, the Tracker's dimmed rows */
  rowClass?: (row: T) => string | undefined;
  /** Rows slide to their new place on a re-sort (off for the tape: a print a second would keep every row moving) */
  animate?: boolean;
  emptyText?: string;
  /** Columns that stand still at the left while the rest scroll — the row's who and what */
  pinLeft?: string[];
  /** …and at the right: the page's one figure that must always show (the premium) */
  pinRight?: string[];
  /** The row on a phone, two lines (PhoneRow) — given, a phone shows it in place of the columns */
  phoneRow?: (row: T) => ReactNode;
  /** No pages: the rows scroll in a screen-tall window and near the bottom ask for the next page (`onNear`) while
      `state` is 'more'; the foot says where the reading stands */
  endless?: EndlessFeed;
  /** The reader has scrolled into the rows (past the first two) — new rows then wait in a pill instead of jumping */
  onDeep?: (deep: boolean) => void;
  /** Changing it glides the window back to the top (the pill's "N new ↑") */
  topSignal?: number;
  /** The rows on screen, in the grid's own order, as the reader scrolls (Multi-Leg reads their legs) */
  onVisible?: (rows: T[]) => void;
  testId: string;
}

/** The state of an endless grid's older pages */
interface EndlessFeed {
  onNear: () => void;
  state: 'more' | 'loading' | 'end' | 'cap' | 'idle';
  /** What the rows loaded are, and why it stopped — the foot's words */
  note?: ReactNode;
  /** How many rows the list holds (all of them, before the page's cut) — an empty cut pages on only once some are in */
  loaded?: number;
  /** The button's word — "Load older ↓" for a list walked back in time; a list walked down by size says "Load more ↓" */
  moreLabel?: string;
  /** Anything else the foot carries (the tape's jump to a time) */
  extra?: ReactNode;
}

export const TraceGrid = <T,>({ rows, columns, hidden, widths, flexes, lockColumns = false, prose, tooltips, rowKey, onRowClick, selectedKey, height, autoHeight = false, initialSort, rowClass, animate = true, emptyText = 'Nothing on this cut', pinLeft, pinRight, phoneRow, endless, onDeep, topSignal, onVisible, testId }: TraceGridProps<T>) => {
  const gridRef = useRef<AgGridReact<T>>(null);
  const phone = useIsPhone() && !!phoneRow;
  const hiddenSet = useMemo(() => hidden ?? new Set<string>(), [hidden]);
  const endlessOn = !!endless;
  const proseKey = (prose ?? []).join(',');
  const proseSet = useMemo(() => new Set(proseKey ? proseKey.split(',') : []), [proseKey]);
  /* The fit pass: each column's widest figure and its header, measured, become its floor — never a "+83…", never a
     "Swe…". A floor only rises (a live tick never makes the columns breathe); it passes the page's set width only when
     a figure would otherwise be cut. Words columns are left to wrap. */
  const [fit, setFit] = useState<Record<string, number>>({});
  const fitTimer = useRef(0);
  const setWidthOf = (key: string): number | undefined => {
    const c = columns.find(x => x.key === key);
    return widths?.[key] ?? (c?.width ? parseInt(c.width, 10) : undefined);
  };
  const measureFit = () => {
    window.clearTimeout(fitTimer.current);
    fitTimer.current = window.setTimeout(() => {
      const wrap = wrapRef.current;
      if (!wrap || phone || lockColumns) return;
      const need: Record<string, number> = {};
      /* the content's own width, to the subpixel: scrollWidth rounds, and a 0.1px overflow still paints an ellipsis */
      const range = document.createRange();
      const contentW = (el: HTMLElement) => {
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width;
      };
      const want = (id: string | null, px: number, cut: boolean) => {
        if (!id || id === 'phone' || proseSet.has(id)) return;
        const set = setWidthOf(id);
        /* an uncut column keeps its set width as the most it asks for: a bar drawn to the cell's width is not a need */
        const w = Math.ceil(cut || set == null ? px : Math.min(px, set));
        need[id] = Math.max(need[id] ?? 0, w);
      };
      wrap.querySelectorAll<HTMLElement>('.ag-cell[col-id]').forEach(cell => {
        const cs = getComputedStyle(cell);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const room = cell.clientWidth - pad;
        const w = contentW(cell);
        want(cell.getAttribute('col-id'), w + pad + (cell.offsetWidth - cell.clientWidth) + 2, w > room + 0.01);
      });
      wrap.querySelectorAll<HTMLElement>('.ag-header-cell[col-id]').forEach(head => {
        const text = head.querySelector<HTMLElement>('.ag-header-cell-text');
        const label = head.querySelector<HTMLElement>('.ag-header-cell-label');
        if (!text || !label) return;
        const shown = text.getBoundingClientRect().width;
        const w = contentW(text);
        /* the cell around its label (padding, the resize grip), the words, and room for the sort arrow */
        want(head.getAttribute('col-id'), head.offsetWidth - label.getBoundingClientRect().width + w + 18, w > shown + 0.01);
      });
      setFit(prev => {
        let next: Record<string, number> | null = null;
        for (const [k, v] of Object.entries(need)) if (v > (prev[k] ?? 0)) (next ??= { ...prev })[k] = v;
        return next ?? prev;
      });
    }, 120);
  };
  useEffect(() => () => window.clearTimeout(fitTimer.current), []);
  const columnDefs = useMemo(() => {
    if (phone && phoneRow) {
      /* one column, the row in two lines */
      return [{ colId: 'phone', headerName: '', flex: 1, sortable: false, resizable: false, suppressMovable: true, cellRenderer: (p: ICellRendererParams<T>) => (p.data ? phoneRow(p.data) : null) } as ColDef<T>];
    }
    const defs = columnsToColDefs(columns, hiddenSet, widths, tooltips, flexes, lockColumns, fit, proseSet);
    for (const d of defs) {
      /* a pinned column is a wall, not a share: no flex, so a fitted width is the width it draws at */
      if (pinLeft?.includes(d.colId ?? '')) {
        d.pinned = 'left';
        d.flex = undefined;
        d.minWidth = d.width ?? d.minWidth;
      } else if (pinRight?.includes(d.colId ?? '')) {
        d.flex = undefined;
        d.minWidth = d.width ?? d.minWidth;
        d.pinned = 'right';
        /* room for the endless window's scrollbar beside the right-pinned figure */
        if (endlessOn && d.width) {
          d.width += 14;
          d.minWidth = d.width;
        }
      }
    }
    /* the first sort only: a new set of defs (a fit, a column shown) keeps the reader's own sort */
    if (initialSort) {
      const d = defs.find(x => x.colId === initialSort.key);
      if (d) d.initialSort = initialSort.dir;
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, hiddenSet, widths, tooltips, flexes, lockColumns, phone, phoneRow, pinLeft, pinRight, endlessOn, fit, proseSet]);
  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);
  /* A cut (the search cleared, a card turned) is a crossfade: the rows dim, the new list lands while they stand still,
     then they come up. A re-rank still glides; a few rows coming or going pass straight through. */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const calm = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const landed = useRef(rows);
  const latest = useRef(rows);
  latest.current = rows;
  const landedAt = useRef(0);
  const [landN, setLandN] = useState(0);
  /* an older page joining under the same head is not a cut */
  const sameHead = !!endless && rows.length > landed.current.length && landed.current.length > 0 && rowKey(rows[0]) === rowKey(landed.current[0]);
  const cutting = !calm && !sameHead && Math.abs(rows.length - landed.current.length) > Math.max(CUT_JUMP, landed.current.length * 0.15);
  /* what the grid holds: the rows it had, while they step back; else the page's rows as they come */
  const gridRows = cutting ? landed.current : rows;
  useEffect(() => {
    if (!cutting) landed.current = rows;
  });
  const rowsBody = () => wrapRef.current?.querySelector<HTMLElement>('.ag-grid-scrolling-rows') ?? null;
  /* a cut always lands: the hold re-arms on every landing (`landN`), so rows that moved again during it still land */
  useEffect(() => {
    if (!cutting) return;
    const body = rowsBody();
    const out = body?.animate([{ opacity: Number(getComputedStyle(body).opacity) || 1 }, { opacity: CUT_DIM }], { duration: CUT_OUT_MS, easing: 'ease-out', fill: 'forwards' });
    const id = window.setTimeout(() => {
      landed.current = latest.current;
      landedAt.current = performance.now();
      setLandN(n => n + 1);
    }, CUT_OUT_MS);
    return () => {
      window.clearTimeout(id);
      /* held at the dim until the come-up takes over (below); a cut that is called off lets go */
      if (performance.now() - landedAt.current > 50) out?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cutting, landN]);
  /* the come-up starts once the new rows are mounted (a mutation, then quiet frames), with a floor for an empty list */
  useLayoutEffect(() => {
    if (landN === 0) return;
    const body = rowsBody();
    if (!body) return;
    let raf = 0;
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      mo.disconnect();
      window.clearTimeout(floor);
      const from = Math.min(Number(getComputedStyle(body).opacity) || CUT_DIM, 0.5);
      body.getAnimations().forEach(a => a.cancel());
      body.animate([{ opacity: from }, { opacity: 1 }], { duration: CUT_IN_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
    };
    /* two quiet frames: the grid mounts a long list in two passes */
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(up);
      });
    });
    mo.observe(body, { childList: true, subtree: true });
    const floor = window.setTimeout(up, 420);
    return () => {
      cancelAnimationFrame(raf);
      up();
    };
  }, [landN]);
  const glide = animate && !cutting && performance.now() - landedAt.current > 450;
  /* The open row wears the house selection — the drill's row, wherever the click came from */
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    api.forEachNode(n => {
      const on = !!n.data && rowKey(n.data) === selectedKey;
      if (n.isSelected() !== on) n.setSelected(on);
    });
  }, [selectedKey, rows, rowKey]);
  /* a click on a control inside a cell is the control's: React's stopPropagation never reaches the grid's listener */
  const onRow = (e: RowClickedEvent<T>) => {
    const target = e.event?.target as HTMLElement | null | undefined;
    if (target?.closest?.('button, a, [data-own-click]')) return;
    if (e.data && onRowClick) onRowClick(e.data);
  };

  /* back to top for a windowed grid, past 600px; absolute writes each frame so a tick cannot shove the glide */
  const [showTop, setShowTop] = useState(false);
  /* endless: a window the height of the screen once the rows overflow half a page; never the pager */
  const windowed = !!endless && gridRows.length > TRACE_PAGE / 2;
  const paged = !endless && gridRows.length > TRACE_PAGE;
  const endlessRef = useRef(endless);
  endlessRef.current = endless;
  const onDeepRef = useRef(onDeep);
  onDeepRef.current = onDeep;
  const rowPx = phone ? 58 : 39;
  const headPx = phone ? 0 : 32;
  const windowedRef = useRef(windowed);
  windowedRef.current = windowed;
  const rowPxRef = useRef(rowPx);
  rowPxRef.current = rowPx;
  const headPxRef = useRef(headPx);
  headPxRef.current = headPx;
  const [pager, setPager] = useState({ page: 0, pages: 1 });
  /* a short page keeps the height of its rows */
  const onPage = paged ? Math.min(TRACE_PAGE, Math.max(1, gridRows.length - pager.page * TRACE_PAGE)) : TRACE_PAGE;
  const pageHeight = headPx + onPage * rowPx + 2;
  const onPaginationChanged = (e: PaginationChangedEvent) => {
    const page = e.api.paginationGetCurrentPage();
    const pages = Math.max(1, e.api.paginationGetTotalPages() || 1);
    setPager(prev => (prev.page === page && prev.pages === pages ? prev : { page, pages }));
  };
  /* v36 scrolls the whole grid viewport (`.ag-grid-viewport`); older builds scrolled the body */
  const viewport = () => wrapRef.current?.querySelector<HTMLElement>('.ag-grid-viewport, .ag-body-viewport') ?? null;
  const nearEnd = (api: { getLastDisplayedRowIndex: () => number; getDisplayedRowCount: () => number }) => {
    const en = endlessRef.current;
    if (!en || en.state !== 'more') return;
    const n = api.getDisplayedRowCount();
    if (n > 0 && api.getLastDisplayedRowIndex() >= n - 30) en.onNear();
  };
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;
  const visTimer = useRef(0);
  /* the rows on screen: a windowed grid by its own scroll, a grid that grows with the page by the page's scroll */
  const tellVisible = (api: { isDestroyed: () => boolean; getDisplayedRowCount: () => number; getDisplayedRowAtIndex: (i: number) => { data?: T } | undefined }) => {
    if (!onVisibleRef.current) return;
    window.clearTimeout(visTimer.current);
    visTimer.current = window.setTimeout(() => {
      /* a remounted grid (a new key) destroys the api this timer closed over */
      if (api.isDestroyed()) return;
      const wrap = wrapRef.current;
      const n = api.getDisplayedRowCount();
      if (!wrap || !n) return;
      let a = 0;
      let b = n - 1;
      const vp = viewport();
      if (windowedRef.current && vp) {
        a = Math.floor(vp.scrollTop / rowPxRef.current);
        b = a + Math.ceil(vp.clientHeight / rowPxRef.current);
      } else {
        const top = wrap.getBoundingClientRect().top + headPxRef.current;
        a = Math.max(0, Math.floor(-top / rowPxRef.current));
        b = Math.ceil((window.innerHeight - top) / rowPxRef.current);
      }
      const out: T[] = [];
      for (let i = Math.max(0, a); i <= Math.min(b, n - 1) && out.length < 60; i++) {
        const d = api.getDisplayedRowAtIndex(i)?.data;
        if (d) out.push(d);
      }
      onVisibleRef.current?.(out);
    }, 250);
  };
  useEffect(() => () => window.clearTimeout(visTimer.current), []);
  useEffect(() => {
    if (!onVisible) return;
    const onScroll = () => {
      const api = gridRef.current?.api;
      if (api && !windowedRef.current) tellVisible(api);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [!!onVisible]); // eslint-disable-line react-hooks/exhaustive-deps
  const onBodyScroll = (e: BodyScrollEvent<T>) => {
    if (e.direction !== 'vertical') return;
    setShowTop(e.top > 600);
    if (e.top > 0) scrolled.current = true;
    onDeepRef.current?.(e.top > 80);
    nearEnd(e.api);
    tellVisible(e.api);
  };
  /* pages load on demand; a page that landed under a reader still at the bottom asks for the next, while pages add rows */
  const shownN = gridRows.length;
  const scrolled = useRef(false);
  const lastN = useRef(shownN);
  useEffect(() => {
    const grew = shownN > lastN.current;
    lastN.current = shownN;
    /* only a reader who has scrolled the window — never the first rows landing */
    if (!grew || !windowed || !scrolled.current) return;
    const api = gridRef.current?.api;
    if (api) nearEnd(api);
  }, [shownN, endless?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  /* a short list (no window — the page scrolls) asks when its foot comes into view */
  const footRef = useRef<HTMLDivElement | null>(null);
  /* one page per sighting, and on only while the pages add rows — or, for a cut that shows nothing yet (a search whose
     rows are further down the list), up to ten pages, then the button */
  const ioSeen = useRef({ shown: -1, empty: 0 });
  useEffect(() => {
    const el = footRef.current;
    if (!el || windowed || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(es => {
      const en = endlessRef.current;
      if (!es.some(e => e.isIntersecting) || !en || en.state !== 'more') return;
      const seen = ioSeen.current;
      /* rows on their way in (the cut's step back) are not an empty cut */
      if (rows.length > 0 && shownN === 0) return;
      if (shownN === 0) {
        if (!(en.loaded && en.loaded > 0)) return;
        if (seen.empty >= 10) return;
        seen.empty++;
      } else {
        if (shownN <= seen.shown) return;
        seen.empty = 0;
      }
      seen.shown = shownN;
      en.onNear();
    });
    io.observe(el);
    return () => io.disconnect();
    /* the note carries the count loaded: a page that lands under a cut that shows nothing re-arms the sighting */
  }, [windowed, endless?.state, shownN, typeof endless?.note === 'string' ? endless.note : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (topSignal) scrollToTop();
  }, [topSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Rows cut down under the reader (a card, the search) pull the scroll back without a scroll event */
  useEffect(() => {
    setShowTop((viewport()?.scrollTop ?? 0) > 600);
  }, [rows]);
  /* a shown no-rows overlay is redrawn when its words change */
  const firstEmpty = useRef(true);
  useEffect(() => {
    if (firstEmpty.current) {
      firstEmpty.current = false;
      return;
    }
    const api = gridRef.current?.api;
    /* rows held back for the crossfade are not "nothing" */
    if (!api || gridRows.length || rows.length) return;
    api.hideOverlay();
    api.showNoRowsOverlay();
  }, [emptyText]); // eslint-disable-line react-hooks/exhaustive-deps
  /* an overlay shown by hand stays until it is hidden by hand — rows landing take it down */
  const hasRows = gridRows.length > 0;
  useEffect(() => {
    if (hasRows) gridRef.current?.api?.hideOverlay();
  }, [hasRows]);
  const scrollToTop = () => {
    const el = viewport();
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.scrollTop = 0;
      return;
    }
    const start = el.scrollTop;
    const t0 = performance.now();
    const DUR = 450;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.scrollTop = 0;
      setShowTop(false);
    };
    const step = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / DUR);
      const eased = 1 - Math.pow(1 - t, 3);
      el.scrollTop = Math.round(start * (1 - eased));
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
    window.setTimeout(finish, DUR + 100);
  };

  return (
    /* suppressAnimationFrame puts every row in the first paint; the endless foot stands under the window, not in it */
    <div ref={wrapRef} className={`slayer-board relative border-t border-borderSubtle animate-grid-in ${windowed ? '[&_.ag-grid-pinned-right-cells_.ag-column-last]:!pr-[22px] [&_.ag-grid-pinned-right-cells_.ag-cell:last-child]:!pr-[22px] [&_.ag-header-cell.ag-column-last]:!pr-[22px]' : ''} ${windowed && phone ? '[&_.ag-cell]:!pr-[18px]' : ''}`} data-trace-grid={testId} data-fit-dbg={JSON.stringify(fit)} data-lock={lockColumns || undefined} data-cutting={cutting || undefined} data-phone-rows={phone || undefined} data-paged={paged || undefined} data-endless={endless ? endless.state : undefined}>
     <div className="relative" style={windowed ? { height: `min(${pageHeight}px, calc(100dvh - 72px))`, minHeight: 360 } : autoHeight ? (paged ? { height: pageHeight } : undefined) : { height }} data-trace-window>
      <AgGridProvider modules={GRID_MODULES}>
        <AgGridReact<T>
          ref={gridRef}
          theme={phone ? TRACE_PHONE_THEME : TRACE_GRID_THEME}
          domLayout={autoHeight && !paged && !windowed ? 'autoHeight' : undefined}
          rowData={gridRows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={p => rowKey(p.data)}
          getRowClass={rowClass ? p => (p.data ? rowClass(p.data) : undefined) : undefined}
          onRowClicked={onRow}
          onBodyScroll={onBodyScroll}
          onModelUpdated={e => {
            tellVisible(e.api);
            measureFit();
          }}
          onFirstDataRendered={measureFit}
          onVirtualColumnsChanged={measureFit}
          onDisplayedColumnsChanged={measureFit}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
          suppressCellFocus
          suppressAnimationFrame
          rowBuffer={windowed ? 40 : 200}
          animateRows={glide}
          suppressMovableColumns={lockColumns}
          suppressColumnMoveAnimation={lockColumns}
          pagination={paged}
          paginationPageSize={TRACE_PAGE}
          paginationPageSizeSelector={false}
          suppressPaginationPanel
          onPaginationChanged={onPaginationChanged}
          tooltipShowDelay={350}
          tooltipHideDelay={8000}
          overlayNoRowsTemplate={`<span class="font-mono text-t11 text-textSecondary">${emptyText}</span>`}
        />
      </AgGridProvider>
      {showTop && (!autoHeight || windowed) && (
        <button
          onClick={scrollToTop}
          title="Back to top"
          aria-label="Scroll back to the top"
          data-trace-top
          className="absolute bottom-5 right-6 z-10 inline-flex items-center justify-center w-9 h-9 rounded-full border border-borderMuted bg-panel/90 backdrop-blur-sm text-textSecondary hover:text-textPrimary hover:bg-panelHover shadow-lg shadow-black/40 transition-colors animate-soft-in"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      )}
     </div>
      {paged && <PageBar page={pager.page} pages={Math.max(pager.pages, Math.ceil(gridRows.length / TRACE_PAGE))} onPage={n => gridRef.current?.api.paginationGoToPage(n)} testId={testId} />}
      {endless && (gridRows.length > 0 || endless.state === 'loading' || (endless.state === 'more' && (endless.loaded ?? 0) > 0)) && (
        <div ref={footRef} className="relative z-[1] bg-panel px-3 min-h-10 border-t border-borderSubtle/50 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-t11" data-endless-foot={endless.state}>
          <span className="min-w-0 flex-1 basis-[12rem] truncate text-textMuted">{endless.note}</span>
          {endless.extra}
          {endless.state === 'more' && (
            <button type="button" onClick={endless.onNear} className="slayer-chip shrink-0" data-endless-more>
              {(endless.moreLabel ?? 'Load older').replace(' ↓', '')}
            </button>
          )}
          {endless.state === 'loading' && <span className="shrink-0 text-textMuted">{endless.moreLabel ? 'Loading…' : 'Loading older…'}</span>}
        </div>
      )}
    </div>
  );
};

export default TraceBox;

/** An endless grid's foot from a list's older pages: how many are loaded, and why it stopped */
export function endlessOf(o: { state: EndlessFeed['state']; loaded: number; loadOlder: () => void } | undefined, noun: string, endWords: string, paused = false, moreLabel?: string): EndlessFeed | undefined {
  if (!o) return undefined;
  const n = `${o.loaded.toLocaleString('en-US')} ${noun} loaded`;
  const state = paused ? 'idle' : o.state;
  return {
    onNear: o.loadOlder,
    state,
    moreLabel,
    loaded: o.loaded,
    note: state === 'end' ? `${n} · ${endWords}` : state === 'cap' ? `${n} · the most the page holds at once` : state === 'idle' ? `${n}${paused ? ' · paused' : ''}` : n,
  };
}
