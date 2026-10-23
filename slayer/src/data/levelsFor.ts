/*
==================================================
  SLAYER TERMINAL - ONE NAME'S LEVELS, ONE FUNCTION
  (data/levelsFor.ts)

  The retail test (2026-10-22): the Dossier stock page read the whole book's levels while Pinpoint defaults to today's
  contracts — SPY read put wall 760 / supreme 769 / flip 770.96 / call wall 780 on Pinpoint and 760 / 760 / 774.65 /
  800 on the Dossier, with nothing saying which was which. This is the one source: the same book, the same profile
  (data/exposure.ts buildExposureProfile — the Map's, the Board's, the Agenda's and Compare's), for either scope, named.
  Any page that prints a name's supreme, walls, flip, net GEX or regime reads it here and says the scope it read.
==================================================
*/
import { useEffect, useMemo } from 'react';
import { buildExposureProfile } from './exposure';
import { levelFlip, regimeOfNet } from './flipLevel';
import { levelsBook, levelsDate, levelsWords } from './bookWindow';
import { ensureScopeDates, scopeDatesPending, snapshotFor, useBookRev } from './uwBook';
import { LEVELS_WINDOW } from './roomLevels';
import { nyIsoDate } from '../core/nyTime';
import type { LevelsScope } from './levelsScope';

export interface TickerLevels {
  ticker: string;
  scope: LevelsScope;
  /** The scope in a reader's words: "Today · Oct 22", "Next session · Oct 23", "All expiries" */
  scopeLabel: string;
  /** The expiry the "Today" scope reads (YYYY-MM-DD), null for All expiries */
  date: string | null;
  spot: number;
  /** The strike with the most net gamma (either sign) on these contracts */
  supreme: number;
  /** The strike with the most call gamma — null when no strike carries any */
  callWall: number | null;
  /** The strike with the most put gamma — null when no strike carries any */
  putWall: number | null;
  /** Where net gamma, re-priced at each price, crosses zero — null when it does not within ±10% */
  flip: number | null;
  /** Net GEX on every strike of these contracts, dollars per 1% move, RETAIL sign (+ = dealers long gamma, absorbs) */
  netGex: number;
  /** LONG (absorbs) or SHORT (amplifies): the sign of netGex */
  regime: 'LONG' | 'SHORT' | null;
  /** False while some of the scope's expiries are still loading — the figures are then provisional */
  complete: boolean;
  /** Another crossing of the profile inside ±10% when it crosses more than once — the flip keeps its own (FLIP_RULE) */
  flipSecond: number | null;
  /** Today's moves of a level from one strike (or flip price) to another, newest last: "call wall moved 765 → 762 at 13:08" */
  moves: LevelMove[];
  /** One strike's net GEX on these contracts, RETAIL sign — null when the strike is not on them */
  netAt: (strike: number) => number | null;
  /** One strike's call leg, put leg and net on these contracts, RETAIL sign — a wall is printed by the leg that makes
      it (calls for the call wall, puts for the put wall), the supreme by its net (the sixth audit's m7) */
  legsAt: (strike: number) => { call: number; put: number; net: number } | null;
}

export interface LevelMove {
  level: 'call wall' | 'put wall' | 'supreme' | 'flip';
  from: number;
  to: number;
  /** Epoch ms the move was seen */
  at: number;
}

/*
  A LEVEL THAT CHANGES STRIKE TODAY SAYS SO (the ninth audit's retail finding: the call wall read 765 at 12:55 and 762 at
  13:08 with no note). Each final reading of a name's levels in a scope is compared with the last one this page saw today;
  a level on a new strike is kept as a move (the flip's own moves come from flipLevel's hysteresis). Kept for the New York
  day, in this page.
*/
/** Two flip prices within this print alike (the pages print the flip to the cent) */
const FLIP_SAME = 0.006;
const lastSeen = new Map<string, { callWall: number | null; putWall: number | null; supreme: number; flip: number | null; moves: LevelMove[] }>();
function trackMoves(key: string, lv: { callWall: number | null; putWall: number | null; supreme: number; flip: number | null; complete: boolean }, flipMoved: { from: number; at: number } | null | undefined): LevelMove[] {
  const prev = lastSeen.get(key);
  if (!lv.complete) return prev?.moves ?? [];
  const moves = [...(prev?.moves ?? [])];
  const now = Date.now();
  const note = (level: LevelMove['level'], from: number | null | undefined, to: number | null) => {
    if (from == null || to == null || Math.abs(from - to) < 1e-9) return;
    moves.push({ level, from, to, at: now });
  };
  if (prev) {
    note('call wall', prev.callWall, lv.callWall);
    note('put wall', prev.putWall, lv.putWall);
    note('supreme', prev.supreme, lv.supreme);
  }
  /* ONE NOTE PER FLIP MOVE (the tenth audit's M2: the re-priced flip drifts ~2e-4 a read, so the same move was logged twice
     — QQQ, AMZN, META, AMD, NFLX — and RegimeLine printed both): a move is the hold's own event (its `from` and the minute
     it was seen); a later read of the same event updates where it went, and two notes that would print the same at the
     page's precision are one */
  if (flipMoved && lv.flip != null) {
    const same = moves.findIndex(m => m.level === 'flip' && m.at === flipMoved.at && Math.abs(m.from - flipMoved.from) < FLIP_SAME);
    const twin = moves.some(m => m.level === 'flip' && Math.abs(m.from - flipMoved.from) < FLIP_SAME && Math.abs(m.to - lv.flip!) < FLIP_SAME);
    if (same >= 0) moves[same] = { ...moves[same], to: lv.flip };
    else if (!twin) moves.push({ level: 'flip', from: flipMoved.from, to: lv.flip, at: flipMoved.at });
  }
  /* …and a note whose two ends print alike says nothing */
  for (let i = moves.length - 1; i >= 0; i--) if (moves[i].level === 'flip' && Math.abs(moves[i].from - moves[i].to) < FLIP_SAME) moves.splice(i, 1);
  const kept = moves.slice(-8);
  lastSeen.set(key, { callWall: lv.callWall, putWall: lv.putWall, supreme: lv.supreme, flip: lv.flip, moves: kept });
  return kept;
}

/** One name's levels for a scope — null until its book is live */
export function levelsFor(ticker: string, scope: LevelsScope): TickerLevels | null {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  if (scope === 'ALL') ensureScopeDates(t, 'ALL');
  const snap = snapshotFor(t, scope);
  if (!snap) return null;
  /* one reading per state of the name's book (data/uwBook.ts materialize hands the same snapshot back until it moves) */
  const pending = scopeDatesPending(t, scope);
  const memo = levelsMemo.get(snap);
  if (memo && memo.scope === scope && memo.pending === pending) return memo.out;
  const out = levelsOf(t, scope, snap);
  levelsMemo.set(snap, { scope, pending, out });
  return out;
}
const levelsMemo = new WeakMap<object, { scope: LevelsScope; pending: boolean; out: TickerLevels | null }>();
function levelsOf(t: string, scope: LevelsScope, snap: NonNullable<ReturnType<typeof snapshotFor>>): TickerLevels | null {
  const book = levelsBook(snap, scope);
  let profile;
  try {
    profile = buildExposureProfile(snap, scope, LEVELS_WINDOW);
  } catch {
    return null;
  }
  const flip = levelFlip(book, book.chain);
  const house = book.chain.reduce((a, n) => a + n.netGex, 0);
  const lv = profile.levels;
  const hasCall = book.chain.some(n => n.callGex);
  const hasPut = book.chain.some(n => n.putGex);
  const complete = flip.complete && !scopeDatesPending(t, scope) && (scope === 'ALL' || levelsDate(snap, scope) != null);
  const date = levelsDate(snap, scope);
  const moves = trackMoves(`${t}|${scope}|${date ?? 'ALL'}|${nyIsoDate()}`, { callWall: hasCall ? lv.callWall : null, putWall: hasPut ? lv.putWall : null, supreme: lv.supreme, flip: flip.flip, complete }, flip.moved);
  return {
    ticker: t,
    scope,
    scopeLabel: levelsWords(snap, scope),
    date: levelsDate(snap, scope),
    spot: snap.spot,
    supreme: lv.supreme,
    callWall: hasCall ? lv.callWall : null,
    putWall: hasPut ? lv.putWall : null,
    flip: flip.flip,
    netGex: house === 0 ? 0 : -house,
    regime: regimeOfNet(house),
    /* "Today" before its own expiry's chain is in reads the whole book — never final */
    netAt: (k: number) => {
      const n = book.chain.find(x => x.strike === k);
      return n ? (n.netGex === 0 ? 0 : -n.netGex) : null;
    },
    legsAt: (k: number) => {
      const n = book.chain.find(x => x.strike === k);
      const r = (v: number) => (v === 0 ? 0 : -v);
      return n ? { call: r(n.callGex), put: r(n.putGex), net: r(n.netGex) } : null;
    },
    complete,
    flipSecond: flip.second ?? null,
    moves,
  };
}

/** The hook: both scopes' levels for a name, kept fresh as its book lands */
export function useLevelsFor(ticker: string | null | undefined, scope: LevelsScope): TickerLevels | null {
  const rev = useBookRev();
  useEffect(() => {
    if (ticker && scope === 'ALL') ensureScopeDates(ticker.toUpperCase(), 'ALL');
  }, [ticker, scope]);
  return useMemo(() => (ticker ? levelsFor(ticker, scope) : null), [ticker, scope, rev]);
}
