/* A Dossier page's view for the visit (sessionStorage): its controls as the reader left them, so back from a name's
   page — or another page of the Dossier — the page is as it was. News kept its view first; the Stocks, Earnings,
   Insiders and Congress pages keep theirs the same way. Every kept value is checked against the page's own options on
   the way back in; a value the page no longer offers falls back to the page's default. */

import { useEffect } from 'react';

/** The kept view under `key`, unchecked, or null (none kept, storage blocked, or not JSON) */
export function readKeptView(key: string): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function writeKeptView(key: string, view: object): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(view));
  } catch {
    /* storage blocked: the view lives for the visit only */
  }
}

/** A kept pick, if the page's options still offer it; else the default */
export const keptPick = <T,>(options: readonly { value: T }[], v: unknown, fallback: T): T => (options.some(o => o.value === v) ? (v as T) : fallback);

/** A kept list of strings (a filter's picks), at most `max` */
export const keptStrings = (v: unknown, max = 40): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, max) : []);

/** Keep `view` under `key` whenever one of its values changes */
export function useKeepView(key: string, view: Record<string, unknown>): void {
  const json = JSON.stringify(view);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, json);
    } catch {
      /* storage blocked: the view lives for the visit only */
    }
  }, [key, json]);
}
