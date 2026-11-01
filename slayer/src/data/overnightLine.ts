/* THE OVERNIGHT SPX LINE in the browser: one shared read of the GTH night (server/terrainApi.mjs /api/terrain/overnight,
   the same answer for every pane and viewer) and the price it implies at each 5-minute stamp.

   SPX does not print overnight; its options do. At each stamp the nearest SPXW expiry's put-call parity forward is the
   median of the 3–4 strikes nearest the money with valid quotes (core/parity.ts parityForward on the stamp's pairs),
   and the price is that forward discounted to spot at the real rate (data/rateFeed.ts): S = F·e^{−rT}, T the calendar
   time from the stamp to the expiry's close. It is a price read off the options, never a cash print, and the chart says
   so. Polled every 15 s while the night is open, every 5 minutes otherwise, every 3 s while the server is still reading
   it; only while an SPX, SPXW or XSP pane is on screen. */

import { parityForward, type ParityPair } from '../core/parity';
import { calendarYears } from '../core/volClock';
import { feedMoving, windowAt } from '../core/session';
import { makeStores } from './chainFeed';
import type { NightPair } from '../../shared/overnight.mjs';

export interface OvernightRead {
  v: number;
  at: number;
  root?: string;
  night?: { from: number; to: number; live: boolean };
  /** The nearest SPXW expiry: the session day the night leads into */
  expiry?: string;
  live?: boolean;
  /** [ms, pairs around the money] every 5 minutes */
  bars?: [number, NightPair[]][];
  /** [ms, VIX close] from about 03:15 */
  vix?: [number, number][];
  pending?: boolean;
  error?: string | null;
}

/** The panes that draw the line, and the scale each draws it at (XSP is a tenth of SPX) */
export const OVERNIGHT_SCALE: Record<string, number> = { SPX: 1, SPXW: 1, XSP: 0.1 };
export const drawsOvernight = (ticker: string | null | undefined): boolean => !!ticker && ticker.toUpperCase() in OVERNIGHT_SCALE;

const NIGHT = 'night';
const useNightStore = makeStores<OvernightRead>(
  () => '/api/terrain/overnight',
  s => (s.read.data?.pending ? 3_000 : s.read.error && !s.read.data ? 60_000 : s.read.data?.live || feedMoving(Date.now(), 'SPXW') ? 15_000 : 300_000)
);
/** The night, shared by every pane that draws it (none asks for a name that does not draw it) */
export const useOvernight = (ticker: string | null | undefined) => useNightStore(drawsOvernight(ticker) ? NIGHT : null, k => k);

export interface NightPoint {
  ms: number;
  /** The price the options imply, discounted to spot */
  spot: number;
  /** The parity forward and how many strikes it is the median of, and their spread */
  F: number;
  n: number;
  spread: number;
}

/** One stamp's implied price, or null when fewer than three strikes give a valid parity */
export function nightPoint(ms: number, pairs: readonly NightPair[], expiry: string, r: number): NightPoint | null {
  const t = calendarYears(expiry, ms);
  if (!(t > 0) || pairs.length < 3) return null;
  const grow = Math.exp(r * t);
  /* the money is where the call and put mids are closest: the forward first guessed there */
  let atm: NightPair | null = null;
  for (const p of pairs) if (!atm || Math.abs(p[1] + p[2] - p[3] - p[4]) < Math.abs(atm[1] + atm[2] - atm[3] - atm[4])) atm = p;
  if (!atm) return null;
  const guess = (atm[0] + grow * ((atm[1] + atm[2]) / 2 - (atm[3] + atm[4]) / 2)) / grow;
  const book: ParityPair[] = pairs.map(p => ({ strike: p[0], callBid: p[1], callAsk: p[2], putBid: p[3], putAsk: p[4] }));
  const fwd = parityForward(book, guess, r, t, 4);
  if (!fwd) return null;
  return { ms, spot: fwd.F / grow, F: fwd.F, n: fwd.n, spread: fwd.hi - fwd.lo };
}

/** The whole night's line, oldest first */
export function nightLine(read: OvernightRead | null | undefined, r: number): NightPoint[] {
  if (!read?.bars || !read.expiry) return [];
  const out: NightPoint[] = [];
  for (const [ms, pairs] of read.bars) {
    const p = nightPoint(ms, pairs, read.expiry, r);
    if (p) out.push(p);
  }
  return out;
}

/** The VIX's latest print at or before `ms` (it prints from about 03:15), or null */
export function vixAt(read: OvernightRead | null | undefined, ms: number): { ms: number; value: number } | null {
  let best: [number, number] | null = null;
  for (const b of read?.vix ?? []) if (b[0] <= ms && (!best || b[0] > best[0])) best = b;
  return best ? { ms: best[0], value: best[1] } : null;
}

/** The stock tape's overnight window at `ms`: the one open now (to now), else the latest that has closed (within five days) */
export function stockNight(ms: number): { from: number; to: number; live: boolean } | null {
  const open = windowAt(ms, 'equity');
  if (open?.kind === 'overnight') return { from: open.from, to: ms, live: true };
  for (let h = 1; h <= 120; h++) {
    const w = windowAt(ms - h * 3_600_000, 'equity');
    if (w?.kind === 'overnight') return { from: w.from, to: w.to, live: false };
  }
  return null;
}

/** The night's slots at a chart's bar step: the last point in each step, stamped at the step's start */
export function stepPoints(points: readonly { ms: number; value?: number }[], stepSec: number): { time: number; value?: number }[] {
  const out: { time: number; value?: number }[] = [];
  for (const p of points) {
    const time = Math.floor(p.ms / 1000 / stepSec) * stepSec;
    const lastOut = out[out.length - 1];
    if (lastOut && lastOut.time === time) lastOut.value = p.value;
    else out.push({ time, value: p.value });
  }
  return out;
}
