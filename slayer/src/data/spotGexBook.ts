/*
  The local spot-gex book: open interest, gamma and session volume off Theta's chain for every listed expiration,
  checked against Unusual Whales' total. Never read from Pinpoint or the Dossier, which are Unusual Whales only.
*/

import { uwCall } from './whales';
import { thetaCall, thetaUseHere } from './theta';
import { nyIsoDate } from '../core/nyTime';
import { spotGex, usesAtmPrice, type SpotGex, type SpotGexLeg, type OptionSide } from './spotGex';

const CHAIN: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP', VIX: 'VIXW' };
/** The weekly root is the same index. One book, one name. */
const SAME: Record<string, string> = { SPXW: 'SPX', RUTW: 'RUT', NDXP: 'NDX', VIXW: 'VIX' };

/** The page in view reads no ThetaData option data — greeks, open interest, chains (Trace, the Dossier, Pinpoint: data/theta.ts
    thetaUseHere is the one rule) — so exposure, levels and vols come from Unusual Whales alone. */
export function uwOnlyDesk(): boolean {
  return thetaUseHere() !== 'all';
}

export function sameName(ticker: string): string {
  const name = ticker.trim().toUpperCase();
  return SAME[name] ?? name;
}
const TTL = 15 * 60 * 1000;

interface SpotGexBook extends SpotGex {
  ticker: string;
  root: string;
  spot: number;
  at: number;
  uw: number | null;
  absDiff: number | null;
}

const cache = new Map<string, SpotGexBook>();
const wait = new Map<string, Promise<SpotGexBook | null>>();
const queue: string[] = [];
let pumping = false;

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object') : [];
}

/** Theta prints `data` as a one-row list on a chain snapshot and as an object on a single contract. */
function firstRecord(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    const row = data[0];
    return row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

function sideOf(right: unknown): OptionSide | null {
  const s = String(right ?? '').toLowerCase();
  if (s.startsWith('c')) return 'C';
  if (s.startsWith('p')) return 'P';
  return null;
}

function ymd(iso: string): string {
  return iso.replace(/\D/g, '').slice(0, 8);
}

interface RawLeg {
  oi: number | null;
  gamma: number | null;
  volume: number | null;
  under: number;
}

async function oneExpiry(root: string, expiration: string, into: Map<string, RawLeg>): Promise<void> {
  const q = `symbol=${encodeURIComponent(root)}&expiration=${ymd(expiration)}&format=json`;
  const [oi, greeks, ohlc] = await Promise.all([
    thetaCall(`/option/snapshot/open_interest?${q}`),
    thetaCall(`/option/snapshot/greeks/second_order?${q}`),
    thetaCall(`/option/snapshot/ohlc?${q}`),
  ]);
  const touch = (contract: Record<string, unknown>): RawLeg | null => {
    const strike = num(contract.strike);
    const right = sideOf(contract.right);
    if (strike == null || !(strike > 0) || !right) return null;
    const key = `${strike}|${right}`;
    const row = into.get(key) ?? { oi: null, gamma: null, volume: null, under: 0 };
    into.set(key, row);
    return row;
  };
  for (const item of rowsOf(oi.data)) {
    const contract = item.contract as Record<string, unknown> | undefined;
    const data = firstRecord(item.data);
    if (!contract || !data) continue;
    const row = touch(contract);
    if (!row) continue;
    const v = num(data.open_interest);
    if (v != null) row.oi = v;
  }
  for (const item of rowsOf(greeks.data)) {
    const contract = item.contract as Record<string, unknown> | undefined;
    const data = firstRecord(item.data);
    if (!contract || !data) continue;
    const row = touch(contract);
    if (!row) continue;
    const g = num(data.gamma);
    if (g != null) row.gamma = g;
    const under = num(data.underlying_price);
    if (under != null && under > 0) row.under = under;
  }
  for (const item of rowsOf(ohlc.data)) {
    const contract = item.contract as Record<string, unknown> | undefined;
    const data = firstRecord(item.data);
    if (!contract || !data) continue;
    const row = touch(contract);
    if (!row) continue;
    const v = num(data.volume);
    if (v != null) row.volume = v;
  }
}

function scanHolds(): boolean {
  return (globalThis as { __slayerScan?: boolean }).__slayerScan === true;
}

function plusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function expirations(root: string): Promise<string[]> {
  const today = nyIsoDate();
  const cap = plusDays(today, 8);
  const got = await thetaCall(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`);
  const out: string[] = [];
  for (const row of rowsOf(got.data)) {
    const exp = String(row.expiration ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(exp) && exp >= today && exp <= cap) out.push(exp);
  }
  return out;
}

async function uwTotal(ticker: string): Promise<number | null> {
  const got = await uwCall(`/stock/${encodeURIComponent(ticker)}/spot-exposures`);
  if (got.error || !Array.isArray(got.data)) return null;
  let best = -Infinity;
  let value: number | null = null;
  for (const row of got.data) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const v = num(o.gamma_per_one_percent_move_oi);
    if (v == null) continue;
    const ms = Date.parse(String(o.start_time ?? o.time ?? ''));
    const at = Number.isFinite(ms) ? ms : 0;
    if (at >= best) {
      best = at;
      value = v;
    }
  }
  return value;
}

async function pull(ticker: string): Promise<SpotGexBook | null> {
  if (uwOnlyDesk()) return null;
  const name = sameName(ticker);
  const root = CHAIN[name] ?? name;
  const dates = await expirations(root);
  if (!dates.length) return null;
  const bag = new Map<string, RawLeg>();
  for (let i = 0; i < dates.length; i += 2) {
    await Promise.all(dates.slice(i, i + 2).map(exp => oneExpiry(root, exp, bag)));
  }
  let spot = 0;
  const legs: SpotGexLeg[] = [];
  for (const [key, row] of bag) {
    const [strikeWord, right] = key.split('|');
    if (row.under > 0) spot = row.under;
    legs.push({
      strike: Number(strikeWord),
      right: right === 'P' ? 'P' : 'C',
      oi: row.oi,
      gamma: row.gamma,
      volume: row.volume,
    });
  }
  if (!(spot > 0) || !legs.length) return null;
  const book = spotGex(usesAtmPrice(name) || usesAtmPrice(root) ? name : name, spot, legs);
  let uw: number | null = null;
  try {
    uw = await uwTotal(name === 'SPXW' ? 'SPX' : name === 'RUTW' ? 'RUT' : name);
  } catch {
    uw = null;
  }
  const absDiff = uw != null && Number.isFinite(book.netOi) ? Math.abs(book.netOi - uw) : null;
  if (uw != null) {
    console.info(
      `[spot-gex] ${name} local ${book.netOi.toFixed(0)} bn ${Number.isFinite(book.netGexBn) ? book.netGexBn.toFixed(4) : 'nan'} uw ${uw.toFixed(0)} abs ${(absDiff ?? 0).toFixed(0)}`,
    );
  }
  return { ...book, ticker: name, root, spot, at: Date.now(), uw, absDiff };
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (queue.length) {
      if (scanHolds()) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      const ticker = queue.shift();
      if (!ticker || wait.has(ticker)) continue;
      const job = pull(ticker)
        .then(book => {
          if (book && book.used > 0) cache.set(ticker, book);
          return book;
        })
        .catch(() => null)
        .finally(() => {
          wait.delete(ticker);
        });
      wait.set(ticker, job);
      await job;
    }
  } finally {
    pumping = false;
    if (queue.length) void pump();
  }
}

/** Queue a name. A fresh book is kept. Does not block the scan. */
export function wantSpotGex(ticker: string): void {
  const name = sameName(ticker);
  if (!name) return;
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL) return;
  if (wait.has(name) || queue.includes(name)) return;
  queue.push(name);
  void pump();
}

/** The book if it is already in hand, else the chain is read now. SPXW is SPX. */
export function awaitSpotGex(ticker: string): Promise<SpotGexBook | null> {
  const name = sameName(ticker);
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL) return Promise.resolve(hit);
  const pending = wait.get(name);
  if (pending) return pending;
  const job = pull(name)
    .then(book => {
      if (book && book.used > 0) cache.set(name, book);
      return book;
    })
    .catch(() => null)
    .finally(() => {
      wait.delete(name);
    });
  wait.set(name, job);
  return job;
}

