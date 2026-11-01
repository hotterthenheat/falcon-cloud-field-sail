/* Terrain's overnight layer on one chart (overnightLayer.ts): the SPX line the options imply through the GTH night on
   SPX, SPXW and XSP panes, the labelled empty night on a stock's or an ETF's. Mounted by StrikeChart for Terrain's panes
   only, intraday timeframes only, never on a host's tape or a replay. */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { INDEX_SYMBOLS } from '../../core/session';
import { rateOn } from '../../core/carry';
import { nyIsoDate } from '../../core/nyTime';
import { ensureDayRates, useRate } from '../../data/rateFeed';
import { OVERNIGHT_SCALE, drawsOvernight, nightLine, stepPoints, stockNight, useOvernight, vixAt } from '../../data/overnightLine';
import { OvernightLayer, type OvernightDraw } from './overnightLayer';

/** A stock or an ETF the feed carries (not a cash index, not a crypto or futures symbol) */
const isStock = (t: string) => /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(t) && !INDEX_SYMBOLS.has(t);

export function useOvernightLayer(chartRef: MutableRefObject<IChartApi | null>, o: { ticker: string; mins: number; light: boolean; off: boolean; revision: number; onSlots?: (times: number[]) => void }) {
  const ticker = o.ticker.toUpperCase();
  const on = !o.off && o.mins < 60 && o.mins >= 1;
  const night = useOvernight(on ? ticker : null);
  const rate = useRate();
  const layerRef = useRef<OvernightLayer | null>(null);
  const read = night.data;
  const day = read?.night ? nyIsoDate(read.night.to) : null;
  useEffect(() => {
    if (day) ensureDayRates(day);
  }, [day]);
  /* the night's own rate once it is over (its morning's published SOFR), the rate in use while it runs */
  const r = read?.night && !read.live && day ? rateOn(day).r : rate.r;

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (!layerRef.current) layerRef.current = new OvernightLayer(chart);
    const layer = layerRef.current;
    if (!on) {
      layer.update(null);
      o.onSlots?.([]);
      return;
    }
    const step = Math.max(5, o.mins) * 60;
    let d: OvernightDraw | null = null;
    if (drawsOvernight(ticker)) {
      const scale = OVERNIGHT_SCALE[ticker] ?? 1;
      const line = nightLine(read, r);
      if (line.length) {
        const points = stepPoints(
          line.map(p => ({ ms: p.ms, value: Math.round(p.spot * scale * 100) / 100 })),
          step
        );
        const end = line[line.length - 1];
        const vix = vixAt(read, end.ms);
        d = {
          kind: 'line',
          points,
          label: `${ticker === 'XSP' ? 'XSP' : 'SPX'} (from options)`,
          valueWord: (end.spot * scale).toFixed(2),
          vixWord: vix ? `VIX ${vix.value.toFixed(2)}` : undefined,
          light: o.light,
        };
      }
    } else if (isStock(ticker)) {
      const w = stockNight(Date.now());
      if (w) {
        const slots: { ms: number }[] = [];
        for (let t = Math.ceil(w.from / 1000 / step) * step; t * 1000 < w.to; t += step) slots.push({ ms: t * 1000 });
        d = { kind: 'gap', points: stepPoints(slots, step), label: 'No overnight trading data', light: o.light };
      }
    }
    layer.update(d);
    o.onSlots?.(d ? d.points.map(p => p.time) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, ticker, o.mins, o.light, read, r, o.revision]);

  useEffect(
    () => () => {
      layerRef.current?.destroy();
      layerRef.current = null;
    },
    []
  );
}
