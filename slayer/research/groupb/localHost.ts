/*
  Group B research host: the engine's terminal, answered from the challenger research's bulk cache (read-only, its
  data/ folder: GB_SRC) the same way research/challenger/localHost.ts did, plus one change — the open interest is the
  count a live read had at the mark (B "OI look-ahead"): from 07:00 ET the session day's count, before it the last
  count published the day before. The cache holds the session day's count only, so the earlier counts are read once
  from the terminal (GB_NET=1, at most two requests in flight) and kept under GB_DATA/oi/.
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { nyWallTime } from '../../src/core/nyTime';
import { addDays, nyWall, sessionDayAtOrBefore } from '../../src/core/session';
import type { ThetaAnswer } from '../../src/data/compassHost';

export const SRC = process.env.GB_SRC || '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/research/challenger/data';
export const DATA = process.env.GB_DATA || '/tmp/gb-data';
const BASE = process.env.THETA_BASE || 'http://127.0.0.1:25503/v3';

export const readGz = (file: string): string => zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
const ymd = (s: string) => s.replace(/-/g, '');
const iso = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
export const ckey = (strike: number, right: string) => `${strike}|${right}`;
const minuteMs = (key: string) => nyWallTime(Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10)), Number(key.slice(11, 13)), Number(key.slice(14, 16)));

let inFlight = 0;
const waiters: (() => void)[] = [];
export let netReads = 0;
export let netFailures = 0;
async function get(p: string): Promise<{ status: number; body: string }> {
  while (inFlight >= 2) await new Promise<void>(res => waiters.push(res));
  inFlight += 1;
  try {
    netReads += 1;
    const res = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(60_000) });
    return { status: res.status, body: await res.text() };
  } catch {
    return { status: 0, body: '' };
  } finally {
    inFlight -= 1;
    waiters.shift()?.();
  }
}

export interface Q { strike: number; right: 'C' | 'P'; bid: number; ask: number; bs: number; as: number }
export interface Chain { root: string; expiry: string; byMinute: Map<string, Q[]>; byContract: Map<string, { t: number; key: string; bid: number; ask: number }[]>; keysOn: Map<string, string[]> }

export function loadChain(day: string, root: string, expiry: string): Chain | null {
  const file = path.join(SRC, 'raw', ymd(day), `${root}_${ymd(expiry)}.csv.gz`);
  if (!fs.existsSync(file)) return null;
  const byMinute = new Map<string, Q[]>();
  const byContract = new Map<string, { t: number; key: string; bid: number; ask: number }[]>();
  const ms = new Map<string, number>();
  for (const line of readGz(file).split('\n')) {
    if (!line) continue;
    const [k, strike, right, bid, ask, bs, as] = line.split(',');
    const q: Q = { strike: Number(strike), right: right === 'C' ? 'C' : 'P', bid: Number(bid), ask: Number(ask), bs: Number(bs), as: Number(as) };
    let l = byMinute.get(k);
    if (!l) byMinute.set(k, (l = []));
    l.push(q);
    let t = ms.get(k);
    if (t == null) ms.set(k, (t = minuteMs(k)));
    const ck = ckey(q.strike, q.right);
    let p = byContract.get(ck);
    if (!p) byContract.set(ck, (p = []));
    p.push({ t, key: k, bid: q.bid, ask: q.ask });
  }
  for (const p of byContract.values()) p.sort((a, b) => a.t - b.t);
  const keysOn = new Map<string, string[]>();
  for (const k of byMinute.keys()) {
    const d = k.slice(0, 10);
    let l = keysOn.get(d);
    if (!l) keysOn.set(d, (l = []));
    l.push(k);
  }
  for (const l of keysOn.values()) l.sort();
  return { root, expiry: iso(expiry), byMinute, byContract, keysOn };
}

export interface BarRow { key: string; o: number; h: number; l: number; c: number; v: number }
const barCache = new Map<string, Map<string, BarRow[]>>();
export function barsOn(sym: string, day: string): BarRow[] {
  const month = iso(day).slice(0, 7);
  const ck = `${sym}|${month}`;
  let byDay = barCache.get(ck);
  if (!byDay) {
    byDay = new Map();
    const file = path.join(SRC, 'bars', sym, `${month}.csv.gz`);
    if (fs.existsSync(file)) {
      for (const line of readGz(file).split('\n')) {
        if (!line) continue;
        const [k, o, h, l, c, v] = line.split(',');
        const d = k.slice(0, 10);
        let list = byDay.get(d);
        if (!list) byDay.set(d, (list = []));
        list.push({ key: k, o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: Number(v) });
      }
    }
    barCache.set(ck, byDay);
  }
  return byDay.get(iso(day)) ?? [];
}

type OiRow = { strike: number; right: string; oi: number };
const parseOi = (text: string): OiRow[] => text.split('\n').filter(Boolean).map(l => {
  const [k, r, o] = l.split(',');
  return { strike: Number(k), right: r, oi: Number(o) };
});

/** The count a live read had at `markMs` (compassModel pinOf's countDay): the session day's, or before 07:00 ET the
    last session's at or before the day before. */
export function countDayAt(markMs: number): string {
  const w = nyWall(markMs);
  const d = w.min < 7 * 60 ? addDays(w.iso, -1) : w.iso;
  return sessionDayAtOrBefore(d);
}

const oiMemo = new Map<string, OiRow[] | null>();
async function oiOf(countDay: string, root: string, expiry: string, net: boolean): Promise<OiRow[] | null> {
  const key = `${countDay}|${root}|${ymd(expiry)}`;
  if (oiMemo.has(key)) return oiMemo.get(key) ?? null;
  const own = path.join(SRC, 'raw', ymd(countDay), `${root}_${ymd(expiry)}.oi.csv.gz`);
  const mine = path.join(DATA, 'oi', ymd(countDay), `${root}_${ymd(expiry)}.csv.gz`);
  let rows: OiRow[] | null = null;
  if (fs.existsSync(own)) rows = parseOi(readGz(own));
  else if (fs.existsSync(mine)) rows = parseOi(readGz(mine));
  else if (net) {
    const got = await get(`/option/history/open_interest?symbol=${root}&expiration=${ymd(expiry)}&date=${ymd(countDay)}&format=csv`);
    if (got.status === 200 || got.status === 472) {
      const lines = got.status === 200 ? got.body.split('\n') : [];
      const head = lines[0]?.split(',') ?? [];
      const [iK, iR, iO] = ['strike', 'right', 'open_interest'].map(k => head.indexOf(k));
      const out = iK < 0 ? [] : lines.slice(1).map(l => l.split(',')).filter(c => c.length >= head.length).map(c => `${Number(c[iK])},${c[iR].replace(/"/g, '')[0]},${Number(c[iO])}`);
      fs.mkdirSync(path.dirname(mine), { recursive: true });
      fs.writeFileSync(mine + '.tmp', zlib.gzipSync(out.join('\n')));
      fs.renameSync(mine + '.tmp', mine);
      rows = parseOi(out.join('\n'));
    } else netFailures += 1;
  } else netFailures += 1;
  oiMemo.set(key, rows);
  return rows;
}

/** The first index whose key is at or after `k` (keys sorted). */
function lowerBound(keys: readonly string[], k: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < k) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const RIGHT_WORD = { C: 'CALL', P: 'PUT' } as const;
const ok = (data: unknown): ThetaAnswer => ({ status: 200, data, error: null });
const none: ThetaAnswer = { status: 472, data: null, error: 'no_data' };

/** A host for one session day. `setMark` names the mark being scored (the open interest it reads is that mark's). */
export function localTheta(day: string, opts: { net?: boolean } = {}) {
  const chains = new Map<string, Chain | null>();
  const chainOf = (root: string, expiry: string) => {
    const k = `${root}|${ymd(expiry)}`;
    if (!chains.has(k)) chains.set(k, loadChain(day, root, expiry));
    return chains.get(k) ?? null;
  };
  let markAt = Date.parse(`${iso(day)}T16:00:00Z`);
  const unknown: string[] = [];
  const theta = async (p: string): Promise<ThetaAnswer> => {
    const [route, qs] = p.split('?');
    const q = new URLSearchParams(qs ?? '');
    const sym = (q.get('symbol') ?? '').toUpperCase();
    if (route === '/option/list/expirations') {
      const file = path.join(SRC, 'meta', `exp_${sym}.json`);
      if (!fs.existsSync(file)) return none;
      const lo = new Date(Date.parse(`${iso(day)}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
      const hi = new Date(Date.parse(`${iso(day)}T12:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
      return ok((JSON.parse(fs.readFileSync(file, 'utf8')) as string[]).filter(e => e >= lo && e <= hi).map(e => ({ symbol: sym, expiration: e })));
    }
    if (route === '/stock/history/ohlc' || route === '/index/history/ohlc') {
      const d = q.get('start_date') ?? q.get('date') ?? '';
      const rows = barsOn(sym, d);
      if (!rows.length) return none;
      return ok(rows.map(b => ({ timestamp: `${b.key.slice(0, 10)}T${b.key.slice(11, 16)}:00.000`, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v })));
    }
    if (route === '/option/snapshot/open_interest') {
      const rows = await oiOf(countDayAt(markAt), sym, q.get('expiration') ?? '', !!opts.net);
      if (!rows || !rows.length) return none;
      return ok(rows.map(r => ({ symbol: sym, strike: r.strike, right: r.right === 'C' ? 'CALL' : 'PUT', open_interest: r.oi })));
    }
    if (route === '/option/at_time/quote') {
      const secs = (q.get('time_of_day') ?? '').slice(6, 8);
      if (secs && secs !== '00') return none;
      const c = chainOf(sym, q.get('expiration') ?? '');
      if (!c) return none;
      const d = iso(q.get('start_date') ?? '');
      const tod = (q.get('time_of_day') ?? '').slice(0, 5);
      const list = c.byMinute.get(`${d} ${tod}`);
      if (!list?.length) return none;
      const stamp = `${d}T${tod}:00.000`;
      return ok(list.map(x => ({ contract: { symbol: sym, strike: x.strike, right: RIGHT_WORD[x.right], expiration: c.expiry }, data: [{ timestamp: stamp, bid: x.bid, ask: x.ask, bid_size: x.bs, ask_size: x.as }] })));
    }
    if (route === '/option/history/quote') {
      const interval = q.get('interval') ?? '1m';
      const strike = q.get('strike');
      const d = iso(q.get('start_date') ?? q.get('date') ?? '');
      if (interval === '1s') return none;
      const c = chainOf(sym, q.get('expiration') ?? '');
      if (!c) return none;
      const step = interval === '5m' ? 5 : 1;
      const from = (q.get('start_time') ?? '00:00:00').slice(0, 5);
      const to = (q.get('end_time') ?? '23:59:00').slice(0, 5);
      const right = (q.get('right') ?? '').toLowerCase();
      const out = new Map<string, { contract: Record<string, unknown>; data: Record<string, unknown>[] }>();
      const last = iso(q.get('end_date') ?? d);
      const dates = [...c.keysOn.keys()].filter(x => x >= d && x <= (last >= d ? last : d)).sort();
      /* each date's minute keys are sorted: only the ones from `from` to `to` are walked (the same answer as a scan of
         every key, without reading the whole day for a 30-minute window) */
      const inWindow = (x: string) => {
        const keys = c.keysOn.get(x) ?? [];
        const lo = lowerBound(keys, `${x} ${from}`);
        const hi = lowerBound(keys, `${x} ${to}~`);
        return keys.slice(lo, hi);
      };
      for (const k of dates.flatMap(inWindow)) {
        const hm = k.slice(11, 16);
        const kd = k.slice(0, 10);
        const list = c.byMinute.get(k) ?? [];
        if (hm < from || hm > to) continue;
        const mm = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
        if (mm % step) continue;
        for (const x of list) {
          if (strike != null && strike !== '*' && Math.abs(Number(strike) - x.strike) > 1e-6) continue;
          if (right && right !== 'both' && RIGHT_WORD[x.right].toLowerCase() !== right) continue;
          const id = ckey(x.strike, x.right);
          let row = out.get(id);
          if (!row) out.set(id, (row = { contract: { symbol: sym, strike: x.strike, right: RIGHT_WORD[x.right], expiration: c.expiry }, data: [] }));
          row.data.push({ timestamp: `${kd}T${hm}:00.000`, bid: x.bid, ask: x.ask, bid_size: x.bs, ask_size: x.as });
        }
      }
      if (!out.size) return none;
      for (const r of out.values()) r.data.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
      return ok([...out.values()]);
    }
    if (/\/snapshot\//.test(route)) return { status: 404, data: null, error: 'a replay reads no live snapshot' };
    unknown.push(p);
    return none;
  };
  return { theta, chainOf, unknown, setMark: (ms: number) => { markAt = ms; } };
}
