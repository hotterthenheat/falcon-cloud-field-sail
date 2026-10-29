/* While the sidebar's 300 ms width glide runs, the costly surfaces (charts, ladders) hold their size and resize once at the end;
   the DOM around them reflows as before. 'frame' is the sidebar glide, 'snap' a desk item's settle after a drop or resize. */

type GlideKind = 'frame' | 'snap';

/** Where the frame is going: the sidebar states the main column's final width at the start, so a surface can lay out for it and ride the glide. */
interface GlideTarget {
  mainWidth: number;
}

let gliding = false;
let endTimer = 0;
let target: GlideTarget | null = null;
const starters = new Set<() => void>();
const enders = new Set<() => void>();
const once = new Set<() => void>();

/** The frame's destination for the glide under way, when the starter said it */
export const glideTarget = (): GlideTarget | null => target;

/** A glide has begun; it ends on `endGlide`, or after `maxMs` if nobody reports the end */
export function beginGlide(maxMs = 450, kind: GlideKind = 'frame', to: GlideTarget | null = null): void {
  window.clearTimeout(endTimer);
  if (!gliding) {
    gliding = true;
    target = to;
    document.documentElement.setAttribute('data-glide', kind);
    starters.forEach(fn => fn());
  }
  /* A transition that never reports its end (a tab hidden mid-glide, a
     reduced-motion setting skipping it) must not hold the charts for good */
  endTimer = window.setTimeout(endGlide, maxMs);
}

/** A host that knows its end width declares it (`data-tile-width`); a surface sizes for that at the start. Null with no promise: hold and resize once. */
export function promisedWidth(el: HTMLElement): number | null {
  const host = el.closest<HTMLElement>('[data-tile-width]');
  if (!host) return null;
  const to = Number(host.dataset.tileWidth);
  if (!Number.isFinite(to) || to <= 0) return null;
  const insets = host.getBoundingClientRect().width - el.getBoundingClientRect().width;
  return Math.max(0, Math.round(to - insets));
}

export function endGlide(): void {
  window.clearTimeout(endTimer);
  if (!gliding) return;
  gliding = false;
  target = null;
  document.documentElement.removeAttribute('data-glide');
  const run = [...once];
  once.clear();
  run.forEach(fn => fn());
  enders.forEach(fn => fn());
}

/** Called at the start and the end of every glide; returns the unsubscribe */
export function onGlide(start: () => void, end: () => void): () => void {
  starters.add(start);
  enders.add(end);
  return () => {
    starters.delete(start);
    enders.delete(end);
  };
}

/** Run now — or, mid-glide, once when it ends (the same function is queued once) */
export function afterGlide(fn: () => void): void {
  if (!gliding) fn();
  else once.add(fn);
}
