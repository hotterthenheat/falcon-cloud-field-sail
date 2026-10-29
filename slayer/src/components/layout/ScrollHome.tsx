/* <main> is the scroller and browsers do not restore it, so this does: forward navigation opens at the top; history navigation
   restores the position per location key for up to 2 s while the page fills, dropped once the reader scrolls. */

import { useLayoutEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const positions = new Map<string, number>();
let currentKey = '';
let recording = false;

const scroller = () => document.querySelector<HTMLElement>('main');

/** One listener for the life of the app: where the reader is, per location */
function ensureRecorder(): void {
  if (recording) return;
  const el = scroller();
  if (!el) return;
  recording = true;
  el.addEventListener(
    'scroll',
    () => {
      if (currentKey) positions.set(currentKey, el.scrollTop);
    },
    { passive: true }
  );
}

const ScrollHome = () => {
  const location = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    const el = scroller();
    if (!el) return;
    ensureRecorder();
    currentKey = location.key;
    const target = type === 'POP' ? (positions.get(location.key) ?? 0) : 0;
    el.scrollTop = target;
    if (target === 0) return;
    /* The page may still be filling in: keep the old position on it until
       it holds, for up to ~2s, unless the reader takes the scroll themselves */
    const until = performance.now() + 2000;
    let held = 0;
    let stop = false;
    const release = () => {
      stop = true;
    };
    const INPUTS: (keyof WindowEventMap)[] = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
    INPUTS.forEach(ev => window.addEventListener(ev, release, { passive: true, once: true }));
    const again = () => {
      if (stop || performance.now() > until) return;
      const max = el.scrollHeight - el.clientHeight;
      if (max >= target && Math.abs(el.scrollTop - target) > 1) el.scrollTop = target;
      held = Math.abs(el.scrollTop - target) <= 1 ? held + 1 : 0;
      if (held < 3) requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
    return () => {
      stop = true;
      INPUTS.forEach(ev => window.removeEventListener(ev, release));
    };
    // On mount only — the wrapper this sits in is keyed by the route, so a
    // navigation this instance answers for remounts it (see the file's head)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};

export default ScrollHome;
