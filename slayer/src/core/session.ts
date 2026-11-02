/* THE SESSION THE WHOLE SITE FOLLOWS. The rule itself is shared/marketSession.mjs (the server's hub reads the same file):
   overnight 20:00–04:00 (Sunday 20:00 opens the week; Friday 20:00 → Sunday 20:00 is closed; the evening before a full
   holiday is closed), pre-market 04:00–09:30, regular 09:30–16:00 (13:00 on an early close), after hours 16:00–20:00
   (13:00–17:00 on an early close). Equity options trade the regular session only (index ETFs to 16:15); index options
   (SPX, XSP, VIX, RUT) trade Global Trading Hours 20:15–09:25 and the curb 16:15–17:00 too.

   This module adds the words every page prints for it and one hook, useMarketSession, that re-renders only when the
   phase turns. Read the session here — never off a bare clock range. */

import { useSyncExternalStore } from 'react';
import {
  nextChangeAt,
  windowAt,
  nyWall,
  phaseAt,
  productOf,
  sessionAt,
  type MarketSessionAt,
  type Phase,
  type Product,
  type WindowKind,
} from '../../shared/marketSession.mjs';

export {
  addDays,
  feedMoving,
  gthHoliday,
  inRegular,
  isEarlyCloseDay,
  isHolidayDay,
  isSessionDay,
  nextChangeAt,
  nextSessionDay,
  nextWindow,
  nyInstant,
  nyWall,
  phaseAt,
  postCloseMin,
  productOf,
  regularCloseMin,
  sessionAt,
  sessionDayAtOrBefore,
  windowAt,
  worldSessionsBetween,
  zoneInstant,
  equityWindowsOn,
  tradingDayOf,
  WORLD_SESSIONS,
  GTH_ROOTS,
  INDEX_SYMBOLS,
  LATE_ETFS,
} from '../../shared/marketSession.mjs';
export type { MarketSessionAt, Phase, Product, WindowKind, SessionWindow, WorldSession, WorldSessionKey } from '../../shared/marketSession.mjs';

/** The regular session's open, minutes of the New York day (09:30) — the rule itself is shared/marketSession.mjs */
export const REGULAR_OPEN_MIN = 9 * 60 + 30;
/** A full day's regular close (16:00). A date's own close is regularCloseMin(iso): 13:00 on an early close. Read the
    session through this module — a bare 9*60+30, 16*60, 570 or 960 elsewhere fails scripts/session-literal-proof.ts */
export const REGULAR_CLOSE_MIN = 16 * 60;

/** The phase's name as the site prints it */
export const PHASE_LABEL: Record<Phase, string> = {
  overnight: 'Overnight',
  pre: 'Pre-market',
  regular: 'Regular',
  post: 'After hours',
  closed: 'Closed',
};

/** The short tag a price outside the regular session carries */
export type SessionTag = 'ON' | 'PM' | 'AH';
export const PHASE_TAG: Record<Phase, SessionTag | null> = { overnight: 'ON', pre: 'PM', regular: null, post: 'AH', closed: null };

/** The words an extended print is named by (data/dayChange.ts extWord) */
export type ExtWord = 'overnight' | 'pre-market' | 'after hours';
export const EXT_TAG: Record<ExtWord, SessionTag> = { overnight: 'ON', 'pre-market': 'PM', 'after hours': 'AH' };
/** "ON" / "PM" / "AH" for an extended word (after hours when unknown) */
export const extTag = (w: string | null | undefined): SessionTag => (w === 'overnight' ? 'ON' : w === 'pre-market' ? 'PM' : 'AH');
/** A print belongs to the session trading now: a session is open and the print was made inside that same window. A
    weekend's Friday print, the after-hours last trade shown overnight (the overnight venues are not on the feed), or a
    thin name that has not printed yet this session are not current — they are shown "as of" their time. */
export function printIsCurrent(printMs: number, nowMs = Date.now()): boolean {
  if (!(printMs > 0)) return false;
  const w = windowAt(nowMs, 'equity');
  if (!w) return false;
  return printMs >= w.from && printMs < w.to + 60_000;
}

/** The phase a print at `ms` was made in, as an extended word (null for a regular-session print) */
export function extWordAt(ms: number): ExtWord | null {
  const ph = phaseAt(ms);
  if (ph === 'overnight') return 'overnight';
  if (ph === 'pre') return 'pre-market';
  if (ph === 'regular') return null;
  /* a print stamped in the closed gap (17:00–20:00 after an early close, or a late report) is after hours */
  return 'after hours';
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KIND_WORD: Record<WindowKind, string> = { overnight: 'overnight', pre: 'pre-market', regular: 'regular session', post: 'after hours', gth: 'global trading hours', curb: 'curb' };

/** "8:00 PM ET" — New York's clock, twelve-hour, as the session lines say it */
export function etTime12(ms: number): string {
  const m = nyWall(ms).min;
  const h = Math.floor(m / 60);
  return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} ET`;
}
/** "Sun 8:00 PM ET", "8:00 PM ET" today, "Mon Nov 30 8:00 PM ET" beyond a week */
export function whenWords(at: number, from = Date.now()): string {
  const a = nyWall(at);
  const f = nyWall(from);
  const days = Math.round((Date.parse(`${a.iso}T00:00:00Z`) - Date.parse(`${f.iso}T00:00:00Z`)) / 86_400_000);
  const time = etTime12(at);
  if (days === 0) return time;
  if (days > 0 && days < 7) return `${DOW[a.weekday]} ${time}`;
  return `${DOW[a.weekday]} ${MON[Number(a.iso.slice(5, 7)) - 1]} ${Number(a.iso.slice(8, 10))} ${time}`;
}

/** "overnight opens Sun 8:00 PM ET" — the next opening of a product's session, or null when it is open */
export function nextOpenLine(s: MarketSessionAt): string | null {
  if (s.open || !s.next) return null;
  return `${KIND_WORD[s.next.kind]} opens ${whenWords(s.next.at, s.at)}`;
}

/** The rail's badge: "Overnight · open", "Pre-market · live", "Regular · live", "After hours · live",
    "Closed · overnight opens Sun 8:00 PM ET" */
export function sessionBadge(s: MarketSessionAt = sessionAt(Date.now())): string {
  /* Overnight is open, but neither stock feed carries overnight prints, so the badge says the session is open,
     never that the data is live (index options' overnight quotes speak for themselves where they show) */
  if (s.phase === 'overnight') return `${PHASE_LABEL[s.phase]} · open`;
  if (s.phase !== 'closed') return `${PHASE_LABEL[s.phase]} · live`;
  const next = s.nextPhase;
  return next ? `Closed · ${KIND_WORD[next.kind]} opens ${whenWords(next.at, s.at)}` : 'Closed';
}

/** The product's trading hours, in words, for a line that says why a quote is not moving */
export function productHours(product: Product, earlyClose = false): string {
  if (product === 'equityOption') return earlyClose ? 'options trade 9:30 AM–1:00 PM ET today' : 'options trade 9:30 AM–4:00 PM ET';
  if (product === 'etfOption') return earlyClose ? 'options trade 9:30 AM–1:15 PM ET today' : 'options trade 9:30 AM–4:15 PM ET';
  if (product === 'extEtfOption') return earlyClose ? 'options trade 7:30–9:25 AM and 9:30 AM–1:15 PM ET today' : 'options trade 7:30–9:25 AM and 9:30 AM–4:15 PM ET';
  if (product === 'extEquityOption') return earlyClose ? 'options trade 7:30–9:25 AM and 9:30 AM–1:15 PM ET today' : 'options trade 7:30–9:25 AM and 9:30 AM–4:15 PM ET';
  if (product === 'indexOption') return 'index options trade 8:15 PM–9:25 AM, 9:30 AM–4:15 PM and 4:15–5:00 PM ET';
  return 'stocks trade 8:00 PM–4:00 AM overnight, 4:00 AM–8:00 PM ET';
}

/** A symbol's options product (SPX → index options, SPY → ETF options, NVDA → equity options) */
export const optionProductOf = (symbol: string): Product => productOf(symbol, true);

/* ---- the hook: one timer for the page, set to the next turn of the phase ---- */

type Snap = { key: string; at: MarketSessionAt };
const snaps = new Map<Product, Snap>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function keyOf(s: MarketSessionAt): string {
  return `${s.phase}|${s.open ? 1 : 0}|${s.window?.kind ?? ''}|${s.tradingDay}|${s.next?.at ?? ''}|${s.nextPhase?.at ?? ''}`;
}

function read(product: Product): MarketSessionAt {
  const now = Date.now();
  const hit = snaps.get(product);
  const at = sessionAt(now, product);
  const key = keyOf(at);
  if (hit && hit.key === key) return hit.at;
  snaps.set(product, { key, at });
  return at;
}

function tick(): void {
  timer = null;
  let moved = false;
  for (const [product, snap] of snaps) {
    const at = sessionAt(Date.now(), product);
    if (keyOf(at) !== snap.key) {
      snaps.set(product, { key: keyOf(at), at });
      moved = true;
    }
  }
  if (moved) listeners.forEach(fn => fn());
  arm();
}

function arm(): void {
  if (timer != null || listeners.size === 0 || typeof window === 'undefined') return;
  /* the next turn of the global phase, a breath after it; never longer than 30 s (a product's own window, a sleeping
     laptop, a faked clock) */
  const now = Date.now();
  const wait = Math.max(250, Math.min(30_000, nextChangeAt(now) - now + 250));
  timer = setTimeout(tick, wait);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  arm();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}

/** The session now, for `product` (the stock tape by default); re-renders when the phase, the product's window or the
    trading day turns */
export function useMarketSession(product: Product = 'equity'): MarketSessionAt {
  return useSyncExternalStore(
    subscribe,
    () => read(product),
    () => read(product),
  );
}

/** The global phase now, re-rendering when it turns */
export const useMarketPhase = (): Phase => useMarketSession().phase;

/** The session now, outside React */
export const marketSessionNow = (product: Product = 'equity'): MarketSessionAt => sessionAt(Date.now(), product);
