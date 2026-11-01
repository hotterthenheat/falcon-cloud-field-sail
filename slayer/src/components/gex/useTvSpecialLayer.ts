/* The volume profiles and auto levels on one chart (tvSpecialItems.ts): reads each indicator's inputs and look, builds
   the profiles from data/volumeAtPrice.ts and the levels from data/tvLevels.ts over the chart's own bars, and hands
   them to the two primitives (tvProfilesPrimitive.ts, tvLevelsPrimitive.ts), which hang on the main series and follow
   it when a style swap replaces that series. Returns each one's legend line.

   The volume is the bars' (see volumeAtPrice.ts): the one-minute bars where the chart already holds them for that
   span — nothing new is asked for — else this chart's own bars, and the legend says which. */

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { ISeriesApi, SeriesType } from 'lightweight-charts';
import type { Candle } from '../../types/market';
import { phaseAt } from '../../core/session';
import { readToken } from '../../theme/theme';
import { inkAt, inputOf, lookOf } from '../../data/indicatorLooks';
import { segmentBy, volumeAtPrice, type VapOptions, type VapProfile } from '../../data/volumeAtPrice';
import {
  autoFibExtension,
  autoFibRetracement,
  autoPitchfork,
  autoZigzag,
  FIB_RETRACE_LEVELS,
  periodKey,
  PITCHFORK_KINDS,
  PIVOT_KINDS,
  PIVOT_TFS,
  pivotPeriods,
  resolvePivotTf,
  sessionDayOf,
  swings,
  zigzag,
  zigzagTail,
} from '../../data/tvLevels';
import { TvProfilesPrimitive, type DockedProfile, type ProfileLook, type ProfileValues, type SpanProfile } from './tvProfilesPrimitive';
import { TvLevelsPrimitive, type LevelsScene } from './tvLevelsPrimitive';
import { detectPatterns, PATTERN_TYPES, TREND_RULES } from '../../data/candlePatterns';
import { TV_LEVEL_KEYS, TV_PROFILE_KEYS, TV_SPECIAL_INKS, TV_SPECIAL_ITEMS, type TvSpecialKey } from './tvSpecialItems';

/** An input of one of these indicators, inside its bounds */
const inp = (key: TvSpecialKey, id: string): number => {
  const spec = TV_SPECIAL_ITEMS.find(i => i.key === key)?.inputs.find(s => s.id === id);
  return spec ? inputOf(key, spec) : NaN;
};
const flag = (key: TvSpecialKey, id: string) => inp(key, id) >= 1;
const VALUES: ProfileValues[] = ['updown', 'total', 'delta'];

function profileLook(key: TvSpecialKey): ProfileLook {
  const look = lookOf(key);
  const op = look.opacity ?? 1;
  const ink = look.ink ?? TV_SPECIAL_INKS[key];
  return {
    values: VALUES[inp(key, 'values')] ?? 'updown',
    widthPct: inp(key, 'width'),
    showPoc: flag(key, 'poc'),
    showVa: flag(key, 'vaShow'),
    extendPoc: flag(key, 'extendPoc'),
    inks: {
      up: readToken('--bull', 0.2 * op),
      down: readToken('--bear', 0.2 * op),
      upVa: readToken('--bull', 0.45 * op),
      downVa: readToken('--bear', 0.45 * op),
      total: inkAt(ink, 0.25 * op),
      totalVa: inkAt(ink, 0.55 * op),
      poc: inkAt(ink, op),
      vaEdge: inkAt(ink, 0.45 * op),
      word: readToken('--ink', 0.8),
    },
  };
}

const vapOptions = (key: TvSpecialKey): VapOptions => ({ layout: inp(key, 'layout') === 1 ? 'ticks' : 'rows', size: inp(key, 'rowSize'), tick: 0.01, valueArea: inp(key, 'va') / 100 });

const pocWords = (p: VapProfile | null | undefined): string => (p ? `POC ${p.pocPrice.toFixed(2)} · VA ${p.val.toFixed(2)}–${p.vah.toFixed(2)}` : 'no volume in these bars');

interface Built {
  times: number[];
  spans: SpanProfile[];
  docked: DockedProfile | null;
  scene: LevelsScene | null;
  extras: Partial<Record<TvSpecialKey, string>>;
}

export function useTvSpecialLayer(
  seriesRef: MutableRefObject<ISeriesApi<SeriesType> | null>,
  o: { bars: () => Candle[]; minuteBars: () => Candle[]; mins: number; on: TvSpecialKey[]; off: boolean; signature: string },
): Partial<Record<TvSpecialKey, string>> {
  const profRef = useRef<TvProfilesPrimitive | null>(null);
  const levelRef = useRef<TvLevelsPrimitive | null>(null);
  const onRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const onKey = o.on.join(',');
  const built = useMemo<Built>(() => {
    const empty: Built = { times: [], spans: [], docked: null, scene: null, extras: {} };
    if (o.off || !o.on.length) return empty;
    const bars = o.bars();
    const extras: Partial<Record<TvSpecialKey, string>> = {};
    if (!bars.length) {
      for (const k of o.on) extras[k] = 'waiting on bars';
      return { ...empty, extras };
    }
    const times = bars.map(b => b.time);
    const intraday = o.mins < 1440;
    /* the volume's bars: the minute bars over the span they cover, the chart's own before it */
    const minutes = intraday && o.mins > 1 ? o.minuteBars() : [];
    const minuteFrom = minutes.length ? minutes[0].time : Infinity;
    const volumeBars = (from: number, to: number): { bars: Candle[]; fine: boolean } => {
      if (o.mins === 1 || from >= minuteFrom) {
        const src = o.mins === 1 ? bars : minutes;
        return { bars: src.filter(b => b.time >= from && b.time <= to), fine: intraday };
      }
      return { bars: bars.filter(b => b.time >= from && b.time <= to), fine: false };
    };
    const sourceWord = (fine: boolean) => (fine ? '1m bars' : intraday ? 'this chart’s bars' : 'day bars');
    const lastBarEnd = (to: number) => to + Math.max(1, o.mins) * 60 - 1;

    const spans: SpanProfile[] = [];
    let docked: DockedProfile | null = null;
    for (const key of TV_PROFILE_KEYS) {
      if (!o.on.includes(key)) continue;
      const look = profileLook(key);
      const opts = vapOptions(key);
      if (key === 'vrvp') {
        docked = {
          side: inp(key, 'placement') === 1 ? 'left' : 'right',
          look,
          build: (from, to) => {
            return volumeAtPrice(volumeBars(from, lastBarEnd(to)).bars, opts);
          },
        };
        extras.vrvp = o.mins === 1 ? 'the bars in view · 1m bars' : intraday ? 'the bars in view · 1m bars where held, else this chart’s bars' : 'the bars in view · day bars';
        continue;
      }
      if (key === 'svp' || key === 'pvp') {
        if (key === 'svp' && !intraday) {
          extras.svp = 'needs intraday bars';
          continue;
        }
        const regular = key === 'svp' && inp(key, 'session') === 1;
        const period = (['Daily', 'Weekly', 'Monthly'] as const)[inp('pvp', 'period')] ?? 'Daily';
        const segs = segmentBy(bars, b => (key === 'svp' ? (regular && phaseAt(b.time * 1000) !== 'regular' ? null : sessionDayOf(b.time)) : periodKey(b.time, period))).slice(-Math.max(1, inp(key, 'back')));
        let last: VapProfile | null = null;
        let fineAll = true;
        for (const s of segs) {
          const from = s.bars[0].time;
          const to = s.bars[s.bars.length - 1].time;
          const v = volumeBars(from, lastBarEnd(to));
          const vb = regular ? v.bars.filter(b => phaseAt(b.time * 1000) === 'regular') : v.bars;
          const p = volumeAtPrice(vb, opts);
          if (!v.fine) fineAll = false;
          if (!p) continue;
          /* the profile sits over the chart's bars of its span, whatever bars built it */
          spans.push({ profile: { ...p, from, to }, look });
          last = p;
        }
        extras[key] = `${pocWords(last)} · ${sourceWord(fineAll)}`;
        continue;
      }
      if (key === 'aavp') {
        const anchor = inp(key, 'anchor');
        const len = Math.max(2, inp(key, 'length'));
        let fromTime = bars[0].time;
        if (anchor === 0) {
          const k = intraday ? sessionDayOf(bars[bars.length - 1].time) : periodKey(bars[bars.length - 1].time, 'Monthly');
          for (let i = bars.length - 1; i >= 0; i--) {
            if ((intraday ? sessionDayOf(bars[i].time) : periodKey(bars[i].time, 'Monthly')) !== k) break;
            fromTime = bars[i].time;
          }
        } else {
          const tail = bars.slice(-len);
          let best = tail[0];
          for (const b of tail) if (anchor === 1 ? b.high > best.high : anchor === 2 ? b.low < best.low : b.volume > best.volume) best = b;
          fromTime = best.time;
        }
        const to = bars[bars.length - 1].time;
        const v = volumeBars(fromTime, lastBarEnd(to));
        const p = volumeAtPrice(v.bars, opts);
        if (p) spans.push({ profile: { ...p, from: fromTime, to }, look });
        extras.aavp = `${pocWords(p)} · ${sourceWord(v.fine)}`;
      }
    }

    /* ---- the levels ---- */
    const scene: LevelsScene = {};
    const lvlInk = (key: TvSpecialKey, a = 1) => inkAt(lookOf(key).ink ?? TV_SPECIAL_INKS[key], a * (lookOf(key).opacity ?? 1));
    const width = (key: TvSpecialKey) => Math.min(4, Math.max(1, Math.round(lookOf(key).width ?? 1)));
    const word = readToken('--ink', 0.75);
    if (o.on.includes('pivotsStd')) {
      const kind = PIVOT_KINDS[inp('pivotsStd', 'type')] ?? 'Traditional';
      const tf = PIVOT_TFS[inp('pivotsStd', 'tf')] ?? 'Auto';
      const periods = pivotPeriods(bars, { kind, tf, barMinutes: o.mins, back: inp('pivotsStd', 'back'), regularOnly: flag('pivotsStd', 'regular') });
      scene.pivots = { periods, labels: flag('pivotsStd', 'labels'), prices: flag('pivotsStd', 'prices'), ink: lvlInk('pivotsStd', 0.85), word: lvlInk('pivotsStd'), width: width('pivotsStd') };
      const live = periods[periods.length - 1];
      extras.pivotsStd = live ? `${resolvePivotTf(tf, o.mins)} · P ${live.levels[0].price.toFixed(2)}` : 'needs a whole period before this one';
    }
    if (o.on.includes('pivotsHL')) {
      const hs = swings(bars, inp('pivotsHL', 'leftH'), inp('pivotsHL', 'rightH'), true);
      const ls = swings(bars, inp('pivotsHL', 'leftL'), inp('pivotsHL', 'rightL'), false);
      scene.hl = { swings: [...hs, ...ls], inkHigh: lvlInk('pivotsHL'), inkLow: lvlInk('pivotsHL') };
      if (!hs.length && !ls.length) extras.pivotsHL = 'no swing confirmed yet';
    }
    if (o.on.includes('zigzag')) {
      const pts = zigzag(bars, inp('zigzag', 'dev'), inp('zigzag', 'legs'));
      scene.zigzag = { pts, tail: flag('zigzag', 'extend') ? zigzagTail(bars, pts) : null, ink: lvlInk('zigzag'), width: Math.max(2, width('zigzag')), price: flag('zigzag', 'price'), change: flag('zigzag', 'change'), volume: flag('zigzag', 'volume'), word };
      extras.zigzag = pts.length >= 2 ? `${pts.length} points · last ${pts[pts.length - 1].price.toFixed(2)}` : 'no leg past the deviation yet';
    }
    const fibLevels = (key: TvSpecialKey) => FIB_RETRACE_LEVELS.filter(l => flag(key, `l${String(l).replace('.', '_')}`));
    if (o.on.includes('autoFib')) {
      const set = autoFibRetracement(autoZigzag(bars, inp('autoFib', 'dev'), inp('autoFib', 'depth')), fibLevels('autoFib'), flag('autoFib', 'reverse'));
      if (set) scene.fib = { set, ink: lvlInk('autoFib', 0.8), word: lvlInk('autoFib'), prices: flag('autoFib', 'prices'), extendLeft: flag('autoFib', 'extendLeft'), extendRight: flag('autoFib', 'extendRight'), width: width('autoFib') };
      extras.autoFib = set ? `${set.anchors[0].price.toFixed(2)} → ${set.anchors[1].price.toFixed(2)}` : 'needs two swings';
    }
    if (o.on.includes('autoFibExt')) {
      const set = autoFibExtension(autoZigzag(bars, inp('autoFibExt', 'dev'), inp('autoFibExt', 'depth')), fibLevels('autoFibExt'), flag('autoFibExt', 'reverse'));
      if (set) scene.ext = { set, ink: lvlInk('autoFibExt', 0.8), word: lvlInk('autoFibExt'), prices: flag('autoFibExt', 'prices'), extendRight: flag('autoFibExt', 'extendRight'), width: width('autoFibExt') };
      extras.autoFibExt = set ? set.anchors.map(a => a.price.toFixed(2)).join(' → ') : 'needs three swings';
    }
    if (o.on.includes('autoPitchfork')) {
      const kind = PITCHFORK_KINDS[inp('autoPitchfork', 'kind')] ?? 'Original';
      const f = autoPitchfork(autoZigzag(bars, inp('autoPitchfork', 'dev'), inp('autoPitchfork', 'depth')), kind);
      const levels = [0.25, 0.382, 0.5, 0.618, 0.75, 1].filter(l => flag('autoPitchfork', `f${String(l).replace('.', '_')}`));
      if (f) scene.fork = { f, levels, ink: lvlInk('autoPitchfork'), faint: lvlInk('autoPitchfork', 0.55), width: width('autoPitchfork') };
      extras.autoPitchfork = f ? kind : 'needs three swings';
    }
    if (o.on.includes('candlesAll')) {
      const marks = detectPatterns(bars, {
        trend: TREND_RULES[inp('candlesAll', 'trend')] ?? 'SMA50',
        type: PATTERN_TYPES[inp('candlesAll', 'type')] ?? 'Both',
        on: key => flag('candlesAll', `p_${key}`),
      });
      const op = lookOf('candlesAll').opacity ?? 1;
      scene.marks = { marks: marks.map(m => ({ ...m, price: m.lean === 'bull' ? bars[m.i].low : bars[m.i].high })), bull: readToken('--bull', 0.9 * op), bear: readToken('--bear', 0.9 * op), neutral: inkAt(lookOf('candlesAll').ink ?? TV_SPECIAL_INKS.candlesAll, 0.9 * op), text: readToken('--canvas') };
      const recent = marks.filter(m => m.i >= bars.length - 1);
      extras.candlesAll = recent.length ? `last bar: ${recent.map(m => m.title).join(', ')}` : `${marks.length} marks on these bars`;
    }
    const anyLevel = o.on.includes('candlesAll') || TV_LEVEL_KEYS.some(k => o.on.includes(k));
    return { times, spans, docked, scene: anyLevel ? scene : null, extras };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.off, onKey, o.mins, o.signature]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    if (!profRef.current) profRef.current = new TvProfilesPrimitive();
    if (!levelRef.current) levelRef.current = new TvLevelsPrimitive();
    if (onRef.current !== series) {
      /* the old series went with a style swap (its primitives with it); hang on the new one */
      if (onRef.current) {
        try {
          onRef.current.detachPrimitive(profRef.current);
          onRef.current.detachPrimitive(levelRef.current);
        } catch {
          /* already removed */
        }
      }
      series.attachPrimitive(profRef.current);
      series.attachPrimitive(levelRef.current);
      onRef.current = series;
    }
    profRef.current.set(built.times, built.spans, built.docked);
    levelRef.current.set(built.times, built.scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built]);

  return built.extras;
}
