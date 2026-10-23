import { pickFlip } from '../core/walls';
import { buildExposureProfile } from './exposure';
import { sessionBars } from './levelview';
import { levelFlip, regimeOfNet } from './flipLevel';
import { levelTicks } from './levelRecord';
import { recordDay, sessionBook } from './bookWindow';
import type { Candle, GexSnapshot, MarketSnapshot } from '../types/market';
import { nyIsoDate, nyMinutes } from '../core/nyTime';

/*
==================================================
  SLAYER TERMINAL - FLIP PROXIMITY (data/flipGauge.ts)

  The most-consulted number on a dealer desk, as a
  header strip rather than a chart read — P-4.
==================================================

  WHAT IT ANSWERS. Which side of the gamma flip the market is on, how far the
  flip is, and how many times it has been crossed today. Every Pinpoint desk
  already draws the flip; none of them ANSWER it — the reader takes it off a
  chart, every time, on the page whose whole subject is dealer positioning.

  THE REGIME FOLLOWS THE HOUSE'S OWN SIGN CONVENTION, read from where spot
  sits against the flip, not from the aggregate sign. exposure.ts states the
  spatial fact this encodes: "Above the flip dealers dampen the tape; below it
  they chase it." Above = call-dominant side = dealers LONG gamma = moves
  absorbed. Below = put-dominant side = dealers SHORT gamma = moves amplified.
  The aggregate (netGex > 0) answers a different question — which side
  OUTWEIGHS — and the two disagree precisely when spot is near the flip, which
  is when this strip matters most.

  CROSSINGS ARE COUNTED AGAINST EACH BAR'S OWN FLIP, not today's flip laid
  over the whole session. The flip MIGRATES — that is the entire premise of
  the Vanna & Charm page — so "crossed 2× today" has to mean price crossed
  the line as it stood at the time, or a morning flip five points away turns
  into crossings that never happened.

  NO FLIP IS A REAL STATE, carried as null and rendered as such. A one-sided
  book has no crossing; a gauge that silently substituted spot would read as
  "the flip is exactly at the market", which is the opposite claim. The rule
  itself is core/walls.ts's `pickFlip` — the ONE copy, which this file is the
  fifth reader of and the reason it stopped being written inline.
*/

export type GammaRegime = 'SHORT' | 'LONG';

export interface FlipGauge {
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

/* One RTH session of 1-minute bars — the simulator's own session shape. */
const SESSION_BARS = 390;

/* A session has to be at least this old before "crossed 0× today" is a
   measurement rather than an absence of data. Two bars can cross at most
   once; ten minutes is the floor where a zero starts meaning something. */
export const GAUGE_MIN_BARS = 10;

/* TEN MINUTES, NOT TEN BARS (the eighth audit's m1: the Board's names read 5-minute bars, so ten bars was 10:20 and every
   name but the active one showed a bare "—" for the first fifty minutes). The floor is ten minutes of the session,
   whatever the bars' width. */
export const coveredMinutes = (bars: readonly Candle[]): number => {
  if (!bars.length) return 0;
  const step = bars.length >= 2 ? Math.max(60, bars[1].time - bars[0].time) : 60;
  return (bars[bars.length - 1].time - bars[0].time + step) / 60;
};
const tooEarly = (bars: readonly Candle[]): boolean => coveredMinutes(bars) < GAUGE_MIN_BARS;

/**
 * Crossings of the per-bar flip, from bar-aligned candle and snapshot tails.
 *
 * Pure, so the proof can hand it a session it constructed — the composed
 * `buildFlipGauge` below reads the simulator, whose history cannot be staged.
 *
 * A bar whose SNAPSHOT TIME does not match its candle's is skipped and breaks
 * the streak: the two buffers push in lockstep (updateCandles appends both on
 * the same roll) with equal caps, so a mismatch means the tails are not the
 * same minutes and a count across them would be crossings of nothing.
 */
export function countFlipCrossings(candles: readonly Candle[], snaps: readonly GexSnapshot[]): number {
  const n = Math.min(candles.length, snaps.length);
  let crossings = 0;
  let prevSide = 0;
  for (let i = 0; i < n; i++) {
    const bar = candles[i];
    const snap = snaps[i];
    if (bar.time !== snap.time) {
      prevSide = 0;
      continue;
    }
    const barFlip = pickFlip(snap.levels, bar.close, l => l.value);
    /* No flip that minute: price cannot cross a line that is not there, and
       carrying the previous side across the gap would count a crossing
       against a flip from minutes earlier. */
    if (barFlip === null) {
      prevSide = 0;
      continue;
    }
    const side = Math.sign(bar.close - barFlip);
    if (side !== 0 && prevSide !== 0 && side !== prevSide) crossings++;
    if (side !== 0) prevSide = side;
  }
  return crossings;
}

export function buildFlipGauge(snapshot: MarketSnapshot): FlipGauge {
  const { ticker, spot, chain } = snapshot;
  /* THE ONE FLIP (data/flipLevel.ts): where the book's net gamma, re-priced at that price, crosses zero — off the
     snapshot's own levels chain. THE REGIME IS THE SIGN OF NET GAMMA AT SPOT, never the side of the flip: on a book
     whose net is long gamma "price below the flip" said "amplifying" beside a green net (the retail test, 2026-10-22:
     MSFT "amplifying moves" next to "Net GEX +$140.4M"). */
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

  /* CROSSED TODAY IS THE MAP'S COUNT: the same flip, the same cash-session bars and the same test rule the Map's level
     report reads (data/levelRecord.ts levelTicks) — the per-bar flips off the volume-walked history counted something
     else (TSLA 1× on the Board against 11 on the Map) */
  const candles = sessionBars(ticker) ?? [];
  if (flip === null || tooEarly(candles)) return { ...base, bars: candles.length };
  return { ...base, crossings: levelTicks(candles, flip, flip >= spot ? 'call' : 'put').length, bars: candles.length };
}

/**
 * "FLIP CROSSED TODAY" IS TODAY'S SESSION AGAINST TODAY'S FLIP (the second re-audit, 2026-10-22): after the close the
 * levels move on to the next session's contracts, and counting Thursday's prices against Friday's flip is a count of
 * nothing. The flip here is the one of the book the session ran on (data/bookWindow.ts sessionBook); null with `why`
 * when that book is no longer available.
 */
export interface SessionCrossings {
  crossings: number | null;
  flip: number | null;
  label: string;
  why: string | null;
  /** False while the count's flip is provisional (its contracts' own vols not all in) — the count is then not shown */
  complete: boolean;
  /** The session is under ten minutes old — no count yet, and the cell says when it starts rather than a bare dash */
  early?: boolean;
}

/* A FINISHED SESSION'S COUNT IS FROZEN (the third audit, 2026-10-23: QQQ's "Flip crossed today" read 13× and then 9×
   after the bell — the morning book's flip was re-priced at each after-hours tick and the running clock). Once the
   session has closed, its flip is read ONCE, at the session's own close (the last cash bar's price and minute), the
   count is taken against it, and the answer is kept for that session: after-hours prints and the clock no longer move
   it. Before the next open there is no session today yet, and the count says so rather than re-counting yesterday. */
const frozenCross = new Map<string, SessionCrossings>();

export function sessionFlipCrossings(snapshot: MarketSnapshot, scope: 'ALL' | '0DTE'): SessionCrossings {
  const candles = sessionBars(snapshot.ticker) ?? [];
  const last = candles[candles.length - 1];
  /* BEFORE TODAY'S OPEN THE COUNT IS THE LAST SESSION'S, NAMED BY ITS DATE (the fifth audit, 2026-10-23): sessionBars
     and sessionBook both read the session on record (data/bookWindow.ts recordDay) — that day's bars against the book
     that was live in it, labelled "Thu Oct 22 · against the book live then", never "today" */
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
  if (read.flip === null) out = { crossings: !tooEarly(candles) ? 0 : null, flip: null, label: sb.label, why: null, complete: read.complete, early: tooEarly(candles) };
  else if (tooEarly(candles)) out = { crossings: null, flip: read.flip, label: sb.label, why: null, complete: read.complete, early: true };
  /* the side rule the Map's report uses (WallReportCard: flip ≥ spot is tested from below) */
  else out = { crossings: levelTicks(candles, read.flip, read.flip >= book.spot ? 'call' : 'put').length, flip: read.flip, label: sb.label, why: null, complete: read.complete };
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

/*
  THE FLIP, BY EXPIRY — P-9.

  Three answers to one question, because the books are different books: the
  0DTE lens is what evaporates at today's bell, the weekly is the trade the
  street is carrying, and the whole book is the structure underneath both.
  They routinely disagree, and the disagreement is the read — a 0DTE flip
  below spot under a whole-book flip above it is a pinned morning and a
  directional afternoon.

  EACH LENS'S OWN WINDOWED PROFILE, through buildExposureProfile — the same
  seam, the same EXPIRY_DECAY model, the same numbers the map and the matrix
  draw for that lens. Computing a "0DTE flip" off anything other than what
  the 0DTE view shows would let this row disagree with the page it sits on.

  THE SPREAD IS BOOK − 0DTE: how far the structure sits from today's
  artifact. Null unless both exist, because a spread against a book with no
  flip is not a number.
*/

export interface ExpiryFlips {
  d0: number | null;
  weekly: number | null;
  book: number | null;
  /** book − d0. Positive = the structural flip sits above today's. */
  spread: number | null;
}

/* The wider of the two windows the Exposure page offers — flips live near
   spot, and ±15 strikes is far more room than one ever needs. */
const FLIP_WINDOW = 15 as const;

/*
  WHAT THE THREE LENSES CAN AND CANNOT SAY, as of P-24B.

  The expiry lens is a UNIFORM POSITIVE SCALAR over every strike
  (`EXPIRY_DECAY` in data/exposure.ts: 0DTE 1, 7D 0.16, ALL 3.13). Scaling a
  whole book by a positive constant cannot move a sign change — so on this
  data source the three flips are the SAME PRICE, necessarily, and the panel
  says so rather than implying three measurements happened to coincide.

  They used to differ, and that difference was not real: the profile's
  per-strike jitter was seeded with the expiry NAME, so a hash of the string
  "7D" tilted near-balanced strikes and produced three numbers. The
  divergence measured when this feature was built (6 of 22 names) was
  measuring that hash. P-24B made the split net-preserving — levels are now
  a property of the book, not of the seed — and the three lenses collapsed
  onto one price, which is the honest reading of a book with no per-expiry
  structure in it.

  THE SHAPE STAYS because the seam is the point: a real chain carries its own
  open interest per expiry, those are three genuinely different books, and
  this function differentiates them the moment it is handed them. That is
  proven with a staged per-expiry book in the proof rather than asserted
  here.
*/
export function buildExpiryFlips(snapshot: MarketSnapshot): ExpiryFlips {
  const flipOf = (expiry: '0DTE' | '7D' | 'ALL') =>
    pickFlip(buildExposureProfile(snapshot, expiry, FLIP_WINDOW).strikes, snapshot.spot, s => s.gex.net);
  const d0 = flipOf('0DTE');
  const weekly = flipOf('7D');
  const book = flipOf('ALL');
  return {
    d0,
    weekly,
    book,
    spread: d0 !== null && book !== null ? book - d0 : null,
  };
}
