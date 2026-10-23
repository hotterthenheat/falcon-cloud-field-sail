/*
==================================================
  SLAYER TERMINAL - A NAME'S OVERVIEW (data/stockOverview.ts)

  The stock overview page's engine (the partner's
  review, 2026-09-13: a row on the Stocks board
  should open "the stock overview… like the compass
  analysis"). One name, read on the four pillars
  the board screens by — THE TREND, THE NUMBERS,
  THE MONEY, THE NEWS — each pillar a handful of
  FACTORS the terminal can actually compute, each
  factor a printed value and a lean between −1 and
  +1, the pillar's score the leans' weighted mean on
  a 0–100 scale, the composite the board's own four
  weights, the screen the board's own cuts.

  THE SECOND PASS (Noah, 2026-09-13, with the
  partner's own overview page: "i need all the
  information he has on there but formatted much
  better"): everything his page carried, computed
  from the same factor model rather than seeded —
  every factor's CONTRIBUTION in points (they sum
  to the score's distance from 50), the pillars'
  AGREEMENT with the read and the main risk, the
  trend's part SESSION BY SESSION, the TIMELINE of
  what happened on the sessions on hand, the
  METHOD (observed · derived · inferred), the
  tape's biggest BUYS and SELLS, the moves that
  would change the score with their deltas, and
  one paragraph from the raw data to the signal.

  WHAT IS REAL AND WHAT IS NOT, said on the page:
    the trend   the name's own sessions (the
                simulator keeps ~22) — the 20-day
                average, RSI, ADX, the ATR
                percentile, the structure; the 50-
                and 200-day averages need more
                sessions than are on hand (thin)
    the money   the book (GEX · DEX · VEX · vanna ·
                charm, the walls), the flow book's
                calls against puts, the ask side,
                sweeps, relative volume, the dark
                pool's posture (live)
    the news    the wire on the name (live)
    the numbers a SAMPLE — the simulator has no
                fundamentals; every figure is marked
                so, and the feed replaces the file
                (data/fundamentals.ts)

  States, not orders: the page says what it sees
  — the screen and the lean — never buy or sell.
  The board's own sleeves are hashed stand-ins
  (stocks.ts); this is the first real reading, so a
  name's row and its page can disagree until the
  board reads this engine for every name — 36 names
  seeded at ~0.6s each is why it cannot today.
==================================================
*/

import { dollars3 } from '../pages/record/money';
import { regimeOfNet } from './flipLevel';
import { levelsFor, type TickerLevels } from './levelsFor';
import { now } from '../core/clock';
import { readSessionClock } from './moc';
import { buildExposureProfile } from './exposure';
import { LEVELS_WINDOW } from './roomLevels';
import { bookCandles, snapshotOf } from './uwBook';
import { peekQuote, extendedLine, priceWords, screenerRead, screenerNeedsCloses } from './liveQuote';
import { peekLive, peekTickerNews } from './liveRecord';
import { darkReadable, peekStockFile, type EarnRow, type StockFile } from './stockFile';
import { nyTodayIso } from './nyDate';
import { nyClock, nyIsoDate, nyMinutes, SESSION_CLOSE_MIN, SESSION_OPEN_MIN } from '../core/nyTime';
import { peekRegularCloses, phaseOf } from './dayChange';
import { epsResultOf, nextReportRow, reportDayLabel, reportDayLabelYear, tradingDaysUntil } from './earningsFeed';
import type { GeoNewsEvent } from './newsroom';
import { lookup } from './universe';
import { tickerName } from './tickers';
import type { Fundamentals } from './fundamentals';
import type { Candle, MarketSnapshot } from '../types/market';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolView } from '../types/darkpool';

export type PillarKey = 'trend' | 'numbers' | 'money' | 'news';
export type Screen = 'STRONG' | 'MIXED' | 'WEAK';
export type Lean = 'bullish' | 'neutral' | 'bearish';
export type SourceStatus = 'live' | 'sample' | 'thin';

export interface Factor {
  key: string;
  label: string;
  /** The figure, printed */
  value: string;
  /** −1 (against the name) … +1 (for it) */
  lean: number;
  /** Its share of the pillar */
  weight: number;
  /** One plain clause on what it says */
  note: string;
  /** Shown for context and never scored (weight 0): the page's own reads — the swing structure, the last print, the dark
      pool, the wire — that the board cannot see for every name, so the page's word and the board's stay one */
  context?: boolean;
}

export interface Pillar {
  key: PillarKey;
  name: string;
  /** False for a pillar the read leaves out (the news: the board has no wire for every name) */
  inRead: boolean;
  /** 0–100 */
  score: number;
  factors: Factor[];
  status: SourceStatus;
  /** Where the pillar's figures come from, in a clause */
  from: string;
}

export interface TrendRead {
  closes: number[];
  /** Each session's first bar, unix seconds — the chart's clock */
  times: number[];
  ema20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  adx14: number | null;
  /** Today's range against the sessions on hand, 0–100 */
  atrPercentile: number | null;
  /** Today's range in dollars */
  rangeToday: number | null;
  structure: string;
  /** The last five sessions' swings against the five before */
  flags: { hh: boolean; hl: boolean; lh: boolean; ll: boolean } | null;
  /** How many of the averages on hand the price sits above, and how many there are */
  above: { count: number; of: number };
  /** The page's two spans of change. From the screener row (one_week_perc, one_month_perc) when it is in hand — the very
      figures the trend factors score — else off the bars, five and twenty sessions */
  change5Pct: number | null;
  change20Pct: number | null;
  /** Where the averages, RSI, ADX and the changes come from: 'screener' (one source for the card and the factors) or 'bars' */
  source: 'screener' | 'bars';
  /** The close the averages are set against: the last regular close after the bell, the live price in the session */
  refClose: number;
  sessions: number;
}

export interface MoneyRead {
  netGex: number;
  netDex: number;
  /** null when the vendor's book carries no vega (its greek-exposure rows have none) — never a measured $0 */
  netVex: number | null;
  netVanna: number;
  netCharm: number;
  /** The walls, the flip and the supreme over every listed expiry — Pinpoint's own levelsFor(t, 'ALL'), null until the
      book is live. The flip is null when net gamma does not cross zero within ±10% (the third audit, 2026-10-23: GME
      read "25.14 FLIP · 25.14 SPOT" where Pinpoint had none). */
  levelsAll: TickerLevels | null;
  /** The same read on Pinpoint's Today scope (levelsFor(t, '0DTE')) — after the bell the next session's expiry, named by
      its scopeLabel ("Next session · Oct 23") */
  levelsToday: TickerLevels | null;
  /** Strikes either side of spot the net figures are summed over */
  levelsWindow: number;
  /** dealers 'absorbing' (long gamma) or 'amplifying' (short) at spot */
  regime: 'absorbing' | 'amplifying';
  /** The screener's call_premium and put_premium: every dollar paid for calls and for puts today */
  callPremium: number;
  putPremium: number;
  /** The screener's bullish_premium and bearish_premium: calls bought at the ask and puts sold at the bid, against puts
      bought at the ask and calls sold at the bid — the side of the trade, not the kind of contract */
  bullishPremium: number;
  bearishPremium: number;
  callVolume: number;
  putVolume: number;
  askSharePct: number | null;
  sweepSharePct: number | null;
  /** Relative volume as the read uses it: paced to the clock in the session (pacedRelVolume), null when not read */
  rvol: number | null;
  /** The paced read in full — the vendor's figure, the basis and the label the page prints */
  rvolPaced: PacedVolume | null;
  volumeToday: number | null;
  volumeAvg: number | null;
  /** True when volumeAvg is the screener's 30-session average (avg30_volume), else the sessions in hand */
  volumeAvgIs30: boolean;
  /** Where today's close sits in its own range, 0 (the low) to 1 (the high) */
  closeInRange: number | null;
  callOI: number;
  putOI: number;
  /** Contracts on the book trading at least twice their open interest */
  unusual: number;
  dark: DarkPoolView;
  /** What the dark-pool read stands on: the read prints (sized, regular session, priced at the quote) of the prints in
      hand, and the New York clock window they span */
  /** The read's prints and the window the tape in hand truly covers: `complete` when it was paged back to the open;
      otherwise `cover` is the oldest instant in hand (HH:MM ET) and nothing before it was read */
  /** `read`/`readNotional`: the prints the posture read is on (the regular session's, at the quote); `outsideRead`: the
      card's prints left out of that read — extended-hours and unquoted ones */
  darkWindow: { read: number; readNotional: number; outsideRead: number; inHand: number; from: string | null; to: string | null; complete: boolean; cover: string | null; ownTerms: number };
  /** The window the session's flow alerts truly cover: `complete` when paged back to the session's start */
  flowWindow: { alerts: number; complete: boolean; from: string | null; to: string | null };
  /** Off-exchange prints of 50K shares or more */
  darkBlocks: number;
  /** Today's session minute by minute — the tape the prints are drawn on */
  today: { time: number; close: number }[];
  /** The busiest contracts on the name today, calls and puts */
  busiest: { calls: BookContract[]; puts: BookContract[] };
}

export interface NewsRead {
  stories: GeoNewsEvent[];
  sentiment: number;
  positive: number;
  negative: number;
  nextEarnings: { label: string; daysOut: number; impliedMovePct: number; confirmed: boolean; timeKnown: boolean } | null;
  /** The average absolute move the session after the last reports, and how many reports that is */
  reaction: { pct: number; reports: number } | null;
  /** The last reports, newest first: what it earned against the estimate and how the stock took it */
  reports: { label: string; epsActual: number | null; epsEst: number | null; beat: boolean; result: 'beat' | 'inline' | 'miss' | null; movePct: number | null; estOff: boolean }[];
}

export interface Source {
  key: string;
  label: string;
  status: SourceStatus;
  /** "live · 21:14" · "sample until the feed lands" · "22 sessions on hand" */
  stamp: string;
}

export interface ScoreHistory {
  /** The trend pillar as it stood N sessions ago (the other pillars held at today's) */
  trend5: number | null;
  trend20: number | null;
  composite5: number | null;
  composite20: number | null;
}

/** A factor's share of the score: the points it adds to or takes from 50 */
export interface Contribution {
  key: string;
  pillar: PillarKey;
  label: string;
  value: string;
  points: number;
}

/** A factor turned the other way, and where the score would land */
export interface Move {
  key: string;
  label: string;
  delta: number;
  to: number;
}

/** A pillar against the read: agrees · argues · in the middle; under a neutral read, the way it pulls — for · against · middle */
export type AgreeStance = 'agrees' | 'argues' | 'middle' | 'for' | 'against';
export interface Agreement {
  lean: Lean;
  pillars: { key: PillarKey; name: string; score: number; agrees: boolean; stance: AgreeStance }[];
  aligned: number;
  /** Where the read fails first if it fails */
  risk: string;
}

/** The trend's part as it stood `back` sessions ago, and the score with the rest held at today's */
export interface TrendPoint {
  back: number;
  /** The session's first bar, unix seconds */
  time: number;
  trend: number;
  composite: number;
}

export type TimelineKind = 'earnings' | 'news' | 'volume' | 'breakout' | 'breakdown' | 'session';
export interface TimelineEntry {
  key: string;
  when: string;
  kind: TimelineKind;
  text: string;
  /** The session's first bar, unix seconds — a mark on the sessions chart; the wire's and the report's carry none */
  time: number | null;
  /** The trend's part on that session, when it can be read */
  score: number | null;
}

export interface Method {
  observed: string[];
  derived: string[];
  inferred: string[];
}

export interface StockOverview {
  ticker: string;
  name: string;
  sector: string | null;
  price: number;
  /** The regular session's change, percent */
  changePct: number;
  /** "after hours +0.40%" — the move outside the session, or null */
  extLine: string | null;
  /** Which price the headline is: "348.22 close · 348.34 after hours 19:25 ET" (liveQuote.priceWords), or null */
  priceLine: string | null;
  /** Before the open: the last session's change and its date, said in place of a bare 0.00% today */
  lastSession: { pct: number; date: string | null } | null;
  marketWord: string;
  pillars: Pillar[];
  composite: number;
  screen: Screen;
  /** The read's side: bullish from 55 up, bearish from 45 down */
  lean: Lean;
  weights: Record<PillarKey, number>;
  /** The biggest current facts, one line */
  whyNow: string;
  /** What is for the name and what is against it */
  thesis: string;
  /** From the raw data to the signal, one paragraph */
  explanation: string;
  /** The two factors nearest a flip, and what each would do to the score */
  wouldMove: string[];
  /** The five moves that would change the score most */
  moves: Move[];
  contributions: Contribution[];
  agreement: Agreement;
  series: TrendPoint[];
  timeline: TimelineEntry[];
  method: Method;
  /** The tape's biggest prints on the name today, by side */
  prints: { buys: FlowPrint[]; sells: FlowPrint[] };
  trend: TrendRead;
  money: MoneyRead;
  news: NewsRead;
  numbers: Fundamentals;
  history: ScoreHistory;
  sources: Source[];
  /** How much of the page is live, 0–100 */
  completeness: number;
  /** The sources the read stands on that are still being read — while any is, the read is provisional and the page holds
      its words (the round-8 audit: AAPL said "Reads strong · The money good" at "5 of 9 sources live", then "good · poor") */
  settling: string[];
}

/* the board's own weights and cuts (stocks.ts) */
export const PILLAR_WEIGHTS: Record<PillarKey, number> = { trend: 0.32, numbers: 0.24, money: 0.26, news: 0.18 };
export const PILLAR_NAMES: Record<PillarKey, string> = { trend: 'The trend', numbers: 'The numbers', money: 'The money', news: 'The news' };
/* THE PUBLIC WORDS (Noah, 2026-09-19: "we do NOT grade or score any of our cons in public. thats for our own
   backtesting and backend information… i would rather have poor, caution, and good instead of actual numbers",
   then "and strong should be when its really great").
   The composite, the pillars' scores, the factors' points, the weights and the cuts all stay INSIDE the engine:
   they sort, they decide the word, they feed the journal. What reaches a screen, a sentence or a DOM attribute
   is one of four words. Nothing below this line may print a score, a weight, a point or a cut. */
export type Grade = 'strong' | 'good' | 'caution' | 'poor';
/** Low to high — the meter's order */
export const GRADES: Grade[] = ['poor', 'caution', 'good', 'strong'];
const screenOf = (composite: number): Screen => (composite >= 68 ? 'STRONG' : composite <= 46 ? 'WEAK' : 'MIXED');
/* THE FOUR WORDS' CUTS (Noah, 2026-09-19: "and strong should be when its really great"). STRONG is kept rare on
   purpose: across the 36 names on 2026-09-19 three reached it (3 strong · 10 good · 13 caution · 10 poor). The
   cuts are the engine's and are re-read against the live spread when real data lands; they never reach a screen. */
const STRONG_FROM = 72;
const GOOD_FROM = 60;
const POOR_TO = 46;
/** The word for any figure of ours, the whole read's or a pillar's: one vocabulary, one set of cuts */
export const gradeOfComposite = (composite: number): Grade => (composite >= STRONG_FROM ? 'strong' : composite >= GOOD_FROM ? 'good' : composite <= POOR_TO ? 'poor' : 'caution');
/** A pillar's word, on the SAME cuts as the whole read. With the figures hidden, two sets of cuts showed as a
    contradiction on the page (three pillars "good" under a read of "caution", measured on AAPL 2026-09-19): one
    vocabulary means one thing everywhere. The lean (bullish · neutral · bearish) keeps its own cuts; it is a
    direction, not a grade. */
export const gradeOf = (score: number): Grade => gradeOfComposite(score);
/** A fundamental's health as a word — the figure is the engine's */
export const healthWord = (healthScore: number): string => (healthScore >= 70 ? 'strong' : healthScore <= 40 ? 'stretched' : 'sound');
/** The side a score is on: 55 and up reads for the name, 45 and down against it */
export const leanOf = (score: number): Lean => (score >= 55 ? 'bullish' : score <= 45 ? 'bearish' : 'neutral');
const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
/** "82nd" — a percentile said as one */
export const ordinal = (n: number): string => {
  const r = n % 100;
  const s = r >= 11 && r <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
};
const pct = (v: number, d = 1) => `${v >= 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
/* ONE MONEY FORMATTER ON THE DOSSIER (the fourth audit, 2026-10-23: Cohen's buy read "$23M" here and "$22.8M" on the
   Insiders page) — three significant figures, pages/record/money.ts dollars3 */
export const fmtMoney = (v: number): string => dollars3(v);
const fmtCount = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`);
/** A pillar's score from its factors: 50 + 50 × the leans' weighted mean */
const scoreOf = (factors: readonly Factor[]): number => {
  const scored = factors.filter(f => !f.context);
  const w = scored.reduce((a, f) => a + f.weight, 0) || 1;
  return Math.round(50 + 50 * scored.reduce((a, f) => a + f.lean * f.weight, 0) / w);
};
/* ---- THE ONE READ, FOR THE BOARD AND THE PAGE ------------------------------------------------
   The retail test (2026-10-23): the board said AAPL "GOOD — the money is selling — a catalyst decides" while its page
   said "Reads strong … nothing against it", and NVDA "CAUTION" on the board, "poor" on its page. They were two engines
   on two inputs — the board's RSI, earnings growth and bullish share off the screener row, the page's bars, earnings
   rows, book and wire. Now the word is ONE function on ONE input: the vendor's screener row for the name
   (/screener/stocks, the same row on both pages). The page shows its other reads beside the scored ones, marked as
   context and never weighed. */
type ScreenRow = Record<string, unknown> | null | undefined;
const rowNum = (row: ScreenRow, k: string): number | null => {
  const v = row?.[k];
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
export interface ScreenPillars {
  trend: Factor[];
  numbers: Factor[];
  money: Factor[];
  /** The close the trend factors set the averages against */
  refClose: number | null;
}
/* ---- RELATIVE VOLUME, PACED TO THE CLOCK ------------------------------------------------
   The round-8 audit (2026-10-23): the screener's relative_volume is the session's volume SO FAR over a full day's
   30-session average — AAPL read 0.22× "quiet" at 10:07, SPY 0.13× — and the lean (rvol − 1) × the day's sign then
   called every morning up name bearish and every down name bullish. Now the session's volume is paced: set against the
   share of a full day a typical session has traded by this minute (the U-shaped intraday curve — a heavy open, a quiet
   midday, the close and its auction heaviest), so 1.00× means "on pace for an ordinary day". The first half hour is
   too early to pace and is shown, never scored; a premarket row is not in the read either. And quiet volume is never
   evidence for either side: it only says no conviction is behind the move, so only volume ABOVE pace leans. */
/** Each half hour's share of a typical session's volume, 09:30 to 16:00 (sums to 1) */
const HALF_HOUR_SHARE = [0.11, 0.075, 0.065, 0.06, 0.055, 0.05, 0.045, 0.045, 0.05, 0.055, 0.065, 0.085, 0.24];
/** The share of a typical full day traded by `minutes` into the regular session */
export const sessionVolumeShare = (minutes: number): number => {
  if (minutes <= 0) return 0;
  if (minutes >= 390) return 1;
  let cum = 0;
  for (let i = 0; i < HALF_HOUR_SHARE.length; i++) {
    const from = i * 30;
    if (minutes >= from + 30) cum += HALF_HOUR_SHARE[i];
    else return cum + HALF_HOUR_SHARE[i] * ((minutes - from) / 30);
  }
  return 1;
};
/** Minutes into the session before relative volume is paced and scored */
export const RVOL_PACE_FROM_MIN = 30;
export interface PacedVolume {
  /** The figure the read uses: paced in the session, the whole day's after it; null when it is not read */
  value: number | null;
  /** The vendor's own figure: the volume so far over a full day's average */
  raw: number;
  basis: 'paced' | 'full' | 'early' | 'premarket';
  /** The share of a typical day traded by now (1 after the close) */
  share: number;
  /** True when it is scored */
  inRead: boolean;
  /** "1.31× paced" · "0.92× full day" · "0.10× of a full day so far" */
  label: string;
}
/** The screener row's relative volume, made fair to the time of day */
export function pacedRelVolume(raw: number | null | undefined, rowDate: string | null | undefined, at: Date | number = now()): PacedVolume | null {
  if (raw == null || !(raw > 0)) return null;
  const today = nyIsoDate(at);
  const m = nyMinutes(at);
  const sameDay = !rowDate || String(rowDate).slice(0, 10) === today;
  if (!sameDay || m >= SESSION_CLOSE_MIN) return { value: raw, raw, basis: 'full', share: 1, inRead: true, label: `${raw.toFixed(2)}× full day` };
  if (m < SESSION_OPEN_MIN) return { value: null, raw, basis: 'premarket', share: 0, inRead: false, label: `${raw.toFixed(2)}× before the open` };
  const into = m - SESSION_OPEN_MIN;
  const share = sessionVolumeShare(into);
  if (into < RVOL_PACE_FROM_MIN) return { value: null, raw, basis: 'early', share, inRead: false, label: `${raw.toFixed(2)}× of a full day so far` };
  const v = raw / share;
  return { value: v, raw, basis: 'paced', share, inRead: true, label: `${v.toFixed(2)}× paced` };
}
/** The relative-volume factor: only volume above pace leans, in the day's direction; quiet volume is no evidence */
export function rvolFactor(pv: PacedVolume | null, up: boolean): Factor | null {
  if (!pv) return null;
  const label = pv.basis === 'paced' ? 'Relative volume, paced to the clock' : 'Relative volume';
  if (!pv.inRead || pv.value == null) {
    return { key: 'rvol', label, value: pv.label, lean: 0, weight: 0, context: true, note: pv.basis === 'premarket' ? 'before the open — not read until the session trades' : `${Math.round(pv.share * 100)}% of a usual day trades by now — too early in the session to read` };
  }
  const v = pv.value;
  const heavy = v >= 1.3;
  return {
    key: 'rvol',
    label,
    value: pv.basis === 'paced' ? `${pv.label} · ${pv.raw.toFixed(2)}× of a full day so far` : pv.label,
    lean: v > 1 ? clamp((v - 1) * (up ? 1 : -1)) : 0,
    weight: 0.25,
    note: heavy ? `heavy for the name, ${up ? 'on an up day' : 'on a down day'}` : v <= 0.7 ? 'quiet — no conviction behind the move either way' : 'ordinary — no conviction either way',
  };
}
/* VOLUME AMPLIFIES THE SIDE, IT DOES NOT PICK ONE (round 9: TSLA's money read "poor" and counted as agreeing bearish
   while its own evidence said "the two sides are about even — no lean (49%)" — heavy volume on a down day carried it).
   Heavy volume leans only where the side of the trade leans the same way; with the side even (or the other way) it
   is said and not weighed. */
export function volumeFollowsSide(factors: Factor[]): Factor[] {
  const side = factors.find(f => f.key === 'side');
  return factors.map(f => {
    if (f.key !== 'rvol' || f.context || f.lean === 0) return f;
    if (side && side.lean !== 0 && Math.sign(side.lean) === Math.sign(f.lean)) return f;
    return { ...f, lean: 0, note: `${f.note} — but the side of the trade ${side && side.lean !== 0 ? 'leans the other way' : 'is about even'}, so no lean` };
  });
}
/** The side of the trade is a lean only past this distance from even (a 49/51 split is no lean) */
const SIDE_DEADBAND = 0.05;

/* THE SIDE LEADS, THE KIND FOLLOWS (the round-8 audit: GME read "The money: strong / leans bullish" beside "bullish
   $1.02M vs bearish $1.07M · 49% bullish" — the call/put kind and a quiet down day carried it). Call premium counts calls
   sold at the bid too, so the kind of contract says nothing on its own: it leans only where the side of the trade leans
   the same way, and a split within five points of even is no lean at all. */
export function premiumFactors(bull: number, bear: number, calls: number, puts: number): Factor[] {
  const out: Factor[] = [];
  let sideDir = 0;
  if (bull + bear > 0) {
    const side = bull / (bull + bear);
    const off = side - 0.5;
    sideDir = Math.abs(off) < SIDE_DEADBAND ? 0 : Math.sign(off);
    out.push({ key: 'side', label: 'Bullish premium against bearish', value: `${Math.round(side * 100)}% bullish`, lean: sideDir === 0 ? 0 : clamp(off * 4), weight: 0.3, note: sideDir > 0 ? 'calls bought at the ask and puts sold at the bid lead' : sideDir < 0 ? 'puts bought at the ask and calls sold at the bid lead' : 'the two sides are about even — no lean' });
  }
  if (calls + puts > 0) {
    const share = calls / (calls + puts);
    const off = share - 0.5;
    const dir = Math.abs(off) < SIDE_DEADBAND ? 0 : Math.sign(off);
    const backed = dir !== 0 && dir === sideDir;
    out.push({
      key: 'prem',
      label: 'Call premium against put premium',
      value: `${Math.round(share * 100)}% calls`,
      lean: backed ? clamp(off * 4) : 0,
      weight: 0.15,
      note: dir === 0 ? 'calls and puts are about even' : backed ? (dir > 0 ? 'more of the premium is on calls, and the side of the trade agrees' : 'more of the premium is on puts, and the side of the trade agrees') : `more of the premium is on ${dir > 0 ? 'calls' : 'puts'}, but the side of the trade does not back it — no lean`,
    });
  }
  return out;
}

/** The scored factors, from the screener row alone */
export function screenFactors(row: ScreenRow): ScreenPillars {
  /* THE SESSION'S CLOSE, NOT THE AFTER-HOURS PRINT (the round-3 audit, 2026-10-22): after the bell the screener's
     close is the post-market price, so the scored "price against its 20-day average" read GME −1.3% while the page's
     trend box, from the regular bars, read −0.3%. The last regular close (dayChange's daily rows) is used when read. */
  const tk = typeof row?.ticker === 'string' ? (row.ticker as string) : '';
  /* (round 6) on liveQuote's screenerRead rule: the row's own session's regular close off the daily rows outside the
     session — before the open too, when the last session is yesterday's — and the row's close in it */
  const regular = row ? screenerRead(row, tk ? peekRegularCloses(tk) : null)?.regular : undefined;
  const last = regular != null && regular > 0 ? regular : rowNum(row, 'close');
  const ema20 = rowNum(row, 'ema_20');
  const rsi14 = rowNum(row, 'rsi_14');
  const adx14 = rowNum(row, 'adx_14');
  /* the week and the month off the same regular close (the vendor's percents run to the last print) */
  const weekRef = rowNum(row, 'one_week_close');
  const week = weekRef != null && weekRef > 0 && last != null && last > 0 ? last / weekRef - 1 : rowNum(row, 'one_week_perc');
  const monthRef = rowNum(row, 'one_month_close');
  const month = monthRef != null && monthRef > 0 && last != null && last > 0 ? last / monthRef - 1 : rowNum(row, 'one_month_perc');
  const day = rowNum(row, 'one_day_perc');
  const trend: Factor[] = [];
  if (ema20 != null && ema20 > 0 && last != null && last > 0) {
    const off = ((last - ema20) / ema20) * 100;
    trend.push({ key: 'ema20', label: 'Price against its 20-day EMA', value: `${pct(off)} · ${ema20.toFixed(2)}`, lean: clamp(off / 3), weight: 0.3, note: off >= 0 ? 'above its average — the trend holds' : 'under its average — the trend has slipped' });
  }
  if (rsi14 != null) trend.push({ key: 'rsi', label: 'RSI, 14 sessions', value: rsi14.toFixed(0), lean: clamp((rsi14 - 50) / 20), weight: 0.2, note: rsi14 >= 70 ? 'stretched — strong, but late' : rsi14 >= 55 ? 'firm' : rsi14 <= 30 ? 'washed out' : rsi14 <= 45 ? 'soft' : 'in the middle' });
  if (adx14 != null && week != null) {
    const dir = week >= 0 ? 1 : -1;
    trend.push({ key: 'adx', label: "ADX, the trend's strength", value: `${adx14.toFixed(0)} · ${week >= 0 ? 'up' : 'down'} on the week`, lean: clamp(((adx14 - 20) / 20) * dir), weight: 0.2, note: adx14 >= 25 ? `a trend with force, ${week >= 0 ? 'upward' : 'downward'}` : 'no trend with force behind it' });
  }
  if (month != null) trend.push({ key: 'chg20', label: 'The last month', value: pct(month * 100), lean: clamp((month * 100) / 8), weight: 0.1, note: month >= 0 ? 'up over the month' : 'down over the month' });
  const numbers: Factor[] = [];
  const growth = rowNum(row, 'eps_growth_4q');
  if (growth != null) numbers.push({ key: 'growth', label: 'Earnings growth, year over year', value: pct(growth * 100, 2), lean: clamp(growth / 0.25), weight: 0.4, note: growth >= 0 ? 'earnings are growing' : 'earnings are shrinking' });
  const money: Factor[] = [];
  const rv = rvolFactor(pacedRelVolume(rowNum(row, 'relative_volume'), typeof row?.date === 'string' ? (row.date as string) : null), (day ?? 0) >= 0);
  if (rv) money.push(rv);
  /* THE MONEY'S SIDE, NOT ITS KIND (the third audit, 2026-10-23): a put sold at the bid is a bullish trade, so the side of
     the trade (bullish against bearish premium) carries most of the weight; the call/put split is a smaller second read,
     named for what it is — premium spent on calls, not "buying". It was read off bullish_premium alone and printed as
     calls (WOLF "94% calls" on a 6%-calls day). */
  const bull = rowNum(row, 'bullish_premium') ?? 0;
  const bear = rowNum(row, 'bearish_premium') ?? 0;
  money.push(...premiumFactors(bull, bear, rowNum(row, 'call_premium') ?? 0, rowNum(row, 'put_premium') ?? 0));
  return { trend, numbers, money: volumeFollowsSide(money), refClose: last };
}
/** The scored factors' weight — a pillar with none of it is left out of the read */
const scoredWeight = (factors: readonly Factor[]): number => factors.reduce((a, f) => a + (f.context ? 0 : f.weight), 0);
export interface ScreenRead {
  pillars: { key: PillarKey; score: number; factors: Factor[]; inRead: boolean }[];
  composite: number;
  screen: Screen;
  grade: Grade;
  lean: Lean;
  thesis: string;
}
/** THE READ — the board's row and the page's headline both come from here, on the screener row */
export function readOfScreen(row: ScreenRow): ScreenRead {
  const f = screenFactors(row);
  const pillars = (['trend', 'numbers', 'money'] as const).map(key => ({ key, score: scoreOf(f[key]), factors: f[key], inRead: scoredWeight(f[key]) > 0 }));
  const scored = pillars.filter(p => p.inRead);
  const w = scored.reduce((a, p) => a + PILLAR_WEIGHTS[p.key], 0);
  const composite = w > 0 ? Math.round(scored.reduce((a, p) => a + p.score * PILLAR_WEIGHTS[p.key], 0) / w) : 50;
  const screen = screenOf(composite);
  return { pillars, composite, screen, grade: gradeOfComposite(composite), lean: leanOf(composite), thesis: thesisOf(scored.map(p => ({ key: p.key, score: p.score })), screen) };
}

const mmdd = (t: number): string => {
  const d = new Date(t * 1000);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
};

/* ---- the trend, from the name's sessions ------------------------------------------- */

const ema = (xs: number[], n: number): number | null => {
  if (xs.length < n) return null;
  const k = 2 / (n + 1);
  let e = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < xs.length; i++) e = xs[i] * k + e * (1 - k);
  return e;
};
const sma = (xs: number[], n: number): number | null => (xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n);
const rsi = (xs: number[], n = 14): number | null => {
  if (xs.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = xs[i] - xs[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
};
/** Wilder's ADX over daily highs, lows and closes — the sessions on hand are few, so it is a rough one */
const adx = (hi: number[], lo: number[], cl: number[], n = 14): number | null => {
  if (cl.length < n + 2) return null;
  let tr = 0;
  let dmp = 0;
  let dmm = 0;
  const dx: number[] = [];
  for (let i = 1; i < cl.length; i++) {
    const up = hi[i] - hi[i - 1];
    const dn = lo[i - 1] - lo[i];
    const p = up > dn && up > 0 ? up : 0;
    const m = dn > up && dn > 0 ? dn : 0;
    const t = Math.max(hi[i] - lo[i], Math.abs(hi[i] - cl[i - 1]), Math.abs(lo[i] - cl[i - 1]));
    if (i <= n) {
      tr += t;
      dmp += p;
      dmm += m;
      if (i < n) continue;
    } else {
      tr = tr - tr / n + t;
      dmp = dmp - dmp / n + p;
      dmm = dmm - dmm / n + m;
    }
    const dip = tr > 0 ? (100 * dmp) / tr : 0;
    const dim = tr > 0 ? (100 * dmm) / tr : 0;
    dx.push(dip + dim > 0 ? (100 * Math.abs(dip - dim)) / (dip + dim) : 0);
  }
  if (!dx.length) return null;
  return dx.reduce((a, b) => a + b, 0) / dx.length;
};

/** The trend from the sessions on hand (blocks of at least 30 bars), as of `uptoSessions` sessions back */
const trendFor = (blocks: Candle[][], spot: number, uptoSessions?: number): { read: TrendRead; factors: Factor[] } => {
  const used = uptoSessions != null ? blocks.slice(0, Math.max(0, blocks.length - uptoSessions)) : blocks;
  const closes = used.map(b => b[b.length - 1].close);
  const times = used.map(b => b[0].time);
  const highs = used.map(b => Math.max(...b.map(c => c.high)));
  const lows = used.map(b => Math.min(...b.map(c => c.low)));
  const last = uptoSessions != null ? closes[closes.length - 1] ?? spot : spot;
  const sessions = closes.length;
  const ema20 = ema(closes, 20);
  const sma50 = sma(closes, 50);
  const sma200 = sma(closes, 200);
  const rsi14 = rsi(closes, 14);
  const adx14 = adx(highs, lows, closes, 14);
  /* today's range against the sessions on hand */
  const ranges = used.map((b, i) => highs[i] - lows[i]);
  const today = ranges[ranges.length - 1];
  const atrPercentile = ranges.length >= 5 ? Math.round((100 * ranges.filter(r => r <= today).length) / ranges.length) : null;
  /* the structure: the last five sessions' swing against the five before */
  let structure = 'too few sessions to say';
  let structLean = 0;
  let flags: TrendRead['flags'] = null;
  if (sessions >= 10) {
    const hh = Math.max(...highs.slice(-5)) > Math.max(...highs.slice(-10, -5));
    const hl = Math.min(...lows.slice(-5)) > Math.min(...lows.slice(-10, -5));
    structure = hh && hl ? 'higher highs and higher lows' : !hh && !hl ? 'lower highs and lower lows' : hh ? 'higher highs, lower lows' : 'lower highs, higher lows';
    structLean = hh && hl ? 1 : !hh && !hl ? -1 : 0;
    flags = { hh, hl, lh: !hh, ll: !hl };
  }
  const averages = [ema20, sma50, sma200].filter((a): a is number => a != null);
  const above = { count: averages.filter(a => last > a).length, of: averages.length };
  const change5Pct = sessions >= 6 ? ((last - closes[sessions - 6]) / closes[sessions - 6]) * 100 : null;
  const change20Pct = sessions >= 21 ? ((last - closes[sessions - 21]) / closes[sessions - 21]) * 100 : null;
  const read: TrendRead = { closes, times, ema20, sma50, sma200, rsi14, adx14, atrPercentile, rangeToday: today ?? null, structure, flags, above, change5Pct, change20Pct, source: 'bars', refClose: last, sessions };
  const factors: Factor[] = [];
  if (ema20 != null) {
    const off = ((last - ema20) / ema20) * 100;
    factors.push({ key: 'ema20', label: 'Price against its 20-day EMA', value: `${pct(off)} · ${ema20.toFixed(2)}`, lean: clamp(off / 3), weight: 0.3, note: off >= 0 ? 'above its average — the trend holds' : 'under its average — the trend has slipped' });
  }
  if (rsi14 != null) factors.push({ key: 'rsi', label: 'RSI, 14 sessions', value: rsi14.toFixed(0), lean: clamp((rsi14 - 50) / 20), weight: 0.2, note: rsi14 >= 70 ? 'stretched — strong, but late' : rsi14 >= 55 ? 'firm' : rsi14 <= 30 ? 'washed out' : rsi14 <= 45 ? 'soft' : 'in the middle' });
  if (adx14 != null && change5Pct != null) {
    const dir = change5Pct >= 0 ? 1 : -1;
    factors.push({ key: 'adx', label: "ADX, the trend's strength", value: `${adx14.toFixed(0)} · ${change5Pct >= 0 ? 'up' : 'down'}`, lean: clamp(((adx14 - 20) / 20) * dir), weight: 0.2, note: adx14 >= 25 ? `a trend with force, ${change5Pct >= 0 ? 'upward' : 'downward'}` : 'no trend with force behind it' });
  }
  if (sessions >= 10) factors.push({ key: 'structure', label: 'The structure', value: structure, lean: structLean, weight: 0.2, note: structLean > 0 ? 'the swings step up' : structLean < 0 ? 'the swings step down' : 'the swings disagree' });
  if (change20Pct != null) factors.push({ key: 'chg20', label: 'The last 20 sessions', value: pct(change20Pct), lean: clamp(change20Pct / 8), weight: 0.1, note: change20Pct >= 0 ? 'up over the month' : 'down over the month' });
  return { read, factors };
};

/* THE BUSIEST CONTRACTS, FROM THE CHAIN (the data audit, 2026-10-22). They were built from the last 40 flow alerts, the
   dollars the alerts' premiums summed — AAPL's 350C read "$134K" against the contract's $6.56M day, and TSLA's 400C
   (68,212 contracts) was missing. They are now the chain's own contracts by the day's volume, expired ones excluded,
   with the day's whole premium — the same read and the same rule as the earnings page. */
const busiestOf = (rows: Record<string, unknown>[], right: 'C' | 'P', ticker: string, spot: number): BookContract[] => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  const out: BookContract[] = [];
  for (const row of rows) {
    const sym = String(row.option_symbol || '');
    const m = /(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(sym);
    if (!m || m[4] !== right) continue;
    const expiryIso = `20${m[1]}-${m[2]}-${m[3]}`;
    if (expiryIso < today) continue;
    const volume = nOr(row.volume) ?? 0;
    if (!(volume > 0)) continue;
    const strike = Number(m[5]) / 1000;
    const bid = nOr(row.nbbo_bid) ?? 0;
    const ask = nOr(row.nbbo_ask) ?? 0;
    const last = nOr(row.last_price) ?? 0;
    const fill = nOr(row.avg_price) ?? (bid > 0 && ask > 0 ? (bid + ask) / 2 : last);
    const premium = nOr(row.total_premium) ?? volume * fill * 100;
    const askV = nOr(row.ask_volume) ?? 0;
    const sweepV = nOr(row.sweep_volume) ?? 0;
    const oi = nOr(row.open_interest) ?? 0;
    const iv = nOr(row.implied_volatility) ?? 0;
    const dte = Math.max(0, Math.round((Date.UTC(+`20${m[1]}`, +m[2] - 1, +m[3]) - Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))) / 86_400_000));
    out.push({
      key: `${ticker}-${strike}-${right}-${expiryIso}`,
      ticker,
      sector: null,
      sectorColor: null,
      strike,
      right,
      expiry: `${m[2]}/${m[3]}/20${m[1]}`,
      dte,
      spot,
      otmPct: spot > 0 ? ((strike - spot) / spot) * 100 : 0,
      last,
      chgPct: 0,
      lastAt: String(row.last_tape_time || ''),
      lastAtMin: 0,
      volume,
      oi,
      deltaOI: 0,
      deltaOIPct: 0,
      premium,
      iv: iv * (iv < 3 ? 100 : 1),
      ivChg: 0,
      volOverOI: oi > 0 ? volume / oi : 0,
      sweepPct: volume > 0 ? (100 * sweepV) / volume : 0,
      multiPct: volume > 0 ? (100 * (nOr(row.multi_leg_volume) ?? 0)) / volume : 0,
      floorPct: volume > 0 ? (100 * (nOr(row.floor_volume) ?? 0)) / volume : 0,
      askPct: volume > 0 ? (100 * askV) / volume : 0,
      prevOI: nOr(row.prev_oi) ?? oi,
      prevVolume: 0,
      prevAvgFill: fill,
      prevPremium: 0,
      prevAskPct: 0,
      oiStreak: 0,
      volGtOiStreak: 0,
      earnDays: null,
      prevSpark: [],
    });
  }
  return out.sort((a, b) => b.volume - a.volume).slice(0, 3);
};

/* ---- the money, from the book, the flow and the dark pool ------------------------------- */

const moneyFor = (ticker: string, snapshot: MarketSnapshot, blocks: Candle[][], file: StockFile, allExpiries: boolean): { read: MoneyRead; factors: Factor[] } => {
  /* EVERY LISTED DATE, NOT THE DESK'S SCOPE (the ship pass, 2026-10-22): the Pinpoint desk's Levels card defaults to
     today's contracts, and a single stock with no same-day expiry (AAPL on a Thursday) then read an empty book — open
     interest 0, "50% calls", a $44M net GEX against the whole book's −$573M. The name's page reads the whole book. */
  const profile = buildExposureProfile(snapshot, 'ALL', LEVELS_WINDOW);
  const netVanna = profile.strikes.reduce((a, s) => a + (s.vanna?.net ?? 0), 0);
  const netCharm = profile.strikes.reduce((a, s) => a + (s.charm?.net ?? 0), 0);
  /* NET GEX AND THE REGIME FROM PINPOINT'S OWN READ (the re-audit, 2026-10-22): the profile's netGex sums a ±30-strike
     window (SPY −$11.6B against Pinpoint's −$14.69B on every strike). levelsFor is the one source both products read;
     it is in the retail sign, the money read keeps the house sign (the page flips it for print). */
  /* THE WHOLE BOOK ONLY WHEN IT IS LOOKED AT (the round-8 audit: 143 calls on AAPL's page, most of them the forty listed
     dates' chains behind these levels). levelsFor(t, 'ALL') walks every date; the page asks for it once the All-expiries
     panel is on screen (or the book is already whole — Pinpoint's cache is shared) */
  const pin = allExpiries ? levelsFor(ticker, 'ALL') : null;
  const pinToday = levelsFor(ticker, '0DTE');
  const houseNet = pin ? -pin.netGex : profile.netGex;
  const regime: MoneyRead['regime'] = regimeOfNet(houseNet) === 'SHORT' ? 'amplifying' : 'absorbing';
  const screen = file.screen;
  /* CALLS AGAINST PUTS ARE call_premium AGAINST put_premium (the third audit, 2026-10-23). They were read off
     bullish_premium / bearish_premium — WOLF printed "94% calls · the money is buying calls" on a day that was 6% calls
     (puts sold at the bid count as bullish). Both are kept now, each under its own name. */
  const callPremium = nOr(screen?.call_premium) ?? 0;
  const putPremium = nOr(screen?.put_premium) ?? 0;
  const bullishPremium = nOr(screen?.bullish_premium) ?? 0;
  const bearishPremium = nOr(screen?.bearish_premium) ?? 0;
  const callVolume = nOr(screen?.call_volume) ?? 0;
  const putVolume = nOr(screen?.put_volume) ?? 0;
  /* THE ASK SHARE IS THE DOLLARS PAID ON THE ASK (audit round 5: it summed whole alerts called ASK — 47% on AAPL against
     44.6% actually filled on the ask): each alert's own ask-side premium, over the alerts' whole premium */
  const flowPrem = file.flow.reduce((a, p) => a + Math.max(p.premium, (p.alertSides?.ask ?? 0) + (p.alertSides?.bid ?? 0) + (p.alertSides?.other ?? 0)), 0);
  const askPrem = file.flow.reduce((a, p) => a + (p.alertSides ? p.alertSides.ask : p.side === 'ASK' ? p.premium : 0), 0);
  const sweepPrem = file.flow.filter(p => p.sweep).reduce((a, p) => a + p.premium, 0);
  const askSharePct = flowPrem > 0 ? (100 * askPrem) / flowPrem : null;
  const sweepSharePct = flowPrem > 0 ? (100 * sweepPrem) / flowPrem : null;
  const unusual = file.flow.filter(p => p.volOverOI >= 2).length;
  const stockVol = nOr(screen?.stock_volume);
  const avg30 = nOr(screen?.avg30_volume);
  const rel = nOr(screen?.relative_volume);
  const vols = blocks.map(b => b.reduce((a, c) => a + (c.volume ?? 0), 0));
  const todayVol = stockVol ?? vols[vols.length - 1] ?? 0;
  const past = vols.slice(0, -1);
  const avgVol = avg30 ?? (past.length ? past.reduce((a, b) => a + b, 0) / past.length : 0);
  const rawRvol = rel != null && rel > 0 ? rel : avgVol > 0 && todayVol > 0 ? todayVol / avgVol : null;
  /* paced to the clock, as the read scores it (pacedRelVolume) */
  const rvolPaced = pacedRelVolume(rawRvol, typeof screen?.date === 'string' ? (screen.date as string) : null);
  const rvol = rvolPaced?.value ?? null;
  const lastBlock = blocks[blocks.length - 1];
  let closeInRange: number | null = null;
  if (lastBlock && lastBlock.length > 1) {
    const hi = Math.max(...lastBlock.map(c => c.high));
    const lo = Math.min(...lastBlock.map(c => c.low));
    closeInRange = hi > lo ? (lastBlock[lastBlock.length - 1].close - lo) / (hi - lo) : null;
  }
  const callOI = snapshot.chain.reduce((a, s) => a + (s.callOI ?? 0), 0);
  const putOI = snapshot.chain.reduce((a, s) => a + (s.putOI ?? 0), 0);
  /* OWN-TERMS PRINTS ARE OUT OF EVERY DARK FIGURE (the fourth audit, 2026-10-23): SPY's tape chart named 126K-share
     contingent blocks ($97.8M each) its largest while the read said "the largest $24M" — average-price, reference-price,
     contingent and derivative-priced prints are priced by their own terms, not the market, so the totals, the chart and
     every "largest" leave them out alike (SidesRule); they are only counted, apart */
  const ownTermsOut = file.dark.filter(p => !p.special);
  const darkShares = ownTermsOut.reduce((a, p) => a + p.size, 0);
  const darkNotional = ownTermsOut.reduce((a, p) => a + p.notional, 0);
  /* THE READ, ON TRACE'S CONVENTION (data/stockFile.ts darksFrom): the read prints' dollars paid over their own mid
     (buyer-initiated) against sold under it (seller-initiated); average-price, reference-price, contingent and
     extended-hours prints are on the tape but never in the read */
  const readPrints = file.dark.filter(darkReadable);
  const readNotional = readPrints.reduce((a, p) => a + p.notional, 0);
  const bought = readPrints.filter(p => p.intent === 'ACCUMULATION').reduce((a, p) => a + p.notional, 0);
  const sold = readPrints.filter(p => p.intent === 'DISTRIBUTION').reduce((a, p) => a + p.notional, 0);
  const netPosturePct = readNotional > 0 ? ((bought - sold) / readNotional) * 100 : 0;
  /* the cut-off is the word bands' own (data/darkpool.ts gradeOfPosture: a lean under 18 is "poor", no lean) — at ±15 a
     16% lean read "accumulating" beside a word that called it nothing (the third audit, 2026-10-23) */
  const posture: DarkPoolView['posture'] = netPosturePct >= 18 ? 'ACCUMULATING' : netPosturePct <= -18 ? 'DISTRIBUTING' : 'BALANCED';
  const largest = [...readPrints].sort((a, b) => b.notional - a.notional)[0] ?? null;
  const clocks = readPrints.map(p => p.time).filter(Boolean).sort();
  const darkWindow = {
    read: readPrints.length,
    readNotional,
    outsideRead: ownTermsOut.filter(p => !darkReadable(p)).length,
    inHand: file.dark.length,
    from: clocks[0] ?? null,
    to: clocks[clocks.length - 1] ?? null,
    complete: file.darkWindow.complete,
    cover: file.darkWindow.complete ? null : file.darkWindow.from || null,
    ownTerms: file.dark.filter(p => p.special).length,
  };
  const flowWindow = { alerts: file.flow.length, complete: file.flowWindow.complete, from: file.flowWindow.from || null, to: file.flowWindow.to || null };
  const dark: DarkPoolView = {
    ticker,
    spot: snapshot.spot,
    dpSharePct: todayVol > 0 && darkShares > 0 ? Math.min(100, (100 * darkShares) / todayVol) : 0,
    netPosturePct,
    posture,
    /* the note is the READ, not the rule: it is quoted inside the Why-now lines, where the bare definition ("A print
       under the price counts as buying…") landed mid-sentence and read as the finding (the dossier sweep, 2026-10-22).
       The read is Trace's: paid over its own mid is buyer-initiated, sold under it seller-initiated. Kept to
       the verdict alone: the factor's own label and value already say where the money printed. */
    postureNote: !readPrints.length
      ? ''
      : posture === 'ACCUMULATING'
        ? 'blocks paid over the mid — buyer-initiated'
        : posture === 'DISTRIBUTING'
          ? 'blocks sold under the mid — seller-initiated'
          : 'on both sides of the mid',
    totalNotional: darkNotional,
    levels: [],
    prints: ownTermsOut,
    largest,
  };
  const darkBlocks = ownTermsOut.filter(p => p.size >= 50_000).length;
  /* THE SESSION'S OWN MINUTES (the retail test, round 6: NVDA's "Oct 22 tape" drew the one daily bar — a 212.10–212.25
     axis on a 7.62 range, no line — because the blocks are daily bars once five sessions are in). The line is the book's
     one-minute cash bars of the dark tape's session; the blocks only when they are minutes themselves. */
  const sessionMinutes = (file.minutes && file.minutes.length > 1 ? file.minutes : bookCandles(ticker) ?? []).filter(c => {
    const at = c.time * 1000;
    const m = nyMinutes(at);
    return (!file.session || nyIsoDate(at) === file.session) && m >= SESSION_OPEN_MIN && m <= SESSION_CLOSE_MIN;
  });
  const today = (sessionMinutes.length > 1 ? sessionMinutes : lastBlock && lastBlock.length > 1 ? lastBlock : []).map(c => ({ time: c.time, close: c.close }));
  const read: MoneyRead = {
    netGex: houseNet,
    netDex: profile.netDex,
    netVex: profile.netVex !== 0 ? profile.netVex : null,
    netVanna,
    netCharm,
    /* BOTH SCOPES FROM levelsFor (the third audit, 2026-10-23) — the walls, the flip, the supreme, net GEX and the regime,
       and the scope's own label, exactly as Pinpoint prints them */
    levelsAll: pin,
    levelsToday: pinToday,
    levelsWindow: LEVELS_WINDOW,
    regime,
    callPremium,
    putPremium,
    bullishPremium,
    bearishPremium,
    callVolume,
    putVolume,
    askSharePct,
    sweepSharePct,
    rvol,
    rvolPaced,
    volumeToday: todayVol > 0 ? todayVol : null,
    volumeAvg: avgVol > 0 ? avgVol : null,
    volumeAvgIs30: avg30 != null,
    closeInRange,
    callOI,
    putOI,
    unusual,
    dark,
    darkWindow,
    flowWindow,
    darkBlocks,
    today,
    busiest: { calls: busiestOf(file.contracts, 'C', ticker, snapshot.spot), puts: busiestOf(file.contracts, 'P', ticker, snapshot.spot) },
  };
  const factors: Factor[] = [];
  const rvf = rvolFactor(rvolPaced, snapshot.changePercent >= 0);
  if (rvf) factors.push(rvf);
  /* THE MONEY'S SIDE, NOT ITS KIND (the third audit, 2026-10-23). A put sold at the bid is a bullish trade and a call
     sold at the bid a bearish one, so the side of the trade (bullish against bearish premium) carries most of the weight;
     the plain call/put split is a smaller second read, named for what it is — premium spent on calls, not buying. */
  factors.push(...premiumFactors(bullishPremium, bearishPremium, callPremium, putPremium));
  if (readPrints.length) factors.push({ key: 'dark', label: 'Off-exchange prints', value: posture === 'ACCUMULATING' ? 'over the mid' : posture === 'DISTRIBUTING' ? 'under the mid' : 'split', lean: clamp(netPosturePct / 40), weight: 0.3, note: dark.postureNote });
  return { read, factors: volumeFollowsSide(factors) };
};

/* ---- the news, from the wire ----------------------------------------------------- */

/* the name's own headlines (liveRecord.useTickerNews), not the whole day's wire */
const wireLive = (ticker: string) => peekTickerNews(ticker).status === 'live';

const newsFor = (ticker: string, file: StockFile): { read: NewsRead; factors: Factor[]; lastReport: { label: string; epsActual: number | null; epsEst: number | null; beat: boolean; result: 'beat' | 'inline' | 'miss' | null; movePct: number | null } | null } => {
  const feed = peekTickerNews(ticker);
  /* the vendor's own feed for the name: every story on it is the name's, whichever symbol leads it */
  const stories = (feed.status === 'live' ? feed.events : [])
    .slice()
    .sort((a, b) => a.item.minutesAgo - b.item.minutesAgo);
  const positive = stories.filter(s => s.grade === 'ALLY').length;
  const negative = stories.filter(s => s.grade === 'THREAT').length;
  const marked = positive + negative;
  const sentiment = marked ? (positive - negative) / marked : 0;
  const past = pastPrints(file.earnings);
  /* a vendor estimate far off the name's own run of estimates (META's 3.45 for a quarter whose neighbours were 6.6–8.2,
     against an actual of 7.40) is said to be off, not read as a 114% beat (the retail pass, 2026-10-22) */
  const ests = past.slice(0, 8).map(r => Math.abs(nOr(r.street_mean_est) ?? 0)).filter(v => v > 0).sort((a, b) => a - b);
  const medEst = ests.length >= 3 ? ests[Math.floor(ests.length / 2)] : 0;
  const reports: NewsRead['reports'] = past.slice(0, 8).map(r => {
    const actualOr = nOr(r.actual_eps);
    const estOr = nOr(r.street_mean_est);
    const actual = actualOr ?? 0;
    const est = estOr ?? 0;
    const move = nOr(r.post_earnings_move_1d);
    if (actualOr == null || estOr == null) return { label: reportDayLabelYear(String(r.report_date || '')), epsActual: actualOr, epsEst: estOr, beat: false, result: null, movePct: move == null ? null : move * 100, estOff: false };
    const result = epsResultOf(actual, est);
    const estOff = medEst > 0.25 && Math.abs(est) > 0 && (Math.abs(est) < medEst * 0.55 || Math.abs(est) > medEst * 1.8) && Math.abs(actual - est) > Math.abs(est) * 0.5;
    /* the move is a fraction of the price, per the spec ("0.0724" is 7.24%) */
    return { label: reportDayLabelYear(String(r.report_date || '')), epsActual: actual, epsEst: est, beat: result === 'beat', result, movePct: move == null ? null : move * 100, estOff };
  });
  /* THE USUAL MOVE ON ITS OWN ROWS: the latest eight reports with a next-session move, whether or not they carry an EPS
     estimate (the re-audit, 2026-10-22: GME's four newest reports had no estimate and were skipped) */
  /* (round 9) the same eight reports the table lists */
  const movedRows = past.slice(0, 8).filter(r => nOr(r.post_earnings_move_1d) != null);
  const reaction = movedRows.length ? { pct: movedRows.reduce((a, r) => a + Math.abs((nOr(r.post_earnings_move_1d) ?? 0) * 100), 0) / movedRows.length, reports: movedRows.length } : null;
  const last = reports[0];
  const lastReport = last ? { label: last.label, epsActual: last.epsActual, epsEst: last.epsEst, beat: last.beat, result: last.result, movePct: last.movePct } : null;
  const upcoming = nextReportRow(file.earnings, { skipOut: true });
  const nextEarnings = upcoming?.report_date
    ? {
        label: reportDayLabel(upcoming.report_date),
        daysOut: Math.max(0, tradingDaysUntil(upcoming.report_date)),
        /* a fraction of the price, per the spec, always */
        impliedMovePct: Math.abs(nOr(upcoming.expected_move_perc) ?? 0) * 100,
        confirmed: String(upcoming.source ?? '').toLowerCase() === 'company',
        timeKnown: /pre|post|after|before/i.test(String(upcoming.report_time ?? '')),
      }
    : null;
  const read: NewsRead = { stories: stories.slice(0, 6), sentiment, positive, negative, nextEarnings, reaction, reports };
  const factors: Factor[] = [];
  if (marked > 0) {
    factors.push({ key: 'lean', label: "The wire's lean", value: `${sentiment >= 0 ? '+' : sentiment < 0 ? '−' : ''}${Math.abs(sentiment).toFixed(2)} · ${positive} positive · ${negative} negative`, lean: clamp(sentiment), weight: 0.7, note: sentiment > 0.15 ? 'the stories read for the name' : sentiment < -0.15 ? 'the stories read against it' : 'no clear lean' });
  }
  if (stories.length) factors.push({ key: 'fresh', label: 'Stories on the wire', value: `${stories.length}`, lean: 0, weight: 0.1, note: 'how many landed on this name' });
  const biggest = stories.reduce<GeoNewsEvent | null>((m, s) => {
    if (!s.item.prediction.measured) return m;
    if (!m || Math.abs(s.item.prediction.expMove1dPct) > Math.abs(m.item.prediction.expMove1dPct)) return s;
    return m;
  }, null);
  if (biggest) factors.push({ key: 'move', label: 'Move at publish on the wire', value: pct(biggest.item.prediction.expMove1dPct), lean: clamp(biggest.item.prediction.expMove1dPct / 4), weight: 0.2, note: biggest.item.headline });
  return { read, factors, lastReport };
};

const EMPTY_NUMBERS: Fundamentals = {
  sample: true,
  epsEstimate: null,
  epsActual: null,
  epsSurprisePct: null,
  revenueEstimateB: null,
  revenueActualB: null,
  revenueSurprisePct: null,
  beats: null,
  beatOf: 0,
  revenueGrowthPct: null,
  epsGrowthPct: null,
  operatingMarginPct: null,
  freeCashFlowMarginPct: null,
  pe: null,
  sectorMedianPe: null,
  evToSales: null,
  peg: null,
  sectorPercentile: null,
  fairValue: null,
  vsFairValuePct: null,
  valuation: null,
  healthScore: null,
  guidance: null,
  dividendYieldPct: null,
  marketCap: null,
};

const nOr = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/* EVERY REPORT, ESTIMATE OR NOT (round 9: GME's page led with 09/09/25 — its 2026-09-08 report (EPS 0.27, +5.3%) and
   2025-12-09 (0.24) carry no street_mean_est and were dropped). A report is a past row with an actual or a next-session
   move; beat / in line / miss is read only where an estimate is on file (earningsFeed historyOf's rule). */
const hasVal = (v: unknown) => v != null && v !== '';
const pastPrints = (rows: EarnRow[]): EarnRow[] => {
  const today = nyTodayIso();
  return rows
    .filter(r => r.report_date && String(r.report_date).slice(0, 10) <= today && (hasVal(r.actual_eps) || hasVal(r.post_earnings_move_1d)))
    .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
};
const withEstimate = (r: EarnRow) => hasVal(r.actual_eps) && hasVal(r.street_mean_est);

/* The last print, earnings growth, the dividend and the market cap. Revenue, margins and a fair value are not on this feed. */
const numbersFor = (file: StockFile): { read: Fundamentals; factors: Factor[] } => {
  if (file.status !== 'live') return { read: EMPTY_NUMBERS, factors: [] };
  const past = pastPrints(file.earnings);
  const last = past[0];
  const window = past.slice(0, 8);
  const epsActual = last ? nOr(last.actual_eps) : null;
  const epsEstimate = last ? nOr(last.street_mean_est) : null;
  /* cents when the estimate is small or the two straddle zero — the same rule as the page's report table (StockName centsGap) */
  const tinyEst = epsEstimate != null && epsActual != null && (Math.abs(epsEstimate) < 0.25 || Math.sign(epsActual) !== Math.sign(epsEstimate));
  /* an estimate far off the name's own run of estimates is a vendor slip, not a surprise to size (META's 3.45 against
     neighbours of 6.6–8.2 read "beat by 114.5%" — the retail pass, 2026-10-22) */
  const runEsts = window.map(r => Math.abs(nOr(r.street_mean_est) ?? 0)).filter(v => v > 0).sort((a, b) => a - b);
  const runMed = runEsts.length >= 3 ? runEsts[Math.floor(runEsts.length / 2)] : 0;
  const estOff = epsEstimate != null && epsActual != null && runMed > 0.25 && Math.abs(epsEstimate) > 0 && (Math.abs(epsEstimate) < runMed * 0.55 || Math.abs(epsEstimate) > runMed * 1.8) && Math.abs(epsActual - epsEstimate) > Math.abs(epsEstimate) * 0.5;
  const epsSurprisePct = !estOff && epsActual != null && epsEstimate != null && epsEstimate !== 0 ? ((epsActual - epsEstimate) / Math.abs(epsEstimate)) * 100 : null;
  const scored = window.filter(withEstimate);
  const results = scored.map(r => epsResultOf(nOr(r.actual_eps) ?? 0, nOr(r.street_mean_est) ?? 0));
  const beats = results.filter(x => x === 'beat').length;
  const inline = results.filter(x => x === 'inline').length;
  const misses = results.filter(x => x === 'miss').length;
  const growth = nOr(file.screen?.eps_growth_4q);
  const div = nOr(file.screen?.dividend_yield);
  const cap = nOr(file.screen?.marketcap);
  if (epsActual == null && growth == null && div == null && cap == null) return { read: EMPTY_NUMBERS, factors: [] };
  const factors: Factor[] = [];
  if (epsSurprisePct != null) {
    factors.push({
      key: 'surprise',
      label: 'EPS against the estimate',
      value: tinyEst ? `${epsActual!.toFixed(2)} vs ${epsEstimate!.toFixed(2)} · ${epsActual! - epsEstimate! >= 0 ? '+' : '−'}${Math.round(Math.abs(epsActual! - epsEstimate!) * 100)}¢` : `${epsActual!.toFixed(2)} vs ${epsEstimate!.toFixed(2)} · ${pct(epsSurprisePct)}`,
      lean: tinyEst ? clamp(((epsActual! - epsEstimate!) * 100) / 8) : clamp(epsSurprisePct / 8),
      weight: 0.4,
      note: epsSurprisePct >= 0 ? 'the last print beat' : 'the last print missed',
    });
  }
  if (growth != null) {
    factors.push({
      key: 'growth',
      label: 'Earnings growth, year over year',
      value: pct(growth * 100, 2),
      lean: clamp(growth / 0.25),
      weight: 0.4,
      note: growth >= 0 ? 'earnings are growing' : 'earnings are shrinking',
    });
  }
  if (scored.length) {
    factors.push({
      key: 'beats',
      label: 'Against the estimate',
      value: `${beats} beat · ${inline} in line · ${misses} missed${scored.length < window.length ? ` · ${window.length - scored.length} with no estimate` : ''}`,
      lean: clamp((beats - misses) / scored.length),
      weight: 0.2,
      note: beats > misses ? 'more beats than misses' : misses > beats ? 'more misses than beats' : 'as many misses as beats',
    });
  }
  return {
    read: {
      sample: false,
      epsEstimate,
      epsActual,
      epsSurprisePct,
      revenueEstimateB: null,
      revenueActualB: null,
      revenueSurprisePct: null,
      beats: scored.length ? beats : null,
      beatOf: scored.length,
      inline: scored.length ? inline : null,
      misses: scored.length ? misses : null,
      revenueGrowthPct: null,
      epsGrowthPct: growth != null ? growth * 100 : null,
      operatingMarginPct: null,
      freeCashFlowMarginPct: null,
      pe: null,
      sectorMedianPe: null,
      evToSales: null,
      peg: null,
      sectorPercentile: null,
      fairValue: null,
      vsFairValuePct: null,
      valuation: null,
      healthScore: null,
      guidance: null,
      dividendYieldPct: div != null ? (Math.abs(div) <= 1.5 ? div * 100 : div) : null,
      marketCap: cap,
    },
    factors,
  };
};

/* ---- the words and the sums ------------------------------------------------------ */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const whyNowOf = (pillars: Pillar[]): string => {
  const all = pillars.flatMap(p => p.factors.filter(f => !f.context).map(f => ({ ...f, pull: Math.abs(f.lean) * f.weight * PILLAR_WEIGHTS[p.key] })));
  const top = all.filter(f => f.pull > 0).sort((a, b) => b.pull - a.pull).slice(0, 3);
  if (!top.length) return 'Nothing on the name stands out right now.';
  return top.map(f => `${cap(f.label)} ${f.value} — ${f.note}`).join(' · ') + '.';
};
/** A pillar's side in the read's sentences, on THE PILLAR LABELS' OWN CUTS (audit round 10: SPY "the money is selling"
    beside a Money of caution, 50%; UNH Money poor beside "nothing against it" — the sentences cut at 45/55 and 65, the
    labels at 46 and 60). For the name = good or strong, against it = poor, between = caution, said as neither. */
export const pillarSide = (score: number): 'for' | 'against' | 'middle' => {
  const g = gradeOf(score);
  return g === 'good' || g === 'strong' ? 'for' : g === 'poor' ? 'against' : 'middle';
};
/** The read in a sentence, from the pillars ranked best first — every clause from the pillars' own labels */
export function verdictSentence(ranked: readonly { score: number; name: string; good: string; bad: string }[], screen: Screen): string {
  if (!ranked.length) return 'Nothing on the name stands out right now.';
  const be = (p: { name: string }) => (p.name === 'the numbers' ? 'are' : 'is');
  const goods = ranked.filter(p => pillarSide(p.score) === 'for');
  const bads = ranked.filter(p => pillarSide(p.score) === 'against').reverse();
  const list = (xs: readonly { name: string }[]) => (xs.length === 1 ? xs[0].name : `${xs.slice(0, -1).map(x => x.name).join(', ')} and ${xs[xs.length - 1].name}`);
  if (ranked.length === 1) {
    const p = ranked[0];
    return cap(`${goods.length ? p.good : bads.length ? p.bad : `${p.name} ${be(p)} in the middle`}.`);
  }
  const soft = bads.length === 0 ? 'nothing against it' : bads.length === 1 ? `${bads[0].name} ${be(bads[0])} the one soft spot` : `${list(bads)} are the soft spots`;
  const help = goods.length === 0 ? 'nothing in its favour' : goods.length === 1 ? `${goods[0].name} alone cannot carry it` : `${list(goods)} cannot carry it`;
  if (screen === 'STRONG' && goods.length) return cap(`${goods.slice(0, 2).map(p => p.good).join(', ')}; ${soft}.`);
  if (screen === 'WEAK' && bads.length) return cap(`${bads.slice(0, 2).map(p => p.bad).join(', ')}; ${help}.`);
  if (!goods.length && !bads.length) return 'Nothing on the name is decisive.';
  if (!goods.length) return cap(`${bads.slice(0, 2).map(p => p.bad).join(', ')}; ${help}.`);
  if (!bads.length) return cap(`${goods.slice(0, 2).map(p => p.good).join(', ')}; nothing against it, the rest in the middle.`);
  return cap(`${goods[0].good} but ${bads[0].bad} — a catalyst decides.`);
}
const thesisOf = (pillars: readonly { key: PillarKey; score: number }[], screen: Screen): string => {
  const words: Record<PillarKey, { good: string; bad: string; name: string }> = {
    /* the trend's span named (round 8: CRM "STRONG · the trend is up" while down 3.5% on the year) — its factors are
       the 20-day average, the 14-session RSI, the week's ADX and the month */
    trend: { name: 'the trend', good: 'the short-term trend (weeks, not the year) is up', bad: 'the short-term trend (weeks, not the year) has turned down' },
    numbers: { name: 'the numbers', good: 'the numbers are clean', bad: 'the numbers are slipping' },
    money: { name: 'the money', good: 'the money is buying', bad: 'the money is selling' },
    news: { name: 'the news', good: 'the news helps', bad: 'the news hurts' },
  };
  const ranked = [...pillars].sort((a, b) => b.score - a.score).map(p => ({ score: p.score, ...words[p.key] }));
  return verdictSentence(ranked, screen);
};
/** Every factor's points: its lean × its share of the pillar × 50 × the pillar's weight — they sum to the score's distance from 50 */
const contributionsOf = (pillars: Pillar[]): Contribution[] =>
  pillars
    .flatMap(p => {
      const own = p.factors.filter(f => !f.context);
      const w = own.reduce((a, f) => a + f.weight, 0) || 1;
      return own.map(f => ({ key: `${p.key}:${f.key}`, pillar: p.key, label: f.label, value: f.value, points: Math.round(f.lean * (f.weight / w) * 50 * PILLAR_WEIGHTS[p.key] * 10) / 10 }));
    })
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
/** The factors whose flip would move the composite most — and by how much */
const movesOf = (pillars: Pillar[], composite: number): Move[] => {
  const out: Move[] = [];
  for (const p of pillars) {
    const own = p.factors.filter(x => !x.context);
    const w = own.reduce((a, f) => a + f.weight, 0) || 1;
    for (const f of own) {
      if (Math.abs(f.lean) < 0.15) continue;
      /* the factor turned the other way, the rest held */
      const flipped = own.map(x => (x === f ? { ...x, lean: -x.lean } : x));
      const pillarThen = Math.round(50 + 50 * flipped.reduce((a, x) => a + x.lean * x.weight, 0) / w);
      const delta = Math.round((pillarThen - p.score) * PILLAR_WEIGHTS[p.key]);
      if (delta === 0) continue;
      out.push({ key: `${p.key}:${f.key}`, label: f.label, delta, to: composite + delta });
    }
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
};
/* AGREE, ARGUE OR NEITHER — AND A NEUTRAL READ HAS NO SIDE TO AGREE WITH (the retail pass, 2026-10-22: NVDA read "0 OF 4
   AGREE" with every pillar "ARGUES", "numbers strong ARGUES" among them, while the text said "the numbers carry it", and
   "If the numbers are right … the neutral read fails there first"). A pillar's stance is its own side of 50 — for the
   name (55+), against it (45−) or in the middle. Under a bullish or bearish read a pillar on that side agrees, one on
   the other side argues, and one in the middle does neither. Under a neutral read nothing agrees or argues: each pillar
   says which way it pulls, and the sentences say the read is split. */
/* A PILLAR'S SIDE IS ITS GRADE'S (the fourth audit, 2026-10-23): AAPL read "3 of 3 agree … money caution AGREES … Every
   pillar agrees" — the side cut at 55 while the word "caution" runs 47–59, so a caution pillar was counted as backing a
   bullish read. A pillar is for the name when it grades good or strong, against it when poor, and a caution pillar is in
   the middle — it neither agrees nor argues. */
const sideOf = pillarSide; /* one rule with the sentences above */
const verbs = (p: Pillar, one: string, many: string) => (p.key === 'numbers' ? many : one);
const lowerName = (p: Pillar) => p.name.toLowerCase();
const topFactor = (p: Pillar) => p.factors.filter(f => !f.context).sort((a, b) => Math.abs(b.lean) * b.weight - Math.abs(a.lean) * a.weight)[0];
const listWords = (xs: string[]) => (xs.length <= 1 ? xs[0] ?? '' : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const agreementOf = (pillars: Pillar[], composite: number, news: NewsRead): Agreement => {
  const lean = leanOf(composite);
  const want = lean === 'bullish' ? 'for' : lean === 'bearish' ? 'against' : null;
  const rows = pillars.map(p => {
    const side = sideOf(p.score);
    const stance: AgreeStance = want == null ? side : side === 'middle' ? 'middle' : side === want ? 'agrees' : 'argues';
    return { key: p.key, name: p.name, score: p.score, agrees: stance === 'agrees', stance };
  });
  const priced = news.nextEarnings && news.nextEarnings.impliedMovePct > 0 ? `, ±${news.nextEarnings.impliedMovePct.toFixed(1)}% priced` : '';
  /* no report on the calendar: nothing is said of a next test ("a headline the wire has not seen yet" was filler) */
  const event = news.nextEarnings ? `the next test is the report on ${news.nextEarnings.label}${priced}` : '';
  const tail = (lead: string) => (event ? `${lead}; ${event}.` : `${lead}.`);
  let risk: string;
  if (want == null) {
    const pulls = pillars.filter(p => sideOf(p.score) === 'for').map(lowerName);
    const drags = pillars.filter(p => sideOf(p.score) === 'against').map(lowerName);
    risk = pulls.length && drags.length
      ? tail(`The read is split: ${listWords(pulls)} ${pulls.length === 1 && !/^the numbers/.test(pulls[0]) ? 'pulls' : 'pull'} for the name, ${listWords(drags)} against it, and neither side carries it`)
      : pulls.length || drags.length
        ? tail(`Only ${listWords(pulls.length ? pulls : drags)} ${pulls.length ? (/^the numbers/.test(pulls[0]) && pulls.length === 1 ? 'lean for the name' : 'leans for the name') : 'leans against it'}, not enough to tip the read`)
        : tail('No pillar leans either way');
  } else {
    const against = pillars.filter(p => sideOf(p.score) !== 'middle' && sideOf(p.score) !== want).sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
    if (against.length) {
      const p = against[0];
      const f = topFactor(p);
      risk = `The case against the ${lean} read is ${lowerName(p)}${f ? ` — ${f.label.toLowerCase()} ${f.value}, ${f.note}` : ''}; if that strengthens, the read turns there first.`;
    } else {
      const all = rows.every(r => r.stance === 'agrees');
      const between = rows.filter(r => r.stance === 'middle').map(r => r.name.toLowerCase());
      risk = tail(all ? 'Every pillar agrees' : `No pillar argues against it${between.length ? ` — ${listWords(between)} ${between.length === 1 && !/^the numbers/.test(between[0]) ? 'sits' : 'sit'} in the middle, at caution` : ''}`);
    }
  }
  return { lean, pillars: rows, aligned: rows.filter(r => r.agrees).length, risk };
};
const explanationOf = (name: string, composite: number, pillars: Pillar[], numbers: Fundamentals, agreement: Agreement): string => {
  const fair = numbers.sample || numbers.fairValue == null || numbers.vsFairValuePct == null || numbers.valuation == null ? '' : ` The numbers put the price ${pct(numbers.vsFairValuePct)} from fair value, ${numbers.valuation}.`;
  if (!pillars.length) return `${name} has no live read yet. ${agreement.risk}`;
  const grade = gradeOfComposite(composite);
  const strongest = (side: 'for' | 'against') => [...pillars].filter(p => sideOf(p.score) === side).sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50))[0];
  const why = (p: Pillar) => {
    const f = topFactor(p);
    return f ? ` — ${f.label.toLowerCase()} ${f.value}, ${f.note}` : '';
  };
  if (agreement.lean === 'neutral') {
    const up = strongest('for');
    const down = strongest('against');
    const lead = up && down
      ? `${name} reads ${grade} with no clear lean: ${lowerName(up)} ${verbs(up, 'pulls', 'pull')} for it${why(up)}, while ${lowerName(down)} ${verbs(down, 'pulls', 'pull')} against it${why(down)}.`
      : up || down
        ? `${name} reads ${grade} with no clear lean: only ${lowerName((up ?? down)!)} ${verbs((up ?? down)!, 'leans', 'lean')} ${up ? 'for it' : 'against it'}${why((up ?? down)!)}.`
        : `${name} reads ${grade} with no clear lean: every pillar sits in the middle.`;
    return `${lead}${fair}`;
  }
  const side = agreement.lean === 'bullish' ? 'for' : 'against';
  const carrier = strongest(side);
  const lead = carrier
    ? `${name} reads ${grade}, leaning ${agreement.lean}: ${lowerName(carrier)} ${side === 'for' ? verbs(carrier, 'carries it', 'carry it') : verbs(carrier, 'drags on it', 'drag on it')}${why(carrier)}`
    : `${name} reads ${grade}, leaning ${agreement.lean}`;
  const others = pillars.filter(p => p !== carrier);
  const next = [...others].sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50))[0];
  const nextWord = next ? (sideOf(next.score) === side ? verbs(next, 'agrees', 'agree') : sideOf(next.score) === 'middle' ? verbs(next, 'sits in the middle', 'sit in the middle') : verbs(next, 'argues', 'argue')) : '';
  return `${lead}${next ? `; ${lowerName(next)} ${nextWord}` : ''}.${fair} ${agreement.risk}`;
};
/* THE DAY'S MOVE, SAID AGAINST THE WIRE AND THE MARKET (round 9: AAPL's "why" was technicals only on a down day). A move
   of half a percent or more names today's story on the name when there is one, and the market's own move (SPY's), or
   says plainly that no story on the wire explains it. */
const todayWhyOf = (ticker: string, dayPct: number | null | undefined, news: NewsRead): string => {
  if (dayPct == null || !Number.isFinite(dayPct) || Math.abs(dayPct) < 0.5 || ticker === 'SPY') return '';
  const today = nyIsoDate();
  const story = news.stories.find(st => nyIsoDate(st.item.atMs) === today);
  const spy = peekQuote('SPY');
  const market = spy && spy.phase === 'regular' && Number.isFinite(spy.changePct) ? ` The market: SPY ${pct(spy.changePct)} today.` : '';
  const move = pct(dayPct);
  return story
    ? ` Today's ${move}: on the wire, "${story.item.headline.length > 110 ? `${story.item.headline.slice(0, 107)}…` : story.item.headline}".${market}`
    : ` No story on the wire today explains the ${move} move.${market}`;
};
const methodOf = (trend: TrendRead, money: MoneyRead, news: NewsRead, pillars: Pillar[], composite: number, lean: Lean): Method => ({
  observed: [
    `${trend.sessions} sessions of the name's own bars`,
    `${money.volumeToday != null ? `${fmtCount(money.volumeToday)} shares today` : 'no volume yet today'}${money.volumeAvg != null ? ` against ${fmtCount(money.volumeAvg)} usual` : ''}`,
    `the options book at every strike · ${fmtCount(money.callOI + money.putOI)} open interest`,
    money.callPremium + money.putPremium > 0 ? `${fmtMoney(money.callPremium + money.putPremium)} of option premium today (screener call_premium + put_premium)` : 'no option premium on the screener yet',
    money.dark.prints.length ? `${money.dark.prints.length} off-exchange ${money.dark.prints.length === 1 ? 'print' : 'prints'}` : 'no off-exchange prints in the recent tape',
    `${news.stories.length} ${news.stories.length === 1 ? 'story' : 'stories'} on the wire`,
  ],
  derived: [
    `the screener's 20-day EMA${trend.sma50 != null ? ', 50-' : ''}${trend.sma200 != null ? ' and 200-day SMA' : ''} · RSI · ADX · the range percentile · the structure`,
    `GEX · DEX · VEX · vanna · charm, and the walls, the flip and the supreme from them`,
    'bullish against bearish premium (the side of the trade) and calls against puts (the kind of contract), from the screener',
    money.darkWindow.read ? 'off-exchange prints over or under their own quote\'s mid, the regular session\'s sized prints only' : 'no regular-session off-exchange print to read',
    `the wire's lean from the stories' reads and expected moves`,
  ],
  inferred: [
    `${pillars.reduce((a, p) => a + p.factors.length, 0)} factors, each leaning for the name or against it — a pillar is the balance of its factors`,
    `the four pillars together give the read: strong, good, caution or poor — today ${gradeOfComposite(composite)}`,
    `the lean — ${lean} — from the same balance`,
  ],
});

/** The trend read with the screener row's own averages, RSI, ADX and changes — the figures its factors score */
const screenTrend = (bars: TrendRead, row: ScreenRow): TrendRead => {
  if (!row) return bars;
  const f = screenFactors(row);
  const ema20 = rowNum(row, 'ema_20');
  const sma50 = rowNum(row, 'sma_50');
  const sma200 = rowNum(row, 'sma_200');
  const rsi14 = rowNum(row, 'rsi_14');
  const adx14 = rowNum(row, 'adx_14');
  /* the week and the month off the same regular close (the vendor's percents run to the last print) */
  const weekRef = rowNum(row, 'one_week_close');
  const week = weekRef != null && weekRef > 0 && f.refClose != null && f.refClose > 0 ? f.refClose / weekRef - 1 : rowNum(row, 'one_week_perc');
  const monthRef = rowNum(row, 'one_month_close');
  const month = monthRef != null && monthRef > 0 && f.refClose != null && f.refClose > 0 ? f.refClose / monthRef - 1 : rowNum(row, 'one_month_perc');
  const ref = f.refClose ?? bars.refClose;
  const averages = [ema20, sma50, sma200].filter((a): a is number => a != null && a > 0);
  return {
    ...bars,
    ema20: ema20 ?? bars.ema20,
    sma50: sma50 ?? bars.sma50,
    sma200: sma200 ?? bars.sma200,
    rsi14: rsi14 ?? bars.rsi14,
    adx14: adx14 ?? bars.adx14,
    change5Pct: week != null ? week * 100 : bars.change5Pct,
    change20Pct: month != null ? month * 100 : bars.change20Pct,
    above: averages.length ? { count: averages.filter(a => ref > a).length, of: averages.length } : bars.above,
    source: 'screener',
    refClose: ref,
  };
};

/* ---- the overview ------------------------------------------------------------- */

export function buildStockOverview(tickerRaw: string, tape: readonly FlowPrint[] = [], opts: { allExpiries?: boolean } = {}): StockOverview | null {
  const ticker = tickerRaw.toUpperCase();
  /* the light book (the name's whole-book strikes and its front expiry); the forty dates load with the All-expiries panel */
  const snapshot = snapshotOf(ticker, opts.allExpiries ? 'full' : 'board');
  if (!snapshot) return null;
  const u = lookup(ticker);
  const name = u?.name ?? tickerName(ticker);
  const sector = u?.sector ?? null;
  const clock = readSessionClock();
  const marketWord = clock.phase === 'OPEN' ? 'market open' : clock.phase === 'AUCTION' ? 'the closing auction' : clock.phase === 'PREMARKET' ? 'before the open' : clock.phase === 'AFTERHOURS' ? 'after hours' : 'market closed';
  const minute = bookCandles(ticker) ?? [];
  const file = peekStockFile(ticker);
  /* the read is the screener row's: until the name's file lands there is no read to give (never a placeholder word) */
  if (file.status === 'loading') return null;
  const blocks = file.days.length >= 5 ? file.days.map(c => [c]) : minute.length >= 2 ? [minute] : [];

  /* THE DAY'S CHANGE IS THE REGULAR SESSION'S (the re-audit, 2026-10-22): after the bell the book's change is the
     after-hours move alone; the quote (data/liveQuote.ts) carries the session's change and the extended move apart */
  const quote = peekQuote(ticker);
  const dayPct = quote ? quote.changePct : snapshot.changePercent;
  const extLine = extendedLine(quote);
  const trendBars = trendFor(blocks, snapshot.spot);
  /* ONE SOURCE FOR EVERY TREND FIGURE ON THE PAGE (the fourth audit, 2026-10-23): the card computed its own ADX and RSI
     off the bars (GME 52, SPY 19) beside factors that score the screener's adx_14 (54; SPY 13.5), and "5 · 20 sessions
     +1.9% · +3.8%" sat beside "The last month +2.6%". The card now prints the screener row's own measures — the very
     numbers the factors score — and the bars keep only what the screener does not carry (the range, the structure). */
  const trend = { ...trendBars, read: screenTrend(trendBars.read, file.screen) };
  const money = moneyFor(ticker, { ...snapshot, changePercent: dayPct }, blocks, file, !!opts.allExpiries);
  const news = newsFor(ticker, file);
  const numbers = numbersFor(file);
  /* THE WORD IS THE BOARD'S (readOfScreen, on the screener row the board reads too); the page's own reads — the swing
     structure, the last print against its estimate, the dark pool, the wire — sit beside the scored factors as context */
  const sr = readOfScreen(file.screen);
  const ctx = (fs: Factor[]): Factor[] => fs.map(f => ({ ...f, context: true }));
  const scoredOf = (k: PillarKey): Factor[] => sr.pillars.find(p => p.key === k)?.factors ?? [];
  const inReadOf = (k: PillarKey): boolean => sr.pillars.find(p => p.key === k)?.inRead ?? false;
  const trendFactors = [...scoredOf('trend'), ...ctx(trend.factors.filter(f => f.key === 'structure'))];
  const numberFactors = [...scoredOf('numbers'), ...ctx(numbers.factors.filter(f => f.key !== 'growth'))];
  const moneyFactors = [...scoredOf('money'), ...ctx(money.factors.filter(f => f.key === 'dark'))];
  const pillars: Pillar[] = [
    { key: 'trend', name: PILLAR_NAMES.trend, inRead: inReadOf('trend'), score: scoreOf(trendFactors), factors: trendFactors, status: file.screen ? 'live' : 'thin', from: 'the screener row · the swing structure from the sessions on hand' },
    { key: 'numbers', name: PILLAR_NAMES.numbers, inRead: inReadOf('numbers'), score: scoreOf(numberFactors), factors: numberFactors, status: inReadOf('numbers') ? 'live' : 'sample', from: inReadOf('numbers') ? 'earnings growth, with the last print beside it' : 'not on this feed' },
    { key: 'money', name: PILLAR_NAMES.money, inRead: inReadOf('money'), score: scoreOf(moneyFactors), factors: moneyFactors, status: file.screen ? 'live' : 'thin', from: 'the screener row · the dark pool beside it' },
    { key: 'news', name: PILLAR_NAMES.news, inRead: false, score: 50, factors: ctx(news.factors), status: wireLive(ticker) || news.read.reports.length ? 'live' : 'thin', from: 'the wire — shown, not scored' },
  ];
  const scored = pillars.filter(p => p.inRead);
  const composite = sr.composite;
  const screen = sr.screen;
  const lean = sr.lean;
  const livePillars = scored;

  /* the trend as it stood N sessions ago — the other live pillars are held */
  const held = scored.filter(p => p.key !== 'trend');
  const heldRest = held.reduce((a, p) => a + p.score * PILLAR_WEIGHTS[p.key], 0);
  const heldW = held.reduce((a, p) => a + PILLAR_WEIGHTS[p.key], 0);
  const compositeAt = (trendScore: number | null): number => {
    const useTrend = trendScore != null && trend.factors.length > 0;
    const w = heldW + (useTrend ? PILLAR_WEIGHTS.trend : 0);
    if (!(w > 0)) return 50;
    return Math.round((heldRest + (useTrend ? trendScore * PILLAR_WEIGHTS.trend : 0)) / w);
  };
  /* the history reads the same four measures off the name's own bars (the structure is context, as on the page) */
  const trendAt = (back: number): number | null => {
    const t = trendFor(blocks, snapshot.spot, back).factors.filter(f => f.key !== 'structure');
    return t.length ? scoreOf(t) : null;
  };
  const sessions = trend.read.sessions;
  const trend5 = sessions > 5 ? trendAt(5) : null;
  const trend20 = sessions > 20 ? trendAt(20) : null;
  const history: ScoreHistory = {
    trend5,
    trend20,
    composite5: trend5 == null ? null : compositeAt(trend5),
    composite20: trend20 == null ? null : compositeAt(trend20),
  };
  /* session by session, as far back as the factors can still be read */
  const series: TrendPoint[] = [];
  for (let back = Math.min(20, Math.max(0, sessions - 1)); back >= 0; back--) {
    const t = back === 0 ? pillars[0].score : trendAt(back);
    const block = blocks[blocks.length - 1 - back];
    if (t == null || !block) continue;
    series.push({ back, time: block[0].time, trend: t, composite: compositeAt(t) });
  }
  const scoreAt = (back: number): number | null => series.find(s => s.back === back)?.trend ?? null;

  /* THE TIMELINE — what happened on the sessions on hand, newest first */
  const timeline: TimelineEntry[] = [];
  news.read.stories.slice(0, 3).forEach(s => timeline.push({ key: `news:${s.id}`, when: s.item.time, kind: 'news', text: s.item.headline, time: null, score: pillars[0].score }));
  const n = blocks.length;
  /* every session on hand, not the last ten — the box says "what happened on the 87 sessions on hand" and drew its lanes
     across all of them, so a scan of ten read as "none on hand" (the Dossier sweep, 2026-10-22) */
  for (let i = n - 1; i >= 1; i--) {
    const b = blocks[i];
    const prev = blocks[i - 1];
    const back = n - 1 - i;
    const when = mmdd(b[0].time);
    const close = b[b.length - 1].close;
    const prevClose = prev[prev.length - 1].close;
    const vol = b.reduce((a, c) => a + (c.volume ?? 0), 0);
    const prevVol = prev.reduce((a, c) => a + (c.volume ?? 0), 0);
    const chg = prevClose > 0 ? ((close - prevClose) / prevClose) * 100 : 0;
    const priorHighs = blocks.slice(Math.max(0, i - 10), i).map(x => Math.max(...x.map(c => c.high)));
    const priorLows = blocks.slice(Math.max(0, i - 10), i).map(x => Math.min(...x.map(c => c.low)));
    const time = b[0].time;
    if (priorHighs.length >= 5 && close > Math.max(...priorHighs)) timeline.push({ key: `breakout:${when}`, when, kind: 'breakout', text: `closed above the prior sessions' highs, at ${close.toFixed(2)}`, time, score: scoreAt(back) });
    else if (priorLows.length >= 5 && close < Math.min(...priorLows)) timeline.push({ key: `breakdown:${when}`, when, kind: 'breakdown', text: `closed under the prior sessions' lows, at ${close.toFixed(2)}`, time, score: scoreAt(back) });
    if (prevVol > 0 && vol >= prevVol * 1.6) timeline.push({ key: `volume:${when}`, when, kind: 'volume', text: `volume ${(vol / prevVol).toFixed(1)}× the session before`, time, score: scoreAt(back) });
    if (Math.abs(chg) >= 2.5) timeline.push({ key: `session:${when}`, when, kind: 'session', text: `a ${pct(chg)} session`, time, score: scoreAt(back) });
  }
  if (news.lastReport) {
    const q = news.lastReport;
    const said = q.result == null || q.epsActual == null || q.epsEst == null ? (q.epsActual != null ? `reported EPS ${q.epsActual.toFixed(2)} — no estimate on file` : 'reported — no EPS on file') : `${q.result === 'beat' ? 'beat' : q.result === 'inline' ? 'in line' : 'missed'} on EPS — ${q.epsActual.toFixed(2)} against ${q.epsEst.toFixed(2)}`;
    timeline.push({ key: `earnings:${q.label}`, when: q.label, kind: 'earnings', text: `${said}${q.movePct != null ? ` · ${pct(q.movePct)} the session after` : ''}`, time: null, score: null });
  }

  const contributions = contributionsOf(livePillars);
  const moves = movesOf(livePillars, composite);
  const agreement = agreementOf(livePillars, composite, news.read);
  const own = (tape.length ? tape : file.flow).filter(p => !p.ticker || p.ticker === ticker);
  const prints = {
    buys: [...own].filter(p => p.side === 'ASK').sort((a, b) => b.premium - a.premium).slice(0, 5),
    sells: [...own].filter(p => p.side === 'BID').sort((a, b) => b.premium - a.premium).slice(0, 5),
  };

  const at = now();
  /* New York's clock, said as ET — the machine's own clock read 23:25 beside a page clock of 19:25 ET (the retail test) */
  const stamp = nyClock(at, { zone: true });
  const record = peekLive();
  const insiderN = record.insiders.status === 'live' ? record.insiders.trades.filter(t => t.ticker === ticker).length : 0;
  const congressN = record.congress.status === 'live' ? record.congress.trades.filter(t => t.ticker === ticker).length : 0;
  const sources: Source[] = [
    { key: 'price', label: 'Price', status: quote ? 'live' : 'thin', stamp: quote ? `last print ${nyClock(quote.tapeAt, { zone: true })}` : 'reading the quote' },
    { key: 'book', label: 'The options book', status: 'live', stamp: `read ${stamp}` },
    /* the tapes' own read, not the file's head (the retail test, round 6: "The flow book LIVE · no alerts on this name"
       beside "READING THE FLOW ALERTS…") — nothing is "none" until the tapes are in */
    { key: 'flow', label: 'The flow book', status: file.tapes === 'live' ? 'live' : 'thin', stamp: file.tapes === 'loading' ? 'reading…' : file.flow.length ? `${file.flow.length} ${file.flow.length === 1 ? 'alert' : 'alerts'}` : file.tapes === 'live' ? 'no alerts on this name' : 'the read did not land' },
    /* COUNTS THAT SAY WHAT THEY COUNT (audit round 7: "The tape 990 prints" was the 990 flow alerts, and "Dark pool 699
       prints" sat beside the card's 648 — the 51 own-terms prints are left out of the card). The biggest buys and sells
       are read off the flow alerts, so the tape says alerts; the dark pool says how many the card reads and why the rest
       are out. */
    { key: 'tape', label: 'The tape', status: file.tapes === 'live' ? 'live' : 'thin', stamp: file.tapes === 'loading' ? 'reading…' : file.flow.length ? `the biggest buys and sells, off the ${file.flow.length} flow ${file.flow.length === 1 ? 'alert' : 'alerts'}` : file.tapes === 'live' ? 'no alerts to read buys and sells off' : 'the read did not land' },
    {
      key: 'dark',
      label: 'Dark pool',
      status: file.tapes === 'live' ? 'live' : 'thin',
      stamp: (() => {
        if (file.tapes === 'loading') return 'reading…';
        if (!file.dark.length) return file.tapes === 'live' ? 'nothing recent' : 'the read did not land';
        const own = file.dark.filter(p => p.special).length;
        const kept = file.dark.length - own;
        return own ? `${kept} ${kept === 1 ? 'print' : 'prints'} on the card · ${own} own-terms of the ${file.dark.length} read left out` : `${kept} ${kept === 1 ? 'print' : 'prints'}`;
      })(),
    },
    { key: 'news', label: 'The wire', status: wireLive(ticker) ? 'live' : 'thin', stamp: news.read.stories.length ? `the newest story ${news.read.stories[0].item.time}` : 'nothing on this name yet' },
    { key: 'sessions', label: 'Sessions', status: sessions >= 20 ? 'live' : 'thin', stamp: `${sessions} on hand` },
    { key: 'fundamentals', label: 'Fundamentals', status: numbers.read.sample ? 'thin' : 'live', stamp: numbers.read.sample ? 'the feed has no print for this name yet' : 'the last print and earnings growth' },
    { key: 'record', label: 'Insiders and Congress', status: record.insiders.status === 'live' || record.congress.status === 'live' ? 'live' : 'thin', stamp: insiderN || congressN ? `${insiderN} insider ${insiderN === 1 ? 'trade' : 'trades'} · ${congressN} congress ${congressN === 1 ? 'report' : 'reports'} in the latest feed` : 'the name\'s own filings below' },
  ];
  const completeness = Math.round((100 * sources.filter(s => s.status === 'live').length) / sources.length);
  const settling: string[] = [];
  if (!quote) settling.push('the quote');
  if (file.screen && screenerNeedsCloses(file.screen) && peekRegularCloses(ticker) == null) settling.push('the regular closes');
  if (file.tapes === 'loading') settling.push('the flow and dark-pool tapes');

  return {
    ticker,
    name,
    sector,
    /* ONE QUOTE ACROSS THE DOSSIER: the headline is liveQuote's price, said as which price it is */
    price: priceWords(quote)?.lead ?? snapshot.spot,
    changePct: dayPct,
    extLine,
    priceLine: priceWords(quote)?.line ?? null,
    lastSession: quote && quote.phase === 'pre' && quote.lastSessionPct != null ? { pct: quote.lastSessionPct, date: quote.regDate } : null,
    marketWord,
    pillars,
    composite,
    screen,
    lean,
    weights: PILLAR_WEIGHTS,
    whyNow: whyNowOf(scored),
    thesis: sr.thesis,
    explanation: `${explanationOf(name, composite, livePillars, numbers.read, agreement)}${todayWhyOf(ticker, dayPct, news.read)}`,
    wouldMove: moves.slice(0, 2).map(m => {
      const now = gradeOfComposite(composite);
      const then = gradeOfComposite(m.to);
      return then === now ? `${m.label} turning the other way would ${m.delta > 0 ? 'help' : 'hurt'} the read, which would still say ${now}` : `${m.label} turning the other way would take the read from ${now} to ${then}`;
    }),
    moves,
    contributions,
    agreement,
    series,
    timeline,
    method: methodOf(trend.read, money.read, news.read, pillars, composite, lean),
    prints,
    trend: trend.read,
    money: money.read,
    news: news.read,
    numbers: numbers.read,
    history,
    sources,
    completeness,
    settling,
  };
}
