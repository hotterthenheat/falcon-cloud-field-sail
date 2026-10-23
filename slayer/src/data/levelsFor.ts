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
  /** One strike's net GEX on these contracts, RETAIL sign — null when the strike is not on them */
  netAt: (strike: number) => number | null;
}

/** One name's levels for a scope — null until its book is live */
export function levelsFor(ticker: string, scope: LevelsScope): TickerLevels | null {
  const t = ticker.trim().toUpperCase();
  if (!t) return null;
  if (scope === 'ALL') ensureScopeDates(t, 'ALL');
  const snap = snapshotFor(t, scope);
  if (!snap) return null;
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
    complete: flip.complete && !scopeDatesPending(t, scope) && (scope === 'ALL' || levelsDate(snap, scope) != null),
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
