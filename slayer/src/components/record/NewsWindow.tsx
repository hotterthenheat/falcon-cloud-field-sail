/* A window of news rows that draws only the rows near its view. A day of the wire is well over a thousand stories of
   different heights; drawing them all cost ~25,000 nodes and a slow pick. The rows are measured as they draw (so a
   two-line headline takes its real height), the open story and the focused row stay drawn, the open story is kept in
   view, and the arrow keys walk the stories. The window scrolls itself only, never the page. Rows that land above the
   first row in view on a re-read (the same view, a fresh read) leave that row where it stands: the window scrolls by
   what was inserted, so nothing the reader sees moves. */

import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ArrowUp } from 'lucide-react';
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
  /** the list is still being read back (more pages are coming) */
  reading?: boolean;
  /** the reader has acted on the list from outside the window (a pick on the map or the tape, a deep link) */
  interacted?: boolean;
  /** the read finished with the reader not having touched the list, and the window went to the top */
  onTop?: () => void;
  /** written on every draw: the first and last rows in view */
  seen?: MutableRefObject<WindowSeen>;
  /** classes for the box the rows stand in (a minimum width, say) */
  className?: string;
  children: (t: T, index: number) => ReactNode;
}

/** rows drawn past each edge of the view, so a Tab or an arrow always finds the next row drawn */
const OVERSCAN = 8;
/** frames a re-read's anchor is held while the rows drawn above it settle (about 1.5 s; the reader's own scroll ends it) */
const HOLD_FRAMES = 90;

export default function NewsWindow<T>({ box, items, keyOf, estimate, head, initialHeight, openKey = null, reveal, above, view, seen, reading = false, interacted = false, onTop, className = '', children }: Props<T>) {
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
  /* the held anchor's correction, while a re-read's rows settle (below) */
  const holding = useRef<(() => unknown) | null>(null);
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
    /* a row measured while a re-read's anchor is held: put the anchor back before this frame is painted */
    onChange: () => holding.current?.(),
  });

  /* the view the rows were last drawn under: a change of items under the same one is a re-read */
  const inView = useRef<{ view: unknown }>({ view });
  const hold = useRef<() => void>(() => {});
  const anchor = useRef<{ key: string; at: number } | null>(null);
  const keysSeen = useRef<Set<string>>(new Set(indexOf.keys()));
  const landedAbove = useRef(0);
  const [newAbove, setNewAbove] = useState(0);
  const itemsSeen = useRef(items);
  if (itemsSeen.current !== items) {
    itemsSeen.current = items;
    /* a new read ends the last one's hold before anything of it is drawn */
    hold.current();
    /* The first row on screen that is still on the list holds its place; a new view starts where it is told to. Where it
       stands is read off the page as the reader sees it now (the old rows are still drawn), not from the virtualizer's
       sums, which run a step behind while it settles a measurement. */
    anchor.current = null;
    if (inView.current.view === view && el) {
      const boxTop = el.getBoundingClientRect().top;
      let best: { key: string; at: number } | null = null;
      v.elementsCache.forEach((node, key) => {
        const k = String(key);
        if (!node.isConnected || !indexOf.has(k)) return;
        const r = node.getBoundingClientRect();
        if (r.bottom > boxTop + head + 1 && r.height > 0 && (!best || r.top - boxTop < best.at)) best = { key: k, at: r.top - boxTop };
      });
      anchor.current = best;
      /* the stories new to the list that land above the anchor: what the "new above" pill counts */
      const at = best ? indexOf.get((best as { key: string }).key) : undefined;
      let n = 0;
      if (at != null) for (let i = 0; i < at; i++) if (!keysSeen.current.has(keyOf(items[i]))) n++;
      landedAbove.current = n;
    }
    keysSeen.current = new Set(indexOf.keys());
  }
  const off = v.scrollOffset ?? 0;
  const tall = v.scrollRect?.height ?? initialHeight;
  const drawn = v.getVirtualItems();
  const shown = drawn.filter(x => x.end > off + head + 1 && x.start < off + tall - 1);
  inView.current = { view };
  if (seen) seen.current = { first: shown.length ? String(shown[0].key) : null, last: shown.length ? String(shown[shown.length - 1].key) : null };

  /* After a re-read the anchor row is where it was: scroll by what landed above it, before the frame is painted, and
     draw again at once so the rows for the new offset are there in the same frame. The rows just drawn above it are
     measured over the next frames, so for about a second and a half the row is held at its place from where it really stands on the
     screen — until the reader scrolls, which ends the hold. */
  const [, redraw] = useState(0);
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const landed = landedAbove.current;
    landedAbove.current = 0;
    if (!a || !el) return;
    if (landed > 0) setNewAbove(n => n + landed);
    const i = indexOf.get(a.key);
    const m = i == null ? undefined : v.measurementsCache[i];
    if (!m) return;
    hold.current();
    /* where the row really stands is the truth (rows drawn in this same commit may already have been measured) */
    const correct = () => {
      const row = v.elementsCache.get(a.key);
      if (!row?.isConnected) return false;
      const off = row.getBoundingClientRect().top - el.getBoundingClientRect().top - a.at;
      if (Math.abs(off) >= 1) {
        el.scrollTop += off;
        v.scrollOffset = el.scrollTop;
      }
      return true;
    };
    if (!correct()) {
      const target = Math.max(0, m.start - a.at);
      if (Math.abs(target - (v.scrollOffset ?? 0)) >= 0.5) {
        el.scrollTop = target;
        v.scrollOffset = el.scrollTop;
      }
    }
    redraw(n => n + 1);
    let frames = 0;
    let raf = 0;
    const stop = () => {
      cancelAnimationFrame(raf);
      for (const t of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) el.removeEventListener(t, stop);
      holding.current = null;
      hold.current = () => {};
    };
    const tick = () => {
      correct();
      if (++frames < HOLD_FRAMES) raf = requestAnimationFrame(tick);
      else stop();
    };
    holding.current = correct;
    for (const t of ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const) el.addEventListener(t, stop, { passive: true });
    hold.current = stop;
    raf = requestAnimationFrame(tick);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => hold.current(), []);

  /* The reader's own touch on the list (a wheel, a finger, a press, a key in it). Until then, and while the wire is still
     read back, the rows hold still; when the read ends the window goes to the top in one step, so the reader sees the
     newest and most important stories first. After a touch the rows stay where the reader put them, and what lands
     above them is counted in the pill. */
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!el || touched) return;
    const on = () => setTouched(true);
    const kinds = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const t of kinds) el.addEventListener(t, on, { passive: true });
    return () => {
      for (const t of kinds) el.removeEventListener(t, on);
    };
  }, [el, touched]);
  const untouched = !touched && !interacted;
  const toTop = () => {
    if (!el) return;
    hold.current();
    el.scrollTop = 0;
    v.scrollOffset = 0;
    setNewAbove(0);
    redraw(n => n + 1);
  };
  const wasReading = useRef(reading);
  useEffect(() => {
    const was = wasReading.current;
    wasReading.current = reading;
    if (!was || reading || !el || !untouched) return;
    toTop();
    onTop?.();
  }, [reading]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the pill clears at the top, and with a new view */
  const atTop = (v.scrollOffset ?? 0) <= 1;
  useEffect(() => {
    if (atTop && newAbove) setNewAbove(0);
  }, [atTop, newAbove]);
  const viewSeen = useRef(view);
  useEffect(() => {
    if (viewSeen.current === view) return;
    viewSeen.current = view;
    setNewAbove(0);
  }, [view]);
  const showPill = newAbove > 0 && !atTop && !(reading && untouched);
  /* every commit while a hold is on (a redraw for the new offset, a row measured and redrawn) */
  useLayoutEffect(() => {
    holding.current?.();
  });

  /* Every row is measured before the frame that first shows it is painted. The virtualizer measures a row as it
     mounts, but skips that while it thinks the window is scrolling (a re-read's hold scrolls it) and leaves the row to
     its resize observer a frame later — a frame painted at the estimate, a two-line headline over the row under it.
     A row this window has not read yet is read here, in the same commit, and the virtualizer redraws at once. */
  const sizedRef = useRef(new WeakMap<Element, number>());
  useLayoutEffect(() => {
    const sized = sizedRef.current;
    v.elementsCache.forEach(node => {
      if (!node.isConnected || sized.has(node)) return;
      const i = v.indexFromElement(node);
      if (!(i >= 0 && i < itemsRef.current.length)) return;
      const h = node.getBoundingClientRect().height;
      if (!(h > 0)) return;
      sized.set(node, h);
      const at = v.measurementsCache[i];
      if (!at || Math.abs(at.size - h) >= 0.5) v.resizeItem(i, Math.round(h));
    });
  });

  /* a new width rewraps every headline: the kept heights are stale, measure again (the drawn rows at once, before the
     rewrapped rows are painted over each other) */
  const widthSeen = useRef(width);
  useLayoutEffect(() => {
    if (widthSeen.current === width) return;
    widthSeen.current = width;
    sizedRef.current = new WeakMap();
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
    <>
      {/* the pill rides at the top of the window, under the pinned head; it takes no height, so the rows do not move */}
      {showPill && (
        <div className="sticky z-20 h-0 w-full" style={{ top: head }}>
          <button
            type="button"
            onClick={toTop}
            className="tap-40 absolute left-1/2 -translate-x-1/2 top-2 inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-borderMuted bg-panel/95 backdrop-blur shadow-lg shadow-black/40 font-mono text-t11 text-textPrimary hover:border-silver/50 transition-colors whitespace-nowrap"
            data-news-new-above={newAbove}
          >
            {newAbove.toLocaleString('en-US')} new {newAbove === 1 ? 'story' : 'stories'} above
            <ArrowUp className="w-3 h-3" aria-hidden />
          </button>
        </div>
      )}
    <div ref={sizerRef} className={`relative w-full ${className}`} style={{ height: v.getTotalSize() }} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} data-news-window-rows={items.length}>
      {drawn.map(x => (
        <div key={x.key} data-index={x.index} ref={v.measureElement} className="absolute left-0 top-0 w-full" style={{ transform: `translateY(${x.start - margin}px)` }}>
          {children(items[x.index], x.index)}
        </div>
      ))}
    </div>
    </>
  );
}
