/*
==================================================
  SLAYER TERMINAL - THE TRACE BOX (components/trace/TraceBox.tsx)

  The house grammar for every Trace page (the walk,
  2026-09-09): ONE box — the head (15px title, the
  guide door, the 11px line, the facts as a dl with
  the page's champions among them in their inks),
  one line of cards, the sentence, then the body —
  and THE GRID: AG Grid on the house theme at the
  tape's 39px rows, fed by the same Column<T>
  definitions the pages already carry (the adapter
  below), so a page's cells, inks and doors are
  untouched. Since 2026-09-11 the grid GROWS with
  its rows and the page scrolls (Noah: "as long as
  information is flowing then the page should keep
  getting longer", the Compass board's rule) — the
  door home is the page's (BackToTop in the shell);
  a window a screen tall is still there for a host
  that asks for one.

  What it replaces: the composition strip and its
  pills, the FlowTop control row and its filters
  popover of chips, the read strip with its ink
  key, and the hand-rolled table.
==================================================
*/

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
export const TRACE_GRID_THEME = GRID_THEME.withParams({ rowHeight: 39, headerHeight: 32, fontSize: 12 });
/** A phone's row: two lines, the contract over its figures (see PhoneRow) */
const TRACE_PHONE_THEME = GRID_THEME.withParams({ rowHeight: 58, headerHeight: 0, fontSize: 12 });

/** THE CONTROLS LINE'S GRAMMAR, shared: a wrapping row at a desk; on a phone a grid of two equal cells (the Trace box's
    own, below) — the Dossier pages draw their own lines and wear the same classes (2026-10-19) */
export const CONTROLS_LINE = 'flex items-center gap-2 flex-wrap max-sm:grid max-sm:grid-cols-2 max-sm:[&>*]:min-w-0 max-sm:[&>*]:w-full max-sm:[&>[data-dropdown]]:justify-between max-sm:[&>[data-span]]:col-span-2 max-sm:[&>[data-span]]:order-first max-sm:[&>[data-cut-doors]]:col-span-2 max-sm:[&>[data-cut-doors]>*]:flex-1 max-sm:[&>[data-cut-doors]>*]:justify-center max-sm:[&>.ml-auto]:col-span-1 max-sm:[&>.ml-auto>*]:w-full max-sm:[&>.ml-auto>*>button]:w-full max-sm:[&>.ml-auto>*>button]:justify-between max-sm:[&>[data-scope]]:col-span-2 max-sm:[&>[data-scope]]:h-auto max-sm:[&>[data-scope]]:min-h-6 max-sm:[&>[data-scope]_[data-scope-pick]]:flex-wrap max-sm:[&>[data-scope]_[data-scope-pick]]:py-1 max-sm:[&>[data-scope]_[data-scope-pick]]:gap-y-1 max-sm:[&>[data-live-hold]]:order-last max-sm:[&>[data-live-hold]]:col-span-2 max-sm:[&>[data-live-hold]>button]:flex-1 max-sm:[&>[data-live-hold]>button]:w-full max-sm:[&>[data-live-hold]>button]:justify-center max-sm:[&>.ml-2]:col-span-2 max-sm:[&>.ml-2]:order-last';

/* ---- the head's facts ------------------------------------------------------------ */

export const Fact = ({ label, children, testId, title, wrap = false }: { label: string; children: ReactNode; testId?: string; title?: string; wrap?: boolean }) => (
  /* `wrap`: a fact that is a sentence takes the line's width and wraps at every width (retail, round 10: the Live Tape's
     "NVDA · biggest with a clear side today" ran past the card's right edge at 1440) */
  <div className={wrap ? 'min-w-0 basis-full' : 'min-w-0'} title={title}>
    <dt className="text-[11px] text-textMuted whitespace-nowrap max-sm:whitespace-normal">{label}</dt>
    {/* ON A PHONE A FACT WRAPS, never clips (audit round 5: "close of 10…", "$101.5…") */}
    <dd className={`mt-0.5 font-mono text-[12px] tnum text-textPrimary ${wrap ? 'whitespace-normal break-words' : 'whitespace-nowrap max-sm:whitespace-normal max-sm:break-words'}`} data-trace-fact={testId}>
      {children}
    </dd>
  </div>
);

/* 'plain' for a champion that is a MAGNITUDE with no direction — the most lifted, the most hit, the busiest name: a side
   is not a direction (2026-10-13, the partner's rule at Noah's word), and the warn orange is SWEEP's, so orange would
   mean two things on one screen */
type Ink = 'supreme' | 'bull' | 'bear' | 'warn' | 'plain';
const INK: Record<Ink, string> = { supreme: 'text-supreme', bull: 'text-bull', bear: 'text-bear', warn: 'text-warn', plain: 'text-textSecondary' };

/** A champion: the label in its ink, the row's words as a door onto the row */
export const Champion = ({ label, ink, onOpen, children, testId, title = "Open the contract's card" }: { label: string; ink: Ink; onOpen: () => void; children: ReactNode; testId?: string; title?: string }) => (
  <div className="min-w-0">
    <dt className={`text-[11px] whitespace-nowrap max-sm:whitespace-normal ${INK[ink]}`}>{label}</dt>
    <dd className="mt-0.5 whitespace-nowrap max-sm:whitespace-normal" data-trace-champion={testId}>
      {/* the door's own hover, silver (door.ts) — it underlined on hover before 2026-09-16 */}
      <button type="button" onClick={onOpen} title={title} className="font-mono text-[12px] tnum font-semibold text-textPrimary hover:text-silver transition-colors text-left max-sm:break-words">
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
  /** The page's sentence (RichRead + doors) — with `lead`, what always stands above the lead (the saved cuts) */
  sentence: ReactNode;
  /** ONE PLAIN LINE FIRST (retail, round 11: each page opened on ~120 words of desk-speak): what happened, in a retail
      trader's words; the page's full read (`detail`) waits behind "more" */
  lead?: ReactNode;
  detail?: ReactNode;
  guide?: { title: string; door: string; body: ReactNode; testId: string; open: boolean; onOpen: (v: boolean) => void };
  children: ReactNode;
  testId: string;
  className?: string;
  /** Attributes for the probes */
  data?: Record<string, string | number | undefined>;
  /** On a phone the cards line folds behind one Filters button (opt-in — the Live Tape and the Screener stood ~750px of
      head and cards above their first row) */
  foldOnPhone?: boolean;
}

export const TraceBox = ({ title, sub, facts, controls, sentence, lead, detail, guide, children, testId, className = '', data, foldOnPhone = false }: TraceBoxProps) => {
  const attrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  const phone = useIsPhone();
  const [unfolded, setUnfolded] = useState(false);
  const [more, setMore] = useState(false);
  const folded = foldOnPhone && phone && !unfolded;
  return (
    /* overflow-CLIP, not hidden: hidden makes the box a scroll container, and
       a rail that should stick to the page while the grid runs past a screen
       (the tape's) would stick to the box instead — which never scrolls */
    <div className={`relative border border-borderSubtle rounded-xs overflow-clip bg-panel flex flex-col ${className}`} {...attrs} data-trace-box={testId}>
      {guide && (
        <GuideFocus open={guide.open} onClose={() => guide.onOpen(false)} title={guide.title} testId={guide.testId} viewport>
          {guide.body}
        </GuideFocus>
      )}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        {/* the title keeps a floor: with five facts beside it the column was squeezed until "Which way the money leans"
            broke over three lines into its own sub — now the facts wrap under it instead */}
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">{title}</h3>
            {guide && <GuideDoor open={guide.open} onClick={() => guide.onOpen(!guide.open)} title={guide.door} testId={guide.testId} />}
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted break-words sm:whitespace-nowrap sm:truncate">{sub}</p>
        </div>
        {/* THE FACTS WRAP (the phone pass, 2026-09-13 — Noah: "make sure every
            page and section ticks the box of mobile viewing"): a column-flow
            grid had one row whatever the width, so on a phone the fourth fact
            ran under the box's edge; a wrapping row keeps one line where it
            fits and two where it does not. */}
        <dl className="flex flex-wrap gap-x-6 gap-y-2" data-trace-facts>
          {facts}
        </dl>
      </div>
      {/* THE CARDS LINE: one line where it fits; on a phone TWO COLUMNS, every
          card a cell (a wrapping row put the cards wherever they landed —
          Noah: "the buttons just randomly get compressed with no order"); the
          right-hand group (Rail · Columns, `ml-auto`) takes a row of its own
          at the end, still at the right. */}
      {/* ON A PHONE THE LINE IS A GRID OF EQUAL CELLS (Noah, 2026-10-19, seven phone stills: "these button formats need to
          change they look all over the place"): two columns, every control stretched to its cell — the search first on a
          row of its own, the cards in rows of two in the page's order, then the doors: Link and Save on one row, Columns
          and the live hold on the last. The cards had kept their own widths inside the cells, so a row read "Most active"
          beside "Both" and Columns stood alone at the right. */}
      {controls != null && controls !== false && foldOnPhone && phone && (
        <div className="px-5 pb-2">
          <button
            type="button"
            onClick={() => setUnfolded(v => !v)}
            aria-expanded={!folded}
            className="w-full h-8 rounded-md border border-borderSubtle bg-chip font-mono text-[11px] uppercase tracking-widest text-textSecondary hover:text-textPrimary"
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
      {/* a div, not a p: the saved cuts' chips and the status line stand inside the sentence (2026-10-13) */}
      {/* no sentence, no line — a page whose body already says it (the Tracker's empty desk) never says it twice */}
      {lead != null ? (
        <div className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-trace-sentence>
          {sentence}
          <p className="text-[13px] leading-snug text-textPrimary" data-trace-lead>
            {lead}
            {detail != null && detail !== false && (
              <>
                {' '}
                <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} className="font-mono text-[11px] text-textSecondary underline decoration-dotted underline-offset-2 hover:text-textPrimary" data-trace-more>
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
          <div className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-trace-sentence>
            {sentence}
          </div>
        )
      )}
      {children}
    </div>
  );
};

/** A PHONE'S ROW (the partner's tape, at Noah's word 2026-10-13): every grid showed about two and a half columns on a
    390px screen — the time, the ticker and part of the contract — and the premium and the side were a sideways swipe
    away. On a phone a row is two lines: who and what on top, the figures that matter under it. */
export const PhoneRow = ({ lead, title, aside, figures }: { lead?: ReactNode; title: ReactNode; aside?: ReactNode; figures: ReactNode[] }) => (
  <span className="flex flex-col gap-1 py-1.5 w-full leading-none">
    <span className="flex items-center gap-2 min-w-0">
      {lead}
      {/* the title gives way to the time at its right — it clips, never runs under it */}
      <span className="min-w-0 flex-1 overflow-hidden flex items-center gap-1.5 font-mono text-[12px] text-textPrimary whitespace-nowrap [&>*:first-child]:shrink-0">{title}</span>
      {aside && <span className="ml-auto shrink-0 font-mono text-[11px] tnum text-textSecondary">{aside}</span>}
    </span>
    <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap font-mono text-[11px] tnum text-textSecondary pl-5">
      {figures.map((f, i) => (
        <span key={i} className="whitespace-nowrap">
          {f}
        </span>
      ))}
    </span>
  </span>
);

/* ---- the grid in its window ------------------------------------------------------ */

/** A page's Column<T> definitions as AG Grid columns — the cells, inks and doors untouched */
export function columnsToColDefs<T>(columns: Column<T>[], hidden: Set<string>, widths: Record<string, number> = {}, tooltips: Record<string, string> = {}, flexes: Record<string, number> = {}, lock = false): ColDef<T>[] {
  return columns.map(c => {
    const fixed = widths[c.key] ?? (c.width ? parseInt(c.width, 10) : undefined);
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
    /* A SET WIDTH IS A SHARE, NOT A WALL (the audit, 2026-10-22): fixed widths summed past the box at a laptop width, so
       the last column stood half under the box's edge ("W", "Prev $", "V") behind a scroll nobody saw. Each column now
       takes its width as its floor and its share of the room — never narrower than its cells (a squeezed cell paints a
       clipped ellipsis), growing to fill a wide box; the pages keep their widths inside a laptop's box. */
    if (fixed) {
      def.width = fixed;
      def.minWidth = fixed;
      def.flex = fixed;
      /* Locked: same shares as before, so the row stays full, but the reader
         cannot drag a column to a new width or a new place. */
      if (lock) def.resizable = false;
    } else {
      def.flex = flexes[c.key] ?? 1;
      /* 92, not 84: the house's widest standard cell (the Lean bar) is 64px and the grid's own padding is 24, so 84
         guaranteed a four-pixel overflow — and an overflowing cell paints a CLIPPED ELLIPSIS, a stray ".." at the
         cell's edge that reads as a rendering fault (the Screener's Lean column, 2026-10-13). */
      def.minWidth = 92;
    }
    return def;
  });
}

/* THE HEAVIEST AT REST, for every grid that grows (lifted from Intervals, 2026-09-20 — Noah, clearing the search on the
   book: "the repositioning… seem to be quite delayed causing it to look like lagging"). A grid that GROWS WITH ITS ROWS
   (autoHeight — the page scrolls, not the grid) draws EVERY row it holds: nothing is windowed. The book at rest is 403
   rows × 17 columns = 6,851 cells, each a React cell, and clearing the search mounted them all in one go — measured, one
   task of 625–668ms with the page frozen under it, and only THEN did the rows start to slide. So at rest a grid holds its
   first 80 rows (they are already ranked — the screen's own order) and a foot says how many there are and opens the rest.
   Never a door for fewer than 20 hidden rows: a door that hides a dozen is chrome. The reader's choice holds while the
   page is open. The page's figures (premium, counts, the champions, the drill's list) still read EVERY row. */
export const ROWS_AT_REST = 80;
const CAP_SLACK = 20;
export interface RestCap<T> {
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
    <div className="px-5 py-2.5 border-t border-borderSubtle flex items-center gap-2 text-[11px] text-textSecondary" data-rest-foot={testId} data-capped={cap.capped || undefined}>
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
  tooltips?: Record<string, string>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  /** A window's height — a screen less the chrome above it (a host that keeps a window) */
  height?: string;
  /** No window: the grid grows with its rows and the PAGE scrolls — every Trace page since 2026-09-11 (the Compass board's rule) */
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
  /** ENDLESS SCROLL (the owner, 2026-10-23: "make it infinite"): no pages — the rows scroll in a window the height of the
      screen, and near the bottom the grid asks for the next older page (`onNear`), once, while `state` is 'more'. The foot
      under the rows says where the reading stands: loading, the start reached, the cap, or a button to ask by hand. */
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
export interface EndlessFeed {
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

export const TraceGrid = <T,>({ rows, columns, hidden, widths, flexes, lockColumns = false, tooltips, rowKey, onRowClick, selectedKey, height, autoHeight = false, initialSort, rowClass, animate = true, emptyText = 'Nothing on this cut', pinLeft, pinRight, phoneRow, endless, onDeep, topSignal, onVisible, testId }: TraceGridProps<T>) => {
  const gridRef = useRef<AgGridReact<T>>(null);
  const phone = useIsPhone() && !!phoneRow;
  const hiddenSet = hidden ?? new Set<string>();
  const endlessOn = !!endless;
  const columnDefs = useMemo(() => {
    if (phone && phoneRow) {
      /* one column, the row in two lines */
      return [{ colId: 'phone', headerName: '', flex: 1, sortable: false, resizable: false, suppressMovable: true, cellRenderer: (p: ICellRendererParams<T>) => (p.data ? phoneRow(p.data) : null) } as ColDef<T>];
    }
    const defs = columnsToColDefs(columns, hiddenSet, widths, tooltips, flexes, lockColumns);
    for (const d of defs) {
      if (pinLeft?.includes(d.colId ?? '')) d.pinned = 'left';
      else if (pinRight?.includes(d.colId ?? '')) {
        d.pinned = 'right';
        /* an endless window carries a vertical scrollbar beside the right-pinned figure — room for it, so the figure is
           never clipped ("$13.1K" read "$13.1") */
        if (endlessOn && d.width) {
          d.width += 14;
          d.minWidth = d.width;
          d.flex = d.width;
        }
      }
    }
    if (initialSort) {
      const d = defs.find(x => x.colId === initialSort.key);
      if (d) d.sort = initialSort.dir;
    }
    return defs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, hiddenSet, widths, tooltips, flexes, lockColumns, phone, phoneRow, pinLeft, pinRight, endlessOn]);
  const defaultColDef = useMemo<ColDef<T>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);
  /* A CUT — the search cleared, a card turned, "Show all" — IS A CROSSFADE, NEVER A SLIDE AND NEVER A SWAP (2026-09-20).
     Two complaints from Noah, the same afternoon, on the book:
       · first the wait: clearing the search froze the page ~650ms and THEN two dozen rows slid out to their places among
         hundreds ("the repositioning… seem to be quite delayed"). The slide is for a RE-RANK — the same rows in a new
         order, the eye can follow one. For a cut there is nothing to follow, so a cut never glides (`animateRows` is read
         when the grid redraws, and every changed option is set before the rows are, so turning it off on the render that
         lands the cut is enough; the next re-rank glides again).
       · then, with the wait gone, the opposite: "it just abruptly changes the tape very quickly" — one frame a name's
         rows, the next frame eighty others.
     So a cut is HELD for a moment: the rows the grid has STEP BACK (to 0.3 over 120ms), only then is the grid given the new
     list, and once its rows are in they COME UP to full over 420ms. OPACITY ONLY, on the standard ease — the house rule
     for anything that holds a table (index.css: travel re-rasterises every figure every frame, and the expo curve is at
     0.87 by 90ms, a snap on a layer this large). THE MOUNT HIDES INSIDE THE STEP BACK: eighty rows × seventeen cells take
     ~140ms of main thread, and they are spent while the rows stand still and dim — nothing on screen is moving, so
     nothing can stutter. What is NOT a cut (the tape ticking, a re-rank, a few rows coming or going) passes straight
     through, untouched. Reduced motion: no hold, no fade. Only the ROWS fade; the head stays put. */
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const calm = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const landed = useRef(rows);
  const latest = useRef(rows);
  latest.current = rows;
  const landedAt = useRef(0);
  const [landN, setLandN] = useState(0);
  /* AN OLDER PAGE JOINING UNDER THE ROWS IS NOT A CUT (audit round 11, major 2): the same head, more rows below — it passes
     straight through, so an endless list never holds its old rows while a page lands */
  const sameHead = !!endless && rows.length > landed.current.length && landed.current.length > 0 && rowKey(rows[0]) === rowKey(landed.current[0]);
  const cutting = !calm && !sameHead && Math.abs(rows.length - landed.current.length) > Math.max(CUT_JUMP, landed.current.length * 0.15);
  /* what the grid holds: the rows it had, while they step back; else the page's rows as they come */
  const gridRows = cutting ? landed.current : rows;
  useEffect(() => {
    if (!cutting) landed.current = rows;
  });
  const rowsBody = () => wrapRef.current?.querySelector<HTMLElement>('.ag-grid-scrolling-rows') ?? null;
  /* A CUT ALWAYS LANDS (audit round 11, major 1: typed "NVDA 220C 11/20" + Enter, the head read "6 of 2,426" while the grid
     kept SOXL, SPXW and SPY rows for 16s+): the held rows land after the step back, and when the rows moved again by then
     — still a cut against what landed — the next step back is set, rather than the grid waiting on an effect that had
     already run (the hold re-arms on every landing, `landN`) */
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
  /* THE COME-UP starts on the first frame AFTER the new rows are in — the grid mounts them in the tasks that follow the
     commit, so the moment is read off the rows themselves (a mutation, then a frame), with a floor so an empty list that
     never mutates still comes up */
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
    /* two quiet frames, not one: the grid mounts a long list in two passes (measured: 35 rows, then 80), and a come-up
       begun between them lost its first 95ms to the second */
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
  /* A click on a control inside a cell (the watch mark, a door with its own
     action) is that control's, not the row's — React's stopPropagation never
     reaches the grid's native listener, so the row asks the target itself */
  const onRow = (e: RowClickedEvent<T>) => {
    const target = e.event?.target as HTMLElement | null | undefined;
    if (target?.closest?.('button, a, [data-own-click]')) return;
    if (e.data && onRowClick) onRowClick(e.data);
  };

  /* THE DOOR HOME (Noah, 2026-09-10: "the ability to glide back to the top if
     user scrolls down too far"): the grid scrolls inside its own window, so
     the door watches the grid's body and sits in the window's corner — shown
     once the reader is a screen or so deep (the tape's 600px), gliding home
     on the house curve with absolute writes each frame so a tick cannot
     shove the scroll mid-glide; reduced motion jumps. */
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
  const [pager, setPager] = useState({ page: 0, pages: 1 });
  /* A short page keeps the height of its rows. A fixed 40 left a black band
     under the last page, and under any cut that did not fill one. */
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
  const tellVisible = (api: { getFirstDisplayedRowIndex: () => number; getLastDisplayedRowIndex: () => number; getDisplayedRowAtIndex: (i: number) => { data?: T } | undefined }) => {
    if (!onVisibleRef.current) return;
    window.clearTimeout(visTimer.current);
    visTimer.current = window.setTimeout(() => {
      const out: T[] = [];
      const a = Math.max(0, api.getFirstDisplayedRowIndex());
      const b = api.getLastDisplayedRowIndex();
      for (let i = a; i <= b && out.length < 60; i++) {
        const d = api.getDisplayedRowAtIndex(i)?.data;
        if (d) out.push(d);
      }
      onVisibleRef.current?.(out);
    }, 250);
  };
  const onBodyScroll = (e: BodyScrollEvent<T>) => {
    if (e.direction !== 'vertical') return;
    setShowTop(e.top > 600);
    if (e.top > 0) scrolled.current = true;
    onDeepRef.current?.(e.top > 80);
    nearEnd(e.api);
    tellVisible(e.api);
  };
  /* ONLY ON DEMAND: a scroll near the bottom asks (onBodyScroll), or the foot's button. A page that LANDED under a reader
     still at the bottom asks for the next one (audit round 11, major 2: "scrolled to the bottom, one page loaded, then it
     stopped" — a page that added a few rows left the reader at the end with no scroll to come) — but only while each page
     adds rows: a page that adds none stops there, so a cut that keeps few rows never walks the whole day unasked */
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
  /* THE EMPTY LINE FOLLOWS THE READ (audit round 8: "Reading…" changed to the cut's empty line, or back, while the grid
     kept the overlay it first drew) — a shown no-rows overlay is redrawn with the new words */
  const firstEmpty = useRef(true);
  useEffect(() => {
    if (firstEmpty.current) {
      firstEmpty.current = false;
      return;
    }
    const api = gridRef.current?.api;
    /* rows already in hand but held back for the cut's glide (cutting) are not "nothing" (audit round 9: "Nothing has
       traded on the book" flashed for a frame as the Screener's first book landed) */
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
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic, the house curve
      el.scrollTop = Math.round(start * (1 - eased));
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
    window.setTimeout(finish, DUR + 100);
  };

  return (
    /* THE GRID LANDS AS ONE (Noah, 2026-10-13: "it shows half the height as the other half loads in … it should be a
       smooth load in of the entire columns"). Measured on Footprints: the grid stood at its full height with 14 rows
       drawn, and the other 66 landed in a second task ~230ms later — the grid draws rows in animation frames by
       default, a scrolling grid's habit. Ours never scroll (autoHeight, 80 rows at rest), so suppressAnimationFrame
       puts every row in the first paint, and the whole box comes up over the table curve (index.css grid-in). */
    /* THE FOOT STANDS UNDER THE WINDOW, NEVER INSIDE IT (audit round 11, major 2: the window is a fixed height and the foot
       sat in it, under the grid — pushed out of the box, behind the page, its "Load older" unclickable at 1440 and 390) */
    <div ref={wrapRef} className={`slayer-board relative border-t border-borderSubtle animate-grid-in ${windowed ? '[&_.ag-grid-pinned-right-cells_.ag-column-last]:!pr-[22px] [&_.ag-grid-pinned-right-cells_.ag-cell:last-child]:!pr-[22px] [&_.ag-header-cell.ag-column-last]:!pr-[22px]' : ''} ${windowed && phone ? '[&_.ag-cell]:!pr-[18px]' : ''}`} data-trace-grid={testId} data-lock={lockColumns || undefined} data-cutting={cutting || undefined} data-phone-rows={phone || undefined} data-paged={paged || undefined} data-endless={endless ? endless.state : undefined}>
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
          overlayNoRowsTemplate={`<span class="font-mono text-[11px] text-textSecondary">${emptyText}</span>`}
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
        <div ref={footRef} className="relative z-[1] bg-panel px-3 min-h-10 border-t border-borderSubtle/50 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-[11px]" data-endless-foot={endless.state}>
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

/** An endless grid's foot from a list's older pages (traceLive useOlderPages): how many are loaded, and why it stopped */
/* `moreLabel`: a list walked down by size, not back in time, says "Load more ↓" (audit round 11, minor 3) */
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
