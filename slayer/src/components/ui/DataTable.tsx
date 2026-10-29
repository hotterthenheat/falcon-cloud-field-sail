import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronDown, ChevronUp } from 'lucide-react';

/** Rows the first paint carries — about a screen; the window takes over from there */
const FIRST_ROWS = 36;
/* Windowed rendering: only rows near the scroll viewport are in the DOM, with two spacer rows holding the rest's height
   (a 250-row screener was 15,000 nodes). The row-height guess is corrected by the first row drawn. */
const ROW_H_GUESS = 39;
const OVERSCAN = 14;

export interface Column<T> {
  key: string;
  /** ReactNode so a header can wrap itself in a Term explainer */
  header: React.ReactNode;
  align?: 'left' | 'right';
  width?: string;
  /** Provide to make the column sortable */
  sortValue?: (row: T) => number | string;
  render: (row: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  /** Scroll container height, e.g. "320px" */
  maxHeight?: string;
  emptyText?: string;
  /** Floating door home once the reader is a screen or so deep — the Live
      Tape's back-to-top grammar, aimed at THIS table's own scroller. */
  backToTop?: boolean;
  /** Extra classes for a row (the tape's arrival fade). Keep it referentially
      stable — a fresh function per render is harmless, but the string it
      returns is what the row memo compares. */
  rowClass?: (row: T) => string | undefined;
  /** Frozen columns, for tables whose rows arrive (the tape): measure once per column set, lock the widths in a
      fixed-layout colgroup, and release for one re-measure only when one of the newest eight rows would not fit.
      Off by default. */
  freezeColumns?: boolean;
}

/* Rows are memoised: with stable callbacks and columns from the caller, a new print re-renders one row, and a selection
   change touches only the two rows whose `selected` flipped. */
const DataRowInner = <T,>({
  row,
  columns,
  selected,
  onRowClick,
  extra,
}: {
  row: T;
  columns: Column<T>[];
  selected: boolean;
  onRowClick?: (row: T) => void;
  extra?: string;
}) => (
  <tr
    data-row
    onClick={onRowClick ? () => onRowClick(row) : undefined}
    className={`border-b border-borderSubtle/60 last:border-0 transition-colors ${onRowClick ? 'cursor-pointer' : ''} ${
      /* a selected row wears the silver rail: where you are */
      selected ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-ink/[0.02]'
    } ${extra ?? ''}`}
  >
    {columns.map(col => (
      <td
        key={col.key}
        className={`px-3 py-2 font-mono text-xs tnum whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}
      >
        {col.render(row)}
      </td>
    ))}
  </tr>
);
const DataRow = memo(DataRowInner) as typeof DataRowInner;

/** Dense sortable data table. Wrap in <Panel flush> for the standard look. */
const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey,
  initialSort,
  maxHeight,
  emptyText = 'No data',
  backToTop = false,
  rowClass,
  freezeColumns = false,
}: DataTableProps<T>) => {
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /* The box that scrolls: with maxHeight, this table's own; without, the page's (the shell's main). */
  const scrollBox = () => (maxHeight ? scrollerRef.current : (scrollerRef.current?.closest('main') ?? null));
  const [showTop, setShowTop] = useState(false);
  useEffect(() => {
    if (!backToTop) return;
    const el = scrollBox();
    if (!el) return;
    const onScroll = () => setShowTop(el.scrollTop > 600);
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backToTop, maxHeight]);

  /* The tape's own tween: absolute writes on the house curve each frame, so
     nothing can shove scrollTop mid-glide; reduced-motion jumps. */
  const scrollToTop = () => {
    const el = scrollBox();
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
    };
    const step = (now: number) => {
      if (done) return;
      const t = Math.min(1, (now - t0) / DUR);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic, the house curve
      el.scrollTop = Math.round(start * (1 - e));
      if (t < 1) requestAnimationFrame(step);
      else finish();
    };
    requestAnimationFrame(step);
    window.setTimeout(finish, DUR + 100);
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  /* The window: the first paint carries the first screen; then the scroll box decides which rows are near its viewport,
     at most one placement per frame, and state changes only when the window does. */
  const tableRef = useRef<HTMLTableElement | null>(null);
  const total = sortedRows.length;
  const [win, setWin] = useState({ start: 0, end: FIRST_ROWS });
  const rowH = useRef(ROW_H_GUESS);
  useEffect(() => {
    const box = scrollBox();
    const table = tableRef.current;
    if (!box || !table) return;
    let raf = 0;
    const place = () => {
      raf = 0;
      const body = table.tBodies[0];
      if (!body) return;
      /* the row height is the average of the rows drawn, taken once it is
         steady — a single row can be a pixel off its neighbours and half a
         pixel over 250 rows moved the table's end by a hundred (measured) */
      const drawn = body.querySelectorAll<HTMLTableRowElement>('tr[data-row]');
      if (drawn.length >= 4) {
        const avg = [...drawn].reduce((s, r) => s + r.getBoundingClientRect().height, 0) / drawn.length;
        if (avg > 20 && Math.abs(avg - rowH.current) > 1) rowH.current = avg;
      }
      const h = rowH.current;
      const bodyTop = body.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      const viewTop = box.scrollTop - bodyTop;
      const start = Math.max(0, Math.floor(viewTop / h) - OVERSCAN);
      const end = Math.min(total, Math.max(start + FIRST_ROWS, Math.ceil((viewTop + box.clientHeight) / h) + OVERSCAN));
      setWin(w => (w.start === start && w.end === end ? w : { start, end }));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    box.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      box.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, maxHeight]);
  const start = Math.min(win.start, Math.max(0, total - 1));
  const end = Math.min(win.end, total);
  const shownRows = sortedRows.slice(start, end);

  const toggleSort = (col: Column<T>) => {
    if (!col.sortValue) return;
    setSort(prev =>
      prev?.key === col.key ? { key: col.key, dir: prev.dir === 'desc' ? 'asc' : 'desc' } : { key: col.key, dir: 'desc' }
    );
  };

  /* The freeze (see the prop). The column set releases it; so does a cell
     among the newest rows that would clip. Nothing here runs unless asked. */
  const [colWidths, setColWidths] = useState<number[] | null>(null);
  const colSig = columns.map(c => c.key).join('|');
  useLayoutEffect(() => {
    if (freezeColumns) setColWidths(null);
  }, [colSig, freezeColumns]);
  /* measured a frame after each commit, not in a layout effect, which forced an early full layout of the table */
  useEffect(() => {
    if (!freezeColumns) return;
    const id = requestAnimationFrame(() => {
      const table = tableRef.current;
      if (!table) return;
      if (!colWidths) {
        if (sortedRows.length === 0) return;
        const tds = table.querySelector('tbody tr')?.querySelectorAll('td');
        if (!tds || tds.length !== columns.length) return;
        const raw = [...tds].map(td => td.getBoundingClientRect().width);
        /* Natural widths (the table overflows): round up and add slack. Stretched (it fits): no slack and round down, since
           under fixed layout rounded-up columns would sum past the box and add a scrollbar. */
        const box = scrollerRef.current?.clientWidth ?? 0;
        const total = raw.reduce((s, w) => s + w, 0);
        setColWidths(total > box + 1 ? raw.map(w => Math.ceil(w) + 6) : raw.map(w => Math.floor(w)));
        return;
      }
      const fresh = table.querySelectorAll('tbody tr:nth-child(-n+8) td');
      for (const td of fresh) {
        if (td.scrollWidth > td.clientWidth) {
          setColWidths(null);
          return;
        }
      }
    });
    return () => cancelAnimationFrame(id);
  });
  /* a box width change releases the freeze, once the width has settled (the sidebar animates over 300 ms) */
  useEffect(() => {
    if (!freezeColumns) return;
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = el.clientWidth;
    let settle = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        const w = el.clientWidth;
        if (w === last) return;
        last = w;
        setColWidths(null);
      }, 160);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      window.clearTimeout(settle);
    };
  }, [freezeColumns]);

  return (
    <div ref={scrollerRef} className="overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
      <table ref={tableRef} className={`w-full border-collapse ${colWidths ? 'table-fixed' : ''}`}>
        {colWidths && (
          <colgroup>
            {colWidths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
        )}
        <thead className="sticky top-0 z-10">
          <tr className="bg-chip border-b border-borderSubtle">
            {columns.map(col => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className={`px-3 py-2 font-mono text-t10 font-semibold uppercase tracking-wider text-textMuted whitespace-nowrap ${
                  col.align === 'right' ? 'text-right' : 'text-left'
                } ${col.sortValue ? 'cursor-pointer select-none hover:text-textSecondary' : ''}`}
                onClick={() => toggleSort(col)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.align === 'right' && sort?.key === col.key && (
                    sort.dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  )}
                  {col.header}
                  {col.align !== 'right' && sort?.key === col.key && (
                    sort.dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center font-mono text-t11 text-textMuted">
                {emptyText}
              </td>
            </tr>
          ) : (
            <>
              {/* the rows above the window, as one empty row of their height */}
              {start > 0 && (
                <tr aria-hidden style={{ height: start * rowH.current }} data-row-spacer="above">
                  <td colSpan={columns.length} className="p-0 border-0" />
                </tr>
              )}
              {shownRows.map(row => {
                const key = rowKey(row);
                return (
                  <DataRow
                    key={key}
                    row={row}
                    columns={columns}
                    selected={selectedKey === key}
                    onRowClick={onRowClick}
                    extra={rowClass?.(row)}
                  />
                );
              })}
              {end < total && (
                <tr aria-hidden style={{ height: (total - end) * rowH.current }} data-row-spacer="below">
                  <td colSpan={columns.length} className="p-0 border-0" />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
      {backToTop &&
        showTop &&
        createPortal(
          <button
            onClick={scrollToTop}
            title="Back to top"
            aria-label="Scroll back to the top"
            className="fixed bottom-6 right-6 z-40 inline-flex items-center justify-center w-9 h-9 rounded-full border border-borderMuted bg-panel/90 backdrop-blur-sm text-textSecondary hover:text-textPrimary hover:border-borderMuted hover:bg-panelHover shadow-lg shadow-black/40 transition-colors animate-soft-in"
          >
            <ArrowUp className="w-4 h-4" />
          </button>,
          document.body
        )}
    </div>
  );
};

/* Memoised: market ticks reach every page through context, and this table must not redraw unless its rows, columns or
   selection change. Callers keep `rowKey` and `onRowClick` stable; the cast keeps the generic signature. */
export default memo(DataTable) as typeof DataTable;
