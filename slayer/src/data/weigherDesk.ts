/* The Weigher's chain from ThetaData: listed expiries, the chain's greeks and NBBO (one snapshot call each per chain),
   the session's volume and open interest, and yesterday's close. With the terminal down the last chain stays, stamped
   with when it was read; nothing stands in for it. */

import { expiryFor, isoDate, isTradingDay, type Expiry, MONTHS as MONTHS_SHORT } from '../core/calendar';
import { keepTheta, keptTheta, noData, thetaGet } from './thetaFeed';
import { atmIvAt, expectedMovePctOf, readContract } from './weigherGate';
import { weekdayDte } from './compassParams';
import { nameTape } from './compassSession';
import { nyIsoDate, nyParts, nyWallStamp, nyWallTime } from '../core/nyTime';
import { inRegular, productOf, sessionAt } from '../core/session';
import type { OptionRight } from '../types/compass';
import type { StrikeNode } from '../types/market';
import { peekEntry } from './book/store';
import { sameName } from './spotGexBook';

// ---- the chain --------------------------------------------------------------

export interface DeskContract {
  strike: number;
  right: OptionRight;
  /** Modeled mid, the same estimator every Compass surface prices with */
  mark: number;
  delta: number;
  /** Per $1 of the underlying, per share. The options-flow vendor's own per-contract gamma (its option-contracts rows, the
      ones the name's book already reads) where it has this contract, else the model's off the row's vol. */
  gamma: number;
  /** Where the gamma came from */
  gammaFrom?: 'vendor' | 'model';
  /** Per trading SESSION: the price change over one session on the trading clock, spot and vol held (core/greeks
      thetaPerSession). Inside the last session it is minus the extrinsic. */
  theta: number;
  /** The decay over the next trading hour (or what is left of the session), same clock. */
  thetaHour?: number;
  /** Per point of the quoted IV */
  vega: number;
  /** Percent, quoted on the calendar year (the vendor's convention), whether the vendor sent it or it was solved */
  iv: number;
  /** Where the IV came from */
  ivFrom?: 'vendor' | 'mark';
  /** A European price for an American put in the money: the UI says so (weigherGate EUROPEAN_NOTE) */
  europeanApprox?: boolean;
  /** Risk-neutral odds the contract finishes in the money — N(d2) family */
  itmOdds: number;
  rho: number;
  /** The quote around the mark — bid under, ask over, by a moneyness-wide spread */
  bid: number;
  ask: number;
  /** Session extremes and reference prints for the drilldown */
  high: number;
  low: number;
  prevClose: number;
  last: number;
  volume: number;
  oi: number;
  breakeven: number;
  /** Strike distance from spot, signed percent */
  fromSpotPct: number;
  /* The column-catalog facts: everything below is derived from the same pricing above — no new model, just more of
     its faces. */
  /** Day-stable resting size on each side of the quote, contracts */
  bidSize: number;
  askSize: number;
  /** Last print against yesterday's close — dollars, then percent */
  netChange: number;
  netChangePct: number;
  /** The move the stock needs to reach this contract's breakeven, signed % */
  toBreakevenPct: number;
  /** The mark split at parity: already-in-the-money value, and the rest */
  intrinsic: number;
  extrinsic: number;
  /** Odds the tape touches this strike before expiry. Not twice the finish odds. */
  touchOdds: number;
  /** Odds the contract closes past its breakeven. Long uses the ask. Short uses the bid. */
  profitOddsLong: number;
  profitOddsShort: number;
  /** The ask 30 minutes earlier, when the feed had one. 0 means it was not there. */
  priorAsk?: number;
  /** Exchange time of this quote, epoch ms. 0 means the feed did not stamp it. */
  quotedAt?: number;
}

export interface DeskChainRow {
  strike: number;
  call: DeskContract;
  put: DeskContract;
}

export interface DeskChain {
  ticker: string;
  spot: number;
  step: number;
  rows: DeskChainRow[];
  expiry: Expiry;
  /** The move the options are charging for by this expiry's close, ± percent: S·σ_ATM·√T_calendar (core/volClock
      sigmaToExpiry) */
  expectedMovePct: number;
  /** The IV at spot, percent on the calendar year, interpolated between the strikes around spot (weigherGate atmIvAt).
      Absent on a chain that has none. */
  atmIv?: number;
  /** Live is this contract's own NBBO. Simulated is the desk model, and it says so. */
  source: 'live' | 'simulated';
  /** Newest quote time on the chain, epoch ms. */
  quotedAt: number;
  /** Listed expiration, YYYY-MM-DD. */
  expiryIso: string;
  /** Option symbol the quotes were requested on. Absent means the chain's own ticker. */
  optRoot?: string;
  /** The terminal did not answer this read. */
  offline?: boolean;
  /** When these quotes were read, epoch ms */
  takenAt?: number;
  /** This browser's copy from an earlier visit, shown until the terminal answers */
  kept?: boolean;
}

/** The expiry rail: requested horizons resolved to REAL sessions, deduped —
    two horizons that land on the same Friday are one door, not two. */
export const DESK_DTES = [0, 2, 4, 7, 14, 21, 30, 45] as const;

/** The desk's horizon (calendar days, what `expiryFor` walks) for a REAL expiry date — a deep link carries the
    date, never a count (the Record sent sessions once and the desk read them as days: a Friday print landed on the
    Wednesday). */
export function dteForDate(key: string): number | null {
  for (const dte of DESK_DTES) {
    const e = expiryFor(dte);
    if (isoDate(e.date) === key) return e.dte;
  }
  for (let dte = 0; dte <= 90; dte++) {
    const e = expiryFor(dte);
    if (isoDate(e.date) === key) return e.dte;
  }
  return null;
}

function numOr(v: unknown): number | null {
  if (v == null || v === '') return null;
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

function stampMs(v: unknown): number {
  return nyWallStamp(v);
}

function ymd(iso: string): string {
  return iso.replace(/\D/g, '').slice(0, 8);
}

function contractKey(contract: Record<string, unknown>): string | null {
  const strike = numOr(contract.strike);
  const word = String(contract.right || '').toLowerCase();
  const right: OptionRight | null = word.startsWith('c') ? 'C' : word.startsWith('p') ? 'P' : null;
  if (!right || strike == null || !(strike > 0)) return null;
  return `${Number(strike.toFixed(4))}|${right}`;
}

function snapRows(data: unknown): { contract: Record<string, unknown>; data: Record<string, unknown> }[] {
  if (!Array.isArray(data)) return [];
  const out: { contract: Record<string, unknown>; data: Record<string, unknown> }[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const bag = item as Record<string, unknown>;
    const contract = bag.contract && typeof bag.contract === 'object' ? (bag.contract as Record<string, unknown>) : bag;
    /* v3 answers flat rows (the contract's fields beside the quote's); a grouped answer nests them under `data` */
    const rows = Array.isArray(bag.data) ? bag.data : bag.data && typeof bag.data === 'object' ? [bag.data] : 'data' in bag ? [] : [bag];
    const row = rows[rows.length - 1];
    if (!row || typeof row !== 'object') continue;
    out.push({ contract, data: row as Record<string, unknown> });
  }
  return out;
}

interface LegQuote {
  /** What a long can sell for. 0 is a real bid, not a missing one. */
  bid: number | null;
  /** What a short must pay to cover. Absent when the ask is missing or 0. */
  ask: number | null;
  prev: number | null;
  low: number | null;
  high: number | null;
}

/** A long is worth the bid, including 0. A short is worth the ask, and only when the ask is a real price. The mid is not a live price. */
export function exitPrice(side: 'long' | 'short', bid: number | null, ask: number | null): number | null {
  if (side === 'short') return ask != null && Number.isFinite(ask) && ask > 0 ? ask : null;
  return bid != null && Number.isFinite(bid) && bid >= 0 ? bid : null;
}

const legCache = new Map<string, { at: number; quotes: Map<string, { bid: number; ask: number }> }>();

function legDay(data: unknown): { close: number | null; low: number | null; high: number | null } {
  let close: number | null = null;
  let low: number | null = null;
  let high: number | null = null;
  for (const item of snapRows(data)) {
    const c = numOr(item.data.close);
    const lo = numOr(item.data.low);
    const hi = numOr(item.data.high);
    if (c != null && c > 0) close = c;
    if (lo != null && lo > 0) low = lo;
    if (hi != null && hi > 0) high = hi;
  }
  return { close, low, high };
}

/** Live bids and asks, and yesterday's closes, for many contracts: one NBBO snapshot and one EOD read per option root and
    expiry, whatever the strikes. A leg the feed does not quote stays null. The mid is not stored. */
export async function readLegs(legs: readonly { ticker: string; expiry: string; strike: number; right: OptionRight }[]): Promise<Map<string, LegQuote>> {
  const out = new Map<string, LegQuote>();
  const groups = new Map<string, typeof legs[number][]>();
  for (const l of legs) {
    const g = `${l.ticker.toUpperCase()}|${l.expiry}`;
    const list = groups.get(g) ?? [];
    list.push(l);
    groups.set(g, list);
  }
  await Promise.all(
    [...groups.entries()].map(async ([g, list]) => {
      const [ticker, expiry] = g.split('|');
      const exp = ymd(expiry);
      const quotes = new Map<string, { bid: number; ask: number }>();
      let prevs = new Map<string, number>();
      for (const symbol of optionRoots(ticker)) {
        const hit = legCache.get(`${symbol}|${exp}`);
        let sheet = hit && Date.now() - hit.at < 4000 ? hit.quotes : null;
        if (!sheet) {
          const quote = await thetaGet(`/option/snapshot/quote?symbol=${encodeURIComponent(symbol)}&expiration=${exp}&format=json`, true);
          if (quote.error) continue;
          sheet = new Map();
          for (const item of snapRows(quote.data)) {
            const k = contractKey(item.contract);
            const bid = numOr(item.data.bid);
            const ask = numOr(item.data.ask);
            /* A 0 bid with an ask at or over it is a real quote. A crossed book is not. */
            if (k && bid != null && ask != null && ask >= bid) sheet.set(k, { bid, ask });
          }
          legCache.set(`${symbol}|${exp}`, { at: Date.now(), quotes: sheet });
        }
        for (const [k, v] of sheet) if (!quotes.has(k)) quotes.set(k, v);
        if (!prevs.size) prevs = await eodCloses(symbol, exp);
        if (list.every(l => quotes.has(`${Number(l.strike.toFixed(4))}|${l.right}`))) break;
      }
      for (const l of list) {
        const k = `${Number(l.strike.toFixed(4))}|${l.right}`;
        const q = quotes.get(k);
        out.set(`${l.ticker}|${l.expiry}|${l.strike}|${l.right}`, { bid: q ? q.bid : null, ask: q ? q.ask : null, prev: prevs.get(k) ?? null, low: null, high: null });
      }
    }),
  );
  return out;
}

/** The low and high of the session they say they entered. Today is the live session. A past day is that day's print. */
export async function entryRange(ticker: string, expiry: string, strike: number, right: OptionRight, day: string): Promise<{ low: number; high: number } | null> {
  const exp = ymd(expiry);
  const word = right === 'C' ? 'call' : 'put';
  const y = day.replace(/\D/g, '').slice(0, 8);
  const today = ymd(nyIsoDate());
  for (const symbol of optionRoots(ticker)) {
    const base = `symbol=${encodeURIComponent(symbol)}&expiration=${exp}&strike=${strike}&right=${word}`;
    const got = y === today
      ? await thetaGet(`/option/snapshot/ohlc?${base}&format=json`, true)
      : await thetaGet(`/option/history/eod?${base}&start_date=${y}&end_date=${y}&format=json`);
    if (got.error) continue;
    const session = legDay(got.data);
    if (session.low != null && session.high != null && session.high >= session.low) return { low: session.low, high: session.high };
  }
  return null;
}
function priorWeekdayYmd(now = Date.now()): string {
  const p = nyParts(now);
  let t = nyWallTime(p.year, p.month, p.day, 12, 0) - 86_400_000;
  for (let i = 0; i < 6; i++) {
    const q = nyParts(t);
    if (q.weekday !== 0 && q.weekday !== 6) return `${q.year}${String(q.month).padStart(2, '0')}${String(q.day).padStart(2, '0')}`;
    t -= 86_400_000;
  }
  const q = nyParts(t);
  return `${q.year}${String(q.month).padStart(2, '0')}${String(q.day).padStart(2, '0')}`;
}

const eodCache = new Map<string, { at: number; rows: Map<string, number> }>();
const priorCache = new Map<string, { at: number; rows: Map<string, number> }>();

async function eodCloses(symbol: string, expiration: string): Promise<Map<string, number>> {
  const key = `${symbol}|${expiration}|${priorWeekdayYmd()}`;
  const hit = eodCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) return hit.rows;
  const day = priorWeekdayYmd();
  const got = await thetaGet(`/option/history/eod?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&start_date=${day}&end_date=${day}&format=json`);
  const rows = new Map<string, number>();
  if (got.error) return rows;
  for (const item of snapRows(got.data)) {
    const k = contractKey(item.contract);
    const close = numOr(item.data.close);
    if (k && close != null && close > 0) rows.set(k, close);
  }
  eodCache.set(key, { at: Date.now(), rows });
  return rows;
}

/** The ask 30 minutes earlier. A stamp more than two minutes off that clock is not that quote. */
async function priorAsks(symbol: string, expiration: string): Promise<Map<string, number>> {
  const target = Date.now() - 30 * 60 * 1000;
  const p = nyParts(target);
  const date = `${p.year}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
  const tod = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
  const key = `${symbol}|${expiration}|${date}${tod.slice(0, 5)}`;
  const hit = priorCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const got = await thetaGet(`/option/at_time/quote?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&start_date=${date}&end_date=${date}&time_of_day=${encodeURIComponent(tod)}&format=json`);
  const rows = new Map<string, number>();
  if (got.error) return rows;
  for (const item of snapRows(got.data)) {
    const k = contractKey(item.contract);
    const ask = numOr(item.data.ask);
    const at = stampMs(item.data.timestamp);
    if (!k || ask == null || !(ask > 0) || !at) continue;
    if (Math.abs(at - target) > 120_000) continue;
    rows.set(k, ask);
  }
  priorCache.set(key, { at: Date.now(), rows });
  return rows;
}

export interface ListedExpiry {
  iso: string;
  /** The desk's horizon, the value `expiryFor` resolves to this date. */
  dte: number;
  /** Weekday sessions after today through this expiration. Same day is 0. */
  weekday: number;
  label: string;
  /** The option symbol this date is listed on. SPX's today is SPXW. */
  root: string;
}

/** Standard index monthlies do not list the same-day contract. That chain is the weekly root. */
const WEEKLY_ROOT: Record<string, string> = { SPX: 'SPXW', NDX: 'NDXP', RUT: 'RUTW' };

/** Roots to read, weekly first so a shared date keeps the contract people actually trade that day. */
function optionRoots(ticker: string): string[] {
  const name = ticker.trim().toUpperCase();
  const weekly = WEEKLY_ROOT[name];
  return weekly ? [weekly, name] : [name];
}

function dayLabel(iso: string, weekday: number): string {
  if (weekday === 0) return '0 DTE';
  const month = MONTHS_SHORT[Number(iso.slice(5, 7)) - 1] ?? '';
  const day = Number(iso.slice(8, 10));
  return `${month} ${day} · ${weekday} DTE`;
}

/** A same-day expiry whose tape is finished is not a choice. A later date is not that contract.
    Weekday 0 is the NY calendar day, so Saturday's next session (Monday) is not dropped just because the index tape is marked done. */
export function listedOpen(rows: readonly ListedExpiry[], at: number = Date.now()): ListedExpiry[] {
  const shut = rows.some(e => e.weekday === 0 && nameTape(e.root, true, at).done);
  if (!shut) return rows as ListedExpiry[];
  return rows.filter(e => !(e.weekday === 0 && nameTape(e.root, true, at).done));
}

/** Every expiration the feed lists for this name. A standard index includes its weekly root, so SPX has a today. `down` means the feed did not answer. An empty list with down false means the name has no options. */
export async function listLiveExpiries(ticker: string): Promise<{ rows: ListedExpiry[]; down: boolean; takenAt?: number }> {
  const roots = optionRoots(ticker);
  /* ahead of the queue (data/theta.ts take): the chain waits on this small list, and behind a chart's history reads it
     waited 15–20 s on a first Weigher visit after Terrain */
  const got = await Promise.all(roots.map(root => thetaGet(`/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`, true)));
  const up = got.map(g => !g.error);
  if (up.some(Boolean)) {
    got.forEach((g, i) => up[i] && keepTheta(`expirations:${roots[i]}`, g.data));
    return { rows: expiriesFrom(roots, got.map(g => g.data), up), down: false };
  }
  if (got.every(g => noData(g))) return { rows: [], down: false };
  /* the terminal did not answer: the list this browser kept, re-dated to today, stamped */
  const kept = await Promise.all(roots.map(root => keptTheta<unknown>(`expirations:${root}`)));
  const have = kept.map(k => k != null);
  if (!have.some(Boolean)) return { rows: [], down: true };
  return { rows: expiriesFrom(roots, kept.map(k => k?.data), have), down: true, takenAt: Math.max(...kept.map(k => k?.at ?? 0)) };
}

function expiriesFrom(roots: string[], datas: unknown[], up: boolean[]): ListedExpiry[] {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const byIso = new Map<number, string>();
  for (let d = 0; d <= 240; d++) {
    const e = expiryFor(d);
    byIso.set(e.dte, isoDate(e.date));
  }
  const dteOf = new Map<string, number>();
  for (const [dte, iso] of byIso) if (!dteOf.has(iso)) dteOf.set(iso, dte);
  const out: ListedExpiry[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < roots.length; i++) {
    if (!up[i]) continue;
    const raw = datas[i];
    const rows = Array.isArray(raw) ? raw : [];
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      let iso = String((item as { expiration?: unknown }).expiration ?? '').slice(0, 10);
      if (/^\d{8}$/.test(iso)) iso = `${iso.slice(0, 4)}-${iso.slice(4, 6)}-${iso.slice(6, 8)}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || seen.has(iso) || iso < today) continue;
      const dte = dteOf.get(iso);
      if (dte == null) continue;
      seen.add(iso);
      const e = expiryFor(dte);
      const weekday = weekdayCount(today, iso);
      out.push({ iso, dte: e.dte, weekday, label: dayLabel(iso, weekday), root: roots[i] });
    }
  }
  out.sort((a, b) => a.iso.localeCompare(b.iso));
  return listedOpen(out);
}

function weekdayCount(todayIso: string, expIso: string): number {
  const n = weekdayDte(todayIso.replace(/-/g, ''), expIso.replace(/-/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** The factor that turns a feed's greek into the house unit: 1, 100 (per 1.00 of vol → per vol point) or 365 (per
    year → per calendar day), read as the median ratio of feed to house value over the rows that carry both: the nearest
    of the three, when within a factor of 1.9 (the two models' clocks differ, so the ratio is near one, not on it). Null
    when nothing agrees. */
export function unitScale(pairs: readonly (readonly [number | null, number | null])[]): number | null {
  const ratios: number[] = [];
  for (const [feed, house] of pairs) {
    if (feed == null || house == null || !Number.isFinite(feed) || !Number.isFinite(house) || Math.abs(house) < 1e-9) continue;
    const r = feed / house;
    if (r > 0) ratios.push(r);
  }
  if (ratios.length < 3) return null;
  ratios.sort((a, b) => a - b);
  const mid = ratios[Math.floor(ratios.length / 2)];
  let best: number | null = null;
  let gap = Math.log(1.9);
  for (const c of [1, 100, 365]) {
    const d = Math.abs(Math.log(mid / c));
    if (d < gap) {
      gap = d;
      best = c;
    }
  }
  return best;
}

/** The listed chain for this name and expiry. `root` is the option symbol when it is not the name (SPX today is SPXW). Bid and ask are that contract's NBBO. A field the feed did not send stays blank. */
export async function loadLiveChain(ticker: string, dte: number, range = 18, root?: string): Promise<DeskChain> {
  const expiry = expiryFor(dte);
  const iso = isoDate(expiry.date);
  const name = ticker.trim().toUpperCase();
  const symbol = (root || name).trim().toUpperCase();
  const span = Math.min(40, Math.max(8, range));
  const expiration = ymd(iso);
  const [got, quote] = await Promise.all([
    thetaGet(`/option/snapshot/greeks/first_order?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&right=both&strike_range=${span}&format=json`, true),
    thetaGet(`/option/snapshot/quote?symbol=${encodeURIComponent(symbol)}&expiration=${expiration}&right=both&strike_range=${span}&format=json`, true),
  ]);
  const nbbo = new Map<string, { bid: number; ask: number; bidSize: number; askSize: number; at: number }>();
  if (!quote.error) {
    for (const item of snapRows(quote.data)) {
      const k = contractKey(item.contract);
      if (!k) continue;
      const bid = numOr(item.data.bid);
      const ask = numOr(item.data.ask);
      const bidSize = numOr(item.data.bid_size);
      const askSize = numOr(item.data.ask_size);
      nbbo.set(k, {
        bid: bid == null ? NaN : bid,
        ask: ask == null ? NaN : ask,
        bidSize: bidSize == null ? NaN : Math.round(bidSize),
        askSize: askSize == null ? NaN : Math.round(askSize),
        at: stampMs(item.data.timestamp),
      });
    }
  }
  const byStrike = new Map<number, { call?: DeskContract; put?: DeskContract }>();
  let spot = 0;
  let quotedAt = 0;
  const now = Date.now();
  /* The terminal did not answer: an empty chain that says so. The desk keeps the chain it had. */
  if (got.error && !noData(got)) return { ticker: name, spot: 0, step: 1, rows: [], expiry, expectedMovePct: 0, source: 'live', quotedAt: 0, expiryIso: iso, optRoot: symbol, offline: true };
  {
    const items = snapRows(got.data);
    /* one spot for every row: the newest underlying print on the snapshot */
    let spotAt = -1;
    for (const item of items) {
      const under = numOr(item.data.underlying_price);
      const uAt = stampMs(item.data.underlying_timestamp) || 0;
      if (under != null && under > 0 && uAt >= spotAt) {
        spot = under;
        spotAt = uAt;
      }
    }
    for (const item of items) {
      const strike = numOr(item.contract.strike);
      const word = String(item.contract.right || '').toLowerCase();
      const right: OptionRight | null = word.startsWith('c') ? 'C' : word.startsWith('p') ? 'P' : null;
      if (!right || strike == null || !(strike > 0)) continue;
      const key = contractKey(item.contract);
      const book = key ? nbbo.get(key) : undefined;
      const bid = book && Number.isFinite(book.bid) ? book.bid : numOr(item.data.bid);
      const ask = book && Number.isFinite(book.ask) ? book.ask : numOr(item.data.ask);
      const bidN = bid == null ? NaN : bid;
      const askN = ask == null ? NaN : ask;
      const at = (book && book.at) || stampMs(item.data.timestamp);
      if (at > quotedAt) quotedAt = at;
      const feed = (key: string) => numOr(item.data[key]);
      /* ThetaData sends implied_vol as a fraction on the calendar year, always (0.2246 is 22.46%) */
      const feedIv = feed('implied_vol');
      /* every model number in the row off one vol on one clock: the vendor's IV moved onto the trading clock, else the
         mid's own (data/weigherGate readContract) */
      const solved = spot > 0 ? readContract({ ticker: name, root: symbol, spot, strike, right, bid: bidN, ask: askN, expiryIso: iso, vendorIv: feedIv, ivAt: at, now }) : null;
      const ivPct = solved ? solved.iv : NaN;
      const feedDelta = feed('delta');
      const mark = bidN >= 0 && askN >= bidN && askN > 0 ? (bidN + askN) / 2 : NaN;
      const intrinsic = spot > 0 ? Math.max(0, right === 'C' ? spot - strike : strike - spot) : NaN;
      const breakeven = askN > 0 ? (right === 'C' ? strike + askN : strike - askN) : NaN;
      const row: DeskContract = {
        strike,
        right,
        mark: Number.isFinite(mark) ? Number(mark.toFixed(2)) : NaN,
        delta: solved ? Number(solved.delta.toFixed(4)) : feedDelta != null ? Number(feedDelta.toFixed(4)) : NaN,
        /* the model's gamma off the row's one vol; the vendor's own per-contract gamma replaces it once the book has
           this expiry's contracts (withVendorGamma). The first-order snapshot sends no gamma, so none is read from it. */
        gamma: solved ? Number(solved.gamma.toFixed(4)) : NaN,
        gammaFrom: solved ? 'model' : undefined,
        theta: solved ? Number(solved.theta.toFixed(4)) : NaN,
        thetaHour: solved ? Number(solved.thetaHour.toFixed(4)) : NaN,
        vega: solved ? Number(solved.vega.toFixed(4)) : NaN,
        iv: Number.isFinite(ivPct) ? Number(ivPct.toFixed(2)) : NaN,
        ivFrom: solved?.ivFrom,
        europeanApprox: solved?.europeanApprox,
        itmOdds: solved ? Number(solved.itm.toFixed(2)) : NaN,
        rho: solved ? Number(solved.rho.toFixed(4)) : NaN,
        bid: bidN,
        ask: askN,
        high: NaN,
        low: NaN,
        prevClose: NaN,
        last: NaN,
        volume: NaN,
        oi: NaN,
        breakeven: Number.isFinite(breakeven) ? Number(breakeven.toFixed(2)) : NaN,
        fromSpotPct: spot > 0 ? Number((((strike - spot) / spot) * 100).toFixed(2)) : NaN,
        bidSize: book ? book.bidSize : NaN,
        askSize: book ? book.askSize : NaN,
        netChange: NaN,
        netChangePct: NaN,
        toBreakevenPct: spot > 0 && Number.isFinite(breakeven) ? Number((((breakeven - spot) / spot) * 100).toFixed(2)) : NaN,
        intrinsic: Number.isFinite(intrinsic) ? Number(intrinsic.toFixed(2)) : NaN,
        extrinsic: Number.isFinite(mark) && Number.isFinite(intrinsic) ? Number(Math.max(0, mark - intrinsic).toFixed(2)) : NaN,
        touchOdds: solved ? Number(solved.touch.toFixed(2)) : NaN,
        profitOddsLong: solved ? Number(solved.profitLong.toFixed(2)) : NaN,
        profitOddsShort: solved ? Number(solved.profitShort.toFixed(2)) : NaN,
        quotedAt: at,
      };
      const slot = byStrike.get(strike) ?? {};
      if (right === 'C') slot.call = row;
      else slot.put = row;
      byStrike.set(strike, slot);
    }
  }
  /* The terminal's own theta (per calendar day, on its calendar clock) and vega are not shown: the row's theta is per
     trading session and its vega per quoted vol point, both off the one vol above. */
  const strikes = [...byStrike.keys()].sort((a, b) => a - b);
  if (!strikes.length) {
    return {
      ticker: name,
      spot,
      step: 1,
      rows: [],
      expiry,
      expectedMovePct: 0,
      source: 'live',
      quotedAt,
      expiryIso: iso,
      optRoot: symbol,
    };
  }
  const gaps = strikes.slice(1).map((k, i) => k - strikes[i]).filter(g => g > 1e-9).sort((a, b) => a - b);
  const step = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1;
  const blank = (strike: number, right: OptionRight): DeskContract => ({
    strike, right, mark: NaN, delta: NaN, gamma: NaN, theta: NaN, vega: NaN, iv: NaN, itmOdds: NaN, rho: NaN,
    bid: NaN, ask: NaN, high: NaN, low: NaN, prevClose: NaN, last: NaN, volume: NaN, oi: NaN, breakeven: NaN,
    fromSpotPct: spot > 0 ? Number((((strike - spot) / spot) * 100).toFixed(2)) : NaN,
    bidSize: NaN, askSize: NaN, netChange: NaN, netChangePct: NaN, toBreakevenPct: NaN, intrinsic: NaN, extrinsic: NaN,
    touchOdds: NaN, profitOddsLong: NaN, profitOddsShort: NaN,
  });
  const rows = strikes.map(strike => {
    const slot = byStrike.get(strike)!;
    return { strike, call: slot.call ?? blank(strike, 'C'), put: slot.put ?? blank(strike, 'P') };
  });
  /* ATM IV at spot from the strikes around it (quoted convention), then S·σ·√T on the expiry's calendar clock */
  const atm = atmIvAt(rows, spot);
  return {
    ticker: name,
    spot,
    step,
    rows,
    expiry,
    atmIv: atm > 0 ? Number(atm.toFixed(2)) : 0,
    expectedMovePct: Number(expectedMovePctOf(spot, atm, iso, now, quotedAt).toFixed(2)),
    source: 'live',
    quotedAt,
    expiryIso: iso,
    optRoot: symbol,
  };
}

/** The options-flow vendor's per-contract gamma for one expiry, strike by strike: the option-contracts rows the name's
    book has already read for that date (data/book/load.ts fillExpiryFacts → book/scale.ts foldContracts, `row.gamma`
    into callGamma / putGamma). Null until that date's rows are read; nothing is asked here. */
export function vendorGammaRows(ticker: string, expiryIso: string): readonly StrikeNode[] | null {
  const e = peekEntry(sameName(ticker));
  if (!e || e.status !== 'live' || !expiryIso || !e.factsDates?.has(expiryIso)) return null;
  const nodes = e.byDate[expiryIso];
  return nodes?.length ? nodes : null;
}

/** The chain with each contract's gamma the vendor's own, where its row has one (callGamma / putGamma > 0); the model's
    stays on the rest. The same chain object when nothing changes. */
export function withVendorGamma(chain: DeskChain, nodes: readonly StrikeNode[] | null): DeskChain {
  if (!nodes?.length || !chain.rows.length) return chain;
  const by = new Map<number, StrikeNode>();
  for (const n of nodes) by.set(Number(n.strike.toFixed(3)), n);
  let changed = 0;
  const lay = (c: DeskContract, g: number | undefined): DeskContract => {
    if (!(g != null && g > 0) || (c.gammaFrom === 'vendor' && c.gamma === g)) return c;
    changed += 1;
    return { ...c, gamma: g, gammaFrom: 'vendor' };
  };
  const rows = chain.rows.map(r => {
    const n = by.get(Number(r.strike.toFixed(3)));
    if (!n) return r;
    const call = lay(r.call, n.callGamma);
    const put = lay(r.put, n.putGamma);
    return call === r.call && put === r.put ? r : { strike: r.strike, call, put };
  });
  return changed ? { ...chain, rows } : chain;
}

/** Keep the slow fields (volume, open interest, yesterday) on a chain that just got a new quote. */
export function keepSlow(fresh: DeskChain, slow: DeskChain): DeskChain {
  if (fresh.ticker !== slow.ticker || fresh.expiryIso !== slow.expiryIso) return fresh;
  if (fresh.optRoot && slow.optRoot && fresh.optRoot !== slow.optRoot) return fresh;
  const bag = new Map<string, DeskContract>();
  for (const r of slow.rows) {
    bag.set(`${r.strike}|C`, r.call);
    bag.set(`${r.strike}|P`, r.put);
  }
  const take = (c: DeskContract): DeskContract => {
    const old = bag.get(`${c.strike}|${c.right}`);
    if (!old) return c;
    const prevClose = Number.isFinite(old.prevClose) ? old.prevClose : c.prevClose;
    const last = Number.isFinite(old.last) ? old.last : c.last;
    return {
      ...c,
      volume: Number.isFinite(old.volume) ? old.volume : c.volume,
      oi: Number.isFinite(old.oi) ? old.oi : c.oi,
      high: Number.isFinite(old.high) ? old.high : c.high,
      low: Number.isFinite(old.low) ? old.low : c.low,
      last,
      prevClose,
      priorAsk: old.priorAsk ?? c.priorAsk,
      netChange: last > 0 && prevClose > 0 ? Number((last - prevClose).toFixed(2)) : NaN,
      netChangePct: last > 0 && prevClose > 0 ? Number((((last - prevClose) / prevClose) * 100).toFixed(1)) : NaN,
    };
  };
  return { ...fresh, rows: fresh.rows.map(r => ({ strike: r.strike, call: take(r.call), put: take(r.put) })) };
}

/** A new NBBO for the chain already on screen. `offline` when the terminal did not answer; null when the read is not
    this chain's. The last live quote stays either way. */
export async function refreshLiveChain(prev: DeskChain, range = 18): Promise<DeskChain | 'offline' | null> {
  if (prev.source !== 'live' || !prev.rows.length) return null;
  const next = await loadLiveChain(prev.ticker, prev.expiry.dte, range, prev.optRoot);
  if (next.offline) return 'offline';
  if (next.source !== 'live' || !next.rows.length || next.expiryIso !== prev.expiryIso) return null;
  return keepSlow(next, prev);
}

/** Volume, last, high, low, and open interest. Does not move the quote. */
export async function attachSession(chain: DeskChain): Promise<DeskChain> {
  if (chain.source !== 'live' || !chain.expiryIso || !chain.rows.length) return chain;
  const symbol = (chain.optRoot || chain.ticker).trim().toUpperCase();
  const q = `symbol=${encodeURIComponent(symbol)}&expiration=${ymd(chain.expiryIso)}&format=json`;
  const [ohlc, oi] = await Promise.all([
    thetaGet(`/option/snapshot/ohlc?${q}`, true),
    thetaGet(`/option/snapshot/open_interest?${q}`, true),
  ]);
  const volumeOf = new Map<string, { volume: number; high: number; low: number; close: number }>();
  if (!ohlc.error) {
    for (const item of snapRows(ohlc.data)) {
      const k = contractKey(item.contract);
      if (!k) continue;
      const volume = numOr(item.data.volume);
      const high = numOr(item.data.high);
      const low = numOr(item.data.low);
      const close = numOr(item.data.close);
      volumeOf.set(k, {
        volume: volume == null ? NaN : Math.round(volume),
        high: high != null && high > 0 ? high : NaN,
        low: low != null && low > 0 ? low : NaN,
        close: close != null && close > 0 ? close : NaN,
      });
    }
  }
  const oiOf = new Map<string, number>();
  if (!oi.error) {
    for (const item of snapRows(oi.data)) {
      const k = contractKey(item.contract);
      const v = numOr(item.data.open_interest);
      if (k && v != null) oiOf.set(k, Math.round(v));
    }
  }
  const paint = (c: DeskContract): DeskContract => {
    const key = `${Number(c.strike.toFixed(4))}|${c.right}`;
    const session = volumeOf.get(key);
    const last = session && Number.isFinite(session.close) ? session.close : c.last;
    const prevClose = c.prevClose;
    return {
      ...c,
      high: session?.high ?? c.high,
      low: session?.low ?? c.low,
      last,
      volume: session && Number.isFinite(session.volume) ? session.volume : c.volume,
      oi: oiOf.has(key) ? oiOf.get(key)! : c.oi,
      netChange: last > 0 && prevClose > 0 ? Number((last - prevClose).toFixed(2)) : c.netChange,
      netChangePct: last > 0 && prevClose > 0 ? Number((((last - prevClose) / prevClose) * 100).toFixed(1)) : c.netChangePct,
    };
  };
  return { ...chain, rows: chain.rows.map(r => ({ strike: r.strike, call: paint(r.call), put: paint(r.put) })) };
}

/** Yesterday's close. Does not wait on the 30-minute ask, and does not carry last or volume — those stay with the session. */
export async function attachHistory(chain: DeskChain): Promise<DeskChain> {
  if (chain.source !== 'live' || !chain.rows.length || !chain.expiryIso) return chain;
  const symbol = (chain.optRoot || chain.ticker).trim().toUpperCase();
  const closes = await eodCloses(symbol, ymd(chain.expiryIso));
  const paint = (c: DeskContract): DeskContract => {
    const prev = closes.get(`${Number(c.strike.toFixed(4))}|${c.right}`);
    const prevClose = prev != null && prev > 0 ? prev : NaN;
    return { ...c, volume: NaN, oi: NaN, high: NaN, low: NaN, last: NaN, prevClose, netChange: NaN, netChangePct: NaN };
  };
  return { ...chain, rows: chain.rows.map(r => ({ strike: r.strike, call: paint(r.call), put: paint(r.put) })) };
}

/** The ask from 30 minutes ago. Book B only. A late answer cannot wipe the quote, the session, or yesterday. */
export async function attachPrior(chain: DeskChain): Promise<DeskChain> {
  if (chain.source !== 'live' || !chain.rows.length || !chain.expiryIso) return chain;
  const symbol = (chain.optRoot || chain.ticker).trim().toUpperCase();
  const priors = await priorAsks(symbol, ymd(chain.expiryIso));
  const paint = (c: DeskContract): DeskContract => {
    const prior = priors.get(`${Number(c.strike.toFixed(4))}|${c.right}`);
    return {
      ...c,
      volume: NaN,
      oi: NaN,
      high: NaN,
      low: NaN,
      last: NaN,
      prevClose: NaN,
      netChange: NaN,
      netChangePct: NaN,
      priorAsk: prior != null && prior > 0 ? prior : undefined,
    };
  };
  return { ...chain, rows: chain.rows.map(r => ({ strike: r.strike, call: paint(r.call), put: paint(r.put) })) };
}

export function blankChain(ticker: string, dte: number): DeskChain {
  const expiry = expiryFor(dte);
  return { ticker, spot: 0, step: 1, rows: [], expiry, expectedMovePct: 0, source: 'simulated', quotedAt: 0, expiryIso: isoDate(expiry.date) };
}

/** The Weigher's name lists: the session's movers and the busiest option tapes */
export type ScanPreset = 'gainers' | 'losers' | 'voliv';

export interface ScanRow {
  ticker: string;
  last: number;
  changePct: number;
  /** Net option premium today (bought at the ask less sold at the bid), dollars; NaN where the list does not carry it */
  netPremium: number;
}

/** Whether the cash session is trading right now (core/session.ts; 13:00 on an early close); everything else is outside it. */
export function marketSession(): 'open' | 'overnight' {
  return inRegular(Date.now()) ? 'open' : 'overnight';
}

/** Whether a name's listed options are quoting now (core/session.ts): an index's (SPX, XSP, VIX, RUT) through Global
    Trading Hours, the regular session and the curb; an index ETF's 09:30–16:15; a stock's 09:30–16:00 (13:00/13:15 on an
    early close). With no name: the regular options session, to 16:15. */
export function optionsOpen(symbol?: string): boolean {
  return sessionAt(Date.now(), symbol ? productOf(symbol, true) : 'etfOption').open;
}
