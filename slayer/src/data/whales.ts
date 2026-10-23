/*
  UNUSUAL WHALES — the browser never holds the token.
  Pages call /api/uw, which is this app's server. The server adds the bearer
  token from UNUSUAL_WHALES_API_KEY and forwards to api.unusualwhales.com.
*/

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
  /** The Congress biographical directory id — only a member of Congress has one */
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
/* FIVE IN FLIGHT FROM THE BROWSER, THREE AT THE VENDOR (the seventh audit's m11, 2026-10-23: the Board on All expiries
   took 59–71s to fill). The key's cap of three concurrent calls is kept by the proxy (server/uwProxy.mjs upstreamSlot),
   which queues the rest; with only three asks in flight here, each upstream slot sat idle for the browser's own round
   trip between one answer and the next ask. Two more in flight keep the proxy's three slots busy; the vendor still
   never sees more than three. */
const MAX_INFLIGHT = 5;

/* THE BACKGROUND LANE (the sixth audit's M3, 2026-10-23): reads no row waits on (a Board name's open-interest change,
   ~170 pages across twenty names) took the key's three slots in turn with the levels' own reads. A low ask runs only
   when no ordinary or priority ask is waiting; the default lane is unchanged for every existing caller. */
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

/* ONE ASK PER ADDRESS (the fourth audit, 2026-10-23: the short file and the member page fired each of their reads twice —
   the desk's ledger and the page's own read ask the same address). Two asks for the same path share one request while
   it is in flight, and a slow-moving route's answer (one the proxy itself keeps five minutes) is reused for a minute.
   The routes that move with the tape (the proxy's 3- and 15-second classes) are never reused, only shared while in flight. Each caller gets
   its own copy of the body, so one caller's sort never reorders another's rows. */
type UwAnswer = { status: number; data: unknown; error: string | null };
/* the proxy's own short-lived classes (server/uwProxy.mjs ttlFor): the 3- and 15-second routes and one contract's
   reads move with the tape and are polled — they are only ever shared in flight */
const LIVE_PATH = /\/(option-trades|flow-alerts|market-tide|sector-tide|etf-tide|top-net-impact|net-flow|greek-flow|stock-state|quote|flow-per-strike-intraday|net-prem-ticks|nope|spot-exposures|greek-exposure|gex-levels|flow-per-|oi-|option-contracts|atm-chains|interpolated-iv|ohlc\/(?:1m|2m|3m|5m|15m|1h)|darkpool|lit-flow|options-volume|stock-price-levels|stock-volume-price-levels)(\/|$)|^\/option-contract\//;
const REUSE_MS = 60_000;
/* (round 9, Dossier) a live route's finished answer is reused for a little less than the proxy keeps it (its 3- and
   15-second classes), so two readers of one page (the stock page's book and its vendor rows) make one request, never
   staler than the proxy's own copy */
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

/** One GET, with the vendor's status and message. Does not invent a body. */
export async function uwCall(path: string, priority = false, low = false): Promise<UwAnswer> {
  const now = Date.now();
  const hit = shared.get(path);
  const bare = path.split('?')[0];
  if (hit && (!hit.done || now - hit.at < (LIVE_PATH.test(bare) ? liveReuseMs(bare) : REUSE_MS))) return copyOf(await hit.p);
  const entry = { at: now, done: false, p: uwFetch(path, priority && !low, low) };
  shared.set(path, entry);
  const got = await entry.p;
  entry.done = true;
  entry.at = Date.now();
  if (got.error) shared.delete(path);
  if (shared.size > 400) for (const [k, v] of shared) if (v.done && Date.now() - v.at > REUSE_MS) shared.delete(k);
  return copyOf(got);
}

async function uwFetch(path: string, priority: boolean, low = false): Promise<UwAnswer> {
  await takeSlot(priority, low);
  try {
    let res = await fetch(`/api/uw${path}`);
    /* one retry for a rate limit or a passing gateway hiccup (the ship sweep, 2026-10-22: a single 503 on a route that
       answered 200 three times straight after) — a second failure is real and is reported */
    if (res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504) {
      await new Promise(r => setTimeout(r, 1500));
      res = await fetch(`/api/uw${path}`);
    }
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed;
    if (!res.ok) {
      const msg =
        parsed && typeof parsed === 'object' && ('message' in parsed || 'error' in parsed)
          ? String((parsed as { message?: unknown; error?: unknown }).message || (parsed as { error?: unknown }).error)
          : text.slice(0, 180) || `unusual whales ${res.status}`;
      return { status: res.status, data, error: msg };
    }
    return { status: res.status, data, error: null };
  } catch (e) {
    return { status: 0, data: null, error: e instanceof Error ? e.message : 'unusual whales unreachable' };
  } finally {
    releaseSlot();
  }
}

async function paged<T>(path: string, limit: number, pages: number, onPage?: (soFar: T[]) => void): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < pages; page++) {
    const rows = await uw<T[]>(`${path}?limit=${limit}&page=${page}`, page === 0);
    if (!Array.isArray(rows) || rows.length === 0) break;
    out.push(...rows);
    onPage?.([...out]);
    if (rows.length < limit) break;
  }
  return out;
}

/* The vendor rejects limit=200 on headlines and limit=300 on congress. Pages are zero-indexed.
   The first page is priority and is handed up before the rest, so the wire is not blank while later pages load. */
export const whalesNews = (onPage?: (soFar: UwNews[]) => void) => paged<UwNews>('/news/headlines', 50, 4, onPage);
export const whalesCongress = () => paged<UwCongress>('/congress/recent-trades', 100, 3);
export const whalesPoliticians = () => uw<UwPolitician[]>('/congress/politicians?last_traded_within_months=24');
export const whalesInsiders = () => uw<UwInsider[]>('/insider/transactions');
export const whalesEcon = () => uw<UwEcon[]>('/market/economic-calendar');
export const whalesScreener = (tickers: string[], priority = false) =>
  uw<Record<string, unknown>[]>(`/screener/stocks?ticker=${tickers.map(t => encodeURIComponent(t)).join(',')}`, priority);
export const whalesFlow = () => uw<Record<string, unknown>[]>('/option-trades/flow-alerts');
export const whalesDarkPool = () => uw<Record<string, unknown>[]>('/darkpool/recent');
export const whalesEarnings = (ticker: string, priority = false) => uw<Record<string, unknown>[]>(`/earnings/${encodeURIComponent(ticker)}`, priority);
export const whalesEarningsSlot = (slot: 'premarket' | 'afterhours', date: string, page = 0) =>
  uw<Record<string, unknown>[]>(`/earnings/${slot}?date=${encodeURIComponent(date)}&limit=100&page=${page}`);
export const whalesStock = (ticker: string) => uw<Record<string, unknown>>(`/stock/${encodeURIComponent(ticker)}/info`);

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
}

const enc = (ticker: string) => encodeURIComponent(ticker);
export const whalesState = (ticker: string) => uw<UwState>(`/stock/${enc(ticker)}/stock-state`);
/** The quote: the last trade (price, epoch-ms time) and the NBBO — read when the stock-state has stalled in the session */
export interface UwQuote {
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
export const whalesBars = (ticker: string, size: '1m' | '5m', limit: number) =>
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

export const whalesDaily = (ticker: string) => uw<UwDaily[]>(`/stock/${enc(ticker)}/ohlc/1d?limit=260`, true);
/* THE DOSSIER'S DAILY SESSIONS (the data audit, 2026-10-22): a daily row comes three times a day — pre-market, regular
   and post (market_time pr · r · po) — so limit=260 was 87 sessions and the trend card could never draw its 200-day
   average. Two years of rows (timeframe=2Y; the route caps the default at one) at 900 rows is about 300 sessions. */
export const whalesDailyLong = (ticker: string) => uw<UwDaily[]>(`/stock/${enc(ticker)}/ohlc/1d?limit=900&timeframe=2Y`, true);
export const whalesDarkTicker = (ticker: string) => uw<Record<string, unknown>[]>(`/darkpool/${enc(ticker)}?limit=80`, true);
export const whalesFlowTicker = (ticker: string) =>
  uw<Record<string, unknown>[]>(`/option-trades/flow-alerts?ticker_symbol=${enc(ticker)}&limit=40`, true);
/** EVERY CONTRACT, PAGED (the sixth audit, 2026-10-23: `limit=1000` is past the spec's 500 and SPY's Nov 30, Dec 18
    and Dec 31 and QQQ's Dec 18 and Dec 31 stopped at 500 rows). One expiry's contracts, or — no expiry — every listed
    contract of the name, walked 500 at a time until a short page. Null when the first page fails; a later page that
    fails ends the walk with an error, so a caller never takes a cut list for the whole. */
/* NEVER A CUT OR UNSTABLE WALK (the seventh audit's M1, 2026-10-23): the vendor's paging is not stable — the same walk
   hands some rows twice and skips others (META's whole-name walk: 7,416 rows, 6,332 of them unique, 916 own-vol-date
   contracts missing; SPY's Dec 18 in two pages: 516 rows, 501 unique, while its calls and puts asked apart are 258 +
   258). So: an expiry that fits one page (under 500 rows) is read in one ask — nothing to page; one that fills a page
   is read calls and puts apart (option_type) — each side one page on every name the desk carries (a side past 500
   strikes still pages). Every row is kept once, by its contract. A walk that reaches `maxPages` is not the whole
   list and comes back null — never a truncated list taken for the whole. */
/* ONE WALK A DATE AT A TIME (audit round 7: a stock page read each of AAPL's sixteen near dates twice within forty
   seconds — two loads of the same book asked the same dates). A walk in flight, or one finished in the last
   PAGED_REUSE_MS, is shared; each caller gets its own copy of the rows. A failed walk is never kept. */
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
  /** One walk of `path`: every page until a short one — null on a failed page or when `maxPages` is reached */
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
/** One expiry's listed contracts, or the chain's busiest when no expiry is given (one page, as before — see the paged walk above). */
/* audit round 7: `limit=1000` is past the spec's 500 (docs/DATA_SOURCES.md), and the earnings page and the stock file
   each asked it for the same name seconds apart — one ask in flight or in the last CONTRACTS_REUSE_MS is shared, each
   caller with its own copy of the rows */
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
  /** SEC filer id — the holdings door takes it where some long names 404 (UBS AM, …) */
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

export interface UwTide {
  timestamp?: string;
  date?: string;
  net_call_premium?: string | number;
  net_put_premium?: string | number;
  net_volume?: string | number;
}

export const whalesInstitutions = (limit = 10) => uw<UwInstitution[]>(`/institutions?limit=${limit}&order=total_value`);
export const whalesHoldings = (name: string, limit = 30) => uw<UwHolding[]>(`/institution/${encodeURIComponent(name)}/holdings?limit=${limit}`);
export const whalesShorts = (minDate: string) =>
  uw<UwShort[]>(`/short_screener?limit=80&min_market_date=${encodeURIComponent(minDate)}&order_by=short_interest&order_direction=desc`);
export const whalesEtfHoldings = (ticker: string) => uw<UwEtfHolding[]>(`/etfs/${enc(ticker)}/holdings`);
export const whalesEtfFlow = (ticker: string) => uw<UwEtfFlow[]>(`/etfs/${enc(ticker)}/in-outflow`);
export const whalesEtfInfo = (ticker: string) => uw<UwEtfInfo>(`/etfs/${enc(ticker)}/info`);
export const whalesTide = () => uw<UwTide[]>('/market/market-tide');

