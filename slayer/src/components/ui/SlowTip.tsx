import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

/*
==================================================
  SLAYER TERMINAL - THE HOVER WORD (components/ui/SlowTip.tsx)

  The ticker bar's triggers are their icons alone; the word comes on hover (Noah, 2026-10-31, openmarket's row: "many
  things dont have words and words only appear as a slow hover on that icon which should be the case for us"). The
  browser's own title does that in the operating system's dress; this is the house's, and since the same evening it is
  OPENMARKET'S HOVER EXACTLY (Noah: "i want the hover to have the exact hover openmarket has"), sampled frame by frame
  on theirs (scratchpad om-hover.mjs):

    · NO DELAY — the word is there on the first frame after the pointer lands (their Quasar tooltip's default);
    · it ENTERS over 300ms, fading in while it drops 15px into place (their jump-down: opacity .3s, transform .3s on
      cubic-bezier(.25,.8,.5,1), from translateY(-15px));
    · it LEAVES over 300ms, fading out while it drops 15px further (jump-down-leave-to: translateY(15px));
    · the NEXT icon's word waits for the old one's leave — moving along the row, the new word arrives ~300ms after the
      old one began to go, never two words at once;
    · the button's own colour and ground change over 150ms (theirs: color .15s, background .15s) — the triggers' own
      `transition-colors`, not this file's.

  8px under the trigger, centred, 11px medium in a small bordered card. The 350ms/700ms waits of the first two cuts are
  gone (Noah: "there is still a delay i notice").

  Wraps ONE trigger in an inline-flex span (no layout change in a flex row); the card is a portal at the body so no
  clipping ancestor can cut it, clamped inside the window. Focus shows it too, for the keyboard.
==================================================
*/

const DELAY_MS = 0;
const GAP_PX = 8;
const EDGE_PX = 8;
/** theirs: .3s in and out */
const MOVE_S = 0.3;
const RISE_PX = 15;
const EASE: [number, number, number, number] = [0.25, 0.8, 0.5, 1];

/* ONE WORD AT A TIME across every trigger: when a word starts to leave, the next one waits out that leave — theirs
   shows the words in sequence, never two at once (measured: the next word 318ms after the pointer moved on) */
let leavingUntil = 0;

const SlowTip = ({ label, children, delay = DELAY_MS }: { label: string; children: ReactNode; delay?: number }) => {
  const host = useRef<HTMLSpanElement | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | null>(null);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const place = () => {
    const r = host.current?.getBoundingClientRect();
    if (r && r.width > 0) setAt({ x: r.left + r.width / 2, y: r.bottom + GAP_PX });
  };
  const show = () => {
    clear();
    const wait = Math.max(delay, leavingUntil - performance.now());
    if (wait <= 0) {
      place();
      return;
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      place();
    }, wait);
  };
  const hide = () => {
    clear();
    if (at) leavingUntil = performance.now() + MOVE_S * 1000;
    setAt(null);
  };
  useEffect(() => clear, []);

  /* keep the card inside the window: measured once it exists, nudged off either edge */
  useLayoutEffect(() => {
    if (!at || !card.current) return;
    const w = card.current.offsetWidth;
    const min = EDGE_PX + w / 2;
    const max = window.innerWidth - EDGE_PX - w / 2;
    const x = Math.min(Math.max(at.x, min), max);
    if (x !== at.x) setAt({ x, y: at.y });
  }, [at]);

  return (
    <span
      ref={host}
      className="inline-flex shrink-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onMouseDown={hide}
      /* the keyboard's focus shows the word; a click's focus does not — the press hid it a frame before, and theirs
         does not bring it back */
      onFocus={e => { if (e.target.matches(':focus-visible')) show(); }}
      onBlur={hide}
      data-slow-tip-host
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {at && (
            <motion.div
              ref={card}
              role="tooltip"
              data-slow-tip
              style={{ position: 'fixed', left: at.x, top: at.y, x: '-50%' }}
              initial={{ opacity: 0, y: -RISE_PX }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: RISE_PX }}
              transition={{ duration: MOVE_S, ease: EASE }}
              className="z-[130] pointer-events-none whitespace-nowrap px-2.5 py-1.5 rounded-md border border-borderMuted bg-panel text-t11 font-medium leading-[1.45] text-textSecondary shadow-lg shadow-black/40"
            >
              {label}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </span>
  );
};

export default SlowTip;
