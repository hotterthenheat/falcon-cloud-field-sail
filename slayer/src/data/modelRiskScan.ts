/* The live tail-risk scan. Every hour, including outside the cash session. Models 1, 2 and 3 are not touched.

   Bars come from one full-day minute read, not the cash-only memo the other models use. A chain is asked
   only after a name's close has broken the last 30 closes, and only one name a pass, so the other models
   keep the terminal. One entry per name per book per side per day. Five open tickets on each
   book, so a weekly name cannot take the same-day seat. An open ticket is
   not flattened on a clock and is not dropped at midnight.
*/

import { compassHost, onServer } from './compassHost';
import { nyParts, nyWallStamp } from '../core/nyTime';
import { REGULAR_OPEN_MIN } from '../core/session';
import { INDEX, UNDER } from './compassFeatures';
import {
  CLS_INDEX,
  NO_SAME_DAY,
  OVERNIGHT_ROOTS,
  atmStrike,
  printOf,
  spreadPass,
  strikeDistance,
  strikeSpan,
  weekdayDte,
} from './compassParams';
import { COMPASS_TICKERS } from './compassUniverse';
import { closeTail, recordTail } from './compassLedger';
import {
  TAIL_OPEN_MAX,
  TAIL_OPEN_NOW,
  betterRank,
  breakSide,
  emptyTail,
  exitAt,
  quoteFresh,
  rankMinute,
  tailQuoteOk,
  trailRange,
  contractRank,
  type TailBook,
  type TailPublic,
  type TailTicket,
} from './modelRisk';

const NO_ODTE = new Set<string>(NO_SAME_DAY);
/** Strike span uses the same index-or-ETF set the cash scan used. The bar route does not. */
const SPAN_AS_INDEX = new Set<string>(CLS_INDEX);
/** The weekly root Compass already lists for a cash index. */
const LISTED_ROOT: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP' };

interface MinuteClose { d: string; m: number; c: number }

interface NameState {
  /** Close of minute-of-day i, missing when that minute has no print */
  closes: (number | null)[];
  /** Last minute whose close we have */
  have: number;
  high: number;
  low: number;
  ready: boolean;
}

let day = '';
let cursor = 0;
let running = false;
let names = new Map<string, NameState>();
let taken = new Set<string>();
let open: TailTicket[] = [];
let closed: TailTicket[] = [];
let published = '';
const expMemo = new Map<string, { at: number; list: string[] }>();
/** A name that listed no same-day expiration. Not asked again today. */
const noOdte = new Set<string>();
/** A name whose chain just failed waits, so the next pass can arm someone else. */
const skipUntil = new Map<string, number>();
const barMemo = new Map<string, { at: number; bars: MinuteClose[] }>();
/** Closes kept for an open ticket after the calendar day rolls, keyed by iso|ticker. */
const heldCloses = new Map<string, (number | null)[]>();

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function ymdOf(p: { year: number; month: number; day: number }): string {
  return `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

function isoOf(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function roll(next: string): void {
  if (day === next) return;
  if (day) {
    for (const t of open) {
      if (t.day !== day) continue;
      const s = names.get(t.ticker);
      if (s) heldCloses.set(`${day}|${t.ticker}`, s.closes);
    }
  }
  day = next;
  names = new Map();
  taken = new Set(open.map(t => t.id));
  closed = [];
  cursor = 0;
  expMemo.clear();
  barMemo.clear();
  noOdte.clear();
  skipUntil.clear();
}

function stateOf(ticker: string): NameState {
  let s = names.get(ticker);
  if (!s) {
    s = { closes: [], have: -1, high: 0, low: 0, ready: false };
    names.set(ticker, s);
  }
  return s;
}

function takeCloses(s: NameState, bars: readonly MinuteClose[], ymd: string): void {
  for (const b of bars) {
    if (b.d !== ymd || !(b.c > 0) || b.m < 0 || b.m > 1439) continue;
    s.closes[b.m] = b.c;
    if (b.m > s.have) s.have = b.m;
  }
  const range = s.have >= 0 ? trailRange(s.closes, s.have) : null;
  if (range) {
    s.high = range.high;
    s.low = range.low;
    s.ready = true;
  } else {
    s.ready = false;
  }
}

function barsOf(data: unknown): MinuteClose[] {
  const flat: Record<string, unknown>[] = [];
  for (const item of Array.isArray(data) ? data : []) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { data?: unknown };
    if (Array.isArray(row.data)) flat.push(...(row.data as Record<string, unknown>[]));
    else flat.push(item as Record<string, unknown>);
  }
  const out: MinuteClose[] = [];
  for (const b of flat) {
    const at = nyWallStamp(b.timestamp ?? b.time ?? b.date);
    const c = num(b.close);
    if (!at || !(c > 0)) continue;
    const p = nyParts(at);
    out.push({ d: ymdOf(p), m: p.hour * 60 + p.minute, c });
  }
  return out;
}

/** Equity tape is 04:00–20:00. An index is asked for the whole day; a zero close is not a print. */
async function tailBars(ticker: string, ymd: string, done: number): Promise<MinuteClose[]> {
  const under = UNDER[ticker] ?? printOf(ticker);
  const index = INDEX.has(ticker) || INDEX.has(under);
  const key = `${index ? 'i' : 's'}|${under}|${ymd}`;
  const hit = barMemo.get(key);
  let last = -1;
  if (hit) for (const b of hit.bars) if (b.d === ymd && b.m > last) last = b.m;
  if (hit && (Date.now() - hit.at < 2_000 || (Date.now() - hit.at < 60_000 && last >= done))) return hit.bars;
  const span = index ? 'start_time=00:00:00.000&end_time=23:59:59.999' : 'start_time=04:00:00.000&end_time=20:00:00.000';
  const path = `/${index ? 'index' : 'stock'}/history/ohlc?symbol=${encodeURIComponent(under)}&start_date=${ymd}&end_date=${ymd}&interval=1m&${span}&format=json`;
  const got = await compassHost().theta(path);
  if (got.error && got.error !== 'no_data') return hit?.bars ?? [];
  const bars = got.error ? [] : barsOf(got.data);
  barMemo.set(key, { at: Date.now(), bars });
  return bars;
}

/** Book 0 root. NDX is skipped (NDXP is not entitled). SPX and RUT use the weekly root. VIX has no same-day contract. */
export function book0Root(symbol: string): string | null {
  const s = symbol.toUpperCase();
  if (s === 'NDX' || s === 'NDXP' || s === 'VIX') return null;
  if (s === 'SPX' || s === 'SPXW') return 'SPXW';
  if (s === 'RUT' || s === 'RUTW') return 'RUTW';
  if (NO_ODTE.has(s)) return null;
  return s;
}

/** Book 1-7 uses the root Compass already lists for that name. */
export function book17Root(symbol: string): string {
  const s = symbol.toUpperCase();
  return LISTED_ROOT[s] ?? s;
}

function underOf(symbol: string): string {
  return printOf(symbol);
}

function keyOf(ticker: string, book: TailBook, right: 'C' | 'P'): string {
  return `${day}|${ticker}|${book}|${right}`;
}

interface Leg {
  strike: number;
  bid: number;
  ask: number;
  at: number;
  exp: string;
}

function legsOf(data: unknown, now: number, rightWanted: 'C' | 'P'): Leg[] {
  const out: Leg[] = [];
  const items = Array.isArray(data) ? data : [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const bag = item as Record<string, unknown>;
    const contract = bag.contract && typeof bag.contract === 'object' ? (bag.contract as Record<string, unknown>) : bag;
    const quote = Array.isArray(bag.data) ? (bag.data[0] as Record<string, unknown>) : bag;
    if (!quote || typeof quote !== 'object') continue;
    const right = String(contract.right || quote.right || '').toLowerCase();
    if (!right.startsWith(rightWanted === 'C' ? 'c' : 'p')) continue;
    const strike = num(contract.strike ?? quote.strike);
    const bid = num(quote.bid);
    const ask = num(quote.ask);
    const at = nyWallStamp(quote.timestamp);
    const exp = String(contract.expiration || quote.expiration || '').slice(0, 10);
    if (!(strike > 0) || !exp) continue;
    if (!quoteFresh(at, now)) continue;
    if (!spreadPass(bid, ask)) continue;
    out.push({ strike, bid, ask, at, exp });
  }
  return out;
}

async function listedExpiries(root: string): Promise<string[]> {
  const hit = expMemo.get(root);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.list;
  const got = await compassHost().theta(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`);
  if (got.error) return hit?.list ?? [];
  const list = (Array.isArray(got.data) ? got.data : []).map(r => String((r as { expiration?: string }).expiration ?? '').slice(0, 10)).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e));
  expMemo.set(root, { at: Date.now(), list });
  return list;
}

async function expiryFor(root: string, session: string, book: TailBook): Promise<string | null> {
  const list = await listedExpiries(root);
  const hits = list.filter(e => {
    const n = weekdayDte(session, e.replace(/-/g, ''));
    return book === '0' ? n === 0 : n >= 1 && n <= 7;
  }).sort((a, b) => (a < b ? -1 : 1));
  return hits[0] ?? null;
}

async function chain(root: string, expiry: string, span: number, now: number, right: 'C' | 'P'): Promise<Leg[]> {
  const exp = expiry.replace(/-/g, '');
  const got = await compassHost().theta(
    `/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(root)}&expiration=${exp}&right=${right === 'C' ? 'call' : 'put'}&strike_range=${span}&format=json`,
  );
  if (got.error) return [];
  return legsOf(got.data, now, right).filter(l => l.exp === expiry);
}

async function bidThen(root: string, expiry: string, strike: number, ymd: string, minute: number, right: 'C' | 'P'): Promise<number | null> {
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  const got = await compassHost().theta(
    `/option/at_time/quote?symbol=${encodeURIComponent(root)}&expiration=${expiry.replace(/-/g, '')}&strike=${strike}&right=${right === 'C' ? 'call' : 'put'}&start_date=${ymd}&end_date=${ymd}&time_of_day=${hh}:${mm}:00.000&format=json`,
  );
  if (got.error || !Array.isArray(got.data)) return null;
  for (const item of got.data) {
    if (!item || typeof item !== 'object') continue;
    const bag = item as Record<string, unknown>;
    const quote = Array.isArray(bag.data) ? (bag.data[0] as Record<string, unknown>) : bag;
    const bid = num(quote?.bid);
    if (bid > 0) return bid;
  }
  return null;
}

/** Sum of call_gamma_oi + put_gamma_oi across the strike pages. Not multiplied by 100. Label only. */
async function dealerGex(ticker: string): Promise<number | null> {
  if (!onServer()) return null;
  let sum = 0;
  let pages = 0;
  try {
    for (let page = 0; page < 12; page++) {
      const res = await fetch(`http://127.0.0.1:8080/api/uw/stock/${encodeURIComponent(ticker)}/spot-exposures/strike?limit=500&page=${page}`);
      if (!res.ok) return pages ? sum : null;
      const body = (await res.json()) as { data?: unknown };
      const rows = Array.isArray(body.data) ? body.data : Array.isArray(body) ? (body as unknown[]) : [];
      if (!rows.length) break;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        sum += num(r.call_gamma_oi) + num(r.put_gamma_oi);
      }
      pages += 1;
      if (rows.length < 500) break;
    }
  } catch {
    return pages ? sum : null;
  }
  return pages ? sum : null;
}

function contractWord(root: string, strike: number, right: 'C' | 'P'): string {
  const k = strike % 1 === 0 ? strike.toFixed(0) : strike.toFixed(2);
  return `${root} ${k}${right}`;
}

async function rankBook(ticker: string, book: TailBook, minute: number, spot: number, session: string, now: number, right: 'C' | 'P'): Promise<Omit<TailTicket, 'id' | 'day' | 'orHigh' | 'orLow' | 'gex' | 'exitMinute' | 'exitBid' | 'exitAt' | 'why'> | null> {
  const root = book === '0' ? book0Root(ticker) : book17Root(ticker);
  if (!root) return null;
  const expiry = await expiryFor(root, session, book);
  if (!expiry) return null;
  const dte = weekdayDte(session, expiry.replace(/-/g, ''));
  if (book === '0' ? dte !== 0 : !(dte >= 1 && dte <= 7)) return null;
  const probe = await chain(root, expiry, 12, now, right);
  const strikes = [...new Set(probe.map(l => l.strike))].sort((a, b) => a - b);
  if (!strikes.length) return null;
  const index = SPAN_AS_INDEX.has(ticker) || SPAN_AS_INDEX.has(root);
  const span = strikeSpan(spot, strikes, index);
  const atm = atmStrike(strikes, spot);
  if (!(atm > 0)) return null;
  let best: { leg: Leg; rank: NonNullable<ReturnType<typeof contractRank>>; dist: number } | null = null;
  for (const leg of probe) {
    if (strikeDistance(strikes, spot, leg.strike) > span + 1e-9) continue;
    if (!tailQuoteOk(leg.bid, leg.ask, leg.strike, spot, ticker, root)) continue;
    const mid = (leg.bid + leg.ask) / 2;
    const rank = contractRank(spot, leg.strike, rankMinute(minute), dte, mid, right === 'C');
    if (!rank) continue;
    const dist = Math.abs(leg.strike - spot) / spot;
    if (!best || betterRank(rank.score, dist, best.rank.score, best.dist)) best = { leg, rank, dist };
  }
  if (!best) return null;
  return {
    book,
    right,
    ticker,
    root,
    contract: contractWord(root, best.leg.strike, right),
    strike: best.leg.strike,
    expiry,
    expiryTradingDays: dte,
    entryMinute: minute,
    entryAsk: best.leg.ask,
    entryBid: best.leg.bid,
    entryAt: best.leg.at,
    spot,
    score: best.rank.score,
    iv: best.rank.iv,
    gamma: best.rank.gamma,
    thetaYear: best.rank.thetaYear,
  };
}

function bookOpen(book: TailBook): number {
  let n = 0;
  for (const t of open) if (t.book === book) n += 1;
  return n;
}

function publish(set: (t: TailPublic) => void): void {
  let armed = 0;
  for (const s of names.values()) if (s.ready) armed += 1;
  const line = `Tail risk. ${armed} ranges set. ${open.length} open of ${TAIL_OPEN_NOW}. ${closed.length} closed. One contract until it is out. Puts above the last 30 closes, calls under them.`;
  const next: TailPublic = { day, armed, read: names.size, open: open.slice(), closed: closed.slice(), line };
  const stamp = JSON.stringify(next);
  if (stamp === published) return;
  published = stamp;
  set(next);
}

/** Restore tickets after a restart. An open ticket is kept even when its day is already over.
    A ticket written before the clock was removed stored minutes after 09:30. The quote time tells them apart. */
export function importTail(raw: TailPublic | null | undefined): void {
  if (!raw || !raw.day) return;
  day = raw.day;
  const keep = (t: TailTicket): TailTicket => {
    const right = t.right === 'C' || t.right === 'P' ? t : { ...t, right: 'P' as const };
    if (!(right.entryAt > 0) || right.entryMinute >= REGULAR_OPEN_MIN) return right;
    const q = nyParts(right.entryAt);
    const quoteMin = q.hour * 60 + q.minute;
    const asCash = right.entryMinute + REGULAR_OPEN_MIN;
    if (quoteMin >= asCash && quoteMin - asCash <= 2) return { ...right, entryMinute: asCash };
    return right;
  };
  open = (raw.open ?? []).filter(t => t && !t.why).map(keep);
  closed = (raw.closed ?? []).filter(t => t && !!t.why).map(keep);
  taken = new Set([...open, ...closed].map(t => t.id || keyOf(t.ticker, t.book, t.right)));
  published = '';
}

function daysFrom(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const d = new Date(`${fromIso}T12:00:00Z`);
  const end = new Date(`${toIso}T12:00:00Z`).getTime();
  for (let i = 0; i < 12 && d.getTime() <= end; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out.length ? out : [toIso];
}

async function closesOn(ticker: string, iso: string, todayIso: string): Promise<(number | null)[] | null> {
  if (iso === todayIso) return names.get(ticker)?.closes ?? null;
  const key = `${iso}|${ticker}`;
  const held = heldCloses.get(key);
  if (held) return held;
  const ymd = iso.replace(/-/g, '');
  const bars = await tailBars(ticker, ymd, 24 * 60);
  const closes: (number | null)[] = [];
  for (const b of bars) {
    if (b.d !== ymd || !(b.c > 0)) continue;
    closes[b.m] = b.c;
  }
  heldCloses.set(key, closes);
  return closes;
}

/** The first close back through the line, on the entry day or a later day. The minute still printing does not count. */
async function findExit(ticket: TailTicket, todayIso: string, done: number): Promise<{ ymd: string; minute: number; why: 'back' | 'held' } | null> {
  const line = ticket.right === 'C' ? ticket.orLow : ticket.orHigh;
  const right = ticket.right === 'C' ? 'C' : 'P';
  const days = ticket.day && ticket.day < todayIso ? daysFrom(ticket.day, todayIso) : [todayIso];
  for (const iso of days) {
    const closes = await closesOn(ticket.ticker, iso, todayIso);
    if (!closes) continue;
    const hit = exitAt(closes, iso === ticket.day ? ticket.entryMinute : -1, line, right);
    if (!hit) continue;
    if (iso === todayIso && hit.minute > done) continue;
    return { ymd: iso.replace(/-/g, ''), minute: hit.minute, why: hit.why };
  }
  return null;
}

export function tailNow(): TailPublic {
  return { day, armed: [...names.values()].filter(s => s.ready).length, read: names.size, open: open.slice(), closed: closed.slice(), line: '' };
}

/** One pass. Safe to call every second: it will not stack, and it asks for at most four bar reads and one chain. */
export async function tailPass(now: number, set: (t: TailPublic) => void): Promise<void> {
  if (!onServer() || running) return;
  const p = nyParts(now);
  const minuteOfDay = p.hour * 60 + p.minute;
  const ymd = ymdOf(p);
  const session = isoOf(ymd);
  running = true;
  try {
    roll(session);
    /* the minute in progress has not closed */
    const done = minuteOfDay - 1;
    let reads = 0;
    let stepped = 0;
    const n = COMPASS_TICKERS.length;
    const order: string[] = [];
    const seen = new Set<string>();
    for (const t of open) {
      if (seen.has(t.ticker)) continue;
      seen.add(t.ticker);
      order.push(t.ticker);
    }
    for (let k = 0; k < n; k++) {
      const ticker = COMPASS_TICKERS[(cursor + k) % n];
      if (seen.has(ticker)) continue;
      order.push(ticker);
    }
    for (const ticker of order) {
      if (reads >= 4) break;
      const prioritized = open.some(t => t.ticker === ticker);
      const s = stateOf(ticker);
      if (s.have >= done && done >= 0) {
        if (!prioritized) stepped += 1;
        continue;
      }
      const bars = await tailBars(ticker, ymd, done);
      takeCloses(s, bars, ymd);
      reads += 1;
      if (!prioritized) stepped += 1;
    }
    cursor = (cursor + Math.max(stepped, 1)) % n;

    const still = open.slice();
    for (const ticket of still) {
      const hit = await findExit(ticket, session, done);
      if (!hit) continue;
      const bid = await bidThen(ticket.root, ticket.expiry, ticket.strike, hit.ymd, hit.minute, ticket.right === 'C' ? 'C' : 'P');
      if (!(bid != null && bid > 0)) continue;
      ticket.exitMinute = hit.minute;
      ticket.exitBid = bid;
      ticket.exitAt = now;
      ticket.why = hit.why;
      open = open.filter(t => t.id !== ticket.id);
      closed = [ticket, ...closed];
      closeTail(ticket);
    }

    if (open.length < TAIL_OPEN_NOW && done >= 0) {
      let listed = 0;
      for (let k = 0; k < n; k++) {
        if (bookOpen('0') >= TAIL_OPEN_MAX && bookOpen('1-7') >= TAIL_OPEN_MAX) break;
        const ticker = COMPASS_TICKERS[(cursor + k) % n];
        const s = names.get(ticker);
        if (!s?.ready) continue;
        const minute = Math.min(s.have, done);
        if (!(minute >= 0)) continue;
        const px = s.closes[minute];
        const range = trailRange(s.closes, minute);
        if (!range || px == null) continue;
        const side = breakSide(px, range.high, range.low);
        if (!side) continue;
        /* An equity or ETF option does not trade before 09:30: its pre-open quote is not a fill (Nov 5: SPY 766C
           "bought" at 09:24:39). Only the roots with overnight options take a ticket before the first full regular
           minute. */
        if (!OVERNIGHT_ROOTS.includes(ticker) && minuteOfDay < REGULAR_OPEN_MIN + 1) continue;
        if ((skipUntil.get(ticker) ?? 0) > now) continue;
        const books: TailBook[] = [];
        let sameDay = false;
        if (bookOpen('0') < TAIL_OPEN_MAX && !taken.has(keyOf(ticker, '0', side))) {
          const root = book0Root(ticker);
          if (root && !noOdte.has(ticker)) {
            const exp = await expiryFor(root, session, '0');
            listed += 1;
            if (!exp) noOdte.add(ticker);
            else sameDay = true;
          }
        }
        if (sameDay) books.push('0');
        if (bookOpen('1-7') < TAIL_OPEN_MAX && !taken.has(keyOf(ticker, '1-7', side))) books.push('1-7');
        /* The weekly book is full. A name with no same-day contract is not this pass. */
        if (bookOpen('1-7') >= TAIL_OPEN_MAX && !sameDay) {
          if (listed >= 8) break;
          continue;
        }
        if (!books.length) continue;
        let filled = false;
        for (const book of books) {
          if (open.length >= TAIL_OPEN_NOW) break;
          if (bookOpen(book) >= TAIL_OPEN_MAX) continue;
          const picked = await rankBook(ticker, book, minute, px, session, now, side);
          if (!picked) continue;
          filled = true;
          const ticket: TailTicket = {
            ...picked,
            id: keyOf(ticker, book, side),
            day,
            orHigh: range.high,
            orLow: range.low,
            gex: null,
            exitMinute: null,
            exitBid: null,
            exitAt: null,
            why: null,
          };
          taken.add(ticket.id);
          open = [ticket, ...open];
          recordTail(ticket);
          void dealerGex(underOf(ticker)).then(gex => {
            if (gex == null) return;
            const row = open.find(t => t.id === ticket.id) ?? closed.find(t => t.id === ticket.id);
            if (row) row.gex = gex;
            published = '';
            publish(set);
          });
        }
        if (!filled) skipUntil.set(ticker, now + 20_000);
        break;
      }
    }
    publish(set);
  } finally {
    running = false;
  }
}

export { emptyTail };
