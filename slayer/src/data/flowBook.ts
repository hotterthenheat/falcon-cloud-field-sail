/* The shared vocabulary of Trace's day book: screens, footprints, reasons and catches, net-flow cuts, moneyness,
   spread shapes and the quarter-hour clock. Nothing here makes a figure. */

import { minuteLabel, SESSION_LENGTH_MIN, SESSION_OPEN_MIN } from '../core/nyTime';
import { SECTOR_LIST, sectorOf } from './darkpool';
import { sleeveForDte } from './compass';
import { reasonMatches, reasonsSignature, type UserReason } from './flowReasons';
import type { SleeveKey } from '../types/compass';
import type { BookContract } from '../types/trace';
import { dayLean, FRESH_VOL_OI, leanWords, SPREAD_LEG_PCT, SWEEP_DAY_PCT } from './traceLean';

export { FRESH_VOL_OI, SPREAD_LEG_PCT, SWEEP_DAY_PCT };
import { advUsdOf, likelyOpeningOf, usd } from './traceRows';

/** A New York minute of the day, spoken — "14:30" */
const clockOf = (minute: number) => minuteLabel(minute);
// ---- screens ----------------------------------------------------------------

/* A screen is a question asked of the book: a filter and an ordering, never a judgment. */
export type ScreenKey =
  | 'active'
  | 'bullish'
  | 'bearish'
  | 'fresh'
  | 'conviction-calls'
  | 'conviction-puts'
  | 'cheap'
  | 'long-term';

interface FlowScreen {
  key: ScreenKey;
  label: string;
  /** Whispered under the chip row — what the cut means, in plain English */
  hint: string;
  /** A screen that IS a side of the market wears it under the pointer in the Screen card (DropdownSelect's `tone`) */
  tone?: 'bull' | 'bear';
}

export const FLOW_SCREENS: FlowScreen[] = [
  { key: 'active', label: 'Most active', hint: 'Heaviest volume first' },
  { key: 'bullish', label: 'Unusually bullish', hint: 'Calls bought or puts sold on likely-opening days, volume at least 0.8× open interest, by premium — a day that may be closing gets no lean', tone: 'bull' },
  { key: 'bearish', label: 'Unusually bearish', hint: 'Puts bought or calls sold on likely-opening days, volume at least 0.8× open interest, by premium — a day that may be closing gets no lean', tone: 'bear' },
  { key: 'fresh', label: 'New positioning', hint: 'Volume running past open interest — positions built in the session' },
  { key: 'conviction-calls', label: 'Conviction calls', hint: 'Out-of-the-money calls with heavy sweep share', tone: 'bull' },
  { key: 'conviction-puts', label: 'Conviction puts', hint: 'Out-of-the-money puts with heavy sweep share', tone: 'bear' },
  { key: 'cheap', label: 'Cheap calls', hint: 'Low-priced out-of-the-money calls the crowd is trading', tone: 'bull' },
  { key: 'long-term', label: 'Long-dated', hint: 'Three months out and beyond — patient money' },
];

/** A contract's day opened new positions (traceRows likelyOpeningOf): the flag paired with the next count when the row
    has one, else its volume against the open interest the session opened on. "Cannot be told" is not opening. */
export function dayOpens(r: Pick<BookContract, 'volume' | 'oi' | 'likelyOpening'>): boolean {
  return (r.likelyOpening !== undefined ? r.likelyOpening : likelyOpeningOf(r)) === true;
}
/** Which way a day's side points, opening or not: the bought side of calls up, of puts down */
function sidedWay(r: BookContract): 'bull' | 'bear' | null {
  if (notABet(r)) return null; // a floor package or a day of spread legs leans nowhere
  const l = dayLean(r).lean;
  if (l !== 'ASK' && l !== 'BID') return null;
  return (r.right === 'C') === (l === 'ASK') ? 'bull' : 'bear';
}
/** Call flow bought at the ask reads bullish, put flow bearish, only where the day has a side (dayLean) and likely
    opened positions (dayOpens): a closing day bought or sold takes an old bet off, which says nothing of new money. */
function leansBull(r: BookContract): boolean {
  return sidedWay(r) === 'bull' && dayOpens(r);
}
function leansBear(r: BookContract): boolean {
  return sidedWay(r) === 'bear' && dayOpens(r);
}
/** What the lean left out of a set of days: the ones with a side that are not likely opening — shown, with no lean */
export function closingLeftOut(rows: readonly BookContract[]): { count: number; premium: number; bull: number; bear: number } {
  let count = 0;
  let premium = 0;
  let bull = 0;
  let bear = 0;
  for (const r of rows) {
    const way = sidedWay(r);
    if (!way || dayOpens(r)) continue;
    count++;
    if (Number.isFinite(r.premium)) premium += r.premium;
    if (way === 'bull') bull++;
    else bear++;
  }
  return { count, premium, bull, bear };
}

/** "Unusually" bullish or bearish also needs this much volume against open interest — said in the screens' hints */
const UNUSUAL_VOL_OI = 0.8;

export function runScreen(rows: BookContract[], key: ScreenKey): BookContract[] {
  switch (key) {
    case 'active':
      return [...rows].sort((a, b) => b.volume - a.volume); // heaviest volume first, as the screen says
    case 'bullish':
      return rows.filter(r => leansBull(r) && r.volOverOI >= UNUSUAL_VOL_OI).sort((a, b) => b.premium - a.premium);
    case 'bearish':
      return rows.filter(r => leansBear(r) && r.volOverOI >= UNUSUAL_VOL_OI).sort((a, b) => b.premium - a.premium);
    case 'fresh':
      return rows.filter(r => r.volOverOI >= FRESH_VOL_OI).sort((a, b) => b.volOverOI - a.volOverOI);
    case 'conviction-calls':
      return rows
        .filter(r => r.right === 'C' && r.sweepPct >= SWEEP_DAY_PCT && r.otmPct >= 0)
        .sort((a, b) => b.premium - a.premium);
    case 'conviction-puts':
      return rows
        .filter(r => r.right === 'P' && r.sweepPct >= SWEEP_DAY_PCT && r.otmPct >= 0) /* otmPct is + out of the money for calls and puts alike */
        .sort((a, b) => b.premium - a.premium);
    case 'cheap':
      return rows.filter(r => r.right === 'C' && r.last <= 1.5 && r.otmPct >= 3).sort((a, b) => b.volume - a.volume);
    case 'long-term':
      return rows.filter(r => r.dte >= 90).sort((a, b) => b.premium - a.premium);
  }
}

// ---- footprint screens ------------------------------------------------------

/* Footprints asks the overnight questions: what stayed, who built it, what left. A filter and an ordering, never a
   judgment. */
export type FootprintScreenKey = 'builds' | 'fresh' | 'unwinds' | 'streaks';

interface FootprintScreen {
  key: FootprintScreenKey;
  label: string;
  hint: string;
}

export const FOOTPRINT_SCREENS: FootprintScreen[] = [
  { key: 'builds', label: 'Biggest builds', hint: 'The most new interest standing since the session before' },
  { key: 'fresh', label: 'Fresh positions', hint: 'Built on near-empty contracts — the loudest percentage jumps' },
  { key: 'unwinds', label: 'Unwinds', hint: 'Interest that left — positions closed out since the session before' },
  { key: 'streaks', label: 'Building streaks', hint: 'Interest climbing three sessions or more in a row' },
];

export function runFootprintScreen(rows: BookContract[], key: FootprintScreenKey): BookContract[] {
  const builds = rows.filter(r => r.deltaOI > 0);
  switch (key) {
    case 'builds':
      return builds.sort((a, b) => b.deltaOI - a.deltaOI);
    case 'fresh':
      return builds.filter(r => r.prevOI <= 1000).sort((a, b) => b.deltaOIPct - a.deltaOIPct);
    case 'unwinds':
      return rows.filter(r => r.deltaOI < 0).sort((a, b) => a.deltaOI - b.deltaOI);
    case 'streaks':
      return builds.filter(r => r.oiStreak >= 3).sort((a, b) => b.oiStreak - a.oiStreak || b.deltaOI - a.deltaOI);
  }
}

// ---- flow alerts ------------------------------------------------------------

/* The desk's watchers over the day book: a contract surfaces when it trips a reason, off the same rows as the
   Screener, so a catch never quotes a different number. */

/* The word on the page is "reason": the reader's question is "why is this in front of me". */
export type WatcherKey = 'big-money' | 'into-earnings' | 'climbing' | 'falling' | 'fresh-size' | 'hammering';

interface WatcherRule {
  key: WatcherKey;
  /** Short chip handle */
  label: string;
  /** The row's why — a plain-English clause, shown in the Reason column */
  reason: string;
  hint: string;
}

/** The desk's watchers, in priority order: a loud contract reports under its loudest reason first. */
export const WATCHERS: WatcherRule[] = [
  {
    key: 'big-money',
    label: 'Big money',
    /* The contract's day premium, relative so it stays rare: the top tenth of the book's premium today, and $25M at
       the least */
    reason: "In the top tenth of the book's premium in the session ($25M at the least, a thousandth of the name's average dollar day where that is more)",
    hint: "A contract whose day's premium is in the top 10% of the book's — and at least $25M, or 0.1% of its name's average day's dollar volume when larger",
  },
  {
    key: 'into-earnings',
    label: 'Into earnings',
    reason: 'Built days before the report',
    hint: 'Heavy positioning with earnings days away',
  },
  {
    key: 'climbing',
    label: 'Up and bought',
    reason: 'Up 8% or more on the previous close, a quarter swept, leaning to the ask',
    hint: 'Price up 8%+ on the previous close, 6,000+ contracts, a quarter swept, leaning to the ask',
  },
  {
    key: 'falling',
    label: 'Down and sold',
    reason: 'Down 8% or more on the previous close, a quarter swept, leaning to the bid',
    hint: 'Price down 8%+ on the previous close, 6,000+ contracts, a quarter swept, leaning to the bid',
  },
  {
    key: 'fresh-size',
    label: 'Fresh size',
    reason: `Volume ${FRESH_VOL_OI}× its open interest or more, on $300K or more`,
    hint: 'Trading many times its open interest — positions built in the session',
  },
  {
    key: 'hammering',
    label: 'Hammering',
    reason: `12,000 contracts or more, ${SWEEP_DAY_PCT}% of them swept`,
    hint: 'One contract absorbing hit after hit all session',
  },
];

/** One contract a watcher caught, told by its own day (last print, fill, money, lean), with all its reasons on one
    row. */
export interface Catch {
  id: string;
  /** The contract's loudest reason — a house reason's key, or one of the reader's own reasons' ids. */
  rule: string;
  /** Every reason it meets, loudest first */
  rules: string[];
  /** True when the reader wrote the loudest reason */
  mine: boolean;
  /** Minute-of-day of the contract's last print */
  minute: number;
  /** HH:MM New York of the contract's last print */
  time: string;
  /** The contract's last fill */
  last: number;
  /** The contract's premium today */
  premium: number;
  /** Which side its day's volume leaned (dayLean): at the ask, on the bid, even, or MID — mostly mid or no side */
  side: 'ASK' | 'BID' | 'EVEN' | 'MID' | 'LEGS';
  row: BookContract;
}

/** A house reason said with the contract's own figure, not its threshold */
export function reasonPhrase(key: WatcherKey, r: BookContract): string {
  switch (key) {
    case 'big-money':
      return `Carried ${usd(r.premium)} of premium in the session — the top tenth of the book${floorPackaged(r) ? `; ${Math.round(r.floorPct)}% of it floor-traded multi-leg packages, the shape of compression, not a bet` : spreadLegDay(r) ? `; ${Math.round(r.multiPct)}% of it legs of multi-leg orders — spread legs, not a single bet` : ''}`;
    case 'into-earnings':
      return `Reports in ${r.earnDays === 0 ? 'this session' : `${r.earnDays} session${r.earnDays === 1 ? '' : 's'}`}, open interest +${r.deltaOI.toLocaleString('en-US')} on ${r.volume.toLocaleString('en-US')} contracts`;
    case 'climbing':
      return `Up ${r.chgPct.toFixed(0)}% on the previous close, ${Math.round(r.sweepPct)}% swept, leaning to the ask`;
    case 'falling':
      return `Down ${Math.abs(r.chgPct).toFixed(0)}% on the previous close, ${Math.round(r.sweepPct)}% swept, leaning to the bid`;
    case 'fresh-size':
      return `Volume ${r.volOverOI >= 10 ? r.volOverOI.toFixed(0) : r.volOverOI.toFixed(1)}× its open interest, on ${usd(r.premium)}${apartWords(r)}`;
    case 'hammering':
      return `${r.volume.toLocaleString('en-US')} contracts, ${Math.round(r.sweepPct)}% of them swept${apartWords(r)}`;
  }
}
/** A day that is not a single bet says so beside its reason */
const apartWords = (r: BookContract) => (floorPackaged(r) ? ' — floor packages, not a bet' : spreadLegDay(r) ? ' — spread legs, not a single bet' : crossDay(r) ? ' — crosses, no side' : '');

/** A floor-package day: half or more on the floor and half or more in multi-leg packages (compression). Never
    crowned without saying so. */
export function floorPackaged(r: Pick<BookContract, 'floorPct' | 'multiPct'>): boolean {
  return r.floorPct >= 50 && r.multiPct >= 50;
}

/** A spread-leg day: 50% or more of the contracts in multi-leg orders, so its side says how a package filled, not
    where money leans. Shown and counted as legs; never crowned, never given a lean. */
/** Mostly legs of multi-leg orders, and not a floor package (that has its own label) */
export function spreadLegDay(r: Pick<BookContract, 'floorPct' | 'multiPct'>): boolean {
  return !floorPackaged(r) && r.multiPct >= SPREAD_LEG_PCT;
}
/** A cross day: half or more in pre-arranged crosses, no side taken. Set apart like a floor package and said as "a
    cross". */
export const CROSS_PCT = 50;
export function crossDay(r: { crossPct?: number }): boolean {
  return (r.crossPct ?? 0) >= CROSS_PCT;
}
export const crossHint = (r: { crossPct?: number; volume?: number }) =>
  `${Math.round(r.crossPct ?? 0)}% of its day${r.volume ? ` (${Math.round(((r.crossPct ?? 0) / 100) * r.volume).toLocaleString('en-US')} of ${r.volume.toLocaleString('en-US')} contracts)` : ''} in pre-arranged cross trades, no side taken: no lean, never crowned (${CROSS_PCT}% or more)`;
/** Not a single bet: a floor package, a day of spread legs or a day of crosses — set apart wherever the book crowns or leans */
export function notABet(r: Pick<BookContract, 'floorPct' | 'multiPct'> & { crossPct?: number }): boolean {
  return floorPackaged(r) || r.multiPct >= SPREAD_LEG_PCT || crossDay(r);
}
/** A book row's day lean in words — a day that is not a bet says why it has none */
export function bookLeanWords(r: BookContract): string {
  if (notABet(r)) return floorPackaged(r) ? 'floor package · no lean' : r.multiPct >= SPREAD_LEG_PCT ? `spread legs ${Math.round(r.multiPct)}% · no lean` : `a cross ${Math.round(r.crossPct ?? 0)}% · no lean`;
  return leanWords(dayLean(r));
}
/** Why a spread-leg day carries no read, in its own figure */
export const spreadLegHint = (r: Pick<BookContract, 'multiPct'>) =>
  `${Math.round(r.multiPct)}% of its day as legs of multi-leg orders: a leg's side says how a package filled, not a lean. Never crowned (${SPREAD_LEG_PCT}% or more)`;
/** One word for why a row is not a bet */
export const notABetWord = (r: Pick<BookContract, 'floorPct' | 'multiPct'> & { crossPct?: number }) => (floorPackaged(r) ? 'floor package' : r.multiPct >= SPREAD_LEG_PCT ? 'spread legs' : crossDay(r) ? 'a cross' : 'spread legs');

/** Why a not-a-bet row is set apart, in full (the hover) */
export const notABetHint = (r: Pick<BookContract, 'floorPct' | 'multiPct'> & { crossPct?: number; volume?: number }) =>
  floorPackaged(r)
    ? `${Math.round(r.floorPct)}% of its day on the floor and ${Math.round(r.multiPct)}% in packages: compression, not a directional bet`
    : r.multiPct >= SPREAD_LEG_PCT
      ? spreadLegHint(r)
      : crossHint(r);
/** The set's label: "Floor packages", "Spread legs", "Crosses", or "Packages, legs & crosses" when mixed */
export function notABetLabel(rows: (Pick<BookContract, 'floorPct' | 'multiPct'> & { crossPct?: number })[]): string {
  const kinds = new Set(rows.map(r => (floorPackaged(r) ? 'f' : r.multiPct >= SPREAD_LEG_PCT ? 'l' : 'c')));
  if (kinds.size > 1) return 'Packages, legs & crosses';
  return kinds.has('f') ? 'Floor packages' : kinds.has('l') ? 'Spread legs' : rows.length === 1 ? 'One cross' : 'Crosses';
}

/** Vol/OI as a cell: "new" when there was no open interest to divide by */
export function volOiText(r: Pick<BookContract, 'oi' | 'volume' | 'volOverOI'>): string {
  /* volOverOI is against the count at the session's open — a row may now show the newer count (usePairedOi), so the
     ratio itself says whether there was one */
  /* under a hundredth says so, never "0.00x" */
  if (r.volOverOI > 0) return r.volOverOI < 0.01 ? '<0.01' : r.volOverOI.toFixed(2);
  return r.volume > 0 ? 'new' : '—';
}
/** A ΔOI's tail: "new" only when there was next to nothing before; a percentage when it means something */
export function doiTail(r: Pick<BookContract, 'prevOI' | 'deltaOI' | 'deltaOIPct'>): string {
  if (r.deltaOI === 0) return '';
  if (r.prevOI <= 0 || (r.deltaOI > 0 && r.prevOI * 20 < r.deltaOI)) return 'new';
  if (!Number.isFinite(r.deltaOIPct) || Math.abs(r.deltaOIPct) > 999) return '';
  const p = Math.round(r.deltaOIPct);
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`;
}
/** 25% or more in the money with a month or more to run trades like the stock, not a view; flagged wherever bets are crowned */
const STOCK_LIKE_DTE = 30;
export function stockLike(r: { otmPct: number; dte: number }): boolean {
  return Number.isFinite(r.otmPct) && r.otmPct <= -25 && r.dte >= STOCK_LIKE_DTE;
}
export const STOCK_LIKE_HINT = '25% or more in the money with a month or more to run: it trades like the stock, likely a replacement or roll, not a bet';

/** Big money's floor, for every name */
export const BIG_MONEY_MIN = 25_000_000;
/** …and, where the name's average day is known, a thousandth of its dollar volume (NVDA's ~$36B day: $36M) */
export const BIG_MONEY_ADV_SHARE = 0.001;
/** The book's big-money line: its 90th-percentile premium, $25M at the least */
function bigMoneyLine(rows: BookContract[]): number {
  if (!rows.length) return BIG_MONEY_MIN;
  const s = rows.map(r => r.premium).sort((a, b) => a - b);
  return Math.max(BIG_MONEY_MIN, s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]);
}
/** One contract's big-money line: the book's, raised to a thousandth of its name's average dollar day when known */
export function bigMoneyLineFor(r: Pick<BookContract, 'ticker'>, bookLine = BIG_MONEY_MIN): number {
  const adv = advUsdOf(r.ticker);
  return Math.max(bookLine, adv != null ? adv * BIG_MONEY_ADV_SHARE : 0);
}

function rulesFor(r: BookContract, bigLine = BIG_MONEY_MIN): WatcherKey[] {
  const out: WatcherKey[] = [];
  // "Big enough to move the day" has to stay rare or the words mean nothing.
  if (r.premium >= bigMoneyLineFor(r, bigLine)) out.push('big-money');
  if (r.earnDays != null && r.earnDays <= 5 && r.deltaOI > 0 && r.volume >= 3000) out.push('into-earnings');
  // Climbing and falling are mirror predicates — chasers vs sellers, same bar.
  /* a day of spread legs has no lean to chase or sell on */
  const lean = notABet(r) ? 'UNSIDED' : dayLean(r).lean;
  if (r.volume >= 6000 && r.sweepPct >= SWEEP_DAY_PCT && r.chgPct >= 8 && lean === 'ASK') out.push('climbing');
  else if (r.volume >= 6000 && r.sweepPct >= SWEEP_DAY_PCT && r.chgPct <= -8 && lean === 'BID') out.push('falling');
  if (r.volOverOI >= FRESH_VOL_OI && r.premium >= 300_000) out.push('fresh-size');
  if (r.volume >= 12000 && r.sweepPct >= SWEEP_DAY_PCT) out.push('hammering');
  return out;
}

/** The reader's own reasons this row meets — same per-row ceiling as the house
    rules, so one very loud contract can never take over the feed. */
function myReasonsFor(r: BookContract, reasons: UserReason[]): string[] {
  const out: string[] = [];
  for (const reason of reasons) {
    if (reasonMatches(reason, r)) out.push(reason.id);
  }
  return out;
}

let catchCache: { rows: BookContract[]; sig: string; catches: Catch[] } | null = null;

/** A catch is a contract on the live book that meets a reason, stamped with its own last print and day, newest
    first. Nothing is scheduled or invented. */
export function buildCatches(rows: BookContract[], reasons: UserReason[] = []): Catch[] {
  const sig = reasonsSignature(reasons);
  if (catchCache && catchCache.rows === rows && catchCache.sig === sig) return catchCache.catches;
  const catches: Catch[] = [];
  const bigLine = bigMoneyLine(rows);
  for (const r of rows) {
    const house = rulesFor(r, bigLine);
    const mine = myReasonsFor(r, reasons);
    const all = [...house, ...mine];
    if (!all.length) continue;
    const lean = dayLean(r).lean;
    catches.push({
      id: r.key,
      rule: all[0],
      rules: all,
      mine: !house.includes(all[0] as WatcherKey),
      minute: r.lastAtMin,
      time: r.lastAt,
      last: r.last,
      premium: r.premium,
      /* a day of spread legs (or a floor package) carries no side of its own */
      side: notABet(r) ? 'LEGS' : lean === 'UNSIDED' ? 'MID' : lean,
      row: r,
    });
  }
  catches.sort((a, b) => b.minute - a.minute || b.premium - a.premium);
  catchCache = { rows, sig, catches };
  return catches;
}

// ---- the day in windows -----------------------------------------------------

/* The session cut into quarter hours, 09:30 to 16:00 New York — the Intervals page's clock (its figures are the
   vendor's minute ticks, pages/trace/Windows.tsx). */

const WINDOW_MIN = 15;
/** 26: the session's quarter hours. Window 0 is 09:30–09:45 New York. */
export const WINDOWS_PER_DAY = SESSION_LENGTH_MIN / WINDOW_MIN;
/** The New York minute window `idx` opens on */
const windowStart = (idx: number) => SESSION_OPEN_MIN + idx * WINDOW_MIN;

export interface IntervalWindow {
  idx: number;
  /** "14:30–14:45" */
  label: string;
  /** All contracts' volume inside the window */
  totalVol: number;
  /** Still filling — the clock is inside it */
  live: boolean;
}

/** "14:30–14:45", New York */
export function windowLabel(idx: number): string {
  return `${clockOf(windowStart(idx))}–${clockOf(windowStart(idx) + WINDOW_MIN)}`;
}

// ---- net premium through the session ----------------------------------------

/* The net-flow cuts: which part of the market a pane's vendor minutes read (/net-flow/expiry's tide types, a sector's
   tide) and which strikes (moneyness). */

/* A cut is the book by family (everything, stocks, index funds) or by sector; one name is the pane's ticker mode,
   not a cut. */
export type NetFlowSegment = 'all' | 'stocks' | 'index-funds' | 'indexes' | `sector:${string}`;

interface NetSegmentMeta {
  key: NetFlowSegment;
  label: string;
  group: 'The book' | 'Sectors';
}

/* A sector is told by its glyph (components/trace/SectorMark), never a colour. */
export const NET_SEGMENTS: NetSegmentMeta[] = [
  { key: 'all', label: 'Everything', group: 'The book' },
  { key: 'stocks', label: 'Stocks only', group: 'The book' },
  { key: 'index-funds', label: 'Index funds only', group: 'The book' },
  /* the vendor's index_only tide — SPX, NDX, XSP, RUT, VIX options */
  { key: 'indexes', label: 'Index options only', group: 'The book' },
  ...SECTOR_LIST.map(s => ({ key: `sector:${s.sector}` as const, label: s.sector, group: 'Sectors' as const })),
];

export const isNetSegment = (v: unknown): v is NetFlowSegment =>
  typeof v === 'string' && NET_SEGMENTS.some(s => s.key === v);

export type MoneynessKey = 'all' | 'itm' | 'otm' | 'atm';

export const MONEYNESS: { key: MoneynessKey; label: string; hint: string }[] = [
  { key: 'all', label: 'All strikes', hint: 'Every strike in the cut' },
  { key: 'itm', label: 'ITM', hint: 'In the money past 1% of the spot — intrinsic value now' },
  { key: 'otm', label: 'OTM', hint: 'Out of the money past 1% of the spot — all time value' },
  { key: 'atm', label: 'ATM', hint: 'Within 1% of the spot' },
];
/** The at-the-money band, % of the spot either way: inside it a strike is ATM and neither ITM nor OTM */
export const ATM_BAND_PCT = 1;

/* otmPct is the strike's distance past the stock, positive out of the money for calls and puts; a NaN distance is
   neither in nor out. The three bands do not overlap: ATM within ATM_BAND_PCT either way, ITM and OTM past it (a 0.5%
   OTM strike was both OTM and ATM). */

/** A contract's or a print's place against the stock — both carry the same two fields */
export function moneynessFilter(r: Pick<BookContract, 'otmPct' | 'right'>, m: MoneynessKey): boolean {
  if (m === 'all') return true;
  if (!Number.isFinite(r.otmPct)) return false;
  if (m === 'atm') return Math.abs(r.otmPct) <= ATM_BAND_PCT;
  return m === 'itm' ? r.otmPct < -ATM_BAND_PCT : r.otmPct > ATM_BAND_PCT;
}

export type SpreadKind = 'vertical' | 'diagonal' | 'condor' | 'butterfly' | 'straddle' | 'strangle' | 'calendar' | 'ratio' | 'synthetic' | 'riskReversal' | 'custom';

interface SpreadKindDef {
  key: SpreadKind;
  label: string;
  /** What the shape does, in plain English — information, never advice */
  read: string;
}

export const SPREAD_KINDS: SpreadKindDef[] = [
  /* The family, never its direction: each structure's own sentence comes from its settled legs (describeStructure) */
  { key: 'vertical', label: 'Vertical', read: 'Two strikes on one side and one expiry, one bought and one sold — the risk capped both ways.' },
  { key: 'condor', label: 'Iron condor', read: 'Four legs, two inner strikes and two outer — sold inner, it gains if the name stays between; bought inner, it gains on a move out.' },
  { key: 'butterfly', label: 'Butterfly', read: 'Three strikes, the middle one twice — long (wings bought), it pays most at the middle; short (wings sold), it gains on a move away.' },
  { key: 'straddle', label: 'Straddle', read: 'A call and a put at one strike — bought, a position on a move either way; sold, on no move.' },
  { key: 'strangle', label: 'Strangle', read: 'A call above and a put below — bought, a move either way; sold, the name staying between.' },
  { key: 'calendar', label: 'Calendar', read: 'Same strike on two clocks — one expiry bought, the other sold.' },
  { key: 'diagonal', label: 'Diagonal', read: 'Two strikes on two clocks — a vertical and a calendar in one.' },
  { key: 'riskReversal', label: 'Risk reversal', read: 'A call one way and a put the other, on two strikes — a directional stance financed by the other side.' },
  { key: 'synthetic', label: 'Synthetic', read: 'A call and a put at one strike, one bought and one sold — it moves like the stock itself.' },
  { key: 'ratio', label: 'Ratio', read: 'Unbalanced legs — extra contracts written on one side, risk open past the far strike.' },
  /* the vendor's "other": legs that print together but match no named shape — never relabelled a vertical */
  { key: 'custom', label: 'Custom', read: 'Legs that printed together but match no named shape — read the legs.' },
];

export interface SpreadLeg {
  /** null when the vendor's record cannot say which way the leg went */
  side: 'BUY' | 'SELL' | null;
  /** Contracts on this leg */
  contracts?: number;
  /** Per-share theta, as the vendor sends it */
  theta?: number;
  /** Per-share delta, as the vendor sends it. Absent: the structure keeps the vendor net, labeled vendor. */
  delta?: number;
  /** The leg's OCC symbol */
  occ?: string;
  /** The leg contract's day volume and open interest, and its IV (%) */
  volume?: number;
  oi?: number;
  iv?: number;
  bid?: number;
  ask?: number;
  ratio: number;
  strike: number;
  right: 'C' | 'P';
  /** MM/DD/YYYY */
  expiry: string;
  dte: number;
  fill: number;
}

export interface SpreadTrade {
  id: string;
  /** OPRA's condition code on the structure (mlet, mlat, mesl, cbmo…) */
  code?: string;
  /** A compression package (cbmo / mctp) — a floor package that nets open interest down between members: labelled,
      never read bullish or bearish, never a champion */
  compression?: boolean;
  minute: number;
  /** The trade's New York day, YYYY-MM-DD, and its instant */
  day?: string;
  epochMs?: number;
  /** Filled outside the name's regular session (before 09:30, or from its 16:00 / 16:15 close) */
  extended?: boolean;
  /** Repeats of this structure the vendor sent under other ids — the same legs, size, money and second — folded in */
  repeats?: number;
  time: string;
  ticker: string;
  kind: SpreadKind;
  /** "480 / 490" — the structure's strikes, sorted */
  strikesLabel: string;
  /** Near leg's expiry & DTE */
  expiry: string;
  dte: number;
  /** A structure over two expiries (a diagonal, a calendar): its far leg's expiry and DTE, from the vendor's max_dte */
  farExpiry?: string;
  farDte?: number;
  size: number;
  /** Per-unit price (net premium over units × 100): positive = debit paid, negative = credit collected; 0 = not known */
  net: number;
  /** The shape's name — from the settled legs once they are in hand (traceLive nameFromLegs), else the vendor's, spelled
      out ("put diagonal spread", "time butterfly") */
  shape: string;
  /** The vendor's own name, kept when the legs name the structure otherwise */
  vendorShape?: string;
  /** The vendor's own name, always (the row's `shape` may be the legs' once they settle) */
  shapeOfVendor?: string;
  /** Signed net premium: + paid, − collected (the vendor's net_premium); premium is the gross of every leg */
  netPremium: number;
  /** How many legs the vendor counted */
  legCount?: number;
  /** |net| × size × 100, dollars */
  premium: number;
  /** The expiry payoff of the settled legs — null when the legs cannot be settled, or run to two expiries */
  maxLoss: number | 'uncapped' | null;
  maxProfit: number | 'uncapped' | null;
  iv: number;
  delta: number;
  /** 'legs' is the sum of the legs' own deltas. 'vendor' is net_delta, shown only when a leg has none. */
  deltaFrom?: 'legs' | 'vendor';
  /** Whose name the shape wears: 'legs' when the app named it from the legs as they were bought and sold, 'vendor' when it
      is the vendor's label (its legs not read, or not settled into one textbook shape) — said so on the row */
  namedBy?: 'legs' | 'vendor';
  /** The position's dollars a day to time (traceLive positionTheta) — capped at what the position is worth */
  theta: number;
  /** True when the vendor's rate ran past what the legs are worth and the figure is the cap: a near-expiry position
      whose remaining value goes to zero by the bell */
  thetaCapped?: boolean;
  spot: number;
  legs: SpreadLeg[];
  /** False when the vendor printed no net premium at all */
  netKnown?: boolean;
  /** The size of the net when its way is not known — the shape's canonical signs, either way */
  netAbs?: number;
  /** Units: the GCD of the legs' contracts — "5 flies" of S5/B10/S5 */
  units?: number;
  /** Every leg's contracts together */
  contracts?: number;
  /** "S1/B2/S1" — each leg's direction and its ratio, low strike first */
  ratioLabel?: string;
  /** Why the risk is not drawn: the legs did not settle, they run to two expiries, or the net is not known */
  riskNote?: 'unsettled' | 'expiries' | 'no-net';
  /** The vendor's own family, direction and expiry risk (null loss when it gave none; 'uncapped' for a null profit) */
  vendorKind?: SpreadKind;
  vendorDirection?: 'long' | 'short' | 'unknown';
  vendorRisk?: { loss: number; profit: number | 'uncapped' } | null;
  /** The settled legs contradict the vendor's risk or (direction unknown) its family: shown, never crowned */
  unverified?: boolean;
  /** The structure in a sentence, from its settled legs */
  read?: string;
  /** Whether its legs are in hand */
  legsState?: 'pending' | 'in' | 'none';
  /** A piece of a split order: printed in the same second, strikes, expiry and vendor name as a structure whose legs do
      make that shape, while its own legs make another. That structure's shape; shown, never crowned. */
  splitOf?: string;
}

/** Mark the pieces of split orders (SpreadTrade.splitOf): same ticker, second, expiry and vendor name as a structure whose
    legs agree with the vendor's name, while this one's legs name it otherwise */
export function markSplitOrders(list: SpreadTrade[]): SpreadTrade[] {
  const groups = new Map<string, SpreadTrade[]>();
  const keyOf = (t: SpreadTrade) => `${t.ticker}|${Math.floor((t.epochMs ?? 0) / 1000) || t.time}|${t.expiry}|${t.shapeOfVendor ?? ''}|${t.strikesLabel}`;
  for (const t of list) {
    const k = keyOf(t);
    const g = groups.get(k);
    if (g) g.push(t);
    else groups.set(k, [t]);
  }
  const split = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const agree = g.filter(t => t.legsState === 'in' && !t.vendorShape && !t.compression).sort((a, b) => (b.units ?? 0) - (a.units ?? 0))[0];
    if (!agree) continue;
    for (const t of g) if (t !== agree && t.legsState === 'in' && t.vendorShape) split.set(t.id, agree.shape);
  }
  return split.size ? list.map(t => (split.has(t.id) ? { ...t, splitOf: split.get(t.id) } : t)) : list;
}

/** One leg as a book row: every figure the legs route sends; what it does not carry stays unknown, never drawn. */
export function spreadLegRow(trade: SpreadTrade, i: number): BookContract {
  const l = trade.legs[i];
  const volume = l.volume ?? 0;
  const oi = l.oi ?? 0;
  const otm = trade.spot > 0 ? ((l.right === 'C' ? l.strike - trade.spot : trade.spot - l.strike) / trade.spot) * 100 : NaN;
  return {
    key: `${trade.id}-l${i}`,
    optionSymbol: l.occ,
    ticker: trade.ticker,
    sector: sectorOf(trade.ticker)?.sector ?? null,
    sectorColor: sectorOf(trade.ticker)?.color ?? null,
    strike: l.strike,
    right: l.right,
    expiry: l.expiry,
    dte: l.dte,
    spot: trade.spot,
    otmPct: otm,
    last: l.fill,
    chgPct: NaN,
    lastAt: trade.time,
    lastAtMin: trade.minute,
    volume,
    oi,
    deltaOI: 0,
    deltaOIPct: 0,
    premium: Math.round((l.contracts ?? trade.size * l.ratio) * l.fill * 100),
    iv: l.iv ?? trade.iv,
    ivChg: 0,
    volOverOI: oi > 0 ? volume / oi : 0,
    sweepPct: 0,
    multiPct: 0,
    floorPct: 0,
    askPct: NaN,
    prevOI: 0,
    prevAvgFill: 0,
    oiStreak: 0,
    volGtOiStreak: 0,
    earnDays: null,
  };
}

// ---- reader filters ---------------------------------------------------------

export interface BookFilters {
  side: 'ALL' | 'C' | 'P';
  /** Empty = every tenor */
  tenors: SleeveKey[];
  minVolume: number;
  /** Dollars */
  minPremium: number;
  excludeItm: boolean;
}

export const DEFAULT_FILTERS: BookFilters = {
  side: 'ALL',
  tenors: [],
  minVolume: 0,
  minPremium: 0,
  excludeItm: false,
};

export function applyFilters(rows: BookContract[], f: BookFilters): BookContract[] {
  return rows.filter(r => {
    if (f.side !== 'ALL' && r.right !== f.side) return false;
    if (f.tenors.length > 0 && !f.tenors.includes(sleeveForDte(r.dte))) return false;
    if (r.volume < f.minVolume) return false;
    if (r.premium < f.minPremium) return false;
    /* "Out of the money — strikes past the stock only": a known distance past the stock (an unknown one is not shown as OTM) */
    if (f.excludeItm && !(Number.isFinite(r.otmPct) && r.otmPct >= 0)) return false;
    return true;
  });
}

/** Said on every figure the vendor sums for us: its totals carry spread legs and floor packages */
export const VENDOR_TOTAL_NOTE = 'A summed total: spread legs and floor packages are in it. Live Tape, Dark Pool and Multi-Leg leave them out';

/** A book cut's head: the single bets' premium and call share, how many traded 1.5× their open interest, and the
    packages, spread legs and crosses set apart (never in the money) */
export function bookFacts(rows: BookContract[]): { prem: number; callPct: number; fresh: number; names: number; apartPrem: number; apart: number; bets: number } {
  let prem = 0;
  let callPrem = 0;
  let fresh = 0;
  let apartPrem = 0;
  let apart = 0;
  const names = new Set<string>();
  for (const r of rows) {
    if (notABet(r)) {
      apartPrem += r.premium;
      apart++;
      continue;
    }
    prem += r.premium;
    if (r.right === 'C') callPrem += r.premium;
    names.add(r.ticker);
    if (r.volOverOI >= FRESH_VOL_OI) fresh++;
  }
  return { prem, callPct: Math.round((callPrem / Math.max(1, prem)) * 100), fresh, names: names.size, apartPrem, apart, bets: rows.length - apart };
}

/** The net-flow board's two ends summed: the bullish names' net, the bearish names' net, and the counts — a name at
    exactly zero net is neither */
export function boardSums(leaders: { ticker: string; net: number }[]): { calls: number; puts: number; gross: number; bullish: number; bearish: number; neutral: number } {
  const calls = leaders.reduce((a, l) => a + (l.net > 0 ? l.net : 0), 0);
  const puts = leaders.reduce((a, l) => a + (l.net < 0 ? l.net : 0), 0);
  const gross = leaders.reduce((a, l) => a + Math.abs(l.net), 0) || 1;
  const bullish = leaders.filter(l => l.net > 0).length;
  const bearish = leaders.filter(l => l.net < 0).length;
  return { calls, puts, gross, bullish, bearish, neutral: leaders.length - bullish - bearish };
}
