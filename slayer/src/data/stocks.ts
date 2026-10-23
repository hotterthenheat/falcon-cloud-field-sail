/*
==================================================
  SLAYER TERMINAL - COMMON STOCKS ENGINE (stocks.ts)
  Ranks the shared universe on four sleeves —
  momentum, quality, flow and news — then rolls the
  same sleeves up into a sector rotation board, so
  "what to buy" and "which sectors are worth being
  in" come from one composite, not two opinions.
==================================================
*/

import { dayKey, hGauss, hRange } from '../core/rng';
import { tickerSentiment } from './news';
import { SECTORS, UNIVERSE, type Sector } from './universe';
import { readOfScreen } from './stockOverview';

export type StockVerdict = 'ACCUMULATE' | 'HOLD' | 'AVOID';
export type SectorVerdict = 'OVERWEIGHT' | 'NEUTRAL' | 'UNDERWEIGHT';
export type RotationPhase = 'LEADING' | 'IMPROVING' | 'WEAKENING' | 'LAGGING';

export interface StockSleeves {
  /** All 0–100 */
  momentum: number;
  quality: number;
  flow: number;
  news: number;
}

export interface StockPick {
  ticker: string;
  name: string;
  sector: Sector;
  price: number;
  changePct: number;
  sleeves: StockSleeves;
  /** Sleeves the feed did not score. They stay out of the screen and print as a dash. */
  quiet: (keyof StockSleeves)[];
  composite: number;
  verdict: StockVerdict;
  /** The read in plain words — what is for the name, what is against it */
  thesis: string;
  /** Real closes along the year: a year, six months, three months, a month, a week, now. Not a filled daily path. */
  trend: number[];
  /** Real one-week and one-month moves, percent. Absent on the house screen. */
  weekPct?: number;
  monthPct?: number;
  /** The 50-day simple average, from the screener; absent on the house screen */
  sma50?: number | null;
}

export interface SectorRow {
  sector: Sector;
  /** Composite of member stocks, 0–100 */
  score: number;
  /** 1-week relative strength vs the tape, signed % */
  rs1w: number;
  /** 1-month relative strength, signed % */
  rs1m: number;
  /** % of members above their 50-day average (those with one) */
  breadthPct: number;
  /** Names the sector holds on this board */
  count: number;
  /** The members' average one-week and one-month return, signed % — a real return, not relative */
  ret1w: number | null;
  ret1m: number | null;
  phase: RotationPhase;
  verdict: SectorVerdict;
  note: string;
  leaders: string[];
}

// ---- sleeves ------------------------------------------------------------------

const SLEEVE_WEIGHTS = { momentum: 0.32, quality: 0.24, flow: 0.26, news: 0.18 } as const;

function sleevesFor(ticker: string, day: string): StockSleeves {
  const s = (tag: string) => `${ticker}-${day}-stk-${tag}`;
  return {
    momentum: Math.round(hRange(s('mom'), 18, 96)),
    quality: Math.round(hRange(s('qual'), 25, 94)),
    flow: Math.round(hRange(s('flow'), 15, 95)),
    news: Math.round(50 + tickerSentiment(ticker) * 48),
  };
}

function composite(sl: StockSleeves, quiet: readonly (keyof StockSleeves)[] = []): number {
  let weight = 0;
  let sum = 0;
  (Object.keys(SLEEVE_WEIGHTS) as (keyof StockSleeves)[]).forEach(k => {
    if (quiet.includes(k)) return;
    weight += SLEEVE_WEIGHTS[k];
    sum += sl[k] * SLEEVE_WEIGHTS[k];
  });
  return weight > 0 ? Math.round(sum / weight) : 50;
}

/** The four sleeves in plain words (the Record walk, 2026-09-10): the trend,
    the numbers, the money, the news — what each says when it is for a name
    and when it is against it. The figures stay inside the engine. */
const SLEEVE_WORDS: Record<keyof StockSleeves, { name: string; good: string; bad: string }> = {
  momentum: { name: 'the trend', good: 'the trend is up', bad: 'the trend is broken' },
  quality: { name: 'the numbers', good: 'the numbers are clean', bad: 'the numbers are slipping' },
  flow: { name: 'the money', good: 'the money is buying', bad: 'the money is selling' },
  news: { name: 'the news', good: 'the news helps', bad: 'the news hurts' },
};

/** The read: what is for the name, what is against it, the soft spot — short
    enough for a grid cell. States, not orders: it says what the screen SAYS,
    never what to do about it (the Compass doctrine). */
function thesisFor(sl: StockSleeves, verdict: StockVerdict, quiet: readonly (keyof StockSleeves)[] = []): string {
  const ranked = (Object.keys(SLEEVE_WORDS) as (keyof StockSleeves)[])
    .filter(k => !quiet.includes(k))
    .map(k => ({ v: sl[k], ...SLEEVE_WORDS[k] }))
    .sort((a, b) => b.v - a.v);
  const [best, second] = ranked;
  const worst = ranked[ranked.length - 1];
  const next = ranked[ranked.length - 2];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (!best || !worst) return 'Not enough on the feed to screen this name.';
  if (!second || best === worst) return cap(`${best.v >= 50 ? best.good : best.bad}.`);
  if (verdict === 'ACCUMULATE') return cap(`${best.good}, ${second.good}; ${worst.v < 45 ? `${worst.name} ${worst.name === 'the numbers' ? 'are' : 'is'} the one soft spot` : 'nothing against it'}.`);
  if (verdict === 'AVOID') return cap(`${worst.bad}${next ? `, ${next.bad}` : ''}; ${best.v > 65 ? `${best.name} alone cannot carry it` : 'nothing in its favour'}.`);
  return cap(`${best.good} but ${worst.bad} — a catalyst decides.`);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** A name scored from the screener's own fields. News stays out: the wire marks headlines neutral and often names no ticker. */
export function pickFromLive(input: {
  ticker: string;
  name: string;
  sector: Sector;
  price: number;
  changePct: number;
  weekPct: number | null;
  monthPct: number | null;
  rsi: number | null;
  /** Earnings growth over four quarters, as a fraction (0.22 = +22%). */
  epsGrowth: number | null;
  yearClose: number | null;
  sixClose: number | null;
  threeClose: number | null;
  monthClose: number | null;
  weekClose: number | null;
  bullish: number | null;
  bearish: number | null;
  sma50?: number | null;
  /** The vendor's screener row itself — the read is taken off it, by the same function the name's page uses */
  row: Record<string, unknown>;
}): StockPick {
  /* ONE READ (the retail test, 2026-10-23: AAPL "GOOD" here and "strong" on its page) — stockOverview.readOfScreen on
     the screener row, the page's own function on the page's own row */
  const read = readOfScreen(input.row);
  const at = (k: 'trend' | 'numbers' | 'money') => read.pillars.find(p => p.key === k);
  const quiet: (keyof StockSleeves)[] = ['news'];
  if (!at('trend')?.inRead) quiet.push('momentum');
  if (!at('numbers')?.inRead) quiet.push('quality');
  if (!at('money')?.inRead) quiet.push('flow');
  const sl: StockSleeves = { momentum: at('trend')?.score ?? 50, quality: at('numbers')?.score ?? 50, flow: at('money')?.score ?? 50, news: 50 };
  const comp = read.composite;
  const verdict: StockVerdict = read.screen === 'STRONG' ? 'ACCUMULATE' : read.screen === 'WEAK' ? 'AVOID' : 'HOLD';
  const trend = [input.yearClose, input.sixClose, input.threeClose, input.monthClose, input.weekClose, input.price].filter((n): n is number => n != null && n > 0);
  return {
    ticker: input.ticker,
    name: input.name,
    sector: input.sector,
    price: input.price,
    changePct: input.changePct,
    sleeves: sl,
    quiet,
    composite: comp,
    verdict,
    thesis: read.thesis,
    trend,
    weekPct: input.weekPct ?? undefined,
    monthPct: input.monthPct ?? undefined,
    sma50: input.sma50 ?? null,
  };
}

/** Above its 50-day simple average — null when the screener has no average for the name */
export const aboveFifty = (p: StockPick): boolean | null => (p.sma50 != null && p.sma50 > 0 && p.price > 0 ? p.price > p.sma50 : null);

// ---- public API ------------------------------------------------------------------

export function buildStockBoard(): StockPick[] {
  const day = dayKey();
  return UNIVERSE.map(u => {
    const sl = sleevesFor(u.ticker, day);
    const comp = composite(sl);
    const verdict: StockVerdict = comp >= 68 ? 'ACCUMULATE' : comp <= 46 ? 'AVOID' : 'HOLD';
    const changePct = hGauss(`${u.ticker}-${day}-chg`) * 1.4 * u.beta + (comp - 55) * 0.02;
    const trend: number[] = [];
    let level = 50;
    for (let i = 0; i < 30; i++) {
      level += hGauss(`${u.ticker}-${day}-tr-${i}`) * 3 + (comp - 55) * 0.06;
      trend.push(level);
    }
    return {
      ticker: u.ticker,
      name: u.name,
      sector: u.sector,
      price: Number((u.px * (1 + changePct / 100)).toFixed(2)),
      changePct,
      sleeves: sl,
      quiet: [],
      composite: comp,
      verdict,
      thesis: thesisFor(sl, verdict),
      trend,
    };
  }).sort((a, b) => b.composite - a.composite);
}

export function buildSectorBoard(picks: StockPick[]): SectorRow[] {
  const benchW = avg(picks.map(p => p.weekPct).filter((n): n is number => n != null));
  const benchM = avg(picks.map(p => p.monthPct).filter((n): n is number => n != null));
  const liveRs = picks.some(p => p.weekPct != null && p.monthPct != null);
  return SECTORS.map(sector => {
    const members = picks.filter(p => p.sector === sector);
    const score = Math.round(members.reduce((a, p) => a + p.composite, 0) / Math.max(members.length, 1));
    /* no week or month returns on the feed: relative strength is unknown (0), never a seeded figure */
    const rs1w = liveRs ? avg(members.map(p => p.weekPct ?? 0)) - benchW : 0;
    const rs1m = liveRs ? avg(members.map(p => p.monthPct ?? 0)) - benchM : 0;
    /* ABOVE THE 50-DAY, NOT RSI OVER 50 (the re-audit, 2026-10-22): the breadth is price against the 50-day average */
    const placed = members.map(aboveFifty).filter((v): v is boolean => v != null);
    const breadthPct = Math.round((placed.filter(Boolean).length / Math.max(placed.length, 1)) * 100);
    const weeks = members.map(p => p.weekPct).filter((n): n is number => n != null);
    const months = members.map(p => p.monthPct).filter((n): n is number => n != null);
    const phase: RotationPhase =
      rs1m >= 0 && rs1w >= 0 ? 'LEADING' : rs1m < 0 && rs1w >= 0 ? 'IMPROVING' : rs1m >= 0 && rs1w < 0 ? 'WEAKENING' : 'LAGGING';
    const verdict: SectorVerdict = score >= 64 && phase !== 'LAGGING' ? 'OVERWEIGHT' : score <= 48 || phase === 'LAGGING' ? 'UNDERWEIGHT' : 'NEUTRAL';
    const leaders = members.slice(0, 2).map(m => m.ticker);
    const note =
      verdict === 'OVERWEIGHT'
        ? `${phase === 'LEADING' ? 'Leadership intact' : 'Turning up'} — money is rotating in; ${leaders.join(' & ')} carry the group.`
        : verdict === 'UNDERWEIGHT'
          ? `${phase === 'LAGGING' ? 'Lagging on both windows' : 'Rolling over'} — relative strength argues against fresh exposure.`
          : 'Middle of the pack — own the single names that screen well, not the group.';
    return { sector, score, rs1w, rs1m, breadthPct, count: members.length, ret1w: weeks.length ? avg(weeks) : null, ret1m: months.length ? avg(months) : null, phase, verdict, note, leaders };
  }).sort((a, b) => b.score - a.score || phaseRank(b.phase) - phaseRank(a.phase));
}

function phaseRank(p: RotationPhase): number {
  return p === 'LEADING' ? 3 : p === 'IMPROVING' ? 2 : p === 'WEAKENING' ? 1 : 0;
}
