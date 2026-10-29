/* ThetaData v3 through /api/theta, which the server forwards to the local terminal (127.0.0.1:25503/v3). A down terminal is a 503 terminal_down;
   nothing is invented and the server's sentence never reaches a cell. */

import { SIM_DESK } from './deskMode';
import { feedHeaders } from './feedGate';

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
  if (code === 'terminal_down' || code === 'session_lost' || code === 'terminal_unavailable' || status === 0 || downStatus(status) || /not running|invalid session/i.test(raw)) return 'terminal_down';
  if (status === 472) return 'no_data';
  const msg = raw.replace(/\s+/g, ' ').trim().slice(0, 180);
  return msg || `unavailable ${status}`;
}

export async function thetaCall(path: string, jump = false): Promise<{ status: number; data: unknown; error: string | null }> {
  if (SIM_DESK) return { status: 0, data: null, error: 'sim' };
  const auth = await feedHeaders();
  if (!auth.ok) return { status: 401, data: null, error: auth.code };
  if (Date.now() < downUntil) return { status: 503, data: null, error: 'terminal_down' };
  await take(jump);
  try {
    const res = await fetch(`/api/theta${path}`, { headers: auth.headers });
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
    if (!res.ok) {
      const error = faultText(res.status, parsed, text);
      if (error === 'terminal_down') noteDown();
      return { status: res.status, data, error };
    }
    noteUp();
    return { status: res.status, data, error: null };
  } catch {
    noteDown();
    return { status: 0, data: null, error: 'terminal_down' };
  } finally {
    release();
  }
}
