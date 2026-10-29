import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { placeMenu, type MenuBox, type MenuSide } from './menuPlacement';

/* The React half of menuPlacement.ts: a trigger ref and a fixed box kept current while open, shared by every portalled menu. */

/** A fixed box for a menu anchored to `anchorRef`, recomputed while open. `placed` is null until measured, so
    nothing paints at the origin for a frame. */
/** How many times one open menu may re-place itself on a wider reading. */
const MAX_WIDTH_PASSES = 2;

export function useAnchoredMenu<T extends HTMLElement, M extends HTMLElement = HTMLDivElement>(
  open: boolean,
  menuSide: MenuSide = 'bottom',
  /** The menu's width, so its far edge stays on screen; omitted, it is measured (or MENU_MIN_WIDTH). */
  menuWidth?: number,
  /** Which edges meet; see placeMenu's `align`. */
  align: 'start' | 'end' = 'end',
  /** The box the menu stays inside (its pane); read at every placement, so a moving pane is followed. */
  bounds?: RefObject<HTMLElement | null>
) {
  const anchorRef = useRef<T | null>(null);
  const [placed, setPlaced] = useState<{ box: MenuBox; side: MenuSide } | null>(null);

  /* The menu's measured width when the caller cannot name it: the widest seen while open, since a scrollbar leaving
     can widen it after the first frame. */
  const [measured, setMeasured] = useState<number | null>(null);
  /* growth steps allowed during this open (capped at the re-read below) */
  const passes = useRef(0);
  const width = menuWidth ?? measured ?? undefined;

  const measure = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const frame = bounds?.current?.getBoundingClientRect();
    setPlaced(placeMenu(el.getBoundingClientRect(), menuSide, window.innerWidth, window.innerHeight, width, align, frame && frame.width > 0 ? frame : undefined));
  }, [menuSide, width, align, bounds]);

  /** Put this on the menu element itself when the width is not passed in. */
  const menuRef = useRef<M | null>(null);

  /* a layout effect, so the menu never paints one frame at its previous position */
  useLayoutEffect(() => {
    if (!open) {
      setPlaced(null);
      setMeasured(null); // the next open re-measures its own content
      passes.current = 0;
      return;
    }
    measure();
  }, [open, measure]);

  /* re-read the width after every placement: a ref callback only ever sees the first layout */
  useLayoutEffect(() => {
    if (!open || menuWidth != null) return;
    const el = menuRef.current;
    if (!el) return;
    const w = Math.round(el.getBoundingClientRect().width);
    if (w > 0) {
      setMeasured(prev => {
        if (prev != null && w <= prev) return prev;
        /* Capped at two growths: a fluid, right-anchored menu can widen on every pass forever (React's update-depth
           error). Two passes cover the real correction; past that the widest seen stands. */
        if (passes.current >= MAX_WIDTH_PASSES) return prev;
        passes.current += 1;
        return w;
      });
    }
  }, [open, placed, menuWidth]);

  useEffect(() => {
    if (!open) return;
    /* capture: a scroll in any ancestor moves the menu with its trigger */
    const onMove = () => measure();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, measure]);

  return { anchorRef, placed, menuRef };
}
