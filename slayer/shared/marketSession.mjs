/*
  THE MARKET SESSION, ONE RULE FOR THE WHOLE SITE (browser: src/core/session.ts; server: server/hub.mjs). Plain JavaScript
  so Node runs it without a build step. Every clock is New York's (America/New_York, DST included); holidays and early
  closes are shared/marketCalendar.mjs.

  The global phase is the stock market's, the 24/5 tape:
    overnight  20:00–04:00   Sunday 20:00 opens the trading week. An evening opens only when the NEXT calendar day is a
                             session (the overnight venues trade only on nights whose next morning the trade-reporting
                             facility is open for: Blue Ocean's Sunday–Thursday 8 PM–4 AM, closed Friday and Saturday
                             evenings). So Friday 20:00 → Sunday 20:00 is closed, the evening before a full holiday is
                             closed, and the holiday's own evening opens when the day after it trades.
    pre        04:00–09:30
    regular    09:30–16:00   13:00 on an early close
    post       16:00–20:00   13:00–17:00 on an early close (NYSE: "late trading sessions will close at 5:00 p.m.")
    closed     anything else (weekends, holidays, 17:00–20:00 after an early close)

  Products trade their own windows inside it:
    equity        the phase above
    equityOption  09:30–16:00 (13:00 on an early close); no extended session
    etfOption     09:30–16:15 (13:15 on an early close): SPY, QQQ, IWM, DIA and the other broad index ETFs
    indexOption   SPX/SPXW/XSP/VIX/RUT — Cboe Global Trading Hours 20:15 (the evening before) → 09:25, regular
                  09:30–16:15, curb 16:15–17:00. On an early close the regular session ends 13:15 and there is no curb.
                  GTH opens the evening before every session. Before a holiday Cboe's table runs GTH from 20:15 the
                  evening before to 11:30 on the holiday itself (MLK, Presidents', Memorial, Juneteenth, Independence,
                  Labor, Thanksgiving), and not at all for Good Friday, Christmas and New Year's Day (cboe.com/about/hours/
                  us-options, 2026 table; Cboe notice 57451 for Christmas 2025 / New Year 2026). One-off closures (a
                  national day of mourning) are treated as no GTH.

  sessionAt(ms, product) answers the global phase, whether the product trades now, its window, and the next opening.
*/

import { EARLY_CLOSE_DATES, HOLIDAY_DATES } from './marketCalendar.mjs';

const HOLIDAYS = new Set(HOLIDAY_DATES);
const EARLY = new Set(EARLY_CLOSE_DATES);
/** Closures that are not a calendar holiday: no holiday GTH session either */
const ONE_OFF = new Set(['2018-12-05', '2025-01-09']);

export const PHASES = ['overnight', 'pre', 'regular', 'post', 'closed'];
export const PRODUCTS = ['equity', 'equityOption', 'etfOption', 'indexOption'];

/* ---- New York's wall clock ---------------------------------------------------------------------------------- */

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
let fmt = null;
const byMinute = new Map();
/** New York's date (YYYY-MM-DD), weekday (0 Sunday) and minute of the day at an instant */
export function nyWall(ms) {
  const minute = Math.floor(ms / 60_000);
  let w = byMinute.get(minute);
  if (!w) {
    fmt ??= new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const p = {};
    for (const x of fmt.formatToParts(new Date(minute * 60_000))) if (x.type !== 'literal') p[x.type] = x.value;
    w = { iso: `${p.year}-${p.month}-${p.day}`, weekday: WEEKDAYS[p.weekday] ?? 0, min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
    if (byMinute.size > 20_000) byMinute.clear();
    byMinute.set(minute, w);
  }
  return w;
}

/** The date `n` calendar days after an ISO date */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
const weekdayOf = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

const instantMemo = new Map();
/** The instant New York's clock reads `min` minutes after midnight on `iso` (DST included; past 1440 runs into the next day) */
export function nyInstant(iso, min) {
  const key = `${iso}|${min}`;
  const hit = instantMemo.get(key);
  if (hit !== undefined) return hit;
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, min);
  /* New York is 4 or 5 hours behind UTC: read the guess there and move by the difference, twice, so a guess across a DST change settles */
  let t = guess + 5 * 3_600_000;
  for (let i = 0; i < 3; i++) {
    const w = nyWall(t);
    const [wy, wm, wd] = w.iso.split('-').map(Number);
    const reads = Date.UTC(wy, wm - 1, wd, 0, w.min);
    if (reads === guess) break;
    t += guess - reads;
  }
  if (instantMemo.size > 20_000) instantMemo.clear();
  instantMemo.set(key, t);
  return t;
}

/* ---- the calendar ------------------------------------------------------------------------------------------- */

/** A weekday the cash market opens */
export const isSessionDay = (iso) => {
  const wd = weekdayOf(iso);
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(iso);
};
export const isHolidayDay = (iso) => HOLIDAYS.has(iso);
export const isEarlyCloseDay = (iso) => EARLY.has(iso);
/** The cash close on a date, minutes of New York's day: 960, or 780 on an early close */
export const regularCloseMin = (iso) => (EARLY.has(iso) ? 13 * 60 : 16 * 60);
/** Where the after-hours session ends: 20:00, or 17:00 on an early close */
export const postCloseMin = (iso) => (EARLY.has(iso) ? 17 * 60 : 20 * 60);
/** A holiday Cboe runs a morning GTH session into (to 11:30): not Good Friday, Christmas, New Year's Day or a one-off */
export function gthHoliday(iso) {
  if (!HOLIDAYS.has(iso) || ONE_OFF.has(iso)) return false;
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (m === 1 && d <= 2) return false;
  if (m === 12 && d >= 24) return false;
  if (m === 3 || m === 4) return false;
  return true;
}
/** The next session day strictly after a date */
export function nextSessionDay(iso) {
  let d = addDays(iso, 1);
  for (let i = 0; i < 15 && !isSessionDay(d); i++) d = addDays(d, 1);
  return d;
}
/** The session day at or before a date */
export function sessionDayAtOrBefore(iso) {
  let d = iso;
  for (let i = 0; i < 15 && !isSessionDay(d); i++) d = addDays(d, -1);
  return d;
}

/* ---- the windows -------------------------------------------------------------------------------------------- */

/** The ETF classes whose options trade to 16:15 (Cboe: "ETF options that currently trade until 4:15 p.m.") */
export const LATE_ETFS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'MDY', 'EEM', 'EFA', 'GLD', 'SLV', 'TLT', 'XLE', 'XLF', 'XLK', 'SMH', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE', 'XLC', 'OEF', 'IVV', 'VOO']);
/** The index roots whose options trade Global Trading Hours */
export const GTH_ROOTS = new Set(['SPX', 'SPXW', 'XSP', 'VIX', 'VIXW', 'RUT', 'RUTW']);
/** Index symbols (prices, no shares): SPX, NDX, VIX… */
export const INDEX_SYMBOLS = new Set(['SPX', 'SPXW', 'XSP', 'VIX', 'VIXW', 'RUT', 'RUTW', 'NDX', 'NDXP', 'DJX', 'OEX', 'XEO']);

/** The product a symbol trades as: a share (`equity`), or its options (`option: true`) */
export function productOf(symbol, option = false) {
  const s = String(symbol ?? '').trim().toUpperCase();
  if (!option) return 'equity';
  if (GTH_ROOTS.has(s)) return 'indexOption';
  if (INDEX_SYMBOLS.has(s) || LATE_ETFS.has(s)) return 'etfOption';
  return 'equityOption';
}

/**
 * The windows of `product` that START on New York date `iso`: { kind, from: ms, to: ms }.
 * kinds — equity: overnight, pre, regular, post; options: regular (and indexOption: gth, curb).
 */
function windowsStarting(iso, product) {
  const out = [];
  const session = isSessionDay(iso);
  const early = EARLY.has(iso);
  const next = addDays(iso, 1);
  const at = (day, min) => nyInstant(day, min);
  if (product === 'equity') {
    if (session) {
      out.push({ kind: 'pre', from: at(iso, 240), to: at(iso, 570) });
      out.push({ kind: 'regular', from: at(iso, 570), to: at(iso, regularCloseMin(iso)) });
      out.push({ kind: 'post', from: at(iso, regularCloseMin(iso)), to: at(iso, postCloseMin(iso)) });
    }
    if (isSessionDay(next)) out.push({ kind: 'overnight', from: at(iso, 1200), to: at(next, 240) });
    return out;
  }
  if (product === 'equityOption') {
    if (session) out.push({ kind: 'regular', from: at(iso, 570), to: at(iso, regularCloseMin(iso)) });
    return out;
  }
  if (product === 'etfOption') {
    if (session) out.push({ kind: 'regular', from: at(iso, 570), to: at(iso, regularCloseMin(iso) + 15) });
    return out;
  }
  /* indexOption */
  if (session) {
    out.push({ kind: 'regular', from: at(iso, 570), to: at(iso, regularCloseMin(iso) + 15) });
    if (!early) out.push({ kind: 'curb', from: at(iso, 975), to: at(iso, 1020) });
  }
  if (isSessionDay(next)) out.push({ kind: 'gth', from: at(iso, 1215), to: at(next, 565) });
  else if (gthHoliday(next)) out.push({ kind: 'gth', from: at(iso, 1215), to: at(next, 690) });
  return out;
}

const windowMemo = new Map();
function windowsOf(iso, product) {
  const key = `${iso}|${product}`;
  let w = windowMemo.get(key);
  if (!w) {
    w = windowsStarting(iso, product);
    if (windowMemo.size > 5000) windowMemo.clear();
    windowMemo.set(key, w);
  }
  return w;
}

/** The product's window holding `ms`, or null */
export function windowAt(ms, product = 'equity') {
  const iso = nyWall(ms).iso;
  for (const day of [addDays(iso, -1), iso]) for (const w of windowsOf(day, product)) if (ms >= w.from && ms < w.to) return w;
  return null;
}

/** The product's next window opening strictly after `ms` (within three weeks) */
export function nextWindow(ms, product = 'equity') {
  const iso = nyWall(ms).iso;
  for (let i = -1; i < 21; i++) {
    for (const w of windowsOf(addDays(iso, i), product)) if (w.from > ms) return w;
  }
  return null;
}

/** The global phase at an instant: the stock tape's */
export function phaseAt(ms) {
  return windowAt(ms, 'equity')?.kind ?? 'closed';
}

/**
 * The session at an instant.
 * @param {number} ms
 * @param {'equity'|'equityOption'|'etfOption'|'indexOption'} [product]
 */
export function sessionAt(ms, product = 'equity') {
  const wall = nyWall(ms);
  const eq = windowAt(ms, 'equity');
  const phase = eq?.kind ?? 'closed';
  const own = product === 'equity' ? eq : windowAt(ms, product);
  const next = nextWindow(ms, product);
  const nextEq = product === 'equity' ? next : nextWindow(ms, 'equity');
  /* the session day the instant is in or leads into: overnight belongs to the morning it opens */
  const tradingDay =
    phase === 'overnight'
      ? nyWall(eq.to).iso
      : phase !== 'closed'
        ? wall.iso
        : nextEq
          ? nextEq.kind === 'overnight'
            ? nyWall(nextEq.to).iso
            : nyWall(nextEq.from).iso
          : wall.iso;
  /* the last regular session that has opened by now (today once 09:30 has passed on a session day) */
  const lastRegular = isSessionDay(wall.iso) && wall.min >= 570 ? wall.iso : sessionDayAtOrBefore(addDays(wall.iso, -1));
  return {
    at: ms,
    product,
    phase,
    open: !!own,
    window: own ? { kind: own.kind, from: own.from, to: own.to } : null,
    next: next ? { kind: next.kind, at: next.from, to: next.to } : null,
    nextPhase: nextEq ? { kind: nextEq.kind, at: nextEq.from, to: nextEq.to } : null,
    date: wall.iso,
    minute: wall.min,
    tradingDay,
    lastRegular,
    isHoliday: HOLIDAYS.has(wall.iso),
    isEarlyClose: EARLY.has(tradingDay),
    regularOpenAt: nyInstant(tradingDay, 570),
    regularCloseAt: nyInstant(tradingDay, regularCloseMin(tradingDay)),
  };
}

/** The instant the global phase next changes after `ms` (the end of the current window, or the next opening) */
export function nextChangeAt(ms) {
  const w = windowAt(ms, 'equity');
  const n = nextWindow(ms, 'equity');
  if (w && n) return Math.min(w.to, n.from);
  return w?.to ?? n?.from ?? ms + 3_600_000;
}

/** Is the cash session (09:30–16:00, 13:00 on an early close) open at `ms` */
export const inRegular = (ms) => phaseAt(ms) === 'regular';

/**
 * Does anything a vendor answers about `path` move at `ms` (the server hub's refresh-ahead and freshness)?
 * Index options (and the VIX, computed during GTH) move through GTH and the curb; a stock or an equity option moves
 * 04:00–20:00 (17:00 on an early close). The stock overnight venues are not on either vendor's tape (ThetaData's
 * SIP-sourced bars and quotes and Unusual Whales' bars end at 20:00 and resume at 04:00, checked 2026-10-31 against
 * Oct 29–30), so stock paths stay at the closed pace overnight — nothing new arrives to refresh.
 */
export function feedMoving(ms, path = '') {
  const p = String(path).toUpperCase();
  const phase = phaseAt(ms);
  const stockDay = phase === 'pre' || phase === 'regular' || phase === 'post';
  if (/(^|[^A-Z])(SPXW?|XSP|VIXW?|RUTW?)([^A-Z]|$)/.test(p)) return stockDay || !!windowAt(ms, 'indexOption');
  return stockDay;
}
