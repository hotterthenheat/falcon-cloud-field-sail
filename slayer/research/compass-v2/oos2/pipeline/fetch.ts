/*
  Challenger bulk history pipeline: the raw reads, newest session first, resumable, in per-run chunks.

  Per session day D and Compass root:
    - the 0DTE chain (expiry D) and the weekly chain (the nearest expiry 1-7 sessions out, the weekly roots), each as
      ONE chain-NBBO request per expiry and calendar date (/option/history/quote, 1-minute, the engine's strike band:
      16 strikes either side same-day, 17 weekly), over every session the root trades: the index roots' overnight
      (20:15 the evening before to 09:25), the 07:30 options pre-market, the regular session and the curb to 17:00;
    - the open interest of that expiry on D (the GEX-core roots, as the engine reads it);
    - the underlying's, SPY's, QQQ's, IWM's and the sector ETFs' 1-minute bars, one request per symbol and month.
  Everything lands under research/challenger/data/ (git-ignored), compact and gzipped. A day is done when its
  _done.json exists; a re-run skips it. At most CONC requests in flight (default 2; the terminal is shared).

    npx tsx research/challenger/fetch.ts [--from 2026-10-30] [--to 2025-01-01] [--minutes 110] [--roots SPY,QQQ]
*/
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ALL, WEEKLY_FOCUS } from '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/data/compassScan';
import { MARKET_HOLIDAYS, sessionCloseMinOn } from '/home/user/falcon-cloud-field-sail/.claude/worktrees/agent-a3673bb87994bc8be/slayer/src/core/calendar';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.CHAL_DATA || '/home/user/falcon-cloud-field-sail/v2data/oos2';
const BASE = process.env.THETA_BASE || 'http://127.0.0.1:25503/v3';
const CONC = Math.max(1, Math.min(3, Number(process.env.CHAL_CONC) || 2));

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const FROM = arg('--from', '2026-10-30');
const TO = arg('--to', '2012-06-01');
const MINUTES = Number(arg('--minutes', '110'));
const ONLY = arg('--roots', '');
const NO_BARS = args.includes('--no-bars');
/* OOS2: CHAL_DAYS=<LOCKED2.json> restricts the fetch to the pre-registered sessions (never a day outside the block) */
const ONLY_DAYS: Set<string> | null = process.env.CHAL_DAYS
  ? new Set((JSON.parse(fs.readFileSync(process.env.CHAL_DAYS, 'utf8')) as { sessions: { day: string }[] }).sessions.map(s => s.day))
  : null;

/* the same-day roots of the engine's book (VIX's same-day contract is not scored: NO_SAME_DAY) and the weekly roots */
export const ODTE_ROOTS = ['SPXW', 'NDXP', 'XSP', 'RUTW', 'SPY', 'QQQ', 'IWM', 'GLD', 'XLF', 'SMH', 'AAPL', 'AMD', 'AMZN', 'AVGO', 'GOOGL', 'INTC', 'META', 'MSFT', 'MU', 'NVDA', 'TSLA', 'SLV', 'TLT', 'XLE', 'EEM', 'TQQQ', 'SOXL', 'USO', 'UNG'].filter(r => ALL.includes(r));
export const WEEKLY_ROOTS = [...WEEKLY_FOCUS];
export const GEX_CORE = new Set(['SPXW', 'NVDA', 'SPY', 'QQQ', 'NDXP', 'IWM', 'TSLA', 'META', 'XSP', 'AVGO', 'MSFT', 'AAPL', 'TLT', 'RUTW', 'AMZN', 'SLV', 'GOOGL', 'GLD', 'SMH', 'XLF']);
export const OVERNIGHT = new Set(['SPXW', 'XSP', 'RUTW', 'VIX']);
export const UNDER_OF: Record<string, string> = { SPXW: 'SPX', NDXP: 'NDX', RUTW: 'RUT' };
export const INDEX_UNDER = new Set(['SPX', 'NDX', 'RUT', 'XSP', 'VIX']);
export const EXTRA_BARS = ['SPY', 'QQQ', 'IWM', 'SMH', 'XLF', 'XLE', 'GDX', 'BITO'];

let inFlight = 0;
const waiters: (() => void)[] = [];
let asked = 0;
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (inFlight >= CONC) await new Promise<void>(res => waiters.push(res));
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    waiters.shift()?.();
  }
}

/** One REST read; a transient answer (empty 200, 5xx, 429, a dropped socket) is asked again with backoff. 472 (no
    data) comes back as an empty body with status 472. */
export async function get(p: string): Promise<{ status: number; body: string }> {
  for (let i = 0; ; i++) {
    try {
      const r = await slot(() => fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(180_000) }));
      const body = await r.text();
      asked += 1;
      if (r.status === 472 || /No data found/i.test(body.slice(0, 200))) return { status: 472, body: '' };
      /* a busy terminal (429: its request slots are shared with other clients) is waited out; an empty 200 or a 5xx
         is asked again a few times */
      if (r.status === 429 && i < 60) {
        await new Promise(res => setTimeout(res, 1500 + Math.random() * 2500));
        continue;
      }
      /* a terminal restart (it is restarted for its 2-hour limit) is waited out, up to about ten minutes */
      if ((r.status === 200 && !body.trim()) || r.status >= 500) {
        if (i < 40) {
          await new Promise(res => setTimeout(res, Math.min(15_000, 1000 * 2 ** i)));
          continue;
        }
      }
      return { status: r.status, body };
    } catch {
      if (i >= 40) return { status: 503, body: '' };
      await new Promise(res => setTimeout(res, Math.min(15_000, 2000 * 2 ** i)));
    }
  }
}

const ymd = (iso: string) => iso.replace(/-/g, '');
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => iso(new Date(Date.parse(`${s}T12:00:00Z`) + n * 86_400_000));

function writeGz(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, zlib.gzipSync(text, { level: 6 }));
  fs.renameSync(tmp, file);
}

export function readGz(file: string): string {
  return zlib.gunzipSync(fs.readFileSync(file)).toString('utf8');
}

/* ---- the calendar: SPY's daily bars name the sessions ---- */

async function sessions(year: number): Promise<string[]> {
  const file = path.join(DATA, 'meta', `sessions_${year}.json`);
  if (fs.existsSync(file) && year < 2026) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
  if (`${year}0101` > today) return [];
  const end = `${year}1231` < today ? `${year}1231` : today;
  const got = await get(`/stock/history/eod?symbol=SPY&start_date=${year}0101&end_date=${end}&format=csv`);
  const days = got.body.split('\n').slice(1).map(l => l.split(',')[0]?.slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(days));
  return days;
}

async function expirations(root: string): Promise<Set<string>> {
  const file = path.join(DATA, 'meta', `exp_${root}.json`);
  const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 7 * 86_400_000;
  if (fresh) return new Set(JSON.parse(fs.readFileSync(file, 'utf8')));
  const got = await get(`/option/list/expirations?symbol=${root}&format=csv`);
  const list = got.body.split('\n').slice(1).map(l => (l.split(',')[1] ?? '').replace(/"/g, '').slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(list));
  return new Set(list);
}

/* ---- one chain read, kept compact: minute (NY wall, "YYYY-MM-DD HH:MM"), strike, C/P, bid, ask, bid size, ask size ---- */

function compactQuotes(csv: string): { text: string; rows: number } {
  const out: string[] = [];
  const lines = csv.split('\n');
  const head = lines[0]?.split(',') ?? [];
  const ix = (k: string) => head.indexOf(k);
  const [iK, iR, iT, iBs, iB, iAs, iA] = ['strike', 'right', 'timestamp', 'bid_size', 'bid', 'ask_size', 'ask'].map(ix);
  if (iK < 0 || iT < 0) return { text: '', rows: 0 };
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < head.length) continue;
    const ask = Number(c[iA]);
    const bid = Number(c[iB]);
    if (!(ask > 0) || !(bid >= 0) || ask < bid) continue;
    const ts = c[iT];
    out.push(`${ts.slice(0, 10)} ${ts.slice(11, 16)},${Number(c[iK])},${c[iR].replace(/"/g, '')[0]},${bid},${ask},${c[iBs]},${c[iAs]}`);
  }
  return { text: out.join('\n'), rows: out.length };
}

async function chain(root: string, expiry: string, day: string, band: number): Promise<{ rows: number; status: number }> {
  const file = path.join(DATA, 'raw', ymd(day), `${root}_${ymd(expiry)}.csv.gz`);
  if (fs.existsSync(file)) return { rows: -1, status: 200 };
  const parts: string[] = [];
  let rows = 0;
  let status = 200;
  const windows: [string, string, string][] = [];
  if (OVERNIGHT.has(root)) {
    /* the overnight session opens 20:15 on the calendar day before the session's first night (Sunday for Monday) */
    windows.push([addDays(day, new Date(`${day}T12:00:00Z`).getUTCDay() === 1 ? -1 : -1), '20:15:00', '23:59:00']);
    windows.push([day, '00:00:00', '17:00:00']);
  } else windows.push([day, '07:30:00', '17:00:00']);
  for (const [date, s, e] of windows) {
    const got = await get(`/option/history/quote?symbol=${root}&expiration=${ymd(expiry)}&date=${ymd(date)}&interval=1m&strike_range=${band}&start_time=${s}&end_time=${e}&format=csv`);
    if (got.status !== 200 && got.status !== 472) status = got.status;
    if (got.status !== 200) continue;
    const c = compactQuotes(got.body);
    rows += c.rows;
    if (c.text) parts.push(c.text);
  }
  if (status !== 200) return { rows: 0, status };
  writeGz(file, parts.join('\n'));
  return { rows, status };
}

/** Book C's board: the same-day chain at the sweep's own instant (15:20:15, or 40 minutes before an early close and
    15 s), as option/at_time/quote answers it, kept raw so the builder needs no terminal for the sweep. */
export function sweepFile(day: string, root: string): string {
  return path.join(DATA, 'raw', ymd(day), `${root}_${ymd(day)}.sweep.json`);
}
export async function sweepBoard(root: string, day: string): Promise<void> {
  const file = sweepFile(day, root);
  if (fs.existsSync(file)) return;
  const close = sessionCloseMinOn(day);
  const m = close < 16 * 60 ? close - 40 : 15 * 60 + 20;
  const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:15.000`;
  const p = `/option/at_time/quote?symbol=${root}&expiration=${ymd(day)}&right=both&strike_range=16&start_date=${ymd(day)}&end_date=${ymd(day)}&time_of_day=${time}&format=json`;
  const got = await get(p);
  if (got.status !== 200 && got.status !== 472) throw new Error(`sweep ${root} ${day}: ${got.status}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ path: p, status: got.status, body: got.body }));
}

async function openInterest(root: string, expiry: string, day: string): Promise<void> {
  const file = path.join(DATA, 'raw', ymd(day), `${root}_${ymd(expiry)}.oi.csv.gz`);
  if (fs.existsSync(file)) return;
  const got = await get(`/option/history/open_interest?symbol=${root}&expiration=${ymd(expiry)}&date=${ymd(day)}&format=csv`);
  if (got.status !== 200 && got.status !== 472) throw new Error(`oi ${root} ${day}: ${got.status}`);
  const lines = got.body.split('\n');
  const head = lines[0]?.split(',') ?? [];
  const [iK, iR, iO] = ['strike', 'right', 'open_interest'].map(k => head.indexOf(k));
  const out = iK < 0 ? [] : lines.slice(1).map(l => l.split(',')).filter(c => c.length >= head.length).map(c => `${Number(c[iK])},${c[iR].replace(/"/g, '')[0]},${Number(c[iO])}`);
  writeGz(file, out.join('\n'));
}

/* ---- bars: one request per symbol and month ---- */

const barJobs = new Map<string, Promise<void>>();
export function barFile(sym: string, month: string): string {
  return path.join(DATA, 'bars', sym, `${month}.csv.gz`);
}
function bars(sym: string, month: string): Promise<void> {
  const key = `${sym}|${month}`;
  let job = barJobs.get(key);
  if (job) return job;
  job = (async () => {
    const file = barFile(sym, month);
    const current = month >= '2026-10';
    if (fs.existsSync(file) && !(current && Date.now() - fs.statSync(file).mtimeMs > 6 * 3600_000)) return;
    const start = `${month}-01`;
    const end = addDays(iso(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))), -1);
    const kind = INDEX_UNDER.has(sym) ? 'index' : 'stock';
    const got = await get(`/${kind}/history/ohlc?symbol=${sym}&start_date=${ymd(start)}&end_date=${ymd(end)}&interval=1m&format=csv`);
    if (got.status !== 200 && got.status !== 472) throw new Error(`bars ${sym} ${month}: ${got.status}`);
    const lines = got.body.split('\n');
    const head = lines[0]?.split(',') ?? [];
    const [iT, iO, iH, iL, iC, iV] = ['timestamp', 'open', 'high', 'low', 'close', 'volume'].map(k => head.indexOf(k));
    const out = iT < 0 ? [] : lines.slice(1).map(l => l.split(',')).filter(c => c.length >= head.length && Number(c[iC]) > 0).map(c => `${c[iT].slice(0, 10)} ${c[iT].slice(11, 16)},${Number(c[iO])},${Number(c[iH])},${Number(c[iL])},${Number(c[iC])},${iV >= 0 ? Number(c[iV]) : 0}`);
    writeGz(file, out.join('\n'));
  })();
  barJobs.set(key, job);
  return job;
}

/* ---- one session ---- */

export function sessionsAhead(list: string[], day: string, expiry: string): number {
  return list.filter(d => d > day && d <= expiry).length;
}

async function oneDay(day: string, cal: string[], exps: Map<string, Set<string>>): Promise<void> {
  const dir = path.join(DATA, 'raw', ymd(day));
  const done = path.join(dir, '_done.json');
  /* a day fetched for a subset of roots (--roots, the regime samples) is done for that subset only */
  if (fs.existsSync(done)) {
    const had = JSON.parse(fs.readFileSync(done, 'utf8')) as { subset?: string[] };
    if (!had.subset || (ONLY && ONLY.split(',').every(r => had.subset!.includes(r)))) return;
  }
  const t0 = Date.now();
  const odte = ODTE_ROOTS.filter(r => (!ONLY || ONLY.split(',').includes(r)) && exps.get(r)?.has(day));
  const weekly: [string, string][] = [];
  for (const r of WEEKLY_ROOTS) {
    if (ONLY && !ONLY.split(',').includes(r)) continue;
    const list = [...(exps.get(r) ?? [])].filter(e => e > day).sort();
    const e = list.find(x => {
      const n = sessionsAhead(cal, day, x);
      return n >= 1 && n <= 7;
    });
    if (e && sessionsAhead(cal, day, e) <= 7) weekly.push([r, e]);
  }
  const month = day.slice(0, 7);
  const prevMonth = iso(new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 2, 1))).slice(0, 7);
  const unders = [...new Set([...odte, ...weekly.map(w => w[0])].map(r => UNDER_OF[r] ?? r).concat(EXTRA_BARS))];
  const jobs: Promise<unknown>[] = [];
  const summary: Record<string, number> = {};
  for (const r of odte) jobs.push(chain(r, day, day, 16).then(x => { summary[`${r}:0`] = x.rows; if (x.status !== 200) throw new Error(`${r} 0DTE ${day}: ${x.status}`); }));
  for (const [r, e] of weekly) jobs.push(chain(r, e, day, 17).then(x => { summary[`${r}:${e}`] = x.rows; if (x.status !== 200) throw new Error(`${r} ${e} ${day}: ${x.status}`); }));
  for (const r of odte) if (GEX_CORE.has(r)) jobs.push(openInterest(r, day, day));
  for (const r of odte) jobs.push(sweepBoard(r, day));
  for (const [r, e] of weekly) if (GEX_CORE.has(r)) jobs.push(openInterest(r, e, day));
  if (!NO_BARS) for (const u of unders) for (const m of [month, prevMonth]) jobs.push(bars(u, m));
  const res = await Promise.allSettled(jobs);
  const bad = res.filter(r => r.status === 'rejected').map(r => String((r as PromiseRejectedResult).reason));
  if (bad.length) {
    console.log(`${day}: ${bad.length} reads failed (${bad.slice(0, 3).join('; ')}); not marked done`);
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(done, JSON.stringify({ day, odte, weekly, summary, at: Date.now(), ...(ONLY ? { subset: ONLY.split(',') } : {}) }));
  console.log(`${day}: ${odte.length} same-day, ${weekly.length} weekly chains, ${Math.round((Date.now() - t0) / 1000)} s, ${asked} asks so far`);
}

async function backfillSweeps(): Promise<void> {
  const stopAt = Date.now() + MINUTES * 60_000;
  const raw = path.join(DATA, 'raw');
  const days = fs.readdirSync(raw).filter(d => /^\d{8}$/.test(d) && fs.existsSync(path.join(raw, d, '_done.json'))).sort().reverse();
  let n = 0;
  for (const d of days) {
    if (Date.now() > stopAt) break;
    const doc = JSON.parse(fs.readFileSync(path.join(raw, d, '_done.json'), 'utf8')) as { day: string; odte: string[] };
    const res = await Promise.allSettled(doc.odte.map(r => sweepBoard(r, doc.day)));
    n += res.filter(r => r.status === 'fulfilled').length;
  }
  console.log(`sweep boards: ${n} read or kept`);
}

async function main(): Promise<void> {
  if (args.includes('--sweeps')) return backfillSweeps();
  const stopAt = Date.now() + MINUTES * 60_000;
  const years: number[] = [];
  for (let y = Number(FROM.slice(0, 4)); y >= Number(TO.slice(0, 4)); y--) years.push(y);
  const cal: string[] = [];
  for (const y of years.slice().reverse()) cal.push(...(await sessions(y)));
  /* the sessions after FROM too (a weekly expiry's count of sessions ahead): the weekdays that are not holidays */
  cal.push(...(await sessions(Number(FROM.slice(0, 4)) + 1).catch(() => [])));
  const last = cal[cal.length - 1];
  for (let d = addDays(last, 1); d <= addDays(last, 14); d = addDays(d, 1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !MARKET_HOLIDAYS.has(d)) cal.push(d);
  }
  const exps = new Map<string, Set<string>>();
  for (const r of [...new Set([...ODTE_ROOTS, ...WEEKLY_ROOTS])]) exps.set(r, await expirations(r));
  const days = cal.filter(d => d <= FROM && d >= TO && (!ONLY_DAYS || ONLY_DAYS.has(d))).sort().reverse();
  console.log(`${days.length} sessions ${days[days.length - 1]} … ${days[0]}, conc ${CONC}`);
  for (const d of days) {
    if (Date.now() > stopAt) {
      console.log('time box reached; resume to continue');
      break;
    }
    await oneDay(d, cal, exps);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}
