/* The vol surface the expected-move cone is drawn from (data/terrainCone.ts forwardCone, one σ = S·σ·√T on the trading
   clock). On a ThetaData page: each expiry's at-the-money IV off the terminal. On an Unusual Whales page: the vendor's
   term structure. Both vendors print vols as fractions (ThetaData implied_vol 0.1834; UW volatility "0.127"), so a vol is
   read as it comes — a 3.2 wing is 320%, not 3.2%. No guessed vol. */

import { useSyncExternalStore } from 'react';
import { nyIsoDate } from '../core/nyTime';
import { thetaGet } from './thetaFeed';
import { thetaUseHere } from './theta';
import { uwCall } from './whales';

export interface Row {
  expiry: string;
  dte: number;
  iv: number;
  move: number;
}

interface Surface {
  at: number;
  rows: Row[];
  source: string;
}

const cache = new Map<string, Surface>();
const inflight = new Set<string>();
/** Names whose last read came back empty — the chart says "no vol", not "waiting", for them */
const missed = new Set<string>();
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

/** A vol as both vendors print it: an annualised fraction, read as it comes (3.2 = 320%). Nothing at or under zero. */
export function vendorVol(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

async function fromUw(ticker: string): Promise<Surface | null> {
  const symbol = UW[ticker] ?? ticker;
  const term = await uwCall(`/stock/${encodeURIComponent(symbol)}/volatility/term-structure`);
  if (term.error) return null;
  const today = nyIsoDate();
  const rows: Row[] = [];
  for (const raw of asRows(term.data)) {
    const expiry = String(raw.expiry ?? raw.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || expiry < today) continue;
    const iv = vendorVol(num(raw.volatility));
    const move = num(raw.implied_move);
    const dte = num(raw.dte) || Math.max(0, Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));
    if (!(iv > 0) && !(move > 0)) continue;
    rows.push({ expiry, dte, iv, move });
  }
  rows.sort((a, b) => a.expiry.localeCompare(b.expiry));
  if (!rows.length) return null;
  return { at: Date.now(), rows, source: 'uw' };
}

async function atmIv(root: string, expiration: string): Promise<{ iv: number; under: number } | null> {
  const got = await thetaGet(`/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(root)}&expiration=${expiration.replace(/-/g, '')}&strike_range=1&format=json`);
  if (got.error) return null;
  return atmOf(asRows(got.data));
}

/** The at-the-money IV of one expiry's snapshot rows: the strike nearest the underlying, its call and put IV averaged */
function atmOf(rows: readonly Record<string, unknown>[]): { iv: number; under: number } | null {
  let under = 0;
  const byStrike = new Map<number, { c: number; p: number }>();
  for (const item of rows) {
    /* v3 answers flat rows; a grouped answer nests the contract and its quote */
    const contract = (item.contract as Record<string, unknown> | undefined) ?? item;
    const data = 'data' in item ? firstRecord(item.data) : item;
    if (!data) continue;
    const strike = num(contract.strike);
    const iv = vendorVol(num(data.implied_vol));
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

const isoOfExp = (raw: unknown): string => {
  const exp = String(raw ?? '').slice(0, 10);
  return /^\d{8}$/.test(exp) ? `${exp.slice(0, 4)}-${exp.slice(4, 6)}-${exp.slice(6, 8)}` : exp;
};
/** The cone's three expiries out of the listed ones (sorted, today on): the nearest, the first Friday, the next */
export function conePicks(dates: readonly string[]): string[] {
  const picked = [dates[0], dates.find(d => new Date(`${d}T12:00:00Z`).getUTCDay() === 5), dates[1]].filter((d): d is string => !!d);
  return [...new Set(picked)].slice(0, 3);
}
const dteOf = (expiry: string, today: string) => Math.max(0, Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000));

/** The cone's expiries reach this far: two weeks covers the nearest, the first Friday (a holiday Friday's weekly is the
    Thursday, so the next listed Friday is still under two weeks out) and the one after the nearest */
export const CONE_MAX_DTE = 14;

/** ONE request for every expiry (`expiration=*`, the strike either side of the money): the same rows the per-expiry
    reads return (scripts/cone-feed-proof.ts), so the cone costs 1 request instead of the list and 3 snapshots. Null when
    it answers nothing usable (a name whose nearest expiry is further out): the per-expiry reads take over. */
export async function coneRowsAll(root: string, today = nyIsoDate()): Promise<Row[] | null> {
  const got = await thetaGet(`/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(root)}&expiration=*&max_dte=${CONE_MAX_DTE}&strike_range=1&format=json`);
  if (got.error) return null;
  const byExp = new Map<string, Record<string, unknown>[]>();
  for (const item of asRows(got.data)) {
    const contract = (item.contract as Record<string, unknown> | undefined) ?? item;
    const exp = isoOfExp(contract.expiration);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || exp < today) continue;
    const list = byExp.get(exp) ?? [];
    list.push(item);
    byExp.set(exp, list);
  }
  const rows: Row[] = [];
  for (const expiry of conePicks([...byExp.keys()].sort())) {
    const atm = atmOf(byExp.get(expiry) ?? []);
    if (atm) rows.push({ expiry, dte: dteOf(expiry, today), iv: atm.iv, move: 0 });
  }
  return rows.length ? rows : null;
}

/** The per-expiry way, kept as the fallback: the listed expiries, then one snapshot for each of the three the cone draws */
export async function coneRowsPerExpiry(root: string, today = nyIsoDate()): Promise<Row[] | null> {
  const got = await thetaGet(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`);
  if (got.error) return null;
  const dates: string[] = [];
  for (const row of asRows(got.data)) {
    const exp = isoOfExp(row.expiration);
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && exp >= today) dates.push(exp);
  }
  dates.sort();
  const rows: Row[] = [];
  for (const expiry of conePicks(dates)) {
    const atm = await atmIv(root, expiry);
    if (!atm) continue;
    rows.push({ expiry, dte: dteOf(expiry, today), iv: atm.iv, move: 0 });
  }
  return rows.length ? rows : null;
}

async function fromTheta(ticker: string): Promise<Surface | null> {
  const root = CHAIN[ticker] ?? ticker;
  const rows = (await coneRowsAll(root)) ?? (await coneRowsPerExpiry(root));
  return rows ? { at: Date.now(), rows, source: 'theta' } : null;
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
        missed.delete(key);
        emit();
      } else if (!missed.has(key)) {
        missed.add(key);
        emit();
      }
    } catch {
      if (!missed.has(key)) {
        missed.add(key);
        emit();
      }
    } finally {
      inflight.delete(key);
    }
  })();
}

/** The surface's at-the-money vols by expiry (calendar-year fractions, as the source quotes them) and where they came
    from: ThetaData's at-the-money IV on a ThetaData page, the vendor's term structure on an Unusual Whales page */
export function coneTerm(ticker: string): { rows: { expiry: string; iv: number }[]; source: 'theta' | 'uw'; at: number } | null {
  const surface = cache.get(keyOf(ticker));
  if (!surface) return null;
  const rows = surface.rows.filter(r => r.iv > 0).map(r => ({ expiry: r.expiry, iv: r.iv }));
  return rows.length ? { rows, source: surface.source === 'theta' ? 'theta' : 'uw', at: surface.at } : null;
}

/** The last read of this name's vols came back with none (and none is cached from before) */
export function coneMissed(ticker: string): boolean {
  const key = keyOf(ticker);
  return !cache.has(key) && missed.has(key);
}

/** The surface's revision: it moves when a name's vols land */
const coneRev = (): number => rev;

/** Re-renders when a name's vols land. The cone is empty until then. */
export function useConeRev(): number {
  return useSyncExternalStore(subscribeCone, coneRev, coneRev);
}
