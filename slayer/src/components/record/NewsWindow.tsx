/* A window of news rows that draws only the rows near its view. A day of the wire is well over a thousand stories of
   different heights; drawing them all cost ~25,000 nodes and a slow pick. The rows are measured as they draw (so a
   two-line headline takes its real height), the open story and the focused row stay drawn, the open story is kept in
   view, and the arrow keys walk the stories. The window scrolls itself only, never the page. Rows that land above the
   first row in view on a re-read (the same view, a fresh read) leave that row where it stands: the window scrolls by
   what was inserted, so nothing the reader sees moves. */

import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react';

/** The rows in view, first to last, for the parent (it places new stories out of view) */
export interface WindowSeen {
  first: string | null;
  last: string | null;
}

interface Props<T> {
  /** the scrolling window the rows sit in */
  box: RefObject<HTMLDivElement | null>;
  items: readonly T[];
  keyOf: (t: T) => string;
  /** a row's height before it is measured, for the window's width */
  estimate: (t: T, width: number) => number;
  /** the pinned head's height inside the window (a revealed row lands under it), 0 when there is none */
  head: number;
  /** the window's height before it is measured, so the first frame draws a full window */
  initialHeight: number;
  /** the open story: kept drawn, and brought into view when it changes or first lands */
  openKey?: string | null;
  /** bump to bring the open story into view again (a tab change) */
  reveal?: unknown;
  /** changes whenever what is drawn above the rows inside the window changes (beyond the head) */
  above?: unknown;
  /** the list's identity (its sort, its filters, its tab): a change of items under the same view is a re-read and keeps
      the first row in view where it stands; a new view does not */
  view?: unknown;
  /** written on every draw: the first and last rows in view */
  seen?: MutableRefObject<WindowSeen>;
  /** classes for the box the rows stand in (a minimum width, say) */
  className?: string;
  children: (t: T, index: number) => ReactNode;
}

/** rows drawn past each edge of the view, so a Tab or an arrow always finds the next row drawn */
const OVERSCAN = 8;

export default function NewsWindow<T>({ box, items, keyOf, estimate, head, initialHeight, openKey = null, reveal, above, view, seen, className = '', children }: Props<T>) {
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const indexOf = useMemo(() => {
    const m = new Map<string, number>();
    items.forEach((t, i) => m.set(keyOf(t), i));
    return m;
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const openIdx = openKey == null ? -1 : (indexOf.get(openKey) ?? -1);

  /* the open row and the focused row stay drawn wherever the window stands */
  const keepRef = useRef<{ open: number; focus: string | null; indexOf: Map<string, number> }>({ open: -1, focus: null, indexOf });
  keepRef.current.open = openIdx;
  keepRef.current.indexOf = indexOf;
  const rangeExtractor = useCallback((r: Range) => {
    const base = defaultRangeExtractor(r);
    const { open, focus, indexOf: idx } = keepRef.current;
    const f = focus == null ? -1 : (idx.get(focus) ?? -1);
    const lo = base.length ? base[0] : 0;
    const hi = base.length ? base[base.length - 1] : -1;
    const extra = [open, f].filter(i => i >= 0 && i < r.count && (i < lo || i > hi));
    if (!extra.length) return base;
    return [...new Set([...base, ...extra])].sort((a, b) => a - b);
  }, []);

  /* The window is the parent's element, and a parent's ref is set only after its children's layout effects have run:
     on the first mount the virtualizer would find no element. It is taken here once the ref is set. */
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (box.current !== el) setEl(box.current);
  });

  /* the window's width sets the estimate (how many lines a headline wraps to) */
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  /* The estimates are worked out once per list and width, into an array read by index: the virtualizer re-reads
     every unmeasured row's estimate each time a row is measured (about once a frame while scrolling), so the read
     must be a plain array lookup, not ~1,300 estimates or map lookups a frame. */
  const estimates = useMemo(() => {
    const a = new Float64Array(items.length);
    items.forEach((t, i) => (a[i] = estimate(t, width)));
    return a;
  }, [items, width, estimate]);
  const estimatesRef = useRef(estimates);
  estimatesRef.current = estimates;

  /* where the rows start inside the window: under the head, and under anything drawn before them (the day's prints).
     Read only when that can change — reading it every render would force a layout on every scrolled frame. */
  const sizerRef = useRef<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(head);
  useLayoutEffect(() => {
    const m = sizerRef.current?.offsetTop ?? head;
    if (m !== margin) setMargin(m);
  }, [head, width, items.length === 0, above]); // eslint-disable-line react-hooks/exhaustive-deps

  const getItemKey = useCallback((i: number) => keyOf(itemsRef.current[i]), [items]); // eslint-disable-line react-hooks/exhaustive-deps
  const estimateSize = useCallback((i: number) => estimatesRef.current[i] ?? 40, []);
  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => el,
    estimateSize,
    getItemKey,
    overscan: OVERSCAN,
    scrollMargin: margin,
    scrollPaddingStart: head,
    rangeExtractor,
    initialRect: { width: 0, height: initialHeight },
  });

  /* What is in view, written each draw (the virtualizer draws on every scroll): the rows in view and where each stands
     against the window's top, so a re-read can keep the first of them in place. */
  const inView = useRef<{ view: unknown; rows: { key: string; at: number }[] }>({ view, rows: [] });
  const anchor = useRef<{ key: string; at: number } | null>(null);
  const itemsSeen = useRef(items);
  if (itemsSeen.current !== items) {
    itemsSeen.current = items;
    /* the first row in view that is still on the list holds its place; a new view starts where it is told to */
    const was = inView.current;
    anchor.current = was.view === view ? (was.rows.find(r => indexOf.has(r.key)) ?? null) : null;
  }
  const off = v.scrollOffset ?? 0;
  const tall = v.scrollRect?.height ?? initialHeight;
  const drawn = v.getVirtualItems();
  const shown = drawn.filter(x => x.end > off + head + 1 && x.start < off + tall - 1);
  inView.current = { view, rows: shown.map(x => ({ key: String(x.key), at: x.start - off })) };
  if (seen) seen.current = { first: shown.length ? String(shown[0].key) : null, last: shown.length ? String(shown[shown.length - 1].key) : null };

  /* after a re-read the anchor row is where it was: scroll by what landed above it, before the frame is painted, and
     draw again at once so the rows for the new offset are there in the same frame */
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a || !el) return;
    const i = indexOf.get(a.key);
    const m = i == null ? undefined : v.measurementsCache[i];
    if (!m) return;
    const target = Math.max(0, m.start - a.at);
    ((window as unknown as { __anc: unknown[] }).__anc ??= []).push([Math.round(performance.now()), a.key.slice(3, 30), a.at, i, m.start, v.scrollOffset, target, el.scrollTop]); // DEBUG-ANC
    if (Math.abs(target - (v.scrollOffset ?? 0)) < 0.5) return;
    el.scrollTop = target;
    v.scrollOffset = el.scrollTop;
    redraw(n => n + 1);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  /* a new width rewraps every headline: the kept heights are stale, measure again (the drawn rows at once) */
  const widthSeen = useRef(width);
  useEffect(() => {
    if (widthSeen.current === width) return;
    widthSeen.current = width;
    v.measure();
    v.elementsCache.forEach(el => v.measureElement(el));
  }, [width, v]);

  /* the open story into view: on a pick, and once when a deep-linked story first lands in the rows */
  const shownRef = useRef<string | null>(null);
  useEffect(() => {
    if (openIdx < 0 || openKey == null || !el) return;
    const mark = `${openKey}|${String(reveal)}`;
    if (shownRef.current === mark) return;
    shownRef.current = mark;
    v.scrollToIndex(openIdx, { align: 'auto' });
  }, [openKey, openIdx >= 0, reveal, el]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the keys walk the stories: ↑ ↓ one, Page Up / Page Down a window, Home / End the ends; Enter opens (the row is a button) */
  const pendingFocus = useRef<number | null>(null);
  const tryFocus = () => {
    const n = pendingFocus.current;
    if (n == null) return;
    const row = el?.querySelector<HTMLElement>(`[data-index="${n}"]`)?.firstElementChild as HTMLElement | null;
    if (!row) return;
    pendingFocus.current = null;
    row.focus({ preventScroll: true });
  };
  useLayoutEffect(tryFocus);
  const onKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const wrap = (ev.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!wrap || wrap.parentElement !== ev.currentTarget) return;
    const i = Number(wrap.dataset.index);
    const n = itemsRef.current.length;
    const avg = v.getTotalSize() / Math.max(1, n);
    const page = Math.max(1, Math.floor(((v.scrollRect?.height ?? initialHeight) - head) / Math.max(1, avg)) - 1);
    const to = ev.key === 'ArrowDown' ? i + 1 : ev.key === 'ArrowUp' ? i - 1 : ev.key === 'PageDown' ? i + page : ev.key === 'PageUp' ? i - page : ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1 : null;
    if (to == null) return;
    ev.preventDefault();
    const t = Math.max(0, Math.min(n - 1, to));
    keepRef.current.focus = keyOf(itemsRef.current[t]);
    pendingFocus.current = t;
    v.scrollToIndex(t, { align: 'auto' });
    tryFocus();
  };
  const onFocus = (ev: FocusEvent<HTMLDivElement>) => {
    const wrap = (ev.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (wrap && wrap.parentElement === ev.currentTarget) keepRef.current.focus = keyOf(itemsRef.current[Number(wrap.dataset.index)]);
  };
  const onBlur = (ev: FocusEvent<HTMLDivElement>) => {
    if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) keepRef.current.focus = null;
  };

  return (
    <div ref={sizerRef} className={`relative w-full ${className}`} style={{ height: v.getTotalSize() }} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} data-news-window-rows={items.length}>
      {drawn.map(x => (
        <div key={x.key} data-index={x.index} ref={v.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${x.start - margin}px)` }}>
          {children(items[x.index], x.index)}
        </div>
      ))}
    </div>
  );
}
