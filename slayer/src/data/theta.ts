/* ThetaData v3 through /api/theta, which the server forwards to the local terminal (127.0.0.1:25503/v3). A down terminal is a 503 terminal_down;
   nothing is invented and the server's sentence never reaches a cell. */

import { SIM_DESK } from './deskMode';
import { feedHeaders } from './feedGate';
import { BoundedMap } from './boundedMap';

let inflight = 0;
const next: (() => void)[] = [];
const first: (() => void)[] = [];
const MAX = 8;
const RESERVED = 2;

function take(jump = false): Promise<void> {
  const cap = jump ? MAX : MAX - RESERVED;
  if (inflight < cap) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise(resolve => (jump ? first : next).push(resolve));
}

function release(): void {
  inflight -= 1;
  if (first.length && inflight < MAX) {
    inflight += 1;
    first.shift()?.();
    return;
  }
  if (next.length && inflight < MAX - RESERVED) {
    inflight += 1;
    next.shift()?.();
  }
}

function unwrap(parsed: unknown): unknown {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.response)) return o.response;
    if (Array.isArray(o.data)) return o.data;
  }
  return parsed;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2 || !lines[0].includes(',')) return [];
  const head = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',');
    const row: Record<string, string> = {};
    head.forEach((h, i) => {
      row[h] = (cols[i] ?? '').trim();
    });
    return row;
  });
}

/* Only these mean the terminal can answer nothing: 474 disconnected from ThetaData, 478 another terminal holds the
   session, 571 still starting. 472 is "no data for this request" and 471/473 are about the request itself. */
const downStatus = (status: number) => status === 503 || status === 474 || status === 478 || status === 571;

/* While the terminal is down every call would fail the same way: hold them all, 15 s at first and up to a minute. */
let downUntil = 0;
let downFor = 0;
const noteDown = () => {
  downFor = Math.min(60_000, downFor ? downFor * 2 : 15_000);
  downUntil = Date.now() + downFor;
};
const noteUp = () => {
  downFor = 0;
  downUntil = 0;
};

/** A down terminal is the code, never the server's sentence. */
function faultText(status: number, parsed: unknown, text: string): string {
  const o = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  const code = o && typeof o.code === 'string' ? o.code : '';
  const raw = o ? String(o.error || o.message || '') : typeof parsed === 'string' ? parsed : text;
  if (code === 'terminal_down' || code === 'terminal_login' || code === 'session_lost' || code === 'terminal_unavailable' || status === 0 || downStatus(status) || /not running|invalid session/i.test(raw)) return 'terminal_down';
  if (status === 472) return 'no_data';
  /* the server gave up waiting on a terminal that is up (server/thetaProxy.mjs BUSY): busy, by its code */
  if (code === 'terminal_busy') return 'terminal_busy';
  const msg = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
  return msg || `unavailable ${status}`;
}

/* What ThetaData may be asked for on the page in view (the owner's rules, docs/DATA_SOURCES.md):
   Trace and the Dossier read Unusual Whales only; Pinpoint reads its greeks, exposure and levels from Unusual Whales
   and only its live price and chart candles from ThetaData; every other page may read all of ThetaData. */
export type ThetaUse = 'all' | 'prices' | 'none';
export const thetaUseHere = (): ThetaUse => {
  if (typeof location === 'undefined') return 'all';
  if (/^\/(trace|dossier)(\/|$)/.test(location.pathname)) return 'none';
  if (/^\/pinpoint(\/|$)/.test(location.pathname)) return 'prices';
  return 'all';
};
/** The page in view reads Unusual Whales only (Trace, the Dossier): no ThetaData request leaves it, whatever asks. */
export const uwOnlyRoute = (): boolean => thetaUseHere() === 'none';
/* a live price or a chart candle: a stock's or an index's snapshot, its bars, or its daily closes (the day's change),
   and a stock's prints, which its extended-hours candles are built from (data/thetaEligible.ts) */
const PRICE_PATH = /^\/(stock|index)\/(snapshot\/(quote|trade|price|ohlc)|history\/(ohlc|eod))(\?|$)|^\/stock\/history\/trade(\?|$)/;
/** May this ThetaData request be made on the page in view? */
export const thetaAllowedHere = (path: string): boolean => {
  const use = thetaUseHere();
  return use === 'all' || (use === 'prices' && PRICE_PATH.test(path));
};

/* The terminal spells a class share's stock with its dot (BRK.B) and its option root without (BRKB): every option
   read is sent the root, so a desk can pass the listing as the reader knows it. */
export const optionPath = (path: string): string =>
  path.startsWith('/option/') ? path.replace(/([?&](?:symbol|root)=)([A-Z]{1,4})(?:\.|%2E)([A-Z])(?=&|$)/gi, '$1$2$3') : path;

type ThetaAnswer = { status: number; data: unknown; error: string | null };

/* A name's daily rows are one read a page: the price store (prior closes) and the tape store (the print's prior close)
   both ask the same address within a second of each other. One read is in flight at a time, and its good answer serves
   that address for a minute (the price store's own after-the-bell re-ask is a minute apart too). */
const DAILY_ROWS = /^\/(stock|index)\/history\/eod\?/;
const DAILY_SHARE_MS = 60_000;
const dailyShared = new BoundedMap<string, { at: number; answer: Promise<ThetaAnswer> }>(200);

export function thetaCall(path: string, jump = false): Promise<ThetaAnswer> {
  if (!DAILY_ROWS.test(path)) return thetaRead(path, jump);
  const hit = dailyShared.get(path);
  if (hit && (hit.at === 0 || Date.now() - hit.at < DAILY_SHARE_MS)) return hit.answer;
  const slot = { at: 0, answer: thetaRead(path, jump) };
  dailyShared.set(path, slot);
  void slot.answer.then(a => {
    /* a good answer is kept for the minute; a failed one is not kept at all, so the next ask reads again */
    if (a.error) {
      if (dailyShared.get(path) === slot) dailyShared.delete(path);
    } else slot.at = Date.now();
  });
  return slot.answer;
}

/* How long this browser waits on one read: a little past the server's own limit on the terminal (server/thetaProxy.mjs
   loadNow: 20 s for a snapshot, 90 s for history), so the server's busy answer (504 terminal_busy) normally lands
   first. A read that outlives it anyway (a stalled socket, a proxy that never answers) is the terminal being busy, not
   down: no breaker, the next read asks again. */
const THETA_WAIT_MS = { quote: 25_000, history: 95_000 } as const;
const historyPath = (p: string): boolean => /\/(history|at_time)\//.test(p);
export const thetaWaitMs = (path: string): number => (historyPath(path) ? THETA_WAIT_MS.history : THETA_WAIT_MS.quote);
const BUSY_ANSWER = (): ThetaAnswer => ({ status: 504, data: null, error: 'terminal_busy' });
const timedOut = (e: unknown): boolean => {
  const name = e && typeof e === 'object' ? (e as { name?: unknown }).name : undefined;
  return name === 'TimeoutError' || name === 'AbortError';
};

async function thetaRead(path: string, jump = false): Promise<ThetaAnswer> {
  path = optionPath(path);
  if (SIM_DESK) return { status: 0, data: null, error: 'sim' };
  if (!thetaAllowedHere(path)) return { status: 0, data: null, error: 'uw_only' };
  const auth = await feedHeaders();
  if (!auth.ok) return { status: 401, data: null, error: auth.code };
  if (Date.now() < downUntil) return { status: 503, data: null, error: 'terminal_down' };
  await take(jump);
  try {
    const res = await fetch(`/api/theta${path}`, { headers: { ...auth.headers, 'x-theta-soft': '1' }, signal: AbortSignal.timeout(thetaWaitMs(path)) });
    const text = await res.text();
    const type = res.headers.get('content-type') || '';
    let parsed: unknown = null;
    if (type.includes('json') || text.startsWith('{') || text.startsWith('[')) {
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
    } else {
      const rows = parseCsv(text);
      parsed = rows.length ? rows : text;
    }
    const data = unwrap(parsed);
    /* an outage or a no-data answer the proxy sent as 200 (x-theta-soft) still carries its code */
    const outage = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as { code?: unknown }).code : undefined;
    if (outage === 'terminal_down' || outage === 'terminal_login' || outage === 'session_lost' || outage === 'terminal_unavailable') {
      /* A stolen session is one read. The terminal is still up and the next read usually lands — a 15s blackout
         is what left the rail saying offline while quotes were answering. A dead terminal still backs off. */
      if (outage !== 'session_lost') noteDown();
      return { status: 503, data: null, error: 'terminal_down' };
    }
    if (outage === 'no_data') {
      noteUp();
      return { status: 472, data: null, error: 'no_data' };
    }
    if (!res.ok) {
      const error = faultText(res.status, parsed, text);
      if (error === 'terminal_down') noteDown();
      return { status: res.status, data, error };
    }
    noteUp();
    return { status: res.status, data, error: null };
  } catch (e) {
    /* our own wait ran out: busy, never down (the body can time out too, after the headers came in) */
    if (timedOut(e)) return BUSY_ANSWER();
    noteDown();
    return { status: 0, data: null, error: 'terminal_down' };
  } finally {
    release();
  }
}
