/* The expected-move cone from a real vol surface. On a ThetaData page: each expiry's at-the-money IV off the terminal,
   one standard deviation, S·σ·√t. On an Unusual Whales page: the term structure, each expiry's implied_move the width (a
   same-day row in session is the move left); outside the session one session is the 1-day implied_move_perc, else
   k·S·σ·√(1/365). No guessed vol. */

import { useSyncExternalStore } from 'react';
import { RTH_MINUTES } from '../core/calendar';
import { nyIsoDate, nyMinutes, nySessionPhase, SESSION_CLOSE_MIN } from '../core/nyTime';
import { YEAR_MINUTES } from './measure';
import { thetaGet } from './thetaFeed';
import { thetaUseHere } from './theta';
import { uwCall } from './whales';

type ConeHorizon = 'session' | 'week' | 'next';

interface ConeDraw {
  iv: number;
  forwardMin: number;
  /** The session is over. Draw the day's band from the open, not a collapsed tip. */
  fromOpen: boolean;
  source: string;
}

interface Row {
  expiry: string;
  dte: number;
  iv: number;
  move: number;
}

interface Surface {
  at: number;
  rows: Row[];
  dayIv: number;
  /** 1-day interpolated move as a fraction of spot. 0 when the vendor did not print one. */
  dayFrac: number;
  /** Vendor scale, move ÷ (S·σ·√(dte/365)). 0 when the rows could not fit one. */
  k: number;
  source: string;
}

const cache = new Map<string, Surface>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let rev = 0;

const CHAIN: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP' };
const UW: Record<string, string> = { SPXW: 'SPX', RUTW: 'RUT', NDXP: 'NDX' };

function emit(): void {
  rev += 1;
  listeners.forEach(fn => fn());
}

export function subscribeCone(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function asRows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

function firstRecord(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function annual(v: number): number {
  if (!(v > 0)) return 0;
  return v > 3 ? v / 100 : v;
}

function sessionsOf(dte: number): number {
  if (dte <= 1) return 1;
  if (dte <= 5) return dte;
  return Math.max(1, Math.round((dte * 5) / 7));
}

function minutesLeft(): number {
  const phase = nySessionPhase();
  if (phase === 'before') return RTH_MINUTES;
  if (phase === 'open') return Math.max(1, SESSION_CLOSE_MIN - nyMinutes());
  return 0;
}

function scaleK(surface: Surface, spot: number): number {
  if (surface.source === 'theta') return 1;
  if (!(spot > 0)) return 0;
  const ks: number[] = [];
  for (const row of surface.rows) {
    if (!(row.iv > 0) || !(row.move > 0) || !(row.dte > 0)) continue;
    ks.push(row.move / (spot * row.iv * Math.sqrt(row.dte / 365)));
  }
  if (!ks.length) return surface.k > 0 ? surface.k : 0;
  ks.sort((a, b) => a - b);
  const k = ks[Math.floor(ks.length / 2)];
  return k > 0.3 && k < 1.2 ? k : 0;
}

async function fromUw(ticker: string): Promise<Surface | null> {
  const symbol = UW[ticker] ?? ticker;
  const [term, interp] = await Promise.all([
    uwCall(`/stock/${encodeURIComponent(symbol)}/volatility/term-structure`),
    uwCall(`/stock/${encodeURIComponent(symbol)}/interpolated-iv`),
  ]);
  if (term.error && interp.error) return null;
  const today = nyIsoDate();
  const rows: Row[] = [];
  for (const raw of asRows(term.data)) {
    const expiry = String(raw.expiry ?? raw.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || expiry < today) continue;
    const iv = annual(num(raw.volatility));
    const move = num(raw.implied_move);
    const dte = num(raw.dte) || Math.max(0, Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
    if (!(iv > 0) && !(move > 0)) continue;
    rows.push({ expiry, dte, iv, move });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  let dayIv = 0;
  let dayFrac = 0;
  for (const raw of asRows(interp.data)) {
    if (num(raw.days) !== 1) continue;
    const iv = annual(num(raw.volatility));
    if (iv > dayIv) dayIv = iv;
    let frac = num(raw.implied_move_perc);
    if (frac > 1) frac /= 100;
    if (frac > dayFrac && frac < 0.2) dayFrac = frac;
  }
  if (!rows.length && !(dayIv > 0) && !(dayFrac > 0)) return null;
  return { at: Date.now(), rows, dayIv, dayFrac, k: 0, source: 'uw' };
}

async function atmIv(root: string, expiration: string): Promise<{ iv: number; under: number } | null> {
  const got = await thetaGet(`/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(root)}&expiration=${expiration.replace(/-/g, '')}&strike_range=1&format=json`);
  if (got.error) return null;
  let under = 0;
  const byStrike = new Map<number, { c: number; p: number }>();
  for (const item of asRows(got.data)) {
    /* v3 answers flat rows; a grouped answer nests the contract and its quote */
    const contract = (item.contract as Record<string, unknown> | undefined) ?? item;
    const data = 'data' in item ? firstRecord(item.data) : item;
    if (!data) continue;
    const strike = num(contract.strike);
    const iv = annual(num(data.implied_vol));
    const px = num(data.underlying_price);
    if (px > 0) under = px;
    if (!(strike > 0) || !(iv > 0)) continue;
    const row = byStrike.get(strike) ?? { c: 0, p: 0 };
    const right = String(contract.right ?? '').toLowerCase();
    if (right.startsWith('c')) row.c = iv;
    else if (right.startsWith('p')) row.p = iv;
    byStrike.set(strike, row);
  }
  if (!byStrike.size || !(under > 0)) return null;
  let best = 0;
  let dist = Infinity;
  for (const strike of byStrike.keys()) {
    const d = Math.abs(strike - under);
    if (d < dist) {
      dist = d;
      best = strike;
    }
  }
  const leg = byStrike.get(best);
  if (!leg) return null;
  const iv = leg.c > 0 && leg.p > 0 ? (leg.c + leg.p) / 2 : leg.c || leg.p;
  return iv > 0 ? { iv, under } : null;
}

async function fromTheta(ticker: string): Promise<Surface | null> {
  const root = CHAIN[ticker] ?? ticker;
  const got = await thetaGet(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`);
  if (got.error) return null;
  const today = nyIsoDate();
  const dates: string[] = [];
  for (const row of asRows(got.data)) {
    let exp = String(row.expiration ?? '').slice(0, 10);
    if (/^\d{8}$/.test(exp)) exp = `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && exp >= today) dates.push(exp);
  }
  dates.sort();
  const picked = [dates[0], dates.find(d => new Date(`${d}T12:00:00Z`).getUTCDay() === 5), dates[1]].filter((d): d is string => !!d);
  const unique = [...new Set(picked)].slice(0, 3);
  const rows: Row[] = [];
  for (const expiry of unique) {
    const atm = await atmIv(root, expiry);
    if (!atm) continue;
    const dte = Math.max(0, Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
    rows.push({ expiry, dte, iv: atm.iv, move: 0 });
  }
  if (!rows.length) return null;
  /* the IV's own one-standard-deviation move: no vendor straddle to fit a scale to */
  return { at: Date.now(), rows, dayIv: rows[0].iv, dayFrac: 0, k: 1, source: 'theta' };
}

/** One surface per name and source: a page that reads ThetaData never draws the one read on an Unusual Whales page. */
const keyOf = (ticker: string) => `${ticker.toUpperCase()}|${thetaUseHere() === 'all' ? 'theta' : 'uw'}`;

export function ensureCone(ticker: string): void {
  const name = ticker.toUpperCase();
  const key = keyOf(name);
  if (!name || inflight.has(key)) return;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return;
  inflight.add(key);
  void (async () => {
    try {
      /* ThetaData's at-the-money IV where it is the page's source (Terrain, Weigher, Compass); Unusual Whales' term
         structure on Pinpoint, Trace and the Dossier. Neither stands in for the other. */
      const surface = thetaUseHere() === 'all' ? await fromTheta(name) : await fromUw(name);
      if (surface) {
        cache.set(key, surface);
        emit();
      }
    } finally {
      inflight.delete(key);
    }
  })();
}

function ivFor(spot: number, move: number, minutes: number, fallbackIv: number): number {
  if (move > 0 && spot > 0 && minutes > 0) return move / (spot * Math.sqrt(minutes / YEAR_MINUTES));
  return fallbackIv > 0 ? fallbackIv : 0;
}

/** Dollars of one full session on the vendor's scale. */
function sessionDollars(spot: number, surface: Surface): number {
  if (surface.dayFrac > 0) return surface.dayFrac * spot;
  const iv = surface.dayIv || surface.rows[0]?.iv || 0;
  if (!(iv > 0)) return 0;
  return scaleK(surface, spot) * spot * iv * Math.sqrt(1 / 365);
}

function weekRow(rows: Row[], today: string): Row | null {
  const ahead = rows.filter(r => r.expiry > today);
  if (!ahead.length) return rows[0] ?? null;
  const friday = ahead.find(r => {
    const dt = new Date(`${r.expiry}T12:00:00Z`);
    return dt.getUTCDay() === 5 && r.dte <= 11;
  });
  return friday ?? ahead.find(r => r.dte >= 3 && r.dte <= 11) ?? ahead[Math.min(ahead.length - 1, 1)] ?? ahead[0];
}

/** The surface's at-the-money vols by expiry (calendar-year fractions, as the source quotes them) and where they came
    from: ThetaData's at-the-money IV on a ThetaData page, the vendor's term structure on an Unusual Whales page */
export function coneTerm(ticker: string): { rows: { expiry: string; iv: number }[]; source: 'theta' | 'uw'; at: number } | null {
  const surface = cache.get(keyOf(ticker));
  if (!surface) return null;
  const rows = surface.rows.filter(r => r.iv > 0).map(r => ({ expiry: r.expiry, iv: r.iv }));
  return rows.length ? { rows, source: surface.source === 'theta' ? 'theta' : 'uw', at: surface.at } : null;
}

/** The surface's revision: it moves when a name's vols land */
export const coneRev = (): number => rev;

/** Re-renders when a name's vols land. The cone is empty until then. */
export function useConeRev(): number {
  return useSyncExternalStore(subscribeCone, coneRev, coneRev);
}

export function coneFor(ticker: string, horizon: ConeHorizon, spot: number): ConeDraw | null {
  const surface = cache.get(keyOf(ticker));
  if (!surface || !(spot > 0)) return null;
  const today = nyIsoDate();
  const phase = nySessionPhase();
  if (horizon === 'session') {
    const todayRow = surface.rows.find(r => r.expiry === today);
    const left = minutesLeft();
    const full = sessionDollars(spot, surface);
    if (phase === 'open' && left > 0) {
      const remaining = todayRow && todayRow.move > 0 ? todayRow.move : full * Math.sqrt(left / RTH_MINUTES);
      const iv = ivFor(spot, remaining, left, todayRow?.iv || surface.dayIv);
      if (!(iv > 0)) return null;
      return { iv, forwardMin: left, fromOpen: false, source: `${surface.source} session` };
    }
    if (!(full > 0)) return null;
    const iv = ivFor(spot, full, RTH_MINUTES, surface.dayIv);
    if (!(iv > 0)) return null;
    return { iv, forwardMin: RTH_MINUTES, fromOpen: phase !== 'before', source: `${surface.source} 1-day` };
  }
  const row = horizon === 'week' ? weekRow(surface.rows, today) : surface.rows.find(r => r.expiry > today) ?? surface.rows[0];
  if (!row) return null;
  const sessions = sessionsOf(row.dte || 1);
  const minutes = sessions * RTH_MINUTES;
  const k = scaleK(surface, spot);
  const dollars = row.move > 0 ? row.move : row.iv > 0 ? k * spot * row.iv * Math.sqrt(Math.max(row.dte, 1) / 365) : 0;
  const iv = ivFor(spot, dollars, minutes, 0);
  if (!(iv > 0)) return null;
  return { iv, forwardMin: minutes, fromOpen: false, source: `${surface.source} ${row.expiry}` };
}

