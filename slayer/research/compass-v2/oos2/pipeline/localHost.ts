/*
  The engine's terminal, answered from the challenger's bulk cache (fetch.ts): the same requests the scan's late path
  makes (option/at_time/quote, the 30-minute option/history/quote window, the day's 1-minute bars, the expirations,
  the open interest), so the engine's own code builds every row, exactly as the replay does, with no request.
  One-second quotes (the ledger's stop/target minutes, Book C's sweep) are not in the bulk cache: they are read from
  the terminal once and kept under data/cache1s/ (only when CHAL_NET=1; otherwise answered "no data").
*/
import fs from 'node:fs';
import path from 'node:path';
import { DATA, readGz, barFile, get, sweepFile } from './fetch';
import { nyWallTime } from '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/core/nyTime';
import type { ThetaAnswer } from '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassHost';

export interface Q { strike: number; right: 'C' | 'P'; bid: number; ask: number; bs: number; as: number }
export interface Chain { root: string; expiry: string; byMinute: Map<string, Q[]>; byContract: Map<string, { t: number; key: string; bid: number; ask: number }[]>; keysOn: Map<string, string[]> }

const ymd = (s: string) => s.replace(/-/g, '');
const iso = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
export const ckey = (strike: number, right: string) => `${strike}|${right}`;
export const minuteMs = (key: string) => nyWallTime(Number(key.slice(0, 4)), Number(key.slice(5, 7)), Number(key.slice(8, 10)), Number(key.slice(11, 13)), Number(key.slice(14, 16)));

export function loadChain(day: string, root: string, expiry: string): Chain | null {
  const file = path.join(DATA, 'raw', ymd(day), `${root}_${ymd(expiry)}.csv.gz`);
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
    const file = barFile(sym, month);
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

function oiOf(day: string, root: string, expiry: string): { strike: number; right: string; oi: number }[] | null {
  const file = path.join(DATA, 'raw', ymd(day), `${root}_${ymd(expiry)}.oi.csv.gz`);
  if (!fs.existsSync(file)) return null;
  return readGz(file).split('\n').filter(Boolean).map(l => {
    const [k, r, o] = l.split(',');
    return { strike: Number(k), right: r, oi: Number(o) };
  });
}

const RIGHT_WORD = { C: 'CALL', P: 'PUT' } as const;
const ok = (data: unknown): ThetaAnswer => ({ status: 200, data, error: null });
const none: ThetaAnswer = { status: 472, data: null, error: 'no_data' };

/** A host for one session day. `chains` is filled lazily from the cache. */
export function localTheta(day: string, opts: { net?: boolean; log?: (p: string) => void } = {}) {
  const chains = new Map<string, Chain | null>();
  const chainOf = (root: string, expiry: string) => {
    const k = `${root}|${ymd(expiry)}`;
    if (!chains.has(k)) chains.set(k, loadChain(day, root, expiry));
    return chains.get(k) ?? null;
  };
  const unknown: string[] = [];
  const theta = async (p: string): Promise<ThetaAnswer> => {
    const [route, qs] = p.split('?');
    const q = new URLSearchParams(qs ?? '');
    const sym = (q.get('symbol') ?? '').toUpperCase();
    if (route === '/option/list/expirations') {
      const file = path.join(DATA, 'meta', `exp_${sym}.json`);
      if (!fs.existsSync(file)) return none;
      /* the expirations listed around the session (the scan only reads the nearest 1-7 sessions out): the whole list
         to 2029 made every weekly mark of a 2020 session walk years of weekdays (weekdayDte), and it held
         expirations not yet listed then */
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
      const rows = oiOf(day, sym, q.get('expiration') ?? '');
      if (!rows || !rows.length) return none;
      return ok(rows.map(r => ({ symbol: sym, strike: r.strike, right: r.right === 'C' ? 'CALL' : 'PUT', open_interest: r.oi })));
    }
    if (route === '/option/at_time/quote') {
      const secs = (q.get('time_of_day') ?? '').slice(6, 8);
      if (secs && secs !== '00') {
        /* Book C's 15:20:15 board, kept by the fetcher (fetch.ts sweepBoard), else the terminal */
        const f = sweepFile(day, sym);
        if (fs.existsSync(f)) {
          const doc = JSON.parse(fs.readFileSync(f, 'utf8')) as { status: number; body: string };
          return answer(doc.status, doc.body);
        }
        return opts.net ? cachedNet(p) : none;
      }
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
      if (interval === '1s') {
        if (!opts.net) return none;
        return cachedNet(p);
      }
      const c = chainOf(sym, q.get('expiration') ?? '');
      if (!c) return none;
      const step = interval === '5m' ? 5 : 1;
      const from = (q.get('start_time') ?? '00:00:00').slice(0, 5);
      const to = (q.get('end_time') ?? '23:59:00').slice(0, 5);
      const right = (q.get('right') ?? '').toLowerCase();
      const out = new Map<string, { contract: Record<string, unknown>; data: Record<string, unknown>[] }>();
      /* every date from start_date to end_date (an overnight path runs past midnight), the times on each */
      const last = iso(q.get('end_date') ?? d);
      const dates = [...c.keysOn.keys()].filter(x => x >= d && x <= (last >= d ? last : d)).sort();
      for (const k of dates.flatMap(x => c.keysOn.get(x) ?? [])) {
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
    opts.log?.(p);
    return none;
  };
  return { theta, chainOf, unknown };
}

/** Terminal reads that did not answer (down, restarting): a day built with one is not written (built.ts). */
export let netFailures = 0;

/** One-second quotes for one contract window, from the terminal once, then from disk. */
async function cachedNet(p: string): Promise<ThetaAnswer> {
  const key = p.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 200);
  const file = path.join(DATA, 'cache1s', `${key}.json`);
  if (fs.existsSync(file)) {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { status: number; body: string };
    return answer(doc.status, doc.body);
  }
  const got = await get(p.replace('format=json', 'format=json'));
  if (got.status === 200 || got.status === 472) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(got));
  } else netFailures += 1;
  return answer(got.status, got.body);
}

function answer(status: number, body: string): ThetaAnswer {
  if (status === 472 || !body) return none;
  if (status !== 200) return { status, data: null, error: `unavailable ${status}` };
  try {
    const doc = JSON.parse(body) as { response?: unknown };
    return ok(doc.response ?? doc);
  } catch {
    return { status: 500, data: null, error: 'parse' };
  }
}
