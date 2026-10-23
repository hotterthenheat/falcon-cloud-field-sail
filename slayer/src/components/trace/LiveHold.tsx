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
import { marketPhase, type MarketPhase } from '../../data/traceLive';

/* THE BADGE SAYS THE SESSION (the re-audit, 2026-10-22: every page wore LIVE after the close while its prints were
   after-hours ones) — and it is a LABEL, not a button (the third audit: the "AFTER HOURS" badge was the pause button, so
   a reader who pressed it to see the session froze the feed). Pause is its own button beside it, worded as what it does.
   From 16:00 to 16:15 the stock options have closed and the index and ETF options have not — the badge says both. */
const PHASE_WORD: Record<MarketPhase, string> = { regular: 'Live', late: 'Stocks closed · index to 16:15', after: 'After hours', pre: 'Pre-market', closed: 'Closed' };
const PHASE_HINT: Record<MarketPhase, string> = {
  regular: 'The regular session is open',
  late: 'Stock options closed at 16:00; the index and ETF options (SPX, SPY, QQQ, IWM…) trade their regular session to 16:15',
  after: 'The regular session has closed — what prints now is after hours, against thin post-market quotes',
  pre: 'Before the bell — what prints now is pre-market',
  closed: 'The market is closed — the page shows the last session',
};
function usePhase(): MarketPhase {
  const [phase, setPhase] = useState<MarketPhase>(() => marketPhase());
  useEffect(() => {
    const id = window.setInterval(() => setPhase(marketPhase()), 30_000);
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
  /** Paused before the first read landed: the page keeps reading until it does, then holds there */
  waitingFirst: boolean;
}

/* PAUSED BEFORE THE FIRST READ NEVER FREEZES AN EMPTY PAGE (audit round 8, major 5): `ready` says the page's first read
   has landed. Pressed before it, the hold keeps following the feed until the read lands and holds THAT moment — the badge
   says so meanwhile ("paused · holds at the first read") — never a frozen "$0 · Nothing". */
export function useHold<T>(live: T, resetKey?: unknown, ready = true): Hold<T> {
  const [paused, setPaused] = useState(false);
  const [heldAt, setHeldAt] = useState<Date | null>(null);
  const held = useRef(live);
  const heldReady = useRef(ready);
  if (!paused || !heldReady.current) {
    held.current = live;
    heldReady.current = ready;
  }
  const waitingFirst = paused && !ready && !heldReady.current;

  // A new key (the active ticker) releases the hold.
  useEffect(() => {
    setPaused(false);
    setHeldAt(null);
  }, [resetKey]);
  /* the hold's moment is when the first read landed, if it was pressed before */
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (waitingFirst) wasWaiting.current = true;
    else if (paused && wasWaiting.current) {
      wasWaiting.current = false;
      setHeldAt(new Date());
    }
  }, [waitingFirst, paused]);

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    setHeldAt(next ? new Date() : null);
    if (!next) wasWaiting.current = false;
  };

  return { paused, toggle, value: paused ? held.current : live, heldAt, waitingFirst };
}

// 24-hour New York, like every clock on Trace ("14:03 ET"), never "02:03 PM" and never the machine's zone (core/nyTime).
const clock = (d: Date) => nyClock(d, { zone: true });

export const LiveHold = ({ paused, onToggle, heldAt, waitingFirst = false }: { paused: boolean; onToggle: () => void; heldAt?: Date | null; waitingFirst?: boolean }) => {
  const phase = usePhase();
  const live = phase === 'regular' || phase === 'late';
  return (
    <span className="inline-flex items-center gap-2 shrink-0" data-live-hold data-session-phase={phase}>
      {/* the session, as a word — never pressed */}
      <span
        role="status"
        title={PHASE_HINT[phase]}
        className={`inline-flex items-center gap-1.5 px-2 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider whitespace-nowrap ${live ? 'text-textPrimary' : 'text-textSecondary'}`}
        data-session-badge
      >
        {live && <span className="w-1.5 h-1.5 rounded-full bg-silver animate-live-breathe" aria-hidden />}
        {PHASE_WORD[phase]}
      </span>
      <button
        onClick={onToggle}
        aria-pressed={paused}
        title={paused ? 'Resume — the page follows the feed again' : 'Pause — hold the page; nothing moves under you until you resume'}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors ${
          paused
            ? 'border-warn/40 bg-warn/[0.06] text-warn hover:bg-warn/[0.1]'
            : /* the live signal's own form per theme (tokens.css --live-*) while the session runs */
              live
              ? 'tone-live hover:opacity-90'
              : 'border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary'
        }`}
        data-hold-button
      >
        {paused ? (
          <>
            <Play className="w-3 h-3" /> Resume
          </>
        ) : (
          <>
            <Pause className="w-3 h-3" /> Pause
          </>
        )}
      </button>
      {paused && waitingFirst && <span className="font-mono text-[11px] text-textMuted uppercase tracking-wider whitespace-nowrap" title="Paused before the first read landed — the page keeps reading until it does, then holds there">paused before the first read · holds when it lands</span>}
      {paused && !waitingFirst && heldAt && <span className="font-mono text-[11px] text-textMuted uppercase tracking-wider whitespace-nowrap tnum">paused · as of {clock(heldAt)}</span>}
    </span>
  );
};
