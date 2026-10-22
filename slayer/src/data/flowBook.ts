/*
==================================================
  SLAYER TERMINAL - THE DAY BOOK (data/flowBook.ts)

  The shared vocabulary of Trace's day book: the
  screens, the footprint screens, the watchers'
  reasons and their catches, the net-flow cuts and
  moneyness, the spread shapes, the reader filters,
  and the session's quarter-hour clock. The ROWS are
  the vendor's (data/traceLive.ts) — nothing in this
  file generates a figure (the audit, 2026-10-22:
  the hashed book, clip table, interval weights and
  spread generator that lived here are gone).
==================================================
*/

import { now } from '../core/clock';
import { isTradingDay } from '../core/calendar';
import { minuteLabel, nyParts, nyWallTime, SESSION_CLOSE_MIN, SESSION_LENGTH_MIN, SESSION_OPEN_MIN } from '../core/nyTime';
import { SECTOR_LIST, sectorOf } from './darkpool';
import { sleeveForDte } from './compass';
import { reasonMatches, reasonsSignature, type UserReason } from './flowReasons';
import type { SleeveKey } from '../types/compass';
import type { BookContract } from '../types/trace';
import { dayLean, usd } from './traceLive';

/* THE BOOK KEEPS NEW YORK'S SESSION (2026-10-13, from the partner's build at Noah's word): every minute in here is New
   York's minute of the day, and the book's day is the cash session, 09:30 to 16:00. It used to be the machine's
   midnight-to-midnight: windows from 00:00 with volume in every quarter hour, catches at 00:30 and after the close, a
   "last print" at 18:03 — on a Los Angeles or UTC machine the whole book sat hours off the session marks drawn beside
   it. Outside the session the book is the LAST session, whole: after the close today's, before the open (or on a
   weekend or a holiday) the session before. */
export interface BookSession {
  /** The session's New York date */
  year: number;
  month: number;
  day: number;
  /** Its 09:30 and 16:00 New York, as instants (ms) */
  open: number;
  close: number;
  /** New York's minute of the day the book stands at — SESSION_OPEN_MIN up to SESSION_CLOSE_MIN */
  minute: number;
  /** The session is under way: the clock is inside it */
  live: boolean;
}

export function bookSession(at: Date | number = now()): BookSession {
  const p = nyParts(at);
  const m = p.hour * 60 + p.minute;
  /* the calendar's checks read a date's own fields, so New York's date goes in as a plain date */
  const d = new Date(p.year, p.month - 1, p.day);
  const today = isTradingDay(d) && m >= SESSION_OPEN_MIN;
  if (!today) {
    for (let i = 0; i < 10; i++) {
      d.setDate(d.getDate() - 1);
      if (isTradingDay(d)) break;
    }
  }
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const dd = d.getDate();
  return {
    year: y,
    month: mo,
    day: dd,
    open: nyWallTime(y, mo, dd, 9, 30),
    close: nyWallTime(y, mo, dd, 16, 0),
    minute: today ? Math.min(m, SESSION_CLOSE_MIN) : SESSION_CLOSE_MIN,
    live: today && m < SESSION_CLOSE_MIN,
  };
}

/** A New York minute of the day, spoken — "14:30" */
const clockOf = (minute: number) => minuteLabel(minute);
// ---- screens ----------------------------------------------------------------

/* A screen is a QUESTION asked of the book — a filter and an ordering, never a
   judgment. States stay Compass's job; a screen only decides which rows are an
   answer and which number ranks them. */
export type ScreenKey =
  | 'active'
  | 'bullish'
  | 'bearish'
  | 'fresh'
  | 'conviction-calls'
  | 'conviction-puts'
  | 'cheap'
  | 'long-term';

export interface FlowScreen {
  key: ScreenKey;
  label: string;
  /** Whispered under the chip row — what the cut means, in plain English */
  hint: string;
  /** A screen that IS a side of the market wears it under the pointer in the Screen card (DropdownSelect's `tone`) */
  tone?: 'bull' | 'bear';
}

export const FLOW_SCREENS: FlowScreen[] = [
  { key: 'active', label: 'Most active', hint: 'Heaviest volume first' },
  { key: 'bullish', label: 'Unusually bullish', hint: 'Calls being bought and puts being sold, ranked by premium', tone: 'bull' },
  { key: 'bearish', label: 'Unusually bearish', hint: 'Puts being bought and calls being sold, ranked by premium', tone: 'bear' },
  { key: 'fresh', label: 'New positioning', hint: 'Volume running past open interest — positions built today' },
  { key: 'conviction-calls', label: 'Conviction calls', hint: 'Out-of-the-money calls with heavy sweep share', tone: 'bull' },
  { key: 'conviction-puts', label: 'Conviction puts', hint: 'Out-of-the-money puts with heavy sweep share', tone: 'bear' },
  { key: 'cheap', label: 'Cheap calls', hint: 'Low-priced out-of-the-money calls the crowd is trading', tone: 'bull' },
  { key: 'long-term', label: 'Long-dated', hint: 'Three months out and beyond — patient money' },
];

/** Aggressive call flow reads bullish; put flow bought at the ask reads
    bearish — sentimentOf's rule, applied to the day's dominant side, and only where the day HAS a side (dayLean: at
    least half the volume on a side — a day that was mostly a no-side cross leans nowhere). */
function leansBull(r: BookContract): boolean {
  const l = dayLean(r).lean;
  return r.right === 'C' ? l === 'ASK' : l === 'BID';
}
function leansBear(r: BookContract): boolean {
  const l = dayLean(r).lean;
  return r.right === 'P' ? l === 'ASK' : l === 'BID';
}

export function runScreen(rows: BookContract[], key: ScreenKey): BookContract[] {
  switch (key) {
    case 'active':
      return [...rows].sort((a, b) => b.volume - a.volume); // heaviest volume first, as the screen says
    case 'bullish':
      return rows.filter(r => leansBull(r) && r.volOverOI >= 0.8).sort((a, b) => b.premium - a.premium);
    case 'bearish':
      return rows.filter(r => leansBear(r) && r.volOverOI >= 0.8).sort((a, b) => b.premium - a.premium);
    case 'fresh':
      return rows.filter(r => r.volOverOI >= 1.5).sort((a, b) => b.volOverOI - a.volOverOI);
    case 'conviction-calls':
      return rows
        .filter(r => r.right === 'C' && r.sweepPct >= 25 && r.otmPct >= 0)
        .sort((a, b) => b.premium - a.premium);
    case 'conviction-puts':
      return rows
        .filter(r => r.right === 'P' && r.sweepPct >= 25 && r.otmPct <= 0)
        .sort((a, b) => b.premium - a.premium);
    case 'cheap':
      return rows.filter(r => r.right === 'C' && r.last <= 1.5 && r.otmPct >= 3).sort((a, b) => b.volume - a.volume);
    case 'long-term':
      return rows.filter(r => r.dte >= 90).sort((a, b) => b.premium - a.premium);
  }
}

// ---- footprint screens ------------------------------------------------------

/* Footprints asks the OVERNIGHT questions — what stayed, who built it, what
   left. Same rule as the screener's screens: a filter and an ordering, never
   a judgment. */
export type FootprintScreenKey =
  | 'builds'
  | 'fresh'
  | 'bought'
  | 'sold'
  | 'carryover'
  | 'unwinds'
  | 'streaks';

export interface FootprintScreen {
  key: FootprintScreenKey;
  label: string;
  hint: string;
}

export const FOOTPRINT_SCREENS: FootprintScreen[] = [
  { key: 'builds', label: 'Biggest builds', hint: 'The most new interest standing since yesterday' },
  { key: 'fresh', label: 'Fresh positions', hint: 'Built on near-empty contracts — the loudest percentage jumps' },
  { key: 'bought', label: 'Bought to open', hint: 'Builds that lifted the ask — buyers opened these' },
  { key: 'sold', label: 'Sold to open', hint: 'Builds that hit the bid — these were written, not bought' },
  { key: 'carryover', label: 'Carryover', hint: "Yesterday's heaviest volume that became standing interest" },
  { key: 'unwinds', label: 'Unwinds', hint: 'Interest that left — positions closed out overnight' },
  { key: 'streaks', label: 'Building streaks', hint: 'Interest climbing three sessions or more in a row' },
];

export function runFootprintScreen(rows: BookContract[], key: FootprintScreenKey): BookContract[] {
  const builds = rows.filter(r => r.deltaOI > 0);
  switch (key) {
    case 'builds':
      return builds.sort((a, b) => b.deltaOI - a.deltaOI);
    case 'fresh':
      return builds.filter(r => r.prevOI <= 1000).sort((a, b) => b.deltaOIPct - a.deltaOIPct);
    case 'bought':
      return builds.filter(r => r.prevAskPct >= 58).sort((a, b) => b.deltaOI - a.deltaOI);
    case 'sold':
      return builds.filter(r => r.prevAskPct <= 42).sort((a, b) => b.deltaOI - a.deltaOI);
    case 'carryover':
      return builds
        .filter(r => r.prevVolume >= 20000 && r.deltaOI >= r.prevVolume * 0.5)
        .sort((a, b) => b.deltaOI - a.deltaOI);
    case 'unwinds':
      return rows.filter(r => r.deltaOI < 0).sort((a, b) => a.deltaOI - b.deltaOI);
    case 'streaks':
      return builds.filter(r => r.oiStreak >= 3).sort((a, b) => b.oiStreak - a.oiStreak || b.deltaOI - a.deltaOI);
  }
}

// ---- flow alerts ------------------------------------------------------------

/* The tape watching itself. Rules are the desk's own watchers over the day
   book — a contract surfaces the moment it trips one, and the feed drips
   through the session on the engine clock exactly like the news wire, so
   alerts LAND live and replay re-derives the same day. One book, one more
   reader: an alert can never quote numbers the screener disagrees with. */

/* VOCABULARY RULING (Noah, 2026-08-30): the user-facing word is REASON, not
   rule — the reader's question is "why is this in front of me", and each row
   answers it in a house phrase. "Repeated Hits" was the reference's verbatim
   wording (banned, the king→supreme precedent) and "whale" anything echoes
   their brand name — both replaced. */
export type WatcherKey = 'big-money' | 'into-earnings' | 'climbing' | 'falling' | 'fresh-size' | 'hammering';

export interface WatcherRule {
  key: WatcherKey;
  /** Short chip handle */
  label: string;
  /** The row's why — a plain-English clause, shown in the Reason column */
  reason: string;
  hint: string;
}

/** THE DESK'S WATCHERS (the Trace page of the same name — "Flow Alerts" until
    2026-09-11: the bell is the reader's alerts, these are the desk's own
    watchers over the day book). Priority order — a loud contract reports
    under its loudest reason first. */
export const WATCHERS: WatcherRule[] = [
  {
    key: 'big-money',
    label: 'Big money',
    /* the rule is the contract's DAY premium ($25M and up) — it never looked at one print */
    reason: 'Carried $25M or more of premium today',
    hint: "A contract whose day's premium reached $25M",
  },
  {
    key: 'into-earnings',
    label: 'Into earnings',
    reason: 'Built days before the report',
    hint: 'Heavy positioning with earnings days away',
  },
  {
    key: 'climbing',
    label: 'Climbing fills',
    reason: 'Up 8% or more on the day, a quarter swept, leaning to the ask',
    hint: 'Buying that keeps coming back, each fill higher — chasers',
  },
  {
    key: 'falling',
    label: 'Falling fills',
    reason: 'Down 8% or more on the day, a quarter swept, leaning to the bid',
    hint: 'Fills stepping lower while the volume keeps coming',
  },
  {
    key: 'fresh-size',
    label: 'Fresh size',
    reason: 'Volume 1.8× its open interest or more, on $300K or more',
    hint: 'Trading many times its open interest — positions built today',
  },
  {
    key: 'hammering',
    label: 'Hammering',
    reason: '12,000 contracts or more, 30% of them swept',
    hint: 'One contract absorbing hit after hit all session',
  },
];

/** One row the desk's (or the reader's) watcher caught — a contract on the live book that meets a reason, told by its
    own day: when it last printed, at what fill, how much money it carried, and which side its volume leaned. ONE ROW A
    CONTRACT (the retail pass, 2026-10-22: QQQ 725C sat twice in "362 catches", once per reason) — its reasons together. */
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
  side: 'ASK' | 'BID' | 'EVEN' | 'MID';
  row: BookContract;
}

/** A house reason said with the contract's OWN figure, not its threshold (the re-audit, 2026-10-22: "Volume 1.8× its
    open interest" beside a Vol/OI of 30.14) */
export function reasonPhrase(key: WatcherKey, r: BookContract): string {
  switch (key) {
    case 'big-money':
      return `Carried ${usd(r.premium)} of premium today — $25M and up`;
    case 'into-earnings':
      return `Reports in ${r.earnDays === 0 ? 'this session' : `${r.earnDays} session${r.earnDays === 1 ? '' : 's'}`}, open interest +${r.deltaOI.toLocaleString('en-US')} on ${r.volume.toLocaleString('en-US')} contracts`;
    case 'climbing':
      return `Up ${r.chgPct.toFixed(0)}% on the day, ${Math.round(r.sweepPct)}% swept, leaning to the ask`;
    case 'falling':
      return `Down ${Math.abs(r.chgPct).toFixed(0)}% on the day, ${Math.round(r.sweepPct)}% swept, leaning to the bid`;
    case 'fresh-size':
      return `Volume ${r.volOverOI >= 10 ? r.volOverOI.toFixed(0) : r.volOverOI.toFixed(1)}× its open interest, on ${usd(r.premium)}`;
    case 'hammering':
      return `${r.volume.toLocaleString('en-US')} contracts, ${Math.round(r.sweepPct)}% of them swept`;
  }
}

function rulesFor(r: BookContract): WatcherKey[] {
  const out: WatcherKey[] = [];
  // "Big enough to move the day" has to stay RARE or the words mean nothing.
  if (r.premium >= 25_000_000) out.push('big-money');
  if (r.earnDays != null && r.earnDays <= 5 && r.deltaOI > 0 && r.volume >= 3000) out.push('into-earnings');
  // Climbing and falling are mirror predicates — chasers vs sellers, same bar.
  const lean = dayLean(r).lean;
  if (r.volume >= 6000 && r.sweepPct >= 25 && r.chgPct >= 8 && lean === 'ASK') out.push('climbing');
  else if (r.volume >= 6000 && r.sweepPct >= 25 && r.chgPct <= -8 && lean === 'BID') out.push('falling');
  if (r.volOverOI >= 1.8 && r.premium >= 300_000) out.push('fresh-size');
  if (r.volume >= 12000 && r.sweepPct >= 30) out.push('hammering');
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

/**
 * EVERY CATCH IS A REAL CONTRACT'S REAL DAY (the audit, 2026-10-22): a catch's trip time was the open plus a hash, its
 * "print" a hashed share of the day's volume at a hashed fill — "SPY 766C 14:28 42,914 @ $0.09" where the largest real
 * print was 777. A catch is now a contract on the live book that meets a reason (the desk's six, or the reader's own),
 * stamped with the contract's own last print and day — newest last print first. Nothing is scheduled or invented.
 */
export function buildCatches(rows: BookContract[], reasons: UserReason[] = []): Catch[] {
  const sig = reasonsSignature(reasons);
  if (catchCache && catchCache.rows === rows && catchCache.sig === sig) return catchCache.catches;
  const catches: Catch[] = [];
  for (const r of rows) {
    const house = rulesFor(r);
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
      side: lean === 'UNSIDED' ? 'MID' : lean,
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
export const windowStart = (idx: number) => SESSION_OPEN_MIN + idx * WINDOW_MIN;

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

/* THE CUT, in plain English (Noah, 2026-09-03: "i dont get what 'single
   names' mean… are the dropdowns reasonable? i am struggling to figure out
   the idea behind them"). The old list mixed four kinds of thing — the whole
   book, two families, two funds pulled out for convenience, one lone sector
   — and its family label was street jargon that promised ONE name. Now a
   cut is one of two kinds: the book by FAMILY (everything, the stocks alone,
   the index funds alone) or the book by SECTOR (every sector the terminal
   files, index funds excluded). One name is not a cut at all — it is the
   pane's ticker mode, reached through the name search in its head. */
export type NetFlowSegment = 'all' | 'stocks' | 'index-funds' | 'indexes' | `sector:${string}`;

export interface NetSegmentMeta {
  key: NetFlowSegment;
  label: string;
  group: 'The book' | 'Sectors';
}

const INDEX_FUNDS = new Set(['SPY', 'QQQ', 'IWM']);

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

export const segmentLabel = (seg: NetFlowSegment): string => NET_SEGMENTS.find(s => s.key === seg)?.label ?? seg;

export type MoneynessKey = 'all' | 'itm' | 'otm' | 'atm';

export const MONEYNESS: { key: MoneynessKey; label: string; hint: string }[] = [
  { key: 'all', label: 'All strikes', hint: 'Every strike in the cut' },
  { key: 'itm', label: 'ITM', hint: 'In the money — intrinsic value now' },
  { key: 'otm', label: 'OTM', hint: 'Out of the money — all time value' },
  { key: 'atm', label: 'ATM', hint: 'Within 1% of the spot' },
];

export function segmentFilter(r: BookContract, seg: NetFlowSegment): boolean {
  if (seg === 'all') return true;
  if (seg === 'index-funds') return INDEX_FUNDS.has(r.ticker);
  if (seg === 'indexes') return /^(SPXW?|NDXP?|XSP|RUTW?|VIXW?|XND|DJX|MRUT)$/.test(r.ticker);
  if (seg === 'stocks') return !INDEX_FUNDS.has(r.ticker);
  /* A sector is a cut of the STOCKS: the sector map files SPY/QQQ/IWM under
     Financial Services, and they would swallow that sector on a 0DTE day. */
  return r.sector === seg.slice('sector:'.length) && !INDEX_FUNDS.has(r.ticker);
}

/** A contract's or a print's place against the stock — both carry the same two fields */
export function moneynessFilter(r: Pick<BookContract, 'otmPct' | 'right'>, m: MoneynessKey): boolean {
  if (m === 'all') return true;
  if (m === 'atm') return Math.abs(r.otmPct) <= 1;
  const itm = r.right === 'C' ? r.otmPct < 0 : r.otmPct > 0;
  return m === 'itm' ? itm : !itm;
}

export type SpreadKind = 'vertical' | 'diagonal' | 'condor' | 'butterfly' | 'straddle' | 'strangle' | 'calendar' | 'ratio' | 'synthetic' | 'riskReversal' | 'custom';

export interface SpreadKindDef {
  key: SpreadKind;
  label: string;
  /** What the shape does, in plain English — information, never advice */
  read: string;
}

export const SPREAD_KINDS: SpreadKindDef[] = [
  /* THE FAMILY, NEVER ITS DIRECTION (the re-audit, 2026-10-22: "wings bought, body sold" was printed over short flies):
     these say what the shape is, both ways round; each structure's own sentence is worked from its settled legs
     (traceLive describeStructure) */
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
  minute: number;
  time: string;
  ticker: string;
  kind: SpreadKind;
  /** "480 / 490" — the structure's strikes, sorted */
  strikesLabel: string;
  /** Near leg's expiry & DTE */
  expiry: string;
  dte: number;
  size: number;
  /** Per-UNIT price (net premium over units × 100): positive = debit paid, negative = credit collected; 0 = not known */
  net: number;
  /** The vendor's name for the shape, spelled out ("put diagonal spread", "time butterfly") */
  shape: string;
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
  theta: number;
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
  /** The structure in a sentence, from its settled legs */
  read?: string;
  /** Whether its legs are in hand */
  legsState?: 'pending' | 'in' | 'none';
}

/** One leg as a book row — every figure the vendor's legs route sends for it (its day volume, open interest, fill,
    IV and quote); what the route does not carry (the day's side split, sweeps, history) is left unknown, never drawn
    (the audit, 2026-10-22: this row was hashed — volume, open interest, its change, sweeps, sides). The card it opens
    reads the contract's own tape by its symbol. */
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
    prevVolume: 0,
    prevAvgFill: 0,
    prevPremium: 0,
    prevAskPct: 0,
    oiStreak: 0,
    volGtOiStreak: 0,
    earnDays: null,
    prevSpark: [],
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
    if (f.excludeItm) {
      const itm = r.right === 'C' ? r.otmPct < 0 : r.otmPct > 0;
      if (itm) return false;
    }
    return true;
  });
}
