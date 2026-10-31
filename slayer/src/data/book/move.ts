/* The expected move every odd reads: the vendor's implied move is its ATM straddle, so 1σ = straddle·√(π/2)
   (data/expectedMove.ts); a date with no implied move uses k·S·σ·√T on the vendor's own fitted k, T the calendar time to
   that expiry's close (core/volClock calendarYears). The vendor's `dte` is whole calendar days from its row's date to the
   expiry — Friday's rows put Monday at 3 and the same day at 0, and its move ÷ (S·σ·√(dte/365)) is one k (0.680 ± 0.004 on
   SPY 2026-10-30, dte 3…31) where dte+1 drifts from 0.59 to 0.67 — so tomorrow is one day of variance, not two. */

import { bookToday, isoDate, nextSession, MONTHS as MON3 } from '../../core/calendar';
import { nyIsoDate, nySessionPhase } from '../../core/nyTime';
import { calendarYears, sigmaMoveOfQuotedIv } from '../../core/volClock';
import { tradingMinutes } from '../../core/tradingYear';
import { now } from '../../core/clock';
import { sigmaFromStraddle, sigmaOverMinutes, STRADDLE_K, STRADDLE_TO_SIGMA, undatedExpiry } from '../expectedMove';
import { type UwInterp, type UwTerm } from '../whales';
import { num } from './scale';
import { peekEntry, type Entry } from './store';


export function peekIv(ticker: string): number | null {
  const e = peekEntry(ticker);
  return e?.status === 'live' && e.iv > 0 ? e.iv : null;
}

/** Today's expiry, else nothing — a later expiry's move is not this session's. */
export function impliedMoveOf(rows: UwTerm[], today: string, spot: number): number {
  if (!Array.isArray(rows) || !(spot > 0)) return 0;
  const row = rows.find(r => String(r.expiry ?? '') === today);
  const dollars = num(row?.implied_move);
  if (!(dollars > 0) || dollars > spot * 0.2) return 0;
  return dollars;
}

/** Each expiry's at-the-money vol off the term structure, annualised fraction — null when the rows carry none */
export function termIvOf(rows: UwTerm[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = String(r.expiry ?? '');
    /* the vendor prints a fraction ("0.127"); a 3.2 is 320%, not a percent to divide */
    const v = num(r.volatility);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0 && v < 5) out[d] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Each expiry's own implied move off the term structure, dollars — null when the rows carry none */
export function termMoveOf(rows: UwTerm[], spot: number): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = String(r.expiry ?? '');
    const v = num(r.implied_move);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && v > 0 && v < spot * 0.5) out[d] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** The vendor's k (see Entry.termK): the median of move ÷ (S·σ·√(dte/365)) over its rows — null when no row carries both */
export function termKOf(rows: UwTerm[], spot: number): number | null {
  if (!Array.isArray(rows) || !(spot > 0)) return null;
  const ks: number[] = [];
  for (const r of rows) {
    /* the vendor prints a fraction ("0.127"); a 3.2 is 320%, not a percent to divide */
    const v = num(r.volatility);
    const m = num(r.implied_move);
    const dte = num((r as Record<string, unknown>).dte);
    if (v > 0 && v < 5 && m > 0 && dte > 0) ks.push(m / (spot * v * Math.sqrt(dte / 365)));
  }
  if (!ks.length) return null;
  ks.sort((a, b) => a - b);
  const k = ks[Math.floor(ks.length / 2)];
  return k > 0.3 && k < 1.2 ? k : null;
}
export function termDteOf(rows: UwTerm[]): Record<string, number> | null {
  const out: Record<string, number> = {};
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = String(r.expiry ?? '');
    const dte = num((r as Record<string, unknown>).dte);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && dte > 0) out[d] = dte;
  }
  return Object.keys(out).length ? out : null;
}
/* The expected move as one standard move (1σ, dollars): the vendor's implied move is its ATM straddle, so 1σ = straddle·√(π/2);
   a date with no implied move uses k·S·σ·√T_calendar to its close on the vendor's own scale (k fitted, else √(2/π)). Every odd and the cone read these. */
interface ScopeMove {
  /** Dollars, one standard move (1σ) over the horizon */
  move: number;
  /** The vendor's straddle the move was read from, dollars (≈0.80σ) */
  straddle: number;
  /** The expiry the move runs to */
  until: string | null;
  /** True when that expiry is past the coming session — the odds are "by <date>", not "by the close" */
  multi: boolean;
  source: 'vendor' | 'fitted' | 'iv30';
  /** "1σ = the vendor's straddle into Nov 20 × 1.25" — which number was used, in words */
  words: string;
}
export const monDayOf = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return m && d ? `${MON3[m - 1]} ${d}` : iso;
};
/** The straddle a vendor vol implies into `expiry`'s close on the vendor's own scale: k·S·σ·√T_calendar. */
const straddleOf = (e: Entry, iv: number, expiry: string, nowMs: number): number => (e.termK ?? STRADDLE_K) * e.spot * iv * Math.sqrt(calendarYears(expiry, nowMs));
/** One session's (390 trading minutes) 1σ off `expiry`'s vol on the vendor's scale: volClock's σ, times k/√(2/π) so a
    vol-derived straddle sits on the same scale as the vendor's printed ones (k = √(2/π) when no row fits one). */
const sessionSigmaOf = (e: Entry, iv: number, expiry: string, nowMs: number): number =>
  ((e.termK ?? STRADDLE_K) / STRADDLE_K) * sigmaMoveOfQuotedIv(e.spot, iv, expiry, 390, nowMs);
export function peekScopeMove(ticker: string, date?: string | null): ScopeMove | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const session = isoDate(nextSession(bookToday()));
  const multi = !!d && d > session;
  const name = d ? monDayOf(d) : null;
  const vendor = d ? e.termMove?.[d] : undefined;
  const of = (straddle: number, source: ScopeMove['source'], words: string): ScopeMove => ({ move: sigmaFromStraddle(straddle), straddle, until: d, multi, source, words: `1σ = ${words} × ${STRADDLE_TO_SIGMA.toFixed(2)}` });
  if (vendor && vendor > 0) return of(vendor, 'vendor', `the printed at-the-money straddle into ${name}`);
  const t = now().getTime();
  const until = d ?? session;
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return of(straddleOf(e, atm, until, t), 'fitted', `the straddle ${name}'s at-the-money vol prices`);
  /* the 30-day vol over the time to this expiry, its variance unchanged (σ_30·√T): the same vol, a shorter horizon */
  if (e.iv > 0) return of(straddleOf(e, e.iv, until, t), 'iv30', `the straddle the 30-day implied vol prices (no vol printed for ${name ?? 'the expiry'})`);
  return null;
}

/* One full session's 1σ for the levels' expiry: the straddle into the coming session before it opens; once a same-day session runs
   its straddle is only what is left, so a full session is the 1-day vol. A later expiry: its ATM vol over one session. */
const sameDayRunning = (d: string | null): boolean => !!d && d === nyIsoDate() && nySessionPhase() !== 'before';
export function peekDaySigma(ticker: string, date?: string | null): number | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const session = isoDate(nextSession(bookToday()));
  const move = d ? e.termMove?.[d] : undefined;
  const t = now().getTime();
  if (d === session && move && move > 0) {
    if (!sameDayRunning(d)) return sigmaFromStraddle(move);
    /* the 1-day tenor (days = 1) is one calendar day of variance — one session's — on the vendor's scale */
    if (e.dayIv && e.dayIv > 0) return sigmaFromStraddle((e.termK ?? STRADDLE_K) * e.spot * e.dayIv * Math.sqrt(1 / 365));
    if (e.dayMoveFrac > 0 && e.dayMoveFrac < 0.2) return sigmaFromStraddle(e.dayMoveFrac * e.spot);
    /* the straddle left is the move over the trading minutes left (210 in all on an early close): one 390-minute session is
       that σ × √(390 / left) */
    const left = tradingMinutes(d, t, false) ?? 0;
    return sigmaFromStraddle(move) * Math.sqrt(390 / Math.max(39, left));
  }
  const atm = d ? e.termIv?.[d] : undefined;
  if (d && atm && atm > 0) return sessionSigmaOf(e, atm, d, t);
  return e.iv > 0 ? sessionSigmaOf(e, e.iv, undatedExpiry(t), t) : null;
}

/** 1σ from now to the close, dollars, time-scaled once: a same-day expiry's straddle read in its session already IS the
    move left; a full session's 1σ is scaled by √(minutes left / 390). `minutesLeft`: 390 outside the session. */
export function peekMoveToClose(ticker: string, date: string | null | undefined, minutesLeft: number): number | null {
  const e = peekEntry(ticker);
  if (!e || e.status !== 'live' || !(e.spot > 0)) return null;
  const floor = isoDate(bookToday());
  const listed = e.expiries.map(x => x.date).filter(d => d >= floor).sort();
  const d = date && date >= floor ? date : listed[0] ?? null;
  const move = d ? e.termMove?.[d] : undefined;
  if (d && sameDayRunning(d) && nySessionPhase() === 'open' && move && move > 0) return sigmaFromStraddle(move);
  const day = peekDaySigma(ticker, date);
  return day == null ? null : sigmaOverMinutes(day, minutesLeft);
}

/** The interpolated 1-day implied vol (days = 1), annualised fraction — null when the rows carry none */
export function dayIvOf(rows: UwInterp[]): number | null {
  if (!Array.isArray(rows)) return null;
  const ones = rows.filter(r => num(r.days) === 1 && num(r.volatility) > 0);
  if (!ones.length) return null;
  const row = ones.reduce((best, r) => (String(r.date ?? '') > String(best.date ?? '') ? r : best));
  const v = num(row.volatility);
  return v > 0 && v < 5 ? v : null;
}

/** The 1-day tenor, as a fraction of spot. The vendor prints a fraction (0.004 = 0.4%). */
export function dayFracOf(rows: UwInterp[]): number {
  if (!Array.isArray(rows)) return 0;
  const ones = rows.filter(r => num(r.days) === 1 && num(r.implied_move_perc) > 0);
  if (!ones.length) return 0;
  const row = ones.reduce((best, r) => (String(r.date ?? '') > String(best.date ?? '') ? r : best));
  let frac = num(row.implied_move_perc);
  if (frac > 1) frac /= 100;
  return frac > 0 && frac < 0.2 ? frac : 0;
}
