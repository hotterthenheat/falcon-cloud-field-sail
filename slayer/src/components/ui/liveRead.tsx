import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';

/*
  Live figures. Digits keep one width, a print that moves flashes once,
  and a panel that has gone quiet says so beside its title — never by
  pasting a vendor's error sentence into a cell.
*/

/** A flow print (Unusual Whales) that has not printed in this long is stale. */
export const FLOW_TTL_MS = 20_000;
/** The full GEX book refreshes on a 45s clock. Stale means a refresh was missed. */
export const BOOK_TTL_MS = 90_000;
/** The board's own book refreshes on a 90s clock. */
export const BOARD_TTL_MS = 180_000;
/** A filing or a company file is not a quote. Stale means the last print is old, or the last ask failed. */
export const FILE_TTL_MS = 15 * 60 * 1000;

export type FeedFault = 'down' | 'failed';

/** A vendor sentence or the terminal_down code. Null when the text is safe to show. */
export function vendorFault(text: string | null | undefined): FeedFault | null {
  if (!text) return null;
  const s = text.toLowerCase();
  if (s.includes('terminal_down') || s.includes('not running') || s.includes('thetadata') || s.includes('theta terminal')) return 'down';
  if (s.includes('unusual whales') || s.includes('unreachable') || s.includes('failed to fetch')) return 'failed';
  return null;
}

/** What a cell may show. A vendor sentence becomes a dash. */
export function quietText(text: string): string {
  return vendorFault(text) ? '—' : text;
}

function isStale(at: number | null | undefined, ttlMs: number, now = Date.now()): boolean {
  if (at == null || !(at > 0)) return false;
  return now - at > ttlMs;
}

export function useTickFlash(value: number | null | undefined): { dir: '' | 'up' | 'down'; gen: number } {
  const prev = useRef<number | null | undefined>(undefined);
  const [tick, setTick] = useState<{ dir: '' | 'up' | 'down'; gen: number }>({ dir: '', gen: 0 });
  useEffect(() => {
    const last = prev.current;
    prev.current = value;
    if (last == null || value == null || !Number.isFinite(last) || !Number.isFinite(value) || last === value) return;
    setTick(t => ({ dir: value > last ? 'up' : 'down', gen: t.gen + 1 }));
  }, [value]);
  return tick;
}

/** A number that does not jog its column, and flashes for 500ms when it moves. */
export function TickFigure({ value, className = '', title, children }: { value: number | null | undefined; className?: string; title?: string; children: ReactNode }) {
  const flash = useTickFlash(value);
  const ink = flash.dir === 'up' ? 'tick-up' : flash.dir === 'down' ? 'tick-down' : '';
  return (
    <span key={flash.gen} title={title} className={`tabular-nums rounded-sm ${ink} ${className}`} data-tick={flash.dir || undefined}>
      {children}
    </span>
  );
}

/** Amber mark beside a title. Nothing, while the last print is inside its window. */
export function StaleMark({ at, ttlMs, fault = null }: { at?: number | null; ttlMs: number; fault?: FeedFault | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(n => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const stale = fault != null || isStale(at, ttlMs);
  if (!stale) return null;
  const down = fault === 'down';
  const label = down ? 'Quote desk is down' : 'Stale data';
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-t9 uppercase tracking-widest text-warn"
      title={down ? 'The quote desk did not answer. The last print stays up.' : 'This panel has not had a fresh print inside its window.'}
      data-stale={down ? 'down' : 'stale'}
    >
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-warn" />
      {label}
    </span>
  );
}

/** The name that was on the desk before this one. Stays on the page. */
export const LeaveRead = () => {
  const { previousTicker, revertTicker } = useTicker();
  if (!previousTicker) return null;
  return (
    <button
      type="button"
      onClick={revertTicker}
      className="slayer-chip uppercase tracking-widest text-t10"
      data-read-back={previousTicker}
    >
      <ArrowLeft className="w-3 h-3" /> {previousTicker}
    </button>
  );
};

/** The block a panel shows instead of a vendor sentence. */
export function FeedFallback({ fault = 'failed' }: { fault?: FeedFault | null }) {
  const down = fault === 'down';
  return (
    <div className="px-5 py-4 flex flex-col items-start gap-3" role="status" data-feed-fallback={down ? 'down' : 'empty'}>
      <p className="font-mono text-t10 uppercase tracking-widest text-textMuted">
        {down ? 'Quote desk is down' : 'This read did not land'}
      </p>
      <LeaveRead />
    </div>
  );
}
