/*
  PINPOINT LIVE CHECK (audit 2026-11-06, items 5 and 9). Loads Pinpoint's own book for real names from the live
  Unusual Whales feed — the app's loader (data/uwBook.ts) exactly as the browser runs it — and checks every headline
  number against an independent recomputation written in this file from the same raw answers (no app code in the
  arithmetic; the holiday table is the NYSE's published one, shared/marketCalendar.mjs):

    1. the clock       trading-year fraction to each date's close, 0DTE included (minutes left ÷ 390 ÷ 252), and an
                       index's AM monthly to 09:30 of its date
    2. GEX hand sums   net GEX, call wall, put wall per scope = Σ call_gamma_oi + put_gamma_oi over the scope's live
                       dates (spot-exposures/expiry-strike, every page), less settled AM contracts on their date
    3. the flip        every leg of every expiry re-priced sticky-strike across ±10% of spot at its OWN contract's vol
                       (option-contracts for every date, read here — the page re-prices small dates at the ATM vol),
                       each root on its own clock; the crossing nearest spot against the page's flip, within 0.05% of
                       spot; and the page's flip is never final while a date is still loading
    4. the expected move  in the session: the page's straddle into the front date against the live at-the-money
                       call + put mid, within 7%, and 1σ = straddle ÷ √(2/π)

  RUN IT DURING REGULAR HOURS (09:30–16:00 ET, a trading day) for the 0DTE and straddle checks; outside them the
  clock, the hand sums and the flip still run on the last close's rows and the live checks say they were skipped:

    cd slayer
    npx tsx --env-file=/path/to/keys.env scripts/pinpoint-live-check.ts SPY SPX
    # the file holds UNUSUAL_WHALES_API_KEY=… (or export it first); the key is never on the command line or printed
    # or through a running local proxy instead of the key:  PINPOINT_UW_BASE=http://127.0.0.1:8080/api/uw npx tsx …

  It reads the vendor one request at a time (the key's 3 slots are shared). SPX's whole chain is ~60 reads of
  option-contracts and ~40 of spot-exposures: a few minutes. Exit code 0 when every check passes, 1 otherwise.
  Nothing is written to disk (PINPOINT_CACHE_DIR=dir keeps the answers there, to run a check again on the same ones;
  with PINPOINT_CACHE_MODE=record the run itself reads live and keeps each path's first answer and its start instant, and a
  later run on that directory replays them with the clock pinned there).
  The GEX hand sums take the very rows each of the page's chains was laid from (by each strike's own pricing stamp, out
  of every answer the run saw), and the flip's own-vol re-pricing takes the page's own contract answers where it read
  them — the same snapshot, never a later read (audit 2026-11-06, finding 3). It prints the quote coverage: of the legs
  with a valid two-sided quote, the share the page prices at that quote's own vol (finding 2). ThetaData is not asked (Pinpoint's greeks are Unusual Whales'): the price comes from the
  vendor's own bars, as it does when the terminal is down.
*/
import * as fs from 'node:fs';
import { EARLY_CLOSE_DATES, HOLIDAY_DATES } from '../shared/marketCalendar.mjs';
import { phiCdf } from './golden/pinpointRaw';

const NAMES = process.argv.slice(2).map(s => s.toUpperCase()).filter(Boolean);
if (!NAMES.length) NAMES.push('SPY', 'SPX');
const KEY = process.env.UNUSUAL_WHALES_API_KEY;
const VIA = process.env.PINPOINT_UW_BASE;
if (!KEY && !VIA) {
  console.error('pinpoint-live-check: set UNUSUAL_WHALES_API_KEY (or PINPOINT_UW_BASE for a running proxy)');
  process.exit(2);
}

let fail = 0;
let skipped = 0;
const check = (what: string, ok: boolean) => {
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
};
const skip = (what: string) => {
  skipped++;
  console.log(`skip ${what}`);
};

/* ---- the feed: /api/uw/* to the vendor, one at a time, every answer kept for the hand checks ---- */
type Row = Record<string, string | number | null>;
const raw = new Map<string, unknown>();
const realFetch = globalThis.fetch;
let chain = Promise.resolve();
let inFlight = 0;
async function vendor(path: string): Promise<{ status: number; body: string }> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = VIA ? await realFetch(`${VIA}${path}`, { headers: { Accept: 'application/json' } }) : await realFetch(`https://api.unusualwhales.com/api${path}`, { headers: { Authorization: `Bearer ${KEY}`, Accept: 'application/json' } });
    if (res.status === 429 || res.status >= 500) {
      const after = Number(res.headers.get('retry-after'));
      await new Promise(r => setTimeout(r, Number.isFinite(after) && after > 0 ? after * 1000 : 1500 * (attempt + 1)));
      continue;
    }
    return { status: res.status, body: await res.text() };
  }
  return { status: 503, body: JSON.stringify({ error: 'vendor busy' }) };
}
/* Every spot-exposures/expiry-strike row any answer carried, by (expiry, strike, the minute the vendor priced it): the page
   re-reads the rows every minute and lays each date's onto its chain when its walk lands, so the LAST answer of a path is
   not the row a chain was laid from (SPY 09:40: the hand sums −0.0009B off). The hand sums take, for every strike of every
   date the page holds, the row whose own stamp is the one the page's node carries (gexAt) — the same rows, the same
   snapshot — and add them up here. */
const rowsSeen = new Map<string, Row>();
const rowKey = (expiry: string, strike: number, at: number) => `${expiry}|${strike}|${at}`;
/* when each date's rows (their pricing minute and price) reached the page, and when each date's contracts did: a quote is
   solved here at the price and minute of the rows the page held when that quote arrived — the clock the page solved it on
   (book/scale.ts paintLegs pricedClockOf) — not at rows read minutes later (the 11:23 run: SPY's front date solved at a
   price a few minutes on, and only 15% of the quoted gamma matched the page's vols) */
const rowsArrived = new Map<string, { at: number; px: number; arrived: number }[]>();
const contractsArrived = new Map<string, number>();
function keepRows(data: unknown): void {
  if (!Array.isArray(data)) return;
  const arrived = Date.now();
  const seen = new Set<string>();
  for (const r of data as Row[]) {
    const at = Date.parse(String(r.time ?? ''));
    const k = parseFloat(String(r.strike ?? ''));
    if (!Number.isFinite(at) || !(k > 0)) continue;
    rowsSeen.set(rowKey(String(r.expiry), k, at), r);
    const name = String(r.ticker ?? '').toUpperCase();
    const tag = `${name}|${r.expiry}|${at}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    const list = rowsArrived.get(`${name}|${r.expiry}`) ?? [];
    list.push({ at, px: parseFloat(String(r.price ?? '')) || 0, arrived });
    rowsArrived.set(`${name}|${r.expiry}`, list);
  }
}
/** The stamp of the newest row on the page's chain for a date when its contracts landed */
const quoteStamp = new Map<string, number>();
/** The rows' minute and price a date's quotes are solved at: the newest row the page held when its contracts arrived (its
    stamp read off the page's chain as they landed, its price off the vendor's own row of that minute); else the newest
    row that had arrived by then */
function quoteClock(ticker: string, date: string): { at: number; px: number } | null {
  const expiry = `${ticker.toUpperCase()}|${date}`;
  const q = contractsArrived.get(expiry);
  const list = rowsArrived.get(expiry);
  if (q == null || !list?.length) return null;
  const stamp = quoteStamp.get(expiry);
  const exact = stamp != null ? list.find(v => v.at === stamp) : undefined;
  if (exact && exact.px > 0) return { at: exact.at, px: exact.px };
  let best: { at: number; px: number; arrived: number } | null = null;
  for (const v of list) if (v.arrived <= q && (!best || v.at > best.at)) best = v;
  return best && best.px > 0 ? { at: best.at, px: best.px } : null;
}
/* PINPOINT_CACHE_DIR (optional, for re-running a check on the same answers): each answer kept under that directory */
const CACHE = process.env.PINPOINT_CACHE_DIR;
/* PINPOINT_CACHE_MODE=record: every answer is read live (the page's minute re-reads included) and each path's first answer
   is kept, with the instant the run started (clock.txt); a later run on the same directory without it replays those
   answers at that instant (the clock pinned there and running on), asking the vendor nothing it already holds */
const RECORD = process.env.PINPOINT_CACHE_MODE === 'record';
if (CACHE) {
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const clockFile = `${CACHE}/clock.txt`;
  if (RECORD) {
    mkdirSync(CACHE, { recursive: true });
    if (!existsSync(clockFile)) writeFileSync(clockFile, new Date().toISOString());
  } else if (existsSync(clockFile)) {
    const { freezeClock } = await import('./golden/uwFixtures');
    freezeClock(readFileSync(clockFile, 'utf8').trim());
  }
}
async function cached(path: string): Promise<{ status: number; body: string }> {
  if (!CACHE) return vendor(path);
  const { createHash } = await import('node:crypto');
  const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs');
  const file = `${CACHE}/${createHash('sha1').update(path).digest('hex')}.json`;
  if (RECORD) {
    const got = await vendor(path);
    if (got.status === 200 && !existsSync(file)) {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(file, JSON.stringify({ ...got, path }));
    }
    return got;
  }
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as { status: number; body: string };
  const got = await vendor(path);
  if (got.status === 200) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(got));
  }
  return got;
}
/** A replay's recorded answers by path (those recorded with their path), read once; empty outside a replay */
let recorded: Map<string, unknown> | null = null;
function recordedAnswers(): Map<string, unknown> {
  if (recorded) return recorded;
  recorded = new Map();
  if (!CACHE || RECORD) return recorded;
  if (!fs.existsSync(CACHE)) return recorded;
  for (const f of fs.readdirSync(CACHE)) {
    if (!f.endsWith('.json')) continue;
    try {
      const saved = JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')) as { status: number; body: string; path?: string };
      if (saved.path && saved.status === 200 && /\/option-contracts\?/.test(saved.path)) recorded.set(saved.path, dataOf(saved.body));
    } catch {
      /* not an answer */
    }
  }
  return recorded;
}
function queued(path: string): Promise<{ status: number; body: string }> {
  const run = chain.then(() => cached(path));
  chain = run.then(() => undefined, () => undefined);
  return run;
}
const dataOf = (body: string): unknown => {
  try {
    const j = JSON.parse(body) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) && 'data' in j ? (j as { data: unknown }).data : j;
  } catch {
    return null;
  }
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^\/api\/(theta|oi-change)\//.test(url)) return new Response(JSON.stringify({ error: 'The terminal is not running.', code: 'terminal_down' }), { status: 503, headers: { 'content-type': 'application/json' } });
  const m = /^\/api\/uw(\/.*)$/.exec(url);
  if (!m) return realFetch(input, init);
  inFlight++;
  try {
    const got = await queued(m[1]);
    if (got.status === 200) {
      const data = dataOf(got.body);
      raw.set(m[1], data);
      if (/\/spot-exposures\/expiry-strike\?/.test(m[1])) keepRows(data);
      const cx = /^\/stock\/([^/]+)\/option-contracts\?.*expiry=(\d{4}-\d{2}-\d{2})/.exec(m[1]);
      if (cx) {
        const key = `${decodeURIComponent(cx[1]).toUpperCase()}|${cx[2]}`;
        contractsArrived.set(key, Date.now());
        /* the pricing stamp of the chain the page held for the date as its quotes landed (the newest row's minute) */
        try {
          const chain = book.peekEntry(decodeURIComponent(cx[1]))?.byDate[cx[2]] ?? [];
          let at = 0;
          for (const nn of chain) if (nn.gexAt != null && nn.gexAt >= at) at = nn.gexAt;
          if (at > 0) quoteStamp.set(key, at);
        } catch {
          /* the app not loaded yet */
        }
      }
    }
    return new Response(got.body, { status: got.status, headers: { 'content-type': 'application/json' } });
  } finally {
    inFlight--;
  }
}) as typeof fetch;
/** A read of the checker's own (not the page's) */
async function own(path: string): Promise<unknown> {
  const got = await queued(path);
  return got.status === 200 ? dataOf(got.body) : null;
}

/* the browser bits the loader touches */
const mem = new Map<string, string>();
const g = globalThis as Record<string, unknown>;
g.window = globalThis;
g.location = { search: '', pathname: '/pinpoint/map', href: 'http://127.0.0.1/pinpoint/map', hostname: '127.0.0.1', origin: 'http://127.0.0.1' };
g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, String(v)), removeItem: (k: string) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };

/* ---- an independent clock: New York wall time by Intl, the NYSE's holidays ---- */
const HOL = new Set<string>(HOLIDAY_DATES as string[]);
const EARLY = new Set<string>(EARLY_CLOSE_DATES as string[]);
const nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function ny(ms: number): { iso: string; min: number } {
  const p = Object.fromEntries(nyFmt.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  /* to the millisecond: Intl names whole seconds, and the page's clock is continuous (core/tradingYear.ts) — at 11:23:50.897
     the dropped 0.897 s read as 1e-4 of the front date's fraction */
  return { iso: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60 + (ms - Math.floor(ms / 1000) * 1000) / 60_000 };
}
const isSession = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d !== 0 && d !== 6 && !HOL.has(iso);
};
const closeOf = (iso: string) => (EARLY.has(iso) ? 13 * 60 : 16 * 60);
const OPEN = 9 * 60 + 30;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Trading minutes from `ms` to `endMin` (NY minutes) on date `end`, 0 when past */
function tradeMin(ms: number, end: string, endMin: number): number {
  const now = ny(ms);
  let total = 0;
  for (let d = now.iso; d <= end; d = addDays(d, 1)) {
    if (!isSession(d)) continue;
    const to = d === end ? Math.min(endMin, closeOf(d)) : closeOf(d);
    const from = d === now.iso ? Math.max(OPEN, now.min) : OPEN;
    if (to > from) total += to - from;
  }
  return total;
}
const YEAR_MIN = 390 * 252;
/** Years on the 252-session clock to a PM contract's close (16:00 / 13:00 on its date), five minutes at the least */
const tPm = (ms: number, exp: string) => Math.max(5, tradeMin(ms, exp, closeOf(exp))) / YEAR_MIN;
/** …and an AM contract's: to 09:30 of its date (on the trading clock the previous session's close); null once past */
const tAm = (ms: number, exp: string) => (ms >= amAt(exp) ? null : Math.max(5, tradeMin(ms, exp, OPEN)) / YEAR_MIN);
function amAt(exp: string): number {
  /* 09:30 New York on the date, by search (DST-safe without a table) */
  let t = Date.parse(`${exp}T13:30:00Z`);
  for (let i = 0; i < 3 && ny(t).min !== OPEN; i++) t += (OPEN - ny(t).min) * 60_000;
  return t;
}
/** Calendar years to a contract's settlement */
function tCal(ms: number, exp: string, am: boolean): number {
  const end = am ? amAt(exp) : (() => {
    let t = Date.parse(`${exp}T21:00:00Z`);
    for (let i = 0; i < 3 && Math.abs(ny(t).min - closeOf(exp)) > 0.01; i++) t += (closeOf(exp) - ny(t).min) * 60_000;
    return t;
  })();
  return Math.max(5 * 60_000, end - ms) / (365 * 86_400_000);
}

/* ---- independent Black-Scholes, with a continuous yield. The rate and the name's yield are INPUTS, set per name to the
   page's own (core/carry.ts carryFor: the rate it holds and the yield it read) so the two price the same carry ---- */
let R = 0.042;
let Q = 0;
const n = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')) || 0);
function bs(right: string, S: number, K: number, t: number, v: number): number {
  const d1 = (Math.log(S / K) + (R - Q + v * v / 2) * t) / (v * Math.sqrt(t));
  const d2 = d1 - v * Math.sqrt(t);
  const F = S * Math.exp(-Q * t);
  return right === 'C' ? F * phiCdf(d1) - K * Math.exp(-R * t) * phiCdf(d2) : K * Math.exp(-R * t) * phiCdf(-d2) - F * phiCdf(-d1);
}
function solve(mid: number, right: string, S: number, K: number, t: number): number | null {
  let lo = 1e-3;
  let hi = 5;
  if (!(mid > bs(right, S, K, t, lo)) || !(mid < bs(right, S, K, t, hi))) return null;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    if (bs(right, S, K, t, m) < mid) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}
const gamma$ = (S: number, K: number, t: number, v: number) => {
  const d1 = (Math.log(S / K) + (R - Q + v * v / 2) * t) / (v * Math.sqrt(t));
  return Math.exp(-Q * t) * (Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) / (S * v * Math.sqrt(t))) * S * S * 0.01 * 100;
};
const AM_ROOTS: Record<string, string[]> = { SPX: ['SPX'], NDX: ['NDX'], RUT: ['RUT'], VIX: ['VIX', 'VIXW'], DJX: ['DJX'] };
const PM_ROOTS: Record<string, string[]> = { SPX: ['SPXW'], NDX: ['NDXP'], RUT: ['RUTW'] };
const tail = (sym: string) => {
  const t = sym.slice(-15);
  return { root: sym.slice(0, -15), exp: `20${t.slice(0, 2)}-${t.slice(2, 4)}-${t.slice(4, 6)}`, right: t[6], k: Number(t.slice(7)) / 1000 };
};

/* ---- the app ---- */
const book = await import('../src/data/uwBook');
const { openFeeds } = await import('../src/data/feedGate');
openFeeds();
const { levelsFor } = await import('../src/data/levelsFor');
const { tradingYears } = await import('../src/core/tradingYear');
const { amTradingYears } = await import('../src/core/settle');
const { nySessionPhase } = await import('../src/core/nyTime');
const { BOOK_LISTINGS, emptyDates } = await import('../src/data/book/store');

const live = nySessionPhase(Date.now()) === 'open' && isSession(ny(Date.now()).iso);
console.log(`pinpoint live check ${new Date().toISOString()} (New York ${ny(Date.now()).iso} ${Math.floor(ny(Date.now()).min / 60)}:${String(Math.floor(ny(Date.now()).min % 60)).padStart(2, '0')}) — ${live ? 'IN the regular session' : 'outside the regular session: the live checks are skipped'}`);

async function until(ok: () => boolean, what: string, ms = 900_000): Promise<boolean> {
  const t0 = Date.now();
  let quiet = 0;
  let last = raw.size;
  while (Date.now() - t0 < ms) {
    await new Promise(r => setTimeout(r, 1000));
    if (raw.size !== last || inFlight > 0) {
      last = raw.size;
      quiet = 0;
      continue;
    }
    if (ok() && ++quiet >= 8) return true;
  }
  console.log(`     ${what}: did not settle in ${ms / 1000} s`);
  return false;
}

for (const t of NAMES) {
  console.log(`\n── ${t}`);
  book.ensureBook(t, 'full');
  /* a scope whose dates are still loading must never print a final flip (no early stop) */
  let sawProvisional = false;
  let earlyFinal: string | null = null;
  const watch = setInterval(() => {
    const lvA = levelsFor(t, 'ALL');
    const e = book.peekEntry(t);
    if (!lvA || !e || e.status !== 'live') return;
    const floor = ny(Date.now()).min >= closeOf(ny(Date.now()).iso) ? addDays(ny(Date.now()).iso, 1) : ny(Date.now()).iso;
    /* the listings the book reads date by date (store.ts BOOK_LISTINGS); past those, the whole book's rows stand in */
    const listed = e.expiries.slice(0, BOOK_LISTINGS).map(x => x.date).filter(d => d >= floor);
    const missing = listed.filter(d => !e.byDate[d]?.length && !emptyDates.get(t)?.has(d));
    if (missing.length) {
      if (lvA.complete) earlyFinal = `${missing.length} of ${listed.length} dates not in (${missing.slice(0, 3).join(', ')})`;
      else sawProvisional = true;
    }
  }, 250);
  const settled = await until(() => {
    const e = book.peekEntry(t);
    return !!e && e.status === 'live' && !!e.everFull && !!levelsFor(t, 'ALL')?.complete && !!levelsFor(t, '0DTE')?.complete;
  }, `${t} book`);
  clearInterval(watch);
  if (!settled) {
    check(`${t}: the book came in and both scopes went final`, false);
    continue;
  }
  check(`${t}: no scope printed a final flip while a date was loading${earlyFinal ? ` — it did: ${earlyFinal}` : ''} (provisional seen: ${sawProvisional})`, earlyFinal == null);
  const e = book.peekEntry(t)!;
  {
    const { carryFor } = await import('../src/core/carry');
    const c = carryFor(t);
    R = c.r;
    Q = c.q;
    console.log(`     carry: r ${(R * 100).toFixed(2)}%, the name's yield ${(Q * 100).toFixed(2)}% (the page's, used on both sides)`);
  }
  const lv0 = levelsFor(t, '0DTE')!;
  const lvA = levelsFor(t, 'ALL')!;
  const spot = book.snapshotFor(t, '0DTE', 'full')!.spot;
  const now = Date.now();

  /* 1. the clock */
  const front = lv0.date ?? '';
  const mine = tPm(now, front);
  const page = tradingYears(front, now);
  check(`${t}: the front date ${front}'s trading-year fraction ${page.toExponential(4)} = ${(mine * YEAR_MIN).toFixed(1)} minutes ÷ 390 ÷ 252 (${mine.toExponential(4)})`, Math.abs(page / mine - 1) < 1e-9);
  if (AM_ROOTS[t]) {
    const monthly = e.expiries.map(x => x.date).find(d => {
      const day = new Date(`${d}T12:00:00Z`);
      return day.getUTCDay() === 5 && day.getUTCDate() >= 15 && day.getUTCDate() <= 21;
    });
    if (monthly) {
      const a = tAm(now, monthly);
      const p = amTradingYears(monthly, now);
      check(`${t}: the ${monthly} AM monthly runs to 09:30 of its date — ${p == null ? 'settled' : `${(p * YEAR_MIN).toFixed(1)} min`} (by hand ${a == null ? 'settled' : `${(a * YEAR_MIN).toFixed(1)} min`}), one session short of the weeklies' ${(tPm(now, monthly) * YEAR_MIN).toFixed(0)}`, (a == null && p == null) || (a != null && p != null && Math.abs(p / a - 1) < 1e-9));
    }
  }

  /* 2. GEX hand sums off the raw rows — THE rows the page's chains were laid from (rowsSeen, by each node's own stamp) */
  const floor = e.expiries.map(x => x.date).filter(d => d >= front).sort()[0] ?? front;
  const snapRows = book.snapshotFor(t, 'ALL', 'full')!;
  const rows: Row[] = [];
  let rowsMissing = 0;
  let rowsUsed = 0;
  const pageDates = Object.keys(snapRows.uwByDate ?? {}).filter(d => d >= floor && snapRows.uwByDate![d]?.length);
  for (const d of pageDates)
    for (const node of snapRows.uwByDate![d]) {
      if (node.gexAt == null) continue;
      const r = rowsSeen.get(rowKey(d, node.strike, node.gexAt));
      if (r) {
        rows.push(r);
        rowsUsed++;
      } else rowsMissing++;
    }
  /* a listing the page holds no chain for (past BOOK_LISTINGS) is the newest answer's rows, as the whole book carries it */
  {
    const held = new Set(pageDates);
    const latest = new Map<string, Row>();
    for (const [p, d] of raw) if (p.startsWith(`/stock/${t}/spot-exposures/expiry-strike?limit=500&page=`) && Array.isArray(d)) for (const r of d as Row[]) if (!held.has(String(r.expiry))) latest.set(`${r.expiry}|${r.strike}`, r);
    rows.push(...latest.values());
  }
  check(`${t}: the hand sums read the very rows the page's chains were laid from (${rowsUsed} rows over ${pageDates.length} dates, by each strike's own pricing stamp; ${rowsMissing} not among the answers read)`, rowsMissing === 0 && rowsUsed > 0);
  /* the contracts of every live date: the page's own answers where it read the date (the same quotes it solved), else read
     here */
  const contracts = new Map<string, Row[]>();
  let reused = 0;
  for (const x of e.expiries.map(y => y.date).filter(d => d >= floor)) {
    const bySym = new Map<string, Row>();
    const mine = (p: string) => p.startsWith(`/stock/${t}/option-contracts?limit=500&expiry=${x}&`);
    /* a date of 500 contracts or more the page reads call and put apart (data/whales.ts optionContractsWalk) and its first
       unsplit page is not what it solved: two answers a second apart quote SPX 2026-11-09 7725P 292.5/311.9 and
       297.9/303.2, and in the money a session out that is 0.17 against 0.25 of vol */
    const answers = [...recordedAnswers(), ...raw].filter(([p, d]) => mine(p) && Array.isArray(d));
    const split = answers.some(([p]) => /&option_type=/.test(p));
    for (const [p, d] of answers) if (!split || /&option_type=/.test(p)) for (const r of d as Row[]) bySym.set(String(r.option_symbol), r);
    if (bySym.size) {
      reused++;
      contracts.set(x, [...bySym.values()]);
      continue;
    }
    const list: Row[] = [];
    for (let page = 0; page < 40; page++) {
      const got = (await own(`/stock/${t}/option-contracts?limit=500&expiry=${x}&page=${page}`)) as Row[] | null;
      if (!Array.isArray(got)) break;
      list.push(...got);
      if (got.length < 500) break;
    }
    contracts.set(x, list);
  }
  console.log(`     contracts: ${reused} of ${contracts.size} dates are the page's own answers (the quotes it solved); the rest read here`);
  /* settled AM contracts' share of each row (an index's monthly from 09:30 of its date), from the contracts' own gamma × OI */
  const amCut = new Map<string, number>();
  for (const [x, list] of contracts) {
    if (now < amAt(x) || !AM_ROOTS[t]) continue;
    const by = new Map<string, { am: number; all: number }>();
    for (const r of list) {
      const c = tail(String(r.option_symbol));
      const key = `${x}|${c.k}|${c.right}`;
      const cur = by.get(key) ?? { am: 0, all: 0 };
      const gOi = n(r.gamma) * n(r.open_interest);
      if (AM_ROOTS[t].includes(c.root)) cur.am += gOi;
      cur.all += gOi;
      by.set(key, cur);
    }
    for (const [key, v] of by) if (v.all > 0 && v.am > 0) amCut.set(key, v.am / v.all);
  }
  const handOf = (dates: Set<string>) => {
    const m = new Map<number, { c: number; p: number }>();
    for (const r of rows) {
      const x = String(r.expiry);
      if (!dates.has(x)) continue;
      const k = n(r.strike);
      const cur = m.get(k) ?? { c: 0, p: 0 };
      cur.c += n(r.call_gamma_oi) * (1 - (amCut.get(`${x}|${k}|C`) ?? 0));
      cur.p += n(r.put_gamma_oi) * (1 - (amCut.get(`${x}|${k}|P`) ?? 0));
      m.set(k, cur);
    }
    let net = 0;
    let cw = [0, 0];
    let pw = [0, 0];
    for (const [k, v] of m) {
      net += v.c + v.p;
      if (Math.abs(v.c) > cw[1]) cw = [k, Math.abs(v.c)];
      if (Math.abs(v.p) > pw[1]) pw = [k, Math.abs(v.p)];
    }
    return { net, callWall: cw[0], putWall: pw[0] };
  };
  const liveDates = new Set(rows.map(r => String(r.expiry)).filter(d => d >= floor));
  for (const [name, lv, dates] of [['Today', lv0, new Set([front])], ['All', lvA, liveDates]] as const) {
    const h = handOf(dates as Set<string>);
    check(`${t} ${name}: net GEX ${(lv.netGex / 1e9).toFixed(4)}B = Σ the rows' call + put gamma ${(h.net / 1e9).toFixed(4)}B (${(dates as Set<string>).size} dates)`, Math.abs(lv.netGex - h.net) <= 1e-6 * Math.max(1, Math.abs(h.net)) + 1);
    check(`${t} ${name}: walls ${lv.callWall} / ${lv.putWall} = the rows' ${h.callWall} / ${h.putWall}`, lv.callWall === h.callWall && lv.putWall === h.putWall);
  }

  /* 3. the flip, every leg at its own contract's vol, each root on its own clock */
  const vols = new Map<string, number>();
  /* THE PRICE A SHORT-DATED INDEX CHAIN IS SOLVED AT. A cash index's rows carry its print at the row's minute; for a
     chain under seven calendar days the page solves the quotes at their own parity spot S* = F·e^(−rT) (core/parity.ts
     impliedBookSpot), and marks it on the chain's nodes (bookPx). That price is an input here, like the carry: the vols
     are solved at it here, independently. Solved at the print instead, the SPX 0DTE ran 8% under the vols its quotes give
     (the 11:23 run), and a deep in-the-money leg — a vol that hangs on a cent — swung the whole book's flip 0.1%. */
  const bookPxOf = (x: string): number | null => {
    const nodes = snapRows.uwByDate?.[x] ?? [];
    for (const nn of nodes) if (nn.bookPx != null && nn.bookPx > 0) return nn.bookPx;
    return null;
  };
  /** Each PM contract's quote-solved vol, its quote, clock and the price it was solved at (the in-the-money rule below) */
  const quotedPm = new Map<string, { v: number; bid: number; ask: number; tt: number; px: number }>();
  const ois = new Map<string, { am: number; pm: number; amIv: number; pmIv: number; amQ: boolean; pmQ: boolean }>();
  for (const [x, list] of contracts) {
    for (const r of list) {
      const c = tail(String(r.option_symbol));
      const am = !!AM_ROOTS[t]?.includes(c.root);
      const pm = !am && (c.root === t || !!PM_ROOTS[t]?.includes(c.root));
      if (!am && !pm) continue;
      /* the clock the quote (and the vendor's vol) stood at: the minute the vendor priced the date's rows */
      const qc = quoteClock(t, x);
      const rowAt = qc?.at ?? (Date.parse(String(rows.find(rr => String(rr.expiry) === x)?.time ?? '')) || now);
      const tt = am ? tAm(rowAt, x) : tPm(rowAt, x);
      if (tt == null) continue;
      const bid = n(r.nbbo_bid);
      const ask = n(r.nbbo_ask);
      const mid = (bid + ask) / 2;
      const px0 = qc?.px ?? (n(rows.find(rr => String(rr.expiry) === x)?.price) || spot);
      /* an index's chain under seven calendar days is solved at its own parity spot (the quotes' own price) */
      const px = am ? px0 : bookPxOf(x) ?? px0;
      const solved = ask > 0 && bid > 0 && (ask - bid) / mid <= 0.4 ? solve(mid, c.right, px, c.k, tt) : null;
      /* the quote pins a vol: a cent of time value at least (a deep in-the-money leg's vol hangs on fractions of a cent) */
      const pins = solved != null && mid - Math.max(0, c.right === 'C' ? px - c.k : c.k - px) >= 0.01;
      if (solved != null && !am && bid > 0) quotedPm.set(`${x}|${c.k}|${c.right}`, { v: solved, bid, ask, tt, px });
      const vend = n(r.implied_volatility);
      const iv = solved ?? (vend > 0 && vend < 10 ? vend * Math.sqrt(tCal(rowAt, x, am) / tt) : 0);
      const key = `${x}|${c.k}|${c.right}`;
      const cur = ois.get(key) ?? { am: 0, pm: 0, amIv: 0, pmIv: 0, amQ: false, pmQ: false };
      if (am) {
        cur.am += n(r.open_interest);
        if (iv > 0) cur.amIv = iv;
        if (pins) cur.amQ = true;
      } else {
        cur.pm += n(r.open_interest);
        if (iv > 0) cur.pmIv = iv;
        if (pins) cur.pmQ = true;
      }
      ois.set(key, cur);
      if (iv > 0 && !am) vols.set(key, iv);
    }
  }
  /* AN IN-THE-MONEY QUOTE THAT PINS NO VOL. Deep in the money a mid is intrinsic plus cents inside a spread dollars wide
     (SPX 2026-11-09 7725P, 4% in the money a session out: 297.9 / 303.2 around an intrinsic of 300.47), so any vol from a
     few points to 0.3 prices inside it — and walked to the flip that leg is at the money (it alone moved SPX's whole-book
     re-price 0.1% of spot, on the page 0.254, solved here 0.171, off one mid). Where both legs of a strike are solved from
     their quotes and the in-the-money one's half spread spans more than two vol points (÷ its vega at the other leg's
     vol), it takes the out-of-the-money leg's vol: parity gives a strike's call and put one vol (exactly so on a European
     index). The page's rule (book/scale.ts paintLegs), written here again. */
  for (const [key, qd] of quotedPm) {
    const [x, ks, right] = key.split('|');
    const k = Number(ks);
    const itm = right === 'C' ? k < qd.px : k > qd.px;
    const other = quotedPm.get(`${x}|${ks}|${right === 'C' ? 'P' : 'C'}`);
    if (!itm || !other) continue;
    const d1 = (Math.log(qd.px / k) + (R - Q + (other.v * other.v) / 2) * qd.tt) / (other.v * Math.sqrt(qd.tt));
    const vega = (qd.px * Math.exp(-Q * qd.tt) * Math.exp(-(d1 * d1) / 2) * Math.sqrt(qd.tt)) / Math.sqrt(2 * Math.PI);
    if (vega > 0 && (qd.ask - qd.bid) / 2 / vega <= 0.02) continue;
    const o = ois.get(key);
    if (o) o.pmIv = other.v;
    vols.set(key, other.v);
  }
  /* q: the leg's contract has a valid two-sided quote (bid and ask, spread within 40% of the mid) that pins a vol (a cent of
     time value), and its vol here is solved from it */
  type Leg = { x: string; k: number; g0: number; iv: number; pageIv: number; t: number; s0: number; oi: number; side: 1 | -1; q?: boolean };
  const legs: Leg[] = [];
  /* the page's own vol per leg (its node's, solved and smoothed by the page) — the second re-pricing below takes these,
     so the arithmetic across every expiry is checked apart from the choice of vol */
  const snapAll = book.snapshotFor(t, 'ALL', 'full')!;
  const pageVol = (x: string, k: number, right: string, am: boolean) => {
    const node = snapAll.uwByDate?.[x]?.find(nn => nn.strike === k);
    if (!node) return 0;
    if (am) return (right === 'C' ? node.am?.callIv : node.am?.putIv) || 0;
    return (right === 'C' ? node.callIv : node.putIv) || 0;
  };
  for (const r of rows) {
    const x = String(r.expiry);
    if (!liveDates.has(x)) continue;
    const k = n(r.strike);
    const s0 = n(r.price) || spot;
    const at = Date.parse(String(r.time)) || now;
    for (const [right, g0raw] of [['C', n(r.call_gamma_oi)], ['P', n(r.put_gamma_oi)]] as const) {
      const key = `${x}|${k}|${right}`;
      const o = ois.get(key);
      const side = right === 'C' ? 1 : -1;
      const g0 = g0raw * (1 - (amCut.get(key) ?? 0));
      if (!o) {
        if (g0) legs.push({ x, k, g0, iv: 0, pageIv: pageVol(x, k, right, false), t: tPm(at, x), s0, oi: 0, side });
        continue;
      }
      const amT = tAm(at, x);
      const live = amT != null && o.am > 0;
      const share = live ? o.am / (o.am + o.pm) : 0;
      if (o.pm > 0 || !live) legs.push({ x, k, g0: g0 * (1 - share), iv: o.pmIv || o.amIv, pageIv: pageVol(x, k, right, false), t: tPm(at, x), s0, oi: o.pm, side, q: o.pmIv ? o.pmQ : o.amQ });
      if (live) legs.push({ x, k, g0: g0 * share, iv: o.amIv || o.pmIv, pageIv: pageVol(x, k, right, true), t: amT!, s0, oi: o.am, side, q: o.amIv ? o.amQ : o.pmQ });
    }
  }
  /* COVERAGE (audit 2026-11-06, finding 2): of the legs whose contract has a valid two-sided quote, the share the page
     prices at that quote's own vol (its vol within 1% of the one solved here), and the gamma-weighted share */
  {
    const quoted = legs.filter(l => l.q && l.iv > 0 && l.g0);
    const onQuote = quoted.filter(l => l.pageIv > 0 && Math.abs(l.pageIv / l.iv - 1) <= 0.01);
    const w = (ls: Leg[]) => ls.reduce((a, l) => a + Math.abs(l.g0), 0);
    console.log(`     quote coverage: ${quoted.length} of ${legs.length} legs carry a valid two-sided quote; the page prices ${onQuote.length} of them (${((onQuote.length / Math.max(1, quoted.length)) * 100).toFixed(1)}%, ${((w(onQuote) / Math.max(1, w(quoted))) * 100).toFixed(1)}% of their gamma) at that quote's own vol`);
    /* the dates where the most quoted gamma is off its quote's vol, with the median page ÷ hand vol there */
    const byX = new Map<string, { all: number; off: number; ratios: number[] }>();
    const on = new Set(onQuote);
    for (const l of quoted) {
      const cur = byX.get(l.x) ?? { all: 0, off: 0, ratios: [] };
      cur.all += Math.abs(l.g0);
      if (!on.has(l)) {
        cur.off += Math.abs(l.g0);
        if (l.pageIv > 0) cur.ratios.push(l.pageIv / l.iv);
      }
      byX.set(l.x, cur);
    }
    const worst = [...byX].filter(([, v]) => v.off > 0).sort((a, b) => b[1].off - a[1].off).slice(0, 4);
    if (process.env.PINPOINT_LEGS)
      for (const [x] of worst) {
        const nodes = snapRows.uwByDate?.[x] ?? [];
        const top = nodes.reduce<{ at: number; px: number }>((m, nn) => (nn.gexAt != null && nn.gexAt >= m.at ? { at: nn.gexAt, px: nn.gexPx ?? 0 } : m), { at: 0, px: 0 });
        console.log(`       ${x}: solved here at ${JSON.stringify(quoteClock(t, x))}, the page's chain is priced at ${JSON.stringify(top)}`);
      }
    if (worst.length)
      console.log(`     most quoted gamma off its quote: ${worst.map(([x, v]) => `${x} ${((v.off / v.all) * 100).toFixed(0)}% (page ÷ hand vol ${v.ratios.length ? v.ratios.sort((a, b) => a - b)[Math.floor(v.ratios.length / 2)].toFixed(3) : 'none'})`).join(', ')}`);
  }
  let ownPriced = 0;
  /* a leg no quote or vendor vol prices (a far wing after the close) takes its own date's smile, built here from the vols
     solved above: linear in strike between the nearest priced strikes, flat past the last — never carried flat */
  {
    ownPriced = legs.filter(l => l.iv > 0).length;
    const smile = new Map<string, [number, number][]>();
    for (const l of legs) if (l.iv > 0) smile.set(l.x, [...(smile.get(l.x) ?? []), [l.k, l.iv]]);
    for (const [, pts] of smile) pts.sort((a, b) => a[0] - b[0]);
    let filled = 0;
    for (const l of legs) {
      if (l.iv > 0 || !(l.t > 0)) continue;
      const pts = smile.get(l.x);
      if (!pts?.length) continue;
      const hi = pts.findIndex(p => p[0] >= l.k);
      l.iv = hi <= 0 ? pts[hi === 0 ? 0 : pts.length - 1][1] : pts[hi - 1][1] + ((pts[hi][1] - pts[hi - 1][1]) * (l.k - pts[hi - 1][0])) / (pts[hi][0] - pts[hi - 1][0]);
      filled++;
    }
    if (filled) console.log(`     ${filled} legs with no vol of their own take their date's smile (solved here)`);
  }
  let usePage = false;
  const netAt = (x: number, only?: string) => {
    let sum = 0;
    for (const l0 of legs) {
      if (only && l0.x !== only) continue;
      /* the page's vol where it holds one; a leg it holds none for takes the same stand-in as below (its date's smile) */
      const l = usePage ? { ...l0, iv: l0.pageIv > 0 ? l0.pageIv : l0.iv } : l0;
      if (!(l.iv > 0) || !(l.t > 0)) {
        sum += l.g0;
        continue;
      }
      const v = l.iv * Math.sqrt(l.t);
      const a = (Math.log(l.s0 / l.k) + (R - Q + l.iv * l.iv / 2) * l.t) / v;
      if (Math.abs(a) > 6) {
        if (l.oi > 0) sum += l.side * l.oi * gamma$(x, l.k, l.t, l.iv);
        continue;
      }
      const b = (Math.log(x / l.k) + (R - Q + l.iv * l.iv / 2) * l.t) / v;
      let gg = l.g0 * (x / l.s0) * Math.exp(a * a / 2 - b * b / 2);
      if (l.oi > 0 && l.t <= 1 / 252 + 1e-12) {
        const cap = Math.max(Math.abs(l.g0), (l.oi * l.k * Math.exp(-Q * l.t)) / (Math.sqrt(2 * Math.PI) * l.iv * Math.sqrt(l.t)));
        if (Math.abs(gg) > cap) gg = Math.sign(gg) * cap;
      }
      sum += gg;
    }
    return sum;
  };
  const flipOf = (lo: number, hi: number, only?: string) => {
    const N = 2000;
    let best: number | null = null;
    let px = lo;
    let py = netAt(px, only);
    for (let i = 1; i <= N; i++) {
      const x = lo + ((hi - lo) * i) / N;
      const y = netAt(x, only);
      if (py * y < 0) {
        let a = px;
        let b = x;
        let fa = py;
        for (let j = 0; j < 50; j++) {
          const m = (a + b) / 2;
          const fm = netAt(m, only);
          if (fm * fa > 0) {
            a = m;
            fa = fm;
          } else b = m;
        }
        const z = (a + b) / 2;
        if (best == null || Math.abs(z - spot) < Math.abs(best - spot)) best = z;
      }
      px = x;
      py = y;
    }
    return best;
  };
  usePage = true;
  const pageVolFlip = flipOf(spot * 0.9, spot * 1.1);
  const pageVolFront = flipOf(spot * 0.9, spot * 1.1, front);
  const pageVolShare = legs.filter(l => l.pageIv > 0).length / Math.max(1, legs.length);
  usePage = false;
  const handFlip = flipOf(spot * 0.9, spot * 1.1);
  console.log(`     ${legs.length} legs over ${liveDates.size} dates, ${((ownPriced / Math.max(1, legs.length)) * 100).toFixed(1)}% on their own contract's vol (the rest their date's smile); hand net at spot ${(netAt(spot) / 1e9).toFixed(3)}B`);
  const near = (a: number | null | undefined, b: number | null) => (a == null || b == null ? a == null && b == null : Math.abs(a - b) <= spot * 0.0005);
  /* (a) the arithmetic: every leg of every expiry re-priced here at the vol the page holds for it (a leg it holds none
     for — a wing with no quote and no vendor vol — at its date's smile solved here, as in (b); it was carried flat, which
     with every date's contracts read now moved SPX's re-price 0.06% off the page's on those few legs alone) */
  check(`${t} All: the flip ${lvA.flip?.toFixed(2) ?? 'none'} = every leg re-priced here at the page's own vols ${pageVolFlip?.toFixed(2) ?? 'none'} (${(pageVolShare * 100).toFixed(1)}% of legs carry one; within 0.05% of spot = ${(spot * 0.0005).toFixed(2)})`, near(lvA.flip, pageVolFlip));
  check(`${t} Today: the flip ${lv0.flip?.toFixed(2) ?? 'none'} = the front date re-priced here at the page's vols ${pageVolFront?.toFixed(2) ?? 'none'}`, near(lv0.flip, pageVolFront));
  /* (b) the vols too: every leg at its own contract's vol solved here off its quote at the minute the rows were priced
     (the vendor's vol moved onto the session clock where the quote is unusable — after the close every quote reads zero) */
  /* in the session within 0.05% of spot; after the close 0.1% — every quote reads zero, so both sides price off the vendor's
     close vols, and a wing with none takes each side's own smile (the page's is the out-of-the-money side, smoothed) */
  const tolOwn = live ? 0.0005 : 0.001;
  const nearOwn = (a: number | null | undefined, b: number | null) => (a == null || b == null ? a == null && b == null : Math.abs(a - b) <= spot * tolOwn);
  check(`${t} All: the flip ${lvA.flip?.toFixed(2) ?? 'none'} against every leg of every date at its own contract's vol solved here ${handFlip?.toFixed(2) ?? 'none'} (${handFlip != null && lvA.flip != null ? ((Math.abs(lvA.flip - handFlip) / spot) * 100).toFixed(3) : '—'}% of spot; ${live ? 'live quotes, within 0.05%' : 'after hours, the vendor\'s close vols, within 0.1%'})`, nearOwn(lvA.flip, handFlip));
  /* the front date alone: both sides re-price it at its own contracts' vols */
  const handFront = flipOf(spot * 0.9, spot * 1.1, front);
  check(`${t} Today: the flip ${lv0.flip?.toFixed(2) ?? 'none'} against the front date at its own contracts' vols solved here ${handFront?.toFixed(2) ?? 'none'} (${handFront != null && lv0.flip != null ? ((Math.abs(lv0.flip - handFront) / spot) * 100).toFixed(3) : '—'}% of spot)`, nearOwn(lv0.flip, handFront));
  /* where the two disagree, date by date: the page's own net per date (flipLevel datesNetAt, house sign) at both flips */
  if (lvA.flip != null && pageVolFlip != null && (Math.abs(lvA.flip - pageVolFlip) > spot * 0.0005 || (handFlip != null && Math.abs(lvA.flip - handFlip) > spot * tolOwn))) {
    usePage = true;
    const { datesNetAt } = await import('../src/data/flipLevel');
    const snap = book.snapshotFor(t, 'ALL', 'full')!;
    const ds = [...liveDates].sort();
    const at = [lvA.flip, handFlip];
    const pageNets = datesNetAt(snap, ds, at);
    const rowsOut = ds.map((d, i) => {
      usePage = true;
      const hand = at.map(x => netAt(x, d));
      usePage = false;
      return { d, page: pageNets[i]?.map(v => -v) ?? null, hand, own: netAt(lvA.flip!, d) };
    });
    rowsOut.sort((a, b) => Math.max(Math.abs((b.page?.[0] ?? 0) - b.hand[0]), Math.abs((b.page?.[0] ?? 0) - b.own)) - Math.max(Math.abs((a.page?.[0] ?? 0) - a.hand[0]), Math.abs((a.page?.[0] ?? 0) - a.own)));
    console.log(`     per date at the page's flip ${lvA.flip.toFixed(2)} (page | here at the page's vols | here at each contract's own vol, $M) — the largest gaps:`);
    for (const r of rowsOut.slice(0, 6)) console.log(`       ${r.d}  ${r.page ? (r.page[0] / 1e6).toFixed(1) : '—'} | ${(r.hand[0] / 1e6).toFixed(1)} | ${(r.own / 1e6).toFixed(1)}`);
    const pageSum = rowsOut.reduce((a, r) => a + (r.page?.[0] ?? 0), 0);
    console.log(`       Σ ${(pageSum / 1e6).toFixed(1)} | ${(rowsOut.reduce((a, r) => a + r.hand[0], 0) / 1e6).toFixed(1)} | ${(rowsOut.reduce((a, r) => a + r.own, 0) / 1e6).toFixed(1)}`);
    /* PINPOINT_LEGS=1: the legs of the worst date whose re-priced gamma at the page's flip differs most between the page's
       vol and the contract's own */
    if (process.env.PINPOINT_LEGS) {
      const d = rowsOut[0].d;
      const one = (l: Leg, iv: number) => {
        usePage = false;
        const saved = l.iv;
        l.iv = iv;
        const legsBak = legs.splice(0, legs.length, l);
        const v = netAt(lvA.flip!);
        legs.splice(0, legs.length, ...legsBak);
        l.iv = saved;
        return v;
      };
      const diffs = legs.filter(l => l.x === d).map(l => ({ l, page: one(l, l.pageIv), own: one(l, l.iv) })).sort((a, b) => Math.abs(b.page - b.own) - Math.abs(a.page - a.own)).slice(0, 8);
      for (const { l, page, own: o } of diffs) console.log(`         ${d} ${l.k}${l.side === 1 ? 'C' : 'P'} t ${(l.t * 390 * 252).toFixed(0)}m s0 ${l.s0} oi ${l.oi} quoted ${!!l.q} iv page ${l.pageIv.toFixed(4)} own ${l.iv.toFixed(4)} → ${(page / 1e6).toFixed(1)} | ${(o / 1e6).toFixed(1)} $M`);
    }
    usePage = false;
  }
  check(`${t} All: the regime is the sign of that net at spot (${lvA.regime}; hand ${netAt(spot) > 0 ? 'LONG' : 'SHORT'})`, lvA.regime === (netAt(spot) > 0 ? 'LONG' : 'SHORT'));

  /* 4. the expected move, live */
  if (!live) {
    skip(`${t}: the straddle against the live quotes (the session is shut — quotes read zero after hours)`);
    continue;
  }
  const list = contracts.get(front) ?? [];
  const by = new Map<number, { C?: number; P?: number }>();
  for (const r of list) {
    const c = tail(String(r.option_symbol));
    if (AM_ROOTS[t]?.includes(c.root)) continue;
    const bid = n(r.nbbo_bid);
    const ask = n(r.nbbo_ask);
    if (!(bid > 0) || ask < bid) continue;
    const cur = by.get(c.k) ?? {};
    cur[c.right as 'C' | 'P'] = (bid + ask) / 2;
    by.set(c.k, cur);
  }
  const ks = [...by].filter(([, v]) => v.C != null && v.P != null).map(([k]) => k).sort((a, b) => a - b);
  const lo = ks.filter(k => k <= spot).pop();
  const hi = ks.find(k => k >= spot);
  const sv = (k: number) => by.get(k)!.C! + by.get(k)!.P!;
  const mid = lo == null || hi == null ? null : hi === lo ? sv(lo) : sv(lo) + ((sv(hi) - sv(lo)) * (spot - lo)) / (hi - lo);
  const move = book.peekScopeMove(t, front);
  if (mid == null || !move) {
    check(`${t}: a live at-the-money straddle and the page's move into ${front}`, false);
    continue;
  }
  check(`${t}: the page's straddle into ${front} ${move.straddle.toFixed(2)} against the live mid ${mid.toFixed(2)} (within 7%: ${((move.straddle / mid - 1) * 100).toFixed(1)}%)`, Math.abs(move.straddle / mid - 1) <= 0.07);
  check(`${t}: 1σ ${move.move.toFixed(2)} = the straddle ÷ √(2/π) (${(move.straddle / Math.sqrt(2 / Math.PI)).toFixed(2)})`, Math.abs(move.move - move.straddle / Math.sqrt(2 / Math.PI)) < 1e-6 * Math.max(1, move.move));
  const tLeft = tPm(now, front);
  const atm = solve(mid / 2, 'C', spot, hi ?? spot, tLeft);
  console.log(`     ${front}: ${(tLeft * YEAR_MIN).toFixed(0)} trading minutes left, the live straddle implies σ ≈ ${atm ? (atm * 100).toFixed(1) : '?'}% on the session clock`);
}

console.log(`\n${fail ? `${fail} FAILED` : 'all ok'}${skipped ? ` (${skipped} live check${skipped > 1 ? 's' : ''} skipped outside the session)` : ''}`);
process.exit(fail ? 1 : 0);
