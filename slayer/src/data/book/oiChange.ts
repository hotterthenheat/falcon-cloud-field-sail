/* The last session's open-interest change, contract by contract (oi-change): what was built and drained overnight. */

import { isoDate, isTradingDay } from '../../core/calendar';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { uwCall } from '../whales';
import { PREMARKET_MIN } from './load';
import { num, parseOcc } from './scale';
import { emit, isHot } from './store';
import { CLOSE_MIN } from './tape';


/* ---- the last session's open-interest change, contract by contract ---------------------------------------------- */

/* What was built is the vendor's open-interest change (each contract's OI this morning against the session before),
   not the day's volume. */
/* Both directions: increases largest first (order=desc), decreases largest first (order=asc), each until a change of 0. */
const OI_PAGES = 14;

/** One contract's open-interest change: the vendor's oi_diff_plain — this morning's open interest (curr_date, set
    overnight from the previous session's trading) against the session before's (last_date) */
export interface OiChangeRow {
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  /** Contracts added (negative = closed) */
  diff: number;
  /** The two dates the change runs between, as the vendor prints them */
  currDate: string;
  lastDate: string;
}
export interface OiChange {
  rows: OiChangeRow[];
  /** The open-interest dates the change runs between ("2026-10-21" → "2026-10-22") */
  lastDate: string | null;
  currDate: string | null;
  /** 'top': the largest 500 increases and 500 decreases only (the Board's read); 'full': every changed contract */
  depth: 'top' | 'full';
}
const oiChangeCache = new Map<string, OiChange>();
const oiChangeAt = new Map<string, number>();
/* the count is set once overnight — re-read every half hour, so a page left open across the roll picks up the new one */
const OI_CHANGE_MS = 30 * 60_000;
const oiChangeWait = new Set<string>();

/* Keyed by contract, not by strike: Building picks the contracts in scope and values each with its own gamma. */
/** The last session that has finished: today's after its 4:00 close, else the trading day before today */
function finishedSessionIso(): string {
  const iso = nyIsoDate();
  const [y, m, d] = iso.split('-').map(Number);
  if (isTradingDay(new Date(y, m - 1, d)) && nyMinutes() >= CLOSE_MIN) return iso;
  for (let back = 1; back < 12; back++) {
    const p = new Date(y, m - 1, d - back);
    if (isTradingDay(p)) return isoDate(p);
  }
  return iso;
}
/* While the count in hand is behind the last finished session, the first page is probed every five minutes and the
   whole count is read again once it carries a newer date. */
const OI_STALE_MS = 5 * 60_000;
const oiChangeChecked = new Map<string, number>();
/** A trading day between 07:00 ET and the close — when a new open-interest count can appear */
function oiCheckWindow(now: number = Date.now()): boolean {
  const [y, m, d] = nyIsoDate(now).split('-').map(Number);
  const mins = nyMinutes(now);
  return isTradingDay(new Date(y, m - 1, d)) && mins >= PREMARKET_MIN && mins < CLOSE_MIN;
}
/** `depth` 'top' reads one page each way (the largest changes — what moves a wall), for a name read in passing (the
    Board, the Agenda's rows); 'full' every page, for Building. A top read in hand is upgraded when full is asked. */
export function ensureOiChange(ticker: string, depth: 'top' | 'full' = 'full'): void {
  const t = ticker.toUpperCase();
  if (!t || oiChangeWait.has(t)) return;
  const held = oiChangeCache.get(t);
  if (held && depth === 'full' && held.depth === 'top') {
    readOiChange(t, 'full');
    return;
  }
  const behind = !!held?.lastDate && held.lastDate < finishedSessionIso();
  const age = Date.now() - Math.max(oiChangeAt.get(t) ?? 0, oiChangeChecked.get(t) ?? 0);
  if (held && age < (behind ? OI_STALE_MS : OI_CHANGE_MS)) return;
  /* a count in hand is looked for again only when a new one can land: a trading day from 07:00 ET to the close */
  if (held && !oiCheckWindow()) return;
  oiChangeWait.add(t);
  if (held && behind) {
    /* a probe: the first page's dates — the whole count is read again only when they move */
    void (async () => {
      const res = await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=0&order=desc`, isHot(t), !isHot(t));
      oiChangeChecked.set(t, Date.now());
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      const newer = rows.some(r => String(r.curr_date ?? '') > (held.currDate ?? ''));
      oiChangeWait.delete(t);
      if (newer) {
        oiChangeAt.delete(t);
        oiChangeChecked.delete(t);
        readOiChange(t, held.depth === 'full' ? 'full' : depth);
      } else emit();
    })().catch(() => oiChangeWait.delete(t));
    return;
  }
  readOiChange(t, held?.depth === 'full' ? 'full' : depth);
}
function readOiChange(t: string, depth: 'top' | 'full'): void {
  oiChangeWait.add(t);
  void (async () => {
    const out: OiChangeRow[] = [];
    let lastDate: string | null = null;
    let currDate: string | null = null;
    const seen = new Set<string>();
    for (const order of ['desc', 'asc'] as const) {
      for (let page = 0; page < (depth === 'top' ? 1 : OI_PAGES); page++) {
        /* a name off screen reads its change in the background lane */
        const res = await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=${page}&order=${order}`, isHot(t), !isHot(t));
        const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
        let reachedZero = false;
        for (const r of rows) {
          const sym = String(r.option_symbol ?? '');
          const occ = parseOcc(sym);
          const diff = num(r.oi_diff_plain);
          if (order === 'desc' ? diff <= 0 : diff >= 0) reachedZero = true;
          if (!occ || !diff || seen.has(sym)) continue;
          seen.add(sym);
          const cd = String(r.curr_date ?? '');
          const ld = String(r.last_date ?? '');
          if (cd && (!currDate || cd > currDate)) currDate = cd;
          if (ld && (!lastDate || ld > lastDate)) lastDate = ld;
          out.push({ expiry: occ.expiry, strike: occ.strike, right: occ.right === 'CALL' ? 'C' : 'P', diff, currDate: cd, lastDate: ld });
        }
        if (res.error || rows.length < 500 || reachedZero) break;
      }
    }
    /* nothing came back (every page failed): keep the last count rather than print an empty one */
    if (!out.length && oiChangeCache.has(t)) return;
    oiChangeCache.set(t, { rows: out, lastDate, currDate, depth });
    oiChangeAt.set(t, Date.now());
    oiChangeChecked.set(t, Date.now());
    emit();
  })().finally(() => {
    oiChangeWait.delete(t);
  });
}

/** Each contract's open-interest change over the last session — null until it lands */
export const peekOiChange = (ticker: string): OiChange | null => oiChangeCache.get(ticker.toUpperCase()) ?? null;
