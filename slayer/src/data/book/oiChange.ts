/* The last session's open-interest change, contract by contract: what was built and drained overnight.

   TWO SOURCES (the owner, 2026-11-01): Building values the COMPLETE change — every listed contract, the terminal's
   all-expiration open interest for the two latest report dates, read once a report date on the server for every page
   and viewer (server/oiChangeApi.mjs, GET /api/oi-change/<T>). Only when the terminal cannot answer does it fall back
   to the options-flow feed's oi-change list, which pages through the largest movers only. `source` says which is in
   hand; Building's hover text says so in words (data/building.ts oiSourceWords). The Board and the Agenda read the
   movers' first page in passing ('top'), as before. */

import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { uwCall, type UwAnswer } from '../whales';
import { feedHeaders } from '../feedGate';
import { PREMARKET_MIN } from './load';
import { num, parseOcc } from './scale';
import { emit, isHot } from './store';
import { addDays, isSessionDay, regularCloseMin, sessionDayAtOrBefore } from '../../core/session';


/* ---- the last session's open-interest change, contract by contract ---------------------------------------------- */

/* The movers' list: the feed's open-interest change (each contract's OI this morning against the session before),
   not the day's volume. Both directions: increases largest first (order=desc), decreases largest first (order=asc),
   each until a change of 0. */
const OI_PAGES = 14;

/** One contract's open-interest change: this morning's open interest (curr_date, set overnight from the previous
    session's trading) against the session before's (last_date) */
export interface OiChangeRow {
  expiry: string;
  strike: number;
  right: 'C' | 'P';
  /** Contracts added (negative = closed) */
  diff: number;
  /** The two report dates the change runs between */
  currDate: string;
  lastDate: string;
}
/** Where a change came from: 'terminal' the complete reports, every listed contract; 'movers' the feed's shorter list
    of the contracts whose open interest moved most */
export type OiSource = 'terminal' | 'movers';
export interface OiChange {
  rows: OiChangeRow[];
  /** The open-interest report dates the change runs between ("2026-10-21" → "2026-10-22") */
  lastDate: string | null;
  currDate: string | null;
  /** 'top': the largest 500 increases and 500 decreases only (the Board's read); 'full': every changed contract the
      source carries */
  depth: 'top' | 'full';
  source: OiSource;
  /** The complete source's count of contracts listed in the later report (null for the movers' list) */
  listed?: number | null;
}
/* ONE STORE OF A NAME'S OPEN-INTEREST CHANGE (audit D7): the largest increases, page 0 of oi-change in descending order,
   is read once and shared — the movers' count below starts from it, the probe for a newer count reads it, and
   Pinpoint's Agenda (data/vendorFeed.ts) shows it. */
const topPages = new Map<string, { at: number; p: Promise<UwAnswer> }>();
/** Page 0 of the name's oi-change, largest increases first: the copy held when it is younger than `maxAgeMs`, else read */
export function oiChangeTopPage(ticker: string, maxAgeMs: number): Promise<UwAnswer> {
  const t = ticker.toUpperCase();
  const hit = topPages.get(t);
  if (hit && (hit.at === 0 || Date.now() - hit.at < maxAgeMs)) return hit.p;
  const entry = { at: 0, p: uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=0&order=desc`, isHot(t), !isHot(t)) };
  topPages.set(t, entry);
  void entry.p.then(a => {
    if (a.error) {
      if (topPages.get(t) === entry) topPages.delete(t);
    } else entry.at = Date.now();
  });
  if (topPages.size > 120) for (const [k, v] of topPages) if (v.at && Date.now() - v.at > OI_CHANGE_MS) topPages.delete(k);
  return entry.p;
}

const oiChangeCache = new Map<string, OiChange>();
const oiChangeAt = new Map<string, number>();
/* the count is set once overnight — re-read every half hour, so a page left open across the roll picks up the new one */
const OI_CHANGE_MS = 30 * 60_000;
const oiChangeWait = new Set<string>();
/* the complete source is tried again this often while the movers' list stands in for it */
const COMPLETE_RETRY_MS = 5 * 60_000;
const completeFailAt = new Map<string, number>();

/** The last session that has finished: today's after its 4:00 close, else the trading day before today */
function finishedSessionIso(): string {
  const iso = nyIsoDate();
  /* its own close: 13:00 on an early close (core/session.ts regularCloseMin) */
  if (isSessionDay(iso) && nyMinutes() >= regularCloseMin(iso)) return iso;
  return sessionDayAtOrBefore(addDays(iso, -1));
}
/* While the count in hand is behind the last finished session, it is looked for again every five minutes and read
   again once a newer one is out. */
const OI_STALE_MS = 5 * 60_000;
const oiChangeChecked = new Map<string, number>();
/** The terminal's report is stamped about 06:30 New York (shared/oiChange.mjs OI_READY_MIN); the feed's list by 07:00 */
const TERMINAL_READY_MIN = 6 * 60 + 35;
/** A trading day between the first stamp and the close — when a new open-interest count can appear */
function oiCheckWindow(source: OiSource, now: number = Date.now()): boolean {
  const iso = nyIsoDate(now);
  const mins = nyMinutes(now);
  return isSessionDay(iso) && mins >= (source === 'terminal' ? TERMINAL_READY_MIN : PREMARKET_MIN) && mins < regularCloseMin(iso);
}
const behindNow = (c: OiChange | undefined) => !!c?.lastDate && c.lastDate < finishedSessionIso();

/** `depth` 'top' reads the movers' first page each way (the largest changes — what moves a wall), for a name read in
    passing (the Board, the Agenda's rows); 'full' the complete change, for Building — the terminal's, else every page of
    the movers' list. A top read in hand is upgraded when full is asked. */
export function ensureOiChange(ticker: string, depth: 'top' | 'full' = 'full'): void {
  const t = ticker.toUpperCase();
  if (!t || oiChangeWait.has(t)) return;
  const held = oiChangeCache.get(t);
  if (held && depth === 'full' && held.depth === 'top') {
    readOiChange(t, 'full');
    return;
  }
  /* the movers' list standing in for the complete change: the terminal is asked again every few minutes */
  if (held && depth === 'full' && held.source === 'movers' && Date.now() - (completeFailAt.get(t) ?? 0) >= COMPLETE_RETRY_MS) {
    readOiChange(t, 'full');
    return;
  }
  const behind = behindNow(held);
  const age = Date.now() - Math.max(oiChangeAt.get(t) ?? 0, oiChangeChecked.get(t) ?? 0);
  if (held && age < (behind ? OI_STALE_MS : OI_CHANGE_MS)) return;
  /* a count in hand is looked for again only when a new one can land: a trading day from the stamp to the close */
  if (held && !oiCheckWindow(held.source)) return;
  if (held && behind && held.source === 'terminal') {
    /* the server keeps the reports: asking it again costs the terminal nothing until a new report is stamped */
    readOiChange(t, 'full');
    return;
  }
  oiChangeWait.add(t);
  if (held && behind) {
    /* a probe: the movers' first page's dates — the whole list is read again only when they move */
    void (async () => {
      const res = await oiChangeTopPage(t, 60_000);
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

/** The answer of GET /api/oi-change/<T> (server/oiChangeApi.mjs) */
interface CompleteAnswer {
  day?: string;
  prior?: string;
  contracts?: number;
  rows?: [string, number, 'C' | 'P', number][];
  pending?: boolean;
  error?: string;
}
const PENDING_TRIES = 4;
const PENDING_GAP_MS = 3_000;
/** The complete change from the server's terminal reader, or null when it cannot answer (the terminal down, a report
    not on file, the route missing on this host) */
export async function readCompleteOiChange(ticker: string): Promise<OiChange | null> {
  const t = ticker.toUpperCase();
  for (let i = 0; i < PENDING_TRIES; i++) {
    let got: CompleteAnswer | null = null;
    try {
      const auth = await feedHeaders();
      if (!auth.ok) return null;
      const res = await fetch(`/api/oi-change/${encodeURIComponent(t)}`, { headers: auth.headers });
      if (!res.ok) return null;
      got = (await res.json()) as CompleteAnswer;
    } catch {
      return null;
    }
    if (got.error) return null;
    if (got.pending) {
      await new Promise(r => setTimeout(r, PENDING_GAP_MS));
      continue;
    }
    if (!got.day || !got.prior || !Array.isArray(got.rows) || !got.rows.length) return null;
    const currDate = got.day;
    const lastDate = got.prior;
    const rows: OiChangeRow[] = got.rows.map(([expiry, strike, right, diff]) => ({ expiry, strike, right, diff, currDate, lastDate }));
    return { rows, lastDate, currDate, depth: 'full', source: 'terminal', listed: got.contracts ?? null };
  }
  return null;
}

/** Every page of the movers' list each way (or the first page, for 'top') */
async function readMovers(t: string, depth: 'top' | 'full'): Promise<OiChange | null> {
  const out: OiChangeRow[] = [];
  let lastDate: string | null = null;
  let currDate: string | null = null;
  const seen = new Set<string>();
  for (const order of ['desc', 'asc'] as const) {
    for (let page = 0; page < (depth === 'top' ? 1 : OI_PAGES); page++) {
      /* a name off screen reads its change in the background lane */
      const res = order === 'desc' && page === 0 ? await oiChangeTopPage(t, 60_000) : await uwCall(`/stock/${encodeURIComponent(t)}/oi-change?limit=500&page=${page}&order=${order}`, isHot(t), !isHot(t));
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
  return out.length ? { rows: out, lastDate, currDate, depth, source: 'movers', listed: null } : null;
}

function readOiChange(t: string, depth: 'top' | 'full'): void {
  oiChangeWait.add(t);
  void (async () => {
    const held = oiChangeCache.get(t);
    const keep = (c: OiChange) => {
      oiChangeCache.set(t, c);
      oiChangeAt.set(t, Date.now());
      oiChangeChecked.set(t, Date.now());
      emit();
    };
    if (depth === 'full') {
      const complete = await readCompleteOiChange(t);
      /* never a count older than the one in hand */
      if (complete && !(held && (held.currDate ?? '') > (complete.currDate ?? ''))) {
        completeFailAt.delete(t);
        keep(complete);
        return;
      }
      completeFailAt.set(t, Date.now());
      /* the movers' whole list already in hand and current: kept, the terminal asked again later */
      if (held && held.depth === 'full' && held.source === 'movers' && !behindNow(held) && Date.now() - (oiChangeAt.get(t) ?? 0) < OI_CHANGE_MS) {
        oiChangeChecked.set(t, Date.now());
        emit();
        return;
      }
    }
    const movers = await readMovers(t, depth);
    /* nothing came back (every page failed), or older than the count in hand: keep the last count rather than print it */
    if (!movers || (held && (held.currDate ?? '') > (movers.currDate ?? ''))) {
      oiChangeChecked.set(t, Date.now());
      emit();
      return;
    }
    keep(movers);
  })().finally(() => {
    oiChangeWait.delete(t);
  });
}

/** Each contract's open-interest change over the last session — null until it lands */
export const peekOiChange = (ticker: string): OiChange | null => oiChangeCache.get(ticker.toUpperCase()) ?? null;
/** Forget a name's change (a proof switching sources) */
export function dropOiChange(ticker: string): void {
  const t = ticker.toUpperCase();
  oiChangeCache.delete(t);
  oiChangeAt.delete(t);
  oiChangeChecked.delete(t);
  completeFailAt.delete(t);
}
