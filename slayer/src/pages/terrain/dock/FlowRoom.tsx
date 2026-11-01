/*
==================================================
  SLAYER TERMINAL - THE NET FLOW ROOM (pages/terrain/dock/FlowRoom.tsx)

  The partner tree's fourth dock room (bfce19c, "Ladder · Heatmap · News · Net flow"): the name's net calls against its
  net puts through the session, the price a thin line on its own scale, the contracts along the floor, a glide card on
  hover — his pane's look (Trace's NetFlowPane: the solid call line, the dashed put line, each point wearing its
  meaning's ink, the head's figures, the 168px card).

  OUR ARITHMETIC AND OUR DATA, NOT HIS: the prints are the ones the chart's Flow pane and Net drift read on Terrain —
  data/paneFlow.ts on the server's option tape (one store per name, shared with every chart on the page: no new poll
  when a chart already reads it), under the desk's flow filters (the same Filters door) — and every minute is
  data/flowBuckets.ts signedFlowBars split by side (dock/flowRoomSeries.ts, held by scripts/flow-room-proof.ts). Net
  calls less net puts is the Net drift's figure. When the tape has nothing — the terminal down, the session not begun —
  the room says so; it never draws a line it does not have.
==================================================
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import CompanyLogo from '../../../components/ui/CompanyLogo';
import ResetViewControl from '../../../components/gex/ResetViewControl';
import { FlowFilterDoor } from '../../../components/gex/FlowFilterDoor';
import { displayBars } from '../../../components/gex/StrikeChart';
import { earnMarks, weightInk, type InkMarks } from '../../../components/trace/earnedInk';
import { usePaneFlow } from '../../../data/paneFlow';
import { FLOW_CHIPS, flowCaption, legsInNet } from '../../../data/flowBuckets';
import { setDeskPrefs, useDeskPrefs, type FlowFilters } from '../../../data/deskPrefs';
import { usd as fmtUsd } from '../../../data/traceRows';
import { nyClock, nyTickMarks, nyTimeFormatter } from '../../../core/nyTime';
import { getResolvedTheme, readToken, useColourVision, useResolvedTheme } from '../../../theme/theme';
import { flowRoomSeries, lastPrintMinute, type FlowRoomPoint } from './flowRoomSeries';

interface Inks { spot: string; calls: string; puts: string; callsDim: string; putsDim: string; volQuiet: string; volLoud: string; volTop: string; axis: string; cross: string; label: string }
/* every ink a token, as the partner's pane reads them: paper and the dark terminal each answer with their own set */
const inks = (): Inks => ({
  spot: readToken('--text-primary'),
  calls: readToken('--bull'),
  puts: readToken('--bear'),
  callsDim: readToken('--bull', 0.3),
  putsDim: readToken('--bear', 0.3),
  volQuiet: readToken('--text-secondary', 0.3),
  volLoud: readToken('--text-secondary', 0.9),
  volTop: readToken('--supreme'),
  axis: readToken('--text-muted'),
  cross: readToken('--ink', 0.25),
  label: readToken('--border-muted'),
});
const ground = (host: Element | null): string => (getResolvedTheme() === 'light' ? readToken('--inset', undefined, host) : 'transparent');
const volInk = (v: number, m: InkMarks, k: Inks) => (v >= m.top ? k.volTop : v >= m.bar ? k.volLoud : k.volQuiet);
/* each point wears its meaning: calls above zero bought (green), puts above zero bought (red) */
function inkLine(pts: { time: UTCTimestamp; value: number }[], line: 'calls' | 'puts', full: boolean, k: Inks) {
  const up = full ? k.calls : k.callsDim;
  const down = full ? k.puts : k.putsDim;
  return pts.map(p => ({ ...p, color: line === 'calls' ? (p.value >= 0 ? up : down) : p.value > 0 ? down : up }));
}
const TIP_VOL_BASE = 'ml-auto font-mono text-t11 tnum';

/** The chart's own one-minute closes for the name, by minute — the bars the chart already holds, never a new read */
function closesOf(ticker: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const b of displayBars(ticker, 1)) if (b.close > 0) out.set(Math.floor(b.time / 60) * 60, b.close);
  return out;
}

const FlowRoom = ({ ticker }: { ticker: string }) => {
  const appTheme = useResolvedTheme();
  const vision = useColourVision();
  const paper = appTheme === 'light';
  const k0 = inks();
  const { flowFilters } = useDeskPrefs();
  const legs = legsInNet(flowFilters);
  const feed = usePaneFlow(ticker, flowFilters, true, 'tape');
  /* the price line re-reads the chart's bars on the tape's own pace */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  const series = useMemo<FlowRoomPoint[]>(() => {
    if (!feed.span || !feed.rows.length) return [];
    const last = lastPrintMinute(feed.rows);
    if (!last) return [];
    return flowRoomSeries(feed.rows, feed.span.from / 1000, Math.min(feed.span.to / 1000, last + 60), legs, closesOf(ticker));
  }, [feed.rows, feed.span, legs, ticker, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const tail = series.length ? series[series.length - 1] : null;
  const ncp = tail?.callPrem ?? 0;
  const npp = tail?.putPrem ?? 0;
  const headVol = series.reduce((a, p) => a + p.vol, 0);
  const windowWords = series.length ? `${nyClock(series[0].time * 1000)}–${nyClock(series[series.length - 1].time * 1000 + 60_000)} ET` : '';
  const emptyNote = series.length
    ? null
    : !feed.ready
      ? 'Reading the tape…'
      : feed.fault
        ? `No prints: ${feed.fault}`
        : feed.filling
          ? 'Reading the session back…'
          : 'No print under these filters this session';

  const step = (key: keyof FlowFilters) => {
    const chip = FLOW_CHIPS.find(c => c.key === key);
    if (!chip) return;
    const at = chip.options.findIndex(o => o.value === flowFilters[key]);
    setDeskPrefs({ flowFilters: { [key]: chip.options[(at + 1) % chip.options.length].value } as Partial<FlowFilters> });
  };

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const spotRef = useRef<ISeriesApi<'Line'> | null>(null);
  const callRef = useRef<ISeriesApi<'Line'> | null>(null);
  const putRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const loadedRef = useRef('');
  const volMarksRef = useRef<InkMarks>({ bar: Infinity, top: Infinity });
  const volChunksRef = useRef<{ time: number; value: number }[]>([]);
  const lineDataRef = useRef<{ calls: { time: UTCTimestamp; value: number }[]; puts: { time: UTCTimestamp; value: number }[] }>({ calls: [], puts: [] });
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipTimeRef = useRef<HTMLSpanElement | null>(null);
  const tipSpotRef = useRef<HTMLSpanElement | null>(null);
  const tipCallRef = useRef<HTMLSpanElement | null>(null);
  const tipPutRef = useRef<HTMLSpanElement | null>(null);
  const tipVolRef = useRef<HTMLSpanElement | null>(null);

  const resetView = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.priceScale('right').applyOptions({ autoScale: true });
    chart.priceScale('left').applyOptions({ autoScale: true });
    chart.timeScale().fitContent();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const k = inks();
    const chart = createChart(container, {
      autoSize: true,
      layout: { background: { color: ground(container) }, textColor: k.axis, fontFamily: "'Inter', sans-serif", fontSize: 10, attributionLogo: false },
      localization: { timeFormatter: (t: Time) => (typeof t === 'number' ? nyClock(t * 1000) : nyTimeFormatter(t)) },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false, minimumWidth: 56, entireTextOnly: true },
      leftPriceScale: { visible: true, borderVisible: false, minimumWidth: 48, entireTextOnly: true },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 6, tickMarkFormatter: nyTickMarks },
      crosshair: { vertLine: { color: k.cross, labelBackgroundColor: k.label }, horzLine: { color: k.cross, labelBackgroundColor: k.label } },
    });
    const spot = chart.addSeries(LineSeries, { priceScaleId: 'left', color: k.spot, lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const premFormat = { type: 'custom' as const, formatter: (v: number) => fmtUsd(v), minMove: 1 };
    const calls = chart.addSeries(LineSeries, { color: k.calls, lineWidth: 2, lineType: LineType.Simple, priceLineVisible: false, lastValueVisible: false, priceFormat: premFormat });
    const puts = chart.addSeries(LineSeries, { color: k.puts, lineStyle: LineStyle.Dashed, lineWidth: 2, lineType: LineType.Simple, priceLineVisible: false, lastValueVisible: false, priceFormat: premFormat });
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', color: k.volQuiet, priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.16, bottom: 0.2 } });
    chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.4, bottom: 0.3 } });
    chartRef.current = chart;
    spotRef.current = spot;
    callRef.current = calls;
    putRef.current = puts;
    volRef.current = vol;

    /* both scales hold on first touch; the reset (or a double press) gives them back */
    const freeze = () => {
      chart.priceScale('right').applyOptions({ autoScale: false });
      chart.priceScale('left').applyOptions({ autoScale: false });
    };
    container.addEventListener('wheel', freeze, { passive: true });
    container.addEventListener('pointerdown', freeze);

    type Pick = 'spot' | 'calls' | 'puts' | null;
    let picked: Pick = null;
    const applyPick = (next: Pick) => {
      if (next === picked) return;
      picked = next;
      const kk = inks();
      const d = lineDataRef.current;
      calls.setData(inkLine(d.calls, 'calls', next === null || next === 'calls', kk));
      puts.setData(inkLine(d.puts, 'puts', next === null || next === 'puts', kk));
      calls.applyOptions({ lineWidth: (next === 'calls' ? 3 : 2) as LineWidth });
      puts.applyOptions({ lineWidth: (next === 'puts' ? 3 : 2) as LineWidth });
      spot.applyOptions({ lineWidth: (next === 'spot' ? 3 : 1) as LineWidth });
    };
    const onMove = (param: MouseEventParams) => {
      const card = tipRef.current;
      if (!card) return;
      if (!param.time || !param.point) {
        card.style.opacity = '0';
        card.style.visibility = 'hidden';
        applyPick(null);
        return;
      }
      const val = (s: ISeriesApi<'Line'> | null) => (s ? (param.seriesData.get(s) as { value?: number } | undefined)?.value : undefined);
      const sp = val(spotRef.current);
      const c = val(callRef.current);
      const p = val(putRef.current);
      let v: number | undefined;
      const t = param.time as number;
      for (let i = volChunksRef.current.length - 1; i >= 0; i--) {
        if (volChunksRef.current[i].time <= t) {
          v = volChunksRef.current[i].value;
          break;
        }
      }
      const y = param.point.y;
      const dist = (s: ISeriesApi<'Line'> | null, value: number | undefined) => {
        if (!s || value == null) return Infinity;
        const at = s.priceToCoordinate(value);
        return at == null ? Infinity : Math.abs(at - y);
      };
      const near = ([['calls', dist(callRef.current, c)], ['puts', dist(putRef.current, p)], ['spot', dist(spotRef.current, sp)]] as [Pick, number][]).sort((a, b) => a[1] - b[1]);
      applyPick(near[0][1] <= 14 ? near[0][0] : null);
      if (tipTimeRef.current) tipTimeRef.current.textContent = typeof param.time === 'number' ? `${nyClock(param.time * 1000)} ET` : nyTimeFormatter(param.time);
      if (tipSpotRef.current) tipSpotRef.current.textContent = sp != null ? `$${sp.toFixed(2)}` : '—';
      if (tipCallRef.current) {
        tipCallRef.current.textContent = c != null ? fmtUsd(c) : '—';
        tipCallRef.current.className = `ml-auto font-mono text-t11 tnum ${c == null || c >= 0 ? 'text-bull' : 'text-bear'}`;
      }
      if (tipPutRef.current) {
        tipPutRef.current.textContent = p != null ? fmtUsd(p) : '—';
        tipPutRef.current.className = `ml-auto font-mono text-t11 tnum ${p == null || p >= 0 ? 'text-bear' : 'text-bull'}`;
      }
      if (tipVolRef.current) {
        tipVolRef.current.textContent = v != null ? v.toLocaleString('en-US') : '—';
        tipVolRef.current.className = `${TIP_VOL_BASE} ${v != null ? weightInk(v, volMarksRef.current) : 'text-textSecondary'}`;
      }
      card.style.opacity = '1';
      card.style.visibility = 'visible';
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      container.removeEventListener('wheel', freeze);
      container.removeEventListener('pointerdown', freeze);
      chart.remove();
      chartRef.current = null;
      spotRef.current = null;
      callRef.current = null;
      putRef.current = null;
      volRef.current = null;
      loadedRef.current = '';
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const spot = spotRef.current;
    const calls = callRef.current;
    const puts = putRef.current;
    const vol = volRef.current;
    if (!chart || !spot || !calls || !puts || !vol) return;
    if (!series.length) {
      spot.setData([]);
      calls.setData([]);
      puts.setData([]);
      vol.setData([]);
      lineDataRef.current = { calls: [], puts: [] };
      return;
    }
    const k = inks();
    const callData = series.map(p => ({ time: p.time as UTCTimestamp, value: p.callPrem }));
    const putData = series.map(p => ({ time: p.time as UTCTimestamp, value: p.putPrem }));
    const marks = earnMarks(series, p => p.vol);
    volMarksRef.current = marks;
    vol.setData(series.map(p => ({ time: p.time as UTCTimestamp, value: Math.sqrt(p.vol), color: volInk(p.vol, marks, k) })));
    volChunksRef.current = series.map(p => ({ time: p.time, value: p.vol }));
    spot.setData(series.filter(p => p.price > 0).map(p => ({ time: p.time as UTCTimestamp, value: p.price })));
    lineDataRef.current = { calls: callData, puts: putData };
    calls.setData(inkLine(callData, 'calls', true, k));
    puts.setData(inkLine(putData, 'puts', true, k));
    const id = `${ticker}|${series[0].time}`;
    if (loadedRef.current !== id) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.priceScale('left').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    }
    loadedRef.current = id;
  }, [series, ticker, appTheme]);

  /* the page turned: re-ink in place */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const k = inks();
    chart.applyOptions({
      layout: { background: { color: ground(containerRef.current) }, textColor: k.axis },
      crosshair: { vertLine: { color: k.cross, labelBackgroundColor: k.label }, horzLine: { color: k.cross, labelBackgroundColor: k.label } },
    });
    spotRef.current?.applyOptions({ color: k.spot });
    const d = lineDataRef.current;
    callRef.current?.setData(inkLine(d.calls, 'calls', true, k));
    putRef.current?.setData(inkLine(d.puts, 'puts', true, k));
  }, [appTheme, vision]);

  return (
    <div className="flex-1 min-h-0 flex flex-col p-1.5" data-dock-room="flow">
      <div data-menu-clip className={`border border-borderSubtle rounded-xs overflow-hidden flex flex-col h-full ${paper ? 'bg-inset' : 'bg-panel'}`}>
        {/* THE HEAD — the partner's pane head: the name, the cut (ours: the desk's flow filters, the chart's own door), and
            the figures — the price line's key, net calls, net puts, the net and its window, the contracts */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 min-h-8 shrink-0 select-none" data-flow-room-head>
          <span className="flex items-center gap-1.5 shrink-0">
            <CompanyLogo ticker={ticker} size={16} />
            <span className="font-mono text-t11 font-bold text-textPrimary">{ticker}</span>
          </span>
          <span className="font-mono text-t10 uppercase tracking-wider" title={flowCaption(flowFilters)}>
            <FlowFilterDoor filters={flowFilters} legsIn={legs} onStep={step} />
          </span>
          <span className="ml-auto min-w-0 flex items-center justify-end gap-x-2.5 gap-y-0.5 flex-wrap font-mono text-t11 tnum [&>span]:whitespace-nowrap">
            <span style={{ color: k0.spot }} data-pane-legend="spot" title={`The thin solid line: ${ticker}'s price off the chart's own bars, on the left scale`}>
              <span aria-hidden className="inline-block align-middle w-3.5 mr-1 border-t" style={{ borderColor: k0.spot }} />
              price
            </span>
            <span title="Solid line: the calls' signed premium from the session's open — bought at the ask up, sold at the bid down, opening prints only">
              <span aria-hidden data-pane-legend="calls" className="inline-block align-middle w-3.5 mr-1 border-t-2" style={{ borderColor: k0.calls }} />
              <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net calls</span>
              <span className={ncp >= 0 ? 'text-bull' : 'text-bear'} data-flow-room-calls>{tail ? fmtUsd(ncp) : '—'}</span>
            </span>
            <span title="Dashed line: the puts' premium bought less sold from the session's open, opening prints only">
              <span aria-hidden data-pane-legend="puts" className="inline-block align-middle w-3.5 mr-1 border-t-2 border-dashed" style={{ borderColor: k0.puts }} />
              <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net puts</span>
              <span className={npp >= 0 ? 'text-bear' : 'text-bull'} data-flow-room-puts>{tail ? fmtUsd(npp) : '—'}</span>
            </span>
            {tail && (
              <span title="Net calls less net puts — the chart's Net drift for this session, under the same filters">
                <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net</span>
                <span className={ncp - npp >= 0 ? 'text-bull' : 'text-bear'} data-flow-room-net>
                  {ncp - npp < 0 ? '−' : '+'}
                  {fmtUsd(Math.abs(ncp - npp))}
                </span>
                <span className="text-textSecondary text-t11 ml-1" data-pane-window>
                  · {windowWords}
                </span>
              </span>
            )}
            {tail && <span className="text-textSecondary">{headVol.toLocaleString('en-US')} contracts</span>}
          </span>
        </div>
        <div className="relative flex-1 min-h-0" onDoubleClick={resetView}>
          <div ref={containerRef} className="absolute inset-0" />
          {emptyNote && (
            <div className="absolute inset-0 z-10 flex items-center justify-center px-6 pointer-events-none">
              <span className="text-center font-mono text-t11 uppercase tracking-widest text-textMuted" data-pane-empty>
                {emptyNote}
              </span>
            </div>
          )}
          <div
            ref={tipRef}
            aria-hidden
            style={{ visibility: 'hidden' }}
            className="pointer-events-none absolute top-2 left-14 z-20 w-[168px] opacity-0 transition-opacity duration-100 border border-borderSubtle bg-panel/60 backdrop-blur-md rounded-md shadow-lg shadow-black/30 px-2.5 py-2"
          >
            <span ref={tipTimeRef} className="block font-mono text-t11 uppercase tracking-widest text-textMuted mb-1">
              --:--
            </span>
            <span className="flex items-center gap-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: k0.spot }} />
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">{ticker}</span>
              <span ref={tipSpotRef} className="ml-auto font-mono text-t11 tnum text-textPrimary">
                —
              </span>
            </span>
            <span className="flex items-center gap-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: k0.calls }} />
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Net calls</span>
              <span ref={tipCallRef} className="ml-auto font-mono text-t11 tnum text-bull">
                —
              </span>
            </span>
            <span className="flex items-center gap-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0 cvd-hollow" style={{ background: k0.puts, color: k0.puts }} />
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Net puts</span>
              <span ref={tipPutRef} className="ml-auto font-mono text-t11 tnum text-bear">
                —
              </span>
            </span>
            <span className="flex items-center gap-1.5 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: k0.volLoud }} />
              <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Contracts</span>
              <span ref={tipVolRef} className={`${TIP_VOL_BASE} text-textSecondary`}>
                —
              </span>
            </span>
          </div>
          {series.length > 0 && <ResetViewControl onReset={resetView} pillClass="right-16 top-2" />}
        </div>
      </div>
    </div>
  );
};

export default FlowRoom;
