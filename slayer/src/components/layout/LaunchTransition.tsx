/*
==================================================
  SLAYER TERMINAL - LAUNCH TRANSITION
  One branded gate, for the door in: "Launch terminal",
  a product's open, the footer's jump, and a missing
  page's way to Pulse. A browser refresh does not play
  it. That wait is the bigger wordmark in index.html.
  Caret logo + a lime progress line over black, then
  the destination fades in beneath it. Fixed duration
  — when a real boot sequence exists it slots into
  the same hold.
==================================================
*/

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { EMBEDDED } from '../../embed';
import Wordmark from '../../brand/Wordmark';
import Signature from '../../brand/Signature';

interface LaunchCtxValue {
  /** Play the gate, then navigate (defaults to the terminal's front door). */
  launch: (to?: string) => void;
}

const LaunchCtx = createContext<LaunchCtxValue | null>(null);

export const useLaunch = (): LaunchCtxValue => {
  const ctx = useContext(LaunchCtx);
  if (!ctx) throw new Error('useLaunch must be used within LaunchProvider');
  return ctx;
};

/** Overlay fully visible while the bar fills… */
const HOLD_MS = 1050;
/** …then the destination mounts behind it before the fade-out starts. */
const REVEAL_MS = 300;

const captionFor = (path: string) => (path === '/' ? 'Loading' : 'Entering terminal');

/** The big wordmark in index.html covers a browser refresh. This gate is the door in, and nothing else: Launch terminal,
    a product's open, the footer's jump, a missing page's way to Pulse. A reload does not play it. The terminal drawn
    inside the landing's window never plays it either — the page outside already did. */
export const LaunchProvider = ({ children }: { children: ReactNode }) => {
  const [active, setActive] = useState(false);
  const [caption, setCaption] = useState(() => captionFor(window.location.pathname));
  const busyRef = useRef(false);
  const navigate = useNavigate();

  const launch = useCallback(
    (to: string = '/pulse') => {
      if (EMBEDDED) {
        navigate(to);
        return;
      }
      if (busyRef.current) return;
      busyRef.current = true;
      setCaption(captionFor(to));
      setActive(true);
      window.setTimeout(() => {
        navigate(to);
        window.setTimeout(() => {
          setActive(false);
          busyRef.current = false;
        }, REVEAL_MS);
      }, HOLD_MS);
    },
    [navigate]
  );

  return (
    <LaunchCtx.Provider value={{ launch }}>
      {children}
      <AnimatePresence>
        {active && (
          <motion.div
            key="launch-gate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[100] bg-canvas flex flex-col items-center justify-center gap-5"
            data-launch-gate
          >
            {/* HIS PARTNER'S LOGO SYSTEM (2026-10-03): the S| in its loading state (the foil at speed), the wordmark typing
                itself in at 28 ms a character, the bar, the signature. On the light page the bar goes to the ink (index.css —
                Noah, 2026-09-26: "the loading screen of slayer on light mode esp the bar needs to be more apparent"); the
                mark and the lit letters wear the galaxy ink there on their own. */}
            <Wordmark height={22} typing label="Slayer Terminal" />
            <div className="w-52 h-[2px] rounded-full bg-ink/[0.08] overflow-hidden" data-gate-track>
              {/* CSS transform fill (see .animate-gate-fill) — compositor-driven,
                  so it never stutters while the main thread loads chunks. */}
              <div className="h-full rounded-full holo-bar animate-gate-fill" />
            </div>
            <span className="sr-only">{caption}</span>
            <Signature rule={false} className="text-t105 select-none" />
          </motion.div>
        )}
      </AnimatePresence>
    </LaunchCtx.Provider>
  );
};
