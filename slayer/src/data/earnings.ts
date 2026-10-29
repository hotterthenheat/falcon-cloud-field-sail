/* The earnings types and the board's calendar helpers. Every report comes off the vendor's calendar
   (earningsFeed.ts); nothing here is invented. */

import type { Sector } from './universe';
import { UNIVERSE } from './universe';
import { SECTOR_UNIVERSE } from './darkpool';
import { SP500_NYSE } from './sp500';
import { boardMondayIso, nyTodayIso } from './nyDate';

export type ReportSlot = 'BMO' | 'AMC';

export interface EarningsEvent {
  ticker: string;
  name: string;
  sector: Sector;
  price: number;
  /** Sessions until the report, 0 = today */
  daysOut: number;
  dateLabel: string;
  /** 1 = Monday … 5 = Friday (reports never land on weekends) */
  weekday: number;
  /** -1 the week before the board's (read on ask), 0 the board's week, 1 the week after */
  weekIdx: -1 | 0 | 1;
  /** true = company has officially set the date; false = still an analyst estimate */
  confirmed: boolean;
  /** A name the room would recognise — the board holds these; the list and the grid hold every report (isKnownName) */
  known: boolean;
  slot: ReportSlot;
  /** Straddle-implied move for the print, % */
  impliedMovePct: number;
  /** Market cap in dollars, when the calendar carried one. The board ranks by this, not by the size of the move. */
  marketCap?: number | null;
  /** Average absolute move over the last 8 prints, % */
  histAvgMovePct: number;
  /** The last 8 earnings-day moves, signed %, oldest first, each with the move its options priced (null if not on file) */
  pastMoves: { label: string; movePct: number; impliedPct?: number | null }[];
  /** implied ÷ realized — the mispricing everything hangs on */
  richness: number;
  /** The street's EPS estimate for the upcoming report, when the vendor's row for it carries one */
  nextEpsEst?: number | null;
  /** % of the last 8 quarters beaten */
  beatRate8q: number;
  ivRank: number;
  /** YYYY-MM-DD when the row came off the feed. */
  iso?: string;
  /** False until the last prints are in */
  history?: boolean;
  /** True once the report is out (its day has passed, or the vendor carries the session's reaction) */
  reported?: boolean;
  /** The stock's move the session after the report, signed % — the vendor's `reaction`, null until it is in */
  actualMovePct?: number | null;
  /** True while actualMovePct is the reacting session's move so far, off the live price */
  moveLive?: boolean;
  /** The New York session that reacts to the report: the report day before the open, the next session after the close */
  reactionIso?: string;
  /** How many past reports the usual move is the average of */
  histCount?: number;
  /** Past reports with both an actual and an estimate, split three ways — an in-line print is not a beat */
  beatCount?: number;
  inlineCount?: number;
  missCount?: number;
  /** False when the vendor has no time for the report ("unknown") — the slot is then not stated */
  timeKnown?: boolean;
  /** True when the date is the vendor's estimate, not one the company set */
  estimated?: boolean;
  /** True when the name is a fund (an ETF or a trust) — funds do not report earnings */
  fund?: boolean;
  /** A second share class whose reports the vendor files under another symbol (BBDO → BBD) */
  classOf?: string;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function labelFor(d: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/** The calendar date of a board cell, on New York's calendar from the feed's Monday; local midnight of that day */
export function weekDayDate(weekIdx: -1 | 0 | 1, weekday: number): Date {
  const [y, m, d] = boardMondayIso().split('-').map(Number);
  return new Date(y, m - 1, d + weekIdx * 7 + (weekday - 1));
}

/** Column header for the week board; "Today" is New York's today */
export function weekDayLabel(weekIdx: -1 | 0 | 1, weekday: number): { label: string; isToday: boolean } {
  const d = weekDayDate(weekIdx, weekday);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { label: labelFor(d), isToday: iso === nyTodayIso() };
}

export interface EarningsQuarter {
  label: string;
  epsEst: number;
  epsActual: number;
  epsBeat: boolean;
  /** Beat, in line (equal to the cent) or miss */
  epsResult?: 'beat' | 'inline' | 'miss';
  revEstB: number;
  revActualB: number;
  revBeat: boolean;
  /** The stock's move the session after that report, signed %. Missing on a live row that did not report one. */
  movePct: number;
  /** False when the vendor sent the quarter but not the next-session move. Absent means the figure is known. */
  moveKnown?: boolean;
}

/** One of the name's busiest contracts into the print — a market fact, never an idea */
export interface ActiveContract {
  id: string;
  right: 'CALL' | 'PUT';
  strike: number;
  /** "GS $500 call · exp 07/25" */
  label: string;
  /** Rough mid, dollars per share */
  mid: number;
  volume: number;
  oi: number;
  volOverOi: number;
  ivPct: number;
  /** Strike distance from spot, signed % */
  fromSpotPct: number;
  /** What "spot" is: the last price in the session, else the last regular close ("the Oct 22 close") */
  spotWord?: string;
  /** Move needed by expiry to break even on the mid, % */
  breakevenPct: number;
  /** The contract's expiry as a date key; the Weigher resolves it on its own calendar. */
  expiry: string;
}

export interface EarningsDossier {
  event: EarningsEvent;
  quarters: EarningsQuarter[];
  /** Past reports whose next-session move stayed inside the move its own options priced, of those with one on file */
  inside: { n: number; of: number } | null;
  /** Past reports whose next-session move was up, of the moves on file */
  up: { n: number; of: number } | null;
  /** Typical overnight IV deflation after this name reports, % */
  ivCrushPct: number;
  /** Extrinsic value an ATM option typically loses by next open, % */
  premiumLostPct: number;
  /** The 3 busiest calls on the name into the print, by volume */
  activeCalls: ActiveContract[];
  /** The 3 busiest puts */
  activePuts: ActiveContract[];
  live?: boolean;
  /** Overnight straddle loss is the vendor's history, not a model */
  crushKnown?: boolean;
  /** The busiest-contract read has finished */
  contractsReady?: boolean;
  /** The report after the one the page leads with (when that one is already out) */
  nextAfter?: { iso: string; dateLabel: string; slot: ReportSlot; timeKnown: boolean; estimated: boolean; confirmed: boolean; daysOut: number } | null;
}

/* ---- known names -------------------------------------------------------------------- */

/* A name the room would recognise: the house universe, the sector leaders, the S&P's NYSE half, any S&P 500 member
   or a market cap of $10B and up. Built on first ask so a module still loading is never read. */
let knownNames: Set<string> | null = null;
const KNOWN = (): Set<string> => (knownNames ??= new Set<string>([...UNIVERSE.map(u => u.ticker), ...SECTOR_UNIVERSE.flatMap(s => s.tickers), ...SP500_NYSE.map(t => t.symbol)]));
/** The feed's floor for a name the board shows without being in the S&P: $10B */
const KNOWN_CAP_FLOOR = 10_000_000_000;

export function isKnownName(ticker: string, facts?: { sp500?: boolean; marketCap?: number | null }): boolean {
  const t = ticker.toUpperCase();
  if (KNOWN().has(t)) return true;
  if (facts?.sp500) return true;
  return typeof facts?.marketCap === 'number' && facts.marketCap >= KNOWN_CAP_FLOOR;
}

export interface NextReport {
  ticker: string;
  name: string;
  /** Sessions until the report, 0 = today */
  daysOut: number;
  dateLabel: string;
  /** The report's date as a key. */
  iso: string;
  slot: ReportSlot;
  /** true = the company has set the date; false = an analyst estimate */
  confirmed: boolean;
  /** The report's event: its options price and its page's door */
  event: EarningsEvent | null;
}

