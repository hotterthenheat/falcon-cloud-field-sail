/* ALL CANDLESTICK PATTERNS, as a chart indicator. Every pattern at once through the Pine runtime is ~90 statements a bar,
   which ran past the runtime's 200 ms budget on a pane's thousand bars, so the combined indicator runs natively here.
   It reads the SAME definitions as the single-pattern scripts (CANDLE_PATTERNS' Pine conditions, parsed by the
   runtime's own parser and turned into closures — nothing is evaluated from text) over the same helper series (the
   runtime's own ta.sma / ta.ema), with the runtime's rules for na, division by zero and history before the first bar.
   scripts/candle-patterns-proof.ts holds it equal, mark for mark, to every single script. */

import { parse } from '../core/pine/parser';
import { ema, sma } from '../core/pine/ta';
import type { Expr } from '../core/pine/ast';
import { CANDLE_PATTERNS, type CandlePattern } from './builtinScriptsCandles';

export interface PatternBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const TREND_RULES = ['SMA50', 'SMA50, SMA200', 'No detection'] as const;
export type TrendRule = (typeof TREND_RULES)[number];
export const PATTERN_TYPES = ['Both', 'Bullish', 'Bearish'] as const;
export type PatternType = (typeof PATTERN_TYPES)[number];

export interface PatternMark {
  i: number;
  time: number;
  key: string;
  mark: string;
  title: string;
  lean: CandlePattern['lean'];
}

type Series = Float64Array;
type Fn = (b: number) => number;

/** The helper series, as the single scripts' HELPERS block computes them (1 / 0 for a bool, NaN for na) */
function helpers(bars: readonly PatternBar[], trend: TrendRule): Map<string, Series> {
  const n = bars.length;
  const m = new Map<string, Series>();
  const mk = (name: string, f: (i: number) => number) => {
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) a[i] = f(i);
    m.set(name, a);
    return a;
  };
  const o = mk('open', i => bars[i].open);
  const h = mk('high', i => bars[i].high);
  const l = mk('low', i => bars[i].low);
  const c = mk('close', i => bars[i].close);
  mk('hl2', i => (h[i] + l[i]) / 2);
  const s50 = {};
  const s200 = {};
  const sma50 = mk('sma50', i => sma(s50, c[i], 50));
  const sma200 = mk('sma200', i => sma(s200, c[i], 200));
  const B = (v: boolean) => (v ? 1 : 0);
  mk('C_DownTrend', i => (trend === 'SMA50' ? B(c[i] < sma50[i]) : trend === 'SMA50, SMA200' ? B(c[i] < sma50[i] && sma50[i] < sma200[i]) : 1));
  mk('C_UpTrend', i => (trend === 'SMA50' ? B(c[i] > sma50[i]) : trend === 'SMA50, SMA200' ? B(c[i] > sma50[i] && sma50[i] > sma200[i]) : 1));
  const hi = mk('C_BodyHi', i => Math.max(c[i], o[i]));
  const lo = mk('C_BodyLo', i => Math.min(c[i], o[i]));
  const body = mk('C_Body', i => hi[i] - lo[i]);
  const es = {};
  const avg = mk('C_BodyAvg', i => ema(es, body[i], 14));
  mk('C_SmallBody', i => B(body[i] < avg[i]));
  const long = mk('C_LongBody', i => B(body[i] > avg[i]));
  const up = mk('C_UpShadow', i => h[i] - hi[i]);
  const dn = mk('C_DnShadow', i => lo[i] - l[i]);
  mk('C_HasUpShadow', i => B(up[i] > (5.0 / 100) * body[i]));
  mk('C_HasDnShadow', i => B(dn[i] > (5.0 / 100) * body[i]));
  mk('C_WhiteBody', i => B(o[i] < c[i]));
  mk('C_BlackBody', i => B(o[i] > c[i]));
  const range = mk('C_Range', i => h[i] - l[i]);
  mk('C_BodyMiddle', i => body[i] / 2 + lo[i]);
  /* the runtime's division: by zero is na, and na compares false */
  const div = (a: number, b: number) => (b === 0 ? NaN : a / b);
  const eq = (a: number, b: number) => (Number.isNaN(a) || Number.isNaN(b) ? Number.isNaN(a) && Number.isNaN(b) : a === b);
  const shadowEq = mk('C_ShadowEquals', i => B(eq(up[i], dn[i]) || (div(Math.abs(up[i] - dn[i]), dn[i]) * 100 < 100.0 && div(Math.abs(dn[i] - up[i]), up[i]) * 100 < 100.0)));
  const dojiBody = mk('C_IsDojiBody', i => B(range[i] > 0 && body[i] <= (range[i] * 5.0) / 100));
  mk('C_Doji', i => B(!!dojiBody[i] && !!shadowEq[i]));
  mk('C_Marubozu', i => B(!!long[i] && up[i] <= (5.0 / 100) * body[i] && dn[i] <= (5.0 / 100) * body[i]));
  mk('C_IsSpinningTop', i => B(dn[i] >= (range[i] / 100) * 34.0 && up[i] >= (range[i] / 100) * 34.0 && !dojiBody[i]));
  mk('C_NoUpShadow3', i => B((range[i] * 5.0) / 100 > up[i]));
  mk('C_NoDnShadow3', i => B((range[i] * 5.0) / 100 > dn[i]));
  const small = m.get('C_SmallBody')!;
  const hl2 = m.get('hl2')!;
  const hasUp = m.get('C_HasUpShadow')!;
  const hasDn = m.get('C_HasDnShadow')!;
  mk('C_HammerShape', i => B(!!small[i] && body[i] > 0 && lo[i] > hl2[i] && dn[i] >= 2.0 * body[i] && !hasUp[i]));
  mk('C_StarShape', i => B(!!small[i] && body[i] > 0 && hi[i] < hl2[i] && up[i] >= 2.0 * body[i] && !hasDn[i]));
  return m;
}

const truthy = (v: number) => !Number.isNaN(v) && v !== 0;

/** One condition's tree into a closure over the helper series */
function closure(e: Expr, m: Map<string, Series>): Fn {
  switch (e.t) {
    case 'num':
      return () => e.v;
    case 'bool':
      return () => (e.v ? 1 : 0);
    case 'id': {
      const a = m.get(e.name);
      if (!a) throw new Error(`candle patterns: no series "${e.name}"`);
      return b => a[b];
    }
    case 'index': {
      if (e.base.t !== 'id' || e.index.t !== 'num') throw new Error('candle patterns: history is of a name, by a number');
      const a = m.get(e.base.name);
      if (!a) throw new Error(`candle patterns: no series "${e.base.name}"`);
      const k = e.index.v;
      return b => (b - k >= 0 ? a[b - k] : NaN);
    }
    case 'unary': {
      const f = closure(e.e, m);
      return e.op === 'not' ? b => (truthy(f(b)) ? 0 : 1) : e.op === '-' ? b => -f(b) : f;
    }
    case 'call': {
      if (e.callee !== 'math.abs' || e.args.length !== 1) throw new Error(`candle patterns: ${e.callee} is not in the set`);
      const f = closure(e.args[0].value, m);
      return b => Math.abs(f(b));
    }
    case 'bin': {
      const l = closure(e.l, m);
      const r = closure(e.r, m);
      switch (e.op) {
        case 'and':
          return b => (truthy(l(b)) && truthy(r(b)) ? 1 : 0);
        case 'or':
          return b => (truthy(l(b)) || truthy(r(b)) ? 1 : 0);
        case '+':
          return b => l(b) + r(b);
        case '-':
          return b => l(b) - r(b);
        case '*':
          return b => l(b) * r(b);
        case '/':
          return b => {
            const d = r(b);
            return d === 0 ? NaN : l(b) / d;
          };
        case '<':
          return b => (l(b) < r(b) ? 1 : 0);
        case '>':
          return b => (l(b) > r(b) ? 1 : 0);
        case '<=':
          return b => (l(b) <= r(b) ? 1 : 0);
        case '>=':
          return b => (l(b) >= r(b) ? 1 : 0);
        case '==':
        case '!=': {
          const want = e.op === '==';
          return b => {
            const x = l(b);
            const y = r(b);
            const same = Number.isNaN(x) || Number.isNaN(y) ? Number.isNaN(x) && Number.isNaN(y) : x === y;
            return same === want ? 1 : 0;
          };
        }
      }
      throw new Error(`candle patterns: operator ${e.op}`);
    }
  }
  throw new Error(`candle patterns: ${e.t} is not in the set`);
}

/* each condition parsed once, by the runtime's parser */
let trees: Map<string, Expr> | null = null;
function treeOf(p: CandlePattern): Expr {
  trees ??= new Map();
  let t = trees.get(p.key);
  if (!t) {
    const prog = parse(`//@version=6\npattern = ${p.when}\n`);
    const st = prog.body[0];
    if (!st || st.t !== 'decl') throw new Error(`candle patterns: ${p.key} did not read`);
    t = st.expr;
    trees.set(p.key, t);
  }
  return t;
}

/** Every mark of the switched-on patterns over the bars, in bar order */
export function detectPatterns(bars: readonly PatternBar[], o: { trend: TrendRule; type: PatternType; on?: (key: string) => boolean }): PatternMark[] {
  if (!bars.length) return [];
  const m = helpers(bars, o.trend);
  const out: PatternMark[] = [];
  for (const p of CANDLE_PATTERNS) {
    if (o.on && !o.on(p.key)) continue;
    if (o.type === 'Bullish' && p.lean === 'bear') continue;
    if (o.type === 'Bearish' && p.lean === 'bull') continue;
    const f = closure(treeOf(p), m);
    for (let b = 0; b < bars.length; b++) if (truthy(f(b))) out.push({ i: b, time: bars[b].time, key: p.key, mark: p.mark, title: p.title, lean: p.lean });
  }
  return out.sort((a, b) => a.i - b.i);
}
