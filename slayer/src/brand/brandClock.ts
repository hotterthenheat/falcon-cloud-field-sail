/* Every infinite brand loop is pinned to the document timeline (startTime 0) so marks mounted at different moments move in step.
   One-shot and paused animations are left alone. */

/** The brand loops, by keyframe name (index.css). */
const BRAND_LOOPS = new Set(['sm-pan', 'sm-blink']);

const isBrandLoop = (a: Animation): a is CSSAnimation =>
  typeof CSSAnimation !== 'undefined' &&
  a instanceof CSSAnimation &&
  BRAND_LOOPS.has(a.animationName) &&
  a.effect?.getComputedTiming().iterations === Infinity;

const pin = (a: Animation): void => {
  if (!isBrandLoop(a) || a.playState === 'paused') return;
  if (a.startTime !== 0) a.startTime = 0;
};

/** Pin every brand loop inside an element, and the element's own, to the page clock. */
export function alignBrandLoops(root: Element | null | undefined): void {
  if (!root || typeof root.getAnimations !== 'function') return;
  root.getAnimations({ subtree: true }).forEach(pin);
}

/* pins a brand loop that starts outside a brand component, or restarts after being hidden, on its first frame */
let listening = false;
function listenForBrandLoops(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'animationstart',
    e => {
      if (!BRAND_LOOPS.has(e.animationName) || !(e.target instanceof Element)) return;
      e.target.getAnimations().forEach(pin);
    },
    true
  );
}
listenForBrandLoops();
