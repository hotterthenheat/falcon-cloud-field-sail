/* A name's read for the stock page and the Stocks board. Four pillars (trend, numbers, money, news), each a few
   factors with a lean from −1 to +1; the grade is scored off the screener row alone, the rest is shown as context. */

import { dollars3, signedPct } from '../pages/record/money';
import { now } from '../core/clock';
import { readSessionClock } from './moc';
import { phaseAt } from '../core/session';
import { peekQuote, extendedLine, priceWords, screenerRead, screenerNeedsCloses } from './liveQuote';
import { peekLive, peekTickerNews } from './liveRecord';
import { peekStockFile, quarterFacts, type EarnRow, type StockFile } from './stockFile';
import { lastSessionIso, nyTodayIso } from './nyDate';
import { nyClock, nyCloseMin, nyIsoDate, nyMinutes, SESSION_OPEN_MIN } from '../core/nyTime';
import { peekRegularCloses } from './dayChange';
import { epsResultOf, nextReportRow, reportDayLabel, reportDayLabelYear, tradingDaysUntil } from './earningsFeed';
import type { GeoNewsEvent } from './newsroom';
import { lookup } from './universe';
import { displayName, tickerName } from './tickers';
import type { Fundamentals } from './fundamentals';
import type { Candle } from '../types/market';
import type { BookContract, FlowPrint } from '../types/trace';
import type { DarkPoolView } from '../types/darkpool';
import { otmOf } from './traceRows';
import { FRESH_VOL_OI, leanOfSides } from './traceLean';
import { DARK_MIN_PRINTS, darkPosture } from './traceDark';

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

/* The options read here is the screener's premium and the session's tapes; the dealer book (walls, the flip, GEX) is
   Pinpoint's, and the page links to it rather than deriving it again. */
export interface MoneyRead {
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
  /** The screener's call_open_interest and put_open_interest */
  callOI: number;
  putOI: number;
  /** The session's flow alerts on contracts trading at least twice their open interest */
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
type AgreeStance = 'agrees' | 'argues' | 'middle' | 'for' | 'against';
export interface Agreement {
  lean: Lean;
  pillars: { key: PillarKey; name: string; score: number; agrees: boolean; stance: AgreeStance }[];
  aligned: number;
  /** Where the read fails first if it fails */
  risk: string;
}

/** The trend pillar off the daily bars as it stood `back` sessions ago */
export interface TrendPoint {
  back: number;
  /** The session's bar, unix seconds */
  time: number;
  trend: number;
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
  sources: Source[];
  /** How much of the page is live, 0–100 */
  completeness: number;
  /** Sources still being read; while any is, the read is provisional and the page holds its words */
  settling: string[];
}

/* each pillar's weight in the grade; the news pillar is shown, never in it */
const PILLAR_WEIGHTS: Record<PillarKey, number> = { trend: 0.32, numbers: 0.24, money: 0.26, news: 0.18 };
const PILLAR_NAMES: Record<PillarKey, string> = { trend: 'The trend', numbers: 'The numbers', money: 'The money', news: 'The news' };
/* Only the four words reach the screen; the composite, scores, weights and cuts stay inside the engine. */
export type Grade = 'strong' | 'good' | 'caution' | 'poor';
/** Low to high — the meter's order */
export const GRADES: Grade[] = ['poor', 'caution', 'good', 'strong'];
/* One set of cuts: the grade, the screen and the lean all read off it. */
const STRONG_FROM = 72;
const GOOD_FROM = 60;
const POOR_TO = 46;
/** The word for any figure of ours, the whole read's or a pillar's */
export const gradeOfComposite = (composite: number): Grade => (composite >= STRONG_FROM ? 'strong' : composite >= GOOD_FROM ? 'good' : composite <= POOR_TO ? 'poor' : 'caution');
export const gradeOf = (score: number): Grade => gradeOfComposite(score);
const screenOf = (composite: number): Screen => {
  const g = gradeOfComposite(composite);
  return g === 'strong' || g === 'good' ? 'STRONG' : g === 'poor' ? 'WEAK' : 'MIXED';
};
/** The side a score is on: good or strong is for the name, poor against it, caution neither */
const leanOf = (score: number): Lean => {
  const s = screenOf(score);
  return s === 'STRONG' ? 'bullish' : s === 'WEAK' ? 'bearish' : 'neutral';
};
const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
/** "82nd" — a percentile said as one */
export const ordinal = (n: number): string => {
  const r = n % 100;
  const s = r >= 11 && r <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${s}`;
};
export const fmtMoney = (v: number): string => dollars3(v);
const fmtCount = (v: number): string => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`);
/** A pillar's score from its factors: 50 + 50 × the leans' weighted mean */
const scoreOf = (factors: readonly Factor[]): number => {
  const scored = factors.filter(f => !f.context);
  const w = scored.reduce((a, f) => a + f.weight, 0) || 1;
  return Math.round(50 + 50 * scored.reduce((a, f) => a + f.lean * f.weight, 0) / w);
};
/* ---- one read for the board and the page: the vendor's screener row (/screener/stocks) ----
   The page's other reads sit beside the scored factors as context and are never weighed. */
type ScreenRow = Record<string, unknown> | null | undefined;
const rowNum = (row: ScreenRow, k: string): number | null => {
  const v = row?.[k];
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
interface ScreenPillars {
  trend: Factor[];
  numbers: Factor[];
  money: Factor[];
  /** The close the trend factors set the averages against */
  refClose: number | null;
}
/* Relative volume, paced: the volume so far against the share of a usual day traded by now (a U-shaped curve).
   The first half hour and pre-market are shown, not scored; only volume above pace leans. */
/** Each half hour's share of a typical session's volume, 09:30 to 16:00 (sums to 1) */
const HALF_HOUR_SHARE = [0.11, 0.075, 0.065, 0.06, 0.055, 0.05, 0.045, 0.045, 0.05, 0.055, 0.065, 0.085, 0.24];
/** The share of a typical full day traded by `minutes` into the regular session */
const sessionVolumeShare = (minutes: number): number => {
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
const RVOL_PACE_FROM_MIN = 30;
interface PacedVolume {
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
function pacedRelVolume(raw: number | null | undefined, rowDate: string | null | undefined, at: Date | number = now()): PacedVolume | null {
  if (raw == null || !(raw > 0)) return null;
  const today = nyIsoDate(at);
  const m = nyMinutes(at);
  const sameDay = !rowDate || String(rowDate).slice(0, 10) === today;
  if (!sameDay || m >= nyCloseMin(at)) return { value: raw, raw, basis: 'full', share: 1, inRead: true, label: `${raw.toFixed(2)}× full day` };
  if (m < SESSION_OPEN_MIN) return { value: null, raw, basis: 'premarket', share: 0, inRead: false, label: `${raw.toFixed(2)}× before the open` };
  const into = m - SESSION_OPEN_MIN;
  const share = sessionVolumeShare(into);
  if (into < RVOL_PACE_FROM_MIN) return { value: null, raw, basis: 'early', share, inRead: false, label: `${raw.toFixed(2)}× of a full day so far` };
  const v = raw / share;
  return { value: v, raw, basis: 'paced', share, inRead: true, label: `${v.toFixed(2)}× paced` };
}
/** The relative-volume factor: only volume above pace leans, in the day's direction; quiet volume is no evidence */
function rvolFactor(pv: PacedVolume | null, up: boolean): Factor | null {
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
    /* ordinary or quiet volume is no evidence either way: it scores neutral */
    lean: heavy ? clamp((v - 1) * (up ? 1 : -1)) : 0,
    weight: 0.25,
    note: heavy ? `heavy for the name, ${up ? 'on an up day' : 'on a down day'}` : v <= 0.7 ? 'quiet — no conviction behind the move either way' : 'ordinary — no conviction either way',
  };
}
/* Heavy volume amplifies the side of the trade; with the side even or the other way it is shown and not weighed. */
function volumeFollowsSide(factors: Factor[]): Factor[] {
  const side = factors.find(f => f.key === 'side');
  return factors.map(f => {
    if (f.key !== 'rvol' || f.context || f.lean === 0) return f;
    if (side && side.lean !== 0 && Math.sign(side.lean) === Math.sign(f.lean)) return f;
    return { ...f, lean: 0, note: `${f.note} — but the side of the trade ${side && side.lean !== 0 ? 'leans the other way' : 'is about even'}, so no lean` };
  });
}
/** The side of the trade is a lean only past this distance from even (a 49/51 split is no lean) */
const SIDE_DEADBAND = 0.05;

/* Call premium counts calls sold at the bid too, so the kind of contract leans only where the side of the trade agrees;
   a split within five points of even is no lean. */
function premiumFactors(bull: number, bear: number, calls: number, puts: number): Factor[] {
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

/** Below this much side-of-trade premium a day the money pillar is shown, never scored */
const MIN_READ_PREMIUM = 1_000_000;
function thinPremium(factors: Factor[], premium: number): Factor[] {
  if (premium >= MIN_READ_PREMIUM) return factors;
  return factors.map(f => ({ ...f, lean: 0, weight: 0, context: true, note: `${f.note} — only ${dollars3(premium)} of premium, too thin to read` }));
}
/* Earnings growth is read as a rate a year: the screener's one-, two- and three-year EPS changes, each turned into a
   yearly rate. When they agree in sign the one nearest zero is read (a tiny base inflates the others); when they
   disagree there is no lean. A change through a loss (EPS at or under zero at either end) has no rate. */
/** Growth of this much a year or more leans fully for the name; the same shrink fully against */
export const GROWTH_FULL = 0.25;
/** A total change over `years` as a rate a year; null when it ran through a loss */
export const yearlyRate = (g: number | null, years: number): number | null => (g == null || !(1 + g > 0) ? null : Math.pow(1 + g, 1 / years) - 1);
/** The rates' claim they all make: the one nearest zero when they share a sign, else 0 */
export const agreedRate = (xs: readonly number[]): number => (xs.every(x => x >= 0) ? Math.min(...xs) : xs.every(x => x <= 0) ? Math.max(...xs) : 0);
/** The numbers pillar: earnings growth as a rate a year, and the share count's change. Scored only when the growth is. */
export function numberFactors(row: ScreenRow): Factor[] {
  const out: Factor[] = [];
  const spans = ([[1, 'eps_growth_4q'], [2, 'eps_growth_8q'], [3, 'eps_growth_12q']] as const).map(([years, k]) => ({ years, total: rowNum(row, k) })).filter(x => x.total != null);
  const rates = spans.map(x => yearlyRate(x.total, x.years)).filter((r): r is number => r != null);
  const spanWords = spans.map(x => `${x.years}y ${signedPct(x.total! * 100, 0)}`).join(' · ');
  if (rates.length) {
    const rate = agreedRate(rates);
    const split = rates.some(r => r > 0) && rates.some(r => r < 0);
    out.push({
      key: 'growth',
      label: 'Earnings growth',
      value: split ? 'mixed' : `${signedPct(rate * 100, 0)} a year`,
      lean: clamp(rate / GROWTH_FULL),
      /* one span alone is half the evidence */
      weight: rates.length >= 2 ? 0.7 : 0.35,
      note: split ? `the spans disagree (${spanWords}) — no lean` : `the slowest of ${spanWords}`,
    });
  } else if (spans.length) {
    out.push({ key: 'growth', label: 'Earnings growth', value: 'through a loss', lean: 0, weight: 0, context: true, note: `${spanWords} — no yearly rate to read` });
  }
  const sh = rowNum(row, 'shares_outstanding_growth_4q');
  if (sh != null) out.push({ key: 'shares', label: 'Share count, one year', value: signedPct(sh * 100), lean: clamp(-sh / 0.05), weight: 0.3, note: sh <= -0.01 ? 'buying back shares' : sh >= 0.02 ? 'issuing shares — each one owns less' : 'about flat' });
  /* the share count alone does not grade a business: without a growth rate the pillar is shown, not read */
  if (!rates.length) return out.map(f => ({ ...f, lean: f.context ? f.lean : 0, weight: 0, context: true }));
  return out;
}

/** The scored factors, from the screener row alone */
function screenFactors(row: ScreenRow, closes?: readonly { date: string; close: number }[] | null): ScreenPillars {
  /* after the bell the screener's close is the post-market print, so the last regular close is used when read */
  const tk = typeof row?.ticker === 'string' ? (row.ticker as string) : '';
  const regular = row ? screenerRead(row, closes ?? (tk ? peekRegularCloses(tk) : null))?.regular : undefined;
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
    trend.push({ key: 'ema20', label: 'Price against its 20-day EMA', value: `${signedPct(off)} · ${ema20.toFixed(2)}`, lean: clamp(off / 3), weight: 0.3, note: off >= 0 ? 'above its average — the trend holds' : 'under its average — the trend has slipped' });
  }
  if (rsi14 != null) trend.push({ key: 'rsi', label: 'RSI, 14 sessions', value: rsi14.toFixed(0), lean: clamp((rsi14 - 50) / 20), weight: 0.2, note: rsi14 >= 70 ? 'stretched — strong, but late' : rsi14 >= 55 ? 'firm' : rsi14 <= 30 ? 'washed out' : rsi14 <= 45 ? 'soft' : 'in the middle' });
  if (adx14 != null && week != null) {
    const dir = week >= 0 ? 1 : -1;
    trend.push({ key: 'adx', label: "ADX, the trend's strength", value: `${adx14.toFixed(0)} · ${week >= 0 ? 'up' : 'down'} on the week`, lean: clamp((Math.max(0, adx14 - 20) / 20) * dir), weight: 0.2, note: adx14 >= 25 ? `a trend with force, ${week >= 0 ? 'upward' : 'downward'}` : adx14 < 20 ? 'no trend — ADX under 20 says nothing about direction' : 'a weak trend' });
  }
  if (month != null) trend.push({ key: 'chg20', label: 'The last month', value: signedPct(month * 100), lean: clamp((month * 100) / 8), weight: 0.1, note: month >= 0 ? 'up over the month' : 'down over the month' });
  const numbers = numberFactors(row);
  const money: Factor[] = [];
  const rv = rvolFactor(pacedRelVolume(rowNum(row, 'relative_volume'), typeof row?.date === 'string' ? (row.date as string) : null), (day ?? 0) >= 0);
  if (rv) money.push(rv);
  /* the side of the trade carries most of the weight (a put sold at the bid is bullish); calls against puts is a smaller read */
  const bull = rowNum(row, 'bullish_premium') ?? 0;
  const bear = rowNum(row, 'bearish_premium') ?? 0;
  money.push(...premiumFactors(bull, bear, rowNum(row, 'call_premium') ?? 0, rowNum(row, 'put_premium') ?? 0));
  return { trend, numbers, money: thinPremium(volumeFollowsSide(money), bull + bear), refClose: last };
}
/** The scored factors' weight — a pillar with none of it is left out of the read */
const scoredWeight = (factors: readonly Factor[]): number => factors.reduce((a, f) => a + (f.context ? 0 : f.weight), 0);
interface ScreenRead {
  pillars: { key: PillarKey; score: number; factors: Factor[]; inRead: boolean }[];
  composite: number;
  screen: Screen;
  grade: Grade;
  lean: Lean;
  thesis: string;
}
/** The read off one screener row; `closes` are the name's regular closes when the caller holds them (else the cache's) */
export function readOfScreen(row: ScreenRow, closes?: readonly { date: string; close: number }[] | null): ScreenRead {
  const f = screenFactors(row, closes);
  const pillars = (['trend', 'numbers', 'money'] as const).map(key => ({ key, score: scoreOf(f[key]), factors: f[key], inRead: scoredWeight(f[key]) > 0 }));
  const scored = pillars.filter(p => p.inRead);
  const w = scored.reduce((a, p) => a + PILLAR_WEIGHTS[p.key], 0);
  const composite = w > 0 ? Math.round(scored.reduce((a, p) => a + p.score * PILLAR_WEIGHTS[p.key], 0) / w) : 50;
  const screen = screenOf(composite);
  const grade = gradeOfComposite(composite);
  return { pillars, composite, screen, grade, lean: leanOf(composite), thesis: thesisOf(scored.map(p => ({ key: p.key, score: p.score })), screen) };
}

const PILLAR_SHORT: Record<PillarKey, string> = { trend: 'trend', numbers: 'numbers', money: 'money', news: 'news' };
/** The grade's ingredients in one hover: each pillar's score, the weights and the cuts */
export function gradeHelp(read: { pillars: readonly { key: PillarKey; score: number; inRead: boolean }[]; composite: number }): string {
  const parts = read.pillars.filter(p => p.key !== 'news').map(p => (p.inRead ? `${PILLAR_SHORT[p.key]} ${p.score}` : `${PILLAR_SHORT[p.key]} not read`));
  return `${parts.join(' · ')} → ${read.composite}, ${gradeOfComposite(read.composite)}. Weights trend 32 · numbers 24 · money 26; news not scored. Strong ${STRONG_FROM}+ · good ${GOOD_FROM}+ · poor ${POOR_TO} or less`;
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
  const ranges = highs.map((h, i) => h - lows[i]);
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
    factors.push({ key: 'ema20', label: 'Price against its 20-day EMA', value: `${signedPct(off)} · ${ema20.toFixed(2)}`, lean: clamp(off / 3), weight: 0.3, note: off >= 0 ? 'above its average — the trend holds' : 'under its average — the trend has slipped' });
  }
  if (rsi14 != null) factors.push({ key: 'rsi', label: 'RSI, 14 sessions', value: rsi14.toFixed(0), lean: clamp((rsi14 - 50) / 20), weight: 0.2, note: rsi14 >= 70 ? 'stretched — strong, but late' : rsi14 >= 55 ? 'firm' : rsi14 <= 30 ? 'washed out' : rsi14 <= 45 ? 'soft' : 'in the middle' });
  if (adx14 != null && change5Pct != null) {
    const dir = change5Pct >= 0 ? 1 : -1;
    factors.push({ key: 'adx', label: "ADX, the trend's strength", value: `${adx14.toFixed(0)} · ${change5Pct >= 0 ? 'up' : 'down'}`, lean: clamp((Math.max(0, adx14 - 20) / 20) * dir), weight: 0.2, note: adx14 >= 25 ? `a trend with force, ${change5Pct >= 0 ? 'upward' : 'downward'}` : adx14 < 20 ? 'no trend — ADX under 20 says nothing about direction' : 'a weak trend' });
  }
  if (sessions >= 10) factors.push({ key: 'structure', label: 'The structure', value: structure, lean: structLean, weight: 0.2, note: structLean > 0 ? 'the swings step up' : structLean < 0 ? 'the swings step down' : 'the swings disagree' });
  if (change20Pct != null) factors.push({ key: 'chg20', label: 'The last 20 sessions', value: signedPct(change20Pct), lean: clamp(change20Pct / 8), weight: 0.1, note: change20Pct >= 0 ? 'up over the month' : 'down over the month' });
  return { read, factors };
};

/* The busiest contracts are the chain's own by the day's volume (expired ones out), with the day's whole premium. */
export const busiestOf = (rows: Record<string, unknown>[], right: 'C' | 'P', ticker: string, spot: number): BookContract[] => {
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
    const bidV = nOr(row.bid_volume) ?? 0;
    const midV = (nOr(row.mid_volume) ?? 0) + (nOr(row.no_side_volume) ?? 0);
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
      /* + out of the money for calls and puts alike (traceRows otmOf): a 90 put on a 100 stock is +10%, not −10% */
      otmPct: otmOf(right, strike, spot, false),
      last,
      chgPct: 0,
      lastAt: String(row.last_tape_time || ''),
      lastAtMin: 0,
      volume,
      oi,
      deltaOI: 0,
      deltaOIPct: 0,
      premium,
      /* always a fraction (traceRows contractRow): a 3.4 is 340%, never 3.4% */
      iv: iv * 100,
      ivChg: 0,
      volOverOI: oi > 0 ? volume / oi : 0,
      sweepPct: volume > 0 ? (100 * sweepV) / volume : 0,
      multiPct: volume > 0 ? (100 * (nOr(row.multi_leg_volume) ?? 0)) / volume : 0,
      floorPct: volume > 0 ? (100 * (nOr(row.floor_volume) ?? 0)) / volume : 0,
      /* Trace's "% ask": the ask's share of the sided contracts (ask + bid), the split carried so dayLean reads mid too —
         never ask over the whole volume, which counted every mid print as a bid */
      askPct: askV + bidV > 0 ? (100 * askV) / (askV + bidV) : NaN,
      sideVol: { ask: askV, bid: bidV, mid: midV },
      prevOI: nOr(row.prev_oi) ?? oi,
      prevAvgFill: fill,
      oiStreak: 0,
      volGtOiStreak: 0,
      earnDays: null,
    });
  }
  return out.sort((a, b) => b.volume - a.volume).slice(0, 3);
};

/* ---- the money, from the book, the flow and the dark pool ------------------------------- */

/** Alerts whose volume ran past their open interest — Trace's one cut (traceLean FRESH_VOL_OI, 1.5×) */
export const unusualOf = (flow: readonly Pick<FlowPrint, 'volOverOI'>[]): number => flow.filter(p => p.volOverOI >= FRESH_VOL_OI).length;

/** The alerts' premium by side: an alert's own split where it carries one, else its whole premium on its side */
export function flowSidesOf(flow: readonly Pick<FlowPrint, 'premium' | 'side' | 'alertSides'>[]): { ask: number; bid: number; mid: number } {
  const out = { ask: 0, bid: 0, mid: 0 };
  for (const p of flow) {
    if (p.alertSides) {
      out.ask += p.alertSides.ask;
      out.bid += p.alertSides.bid;
      out.mid += Math.max(0, Math.max(p.premium, p.alertSides.ask + p.alertSides.bid + p.alertSides.other) - p.alertSides.ask - p.alertSides.bid);
    } else if (p.side === 'ASK') out.ask += p.premium;
    else if (p.side === 'BID') out.bid += p.premium;
    else out.mid += p.premium;
  }
  return out;
}

/** Fewer regular-session prints than this is too few to call buying or selling — Trace's own (traceDark) */
export { DARK_MIN_PRINTS };
const moneyFor = (ticker: string, spot: number, blocks: Candle[][], file: StockFile, dayPct: number): { read: MoneyRead; factors: Factor[] } => {
  const screen = file.screen;
  /* calls against puts is call_premium against put_premium; bullish against bearish is a separate read */
  const callPremium = nOr(screen?.call_premium) ?? 0;
  const putPremium = nOr(screen?.put_premium) ?? 0;
  const bullishPremium = nOr(screen?.bullish_premium) ?? 0;
  const bearishPremium = nOr(screen?.bearish_premium) ?? 0;
  const callVolume = nOr(screen?.call_volume) ?? 0;
  const putVolume = nOr(screen?.put_volume) ?? 0;
  /* the ask share is Trace's (leanOfSides): the alerts' ask-side premium over their sided (ask + bid) premium, the
     unsided rest as mid — one meaning of "% ask" on every page */
  const flowPrem = file.flow.reduce((a, p) => a + Math.max(p.premium, (p.alertSides?.ask ?? 0) + (p.alertSides?.bid ?? 0) + (p.alertSides?.other ?? 0)), 0);
  const flowSides = flowSidesOf(file.flow);
  const sweepPrem = file.flow.filter(p => p.sweep).reduce((a, p) => a + p.premium, 0);
  const sidedLean = leanOfSides(flowSides);
  const askSharePct = flowPrem > 0 && Number.isFinite(sidedLean.askSided) && flowSides.ask + flowSides.bid > 0 ? sidedLean.askSided : null;
  const sweepSharePct = flowPrem > 0 ? (100 * sweepPrem) / flowPrem : null;
  const unusual = unusualOf(file.flow);
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
  const callOI = nOr(screen?.call_open_interest) ?? 0;
  const putOI = nOr(screen?.put_open_interest) ?? 0;
  /* Prints priced by their own terms (average-price, contingent, derivative-priced) are left out of every dark figure,
     counted apart. */
  const ownTermsOut = file.dark.filter(p => !p.special);
  const darkShares = ownTermsOut.reduce((a, p) => a + p.size, 0);
  const darkNotional = ownTermsOut.reduce((a, p) => a + p.notional, 0);
  /* the read is Trace's one posture (traceDark darkPosture) over the prints in hand: dollars paid over the print's own
     mid against sold under it, each print sized for the name's own average day, the 18% edge on the unrounded net and
     no posture under DARK_MIN_PRINTS prints */
  const advUsd = (nOr(screen?.avg30_volume) ?? 0) * (nOr(screen?.close) ?? spot);
  const pv = darkPosture(file.dark, { advUsd: t => (t === ticker && advUsd > 0 ? advUsd : null) });
  const readPrints = pv.read;
  const readNotional = pv.notional;
  const netPosturePct = pv.net;
  const posture: DarkPoolView['posture'] = pv.posture;
  const largest = [...readPrints].sort((a, b) => b.notional - a.notional)[0] ?? null;
  const instants = readPrints.map(p => p.epochMs ?? NaN).filter(Number.isFinite).sort((a, b) => a - b);
  const darkWindow = {
    read: readPrints.length,
    readNotional,
    outsideRead: ownTermsOut.length - readPrints.length,
    inHand: file.dark.length,
    from: instants.length ? nyClock(instants[0]) : null,
    to: instants.length ? nyClock(instants[instants.length - 1]) : null,
    complete: file.darkWindow.complete,
    cover: file.darkWindow.complete ? null : file.darkWindow.from || null,
    ownTerms: file.dark.filter(p => p.special).length,
  };
  const flowWindow = { alerts: file.flow.length, complete: file.flowWindow.complete, from: file.flowWindow.from || null, to: file.flowWindow.to || null };
  const dark: DarkPoolView = {
    ticker,
    spot,
    dpSharePct: todayVol > 0 && darkShares > 0 ? Math.min(100, (100 * darkShares) / todayVol) : 0,
    netPosturePct,
    posture,
    /* the note is the verdict alone; it is quoted inside the Why-now lines */
    postureNote: !readPrints.length
      ? ''
      : readPrints.length < DARK_MIN_PRINTS
        ? `only ${readPrints.length} ${readPrints.length === 1 ? 'print' : 'prints'} — too few to read`
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
  /* the session's own one-minute cash bars draw the line; daily blocks only when they are minutes themselves */
  const sessionMinutes = (file.minutes ?? []).filter(c => {
    const at = c.time * 1000;
    const m = nyMinutes(at);
    return (!file.session || nyIsoDate(at) === file.session) && m >= SESSION_OPEN_MIN && m <= nyCloseMin(at);
  });
  const today = (sessionMinutes.length > 1 ? sessionMinutes : lastBlock && lastBlock.length > 1 ? lastBlock : []).map(c => ({ time: c.time, close: c.close }));
  /* where the session's last regular minute sits in that session's own high–low */
  let closeInRange: number | null = null;
  if (sessionMinutes.length > 1) {
    const hi = Math.max(...sessionMinutes.map(c => c.high));
    const lo = Math.min(...sessionMinutes.map(c => c.low));
    closeInRange = hi > lo ? (sessionMinutes[sessionMinutes.length - 1].close - lo) / (hi - lo) : null;
  }
  const read: MoneyRead = {
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
    busiest: { calls: busiestOf(file.contracts, 'C', ticker, spot), puts: busiestOf(file.contracts, 'P', ticker, spot) },
  };
  const factors: Factor[] = [];
  const rvf = rvolFactor(rvolPaced, dayPct >= 0);
  if (rvf) factors.push(rvf);
  /* the side of the trade carries most of the weight; calls against puts is a smaller second read */
  factors.push(...premiumFactors(bullishPremium, bearishPremium, callPremium, putPremium));
  if (readPrints.length >= DARK_MIN_PRINTS) factors.push({ key: 'dark', label: 'Off-exchange prints', value: posture === 'ACCUMULATING' ? 'over the mid' : posture === 'DISTRIBUTING' ? 'under the mid' : 'split', lean: clamp(netPosturePct / 40), weight: 0.3, note: dark.postureNote });
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
  const past = pastPrints(file.earnings);
  /* an estimate far off the name's own run of estimates is said to be off, not read as a beat or miss */
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
  /* the usual move: the latest eight reports with a next-session move, estimate or not */
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
  const read: NewsRead = { stories: stories.slice(0, 6), nextEarnings, reaction, reports };
  const factors: Factor[] = [];
  if (stories.length) factors.push({ key: 'fresh', label: 'Stories on the wire', value: `${stories.length}`, lean: 0, weight: 0.1, note: 'how many landed on this name' });
  const biggest = stories.reduce<GeoNewsEvent | null>((m, s) => {
    if (!s.item.prediction.measured) return m;
    if (!m || Math.abs(s.item.prediction.expMove1dPct) > Math.abs(m.item.prediction.expMove1dPct)) return s;
    return m;
  }, null);
  if (biggest) factors.push({ key: 'move', label: 'Move at publish on the wire', value: signedPct(biggest.item.prediction.expMove1dPct), lean: clamp(biggest.item.prediction.expMove1dPct / 4), weight: 0.2, note: biggest.item.headline });
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

/* A report is a past row with an actual or a next-session move; beat, in line or miss only where an estimate is on file. */
const hasVal = (v: unknown) => v != null && v !== '';
const pastPrints = (rows: EarnRow[]): EarnRow[] => {
  const today = nyTodayIso();
  return rows
    .filter(r => r.report_date && String(r.report_date).slice(0, 10) <= today && (hasVal(r.actual_eps) || hasVal(r.post_earnings_move_1d)))
    .sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
};
const withEstimate = (r: EarnRow) => hasVal(r.actual_eps) && hasVal(r.street_mean_est);

const numbersFor = (file: StockFile): { read: Fundamentals; factors: Factor[] } => {
  const filed = quarterFacts(file.quarters ?? []);
  if (file.status !== 'live') return { read: EMPTY_NUMBERS, factors: [] };
  const past = pastPrints(file.earnings);
  const last = past[0];
  const window = past.slice(0, 8);
  const epsActual = last ? nOr(last.actual_eps) : null;
  const epsEstimate = last ? nOr(last.street_mean_est) : null;
  /* cents when the estimate is small or the two straddle zero — the same rule as the page's report table (StockName centsGap) */
  const tinyEst = epsEstimate != null && epsActual != null && (Math.abs(epsEstimate) < 0.25 || Math.sign(epsActual) !== Math.sign(epsEstimate));
  /* an estimate far off the name's own run is a vendor slip, not a surprise to size */
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
  if (epsActual == null && growth == null && div == null && cap == null && filed.revenue == null && file.street == null) return { read: EMPTY_NUMBERS, factors: [] };
  const factors: Factor[] = [];
  if (epsSurprisePct != null) {
    factors.push({
      key: 'surprise',
      label: 'EPS against the estimate',
      value: tinyEst ? `${epsActual!.toFixed(2)} vs ${epsEstimate!.toFixed(2)} · ${epsActual! - epsEstimate! >= 0 ? '+' : '−'}${Math.round(Math.abs(epsActual! - epsEstimate!) * 100)}¢` : `${epsActual!.toFixed(2)} vs ${epsEstimate!.toFixed(2)} · ${signedPct(epsSurprisePct)}`,
      lean: tinyEst ? clamp(((epsActual! - epsEstimate!) * 100) / 8) : clamp(epsSurprisePct / 8),
      weight: 0.4,
      note: epsSurprisePct >= 0 ? 'the last print beat' : 'the last print missed',
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
      revenueActualB: filed.revenue != null ? filed.revenue / 1e9 : null,
      revenueSurprisePct: null,
      beats: scored.length ? beats : null,
      beatOf: scored.length,
      inline: scored.length ? inline : null,
      misses: scored.length ? misses : null,
      revenueGrowthPct: filed.revenueGrowthPct,
      epsGrowthPct: growth != null ? growth * 100 : null,
      operatingMarginPct: filed.operatingMarginPct,
      freeCashFlowMarginPct: filed.fcfMarginPct,
      pe: null,
      sectorMedianPe: null,
      evToSales: null,
      peg: null,
      sectorPercentile: null,
      fairValue: file.street?.median ?? null,
      vsFairValuePct: file.street && nOr(file.screen?.close) != null && file.street.median > 0 ? ((nOr(file.screen?.close)! / file.street.median) - 1) * 100 : null,
      valuation: null,
      healthScore: null,
      guidance: null,
      dividendYieldPct: div != null ? div * 100 : null,
      marketCap: cap,
    },
    factors,
  };
};

/* ---- the words and the sums ------------------------------------------------------ */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A factor's label inside a sentence: lower-cased, its initialisms kept ("20-day EMA", "RSI") */
const lowerLabel = (label: string): string => label.split(' ').map(w => (/^[A-Z0-9-]*[A-Z]{2,}[A-Z0-9-]*$/.test(w) ? w : w.toLowerCase())).join(' ');
const whyNowOf = (pillars: Pillar[]): string => {
  const all = pillars.flatMap(p => p.factors.filter(f => !f.context).map(f => ({ ...f, pull: Math.abs(f.lean) * f.weight * PILLAR_WEIGHTS[p.key] })));
  const top = all.filter(f => f.pull > 0).sort((a, b) => b.pull - a.pull).slice(0, 3);
  if (!top.length) return 'Nothing on the name stands out right now.';
  return top.map(f => `${cap(f.label)} ${f.value} — ${f.note}`).join(' · ') + '.';
};
/** A pillar's side in the sentences, on the grade's own cuts: good or strong is for the name, poor against it */
const pillarSide = (score: number): 'for' | 'against' | 'middle' => {
  const g = gradeOf(score);
  return g === 'good' || g === 'strong' ? 'for' : g === 'poor' ? 'against' : 'middle';
};
/** The read in a sentence, from the pillars ranked best first — every clause from the pillars' own labels */
function verdictSentence(ranked: readonly { score: number; name: string; good: string; bad: string }[], screen: Screen): string {
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
  /* every pillar against is named */
  const badWords = bads.length === 1 ? bads[0].bad : `${bads.slice(0, -1).map(p => p.bad).join(', ')} and ${bads[bads.length - 1].bad}`;
  const goodWords = goods.length === 1 ? goods[0].good : `${goods.slice(0, -1).map(p => p.good).join(', ')} and ${goods[goods.length - 1].good}`;
  return cap(`${goodWords} but ${badWords} — a catalyst decides.`);
}
const thesisOf = (pillars: readonly { key: PillarKey; score: number }[], screen: Screen): string => {
  const words: Record<PillarKey, { good: string; bad: string; name: string }> = {
    /* the trend's factors span weeks (20-day average, RSI, ADX, the month), so the words say so */
    trend: { name: 'the trend', good: 'the short-term trend (weeks, not the year) is up', bad: 'the short-term trend (weeks, not the year) has turned down' },
    numbers: { name: 'the numbers', good: 'the numbers are clean', bad: 'the numbers are slipping' },
    money: { name: 'the options flow', good: 'the options flow leans bullish', bad: 'the options flow leans bearish' },
    news: { name: 'the news', good: 'the news helps', bad: 'the news hurts' },
  };
  const ranked = [...pillars].sort((a, b) => b.score - a.score).map(p => ({ score: p.score, ...words[p.key] }));
  return verdictSentence(ranked, screen);
};
/** Every factor's points: its lean × its share of the pillar × 50 × the pillar's weight — they sum to the score's distance from 50 */
const contributionsOf = (pillars: Pillar[]): Contribution[] => {
  const total = pillars.reduce((a, p) => a + PILLAR_WEIGHTS[p.key], 0) || 1;
  return pillars
    .flatMap(p => {
      const own = p.factors.filter(f => !f.context);
      const w = own.reduce((a, f) => a + f.weight, 0) || 1;
      return own.map(f => ({ key: `${p.key}:${f.key}`, pillar: p.key, label: f.label, value: f.value, points: Math.round(f.lean * (f.weight / w) * 50 * (PILLAR_WEIGHTS[p.key] / total) * 10) / 10 }));
    })
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
};
/** The factors whose flip would move the composite most — and by how much */
const movesOf = (pillars: Pillar[], composite: number): Move[] => {
  const out: Move[] = [];
  const total = pillars.reduce((a, q) => a + PILLAR_WEIGHTS[q.key], 0) || 1;
  for (const p of pillars) {
    const own = p.factors.filter(x => !x.context);
    const w = own.reduce((a, f) => a + f.weight, 0) || 1;
    for (const f of own) {
      if (Math.abs(f.lean) < 0.15) continue;
      /* the factor turned the other way, the rest held */
      const flipped = own.map(x => (x === f ? { ...x, lean: -x.lean } : x));
      const pillarThen = Math.round(50 + 50 * flipped.reduce((a, x) => a + x.lean * x.weight, 0) / w);
      const delta = Math.round((pillarThen - p.score) * (PILLAR_WEIGHTS[p.key] / total));
      if (delta === 0) continue;
      out.push({ key: `${p.key}:${f.key}`, label: f.label, delta, to: composite + delta });
    }
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
};
/* A pillar agrees, argues or sits in the middle by its own grade; under a neutral read nothing agrees or argues and
   each pillar says which way it pulls. */
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
      risk = `The case against the ${lean} read is ${lowerName(p)}${f ? ` — ${lowerLabel(f.label)} ${f.value}, ${f.note}` : ''}; if that strengthens, the read turns there first.`;
    } else {
      const all = rows.every(r => r.stance === 'agrees');
      const between = rows.filter(r => r.stance === 'middle').map(r => r.name.toLowerCase());
      risk = tail(all ? 'Every pillar agrees' : `No pillar argues against it${between.length ? ` — ${listWords(between)} ${between.length === 1 && !/^the numbers/.test(between[0]) ? 'sits' : 'sit'} in the middle, at caution` : ''}`);
    }
  }
  return { lean, pillars: rows, aligned: rows.filter(r => r.agrees).length, risk };
};
const explanationOf = (name: string, composite: number, pillars: Pillar[], numbers: Fundamentals, agreement: Agreement): string => {
  const fair = numbers.sample || numbers.fairValue == null || numbers.vsFairValuePct == null || numbers.valuation == null ? '' : ` The numbers put the price ${signedPct(numbers.vsFairValuePct)} from fair value, ${numbers.valuation}.`;
  if (!pillars.length) return `${name} has no live read yet. ${agreement.risk}`;
  const grade = gradeOfComposite(composite);
  const strongest = (side: 'for' | 'against') => [...pillars].filter(p => sideOf(p.score) === side).sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50))[0];
  const why = (p: Pillar) => {
    const f = topFactor(p);
    return f ? ` — ${lowerLabel(f.label)} ${f.value}, ${f.note}` : '';
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
/* A move of half a percent or more is set against the name's story that day and SPY's own move. */
const todayWhyOf = (ticker: string, dayPct: number | null | undefined, news: NewsRead): string => {
  if (dayPct == null || !Number.isFinite(dayPct) || Math.abs(dayPct) < 0.5 || ticker === 'SPY') return '';
  /* the session named: today once it has opened, else the last session's day */
  const session = lastSessionIso();
  const isToday = session === nyIsoDate();
  const [sy, sm, sd] = session.split('-').map(Number);
  const dayWord = isToday ? 'today' : `on ${new Date(Date.UTC(sy, sm - 1, sd, 12)).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '')}`;
  const story = news.stories.find(st => nyIsoDate(st.item.atMs) >= session);
  const spy = peekQuote('SPY');
  const market = spy && spy.phase === 'regular' && Number.isFinite(spy.changePct) ? ` The market: SPY ${signedPct(spy.changePct)} today.` : '';
  const move = signedPct(dayPct);
  return story
    ? ` ${isToday ? "Today's" : `${dayWord.slice(3)}'s`} ${move}: on the wire, "${story.item.headline.length > 110 ? `${story.item.headline.slice(0, 107)}…` : story.item.headline}".${market}`
    : ` No story on the wire ${dayWord} explains the ${move} move.${market}`;
};
const methodOf = (trend: TrendRead, money: MoneyRead, news: NewsRead, pillars: Pillar[], composite: number, lean: Lean): Method => ({
  observed: [
    `${trend.sessions} sessions of the name's own bars`,
    `${money.volumeToday != null ? `${fmtCount(money.volumeToday)} shares today` : 'no volume yet today'}${money.volumeAvg != null ? ` against ${fmtCount(money.volumeAvg)} usual` : ''}`,
    `${fmtCount(money.callOI + money.putOI)} contracts of open interest (the screener)`,
    money.callPremium + money.putPremium > 0 ? `${fmtMoney(money.callPremium + money.putPremium)} of option premium today (screener call_premium + put_premium)` : 'no option premium on the screener yet',
    money.dark.prints.length ? `${money.dark.prints.length} off-exchange ${money.dark.prints.length === 1 ? 'print' : 'prints'}` : 'no off-exchange prints in the recent tape',
    `${news.stories.length} ${news.stories.length === 1 ? 'story' : 'stories'} on the wire`,
  ],
  derived: [
    `the screener's 20-day EMA${trend.sma50 != null ? ', 50-' : ''}${trend.sma200 != null ? ' and 200-day SMA' : ''} · RSI · ADX · the range percentile · the structure`,
    'bullish against bearish premium (the side of the trade) and calls against puts (the kind of contract), from the screener',
    money.darkWindow.read ? 'off-exchange prints over or under their own quote\'s mid, the regular session\'s sized prints only' : 'no regular-session off-exchange print to read',
    `the wire's stories and each named stock's move at publish`,
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

export function buildStockOverview(tickerRaw: string, tape: readonly FlowPrint[] = []): StockOverview | null {
  const ticker = tickerRaw.toUpperCase();
  const u = lookup(ticker);
  const name = displayName(u?.name ?? tickerName(ticker)) || ticker;
  const sector = u?.sector ?? null;
  const clock = readSessionClock();
  /* the one session (core/session.ts): overnight, pre-market, the session (and its closing auction), after hours, closed */
  const phase = phaseAt(Date.now());
  const marketWord = phase === 'regular' ? (clock.phase === 'AUCTION' ? 'the closing auction' : 'market open') : phase === 'overnight' ? 'overnight' : phase === 'pre' ? 'pre-market' : phase === 'post' ? 'after hours' : 'market closed';
  const file = peekStockFile(ticker);
  /* the read is the screener row's: until the name's file lands there is no read to give (never a placeholder word) */
  if (file.status !== 'live') return null;
  const minute = file.minutes ?? [];
  const blocks = file.days.length >= 5 ? file.days.map(c => [c]) : minute.length >= 2 ? [minute] : [];

  /* the day's change is the regular session's; the quote keeps the extended move apart */
  const quote = peekQuote(ticker);
  const screenRead = file.screen ? screenerRead(file.screen, peekRegularCloses(ticker)) : null;
  const spot = (quote && quote.regularPrice > 0 ? quote.regularPrice : null) ?? screenRead?.regular ?? (nOr(file.screen?.close) || file.days[file.days.length - 1]?.close || 0);
  const dayPct = quote ? quote.changePct : screenRead?.pct ?? 0;
  const extLine = extendedLine(quote);
  const trendBars = trendFor(blocks, spot);
  /* the card prints the screener row's own measures, the figures the factors score; the bars keep the range and structure */
  const trend = { ...trendBars, read: screenTrend(trendBars.read, file.screen) };
  const money = moneyFor(ticker, spot, blocks, file, dayPct);
  const news = newsFor(ticker, file);
  const numbers = numbersFor(file);
  /* the grade is readOfScreen's; the page's own reads sit beside it as context */
  const sr = readOfScreen(file.screen);
  const ctx = (fs: Factor[]): Factor[] => fs.map(f => ({ ...f, context: true }));
  const scoredOf = (k: PillarKey): Factor[] => sr.pillars.find(p => p.key === k)?.factors ?? [];
  const inReadOf = (k: PillarKey): boolean => sr.pillars.find(p => p.key === k)?.inRead ?? false;
  const trendFactors = [...scoredOf('trend'), ...ctx(trend.factors.filter(f => f.key === 'structure'))];
  const numberFactors = [...scoredOf('numbers'), ...ctx(numbers.factors)];
  const moneyFactors = [...scoredOf('money'), ...ctx(money.factors.filter(f => f.key === 'dark'))];
  const pillars: Pillar[] = [
    { key: 'trend', name: PILLAR_NAMES.trend, inRead: inReadOf('trend'), score: scoreOf(trendFactors), factors: trendFactors, status: file.screen ? 'live' : 'thin', from: 'the screener row · the swing structure from the sessions on hand' },
    { key: 'numbers', name: PILLAR_NAMES.numbers, inRead: inReadOf('numbers'), score: scoreOf(numberFactors), factors: numberFactors, status: inReadOf('numbers') ? 'live' : 'sample', from: inReadOf('numbers') ? 'EPS growth and the share count · the last print beside it' : 'not on this feed' },
    { key: 'money', name: PILLAR_NAMES.money, inRead: inReadOf('money'), score: scoreOf(moneyFactors), factors: moneyFactors, status: file.screen ? 'live' : 'thin', from: 'the screener row · the dark pool beside it' },
    { key: 'news', name: PILLAR_NAMES.news, inRead: false, score: 50, factors: ctx(news.factors), status: wireLive(ticker) || news.read.reports.length ? 'live' : 'thin', from: 'the wire — shown, not scored' },
  ];
  const scored = pillars.filter(p => p.inRead);
  const composite = sr.composite;
  const screen = sr.screen;
  const lean = sr.lean;
  const livePillars = scored;

  /* The history is the trend pillar alone, every point off the name's daily bars, today's included. */
  const trendAt = (back: number): number | null => {
    const t = trendFor(blocks, spot, back).factors.filter(f => f.key !== 'structure');
    return t.length ? scoreOf(t) : null;
  };
  const sessions = trend.read.sessions;
  const series: TrendPoint[] = [];
  for (let back = Math.min(20, Math.max(0, sessions - 1)); back >= 0; back--) {
    const t = trendAt(back);
    const block = blocks[blocks.length - 1 - back];
    if (t == null || !block) continue;
    series.push({ back, time: block[0].time, trend: t });
  }
  const scoreAt = (back: number): number | null => series.find(s => s.back === back)?.trend ?? null;

  /* the timeline: what happened on the sessions on hand, newest first */
  const timeline: TimelineEntry[] = [];
  news.read.stories.slice(0, 3).forEach(s => timeline.push({ key: `news:${s.id}`, when: s.item.time, kind: 'news', text: s.item.headline, time: null, score: scoreAt(0) }));
  const n = blocks.length;
  /* every session on hand is scanned, since the lanes span them all */
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
    if (Math.abs(chg) >= 2.5) timeline.push({ key: `session:${when}`, when, kind: 'session', text: `a ${signedPct(chg)} session`, time, score: scoreAt(back) });
  }
  if (news.lastReport) {
    const q = news.lastReport;
    const said = q.result == null || q.epsActual == null || q.epsEst == null ? (q.epsActual != null ? `reported EPS ${q.epsActual.toFixed(2)} — no estimate on file` : 'reported — no EPS on file') : `${q.result === 'beat' ? 'beat' : q.result === 'inline' ? 'in line' : 'missed'} on EPS — ${q.epsActual.toFixed(2)} against ${q.epsEst.toFixed(2)}`;
    timeline.push({ key: `earnings:${q.label}`, when: q.label, kind: 'earnings', text: `${said}${q.movePct != null ? ` · ${signedPct(q.movePct)} the session after` : ''}`, time: null, score: null });
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
  const record = peekLive();
  const insiderN = record.insiders.status === 'live' ? record.insiders.trades.filter(t => t.ticker === ticker).length : 0;
  const congressN = record.congress.status === 'live' ? record.congress.trades.filter(t => t.ticker === ticker).length : 0;
  const sources: Source[] = [
    { key: 'price', label: 'Price', status: quote ? 'live' : 'thin', stamp: quote ? `last print ${nyClock(quote.tapeAt, { zone: true })}` : 'reading the quote' },
    { key: 'screen', label: 'The screener row', status: file.screen ? 'live' : 'thin', stamp: file.screen ? `${file.keptAt ? 'kept' : 'read'} ${nyClock(file.keptAt ?? file.at ?? at, { zone: true })}` : 'no row for this name' },
    /* nothing reads "none" until the tapes are in */
    { key: 'flow', label: 'The flow book', status: file.tapes === 'live' ? 'live' : 'thin', stamp: file.tapes === 'loading' ? 'reading…' : file.flow.length ? `${file.flow.length} ${file.flow.length === 1 ? 'alert' : 'alerts'}` : file.tapes === 'live' ? 'no alerts on this name' : 'the read did not land' },
    /* each count says what it counts: the tape is flow alerts; the dark pool says how many prints the card reads */
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
    /* the headline is liveQuote's price, said as which price it is */
    price: priceWords(quote)?.lead ?? spot,
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
    sources,
    completeness,
    settling,
  };
}
