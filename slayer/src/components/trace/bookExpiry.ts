/* The expiry cut for a flow page: the dates actually on its rows as a calendar, and the rows cut to the chosen one
   (or every expiry). */

import { useCallback, useMemo, useState } from 'react';
import { expiryAt, isoDate, type Expiry } from '../../core/calendar';

/** MM/DD/YYYY (the tape's and the book's spelling) → a local Date */
function parseBookExpiry(s: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
}

/** MM/DD/YYYY → YYYY-MM-DD, the calendar's key */
function bookExpiryIso(s: string): string | null {
  const d = parseBookExpiry(s);
  return d ? isoDate(d) : null;
}

interface ExpiryCut<T> {
  /** The chosen expiry, YYYY-MM-DD; null = every expiry */
  expiry: string | null;
  setExpiry: (iso: string | null) => void;
  /** The dates on the rows, ascending, as real expiries (dte, sessions, weekday) */
  expiries: Expiry[];
  /** The rows on the chosen expiry — or all of them */
  cut: (rows: T[]) => T[];
  /** The chosen expiry, as one of `expiries` */
  chosen: Expiry | null;
}

/** The expiry cut for a page. `get` reads a row's expiry (MM/DD/YYYY); `control` holds the choice outside the hook. */
export function useExpiryCut<T>(rows: T[], get: (r: T) => string, control?: { value: string | null; onChange: (iso: string | null) => void }): ExpiryCut<T> {
  const [own, setOwn] = useState<string | null>(null);
  const expiry = control ? control.value : own;
  const setExpiry = control ? control.onChange : setOwn;
  const expiries = useMemo(() => {
    const seen = new Map<string, Expiry>();
    for (const r of rows) {
      const raw = get(r);
      if (!raw || seen.has(raw)) continue;
      const d = parseBookExpiry(raw);
      if (!d) continue;
      seen.set(raw, expiryAt(d));
    }
    return [...seen.values()].sort((a, b) => a.dte - b.dte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const chosen = useMemo(() => (expiry ? expiries.find(e => isoDate(e.date) === expiry) ?? null : null), [expiry, expiries]);
  const cut = useCallback(
    (list: T[]) => {
      if (!expiry) return list;
      return list.filter(r => bookExpiryIso(get(r)) === expiry);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expiry]
  );
  return { expiry, setExpiry, expiries, cut, chosen };
}
