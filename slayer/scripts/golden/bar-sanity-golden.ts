/*
  The intraday bar-sanity rule (data/barSanity.ts, rebuilt from prints in data/thetaEligible.ts saneStockBars) on bars
  recorded straight from the ThetaData terminal on 2026-10-31: one bad-print day and the fast real moves that must keep
  their shape.

  Bad prints (ThetaData's own bars, checked against /stock/history/trade by hand):
  - Fri 2026-10-23 after the close SPY traded at 761, yet six Form T reports from exchange 57 (conditions 4 and 115,
    which may not set the consolidated high, low or last) at 723.5739–787.5169 gave the 17:00 fifteen-minute bar a
    723.57–787.52 range, the 17:15 bar a low of 728.67 and the 17:30 bar a high of 768.06; the 17:01 one-minute bar
    closed on one of them at 728.6713 (the next minute opened at 761.01). Rebuilt from each bar's price-setting prints
    the 17:00 bar runs 760.8714–762.00, the 17:15 bar's low is 761.03, the 17:30 bar's high 761.14, and the 17:01
    minute closes at its one price-setting print, 760.95; three more minutes (17:40–17:42) opened or closed on 767.61–
    768.01 prints of the same venue and come back to 761.03–761.05.
  - Mon 2024-08-05 08:00: a pre-market high of 532.90 (the prior close, a late report) under a 515–521 body; its
    price-setting prints reach 522.7596.

  Real moves that must survive:
  - every regular-session minute of 7, 9 and 10 April 2025 (the tariff crash and the 9 April 12% rally), the CPI
    mornings of 13 Sep and 10 Nov 2022 and the 5 Aug 2024 VIX spike: nothing is touched;
  - GME's open on Tue 2024-05-14 at 64.83 over Monday's 30.45 close, then halted: the session's first bar is never
    held against the day before;
  - Mon 2025-04-07 08:04 pre-market: the vendor's low is 479.47 and price-setting prints reach 480.00 — a real
    crash wick. It is flagged (the neighbouring bodies sit near 490), and rebuilt from its prints it keeps 480.00.

    Replay: npx tsx scripts/golden/bar-sanity-golden.ts
    Record: GOLDEN_RECORD=1 npx tsx scripts/golden/bar-sanity-golden.ts   (needs the terminal on 127.0.0.1:25503)
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { badBars, saneBars } from '../../src/data/barSanity';
import { saneStockBars } from '../../src/data/thetaEligible';
import { nyWallStamp } from '../../src/core/nyTime';
import type { Candle } from '../../src/types/market';

const RECORD = process.env.GOLDEN_RECORD === '1';
const FILE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', 'bar-sanity', 'bars.json.gz');
const TERMINAL = 'http://127.0.0.1:25503/v3';

type Row = Record<string, unknown>;
type Saved = { bars: Record<string, Row[]>; trades: Record<string, Row[]> };

const WINS: Record<string, [string, string]> = { pre: ['04:00:00', '09:29:59.999'], rth: ['09:30:00', '15:59:59.999'], post: ['16:00:00', '19:59:59.999'] };
type Case = { sym: string; from: string; to: string; grain: '1m' | '15m'; step: number; sessions: string[] };
const CASES: Case[] = [
  { sym: 'SPY', from: '20261023', to: '20261023', grain: '15m', step: 900, sessions: ['post'] },
  { sym: 'SPY', from: '20261023', to: '20261023', grain: '1m', step: 60, sessions: ['rth', 'post'] },
  { sym: 'SPY', from: '20250407', to: '20250407', grain: '1m', step: 60, sessions: ['pre', 'rth'] },
  { sym: 'SPY', from: '20250409', to: '20250409', grain: '1m', step: 60, sessions: ['rth'] },
  { sym: 'SPY', from: '20250410', to: '20250410', grain: '1m', step: 60, sessions: ['rth'] },
  { sym: 'SPY', from: '20220913', to: '20220913', grain: '1m', step: 60, sessions: ['rth'] },
  { sym: 'SPY', from: '20221110', to: '20221110', grain: '1m', step: 60, sessions: ['rth'] },
  { sym: 'SPY', from: '20240805', to: '20240805', grain: '1m', step: 60, sessions: ['pre', 'rth'] },
  { sym: 'GME', from: '20240513', to: '20240514', grain: '1m', step: 60, sessions: ['rth'] },
];
const caseKey = (c: Case, s: string) => `${c.sym}|${c.from}|${c.to}|${c.grain}|${s}`;
const label = (c: Case) => `${c.sym} ${c.from}${c.to !== c.from ? `–${c.to}` : ''} ${c.grain} ${c.sessions.join('+')}`;

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const toBars = (rows: Row[]): Candle[] =>
  rows
    .map(r => ({ time: Math.floor(nyWallStamp(r.timestamp) / 1000), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close), volume: Number(r.volume) }))
    .filter(b => b.time > 0 && b.open > 0 && b.high > 0 && b.low > 0 && b.close > 0)
    .sort((a, b) => a.time - b.time);
const barsOf = (c: Case) => toBars(c.sessions.flatMap(s => saved.bars[caseKey(c, s)] ?? []));

async function terminal(path: string): Promise<Row[]> {
  const r = await fetch(`${TERMINAL}${path.replace('format=csv', 'format=json')}`);
  if (!r.ok) return [];
  const j = (await r.json()) as { response?: Row[] };
  return j.response ?? [];
}

let saved: Saved;
if (RECORD) {
  saved = { bars: {}, trades: {} };
  for (const c of CASES)
    for (const s of c.sessions) {
      const [a, b] = WINS[s];
      saved.bars[caseKey(c, s)] = await terminal(`/stock/history/ohlc?symbol=${c.sym}&start_date=${c.from}&end_date=${c.to}&interval=${c.grain}&start_time=${a}&end_time=${b}&format=json`);
    }
  /* the prints of every flagged bar, as saneStockBars asks for them */
  for (const c of CASES) {
    await saneStockBars(async path => {
      saved.trades[path] = await terminal(path);
      return { status: 200, data: saved.trades[path], error: null };
    }, c.sym, c.step, barsOf(c));
  }
  mkdirSync(join(FILE, '..'), { recursive: true });
  writeFileSync(FILE, gzipSync(JSON.stringify(saved)));
  console.log(`recorded ${Object.keys(saved.bars).length} bar reads and ${Object.keys(saved.trades).length} print reads`);
} else {
  if (!existsSync(FILE)) {
    console.log('SKIP  bar-sanity fixtures are not recorded: GOLDEN_RECORD=1 npx tsx scripts/golden/bar-sanity-golden.ts');
    process.exit(0);
  }
  saved = JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8')) as Saved;
}

const replay = async (path: string) => {
  const rows = saved.trades[path];
  return rows ? { status: 200, data: rows as unknown, error: null } : { status: 0, data: null, error: 'not recorded' };
};
const hmOf = (b: Candle) => new Date(b.time * 1000).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
const dayOf = (b: Candle) => new Date(b.time * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const at = (bars: Candle[], hhmm: string, day?: string) => bars.find(b => hmOf(b) === hhmm && (!day || dayOf(b) === day))!;
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;

for (const c of CASES) {
  const raw = barsOf(c);
  const out = await saneStockBars(replay, c.sym, c.step, raw);
  const cut = saneBars(raw);
  check(`${label(c)}: bars recorded`, raw.length >= 16, `${raw.length} bars`);
  check(`${label(c)}: no bar added or dropped, every volume as it came`, out.length === raw.length && cut.length === raw.length && out.every((b, i) => b.time === raw[i].time && b.volume === raw[i].volume));
  check(`${label(c)}: every bar holds its body`, [out, cut].every(bs => bs.every(b => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close))));
  if (c.sessions.includes('rth')) {
    const rth = toBars(saved.bars[caseKey(c, 'rth')]);
    const fixes = badBars(rth);
    check(`${label(c)}: nothing in the regular session is touched`, fixes.length === 0, fixes.map(x => `${x.field} ${x.was}`).join(', '));
  }
}

/* the bad prints of 23 Oct 2026 */
{
  const raw = barsOf(CASES[0]);
  const out = await saneStockBars(replay, 'SPY', 900, raw);
  const r17 = at(raw, '17:00');
  const b17 = at(out, '17:00');
  const b1715 = at(out, '17:15');
  const b1730 = at(out, '17:30');
  check('2026-10-23 17:00 15m: the vendor bar is the bad print (723.57–787.52 under 761.04→761.08)', near(r17.high, 787.5169) && near(r17.low, 723.5739) && near(r17.open, 761.039) && near(r17.close, 761.08));
  check('2026-10-23 17:00 15m: rebuilt from its prints, 760.8714–762.00, body as it came', near(b17.high, 762) && near(b17.low, 760.8714) && b17.open === r17.open && b17.close === r17.close, `${b17.low}–${b17.high}`);
  check('2026-10-23 17:15 15m: low 728.67 rebuilt from its prints (761.03)', near(b1715.low, 761.03), `${b1715.low}`);
  check('2026-10-23 17:30 15m: high 768.06 rebuilt from its prints (761.14)', near(at(raw, '17:30').high, 768.06) && near(b1730.high, 761.14), `${b1730.high}`);
  const offline = saneBars(raw);
  check('2026-10-23 17:00 15m with no prints: cut back to the body', near(at(offline, '17:00').high, 761.08) && near(at(offline, '17:00').low, 761.039));
  const hi = Math.max(...out.map(b => b.high));
  const lo = Math.min(...out.map(b => b.low));
  check('2026-10-23 after hours, 15m: the chart spans the market, not the bad prints', hi < 766 && lo > 756, `${lo}–${hi}`);
}
{
  const raw = barsOf(CASES[1]);
  const out = await saneStockBars(replay, 'SPY', 60, raw);
  const r = at(raw, '17:01');
  const b = at(out, '17:01');
  check('2026-10-23 17:01 1m: the vendor minute closes on a bad print (728.6713)', near(r.close, 728.6713) && near(at(raw, '17:02').open, 761.01));
  check('2026-10-23 17:01 1m: its close and low rebuilt from its one price-setting print (760.95)', near(b.close, 760.95) && b.low > 760 && near(b.open, r.open), `o${b.open} h${b.high} l${b.low} c${b.close}`);
  const off = at(saneBars(raw), '17:01');
  check('2026-10-23 17:01 1m with no prints: the close takes the next open (761.01)', near(off.close, 761.01) && off.low > 760, `l${off.low} c${off.close}`);
  const run = ['17:40', '17:41', '17:42'].map(t => at(out, t));
  check('2026-10-23 17:40–17:42 1m: three minutes on the venue\'s 767.6–768.06 prints come back to the market', run.every(x => x.high < 762 && x.open < 762 && x.close < 762), run.map(x => `o${x.open} h${x.high} c${x.close}`).join(' · '));
  const post = out.filter(x => hmOf(x) >= '16:00');
  const hi = Math.max(...post.map(x => x.high));
  const lo = Math.min(...post.map(x => x.low));
  check('2026-10-23 after hours, 1m: the chart spans the market, not the bad prints', hi < 766 && lo > 756, `${lo}–${hi}`);
}

/* the real pre-market crash wick of 7 Apr 2025 */
{
  const raw = barsOf(CASES[2]);
  const out = await saneStockBars(replay, 'SPY', 60, raw);
  check('2025-04-07 08:04: the vendor low is 479.47', near(at(raw, '08:04').low, 479.47));
  check('2025-04-07 08:04: flagged, and its prints keep the real 480.00 low', near(at(out, '08:04').low, 480), `${at(out, '08:04').low}`);
}

/* the late report at the prior close on 5 Aug 2024 */
{
  const raw = barsOf(CASES[7]);
  const out = await saneStockBars(replay, 'SPY', 60, raw);
  check('2024-08-05 08:00: the vendor high is the prior close 532.90', near(at(raw, '08:00').high, 532.9));
  check('2024-08-05 08:00: rebuilt from its prints (522.7596)', near(at(out, '08:00').high, 522.7596), `${at(out, '08:00').high}`);
}

/* GME's opening gap on 14 May 2024 */
{
  const raw = barsOf(CASES[8]);
  const open = at(raw, '09:30', '2024-05-14');
  check('GME 2024-05-14 09:30: the vendor bar opens at 64.83 over a 30.45 close', near(open.open, 64.83) && near(at(raw, '15:59', '2024-05-13').close, 30.45, 0.05));
  const keep = (bs: Candle[]) => at(bs, '09:30', '2024-05-14');
  const out = keep(await saneStockBars(replay, 'GME', 60, raw));
  const off = keep(saneBars(raw));
  check('GME 2024-05-14 09:30: the opening gap is kept as it came', [out, off].every(b => b.open === open.open && b.high === open.high && b.low === open.low && b.close === open.close));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
