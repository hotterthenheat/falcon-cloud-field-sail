/* The chart's bars off ThetaData (data/thetaTape.ts) for every desk but Pinpoint and the Dossier: intraday timeframes
   fold the one-minute tape (so the exposure beads, stamped per minute, land on the same buckets), 15 seconds is its own
   grain, a day and a week are the EOD rows. The live print paints the forming bar. */

import type { Candle } from '../types/market';
import type { DeskSession } from './deskSession';
import { aggregateCandles } from './timeframe';
import { grainStep, paintPrint, peekPrint, peekTape, tapeWords, wantPrint, wantTape, type TapeGrain, type TapeRead } from './thetaTape';

/** The tape grain a timeframe (in minutes) is drawn from. */
export const chartGrain = (mins: number): TapeGrain => (mins < 1 ? '15s' : mins <= 60 ? '1m' : mins <= 1440 ? 'day' : 'week');

/** Keep a name's chart tapes fresh: the one-minute tape always, the timeframe's grain when it is another, the print. */
export function wantChartTape(ticker: string, grain: TapeGrain, session: DeskSession): (() => void)[] {
  const offs = [wantTape(ticker, '1m', session), wantPrint(ticker)];
  if (grain !== '1m') offs.push(wantTape(ticker, grain, session));
  return offs;
}

/* One painted copy per tape read and print, so a pane's many effects fold the same array (aggregateCandles keeps its
   folds per base array). */
const painted = new WeakMap<Candle[], { price: number; at: number; out: Candle[] }>();
function withPrint(t: TapeRead, ticker: string, grain: TapeGrain, session: DeskSession): Candle[] {
  const print = t.state === 'live' ? peekPrint(ticker) : null;
  if (!print || !t.bars.length) return t.bars;
  const hit = painted.get(t.bars);
  if (hit && hit.price === print.price && hit.at === print.at) return hit.out;
  const out = paintPrint(t.bars, print.price, print.at, grainStep(grain), session);
  painted.set(t.bars, { price: print.price, at: print.at, out });
  return out;
}

/** The bars a chart draws at `mins` in a session. Empty until the tape lands. */
export function thetaChartBars(ticker: string, mins: number, session: DeskSession): Candle[] {
  const grain = chartGrain(mins);
  const bars = withPrint(peekTape(ticker, grain, session), ticker, grain, session);
  return grain === '1m' ? aggregateCandles(bars, mins) : bars;
}

/** What the chart says over its bars: kept, offline, or an empty session. Null while live with bars, or still loading. */
export function thetaChartNote(ticker: string, mins: number, session: DeskSession): string | null {
  return tapeWords(peekTape(ticker, chartGrain(mins), session), session);
}
