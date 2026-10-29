/* At the wall: the walls' model behind Targets and the Pulse desk's At-the-wall tile. Reach odds are touch odds on the
   1σ left (data/expectedMove.ts); a wall's percentage is its size against the top wall, not a probability; the factor
   pushes are hand-set context. If it breaks: the next shelf and the dealer flow along the path (data/hedgeFlow.ts). */

import { daySigmaOfIv, sigmaFracOver, sigmaOverMinutes, touchOdds } from './expectedMove';
import { findAirPockets, SHELF_SHARE, type AirPocket } from './airPockets';
import { buildHedgeFlowLadder, type FlowLadder } from './hedgeFlow';
import { SESSION_MIN, fmtDollars, fmtStrike, wholeBookVanna, type AheadClock } from './ahead';
import type { Building } from './building';
import { todayColumn, type ExposureSurface } from './exposureSurface';
import type { ExposureProfileData, StrikeExposure } from '../types/gex';
import type { Candle, MarketSnapshot } from '../types/market';
import { putWallWords } from '../core/walls';
import { dealerOf } from '../core/dealerSign';
import { monDayOf, peekDaySigma, peekMoveToClose, peekScopeMove } from './uwBook';
import { datesOf, levelNetPath } from './flipLevel';
import { pctWhole as pct } from '../core/format';
import { clamp } from '../core/math';

/** The one expiry a snapshot's levels chain reads, or null for several / the whole book */
export const scopeDateOf = (snapshot: MarketSnapshot): string | null => {
  const d = datesOf(snapshot, snapshot.chain);
  return Array.isArray(d) && d.length === 1 ? d[0] : null;
};

/* The reach odds' horizon and σ: the coming session's 1σ scaled to the minutes left, or for a later expiry the 1σ into
   it over its whole horizon ("by Nov 20"). One rule for the Agenda, the Board, Compare and the corridor. */
interface ScopeSigma {
  /** 1σ from now to the horizon, dollars */
  sigmaLeft: number;
  /** One session's 1σ, dollars (the ruler's σ) */
  sigmaDay: number;
  /** "by Nov 20" for a multi-day scope — null when the horizon is the coming session's close */
  horizon: string | null;
  /** Which number the move is, in words ("1σ = the vendor's straddle into Nov 20 × 1.25") */
  words: string;
}
export function scopeSigma(snapshot: MarketSnapshot, minutesLeft: number, iv: number, date: string | null = scopeDateOf(snapshot)): ScopeSigma {
  const spot = snapshot.spot;
  const sigmaDay = (snapshot.liveBook ? peekDaySigma(snapshot.ticker, date) : null) ?? daySigmaOfIv(spot, iv) ?? spot * 0.01;
  const m = snapshot.liveBook ? peekScopeMove(snapshot.ticker, date) : null;
  if (m?.multi && m.until && m.move > 0) return { sigmaLeft: m.move, sigmaDay, horizon: `by ${monDayOf(m.until)}`, words: m.words };
  /* a same-day expiry's straddle read in its session is already the move left; a full session's 1σ is scaled once */
  const left = snapshot.liveBook ? peekMoveToClose(snapshot.ticker, date, minutesLeft) : null;
  return { sigmaLeft: left ?? sigmaOverMinutes(sigmaDay, minutesLeft), sigmaDay, horizon: null, words: m?.words ?? '1σ of the 30-day implied vol over one session' };
}

/* ---- the constants, named so they can be calibrated ------------------------------ */

/* A wall's reading is its weight (the strike and its neighbours) against the heaviest wall on the same chain — a size,
   not a probability (the back-test found size does not predict a hold), so the pages say "of the top wall". */

/** Kept for the size factor's words: a wall at this ratio of the typical wall reads as typical */
const PAR_RATIO = 1;
/** Logits per doubling of the wall's weight against the typical wall on its book — the factor list's push only */
const A_WEIGHT = 1.0;
/** Logits for a perfect record of holds today (and against for breaks) (back-tested) */
const A_TESTS = 0.048;
/** Logits for a wall that grew by half its size today (and against for draining) — not back-testable, hand-set */
const A_BUILD = 0.8;
/** Logits AGAINST, per unit of speed over the priced pace (back-tested: negative — a fast arrival holds more) */
const A_SPEED = -0.458;
/** Logits against, for a one-point vol drop forcing a wall's worth of dealer stock through it (vanna) — hand-set */
const A_VOL = 0.6;
/** How much of a wall's expiring-today part still counts at the close */
const CHARM_FLOOR = 0.35;
/** The neighbours that count as part of a wall, as a share of spot */
const NEIGHBOUR_PCT = 0.0025;

/* ---- types ------------------------------------------------------------------------ */

export type WallSide = 'call' | 'put';
export type WallRole = 'call wall' | 'put wall' | 'supreme' | 'flip' | null;

export interface WallFactor {
  key: 'weight' | 'tests' | 'build' | 'expiry' | 'speed' | 'prints' | 'vol';
  label: string;
  /** The measured fact, printed in mono */
  fact: string;
  /** −1..+1: positive pushes toward holding, negative toward breaking */
  push: number;
  /** One short clause */
  words: string;
}

export interface WallPath {
  /** The strike it heads to — null when nothing bounds it in the window */
  to: number | null;
  /** The empty stretch it crosses first, if any */
  pocket: AirPocket | null;
  /** Signed dollars of dealer stock flow forced along the way: positive = buying */
  flow: number;
  words: string;
}

export interface WallOdds {
  strike: number;
  side: WallSide;
  role: WallRole;
  /** The absorbing hedging at the wall, dollars per 1% move — negative when the strike pushes moves along instead */
  weight: number;
  /** The same after the expiring-today part is discounted for the clock */
  weightEff: number;
  /** Share of the wall that expires at 4:00 */
  expiresToday: number;
  touches: number;
  breaks: number;
  /** Today's change in the wall's size, dollars */
  build: number;
  /** Realized pace over the last half hour against the pace the options priced */
  speed: number;
  /** Dollars of stock today's prints hand dealers to trade TOWARD the wall (positive pushes through it) */
  prints: number;
  /** Distance from spot in expected-move units for the minutes left */
  distanceSigma: number;
  /** Odds price reaches it by the close, 0..1 */
  reach: number;
  /** The wall's size against the heaviest wall on the same chain, 0..1 (1 = the top wall) — a size, not a probability */
  hold: number;
  factors: WallFactor[];
  breakPath: WallPath;
  holdPath: WallPath;
  sentence: string;
}

/* ---- helpers --------------------------------------------------------------------- */

/** The wall reading as printed: its size against the heaviest wall on the same chain, as a multiple (a size, so never a
    percent — a percent on these pages is a chance) */
export const holdLabel = (v: number): string => (v >= 0.995 ? 'the top wall' : `${holdShort(v)} the top wall`);
/** The same reading for a cell under a "Wall size" heading: "0.85×", "top" for the heaviest, "<0.05×" for the thinnest */
export const holdShort = (v: number): string => (v >= 0.995 ? 'top' : v < 0.05 ? '<0.05×' : `${v.toFixed(2)}×`);
/** A chance as printed: "<1%" for the tiny ones (a floor of 2% made strikes five expected moves out read "2% reached") */
export const chanceLabel = (v: number): string => (v < 0.005 ? '<1%' : v > 0.995 ? '>99%' : `${Math.round(v * 100)}%`);
const signedDollars = (v: number) => `${v >= 0 ? '+' : '−'}${fmtDollars(v)}`;

/** Tests of a level as visits, not bars: a test begins when a bar reaches the strike and ends held when price leaves it
    back on its own side, or broke on the first close beyond it. */
export function testEvents(bars: readonly Candle[], strike: number, side: WallSide): { tests: number; held: number; broke: number } {
  let held = 0;
  let broke = 0;
  let at = false;
  let beyond = false;
  for (const b of bars) {
    const touched = b.low <= strike && b.high >= strike;
    const closedBeyond = side === 'call' ? b.close > strike : b.close < strike;
    if (beyond) {
      if (!closedBeyond) beyond = false; // back on the original side: the next visit is new
      continue;
    }
    if (touched) {
      at = true;
      if (closedBeyond) {
        broke++;
        at = false;
        beyond = true;
      }
    } else if (at) {
      held++;
      at = false;
    }
  }
  if (at) held++; // still at the level as the tape ends — it has held so far
  return { tests: held + broke, held, broke };
}

/** Dollars of stock it took to move price 1% today — today's dollar volume over today's travel */
function dollarsPer1Pct(bars: readonly Candle[]): number | null {
  if (bars.length < 5) return null;
  let dollars = 0;
  let travel = 0;
  for (let i = 1; i < bars.length; i++) {
    dollars += bars[i].volume * bars[i].close;
    travel += (Math.abs(bars[i].close - bars[i - 1].close) / bars[i - 1].close) * 100;
  }
  return travel > 0 ? dollars / travel : null;
}

/** Realized pace over the last `n` bars against the pace the options priced for the same span */
export function speedRatio(bars: readonly Candle[], iv: number, n = 30): number | null {
  if (bars.length < n + 1 || !(iv > 0)) return null;
  const tail = bars.slice(-n - 1);
  const rets = tail.slice(1).map((b, i) => Math.log(b.close / tail[i].close));
  const mean = rets.reduce((a, r) => a + r, 0) / rets.length;
  const varr = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
  const realized = Math.sqrt(varr) * Math.sqrt(n);
  const implied = sigmaFracOver(iv, n);
  return implied > 0 ? realized / implied : null;
}

/* ---- the model ------------------------------------------------------------------- */

interface Ctx {
  ticker: string;
  spot: number;
  strikes: StrikeExposure[]; // descending
  heaviest: number;
  levels: ExposureProfileData['levels'];
  pockets: AirPocket[];
  ladder: FlowLadder;
  building: Building;
  surface: ExposureSurface | null;
  todayIdx: number;
  bars: Candle[];
  clock: AheadClock;
  marketPer1Pct: number;
  /** The median weight of the shelves on this book — the size factor's yardstick */
  typicalWall: number;
  /** The heaviest wall weight on this chain, measured the way every wall is — the 100% of the wall reading */
  topWall: number;
  sigmaLeft: number;
  /** "by Nov 20" when the odds run to a later expiry than the coming session (scopeSigma) — null for the close */
  horizon: string | null;
  speed: number | null;
  /** Dollars of stock dealers must BUY if vol drops a point — the window's net vanna */
  volDrop: number;
}

function roleOf(K: number, levels: ExposureProfileData['levels']): WallRole {
  if (K === levels.callWall) return 'call wall';
  if (K === levels.putWall) return 'put wall';
  if (K === levels.supreme) return 'supreme';
  return null;
}

/** The weight: the strike and its close neighbours, absorbing counted for, amplifying against — a strike absorbs where
    dealers are long gamma there (house sign negative), above spot or below. */
/* The strike's own sign names it wall or trapdoor; neighbours (same side, half weight) only size it. */
function wallWeight(K: number, spot: number, strikes: readonly StrikeExposure[]): number {
  const own = strikes.find(s => s.strike === K)?.gex.net ?? 0;
  if (!own) return 0;
  const absorbs = own < 0;
  let mag = 0;
  for (const s of strikes) {
    if (Math.abs(s.strike - K) > spot * NEIGHBOUR_PCT) continue;
    if (s.gex.net < 0 !== absorbs || !s.gex.net) continue;
    mag += Math.abs(s.gex.net) * (s.strike === K ? 1 : 0.5);
  }
  return absorbs ? mag : -mag;
}

/** Which way the dealers' hedging along a path leans against the move: a move up met by dealer BUYING is pushed along,
    by selling it is leaned against (and the reverse for a move down) — the words follow the flow's own sign */
export const pathLean = (side: WallSide, flow: number): 'along' | 'against' | null => (flow === 0 ? null : (side === 'call') === flow > 0 ? 'along' : 'against');
export const pathFlowWords = (side: WallSide, flow: number): string => {
  const lean = pathLean(side, flow);
  if (!lean) return '';
  return `${fmtDollars(flow)} of forced dealer ${flow > 0 ? 'buying' : 'selling'} on the way, which ${lean === 'along' ? 'pushes the move along' : 'leans against the move'}`;
};

function wallOdds(K: number, ctx: Ctx): WallOdds {
  const { spot, strikes, levels, clock } = ctx;
  const side: WallSide = K >= spot ? 'call' : 'put';
  const role = roleOf(K, levels);
  const weight = wallWeight(K, spot, strikes);

  /* THE CLOCK: the expiring-today part fades toward CHARM_FLOOR by the close, and is gone after it */
  let expiresToday = 0;
  if (ctx.surface && ctx.todayIdx >= 0) {
    const si = ctx.surface.strikes.indexOf(K);
    if (si >= 0) {
      let total = 0;
      for (let e = 0; e < ctx.surface.expiries.length; e++) total += Math.abs(ctx.surface.net.gex[e][si] ?? 0);
      const today = Math.abs(ctx.surface.net.gex[ctx.todayIdx][si] ?? 0);
      expiresToday = total > 0 ? clamp(today / total, 0, 1) : 0;
    }
  }
  /* Outside the session the book's "today" contracts are the COMING session's (bookToday rolls at 16:15), alive in
     full — they used to read as already expired, so before the open every front-expiry wall weighed nothing and sat on
     the odds floor (the Board printed "holds 10%" on every name) */
  const fade = clock.inSession ? CHARM_FLOOR + (1 - CHARM_FLOOR) * (clock.minutesLeft / SESSION_MIN) : 1;
  const weightEff = weight * (1 - expiresToday * (1 - fade));

  /* THE TESTS today — visits, held or broke */
  const { tests: touches, held, broke: breaks } = testEvents(ctx.bars, K, side);
  const testsScore = touches === 0 ? 0 : clamp((held - 2 * breaks) / (touches + 2), -1, 1);

  /* Being built or drained today. */
  const brow = ctx.building.rows.find(r => r.strike === K);
  const build = brow?.sizeChange ?? 0;
  const buildScore = weight > 0 ? clamp(build / weight, -0.5, 0.5) * 2 : 0;

  /* THE SPEED and THE PRINTS */
  const speed = ctx.speed ?? 1;
  const speedExcess = clamp(speed - 1, -0.6, 1.5);
  /* the option tape is not read into the book, so no prints factor */
  const prints = 0;
  /* A VOL DROP — VANNA: the stock a one-point drop makes dealers trade, read
     toward the wall like the prints: buying leans through a call wall, selling
     through a put wall */
  const volToward = side === 'call' ? ctx.volDrop : -ctx.volDrop;
  const volScore = weightEff > 0 ? clamp(volToward / weightEff, -1, 1) : 0;

  /* THE ODDS */
  const ratio = weightEff > 0 ? weightEff / Math.max(1, ctx.typicalWall) : 0;
  const zWeight = weightEff > 0 ? A_WEIGHT * (Math.log2(ratio) - Math.log2(PAR_RATIO)) : -4;
  const zTests = A_TESTS * testsScore;
  const zBuild = A_BUILD * buildScore;
  /* The speed is the pace price ARRIVES at, measured in the session (the back-test read it at the touch). Outside the
     session the tape is the thin after-hours one, so it does not move the hold until the bell */
  const zSpeed = clock.inSession ? -A_SPEED * speedExcess : 0;
  const zVol = -A_VOL * volScore;
  /* the reading: this wall's weight against the heaviest strike on the same chain (1 = the top wall) */
  const hold = weight <= 0 ? 0 : clamp(weight / Math.max(1, ctx.topWall), 0, 1);

  const distance = Math.abs(K - spot);
  const distanceSigma = ctx.sigmaLeft > 0 ? distance / ctx.sigmaLeft : 99;
  /* touch odds by the horizon (reflection principle on the 1σ left); no floor */
  const reach = touchOdds(spot, K, ctx.sigmaLeft);

  /* THE PATHS */
  const beyond = side === 'call' ? strikes.filter(s => s.strike > K).sort((a, b) => a.strike - b.strike) : strikes.filter(s => s.strike < K).sort((a, b) => b.strike - a.strike);
  const nextShelf = beyond.find(s => Math.abs(s.gex.net) >= SHELF_SHARE * ctx.heaviest && s.strike !== K) ?? null;
  const pocket = ctx.pockets.find(p => (side === 'call' ? p.floor === K : p.ceiling === K)) ?? null;
  const rungAt = (k: number | null) => (k == null ? null : (ctx.ladder.rungs.find(r => Math.abs(r.strike - k) < 1e-9) ?? null));
  const breakTo = nextShelf?.strike ?? (pocket ? (side === 'call' ? pocket.ceiling : pocket.floor) : null);
  const breakRung = rungAt(breakTo);
  /* The break's own flow, from this strike to where it runs, not from spot (the ladder's flow is cumulative from spot). */
  const breakFlow = breakRung ? breakRung.flow - (rungAt(K)?.flow ?? 0) : 0;
  const breakPath: WallPath = {
    to: breakTo,
    pocket,
    flow: breakFlow,
    words:
      breakTo == null
        ? `a break ${side === 'call' ? 'above' : 'below'} ${fmtStrike(K)} has no shelf behind it on the strikes shown`
        : `a ${weight > 0 ? 'break' : 'move'} ${side === 'call' ? 'above' : 'below'} ${fmtStrike(K)} runs to ${fmtStrike(breakTo)}${pocket ? ' with almost nothing in between' : ''}${breakFlow !== 0 ? `, ${pathFlowWords(side, breakFlow)}` : ''}`,
  };
  const flipOnSpotSide = side === 'call' ? levels.flip < K : levels.flip > K;
  const holdTo = flipOnSpotSide && Math.abs(levels.flip - spot) > 1e-9 ? levels.flip : side === 'call' ? levels.putWall : levels.callWall;
  const holdRung = rungAt(holdTo);
  const holdFlow = holdRung?.flow ?? 0;
  const holdPath: WallPath = {
    to: holdTo,
    pocket: null,
    flow: holdFlow,
    words: `a hold sends price back toward ${fmtStrike(holdTo)}${holdFlow !== 0 ? `, ${pathFlowWords(side === 'call' ? 'put' : 'call', holdFlow)}` : ''}`,
  };

  /* THE FACTORS, each a fact and a push */
  const factors: WallFactor[] = [
    {
      key: 'weight',
      label: 'What it is made of',
      fact: weight > 0 ? `${fmtDollars(weightEff)} per 1% · ${ratio.toFixed(1)}× a typical wall here` : `${fmtDollars(Math.abs(weight))} the wrong way`,
      push: weight > 0 ? clamp(zWeight / 3, -1, 1) : -1,
      words:
        weight > 0
          ? ratio >= 2
            ? 'one of the heaviest walls on this name'
            : ratio >= 1
              ? 'heavier than a typical wall on this name'
              : ratio >= 0.5
                ? 'lighter than a typical wall on this name'
                : 'thin for this name'
          : role === 'put wall'
            ? putWallWords(K, spot)
            : 'pushes moves along rather than back — dealers are short gamma here: a trapdoor, not a wall',
    },
    {
      key: 'tests',
      label: 'Tested today',
      fact: touches === 0 ? 'not yet' : `${touches}× · held ${held} · broke ${breaks}`,
      push: clamp(zTests / Math.abs(A_TESTS), -1, 1),
      words: touches === 0 ? 'price has not reached it today' : breaks === 0 ? `every touch held` : `broke ${breaks} time${breaks === 1 ? '' : 's'} on ${touches} touch${touches === 1 ? '' : 'es'}`,
    },
    {
      key: 'build',
      label: clock.inSession ? 'Built or drained today' : 'Built or drained last session',
      fact: `${signedDollars(build)}${weight > 0 ? ` · ${Math.round((build / weight) * 100)}% of it` : ''}`,
      push: clamp(zBuild / A_BUILD, -1, 1),
      words: build > 0 ? 'the wall is being added to' : build < 0 ? 'the wall is draining' : 'unchanged',
    },
    {
      key: 'expiry',
      label: clock.inSession ? 'Expires at 4:00 · charm' : 'Expired at 4:00 · charm',
      fact: `${pct(expiresToday)} of it${clock.inSession ? ` · ${Math.floor(clock.minutesLeft / 60)}h ${String(clock.minutesLeft % 60).padStart(2, '0')}m left` : ''}`,
      push: -clamp(expiresToday * (1 - fade) * 2, 0, 1),
      words: clock.inSession
        ? expiresToday > 0.5
          ? 'most of this wall is gone at the close'
          : expiresToday > 0.2
            ? 'a real share of it thins into the close'
            : 'nearly all of it stays past today'
        : expiresToday > 0.5
          ? 'most of this wall left at the close'
          : expiresToday > 0.2
            ? 'a real share of it left at the close'
            : 'nearly all of it is still there',
    },
    {
      key: 'speed',
      label: 'The market’s speed',
      fact: ctx.speed == null ? '—' : `${speed.toFixed(2)}× the pace priced`,
      push: clamp(zSpeed / Math.abs(A_SPEED), -1, 1),
      words: !clock.inSession ? 'the pace price arrives at counts once the session opens' : speed > 1.3 ? 'running faster than its options priced — fast arrivals tend to turn back more often' : speed < 0.7 ? 'a quiet market — slow arrivals tend to push through more often' : 'about the pace the options priced',
    },
    {
      key: 'vol',
      label: 'A one-point vol drop · vanna',
      fact: `${fmtDollars(ctx.volDrop)} of forced dealer ${ctx.volDrop >= 0 ? 'buying' : 'selling'}`,
      push: clamp(zVol / A_VOL, -1, 1),
      words: volToward > 0 ? 'a vol drop leans through this wall' : volToward < 0 ? 'a vol drop leans away from it' : 'no lean from a vol drop',
    },
  ];

  const who = role ? `The ${role} at ${fmtStrike(K)}` : weight > 0 ? `The shelf at ${fmtStrike(K)}` : `${fmtStrike(K)}`;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const sentence =
    weight > 0
      ? `${who} is reached by ${clock.inSession ? 'the close' : 'the next close'} ${chanceLabel(reach)} of the time; it is ${holdLabel(hold)} on this chain. ${cap(breakPath.words)}. ${cap(holdPath.words)}.`
      : role === 'put wall'
        ? `${who}: ${putWallWords(K, spot)}. ${cap(breakPath.words)}.`
        : `${who} is not a wall: dealers are short gamma there, so the hedging pushes moves along rather than back. ${cap(breakPath.words)}.`;

  return { strike: K, side, role, weight, weightEff, expiresToday, touches, breaks, build, speed, prints, distanceSigma, reach, hold, factors, breakPath, holdPath, sentence };
}

/* ---- the board ------------------------------------------------------------------- */

/** Everything the odds need for one name, built once — the Targets page reads
    every strike through it, the wall board only the walls */
export type WallContext = Ctx;

export function buildWallContext(
  snapshot: MarketSnapshot,
  profile: ExposureProfileData,
  building: Building,
  surface: ExposureSurface | null,
  bars: readonly Candle[],
  clock: AheadClock,
  iv: number
): WallContext {
  const { spot } = snapshot;
  const strikes = profile.strikes; // descending
  const heaviest = Math.max(1, ...strikes.map(s => Math.abs(s.gex.net)));
  const shelves = strikes.map(s => Math.abs(s.gex.net)).filter(v => v >= SHELF_SHARE * heaviest).sort((a, b) => a - b);
  const typicalWall = shelves.length ? shelves[Math.floor((shelves.length - 1) / 2)] : heaviest * 0.5;
  const topWall = Math.max(1, ...strikes.map(s => wallWeight(s.strike, spot, strikes)));
  const todayBars = bars as Candle[];
  const marketPer1Pct = dollarsPer1Pct(todayBars) ?? 1;
  /* the expiry the levels read: its own implied move (data/uwBook.ts peekDaySigma), the 30-day IV only as a fallback */
  const ss = scopeSigma(snapshot, clock.minutesLeft, iv);
  const sigmaLeft = snapshot.liveBook ? ss.sigmaLeft : sigmaOverMinutes(daySigmaOfIv(spot, iv) ?? spot * 0.01, clock.minutesLeft);
  return {
    horizon: snapshot.liveBook ? ss.horizon : null,
    ticker: snapshot.ticker,
    spot,
    strikes,
    heaviest,
    levels: profile.levels,
    pockets: findAirPockets(strikes),
    ladder: buildHedgeFlowLadder(profile, snapshot.liveBook ? prices => levelNetPath(snapshot, snapshot.uwChains?.[profile.expiry] ?? snapshot.chain, prices)?.path.map(v => -v) ?? null : undefined),
    building,
    surface,
    todayIdx: surface ? todayColumn(surface) : -1,
    bars: todayBars,
    clock,
    marketPer1Pct,
    typicalWall,
    topWall,
    sigmaLeft,
    speed: speedRatio(todayBars, iv),
    /* Across every expiry when the calendar is here — today's contracts carry
       almost no vanna; the further dates do, and a vol crush moves all of them */
    volDrop: dealerOf(surface ? wholeBookVanna(surface) : strikes.reduce((a, s) => a + (s.vanna?.net ?? 0), 0)),
  };
}

/** The odds at one strike, walls and trapdoors alike */
export const oddsAt = (strike: number, ctx: WallContext): WallOdds => wallOdds(strike, ctx);

