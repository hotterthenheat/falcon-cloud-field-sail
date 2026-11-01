/*
  TERRAIN'S OPTION CHAIN, read once for every viewer and cut down to what the pages draw (the reader is
  server/terrainApi.mjs; the pages are the Surface tab's Skew and Drift views). Plain JavaScript so Node runs it
  without a build step; the math on the rows (parity forward, implied vols, the dealers' hedge) is the browser's, on the
  site's own modules (src/data/skew.ts, src/data/charmDrift.ts), so nothing here prices anything.

  What it absorbs:
  - the terminal's CSV (format=csv is about half the bytes of JSON for a whole chain): a header line, then one line a
    contract, strings in double quotes, never a comma inside one;
  - one row a STRIKE, the call and the put side by side (a slim array, the column order in CHAIN_COLS), so a 36-expiry
    chain of 8,000 contracts is about 4,000 short rows;
  - a quote with no bid (0) or no ask is kept as null, never as a price.
*/

/** The slim row of a live strike, in order */
export const CHAIN_COLS = ['strike', 'callBid', 'callAsk', 'putBid', 'putAsk', 'callDelta', 'putDelta', 'callCharm', 'putCharm', 'callVanna', 'putVanna', 'callOi', 'putOi', 'callIv', 'putIv'];
/** The slim row of a closing strike (the prior session's end-of-day surface), in order */
export const CLOSE_COLS = ['strike', 'callBid', 'callAsk', 'putBid', 'putAsk'];

/** The option root a page's name reads: the cash index's options are its weeklies (SPX → SPXW); anything else is itself */
export function chainRoot(symbol) {
  const s = String(symbol ?? '').toUpperCase();
  if (s === 'SPX' || s === 'SPXW') return 'SPXW';
  if (s === 'NDX' || s === 'NDXP') return 'NDXP';
  if (s === 'RUT' || s === 'RUTW') return 'RUTW';
  return s;
}
/** A name the routes accept: letters, a dot, at most eight */
export const okSymbol = (s) => /^[A-Z][A-Z.]{0,7}$/.test(String(s ?? ''));

/** Parses the terminal's CSV: an array of objects keyed by the header */
export function parseCsv(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const head = (lines.shift() ?? '').split(',').map((h) => h.replace(/^"|"$/g, '').trim());
  if (head.length < 2) return [];
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const cells = line.split(',');
    if (cells.length !== head.length) continue;
    const row = {};
    for (let i = 0; i < head.length; i++) row[head[i]] = cells[i].replace(/^"|"$/g, '');
    out.push(row);
  }
  return out;
}

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
/** a bid or an ask: a positive price, else null (0 is "no quote") */
const px = (v) => {
  const n = num(v);
  return n != null && n > 0 ? n : null;
};
const iso = (v) => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(v ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
/** "2026-10-30T16:15:00.137" → "2026-10-30T16:15:00" (New York wall time, as the terminal stamps) */
const wall = (v) => {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/.exec(String(v ?? ''));
  return m ? m[1] : null;
};
const rightOf = (v) => {
  const s = String(v ?? '').toUpperCase();
  return s.startsWith('C') ? 'C' : s.startsWith('P') ? 'P' : null;
};

/** contract key "2026-11-06|7600|C" */
const keyOf = (exp, strike, right) => `${exp}|${strike}|${right}`;

/** The open-interest snapshot (/option/snapshot/open_interest, csv): { day (the report's date), oi: Map key → contracts } */
export function readOpenInterest(text) {
  const oi = new Map();
  let day = null;
  for (const r of parseCsv(text)) {
    const exp = iso(r.expiration);
    const k = num(r.strike);
    const right = rightOf(r.right);
    const n = num(r.open_interest);
    if (!exp || k == null || !right || n == null) continue;
    oi.set(keyOf(exp, k, right), n);
    const d = iso(r.timestamp);
    if (d && (!day || d > day)) day = d;
  }
  return { day, oi };
}

/**
 * The all-expiry greeks snapshot (/option/snapshot/greeks/all, csv) as the pages read it: the expiries in order, each a
 * list of slim strike rows (CHAIN_COLS), with the open interest folded in when it is given.
 * @returns {{ spot: number | null, spotAt: string | null, asOf: string | null, expiries: { exp: string, rows: (number|null)[][] }[] }}
 */
export function readChain(text, oi = null) {
  const byExp = new Map();
  let spot = null;
  let spotAt = null;
  let asOf = null;
  for (const r of parseCsv(text)) {
    const exp = iso(r.expiration);
    const k = num(r.strike);
    const right = rightOf(r.right);
    if (!exp || k == null || !(k > 0) || !right) continue;
    const u = num(r.underlying_price);
    const uAt = wall(r.underlying_timestamp);
    if (u != null && u > 0 && uAt && (!spotAt || uAt > spotAt)) {
      spot = u;
      spotAt = uAt;
    }
    const at = wall(r.timestamp);
    if (at && (!asOf || at > asOf)) asOf = at;
    let strikes = byExp.get(exp);
    if (!strikes) byExp.set(exp, (strikes = new Map()));
    let row = strikes.get(k);
    if (!row) strikes.set(k, (row = [k, null, null, null, null, null, null, null, null, null, null, null, null, null, null]));
    const c = right === 'C' ? 0 : 1;
    row[1 + 2 * c] = px(r.bid);
    row[2 + 2 * c] = px(r.ask);
    row[5 + c] = num(r.delta);
    row[7 + c] = num(r.charm);
    row[9 + c] = num(r.vanna);
    row[11 + c] = oi ? (oi.get(keyOf(exp, k, right)) ?? null) : null;
    const iv = num(r.implied_vol);
    row[13 + c] = iv != null && iv > 0 ? iv : null;
  }
  const expiries = [...byExp.keys()].sort().map((exp) => ({ exp, rows: [...byExp.get(exp).values()].sort((a, b) => a[0] - b[0]) }));
  return { spot, spotAt, asOf, expiries };
}

/**
 * The end-of-day greeks (/option/history/greeks/eod, csv) for one session: its closing quotes per strike (CLOSE_COLS)
 * and the underlying's close.
 * @returns {{ day: string | null, spot: number | null, expiries: { exp: string, rows: (number|null)[][] }[] }}
 */
export function readCloses(text) {
  const byExp = new Map();
  let spot = null;
  let spotAt = null;
  let day = null;
  for (const r of parseCsv(text)) {
    const exp = iso(r.expiration);
    const k = num(r.strike);
    const right = rightOf(r.right);
    if (!exp || k == null || !(k > 0) || !right) continue;
    const u = num(r.underlying_price);
    const uAt = wall(r.underlying_timestamp);
    if (u != null && u > 0 && uAt && (!spotAt || uAt > spotAt)) {
      spot = u;
      spotAt = uAt;
      day = uAt.slice(0, 10);
    }
    let strikes = byExp.get(exp);
    if (!strikes) byExp.set(exp, (strikes = new Map()));
    let row = strikes.get(k);
    if (!row) strikes.set(k, (row = [k, null, null, null, null]));
    const c = right === 'C' ? 0 : 1;
    row[1 + 2 * c] = px(r.bid);
    row[2 + 2 * c] = px(r.ask);
  }
  const expiries = [...byExp.keys()].sort().map((exp) => ({ exp, rows: [...byExp.get(exp).values()].sort((a, b) => a[0] - b[0]) }));
  return { day, spot, expiries };
}
