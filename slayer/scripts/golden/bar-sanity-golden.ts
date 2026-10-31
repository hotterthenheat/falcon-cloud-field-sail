/*
  The intraday bar-sanity rule (data/barSanity.ts, rebuilt from prints in data/thetaEligible.ts saneStockBars) on SPY
  bars recorded straight from the ThetaData terminal on 2026-10-31: one bad-print day and the fast real moves that
  must keep their shape.

  Bad prints (ThetaData's own bars, checked against /stock/history/trade by hand):
  - Fri 2026-10-23 after the close SPY traded at 761, yet six Form T reports from exchange 57 (conditions 4 and 115,
    which may not set the consolidated high, low or last) at 723.5739–787.5169 gave the 17:00 fifteen-minute bar a
    723.57–787.52 range, the 17:15 bar a low of 728.67 and the 17:30 bar a high of 768.06. Rebuilt from each bar's
    price-setting prints the 17:00 bar runs 760.8714–762.00, the 17:15 bar's low is 761.03 and the 17:30 bar's high
    761.14; the open, close and volume are the vendor's.
  - Mon 2024-08-05 08:00: a pre-market high of 532.90 (the prior close, a late report) under a 515–521 body; its
    price-setting prints reach 522.7596.

  Real moves that must survive:
  - every regular-session minute of 7, 9 and 10 April 2025 (the tariff crash and the 9 April 12% rally), the CPI
    mornings of 13 Sep and 10 Nov 2022 and the 5 Aug 2024 VIX spike: not one wick is cut;
  - Mon 2025-04-07 08:04 pre-market: the vendor's low is 479.47 and price-setting prints reach 480.00 — a real
    crash wick. It is flagged (the neighbouring bodies sit near 490), and rebuilt from its prints it keeps 480.00.

    Replay: npx tsx scripts/golden/bar-sanity-golden.ts
    Record: GOLDEN_RECORD=1 npx tsx scripts/golden/bar-sanity-golden.ts   (needs the terminal on 127.0.0.1:25503)
*/
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { badWicks, saneBars } from '../../src/data/barSanity';
import { saneStockBars } from '../../src/data/thetaEligible';
import { nyWallStamp } from '../../src/core/nyTime';
import type { Candle } from '../../src/types/market';

const RECORD = process.env.GOLDEN_RECORD === '1';
const FILE = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures', 'golden', 'bar-sanity', 'spy.json.gz');
const TERMINAL = 'http://127.0.0.1:25503/v3';

type Row = Record<string, unknown>;
type Saved = { bars: Record<string, Row[]>; trades: Record<string, Row[]> };

const WINS: Record<string, [string, string]> = { pre: ['04:00:00', '09:29:59.999'], rth: ['09:30:00', '15:59:59.999'], post: ['16:00:00', '19:59:59.999'] };
const CASES: { day: string; grain: '1m' | '15m'; step: number; sessions: string[] }[] = [
  { day: '20261023', grain: '15m', step: 900, sessions: ['post'] },
  { day: '20261023', grain: '1m', step: 60, sessions: ['rth'] },
  { day: '20250407', grain: '1m', step: 60, sessions: ['pre', 'rth'] },
  { day: '20250409', grain: '1m', step: 60, sessions: ['rth'] },
  { day: '20250410', grain: '1m', step: 60, sessions: ['rth'] },
  { day: '20220913', grain: '1m', step: 60, sessions: ['rth'] },
  { day: '20221110', grain: '1m', step: 60, sessions: ['rth'] },
  { day: '20240805', grain: '1m', step: 60, sessions: ['pre', 'rth'] },
];
const caseKey = (c: (typeof CASES)[number], s: string) => `${c.day}|${c.grain}|${s}`;

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
      saved.bars[caseKey(c, s)] = await terminal(`/stock/history/ohlc?symbol=SPY&start_date=${c.day}&end_date=${c.day}&interval=${c.grain}&start_time=${a}&end_time=${b}&format=json`);
    }
  /* the prints of every flagged bar, as saneStockBars asks for them */
  for (const c of CASES) {
    const bars = toBars(c.sessions.flatMap(s => saved.bars[caseKey(c, s)]));
    await saneStockBars(async path => {
      saved.trades[path] = await terminal(path);
      return { status: 200, data: saved.trades[path], error: null };
    }, 'SPY', c.step, bars);
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
const at = (bars: Candle[], hhmm: string) => bars.find(b => new Date(b.time * 1000).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }) === hhmm)!;
const near = (a: number, b: number, eps = 0.005) => Math.abs(a - b) <= eps;

for (const c of CASES) {
  const raw = toBars(c.sessions.flatMap(s => saved.bars[caseKey(c, s)]));
  const out = await saneStockBars(replay, 'SPY', c.step, raw);
  const cut = saneBars(raw);
  const label = `${c.day} ${c.grain} ${c.sessions.join('+')}`;
  check(`${label}: bars recorded`, raw.length >= 16, `${raw.length} bars`);
  check(
    `${label}: no bar added or dropped, every open, close and volume as it came`,
    out.length === raw.length && out.every((b, i) => b.time === raw[i].time && b.open === raw[i].open && b.close === raw[i].close && b.volume === raw[i].volume) &&
      cut.length === raw.length && cut.every((b, i) => b.open === raw[i].open && b.close === raw[i].close),
  );
  check(`${label}: every bar still holds its body`, out.every(b => b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close)));
  if (c.sessions.includes('rth')) {
    const rth = toBars(saved.bars[caseKey(c, 'rth')]);
    const cuts = badWicks(rth);
    check(`${label}: no regular-session wick is cut`, cuts.length === 0, cuts.map(x => `${x.side} ${x.was}`).join(', '));
  }
}

/* the bad prints of 23 Oct 2026 */
{
  const c = CASES[0];
  const raw = toBars(saved.bars[caseKey(c, 'post')]);
  const out = await saneStockBars(replay, 'SPY', c.step, raw);
  const r17 = at(raw, '17:00');
  const b17 = at(out, '17:00');
  const b1715 = at(out, '17:15');
  const b1730 = at(out, '17:30');
  check('2026-10-23 17:00 15m: the vendor bar is the bad print (723.57–787.52 under 761.04→761.08)', near(r17.high, 787.5169) && near(r17.low, 723.5739) && near(r17.open, 761.039) && near(r17.close, 761.08));
  check('2026-10-23 17:00 15m: high rebuilt from its prints', near(b17.high, 762), `${b17.high}`);
  check('2026-10-23 17:00 15m: low rebuilt from its prints', near(b17.low, 760.8714), `${b17.low}`);
  check('2026-10-23 17:15 15m: low 728.67 rebuilt from its prints', near(b1715.low, 761.03), `${b1715.low}`);
  check('2026-10-23 17:30 15m: high 768.06 rebuilt from its prints', near(at(raw, '17:30').high, 768.06) && near(b1730.high, 761.14), `${b1730.high}`);
  const offline = saneBars(raw);
  check('2026-10-23 17:00 15m with no prints: cut back to the body', near(at(offline, '17:00').high, 761.08) && near(at(offline, '17:00').low, 761.039));
  const hi = Math.max(...out.map(b => b.high));
  const lo = Math.min(...out.map(b => b.low));
  check('2026-10-23 after hours: the chart spans the market, not the bad prints', hi < 766 && lo > 756, `${lo}–${hi}`);
}

/* the real pre-market crash wick of 7 Apr 2025 */
{
  const c = CASES[2];
  const raw = toBars(c.sessions.flatMap(s => saved.bars[caseKey(c, s)]));
  const out = await saneStockBars(replay, 'SPY', c.step, raw);
  check('2025-04-07 08:04: the vendor low is 479.47', near(at(raw, '08:04').low, 479.47));
  check('2025-04-07 08:04: flagged, and its prints keep the real 480.00 low', near(at(out, '08:04').low, 480), `${at(out, '08:04').low}`);
}

/* the late report at the prior close on 5 Aug 2024 */
{
  const c = CASES[7];
  const raw = toBars(c.sessions.flatMap(s => saved.bars[caseKey(c, s)]));
  const out = await saneStockBars(replay, 'SPY', c.step, raw);
  check('2024-08-05 08:00: the vendor high is the prior close 532.90', near(at(raw, '08:00').high, 532.9));
  check('2024-08-05 08:00: rebuilt from its prints (522.7596)', near(at(out, '08:00').high, 522.7596), `${at(out, '08:00').high}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
