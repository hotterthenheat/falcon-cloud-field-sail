import { sessionCloseMinOn } from '../core/calendar';
import { SESSION_OPEN_MIN, nyIsoDate, nyMinutes } from '../core/nyTime';
import { sessionStarts, tradingDayKey } from './indicators';
import type { Candle } from '../types/market';

/*
==================================================
  SLAYER TERMINAL - SESSION LEVELS (data/sessionLevels.ts)

  The reference prices every intraday reader draws
  by hand before the open.
==================================================

  WHAT IS HERE, AND WHAT IS DELIBERATELY NOT.

    prior day high · low · close      the previous trading day's CASH session
    opening range high · low          the first 5, 15 or 30 minutes from 9:30
    initial balance high · low        the first hour from 9:30

  The cash session is 09:30 New York to that day's close (16:00, or 13:00 on
  an early close). Premarket, after-hours and the overnight are on the tape
  and they are not these levels. A 4:00 spike is not the opening range, and
  it is not yesterday's high.

  OVERNIGHT HIGH AND LOW ARE NOT HERE. They are a different session. Drawing
  them from the same bars and calling them PDH would be a level the name does
  not claim.

  BY THE CLOCK, NOT BY BAR COUNT. "The first fifteen minutes" starts at 9:30,
  not at the first bar in the file. A halt inside the window leaves a hole;
  the high is the high of the bars that printed, and the clock still says
  whether the window has closed.

  A FORMING RANGE IS SAID TO BE FORMING. At 09:33 the fifteen-minute opening
  range exists but is not finished. `orComplete` is that. The running range
  is still returned, because that is the useful thing during the range.

  THE DAY BOUNDARY is `sessionStarts` (the New York trading day, the evening
  from 20:00 joined to the session it opens) — the same cut the VWAP uses.
  The cash filter is applied inside that day, so the prior day and the VWAP
  still change on the same bar.
*/

/** The three opening ranges the desk offers. Minutes from the open. */
export type OpeningRange = 5 | 15 | 30;
export const OPENING_RANGES: readonly OpeningRange[] = [5, 15, 30];

/** The initial balance is the first hour. It is not configurable — the noun
    means the first hour, and a 40-minute "initial balance" is a different
    thing wearing a borrowed name. */
export const INITIAL_BALANCE_MIN = 60;

export type SessionLevelKey = 'prevHigh' | 'prevLow' | 'prevClose' | 'orHigh' | 'orLow' | 'ibHigh' | 'ibLow';

export interface SessionLevel {
  key: SessionLevelKey;
  /** The shorthand a chart is labelled with — PDH, ORL, IBH. */
  tag: string;
  price: number;
}

export interface SessionLevels {
  levels: SessionLevel[];
  /** The opening range asked for, echoed so a caller can label it `OR15`. */
  orMinutes: OpeningRange;
  /** Minutes of it elapsed so far, capped at `orMinutes`. */
  orElapsed: number;
  orComplete: boolean;
  ibElapsed: number;
  ibComplete: boolean;
  /** First bar time of the session these were cut from; null with no data. */
  sessionStart: number | null;
  /** Whether a prior session existed to take PDH/PDL/PDC from. */
  hasPrior: boolean;
}

const TAGS: Record<SessionLevelKey, string> = {
  prevHigh: 'PDH',
  prevLow: 'PDL',
  prevClose: 'PDC',
  orHigh: 'ORH',
  orLow: 'ORL',
  ibHigh: 'IBH',
  ibLow: 'IBL',
};

const empty = (orMinutes: OpeningRange): SessionLevels => ({
  levels: [],
  orMinutes,
  orElapsed: 0,
  orComplete: false,
  ibElapsed: 0,
  ibComplete: false,
  sessionStart: null,
  hasPrior: false,
});

/** High and low of a slice, or null on an empty one. */
function extent(bars: readonly Candle[]): { high: number; low: number } | null {
  if (bars.length === 0) return null;
  let high = bars[0].high;
  let low = bars[0].low;
  for (const b of bars) {
    if (b.high > high) high = b.high;
    if (b.low < low) low = b.low;
  }
  return { high, low };
}

/** yyyymmdd from `tradingDayKey` as YYYY-MM-DD — the cash session's calendar date. */
function dayIso(key: number): string {
  const y = Math.floor(key / 10_000);
  const m = Math.floor((key % 10_000) / 100);
  const d = key % 100;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Bars inside the cash session of their own trading day. */
function cashOf(bars: readonly Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const b of bars) {
    const ms = b.time * 1000;
    const iso = nyIsoDate(ms);
    if (iso !== dayIso(tradingDayKey(b.time))) continue;
    const minute = nyMinutes(ms);
    if (minute >= SESSION_OPEN_MIN && minute < sessionCloseMinOn(iso)) out.push(b);
  }
  return out;
}

/** Minutes since 9:30, counting the opening minute. 0 before the cash date's open. */
function cashElapsed(last: Candle, dayKey: number): number {
  const ms = last.time * 1000;
  if (nyIsoDate(ms) !== dayIso(dayKey)) return 0;
  const minute = nyMinutes(ms);
  if (minute < SESSION_OPEN_MIN) return 0;
  return minute - SESSION_OPEN_MIN + 1;
}

/**
 * The session's reference levels, from a symbol's 1-minute base bars.
 *
 * `base` is the RAW 1-minute series, never an aggregated one: a 15-minute bar
 * cannot answer what the first five minutes did, and handing this an
 * aggregated series would silently round every level to that interval.
 */
export function buildSessionLevels(base: readonly Candle[], orMinutes: OpeningRange): SessionLevels {
  if (base.length === 0) return empty(orMinutes);
  const starts = sessionStarts(base, 1);
  const cur = starts[starts.length - 1];
  const prior = starts.length >= 2 ? starts[starts.length - 2] : null;

  const curBars = base.slice(cur);
  const curCash = cashOf(curBars);
  const dayKey = tradingDayKey(curBars[0].time);
  const elapsed = cashElapsed(curBars[curBars.length - 1], dayKey);

  const levels: SessionLevel[] = [];
  const put = (key: SessionLevelKey, price: number | null | undefined) => {
    if (typeof price === 'number' && Number.isFinite(price)) levels.push({ key, tag: TAGS[key], price });
  };

  let hasPrior = false;
  if (prior !== null) {
    const priorCash = cashOf(base.slice(prior, cur));
    const e = extent(priorCash);
    if (e && priorCash.length) {
      hasPrior = true;
      put('prevHigh', e.high);
      put('prevLow', e.low);
      put('prevClose', priorCash[priorCash.length - 1].close);
    }
  }

  const within = (minutes: number) => curCash.filter(b => nyMinutes(b.time * 1000) - SESSION_OPEN_MIN < minutes);
  const or = extent(within(orMinutes));
  put('orHigh', or?.high);
  put('orLow', or?.low);
  const ib = extent(within(INITIAL_BALANCE_MIN));
  put('ibHigh', ib?.high);
  put('ibLow', ib?.low);

  return {
    levels,
    orMinutes,
    orElapsed: Math.min(orMinutes, elapsed),
    orComplete: elapsed >= orMinutes,
    ibElapsed: Math.min(INITIAL_BALANCE_MIN, elapsed),
    ibComplete: elapsed >= INITIAL_BALANCE_MIN,
    sessionStart: curCash[0]?.time ?? curBars[0].time,
    hasPrior,
  };
}
