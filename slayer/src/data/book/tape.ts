/* The day's price off the bars: minute bars into cash candles and the tape, the regular close, and the ThetaData tape a
   name the vendor has no bars for falls back to (never on the UW-only desks). */

import { isCashIndex } from '../symbolDirectory';
import { nyIsoDate, nyMinutes, nyWallStamp } from '../../core/nyTime';
import { noteBarCloses, peekRegularCloses } from '../dayChange';
import { type Candle } from '../../types/market';
import { thetaAllowedHere } from '../theta';
import { thetaCall } from '../theta';
import { EXT_WINDOWS, cleanExtendedBars } from '../thetaEligible';
import { saneBars } from '../barSanity';
import { type UwBar } from '../whales';
import { num } from './scale';


export const OPEN_MIN = 9 * 60 + 30;
export const CLOSE_MIN = 16 * 60;
/** An index's closing print lands after 16:00 (VIX prints through 16:15): that is the close, not after hours. */
const INDEX_CASH_TO = 16 * 60 + 15;
/** CBOE indexes. /stock/SPX/ohlc and stock-state answer 422 (cboe_index_access_missing). The day's price is the index tape. */
export const INDEX_TAPE = new Set(['SPX', 'RUT', 'NDX', 'VIX', 'XSP']);
/** Any cash index the terminal prices (SOX, DJI, VIX9D …), the directory's own list */
export { isCashIndex };

function ymdNY(ms: number): string {
  /* core/nyTime's cached parts, not a formatter per call */
  return nyIsoDate(ms).replace(/-/g, '');
}

/** How far the cash chart runs. A stock's 16:00 bar is the closing print. An index's close can print until 16:15. */
export function cashToOf(symbol: string): number {
  return isCashIndex(symbol.toUpperCase()) ? INDEX_CASH_TO : CLOSE_MIN;
}

/** Regular, pre, or post off the clock. The 16:00 minute is the close. Anything later is after hours, except an index through 16:15. */
function tapeMark(symbol: string, minute: number): 'r' | 'pr' | 'po' {
  if (minute >= OPEN_MIN && minute <= cashToOf(symbol)) return 'r';
  if (minute < OPEN_MIN) return 'pr';
  return 'po';
}

function pushPrint(out: UwBar[], px: number, at: number, symbol: string): void {
  if (!(px > 0) || !at) return;
  const barStart = Math.floor(at / 60000) * 60000;
  const iso = new Date(at).toISOString();
  const minute = nyMinutes(at);
  const mt = tapeMark(symbol, minute);
  const last = out[out.length - 1];
  const lastAt = last ? Date.parse(last.start_time || '') : 0;
  if (last && Math.floor(lastAt / 60000) * 60000 === barStart) {
    last.close = px;
    last.high = Math.max(num(last.high), px);
    last.low = Math.min(num(last.low) || px, px);
    last.end_time = iso;
    last.market_time = mt;
  } else if (!last || barStart > lastAt) {
    out.push({ open: px, high: px, low: px, close: px, volume: 0, start_time: new Date(barStart).toISOString(), end_time: iso, market_time: mt });
  }
}

/** A bar with no price is missing. All-zero open, high, low and close is not a print at $0. */
export function barPriced(open: number, high: number, low: number, close: number): boolean {
  if (!(close > 0)) return false;
  if (open === 0 && high === 0 && low === 0 && close === 0) return false;
  return true;
}

/** A day the tape returned only empty bars, so the chart must not pretend that day printed. */
export const blankTapeDay = new Map<string, string>();

function noteBlankDays(symbol: string, rows: readonly { at: number; priced: boolean }[]): void {
  const by = new Map<string, { n: number; good: number }>();
  for (const row of rows) {
    if (!row.at) continue;
    const day = nyIsoDate(row.at);
    const cur = by.get(day) ?? { n: 0, good: 0 };
    cur.n += 1;
    if (row.priced) cur.good += 1;
    by.set(day, cur);
  }
  let blank = '';
  for (const [day, v] of by) if (v.n > 0 && v.good === 0 && day > blank) blank = day;
  if (blank) blankTapeDay.set(symbol.toUpperCase(), blank);
}
/** One-minute bars off the ThetaData terminal (a name the vendor has no bars for) — none on the UW-only desks. */
export async function thetaTape(symbol: string, index: boolean): Promise<UwBar[]> {
  if (!thetaAllowedHere(`/${index ? 'index' : 'stock'}/history/ohlc`)) return [];
  const end = ymdNY(Date.now());
  const back = symbol.toUpperCase() === 'SPX' ? 8 : 4;
  const start = ymdNY(Date.now() - back * 86400000);
  const root = index ? 'index' : 'stock';
  /* The vendor's default window is the cash session. Premarket, the curb and the overnight book are separate asks.
     Each ends on its last millisecond: an end of 19:59:59 leaves out the prints stamped 19:59:59.xxx, and the cash
     window's old end of 16:15:00 kept a 16:15 bar of the 16:15:00.000 prints alone (it wins over the post window's). */
  const windows = [
    { start: '09:30:00', end: '16:15:59.999' },
    EXT_WINDOWS.pre,
    EXT_WINDOWS.post,
    { start: '20:00:00', end: '23:59:59.999' },
    { start: '00:00:00', end: '03:59:59.999' },
  ];
  const got = await Promise.all(
    windows.map(w => thetaCall(`/${root}/history/ohlc?symbol=${symbol}&start_date=${start}&end_date=${end}&interval=1m&start_time=${w.start}&end_time=${w.end}&format=json`)),
  );
  const rows = got.flatMap(g => (Array.isArray(g.data) ? (g.data as Record<string, unknown>[]) : []));
  const snapPath = index
    ? `/index/snapshot/price?symbol=${symbol}&format=json`
    : `/stock/snapshot/trade?symbol=${symbol}&format=json`;
  const snap = await thetaCall(snapPath);
  const out: UwBar[] = [];
  const seen: { at: number; priced: boolean }[] = [];
  const kept = new Set<number>();
  for (const b of rows) {
    const at = nyWallStamp(b.timestamp);
    const open = num(b.open);
    const high = num(b.high);
    const low = num(b.low);
    const close = num(b.close);
    const priced = barPriced(open, high, low, close);
    if (at) seen.push({ at, priced });
    if (!at || !priced) continue;
    const minuteKey = Math.floor(at / 60000);
    if (kept.has(minuteKey)) continue;
    kept.add(minuteKey);
    const iso = new Date(at).toISOString();
    const minute = nyMinutes(at);
    out.push({
      open: open || close,
      high: high || close,
      low: low || close,
      close,
      volume: num(b.volume),
      start_time: iso,
      end_time: iso,
      market_time: tapeMark(symbol, minute),
    });
  }
  noteBlankDays(symbol, seen);
  out.sort((a, b) => Date.parse(a.start_time || '') - Date.parse(b.start_time || ''));
  /* a stock's pre-market and after-hours minutes priced off the prints that may set a price (data/thetaEligible.ts),
     the same reads the chart tape makes */
  const clean = index ? out : await cleanStockTape(symbol, out);
  const row = Array.isArray(snap.data) ? snap.data[0] as Record<string, unknown> | undefined : undefined;
  const px = row ? num(row.price ?? row.close) : 0;
  const at = row ? nyWallStamp(row.timestamp) : 0;
  pushPrint(clean, px, at, symbol);
  return clean;
}

/** A stock's extended-hours bars rebuilt from its price-setting prints (data/thetaEligible.ts); the regular session
    and the 16:00 close bar as they came. */
async function cleanStockTape(symbol: string, bars: UwBar[]): Promise<UwBar[]> {
  const asCandle = (b: UwBar): Candle => ({ time: Math.floor(Date.parse(b.start_time || '') / 1000), open: num(b.open), high: num(b.high), low: num(b.low), close: num(b.close), volume: num(b.volume) });
  const minuteOf = (b: UwBar) => nyMinutes(Date.parse(b.start_time || ''));
  const isPre = (b: UwBar) => minuteOf(b) >= 4 * 60 && minuteOf(b) < OPEN_MIN;
  const isPost = (b: UwBar) => minuteOf(b) >= CLOSE_MIN && minuteOf(b) < 20 * 60;
  const [pre, post] = await Promise.all([
    cleanExtendedBars(thetaCall, symbol, EXT_WINDOWS.pre, 60, bars.filter(isPre).map(asCandle)),
    cleanExtendedBars(thetaCall, symbol, EXT_WINDOWS.post, 60, bars.filter(isPost).map(asCandle)),
  ]);
  const asBar = (c: Candle): UwBar => {
    const iso = new Date(c.time * 1000).toISOString();
    return { open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, start_time: iso, end_time: iso, market_time: tapeMark(symbol, nyMinutes(c.time * 1000)) };
  };
  return bars
    .filter(b => !isPre(b) && !isPost(b))
    .concat(pre.map(asBar), post.map(asBar))
    .sort((a, b) => Date.parse(a.start_time || '') - Date.parse(b.start_time || ''));
}

/** VIX prints from 03:15. That print is the price, not a pre-market stock. */
function vixLive(symbol: string, minute: number): boolean {
  return symbol.toUpperCase() === 'VIX' && minute >= 3 * 60 + 15 && minute <= INDEX_CASH_TO;
}

/** Price off the tape when the vendor has no stock-state. A regular print keeps yesterday as prev_close; after hours
    prev_close is today's regular close, the way the vendor's stock-state is read. */
export function quoteFromBars(symbol: string, bars: readonly UwBar[]): { close: number; prev_close: number; market_time: string; tape_time: string } | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  const lastAt = Date.parse(last.end_time || last.start_time || '');
  const close = num(last.close);
  if (!Number.isFinite(lastAt) || !(close > 0)) return null;
  const minute = nyMinutes(lastAt);
  const day = nyIsoDate(lastAt);
  let prior = 0;
  let todayReg = 0;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].market_time !== 'r') continue;
    const at = Date.parse(bars[i].end_time || bars[i].start_time || '');
    if (!Number.isFinite(at)) continue;
    const d = nyIsoDate(at);
    const c = num(bars[i].close);
    if (!(c > 0)) continue;
    if (d === day) {
      if (!todayReg) todayReg = c;
    } else if (d < day) {
      prior = c;
      break;
    }
  }
  const tape_time = last.end_time || last.start_time || '';
  /* a close the tape does not reach is 0 (unknown): the day's change then reads "—" */
  if (vixLive(symbol, minute) && minute < OPEN_MIN) return { close, prev_close: prior, market_time: 'regular', tape_time };
  if (last.market_time === 'r') return { close, prev_close: prior, market_time: 'regular', tape_time };
  if (last.market_time === 'pr') return { close, prev_close: prior || todayReg, market_time: 'premarket', tape_time };
  return { close, prev_close: todayReg || prior, market_time: 'postmarket', tape_time };
}

/** Last regular close of each finished session on the tape. Today is included only after the index close window, so a mid-session print is not cached as the close. */
export function closesFromTape(bars: readonly UwBar[]): { date: string; close: number }[] {
  const by = new Map<string, { t: number; close: number }>();
  for (const b of bars) {
    if (b.market_time !== 'r') continue;
    const t = Date.parse(b.end_time || b.start_time || '');
    const c = num(b.close);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    const day = nyIsoDate(t);
    const cur = by.get(day);
    if (!cur || t >= cur.t) by.set(day, { t, close: c });
  }
  const today = nyIsoDate();
  const includeToday = nyMinutes() > INDEX_CASH_TO;
  return [...by.entries()]
    .filter(([date]) => date < today || (date === today && includeToday))
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 5)
    .map(([date, v]) => ({ date, close: v.close }));
}

/** The price when the vendor's stock-state is missing. Indexes use the index print. Stocks use the last trade, not the bid. */
export async function tapeQuote(symbol: string): Promise<{ close: number; prev_close: number; market_time: string; tape_time: string } | null> {
  const name = symbol.trim().toUpperCase();
  if (!name) return null;
  const index = isCashIndex(name);
  const bars = await thetaTape(name, index);
  const quoted = quoteFromBars(name, bars);
  if (!quoted) return null;
  noteBarCloses(name, closesFromTape(bars), index);
  return quoted;
}

/** Each one-minute bar's own volume. `total_volume` is the day's running total, never a bar's: a bar with no `volume`
    field takes the difference of the running total from the bar before it on the same New York day (0 where there is
    none); a bar that says 0 traded 0. */
export function barVolumes(bars: readonly UwBar[]): Map<UwBar, number> {
  const out = new Map<UwBar, number>();
  const timed = bars.map(b => ({ b, t: Date.parse(b.start_time || b.end_time || '') })).filter(x => Number.isFinite(x.t)).sort((a, z) => a.t - z.t);
  let day = '';
  let prevTotal: number | null = null;
  for (const { b, t } of timed) {
    const d = nyIsoDate(t);
    if (d !== day) {
      day = d;
      prevTotal = null;
    }
    const total = b.total_volume != null && b.total_volume !== '' ? num(b.total_volume) : null;
    if (b.volume != null && b.volume !== '') out.set(b, num(b.volume));
    else out.set(b, total != null && prevTotal != null ? Math.max(0, total - prevTotal) : 0);
    if (total != null) prevTotal = total;
  }
  return out;
}

export function candlesFrom(bars: UwBar[], cashTo = CLOSE_MIN): { cash: Candle[]; tape: Candle[] } {
  let parsed: Candle[] = [];
  const vols = barVolumes(bars);
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!barPriced(num(b.open), num(b.high), num(b.low), close)) continue;
    parsed.push({
      time,
      open: num(b.open) || close,
      high: num(b.high) || close,
      low: num(b.low) || close,
      close,
      volume: vols.get(b) ?? 0,
    });
  }
  parsed.sort((a, b) => a.time - b.time);
  /* a bad print's wick cut back to its body (data/barSanity.ts) */
  parsed = saneBars(parsed);
  if (!parsed.length) return { cash: [], tape: [] };
  const day = nyIsoDate(parsed[parsed.length - 1].time * 1000);
  const tape = parsed.filter(b => nyIsoDate(b.time * 1000) === day || nyMinutes(b.time * 1000) >= 20 * 60);
  /* The 16:00 bar is the closing print. An index keeps the auction through 16:15 (`cashTo`). A later bar is after hours. */
  const inCash = (b: Candle) => {
    const m = nyMinutes(b.time * 1000);
    return m >= OPEN_MIN && m <= cashTo;
  };
  const session = tape.filter(inCash);
  const lastCash = [...parsed].reverse().find(inCash);
  const lastDay = lastCash ? nyIsoDate(lastCash.time * 1000) : null;
  const prior = lastDay && lastDay !== day ? parsed.filter(b => inCash(b) && nyIsoDate(b.time * 1000) === lastDay) : [];
  /* Once today's session has a bar it is the session; the counts wait for their own minimum of bars. */
  if (session.length >= 1 && day === nyIsoDate()) return { cash: session, tape: tape.length ? tape : parsed };
  const cash = session.length >= 2 ? session : prior.length >= 2 ? prior : tape.filter(b => nyIsoDate(b.time * 1000) === day);
  return { cash: cash.length >= 2 ? cash : parsed, tape: tape.length ? tape : parsed };
}

export function twoCashSessions(bars: UwBar[], cashTo: number, keepDays = 2): Candle[] {
  const parsed: Candle[] = [];
  const vols = barVolumes(bars);
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!barPriced(num(b.open), num(b.high), num(b.low), close)) continue;
    const m = nyMinutes(time * 1000);
    if (m < OPEN_MIN || m > cashTo) continue;
    parsed.push({
      time,
      open: num(b.open) || close,
      high: num(b.high) || close,
      low: num(b.low) || close,
      close,
      volume: vols.get(b) ?? 0,
    });
  }
  parsed.sort((a, b) => a.time - b.time);
  const days: string[] = [];
  for (const c of parsed) {
    const d = nyIsoDate(c.time * 1000);
    if (days[days.length - 1] !== d) days.push(d);
  }
  const keep = new Set(days.slice(-keepDays));
  return saneBars(parsed.filter(c => keep.has(nyIsoDate(c.time * 1000))));
}

export function parseTape(bars: UwBar[]): Candle[] {
  const parsed: Candle[] = [];
  const vols = barVolumes(bars);
  for (const b of bars) {
    const time = Math.floor(Date.parse(b.start_time || b.end_time || '') / 1000);
    if (!time) continue;
    const close = num(b.close);
    if (!barPriced(num(b.open), num(b.high), num(b.low), close)) continue;
    parsed.push({
      time,
      open: num(b.open) || close,
      high: num(b.high) || close,
      low: num(b.low) || close,
      close,
      volume: vols.get(b) ?? 0,
    });
  }
  parsed.sort((a, b) => a.time - b.time);
  return saneBars(parsed);
}

/** The last regular session's close off the one-minute bars (the last bar the vendor marks "r"; its daily close for that
    date when the daily rows are in), with the newest extended-hours print kept apart — for a state outside the session
    that still says "regular". Null when the bars carry no regular bar. */
export function regularCloseOf(ticker: string, bars: readonly UwBar[]): { close: number; prevClose: number; at: number; last: number; marketTime: string } | null {
  let reg: { t: number; close: number } | null = null;
  let ext: { t: number; close: number; mt: string } | null = null;
  for (const b of bars) {
    const mt = String((b as { market_time?: string }).market_time ?? '');
    const t = Date.parse(b.end_time || b.start_time || '');
    const c = num(b.close);
    if (!Number.isFinite(t) || !(c > 0)) continue;
    if (mt === 'r') {
      if (!reg || t > reg.t) reg = { t, close: c };
    } else if ((mt === 'po' || mt === 'pr') && (!ext || t > ext.t)) ext = { t, close: c, mt };
  }
  if (!reg) return null;
  const day = nyIsoDate(reg.t - 60_000);
  const closes = peekRegularCloses(ticker) ?? [];
  const own = closes.find(c => c.date === day);
  const before = closes.find(c => c.date < day);
  const close = own?.close ?? reg.close;
  const after = ext && ext.t > reg.t ? ext : null;
  return {
    close,
    prevClose: before?.close ?? 0,
    at: reg.t,
    last: after ? after.close : close,
    /* the phase the extended print belongs to; with no print past the close the session is simply over */
    marketTime: after?.mt === 'pr' ? 'premarket' : 'postmarket',
  };
}
