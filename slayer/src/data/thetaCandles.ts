/* The chart's bars off ThetaData. Every session is fetched. The chart draws every session that has a price, on one
   tape. A click on a session moves the view to that session; it does not throw the others away. A minute with no
   price is a gap. A zero bar is not a price. Overnight stock OHLC from this feed is zeros when no trade printed.
   A day and a week stay the cash day's own bar. */

import type { Candle } from '../types/market';
import type { DeskSession } from './deskSession';
import { aggregateCandles } from './timeframe';
import { offlineWords } from './thetaFeed';
import { nyParts } from '../core/nyTime';
import { extendTape, grainStep, paintPrint, peekPrint, peekTape, tapeOpenMinute, tapeReach, wantPrint, wantTape, type TapeGrain, type TapeRead } from './thetaTape';

/** Sessions a chart keeps warm. A bar is drawn only when that minute has a price. */
const CHART_SESSIONS: readonly DeskSession[] = ['overnight', 'pre', 'rth', 'post'];

/** The tape grain a timeframe (in minutes) is drawn from: the coarsest native ThetaData interval that divides it (5m and
    10m off 5-minute bars, 15m and 45m off 15-minute, 30m off 30-minute, 1h–12h off hourly), so a coarse chart reaches back
    months instead of folding a week of minutes. Finer bars are folded up to the interval. */
export const chartGrain = (mins: number): TapeGrain => {
  if (mins < 1) return '15s';
  if (mins < 1440) {
    if (mins % 60 === 0) return '1h';
    if (mins % 30 === 0) return '30m';
    if (mins % 15 === 0) return '15m';
    if (mins % 5 === 0) return '5m';
    return '1m';
  }
  if (mins >= 7 * 1440 && mins < 20 * 1440) return 'week';
  return 'day';
};

/** A grain's bar, minutes */
const GRAIN_MIN: Partial<Record<TapeGrain, number>> = { '15s': 0.25, '1m': 1, '5m': 5, '15m': 15, '30m': 30, '1h': 60 };

const cashGrain = (grain: TapeGrain): boolean => grain === 'day' || grain === 'week';

/** Keep a name's chart tapes fresh: every session's one-minute tape, the timeframe's grain when it is another, the print. */
export function wantChartTape(ticker: string, grain: TapeGrain, _session: DeskSession): (() => void)[] {
  const offs: (() => void)[] = [wantPrint(ticker)];
  for (const s of CHART_SESSIONS) offs.push(wantTape(ticker, '1m', s));
  if (cashGrain(grain)) offs.push(wantTape(ticker, grain, 'rth'));
  else if (grain !== '1m') for (const s of CHART_SESSIONS) offs.push(wantTape(ticker, grain, s));
  return offs;
}

const painted = new WeakMap<Candle[], { price: number; at: number; out: Candle[] }>();
function withPrint(t: TapeRead, ticker: string, grain: TapeGrain, session: DeskSession): Candle[] {
  const print = t.state === 'live' ? peekPrint(ticker) : null;
  if (!print || !t.bars.length) return t.bars;
  const hit = painted.get(t.bars);
  if (hit && hit.price === print.price && hit.at === print.at) return hit.out;
  const out = paintPrint(t.bars, print.price, print.at, grainStep(grain), session, ticker);
  painted.set(t.bars, { price: print.price, at: print.at, out });
  return out;
}

function dedupe(bars: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const prev = out[out.length - 1];
    /* Same minute in two sessions: keep the earlier one. Sessions do not overlap (on a half day 13:00–19:59 is the
       after-hours alone, thetaTape barInTape); this only guards a duplicated stamp. */
    if (prev && prev.time === b.time) continue;
    out.push(b);
  }
  return out;
}

function mergeInto(cur: Candle, b: Candle): void {
  cur.high = Math.max(cur.high, b.high);
  cur.low = Math.min(cur.low, b.low);
  cur.close = b.close;
  cur.volume += b.volume;
  cur.time = b.time;
}

/** Every `n` calendar days, anchored on the civil date so a new bar does not reshuffle the older ones. */
function foldCalendarDays(bars: Candle[], n: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curKey = '';
  for (const b of bars) {
    const p = nyParts(b.time * 1000);
    const serial = Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
    const key = String(Math.floor(serial / n));
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { ...b };
      curKey = key;
    } else if (cur) mergeInto(cur, b);
  }
  if (cur) out.push(cur);
  return out;
}

/** Month, quarter, half-year, or year, from daily bars. */
function foldCalendar(bars: Candle[], mins: number): Candle[] {
  const kind = mins >= 365 * 1440 ? 'y' : mins >= 180 * 1440 ? 'h' : mins >= 90 * 1440 ? 'q' : 'm';
  const out: Candle[] = [];
  let cur: Candle | null = null;
  let curKey = '';
  for (const b of bars) {
    const p = nyParts(b.time * 1000);
    const key = kind === 'y' ? `${p.year}` : kind === 'h' ? `${p.year}-${p.month <= 6 ? 1 : 2}` : kind === 'q' ? `${p.year}-q${Math.floor((p.month - 1) / 3)}` : `${p.year}-${p.month}`;
    if (key !== curKey) {
      if (cur) out.push(cur);
      cur = { ...b };
      curKey = key;
    } else if (cur) mergeInto(cur, b);
  }
  if (cur) out.push(cur);
  return out;
}

/** Fold a session's bars up to `mins`. A week is already a weekly bar. A day stays a day. */
export function shapeBars(raw: Candle[], mins: number, session: DeskSession, ticker: string): Candle[] {
  if (!raw.length) return raw;
  if (mins < 1440) {
    const step = GRAIN_MIN[chartGrain(mins)] ?? 1;
    /* each segment counts from its own open (timeframe.ts barBucket: 9:30, 4:00, the close — 13:00 on a half day); an index's
       overnight from 20:15 */
    return mins > step ? aggregateCandles(raw, mins, session === 'overnight' ? tapeOpenMinute(session, ticker) : undefined) : raw;
  }
  if (mins >= 7 * 1440 && mins < 20 * 1440) return raw;
  if (mins >= 3 * 1440 && mins < 7 * 1440) return foldCalendarDays(raw, 3);
  if (mins > 1440) return foldCalendar(raw, mins);
  return raw;
}

/** The bars a chart draws at `mins`. Every session that has a price, oldest first. `session` does not hide the others. */
export function thetaChartBars(ticker: string, mins: number, _session: DeskSession): Candle[] {
  const grain = chartGrain(mins);
  const sessions: readonly DeskSession[] = cashGrain(grain) ? ['rth'] : CHART_SESSIONS;
  const out: Candle[] = [];
  for (const s of sessions) {
    const raw = withPrint(peekTape(ticker, grain, s), ticker, grain, s);
    for (const b of shapeBars(raw, mins, s, ticker)) out.push(b);
  }
  out.sort((a, b) => a.time - b.time);
  return dedupe(out);
}

/** The chart reached its left edge: one older chunk for every session's tape of this timeframe's grain (each tape reads one
    chunk at a time; a tape at its data's start asks nothing). True when any was asked. */
export function extendChartTape(ticker: string, mins: number): boolean {
  const grain = chartGrain(mins);
  const sessions: readonly DeskSession[] = cashGrain(grain) ? ['rth'] : CHART_SESSIONS;
  let asked = false;
  for (const s of sessions) if (extendTape(ticker, grain, s)) asked = true;
  return asked;
}

/** Older bars are on their way for this chart (a backfill or a scroll-back chunk) */
export function chartTapeLoading(ticker: string, mins: number): boolean {
  const grain = chartGrain(mins);
  const sessions: readonly DeskSession[] = cashGrain(grain) ? ['rth'] : CHART_SESSIONS;
  return sessions.some(s => tapeReach(ticker, grain, s).loading);
}

/** What the chart says when it has nothing to draw. Null while any session still has bars, or a tape is still loading. */
export function thetaChartNote(ticker: string, mins: number, _session: DeskSession): string | null {
  const grain = chartGrain(mins);
  const sessions: readonly DeskSession[] = cashGrain(grain) ? ['rth'] : CHART_SESSIONS;
  const reads = sessions.map(s => peekTape(ticker, grain, s));
  if (reads.some(t => t.bars.length > 0)) return null;
  if (reads.some(t => t.state === 'loading' || t.takenAt === 0)) return null;
  const down = reads.find(t => t.state === 'offline');
  if (down) return offlineWords(down.takenAt);
  return 'No prints on this name.';
}
