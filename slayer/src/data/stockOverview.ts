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

import { regimeOfNet } from './flipLevel';
import { levelsFor } from './levelsFor';
import { now } from '../core/clock';
import { readSessionClock } from './moc';
import { buildExposureProfile } from './exposure';
import { LEVELS_WINDOW } from './roomLevels';
import { bookCandles, expiryDateFor, snapshotOf } from './uwBook';
import { peekQuote, extendedLine } from './liveQuote';
import { peekLive } from './liveRecord';
import { darkReadable, peekStockFile, type EarnRow, type StockFile } from './stockFile';
import { nyTodayIso } from './nyDate';
import { epsResultOf, nextReportRow, reportDayLabel, reportDayLabelYear, tradingDaysUntil } from './earningsFeed';
import type { GeoNewsEvent } from './newsroom';
import { lookup } from './universe';
import { tickerName } from './tickers';
import type { Fundamentals } from './fundamentals';
import type { Candle, MarketSnapshot } from '../types/market';
import type { ExposureLevels } from '../types/gex';
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
}

export interface Pillar {
  key: PillarKey;
  name: string;
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
  change5Pct: number | null;
  change20Pct: number | null;
  sessions: number;
}

export interface MoneyRead {
  netGex: number;
  netDex: number;
  /** null when the vendor's book carries no vega (its greek-exposure rows have none) — never a measured $0 */
  netVex: number | null;
  netVanna: number;
  netCharm: number;
  /** The walls, the flip and the supreme over every listed expiry — Pinpoint's own buildExposureProfile(…, 'ALL') */
  levels: ExposureLevels;
  /** The same read on today's expiry alone ('0DTE'), when the name lists one today — null otherwise */
  levelsToday: ExposureLevels | null;
  /** The expiry date Pinpoint's Today scope reads on this name ("2026-10-23" after the bell), or null */
  levelsTodayDate: string | null;
  /** Strikes either side of spot the net figures are summed over */
  levelsWindow: number;
  /** dealers 'absorbing' (long gamma) or 'amplifying' (short) at spot */
  regime: 'absorbing' | 'amplifying';
  callPremium: number;
  putPremium: number;
  callVolume: number;
  putVolume: number;
  askSharePct: number | null;
  sweepSharePct: number | null;
  rvol: number | null;
  volumeToday: number | null;
  volumeAvg: number | null;
  /** Where today's close sits in its own range, 0 (the low) to 1 (the high) */
  closeInRange: number | null;
  callOI: number;
  putOI: number;
  /** Contracts on the book trading at least twice their open interest */
  unusual: number;
  dark: DarkPoolView;
  /** What the dark-pool read stands on: the read prints (sized, regular session, priced at the quote) of the prints in
      hand, and the New York clock window they span */
  darkWindow: { read: number; inHand: number; from: string | null; to: string | null };
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
  reports: { label: string; epsActual: number; epsEst: number; beat: boolean; result: 'beat' | 'inline' | 'miss'; movePct: number | null; estOff: boolean }[];
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
const pct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
export const fmtMoney = (v: number): string => {
  const a = Math.abs(v);
  const s = a >= 1e12 ? `$${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `$${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(0)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}K` : `$${a.toFixed(0)}`;
  return v < 0 ? `−${s}` : s;
};
const fmtCount = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`);
/** A pillar's score from its factors: 50 + 50 × the leans' weighted mean */
const scoreOf = (factors: Factor[]): number => {
  const w = factors.reduce((a, f) => a + f.weight, 0) || 1;
  return Math.round(50 + 50 * factors.reduce((a, f) => a + f.lean * f.weight, 0) / w);
};
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
  const read: TrendRead = { closes, times, ema20, sma50, sma200, rsi14, adx14, atrPercentile, rangeToday: today ?? null, structure, flags, above, change5Pct, change20Pct, sessions };
  const factors: Factor[] = [];
  if (ema20 != null) {
    const off = ((last - ema20) / ema20) * 100;
    factors.push({ key: 'ema20', label: 'Price against its 20-day average', value: `${pct(off)} · ${ema20.toFixed(2)}`, lean: clamp(off / 3), weight: 0.3, note: off >= 0 ? 'above its average — the trend holds' : 'under its average — the trend has slipped' });
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

const moneyFor = (ticker: string, snapshot: MarketSnapshot, blocks: Candle[][], file: StockFile): { read: MoneyRead; factors: Factor[] } => {
  /* EVERY LISTED DATE, NOT THE DESK'S SCOPE (the ship pass, 2026-10-22): the Pinpoint desk's Levels card defaults to
     today's contracts, and a single stock with no same-day expiry (AAPL on a Thursday) then read an empty book — open
     interest 0, "50% calls", a $44M net GEX against the whole book's −$573M. The name's page reads the whole book. */
  const profile = buildExposureProfile(snapshot, 'ALL', LEVELS_WINDOW);
  const netVanna = profile.strikes.reduce((a, s) => a + (s.vanna?.net ?? 0), 0);
  const netCharm = profile.strikes.reduce((a, s) => a + (s.charm?.net ?? 0), 0);
  /* NET GEX AND THE REGIME FROM PINPOINT'S OWN READ (the re-audit, 2026-10-22): the profile's netGex sums a ±30-strike
     window (SPY −$11.6B against Pinpoint's −$14.69B on every strike). levelsFor is the one source both products read;
     it is in the retail sign, the money read keeps the house sign (the page flips it for print). */
  const pin = levelsFor(ticker, 'ALL');
  const houseNet = pin ? -pin.netGex : profile.netGex;
  const regime: MoneyRead['regime'] = regimeOfNet(houseNet) === 'SHORT' ? 'amplifying' : 'absorbing';
  const screen = file.screen;
  const callPremium = nOr(screen?.bullish_premium) ?? 0;
  const putPremium = nOr(screen?.bearish_premium) ?? 0;
  const callVolume = nOr(screen?.call_volume) ?? 0;
  const putVolume = nOr(screen?.put_volume) ?? 0;
  const flowPrem = file.flow.reduce((a, p) => a + p.premium, 0);
  const askPrem = file.flow.filter(p => p.side === 'ASK').reduce((a, p) => a + p.premium, 0);
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
  const rvol = rel != null && rel > 0 ? rel : avgVol > 0 && todayVol > 0 ? todayVol / avgVol : null;
  const lastBlock = blocks[blocks.length - 1];
  let closeInRange: number | null = null;
  if (lastBlock && lastBlock.length > 1) {
    const hi = Math.max(...lastBlock.map(c => c.high));
    const lo = Math.min(...lastBlock.map(c => c.low));
    closeInRange = hi > lo ? (lastBlock[lastBlock.length - 1].close - lo) / (hi - lo) : null;
  }
  const callOI = snapshot.chain.reduce((a, s) => a + (s.callOI ?? 0), 0);
  const putOI = snapshot.chain.reduce((a, s) => a + (s.putOI ?? 0), 0);
  const darkShares = file.dark.reduce((a, p) => a + p.size, 0);
  const darkNotional = file.dark.reduce((a, p) => a + p.notional, 0);
  /* THE READ, ON TRACE'S CONVENTION (data/stockFile.ts darksFrom): the read prints' dollars paid over their own mid
     (buyer-initiated) against sold under it (seller-initiated); average-price, reference-price, contingent and
     extended-hours prints are on the tape but never in the read */
  const readPrints = file.dark.filter(darkReadable);
  const readNotional = readPrints.reduce((a, p) => a + p.notional, 0);
  const bought = readPrints.filter(p => p.intent === 'ACCUMULATION').reduce((a, p) => a + p.notional, 0);
  const sold = readPrints.filter(p => p.intent === 'DISTRIBUTION').reduce((a, p) => a + p.notional, 0);
  const netPosturePct = readNotional > 0 ? ((bought - sold) / readNotional) * 100 : 0;
  const posture: DarkPoolView['posture'] = netPosturePct > 15 ? 'ACCUMULATING' : netPosturePct < -15 ? 'DISTRIBUTING' : 'BALANCED';
  const largest = [...readPrints].sort((a, b) => b.notional - a.notional)[0] ?? null;
  const clocks = readPrints.map(p => p.time).filter(Boolean).sort();
  const darkWindow = { read: readPrints.length, inHand: file.dark.length, from: clocks[0] ?? null, to: clocks[clocks.length - 1] ?? null };
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
    prints: file.dark,
    largest,
  };
  const darkBlocks = file.dark.filter(p => p.size >= 50_000).length;
  const today = (lastBlock ?? []).map(c => ({ time: c.time, close: c.close }));
  const read: MoneyRead = {
    netGex: houseNet,
    netDex: profile.netDex,
    netVex: profile.netVex !== 0 ? profile.netVex : null,
    netVanna,
    netCharm,
    levels: profile.levels,
    /* TODAY'S LEVELS BESIDE THE WHOLE BOOK'S (the retail pass, 2026-10-22: SPY's Dossier read 760 / 774.65 / 800 on every
       expiry while Pinpoint opens on Today, 760 / 770.96 / 780) — the same Pinpoint function on the '0DTE' scope */
    levelsToday: snapshot.liveBook && (snapshot.uwChains?.['0DTE']?.length ?? 0) > 0 ? buildExposureProfile(snapshot, '0DTE', LEVELS_WINDOW).levels : null,
    levelsTodayDate: expiryDateFor(ticker, '0DTE'),
    levelsWindow: LEVELS_WINDOW,
    regime,
    callPremium,
    putPremium,
    callVolume,
    putVolume,
    askSharePct,
    sweepSharePct,
    rvol,
    volumeToday: todayVol > 0 ? todayVol : null,
    volumeAvg: avgVol > 0 ? avgVol : null,
    closeInRange,
    callOI,
    putOI,
    unusual,
    dark,
    darkWindow,
    darkBlocks,
    today,
    busiest: { calls: busiestOf(file.contracts, 'C', ticker, snapshot.spot), puts: busiestOf(file.contracts, 'P', ticker, snapshot.spot) },
  };
  const factors: Factor[] = [];
  if (rvol != null) factors.push({ key: 'rvol', label: 'Relative volume', value: `${rvol.toFixed(2)}×`, lean: clamp((rvol - 1) * (snapshot.changePercent >= 0 ? 1 : -1)), weight: 0.25, note: rvol >= 1.3 ? `heavy for the name, ${snapshot.changePercent >= 0 ? 'on an up day' : 'on a down day'}` : rvol <= 0.7 ? 'quiet' : 'ordinary' });
  if (callPremium + putPremium > 0) {
    const share = callPremium / (callPremium + putPremium);
    factors.push({ key: 'prem', label: 'Call premium against put premium', value: `${Math.round(share * 100)}% calls`, lean: clamp((share - 0.5) * 4), weight: 0.45, note: share >= 0.55 ? 'the money is buying calls' : share <= 0.45 ? 'the money is buying puts' : 'calls and puts are about even' });
  }
  if (readPrints.length) factors.push({ key: 'dark', label: 'Off-exchange prints', value: posture === 'ACCUMULATING' ? 'over the mid' : posture === 'DISTRIBUTING' ? 'under the mid' : 'split', lean: clamp(netPosturePct / 40), weight: 0.3, note: dark.postureNote });
  return { read, factors };
};

/* ---- the news, from the wire ----------------------------------------------------- */

const wireLive = (ticker: string) => peekLive().news.status === 'live' && peekLive().news.events.some(e => e.item.ticker === ticker);

const newsFor = (ticker: string, file: StockFile): { read: NewsRead; factors: Factor[]; lastReport: { label: string; epsActual: number; epsEst: number; beat: boolean; result: 'beat' | 'inline' | 'miss'; movePct: number | null } | null } => {
  const feed = peekLive().news;
  const stories = (feed.status === 'live' ? feed.events : [])
    .filter(e => e.item.ticker === ticker)
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
    const actual = nOr(r.actual_eps) ?? 0;
    const est = nOr(r.street_mean_est) ?? 0;
    const move = nOr(r.post_earnings_move_1d);
    const result = epsResultOf(actual, est);
    const estOff = medEst > 0.25 && Math.abs(est) > 0 && (Math.abs(est) < medEst * 0.55 || Math.abs(est) > medEst * 1.8) && Math.abs(actual - est) > Math.abs(est) * 0.5;
    /* the move is a fraction of the price, per the spec ("0.0724" is 7.24%) */
    return { label: reportDayLabelYear(String(r.report_date || '')), epsActual: actual, epsEst: est, beat: result === 'beat', result, movePct: move == null ? null : move * 100, estOff };
  });
  /* THE USUAL MOVE ON ITS OWN ROWS: the latest eight reports with a next-session move, whether or not they carry an EPS
     estimate (the re-audit, 2026-10-22: GME's four newest reports had no estimate and were skipped) */
  const today = nyTodayIso();
  const movedRows = file.earnings
    .filter(r => r.report_date && String(r.report_date) <= today && nOr(r.post_earnings_move_1d) != null)
    .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)))
    .slice(0, 8);
  const reaction = movedRows.length ? { pct: movedRows.reduce((a, r) => a + Math.abs((nOr(r.post_earnings_move_1d) ?? 0) * 100), 0) / movedRows.length, reports: movedRows.length } : null;
  const last = reports[0];
  const lastReport = last ? { label: last.label, epsActual: last.epsActual, epsEst: last.epsEst, beat: last.beat, result: last.result, movePct: last.movePct } : null;
  const upcoming = nextReportRow(file.earnings);
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
    factors.push({ key: 'lean', label: "The wire's lean", value: `${sentiment >= 0 ? '+' : ''}${sentiment.toFixed(2)} · ${positive} positive · ${negative} negative`, lean: clamp(sentiment), weight: 0.7, note: sentiment > 0.15 ? 'the stories read for the name' : sentiment < -0.15 ? 'the stories read against it' : 'no clear lean' });
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

const pastPrints = (rows: EarnRow[]): EarnRow[] =>
  rows
    .filter(r => r.actual_eps != null && r.street_mean_est != null && r.report_date)
    .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));

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
  const results = window.map(r => epsResultOf(nOr(r.actual_eps) ?? 0, nOr(r.street_mean_est) ?? 0));
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
      label: 'Earnings growth, four quarters',
      value: pct(growth * 100),
      lean: clamp(growth / 0.25),
      weight: 0.4,
      note: growth >= 0 ? 'earnings are growing' : 'earnings are shrinking',
    });
  }
  if (window.length) {
    factors.push({
      key: 'beats',
      label: 'Against the estimate',
      value: `${beats} beat · ${inline} in line · ${misses} missed`,
      lean: clamp((beats - misses) / window.length),
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
      beats: window.length ? beats : null,
      beatOf: window.length,
      inline: window.length ? inline : null,
      misses: window.length ? misses : null,
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
  const all = pillars.flatMap(p => p.factors.map(f => ({ ...f, pull: Math.abs(f.lean) * f.weight * PILLAR_WEIGHTS[p.key] })));
  const top = all.filter(f => f.pull > 0).sort((a, b) => b.pull - a.pull).slice(0, 3);
  if (!top.length) return 'Nothing on the name stands out right now.';
  return top.map(f => `${cap(f.label)} ${f.value} — ${f.note}`).join(' · ') + '.';
};
const thesisOf = (pillars: Pillar[], screen: Screen): string => {
  const words: Record<PillarKey, { good: string; bad: string; name: string }> = {
    trend: { name: 'the trend', good: 'the trend is up', bad: 'the trend is broken' },
    numbers: { name: 'the numbers', good: 'the numbers are clean', bad: 'the numbers are slipping' },
    money: { name: 'the money', good: 'the money is buying', bad: 'the money is selling' },
    news: { name: 'the news', good: 'the news helps', bad: 'the news hurts' },
  };
  const ranked = [...pillars].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const second = ranked[1];
  const next = ranked[ranked.length - 2];
  if (!best || !worst) return 'Nothing on the name stands out right now.';
  if (!second || !next) return cap(`${best.score >= 55 ? words[best.key].good : best.score <= 45 ? words[best.key].bad : `${words[best.key].name} is quiet`}.`);
  if (screen === 'STRONG') return cap(`${words[best.key].good}, ${words[second.key].good}; ${worst.score < 45 ? `${words[worst.key].name} is the one soft spot` : 'nothing against it'}.`);
  if (screen === 'WEAK') return cap(`${words[worst.key].bad}, ${words[next.key].bad}; ${best.score > 65 ? `${words[best.key].name} alone cannot carry it` : 'nothing in its favour'}.`);
  if (best.score < 55 && worst.score > 45) return 'Nothing on the name is decisive.';
  if (best.score < 55) return cap(`${words[worst.key].bad}.`);
  return cap(`${words[best.key].good} but ${words[worst.key].bad} — a catalyst decides.`);
};
/** Every factor's points: its lean × its share of the pillar × 50 × the pillar's weight — they sum to the score's distance from 50 */
const contributionsOf = (pillars: Pillar[]): Contribution[] =>
  pillars
    .flatMap(p => {
      const w = p.factors.reduce((a, f) => a + f.weight, 0) || 1;
      return p.factors.map(f => ({ key: `${p.key}:${f.key}`, pillar: p.key, label: f.label, value: f.value, points: Math.round(f.lean * (f.weight / w) * 50 * PILLAR_WEIGHTS[p.key] * 10) / 10 }));
    })
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
/** The factors whose flip would move the composite most — and by how much */
const movesOf = (pillars: Pillar[], composite: number): Move[] => {
  const out: Move[] = [];
  for (const p of pillars) {
    const w = p.factors.reduce((a, f) => a + f.weight, 0) || 1;
    for (const f of p.factors) {
      if (Math.abs(f.lean) < 0.15) continue;
      /* the factor turned the other way, the rest held */
      const flipped = p.factors.map(x => (x === f ? { ...x, lean: -x.lean } : x));
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
const sideOf = (score: number): 'for' | 'against' | 'middle' => (score >= 55 ? 'for' : score <= 45 ? 'against' : 'middle');
const verbs = (p: Pillar, one: string, many: string) => (p.key === 'numbers' ? many : one);
const lowerName = (p: Pillar) => p.name.toLowerCase();
const topFactor = (p: Pillar) => [...p.factors].sort((a, b) => Math.abs(b.lean) * b.weight - Math.abs(a.lean) * a.weight)[0];
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
  const event = news.nextEarnings ? `the next test is the report on ${news.nextEarnings.label}${priced}` : 'the next test is a headline the wire has not seen yet';
  let risk: string;
  if (want == null) {
    const pulls = pillars.filter(p => sideOf(p.score) === 'for').map(lowerName);
    const drags = pillars.filter(p => sideOf(p.score) === 'against').map(lowerName);
    risk = pulls.length && drags.length
      ? `The read is split: ${listWords(pulls)} ${pulls.length === 1 && !/^the numbers/.test(pulls[0]) ? 'pulls' : 'pull'} for the name, ${listWords(drags)} against it, and neither side carries it; ${event}.`
      : pulls.length || drags.length
        ? `Only ${listWords(pulls.length ? pulls : drags)} ${pulls.length ? 'leans for the name' : 'leans against it'}, not enough to tip the read; ${event}.`
        : `No pillar leans either way; ${event}.`;
  } else {
    const against = pillars.filter(p => sideOf(p.score) !== 'middle' && sideOf(p.score) !== want).sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
    if (against.length) {
      const p = against[0];
      const f = topFactor(p);
      risk = `The case against the ${lean} read is ${lowerName(p)}${f ? ` — ${f.label.toLowerCase()} ${f.value}, ${f.note}` : ''}; if that strengthens, the read turns there first.`;
    } else {
      const all = rows.every(r => r.stance === 'agrees');
      risk = `${all ? 'Every pillar agrees' : 'No pillar argues against it'}; ${event}.`;
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
const methodOf = (trend: TrendRead, money: MoneyRead, news: NewsRead, pillars: Pillar[], composite: number, lean: Lean): Method => ({
  observed: [
    `${trend.sessions} sessions of the name's own bars`,
    `${money.volumeToday != null ? `${fmtCount(money.volumeToday)} shares today` : 'no volume yet today'}${money.volumeAvg != null ? ` against ${fmtCount(money.volumeAvg)} usual` : ''}`,
    `the options book at every strike · ${fmtCount(money.callOI + money.putOI)} open interest`,
    money.callPremium + money.putPremium > 0 ? `${fmtMoney(money.callPremium + money.putPremium)} of premium on the flow book` : 'no option premium on the screener yet',
    money.dark.prints.length ? `${money.dark.prints.length} off-exchange ${money.dark.prints.length === 1 ? 'print' : 'prints'}` : 'no off-exchange prints in the recent tape',
    `${news.stories.length} ${news.stories.length === 1 ? 'story' : 'stories'} on the wire`,
  ],
  derived: [
    `the 20-day average${trend.sma50 != null ? ', the 50-' : ''}${trend.sma200 != null ? ' and 200-day' : ''} · RSI · ADX · the range percentile · the structure`,
    `GEX · DEX · VEX · vanna · charm, and the walls, the flip and the supreme from them`,
    money.askSharePct != null ? `calls against puts, ${money.askSharePct.toFixed(0)}% of the alert premium on the ask` : 'calls against puts from the screener',
    money.darkWindow.read ? 'off-exchange prints over or under their own quote\'s mid, the regular session\'s sized prints only' : 'no regular-session off-exchange print to read',
    `the wire's lean from the stories' reads and expected moves`,
  ],
  inferred: [
    `${pillars.reduce((a, p) => a + p.factors.length, 0)} factors, each leaning for the name or against it — a pillar is the balance of its factors`,
    `the four pillars together give the read: strong, good, caution or poor — today ${gradeOfComposite(composite)}`,
    `the lean — ${lean} — from the same balance`,
  ],
});

/* ---- the overview ------------------------------------------------------------- */

export function buildStockOverview(tickerRaw: string, tape: readonly FlowPrint[] = []): StockOverview | null {
  const ticker = tickerRaw.toUpperCase();
  const snapshot = snapshotOf(ticker, 'full');
  if (!snapshot) return null;
  const u = lookup(ticker);
  const name = u?.name ?? tickerName(ticker);
  const sector = u?.sector ?? null;
  const clock = readSessionClock();
  const marketWord = clock.phase === 'OPEN' ? 'market open' : clock.phase === 'AUCTION' ? 'the closing auction' : clock.phase === 'PREMARKET' ? 'before the open' : clock.phase === 'AFTERHOURS' ? 'after hours' : 'market closed';
  const minute = bookCandles(ticker) ?? [];
  const file = peekStockFile(ticker);
  const blocks = file.days.length >= 5 ? file.days.map(c => [c]) : minute.length >= 2 ? [minute] : [];

  /* THE DAY'S CHANGE IS THE REGULAR SESSION'S (the re-audit, 2026-10-22): after the bell the book's change is the
     after-hours move alone; the quote (data/liveQuote.ts) carries the session's change and the extended move apart */
  const quote = peekQuote(ticker);
  const dayPct = quote ? quote.changePct : snapshot.changePercent;
  const extLine = extendedLine(quote);
  const trend = trendFor(blocks, snapshot.spot);
  const money = moneyFor(ticker, { ...snapshot, changePercent: dayPct }, blocks, file);
  const news = newsFor(ticker, file);
  const numbers = numbersFor(file);
  const pillars: Pillar[] = [
    { key: 'trend', name: PILLAR_NAMES.trend, score: scoreOf(trend.factors), factors: trend.factors, status: trend.read.sessions >= 20 ? 'live' : file.status === 'live' ? 'thin' : 'thin', from: `${trend.read.sessions} sessions on hand` },
    { key: 'numbers', name: PILLAR_NAMES.numbers, score: scoreOf(numbers.factors), factors: numbers.factors, status: numbers.read.sample ? (file.status === 'loading' ? 'thin' : 'sample') : 'live', from: numbers.read.sample ? 'not on this feed' : 'the last print and earnings growth' },
    { key: 'money', name: PILLAR_NAMES.money, score: scoreOf(money.factors), factors: money.factors, status: 'live', from: 'the live book' },
    { key: 'news', name: PILLAR_NAMES.news, score: scoreOf(news.factors), factors: news.factors, status: wireLive(ticker) || news.read.reports.length ? 'live' : 'thin', from: 'the wire' },
  ];
  const scored = pillars.filter(p => p.status !== 'sample' && p.factors.length > 0);
  const wsum = scored.reduce((a, p) => a + PILLAR_WEIGHTS[p.key], 0);
  const composite = wsum > 0 ? Math.round(scored.reduce((a, p) => a + p.score * PILLAR_WEIGHTS[p.key], 0) / wsum) : 50;
  const screen = screenOf(composite);
  const lean = leanOf(composite);
  const livePillars = pillars.filter(p => p.status !== 'sample');

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
  const trendAt = (back: number): number | null => {
    const t = trendFor(blocks, snapshot.spot, back);
    return t.factors.length ? scoreOf(t.factors) : null;
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
    timeline.push({ key: `earnings:${q.label}`, when: q.label, kind: 'earnings', text: `${q.result === 'beat' ? 'beat' : q.result === 'inline' ? 'in line' : 'missed'} on EPS — ${q.epsActual.toFixed(2)} against ${q.epsEst.toFixed(2)}${q.movePct != null ? ` · ${pct(q.movePct)} the session after` : ''}`, time: null, score: null });
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
  const stamp = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const record = peekLive();
  const insiderN = record.insiders.status === 'live' ? record.insiders.trades.filter(t => t.ticker === ticker).length : 0;
  const congressN = record.congress.status === 'live' ? record.congress.trades.filter(t => t.ticker === ticker).length : 0;
  const sources: Source[] = [
    { key: 'price', label: 'Price', status: 'live', stamp: `live · ${stamp}` },
    { key: 'book', label: 'The options book', status: 'live', stamp: `live · ${stamp}` },
    { key: 'flow', label: 'The flow book', status: file.status === 'live' ? 'live' : 'thin', stamp: file.flow.length ? `${file.flow.length} ${file.flow.length === 1 ? 'alert' : 'alerts'}` : file.status === 'live' ? 'no alerts on this name' : 'reading' },
    { key: 'tape', label: 'The tape', status: file.status === 'live' ? 'live' : 'thin', stamp: file.flow.length ? `${file.flow.length} ${file.flow.length === 1 ? 'print' : 'prints'}` : file.status === 'live' ? 'no prints in the recent alerts' : 'reading' },
    { key: 'dark', label: 'Dark pool', status: file.status === 'live' ? 'live' : 'thin', stamp: file.dark.length ? `${file.dark.length} ${file.dark.length === 1 ? 'print' : 'prints'}` : file.status === 'live' ? 'nothing recent' : 'reading' },
    { key: 'news', label: 'The wire', status: wireLive(ticker) ? 'live' : 'thin', stamp: news.read.stories.length ? `the newest story ${news.read.stories[0].item.time}` : 'nothing on this name yet' },
    { key: 'sessions', label: 'Sessions', status: sessions >= 20 ? 'live' : 'thin', stamp: `${sessions} on hand` },
    { key: 'fundamentals', label: 'Fundamentals', status: numbers.read.sample ? 'thin' : 'live', stamp: numbers.read.sample ? 'the feed has no print for this name yet' : 'the last print and earnings growth' },
    { key: 'record', label: 'Insiders and Congress', status: record.insiders.status === 'live' || record.congress.status === 'live' ? 'live' : 'thin', stamp: insiderN || congressN ? `${insiderN} insider ${insiderN === 1 ? 'trade' : 'trades'} · ${congressN} congress ${congressN === 1 ? 'report' : 'reports'} in the latest feed` : 'the name\'s own filings below' },
  ];
  const completeness = Math.round((100 * sources.filter(s => s.status === 'live').length) / sources.length);

  return {
    ticker,
    name,
    sector,
    price: snapshot.spot,
    changePct: dayPct,
    extLine,
    marketWord,
    pillars,
    composite,
    screen,
    lean,
    weights: PILLAR_WEIGHTS,
    whyNow: whyNowOf(pillars),
    thesis: thesisOf(pillars, screen),
    explanation: explanationOf(name, composite, livePillars, numbers.read, agreement),
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
  };
}
