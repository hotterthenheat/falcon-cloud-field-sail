/* The underlying beside the contract (restored from the owner's contract page, where the stock's chart sat with the
   setup on it): the name's one-minute line for the call's session, the minute the call fired and the minute it left
   marked on it, and the underlying at the call as a dotted rule. The scan's own bar read; a live session grows each
   minute. Nothing is drawn that the record does not hold. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { LineSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { underCloses } from '../../data/compassModel';
import { anchorSession } from '../../data/thetaTape';
import { printOf } from '../../data/compassParams';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { dayChartOptions, daySurface } from '../gex/dayChart';
import { nyDay, nyWallTime } from '../../core/nyTime';
import type { OptionRight } from '../../types/compass';

interface UnderlyingTrackProps {
  ticker: string;
  right: OptionRight;
  /** The session, YYYY-MM-DD */
  day: string;
  live: boolean;
  /** The call's minute and the underlying it read, when there is a call */
  calledAt?: number;
  calledSpot?: number | null;
  /** The exit's minute, once it has left */
  exitAt?: number | null;
  /** The underlying now, live */
  spot?: number;
}

const UnderlyingTrack = ({ ticker, right, day, live, calledAt = 0, calledSpot = null, exitAt = null, spot = 0 }: UnderlyingTrackProps) => {
  const paper = useResolvedTheme() === 'light';
  const name = printOf(ticker);
  const key = `${ticker}|${day}`;
  const [bars, setBars] = useState<{ key: string; points: { time: number; value: number }[]; status: 'loading' | 'ready' | 'empty'; day: string }>({ key: '', points: [], status: 'loading', day: '' });
  useEffect(() => {
    let dead = false;
    setBars(b => (b.key === key ? b : { key, points: [], status: 'loading', day }));
    /* a live page reads the session that has minutes: today's, or the last one before the open (the scan's own read) */
    const pull = () => {
      /* the last regular session that has opened: today's once it has, else the one before (never a day not begun) */
      const anchor = live ? anchorSession('rth') : day.replace(/-/g, '');
      const read = live ? `${anchor.slice(0, 4)}-${anchor.slice(4, 6)}-${anchor.slice(6, 8)}` : day;
      return underCloses(ticker, anchor).then(rows => ({ day: read, rows }));
    };
    const read = () =>
      pull()
        .then(({ day: shownDay, rows }) => {
          if (dead) return;
          const points = rows.filter(r => r.c > 0).map(r => ({ time: Math.floor(r.t / 1000), value: r.c }));
          setBars({ key, points, status: points.length ? 'ready' : 'empty', day: shownDay });
        })
        .catch(() => {
          if (!dead) setBars({ key, points: [], status: 'empty', day });
        });
    void read();
    const id = live ? window.setInterval(read, 60_000) : 0;
    return () => {
      dead = true;
      if (id) window.clearInterval(id);
    };
  }, [key, ticker, day, live]);
  const points = bars.key === key ? bars.points : [];

  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const ruleRef = useRef<IPriceLine | null>(null);
  const [made, setMade] = useState(0);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = daySurface(host, paper);
    const chart = createChart(host, dayChartOptions(s, { clock: true, logo: false }));
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.16, bottom: 0.12 } });
    const series = chart.addSeries(LineSeries, {
      color: readToken('--text-secondary', undefined, host),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerRadius: 3,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series);
    setMade(n => n + 1);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      ruleRef.current = null;
    };
  }, [paper]);

  /* the bar a minute sits on: the last at or before it, inside five minutes */
  const barAt = useMemo(() => {
    return (ms: number): { time: number; value: number } | null => {
      const t = Math.floor(ms / 60_000) * 60;
      let at: { time: number; value: number } | null = null;
      for (const p of points) {
        if (p.time > t) break;
        at = p;
      }
      return at && t - at.time <= 300 ? at : null;
    };
  }, [points]);

  useEffect(() => {
    const series = seriesRef.current;
    const host = hostRef.current;
    if (!series || !host) return;
    series.setData(points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
    const sideInk = readToken(right === 'C' ? '--bull' : '--bear', undefined, host);
    const ink = readToken('--text-primary', undefined, host);
    const marks: SeriesMarker<Time>[] = [];
    const call = calledAt ? barAt(calledAt) : null;
    if (call) marks.push({ time: call.time as UTCTimestamp, position: right === 'C' ? 'belowBar' : 'aboveBar', color: sideInk, shape: right === 'C' ? 'arrowUp' : 'arrowDown', text: 'Call' });
    const out = exitAt ? barAt(exitAt) : null;
    if (out) marks.push({ time: out.time as UTCTimestamp, position: 'inBar', color: ink, shape: 'square', text: 'Out' });
    markersRef.current?.setMarkers(marks.sort((a, b) => (a.time as number) - (b.time as number)));
    if (ruleRef.current) {
      series.removePriceLine(ruleRef.current);
      ruleRef.current = null;
    }
    if (calledSpot && calledSpot > 0) {
      ruleRef.current = series.createPriceLine({ price: calledSpot, color: sideInk, lineStyle: LineStyle.Dotted, lineWidth: 1, axisLabelVisible: true, title: 'At call' });
    }
    chartRef.current?.timeScale().fitContent();
  }, [points, made, calledAt, calledSpot, exitAt, right, barAt]);

  const shownDay = bars.key === key && bars.day ? bars.day : day;
  const sessionWord = live && shownDay === day ? 'this session, each minute' : `the session of ${nyDay(nyWallTime(Number(shownDay.slice(0, 4)), Number(shownDay.slice(5, 7)), Number(shownDay.slice(8, 10)), 12), { weekday: true })}`;
  const last = points.length ? points[points.length - 1].value : 0;
  const shown = live && spot > 0 ? spot : last;
  const first = points.length ? points[0].value : 0;
  const move = first > 0 && shown > 0 ? ((shown - first) / first) * 100 : NaN;

  return (
    <div className="border border-borderSubtle rounded-md bg-panel overflow-hidden flex flex-col" data-underlying-track={name} data-underlying-points={points.length}>
      <div className="px-3.5 pt-3 pb-2 flex items-baseline gap-3 min-w-0">
        <span className="font-mono text-t9 uppercase tracking-widest text-textPrimary">The underlying</span>
        <span className="font-mono text-t12 font-semibold text-textPrimary">{name}</span>
        <span className="font-mono text-t12 tnum text-textPrimary">{shown > 0 ? `$${shown.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</span>
        {Number.isFinite(move) ? <span className={`font-mono text-t11 tnum ${move >= 0 ? 'text-bull' : 'text-bear'}`}>{`${move >= 0 ? '+' : '−'}${Math.abs(move).toFixed(2)}%`}</span> : null}
        <span className="ml-auto font-mono text-t10 text-textMuted truncate">{sessionWord}</span>
      </div>
      <div className="relative h-[200px]">
        <div ref={hostRef} className="absolute inset-0" />
        {bars.key === key && bars.status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center font-mono text-t10 text-textMuted">{bars.status === 'loading' ? 'Reading the minutes' : 'No minutes on this session yet'}</div>
        )}
      </div>
    </div>
  );
};

export default UnderlyingTrack;
