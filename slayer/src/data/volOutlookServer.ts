/// <reference types="node" />
/*
  The vol outlook's inputs, read on the server (the Node process that serves the app, like the exposure recorder and the
  Compass engine). Pulse's Vol outlook tile fits on about a year of one-minute bars; read in a browser that is some 13
  two-month reads a name and about three minutes on a cold first view. Here each name's sessions are read once a New York
  day and kept, and /api/vol-outlook/<TICKER> hands them to the tile, which then fits in a few milliseconds.

  - The same reader as the browser (data/volOutlook.ts readSessions over sessionWindow): the same window, the same
    minute paths (through the in-process hub, server/thetaProxy.mjs thetaDirect — the same cache and slots as a viewer's
    read), the same grid, returns and decision rows, so the tile's numbers are the numbers its own read would give
    (scripts/vol-outlook-proof.ts, section 4).
  - Which names: the hot ones (server/hub.mjs HOT_NAMES: SPY, QQQ, IWM, SPX, NVDA, AAPL, TSLA) from the start, and any
    name a tile asked for today. One name is read at a time; a name already read for today's window is not read again
    until the next session closes (a closed session never changes, so the next read is that one session).
  - Kept on disk, <dir>/<TICKER>.json (the wire format, NaN spelled out), so a restart reads only what it lacks.
  - An ask for a name not read yet answers 202 with its progress and queues it; the tile asks again every few seconds.

  This module never runs in a browser bundle. On Vercel there is no long-lived process: the route answers 503 there and
  the tile reads the bars itself.
*/

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { readSessions, sessionWindow, sessionsFromWire, sessionsToWire, SERVED_VERSION, type ServedSessions, type Sessions } from './volOutlook';
import { thetaAnswer } from './compassServer';

type Req = { url?: string; method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string | Buffer) => void };

export interface VolServerOptions {
  /** Where each name's sessions are kept */
  dir: string;
  /** One ThetaData answer, in-process (server/thetaProxy.mjs thetaDirect) */
  theta: (path: string) => Promise<{ status: number; body: string; type: string }>;
  /** The names read from the start, whether or not anyone asks */
  hot: readonly string[];
  /** Read (false: serve what is kept only) */
  read?: boolean;
  /** How many names a day beyond the hot ones (asked-for names, the latest first) */
  max?: number;
  log?: (line: string) => void;
}

export interface VolServer {
  /** A name's sessions for today's window — ready, or building with its progress (and queued) */
  ask: (ticker: string) => { ready: ServedSessions } | { building: { done: number; of: number } };
  status: () => Record<string, unknown>;
  stop: () => void;
}

const TICKER = /^[A-Z][A-Z0-9.]{0,9}$/;
const TICK_MS = 10 * 60_000;

export function startVolOutlookServer(o: VolServerOptions): VolServer {
  const log = o.log ?? (() => undefined);
  const max = o.max ?? 25;
  const kept = new Map<string, ServedSessions>();
  const progress = new Map<string, { done: number; of: number }>();
  /* the names asked for today, latest last */
  let askedDay = '';
  const asked = new Map<string, number>();
  const queue: string[] = [];
  let busy = false;
  let stopped = false;

  try {
    fs.mkdirSync(o.dir, { recursive: true });
    for (const f of fs.readdirSync(o.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = sessionsFromWire<ServedSessions>(fs.readFileSync(path.join(o.dir, f), 'utf8'));
        if (s.v === SERVED_VERSION && TICKER.test(s.ticker)) kept.set(s.ticker, s);
      } catch {
        /* a broken file is read again */
      }
    }
  } catch (e) {
    log(`[vol-outlook] the folder ${o.dir} could not be read: ${e instanceof Error ? e.message : e}`);
  }

  const save = (s: ServedSessions) => {
    const file = path.join(o.dir, `${s.ticker}.json`);
    try {
      fs.writeFileSync(`${file}.tmp`, sessionsToWire(s));
      fs.renameSync(`${file}.tmp`, file);
    } catch (e) {
      log(`[vol-outlook] ${s.ticker} was not kept: ${e instanceof Error ? e.message : e}`);
    }
  };

  /** Is a name's kept copy today's: the same window, read to the last closed session */
  const current = (t: string): ServedSessions | null => {
    const s = kept.get(t);
    const w = sessionWindow();
    return s && s.start === w.start && s.last === w.last ? s : null;
  };

  const read = async (p: string) => {
    try {
      const got = await o.theta(p);
      return thetaAnswer(got.status, got.body, got.type);
    } catch {
      return { status: 503, data: null, error: 'terminal_down' };
    }
  };

  const buildOne = async (t: string) => {
    const w = sessionWindow();
    const have = kept.get(t);
    /* a copy from an earlier window serves as far as it reaches back (readSessions keeps the run from the new start) */
    const prior: Sessions | null = have ? { days: have.days, tail: have.tail } : null;
    const t0 = Date.now();
    const got = await readSessions(t, prior, w.start, w.last, read, (done, of) => progress.set(t, { done, of }));
    progress.delete(t);
    if (got.offline) {
      log(`[vol-outlook] ${t}: the terminal did not answer; asked again on the next pass`);
      return;
    }
    if (!got.days.length) return;
    const s: ServedSessions = { v: SERVED_VERSION, ticker: t, start: w.start, last: w.last, days: got.days, tail: got.tail };
    kept.set(t, s);
    save(s);
    if (got.read) log(`[vol-outlook] ${t}: ${got.days.length} sessions to ${w.last} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  };

  const pump = async () => {
    if (busy || stopped || o.read === false) return;
    busy = true;
    try {
      while (queue.length && !stopped) {
        const t = queue.shift()!;
        if (current(t)) continue;
        await buildOne(t).catch(e => log(`[vol-outlook] ${t}: ${e instanceof Error ? e.message : e}`));
      }
    } finally {
      busy = false;
    }
  };
  const want = (t: string, first = false) => {
    if (current(t) || queue.includes(t)) return;
    if (first) queue.unshift(t);
    else queue.push(t);
    void pump();
  };
  const sweep = () => {
    const day = sessionWindow().liveDay;
    if (day !== askedDay) {
      askedDay = day;
      asked.clear();
    }
    for (const t of o.hot) want(t);
    for (const t of [...asked.keys()].reverse()) want(t);
  };
  sweep();
  const timer = setInterval(sweep, TICK_MS);
  (timer as { unref?: () => void }).unref?.();

  return {
    ask(raw) {
      const t = raw.trim().toUpperCase();
      const day = sessionWindow().liveDay;
      if (day !== askedDay) sweep();
      /* a name viewed today is read again when the next session closes, whether or not it was ready now */
      if (!o.hot.includes(t)) {
        asked.delete(t);
        asked.set(t, Date.now());
        while (asked.size > max) asked.delete(asked.keys().next().value as string);
      }
      const now = current(t);
      if (now) return { ready: now };
      /* a viewer is waiting: their name goes first */
      want(t, true);
      /* yesterday's copy of today's window still serves (the browser reads the one session it lacks) */
      const s = kept.get(t);
      if (s && s.start === sessionWindow().start) return { ready: s };
      return { building: progress.get(t) ?? { done: 0, of: 0 } };
    },
    status: () => ({ names: [...kept.keys()], queue: [...queue], busy, asked: [...asked.keys()] }),
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

function send(req: Req, res: Res, status: number, text: string): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  const accepts = String(req.headers['accept-encoding'] ?? '');
  if (text.length > 4_096 && /\bgzip\b/.test(accepts)) {
    res.setHeader('content-encoding', 'gzip');
    res.end(gzipSync(text));
    return;
  }
  res.end(text);
}

/** GET /api/vol-outlook/<TICKER>: 200 with the sessions (the wire format), 202 while they are read, 400 for a bad name */
export function volOutlookRoute(srv: VolServer, req: Req, res: Res): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, JSON.stringify({ error: 'method not allowed' }));
    return;
  }
  const route = new URL(req.url || '/', 'http://local').pathname.replace(/^\/api\/vol-outlook/, '');
  if (route === '/status') {
    send(req, res, 200, JSON.stringify(srv.status()));
    return;
  }
  const t = decodeURIComponent(route.replace(/^\/+/, '')).trim().toUpperCase();
  if (!TICKER.test(t)) {
    send(req, res, 400, JSON.stringify({ error: 'a ticker, /api/vol-outlook/SPY' }));
    return;
  }
  const got = srv.ask(t);
  if ('ready' in got) send(req, res, 200, sessionsToWire(got.ready));
  else send(req, res, 202, JSON.stringify({ state: 'building', progress: got.building }));
}
