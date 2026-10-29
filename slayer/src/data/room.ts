/*
  The community room's data: the reader's own posts and marks in this browser, and the small engines —
  what a post mentions, what is trending, what a setup settled for and the record a person builds.
*/

import type { Lean, Person, Post, RoomState, Setup } from '../types/room';

/** The reader's own posts carry this handle; the page draws the profile for it */
export const ME = 'me';


/* No members or posts are invented: until the room has a backend, only this browser's own posts are in it. */
export const PEOPLE: Person[] = [];

const byHandle = new Map(PEOPLE.map(p => [p.handle, p]));
/** Null for the reader — the page draws the profile instead */
export const personOf = (handle: string): Person | null => byHandle.get(handle) ?? null;

export const fmtFollowers = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ---- this browser's store ------------------------------------------------------

const KEY = 'slayer_room_v1';
const EMPTY: RoomState = { posts: [], liked: [], saved: [], following: [] };

export function loadRoom(): RoomState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw) as Partial<RoomState>;
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { posts: Array.isArray(p.posts) ? (p.posts as Post[]) : [], liked: strings(p.liked), saved: strings(p.saved), following: strings(p.following) };
  } catch {
    return EMPTY;
  }
}

export function saveRoom(state: RoomState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage full or off — the room lives for the session */
  }
}

// ---- the small engines ----------------------------------------------------------

/** "17m", "3h", "2d" */
export function timeAgo(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const NAME_RE = /\$([A-Z]{1,5})\b/g;

export type Token = { kind: 'text'; text: string } | { kind: 'name'; text: string } | { kind: 'handle'; text: string };

/** The body cut into text, $names and @handles — the page draws the doors */
export function tokenize(body: string): Token[] {
  const out: Token[] = [];
  const re = /\$([A-Z]{1,5})\b|@([a-z0-9_]{2,24})/gi;
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ kind: 'text', text: body.slice(last, i) });
    if (m[1]) out.push({ kind: 'name', text: m[1].toUpperCase() });
    else out.push({ kind: 'handle', text: m[2]!.toLowerCase() });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ kind: 'text', text: body.slice(last) });
  return out;
}

/** The names a post mentions, first first, once each */
export function mentionsOf(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(NAME_RE)) seen.add(m[1]!.toUpperCase());
  return [...seen];
}

export interface Trend {
  name: string;
  posts: number;
  bullish: number;
  bearish: number;
  /** The room's lean on the name — null when split or unsaid */
  lean: Lean | null;
}

/** What the room is naming — every $name mentioned in the last `hours`, the most mentioned first */
export function trendingOf(posts: Post[], hours = 24): Trend[] {
  const since = Date.now() - hours * 3600_000;
  const m = new Map<string, Trend>();
  for (const p of posts) {
    if (new Date(p.at).getTime() < since) continue;
    for (const name of mentionsOf(p.body)) {
      const t = m.get(name) ?? { name, posts: 0, bullish: 0, bearish: 0, lean: null };
      t.posts += 1;
      if (p.lean === 'BULLISH') t.bullish += 1;
      if (p.lean === 'BEARISH') t.bearish += 1;
      m.set(name, t);
    }
  }
  return [...m.values()]
    .map((t): Trend => ({ ...t, lean: t.bullish > t.bearish ? 'BULLISH' : t.bearish > t.bullish ? 'BEARISH' : null }))
    .sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name));
}

/** What a settled setup made, in R — the move against the risk taken; null while open */
export function rMultiple(s: Setup): number | null {
  if (s.settledAt == null) return null;
  const risk = Math.abs(s.entry - s.stop);
  if (risk === 0) return null;
  const move = s.lean === 'BULLISH' ? s.settledAt - s.entry : s.entry - s.settledAt;
  return move / risk;
}

export const fmtR = (r: number) => `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}R`;

export interface Record {
  settled: number;
  hit: number;
  /** The sum of every settled setup's R */
  r: number;
}

/** The record a person builds — every setup of theirs that settled */
export function recordOf(handle: string, posts: Post[]): Record {
  const out: Record = { settled: 0, hit: 0, r: 0 };
  for (const p of posts) {
    if (p.handle !== handle || !p.setup || p.setup.state === 'OPEN') continue;
    out.settled += 1;
    if (p.setup.state === 'TARGET HIT') out.hit += 1;
    out.r += rMultiple(p.setup) ?? 0;
  }
  return out;
}
