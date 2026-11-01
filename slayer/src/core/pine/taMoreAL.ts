/* More of Pine's `ta.*` — the A to L built-in indicators lean on these (2026-11-01): ta.cmo, ta.kc, ta.kcw.
   Wired from builtins.ts in two lines: SIG_AL merges into the signatures, callMoreAL answers before the "not in this version" stop.
   Same conventions as ta.ts: `na` is NaN, a window not yet full answers NaN, each call site owns its `state`. */

import * as ta from './ta';
import { PineError, type Tuple, type Value } from './types';

type State = Record<string, unknown>;

/** Argument names, in order, for the calls below */
export const SIG_AL: Record<string, string[]> = {
  'ta.cmo': ['series', 'length'],
  'ta.kc': ['series', 'length', 'mult', 'useTrueRange'],
  'ta.kcw': ['series', 'length', 'mult', 'useTrueRange'],
};

/* ---- the maths ------------------------------------------------------------------- */

/** Chande momentum: 100 · (Σup − Σdown) / (Σup + Σdown) over the last `len` one-bar changes */
export function cmo(s: State, src: number, len: number): number {
  const prev = s.p as number | undefined;
  s.p = src;
  const ch = prev === undefined ? NaN : src - prev;
  const up = ta.sum((s.u as State) ?? (s.u = {}), Number.isNaN(ch) ? NaN : ch >= 0 ? ch : 0, len);
  const down = ta.sum((s.d as State) ?? (s.d = {}), Number.isNaN(ch) ? NaN : ch >= 0 ? 0 : -ch, len);
  /* Pine's own answer on a flat window is 0 / 0 — na */
  return (100 * (up - down)) / (up + down);
}

/** Pine's Keltner channel: [EMA, EMA + mult·EMA(range), EMA − mult·EMA(range)], the range the true range or high − low */
export function kc(s: State, src: number, high: number, low: number, close: number, len: number, mult: number, useTrueRange: boolean): [number, number, number] {
  const basis = ta.ema((s.m as State) ?? (s.m = {}), src, len);
  const range = useTrueRange ? ta.tr((s.t as State) ?? (s.t = {}), high, low, close, false) : high - low;
  const r = ta.ema((s.r as State) ?? (s.r = {}), range, len);
  return [basis, basis + r * mult, basis - r * mult];
}

/** Keltner width: (upper − lower) / basis */
export function kcw(s: State, src: number, high: number, low: number, close: number, len: number, mult: number, useTrueRange: boolean): number {
  const [m, u, l] = kc(s, src, high, low, close, len, mult, useTrueRange);
  return (u - l) / m;
}

/* ---- the call ---------------------------------------------------------------------- */

interface Bar {
  high: number;
  low: number;
  close: number;
}

const num = (v: Value | undefined): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);
const need = (a: Record<string, Value>, key: string, callee: string, line: number): Value => {
  if (!(key in a)) throw new PineError(`${callee} needs its "${key}"`, line);
  return a[key];
};
const len = (a: Record<string, Value>, key: string, callee: string, line: number): number => {
  const v = num(need(a, key, callee, line));
  if (Number.isNaN(v) || v < 1) throw new PineError(`${callee}: "${key}" must be a whole number of at least 1`, line);
  return Math.floor(v);
};
const flag = (v: Value | undefined, dflt: boolean): boolean => (v === undefined || v === null ? dflt : typeof v === 'boolean' ? v : num(v) !== 0);
const tuple = (items: Value[]): Tuple => ({ tuple: items });

/** Answer one of the calls above, or undefined when the name is not one of them */
export function callMoreAL(bar: Bar, callee: string, a: Record<string, Value>, state: State, line: number): Value | undefined {
  switch (callee) {
    case 'ta.cmo':
      return cmo(state, num(need(a, 'series', callee, line)), len(a, 'length', callee, line));
    case 'ta.kc':
      return tuple(kc(state, num(need(a, 'series', callee, line)), bar.high, bar.low, bar.close, len(a, 'length', callee, line), num(need(a, 'mult', callee, line)), flag(a.useTrueRange, true)));
    case 'ta.kcw':
      return kcw(state, num(need(a, 'series', callee, line)), bar.high, bar.low, bar.close, len(a, 'length', callee, line), num(need(a, 'mult', callee, line)), flag(a.useTrueRange, true));
  }
  return undefined;
}
