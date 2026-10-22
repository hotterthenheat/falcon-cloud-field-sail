/*
==================================================
  SLAYER TERMINAL - LIVE / PAUSED (one hold for every Trace page)

  The tape had the only pause on Trace. Every other
  flow page re-ranks its book once a real minute
  and every in-depth card moves on the 1.5s tick —
  silently, with no way to stop it (Noah,
  2026-08-30: "go build it, one shared live/paused
  for all of them").
==================================================

  THE HOLD. useHold(live) hands back `live` while playing and the LAST value
  it saw while paused. A page passes the whole snapshot it renders from —
  { book, tick } — so rows, facts, read, pills and any open card freeze on
  the SAME moment; nothing derived can drift. A ticker change releases the
  hold: an old book must never wear a new name.

  THE BUTTON. The tape's exact control — LIVE breathes lime (the house's one
  "this is live" signal), PAUSED holds amber — plus one honesty rule: a held
  page says "as of HH:MM" beside the button, so a frozen table can never
  pass for a live one.
*/

import { useEffect, useRef, useState } from 'react';
import { nyClock } from '../../core/nyTime';
import { Pause, Play } from 'lucide-react';
import { sessionPhase, type SessionPhase } from '../../data/traceLive';

/* THE BADGE SAYS THE SESSION (the re-audit, 2026-10-22: every page wore LIVE after the close while its prints were
   after-hours ones): Live in the regular session; After hours, Pre-market or Closed outside it — the page still follows
   the vendor, the word says what kind of tape that is */
const PHASE_WORD: Record<SessionPhase, string> = { regular: 'Live', after: 'After hours', pre: 'Pre-market', closed: 'Closed' };
const PHASE_HINT: Record<SessionPhase, string> = {
  regular: 'The regular session is open',
  after: 'The regular session has closed — what prints now is after hours, against thin post-market quotes',
  pre: 'Before the bell — what prints now is pre-market',
  closed: 'The market is closed — the page shows the last session',
};
function usePhase(): SessionPhase {
  const [phase, setPhase] = useState<SessionPhase>(() => sessionPhase());
  useEffect(() => {
    const id = window.setInterval(() => setPhase(sessionPhase()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return phase;
}

export interface Hold<T> {
  paused: boolean;
  toggle: () => void;
  /** `live` while playing; the last live value while paused */
  value: T;
  /** When the hold began — null while live */
  heldAt: Date | null;
}

export function useHold<T>(live: T, resetKey?: unknown): Hold<T> {
  const [paused, setPaused] = useState(false);
  const [heldAt, setHeldAt] = useState<Date | null>(null);
  const held = useRef(live);
  if (!paused) held.current = live;

  // A new key (the active ticker) releases the hold.
  useEffect(() => {
    setPaused(false);
    setHeldAt(null);
  }, [resetKey]);

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    setHeldAt(next ? new Date() : null);
  };

  return { paused, toggle, value: paused ? held.current : live, heldAt };
}

// 24-hour New York, like every clock on Trace ("14:03 ET"), never "02:03 PM" and never the machine's zone (core/nyTime).
const clock = (d: Date) => nyClock(d, { zone: true });

export const LiveHold = ({ paused, onToggle, heldAt }: { paused: boolean; onToggle: () => void; heldAt?: Date | null }) => {
  const phase = usePhase();
  return (
  <span className="inline-flex items-center gap-2 shrink-0" data-live-hold data-session-phase={phase}>
    <button
      onClick={onToggle}
      aria-pressed={paused}
      title={paused ? 'Resume — the page follows the book again' : `${PHASE_HINT[phase]} · hold the page — nothing moves under you until you resume`}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
        paused
          ? 'border-warn/40 bg-warn/[0.06] text-warn hover:bg-warn/[0.1]'
          : /* the live signal's own form per theme: a silver glow on the dark terminal, a silver highlighter on paper (tokens.css --live-*) */
            /* the breath is the mark's, not the button's: the whole button falling to 0.3 read as DISABLED on whichever
               page a glance caught it at its low (the audit, 2026-10-22) */
            phase === 'regular'
            ? 'tone-live hover:opacity-90'
            : 'border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary'
      }`}
    >
      {paused ? (
        <>
          <Play className="w-3 h-3" /> Paused
        </>
      ) : (
        <>
          <Pause className={`w-3 h-3 ${phase === 'regular' ? 'animate-live-breathe' : ''}`} /> {PHASE_WORD[phase]}
        </>
      )}
    </button>
    {paused && heldAt && (
      <span className="font-mono text-[11px] text-textMuted uppercase tracking-wider whitespace-nowrap tnum">as of {clock(heldAt)}</span>
    )}
  </span>
  );
};
