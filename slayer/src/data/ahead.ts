/* The day ahead, as models with their assumptions stated: the corridor (1σ to the close bent by the walls, split by the
   flip), where it closes (a normal on 1σ to the close weighted by the book's pull — model weights, not measured chances),
   and the session's words and clock the Map, Targets, Compare and the desk tiles share. */

import { daySigmaOfIv, normCdf, sigmaOverMinutes } from './expectedMove';
import { peekDaySigma, peekMoveToClose } from './book/move';
import { datesOf } from './flipLevel';
import { lastSessionSupreme, ofLast, rangeFrom, recentSessions, sessionSoFar } from './aheadHistory';
import { inCashSession, sessionBars } from './levelview';
import { nyMinutes } from '../core/nyTime';
import { REGULAR_CLOSE_MIN, REGULAR_OPEN_MIN, regularCloseMin, sessionAt } from '../core/session';
import { type ExposureSurface } from './exposureSurface';
import type { SessionClock } from './moc';
import type { ExposureProfileData } from '../types/gex';
import type { MarketSnapshot } from '../types/market';
import { fmtStrikeOrDash as fmtStrike } from '../core/format';

/** The drawing frame of a session, 09:30–16:00 (core/session.ts); a day's own close is AheadClock.closeMin */
export const OPEN_MIN = REGULAR_OPEN_MIN;
export const CLOSE_MIN = REGULAR_CLOSE_MIN;
export const SESSION_MIN = CLOSE_MIN - OPEN_MIN; // 390

export { fmtStrike };
const fmtPrice = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '—');
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** "$48M" / "$1.2B" — the schedule's dollars */
export const fmtDollars = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `$${(a / 1e3).toFixed(0)}K`;
  return `$${a.toFixed(0)}`;
};

// ---- the clock, as minutes -----------------------------------------------------

export interface AheadClock {
  /** New York minutes from midnight — null outside the session */
  nowMin: number | null;
  inSession: boolean;
  /** Trading minutes still to run: the rest of today, or a whole day when the market is shut */
  minutesLeft: number;
  label: string;
  /** Today's own close, minutes (13:00 on an early close); a full day's 16:00 when absent */
  closeMin?: number;
}

export function aheadClock(clock: SessionClock): AheadClock {
  const [h, m] = clock.etTime.split(':').map(Number);
  const mins = h * 60 + m;
  const inSession = clock.phase === 'OPEN' || clock.phase === 'AUCTION';
  /* the session's own close (core/session.ts): 13:00 on an early close, so the time left is not overstated */
  const closeMin = regularCloseMin(sessionAt(Date.now()).tradingDay);
  return {
    nowMin: inSession ? mins : null,
    inSession,
    minutesLeft: inSession ? Math.max(1, closeMin - mins) : closeMin - OPEN_MIN,
    label: clock.label,
    closeMin,
  };
}

// ---- the corridor --------------------------------------------------------------

type EdgeWhy = 'the expected move' | 'the call wall' | 'the put wall';

interface CorridorEdge {
  price: number;
  why: EdgeWhy;
}

interface ConePoint {
  min: number;
  lo1: number;
  hi1: number;
  lo2: number;
  hi2: number;
  /** The middle of the likely band — where the strikes have pulled the range's centre to by then */
  mid: number;
}

interface Corridor {
  spot: number;
  /** One standard deviation, in dollars, for the minutes left */
  sigma: number;
  /** One day's standard deviation in dollars — the ruler the cone is drawn in */
  sigmaDay: number;
  likely: { low: CorridorEdge; high: CorridorEdge };
  outer: { low: number; high: number };
  flip: number | null;
  /** Which side of the flip moves run on (dealers amplify there) */
  fastSide: 'above' | 'below' | null;
  /** The cone from now to the bell, one point per five minutes */
  cone: ConePoint[];
  /** Today's closes so far, placed on the session's minutes */
  path: { min: number; price: number }[];
  sentence: string;
}

/** A wall bends the corridor when it sits inside the expected move's reach, with a little give */
const WALL_REACH = 1.35;

/** How strongly the strikes pull the close right now, 0..1 — at the open the whole
    range is in play and they barely matter; in the last hour they are most of the story */
const gravityFor = (minutesLeft: number) => 0.35 + 0.65 * (1 - minutesLeft / SESSION_MIN);

/* The pulled centre: the close weights' centre of mass, so the corridor bends toward the strike the weights peak on. */
function pulledCentre(profile: ExposureProfileData, spot: number, sigma: number, gravity: number): number {
  if (sigma <= 1e-6) return spot;
  const curve = oddsCurve(profile, spot, sigma, gravity, 12);
  let sum = 0;
  let mass = 0;
  for (const c of curve) {
    sum += c.strike * c.w;
    mass += c.w;
  }
  return mass > 0 ? sum / mass : spot;
}

export function buildCorridor(snapshot: MarketSnapshot, profile: ExposureProfileData, iv: number, clock: AheadClock): Corridor {
  const spot = snapshot.spot;
  const one = snapshot.liveBook ? datesOf(snapshot, snapshot.chain) : null;
  const oneDate = Array.isArray(one) && one.length === 1 ? one[0] : null;
  const sigmaDay = (snapshot.liveBook ? peekDaySigma(snapshot.ticker, oneDate) : null) ?? daySigmaOfIv(spot, iv) ?? spot * 0.01;
  /* 1σ to the coming close, scaled to the minutes left exactly once (data/expectedMove.ts) */
  const sigma = (snapshot.liveBook ? peekMoveToClose(snapshot.ticker, oneDate, clock.minutesLeft) : null) ?? sigmaOverMinutes(sigmaDay, clock.minutesLeft);
  const { callWall, putWall, flip } = profile.levels;
  const gravityEnd = gravityFor(clock.minutesLeft);
  const start = clock.nowMin ?? OPEN_MIN;
  const close = clock.closeMin ?? CLOSE_MIN;
  const span = Math.max(1, close - start);

  /* The band at the close: the expected move around the pulled centre, then
     a wall inside reach becomes the edge */
  const centreEnd = pulledCentre(profile, spot, sigma, gravityEnd);
  const highWall = callWall > spot && callWall - spot <= sigma * WALL_REACH;
  const lowWall = putWall < spot && spot - putWall <= sigma * WALL_REACH;
  const high: CorridorEdge = highWall ? { price: Math.min(callWall, Math.max(centreEnd + sigma, spot)), why: 'the call wall' } : { price: centreEnd + sigma, why: 'the expected move' };
  const low: CorridorEdge = lowWall ? { price: Math.max(putWall, Math.min(centreEnd - sigma, spot)), why: 'the put wall' } : { price: centreEnd - sigma, why: 'the expected move' };
  const outer = { low: spot - 2 * sigma, high: spot + 2 * sigma };

  /* The flip splits the corridor. The fast side is where dealers are short gamma, read off the net at spot (flipLevel.ts),
     never off which side of the flip spot sits. No flip within ±10% splits nothing. */
  const flipInside = profile.levels.flipFound !== false && flip > outer.low && flip < outer.high ? flip : null;
  const longHere = profile.levels.net != null ? profile.levels.net < 0 : spot >= flip;
  const fastSide: Corridor['fastSide'] = flipInside == null ? null : longHere === flipInside > spot ? 'above' : 'below';

  /* the cone, five minutes at a time: 1σ for the minutes elapsed around the pulled centre, clipped by the walls */
  const cone: ConePoint[] = [];
  const at = (t: number): ConePoint => {
    /* ends on the corridor's own 1σ to the close (scaled once) */
    const s = sigma * Math.sqrt(Math.max(0, t - start) / span);
    const g = gravityEnd * ((t - start) / span);
    const c = pulledCentre(profile, spot, s, g);
    const hi1 = highWall ? Math.min(c + s, callWall) : c + s;
    const lo1 = lowWall ? Math.max(c - s, putWall) : c - s;
    const lo = Math.min(lo1, hi1);
    const hi = Math.max(lo1, hi1);
    return { min: t, lo1: lo, hi1: hi, lo2: spot - 2 * s, hi2: spot + 2 * s, mid: Math.min(hi, Math.max(lo, c)) };
  };
  for (let t = start; t <= close; t += 5) cone.push(at(t));
  if (cone[cone.length - 1]?.min !== close) cone.push(at(close));

  /* Today's path so far: the session's one-minute closes, the newest at now.
     Outside the session the whole last session is laid over the day. */
  const all = sessionBars(snapshot.ticker) ?? [];
  const path: Corridor['path'] = [];
  if (all.length) {
    /* Every bar at its own New York minute when the cut is inside the cash session (levelview sessionCut); a late-starting tape is not stretched to 09:30. */
    const inCash = all.every(b => inCashSession(b.time));
    if (inCash) {
      for (const b of all) {
        const m = nyMinutes(b.time * 1000);
        if (clock.nowMin == null || m <= clock.nowMin) path.push({ min: m, price: b.close });
      }
    } else if (clock.nowMin == null) {
      /* Shut: the whole last session laid over the day */
      const step = all.length > 1 ? (CLOSE_MIN - OPEN_MIN) / (all.length - 1) : 1;
      for (let i = 0; i < all.length; i++) path.push({ min: OPEN_MIN + i * step, price: all[i].close });
    } else {
      /* Open: only the minutes that have happened — the simulator's session
         holds a whole day of bars whatever the wall clock says, so the tail
         that fits between the open and now is the path, ending AT now */
      const keep = Math.min(all.length, clock.nowMin - OPEN_MIN + 1);
      const bars = all.slice(all.length - keep);
      const first = clock.nowMin - (keep - 1);
      for (let i = 0; i < bars.length; i++) path.push({ min: first + i, price: bars[i].close });
    }
  }

  /* The sentence says what the drawing cannot: how often recent sessions stayed inside a range this wide, and where the
     last session's high and low stopped against today's walls. */
  const splitWords =
    flipInside == null
      ? ''
      : fastSide === 'below'
        ? ` Below ${fmtStrike(flipInside)} moves run; above it they slow.`
        : ` Above ${fmtStrike(flipInside)} moves run; below it they slow.`;
  const width = high.price - low.price;
  const past = recentSessions(snapshot.ticker, 5, clock.inSession);
  let held = '';
  if (past.length) {
    if (clock.inSession && clock.nowMin != null) {
      const from = clock.nowMin;
      const ranges = past.map(s => rangeFrom(s, from)).filter((v): v is number => v != null);
      if (ranges.length) {
        const inside = ranges.filter(r => r <= width + 1e-9).length;
        held = ` From ${hhmm(from)} to the close, price stayed inside a range this wide in ${ofLast(inside, ranges.length)}; they ran ${fmtStrike(Math.min(...ranges))} to ${fmtStrike(Math.max(...ranges))}.`;
      }
    } else {
      const ranges = past.map(s => s.high - s.low);
      const inside = ranges.filter(r => r <= width + 1e-9).length;
      held = ` Price stayed inside a range this wide in ${ofLast(inside, ranges.length)}; the last ran ${fmtStrike(ranges[0])}.`;
    }
  }
  const against = clock.inSession ? sessionSoFar(snapshot.ticker, true) : past[0];
  let wallWords = '';
  if (against) {
    const upGap = callWall - against.high;
    const downGap = against.low - putWall;
    const upWords = upGap >= 0 ? `stopped ${fmtStrike(upGap)} under the call wall at ${fmtStrike(callWall)}` : `went ${fmtStrike(-upGap)} through the call wall at ${fmtStrike(callWall)}`;
    const downWords = downGap >= 0 ? `held ${fmtStrike(downGap)} above the put wall at ${fmtStrike(putWall)}` : `went ${fmtStrike(-downGap)} through the put wall at ${fmtStrike(putWall)}`;
    wallWords = ` ${clock.inSession ? "So far today the high" : "The last session's high"} ${upWords}, and ${clock.inSession ? 'the' : 'its'} low ${downWords}.`;
  }
  const sentence = `${clock.inSession ? 'Likely to hold' : 'When it opens, likely to hold'} between ${fmtPrice(low.price)} and ${fmtPrice(high.price)}, a ${fmtStrike(width)}-point range.${held}${wallWords}${splitWords}`;

  return { spot, sigma, sigmaDay, likely: { low, high }, outer, flip: flipInside, fastSide, cone, path, sentence };
}

// ---- where it closes -----------------------------------------------------------

type CloseRole = 'call wall' | 'put wall' | 'supreme' | 'pin' | null;

interface CloseOdd {
  strike: number;
  /** Model weight, percent to one decimal: the normal's share at the strike times the book's pull, renormalised. The rows
      sum to the share inside the window (the tails past it are not rows). */
  odds: number;
  /** The normal alone, before the book pulls on it — percent (probability of closing within half a step of the strike) */
  plain: number;
  /** How the book changes this strike's odds: >1 pulls, <1 pushes */
  pull: number;
  role: CloseRole;
}

/** A run of neighbouring strikes around the likeliest, and the odds they hold between them */
interface CloseBand {
  low: number;
  high: number;
  /** Percent of the odds inside it */
  mass: number;
  strikes: number;
}

interface CloseOdds {
  rows: CloseOdd[];
  /** The three most likely, best first */
  top: CloseOdd[];
  /** The rows with a strike above spot come first; this is the index of the first row at or below spot */
  spotAfter: number;
  sigma: number;
  /** How strongly the book pulls right now, 0..1 — grows into the close */
  gravity: number;
  /** The tightest runs around the heaviest strike holding 50% and 80% of the weights */
  half: CloseBand;
  most: CloseBand;
  /** The words under the drawing, one read per line */
  reads: CloseReads | null;
  /** The same as one paragraph, for the guide */
  sentence: string;
}

interface CloseReads {
  /** "345 at 17%, then 344 at 13% and 346 at 11%" */
  likely: string;
  /** "the model puts 50% of the close between 343 and 346 · 80% between 340 and 348" */
  bands: string;
  /** "the supreme at 345 carries the most model weight · the odds tighten as the close nears" */
  pull: string;
}

/** Grow a run of strikes outward from the likeliest, taking the heavier neighbour each step, until it holds `target` percent */
function bandOf(rows: CloseOdd[], top: CloseOdd | undefined, target: number): CloseBand {
  if (!top || !rows.length) return { low: 0, high: 0, mass: 0, strikes: 0 };
  const asc = [...rows].sort((a, b) => a.strike - b.strike);
  let lo = asc.findIndex(r => r.strike === top.strike);
  if (lo < 0) lo = 0;
  let hi = lo;
  let mass = asc[lo].odds;
  while (mass < target && (lo > 0 || hi < asc.length - 1)) {
    const below = lo > 0 ? asc[lo - 1].odds : -1;
    const above = hi < asc.length - 1 ? asc[hi + 1].odds : -1;
    if (above >= below) {
      hi++;
      mass += asc[hi].odds;
    } else {
      lo--;
      mass += asc[lo].odds;
    }
  }
  return { low: asc[lo].strike, high: asc[hi].strike, mass: Math.round(mass), strikes: hi - lo + 1 };
}

interface OddsPoint {
  strike: number;
  plain: number;
  w: number;
  pull: number;
  role: CloseRole;
}

/** The model's curve at one moment: each strike's share of a normal `sigma` wide on spot (the probability of closing
    nearer it than either neighbour), weighted by a pull (absorbs, the pin) or push (amplifies) with `gravity`. The
    pull is a heuristic, not calibrated: the result is a model weight, not a measured chance. */
function oddsCurve(profile: ExposureProfileData, spot: number, sigma: number, gravity: number, maxHalf: number): OddsPoint[] {
  const { callWall, putWall, supreme, pin } = profile.levels;
  const maxAbs = Math.max(1, profile.maxAbs.gex);
  const desc = [...profile.strikes].sort((a, b) => b.strike - a.strike);
  const spotIdx = Math.max(0, desc.findIndex(s => s.strike <= spot));
  /* Only the strikes the close can plausibly reach: the rarer band (two
     standard deviations) plus one, never fewer than four each side — a row
     of 0.0% strikes says nothing and buries the ones that matter */
  /* the spacing at price: far strikes are often listed wider apart */
  const near = Math.min(Math.max(1, spotIdx), desc.length - 1);
  const step = desc.length > 1 ? Math.abs(desc[near - 1].strike - desc[near].strike) || 1 : 1;
  const half = Math.max(4, Math.min(maxHalf, Math.ceil((2.2 * sigma) / step) + 1));
  const from = Math.max(0, spotIdx - half);
  const window = desc.slice(from, from + half * 2 + 1);
  const sd = Math.max(sigma, 1e-6);
  /* each strike owns the prices nearer it than its neighbours (midpoints), so the shares never overlap where the spacing
     changes (2.5 near price, 5 further out) */
  return window.map((s, i) => {
    const up = from + i - 1 >= 0 ? desc[from + i - 1].strike : s.strike + (desc[from + i + 1] ? s.strike - desc[from + i + 1].strike : step);
    const dn = desc[from + i + 1] ? desc[from + i + 1].strike : s.strike - (from + i - 1 >= 0 ? desc[from + i - 1].strike - s.strike : step);
    const plain = normCdf(((s.strike + up) / 2 - spot) / sd) - normCdf(((s.strike + dn) / 2 - spot) / sd);
    const net = s.gex.net / maxAbs; // + amplifies (pushes the close off it), − absorbs (pulls it in)
    const absorb = Math.max(0, -net);
    const amplify = Math.max(0, net);
    const pinPull = s.pin ? 0.5 : 0;
    const pull = (1 + gravity * 1.6 * (absorb + pinPull)) * (1 - 0.6 * gravity * amplify);
    const role: CloseRole = s.strike === supreme ? 'supreme' : s.strike === callWall ? 'call wall' : s.strike === putWall ? 'put wall' : s.strike === pin ? 'pin' : null;
    return { strike: s.strike, plain, w: plain * pull, pull, role };
  });
}

export function buildCloseOdds(profile: ExposureProfileData, spot: number, sigma: number, clock: AheadClock, maxHalf = 12): CloseOdds {
  const gravity = gravityFor(clock.minutesLeft);
  const raw = oddsCurve(profile, spot, sigma, gravity, maxHalf);
  /* the mass past the rows shown stays in the total (pull 1), so a short window never inflates its rows */
  let plainSum = 0;
  let sum = 0;
  for (const r of raw) {
    plainSum += r.plain;
    sum += r.w;
  }
  const tail = Math.max(0, 1 - plainSum);
  sum += tail;
  const rows: CloseOdd[] = raw.map(r => ({
    strike: r.strike,
    odds: sum > 0 ? Math.round((1000 * r.w) / sum) / 10 : 0,
    plain: Math.round(1000 * r.plain) / 10,
    pull: r.pull,
    role: r.role,
  }));
  const top = [...rows].sort((a, b) => b.odds - a.odds).slice(0, 3);
  const spotAfter = rows.findIndex(r => r.strike <= spot);
  const lead = top[0];
  const half = bandOf(rows, lead, 50);
  const most = bandOf(rows, lead, 80);
  /* the reads, one per line: the heaviest strikes, the two bands, who is pulling and what the clock does */
  /* each read carries a comparison the drawing cannot (the last close against the runs, the record, the last supreme) */
  let reads: CloseReads | null = null;
  if (lead) {
    const at = (r: CloseOdd) => `${fmtStrike(r.strike)} at ${r.odds.toFixed(0)}%`;
    const past = recentSessions(profile.ticker, 5, clock.inSession);
    const step = rows.length > 1 ? Math.abs(rows[0].strike - rows[1].strike) || 1 : 1;
    const inRun = (p: number, b: CloseBand) => (b.strikes ? p >= b.low - step / 2 && p <= b.high + step / 2 : false);
    const mark = clock.inSession ? spot : past[0]?.close ?? null;
    const markWords = mark == null ? '' : ` · ${clock.inSession ? `spot at ${fmtPrice(mark)}` : `the last close, ${fmtPrice(mark)},`} sits ${inRun(mark, half) ? 'inside the 50% run' : inRun(mark, most) ? 'inside the 80% run, outside the 50%' : 'outside both runs'}`;
    const likely = `${at(lead)}${top[1] ? `, then ${at(top[1])}` : ''}${top[2] ? ` and ${at(top[2])}` : ''}${markWords}`;
    const halfWidth = half.strikes ? half.high - half.low + step : 0;
    const caught = past.length && halfWidth > 0 ? past.filter(s => Math.abs(s.close - s.open) <= halfWidth / 2 + 1e-9).length : null;
    const record = caught != null ? ` · from their open, a 50% run this wide would have caught the close in ${ofLast(caught, past.length)}` : '';
    const bands = `the model puts 50% of the close between ${fmtStrike(half.low)} and ${fmtStrike(half.high)} · 80% between ${fmtStrike(most.low)} and ${fmtStrike(most.high)}${record}`;
    const who = lead.role
      ? `the ${lead.role} at ${fmtStrike(lead.strike)} carries the most model weight`
      : lead.pull > 1.02
        ? `the strikes around ${fmtStrike(lead.strike)} carry the most model weight`
        : `1σ alone puts it at ${fmtStrike(lead.strike)} — the book adds no weight`;
    const last = lastSessionSupreme(profile.ticker, clock.inSession);
    const lastWords = last ? ` · the last session closed ${last.away < step / 2 ? 'on' : `${fmtStrike(Number(last.away.toFixed(2)))} from`} its own heaviest strike, ${fmtStrike(last.strike)}` : '';
    const when = clock.inSession ? 'the odds tighten as the close nears' : "a whole day's range is in play until the open";
    reads = { likely, bands, pull: `${who}${lastWords} · ${when}` };
  }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const sentence = reads ? `Model weights: ${reads.likely}. ${cap(reads.bands.replace(' · ', ', and '))}. ${cap(reads.pull.replace(' · ', '; '))}.` : 'No strikes near enough to spot to say.';
  return { rows, top, spotAfter: spotAfter < 0 ? rows.length : spotAfter, sigma, gravity, half, most, reads, sentence };
}

// ---- the schedule ---------------------------------------------------------------

/** The calendar's net vanna, every expiry and strike — dollars of delta per point of vol, kept sign (core/dealerSign.ts) */
export function wholeBookVanna(surface: ExposureSurface): number {
  let v = 0;
  for (let e = 0; e < surface.expiries.length; e++) for (let s = 0; s < surface.strikes.length; s++) v += surface.net.vanna[e]?.[s] ?? 0;
  return v;
}

