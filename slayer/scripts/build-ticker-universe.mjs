#!/usr/bin/env node
/* Builds src/data/generated/tickerUniverse.json, the app's ticker directory: every symbol the two data keys serve,
   with its name, kind, exchange, and which desks can serve it. Refresh it daily (a full run reads every list fresh):

     node scripts/build-ticker-universe.mjs [--cache <dir>] [--master <csv>] [--offline]

   Needs the ThetaData terminal (THETA_URL, default http://127.0.0.1:25503/v3) and UNUSUAL_WHALES_API_KEY in the
   environment. Every answer is kept in the cache folder (default <tmp>/slayer-ticker-universe/<date>), so a stopped
   run picks up where it left off; --offline builds from the cache alone. --master also writes the full table (every
   symbol any list names, live or not, with both vendors' expiry lists) as CSV, for the audit report.

   Limits, set by docs/DATA_SOURCES.md and the keys' owners:
     - the terminal: one request in flight;
     - the vendor key (shared with the live app, 3 concurrent for everyone): one request in flight, 0.45 s apart,
       a 429 waits out Retry-After (else 2, 4 … 60 s). The vendor walk is about 6,500 requests: roughly 75 minutes.

   Sources:
     terminal  /stock/list/symbols, /option/list/symbols, /index/list/symbols; /stock/snapshot/quote and /ohlc and
               /index/snapshot/price (150 symbols a request) for what is quoted now; /option/list/expirations for
               every option root; /stock/list/dates/trade for a quoted symbol with no bar this week.
     vendor    /screener/stocks (every row, paged by ticker: name, type, options flag, 30-day option volume),
               /stock-directory/ticker-exchanges (every ticker it maps), and /stock/{t}/greek-exposure/expiry, the
               list Pinpoint reads its expiries from, for every screener ticker and every name the terminal lists
               options on.
     names     the house tables, the Nasdaq Trader symbol directory, the SEC's company_tickers_exchange.json, the
               previous build, then the vendor's screener name.

   Which desk gets a symbol (docs/DATA_SOURCES.md):
     Terrain   needs the terminal's quotes and bars: a stock quoted (or with a bar) in the last 10 sessions and with a
               bar in the last 30 days, or an index priced in the last 10 sessions.
     Pinpoint  reads its options from the vendor: a name whose vendor expiry list has a live date. A name only the
               terminal lists options on is NOT offered there (no vendor greeks, and Pinpoint may not use the
               terminal's).
     options   (the Weigher, Paper, Backtest) the terminal's chains: a root with a live expiration. */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { HOLIDAY_DATES } from '../shared/marketCalendar.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'src/data/generated/tickerUniverse.json');
const SCHEMA = 2;
const THETA = process.env.THETA_URL || 'http://127.0.0.1:25503/v3';
const UW = 'https://api.unusualwhales.com/api';
const UW_KEY = process.env.UNUSUAL_WHALES_API_KEY || '';
const UA = process.env.SEC_USER_AGENT || 'Slayer symbol directory (contact via repository owner)';

const argv = process.argv.slice(2);
const arg = name => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : '';
};
const OFFLINE = argv.includes('--offline');
const MASTER = arg('--master');

const log = (...a) => console.error('[universe]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- the clock: the last finished session and the first date an expiry can still be live ---- */
const HOLIDAYS = new Set(HOLIDAY_DATES);
const etParts = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
};
const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = d => new Date(`${d}T12:00:00Z`).getUTCDay();
const isSession = d => weekday(d) % 6 !== 0 && !HOLIDAYS.has(d);
const nextSession = d => {
  let x = addDays(d, 1);
  while (!isSession(x)) x = addDays(x, 1);
  return x;
};
const prevSession = d => {
  let x = addDays(d, -1);
  while (!isSession(x)) x = addDays(x, -1);
  return x;
};
const NOW = etParts();
/* options stop trading at 16:15 ET at the latest: after that today's expiries are settled */
const OPEN_TODAY = isSession(NOW.date) && NOW.minute < 16 * 60 + 15;
const FLOOR = OPEN_TODAY ? NOW.date : nextSession(NOW.date);
const SESSION = isSession(NOW.date) && NOW.minute >= 16 * 60 + 15 ? NOW.date : prevSession(NOW.date);
const today = NOW.date;
const QUOTE_SINCE = (() => {
  let d = SESSION;
  for (let i = 0; i < 9; i++) d = prevSession(d);
  return d;
})();
const BAR_SINCE = addDays(SESSION, -30);

const CACHE = arg('--cache') || join(tmpdir(), 'slayer-ticker-universe', today);
mkdirSync(CACHE, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
log('clock', { today, session: SESSION, floor: FLOOR, cache: CACHE });

/* ---- the cache: every answer kept as a file, written whole ---- */
const cachePath = name => join(CACHE, name);
const readCache = name => (existsSync(cachePath(name)) ? JSON.parse(readFileSync(cachePath(name), 'utf8')) : undefined);
const writeCache = (name, value) => {
  const tmp = `${cachePath(name)}.tmp`;
  writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value));
  renameSync(tmp, cachePath(name));
};
async function cached(name, fetcher) {
  const have = readCache(name);
  if (have !== undefined) return have;
  if (OFFLINE) throw new Error(`--offline: ${name} is not in ${CACHE}`);
  const value = await fetcher();
  writeCache(name, value);
  return value;
}
async function cachedText(name, fetcher) {
  if (existsSync(cachePath(name))) return readFileSync(cachePath(name), 'utf8');
  if (OFFLINE) return null;
  const text = await fetcher();
  if (text) writeCache(name, text);
  return text;
}

/* ---- the terminal: one request in flight ---- */
async function theta(path, params = {}) {
  const q = new URLSearchParams({ ...params, format: 'json' });
  let wait = 1000;
  for (let i = 0; i < 4; i++) {
    let res = null;
    try {
      res = await fetch(`${THETA}${path}?${q}`);
    } catch {
      /* the terminal is restarting: asked again */
    }
    if (res?.status === 472) return [];
    if (res?.ok) {
      const j = await res.json();
      return Array.isArray(j) ? j : (j.response ?? []);
    }
    /* a malformed request (400, 404) is not asked again; an outage code (47x, 5xx) is */
    if (res && res.status >= 400 && res.status < 470) throw new Error(`terminal ${res.status} ${path}`);
    await sleep(wait);
    wait = Math.min(30_000, wait * 2);
  }
  throw new Error(`the terminal did not answer ${path} — is it running?`);
}

/* ---- the vendor: one request in flight, 0.45 s apart, a 429 waited out ---- */
let uwLast = 0;
async function uw(path, params) {
  if (!UW_KEY) throw new Error('UNUSUAL_WHALES_API_KEY is not set');
  const q = params ? `?${new URLSearchParams(params)}` : '';
  let wait = 2000;
  let status = 0;
  for (let i = 0; i < 6; i++) {
    const gap = 450 - (Date.now() - uwLast);
    if (gap > 0) await sleep(gap);
    uwLast = Date.now();
    let res;
    try {
      res = await fetch(`${UW}${path}${q}`, { headers: { Authorization: `Bearer ${UW_KEY}`, Accept: 'application/json', 'User-Agent': 'slayer-ticker-universe' } });
    } catch {
      await sleep(wait);
      wait = Math.min(60_000, wait * 2);
      continue;
    }
    status = res.status;
    if (status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Math.min(60_000, Math.max(Number.isFinite(ra) ? ra * 1000 : 0, wait)));
      wait = Math.min(60_000, wait * 2);
      continue;
    }
    if (status >= 500) {
      await sleep(wait);
      wait = Math.min(60_000, wait * 2);
      continue;
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* an empty body */
    }
    return { status, body };
  }
  return { status, body: null };
}

async function getText(url, headers = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (res.ok) return await res.text();
      if (res.status === 404) return null;
    } catch {
      /* asked again */
    }
    await sleep(800 * (i + 1));
  }
  return null;
}

/* ---- names ---- */

/** Hand names for the cash indexes the terminal carries (and the weekly roots that share their chains) */
const INDEX_NAMES = {
  SPX: 'S&P 500 Index', SPXW: 'S&P 500 Index (Weeklys)', XSP: 'Mini-S&P 500 Index', NDX: 'Nasdaq-100 Index',
  NDXP: 'Nasdaq-100 Index (PM-settled)', XNDX: 'Nasdaq-100 Index (Mini Reduced Value)', NQX: 'Nasdaq-100 Micro Index',
  MNX: 'Mini-Nasdaq-100 Index', RUT: 'Russell 2000 Index', RUTW: 'Russell 2000 Index (Weeklys)', MRUT: 'Mini-Russell 2000 Index',
  RUI: 'Russell 1000 Index', RUA: 'Russell 3000 Index', RLG: 'Russell 1000 Growth Index', RLV: 'Russell 1000 Value Index',
  VIX: 'Cboe Volatility Index', VIXW: 'Cboe Volatility Index (Weeklys)', VIX1D: 'Cboe 1-Day Volatility Index',
  VIX9D: 'Cboe S&P 500 9-Day Volatility Index', VIX3M: 'Cboe S&P 500 3-Month Volatility Index',
  VIX6M: 'Cboe S&P 500 6-Month Volatility Index', VIX1Y: 'Cboe S&P 500 1-Year Volatility Index', VVIX: 'Cboe VIX of VIX Index',
  VXN: 'Cboe Nasdaq-100 Volatility Index', RVX: 'Cboe Russell 2000 Volatility Index', VXD: 'Cboe DJIA Volatility Index',
  GVZ: 'Cboe Gold ETF Volatility Index', OVX: 'Cboe Crude Oil ETF Volatility Index', VXEEM: 'Cboe Emerging Markets ETF Volatility Index',
  SKEW: 'Cboe S&P 500 Skew Index', DJX: 'Dow Jones Industrial Average (1/100)', DJI: 'Dow Jones Industrial Average',
  DJU: 'Dow Jones Utility Average', OEX: 'S&P 100 Index', XEO: 'S&P 100 Index (European)', SPESG: 'S&P 500 ESG Index',
  SOX: 'PHLX Semiconductor Index', OSX: 'PHLX Oil Service Index', BKX: 'KBW Nasdaq Bank Index', HGX: 'PHLX Housing Index',
  XAU: 'PHLX Gold and Silver Index', UTY: 'PHLX Utility Sector Index', TNX: 'Cboe 10-Year Treasury Yield Index',
  TYX: 'Cboe 30-Year Treasury Yield Index', FVX: 'Cboe 5-Year Treasury Yield Index', IRX: 'Cboe 13-Week Treasury Bill Index',
};
/** Weekly and PM roots: option roots of a cash index, priced off the index itself */
const WEEKLY_ROOTS = ['SPXW', 'NDXP', 'RUTW', 'VIXW'];

const ENTITY = { '&#39;': "'", '&apos;': "'", '&amp;': '&', '&quot;': '"', '&#34;': '"' };
const plain = s => String(s ?? '').replace(/&(?:#39|apos|amp|quot|#34);/g, m => ENTITY[m] ?? m);

/** A listing's security name as a company name: the share-class line dropped (the class letter kept), the long
    unit / warrant / preferred descriptions cut at their first clause. */
function cleanName(raw, etf) {
  let n = plain(raw).replace(/\s+/g, ' ').trim().replace(/\s+When[- ]Issued$/i, '');
  if (!n) return '';
  n = n.replace(/,?\s+(?:each|Each|EACH)\b.*$/, '').replace(/,\s*(?:Liquidation Preference|par value|\$\d).*$/i, '').trim();
  if (etf) return n.replace(/\s+-\s*$/, '');
  n = n.replace(/\s*-\s*(Warrants?|Units?|Rights?)\s*$/i, (_, w) => ` ${w.charAt(0).toUpperCase()}${w.slice(1).toLowerCase().replace(/s?$/, 's')}`);
  const cls = /(?:\s*-\s*|\s+)(Class [A-Z]|Series [A-Z])?\s*(?:Common Stock|Common Shares?(?: of Beneficial Interest)?|Ordinary Shares?|American Deposit[ao]ry Shares?|American Deposit[ao]ry Receipts?|Sponsored ADRs?|ADRs?|Shares of Beneficial Interest|Subordinate Voting Shares|Capital Stock|Limited Partnership Units|Common Units(?: representing.*)?|Shares)\s*$/i;
  const m = cls.exec(n);
  if (m && m.index > 2) n = n.slice(0, m.index).trim() + (m[1] ? ` ${m[1].replace(/^class/i, 'Class').replace(/^series/i, 'Series')}` : '');
  return n.replace(/\s+-\s*$/, '').replace(/\s{2,}/g, ' ').trim();
}

/** The SEC writes many names in capitals ("NVIDIA CORP"): sentence-cased, short initialisms kept */
const KEEP_UP = new Set(['AG', 'SA', 'NV', 'SE', 'LP', 'LLC', 'PLC', 'ETF', 'ETN', 'REIT', 'II', 'III', 'IV', 'VI', 'US', 'USA', 'UK', 'AI', 'ADR', 'BDC', 'ESG', 'SPDR', 'MSCI', 'NA', 'NYSE', 'IBM', 'AT&T', 'CVS', 'HP', 'GE', 'BP', 'AMC', 'TD', 'ING', 'UBS', 'HSBC', 'BHP', 'RTX', 'CSX', 'PG&E', 'NRG', 'AES', 'ASML', 'NVIDIA', 'AMD', 'SAP']);
const SMALL = new Set(['of', 'and', 'the', 'for', 'de', 'la', 'du', 'in', 'on', 'at', 'by', 'to', 'a', 'an']);
function caseSec(s) {
  if (s !== s.toUpperCase() || !/[A-Z]{3}/.test(s)) return s;
  return s
    .split(/(\s+|\/|-)/)
    .map((w, i) => {
      if (!w || /^(\s+|\/|-)$/.test(w)) return w;
      const bare = w.replace(/[.,]+$/, '');
      const tail = w.slice(bare.length);
      if (KEEP_UP.has(bare)) return w;
      const lower = bare.toLowerCase();
      if (i > 0 && SMALL.has(lower)) return lower + tail;
      if (/^[A-Z]{2,3}$/.test(bare) && !/[AEIOUY]/.test(bare)) return w; // an initialism with no vowel (CSX, JPM)
      return lower.charAt(0).toUpperCase() + lower.slice(1) + tail;
    })
    .join('')
    .replace(/\bInc\b\.?/g, 'Inc.')
    .replace(/\bCorp\b\.?/g, 'Corp.')
    .replace(/\bLtd\b\.?/g, 'Ltd.')
    .replace(/\bCo\b\.?(?=\s|$)/g, 'Co.')
    .replace(/\bHldgs\b\.?/g, 'Holdings')
    .replace(/\s\/[A-Z]{2}\/?$/, ''); // "/DE/" state suffixes
}

/** Pull `{ symbol: 'X', name: 'Y' }` pairs, or `X: 'Y'` record entries, out of a TS source */
function namesFromSource(path, recordName) {
  const out = new Map();
  if (!existsSync(path)) return out;
  const src = readFileSync(path, 'utf8');
  for (const m of src.matchAll(/\{\s*symbol:\s*'([^']+)',\s*name:\s*'((?:[^'\\]|\\.)+)'/g)) out.set(m[1], m[2].replace(/\\'/g, "'"));
  if (recordName) {
    const block = new RegExp(`const ${recordName}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(src);
    if (block) for (const m of block[1].matchAll(/([A-Z0-9.]+):\s*'((?:[^'\\]|\\.)+)'/g)) out.set(m[1], m[2].replace(/\\'/g, "'"));
  }
  return out;
}

/* ---- the Nasdaq Trader directory: ACT symbols to the terminal's form ---- */
function actToTheta(act) {
  let s = act.trim().toUpperCase();
  if (!s) return '';
  s = s.replace(/\$([A-Z]?)$/, (_, l) => (l ? `.PR.${l}` : '.PR'));
  s = s.replace(/\.W$/, '.WS').replace(/\.R$/, '.RT');
  return s;
}

function nasdaqTrader(text, file) {
  const rows = [];
  if (!text) return rows;
  const lines = text.split(/\r?\n/);
  const head = lines[0].split('|');
  for (const line of lines.slice(1)) {
    if (!line || line.startsWith('File Creation Time')) continue;
    const p = line.split('|');
    const get = k => p[head.indexOf(k)] ?? '';
    if (get('Test Issue') === 'Y') continue;
    if (file === 'nasdaq') {
      const symbol = get('Symbol').trim().toUpperCase();
      rows.push({ symbol, name: get('Security Name'), etf: get('ETF') === 'Y', exch: 'Q' });
    } else {
      rows.push({ symbol: actToTheta(get('ACT Symbol')), name: get('Security Name'), etf: get('ETF') === 'Y', exch: get('Exchange') || '' });
    }
  }
  return rows;
}

/* ---- known ticker changes: kept only when the data agree (the old symbol is dark, the new one quoted) ---- */
const RENAMES = [
  ['FB', 'META', '2022-06-09'], ['SQ', 'XYZ', '2025-01-21'], ['ANTM', 'ELV', '2022-06-28'], ['DWAC', 'DJT', '2024-03-26'],
  ['PARA', 'PSKY', '2025-08-07'], ['ABC', 'COR', '2023-08-30'], ['FLT', 'CPAY', '2024-03-25'], ['CDAY', 'DAY', '2024-02-01'],
  ['PEAK', 'DOC', '2024-03-04'], ['RE', 'EG', '2023-07-10'], ['GPS', 'GAP', '2024-08-22'], ['WRK', 'SW', '2024-07-08'],
  ['CTL', 'LUMN', '2020-09-18'], ['UTX', 'RTX', '2020-04-03'], ['TWTR', '', ''], ['FISV', 'FI', '2023-06-07'], ['FI', 'FISV', '2025-11-11'],
  ['MMC', 'MRSH', '2026-01-20'], ['SIX', 'FUN', '2024-07-02'], ['HZNP', '', ''],
].filter(r => r[1]);

/* ---- inventory: every list each source offers ---- */
const symbolsOf = rows => (Array.isArray(rows) ? rows : []).map(r => String((r && r.symbol) ?? r ?? '').trim().toUpperCase()).filter(Boolean);
const tdStockList = symbolsOf(await cached('td_stock_symbols.json', () => theta('/stock/list/symbols')));
const tdRootList = symbolsOf(await cached('td_option_symbols.json', () => theta('/option/list/symbols')));
const tdIndexList = symbolsOf(await cached('td_index_symbols.json', () => theta('/index/list/symbols')));
log('terminal lists', { stocks: tdStockList.length, optionRoots: tdRootList.length, indexes: tdIndexList.length });
const tdStock = new Set(tdStockList);
const tdIndex = new Set(tdIndexList);

async function snapshot(kind, snap, symbols) {
  return cached(`td_${kind}_snapshot_${snap}.json`, async () => {
    const got = {};
    for (let i = 0; i < symbols.length; i += 150) {
      const chunk = symbols.slice(i, i + 150).filter(s => !s.includes(','));
      for (const r of await theta(`/${kind}/snapshot/${snap}`, { symbol: chunk.join(',') })) if (r?.symbol) got[r.symbol] = r;
      if ((i / 150) % 40 === 0) log(`  ${kind} ${snap}`, i, Object.keys(got).length);
    }
    return got;
  });
}
const quote = await snapshot('stock', 'quote', tdStockList);
const ohlc = await snapshot('stock', 'ohlc', tdStockList);
const indexPrice = await snapshot('index', 'price', tdIndexList);

/* every root's expirations (the whole walk is kept, a stopped run goes on from where it was) */
const expirations = readCache('td_option_expirations.json') ?? {};
{
  const todo = tdRootList.filter(r => !Array.isArray(expirations[r]));
  if (todo.length && OFFLINE) throw new Error(`--offline: ${todo.length} roots have no expirations in the cache`);
  log('expiration walk', { roots: tdRootList.length, toAsk: todo.length });
  let n = 0;
  for (const r of todo) {
    try {
      expirations[r] = [...new Set((await theta('/option/list/expirations', { symbol: r })).map(x => x.expiration).filter(Boolean))].sort();
    } catch (e) {
      log('  expirations failed', r, String(e).slice(0, 80));
    }
    if (++n % 500 === 0) {
      writeCache('td_option_expirations.json', expirations);
      log('  expirations', n);
    }
  }
  writeCache('td_option_expirations.json', expirations);
}

/* the vendor: its whole screener, its ticker directory */
const SCREEN_KEEP = ['ticker', 'full_name', 'issue_type', 'is_index', 'has_options', 'sector', 'marketcap', 'close', 'prev_close', 'date', 'quote_time', 'total_open_interest', 'call_open_interest', 'put_open_interest', 'call_volume', 'put_volume', 'prev_day_option_volume', 'avg_30_day_call_volume', 'avg_30_day_put_volume', 'avg30_volume', 'stock_volume', 'iv30d', 'bid', 'ask'];
const screener = await cached('uw_screener_all.json', async () => {
  const rows = new Map();
  for (let page = 0; page < 200; page++) {
    const { status, body } = await uw('/screener/stocks', { limit: '500', offset: String(page), order: 'ticker', order_direction: 'asc' });
    const data = Array.isArray(body?.data) ? body.data : [];
    if (status !== 200) throw new Error(`the vendor's screener answered ${status}`);
    for (const r of data) rows.set(r.ticker, Object.fromEntries(SCREEN_KEEP.map(k => [k, r[k] ?? null])));
    if (data.length < 500) break;
  }
  return [...rows.values()];
});
const uwDirectory = (await cached('uw_stock-directory_ticker-exchanges.json', async () => {
  const { status, body } = await uw('/stock-directory/ticker-exchanges');
  if (status !== 200) throw new Error(`the vendor's ticker directory answered ${status}`);
  return body;
}))?.data ?? [];
const screen = new Map(screener.map(r => [String(r.ticker).toUpperCase(), r]));
log('vendor lists', { screener: screen.size, directory: uwDirectory.length });

/* ---- one symbol for every spelling: the terminal's stock form (BRK.B, X.PR.A, X.WS, X.U, X.RT) ---- */
const testSymbol = s => /TEST/.test(s) || /^Z[A-Z]ZZT$/.test(s) || ['ZBZX', 'ZEXIT', 'ZIEXT', 'ZXIET', 'ZTST', 'ZZK', 'IGZ', 'ZVV', 'NTEST'].includes(s);
const wellFormed = s => /^[A-Z0-9][A-Z0-9./]{0,15}$/.test(s) && !testSymbol(s);
const derivative = sym => /\.(PR|WS|U|RT|W|R)(\.|$)|\/WI$|\.CL$|\.CV$/.test(sym);

/** An option root's underlying and how the root relates to it */
function rootUnderlying(root) {
  if (tdStock.has(root)) return { u: root, how: 'standard' };
  if (tdIndex.has(root)) return { u: root, how: 'index' };
  for (const suf of ['PM', 'W', 'P']) {
    const b = root.slice(0, -suf.length);
    if (root.endsWith(suf) && b && tdIndex.has(b) && !tdStock.has(b)) return { u: b, how: 'index weekly/PM' };
  }
  if (/^[A-Z]{2,6}$/.test(root)) {
    const cs = `${root.slice(0, -1)}.${root.slice(-1)}`;
    if (tdStock.has(cs)) return { u: cs, how: 'class share' };
  }
  const m = /^(\d*)([A-Z]+)(\d*)$/.exec(root);
  if (m && (m[1] || m[3])) {
    const b = m[2];
    const cs = b.length >= 2 ? `${b.slice(0, -1)}.${b.slice(-1)}` : '';
    return { u: tdStock.has(b) || tdIndex.has(b) || !cs || !tdStock.has(cs) ? b : cs, how: 'adjusted' };
  }
  /* a digit inside a root no listing carries (B1BIT): an adjusted root whose underlying the root does not spell */
  if (/\d/.test(root)) return { u: root, how: 'adjusted' };
  return { u: root, how: 'standard' };
}
/** A vendor ticker in the terminal's form */
function uwCanon(t) {
  if (tdStock.has(t) || tdIndex.has(t)) return t;
  const r = rootUnderlying(t);
  if (r.how === 'index weekly/PM' || r.how === 'class share') return r.u;
  let m;
  if ((m = /^([A-Z][A-Z.]*)-([A-Z])$/.exec(t))) return `${m[1]}.PR.${m[2]}`;
  if ((m = /^([A-Z][A-Z.]*)\+#?$/.exec(t))) return `${m[1]}.WS${t.endsWith('#') ? '/WI' : ''}`;
  if ((m = /^([A-Z][A-Z.]*)=$/.exec(t))) return `${m[1]}.U`;
  if ((m = /^([A-Z][A-Z.]*)\^(#?)$/.exec(t))) return `${m[1]}.RT${m[2] ? '/WI' : ''}`;
  if ((m = /^([A-Z][A-Z.]*)#$/.exec(t))) return `${m[1]}/WI`;
  return t;
}
/** The vendor's spelling of a symbol (a class share as its letters: BRK.B is BRKB) */
const uwForm = s => (/^[A-Z]{1,5}\.[A-Z]$/.test(s) ? s.replace('.', '') : s);

/* ---- the master table ---- */
const master = new Map();
const entry = sym => {
  let e = master.get(sym);
  if (!e) {
    e = { symbol: sym, tdStock: false, tdIndex: false, roots: [], uwTickers: new Set(), uwScreener: false, uwDirectory: false, uwDirExch: '' };
    master.set(sym, e);
  }
  return e;
};
for (const s of tdStockList) entry(s).tdStock = true;
for (const s of tdIndexList) entry(s).tdIndex = true;
const rootInfo = new Map();
for (const r of tdRootList) {
  const info = rootUnderlying(r);
  rootInfo.set(r, info);
  entry(info.u).roots.push(r);
}
for (const r of screener) {
  const t = String(r.ticker).toUpperCase();
  const e = entry(uwCanon(t));
  e.uwScreener = true;
  e.uwTickers.add(t);
}
const UW_EXCH = { nasdaq: 'Q', nyse: 'N', bats: 'Z' };
for (const r of uwDirectory) {
  const t = String(r.ticker || '').toUpperCase();
  if (!t) continue;
  const e = entry(uwCanon(t));
  e.uwDirectory = true;
  e.uwDirExch ||= UW_EXCH[r.exchange] ?? '';
}

/* live roots: an expiration on or after the floor */
const liveDates = root => (expirations[root] ?? []).filter(d => d >= FLOOR);
/* the vendor's expiry walk: every screener ticker, and the vendor's spelling of every name the terminal lists live
   options on (its standard and index roots, not an adjusted root) */
const uwExp = readCache('uw_greek_expiry.json') ?? {};
{
  const want = new Set(screener.map(r => String(r.ticker).toUpperCase()));
  for (const [r, info] of rootInfo) if (info.how !== 'adjusted' && liveDates(r).length) want.add(info.how === 'standard' || info.how === 'index' ? uwForm(r) : r);
  const todo = [...want].filter(t => !uwExp[t] || ![200, 404, 422].includes(uwExp[t].status));
  if (todo.length && OFFLINE) throw new Error(`--offline: ${todo.length} vendor expiry lists are not in the cache`);
  log('vendor expiry walk', { tickers: want.size, toAsk: todo.length });
  let n = 0;
  for (const t of todo) {
    const { status, body } = await uw(`/stock/${encodeURIComponent(t)}/greek-exposure/expiry`);
    const rows = Array.isArray(body?.data) ? body.data.map(x => [x.expiry, x.dte, x.date, x.call_gex, x.put_gex, x.call_delta, x.put_delta]) : [];
    uwExp[t] = { status, rows, at: Date.now() / 1000, msg: status === 200 ? '' : JSON.stringify(body ?? '').slice(0, 200) };
    if (++n % 200 === 0) {
      writeCache('uw_greek_expiry.json', uwExp);
      log('  vendor expiries', n);
    }
  }
  writeCache('uw_greek_expiry.json', uwExp);
}
for (const [t, v] of Object.entries(uwExp)) if (v.status === 200 && v.rows.length) entry(uwCanon(t)).uwTickers.add(t);

/* a quoted symbol with no bar this week: its last trade decides whether a chart can be drawn */
const noBar = tdStockList.filter(s => quote[s] && !ohlc[s] && wellFormed(s));
const lastTrade = readCache('td_stock_last_trade.json') ?? {};
for (const s of noBar) {
  if (s in lastTrade || OFFLINE) continue;
  try {
    const rows = await theta('/stock/list/dates/trade', { symbol: s });
    lastTrade[s] = rows.length ? String(rows[rows.length - 1].date ?? rows[rows.length - 1]) : '';
  } catch {
    lastTrade[s] = '';
  }
}
writeCache('td_stock_last_trade.json', lastTrade);
const isoOf = d => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : String(d).slice(0, 10));

/* ---- expiry patterns, read off the listed dates ---- */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const monday = d => addDays(d, -((weekday(d) + 6) % 7));
const thirdFriday = (y, m) => {
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  return addDays(first, ((5 - weekday(first) + 7) % 7) + 14);
};
/** The month's standard expiry: its third Friday, or the session before when that Friday is a holiday */
const monthlyOf = d => {
  const f = thirdFriday(Number(d.slice(0, 4)), Number(d.slice(5, 7)));
  return isSession(f) ? f : prevSession(f);
};
const WINDOW_END = addDays(monday(FLOOR), 35);
function patternOf(dates) {
  if (!dates.length) return 'none';
  const win = dates.filter(d => d < WINDOW_END);
  if (!win.length) return 'long-dated only';
  const sessions = [];
  for (let d = FLOOR; d < WINDOW_END; d = addDays(d, 1)) if (isSession(d)) sessions.push(d);
  const days = new Set(win.map(weekday));
  const weeks = new Set(win.map(monday));
  if (win.length >= sessions.length * 0.8) return 'daily';
  if (days.has(1) && days.has(3) && days.has(5) && weeks.size >= 4) return 'Mon-Wed-Fri';
  if (days.size >= 2 && weeks.size >= 4) return `weekly (${[...days].sort().map(x => DAYS[x]).join('/')})`;
  if (weeks.size >= 4) return 'weekly';
  if (win.every(d => d === monthlyOf(d))) return 'monthly';
  return 'irregular';
}

/* ---- names ---- */
const [nasdaqText, otherText, secText] = [
  await cachedText('nasdaqlisted.txt', () => getText('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt')),
  await cachedText('otherlisted.txt', () => getText('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt')),
  await cachedText('sec_company_tickers_exchange.json', () => getText('https://www.sec.gov/files/company_tickers_exchange.json')),
];
if (!nasdaqText || !otherText) throw new Error('the Nasdaq Trader symbol directory did not answer');
const listed = new Map();
for (const r of [...nasdaqTrader(nasdaqText, 'nasdaq'), ...nasdaqTrader(otherText, 'other')]) if (r.symbol && !listed.has(r.symbol)) listed.set(r.symbol, r);
const sec = new Map();
if (secText) {
  const d = JSON.parse(secText);
  const fi = Object.fromEntries(d.fields.map((f, i) => [f, i]));
  for (const row of d.data) {
    const t = String(row[fi.ticker] || '').toUpperCase().replace(/-/g, '.');
    if (t && !sec.has(t)) sec.set(t, { name: caseSec(String(row[fi.name] || '')), exch: String(row[fi.exchange] || '') });
  }
}
const house = new Map([...namesFromSource(join(ROOT, 'src/data/sp500.ts')), ...namesFromSource(join(ROOT, 'src/data/tickers.ts'), 'FALLBACK_NAMES')]);
const oldJson = new Map();
try {
  for (const t of JSON.parse(readFileSync(join(ROOT, 'src/data/nasdaqTickers.json'), 'utf8'))) oldJson.set(t.symbol, plain(t.name));
} catch {
  /* gone: fine */
}
/* the previous build's names and order stand in for a source that is down this run */
const previous = { order: [], names: new Map() };
{
  let text = '';
  if (existsSync(OUT)) text = JSON.parse(readFileSync(OUT, 'utf8')).rows ?? '';
  else if (existsSync(join(ROOT, 'src/data/symbolDirectory.data.ts'))) text = /String\.raw`([\s\S]*?)`/.exec(readFileSync(join(ROOT, 'src/data/symbolDirectory.data.ts'), 'utf8'))?.[1] ?? '';
  for (const line of text.split('\n')) {
    const [s, n] = line.split('\t');
    if (!s) continue;
    previous.order.push(s);
    if (n) previous.names.set(s, n);
  }
}

/* ---- each symbol's facts ---- */
const recentQuote = s => !!quote[s] && String(quote[s].timestamp).slice(0, 10) >= QUOTE_SINCE;
const recentBar = s => (ohlc[s] ? String(ohlc[s].timestamp).slice(0, 10) >= BAR_SINCE : isoOf(lastTrade[s] || '') >= BAR_SINCE);
const recentOhlc = s => !!ohlc[s] && String(ohlc[s].timestamp).slice(0, 10) >= QUOTE_SINCE;
const recentPrice = s => !!indexPrice[s] && String(indexPrice[s].timestamp).slice(0, 10) >= QUOTE_SINCE;
const vol30 = t => {
  const r = screen.get(t);
  return r ? (Number(r.avg_30_day_call_volume) || 0) + (Number(r.avg_30_day_put_volume) || 0) : -1;
};

for (const e of master.values()) {
  const s = e.symbol;
  e.wellFormed = wellFormed(s);
  e.isIndex = e.tdIndex && !e.tdStock;
  e.stdRoots = e.roots.filter(r => rootInfo.get(r).how !== 'adjusted').sort();
  e.adjRoots = e.roots.filter(r => rootInfo.get(r).how === 'adjusted').sort();
  const byRoot = {};
  for (const r of e.stdRoots) {
    const live = liveDates(r);
    if (live.length) byRoot[r] = live;
  }
  e.tdByRoot = byRoot;
  e.tdDates = [...new Set(Object.values(byRoot).flat())].sort();
  const uwDates = new Set();
  const uwStale = new Set();
  let uwAsked = false;
  for (const t of e.uwTickers) {
    const v = uwExp[t];
    if (!v) continue;
    uwAsked = true;
    for (const row of v.rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row[0]))) continue;
      (row[0] >= FLOOR ? uwDates : uwStale).add(row[0]);
    }
  }
  /* a symbol whose vendor spelling was asked but is not one of its tickers yet (a class share, a weekly root) */
  for (const t of [uwForm(s)]) {
    const v = uwExp[t];
    if (v && !e.uwTickers.has(t)) {
      uwAsked = true;
      for (const row of v.rows) if (/^\d{4}-\d{2}-\d{2}$/.test(String(row[0]))) (row[0] >= FLOOR ? uwDates : uwStale).add(row[0]);
    }
  }
  e.uwAsked = uwAsked;
  e.uwDates = [...uwDates].sort();
  e.uwStale = [...uwStale].sort();
  e.inUw = e.uwScreener || e.uwDirectory || e.uwDates.length > 0;
  e.tdOptions = e.tdDates.length > 0;
  e.uwOptions = e.uwDates.length > 0;
  e.quoted = e.tdStock ? recentQuote(s) || recentOhlc(s) : e.isIndex ? recentPrice(s) : false;
  /* Terrain: the terminal's quotes and bars */
  if (!e.wellFormed) [e.terrain, e.terrainWhy] = [false, testSymbol(s) ? 'an exchange test symbol' : 'malformed symbol'];
  /* a bar this week stands for the quote where the terminal keeps no quote snapshot (BRK.A): its last trade is the price */
  else if (e.tdStock && (recentQuote(s) || recentOhlc(s)) && recentBar(s)) [e.terrain, e.terrainWhy] = [true, ''];
  else if (e.tdStock && recentQuote(s)) [e.terrain, e.terrainWhy] = [false, 'quoted but no trade in 30 days (no bars to draw)'];
  else if (e.tdStock) [e.terrain, e.terrainWhy] = [false, 'no quote in the last 10 sessions (inactive or delisted)'];
  else if (e.isIndex && recentPrice(s)) [e.terrain, e.terrainWhy] = [true, ''];
  else if (e.isIndex) [e.terrain, e.terrainWhy] = [false, 'index with no price in the last 10 sessions'];
  else if (e.roots.length) [e.terrain, e.terrainWhy] = [false, 'option root only: no stock or index listing in the terminal'];
  else [e.terrain, e.terrainWhy] = [false, 'vendor list only: the terminal does not carry it'];
  /* Pinpoint: the vendor's options */
  e.pinpoint = e.wellFormed && e.uwOptions;
  e.pinpointNote = !e.pinpoint ? (e.tdOptions ? 'options only in the terminal: not offered (no vendor greeks)' : '') : e.tdOptions ? 'both vendors list options' : 'vendor options only: the terminal lists none';
  if (e.pinpoint && !e.quoted) e.pinpointNote += '; no live price from the terminal';
  e.vol30 = Math.max(vol30(s), vol30(uwForm(s)), ...[...e.uwTickers].map(vol30));
  /* kind */
  const l = listed.get(s);
  const sr = screen.get(uwForm(s)) ?? screen.get(s);
  if (e.isIndex || (!e.tdStock && sr?.is_index)) e.kind = 'i';
  else if (l?.etf || sr?.issue_type === 'ETF') e.kind = 'e';
  else e.kind = /\.PR(\.|$)/.test(s) ? 'p' : /\.WS(\/|$)/.test(s) ? 'w' : /\.U$/.test(s) ? 'u' : /\.RT(\/|$)/.test(s) ? 'r' : 's';
  e.issueType = sr?.issue_type ?? (l?.etf ? 'ETF' : '');
  const secEx = sec.get(s)?.exch;
  e.exch = e.kind === 'i' ? 'C' : l ? l.exch : secEx === 'OTC' ? 'O' : secEx === 'Nasdaq' ? 'Q' : secEx === 'NYSE' ? 'N' : secEx === 'CBOE' ? 'Z' : e.uwDirExch;
  /* name */
  const h = house.get(s);
  if (INDEX_NAMES[s] && e.kind === 'i') [e.name, e.nameSrc] = [INDEX_NAMES[s], 'house'];
  else if (h) [e.name, e.nameSrc] = [h, 'house'];
  else if (l && cleanName(l.name, l.etf)) [e.name, e.nameSrc] = [cleanName(l.name, l.etf), 'nasdaqtrader'];
  else if (sec.get(s)?.name) [e.name, e.nameSrc] = [sec.get(s).name, 'sec'];
  else if (oldJson.get(s)) [e.name, e.nameSrc] = [cleanName(oldJson.get(s), false), 'bundled'];
  else if (previous.names.get(s)) [e.name, e.nameSrc] = [previous.names.get(s), 'previous'];
  else if (sr?.full_name) [e.name, e.nameSrc] = [caseSec(String(sr.full_name)), 'vendor'];
  else [e.name, e.nameSrc] = ['', ''];
  if (e.kind === 's' && !e.tdOptions && !e.uwOptions) {
    if (/\bWarrants?$/i.test(e.name)) e.kind = 'w';
    else if (/\bUnits?$/i.test(e.name)) e.kind = 'u';
    else if (/\bRights?$/i.test(e.name)) e.kind = 'r';
  }
}

/* ticker changes the data agree on */
const aliases = {};
for (const [from, to, on] of RENAMES) {
  const a = master.get(from);
  const b = master.get(to);
  if (!b || !(b.terrain || b.pinpoint)) continue;
  /* the old symbol must be dark: no quote and no vendor options (a LEAP may still list under the old root) */
  if (a && (a.quoted || a.uwOptions)) continue;
  aliases[from] = to;
  b.formerly = [...(b.formerly ?? []), `${from} (${on})`];
  entry(from).renamedTo = `${to} (${on})`;
}
log('ticker changes confirmed', aliases);

/* ---- the app's directory: every symbol a desk can serve, plus the vendor's screener names ---- */
const KIND_NAME = { s: 'stock', e: 'ETF', i: 'index', p: 'preferred', w: 'warrant', u: 'unit', r: 'right' };
const inApp = e => e.wellFormed && (e.terrain || e.pinpoint || e.tdOptions || e.uwScreener) && !(e.kind !== 'i' && !e.tdStock && !e.name && !e.pinpoint);
const app = [...master.values()].filter(inApp);
/* the weekly and PM roots of the cash indexes: their own row, folded into the index by every search */
for (const w of WEEKLY_ROOTS) {
  const base = rootUnderlying(w).u;
  const b = master.get(base);
  if (!b || app.some(e => e.symbol === w)) continue;
  const live = liveDates(w);
  const v = uwExp[w];
  app.push({ ...b, symbol: w, name: INDEX_NAMES[w] ?? b.name, tdOptions: live.length > 0, uwOptions: !!v?.rows?.some(r => r[0] >= FLOOR), pinpoint: !!v?.rows?.some(r => r[0] >= FLOOR), weeklyOf: base });
}
const prevRank = new Map(previous.order.map((s, i) => [s, i]));
const kindRank = { i: 0, s: 1, e: 1, p: 3, u: 3, w: 4, r: 4 };
app.sort((a, b) => {
  if (a.vol30 !== b.vol30) return b.vol30 - a.vol30;
  const pa = prevRank.get(a.symbol) ?? Infinity;
  const pb = prevRank.get(b.symbol) ?? Infinity;
  if (pa !== pb) return pa - pb;
  const oa = a.tdOptions || a.uwOptions;
  const ob = b.tdOptions || b.uwOptions;
  if (oa !== ob) return oa ? -1 : 1;
  if (!!a.name !== !!b.name) return a.name ? -1 : 1;
  return (kindRank[a.kind] ?? 2) - (kindRank[b.kind] ?? 2) || a.symbol.localeCompare(b.symbol);
});
const clip = s => String(s).replace(/[\t\n\r]/g, ' ').slice(0, 90).trim();
const flagsOf = e => `${e.kind}${e.tdOptions ? 'o' : ''}${e.uwOptions ? 'v' : ''}${e.terrain ? 't' : ''}${e.pinpoint ? 'p' : ''}${e.exch || ''}`;
const rows = app.map(e => `${e.symbol}\t${clip(e.name)}\t${flagsOf(e)}`);
const count = f => app.filter(f).length;
const stats = {
  rows: app.length,
  byKind: Object.fromEntries(Object.entries(KIND_NAME).map(([k, n]) => [n, count(e => e.kind === k)])),
  terrain: count(e => e.terrain),
  pinpoint: count(e => e.pinpoint),
  optionsTerminal: count(e => e.tdOptions),
  optionsVendor: count(e => e.uwOptions),
  named: count(e => e.name),
  namedNonIndexPct: Math.round((count(e => e.name && e.kind !== 'i') / Math.max(1, count(e => e.kind !== 'i'))) * 1000) / 10,
  sources: { stocks: tdStockList.length, optionRoots: tdRootList.length, indexes: tdIndexList.length, vendorScreener: screen.size, vendorDirectory: uwDirectory.length },
};
log('app directory', stats);
const doc = {
  schema: SCHEMA,
  builtOn: today,
  session: SESSION,
  floor: FLOOR,
  legend: 'rows: one symbol a line, SYMBOL \\t NAME \\t FLAGS. FLAGS: the kind (s stock, e ETF, i index, p preferred, w warrant, u unit, r right); then o (the terminal lists live options), v (the vendor lists live options), t (Terrain can serve it), p (Pinpoint can serve it); then the listing exchange (Q Nasdaq, N NYSE, A NYSE American, P NYSE Arca, Z Cboe BZX, V IEX, O OTC, C Cboe index). Most traded options first. aliases: an old ticker to its new one.',
  stats,
  aliases,
  rows: rows.join('\n'),
};
writeFileSync(OUT, `${JSON.stringify(doc)}\n`);
log('wrote', OUT, `${Math.round(readFileSync(OUT).length / 1024)} KB`);

/* ---- the full table, for the audit ---- */
if (MASTER) {
  const esc = v => {
    const s = Array.isArray(v) ? v.join('|') : v === true ? 'Y' : v === false ? '' : String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const cols = ['symbol', 'name', 'type', 'issue_type', 'exchange', 'quoted', 'renamed_to', 'formerly', 'option_roots', 'adjusted_roots', 'in_uw', 'uw_screener', 'uw_directory', 'uw_tickers', 'td_stock', 'td_options_any', 'td_index', 'uw_options', 'td_options', 'options_both', 'terrain', 'terrain_reason', 'pinpoint', 'pinpoint_note', 'in_app', 'vol30', 'uw_n', 'td_n', 'uw_nearest', 'td_nearest', 'uw_pattern', 'td_pattern', 'uw_dates', 'td_dates', 'uw_stale_dates', 'td_dates_by_root'];
  const lines = [cols.join(',')];
  const inAppSet = new Set(app.map(e => e.symbol));
  for (const e of [...master.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))) {
    const v = {
      symbol: e.symbol, name: e.name, type: KIND_NAME[e.kind], issue_type: e.issueType, exchange: e.exch, quoted: e.quoted, renamed_to: e.renamedTo ?? '', formerly: e.formerly ?? [],
      option_roots: e.stdRoots, adjusted_roots: e.adjRoots, in_uw: e.inUw, uw_screener: e.uwScreener, uw_directory: e.uwDirectory, uw_tickers: [...e.uwTickers].sort(),
      td_stock: e.tdStock, td_options_any: e.roots.length > 0, td_index: e.tdIndex, uw_options: e.uwOptions, td_options: e.tdOptions, options_both: e.uwOptions && e.tdOptions,
      terrain: e.terrain, terrain_reason: e.terrainWhy, pinpoint: e.pinpoint, pinpoint_note: e.pinpointNote, in_app: inAppSet.has(e.symbol), vol30: e.vol30 >= 0 ? Math.round(e.vol30) : '',
      uw_n: e.uwAsked ? e.uwDates.length : '', td_n: e.roots.length ? e.tdDates.length : '', uw_nearest: e.uwDates[0] ?? '', td_nearest: e.tdDates[0] ?? '',
      uw_pattern: e.uwAsked ? patternOf(e.uwDates) : '', td_pattern: e.roots.length ? patternOf(e.tdDates) : '', uw_dates: e.uwDates, td_dates: e.tdDates, uw_stale_dates: e.uwStale,
      td_dates_by_root: Object.entries(e.tdByRoot).map(([r, d]) => `${r}:${d.join(';')}`),
    };
    lines.push(cols.map(c => esc(v[c])).join(','));
  }
  writeFileSync(MASTER, `${lines.join('\n')}\n`);
  log('wrote', MASTER, master.size, 'symbols');
}
