/* The Stocks board: each house name read off its screener row (stockOverview.readOfScreen, the name page's own
   function), then rolled up by sector. States, never orders. */

import { SECTORS, type Sector } from './universe';
import { readOfScreen } from './stockOverview';
import { useLiveStocks } from './liveFiles';

export type StockVerdict = 'ACCUMULATE' | 'HOLD' | 'AVOID';
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
  /** The extended-hours print and its move off the regular close, outside the session — null in it (the price is the
      regular one either way) */
  extPrice?: number | null;
  extPct?: number | null;
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
  /** Each scored sleeve's measures in words, with their figures ("RSI, 14 sessions 39 · ADX … 18 · down on the week") —
      the bar's hover, so a bar is never a shape alone */
  sleeveNotes?: Partial<Record<keyof StockSleeves, string>>;
  /** Why a quiet sleeve was left out, in words ("only $412K of premium, too thin to read") */
  quietWhy?: Partial<Record<keyof StockSleeves, string>>;
  /** Listed, and not on the screener. No sleeve is invented. */
  listedOnly?: boolean;
  /** The New York session the price and its change belong to */
  sessionDate?: string;
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
  /** The name's regular closes, read with the row */
  closes?: readonly { date: string; close: number }[] | null;
}): StockPick {
  const read = readOfScreen(input.row, input.closes);
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
    sleeveNotes: {
      momentum: noteOf(at('trend')?.factors),
      quality: noteOf(at('numbers')?.factors),
      flow: noteOf(at('money')?.factors),
    },
    quietWhy: {
      momentum: whyQuiet(at('trend')?.factors),
      quality: whyQuiet(at('numbers')?.factors),
      flow: whyQuiet(at('money')?.factors),
    },
  };
}
/** A left-out pillar's reason: its figures, then each distinct reason once (the last clause of a note that gives one) */
function whyQuiet(fs: readonly { label: string; value: string; note: string }[] | undefined): string {
  if (!fs || !fs.length) return 'none of its measures are on the screener row';
  const reasons = [...new Set(fs.filter(f => f.note.includes(' — ')).map(f => f.note.split(' — ').pop()!))];
  return `${fs.map(f => `${f.label} ${f.value}`).join(' · ')}${reasons.length ? ` — ${reasons.join('; ')}` : ''}`;
}
const noteOf = (fs: readonly { label: string; value: string; context?: boolean }[] | undefined): string | undefined =>
  fs && fs.length ? fs.filter(f => !f.context).map(f => `${f.label}: ${f.value}`).join(' · ') : undefined;

/** Above its 50-day simple average — null when the screener has no average for the name */
export const aboveFifty = (p: StockPick): boolean | null => (p.sma50 != null && p.sma50 > 0 && p.price > 0 ? p.price > p.sma50 : null);

/** The live board, strongest first — for any tile or page that shows it */
export const useStockBoard = (): StockPick[] => useLiveStocks().picks;

export function buildSectorBoard(picks: StockPick[]): SectorRow[] {
  const weeksOf = (xs: StockPick[]) => xs.map(p => p.weekPct).filter((n): n is number => n != null);
  const monthsOf = (xs: StockPick[]) => xs.map(p => p.monthPct).filter((n): n is number => n != null);
  const benchW = avg(weeksOf(picks));
  const benchM = avg(monthsOf(picks));
  return SECTORS.map(sector => picks.filter(p => p.sector === sector))
    .filter(members => members.length > 0)
    .map(members => {
      const sector = members[0].sector;
      const score = Math.round(members.reduce((a, p) => a + p.composite, 0) / members.length);
      /* a name with no week or month return is left out of its sector's average, never counted as flat */
      const weeks = weeksOf(members);
      const months = monthsOf(members);
      const rs1w = weeks.length ? avg(weeks) - benchW : 0;
      const rs1m = months.length ? avg(months) - benchM : 0;
      const placed = members.map(aboveFifty).filter((v): v is boolean => v != null);
      const breadthPct = Math.round((placed.filter(Boolean).length / Math.max(placed.length, 1)) * 100);
      const phase: RotationPhase = rs1m >= 0 && rs1w >= 0 ? 'LEADING' : rs1m < 0 && rs1w >= 0 ? 'IMPROVING' : rs1m >= 0 && rs1w < 0 ? 'WEAKENING' : 'LAGGING';
      return { sector, score, rs1w, rs1m, breadthPct, count: members.length, ret1w: weeks.length ? avg(weeks) : null, ret1m: months.length ? avg(months) : null, phase };
    })
    .sort((a, b) => b.score - a.score || phaseRank(b.phase) - phaseRank(a.phase));
}

function phaseRank(p: RotationPhase): number {
  return p === 'LEADING' ? 3 : p === 'IMPROVING' ? 2 : p === 'WEAKENING' ? 1 : 0;
}
