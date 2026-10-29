import { sessionBars } from './levelview';
import { levelFlip, regimeOfNet } from './flipLevel';
import { recordDay, sessionBook } from './bookWindow';
import type { Candle, MarketSnapshot } from '../types/market';
import { nyIsoDate, nyMinutes } from '../core/nyTime';

/* Which side of the flip the market is on, how far, and how often it was crossed today, as a header strip.
   The rule is core/walls.ts pickFlip; no flip is a real state (null), never spot. */

export type GammaRegime = 'SHORT' | 'LONG';

interface FlipGauge {
  spot: number;
  /** Null when the field never changes sign — a one-sided book has no flip. */
  flip: number | null;
  /** Which side of the flip spot sits — the regime. Null with no flip. */
  regime: GammaRegime | null;
  /** Signed distance, flip − spot: positive = the flip is overhead. */
  distAbs: number | null;
  /** The same distance as a percent of spot. */
  distPct: number | null;
  /** Times price crossed the (per-bar) flip today. Null when the history is
      too thin to say — "0" is a measurement and this state is not. */
  crossings: number | null;
  /** How many bars the count was read from, so a caller can qualify it. */
  bars: number;
}

/* A session has to be at least this old before "crossed 0× today" is a
   measurement rather than an absence of data. Two bars can cross at most
   once; ten minutes is the floor where a zero starts meaning something. */
const GAUGE_MIN_BARS = 10;

/* Ten minutes of the session, not ten bars (a 5-minute name would wait fifty minutes). */
const coveredMinutes = (bars: readonly Candle[]): number => {
  if (!bars.length) return 0;
  const step = bars.length >= 2 ? Math.max(60, bars[1].time - bars[0].time) : 60;
  return (bars[bars.length - 1].time - bars[0].time + step) / 60;
};
const tooEarly = (bars: readonly Candle[]): boolean => coveredMinutes(bars) < GAUGE_MIN_BARS;

/** Times price crossed the flip, one definition for the Board and the Map: a one-minute close on the other side from the last close
    not on it. A close exactly on the flip changes nothing. The Map's report counts tests beside this. */
export function flipCrossings(bars: readonly Candle[], flip: number): number {
  /* Counted at the printed flip (to the cent), so a recount matches the page. */
  const level = Math.round(flip * 100) / 100;
  let side = 0;
  let n = 0;
  for (const b of bars) {
    const s = Math.sign(Math.round(b.close * 100) / 100 - level);
    if (s === 0) continue;
    if (side !== 0 && s !== side) n++;
    side = s;
  }
  return n;
}

export function buildFlipGauge(snapshot: MarketSnapshot): FlipGauge {
  const { ticker, spot, chain } = snapshot;
  /* The one flip (data/flipLevel.ts) off the snapshot's levels chain; the regime is the sign of net gamma at spot, never the side of the flip. */
  const read = levelFlip(snapshot, chain);
  const flip = read.flip;
  const base: FlipGauge = {
    spot,
    flip,
    regime: regimeOfNet(read.netAtSpot),
    distAbs: flip === null ? null : flip - spot,
    distPct: flip === null || spot === 0 ? null : ((flip - spot) / spot) * 100,
    crossings: null,
    bars: 0,
  };

  /* Crossed today is the Map's count: the same flip, cash-session bars and test rule (levelRecord levelTicks). */
  const candles = sessionBars(ticker) ?? [];
  if (flip === null || tooEarly(candles)) return { ...base, bars: candles.length };
  return { ...base, crossings: flipCrossings(candles, flip), bars: candles.length };
}

/** Today's session against the flip of the book it ran on (bookWindow sessionBook); null with `why` when that book is gone. */
interface SessionCrossings {
  crossings: number | null;
  flip: number | null;
  label: string;
  why: string | null;
  /** False while the count's flip is provisional (its contracts' own vols not all in) — the count is then not shown */
  complete: boolean;
  /** The session is under ten minutes old — no count yet, and the cell says when it starts rather than a bare dash */
  early?: boolean;
}

/* A finished session's count is frozen: once it closes, its flip is read once at the session's close and the answer kept,
   so after-hours prints do not move it. */
const frozenCross = new Map<string, SessionCrossings>();

export function sessionFlipCrossings(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): SessionCrossings {
  const candles = sessionBars(snapshot.ticker) ?? [];
  const last = candles[candles.length - 1];
  /* Before today's open the count is the last session's (recordDay), against the book live then, named by its date. */
  const today = recordDay().date;
  const barDay = last ? nyIsoDate(last.time * 1000) : null;
  const sb = sessionBook(snapshot, scope);
  const key = `${snapshot.ticker}|${scope}|${barDay ?? today}`;
  if (sb.after) {
    const hit = frozenCross.get(key);
    if (hit) return hit;
  }
  if (!sb.book) return { crossings: null, flip: null, label: sb.label, why: sb.why, complete: true };
  /* after the bell the session book is already priced at the session's own close (data/bookWindow.ts frozenAtClose) */
  const closed = sb.after && !!last;
  const book = sb.book;
  const read = levelFlip(book, book.chain);
  let out: SessionCrossings;
  /* A stand-in book is never final and never frozen. */
  if (sb.provisional) return { crossings: null, flip: read.flip, label: sb.label, why: null, complete: false, early: tooEarly(candles) };
  if (read.flip === null) out = { crossings: !tooEarly(candles) ? 0 : null, flip: null, label: sb.label, why: null, complete: read.complete, early: tooEarly(candles) };
  else if (tooEarly(candles)) out = { crossings: null, flip: read.flip, label: sb.label, why: null, complete: read.complete, early: true };
  /* the side rule the Map's report uses (WallReportCard: flip ≥ spot is tested from below) */
  /* closes changing side of the flip, on one-minute bars (flipCrossings) — the Map's flip row prints the same count */
  else out = { crossings: flipCrossings(candles, read.flip), flip: read.flip, label: sb.label, why: null, complete: read.complete };
  /* kept once the whole session is in (its last bar at 15:55 or later) and the book's dates have all landed */
  if (closed && read.complete && nyMinutes(last.time * 1000) >= 15 * 60 + 55) {
    if (frozenCross.size > 200) frozenCross.clear();
    frozenCross.set(key, out);
  }
  return out;
}

/** The words the strip prints for a regime — one place, so the strip and its
    accessible name cannot drift apart. */
export const REGIME_WORDS: Record<GammaRegime, { label: string; blurb: string }> = {
  SHORT: { label: 'SHORT GAMMA', blurb: 'net gamma is negative here — dealer hedging amplifies moves' },
  LONG: { label: 'LONG GAMMA', blurb: 'net gamma is positive here — dealer hedging absorbs moves' },
};

/* The flip by expiry: 0DTE, weekly and the whole book, each off its own windowed profile (buildExposureProfile, as the map draws that lens);
   their disagreement is the read. The spread is book − 0DTE, null unless both exist. */

