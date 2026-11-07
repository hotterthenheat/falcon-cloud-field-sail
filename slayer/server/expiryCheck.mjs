/*
  Every /option/list/expirations answer, checked against the root's own contracts before any page or server reader sees
  it (shared/expiryEvidence.mjs says why: the terminal's list carries dates with no contract and lags new listings).

  For one root, besides the list itself, this reads (one at a time, each through the terminal's slots like any other
  read, and kept here so the hub's five-minute refresh of the list costs nothing more):
  - /option/snapshot/quote?symbol=R&expiration=*      the current NBBO of every contract     kept SNAPSHOT_MS
  - /option/snapshot/open_interest?symbol=R&expiration=*  the current open-interest report    kept REPORT_MS
  - /option/list/contracts/quote?symbol=R&date=<last finished session>   kept for that session
  An answer with no rows is not evidence either way (the terminal between sessions can answer empty); a read that
  failed is asked again after RETRY_MS. With no evidence at all the list goes out as the last universe build judged it.
  A date's verdict is logged once a day per root.
*/

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expirationsBody, expirationsIn, verifyExpirations } from '../shared/expiryEvidence.mjs';
import { addDays, nyWall, isSessionDay, regularCloseMin, sessionDayAtOrBefore } from '../shared/marketSession.mjs';

export const EXPIRATION_LIST = /^\/option\/list\/expirations\?/;
/** How long the NBBO snapshot's dates are reused: a new listing shows within this */
export const SNAPSHOT_MS = 10 * 60_000;
/** The open-interest report is stamped once a morning */
export const REPORT_MS = 60 * 60_000;
export const RETRY_MS = 60_000;
const MAX_ROOTS = 2_000;

/** The last session whose options have finished trading at `ms` (15 minutes after the stock close: 16:15 New York) */
export function lastFinishedSession(ms) {
  const w = nyWall(ms);
  if (isSessionDay(w.iso) && w.min >= regularCloseMin(w.iso) + 15) return w.iso;
  return sessionDayAtOrBefore(addDays(w.iso, -1));
}

/** The last universe build's verdict per root (src/data/generated/tickerUniverse.json `expiries`), read once */
let universe;
function universeVerdict(root) {
  if (universe === undefined) {
    universe = null;
    try {
      const file = fileURLToPath(new URL('../src/data/generated/tickerUniverse.json', import.meta.url));
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      universe = doc && doc.expiries ? doc.expiries : null;
    } catch {
      /* no generated file next to the server (a bare deploy): no fallback */
    }
  }
  return universe ? { drop: universe.phantom?.[root] ?? [], add: universe.added?.[root] ?? [] } : undefined;
}

/**
 * @param {object} o
 * @param {(path: string, lane?: string) => Promise<{ status: number, body: Buffer | string, type: string }>} o.load
 *   one terminal read through the slots (never the hub: the list's own answer is what the hub keeps)
 * @param {() => number} [o.now]
 * @param {(line: string) => void} [o.log]
 * @param {(root: string) => ({ drop?: string[], add?: string[] } | undefined)} [o.fallbackOf]
 */
export function createExpiryCheck(o) {
  const now = o.now ?? (() => Date.now());
  const log = o.log ?? (() => {});
  const fallbackOf = o.fallbackOf ?? universeVerdict;
  /** `${kind}|${root}|${day?}` → { at, dates: Set | null, failed?: true } */
  const kept = new Map();
  const logged = new Map();
  const stats = { lists: 0, evidenceReads: 0, phantom: 0, added: 0, unverified: 0 };

  async function evidence(kind, root, path, holdMs, lane) {
    const key = `${kind}|${root}`;
    const hit = kept.get(key);
    const t = now();
    if (hit && t - hit.at < (hit.failed ? RETRY_MS : holdMs)) return hit.dates;
    let dates = null;
    let failed = false;
    try {
      stats.evidenceReads += 1;
      const got = await o.load(path, lane);
      if (got.status === 200) {
        const set = expirationsIn(String(got.body));
        dates = set.size ? set : null;
      } else if (got.status !== 472) failed = true;
    } catch {
      failed = true;
    }
    kept.set(key, { at: now(), dates, failed });
    if (kept.size > MAX_ROOTS * 3) kept.delete(kept.keys().next().value);
    return dates;
  }

  /** The checked answer for one /option/list/expirations path */
  async function answer(reqPath, lane) {
    const q = new URLSearchParams(reqPath.split('?')[1] ?? '');
    const root = String(q.get('symbol') ?? '').trim().toUpperCase();
    const got = await o.load(reqPath, lane);
    if (got.status !== 200 || !/^[A-Z0-9.]{1,12}$/.test(root)) return got;
    stats.lists += 1;
    const csv = q.get('format') === 'csv' || !/json/.test(String(got.type));
    const listed = [...expirationsIn(String(got.body))];
    const enc = encodeURIComponent(root);
    const session = lastFinishedSession(now());
    const reads = [
      await evidence('quote', root, `/option/snapshot/quote?symbol=${enc}&expiration=*&format=csv`, SNAPSHOT_MS, lane),
      await evidence('oi', root, `/option/snapshot/open_interest?symbol=${enc}&expiration=*&format=csv`, REPORT_MS, lane),
      await evidence(`session-${session}`, root, `/option/list/contracts/quote?symbol=${enc}&date=${session.replace(/-/g, '')}&format=csv`, 24 * 3_600_000, lane),
    ];
    const today = nyWall(now()).iso;
    const v = verifyExpirations({ listed, evidence: reads, today, fallback: fallbackOf(root) });
    if (!v.verified) stats.unverified += 1;
    const stamp = `${today}|${v.phantom.join(',')}|${v.added.join(',')}|${v.verified}`;
    if ((v.phantom.length || v.added.length || !v.verified) && logged.get(root) !== stamp) {
      logged.set(root, stamp);
      if (logged.size > MAX_ROOTS) logged.delete(logged.keys().next().value);
      stats.phantom += v.phantom.length;
      stats.added += v.added.length;
      const list = (a) => (a.length > 6 ? `${a.slice(0, 6).join(' ')} … (${a.length})` : a.join(' '));
      log(`${root}: ${v.verified ? 'checked against its contracts' : 'no contract read answered, the last build’s verdict'}${v.phantom.length ? `; dropped ${list(v.phantom)} (no contract)` : ''}${v.added.length ? `; added ${list(v.added)} (contracts the list does not carry yet)` : ''}`);
    }
    return {
      status: 200,
      body: Buffer.from(expirationsBody(root, v.dates, csv)),
      type: csv ? 'text/csv' : 'application/json',
    };
  }

  return { answer, stats: () => ({ ...stats, kept: kept.size }) };
}
