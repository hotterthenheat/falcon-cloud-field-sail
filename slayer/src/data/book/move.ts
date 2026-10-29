/* The expected move every odd reads: the vendor's implied move is its ATM straddle, so 1σ = straddle·√(π/2)
   (data/expectedMove.ts); a date with no implied move uses k·S·σ·√(dte/365) on the vendor's own fitted k. */

import { bookToday, isoDate, nextSession, MONTHS as MON3 } from '../../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase } from '../../core/nyTime';
import { sigmaFromStraddle, sigmaOverMinutes, STRADDLE_K, STRADDLE_TO_SIGMA } from '../expectedMove';
import { type UwInterp, type UwTerm } from '../whales';
import { num } from './scale';
import { peekEntry, type Entry } from './store';
import { CLOSE_MIN, OPEN_MIN } from './tape';


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
    let v = num(r.volatility);
    if (v > 3) v /= 100;
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
    let v = num(r.volatility);
    if (v > 3) v /= 100;
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
   a date with no implied move uses k·S·σ·√(dte/365) on the vendor's own scale (k fitted, else √(2/π)). Every odd and the cone read these. */
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
/** The straddle a vendor vol implies over `dte` calendar days on the vendor's own scale */
const straddleOf = (e: Entry, iv: number, dte: number): number => (e.termK ?? STRADDLE_K) * e.spot * iv * Math.sqrt(dte / 365);
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
  if (vendor && vendor > 0) return of(vendor, 'vendor', `the vendor's straddle into ${name}`);
  const dte = (d && e.termDte?.[d]) || (d ? Math.max(1, Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${floor}T00:00:00Z`)) / 86_400_000) + 1) : 1);
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return of(straddleOf(e, atm, dte), 'fitted', `the straddle ${name}'s at-the-money vol prices`);
  if (e.iv > 0) return of(straddleOf(e, e.iv, dte), 'iv30', `the straddle the 30-day implied vol prices (no vol printed for ${name ?? 'the expiry'})`);
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
  if (d === session && move && move > 0) {
    if (!sameDayRunning(d)) return sigmaFromStraddle(move);
    if (e.dayIv && e.dayIv > 0) return sigmaFromStraddle(straddleOf(e, e.dayIv, 1));
    if (e.dayMoveFrac > 0 && e.dayMoveFrac < 0.2) return sigmaFromStraddle(e.dayMoveFrac * e.spot);
    const left = Math.max(0, CLOSE_MIN - nyMinutes());
    return sigmaFromStraddle(move) / Math.sqrt(Math.max(0.1, left / (CLOSE_MIN - OPEN_MIN)));
  }
  const atm = d ? e.termIv?.[d] : undefined;
  if (atm && atm > 0) return sigmaFromStraddle(straddleOf(e, atm, 1));
  return e.iv > 0 ? sigmaFromStraddle(straddleOf(e, e.iv, 1)) : null;
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
  let v = num(row.volatility);
  if (v > 3) v /= 100;
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
