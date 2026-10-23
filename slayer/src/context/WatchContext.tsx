/*
==================================================
  SLAYER TERMINAL - WATCH CONTEXT (the Trace bookmarks)

  One store for everything a reader bookmarks on
  the Trace pages (Noah, 2026-09-03: "a bookmark
  ability by each tape ticker like how live tape
  has it already… for the other subpages"). Until
  now the tape's star and the card's "Track this
  print" wrote to page-local sets that died on the
  next navigation, and the Tracker tab was a
  scaffold with nowhere to read from.

  Three kinds of thing get watched, because the
  pages deal in three units:
    print      one execution off the tape — the
               thing that printed, as it printed
    contract   a whole contract off a book page
               (Screener, Footprints, Watchers,
               Windows, or the card) — keyed by
               ticker · strike · right · expiry so
               it survives the day rolling over
    structure  a multi-leg trade off Multi-Leg

  Every item carries WHEN it was watched, WHERE
  from, and a snapshot of what it looked like then —
  the Tracker's whole job is "what has it done
  since", and that needs a then. Persisted.
==================================================
*/

import type { DarkPoolIntent, DarkPoolPrint } from '../types/darkpool';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { BookContract, FlowPrint } from '../types/trace';
import type { SpreadTrade } from '../data/flowBook';

const STORAGE_KEY = 'slayer_trace_watch';

export type WatchKind = 'print' | 'contract' | 'structure' | 'cross';
export type WatchSource = 'tape' | 'screener' | 'footprints' | 'watchers' | 'windows' | 'multi-leg' | 'card' | 'dark-pool';

interface WatchBase {
  key: string;
  kind: WatchKind;
  ticker: string;
  /** Epoch ms */
  watchedAt: number;
  from: WatchSource;
}

export interface WatchedContract extends WatchBase {
  kind: 'contract';
  strike: number;
  right: 'C' | 'P';
  /** MM/DD/YYYY */
  expiry: string;
  /** The contract's facts at the moment it was watched — the Tracker's "then" */
  at: { dte: number; spot: number; last: number; chgPct: number; volume: number; oi: number; premium: number; askPct: number; lastAt?: string };
  /** The vendor's OCC symbol — the Tracker reads the contract's own day by it (optional: older marks carry none) */
  occ?: string;
}

export interface WatchedPrint extends WatchBase {
  kind: 'print';
  strike: number;
  right: 'C' | 'P';
  expiry: string;
  dte: number;
  time: string;
  size: number;
  fill: number;
  premium: number;
  side: 'ASK' | 'BID' | 'MID';
  sweep: boolean;
  /** One leg of a multi-leg order — half of a structure, never read bullish or bearish when reopened (audit round 8) */
  multi?: boolean;
  /** The underlying and the contract's day when it printed — `daySide` the contract's day by side at the mark, so the
      Tracker's "lean then" is the lean when it was marked (audit round 8: "— → EVEN" on a print marked at ask 54%) */
  at: { spot: number; volume: number; oi: number; daySide?: { ask: number; bid: number; mid: number } };
  occ?: string;
}

export interface WatchedStructure extends WatchBase {
  kind: 'structure';
  spreadKind: string;
  strikesLabel: string;
  expiry: string;
  dte: number;
  time: string;
  size: number;
  /** Per UNIT: positive = debit paid, negative = credit collected (older marks: the vendor's net price) */
  net: number;
  /** The net premium that changed hands, dollars, signs dropped (older marks: the gross of every leg — see `gross`) */
  premium: number;
  /** Signed net premium: + paid, − collected — newer marks only */
  netPremium?: number;
  /** The gross of every leg — newer marks only */
  gross?: number;
  /** Units (the legs' common factor) — newer marks only; `size` holds the same */
  units?: number;
  at: { spot: number };
}

/** A DARK-POOL CROSS under watch (2026-10-19; Noah: "you should also be able to save and bookmark it for it to be seen
    in the tracker") — the cross's own figures and its read, with the stock where it stood */
export interface WatchedCross extends WatchBase {
  kind: 'cross';
  id: number;
  time: string;
  price: number;
  size: number;
  notional: number;
  venue: string;
  intent: DarkPoolIntent;
  conviction: number;
  read: string;
  vsSpotPct: number;
  atLevel: boolean;
  sized: boolean;
  at: { spot: number };
}

export type WatchedItem = WatchedContract | WatchedPrint | WatchedStructure | WatchedCross;

// ---- keys and builders ---------------------------------------------------------

export const contractKey = (c: { ticker: string; strike: number; right: 'C' | 'P'; expiry: string }) =>
  `c:${c.ticker}:${c.strike}:${c.right}:${c.expiry}`;

/** A print's key is its CONTENT, not its tape id — ids restart with the
    session, the print itself does not. */
export const printKey = (p: FlowPrint) => `p:${p.ticker}:${p.strike}:${p.right}:${p.expiry}:${p.time}:${p.size}:${p.fill}`;

/** A cross's key is its content too — the name, the minute, the price and the shares */
export const crossKey = (p: Pick<DarkPoolPrint, 'ticker' | 'time' | 'price' | 'size'>) => `x:${p.ticker}:${p.time}:${p.price}:${p.size}`;
export const watchedCross = (p: DarkPoolPrint, spot: number, from: WatchSource = 'dark-pool'): WatchedCross => ({
  key: crossKey(p),
  kind: 'cross',
  ticker: p.ticker,
  watchedAt: Date.now(),
  from,
  id: p.id,
  time: p.time,
  price: p.price,
  size: p.size,
  notional: p.notional,
  venue: p.venue,
  intent: p.intent,
  conviction: p.conviction,
  read: p.read,
  vsSpotPct: p.vsSpotPct,
  atLevel: p.atLevel,
  sized: p.sized,
  at: { spot },
});
/** The cross back from its watch, for the card */
export const crossOfWatch = (w: WatchedCross): DarkPoolPrint => ({
  id: w.id,
  time: w.time,
  ticker: w.ticker,
  price: w.price,
  size: w.size,
  notional: w.notional,
  venue: w.venue,
  vsSpotPct: w.vsSpotPct,
  atLevel: w.atLevel,
  sized: w.sized,
  intent: w.intent,
  conviction: w.conviction,
  read: w.read,
});

export const structureKey = (t: SpreadTrade) => `s:${t.ticker}:${t.id}`;

export const watchContract = (r: BookContract, from: WatchSource): WatchedContract => ({
  key: contractKey(r),
  kind: 'contract',
  ticker: r.ticker,
  strike: r.strike,
  right: r.right,
  expiry: r.expiry,
  watchedAt: Date.now(),
  from,
  at: { dte: r.dte, spot: r.spot, last: r.last, chgPct: r.chgPct, volume: r.volume, oi: r.oi, premium: r.premium, askPct: r.askPct, lastAt: r.lastAt && r.lastAt !== '—' ? r.lastAt : undefined },
  occ: r.optionSymbol,
});

export const watchPrint = (p: FlowPrint, from: WatchSource): WatchedPrint => ({
  key: printKey(p),
  kind: 'print',
  ticker: p.ticker,
  strike: p.strike,
  right: p.right,
  expiry: p.expiry,
  dte: p.dte,
  time: p.time,
  size: p.size,
  fill: p.fill,
  premium: p.premium,
  side: p.side,
  sweep: p.sweep,
  multi: p.legs > 1 || undefined,
  watchedAt: Date.now(),
  from,
  at: { spot: p.spot, volume: p.volume, oi: p.oi, daySide: p.daySide },
  occ: p.occ,
});

export const watchStructure = (t: SpreadTrade, from: WatchSource): WatchedStructure => ({
  key: structureKey(t),
  kind: 'structure',
  ticker: t.ticker,
  spreadKind: t.kind,
  strikesLabel: t.strikesLabel,
  expiry: t.expiry,
  dte: t.dte,
  time: t.time,
  /* THE MONEY THAT CHANGED HANDS (the re-audit, 2026-10-22: a structure's "Then $18.1K" was the gross of its legs; it
     collected $2.35K) — units and the per-unit net from its settled legs, the net premium beside the gross */
  size: t.units ?? t.size,
  net: t.net,
  premium: t.netKnown === false ? t.premium : Math.abs(t.netPremium),
  netPremium: t.netKnown === false ? undefined : t.netPremium,
  gross: t.premium,
  units: t.units,
  watchedAt: Date.now(),
  from,
  at: { spot: t.spot },
});

// ---- storage -------------------------------------------------------------------

const KINDS = new Set<string>(['print', 'contract', 'structure', 'cross']);

/** One malformed row must never take a page down — the Tracker's own rule. */
function isValid(v: unknown): v is WatchedItem {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.key === 'string' &&
    typeof o.kind === 'string' &&
    KINDS.has(o.kind) &&
    typeof o.ticker === 'string' &&
    typeof o.watchedAt === 'number' &&
    typeof o.from === 'string' &&
    typeof o.at === 'object' &&
    o.at !== null
  );
}

function load(): WatchedItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const valid = parsed.filter(isValid);
    /* The Trace page "Flow Alerts" became Watchers on 2026-09-11 — a mark taken
       there before that day keeps its source under the new name */
    let renamed = 0;
    for (const it of valid) {
      if ((it.from as string) === 'flow-alerts') {
        it.from = 'watchers';
        renamed++;
      }
    }
    if (valid.length !== parsed.length || renamed > 0) save(valid);
    return valid;
  } catch {
    return [];
  }
}

function save(items: WatchedItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* storage full or off — the session still works */
  }
}

// ---- the context ---------------------------------------------------------------

interface WatchValue {
  watched: WatchedItem[];
  isWatched: (key: string) => boolean;
  /** Add when absent, remove when present — the star's one gesture. */
  toggle: (item: WatchedItem) => void;
  unwatch: (key: string) => void;
}

const WatchContext = createContext<WatchValue | null>(null);

export const WatchProvider = ({ children }: { children: React.ReactNode }) => {
  const [watched, setWatched] = useState<WatchedItem[]>(load);
  const keys = useMemo(() => new Set(watched.map(w => w.key)), [watched]);

  const isWatched = useCallback((key: string) => keys.has(key), [keys]);
  const toggle = useCallback((item: WatchedItem) => {
    setWatched(prev => {
      const next = prev.some(w => w.key === item.key) ? prev.filter(w => w.key !== item.key) : [...prev, item];
      save(next);
      return next;
    });
  }, []);
  const unwatch = useCallback((key: string) => {
    setWatched(prev => {
      const next = prev.filter(w => w.key !== key);
      save(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ watched, isWatched, toggle, unwatch }), [watched, isWatched, toggle, unwatch]);
  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
};

export const useWatch = (): WatchValue => {
  const ctx = useContext(WatchContext);
  if (!ctx) throw new Error('useWatch must be used within a WatchProvider');
  return ctx;
};
