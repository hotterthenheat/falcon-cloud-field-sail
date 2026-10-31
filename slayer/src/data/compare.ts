/* Compare: two names, the same reads side by side — the Board's row, the corridor and close weights, and each book's
   strikes by distance from its own spot, so two books sit on one ruler (dollars do not compare across names, so '$'
   reads as percent here). */

import { daySigmaOfIv, sigmaOverMinutes } from './expectedMove';
import { wallPlace } from '../core/walls';
import { bookCandles, peekBellShare } from './book/levels';
import { monDayOf, peekDaySigma, peekIv, peekMoveToClose, peekScopeMove } from './book/move';
import { peekSpot } from './book/day';
import { scopeDatesPending } from './book/load';
import { scopeDateOf } from './wall';
import { UNIVERSE } from './universe';
import type { AheadClock } from './ahead';
import { sessionStarts } from './indicators';
import { sessionAtr, type DistanceScales, type DistanceUnit } from './atr';
import { deskAgenda, netGexOf, retailNet, watchFrom, watchSurface, type BoardRow } from './board';
import { buildExposureProfile } from './exposure';
import { buildExposureSurface, CALENDAR_DTES, GREEKS, type ExposureSurface, type Greek } from './exposureSurface';
import { buildFlipGauge, type GammaRegime } from './flipGauge';
import { readRegime } from './flipLevel';
import { levelsFor } from './levelsFor';
import type { ExposureExpiry, ExposureLevels, ExposureProfileData, StrikeExposure } from '../types/gex';
import type { Candle, GexLevel, MarketSnapshot } from '../types/market';
import { fmtStrike } from '../core/format';

/** Thirty strikes each side: the whole book */
export const WINDOW = 30;

export type { Greek };

interface GreekWords {
  pos: string;
  neg: string;
  /** The same, said of two names at once */
  posBoth: string;
  negBoth: string;
  posWhy: string;
  negWhy: string;
}
/* Keyed on the KEPT sign (core/dealerSign.ts: kept = −dealer), the way every page holds the figure: `pos` is a positive kept
   value, i.e. a negative dealer exposure. */
export const GREEK_WORDS: Record<Greek, GreekWords> = {
  gex: { pos: 'pushes along', neg: 'pushes back', posBoth: 'both push along', negBoth: 'both push back', posWhy: 'dealers chase a move there', negWhy: 'dealers lean against a move there' },
  dex: { pos: 'hedged long stock', neg: 'hedged short stock', posBoth: 'both hedged long stock', negBoth: 'both hedged short stock', posWhy: 'dealers’ options there are short delta, so they hold stock against them', negWhy: 'dealers’ options there are long delta, so they are short stock against them' },
  vex: { pos: 'gains if vol falls', neg: 'gains if vol rises', posBoth: 'both gain if vol falls', negBoth: 'both gain if vol rises', posWhy: 'dealers are short volatility there', negWhy: 'dealers are long volatility there' },
  vanna: { pos: 'sells on a vol drop', neg: 'buys on a vol drop', posBoth: 'both sell on a vol drop', negBoth: 'both buy on a vol drop', posWhy: 'a one-point vol drop makes dealers sell stock there', negWhy: 'a one-point vol drop makes dealers buy stock there' },
  charm: { pos: 'buys as the clock runs', neg: 'sells as the clock runs', posBoth: 'both buy as the clock runs', negBoth: 'both sell as the clock runs', posWhy: 'each passing session makes dealers buy stock there', negWhy: 'each passing session makes dealers sell stock there' },
  color: { pos: 'gamma fades', neg: 'gamma builds', posBoth: 'both fade gamma', negBoth: 'both build gamma', posWhy: 'dealers’ gamma per 1% is shrinking as the session runs', negWhy: 'dealers’ gamma per 1% is growing as the session runs' },
  vomma: { pos: 'vega falls with vol', neg: 'vega rises with vol', posBoth: 'both lose vega as vol rises', negBoth: 'both gain vega as vol rises', posWhy: 'a vol rise takes dealer vega off there', negWhy: 'a vol rise adds dealer vega there' },
  speed: { pos: 'gamma falls with price', neg: 'gamma rises with price', posBoth: 'both lose gamma as price rises', negBoth: 'both add gamma as price rises', posWhy: 'a 1% rise takes dealer gamma off there', negWhy: 'a 1% rise adds dealer gamma there' },
  veta: { pos: 'vega fades', neg: 'vega builds', posBoth: 'both fade vega', negBoth: 'both build vega', posWhy: 'dealer vega is shrinking as the session runs', negWhy: 'dealer vega is growing as the session runs' },
  zomma: { pos: 'gamma falls with vol', neg: 'gamma rises with vol', posBoth: 'both lose gamma as vol rises', negBoth: 'both add gamma as vol rises', posWhy: 'a one-point vol rise takes dealer gamma off there', negWhy: 'a one-point vol rise adds dealer gamma there' },
};
export const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'vega $', vanna: 'VANNA', charm: 'CHARM', color: 'COLOR', vomma: 'VOMMA', speed: 'SPEED', veta: 'VETA', zomma: 'ZOMMA' };

/** Each greek in one plain sentence — the hover on every label that prints them side by side */
export const GREEK_EXPLAIN: Record<Greek, string> = {
  gex: 'GEX (gamma): the stock dealers must trade for a 1% move — positive, they absorb moves; negative, they amplify them',
  dex: 'DEX (delta): the dealers’ option delta in dollars of stock, if they are long the calls and short the puts — they hold the opposite in stock',
  vex: 'Dollar vega: what the dealers’ option book gains or loses if implied volatility moves one point. Not vanna — vanna is the stock that vol makes them trade.',
  vanna: 'Vanna: the stock dealers must buy or sell if implied volatility moves one point. Not dollar vega.',
  charm: 'CHARM: the stock dealers must buy or sell as a day passes, with price and vol unchanged — the clock pulling on their hedges',
  color: 'COLOR: how the gamma-per-1% book changes as this session runs, from each contract’s own vol — the slope right now, not a forecast of tomorrow’s gamma',
  vomma: 'VOMMA: how much vega the book gains or loses when implied volatility moves one point, from each contract’s own vol',
  speed: 'SPEED: how much the gamma-per-1% book changes when the underlying moves one dollar',
  veta: 'VETA: how vega changes as this session runs, from each contract’s own vol — the slope right now, not a forecast of tomorrow’s vega',
  zomma: 'ZOMMA: how much the gamma-per-1% book changes when implied volatility moves one point',
};

export interface CompareLevel {
  strike: number;
  /** Signed percent of spot */
  distPct: number;
  /** |net| parked there — gamma's for the walls, the chosen greek's for its supreme */
  weight: number;
}

export interface CompareSide {
  ticker: string;
  spot: number;
  changePct: number;
  regime: GammaRegime | null;
  flip: number | null;
  /** Signed percent, flip − spot */
  flipDistPct: number | null;
  /** One expected move for the minutes left, dollars — and as percent of spot. Null when this name has no real implied move. */
  sigmaLeft: number | null;
  /** "by Nov 20" when the move runs to a later expiry than the coming session — null for the close */
  horizon: string | null;
  /** Which number the move is ("the vendor's implied move into Oct 23"). Empty when there is no move. */
  moveWords: string;
  sigmaLeftPct: number | null;
  sigmaDay: number | null;
  scales: DistanceScales;
  levels: ExposureLevels;
  /** Every strike in the window, ascending, the day's net parked there — one list per greek */
  rows: Record<Greek, GexLevel[]>;
  heaviest: Record<Greek, number>;
  /** The walls are gamma's — a wall is a gamma idea */
  callWall: CompareLevel;
  putWall: CompareLevel;
  /** The heaviest strike, per greek — the one the Map's supreme follows when the greek changes */
  supreme: Record<Greek, CompareLevel>;
  /** Net GEX in the RETAIL sign (data/board.ts retailNet): positive = dealers long gamma, hedging absorbs moves;
      negative = short gamma, it amplifies them — the Board's own figure for the same contracts */
  netGex: number;
  /** Share of the book's gamma that expires today, percent — the Board's figure (uwBook peekBellShare) */
  bellShare: number | null;
  /** Why there is no share: nothing expires today on this name, or the list is not in yet */
  bellWhy: 'none' | 'wait' | null;
  watch: BoardRow['watch'];
  /** The most likely close, and its odds in percent */
  /** The close's lean — the desk agenda's (data/agenda.ts closesNear: only past LEAN_MIN) */
  closes: { strike: number; odds: number } | null;
  /** The best single strike's odds even when it is no lean */
  closeTop: { strike: number; odds: number } | null;
  /* the book's read for two names: what the card prints */
  /** The snapshot the side was built from — the windows' history is read off it (data/replay.ts) */
  snapshot: MarketSnapshot;
  /** The book's strikes, descending, every greek's legs at each — the heaviest list, the strike's legs and greeks */
  strikes: StrikeExposure[];
  /** The heaviest |net| per greek across the window — the figures' ramp */
  maxAbs: ExposureProfileData['maxAbs'];
  /** The book read as one sentence (data/gex.ts readHeatPattern) */
  read: string;
  /** How many expiries the calendar holds */
  expiryCount: number;
  /** The contracts this side reads — its history windows must read the same ones */
  expiry: ExposureExpiry;
}

export interface Compare {
  a: CompareSide;
  b: CompareSide;
  inSession: boolean;
  /** Whose expected move is wider, and by how much — null when either name has no real move */
  wider: { ticker: string; ratio: number } | null;
  sentence: string;
}

/** The name a comparison opens against: the index twin when there is one, else the next name on the list */
export function partnerFor(ticker: string): string {
  const twins: Record<string, string> = { SPY: 'QQQ', QQQ: 'SPY', IWM: 'SPY', DIA: 'SPY' };
  if (twins[ticker]) return twins[ticker];
  const list = UNIVERSE.map(u => u.ticker);
  return list.find(t => t !== ticker) ?? ticker;
}

/** A strike's distance from spot in the ruler's unit — null when the ruler has no scale yet */
export function distanceIn(delta: number, spot: number, unit: DistanceUnit, scales: DistanceScales): number | null {
  switch (unit) {
    case '$':
      return delta;
    case '%':
      return spot > 0 ? (delta / spot) * 100 : null;
    case 'ATR':
      return scales.atr !== null && scales.atr > 0 ? delta / scales.atr : null;
    default:
      return scales.sigma !== null && scales.sigma > 0 ? delta / scales.sigma : null;
  }
}

/** The ruler two names share: dollars do not compare across names, so '$' reads as percent */
export const sharedUnit = (unit: DistanceUnit): Exclude<DistanceUnit, '$'> => (unit === '$' ? '%' : unit);

/** "+0.59%" · "+0.42 ATR" · "+1.10σ" — a distance on the shared ruler */
export function fmtShared(v: number, unit: Exclude<DistanceUnit, '$'>): string {
  const sign = v < 0 ? '−' : '+';
  const a = Math.abs(v);
  if (unit === '%') return `${sign}${a.toFixed(2)}%`;
  if (unit === 'ATR') return `${sign}${a.toFixed(2)} ATR`;
  return `${sign}${a.toFixed(2)}σ`;
}

/** One book, on the contracts the reader picked — today's by default */
export function buildCompareSide(snapshot: MarketSnapshot, clock: AheadClock, expiry: ExposureExpiry = '0DTE'): CompareSide | null {
  if (!snapshot.chain || snapshot.chain.length === 0) return null;
  const { ticker, spot } = snapshot;
  let profile;
  try {
    profile = buildExposureProfile(snapshot, expiry, WINDOW);
  } catch {
    return null;
  }
  /* The flip off the same contracts as the walls: with another expiry picked here, the gauge reads that expiry's chain. */
  const lens = snapshot.liveBook && snapshot.uwChains?.[expiry]?.length ? { ...snapshot, chain: snapshot.uwChains[expiry]! } : snapshot;
  const gauge = buildFlipGauge(lens);
  /* a real implied move only: the term's, or this name's own vol. Never a 20% stand-in, and never spot × 1%. */
  const iv = peekIv(ticker);
  const date = scopeDateOf(lens);
  const day = snapshot.liveBook ? peekDaySigma(ticker, date) : iv != null ? daySigmaOfIv(spot, iv) : null;
  const move = snapshot.liveBook ? peekScopeMove(ticker, date) : null;
  let sigmaLeft: number | null = null;
  let sigmaDay: number | null = null;
  let horizon: string | null = null;
  let moveWords = '';
  if (move?.multi && move.move > 0) {
    sigmaLeft = move.move;
    sigmaDay = day != null && day > 0 ? day : move.move;
    horizon = move.until ? `by ${monDayOf(move.until)}` : null;
    moveWords = move.words;
  } else if (day != null && day > 0) {
    sigmaDay = day;
    const left = snapshot.liveBook ? peekMoveToClose(ticker, date, clock.minutesLeft) : null;
    const scaled = left != null && left > 0 ? left : sigmaOverMinutes(day, clock.minutesLeft);
    sigmaLeft = scaled > 0 ? scaled : null;
    moveWords = move?.words ?? (iv != null ? 'the 30-day implied vol over one session' : 'the implied move');
  }
  const scales: DistanceScales = { atr: sessionAtr(bookCandles(ticker) ?? []), sigma: sigmaDay };

  const rows = {} as Record<Greek, GexLevel[]>;
  const heaviest = {} as Record<Greek, number>;
  const none = (): CompareLevel => ({ strike: spot, distPct: 0, weight: 0 });
  const supreme = {} as Record<Greek, CompareLevel>;
  for (const g of GREEKS) {
    rows[g] = [];
    heaviest[g] = 1;
    supreme[g] = none();
  }
  for (const s of [...profile.strikes].reverse()) {
    for (const g of GREEKS) {
      const value = s[g].net;
      rows[g].push({ strike: s.strike, value });
      heaviest[g] = Math.max(heaviest[g], Math.abs(value));
      if (Math.abs(value) > supreme[g].weight) supreme[g] = { strike: s.strike, distPct: ((s.strike - spot) / spot) * 100, weight: Math.abs(value) };
    }
  }
  /* The walls, weighed in gamma */
  const at = (k: number): CompareLevel => ({
    strike: k,
    distPct: ((k - spot) / spot) * 100,
    /* off the drawn window the level still weighs what its strike carries on these contracts */
    weight: Math.abs(rows.gex.find(r => Math.abs(r.strike - k) < 1e-9)?.value ?? lens.chain.find(n => Math.abs(n.strike - k) < 1e-9)?.netGex ?? 0),
  });

  /* the named levels are levelsFor's on the two Levels scopes, drawn or not */
  const lv = snapshot.liveBook && (expiry === '0DTE' || expiry === 'ALL') ? levelsFor(ticker, expiry) : null;
  if (lv) supreme.gex = at(lv.supreme);
  else supreme.gex = at(profile.levels.supreme);
  /* no other scope's levels under this one's name: a Levels scope with no levelsFor reading yet, or a picked expiry whose
     chain has not landed, is not final */
  const scoped = expiry === '0DTE' || expiry === 'ALL';
  /* (a picked expiry the name does not list never lands — once every date is in, the page reads what there is) */
  const ownMissing = !!snapshot.liveBook && (scoped ? !lv : !snapshot.uwChains?.[expiry]?.length && scopeDatesPending(ticker, 'ALL'));
  const levels: ExposureLevels = lv
    ? { ...profile.levels, supreme: lv.supreme, callWall: lv.callWall ?? profile.levels.callWall, putWall: lv.putWall ?? profile.levels.putWall, flip: lv.flip ?? profile.levels.flip, flipFound: lv.flip != null, complete: profile.levels.complete && lv.complete }
    : ownMissing
      ? { ...profile.levels, complete: false }
      : profile.levels;
  const flipAt = lv ? lv.flip : gauge.flip;

  let surface: ExposureSurface | null = null;
  const bell = peekBellShare(ticker);
  try {
    surface = buildExposureSurface(snapshot, 20, CALENDAR_DTES);
  } catch {
    /* no surface for this name yet */
  }
  /* the likeliest close is the desk agenda's: the same build, the same 1σ and the same LEAN_MIN */
  const agenda = deskAgenda(snapshot, expiry, clock, 'matters', watchSurface(snapshot));
  const lead = agenda?.first[0];
  const watch: BoardRow['watch'] = watchFrom(lead);

  return {
    ticker,
    spot,
    changePct: snapshot.changePercent,
    /* the regime is levelsFor's: the sign of the scope's whole net */
    regime: lv ? lv.regime : gauge.regime,
    flip: flipAt,
    flipDistPct: flipAt != null && spot > 0 ? ((flipAt - spot) / spot) * 100 : null,
    sigmaLeft,
    horizon,
    moveWords,
    sigmaLeftPct: sigmaLeft != null && spot > 0 ? (sigmaLeft / spot) * 100 : null,
    sigmaDay,
    scales,
    levels,
    rows,
    heaviest,
    callWall: at(levels.callWall),
    putWall: at(levels.putWall),
    supreme,
    netGex: snapshot.liveBook ? netGexOf(lens.chain) : retailNet(profile.netGex),
    bellShare: bell.share,
    bellWhy: bell.share == null ? bell.why : null,
    watch,
    closes: agenda?.closesNear ?? null,
    closeTop: agenda?.closeTop ?? null,
    snapshot,
    strikes: profile.strikes,
    maxAbs: profile.maxAbs,
    /* the walls' words follow each strike's own net sign (core/walls.ts) — retail sign, off the scope's contracts */
    read: readRegime(levels, k => (lv ? lv.netAt(k) : (() => {
      const n = lens.chain.find(x => Math.abs(x.strike - k) < 1e-9);
      return n ? retailNet(n.netGex) : null;
    })())).read,
    /* the expiries these figures read: one on Today or a picked date, every listed one on All expiries */
    expiryCount: expiry === 'ALL' ? (snapshot.uwExpiries?.length || surface?.expiries.length || 1) : 1,
    expiry,
  };
}

/* ---- the ruler's reach ------------------------------------------------------------ */

/** How far the ruler shows each way, in the day's expected moves — 'all' is both whole books */
export type Reach = 'one' | 'two' | 'three' | 'all';
export const REACH_OPTIONS: { value: Reach; label: string; hint: string }[] = [
  { value: 'one', label: 'One expected move', hint: 'About two days in three end inside it' },
  { value: 'two', label: 'Two expected moves', hint: 'About what a day can reach — nineteen days in twenty' },
  { value: 'three', label: 'Three expected moves', hint: 'Almost every day ends inside it' },
  { value: 'all', label: 'Everything', hint: 'Every strike either name carries' },
];

/* ---- the pair ------------------------------------------------------------------ */

export interface PairPoint {
  /** The session's last bar, unix seconds */
  time: number;
  /** The first name's close over the second's */
  ratio: number;
  /** The two closes the ratio was made of — the card says them, so the figure is a division a reader can check */
  closeA: number;
  closeB: number;
}

/** Where a day sits against the usual range, in words a person can picture (never "+0.8σ"): how far toward an edge of
    the average ± one usual swing, or how far past. */
interface PairPlace {
  where: 'inside' | 'above' | 'below';
  /** Which name is further ahead than on an average day — neither, on the average */
  ahead: 'a' | 'b' | null;
  words: string;
}
export function pairPlace(ratio: number, mean: number | null, sd: number | null): PairPlace | null {
  if (mean == null || sd == null || !(sd > 0)) return null;
  const z = (ratio - mean) / sd;
  const side = z >= 0 ? 'top' : 'bottom';
  const m = Math.abs(z);
  if (m < 0.1) return { where: 'inside', ahead: null, words: 'on its average' };
  if (m <= 1) return { where: 'inside', ahead: z > 0 ? 'a' : 'b', words: `inside the usual range · ${Math.round(m * 100)}% of the way to its ${side}` };
  return { where: z > 0 ? 'above' : 'below', ahead: z > 0 ? 'a' : 'b', words: `${z > 0 ? 'above' : 'below'} the usual range · ${Math.round((m - 1) * 100)}% past its ${side}` };
}

export interface Pair {
  a: string;
  b: string;
  /** One point per completed session, oldest first */
  sessions: PairPoint[];
  /** Today's path, minute by minute, on the minutes both names printed */
  today: PairPoint[];
  now: number | null;
  mean: number | null;
  sd: number | null;
  /** How far today sits from the average, in standard deviations of the sessions */
  z: number | null;
  /** Sessions whose close sat outside the usual band */
  outside: number;
  sentence: string;
}

/** The ratio of the two names' closes, session by session and today minute by minute */
/** One session's close, from the vendor's daily bars */
export interface DailyClose {
  /** New York calendar date, YYYY-MM-DD */
  date: string;
  close: number;
}

/* The sessions come from the daily bars when they are in (months of them); the minute bars still draw today. */
export function buildPair(a: string, b: string, dailyA?: readonly DailyClose[] | null, dailyB?: readonly DailyClose[] | null): Pair {
  const ba = bookCandles(a) ?? [];
  const bb = bookCandles(b) ?? [];
  const sessionsOf = (bars: readonly Candle[]) => {
    const starts = sessionStarts(bars, 1);
    return starts.map((s, i) => bars.slice(s, i + 1 < starts.length ? starts[i + 1] : bars.length));
  };
  const sa = sessionsOf(ba);
  const sb = sessionsOf(bb);
  /* Sessions pair by their day: the close of each against the close of the other on the same day */
  const dayOf = (t: number) => Math.floor((t - 4 * 3600) / 86400);
  const closeB = new Map<number, number>();
  for (const s of sb) if (s.length) closeB.set(dayOf(s[s.length - 1].time), s[s.length - 1].close);
  const sessions: PairPoint[] = [];
  for (const s of sa) {
    if (!s.length) continue;
    const last = s[s.length - 1];
    const cb = closeB.get(dayOf(last.time));
    if (cb) sessions.push({ time: last.time, ratio: last.close / cb, closeA: last.close, closeB: cb });
  }
  if (dailyA?.length && dailyB?.length) {
    const closeOn = new Map(dailyB.map(d => [d.date, d.close]));
    const lastIntraday = sessions[sessions.length - 1];
    const lastDay = lastIntraday ? new Date((lastIntraday.time - 4 * 3600) * 1000).toISOString().slice(0, 10) : null;
    const fromDaily: PairPoint[] = [];
    for (const d of [...dailyA].sort((x, y) => x.date.localeCompare(y.date))) {
      const cb = closeOn.get(d.date);
      if (!(cb && cb > 0 && d.close > 0) || d.date === lastDay) continue;
      fromDaily.push({ time: Math.floor(Date.parse(`${d.date}T20:00:00Z`) / 1000), ratio: d.close / cb, closeA: d.close, closeB: cb });
    }
    if (fromDaily.length >= 5) {
      const tail = fromDaily.slice(-120);
      sessions.splice(0, sessions.length, ...tail, ...(lastIntraday ? [lastIntraday] : []));
    }
  }
  /* The still-forming session is today's, off the average */
  const done = sessions.slice(0, -1);
  const todayA = sa[sa.length - 1] ?? [];
  const todayB = sb[sb.length - 1] ?? [];
  const bAt = new Map(todayB.map(x => [x.time, x.close]));
  const today: PairPoint[] = [];
  for (const x of todayA) {
    const cb = bAt.get(x.time);
    if (cb) today.push({ time: x.time, ratio: x.close / cb, closeA: x.close, closeB: cb });
  }
  /* one quote on the page: today's point is the two last prices the heads print */
  const qa = peekSpot(a);
  const qb = peekSpot(b);
  if (qa != null && qb != null && qb > 0 && today.length) today[today.length - 1] = { ...today[today.length - 1], ratio: qa / qb, closeA: qa, closeB: qb };
  const now = today.length ? today[today.length - 1].ratio : qa != null && qb != null && qb > 0 ? qa / qb : sessions.length ? sessions[sessions.length - 1].ratio : null;
  let mean: number | null = null;
  let sd: number | null = null;
  if (done.length >= 5) {
    mean = done.reduce((s, p) => s + p.ratio, 0) / done.length;
    const m = mean;
    sd = Math.sqrt(done.reduce((s, p) => s + (p.ratio - m) * (p.ratio - m), 0) / Math.max(1, done.length - 1));
  }
  const z = now != null && mean != null && sd != null && sd > 0 ? (now - mean) / sd : null;
  const outside = mean != null && sd != null ? done.filter(p => Math.abs(p.ratio - mean!) > sd!).length : 0;
  /* the sentence: what the figure is, what is usual, where today sits, how often it leaves */
  const place = now != null ? pairPlace(now, mean, sd) : null;
  const f3 = (v: number) => v.toFixed(v >= 10 ? 2 : 3);
  const sentence =
    place == null || mean == null || sd == null || now == null
      ? `Not enough sessions on the tape yet to say what is usual for ${a} against ${b}.`
      : `One ${a} share is worth ${f3(now)} ${b} shares right now, against ${f3(mean)} on an average day over the last ${done.length} sessions. ` +
        (place.where === 'inside'
          ? place.ahead == null
            ? `That is right on its average — neither name has pulled ahead of the other.`
            : `That is inside the usual range (${f3(mean - sd)} to ${f3(mean + sd)}): ${place.ahead === 'a' ? a : b} is a little ahead of where the two usually sit, nothing unusual.`
          : `That is ${place.where} the usual range (${f3(mean - sd)} to ${f3(mean + sd)}): ${place.ahead === 'a' ? a : b} has run further ahead of ${place.ahead === 'a' ? b : a} than it usually does.`) +
        ` ${outside} of those ${done.length} days closed outside the range.`;
  return { a, b, sessions, today, now, mean, sd, z, outside, sentence };
}

/* on the flip (within 0.05%, data/gex.ts readHeatPattern's AT_FLIP) a name is neither regime — the panel says "sitting on
   the flip", so the sentence under the ruler must not say "amplify" for it */
const onFlip = (s: CompareSide) => s.flipDistPct != null && Math.abs(s.flipDistPct) < 0.05;
export const regimeWord = (s: CompareSide) => (onFlip(s) ? 'go either way on' : s.regime === 'LONG' ? 'absorb' : s.regime === 'SHORT' ? 'amplify' : 'lean one way');

/* One "at price" (core/walls.ts wallPlace, 0.05%) */
const placeWords = (strike: number, spot: number, distPct: number): string => {
  const p = wallPlace(strike, spot);
  return p === 'at' ? 'right at price' : `${Math.abs(distPct).toFixed(2)}% ${p}`;
};

export function buildCompare(a: CompareSide, b: CompareSide, clock: AheadClock): Compare {
  const aPct = a.sigmaLeftPct;
  const bPct = b.sigmaLeftPct;
  const ratioRaw = aPct != null && bPct != null && aPct > 0 && bPct > 0 ? bPct / aPct : null;
  const wider = ratioRaw == null ? null : ratioRaw >= 1 ? { ticker: b.ticker, ratio: ratioRaw } : { ticker: a.ticker, ratio: 1 / ratioRaw };
  const narrower = wider == null ? null : wider.ticker === a.ticker ? b.ticker : a.ticker;
  const nearerCall = Math.abs(a.callWall.distPct) <= Math.abs(b.callWall.distPct) ? a : b;
  const nearerPut = Math.abs(a.putWall.distPct) <= Math.abs(b.putWall.distPct) ? a : b;
  const regimes =
    onFlip(a) || onFlip(b)
      ? [a, b].map(s => (onFlip(s) ? `${s.ticker} sits on its flip` : `dealers ${regimeWord(s)} moves on ${s.ticker}`)).join(' and ')
      : a.regime && b.regime && a.regime === b.regime
        ? `dealers ${regimeWord(a)} moves on both`
        : `dealers ${regimeWord(a)} moves on ${a.ticker} and ${regimeWord(b)} them on ${b.ticker}`;
  const when = clock.inSession ? 'to the close' : 'next session';
  const moveClause = wider && narrower ? `${wider.ticker} has the wider expected move ${when}, ${wider.ratio.toFixed(1)}× ${narrower}'s; ` : '';
  const lead = moveClause ? regimes : `${regimes.charAt(0).toUpperCase()}${regimes.slice(1)}`;
  const sentence =
    `${moveClause}${lead}. ` +
    `${nearerCall.ticker}'s call wall (the most call gamma) is the nearer at ${fmtStrike(nearerCall.callWall.strike)}, ${placeWords(nearerCall.callWall.strike, nearerCall.spot, nearerCall.callWall.distPct)}; ${nearerPut.ticker}'s put wall (the most put gamma) the nearer at ${fmtStrike(nearerPut.putWall.strike)}, ${placeWords(nearerPut.putWall.strike, nearerPut.spot, nearerPut.putWall.distPct)}.`;
  return { a, b, inSession: clock.inSession, wider, sentence };
}
