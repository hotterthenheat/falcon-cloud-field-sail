/* One persisted store for everything a reader marks on Trace: prints, whole contracts, structures and dark crosses,
   each with when and where it was marked and a snapshot of it then, so the Tracker can say what it has done since. */

import type { DarkPoolIntent, DarkPoolPrint } from '../types/darkpool';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { BookContract, FlowPrint } from '../types/trace';
import type { SpreadTrade } from '../data/flowBook';
import { liveSpotOf } from '../core/liveSpots';

const STORAGE_KEY = 'slayer_trace_watch';

type WatchKind = 'print' | 'contract' | 'structure' | 'cross';
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
  /** One leg of a multi-leg order: never read bullish or bearish when reopened */
  multi?: boolean;
  /** The underlying and the contract's day when it printed; `daySide` is the lean then */
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
  /** Per unit: positive = debit paid, negative = credit collected (older marks: the vendor's net price) */
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

/** A dark-pool cross under watch: its own figures and read, with the stock where it stood */
export interface WatchedCross extends WatchBase {
  kind: 'cross';
  id: number;
  /** The cross's New York day, YYYY-MM-DD */
  dateIso?: string;
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

const NY_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
/** The New York day of an instant, '' without one */
const dayOf = (ms?: number) => (ms && ms > 0 ? NY_DAY.format(new Date(ms)) : '');

export const contractKey = (c: { ticker: string; strike: number; right: 'C' | 'P'; expiry: string }) =>
  `c:${c.ticker}:${c.strike}:${c.right}:${c.expiry}`;

/** A print's key is its content and its day: tape ids restart with the session, and a clock repeats every day */
export const printKey = (p: FlowPrint) => `p:${dayOf(p.epochMs ?? (p.epoch ? p.epoch * 1000 : undefined))}:${p.ticker}:${p.strike}:${p.right}:${p.expiry}:${p.time}:${p.size}:${p.fill}`;

/** A cross's key is its content and its day too */
export const crossKey = (p: Pick<DarkPoolPrint, 'ticker' | 'time' | 'price' | 'size' | 'epochMs' | 'dateIso'>) => `x:${p.dateIso || dayOf(p.epochMs)}:${p.ticker}:${p.time}:${p.price}:${p.size}`;
export const watchedCross = (p: DarkPoolPrint, spot: number, from: WatchSource = 'dark-pool'): WatchedCross => ({
  key: crossKey(p),
  kind: 'cross',
  ticker: p.ticker,
  watchedAt: Date.now(),
  from,
  id: p.id,
  dateIso: p.dateIso || dayOf(p.epochMs) || undefined,
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
  dateIso: w.dateIso ?? (/^x:(\d{4}-\d{2}-\d{2}):/.exec(w.key)?.[1] || undefined),
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
  /* the spot at mark time is the live one, not the screener's frozen stock state */
  at: { dte: r.dte, spot: liveSpotOf(r.ticker) || r.spot, last: r.last, chgPct: r.chgPct, volume: r.volume, oi: r.oi, premium: r.premium, askPct: r.askPct, lastAt: r.lastAt && r.lastAt !== '—' ? r.lastAt : undefined },
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
  /* the money that changed hands: units and per-unit net from the settled legs, the net beside the gross */
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
    /* old sources keep their new name; print and cross keys taken before keys carried a day get the mark's day */
    let renamed = 0;
    for (const it of valid) {
      if ((it.from as string) === 'flow-alerts') {
        it.from = 'watchers';
        renamed++;
      }
      if ((it.kind === 'print' || it.kind === 'cross') && !/^[px]:\d{4}-\d{2}-\d{2}:/.test(it.key) && !/^[px]::/.test(it.key)) {
        it.key = `${it.key.slice(0, 2)}${dayOf(it.watchedAt)}:${it.key.slice(2)}`;
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
    /* storage full or off: the session still works */
  }
}

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
