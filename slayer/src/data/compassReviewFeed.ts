/* The session review and study the server builds after each session (data/compassReview.ts), read once per day and
   kept in this browser so a later visit paints at once. */

import { useEffect, useState } from 'react';
import { feedHeaders } from './feedGate';
import type { LiveReview } from './reviewShape';
import type { PooledStudy, StudyResult } from './compassStudy';
import type { Signal } from './compassLedger';
import { noFees } from './compassOutcome';
import { viewerWords } from './compassParams';

/** 'pooled' is every labelled session's study together (/api/compass/study?day=all; pass day 'all') */
type Kind = 'review' | 'study' | 'pooled';
type Doc<K extends Kind> = K extends 'review' ? LiveReview : K extends 'pooled' ? PooledStudy : StudyResult;
export interface DocState<T> {
  doc: T | null;
  status: 'loading' | 'ready' | 'missing' | 'error';
  error: string;
}

const memo = new Map<string, { at: number; doc: unknown; status: DocState<unknown>['status']; error: string }>();
const KEEP = 'slayer_compass_doc_v1';

function kept(key: string): unknown {
  try {
    const all = JSON.parse(viewerWords(localStorage.getItem(KEEP) || '{}')) as Record<string, unknown>;
    return all[key] ?? null;
  } catch {
    return null;
  }
}

function keep(key: string, doc: unknown): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEEP) || '{}') as Record<string, unknown>;
    all[key] = doc;
    /* the last few sessions only */
    const keys = Object.keys(all).sort().slice(-6);
    localStorage.setItem(KEEP, JSON.stringify(Object.fromEntries(keys.map(k => [k, all[k]]))));
  } catch {
    /* storage full or closed: the next visit reads again */
  }
}

/** The review or the study of one session (YYYY-MM-DD), or every session's study pooled ('pooled', day 'all').
    `refreshMs` keeps a live page on the scanner (the review). */
export function useCompassDoc<K extends Kind>(kind: K, day: string | null, refreshMs = 0): DocState<Doc<K>> {
  const key = `${kind}|${day}`;
  const [state, setState] = useState<DocState<Doc<K>>>(() => {
    const hit = memo.get(key);
    if (hit) return { doc: hit.doc as Doc<K>, status: hit.status, error: hit.error };
    const k = day ? kept(key) : null;
    return { doc: (k as Doc<K>) ?? null, status: 'loading', error: '' };
  });
  useEffect(() => {
    if (!day) return;
    const hit = memo.get(key);
    if (!refreshMs && hit && Date.now() - hit.at < 5 * 60_000 && hit.status !== 'error') {
      setState({ doc: hit.doc as Doc<K>, status: hit.status, error: hit.error });
      return;
    }
    let dead = false;
    const pull = async () => {
      const auth = await feedHeaders();
      if (!auth.ok) {
        if (!dead) setState(s => ({ ...s, status: 'error', error: 'Sign in to read Compass.' }));
        return;
      }
      try {
        const res = await fetch(kind === 'pooled' ? '/api/compass/study?day=all' : `/api/compass/${kind}?day=${day}`, { headers: { ...auth.headers, 'x-compass-soft': '1' } });
        const body = (await res.text().then(t => JSON.parse(viewerWords(t))).catch(() => null)) as (Doc<K> & { code?: string; error?: string }) | null;
        if (dead) return;
        if ((res.status === 404 || res.status === 200) && body?.code === 'not_built') {
          memo.set(key, { at: Date.now(), doc: null, status: 'missing', error: body.error ?? '' });
          setState({ doc: null, status: 'missing', error: body.error ?? '' });
          return;
        }
        if (!res.ok || !body) throw new Error(body?.error || `status ${res.status}`);
        memo.set(key, { at: Date.now(), doc: body, status: 'ready', error: '' });
        keep(key, body);
        setState({ doc: body, status: 'ready', error: '' });
      } catch {
        if (!dead) setState(s => ({ ...s, status: 'error', error: 'The Compass server did not answer.' }));
      }
    };
    void pull();
    if (!refreshMs) return () => { dead = true; };
    const timer = setInterval(() => void pull(), refreshMs);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, [key, kind, day, refreshMs]);
  return state;
}

const recordMemo = new Map<string, { at: number; calls: Signal[] }>();

/** Every official call on record, every session (the Blotter's track record): /api/compass/days, then each session's
    record (a past session's once; today's again after a minute). Null until the first read answers. */
export function useAllCalls(today: string, rev: number): Signal[] | null {
  const [calls, setCalls] = useState<Signal[] | null>(null);
  useEffect(() => {
    let dead = false;
    void (async () => {
      const auth = await feedHeaders();
      if (!auth.ok) return;
      try {
        const res = await fetch('/api/compass/days', { headers: auth.headers });
        const body = (await res.json()) as { days?: { day: string; calls: number }[] };
        const days = (body.days ?? []).filter(d => d.calls > 0).map(d => d.day);
        const out: Signal[] = [];
        for (const d of days) {
          const hit = recordMemo.get(d);
          if (hit && (d < today || Date.now() - hit.at < 60_000)) {
            out.push(...hit.calls);
            continue;
          }
          const r = await fetch(`/api/compass/record?day=${d}`, { headers: auth.headers });
          if (!r.ok) continue;
          const doc = JSON.parse(viewerWords(await r.text())) as { calls?: Signal[] };
          const got = Array.isArray(doc.calls) ? doc.calls.map(noFees) : [];
          recordMemo.set(d, { at: Date.now(), calls: got });
          out.push(...got);
        }
        if (!dead) setCalls(out.sort((a, b) => b.firedAt - a.firedAt));
      } catch {
        /* the header keeps the record it has */
      }
    })();
    return () => {
      dead = true;
    };
  }, [today, rev]);
  return calls;
}

/** The sessions on record, newest first. */
export function useCompassDays(): string[] {
  const [days, setDays] = useState<string[]>([]);
  useEffect(() => {
    let dead = false;
    const pull = async () => {
      const auth = await feedHeaders();
      if (!auth.ok) return;
      try {
        const res = await fetch('/api/compass/days', { headers: auth.headers });
        const body = (await res.json()) as { days?: { day: string }[] };
        if (!dead && Array.isArray(body.days)) setDays(body.days.map(d => d.day).sort().reverse());
      } catch {
        /* the page says it has no record */
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 60_000);
    return () => {
      dead = true;
      clearInterval(timer);
    };
  }, []);
  return days;
}
