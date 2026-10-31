#!/usr/bin/env node
/* Builds src/data/symbolDirectory.data.ts: every symbol the data keys serve, with its name, its kind, whether it has
   listed options today, and its exchange. Run it with the ThetaData terminal up:

     node scripts/build-symbol-directory.mjs            (UNUSUAL_WHALES_API_KEY in the environment adds the popularity order)

   Sources, in order of trust for a name:
     1. the house's own names (src/data/tickers.ts FALLBACK_NAMES, src/data/sp500.ts, the index names below);
     2. the Nasdaq Trader symbol directory (nasdaqlisted.txt and otherlisted.txt) — every Nasdaq, NYSE, NYSE American,
        NYSE Arca, Cboe and IEX listing, with the ETF flag;
     3. the SEC's company_tickers_exchange.json — every filer with a ticker, OTC included;
     4. the old bundled list (src/data/nasdaqTickers.json), only for a symbol no current source knows;
     5. the vendor's stock info, for a name with listed options still unnamed after the above (at most 400 asks).
   Symbols: the terminal's stock, option-root and index lists (/v3/stock/list/symbols, /v3/option/list/symbols,
   /v3/index/list/symbols). "Has options" is a root whose last listed expiration is today or later
   (/v3/option/list/expirations). Popularity: the vendor's screener by 30-day call and put volume, then the previous
   directory's order. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'src/data/symbolDirectory.data.ts');
const THETA = process.env.THETA_URL || 'http://127.0.0.1:25503/v3';
const UW_KEY = process.env.UNUSUAL_WHALES_API_KEY || '';
const UA = process.env.SEC_USER_AGENT || 'Slayer symbol directory (contact via repository owner)';
const CACHE = join(tmpdir(), 'slayer-symbol-directory');
mkdirSync(CACHE, { recursive: true });
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

const log = (...a) => console.error('[symdir]', ...a);

async function getText(url, headers = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
      if (res.ok) return await res.text();
      if (res.status === 404 || res.status === 472 || res.status === 422) return null;
      log('status', res.status, url.replace(/\?.*/, ''));
    } catch (e) {
      log('fetch failed', url.replace(/\?.*/, ''), String(e).slice(0, 80));
    }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}

async function thetaList(kind) {
  const text = await getText(`${THETA}/${kind}/list/symbols?format=json`);
  if (!text) throw new Error(`the terminal did not answer /${kind}/list/symbols — is it running?`);
  return JSON.parse(text).response.map(r => String(r.symbol || '').trim().toUpperCase()).filter(Boolean);
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

/* ---- main ---- */

const [stockList, optionList, indexList] = await Promise.all([thetaList('stock'), thetaList('option'), thetaList('index')]);
log('terminal lists', { stocks: stockList.length, optionRoots: optionList.length, indexes: indexList.length });
const stockSet = new Set(stockList);
const optionSet = new Set(optionList);
const indexSet = new Set(indexList);

const [nasdaqText, otherText, secText] = await Promise.all([
  getText('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt'),
  getText('https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'),
  getText('https://www.sec.gov/files/company_tickers_exchange.json'),
]);
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
log('name sources', { nasdaqTrader: listed.size, sec: sec.size });

const house = new Map([
  ...namesFromSource(join(ROOT, 'src/data/sp500.ts')),
  ...namesFromSource(join(ROOT, 'src/data/tickers.ts'), 'FALLBACK_NAMES'),
]);
const oldJson = new Map();
try {
  for (const t of JSON.parse(readFileSync(join(ROOT, 'src/data/nasdaqTickers.json'), 'utf8'))) oldJson.set(t.symbol, plain(t.name));
} catch {
  /* gone: fine */
}

/* the previous directory's order and names stand in for a source that is down this run */
const previous = { order: [], names: new Map() };
if (existsSync(OUT)) {
  const m = /String\.raw`([\s\S]*?)`/.exec(readFileSync(OUT, 'utf8'));
  if (m) for (const line of m[1].split('\n')) {
    const [s, n] = line.split('\t');
    if (!s) continue;
    previous.order.push(s);
    if (n) previous.names.set(s, n);
  }
}
const bundlePath = join(ROOT, 'src/data/listedBundle.ts');
if (!previous.order.length && existsSync(bundlePath)) {
  const m = /BUNDLED_OPTIONS[^=]*=\s*(\[[\s\S]*?\]);/.exec(readFileSync(bundlePath, 'utf8'));
  if (m) previous.order = JSON.parse(m[1]);
}

/* ---- which roots list options today ---- */
const rootOf = sym => sym.replace(/[./]/g, '');
const derivative = sym => /\.(PR|WS|U|RT|W|R)(\.|$)|\/WI$|\.CL$|\.CV$/.test(sym);
const wantRoots = new Set();
for (const s of stockList) if (!derivative(s) && optionSet.has(rootOf(s))) wantRoots.add(rootOf(s));
for (const s of optionList) if (/^[A-Z]{1,6}$/.test(s)) wantRoots.add(s);
const expCachePath = join(CACHE, `expirations-${today}.json`);
const lastExp = existsSync(expCachePath) ? JSON.parse(readFileSync(expCachePath, 'utf8')) : {};
const todo = [...wantRoots].filter(r => !(r in lastExp));
log('expiration checks', { roots: wantRoots.size, toAsk: todo.length });
let done = 0;
async function worker() {
  while (todo.length) {
    const root = todo.shift();
    const text = await getText(`${THETA}/option/list/expirations?symbol=${encodeURIComponent(root)}&format=json`);
    let last = '';
    try {
      const rows = text ? JSON.parse(text).response : [];
      for (const r of rows) if (r.expiration > last) last = r.expiration;
    } catch {
      /* a 472 (no data) reads as none */
    }
    lastExp[root] = last;
    if (++done % 1000 === 0) {
      log('  checked', done);
      writeFileSync(expCachePath, JSON.stringify(lastExp));
    }
  }
}
await Promise.all(Array.from({ length: 8 }, worker));
writeFileSync(expCachePath, JSON.stringify(lastExp));
const liveRoot = root => (lastExp[root] || '') >= today;

/* ---- popularity: the vendor's screener by 30-day call and put volume ---- */
const vendor = new Map();
if (UW_KEY) {
  for (const order of ['avg_30_day_call_volume', 'avg_30_day_put_volume']) {
    const text = await getText(`https://api.unusualwhales.com/api/screener/stocks?limit=500&order=${order}&order_direction=desc`, { Authorization: `Bearer ${UW_KEY}`, Accept: 'application/json' });
    if (!text) continue;
    for (const r of JSON.parse(text).data ?? []) {
      const t = String(r.ticker || '').toUpperCase();
      const vol = (Number(r.avg_30_day_call_volume) || 0) + (Number(r.avg_30_day_put_volume) || 0);
      vendor.set(t, { vol, type: r.issue_type, hasOptions: r.has_options === true, name: r.full_name || '' });
    }
  }
  log('vendor screener rows', vendor.size);
}

/* ---- assemble ---- */
const entries = new Map();
const add = (symbol, kind, exch) => {
  if (!entries.has(symbol)) entries.set(symbol, { symbol, kind, exch, name: '', src: '', options: false });
  return entries.get(symbol);
};
/** The exchanges' test symbols (ZVZZT, ZXIET, CTEST, ATEST.C) */
const testSymbol = s => /TEST/.test(s) || /^Z[A-Z]ZZT$/.test(s) || ['ZBZX', 'ZEXIT', 'ZIEXT', 'ZXIET', 'ZTST', 'ZZK', 'IGZ', 'ZVV', 'NTEST'].includes(s);
for (const s of stockList) {
  if (!/^[A-Z0-9][A-Z0-9./]{0,15}$/.test(s) || s.startsWith('.') || testSymbol(s)) continue;
  const l = listed.get(s);
  const kind = l?.etf ? 'e' : /\.PR(\.|$)/.test(s) ? 'p' : /\.WS$/.test(s) ? 'w' : /\.U$/.test(s) ? 'u' : /\.RT$/.test(s) ? 'r' : 's';
  const secEx = sec.get(s)?.exch;
  const exch = l ? l.exch : secEx === 'OTC' ? 'O' : secEx === 'Nasdaq' ? 'Q' : secEx === 'NYSE' ? 'N' : secEx === 'CBOE' ? 'Z' : '';
  add(s, kind, exch);
}
for (const s of Object.keys(INDEX_NAMES)) {
  if (stockSet.has(s)) continue; // a stock holds that symbol (DJT, COMP): the stock wins
  if (!indexSet.has(s) && !WEEKLY_ROOTS.includes(s)) continue;
  const e = add(s, 'i', 'C');
  e.name = INDEX_NAMES[s];
  e.src = 'house';
}
/* option roots the stock list lacks (OTC ADRs with listed options): kept when their options are live — not a class
   share's own root (BRKB is BRK.B's) */
const classRoots = new Set(stockList.filter(s => /^[A-Z]{1,4}\.[A-Z]$/.test(s)).map(rootOf));
for (const r of optionList) {
  if (entries.has(r) || classRoots.has(r) || !/^[A-Z]{1,6}$/.test(r) || !liveRoot(r)) continue;
  if (testSymbol(r)) continue;
  const secEx = sec.get(r)?.exch;
  add(r, vendor.get(r)?.type === 'ETF' ? 'e' : 's', secEx === 'OTC' ? 'O' : '').optOnly = true;
}

/* The terminal's stock list keeps every symbol it ever carried (KCG, HAPP): one no current listing knows is kept only
   when it traded in the last 30 days (/v3/stock/list/dates/trade). */
const tradeCachePath = join(CACHE, `last-trade-${today}.json`);
const lastTrade = existsSync(tradeCachePath) ? JSON.parse(readFileSync(tradeCachePath, 'utf8')) : {};
const recent = new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const unlisted = [...entries.values()].filter(e => e.kind !== 'i' && !listed.has(e.symbol) && !(optionSet.has(rootOf(e.symbol)) && liveRoot(rootOf(e.symbol)) && !derivative(e.symbol)));
const tradeTodo = unlisted.map(e => e.symbol).filter(s => !(s in lastTrade));
log('last-trade checks', { unlisted: unlisted.length, toAsk: tradeTodo.length });
let tdone = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (tradeTodo.length) {
      const s = tradeTodo.shift();
      const text = await getText(`${THETA}/stock/list/dates/trade?symbol=${encodeURIComponent(s)}&format=json`);
      const m = text ? [...text.matchAll(/"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/g)] : [];
      lastTrade[s] = m.length ? m[m.length - 1][1] : '';
      if (++tdone % 1000 === 0) {
        log('  checked', tdone);
        writeFileSync(tradeCachePath, JSON.stringify(lastTrade));
      }
    }
  }),
);
writeFileSync(tradeCachePath, JSON.stringify(lastTrade));
let retired = 0;
for (const e of unlisted) {
  if ((lastTrade[e.symbol] || '') >= recent) continue;
  entries.delete(e.symbol);
  retired += 1;
}
log('retired symbols left out', retired);

for (const e of entries.values()) {
  if (e.kind === 'i') e.options = optionSet.has(e.symbol) && liveRoot(e.symbol);
  else if (!derivative(e.symbol)) e.options = optionSet.has(rootOf(e.symbol)) && liveRoot(rootOf(e.symbol));
  if (e.name) continue;
  const l = listed.get(e.symbol);
  const h = house.get(e.symbol);
  const s = sec.get(e.symbol);
  if (h) [e.name, e.src] = [h, 'house'];
  else if (l && cleanName(l.name, l.etf)) [e.name, e.src] = [cleanName(l.name, l.etf), 'nasdaqtrader'];
  else if (s?.name) [e.name, e.src] = [s.name, 'sec'];
  else if (oldJson.get(e.symbol)) [e.name, e.src] = [cleanName(oldJson.get(e.symbol), false), 'bundled'];
  else if (previous.names.get(e.symbol)) [e.name, e.src] = [previous.names.get(e.symbol), 'previous'];
  /* Nasdaq's five-letter units, warrants and rights (AACIU, AACIW) carry no dot: their names say what they are */
  if (e.kind === 's' && !e.options) {
    if (/\bWarrants?$/i.test(e.name)) e.kind = 'w';
    else if (/\bUnits?$/i.test(e.name)) e.kind = 'u';
    else if (/\bRights?$/i.test(e.name)) e.kind = 'r';
  }
}

/* the vendor's stock info for optionable names still unnamed */
const dropUnnamedRoots = () => {
  for (const e of [...entries.values()]) if (e.optOnly && !e.name) entries.delete(e.symbol);
};
if (UW_KEY) {
  const ask = [...entries.values()].filter(e => !e.name && e.options).slice(0, 400);
  log('vendor name asks', ask.length);
  const q = [...ask];
  await Promise.all(
    Array.from({ length: 2 }, async () => {
      while (q.length) {
        const e = q.shift();
        const text = await getText(`https://api.unusualwhales.com/api/stock/${encodeURIComponent(e.symbol)}/info`, { Authorization: `Bearer ${UW_KEY}`, Accept: 'application/json' });
        try {
          const n = JSON.parse(text || '{}').data?.full_name;
          if (n) [e.name, e.src] = [caseSec(String(n)), 'vendor'];
        } catch {
          /* none */
        }
      }
    }),
  );
}

/* an option root no source can name (a currency or sector index root, an old symbol) is not a name anyone searches */
dropUnnamedRoots();

/* order: the vendor's volume rank, then the previous order, then common stock and funds before the rest, A to Z */
const prevRank = new Map(previous.order.map((s, i) => [s, i]));
const kindRank = { i: 0, s: 1, e: 1, p: 3, u: 3, w: 4, r: 4 };
const list = [...entries.values()].sort((a, b) => {
  const va = vendor.get(a.symbol)?.vol ?? -1;
  const vb = vendor.get(b.symbol)?.vol ?? -1;
  if (va !== vb) return vb - va;
  const pa = prevRank.get(a.symbol) ?? Infinity;
  const pb = prevRank.get(b.symbol) ?? Infinity;
  if (pa !== pb) return pa - pb;
  if (a.options !== b.options) return a.options ? -1 : 1;
  return (kindRank[a.kind] ?? 2) - (kindRank[b.kind] ?? 2) || a.symbol.localeCompare(b.symbol);
});

const clip = s => s.replace(/[\t\n`\\]/g, ' ').replace(/\$\{/g, '$ {').slice(0, 90).trim();
const lines = list.map(e => `${e.symbol}\t${clip(e.name)}\t${e.kind}${e.options ? 'o' : ''}${e.exch}`);
const named = list.filter(e => e.name).length;
const by = k => list.filter(e => e.kind === k).length;
const stats = {
  total: list.length,
  stocks: by('s'),
  etfs: by('e'),
  indexes: by('i'),
  preferred: by('p'),
  warrants: by('w'),
  units: by('u'),
  rights: by('r'),
  withOptions: list.filter(e => e.options).length,
  retired,
  named,
  namedPct: Math.round((named / list.length) * 1000) / 10,
  namedCommonPct: Math.round((list.filter(e => e.name && 'sei'.includes(e.kind)).length / list.filter(e => 'sei'.includes(e.kind)).length) * 1000) / 10,
  namedOptionsPct: Math.round((list.filter(e => e.name && e.options).length / list.filter(e => e.options).length) * 1000) / 10,
  sources: Object.fromEntries(['house', 'nasdaqtrader', 'sec', 'bundled', 'previous', 'vendor'].map(k => [k, list.filter(e => e.src === k).length])),
};
log('stats', stats);

const body = `/* GENERATED by scripts/build-symbol-directory.mjs on ${today} — do not edit by hand; run the script to refresh.
   Every symbol the data keys serve: the terminal's stock, option-root and index lists. Names from the house tables,
   the Nasdaq Trader symbol directory (nasdaqlisted.txt, otherlisted.txt, ${today}), the SEC's
   company_tickers_exchange.json (${today}) and, for a few optionable names, the vendor's stock info.
   One line a symbol, most traded options first: SYMBOL \\t NAME \\t FLAGS. FLAGS: the kind (s stock, e ETF, i index,
   p preferred, w warrant, u unit, r right), "o" when options are listed today, then the exchange (Q Nasdaq, N NYSE,
   A NYSE American, P NYSE Arca, Z Cboe BZX, V IEX, O OTC, C Cboe index).
   ${JSON.stringify(stats)} */

export const BUILT_ON = '${today}';
export const DIRECTORY = String.raw\`${lines.join('\n')}\`;
`;
writeFileSync(OUT, body);
log('wrote', OUT, `${Math.round(body.length / 1024)} KB`);
