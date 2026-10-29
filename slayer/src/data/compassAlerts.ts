/* Compass call alerts. Off until the reader turns them on. Empty names means every name. 0DTE and 1–7 DTE are
   separate switches. */

import { useEffect, useState } from 'react';

const KEY = 'slayer_compass_alert_v1';

interface CompassAlertPref {
  /** 'off' is quiet. 'all' is every name on that sleeve. A list is only those names. */
  odte: 'off' | 'all' | string[];
  swing: 'off' | 'all' | string[];
}

interface CompassPing {
  id: string;
  ticker: string;
  contract: string;
  at: number;
  sleeve: string;
}

const def: CompassAlertPref = { odte: 'off', swing: 'off' };
let pref: CompassAlertPref = def;
let pings: CompassPing[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function namesOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((t): t is string => typeof t === 'string' && /^[A-Z]{1,6}$/.test(t)))];
}

function bookOf(raw: unknown): CompassAlertPref['odte'] {
  if (raw === 'all' || raw === 'off') return raw;
  const names = namesOf(raw);
  return names.length ? names : 'off';
}

function load(): CompassAlertPref {
  if (typeof localStorage === 'undefined') return def;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<CompassAlertPref> & { on?: boolean; sleeve?: string; tickers?: unknown } | null;
    if (!raw || typeof raw !== 'object') return def;
    if (raw.odte != null || raw.swing != null) return { odte: bookOf(raw.odte), swing: bookOf(raw.swing) };
    if (raw.on !== true) return def;
    const tickers = namesOf(raw.tickers);
    const book = tickers.length ? tickers : 'all';
    const sleeve = raw.sleeve === 'odte' || raw.sleeve === 'swing' || raw.sleeve === 'both' ? raw.sleeve : 'both';
    return {
      odte: sleeve === 'swing' ? 'off' : book,
      swing: sleeve === 'odte' ? 'off' : book,
    };
  } catch {
    return def;
  }
}

pref = load();

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch { /* the switch still stands in this tab */ }
}

export function useCompassAlert(): CompassAlertPref {
  const [row, setRow] = useState(pref);
  useEffect(() => {
    const fn = () => setRow(pref);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return row;
}

export function setCompassAlert(next: Partial<CompassAlertPref>): void {
  pref = {
    odte: next.odte ?? pref.odte,
    swing: next.swing ?? pref.swing,
  };
  save();
  emit();
}

function hears(book: CompassAlertPref['odte'], ticker: string): boolean {
  if (book === 'off') return false;
  if (book === 'all') return true;
  return book.includes(ticker);
}

export function noteCompassCall(pick: { id: string; ticker: string; contract: string; expiry: string }): void {
  const odte = pick.expiry === '0DTE';
  if (!hears(odte ? pref.odte : pref.swing, pick.ticker)) return;
  if (pings.some(p => p.id === pick.id)) return;
  pings = [{ id: pick.id, ticker: pick.ticker, contract: pick.contract, at: Date.now(), sleeve: odte ? '0DTE' : '1–7 DTE' }, ...pings].slice(0, 12);
  emit();
}

/** The calls the reader asked to hear, newest first. */
export function useCompassPings(): CompassPing[] {
  const [row, setRow] = useState(pings);
  useEffect(() => {
    const fn = () => setRow(pings);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return row;
}
