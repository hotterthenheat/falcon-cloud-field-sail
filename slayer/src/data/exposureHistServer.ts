/// <reference types="node" />
/*
  The reconstructed past day (data/book/exposureHist.ts), served beside the recorder: GET /api/exposure/hist?ticker=SPY
  &day=2026-10-30&cut=book (or cut=YYYY-MM-DD, one expiry). A day the recorder holds is served as recorded; a finished
  day it does not hold is rebuilt from what the terminal keeps for it, and labelled so.

  - The inputs (the day's opening open interest, a 30-minute grid of mid vols in the strike window, the cleaned
    one-minute bars) are read from the terminal once a name and day, through the shared hub (server/thetaProxy.mjs
    thetaDirect), at most HIST_READS history reads at once — the research pipeline and the charts share its slots —
    and kept under <dir>/YYYY-MM-DD/<TICKER>.json.gz (.cache/exposure-hist, git-ignored).
  - Today is never rebuilt (it is live: the recorder and the viewer's own reads), nor a day that has not finished.
  - The rebuilt series, per cut, are kept in memory (a few) as the gzipped answer.

  This module never runs in a browser bundle.
*/

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { nyIsoDate, nyWallTime } from '../core/nyTime';
import { isTradingDay } from '../core/calendar';
import { HIST_FORMAT, IV_STEP_MIN, IV_STRIKES, lastVols, nyStampMs, readBars, readIv, readOi, rebuildDay, type HistInputs } from './book/exposureHist';
import { ALL, type KeptSeries } from './book/exposureSegs';

/** History reads in flight at once, across every name */
export const HIST_READS = 2;
/** Rebuilt answers kept in memory */
const KEEP_ANSWERS = 12;

export interface ThetaAnswer {
  status: number;
  body: string;
}

export interface HistOptions {
  /** the folder (.cache/exposure-hist) */
  dir: string;
  /** one terminal answer through the hub (server/thetaProxy.mjs thetaDirect); the path is the v3 path after /v3 */
  theta: (path: string) => Promise<ThetaAnswer>;
  /** the recorder's day, when it holds one (it takes priority) */
  recorded?: (ticker: string, day: string) => { series: KeptSeries[] } | null;
  now?: () => number;
  log?: (line: string) => void;
}

export interface HistAnswer {
  format: typeof HIST_FORMAT;
  ticker: string;
  day: string;
  cut: string;
  /** 'recorded': the recorder's own readings; 'reconstructed': rebuilt from the day's open interest and quotes */
  source: 'recorded' | 'reconstructed';
  series: KeptSeries[];
}

export interface HistService {
  /** The day's series for a cut: { status, gzipped JSON } — 404 when there is nothing to serve */
  answer: (ticker: string, day: string, cut: string) => Promise<{ status: number; gz: Buffer }>;
  /** The inputs for a name and day (read once, then from disk), null when the terminal has none */
  inputs: (ticker: string, day: string) => Promise<HistInputs | null>;
}

const ymd = (day: string) => day.replace(/-/g, '');
const toMs = (stamp: string) => nyStampMs(stamp, nyWallTime);

export function createExposureHist(o: HistOptions): HistService {
  const now = o.now ?? Date.now;
  const log = o.log ?? (() => {});
  /* the read gate: HIST_READS at once, the rest wait their turn */
  let busy = 0;
  const queue: (() => void)[] = [];
  const read = async (p: string): Promise<unknown> => {
    if (busy >= HIST_READS) await new Promise<void>(r => queue.push(r));
    else busy += 1;
    try {
      const got = await o.theta(p);
      if (got.status === 472) return { response: [] };
      if (got.status !== 200) throw new Error(`terminal answered ${got.status}`);
      return JSON.parse(got.body);
    } finally {
      const next = queue.shift();
      if (next) next();
      else busy -= 1;
    }
  };

  const fileOf = (t: string, day: string) => path.join(o.dir, day, `${t}.json.gz`);
  const pending = new Map<string, Promise<HistInputs | null>>();
  const readDisk = (t: string, day: string): HistInputs | null => {
    try {
      const inp = JSON.parse(gunzipSync(fs.readFileSync(fileOf(t, day))).toString('utf8')) as HistInputs;
      return inp.format === HIST_FORMAT ? inp : null;
    } catch {
      return null;
    }
  };

  const inputs = (t: string, day: string): Promise<HistInputs | null> => {
    const key = `${t}|${day}`;
    const hit = pending.get(key);
    if (hit) return hit;
    const job = (async () => {
      const kept = readDisk(t, day);
      if (kept) return kept;
      const d = ymd(day);
      const sym = encodeURIComponent(t);
      const started = Date.now();
      const [oiJson, ivJson, barsJson] = await Promise.all([
        read(`/option/history/open_interest?symbol=${sym}&expiration=*&date=${d}&format=json`),
        read(`/option/history/greeks/implied_volatility?symbol=${sym}&expiration=*&date=${d}&interval=${IV_STEP_MIN}m&strike_range=${IV_STRIKES}&format=json`),
        read(`/stock/history/ohlc?symbol=${sym}&start_date=${d}&end_date=${d}&interval=1m&start_time=04:00:00&end_time=19:59:59.999&format=json`),
      ]);
      const inp: HistInputs = { format: HIST_FORMAT, ticker: t, day, oi: readOi(oiJson), iv: readIv(ivJson, toMs), bars: readBars(barsJson, toMs) };
      if (!inp.oi.length || !inp.bars.length) return null;
      fs.mkdirSync(path.dirname(fileOf(t, day)), { recursive: true });
      const tmp = `${fileOf(t, day)}.tmp`;
      fs.writeFileSync(tmp, gzipSync(JSON.stringify(inp)));
      fs.renameSync(tmp, fileOf(t, day));
      log(`[exposure-hist] ${t} ${day}: ${inp.oi.length} contracts, ${inp.iv.length} vol paths, ${inp.bars.length} bars in ${Math.round((Date.now() - started) / 1000)} s`);
      return inp;
    })().finally(() => pending.delete(key));
    pending.set(key, job);
    return job;
  };

  /** The session before's last vols, when its inputs are already kept (never read just for this) */
  const carriedFor = (t: string, day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    for (let back = 1; back < 8; back++) {
      const prev = new Date(y, m - 1, d - back);
      if (!isTradingDay(prev)) continue;
      const iso = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}`;
      const inp = readDisk(t, iso);
      return inp ? lastVols(inp) : {};
    }
    return {};
  };

  const answers = new Map<string, Buffer>();
  const keepAnswer = (key: string, gz: Buffer) => {
    answers.set(key, gz);
    while (answers.size > KEEP_ANSWERS) answers.delete(answers.keys().next().value!);
  };
  const pack = (a: HistAnswer) => gzipSync(JSON.stringify(a));

  return {
    inputs,
    async answer(t, day, cut) {
      const want = cut === 'book' ? ALL : cut;
      const rec = o.recorded?.(t, day);
      const recSeries = rec?.series.filter(s => s[0] === want) ?? [];
      if (recSeries.length) return { status: 200, gz: pack({ format: HIST_FORMAT, ticker: t, day, cut, source: 'recorded', series: recSeries }) };
      /* a finished trading day only: today is live */
      const [y, m, d] = day.split('-').map(Number);
      if (day >= nyIsoDate(now()) || !isTradingDay(new Date(y, m - 1, d))) return { status: 404, gz: pack({ format: HIST_FORMAT, ticker: t, day, cut, source: 'reconstructed', series: [] }) };
      const key = `${t}|${day}|${cut}`;
      const hit = answers.get(key);
      if (hit) return { status: 200, gz: hit };
      const inp = await inputs(t, day);
      if (!inp) return { status: 404, gz: pack({ format: HIST_FORMAT, ticker: t, day, cut, source: 'reconstructed', series: [] }) };
      const rebuilt = rebuildDay(inp, cut, carriedFor(t, day));
      const gz = pack({ format: HIST_FORMAT, ticker: t, day, cut, source: 'reconstructed', series: rebuilt.series });
      keepAnswer(key, gz);
      return { status: 200, gz };
    },
  };
}

interface Req {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface Res {
  statusCode: number;
  setHeader: (k: string, v: string) => void;
  end: (body?: string | Buffer) => void;
}

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /api/exposure/hist?ticker=&day=&cut=book|YYYY-MM-DD */
export async function histRoute(hist: HistService, req: Req, res: Res): Promise<void> {
  const url = new URL(req.url || '/', 'http://local');
  const t = String(url.searchParams.get('ticker') ?? '').trim().toUpperCase();
  const day = url.searchParams.get('day') ?? '';
  const cut = url.searchParams.get('cut') || 'book';
  res.setHeader('cache-control', 'no-store');
  if (!TICKER.test(t) || !DAY.test(day) || !(cut === 'book' || DAY.test(cut))) {
    res.statusCode = 400;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'ticker must be a symbol, day and cut YYYY-MM-DD (cut may be book)' }));
    return;
  }
  try {
    const { status, gz } = await hist.answer(t, day, cut);
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    const accepts = String(req.headers['accept-encoding'] ?? '').includes('gzip');
    if (accepts) {
      res.setHeader('content-encoding', 'gzip');
      res.end(gz);
    } else res.end(gunzipSync(gz));
  } catch (e) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'The terminal could not rebuild this day.', code: 'hist_unavailable', why: e instanceof Error ? e.message : String(e) }));
  }
}
