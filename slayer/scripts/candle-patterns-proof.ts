/*
  THE CANDLESTICK PATTERN BUILT-INS (src/data/builtinScriptsCandles.ts), run through the Pine runtime on hand-built
  candles. Each pattern gets thirty quiet filler bars (alternating one-point bodies with half-point shadows — no long
  body, no doji, no shadow pattern) and then the candles that make it, priced by hand from the definition; the script
  must mark the pattern's last bar and stay quiet on the fillers. Then: the trend rule (a hammer only in a downtrend,
  a hanging man only in an uptrend, on the 50-bar SMA), and "All candlestick patterns" marking exactly what each
  single script marks (data/candlePatterns.ts runs the same conditions natively) under all three trend rules, its
  per-pattern switches, its bullish / bearish filter, and its speed.
  Run: npx tsx scripts/candle-patterns-proof.ts
*/
import { compile, run } from '../src/core/pine';
import type { Bar } from '../src/core/pine';
import { CANDLE_PATTERNS, CANDLE_SOURCES } from '../src/data/builtinScriptsCandles';
import { detectPatterns, TREND_RULES, type PatternMark } from '../src/data/candlePatterns';

let fail = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    fail++;
    console.log(`  ✗ ${msg}`);
  }
};

type C = [number, number, number, number];
const bar = (i: number, [o, h, l, c]: C): Bar => ({ time: 1_760_000_000 + i * 60, open: o, high: h, low: l, close: c, volume: 1000 });
/* quiet fillers around 100: white 100→101, black 101→100, half-point shadows */
const fillers = (n: number): C[] => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? [100, 101.5, 99.5, 101] : [101, 101.5, 99.5, 100]) as C);

/* the candles of each pattern, last bar marked */
const CASES: Record<string, C[]> = {
  doji: [[100, 101, 99, 100.02]],
  'dragonfly-doji': [[100, 100, 98, 100]],
  'gravestone-doji': [[100, 102, 100, 100]],
  hammer: [[100, 100.5, 98, 100.5]],
  'hanging-man': [[100, 100.5, 98, 100.5]],
  'inverted-hammer': [[100, 102, 99.5, 99.5]],
  'shooting-star': [[100, 102, 99.5, 99.5]],
  'marubozu-white': [[100, 103, 100, 103]],
  'marubozu-black': [[103, 103, 100, 100]],
  'spinning-top-white': [[100, 102, 98, 100.5]],
  'spinning-top-black': [[100.5, 102, 98, 100]],
  'long-lower-shadow': [[100, 100.4, 97, 100.3]],
  'long-upper-shadow': [[100.3, 103, 99.9, 100]],
  'engulfing-bull': [[100.5, 100.7, 99.8, 100], [99.8, 101.1, 99.7, 101]],
  'engulfing-bear': [[100, 100.7, 99.8, 100.5], [100.7, 100.8, 99.4, 99.5]],
  'harami-bull': [[102, 102.2, 99.3, 99.5], [100, 100.8, 99.8, 100.5]],
  'harami-bear': [[99.5, 102.2, 99.3, 102], [101.5, 101.8, 100.8, 101]],
  'harami-cross-bull': [[102, 102.2, 99.3, 99.5], [100.5, 101, 100, 100.5]],
  'harami-cross-bear': [[99.5, 102.2, 99.3, 102], [100.8, 101.3, 100.3, 100.8]],
  'doji-star-bull': [[102, 102.2, 99.3, 99.5], [99, 99.3, 98.7, 99]],
  'doji-star-bear': [[99.5, 102.2, 99.3, 102], [102.5, 102.8, 102.2, 102.5]],
  'morning-star': [[103, 103.1, 99.9, 100], [99.5, 99.6, 99.1, 99.2], [99.8, 102.1, 99.7, 102]],
  'morning-doji-star': [[103, 103.1, 99.9, 100], [99.3, 99.5, 99.1, 99.3], [99.8, 102.1, 99.7, 102]],
  'evening-star': [[100, 103.1, 99.9, 103], [103.5, 103.9, 103.4, 103.8], [103.2, 103.3, 100.9, 101]],
  'evening-doji-star': [[100, 103.1, 99.9, 103], [103.6, 103.8, 103.4, 103.6], [103.2, 103.3, 100.9, 101]],
  piercing: [[102, 102.1, 99.4, 99.5], [99.3, 101.5, 99.2, 101.2]],
  'dark-cloud-cover': [[99.5, 102.1, 99.4, 102], [102.3, 102.4, 100.2, 100.5]],
  'tweezer-bottom': [[102, 102.1, 99, 99.5], [99.6, 100.9, 99.02, 100.8]],
  'tweezer-top': [[99.5, 102.5, 99.4, 102], [101.8, 102.52, 100.5, 100.6]],
  'kicking-bull': [[102, 102, 100, 100], [102.5, 104.5, 102.5, 104.5]],
  'kicking-bear': [[100, 102, 100, 102], [99.5, 99.5, 97.5, 97.5]],
  'abandoned-baby-bull': [[101, 101.1, 99.8, 100], [99, 99.3, 98.7, 99], [99.6, 100.6, 99.5, 100.5]],
  'abandoned-baby-bear': [[100, 101.2, 99.9, 101], [101.8, 102.1, 101.5, 101.8], [101.3, 101.4, 100.3, 100.4]],
  'three-white-soldiers': [[100, 102, 99.9, 102], [101, 103.5, 100.9, 103.5], [102.5, 105, 102.4, 105]],
  'three-black-crows': [[105, 105.1, 103, 103], [104, 104.1, 101.5, 101.5], [102.5, 102.6, 100, 100]],
  'rising-three-methods': [[100, 103.1, 99.9, 103], [102.5, 102.6, 102, 102.1], [102.3, 102.4, 101.8, 101.9], [102, 102.1, 101.5, 101.6], [101.7, 103.7, 101.6, 103.6]],
  'falling-three-methods': [[103, 103.1, 99.9, 100], [100.5, 101, 100.4, 100.9], [100.7, 101.2, 100.6, 101.1], [101, 101.5, 100.9, 101.4], [101.3, 101.4, 99.3, 99.4]],
  'rising-window': [[100, 100.5, 99.5, 100.3], [101, 101.8, 100.8, 101.5]],
  'falling-window': [[100, 100.5, 99.5, 99.7], [99, 99.2, 98.3, 98.5]],
  'on-neck': [[102, 102.1, 99.3, 99.5], [99, 99.4, 98.9, 99.31]],
  'upside-tasuki-gap': [[100, 102.1, 99.9, 102], [102.5, 103, 102.4, 102.9], [102.8, 102.9, 102.1, 102.2]],
  'downside-tasuki-gap': [[102, 102.1, 99.9, 100], [99.5, 99.6, 99, 99.1], [99.2, 99.9, 99.1, 99.8]],
  'tri-star-bull': [[100, 100.5, 99.5, 100], [99, 99.5, 98.5, 99], [100, 100.5, 99.5, 100]],
  'tri-star-bear': [[100, 100.5, 99.5, 100], [101, 101.5, 100.5, 101], [100, 100.5, 99.5, 100]],
};

const NO_TREND = { trendRule: 'No detection' };
const srcOf = (key: string) => CANDLE_SOURCES.find(s => s.slug === `candle-${key}`)!.source;
const marks = (source: string, bars: Bar[], inputs: Record<string, string | boolean> = NO_TREND) => {
  const r = run(compile(source), bars, { inputs, budgetMs: 10_000 });
  return r.shapes.map(s => [...s.values].map((v, i) => (v === 1 ? i : -1)).filter(i => i >= 0));
};

/* ---- every pattern has a case, and the case marks its last bar ---- */
console.log(`candle patterns: ${CANDLE_PATTERNS.length} patterns, ${CANDLE_SOURCES.length} scripts`);
ok(CANDLE_SOURCES.length === CANDLE_PATTERNS.length, 'one script a pattern');
ok(CANDLE_PATTERNS.length === 44, `44 patterns in the set (have ${CANDLE_PATTERNS.length})`);
ok(new Set(CANDLE_SOURCES.map(s => s.slug)).size === CANDLE_SOURCES.length, 'slugs are unique');
for (const s of CANDLE_SOURCES) {
  try {
    compile(s.source);
  } catch (e) {
    ok(false, `${s.slug} compiles: ${(e as Error).message}`);
  }
}
const tape: Bar[] = [];
const expected = new Map<string, number>();
for (const p of CANDLE_PATTERNS) {
  const c = CASES[p.key];
  ok(!!c, `${p.key} has a hand-built case`);
  if (!c) continue;
  ok(c.length === p.bars, `${p.key}: the case is ${p.bars} bar(s) (has ${c.length})`);
  const bars = [...fillers(30), ...c].map((x, i) => bar(i, x));
  const hit = marks(srcOf(p.key), bars)[0];
  const last = bars.length - 1;
  ok(hit.includes(last), `${p.key} marks its last bar (marked ${JSON.stringify(hit)})`);
  ok(!hit.some(i => i >= 15 && i < 30), `${p.key} is quiet on the fillers (marked ${JSON.stringify(hit.filter(i => i < 30))})`);
  /* the same candles appended to one long tape for the combined script */
  const at = tape.length;
  for (const x of [...fillers(16), ...c]) tape.push(bar(tape.length, x));
  expected.set(p.key, at + 16 + c.length - 1);
}

/* ---- the trend rule: the hammer's shape only reads as a hammer after a fall, as a hanging man after a rise ---- */
const drift = (dir: 1 | -1): C[] => Array.from({ length: 60 }, (_, i) => {
  const o = 100 + dir * i * 0.4;
  const c = o + (i % 2 === 0 ? 1 : -1) * 0.6 + dir * 0.4;
  return [o, Math.max(o, c) + 0.3, Math.min(o, c) - 0.3, c] as C;
});
const hammerAt = (base: number): C => [base, base + 0.5, base - 2, base + 0.5];
for (const [dir, shouldHammer] of [[-1, true], [1, false]] as const) {
  const d = drift(dir);
  const lastClose = d[d.length - 1][3];
  const bars = [...d, hammerAt(lastClose)].map((x, i) => bar(i, x));
  const last = bars.length - 1;
  const h = marks(srcOf('hammer'), bars, { trendRule: 'SMA50' })[0];
  const hm = marks(srcOf('hanging-man'), bars, { trendRule: 'SMA50' })[0];
  ok(h.includes(last) === shouldHammer, `SMA50 ${dir < 0 ? 'downtrend' : 'uptrend'}: hammer ${shouldHammer ? 'marks' : 'stays quiet'}`);
  ok(hm.includes(last) === !shouldHammer, `SMA50 ${dir < 0 ? 'downtrend' : 'uptrend'}: hanging man ${shouldHammer ? 'stays quiet' : 'marks'}`);
  const h2 = marks(srcOf('hammer'), bars, { trendRule: 'SMA50, SMA200' })[0];
  ok(!h2.includes(last), 'SMA50, SMA200: fewer than 200 bars, no trend, no hammer');
}

/* ---- All candlestick patterns (data/candlePatterns.ts, run natively): the same marks as every single script ---- */
const byKey = (ms: PatternMark[], key: string) => ms.filter(m => m.key === key).map(m => m.i);
/* on the long hand-built tape, and on a drifting tape where the trend rules bite */
const driftTape: Bar[] = [...drift(-1), ...drift(1), ...drift(-1)].map((x, i) => bar(i, x));
for (const [name, t, rules] of [['the hand-built tape', tape, TREND_RULES], ['a drifting tape', driftTape, TREND_RULES]] as const) {
  for (const trend of rules) {
    const nat = detectPatterns(t, { trend, type: 'Both' });
    for (const p of CANDLE_PATTERNS) {
      const single = marks(srcOf(p.key), t, { trendRule: trend })[0];
      ok(JSON.stringify(single) === JSON.stringify(byKey(nat, p.key)), `All = ${p.key} on ${name}, ${trend} (${JSON.stringify(single)} vs ${JSON.stringify(byKey(nat, p.key))})`);
    }
  }
}
const allNat = detectPatterns(tape, { trend: 'No detection', type: 'Both' });
for (const p of CANDLE_PATTERNS) ok(byKey(allNat, p.key).includes(expected.get(p.key)!), `All marks ${p.key} where it was built`);
/* a switch off silences that pattern alone */
const off = detectPatterns(tape, { trend: 'No detection', type: 'Both', on: k => k !== 'hammer' });
ok(byKey(off, 'hammer').length === 0, 'the Hammer switch off: no hammer marks');
ok(byKey(off, 'hanging-man').length === byKey(allNat, 'hanging-man').length, 'the Hammer switch off: the hanging man untouched');
/* the type filter */
const bullOnly = detectPatterns(tape, { trend: 'No detection', type: 'Bullish' });
for (const p of CANDLE_PATTERNS) {
  if (p.lean === 'bear') ok(byKey(bullOnly, p.key).length === 0, `Bullish only: ${p.key} silent`);
  else ok(byKey(bullOnly, p.key).length === byKey(allNat, p.key).length, `Bullish only: ${p.key} kept`);
}
/* fast enough for a pane: a thousand bars of every pattern */
const big: Bar[] = Array.from({ length: 1000 }, (_, i) => bar(i, (i % 7 === 0 ? [100, 101, 99, 100.02] : i % 2 ? [100, 101.5, 99.5, 101] : [101, 101.5, 99.5, 100]) as C));
const t0 = performance.now();
detectPatterns(big, { trend: 'SMA50', type: 'Both' });
const ms = performance.now() - t0;
ok(ms < 150, `a thousand bars of every pattern in ${ms.toFixed(0)} ms`);

console.log(fail ? `candle patterns: ${fail} FAILED` : 'candle patterns: all hold');
process.exit(fail ? 1 : 0);
