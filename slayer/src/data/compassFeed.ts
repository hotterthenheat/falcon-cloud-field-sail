/* The browser's copy of the server's Compass: the board, the record and the marks, read from /api/compass/state
   every few seconds while a page that shows them is open and the tab is visible. Every viewer reads the same
   engine, so two browsers show the same calls. The last copy is kept in this browser and painted at once on a
   reload, stamped with the instant the server took it, until the fresh one lands. */

import { useSyncExternalStore } from 'react';
import { importModelState, type ModelPack } from './compassModel';
import { importSignals, importWould, type Signal } from './compassLedger';
import { importMarks, setScanMeta, type MarkRow, type ScanMeta } from './compassScan';
import { noteCompassCall } from './compassAlerts';
import { feedHeaders } from './feedGate';
import type { Setup } from '../types/compass';

/** The served state (data/compassServer.ts CompassState), as this browser reads it. */
interface Served {
  format: string;
  rev: number;
  at: number;
  day: string;
  engine: { running: boolean; readOnly: boolean; startedAt: number; why: string };
  meta: ScanMeta;
  lock: string;
  close: number | null;
  model: ModelPack;
  earlier: { day: string; at: number; setups: Setup[] } | null;
  signals: Signal[];
  /** What late marks would have called (not calls) */
  would?: Signal[];
  marks: MarkRow[];
}

export type FeedStatus = 'loading' | 'live' | 'kept' | 'offline';

export interface CompassFeed {
  status: FeedStatus;
  /** When the server took the state on screen, epoch ms (0 before any) */
  at: number;
  /** The session the state is for, YYYY-MM-DD */
  day: string;
  engine: Served['engine'] | null;
  lock: string;
  close: number | null;
  marks: MarkRow[];
  /** Why the last read failed, for the offline line */
  error: string;
}

const KEEP = 'slayer_compass_state_v2';
const POLL_MS = 5_000;

let feed: CompassFeed = { status: 'loading', at: 0, day: '', engine: null, lock: '', close: null, marks: [], error: '' };
let rev = 0;
let served = 0;
const listeners = new Set<() => void>();

function emit(): void {
  rev += 1;
  for (const fn of listeners) fn();
}

let heard: Set<string> | null = null;

function apply(s: Served, status: FeedStatus): void {
  importModelState(s.model, s.earlier);
  importSignals(s.signals);
  importWould(s.would ?? []);
  importMarks(s.marks);
  setScanMeta(s.meta);
  /* a call this browser has not seen before chimes for the reader who asked to hear it (data/compassAlerts.ts);
     the record already on screen at the first read does not */
  const keys = new Set(s.signals.map(r => r.key));
  if (heard && status === 'live') {
    for (const r of s.signals) {
      if (heard.has(r.key) || Date.now() - r.firedAt > 15 * 60_000) continue;
      noteCompassCall({ id: r.id, ticker: r.ticker, contract: r.contract, expiry: r.expiry === s.day ? '0DTE' : r.expiry, at: r.firedAt });
    }
  }
  if (status === 'live') heard = keys;
  feed = { status, at: s.at, day: s.day, engine: s.engine, lock: s.lock, close: s.close, marks: s.marks, error: '' };
  emit();
}

/* the kept copy paints the first frame */
try {
  const kept = typeof localStorage !== 'undefined' ? localStorage.getItem(KEEP) : null;
  const s = kept ? (JSON.parse(kept) as Served) : null;
  if (s && s.format && s.model && Array.isArray(s.signals)) apply(s, 'kept');
} catch {
  /* nothing kept, or storage is closed: the first read paints */
}

let inflight = false;

async function pull(): Promise<void> {
  if (inflight || (typeof document !== 'undefined' && document.hidden)) return;
  inflight = true;
  try {
    const auth = await feedHeaders();
    if (!auth.ok) {
      feed = { ...feed, status: feed.at ? 'kept' : 'offline', error: auth.code === 'signed_out' ? 'Sign in to read Compass.' : 'Compass reads once the terminal is open.' };
      emit();
      return;
    }
    const res = await fetch(`/api/compass/state${served ? `?rev=${served}` : ''}`, { headers: auth.headers });
    const body = (await res.json().catch(() => null)) as (Served & { same?: boolean; error?: string; code?: string }) | null;
    if (!res.ok || !body) {
      const why = body?.code === 'engine_hosted' || res.status === 404
        ? 'This deployment has no Compass engine. It runs on the always-on server beside the terminal.'
        : body?.error || `The Compass server did not answer (${res.status}).`;
      feed = { ...feed, status: feed.at ? 'kept' : 'offline', error: why };
      emit();
      return;
    }
    if (body.same) {
      if (feed.status !== 'live') {
        feed = { ...feed, status: 'live', error: '' };
        emit();
      }
      return;
    }
    served = body.rev;
    apply(body, 'live');
    try {
      localStorage.setItem(KEEP, JSON.stringify(body));
    } catch {
      /* too big for this browser's storage, or closed: the next visit waits for the first read */
    }
  } catch {
    feed = { ...feed, status: feed.at ? 'kept' : 'offline', error: 'The Compass server did not answer.' };
    emit();
  } finally {
    inflight = false;
  }
}

let users = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;

const onVisible = () => {
  if (!document.hidden) void pull();
};

/** Start reading (counted: a page that shows Compass holds it open). Returns the release. */
export function holdCompassFeed(): () => void {
  users += 1;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
  if (!timer && typeof window !== 'undefined') {
    void pull();
    timer = setInterval(() => void pull(), POLL_MS);
    document.addEventListener('visibilitychange', onVisible);
  }
  return () => {
    users -= 1;
    /* a beat of grace: moving between Compass pages remounts the readers */
    if (users === 0) stopTimer = setTimeout(() => {
      stopTimer = null;
      if (users > 0 || !timer) return;
      clearInterval(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisible);
    }, 1_000);
  };
}

let pulledAt = 0;

/** A page outside Compass that shows the engine's seats (Weigher) reads the state once a minute at most. */
export function refreshCompassSoon(): void {
  if (timer || Date.now() - pulledAt < 60_000) return;
  pulledAt = Date.now();
  void pull();
}

export function compassFeed(): CompassFeed {
  return feed;
}

/** The feed's condition, re-rendering on every new read. */
export function useCompassFeed(): CompassFeed {
  useSyncExternalStore(
    fn => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => rev,
    () => rev,
  );
  return feed;
}

/** The marks still waiting to be scored from recorded quotes (the terminal missed them, or the engine started after
    them): how many names, and the oldest mark's clock. */
export function backlog(marks: readonly MarkRow[] = feed.marks): { names: number; oldest: string; late: number } {
  let names = 0;
  let late = 0;
  let oldest = '';
  let oldestAt = Infinity;
  for (const m of marks) {
    for (const v of Object.values(m.names)) {
      if (v === 'late') late += 1;
      if (v !== 'pending') continue;
      names += 1;
      if (m.at < oldestAt) {
        oldestAt = m.at;
        oldest = m.clock;
      }
    }
  }
  return { names, oldest, late };
}

/** One line for a page while marks are waiting, or ''. */
export function backlogLine(marks: readonly MarkRow[] = feed.marks): string {
  const b = backlog(marks);
  if (!b.names) return '';
  return `Scoring missed marks late from recorded quotes: ${b.names.toLocaleString('en-US')} left, from ${b.oldest} ET.`;
}
