/*
  The chart's own numbers, without a browser.

  Every built-in Pine script has to compile and run, on a book and on a
  pane that has no walls. The native studies, including the four book
  lines, have to return a series or an honest blank. The cone has to
  draw from a vol and stay empty without one.
*/
import { builtinScripts } from '../src/data/builtinScripts';
import { runSource } from '../src/core/pine';
import type { Bar } from '../src/core/pine/types';
import {
  atrBarSeries,
  bollingerSeries,
  emaSeries,
  flowVwapSeries,
  gammaEmaSeries,
  gammaVwapSeries,
  macdSeries,
  rsiSeries,
  sessionStarts,
  smaSeries,
  vwapSeries,
  alignScalar,
} from '../src/data/indicators';
import { sessionAtr } from '../src/data/atr';
import { volumeProfileAt } from '../src/data/volumeProfile';
import { buildExpectedMoveCone, daySigmaOfIv, sigmaFracOver, sigmaOverMinutes } from '../src/data/expectedMove';
import { sigmaToExpiry } from '../src/core/volClock';
import { nyWallTime } from '../src/core/nyTime';
import { vendorVol } from '../src/data/coneFeed';
import type { Candle } from '../src/types/market';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  ok ? pass++ : fail++;
};

const bars: Bar[] = [];
const candles: Candle[] = [];
for (let i = 0; i < 80; i++) {
  const close = 100 + Math.sin(i / 6) * 2 + i * 0.05;
  const open = close - 0.2;
  const high = close + 0.4;
  const low = close - 0.5;
  const time = 1_700_000_000 + i * 60;
  const volume = 1000 + (i % 5) * 200;
  bars.push({ time, open, high, low, close, volume });
  candles.push({ time, open, high, low, close, volume });
}

const slayer = { callWall: 110, putWall: 95, flip: 101, supreme: 108, netGex: bars.map((_, i) => (i % 3 === 1 ? Number.NaN : (i - 40) * 1e6)) };

const scripts = builtinScripts();
check('every built-in compiles', scripts.length >= 20 && scripts.every(s => s.status === 'ok'), scripts.filter(s => s.status !== 'ok').map(s => `${s.title}: ${s.error?.message}`).join('; '));

for (const s of scripts) {
  let threw = '';
  try {
    runSource(s.source, bars, { slayer, timeframe: '1' });
    runSource(s.source, bars, { timeframe: '1' });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  check(`pine ${s.title}`, threw === '', threw);
}

const walls = scripts.find(s => s.id === 'builtin:walls');
const above = runSource(walls!.source, bars, { slayer, timeframe: '1' });
const fill = above.fills[0];
const under = bars.findIndex(b => b.close < slayer.flip);
const over = bars.findIndex(b => b.close > slayer.flip);
check('corridor only above the flip', !!fill && under >= 0 && over >= 0 && fill.colors?.[under] == null && fill.colors?.[over] != null);

const gex = runSource(`//@version=6
indicator("net")
plot(slayer.netGex)`, bars, { slayer, timeframe: '1' });
const series = gex.plots[0]?.values;
check('net gamma is the minute, and a gap stays blank', !!series && series[0] === slayer.netGex[0] && Number.isNaN(series[1]));

const ema = emaSeries(candles, 9);
const sma = smaSeries(candles, 20);
const vwap = vwapSeries(candles, 1);
const rsi = rsiSeries(candles, 14);
const macd = macdSeries(candles);
const bb = bollingerSeries(candles);
const atr = atrBarSeries(candles);
check('ema sma vwap', ema.length === 80 && ema.slice(0, 8).every(n => n == null) && ema.slice(8).every(n => n != null && n > 0) && sma.filter(n => n != null).length > 40 && vwap.every(n => n > 0));
check('rsi macd bands atr', rsi[rsi.length - 1] != null && macd.macd.length === 80 && bb.upper[bb.upper.length - 1]! > bb.lower[bb.lower.length - 1]! && atr[atr.length - 1] != null);

const quiet = flowVwapSeries(candles, 1, candles.map((_, i) => (i < 3 ? 10 : 0)));
check('a quiet bar does not move flow vwap', quiet[2] != null && quiet[3] === quiet[2]);
const flat = gammaEmaSeries(candles, candles.map(() => 5));
check('flat gamma stays blank', flat.every(v => v == null));
const moving = candles.map((_, i) => (i % 2 === 0 ? 1e6 : 4e6));
const gEma = gammaEmaSeries(candles, moving);
const gVwap = gammaVwapSeries(candles, 1, moving);
check('a moving book draws gamma ema and gamma vwap', gEma.some(v => v != null) && gVwap.some(v => v != null));

const cone = buildExpectedMoveCone(candles.slice(0, 30), 0.2, 120, 1);
check('cone has an envelope and a forward half', cone.past.length === 30 && cone.forward.length > 1 && cone.forward[0].up1 > 0);
const blank = buildExpectedMoveCone(candles.slice(0, 5), 0, 120, 1);
check('no vol means no cone', blank.past.length === 0 && blank.forward.length === 0);

/* TradingView's conventions, the same as the Pine interpreter's (core/pine/ta.ts) */
{
  const ramp: Candle[] = Array.from({ length: 40 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: i + 1, high: i + 1.5, low: i + 0.5, close: i + 1, volume: 1 }));
  const e3 = emaSeries(ramp, 3);
  check('ta.ema: null, null, the SMA of the first 3 closes (2), then α = ½ (3) — was 1, 1.5, 2.25', e3[0] == null && e3[1] == null && e3[2] === 2 && e3[3] === 3, JSON.stringify(e3.slice(0, 4)));
  const m = macdSeries(ramp, 12, 26, 9);
  check('ta.macd: the line from bar 25, the signal from bar 33', m.macd[24] == null && m.macd[25] != null && m.signal[32] == null && m.signal[33] != null);
  const a = atrBarSeries(ramp, 14);
  /* bar 0's true range is its high − low (1); every later one reaches back to the prior close (1.5) */
  check('ta.atr: seeded on bar 13 with the mean of 14 true ranges, the first one high − low', a[12] == null && Math.abs((a[13] ?? 0) - (1 + 13 * 1.5) / 14) < 1e-12, String(a[13]));
  const flatBars: Candle[] = Array.from({ length: 20 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 5, high: 5, low: 5, close: 5, volume: 1 }));
  check('ta.rsi: a flat window reads 100 (Pine), not 50', rsiSeries(flatBars, 14)[19] === 100);
  const pts = alignScalar([{ time: 0 }, { time: 60 }], [{ time: 0, value: 1 }, { time: 60, value: 2 }], 60);
  check('alignScalar: a point stamped on the next bar\'s open is the next bar\'s', pts[0] === 1 && pts[1] === 2, JSON.stringify(pts));
}

/* a session is a New York trading day, not a silence: one missing minute does not reset the VWAP */
{
  const open = nyWallTime(2026, 10, 28, 9, 30) / 1000;
  const day: Candle[] = [];
  for (let i = 0; i < 390; i++) {
    if (i === 200) continue; // the missing minute
    const px = 100 + i * 0.01;
    day.push({ time: open + i * 60, open: px, high: px, low: px, close: px, volume: 1000 });
  }
  const want = day.reduce((a, b) => a + b.close, 0) / day.length;
  const v = vwapSeries(day, 1);
  check('EOD VWAP with one missing 1m bar is the whole day\'s ($101.95), not the afternoon\'s ($102.95)', Math.abs(v[v.length - 1] - want) < 1e-9 && Math.abs(want - 101.95) < 0.01, v[v.length - 1].toFixed(2));
  check('one session in that day', sessionStarts(day, 1).length === 1);
  const eve = nyWallTime(2026, 10, 27, 20, 0) / 1000;
  const late = nyWallTime(2026, 10, 28, 2, 0) / 1000;
  const cash = nyWallTime(2026, 10, 28, 9, 30) / 1000;
  const next = nyWallTime(2026, 10, 29, 9, 30) / 1000;
  const tape = [eve, late, cash, next].map(time => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
  check('the overnight from 20:00 is the next day\'s; the next cash open starts a new one', JSON.stringify(sessionStarts(tape, 1)) === '[0,3]', JSON.stringify(sessionStarts(tape, 1)));
  /* 16 sessions of 1m bars, each missing a minute: the session ATR is 15 full days, not 30 half days */
  const many: Candle[] = [];
  for (let d = 0; d < 16; d++) {
    const t0 = nyWallTime(2026, 9, 1 + d + Math.floor(d / 5) * 2, 9, 30) / 1000;
    for (let i = 0; i < 390; i++) if (i !== 100) many.push({ time: t0 + i * 60, open: 100, high: 100 + (i === 50 ? 2 : 0), low: 100 - (i === 300 ? 2 : 0), close: 100, volume: 1 });
  }
  check('session ATR reads the day\'s range ($4), not half-days', Math.abs((sessionAtr(many) ?? 0) - 4) < 1e-9, String(sessionAtr(many)));
}

/* the value area: two rows at a time (CBOT). Rows 1..4 hold 9, 1, 20, 6; the POC is 3.5. One row at a time took the 6 above
   (26 of 36 ≥ 70%) for 3–5; the pair below (1 + 9 = 10) outweighs the one row above (6), so the area is 1–4. */
{
  const at = (px: number, volume: number): Candle => ({ time: 0, open: px, high: px, low: px, close: 3.5, volume });
  const vp = volumeProfileAt([at(1.5, 9), at(2.5, 1), at(3.5, 20), at(4.5, 6)], 1);
  check('value area annexes the heavier pair of rows: VAL 1, VAH 4 (was 3, 5)', vp.vpoc === 3.5 && vp.val === 1 && vp.vah === 4, `${vp.val}..${vp.vah}`);
}

/* one σ everywhere: core/volClock's, the one Terrain's cone draws (S·σ_trading·√(minutes/(390·252))) */
{
  const noon = nyWallTime(2026, 10, 28, 12, 0);
  const odte = sigmaOverMinutes(daySigmaOfIv(600, 0.2, '2026-10-28', noon) ?? 0, 240);
  const truth = sigmaToExpiry(600, 0.2, '2026-10-28', noon) ?? 0;
  check('0DTE 20% at S=600, noon: the odds read $2.56 to the close, as Terrain does (was $4.93)', Math.abs(odte - 2.564) < 0.01 && Math.abs(odte - truth) < 1e-6, `$${odte.toFixed(2)}`);
  const day30 = daySigmaOfIv(600, 0.2, null, noon) ?? 0;
  check('a 30-day 20% vol over one session at S=600 is ≈ $7.49, not 600·0.2·√(1/365) = $6.28', Math.abs(day30 - 7.485) < 0.01, `$${day30.toFixed(2)}`);
  check('sigmaFracOver is the same σ per dollar', Math.abs(600 * sigmaFracOver(0.2, 240, '2026-10-28', noon) - truth) < 1e-6);
  check('a vendor vol is read as the fraction it is: 3.2 is 320% (was 3.2%)', vendorVol(3.2) === 3.2 && vendorVol(0.18) === 0.18 && vendorVol(-1) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
