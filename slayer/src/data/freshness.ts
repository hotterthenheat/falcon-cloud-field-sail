/* How old a reading may be before a page calls it stale, per source, and the one state every box wears for it: live,
   stale, reconnecting or not yet read. Pure: no clock of its own (the caller passes `now`), no DOM, so the status page,
   the banner, the boxes and scripts/surfaces-proof.ts read the same rule.

   A threshold is a few of the source's own refresh beats, so one late answer is not "stale" and a stopped feed is.
   With no stock session moving (a night, a weekend, a holiday: core/session.ts) the feeds slow their polling and the
   prices stand still, so the same source gets a longer window. */

import { phaseAt } from '../core/session';

/** Where a reading came from. Words for each live in SOURCE_WORDS; no vendor is ever named. */
export type FreshSource =
  /** live stock, index and option prices from the market data terminal (polled every few seconds) */
  | 'quotes'
  /** the options flow tape and the flow reads (a print is reused for ~2.5 s, the page asks every few seconds) */
  | 'flow'
  /** the dealer book, the exposure and the levels (the proxy keeps them 15 s; the desks re-read every 45 s) */
  | 'book'
  /** the Compass board and record (read every 5 s in a session, every minute outside one) */
  | 'compass'
  /** a filing, a company file, the news wire (refreshed in minutes, not seconds) */
  | 'record';

export type FreshState = 'live' | 'stale' | 'reconnecting' | 'unknown';

/** [while a session moves, while none does], ms */
export const STALE_MS: Record<FreshSource, readonly [number, number]> = {
  quotes: [45_000, 10 * 60_000],
  flow: [90_000, 20 * 60_000],
  book: [180_000, 30 * 60_000],
  compass: [30_000, 3 * 60_000],
  record: [15 * 60_000, 60 * 60_000],
};

/** The neutral words a user reads for each source (copy/feeds.ts's rule: no vendor named). */
export const SOURCE_WORDS: Record<FreshSource, string> = {
  quotes: 'Live quotes',
  flow: 'Options flow',
  book: 'Dealer book',
  compass: 'Compass',
  record: 'The record',
};

/** A stock session is moving: pre-market, the regular session or after hours. */
export const sessionMoving = (now: number): boolean => {
  const ph = phaseAt(now);
  return ph === 'pre' || ph === 'regular' || ph === 'post';
};

/** The window a reading from `source` stays fresh at `now`. */
export function staleAfter(source: FreshSource, now: number, moving: boolean = sessionMoving(now)): number {
  const [open, closed] = STALE_MS[source];
  return moving ? open : closed;
}

export interface Freshness {
  state: FreshState;
  /** ms since the reading was taken, or null before any */
  ageMs: number | null;
  /** the window that applied */
  ttlMs: number;
}

export interface FreshInput {
  /** When the reading on screen was taken (epoch ms); null or 0 before any */
  at: number | null | undefined;
  source: FreshSource;
  now: number;
  /** The feed says it is down and is trying again (a breaker open, a kept copy on screen) */
  down?: boolean;
  /** Override the session test (the proof pins it) */
  moving?: boolean;
}

/** The one rule: down is reconnecting, whatever the age; no reading is unknown; older than the window is stale. */
export function freshnessOf({ at, source, now, down = false, moving }: FreshInput): Freshness {
  const ttlMs = staleAfter(source, now, moving ?? sessionMoving(now));
  const has = at != null && at > 0;
  const ageMs = has ? Math.max(0, now - (at as number)) : null;
  if (down) return { state: 'reconnecting', ageMs, ttlMs };
  if (!has) return { state: 'unknown', ageMs, ttlMs };
  return { state: (ageMs as number) > ttlMs ? 'stale' : 'live', ageMs, ttlMs };
}

/** "12 s", "4 min", "2 h", "3 d": an age said short */
export function ageWords(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}
