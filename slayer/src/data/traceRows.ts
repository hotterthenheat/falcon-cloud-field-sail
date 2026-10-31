/* Trace's row mapping: the vendor's option prints, flow alerts and screener rows as the rows the pages draw, the
   session clock they are read against, and the live spots and index levels they are priced from. */

import { uwCall } from './whales';
import { peekQuote } from './liveQuote';
import type { BookContract, FlowPrint } from '../types/trace';
import { isoDate, isTradingDay, sessionBefore, sessionsBetween } from '../core/calendar';
import { marketPhase } from '../core/marketPhase';
import { nyParts, nyWallTime } from '../core/nyTime';
import { leanOfSides } from './traceLean';

/** A vendor field as a number; anything unreadable is 0 */
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
};

export const COUNT = new Intl.NumberFormat('en-US');
/** A count with thousands separators — the one formatter every Trace page uses */
export const fmtCount = (v: number): string => COUNT.format(v);

export function rowsOf(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object');
  if (data && typeof data === 'object' && Array.isArray((data as { data?: unknown }).data)) {
    return rowsOf((data as { data: unknown }).data);
  }
  /* one alert's trades come as { alert, has_more, trades: [...] } */
  if (data && typeof data === 'object' && Array.isArray((data as { trades?: unknown }).trades)) {
    return rowsOf((data as { trades: unknown }).trades);
  }
  return [];
}

/* The regular session is 09:30–16:00 New York for a stock's options and 09:30–16:15 for the index and ETF options that
   trade to 16:15. LATE_CLOSE is a fallback: a print's own extended_hours flag wins where it has one. */
export const LATE_CLOSE = new Set(['SPX', 'SPXW', 'NDX', 'NDXP', 'XSP', 'RUT', 'RUTW', 'MRUT', 'VIX', 'VIXW', 'XND', 'DJX', 'OEX', 'XEO', 'SPY', 'QQQ', 'IWM', 'DIA', 'MDY', 'EEM', 'EFA', 'GLD', 'SLV', 'TLT', 'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'SMH', 'SOXX', 'SOXL', 'IBIT', 'KRE', 'KWEB', 'FXI', 'EWZ', 'EWY', 'UNG', 'UVXY', 'UVIX', 'HYG', 'LQD', 'GDX', 'XBI', 'USO', 'TQQQ', 'SQQQ']);
export const SESSION_OPEN = 570;
/** New York minute the regular session ends for this name's options */
export function sessionEndMin(ticker?: string | null): number {
  return ticker && LATE_CLOSE.has(ticker.toUpperCase()) ? 975 : 960;
}
/** "16:15 ET" or "16:00 ET" */
export const sessionEndLabel = (ticker?: string | null) => (sessionEndMin(ticker) === 975 ? '16:15 ET' : '16:00 ET');
/** The last session that has ended at `endMin` (New York minute) — its day, open and close — or null while it runs */
export function lastCloseAt(at: Date, endMin: number): { iso: string; closeMs: number; openMs: number } | null {
  const p = nyParts(at);
  const m = p.hour * 60 + p.minute;
  const d = new Date(p.year, p.month - 1, p.day);
  if (isTradingDay(d) && m >= SESSION_OPEN && m < endMin) return null;
  if (!(isTradingDay(d) && m >= endMin)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  const y = d.getFullYear();
  const mo = d.getMonth() + 1;
  const da = d.getDate();
  return { iso: isoDate(d), closeMs: nyWallTime(y, mo, da, Math.floor(endMin / 60), endMin % 60), openMs: nyWallTime(y, mo, da, 9, 30) };
}
/** The last options session that has ended (closing 16:15, the last options to close); null while one runs */
export const lastRegularClose = (at: Date = new Date()) => lastCloseAt(at, 975);
/** The last stock session that has ended (16:00) — dark and lit prints are equity prints; null while it runs */
export const lastStockClose = (at: Date = new Date()) => lastCloseAt(at, 960);

/** A Trace figure in money with a real minus sign ("−$4.2K", never "-$4.2K") */
export const usd = (v: number): string => {
  const a = Math.abs(v);
  const sign = v < 0 && a >= 0.5 ? '−' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`;
  return `${sign}$${a.toFixed(0)}`;
};

/** "1 contract", "2 contracts" */
export const plural = (n: number, one: string, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;

export function nyIsoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}
/** The New York calendar day of an instant, YYYY-MM-DD */
export function nyDateOf(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
}
/** Newest first by the full instant, never by the time of day alone (two days' prints can share a clock) */
export const byNewest = (a: { epochMs?: number; time: string }, b: { epochMs?: number; time: string }) => (b.epochMs ?? 0) - (a.epochMs ?? 0) || b.time.localeCompare(a.time);

export function clock(iso: unknown): { time: string; minute: number; epoch: number; ms: number } {
  const raw = typeof iso === 'number' ? iso : typeof iso === 'string' ? Date.parse(iso) : NaN;
  const d = Number.isFinite(raw) ? new Date(raw > 1e12 ? raw : raw * 1000) : null;
  if (!d || Number.isNaN(d.getTime())) return { time: '—', minute: 0, epoch: 0, ms: 0 };
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const pick = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  const time = `${pick('hour')}:${pick('minute')}:${pick('second')}`;
  const minute = Number(pick('hour')) * 60 + Number(pick('minute'));
  return { time, minute, epoch: Math.floor(d.getTime() / 1000), ms: d.getTime() };
}

/** A 53-bit hash (cyrb53) — a 32-bit one collides about once in twenty 20,000-row buffers */
export function hashId(s: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function expiryLabel(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || '—';
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** The options session an instant belongs to. The option tape has no pre-market, so a trading day becomes the session at
    the 09:30 open; before it (or on a closed day) the session is the last trading day. Every Trace date reads this. */
export function sessionIsoAt(ms: number): string {
  const p = nyParts(new Date(ms));
  const d = new Date(p.year, p.month - 1, p.day);
  const open = p.hour * 60 + p.minute >= SESSION_OPEN_MIN_ET;
  if (!(isTradingDay(d) && open)) {
    d.setDate(d.getDate() - 1);
    for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() - 1);
  }
  return isoDate(d);
}
export const SESSION_OPEN_MIN_ET = 9 * 60 + 30;
/** A New York day's 04:00 — where its pre-market prints and alerts start, in either daylight or standard time */
export function dayStartMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return nyWallTime(y, m, d, 4, 0);
}
export function tapeSessionIso(): string {
  return sessionIsoAt(Date.now());
}

/** Calendar days from a trade day (default the tape's session) to an expiry */
export function dteFrom(iso: string, fromIso: string = tapeSessionIso()): number {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const f = fromIso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || !f) return 0;
  const day = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const from = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]));
  return Math.max(0, Math.round((day - from) / 86_400_000));
}
/** Days to expiry from the tape's session */
export const dteOf = (iso: string): number => dteFrom(iso);

export const SETTLE_MS = 5 * 60_000;
/** The ended session's close (ms) while the market stands closed after it — after 16:15, overnight, a weekend or a
    holiday; null in the session and in the pre-market */
export function heldCloseMs(at: Date = new Date()): number | null {
  const ph = marketPhase(at);
  if (ph !== 'after' && ph !== 'closed') return null;
  return lastRegularClose(at)?.closeMs ?? null;
}
/** A read stamped `atMs` of the ended session's figures: it stands until the next session (read after the close settled) */
export function heldFresh(atMs: number | null | undefined): boolean {
  const c = heldCloseMs();
  return c != null && atMs != null && atMs >= c + SETTLE_MS;
}
/** The print's own side as the vendor tags it (ask_side / bid_side / mid_side), the side every Trace surface reads;
    the quote is the fallback only when the row carries no tag. */
/** A crossed quote, or a side quoted more than five minutes before the fill, gives no read whatever the tag says
    ("quote crossed · no read"). */
export const STALE_QUOTE_MS = 5 * 60_000;
export function quoteNoReadOf(row: Record<string, unknown>, price: number, bid: number, ask: number, atMs: number): 'crossed' | 'stale' | null {
  if (!(price > 0)) return null;
  if (bid > 0 && ask > 0 && bid >= ask) return 'crossed';
  if (atMs > 0) {
    for (const k of ['nbbo_bid_time', 'nbbo_ask_time']) {
      const t = Date.parse(String(row[k] ?? ''));
      if (Number.isFinite(t) && atMs - t > STALE_QUOTE_MS) return 'stale';
    }
  }
  return null;
}
/** The words for a print whose quote gives no read */
export const quoteNoReadWords = (k: 'crossed' | 'stale') => (k === 'crossed' ? 'quote crossed · no read' : 'quote stale · no read');
export function sideOfTags(tags: unknown, price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' {
  const t = Array.isArray(tags) ? tags.map(String) : [];
  /* A tag the quote at the print contradicts loses to the quote: an "ask_side" fill at or under the bid was a sale.
     A fill a cent inside the spread keeps its tag. */
  /* a crossed quote (bid at or over the ask) says nothing about the side — no read (quoteNoReadOf) */
  if (price > 0 && bid > 0 && ask > 0 && bid >= ask) return 'MID';
  const quoted = price > 0 && bid > 0 && ask > bid;
  if (t.includes('ask_side')) return quoted && price <= bid + 1e-6 ? 'BID' : 'ASK';
  if (t.includes('bid_side')) return quoted && price >= ask - 1e-6 ? 'ASK' : 'BID';
  /* a mid tag inside a live quote follows where the fill sat: within a fifth of the spread of a side it is that side's
     (execOf); a no-side tag carries nothing to place */
  if (t.includes('mid_side')) return execOf(price, bid, ask) ?? 'MID';
  if (t.includes('no_side')) return 'MID';
  return execOf(price, bid, ask) ?? 'MID';
}
/** A print's side, the one rule every page reads: no read (MID) on a crossed or stale quote and on a cross trade, else
    the tag against the quote (sideOfTags) */
export function printSideOf(row: Record<string, unknown>, price: number, bid: number, ask: number, atMs: number): 'ASK' | 'BID' | 'MID' {
  if (quoteNoReadOf(row, price, bid, ask, atMs)) return 'MID';
  if (printCondition(row).cross) return 'MID';
  return sideOfTags(row.tags, price, bid, ask);
}
/** A print's identity: the vendor's trade id, else its content (contract, instant, price, size, premium) — never its
    place on a page, which shifts as prints land and repeats a print read on two pages */
export function printKeyOf(row: Record<string, unknown>): string {
  if (row.id != null && row.id !== '') return String(row.id);
  return `${tickerOfRow(row)}|${row.option_chain_id ?? row.option_chain ?? row.option_symbol ?? ''}|${row.executed_at ?? row.created_at ?? ''}|${row.price ?? ''}|${row.size ?? ''}|${row.premium ?? ''}`;
}

/* The print's OPRA condition says what it was: ISOI a sweep; ML?T / TL?T and the ?ESL / ?ASL / ?FSL family legs of a
   multi-leg order. `multi_vol` is the contract's day, never this print's kind. */
/* Compression is not a bet: OPRA cbmo / mctp (and UW's `arbitrage` tag) are floor packages that net open interest
   down. Labelled, counted apart, and kept out of every directional total, crown and sentiment. */
export const COMPRESSION_CODES = new Set(['cbmo', 'mctp']);
export function printCondition(row: Record<string, unknown>): { multi: boolean; sweep: boolean; floor: boolean; compression: boolean; cross: boolean } {
  const cond = String(row.upstream_condition_detail || '').toLowerCase();
  const flags = (Array.isArray(row.report_flags) ? row.report_flags.map(String) : [String(row.report_flags || '')]).join(' ');
  const tags = Array.isArray(row.tags) ? row.tags.map(String) : [];
  return {
    multi: /^(ml|tl)[aecf]t$|^[mt][aecf]sl$/.test(cond) || cond === 'cbmo' || /multi/i.test(flags),
    sweep: cond === 'isoi' || /sweep/i.test(flags),
    floor: /floor/i.test(flags) || /^(ml|tl)ft$|^[mt]fsl$/.test(cond),
    compression: COMPRESSION_CODES.has(cond) || tags.includes('arbitrage'),
    /* a cross trade (report_flags "cross_trade") is pre-arranged at one price: no side taken */
    cross: /cross_trade/i.test(flags),
  };
}

/** A cancelled print never traded; every option-trade route drops it here. */
export const liveTrades = (rows: Record<string, unknown>[]) => rows.filter(r => r.canceled !== true && r.canceled !== 'true');

/* The index level (SPX, NDX, XSP, RUT, VIX): index prints carry no underlying price, but the vendor's spot-exposure
   minutes carry the level; read at most every 30s, only for an index on screen. */
export const INDEX_ROOT: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', NDX: 'NDX', NDXP: 'NDX', XSP: 'XSP', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX', VIXW: 'VIX', XND: 'XND', DJX: 'DJX', MRUT: 'MRUT' };
export const indexLevels = new Map<string, { at: number; level: number }>();
export const indexFrom = new Map<string, 'quote' | 'book'>();
export const indexAsks = new Map<string, Promise<void>>();
export function indexRoot(ticker: string): string | null {
  return INDEX_ROOT[ticker.toUpperCase()] ?? null;
}
/** The newest index level we hold for this ticker's index, 0 when none */
export function indexLevel(ticker: string): number {
  const root = indexRoot(ticker);
  return root ? (indexLevels.get(root)?.level ?? 0) : 0;
}
/** A live index print. The quote wins over the book's last minute while it is fresh. */
export function noteIndex(ticker: string, level: number, at = Date.now()): void {
  const root = indexRoot(ticker) ?? ticker.toUpperCase();
  if (!INDEX_ROOT[root] || !(level > 0) || !(at > 0)) return;
  const had = indexLevels.get(root);
  if (had && indexFrom.get(root) === 'quote' && had.at > at) return;
  indexLevels.set(root, { at, level });
  indexFrom.set(root, 'quote');
}
/** Fetch the index levels the rows need (cached 30s); never throws */
export async function ensureIndexLevels(tickers: Iterable<string>): Promise<void> {
  const roots = new Set<string>();
  for (const t of tickers) {
    const r = indexRoot(t);
    if (r) roots.add(r);
  }
  const jobs: Promise<void>[] = [];
  for (const root of roots) {
    const hit = indexLevels.get(root);
    if (hit && indexFrom.get(root) === 'quote' && Date.now() - hit.at < 60_000) continue;
    if (hit && (Date.now() - hit.at < 30_000 || heldFresh(hit.at))) continue;
    /* a level in hand is used while the new one is asked for; only a root with no level holds its rows back */
    const waitFor = !hit;
    let job = indexAsks.get(root);
    if (!job) {
      job = (async () => {
        try {
          const got = await uwCall(`/stock/${root}/spot-exposures`, true);
          const rows = got.error ? [] : rowsOf(got.data);
          let best: { t: number; p: number } | null = null;
          for (const r of rows) {
            const t = Date.parse(String(r.time || r.start_time || ''));
            const p = num(r.price);
            if (p > 0 && Number.isFinite(t) && (!best || t > best.t)) best = { t, p };
          }
          if (best && !(indexFrom.get(root) === 'quote' && Date.now() - (indexLevels.get(root)?.at ?? 0) < 60_000)) {
            indexLevels.set(root, { at: Date.now(), level: best.p });
            indexFrom.set(root, 'book');
          }
        } catch {
          /* no level: the moneyness reads "—" */
        } finally {
          indexAsks.delete(root);
        }
      })();
      indexAsks.set(root, job);
    }
    if (waitFor) jobs.push(job);
  }
  /* never holds a page's rows long: past INDEX_WAIT_MS they map without the level (the distance reads "—") and the
     next read carries it */
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, INDEX_WAIT_MS))]);
}
const INDEX_WAIT_MS = 5_000;
export const tickerOfRow = (r: Record<string, unknown>) => String(r.underlying_symbol || r.ticker || r.ticker_symbol || '').toUpperCase();

/* One live spot per name, the newest of the live quote, the newest print's underlying price and the stock screener's
   close (read at most once a minute for names on the page): the vendor's stock state can sit frozen for hours. */
export interface SeenSpot {
  spot: number;
  at: number;
}
export const spotSeen = new Map<string, SeenSpot>();
export const spotScreenAt = new Map<string, number>();
/* A name's average day in dollars (the screener's avg30_volume × its close), noted wherever a screener row is read —
   the sized lines (dark prints, big money) scale to it */
const advSeen = new Map<string, number>();
export function noteAdv(ticker: string, advUsd: number): void {
  if (ticker && advUsd > 0 && Number.isFinite(advUsd)) advSeen.set(ticker.toUpperCase(), advUsd);
}
/** A name's average daily dollar volume, null when no screener row for it has been read */
export const advUsdOf = (ticker: string): number | null => advSeen.get((ticker || '').toUpperCase()) ?? null;
export const spotAsks = new Map<string, Promise<void>>();
export const SPOT_SCREEN_MS = 60_000;
/** Note a price for a name, stamped by when it printed — the newest wins */
export function noteSpot(ticker: string, spot: number, at: number): void {
  if (!ticker || !(spot > 0) || !(at > 0)) return;
  const t = ticker.toUpperCase();
  const had = spotSeen.get(t);
  if (!had || at >= had.at) spotSeen.set(t, { spot, at });
}
/** The newest live price we hold for a name, with its time; null when none (an index reads its level instead) */
export function liveSpotAt(ticker: string): SeenSpot | null {
  const t = (ticker || '').toUpperCase();
  if (!t || indexRoot(t)) return null;
  const seen = spotSeen.get(t) ?? null;
  const q = peekQuote(t);
  const quoted = q && q.spot > 0 ? { spot: q.spot, at: q.tapeAt } : null;
  if (seen && quoted) return quoted.at >= seen.at ? quoted : seen;
  return seen ?? quoted;
}
/** The newest live price for a name, 0 when none is in hand */
export const liveSpotOf = (ticker: string): number => liveSpotAt(ticker)?.spot ?? 0;
/** Read the names' live prices off the stock screener (sixty a call), at most once a minute a name. Waits only for names
    with no price at all; never throws. */
export async function ensureSpots(tickers: Iterable<string>): Promise<void> {
  const want: string[] = [];
  const waitFor: Promise<void>[] = [];
  for (const raw of new Set([...tickers].map(t => (t || '').toUpperCase()))) {
    if (!raw || indexRoot(raw) || !/^[A-Z][A-Z0-9.]{0,9}$/.test(raw)) continue;
    const pending = spotAsks.get(raw);
    if (pending) {
      if (!spotSeen.has(raw)) waitFor.push(pending);
      continue;
    }
    if (Date.now() - (spotScreenAt.get(raw) ?? 0) < SPOT_SCREEN_MS || (spotSeen.has(raw) && heldFresh(spotScreenAt.get(raw)))) continue;
    want.push(raw);
  }
  const chunks: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const t of want) {
    if (cur.length && len + t.length + 1 > 300) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(t);
    len += t.length + 1;
  }
  if (cur.length) chunks.push(cur);
  for (const chunk of chunks) {
    const job = (async () => {
      try {
        const got = await uwCall(`/screener/stocks?ticker=${chunk.join(',')}`, true);
        const readAt = Date.now();
        for (const r of got.error ? [] : rowsOf(got.data)) {
          const t = String(r.ticker ?? '').toUpperCase();
          const close = num(r.close);
          /* the screener row carries no clock of its own: stamped a little before the read, so a print seen since wins */
          if (t && close > 0) noteSpot(t, close, readAt - 5_000);
          if (t && close > 0) noteAdv(t, num(r.avg30_volume) * close);
        }
      } catch {
        /* no price: the row keeps its own */
      } finally {
        for (const t of chunk) {
          spotScreenAt.set(t, Date.now());
          spotAsks.delete(t);
        }
      }
    })();
    for (const t of chunk) spotAsks.set(t, job);
    if (chunk.some(t => !spotSeen.has(t) && !peekQuote(t))) waitFor.push(job);
  }
  /* never holds a page's first read long: past SPOT_WAIT_MS the rows map with what is in hand, and the next poll (4s)
     carries the live prices once they land */
  if (waitFor.length) await Promise.race([Promise.all(waitFor), new Promise(r => setTimeout(r, SPOT_WAIT_MS))]);
}
export const SPOT_WAIT_MS = 2_000;

/* A whole-point level is too coarse for a distance on a small index (a point is 5% of VIX), so none is stated there;
   SPX, NDX and RUT keep theirs, marked "≈". */
export function otmOf(right: 'C' | 'P', strike: number, spot: number, fromIndex: boolean): number {
  if (!(spot > 0) || !(strike > 0)) return NaN;
  if (fromIndex && spot < 2000) return NaN;
  return ((right === 'C' ? strike - spot : spot - strike) / spot) * 100;
}
/** True when the row's spot is the index's whole-point level (no underlying price on the print) */
export const spotIsIndexLevel = (row: Record<string, unknown>, ticker: string) => !(num(row.underlying_price || row.stock_price) > 0) && !!indexRoot(ticker);

/** The print ran outside the regular session: the vendor's own flag, else its trading_hours word */
export function extendedOf(row: Record<string, unknown>): boolean {
  const flags = Array.isArray(row.report_flags) ? row.report_flags.map(String) : [String(row.report_flags || '')];
  if (flags.some(f => /extended/i.test(f))) return true;
  if (String(row.upstream_condition_detail || '').toLowerCase() === 'exht') return true;
  const th = String(row.trading_hours || '').toLowerCase();
  return th !== '' && th !== 'rth' && th !== 'regular';
}

export function tradeToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const ticker = tickerOfRow(row);
  const expiryIso = String(row.expiry || row.expiration || '').slice(0, 10);
  const when = clock(row.executed_at || row.created_at);
  const fill = num(row.price);
  const bid = num(row.nbbo_bid);
  const ask = num(row.nbbo_ask);
  const spot = num(row.underlying_price || row.stock_price) || indexLevel(ticker);
  /* the print's own underlying price is the name's price at that instant — the live spot hears it (noteSpot) */
  if (num(row.underlying_price) > 0 && when.ms > 0) noteSpot(ticker, num(row.underlying_price), when.ms);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || row.type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  /* (a flow alert's side is its money's split, not one quote — the check is a print's) */
  const quoteNoRead = row.__aggregate ? null : quoteNoReadOf(row, fill, bid, ask, when.ms);
  /* a cross takes no side on the screen, so no read (printSideOf; an alert's side is its money's, never a quote's) */
  const side = row.__aggregate ? (Array.isArray(row.tags) && row.tags.includes('mid_side') ? 'MID' : sideOfTags(row.tags, fill, bid, ask)) : printSideOf(row, fill, bid, ask, when.ms);
  /* the vendor's flag, else the clock: a fill outside the name's regular session (09:30 to 16:00, 16:15 for the index
     and ETF options) is an extended-hours print whether or not it came flagged (a hive call at 17:11:50 did not) */
  /* By the print, not the wall clock: between 16:00 and 16:15 the vendor's own flag decides; before 09:30 and from
     16:15 nothing is regular */
  const flagged = Array.isArray(row.report_flags) || row.trading_hours != null;
  const m = when.minute;
  const extended = extendedOf(row) || (m > 0 && (m < SESSION_OPEN || m >= 975 || (!flagged && m >= sessionEndMin(ticker))));
  const spread = ask > bid ? ask - bid : 0;
  const fillPos = spread > 0 ? Math.min(1, Math.max(0, (fill - bid) / spread)) : side === 'ASK' ? 1 : side === 'BID' ? 0 : 0.5;
  const size = num(row.size);
  const premium = num(row.premium) || fill * size * 100;
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  /* the contract's day by side (the vendor's ask_vol / bid_vol / mid_vol sum to its volume) — the row's day lean */
  const askVol = num(row.ask_vol);
  const bidVol = num(row.bid_vol);
  const volSum = askVol + bidVol;
  const { multi, sweep, compression, cross } = printCondition(row);
  void i;
  const idRaw = printKeyOf(row);
  return {
    id: hashId(idRaw),
    time: when.time,
    ticker,
    /* the condition says "a leg of a multi-leg order", not how many legs it had — 2 is the marker, drawn as "multi-leg" */
    legs: multi ? 2 : 1,
    strike,
    right,
    otmPct: otmOf(right, strike, spot, spotIsIndexLevel(row, ticker)),
    expiry: expiryLabel(expiryIso),
    /* days to run from the print's own trade date (the vendor's dte where the row carries one), never the clock's */
    dte: row.dte != null && row.dte !== '' && Number.isFinite(Number(row.dte)) ? Math.max(0, Number(row.dte)) : dteFrom(expiryIso, when.ms > 0 ? nyDateOf(when.ms) : tapeSessionIso()),
    fill,
    bid,
    ask,
    fillPos,
    side,
    ratioBidPct: volSum > 0 ? Math.round((bidVol / volSum) * 100) : NaN,
    size,
    nbboBidSize: row.nbbo_bid_size != null && row.nbbo_bid_size !== '' ? num(row.nbbo_bid_size) : undefined,
    nbboAskSize: row.nbbo_ask_size != null && row.nbbo_ask_size !== '' ? num(row.nbbo_ask_size) : undefined,
    premium,
    volume,
    oi,
    deltaOI: 0,
    spot,
    /* the vendor's IV is always a fraction — a same-day contract's 5.3 is 530%, not 5% */
    iv: num(row.implied_volatility) * 100,
    volOverOI: oi > 0 ? volume / oi : 0,
    strat: '—',
    sweep,
    alertId: typeof row.flow_alert_id === 'string' ? row.flow_alert_id : null,
    epoch: when.epoch,
    epochMs: when.ms,
    vendorId: idRaw,
    occ: row.option_chain_id ? String(row.option_chain_id) : row.option_chain ? String(row.option_chain) : row.option_symbol ? String(row.option_symbol) : undefined,
    extended: extended || undefined,
    theta: row.theta != null && row.theta !== '' ? num(row.theta) : undefined,
    daySide: row.ask_vol != null || row.bid_vol != null ? { ask: askVol, bid: bidVol, mid: num(row.mid_vol) + num(row.no_side_vol) } : undefined,
    compression: compression || undefined,
    cross: cross || undefined,
    quoteNoRead: quoteNoRead ?? undefined,
  };
}

/* A flow alert is an aggregate (`trade_count` prints on one contract in a window): its side is the one that carried
   60% or more of its money, else mid; its quote is `bid` / `ask` and its last fill `price`. */
export function alertToPrint(row: Record<string, unknown>, i = 0): FlowPrint {
  const askPrem = num(row.total_ask_side_prem);
  const bidPrem = num(row.total_bid_side_prem);
  const sided = askPrem + bidPrem;
  const total = num(row.total_premium);
  /* the alert's side is the one lean rule over its premium by side, the unsided rest as mid */
  const whole = Math.max(total, sided);
  const lean = leanOfSides({ ask: askPrem, bid: bidPrem, mid: Math.max(0, whole - sided) }).lean;
  const side: 'ASK' | 'BID' | 'MID' = lean === 'ASK' ? 'ASK' : lean === 'BID' ? 'BID' : 'MID';
  const tags = side === 'ASK' ? ['ask_side'] : side === 'BID' ? ['bid_side'] : ['mid_side'];
  const base = tradeToPrint(
    {
      ...row,
      tags,
      price: row.price,
      nbbo_bid: row.bid,
      nbbo_ask: row.ask,
      premium: row.total_premium ?? row.premium,
      size: row.total_size ?? row.size,
      /* start_time … end_time is the window the alert's prints filled in; created_at is only its filing */
      executed_at: row.start_time ?? row.end_time ?? row.created_at,
      underlying_price: row.underlying_price,
      option_type: row.type ?? row.option_type,
      option_chain_id: row.option_chain,
      implied_volatility: row.iv ?? row.iv_end ?? row.iv_start,
      flow_alert_id: row.id,
      upstream_condition_detail: '',
      report_flags: [],
      __aggregate: true,
      ask_vol: undefined,
      bid_vol: undefined,
    },
    i
  );
  return {
    ...base,
    alertId: String(row.id || base.alertId || ''),
    sweep: row.has_sweep === true,
    legs: row.has_multileg === true && row.has_singleleg !== true ? 2 : 1,
    trades: num(row.trade_count) || undefined,
    /* the bid's share of the sided money (ask + bid), as a print's ratioBidPct is of its sided contracts */
    ratioBidPct: sided > 0 ? Math.round((bidPrem / sided) * 100) : NaN,
    alertSides: { ask: askPrem, bid: bidPrem, other: Math.max(0, total - sided) },
    alertRule: row.alert_rule ? String(row.alert_rule) : undefined,
    /* the alert's filing instant — the route's older_than cursor (the endless lists) */
    createdMs: row.created_at != null && Number.isFinite(Date.parse(String(row.created_at))) ? Date.parse(String(row.created_at)) : undefined,
    fillEnd: row.end_time != null && row.start_time != null && num(row.end_time) - num(row.start_time) >= 1000 ? clock(row.end_time).time : undefined,
    /* an alert carries no session flag of its own: its fill time says it */
    extended: (() => {
      const m = clock(row.start_time ?? row.created_at).minute;
      return m > 0 && (m < SESSION_OPEN || m >= sessionEndMin(base.ticker)) ? true : undefined;
    })(),
  };
}

/** A floor package filed as alerts: no-side alerts on one root whose fills started in the same millisecond, known by
    shape since the route carries no floor flag. */
export function markAlertPackages(rows: FlowPrint[]): FlowPrint[] {
  const rootOf = (p: FlowPrint) => (indexRoot(p.ticker) ?? p.ticker).toUpperCase();
  const by = new Map<string, Set<string>>();
  for (const p of rows) {
    if (p.side !== 'MID' || !p.epochMs) continue;
    const k = `${rootOf(p)}|${p.epochMs}`;
    const set = by.get(k) ?? new Set<string>();
    set.add(`${p.strike}${p.right}${p.expiry}`);
    by.set(k, set);
  }
  return rows.map(p => (p.side === 'MID' && p.epochMs && (by.get(`${rootOf(p)}|${p.epochMs}`)?.size ?? 0) > 1 ? { ...p, floorPackage: true } : p));
}

/** Rows mapped once the index levels they need are in hand (an index print carries no underlying price) */
export async function mapWithIndex<T>(rows: Record<string, unknown>[], fn: (r: Record<string, unknown>, i: number) => T): Promise<T[]> {
  await ensureIndexLevels(rows.map(tickerOfRow));
  return rows.map(fn);
}
/** Screener rows mapped once their names' live prices are in hand too — the row's stock_price is the stalled state */
export async function mapBook(rows: Record<string, unknown>[]): Promise<BookContract[]> {
  const names = rows.map(tickerOfRow);
  await Promise.all([ensureIndexLevels(names), ensureSpots(names)]);
  return rows.map(contractRow);
}

/** One screener row as a book contract (exported for scripts/trace-moneyness-proof.ts) */
export function contractRow(row: Record<string, unknown>, _i = 0): BookContract {
  const ticker = String(row.ticker_symbol || row.underlying_symbol || row.ticker || '').toUpperCase();
  const expiryIso = String(row.expiry || '').slice(0, 10);
  const strike = num(row.strike);
  const right: 'C' | 'P' = String(row.option_type || '').toLowerCase().startsWith('p') ? 'P' : 'C';
  /* the row's stock_price is the vendor's stock-state, which can stall for hours: the newest live price wins; an index
     row carries none, so it reads the index level */
  const live = liveSpotOf(ticker);
  const spot = live || num(row.stock_price) || indexLevel(ticker);
  const volume = num(row.volume);
  const oi = num(row.open_interest);
  const premium = num(row.premium);
  const ask = num(row.ask_side_volume);
  const bid = num(row.bid_side_volume);
  const mid = num(row.mid_volume) + num(row.no_side_volume);
  const when = clock(row.last_fill);
  const dte = dteOf(expiryIso);
  return {
    /* stable across polls and re-ranks: the OCC symbol, else the contract's parts */
    key: row.option_symbol ? String(row.option_symbol) : `${ticker}-${strike}-${right}-${expiryIso}`,
    optionSymbol: row.option_symbol ? String(row.option_symbol) : undefined,
    ticker,
    sector: row.sector ? String(row.sector) : null,
    sectorColor: null,
    strike,
    right,
    expiry: expiryLabel(expiryIso),
    dte,
    spot,
    otmPct: otmOf(right, strike, spot, !(live > 0) && !(num(row.stock_price) > 0) && !!indexRoot(ticker)),
    last: num(row.close || row.avg_price),
    /* the fill against the contract's prior close (chain_prev_close) — `roc` is not a price change (TSLA 370C: roc 0.76
       beside a real +15.0%); no prior close (a new listing) is no change to state */
    chgPct: num(row.chain_prev_close) > 0 ? ((num(row.close || row.avg_price) - num(row.chain_prev_close)) / num(row.chain_prev_close)) * 100 : NaN,
    lastAt: when.time.slice(0, 5),
    lastAtMin: when.minute,
    volume,
    oi,
    deltaOI: num(row.open_interest) - num(row.prev_oi),
    deltaOIPct: num(row.prev_oi) > 0 ? ((oi - num(row.prev_oi)) / num(row.prev_oi)) * 100 : 0,
    premium,
    /* the screener sends no `iv` — only yesterday's and the change since (prev_iv + iv_change); reading `iv` alone put 0% on
       every row of the Screener */
    iv: (() => {
      const v = num(row.iv) || (row.prev_iv != null ? num(row.prev_iv) + num(row.iv_change) : 0);
      return v * 100; // always a fraction: a same-day contract's 5.31 is 531%, never 5%
    })(),
    ivChg: num(row.iv_change) * 100,
    volOverOI: oi > 0 ? volume / oi : 0,
    sweepPct: volume > 0 ? (num(row.sweep_volume) / volume) * 100 : 0,
    multiPct: volume > 0 ? (num(row.multileg_volume) / volume) * 100 : 0,
    floorPct: volume > 0 ? (num(row.floor_volume) / volume) * 100 : 0,
    crossPct: volume > 0 ? Math.min(100, (num(row.cross_volume) / volume) * 100) : 0,
    askPct: ask + bid > 0 ? (ask / (ask + bid)) * 100 : 0,
    prevOI: num(row.prev_oi),
    prevAvgFill: num(row.chain_prev_close),
    oiStreak: num(row.days_of_oi_increases),
    volGtOiStreak: num(row.days_of_vol_greater_than_oi),
    /* the name's next report in sessions from the tape's day — only when it lands before this contract expires
       (the column was a dead row of dashes: the field was never read) */
    earnDays: (() => {
      const er = String(row.next_earnings_date || '').slice(0, 10);
      const session = tapeSessionIso();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(er) || er < session || (expiryIso && er > expiryIso)) return null;
      const at = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
      return sessionsBetween(at(session), at(er));
    })(),
    earnIso: /^\d{4}-\d{2}-\d{2}$/.test(String(row.next_earnings_date || '').slice(0, 10)) ? String(row.next_earnings_date).slice(0, 10) : null,
    sideVol: { ask, bid, mid },
    expired: expiredAtBell(expiryIso, ticker),
    theta: row.theta != null && row.theta !== '' ? num(row.theta) : undefined,
    lastDay: when.ms > 0 ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(when.ms)) : undefined,
  };
}

/** A contract whose expiry was the tape's session (or before) and whose bell has rung no longer stands */
/** Its own bell: 16:15 for the late-closing index and ETF options (sessionEndMin), 16:00 for a stock's. */
export function expiredAtBell(expiryIso: string, ticker?: string | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryIso)) return false;
  const session = tapeSessionIso();
  if (expiryIso < session) return true;
  if (expiryIso > session) return false;
  const p = nyParts(new Date());
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return today > session || p.hour * 60 + p.minute >= sessionEndMin(ticker);
}

/** The contracts that still stand — the expired ones left out, and how many were */
export function standing<T extends { expired?: boolean }>(rows: T[]): { rows: T[]; expired: number } {
  const out = rows.filter(r => !r.expired);
  return { rows: out, expired: rows.length - out.length };
}

/* The screener's open_interest is the count its session opened on; once the next count is published the row takes it
   and says whose trading it reflects (oiDay, oiPending). */
export function nextSessionIso(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + 1);
  for (let i = 0; i < 10 && !isTradingDay(d); i++) d.setDate(d.getDate() + 1);
  return isoDate(d);
}
/** The session before a session day, YYYY-MM-DD */
export function prevSessionIso(iso: string = tapeSessionIso()): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return isoDate(sessionBefore(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))));
}
/** What a net-premium figure covers, so a page can say it beside the figure: the stretch (New York clocks), the source,
    and what it leaves out. Every net figure Trace makes returns one. */
export interface NetCovers {
  /** "09:30" — the first minute or print counted, New York */
  since: string;
  /** "16:15" — the last */
  until: string;
  /** Whose figure: "net-prem-ticks", "market tide", "net flow by expiry", "flow by expiry", "the book's contracts", "the prints in hand" */
  source: string;
  /** Left out of it: "pre-market", "spread legs", "crosses", "compression", "after hours", "strikes off the cut"… */
  leaves: string[];
  /** True when the figure is the app's own estimate off contract shares, not the vendor's sum */
  approx?: boolean;
}
const hhmm = (sec: number) => (sec > 0 ? clock(sec).time.slice(0, 5) : '—');
/** A series' stretch, first to last point (epoch seconds) */
export function coversOf(points: readonly { time: number }[], source: string, leaves: string[] = [], approx = false): NetCovers {
  let first = 0;
  let last = 0;
  for (const p of points) {
    if (!(p.time > 0)) continue;
    if (!first || p.time < first) first = p.time;
    if (p.time > last) last = p.time;
  }
  return { since: hhmm(first), until: hhmm(last), source, leaves, ...(approx ? { approx } : {}) };
}

/** The tide's net between two New York minutes [from, to): its running figure at the last point before `to`, less the last
    point before `from` (the tide runs from 07:30, so the regular session's own net is the difference) */
export function tideBetween(rows: { time: number; callPrem: number; putPrem: number }[], from: number, to: number): { calls: number; puts: number; net: number; first: number; last: number; covers: NetCovers } | null {
  let base: { callPrem: number; putPrem: number } | null = null;
  let end: { time: number; callPrem: number; putPrem: number } | null = null;
  let first = 0;
  for (const r of rows) {
    const p = nyParts(new Date(r.time * 1000));
    const m = p.hour * 60 + p.minute;
    if (m < from) base = r;
    else if (m < to) {
      if (!first) first = r.time;
      end = r;
    }
  }
  if (!end) return null;
  const calls = end.callPrem - (base?.callPrem ?? 0);
  const puts = end.putPrem - (base?.putPrem ?? 0);
  /* from the window's own start when a point before it is the base, else from the vendor's first minute (07:30) */
  const since = base ? `${String(Math.floor(from / 60)).padStart(2, '0')}:${String(from % 60).padStart(2, '0')}` : hhmm(first);
  return { calls, puts, net: calls - puts, first, last: end.time, covers: { since, until: hhmm(end.time), source: 'market tide', leaves: [] } };
}

/** A contract's OCC symbol from its parts — "SPY", 763, P, "10/22/2026" → SPY261022P00763000; an index's weekly root
    (SPXW, NDXP…) is the caller's to pass */
export function occOf(root: string, strike: number, right: 'C' | 'P', expiry: string): string | null {
  const m = expiry.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) ?? null;
  const iso = m ? `${m[3]}-${m[1]}-${m[2]}` : expiry.slice(0, 10);
  const d = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!d || !(strike > 0) || !root) return null;
  return `${root.toUpperCase()}${d[1].slice(2)}${d[2]}${d[3]}${right}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
}

/** Inside the spread, a fill this far toward a side (fillPos 0–1 from the bid) counts to it: 0.8 and up the ask, 0.2 and
    under the bid; the middle three-fifths stays MID */
export const NEAR_SIDE = 0.8;
/** Print versus the quote. At or above the ask is a lift, at or below the bid a hit, and within a fifth of the spread of
    either it counts to that side (NEAR_SIDE). A locked or crossed quote (bid at or over the ask) says nothing: MID, as
    sideOfTags reads it. Null when NBBO is missing. */
export function execOf(price: number, bid: number, ask: number): 'ASK' | 'BID' | 'MID' | null {
  if (!(price > 0) || !(bid > 0) || !(ask > 0)) return null;
  if (bid >= ask) return 'MID';
  if (price >= ask - 1e-6) return 'ASK';
  if (price <= bid + 1e-6) return 'BID';
  const pos = (price - bid) / (ask - bid);
  return pos >= NEAR_SIDE - 1e-9 ? 'ASK' : pos <= 1 - NEAR_SIDE + 1e-9 ? 'BID' : 'MID';
}
