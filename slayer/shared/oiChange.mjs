/*
  THE COMPLETE OPEN-INTEREST CHANGE, the arithmetic only (the reader is server/oiChangeApi.mjs; Building values the
  answer: src/data/book/oiChange.ts → src/data/building.ts valueOiChange). Plain JavaScript so Node runs it without a
  build step, and the proofs (scripts/oi-change-proof.mjs, scripts/golden/pinpoint-golden.ts) test it with known numbers.

  Recovered from the Regime tab's reader (git a2f14ce, shared/volRegime.mjs oiChange / readOiReport / oiReportDay), but
  kept contract by contract, not summed per strike: Building values each contract at its own gamma.

  The terminal's quirks it absorbs:
  - /option/history/open_interest?expiration=*&date=D answers every listed contract of one root, one figure each (zeros
    included), stamped about 06:30 New York on D for the PREVIOUS session's close. Report D against the report of the
    session before D is the change from that earlier session's trading.
  - An index's chain is split over roots on the terminal (SPX's monthlies are SPX, its dailies SPXW): a name reads every
    root it has and adds them.
*/

import { addDays, isSessionDay, nyWall, sessionDayAtOrBefore } from './marketSession.mjs';

/** The roots a name's chain is listed under on the terminal */
export const OI_ROOTS = { SPX: ['SPX', 'SPXW'], NDX: ['NDX', 'NDXP'], RUT: ['RUT', 'RUTW'] };
export const oiRootsOf = (ticker) => {
  const t = String(ticker ?? '').toUpperCase();
  return OI_ROOTS[t] ?? [t];
};
/** When the morning's open interest is on file, minutes of New York's day: stamped about 06:30; five minutes' grace */
export const OI_READY_MIN = 6 * 60 + 35;

/** The report a reader can expect at `ms`: today's once it is stamped on a session day, else the last session's */
export function oiReportDay(ms) {
  const w = nyWall(ms);
  if (isSessionDay(w.iso) && w.min >= OI_READY_MIN) return w.iso;
  return sessionDayAtOrBefore(addDays(w.iso, -1));
}
/** The session before `day`: the report a report is compared against, and the close a report counts */
export const priorSession = (day) => sessionDayAtOrBefore(addDays(day, -1));

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : NaN;
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * /option/history/open_interest?expiration=*: each contract's figure, `${expiry}|${strike}|${C|P}` → open interest.
 * A contract listed twice (two roots on one expiry and strike) is added.
 * @returns {Record<string, number>}
 */
export function readOiReport(json) {
  const rows = json && typeof json === 'object' && Array.isArray(json.response) ? json.response : [];
  const out = {};
  for (const row of rows) {
    const c = row?.contract;
    const d = Array.isArray(row?.data) ? row.data[row.data.length - 1] : null;
    const right = String(c?.right ?? '').toUpperCase()[0];
    const strike = num(c?.strike);
    const oi = num(d?.open_interest);
    const exp = String(c?.expiration ?? '').slice(0, 10);
    if ((right !== 'C' && right !== 'P') || !(strike > 0) || !(oi >= 0) || !ISO.test(exp)) continue;
    const key = `${exp}|${strike}|${right}`;
    out[key] = (out[key] ?? 0) + oi;
  }
  return out;
}

/** Several roots' reports as one */
export function mergeReports(reports) {
  const out = {};
  for (const r of reports) for (const [k, v] of Object.entries(r)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * Every contract whose open interest changed between two reports: [expiry, strike, 'C' | 'P', change], ordered by
 * expiry, strike, right. Only expiries on or after `from` (the later report's date) are counted: an expiry before it
 * settled at or before the close the later report counts, so its fall to nothing is not an unwind. A contract missing
 * from one report counts as 0 there (listed after the earlier report, or gone from the later one).
 * @param {Record<string, number>} now    the later report (readOiReport)
 * @param {Record<string, number>} prior  the earlier report
 * @param {string} from
 */
export function oiChangeRows(now, prior, from) {
  const keys = new Set([...Object.keys(now), ...Object.keys(prior)]);
  const out = [];
  for (const key of keys) {
    const [exp, k, right] = key.split('|');
    if (exp < from) continue;
    const d = (now[key] ?? 0) - (prior[key] ?? 0);
    if (d) out.push([exp, Number(k), right, d]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0)));
  return out;
}
