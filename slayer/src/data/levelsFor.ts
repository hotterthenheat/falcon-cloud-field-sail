/* One name's levels, one function: the same book and profile (exposure.ts buildExposureProfile) for either scope, named.
   Any page printing a supreme, walls, flip, net GEX or regime reads it here and says the scope. */
import { useEffect, useMemo } from 'react';
import { buildExposureProfile } from './exposure';
import { levelFlip, regimeOfNet } from './flipLevel';
import { levelsBook, levelsDate, levelsWords } from './bookWindow';
import { ensureScopeDates, scopeDatesPending } from './book/load';
import { snapshotFor } from './book/feed';
import { useBookRev } from './book/store';
import { bookInMode, bookMode, useBookMode } from './bookMode';
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
  /** Net gamma re-priced AT spot (core/gammaFlip.ts), RETAIL sign — netGex when the book was priced at spot; before the
      open (the rows marked at the close, spot the pre-market print) the same contracts at the price they are at now */
  netAtSpot: number;
  /** LONG (absorbs) or SHORT (amplifies): the sign of netAtSpot — the ONE regime rule (flipLevel.ts regimeOfNet), the
      same curve the flip is the zero of, so the regime and the side of the flip never disagree */
  regime: 'LONG' | 'SHORT' | null;
  /** False while some of the scope's expiries are still loading — the figures are then provisional */
  complete: boolean;
  /** The walls and the supreme are read off the scope's own contracts — false while another book stands in for them
      ("Today" before its date's chain is in reads the whole book). A page draws no wall while this is false. `complete`
      also waits on the flip's pricing. */
  wallsFinal: boolean;
  /** Another crossing of the profile inside ±10% when it crosses more than once — the flip keeps its own (FLIP_RULE) */
  flipSecond: number | null;
  /** Today's moves of a level from one strike (or flip price) to another, newest last: "call wall moved 765 → 762 at 13:08" */
  moves: LevelMove[];
  /** One strike's net GEX on these contracts, RETAIL sign — null when the strike is not on them */
  netAt: (strike: number) => number | null;
  /** One strike's call leg, put leg and net on these contracts, retail sign; a wall is printed by its own leg, the supreme by its net. */
  legsAt: (strike: number) => { call: number; put: number; net: number } | null;
}

export interface LevelMove {
  level: 'call wall' | 'put wall' | 'supreme' | 'flip';
  from: number;
  to: number;
  /** Epoch ms the move was seen */
  at: number;
}

/* A level that changes strike today says so: each final reading per scope is compared with the last one this page saw today,
   and a level on a new strike is kept as a move (the flip's own moves come from flipLevel's hysteresis). */
/** Two flip prices within this print alike (the pages print the flip to the cent) */
const FLIP_SAME = 0.006;
const lastSeen = new Map<string, { callWall: number | null; putWall: number | null; supreme: number; flip: number | null; moves: LevelMove[] }>();
function trackMoves(key: string, lv: { callWall: number | null; putWall: number | null; supreme: number; flip: number | null; complete: boolean }, flipMoved: { from: number; at: number } | null | undefined): LevelMove[] {
  const prev = lastSeen.get(key);
  if (!lv.complete) return prev?.moves ?? [];
  const moves = [...(prev?.moves ?? [])];
  const now = Date.now();
  const note = (level: LevelMove['level'], from: number | null | undefined, to: number | null) => {
    if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || Math.abs(from - to) < 1e-9) return;
    moves.push({ level, from, to, at: now });
  };
  if (prev) {
    note('call wall', prev.callWall, lv.callWall);
    note('put wall', prev.putWall, lv.putWall);
    note('supreme', prev.supreme, lv.supreme);
  }
  /* One note per flip move: a move is the hold's own event (its `from` and the minute seen); later reads of it update where it went. */
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
  const read = snapshotFor(t, scope);
  if (!read) return null;
  /* the book the desk's toggle names (data/bookMode.ts): on Open interest the snapshot itself */
  const snap = bookInMode(read, bookMode());
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
  /* the walls and the supreme are final once the scope's own contracts are in: "Today" before its date's chain lands reads
     the whole book (a different book, whose walls are not the day's), and All expiries before every date has landed */
  const wallsFinal = scope === 'ALL' ? !scopeDatesPending(t, 'ALL') : levelsDate(snap, scope) != null;
  const complete = flip.complete && wallsFinal;
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
    netAtSpot: flip.netAtSpot === 0 ? 0 : -flip.netAtSpot,
    regime: regimeOfNet(flip.netAtSpot),
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
    wallsFinal,
    flipSecond: flip.second ?? null,
    moves,
  };
}

/** One name's levels on a single expiry (YYYY-MM-DD), read off that date's rows the book already holds: no new call.
    The date's chain stands in for the "Today" chain, so `scope` reads '0DTE' and `date` names the expiry. Null until
    the book is live or while the date holds no strikes. */
export function levelsForDate(ticker: string, date: string): TickerLevels | null {
  const t = ticker.trim().toUpperCase();
  if (!t || !date) return null;
  const read = snapshotFor(t, '0DTE');
  const front = read ? bookInMode(read, bookMode()) : read;
  const rows = front?.uwByDate?.[date];
  if (!front || !rows?.length) return null;
  if (front.uwChains?.['0DTE'] === rows) return levelsFor(t, '0DTE');
  let byDate = dateSnaps.get(front);
  if (!byDate) dateSnaps.set(front, (byDate = new Map()));
  let snap = byDate.get(date);
  if (!snap || snap.chain !== rows) {
    snap = { ...front, chain: rows, uwChains: { ...front.uwChains, '0DTE': rows } };
    byDate.set(date, snap);
  }
  const memo = levelsMemo.get(snap);
  if (memo) return memo.out;
  const out = levelsOf(t, '0DTE', snap);
  levelsMemo.set(snap, { scope: '0DTE', pending: false, out });
  return out;
}
/* One derived snapshot per (front snapshot, date), so the memo above holds while the book stands still */
const dateSnaps = new WeakMap<object, Map<string, NonNullable<ReturnType<typeof snapshotFor>>>>();

/** The hook: both scopes' levels for a name, kept fresh as its book lands. A `date` reads that one expiry instead. */
export function useLevelsFor(ticker: string | null | undefined, scope: LevelsScope, date?: string | null): TickerLevels | null {
  const rev = useBookRev();
  /* the Open interest / Flow toggle re-reads the levels */
  const mode = useBookMode();
  useEffect(() => {
    if (ticker && scope === 'ALL' && !date) ensureScopeDates(ticker.toUpperCase(), 'ALL');
  }, [ticker, scope, date]);
  return useMemo(() => (!ticker ? null : date ? levelsForDate(ticker, date) : levelsFor(ticker, scope)), [ticker, scope, date, rev, mode]);
}
