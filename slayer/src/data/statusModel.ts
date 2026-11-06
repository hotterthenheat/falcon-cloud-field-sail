/* THE STATUS PAGE'S RULE: each of the app's data paths, judged only on what the app itself heard. The inputs are the
   reads the clients made (data/pathHealth.ts), the Compass feed this browser holds (data/compassFeed.ts), and the
   exposure recorder's own /api/exposure/status answer. Pure (the caller passes `now`), so scripts/surfaces-proof.ts
   pins it. A row with nothing heard yet is "checking", never "up". No vendor is named in any line. */

import type { PathRead } from './pathHealth';
import { ageWords, sessionMoving, staleAfter } from './freshness';
import { nyClock } from '../core/nyTime';

export type RowState = 'up' | 'degraded' | 'down' | 'refused' | 'off' | 'checking';

export interface StatusRow {
  id: 'quotes' | 'flow' | 'recorder' | 'compass' | 'server';
  label: string;
  /** what the path carries, one line */
  what: string;
  state: RowState;
  /** what was heard, in a sentence */
  line: string;
  /** the instant the row's last good answer came in, 0 for none */
  lastAt: number;
}

/** The words a row's state shows as */
export const STATE_WORDS: Record<RowState, string> = {
  up: 'Answering',
  degraded: 'Degraded',
  down: 'Down',
  refused: 'Closed to you',
  off: 'Not running here',
  checking: 'Checking',
};

/** Worst first: the page's summary is the worst row's */
export const STATE_RANK: Record<RowState, number> = { down: 0, degraded: 1, refused: 2, checking: 3, off: 4, up: 5 };

/* the server's own sentences can carry a vendor's name; a status line never does */
const VENDOR = /\b(?:thetadata|theta\s*data|theta\s*terminal|unusual\s*whales|uw\b)/gi;
/* nor a server setting's name ("(EXPOSURE_RECORDER=0)"): the reader is told what, not how to switch it */
const SETTING = /\s*\([A-Z][A-Z0-9_]*=[^)]*\)/g;
export const neutral = (s: string): string => s.replace(VENDOR, 'market data').replace(SETTING, '');

const clock = (ms: number) => nyClock(ms, { zone: true });

/** A client path (quotes, flow, server) from its reads */
/** The Compass engine's reading of the option chain's own stamps (compassScan FeedHealth), for the quotes row: the
    terminal can answer every read while its option quotes are minutes old (2026-11-06 09:35–10:15 ET), and an answer
    alone said "answering". */
export interface OptionStaleness {
  state: 'fresh' | 'stale';
  since: number;
  lagMs: number;
  names: readonly string[];
  fallback: readonly string[];
  blind: readonly string[];
  at: number;
}

/** Stale snapshots, in words: how far behind, since when, and what the scan does about it. */
export function staleWords(f: OptionStaleness): string {
  const lag = f.lagMs > 0 ? ` ${ageWords(f.lagMs)} behind` : '';
  const from = f.since ? ` since ${clock(f.since)}` : '';
  const n = f.names.length;
  const fell = f.fallback.length ? ` ${f.fallback.length} of ${n} scored from a current source.` : '';
  const blind = f.blind.length ? ` ${f.blind.length} of ${n} not scored (no current quote).` : '';
  return `Stale snapshots: option quotes${lag}${from} (${n} ${n === 1 ? 'name' : 'names'}).${fell}${blind}`;
}

/** Stale option quotes count for this long after the mark that saw them (a mark runs every minute) */
const STALE_HOLD_MS = 3 * 60_000;
export const optionsStaleNow = (f: OptionStaleness | null | undefined, now: number): boolean => !!f && f.state === 'stale' && now - f.at <= STALE_HOLD_MS;

export function pathRow(id: 'quotes' | 'flow' | 'server', r: PathRead, now: number, options?: OptionStaleness | null): StatusRow {
  const META = {
    quotes: { label: 'Live quotes', what: 'The market data terminal: stock, index and option prices, chains and minute bars' },
    flow: { label: 'Options flow & exposure', what: 'The flow tape, the dealer book and exposure, levels, news and filings' },
    server: { label: 'App server', what: 'This terminal’s own server: the data proxies, Compass and the recorder' },
  }[id];
  const base = { id, ...META, lastAt: r.okAt };
  const since = r.okAt ? `last answer ${ageWords(now - r.okAt)} ago` : 'no answer yet this visit';
  if (r.condition === 'unknown') return { ...base, state: 'checking', line: 'Nothing asked yet — the first read is on its way.' };
  if (r.condition === 'refused') return { ...base, state: 'refused', line: 'The server answers, but this account may not read it (sign in, or a plan that opens it).' };
  if (r.condition === 'down') {
    const from = r.failSince ? ` since ${clock(r.failSince)}` : '';
    if (id === 'quotes' && r.login) return { ...base, state: 'down', line: `Login refused${from} — the data key on the server needs looking at. ${cap(since)}.` };
    if (id === 'server') return { ...base, state: 'down', line: `No answer${from}. Pages keep what they showed and try again on their own. ${cap(since)}.` };
    const busy = r.why === 'busy' ? 'Busy — asking again shortly' : 'Not answering — reconnecting';
    return { ...base, state: 'down', line: `${busy}${from}. ${cap(since)}.` };
  }
  /* up: but a good answer long ago is stale (the page stopped asking, or every ask since failed softly) */
  const ttl = staleAfter(id === 'quotes' ? 'quotes' : id === 'flow' ? 'flow' : 'compass', now);
  const taken = id === 'flow' && r.dataAt ? ` · data taken ${nyClock(r.dataAt, { seconds: true, zone: true })}` : '';
  if (now - r.okAt > Math.max(ttl, 5 * 60_000)) return { ...base, state: 'degraded', line: `No answer in ${ageWords(now - r.okAt)} — nothing on screen has asked lately${taken}.` };
  /* answering is not current: the option chain's own stamps can lag while every read answers */
  if (id === 'quotes' && options && optionsStaleNow(options, now)) return { ...base, state: 'degraded', line: `Answering, but ${staleWords(options).replace(/^Stale snapshots: o/, 'o')} ${cap(since)}.` };
  return { ...base, state: 'up', line: `${cap(since)}${taken}.` };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface CompassInput {
  status: 'loading' | 'live' | 'kept' | 'offline';
  heardAt: number;
  /** when the server took the state on screen */
  at: number;
  error: string;
  engine: { running: boolean; readOnly: boolean; startedAt: number; why: string } | null;
  /** the newest mark's minute, 0 for none */
  lastMark: number;
  /** the engine's own view of the quote terminal */
  quotes: 'unknown' | 'up' | 'down' | string;
  quotesDownSince: number;
  /** a mark is due now (the engine's scan window is open) */
  markDue: boolean;
  /** the option chain's freshness at the engine's last mark */
  options?: OptionStaleness | null;
}

export function compassRow(c: CompassInput, now: number): StatusRow {
  const base = { id: 'compass' as const, label: 'Compass engine', what: 'The server’s scan: it scores contracts every minute of the session and keeps the record', lastAt: c.heardAt };
  if (c.status === 'loading') return { ...base, state: 'checking', line: 'Asking the server for the board.' };
  if (c.status === 'offline') return { ...base, state: 'down', line: neutral(c.error || 'The Compass server did not answer.') };
  if (c.status === 'kept') return { ...base, state: 'degraded', line: `Reconnecting — showing the board as of ${clock(c.at)}. ${neutral(c.error)}`.trim() };
  const e = c.engine;
  const mark = c.lastMark ? `last mark ${nyClock(c.lastMark, { zone: true })}` : 'no mark yet today';
  if (e && !e.running) return { ...base, state: 'off', line: `Serving the record, not scanning: ${neutral(e.why || 'the scan is off in this process.')} ${cap(mark)}.` };
  if (c.quotes === 'down') return { ...base, state: 'degraded', line: `Running, scan paused — live quotes are not answering${c.quotesDownSince ? ` since ${clock(c.quotesDownSince)}` : ''}. Missed marks are scored later from recorded quotes. ${cap(mark)}.` };
  if (c.options && optionsStaleNow(c.options, now)) return { ...base, state: 'degraded', line: `Running — ${staleWords(c.options)} ${cap(mark)}.` };
  const heardTtl = staleAfter('compass', now);
  if (c.heardAt && now - c.heardAt > heardTtl) return { ...base, state: 'degraded', line: `Stale — the board was last heard ${ageWords(now - c.heardAt)} ago. ${cap(mark)}.` };
  /* a mark every minute of the scan window: three missed in a row is stale */
  if (c.markDue && c.lastMark && now - c.lastMark > 3 * 60_000) return { ...base, state: 'degraded', line: `Running, but the last mark was ${ageWords(now - c.lastMark)} ago (${nyClock(c.lastMark, { zone: true })}) — marks are due every minute.` };
  return { ...base, state: 'up', line: `Running · ${mark}${c.markDue ? '' : ' · no marks are due outside the scan window'}.` };
}

/** /api/exposure/status's answer as the page read it */
export type RecorderProbe =
  | { kind: 'asking' }
  | { kind: 'refused' }
  | { kind: 'none'; code: string; status: number }
  | { kind: 'unreachable' }
  | { kind: 'ok'; recording: boolean; why: string; lastAt: number; took: number; fault: string | null; backoffUntil: number; names: number };

export function recorderRow(p: RecorderProbe, now: number): StatusRow {
  const base = { id: 'recorder' as const, label: 'Exposure recorder', what: 'The server’s minute-by-minute record of each name’s exposure, for Terrain’s field', lastAt: p.kind === 'ok' ? p.lastAt : 0 };
  if (p.kind === 'asking') return { ...base, state: 'checking', line: 'Asking the server.' };
  if (p.kind === 'refused') return { ...base, state: 'refused', line: 'The server answers, but this account may not read it.' };
  if (p.kind === 'unreachable') return { ...base, state: 'down', line: 'The server did not answer.' };
  if (p.kind === 'none') return { ...base, state: 'off', line: p.code === 'recorder_hosted' ? 'This deployment has no recorder: it runs on the always-on server.' : `Not running on this server (${p.status}).` };
  if (!p.recording) return { ...base, state: 'off', line: `Serving the record, not recording: ${neutral(p.why || 'recording is off in this process.')}` };
  if (p.backoffUntil > now) return { ...base, state: 'degraded', line: `Holding off after a refused read until ${clock(p.backoffUntil)}.` };
  if (!p.lastAt) return { ...base, state: 'up', line: `Recording ${p.names} names · no pass yet${sessionMoving(now) ? '' : ' (passes run in the session)'}.` };
  const age = now - (p.lastAt + p.took);
  const fault = p.fault ? ` The last pass reported: ${neutral(p.fault)}.` : '';
  if (sessionMoving(now) && age > 5 * 60_000) return { ...base, state: 'degraded', line: `Recording ${p.names} names, but the last pass was ${ageWords(age)} ago.${fault}` };
  return { ...base, state: p.fault ? 'degraded' : 'up', line: `Recording ${p.names} names · last pass ${clock(p.lastAt)}.${fault}` };
}

/** The page's one-line summary */
export function overall(rows: readonly StatusRow[]): RowState {
  let worst: RowState = 'up';
  for (const r of rows) if (STATE_RANK[r.state] < STATE_RANK[worst]) worst = r.state;
  return worst;
}
