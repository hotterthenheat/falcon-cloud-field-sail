/* One live/paused hold for every Trace page. useHold(live) returns `live` while playing and the last value it saw while
   paused, so everything a page derives from it freezes on the same moment; a new reset key (the ticker) lets go. */

import { useEffect, useRef, useState } from 'react';
import { nyClock } from '../../core/nyTime';
import { Pause, Play } from 'lucide-react';
import { heldFresh, lastRegularClose, marketPhase, noteTraceHold, type MarketPhase } from '../../data/traceLive';
import { FLOW_TTL_MS, StaleMark } from '../ui/liveRead';
import type { FeedFault } from '../ui/liveRead';
import { useResolvedTheme } from '../../theme/theme';
import { shortDay } from './dayWords';

/* the badge is a label, never the pause button */
const PHASE_WORD: Record<MarketPhase, string> = { regular: 'Live', late: 'Stocks closed · index to 16:15', after: 'After hours', pre: 'Pre-market', closed: 'Closed' };
const PHASE_HINT: Record<MarketPhase, string> = {
  regular: 'The regular session is open',
  late: 'Stock options closed at 16:00 ET; index and ETF options trade to 16:15 ET',
  after: 'The session has closed; prints now are after hours, against thin quotes',
  pre: 'Before the bell; prints now are pre-market',
  closed: 'The market is closed; the page shows the last session',
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

/** `ready`: the page's first read has landed — a pause pressed before it holds at that read, never at an empty page */
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
  /* a hold that has its moment stops the shared reads too (traceLive noteTraceHold) */
  const holding = paused && !waitingFirst;
  useEffect(() => {
    if (!holding) return;
    noteTraceHold(true);
    return () => noteTraceHold(false);
  }, [holding]);

  useEffect(() => {
    setPaused(false);
    setHeldAt(null);
  }, [resetKey]);
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

const clock = (d: Date) => nyClock(d, { zone: true });

/** A read's freshness: "Closed · Oct 28" once the session it reads has ended (a held day read never goes stale), else the
    usual stale mark; hidden while the page is paused */
export const SessionMark = ({ at, fault, paused = false, ttlMs = FLOW_TTL_MS }: { at: number | null; fault: FeedFault | null; paused?: boolean; ttlMs?: number }) => {
  const closed = !fault && heldFresh(at) ? lastRegularClose() : null;
  /* outside the session reads poll slowly (traceLive readDue), so a 20s age is not stale there */
  const ph = marketPhase();
  const ttl = ph === 'regular' || ph === 'late' ? ttlMs : Math.max(ttlMs, ph === 'pre' ? 150_000 : 45_000);
  if (closed)
    return (
      <span className="inline-flex items-center gap-1 font-mono text-t9 uppercase tracking-widest text-textMuted" title={`The ${shortDay(closed.iso)} session has closed; its figures no longer change`} data-stale="closed">
        <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-textMuted" />
        Closed · {shortDay(closed.iso)}
      </span>
    );
  return (
    <span className={paused ? 'invisible' : undefined} aria-hidden={paused || undefined}>
      <StaleMark at={at} ttlMs={ttl} fault={fault} />
    </span>
  );
};

export const LiveHold = ({ paused, onToggle, heldAt, waitingFirst = false }: { paused: boolean; onToggle: () => void; heldAt?: Date | null; waitingFirst?: boolean }) => {
  const phase = usePhase();
  const paper = useResolvedTheme() === 'light';
  const live = phase === 'regular' || phase === 'late';
  return (
    <span className="inline-flex items-center gap-2 shrink-0" data-live-hold data-session-phase={phase}>
      <span
        role="status"
        title={PHASE_HINT[phase]}
        className={`inline-flex items-center gap-1.5 px-2 py-1.5 font-mono text-t11 font-semibold uppercase tracking-wider whitespace-nowrap ${live ? 'text-textPrimary' : 'text-textSecondary'}`}
        data-session-badge
      >
        {live && <span className="w-1.5 h-1.5 rounded-full bg-silver animate-live-breathe" aria-hidden />}
        {PHASE_WORD[phase]}
      </span>
      <button
        onClick={onToggle}
        aria-pressed={paused}
        title={paused ? (waitingFirst ? 'Paused — holds at the first read' : heldAt ? `Held as of ${clock(heldAt)} — resume to follow the feed` : 'Resume — follow the feed again') : 'Pause — hold the page until you resume'}
        className={`inline-grid place-items-center px-3 py-1.5 rounded-md border font-mono text-t11 font-semibold uppercase tracking-wider transition-colors ${
          paused ? 'border-warn/40 bg-warn/[0.06] text-warn hover:bg-warn/[0.1]' : paper ? 'galaxy-bg border-transparent' : 'holo-bg text-onfoil border-transparent hover:opacity-90'
        }`}
        data-hold-button
      >
        {/* the wider label always sits in the box, invisible, so Pause and Resume share one width */}
        <span className="invisible col-start-1 row-start-1 inline-flex items-center gap-1.5 whitespace-nowrap" aria-hidden>
          <Play className="w-3 h-3" /> Resume · 00:00 ET
        </span>
        <span className="col-start-1 row-start-1 inline-flex items-center gap-1.5 whitespace-nowrap">
          {paused ? (
            <>
              <Play className="w-3 h-3" /> {waitingFirst ? 'Holds' : heldAt ? `Resume · ${clock(heldAt)}` : 'Resume'}
            </>
          ) : (
            <>
              <Pause className="w-3 h-3" /> Pause
            </>
          )}
        </span>
      </button>
    </span>
  );
};
