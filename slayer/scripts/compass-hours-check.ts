/*
  Cross-checks Compass's session rules against the market. For every name in the Compass universe it reads one real
  session of ThetaData one-minute option bars for the name's nearest expiry, three strikes either side, calls and
  puts (the evening before, the overnight book, pre-market, the regular session, the curb and after hours), and
  compares each minute with whether Compass would scan that name then (data/compassSession.ts optionScanOpen).
  Trades are the evidence (a quote row repeats the last NBBO after the close; a trade only happens while the tape is
  open). It reports a window Compass scans in which nothing traded ("scans a dead tape") and trades in a window
  Compass does not scan ("misses a live tape").

    npx tsx scripts/compass-hours-check.ts [YYYYMMDD]      default: the last full session before today
  Needs the ThetaData terminal on THETA_REST_BASE (default http://127.0.0.1:25503). Writes a JSON report next to it
  when COMPASS_HOURS_OUT is set.
*/

import { writeFileSync } from 'node:fs';
import { COMPASS_TICKERS } from '../src/data/compassUniverse';
import { optionScanOpen } from '../src/data/compassSession';
import { isTradingDay } from '../src/core/calendar';

const BASE = (process.env.THETA_REST_BASE || 'http://127.0.0.1:25503').replace(/\/+$/, '');
const OPTION_OF: Record<string, string> = { SPX: 'SPXW', RUT: 'RUTW', NDX: 'NDXP' };
const ONLY = (process.env.COMPASS_HOURS_ONLY || '').split(',').filter(Boolean);
const NAMES = ONLY.length ? ONLY : [...new Set(COMPASS_TICKERS.map(t => OPTION_OF[t] ?? t))];

const ymd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
function lastSession(): string {
  const d = new Date();
  for (let i = 1; i < 10; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - i));
    if (isTradingDay(new Date(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()))) return ymd(x);
  }
  throw new Error('no session in the last ten days');
}
const DAY = process.argv[2] || lastSession();
const prevDay = (() => {
  const x = new Date(Date.UTC(+DAY.slice(0, 4), +DAY.slice(4, 6) - 1, +DAY.slice(6, 8)));
  for (let i = 1; i < 10; i++) {
    const y = new Date(x.getTime() - i * 86_400_000);
    if (isTradingDay(new Date(y.getUTCFullYear(), y.getUTCMonth(), y.getUTCDate()))) return ymd(y);
  }
  return DAY;
})();

/* New York wall time → instant, for the two days in question (EDT or EST, read from the zone itself) */
const NY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
function nyInstant(day: string, h: number, m: number): number {
  const guess = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), h + 4, m);
  for (const off of [4, 5]) {
    const t = Date.UTC(+day.slice(0, 4), +day.slice(4, 6) - 1, +day.slice(6, 8), h + off, m);
    const p = Object.fromEntries(NY.formatToParts(new Date(t)).map(x => [x.type, x.value]));
    if (Number(p.hour) % 24 === h && Number(p.minute) === m) return t;
  }
  return guess;
}

async function get(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${BASE}/v3${path}`, { signal: AbortSignal.timeout(60_000) });
      const text = await r.text();
      if (r.status === 472) return null;
      if (r.ok) return JSON.parse(text);
      if (!/invalid session|disconnected/i.test(text) && r.status < 500 && r.status !== 474 && r.status !== 478) throw new Error(`${r.status} ${text.slice(0, 120)}`);
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise(r => setTimeout(r, 15_000 * (attempt + 1)));
  }
  return null;
}
const rows = (j: unknown): Record<string, unknown>[] => {
  const o = j as { response?: unknown[] } | null;
  return Array.isArray(o?.response) ? (o!.response as Record<string, unknown>[]) : [];
};

/** minutes with at least one trade, as "YYYYMMDD HH:MM" */
async function tradedMinutes(sym: string, exp: string): Promise<Set<string>> {
  const out = new Set<string>();
  const ask = async (day: string, from: string, to: string) => {
    const j = await get(`/option/history/ohlc?symbol=${sym}&expiration=${exp}&right=both&strike_range=3&start_date=${day}&end_date=${day}&interval=1m&start_time=${from}&end_time=${to}&format=json`);
    for (const c of rows(j)) {
      for (const q of (c.data as Record<string, unknown>[]) ?? []) {
        if (!(Number(q.count) > 0)) continue;
        const ts = String(q.timestamp ?? '');
        out.add(`${ts.slice(0, 10).replace(/-/g, '')} ${ts.slice(11, 16)}`);
      }
    }
  };
  await ask(prevDay, '16:00:00', '23:59:59');
  await ask(DAY, '00:00:00', '09:29:59');
  await ask(DAY, '09:30:00', '16:15:00');
  await ask(DAY, '16:15:00', '19:59:59');
  return out;
}

type Gap = { kind: 'scans a dead tape' | 'misses a live tape'; from: string; to: string; minutes: number };

async function checkName(sym: string): Promise<{ name: string; expiry: string; dte: number; gaps: Gap[]; quoted: number; scanned: number } | { name: string; error: string }> {
  const ex = rows(await get(`/option/list/expirations?symbol=${sym}&format=json`))
    .map(r => String(r.expiration ?? '').slice(0, 10).replace(/-/g, ''))
    .filter(e => /^\d{8}$/.test(e) && e >= DAY)
    .sort();
  if (!ex.length) return { name: sym, error: 'no listed expiry on or after the day' };
  const exp = ex[0];
  const dte = exp === DAY ? 0 : 1;
  const traded = await tradedMinutes(sym, exp);
  const minutes: [string, number, number][] = [];
  for (let m = 16 * 60; m < 24 * 60; m++) minutes.push([prevDay, Math.floor(m / 60), m % 60]);
  for (let m = 0; m < 20 * 60; m++) minutes.push([DAY, Math.floor(m / 60), m % 60]);
  /* runs of scan / no-scan; a scan run with no trade in it is a dead window, trades inside a no-scan run are missed */
  type Run = { scan: boolean; from: string; to: string; minutes: number; trades: string[] };
  const runs: Run[] = [];
  let q = 0;
  let s = 0;
  for (const [day, h, mi] of minutes) {
    const label = `${day} ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    /* the contract the check reads expires on DAY; on the evening before it is a 1-day contract */
    const dteThen = dte === 0 && day === prevDay ? 1 : dte;
    const scan = optionScanOpen(sym, dteThen, nyInstant(day, h, mi) + 5_000);
    const hit = traded.has(label);
    if (hit) q += 1;
    if (scan) s += 1;
    const last = runs[runs.length - 1];
    if (last && last.scan === scan) {
      last.to = label;
      last.minutes += 1;
      if (hit) last.trades.push(label);
    } else runs.push({ scan, from: label, to: label, minutes: 1, trades: hit ? [label] : [] });
  }
  const gaps: Gap[] = [];
  for (const r of runs) {
    if (r.scan && !r.trades.length && r.minutes > 2) gaps.push({ kind: 'scans a dead tape', from: r.from, to: r.to, minutes: r.minutes });
    if (!r.scan && r.trades.length) gaps.push({ kind: 'misses a live tape', from: r.trades[0], to: r.trades[r.trades.length - 1], minutes: r.trades.length });
  }
  return { name: sym, expiry: exp, dte, gaps, quoted: q, scanned: s };
}
const results: Awaited<ReturnType<typeof checkName>>[] = [];
let next = 0;
async function worker() {
  while (next < NAMES.length) {
    const sym = NAMES[next++];
    try {
      results.push(await checkName(sym));
    } catch (e) {
      results.push({ name: sym, error: e instanceof Error ? e.message : String(e) });
    }
    if (results.length % 25 === 0) console.error(`… ${results.length}/${NAMES.length}`);
  }
}
console.error(`Compass universe: ${NAMES.length} names · session ${DAY} (evening of ${prevDay} through ${DAY} 20:00 ET)`);
await Promise.all(Array.from({ length: 6 }, worker));

results.sort((a, b) => a.name.localeCompare(b.name));
let clean = 0;
const noisy: string[] = [];
for (const r of results) {
  if ('error' in r) {
    noisy.push(`${r.name.padEnd(6)} could not be checked: ${r.error}`);
    continue;
  }
  /* a stray print or two at a boundary (a late report) is not a session */
  const real = r.gaps.filter(g => g.kind === 'scans a dead tape' || g.minutes > 2);
  if (!real.length) {
    clean += 1;
    continue;
  }
  noisy.push(`${r.name.padEnd(6)} exp ${r.expiry} (${r.dte ? '1+ DTE' : '0DTE'}) · traded in ${r.quoted} min · scanned ${r.scanned} min`);
  for (const g of real) noisy.push(`        ${g.kind.padEnd(19)} ${g.from} → ${g.to} ET (${g.minutes} min)`);
}
console.log(`\n${clean} of ${results.length} names: Compass's scan windows match when the market traded.`);
if (noisy.length) console.log(`\nDisagreements:\n${noisy.join('\n')}`);
if (process.env.COMPASS_HOURS_OUT) writeFileSync(process.env.COMPASS_HOURS_OUT, JSON.stringify({ day: DAY, prevDay, results }, null, 1));
