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
  smaSeries,
  vwapSeries,
} from '../src/data/indicators';
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
check('ema sma vwap', ema.length === 80 && ema.every(n => n > 0) && sma.filter(n => n != null).length > 40 && vwap.every(n => n > 0));
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
