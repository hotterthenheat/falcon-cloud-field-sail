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
    name a tile asked for today. A name a viewer asks for goes to the front of the queue, ahead of the hot names still
    waiting. A name already read for today's window is not read again until the next session closes (a closed session
    never changes, so the next read is that one session).
  - Two names at once, at most, and the second only while the terminal has room (LANES, KEEP_FREE): each name reads
    two spans at a time, and every read of the second name waits until, with it, at least KEEP_FREE of the terminal's
    eight slots stay free and no other reader is queued for one. Alone on the terminal the two names hold four slots
    and leave four; once the Compass engine or a chart takes slots, the second name pauses after its reads in flight
    and the first goes on as before. The first name is counted at its full width (SPAN_READS) whether or not all its
    reads are in flight: it never waits for room, so a slot it frees for a moment (its last span of a name, the turn
    to the next name) is not the second name's to take. With no slot count (a test, a host without the hub) one name
    is read at a time.
  - Kept on disk, <dir>/<TICKER>.json (the wire format, NaN spelled out), so a restart reads only what it lacks.
  - An ask for a name not read yet answers 202 with its progress and queues it; the tile asks again every few seconds.

  This module never runs in a browser bundle. On Vercel there is no long-lived process: the route answers 503 there and
  the tile reads the bars itself.
*/

import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { takeWire, writeWire } from '../../shared/jsonWire.mjs';
import { readSessions, sessionWindow, sessionsFromWire, sessionsToWire, SERVED_VERSION, SPAN_READS, type ServedSessions, type Sessions } from './volOutlook';
import { thetaAnswer } from './compassServer';

type Req = { url?: string; method?: string; headers: Record<string, string | string[] | undefined> };
type Res = { statusCode: number; setHeader: (k: string, v: string) => void; end: (body?: string | Buffer) => void };

/** The terminal's slots as they stand (server/thetaProxy.mjs thetaSlots) */
export interface ThetaSlots {
  terminal: number;
  history: number;
  busy: number;
  busyHistory: number;
  /** Readers queued for a slot */
  waiting: number;
}

export interface VolServerOptions {
  /** Where each name's sessions are kept */
  dir: string;
  /** One ThetaData answer, in-process (server/thetaProxy.mjs thetaDirect) */
  theta: (path: string) => Promise<{ status: number; body: string; type: string }>;
  /** The terminal's slots (server/thetaProxy.mjs thetaSlots): a second name is read only while they leave room */
  slots?: () => ThetaSlots;
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
/** Names read at once */
export const LANES = 2;
/** Terminal slots a second name's read leaves free, counting itself: the Compass engine, the charts and the quotes
    share the eight (history at most six) */
export const KEEP_FREE = 4;
/** How often a held-back read looks again */
const ROOM_POLL_MS = 250;

/** Room for one more background read: with it, KEEP_FREE slots stay free, history stays under its cap, nobody waits */
export const roomForRead = (s: ThetaSlots): boolean => s.waiting === 0 && s.terminal - s.busy - 1 >= KEEP_FREE && s.busyHistory + 1 <= s.history;

export function startVolOutlookServer(o: VolServerOptions): VolServer {
  const log = o.log ?? (() => undefined);
  const max = o.max ?? 25;
  const kept = new Map<string, ServedSessions>();
  const progress = new Map<string, { done: number; of: number }>();
  /* the names asked for today, latest last */
  let askedDay = '';
  const asked = new Map<string, number>();
  const queue: string[] = [];
  /* the names being read, one per lane */
  const reading = new Set<string>();
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
  /* the first lane's reads in flight, counted in the same turn as read() takes its slot */
  let firstReads = 0;
  const readFirst = async (p: string) => {
    firstReads++;
    try {
      return await read(p);
    } finally {
      firstReads--;
    }
  };
  /* No race between two reads that both see room: read() reaches the hub's slot count (server/thetaProxy.mjs slot) in
     the same turn, with no await before it, so the next look already counts it, or sees it queued.
     The first lane never asks for room, so its slots are counted as held at its full width (SPAN_READS) even while it
     holds fewer — at the end of a name one span is still read and the other slot is free for a moment, and a second
     name's read taken then would leave the first lane's next name, at full width, under KEEP_FREE free (2026-11-07:
     8 − 1 other − 2 − 2 = 3 free, scripts/vol-outlook-proof.ts "lanes: … the first name's free slot"). */
  const room = () => {
    if (!o.slots) return false;
    const s = o.slots();
    const owed = Math.max(0, SPAN_READS - firstReads);
    return roomForRead({ ...s, busy: s.busy + owed, busyHistory: s.busyHistory + owed });
  };
  /* a second lane's read waits for room; the first lane's never does (one name at a time, as before) */
  const readWhenRoom = async (p: string) => {
    while (!stopped && !room()) await new Promise(r => setTimeout(r, ROOM_POLL_MS));
    return read(p);
  };

  const buildOne = async (t: string, lane: number) => {
    const w = sessionWindow();
    const have = kept.get(t);
    /* a copy from an earlier window serves as far as it reaches back (readSessions keeps the run from the new start) */
    const prior: Sessions | null = have ? { days: have.days, tail: have.tail } : null;
    const t0 = Date.now();
    const got = await readSessions(t, prior, w.start, w.last, lane === 0 ? readFirst : readWhenRoom, (done, of) => progress.set(t, { done, of }));
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

  /* lane 0 reads whenever there is a name; lane 1 takes a name only while the slots leave room (and its reads wait
     for room after that) */
  const lanes: boolean[] = new Array(LANES).fill(false);
  let roomTimer: ReturnType<typeof setTimeout> | null = null;
  const runLane = async (lane: number) => {
    lanes[lane] = true;
    try {
      while (queue.length && !stopped && (lane === 0 || room())) {
        const t = queue.shift()!;
        if (current(t) || reading.has(t)) continue;
        reading.add(t);
        try {
          await buildOne(t, lane).catch(e => log(`[vol-outlook] ${t}: ${e instanceof Error ? e.message : e}`));
        } finally {
          reading.delete(t);
        }
      }
    } finally {
      lanes[lane] = false;
    }
    if (!stopped) pump();
  };
  const pump = () => {
    if (stopped || o.read === false) return;
    if (!lanes[0] && queue.length) void runLane(0);
    if (!o.slots) return;
    for (let lane = 1; lane < LANES; lane++) {
      if (lanes[lane] || !queue.length) continue;
      if (room()) void runLane(lane);
      /* no room now: look again shortly while names wait */ else if (!roomTimer) {
        roomTimer = setTimeout(() => {
          roomTimer = null;
          pump();
        }, ROOM_POLL_MS * 4);
        (roomTimer as { unref?: () => void }).unref?.();
      }
    }
  };
  const want = (t: string, first = false) => {
    if (current(t) || reading.has(t)) return;
    const at = queue.indexOf(t);
    /* a viewer's name jumps the queue, ahead of the hot names still waiting */
    if (at >= 0 && first && at > 0) queue.splice(at, 1);
    else if (at >= 0) return;
    if (first) queue.unshift(t);
    else queue.push(t);
    pump();
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
    status: () => ({ names: [...kept.keys()], queue: [...queue], reading: [...reading], busy: reading.size > 0, asked: [...asked.keys()] }),
    stop() {
      stopped = true;
      clearInterval(timer);
      if (roomTimer) clearTimeout(roomTimer);
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
  if ('ready' in got) {
    const s = got.ready;
    const tail = s.days[s.days.length - 1];
    const stamp = `${s.start}|${s.last}|${s.days.length}|${tail?.day ?? ''}|${tail?.n ?? 0}|${tail?.rows.length ?? 0}`;
    writeWire(req, res, 200, takeWire(`vol|${t}`, stamp, () => sessionsToWire(s)));
  } else send(req, res, 202, JSON.stringify({ state: 'building', progress: got.building }));
}
