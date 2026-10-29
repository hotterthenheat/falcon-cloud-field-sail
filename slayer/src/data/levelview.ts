/* What a focused strike is doing today: how far price is, whether it was tested this session, and whether its gamma is building since the open. */

import { SESSION_CLOSE_MIN, SESSION_OPEN_MIN, nyClock, nyIsoDate, nyMinutes } from '../core/nyTime';
import { recordDay } from './bookWindow';
import { bookCandles, bookHistory, peekEntry, peekSpot } from './uwBook';
import type { MarketSnapshot } from '../types/market';

/** NONE: no book was kept at the open or now — nothing to compare */
type GexTrend = 'BUILDING' | 'BLEEDING' | 'FLAT' | 'NEW' | 'NONE';

interface LevelRead {
  /** Signed distance from live spot, percent (+ above) */
  distPct: number;
  /** Times price has tested the level this session — a test is a contiguous
      run of bars whose range contains the strike */
  touches: number;
  /** HH:MM of the last bar that touched it, or null if untested */
  lastTouch: string | null;
  /** |net GEX| at the strike now vs at the session open, percent change */
  changePct: number | null;
  trend: GexTrend;
}

/** Under ±15% since the open the gamma at a level is neither building nor bleeding. */
const TREND_THRESHOLD = 15;

/** A bar's time, New York's clock — the market's day, whatever zone the machine is in */
const fmtTime = (t: number) => nyClock(t * 1000);

/** The live session's bars (sessionCut), shared with the Wall Report Card so every grade reads the same session cut. */
export function sessionBars(ticker: string) {
  const live = bookCandles(ticker);
  /* A live vendor book answers for this name. One bar, or none, is not a
     session yet — the counts wait (uwBook candlesFrom). The simulator's tape
     is not today's, and it is not drawn in the book's place. */
  if (live) {
    if (live.length > 1) {
      const day = recordDay().date;
      const own = live.filter(b => nyIsoDate(b.time * 1000) === day);
      return own.length > 1 ? own : [];
    }
    return [];
  }
  return null;
}

/** True when a bar's minute is inside the cash session */
export const inCashSession = (t: number): boolean => {
  const m = nyMinutes(t * 1000);
  return m >= SESSION_OPEN_MIN && m < SESSION_CLOSE_MIN;
};

/** Per strike, net gamma at the open over net gamma now: under 1 built, over 1 bled, negative flipped. Null until two snapshots exist. */
export function netSinceOpenRatio(ticker: string): Map<number, number> | null {
  /* Not on the vendor's book: its minute history walks volume onto open interest, and OI is counted once overnight, so no since-open change is claimed. */
  if (peekEntry(ticker)) return null;
  const session = sessionBars(ticker);
  if (!session) return null;
  const snaps = bookHistory(ticker) ?? [];
  const first = snaps.find(s => s.time >= session[0].time);
  const last = snaps[snaps.length - 1];
  if (!first || !last || first === last) return null;
  const open = new Map(first.levels.map(l => [l.strike, l.value]));
  const out = new Map<number, number>();
  for (const l of last.levels) {
    const o = open.get(l.strike);
    if (o == null || Math.abs(l.value) < 1e-9) continue;
    out.set(l.strike, o / l.value);
  }
  return out;
}

/** The book as it stood at the open: the session's first GEX snapshot's OI by strike and the first bar's price. Null on the vendor's book
    (it has no opening book of its own) and until a snapshot exists. */
export function snapshotAtOpen(ticker: string): MarketSnapshot | null {
  /* the vendor's book has no opening book of its own (see netSinceOpenRatio) — and the simulator's chain is not this name's */
  if (peekEntry(ticker)) return null;
  const session = sessionBars(ticker);
  if (!session) return null;
  const snaps = bookHistory(ticker) ?? [];
  const first = snaps.find(s => s.time >= session[0].time);
  if (!first) return null;
  const book = new Map<number, { callOI: number; putOI: number }>();
  for (const l of first.levels) if (l.callOI != null && l.putOI != null) book.set(l.strike, { callOI: l.callOI, putOI: l.putOI });
  if (!book.size) return null;
  /* no live opening chain can be rebuilt from the vendor's book, so nothing is invented here */
  return null;
}

/* The since-open read, one rule for every card: side flipped → words only; now ≥ 20× the open → "new since the open";
   over 3× → the multiple; else the percent (−99 … +200) with the ±15% word. Never a raw percent of nothing. */
interface SinceOpenRead {
  /** The figure as printed — "+37%", "-12%", "4.2×" — or null when only the words apply */
  figure: string | null;
  /** Which way: 1 building, −1 bleeding, 0 flat or flipped */
  dir: 1 | -1 | 0;
  /** The full sentence ("gamma building", "new since the open") */
  text: string;
  /** The same in one or two words for a narrow cell ("building", "new today") */
  short: string;
}

/** `ratio` is the open's net over now's (`netSinceOpenRatio`). Null when there is nothing to compare. */
export function sinceOpenRead(ratio: number | null | undefined): SinceOpenRead | null {
  if (ratio == null || !Number.isFinite(ratio)) return null;
  if (ratio < 0) return { figure: null, dir: 0, text: 'flipped sides since the open', short: 'flipped sides' };
  if (ratio < 0.05) return { figure: null, dir: 1, text: 'new since the open', short: 'new today' };
  const times = 1 / ratio;
  if (times > 3) return { figure: `${times.toFixed(1)}×`, dir: 1, text: 'gamma building', short: 'building' };
  const pct = Math.max(-99, (times - 1) * 100);
  const dir: 1 | -1 | 0 = pct >= TREND_THRESHOLD ? 1 : pct <= -TREND_THRESHOLD ? -1 : 0;
  const whole = Math.round(pct) || 0;
  return {
    /* the true minus, as every other negative on the page prints it */
    figure: `${whole > 0 ? '+' : whole < 0 ? '−' : ''}${Math.abs(whole).toLocaleString('en-US')}%`,
    dir,
    text: dir === 1 ? 'gamma building' : dir === -1 ? 'gamma bleeding' : 'about where it opened',
    short: dir === 1 ? 'building' : dir === -1 ? 'bleeding' : 'about flat',
  };
}

export function buildLevelRead(ticker: string, strike: number): LevelRead | null {
  const session = sessionBars(ticker);
  if (!session || session.length === 0) return null;

  let touches = 0;
  let lastTouch: number | null = null;
  let inTouch = false;
  for (const b of session) {
    const hit = b.low <= strike && strike <= b.high;
    if (hit && !inTouch) touches++;
    if (hit) lastTouch = b.time;
    inTouch = hit;
  }

  const spot = peekSpot(ticker) ?? session[session.length - 1].close;
  const distPct = ((strike - spot) / spot) * 100;

  /* the vendor's minute history is volume walked onto open interest — no since-the-open claim off it (see above) */
  const snaps: { time: number; levels: { strike: number; value: number }[] }[] = [];
  const at = (s: { levels: { strike: number; value: number }[] }) => s.levels.find(l => l.strike === strike)?.value ?? null;
  const first = snaps.find(s => s.time >= session[0].time);
  const last = snaps[snaps.length - 1];
  const gexOpen = first ? at(first) : null;
  const gexNow = last ? at(last) : null;

  let changePct: number | null = null;
  let trend: GexTrend = !first || !last ? 'NONE' : 'NEW';
  if (gexOpen != null && gexNow != null && Math.abs(gexOpen) > 0) {
    changePct = ((Math.abs(gexNow) - Math.abs(gexOpen)) / Math.abs(gexOpen)) * 100;
    trend = changePct >= TREND_THRESHOLD ? 'BUILDING' : changePct <= -TREND_THRESHOLD ? 'BLEEDING' : 'FLAT';
  }

  return { distPct, touches, lastTouch: lastTouch != null ? fmtTime(lastTouch) : null, changePct, trend };
}
