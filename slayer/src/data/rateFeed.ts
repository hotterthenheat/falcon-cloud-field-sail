/* The pricing rate (core/carry.ts setRate): the overnight rate SOFR from the rate history (/interest_rate/history/eod),
   read through the server's data hub. Every browser asks the SAME path for a publishing day, and the hub keeps an answer
   for a day (shared/thetaPaths.mjs thetaTtl), so the vendor is asked about once a day however many viewers price.

   SOFR is published about 08:00 New York for the day before, so the publishing day turns at 08:30: before it the window
   ends yesterday, after it today. The answer's newest row is the rate in use ('live'); it is kept in this browser, and a
   reload or a page that may not ask (Trace, the Dossier) prices at that last good read ('held') until a fresh one lands.
   With none ever read: the fixed core/carry DEFAULT_R ('fixed'). The hover says which (rateWords).

   A past day (the backtest, a replayed paper minute) is priced at that day's own rate: ensureDayRates reads the day's
   month once (rows come every calendar day) and core/carry rateOn picks the day's row. */

import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_R, carryRev, rateNow, setDayRates, setRate, subscribeCarry, type RateRead } from '../core/carry';
import { nyIsoDate, nyMinutes } from '../core/nyTime';
import { thetaCall } from './theta';

export const RATE_SYMBOL = 'SOFR';
/* v2: the kept rate is the continuous one (sofrToContinuous); a v1 copy held SOFR as quoted */
const KEY = 'slayer.rate.v2';
/** 08:30 New York: the day's SOFR is out by then */
const PUBLISHED_MIN = 8 * 60 + 30;
/** Days of history in the live window: a long weekend and a holiday still leave a row */
const WINDOW_DAYS = 14;

const ymd = (iso: string) => iso.replace(/-/g, '');
function isoPlus(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** The publishing day at an instant: New York's date from 08:30, the day before until then */
export function publishDay(now = Date.now()): string {
  const day = nyIsoDate(now);
  return nyMinutes(now) >= PUBLISHED_MIN ? day : isoPlus(day, -1);
}

/** The one path every browser asks for the rate on a publishing day */
export const ratePath = (now = Date.now()): string => {
  const end = publishDay(now);
  return `/interest_rate/history/eod?symbol=${RATE_SYMBOL}&start_date=${ymd(isoPlus(end, -WINDOW_DAYS))}&end_date=${ymd(end)}&format=json`;
};

/** A past day's month (from a week before its first, for a 1st that follows a holiday), ending no later than today */
export function monthPath(day: string, now = Date.now()): string {
  const first = `${day.slice(0, 7)}-01`;
  const [y, m] = day.split('-').map(Number);
  const last = isoPlus(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`, -1);
  const today = publishDay(now);
  return `/interest_rate/history/eod?symbol=${RATE_SYMBOL}&start_date=${ymd(isoPlus(first, -7))}&end_date=${ymd(last < today ? last : today)}&format=json`;
}

/** SOFR as quoted — an overnight rate, simple interest on ACT/360, percent — as the continuously-compounded ACT/365
    rate every greek is priced at (core/carry): one night at SOFR grows $1 by 1 + SOFR/360, so r = 365 · ln(1 + SOFR/360).
    (3.94% quoted is 3.9945% continuous; read as is, every forward and rho was 0.05 pts short.) */
export const sofrToContinuous = (pct: number): number => 365 * Math.log1p(pct / 100 / 360);

/** The rate history's rows: { rate: 3.94 (percent), created: "2026-10-30" (the fixing's date) } → { day, r }, r the
    continuous ACT/365 rate (sofrToContinuous: 0.039945 for 3.94), oldest first */
export function parseRates(data: unknown): { day: string; r: number }[] {
  const rows = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { response?: unknown }).response) ? (data as { response: unknown[] }).response : [];
  const out: { day: string; r: number }[] = [];
  for (const raw of rows as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue;
    const day = String(raw.created ?? raw.date ?? '').slice(0, 10);
    const pct = Number(raw.rate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(pct) || raw.rate === '' || raw.rate == null) continue;
    out.push({ day, r: sofrToContinuous(pct) });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Puts a rate answer in the carry: every day's row, and the newest as the rate in use. The newest, or null. */
export function takeRates(data: unknown): { day: string; r: number } | null {
  const rows = parseRates(data);
  if (!rows.length) return null;
  setDayRates(rows);
  const last = rows[rows.length - 1];
  if (!setRate(last.r, 'live', last.day)) return null;
  try {
    localStorage.setItem(KEY, JSON.stringify({ r: last.r, asOf: last.day, at: Date.now() }));
  } catch {
    /* no storage: the next visit reads again */
  }
  return last;
}

/* the last good read this browser kept, in force until today's lands */
let heldTried = false;
/** Puts the last good read this browser kept in the carry, once a page load ('held'; a live read already in wins) */
export function loadHeldRate(again = false): void {
  if (heldTried && !again) return;
  heldTried = true;
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) || 'null') as { r?: unknown; asOf?: unknown } | null;
    if (kept && typeof kept.r === 'number') setRate(kept.r, 'held', typeof kept.asOf === 'string' ? kept.asOf : null);
  } catch {
    /* nothing kept */
  }
}

let askedPath = '';
let failedAt = 0;
let inflight = false;
/** Reads today's rate once per publishing day (again a minute after a failed read). Safe to call on every render. */
export function ensureRate(now = Date.now()): void {
  if (typeof window === 'undefined') return;
  loadHeldRate();
  const path = ratePath(now);
  if (inflight || (askedPath === path && (rateNow().source === 'live' || now - failedAt < 60_000))) return;
  askedPath = path;
  inflight = true;
  void thetaCall(path)
    .then(a => {
      if (a.error || !takeRates(a.data)) failedAt = Date.now();
    })
    .finally(() => {
      inflight = false;
    });
}

const months = new Map<string, number>();
/** Reads a past day's month of rates once (again a minute after a failed read) */
export function ensureDayRates(day: string, now = Date.now()): void {
  if (typeof window === 'undefined' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= publishDay(now)) return;
  const path = monthPath(day, now);
  const at = months.get(path);
  if (at != null && (at === 0 || now - at < 60_000)) return;
  months.set(path, 0);
  void thetaCall(path).then(a => {
    const rows = a.error ? [] : parseRates(a.data);
    if (rows.length) setDayRates(rows);
    else months.set(path, Date.now());
  });
}

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const dayWords = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};

/** The rate in words, for a hover: which one is in use, and why */
export function rateWords(read: RateRead = rateNow()): string {
  /* the rate in use is continuous (sofrToContinuous); the quote a trader knows is SOFR as published */
  const quoted = pct(360 * Math.expm1(read.r / 365));
  if (read.source === 'live') return `a ${pct(read.r)} rate (the overnight SOFR rate for ${dayWords(read.asOf)}, ${quoted} as quoted, compounded)`;
  if (read.source === 'held') return `a ${pct(read.r)} rate (${quoted} as quoted: the last SOFR rate read, for ${dayWords(read.asOf)}; today's has not loaded)`;
  return `a fixed ${pct(DEFAULT_R)} rate (no market rate has loaded)`;
}

/** The rate in use, read on mount and re-rendered when it lands */
export function useRate(): RateRead {
  useEffect(() => ensureRate(), []);
  useSyncExternalStore(subscribeCarry, carryRev, carryRev);
  return rateNow();
}
