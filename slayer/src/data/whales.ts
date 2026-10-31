/*
  Unusual Whales client. Pages call /api/uw (server/uwProxy.mjs), which adds the token; the browser never holds it.
  Calls go only while the terminal shell is mounted and, with accounts on, carry the session token (feedGate.ts).
*/

import { SIM_DESK } from './deskMode';
import { feedHeaders } from './feedGate';
import { readSaved, save } from './uwStore';

export interface UwNews {
  created_at: string;
  headline: string;
  is_major: boolean;
  sentiment: string;
  source: string;
  tags: string[];
  tickers: string[];
  meta?: Record<string, { curr?: { c?: string | number }; prev?: { c?: string | number } }>;
}

export interface UwPolitician {
  name: string;
  party?: string;
  chamber?: string;
  politician_id: string;
  district?: string;
  /** The Congress biographical directory id; only members of Congress have one */
  bioguide_id?: string | null;
}

export interface UwEcon {
  type?: string;
  time: string;
  prev?: string | null;
  event: string;
  forecast?: string | null;
  reported_period?: string;
}
export interface UwCongress {
  amounts?: unknown;
  filed_at_date?: string;
  member_type?: string;
  name?: string;
  notes?: string;
  politician_id?: string;
  ticker?: string;
  transaction_date?: string;
  txn_type?: string;
  issuer?: string;
}

export interface UwInsider {
  amount?: number;
  filing_date?: string;
  is_10b5_1?: boolean;
  is_director?: boolean;
  is_officer?: boolean;
  is_ten_percent_owner?: boolean;
  officer_title?: string;
  owner_name?: string;
  price?: string | number;
  shares_owned_after?: number;
  ticker?: string;
  transaction_code?: string;
  transaction_date?: string;
  stock_price?: string | number | null;
  id?: string;
}

let inflight = 0;
const waiters: (() => void)[] = [];
/* Five in flight from the browser: the proxy caps the key at three upstream and queues the rest, and two extra here
   keep its slots busy across the browser's own round trips. */
const MAX_INFLIGHT = 5;

/* A low lane for reads no row waits on: it runs only when no ordinary or priority ask is waiting. */
const lowWaiters: (() => void)[] = [];

function takeSlot(priority = false, low = false): Promise<void> {
  if (inflight < MAX_INFLIGHT && (!low || !waiters.length)) {
    inflight += 1;
    return Promise.resolve();
  }
  return new Promise(resolve => {
    if (low) lowWaiters.push(resolve);
    else if (priority) waiters.unshift(resolve);
    else waiters.push(resolve);
  });
}

function releaseSlot(): void {
  inflight -= 1;
  const next = waiters.shift() ?? lowWaiters.shift();
  if (next) {
    inflight += 1;
    next();
  }
}

async function uw<T>(path: string, priority = false): Promise<T> {
  const got = await uwCall(path, priority);
  if (got.error) throw new Error(got.error);
  return got.data as T;
}

/* One request per path: concurrent asks share it in flight, and a slow route's answer is reused for a minute. Routes
   that move with the tape are shared in flight only. Each caller gets its own copy of the body. */
/** `at`: when the server's hub took this answer from the vendor (epoch ms, the proxy's x-hub-at header; null when
    unknown). `held`: the server is serving it past its route's normal life because the vendor is refusing (it may for up
    to 4× the route's freshness, 20 min for a slow route); a feed should then show it "as of" `at`, not as live. */
export type UwAnswer = { status: number; data: unknown; error: string | null; at?: number | null; held?: boolean };
/* the proxy's short-lived classes (server/uwProxy.mjs ttlFor): shared in flight only */
const LIVE_PATH = /\/(option-trades|flow-alerts|market-tide|sector-tide|etf-tide|top-net-impact|net-flow|greek-flow|stock-state|quote|flow-per-strike-intraday|net-prem-ticks|nope|spot-exposures|greek-exposure|gex-levels|flow-per-|oi-|option-contracts|atm-chains|interpolated-iv|ohlc\/(?:1m|2m|3m|5m|15m|1h)|darkpool|lit-flow|options-volume|stock-price-levels|stock-volume-price-levels)(\/|$)|^\/option-contract\//;
const REUSE_MS = 60_000;
/* a live route's finished answer is reused for a little less than the proxy caches it, so two readers of one page
   make one request */
const PROXY_15S = /\/(greek-exposure|gex-levels|flow-per-|oi-|option-contracts|atm-chains|interpolated-iv|ohlc\/(?:1m|2m|3m|5m|15m|1h)|darkpool|lit-flow|options-volume|stock-price-levels|stock-volume-price-levels)(\/|$)/;
const liveReuseMs = (p: string): number => (/^\/option-contract\//.test(p) ? 0 : PROXY_15S.test(p) && !/\/(flow-per-strike-intraday)(\/|$)/.test(p) ? 12_000 : 2_500);
const shared = new Map<string, { at: number; done: boolean; p: Promise<UwAnswer> }>();
const copyOf = (a: UwAnswer): UwAnswer => {
  try {
    return { ...a, data: a.data == null || typeof a.data !== 'object' ? a.data : structuredClone(a.data) };
  } catch {
    return a;
  }
};

/* What the key does not carry is never asked: a CBOE index has no stock-state or stock bars (422
   cboe_index_access_missing; its exposure routes answer), and a request that answers 422 is not asked again this session. */
const NO_INDEX_PRICE = /^\/stock\/(SPX|RUT|NDX|VIX|XSP)\/(stock-state|ohlc\/)/i;
const NOT_CARRIED_KEY = 'slayer_uw_not_carried';
const notCarried: Set<string> = (() => {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(NOT_CARRIED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set<string>();
  }
})();
const noteNotCarried = (path: string) => {
  notCarried.add(path);
  try {
    sessionStorage.setItem(NOT_CARRIED_KEY, JSON.stringify([...notCarried]));
  } catch {
    /* storage off: held for this page */
  }
};

/** One GET, with the vendor's status and message. Does not invent a body. */
export async function uwCall(path: string, priority = false, low = false): Promise<UwAnswer> {
  if (SIM_DESK) return { status: 0, data: null, error: 'sim' };
  const now = Date.now();
  const hit = shared.get(path);
  const bare = path.split('?')[0];
  if (NO_INDEX_PRICE.test(bare) || notCarried.has(path)) return { status: 422, data: null, error: 'not carried on this key' };
  if (hit && (!hit.done || now - hit.at < (LIVE_PATH.test(bare) ? liveReuseMs(bare) : REUSE_MS))) return copyOf(await hit.p);
  const entry = { at: now, done: false, p: uwFetch(path, priority && !low, low) };
  shared.set(path, entry);
  const got = await entry.p;
  entry.done = true;
  entry.at = Date.now();
  if (got.status === 422) noteNotCarried(path);
  if (got.error) shared.delete(path);
  else save(path, got.status, got.data, got.at);
  if (shared.size > 400) for (const [k, v] of shared) if (v.done && Date.now() - v.at > REUSE_MS) shared.delete(k);
  return copyOf(got);
}

/** ms since the server's hub took an answer from the vendor, or null when the proxy did not say */
export const uwAge = (a: Pick<UwAnswer, 'at'>, now = Date.now()): number | null => (a.at ? Math.max(0, now - a.at) : null);

/**
 * Paint first, then refresh: hands `on` the answer this browser kept for the path (with the instant it was kept), then
 * the fresh one (savedAt null). A reader shows the kept copy as "as of" that instant, never as live. An answer the
 * server is holding past its route's normal life (`held`: the vendor refusing) comes with its own instant too.
 */
export async function uwSwr<T>(path: string, on: (data: T, savedAt: number | null) => void, priority = false): Promise<UwAnswer> {
  let freshIn = false;
  void readSaved(path).then(k => {
    if (k && !freshIn) on(structuredClone(k.data) as T, k.at);
  });
  const got = await uwCall(path, priority);
  freshIn = true;
  if (!got.error) on(got.data as T, got.held ? got.at ?? null : null);
  return got;
}

/** The answer this browser kept for a path, or null. */
export const uwKept = (path: string) => readSaved(path);

const failWait = new Map<string, { n: number; until: number }>();

function retryWait(path: string): number {
  const held = failWait.get(path);
  if (!held || held.n < 2) return 0;
  return Math.max(0, held.until - Date.now());
}

function noteFail(path: string) {
  const n = (failWait.get(path)?.n ?? 0) + 1;
  const ms = n < 2 ? 0 : Math.min(30_000, 2000 * 2 ** (n - 2));
  failWait.set(path, { n, until: Date.now() + ms });
  return ms;
}

/* The key's rate limit is the server's to wait out (server/uwProxy.mjs, one breaker for the key). When it answers 429
   with Retry-After, every read from this browser holds until then, outside the five slots, so a refusal never parks a
   slot in a sleep or multiplies into more asks. */
let coolUntil = 0;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const gatewayFault = (s: number) => s === 502 || s === 503 || s === 504;
/** Longest this browser waits out a refusal before giving the reader the error (its feed asks again on its own beat) */
const MAX_HOLD_MS = 8_000;

type Got = { status: number; ok: boolean; headers: Headers; text: string };

function retryAfterMs(res: Got): number {
  const h = res.headers.get('retry-after');
  const s = h == null ? NaN : Number(h);
  return Number.isFinite(s) && s > 0 ? s * 1000 : 0;
}

/** When the hub took the answer from the vendor (x-hub-at), epoch ms; null when the proxy did not say */
function hubAt(res: Got): number | null {
  const at = Number(res.headers.get('x-hub-at'));
  return Number.isFinite(at) && at > 0 ? at : null;
}

async function uwOnce(path: string, priority: boolean, low: boolean, headers: HeadersInit): Promise<Got> {
  await takeSlot(priority, low);
  try {
    const res = await fetch(`/api/uw${path}`, { headers });
    /* the body is read inside the slot, as before; nothing sleeps in it */
    const text = await res.text();
    return { status: res.status, ok: res.ok, headers: res.headers, text };
  } finally {
    releaseSlot();
  }
}

/** A failed answer's words for the reader: the vendor's message, or "unavailable <status>" (never an HTML page) */
function faultWords(status: number, parsed: unknown, text: string): string {
  if (parsed && typeof parsed === 'object' && ('message' in parsed || 'error' in parsed)) {
    const m = String((parsed as { message?: unknown; error?: unknown }).message || (parsed as { error?: unknown }).error || '');
    if (m && !/^\s*</.test(m)) return m.slice(0, 180);
  }
  /* a gateway's error page (Vercel's, a proxy's) or any body that is not the vendor's JSON */
  if (typeof parsed === 'string' && text && !/^\s*</.test(text) && text.length <= 180) return text;
  return `unavailable ${status}`;
}

async function uwFetch(path: string, priority: boolean, low = false): Promise<UwAnswer> {
  try {
    const auth = await feedHeaders();
    if (!auth.ok) return { status: 401, data: null, error: auth.code };
    let res: Got | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      /* waits happen before a slot is taken: the key's breaker (given up past MAX_HOLD_MS), and the path's own backoff */
      const keyHold = coolUntil - Date.now();
      if (keyHold > MAX_HOLD_MS) {
        if (res) break;
        return { status: 429, data: null, error: 'rate limited; asked again shortly', at: null };
      }
      const held = Math.max(retryWait(path), keyHold);
      if (held > 0) await sleep(held);
      res = await uwOnce(path, priority, low, auth.headers);
      if (res.ok) {
        failWait.delete(path);
        break;
      }
      if (res.status === 429) {
        /* the server already retried once behind its breaker: one more try here only when the wait is short */
        const ms = retryAfterMs(res) || 2_000;
        coolUntil = Math.max(coolUntil, Date.now() + ms);
        noteFail(path);
        if (ms > MAX_HOLD_MS) break;
        continue;
      }
      if (gatewayFault(res.status)) {
        /* a gateway blip (a cold function, a dropped connection) gets one more try after 1.5 s; after two failures
           in a row the path waits 2 s, then 4, then 8, up to 30 s before its next ask; a 200 clears the wait */
        noteFail(path);
        /* (a path already backing off waits that out at the top of the loop instead) */
        if (attempt === 0 && retryWait(path) === 0) await sleep(1500);
        continue;
      }
      break;
    }
    if (!res) return { status: 0, data: null, error: 'unusual whales unreachable', at: null };
    const text = res.text;
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed;
    if (!res.ok) return { status: res.status, data: typeof parsed === 'string' ? null : data, error: faultWords(res.status, parsed, text), at: null };
    return { status: res.status, data, error: null, at: hubAt(res), held: res.headers.get('x-hub-held') === '1' };
  } catch (e) {
    return { status: 0, data: null, error: e instanceof Error ? e.message : 'unusual whales unreachable', at: null };
  }
}

/* The vendor rejects limit=200 on headlines and 300 on congress; pages are zero-indexed. The first page is priority and
   handed up before the rest. */
export const whalesPoliticians = () => uw<UwPolitician[]>('/congress/politicians?last_traded_within_months=24');
export const whalesEcon = () => uw<UwEcon[]>('/market/economic-calendar');
export const whalesScreener = (tickers: string[], priority = false) =>
  uw<Record<string, unknown>[]>(`/screener/stocks?ticker=${tickers.map(t => encodeURIComponent(t)).join(',')}`, priority);
export const whalesAnalysts = (ticker: string, priority = false) =>
  uw<Record<string, unknown>[]>(`/screener/analysts?ticker=${encodeURIComponent(ticker)}&limit=200`, priority);
export const whalesEarnings = (ticker: string, priority = false) => uw<Record<string, unknown>[]>(`/earnings/${encodeURIComponent(ticker)}`, priority);
export const whalesEarningsSlot = (slot: 'premarket' | 'afterhours', date: string, page = 0, limit = 100) =>
  uw<Record<string, unknown>[]>(`/earnings/${slot}?date=${encodeURIComponent(date)}&limit=${limit}&page=${page}`);
export const whalesStock = (ticker: string) => uw<Record<string, unknown>>(`/stock/${encodeURIComponent(ticker)}/info`);
export const whalesFinancials = (ticker: string, priority = false) =>
  uw<{ earnings?: Record<string, unknown>[]; income_statements?: Record<string, unknown>[]; cash_flows?: Record<string, unknown>[] }>(
    `/stock/${encodeURIComponent(ticker)}/financials`,
    priority,
  );

export interface UwState {
  close?: string | number;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  prev_close?: string | number;
  volume?: string | number;
  market_time?: string;
}

export interface UwGreekStrike {
  strike?: string | number;
  expiry?: string;
  dte?: number;
  call_gex?: string | number;
  put_gex?: string | number;
  call_delta?: string | number;
  put_delta?: string | number;
  call_vanna?: string | number;
  put_vanna?: string | number;
  call_charm?: string | number;
  put_charm?: string | number;
  call_oi?: string | number;
  put_oi?: string | number;
}

export interface UwBar {
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  volume?: string | number;
  total_volume?: string | number;
  start_time?: string;
  end_time?: string;
  /** r regular, pr pre-market, po post-market. The index tape sets this; the stock feed does too. */
  market_time?: string;
}

export interface UwIv {
  volatility?: string | number;
  iv_rank_1y?: string | number;
  close?: string | number;
  date?: string;
}

/** One expiry on the vendor's vol surface. `implied_move` is dollars into that expiry. */
export interface UwTerm {
  date?: string;
  expiry?: string;
  dte?: number;
  volatility?: string | number;
  implied_move?: string | number;
  implied_move_perc?: string | number;
}

/** Constant-maturity vol. `implied_move_perc` for `days: 1` is one session, as a fraction of spot. */
export interface UwInterp {
  date?: string;
  days?: number | string;
  volatility?: string | number;
  implied_move_perc?: string | number;
  percentile?: string | number;
}

export interface UwFlowStrike {
  strike?: string | number;
  call_volume?: string | number;
  put_volume?: string | number;
}

export interface UwContract {
  option_symbol?: string;
  open_interest?: string | number;
  volume?: string | number;
  vega?: string | number;
  implied_volatility?: string | number;
  gamma?: string | number;
  last_price?: string | number;
  nbbo_bid?: string | number;
  nbbo_ask?: string | number;
  ask_volume?: string | number;
  bid_volume?: string | number;
  mid_volume?: string | number;
  multi_leg_volume?: string | number;
  no_side_volume?: string | number;
  last_tape_time?: string;
  updated_at?: string;
}

const enc = (ticker: string) => encodeURIComponent(ticker);
export const whalesState = (ticker: string) => uw<UwState>(`/stock/${enc(ticker)}/stock-state`);
/** The quote: the last trade (price, epoch-ms time) and the NBBO — read when the stock-state has stalled in the session */
interface UwQuote {
  last_trade?: { price?: string | number; time?: number };
  market_time?: string;
}
export const whalesQuote = (ticker: string) => uw<UwQuote>(`/stock/${enc(ticker)}/quote`);
export const whalesGreekStrike = (ticker: string) => uw<UwGreekStrike[]>(`/stock/${enc(ticker)}/greek-exposure/strike`);
export const whalesGreekExpiry = (ticker: string) => uw<UwGreekStrike[]>(`/stock/${enc(ticker)}/greek-exposure/expiry`);
export const whalesGreekStrikeExpiry = (ticker: string, expiry: string) =>
  uw<UwGreekStrike[]>(`/stock/${enc(ticker)}/greek-exposure/strike-expiry?expiry=${encodeURIComponent(expiry)}`);
export const whalesOiStrike = (ticker: string) => uw<UwGreekStrike[]>(`/stock/${enc(ticker)}/oi-per-strike`);
export const whalesFlowStrike = (ticker: string) => uw<UwFlowStrike[]>(`/stock/${enc(ticker)}/flow-per-strike`);
export const whalesIvRank = (ticker: string, priority = false) => uw<UwIv[]>(`/stock/${enc(ticker)}/iv-rank`, priority);
export const whalesTermStructure = (ticker: string) => uw<UwTerm[]>(`/stock/${enc(ticker)}/volatility/term-structure`);
export const whalesInterpIv = (ticker: string) => uw<UwInterp[]>(`/stock/${enc(ticker)}/interpolated-iv`);
export const whalesBars = (ticker: string, size: '1m' | '5m' | '15m' | '1h', limit: number) =>
  uw<UwBar[]>(`/stock/${enc(ticker)}/ohlc/${size}?limit=${limit}`);
export interface UwDaily {
  date?: string;
  open?: string | number;
  high?: string | number;
  low?: string | number;
  close?: string | number;
  volume?: string | number;
  total_volume?: string | number;
  market_time?: string;
}

/* one daily read per name: the newest 260 rows of the long read below, shared through the in-flight and reuse caches */
export const whalesDaily = (ticker: string) => uw<UwDaily[]>(`/stock/${enc(ticker)}/ohlc/1d?limit=900&timeframe=2Y`, true).then(rows => (Array.isArray(rows) ? rows.slice(0, 260) : rows));
/* A daily row comes up to three times a day (pre, regular, post), so two years (timeframe=2Y, 900 rows) is about 300
   sessions: enough for a 200-day average. */
/** The last few sessions' daily rows (pre, regular and post rows, newest first): enough for the regular closes the
    day's change needs, without the two-year read */
export const whalesDailyRecent = (ticker: string) => uw<UwDaily[]>(`/stock/${enc(ticker)}/ohlc/1d?limit=18`, true);
export const whalesDailyLong = (ticker: string) => uw<UwDaily[]>(`/stock/${enc(ticker)}/ohlc/1d?limit=900&timeframe=2Y`, true);
/** Every contract, paged: one expiry's, or (no expiry) every listed contract of the name, 500 at a time until a short
    page. Null when the first page fails; a later failed page ends the walk with an error, never a cut list. */
/* The vendor's paging is unstable (rows repeat and go missing across pages). An expiry under 500 rows is one ask; a
   full one is read calls and puts apart (option_type). Rows are de-duplicated by contract, and a walk that reaches
   `maxPages` returns null rather than a truncated list. */
/* a walk in flight or finished within PAGED_REUSE_MS is shared (each caller gets its own copy); failures are not kept */
const PAGED_REUSE_MS = 20_000;
const pagedAsked = new Map<string, { at: number; p: Promise<UwContract[] | null> }>();
export function whalesOptionContractsPaged(ticker: string, expiry?: string, priority = false, maxPages = 60): Promise<UwContract[] | null> {
  const key = `${ticker.toUpperCase()}|${expiry ?? ''}|${maxPages}`;
  const hit = pagedAsked.get(key);
  const entry = hit && Date.now() - hit.at < PAGED_REUSE_MS ? hit : { at: Date.now(), p: optionContractsWalk(ticker, expiry, priority, maxPages) };
  if (entry !== hit) {
    pagedAsked.set(key, entry);
    entry.p.then(
      rows => {
        if (rows == null) pagedAsked.delete(key);
        else entry.at = Date.now();
      },
      () => pagedAsked.delete(key),
    );
    if (pagedAsked.size > 300) for (const [k, v] of pagedAsked) if (Date.now() - v.at > PAGED_REUSE_MS) pagedAsked.delete(k);
  }
  return entry.p.then(rows => (Array.isArray(rows) ? rows.map(r => ({ ...r })) : rows));
}
async function optionContractsWalk(ticker: string, expiry?: string, priority = false, maxPages = 60): Promise<UwContract[] | null> {
  const base = `/stock/${enc(ticker)}/option-contracts?limit=500${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ''}`;
  /** One walk of `path`, every page until a short one; null on a failed page or at `maxPages` */
  const walk = async (path: string, from: UwContract[] = []): Promise<{ rows: UwContract[] } | null> => {
    const out: UwContract[] = [...from];
    for (let page = from.length ? 1 : 0; page < maxPages; page++) {
      const got = await uwCall(`${path}&page=${page}`, priority);
      if (got.error || !Array.isArray(got.data)) return null;
      const rows = got.data as UwContract[];
      out.push(...rows);
      if (rows.length < 500) return { rows: out };
    }
    return null;
  };
  const byContract = (lists: UwContract[][]): UwContract[] => {
    const seen = new Map<string, UwContract>();
    for (const list of lists) for (const r of list) {
      const sym = String(r.option_symbol ?? '');
      if (sym && !seen.has(sym)) seen.set(sym, r);
    }
    return [...seen.values()];
  };
  const first = await uwCall(`${base}&page=0`, priority);
  if (first.error || !Array.isArray(first.data)) return null;
  const head = first.data as UwContract[];
  if (head.length < 500) return byContract([head]);
  if (!expiry) {
    const all = await walk(base, head);
    return all ? byContract([all.rows]) : null;
  }
  const side = async (type: 'call' | 'put'): Promise<UwContract[] | null> => {
    const path = `${base}&option_type=${type}`;
    const one = await walk(path);
    return one ? one.rows : null;
  };
  const [calls, puts] = await Promise.all([side('call'), side('put')]);
  return calls && puts ? byContract([calls, puts]) : null;
}
/** One expiry's listed contracts, or the chain's busiest when no expiry is given (one page). */
/* limit stays at the documented 500 (docs/DATA_SOURCES.md); an ask in flight or within CONTRACTS_REUSE_MS is shared */
const CONTRACTS_REUSE_MS = 30_000;
const contractsAsked = new Map<string, { at: number; p: Promise<UwContract[]> }>();
export const whalesOptionContracts = (ticker: string, expiry?: string, priority = false): Promise<UwContract[]> => {
  const path = `/stock/${enc(ticker)}/option-contracts?limit=500${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ''}`;
  const hit = contractsAsked.get(path);
  const entry = hit && Date.now() - hit.at < CONTRACTS_REUSE_MS ? hit : { at: Date.now(), p: uw<UwContract[]>(path, priority) };
  if (entry !== hit) {
    contractsAsked.set(path, entry);
    entry.p.then(
      () => (entry.at = Date.now()),
      () => contractsAsked.delete(path),
    );
  }
  return entry.p.then(rows => (Array.isArray(rows) ? rows.map(r => ({ ...r })) : rows));
};

export interface UwInstitution {
  /** SEC filer id: the holdings route takes it where some long names 404 */
  cik?: string;
  name?: string;
  short_name?: string;
  date?: string;
  filing_date?: string;
  total_value?: string | number;
}

export interface UwHolding {
  ticker?: string;
  units?: string | number;
  units_change?: string | number;
  value?: string | number;
  close?: string | number;
  avg_price?: string | number;
  price_first_buy?: string | number;
  first_buy?: string;
  sector?: string;
  security_type?: string;
  put_call?: string | null;
  shares_outstanding?: string | number;
  perc_of_share_value?: string | number;
  perc_of_total?: string | number;
  historical_units?: unknown;
  date?: string;
  full_name?: string;
}

export interface UwShort {
  symbol?: string;
  days_to_cover?: string | number;
  fee_rate?: string | number;
  rebate_rate?: string | number;
  short_interest?: string | number;
  short_shares_available?: string | number;
  si_float?: string | number;
  total_float?: string | number;
  market_date?: string;
}

export interface UwEtfHolding {
  ticker?: string;
  name?: string;
  /** 'bond' lines carry no ticker — the name and the face amount */
  type?: string;
  weight?: string | number;
  shares?: string | number;
  sector?: string;
  country_name?: string;
  /** the day the weight was taken */
  updated?: string;
}

export interface UwEtfFlow {
  date?: string;
  change_prem?: string | number;
}

export interface UwEtfInfo {
  name?: string;
  aum?: string | number;
  has_options?: boolean;
  avg30_volume?: string | number;
  call_vol?: string | number;
  put_vol?: string | number;
  domicile?: string;
  etf_company?: string;
  expense_ratio?: string | number;
  holdings_count?: string | number;
  inception_date?: string;
}

export const whalesInstitutions = (limit = 10) => uw<UwInstitution[]>(`/institutions?limit=${limit}&order=total_value`);
export const whalesHoldings = (name: string, limit = 30) => uw<UwHolding[]>(`/institution/${encodeURIComponent(name)}/holdings?limit=${limit}`);
export const whalesEtfHoldings = (ticker: string) => uw<UwEtfHolding[]>(`/etfs/${enc(ticker)}/holdings`);
export const whalesEtfFlow = (ticker: string) => uw<UwEtfFlow[]>(`/etfs/${enc(ticker)}/in-outflow`);
export const whalesEtfInfo = (ticker: string) => uw<UwEtfInfo>(`/etfs/${enc(ticker)}/info`);

