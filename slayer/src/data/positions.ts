/* The positions the reader owns or sold, kept per name, and how each reads against the day's dealer map: where it
   sits, whether hedging works with it, and when it expires. */

import { useMemo, useSyncExternalStore } from 'react';
import { expiryFor, isoDate, sessionsBetween, today } from '../core/calendar';
import type { ExposureProfileData } from '../types/gex';
import { fmtStrike } from '../core/format';

export type Right = 'C' | 'P';
export type Side = 'long' | 'short';

export interface Position {
  id: string;
  ticker: string;
  strike: number;
  right: Right;
  /** long = you own it, short = you sold it */
  side: Side;
  contracts: number;
  /** YYYY-MM-DD */
  expiry: string;
  /** What you paid (or collected) per share. Absent until you type it, or until a live mark is stamped. */
  entry?: number;
  /** The live mark at the moment it was added, when no price was typed. Never a model. */
  addedMark?: number;
  /** The session you entered, YYYY-MM-DD. Absent on rows saved before this — those use the day they were added. */
  enteredOn?: string;
  source: 'you' | 'tracker';
  addedAt: number;
}

/** v2: the key moved once with the watchlist's so the Weigher opened on a clean list for the walk */
const KEY = 'slayer_positions_v2';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function isPosition(x: unknown): x is Position {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.ticker === 'string' &&
    typeof p.strike === 'number' &&
    Number.isFinite(p.strike) &&
    (p.right === 'C' || p.right === 'P') &&
    (p.side === 'long' || p.side === 'short') &&
    typeof p.contracts === 'number' &&
    typeof p.expiry === 'string' &&
    ISO.test(p.expiry) &&
    (p.entry === undefined || (typeof p.entry === 'number' && Number.isFinite(p.entry) && p.entry >= 0)) &&
    (p.addedMark === undefined || (typeof p.addedMark === 'number' && Number.isFinite(p.addedMark) && p.addedMark >= 0)) &&
    (p.enteredOn === undefined || (typeof p.enteredOn === 'string' && ISO.test(p.enteredOn))) &&
    (p.source === 'you' || p.source === 'tracker') &&
    typeof p.addedAt === 'number'
  );
}

function load(): Position[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isPosition) : [];
  } catch {
    return [];
  }
}

let positions: Position[] = load();
const listeners = new Set<() => void>();

function commit(next: Position[]): void {
  positions = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — the session keeps its list in memory */
  }
  listeners.forEach(l => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => positions;

/** Every position, or one name's — stable identity until something changes */
export function getPositions(ticker?: string): Position[] {
  return ticker ? positions.filter(p => p.ticker === ticker) : positions;
}

export function usePositions(ticker: string | null | undefined): Position[] {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => (ticker ? all.filter(p => p.ticker === ticker) : []), [all, ticker]);
}

/** Every position on every name — the Weigher's list */
export function useAllPositions(): Position[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

let seq = 0;
const newId = () => `pos-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function addPosition(p: Omit<Position, 'id' | 'addedAt' | 'source' | 'addedMark'> & { source?: Position['source']; addedMark?: number; enteredOn?: string }): Position {
  const pos: Position = { ...p, source: p.source ?? 'you', id: newId(), addedAt: Date.now() };
  if (pos.addedMark == null) delete pos.addedMark;
  commit([...positions, pos]);
  return pos;
}

export function updatePosition(id: string, patch: Partial<Pick<Position, 'strike' | 'right' | 'side' | 'contracts' | 'expiry' | 'entry' | 'enteredOn' | 'addedMark'>>): void {
  commit(
    positions.map(p => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      if (patch.entry === undefined && 'entry' in patch) delete next.entry;
      return next;
    })
  );
}

export function removePosition(id: string): void {
  commit(positions.filter(p => p.id !== id));
}

/** Today's session as an expiry string — the default for a new position */
export const todayExpiry = (): string => isoDate(expiryFor(0).date);

// ---- THE READ: the position on the dealer map, in words --------------------------

export type Verdict = 'with' | 'against' | 'mixed';

interface PositionRead {
  /** "on the put wall · the supreme · 0.20% below spot" */
  sits: string;
  verdict: Verdict;
  /** The hedging sentence, no subject: "hedging works against you — …" */
  hedging: string;
  /** Net gamma at the strike, $ per 1% move; 0 when the strike is outside the window */
  gammaHere: number;
  /** What that gamma does to a move through the strike */
  through: 'slows it' | 'speeds it up' | null;
  /** "today at 4:00" · "next trading day" · "in 5 trading days" · "expired" */
  expires: string;
  /** Trading sessions until expiry; -1 once it has passed */
  sessions: number;
  /** The whole thing, subject included — the line the gutter chip and the box print */
  sentence: string;
}

const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** "5 calls" / "1 put" */
export function contractWords(p: Position): string {
  const kind = p.right === 'C' ? 'call' : 'put';
  return `${p.contracts} ${kind}${p.contracts === 1 ? '' : 's'}`;
}

/** "Your 5 455 calls" · "Your 455 call" · "The 2 455 puts you sold" · "The 455 put you sold" */
function subjectWords(p: Position): string {
  const one = p.contracts === 1;
  const kind = `${fmtStrike(p.strike)} ${p.right === 'C' ? 'call' : 'put'}${one ? '' : 's'}`;
  const count = one ? '' : `${p.contracts} `;
  return p.side === 'long' ? `Your ${count}${kind}` : `The ${count}${kind} you sold`;
}

function expiryWords(expiry: string): { expires: string; sessions: number } {
  const [y, m, d] = expiry.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const t = today();
  if (date < t) return { expires: 'expired', sessions: -1 };
  const sessions = sessionsBetween(t, date);
  if (sessions === 0) return { expires: 'today at 4:00', sessions };
  if (sessions === 1) return { expires: 'next trading day', sessions };
  return { expires: `in ${sessions} trading days`, sessions };
}

export function readPosition(p: Position, profile: ExposureProfileData): PositionRead {
  const L = profile.levels;
  const spot = L.spot;
  const row = profile.strikes.find(s => eq(s.strike, p.strike));
  const gammaHere = row ? row.gex.net : 0;
  const big = profile.maxAbs.gex > 0 && Math.abs(gammaHere) >= 0.35 * profile.maxAbs.gex;
  const through: PositionRead['through'] = !row || !big ? null : gammaHere > 0 ? 'speeds it up' : 'slows it';

  /* Where it sits — the named level it is on, else where against spot and the walls */
  const on: string[] = [];
  if (eq(p.strike, L.callWall)) on.push('on the call wall');
  if (eq(p.strike, L.putWall)) on.push('on the put wall');
  if (eq(p.strike, L.pin)) on.push('on the gamma pin');
  if (eq(p.strike, L.supreme)) on.push('the supreme strike');
  const d = ((p.strike - spot) / spot) * 100;
  const rel = Math.abs(d) < 0.05 ? 'at spot' : `${Math.abs(d).toFixed(2)}% ${d > 0 ? 'above' : 'below'} spot`;
  const zone = p.strike > L.callWall ? 'past the call wall' : p.strike < L.putWall ? 'under the put wall' : 'between the walls';
  const sits = on.length ? `${on.join(' · ')} · ${rel}` : `${rel} · ${zone}`;

  /* Above the flip dealers lean against moves (damped, pinned); below it they chase them. A buyer needs the move, so
     chasing helps; a seller needs the price to stay away from the strike, so damping helps. A wall between spot and
     the strike blocks the move either way. */
  const absorbing = spot > L.flip;
  const flip = fmtStrike(L.flip);
  const up = p.right === 'C';
  const wallInWay = up ? p.strike > L.callWall && L.callWall > spot : p.strike < L.putWall && L.putWall < spot;
  const wallWords = up ? `the call wall at ${fmtStrike(L.callWall)}` : `the put wall at ${fmtStrike(L.putWall)}`;
  const moveWord = up ? 'rallies' : 'the move down';
  let verdict: Verdict;
  let hedging: string;
  if (p.side === 'long') {
    if (absorbing) {
      verdict = 'against';
      hedging = `hedging works against you — above the flip at ${flip} dealers lean against ${moveWord}`;
      if (wallInWay) hedging += `, and ${wallWords} stands between spot and your strike`;
    } else if (wallInWay) {
      verdict = 'mixed';
      hedging = `hedging works with you under the flip at ${flip} — dealers chase ${moveWord} — but ${wallWords} stands between spot and your strike`;
    } else {
      verdict = 'with';
      hedging = `hedging works with you while price is under the flip at ${flip} — dealers chase ${moveWord}; above it they lean against it`;
    }
  } else if (absorbing) {
    verdict = 'with';
    hedging = `hedging works with you — above the flip at ${flip} dealers damp the moves, which helps a seller`;
    if (wallInWay) hedging += `, and ${wallWords} stands between spot and your strike`;
  } else if (wallInWay) {
    verdict = 'mixed';
    hedging = `hedging works against you under the flip at ${flip} — dealers chase ${moveWord} — but ${wallWords} stands between spot and your strike`;
  } else {
    verdict = 'against';
    hedging = `hedging works against you while price is under the flip at ${flip} — dealers chase ${moveWord} toward your strike`;
  }

  const { expires, sessions } = expiryWords(p.expiry);
  const sentence = `${subjectWords(p)} sit${p.contracts === 1 ? 's' : ''} ${sits}. ${hedging[0].toUpperCase()}${hedging.slice(1)}. ${sessions < 0 ? 'Expired.' : `Expires ${expires}.`}`;
  return { sits, verdict, hedging, gammaHere, through, expires, sessions, sentence };
}
