/* One name's or one cut's running net call and net put premium through the session, with the price as a quiet
   reference line and volume along the floor. The money lines are the subject; the price is squeezed into a band. */

import { useCallback, useEffect, useRef } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import {
  createChart,
  HistogramSeries,
  LineSeries,
  LineType,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type MouseEventParams,
  type Time,
  type TickMarkType,
  type UTCTimestamp,
  LineStyle,
} from 'lightweight-charts';
import { VENDOR_TOTAL_NOTE, MONEYNESS, NET_SEGMENTS, type MoneynessKey, type NetFlowSegment } from '../../data/flowBook';
import { sessionEndMin, tapeSessionIso, usePaneFlow, usd as fmtUsd } from '../../data/traceLive';
import { isLiveDay, shortDay } from './dayWords';
import { nyClock, nyParts, nyTickMarks, nyTimeFormatter, SESSION_OPEN_MIN } from '../../core/nyTime';
import { getResolvedTheme, readToken, useColourVision, useResolvedTheme } from '../../theme/theme';
import { earnMarks, weightInk, type InkMarks } from './earnedInk';
import ResetViewControl from '../gex/ResetViewControl';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { SLEEVES, type SleeveKey } from '../../types/compass';
import CompanyLogo from '../ui/CompanyLogo';
import { coversSpan, coversTip } from './coversWords';

export const MONEY_OPTIONS: DropdownOption<MoneynessKey>[] = MONEYNESS.map(m => ({ value: m.key, label: m.label === 'All strikes' ? 'Any' : m.label, hint: m.hint }));
export const CLOCK_OPTIONS: DropdownOption<SleeveKey | 'all'>[] = [
  { value: 'all', label: 'Any', hint: 'Every tenor on the book' },
  ...SLEEVES.map(sl => ({ value: sl.key, label: sl.label, hint: sl.blurb })),
];

interface PaneInks { spot: string; calls: string; puts: string; callsDim: string; putsDim: string; volQuiet: string; volLoud: string; volTop: string; axis: string; cross: string; label: string }
/* Every ink is read off the page's tokens, so light, dark and the colour-vision pair each get their own set */
const paneInks = (): PaneInks => ({
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
/** The plot's ground: the inset on paper, the panel showing through on dark */
const paneGround = (host: Element | null): string => (getResolvedTheme() === 'light' ? readToken('--inset', undefined, host) : 'transparent');
const volInk = (v: number, m: InkMarks, k: PaneInks) => (v >= m.top ? k.volTop : v >= m.bar ? k.volLoud : k.volQuiet);
/* Each point wears its meaning: calls above zero bought (green), puts above zero bought (red) */
function inkLine(pts: { time: UTCTimestamp; value: number }[], line: 'calls' | 'puts', full: boolean, k: PaneInks) {
  const up = full ? k.calls : k.callsDim;
  const down = full ? k.puts : k.putsDim;
  return pts.map(p => ({ ...p, color: line === 'calls' ? (p.value >= 0 ? up : down) : p.value > 0 ? down : up }));
}
const TIP_VOL_BASE = 'ml-auto font-mono text-t11 tnum';

const SegPick = ({ seg, onSeg, allowed }: { seg: NetFlowSegment; onSeg: (s: NetFlowSegment) => void; allowed?: (s: NetFlowSegment) => boolean }) => (
  <DropdownSelect
    label="Cut"
    value={seg}
    options={NET_SEGMENTS.filter(s => !allowed || allowed(s.key)).map(s => ({ value: s.key, label: s.label, group: s.group }))}
    onChange={onSeg}
    title="Which part of the market this pane watches"
    testId="net-flow-cut"
  />
);

interface NetFlowPaneProps {
  seg: NetFlowSegment;
  mny: MoneynessKey;
  onSeg: (s: NetFlowSegment) => void;
  onMny: (m: MoneynessKey) => void;
  onExpand?: () => void;
  expanded?: boolean;
  /** One name across every expiry; the cut picker hides */
  ticker?: string;
  /** DTE ceiling of a cut: 1 on the 0DTE desk, Infinity for a name */
  dteMax?: number;
  /** Which cuts the picker offers */
  segments?: (s: NetFlowSegment) => boolean;
  /** Off when the host carries the cut cards for several panes */
  cutCards?: boolean;
  /** Said on the head when the host's cut does not reach this pane's series */
  uncutNote?: string;
}

const NetFlowPane = ({ seg, mny, onSeg, onMny, onExpand, expanded, ticker, dteMax = 1, cutCards = true, segments, uncutNote }: NetFlowPaneProps) => {
  const appTheme = useResolvedTheme();
  const vision = useColourVision();
  const paper = appTheme === 'light';
  const inksNow = paneInks();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const spotRef = useRef<ISeriesApi<'Line'> | null>(null);
  const callRef = useRef<ISeriesApi<'Line'> | null>(null);
  const putRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const loadedRef = useRef('');
  /** The volume floor's ink marks for what is on screen; the readout inks its figure from them */
  const volMarksRef = useRef<InkMarks>({ bar: Infinity, top: Infinity });

  /* The readout is written straight to the DOM per crosshair move, so a hover never re-renders the pane */
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipTimeRef = useRef<HTMLSpanElement | null>(null);
  const tipSpotLabelRef = useRef<HTMLSpanElement | null>(null);
  const tipSpotRef = useRef<HTMLSpanElement | null>(null);
  const tipCallRef = useRef<HTMLSpanElement | null>(null);
  const tipPutRef = useRef<HTMLSpanElement | null>(null);
  const tipVolRef = useRef<HTMLSpanElement | null>(null);
  const refNameRef = useRef('SPY');
  /** Volume per minute, for a crosshair that lands between stamps */
  const volChunksRef = useRef<{ time: number; value: number }[]>([]);
  /** The money lines' points, kept so a hover can re-ink them */
  const lineDataRef = useRef<{ calls: { time: UTCTimestamp; value: number }[]; puts: { time: UTCTimestamp; value: number }[] }>({ calls: [], puts: [] });

  /* the price line: the name's own, or SPY's as the reference on a cut */
  const ref = ticker ?? 'SPY';
  const own = usePaneFlow({ ticker: ticker ?? null, seg, mny, zeroDte: dteMax <= 1, enabled: true });
  const series = own.rows;
  const tail = series.length ? series[series.length - 1] : null;
  /* a name's minutes carry gross contracts; a cut's only the net, so a cut prints no volume figure */
  const headVol = ticker ? series.reduce((a, p) => a + p.vol, 0) : null;
  const ncp = tail ? tail.callPrem : 0;
  const npp = tail ? tail.putPrem : 0;
  const endMin = sessionEndMin(ref);
  const nowP = nyParts(new Date());
  const runningNow = isLiveDay() && nowP.hour * 60 + nowP.minute < endMin;
  /* the stretch the figure covers, off the series itself (data/traceRows NetCovers): a name's ticks start at its 09:30,
     a cut's minutes at the feed's own day start — never a hard-coded bell */
  const windowWords = coversSpan(own.covers) || (runningNow ? `09:30–${tail ? nyClock(tail.time * 1000, { zone: true }) : 'now'}` : `09:30–${endMin === 975 ? '16:15' : '16:00'} ET`);
  const coverTip = coversTip(own.covers);
  /* at rest the readout holds the latest minute; a hover writes over it */
  const restTip = useCallback(() => {
    const card = tipRef.current;
    if (!card || card.style.opacity === '1' || !tail) return;
    if (tipTimeRef.current) tipTimeRef.current.textContent = `${nyClock(tail.time * 1000)} ET · latest`;
    if (tipSpotLabelRef.current) tipSpotLabelRef.current.textContent = ref;
    if (tipSpotRef.current) tipSpotRef.current.textContent = tail.price > 0 ? `$${tail.price.toFixed(2)}` : '—';
    if (tipCallRef.current) tipCallRef.current.textContent = fmtUsd(tail.callPrem);
    if (tipPutRef.current) tipPutRef.current.textContent = fmtUsd(tail.putPrem);
    if (tipVolRef.current) tipVolRef.current.textContent = tail.vol.toLocaleString('en-US');
  }, [tail, ref]);
  useEffect(() => {
    restTip();
  }, [restTip]);
  const restTipRef = useRef(restTip);
  restTipRef.current = restTip;
  const emptyNote = series.length ? null : own.waiting ? 'Reading the minutes…' : own.fault ? 'This read did not land — the line fills when the feed answers' : 'No flow on this cut yet';

  /* set while rendering, so a hover before the effect lands names this pane's ticker */
  refNameRef.current = ref;

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

    const k0 = paneInks();
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: paneGround(container) },
        textColor: k0.axis,
        fontFamily: "'Inter', sans-serif",
        fontSize: 10,
        attributionLogo: false,
      },
      localization: { timeFormatter: (t: Time) => (typeof t === 'number' ? nyClock(t * 1000) : nyTimeFormatter(t)) },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      /* minimumWidth fixes the axes' width from the first frame, so the plot does not shrink a frame after mount;
         entireTextOnly drops a label the edge would cut */
      rightPriceScale: { borderVisible: false, minimumWidth: 60, entireTextOnly: true },
      leftPriceScale: { visible: true, borderVisible: false, minimumWidth: 52, entireTextOnly: true },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 14,
        /* the lead minutes before the bell carry no label, or the edge cuts "09:10" to ":10" */
        tickMarkFormatter: (t: Time, type: TickMarkType) => {
          const p = nyParts((t as number) * 1000);
          return typeof t === 'number' && p.hour * 60 + p.minute < SESSION_OPEN_MIN ? '' : nyTickMarks(t, type, 'en-US');
        },
      },
      crosshair: {
        vertLine: { color: k0.cross, labelBackgroundColor: k0.label },
        horzLine: { color: k0.cross, labelBackgroundColor: k0.label },
      },
    });

    const spot = chart.addSeries(LineSeries, {
      priceScaleId: 'left',
      color: k0.spot,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    /* lines, not areas: an area fills to its scale's floor and floods the pane */
    const premFormat = { type: 'custom' as const, formatter: (v: number) => fmtUsd(v), minMove: 1 };
    const calls = chart.addSeries(LineSeries, {
      color: k0.calls,
      lineWidth: 2,
      lineType: LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: premFormat,
    });
    const puts = chart.addSeries(LineSeries, {
      color: k0.puts,
      lineStyle: LineStyle.Dashed,
      lineWidth: 2,
      lineType: LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: premFormat,
    });
    /* a histogram, because each bar carries its own ink (quiet, loud, the top bar) */
    const vol = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      color: k0.volQuiet,
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.16, bottom: 0.2 } });
    /* the price gets a middle band so its swings never outweigh the money lines */
    chart.priceScale('left').applyOptions({ scaleMargins: { top: 0.4, bottom: 0.3 } });

    chartRef.current = chart;
    spotRef.current = spot;
    callRef.current = calls;
    putRef.current = puts;
    volRef.current = vol;

    /* both scales freeze on first touch; reset gives them back */
    const freezeScale = () => {
      chart.priceScale('right').applyOptions({ autoScale: false });
      chart.priceScale('left').applyOptions({ autoScale: false });
    };
    container.addEventListener('wheel', freezeScale, { passive: true });
    container.addEventListener('pointerdown', freezeScale);

    const setInk = (el: HTMLElement, bull: boolean) => {
      el.classList.remove('text-bull', 'text-bear');
      el.classList.add(bull ? 'text-bull' : 'text-bear');
    };
    /* the line nearest the pointer steps forward and the others dim; options change only when the pick does */
    type LinePick = 'spot' | 'calls' | 'puts' | null;
    let picked: LinePick = null;
    const REACH = 14;
    const applyPick = (next: LinePick) => {
      if (next === picked) return;
      picked = next;
      const k = paneInks();
      const d = lineDataRef.current;
      calls.setData(inkLine(d.calls, 'calls', next === null || next === 'calls', k));
      puts.setData(inkLine(d.puts, 'puts', next === null || next === 'puts', k));
      calls.applyOptions({ lineWidth: (next === 'calls' ? 3 : 2) as LineWidth });
      puts.applyOptions({ lineWidth: (next === 'puts' ? 3 : 2) as LineWidth });
      spot.applyOptions({ color: k.spot, lineWidth: (next === 'spot' ? 3 : 1) as LineWidth });
      (
        [
          ['spot', tipSpotRef.current],
          ['calls', tipCallRef.current],
          ['puts', tipPutRef.current],
        ] as [LinePick, HTMLElement | null][]
      ).forEach(([key, el]) => el?.classList.toggle('font-bold', key === next));
    };

    const onMove = (param: MouseEventParams) => {
      const card = tipRef.current;
      if (!card) return;
      if (!param.time || !param.point) {
        card.style.opacity = '0';
        card.style.visibility = 'hidden';
        applyPick(null);
        restTipRef.current();
        return;
      }
      if (tipTimeRef.current) tipTimeRef.current.textContent = typeof param.time === 'number' ? `${nyClock(param.time * 1000)} ET` : nyTimeFormatter(param.time);

      const val = (s: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | null) =>
        s ? (param.seriesData.get(s) as { value?: number } | undefined)?.value : undefined;
      const sp = val(spotRef.current);
      const c = val(callRef.current);
      const p = val(putRef.current);
      /* the true count, not the drawn (root-compressed) bar: last value at or before the hovered minute */
      let v: number | undefined;
      {
        const t = param.time as number;
        const chunks = volChunksRef.current;
        for (let i = chunks.length - 1; i >= 0; i--) {
          if (chunks[i].time <= t) {
            v = chunks[i].value;
            break;
          }
        }
      }

      /* pixel distance through each series' own scale */
      const y = param.point.y;
      const distTo = (srs: ISeriesApi<'Line'> | null, value: number | undefined) => {
        if (!srs || value == null) return Infinity;
        const coord = srs.priceToCoordinate(value);
        return coord == null ? Infinity : Math.abs(coord - y);
      };
      const nearest: [LinePick, number][] = [
        ['calls', distTo(callRef.current, c)],
        ['puts', distTo(putRef.current, p)],
        ['spot', distTo(spotRef.current, sp)],
      ];
      nearest.sort((a, b) => a[1] - b[1]);
      applyPick(nearest[0][1] <= REACH ? nearest[0][0] : null);

      if (tipSpotLabelRef.current) tipSpotLabelRef.current.textContent = refNameRef.current;
      if (tipSpotRef.current) tipSpotRef.current.textContent = sp != null ? `$${sp.toFixed(2)}` : '—';
      if (tipCallRef.current) {
        tipCallRef.current.textContent = c != null ? fmtUsd(c) : '—';
        if (c != null) setInk(tipCallRef.current, c >= 0);
      }
      if (tipPutRef.current) {
        tipPutRef.current.textContent = p != null ? fmtUsd(p) : '—';
        if (p != null) setInk(tipPutRef.current, p < 0);
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
      container.removeEventListener('wheel', freezeScale);
      container.removeEventListener('pointerdown', freezeScale);
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
      return;
    }
    const id = `${seg}-${mny}-${ref}-${dteMax}`;
    const spotData = series.filter(p => p.price > 0).map(p => ({ time: p.time as UTCTimestamp, value: p.price }));
    const callData = series.map(p => ({ time: p.time as UTCTimestamp, value: p.callPrem }));
    const putData = series.map(p => ({ time: p.time as UTCTimestamp, value: p.putPrem }));
    /* marks over exactly the bars on screen; bars drawn on a square-root height because volume is heavy-tailed */
    const marks = earnMarks(series, p => p.vol);
    volMarksRef.current = marks;
    const inks = paneInks();
    /* twenty empty minutes ahead of the first bar seat the 09:30 label whole */
    const lead: { time: UTCTimestamp }[] = Array.from({ length: 20 }, (_, i) => ({ time: (series[0].time - (20 - i) * 60) as UTCTimestamp }));
    vol.setData([...lead, ...series.map(p => ({ time: p.time as UTCTimestamp, value: Math.sqrt(Math.abs(p.vol)), color: volInk(Math.abs(p.vol), marks, inks) }))]);
    volChunksRef.current = series.map(p => ({ time: p.time, value: p.vol }));
    /* the whole series every pass: the running totals move every earlier point */
    spot.setData(spotData);
    lineDataRef.current = { calls: callData, puts: putData };
    calls.setData(inkLine(callData, 'calls', true, inks));
    puts.setData(inkLine(putData, 'puts', true, inks));
    if (loadedRef.current !== id) {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.priceScale('left').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    }
    loadedRef.current = id;
  }, [seg, mny, ref, dteMax, appTheme, series]);

  /* the page's theme turned: re-ink the chart in place */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const k = paneInks();
    chart.applyOptions({
      layout: { background: { color: paneGround(containerRef.current) }, textColor: k.axis },
      crosshair: { vertLine: { color: k.cross, labelBackgroundColor: k.label }, horzLine: { color: k.cross, labelBackgroundColor: k.label } },
    });
    spotRef.current?.applyOptions({ color: k.spot });
    callRef.current?.applyOptions({ color: k.calls });
    putRef.current?.applyOptions({ color: k.puts, lineStyle: LineStyle.Dashed });
    const d = lineDataRef.current;
    callRef.current?.setData(inkLine(d.calls, 'calls', true, k));
    putRef.current?.setData(inkLine(d.puts, 'puts', true, k));
  }, [appTheme, vision]);

  /* data-menu-clip: the box clips overflow, so its menus size to the room left (ui/menuRoom) */
  return (
    <div data-menu-clip data-theme={paper ? 'light' : 'dark'} className={`border border-borderSubtle rounded-xs overflow-hidden flex flex-col h-full ${paper ? 'bg-inset' : 'bg-panel'}`}>
      {/* min-h, not h: on a narrow pane the head wraps rather than clipping its figures */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1 min-h-8 shrink-0 select-none">
        {ticker ? (
          <span className="flex items-center gap-1.5 shrink-0">
            <CompanyLogo ticker={ticker} size={16} />
            <span className="font-mono text-t11 font-bold text-textPrimary">{ticker}</span>
          </span>
        ) : (
          <SegPick seg={seg} onSeg={onSeg} allowed={segments} />
        )}
        {/* the feed's market minutes take a strike cut; a name's ticks and a sector's tide do not */}
        {cutCards && !ticker && !seg.startsWith('sector:') && <DropdownSelect label="Moneyness" value={mny} options={MONEY_OPTIONS} onChange={onMny} title="Which strikes against the stock" testId="pane-money" />}
        <span className="ml-auto min-w-0 flex items-center justify-end gap-2.5 flex-wrap font-mono text-t11 tnum [&>span]:whitespace-nowrap">
          <span style={{ color: inksNow.spot }} data-pane-legend="spot" title={ticker ? `The thin solid line: ${ref}'s price, on the left scale` : `${ref}'s price as a clock to read the cut against, not the cut's own price`}>
            <span aria-hidden className="inline-block align-middle w-3.5 mr-1 border-t" style={{ borderColor: inksNow.spot }} />
            {ticker ? `${ref} price` : seg === 'indexes' ? `${ref} price for reference, not an index` : `${ref} price for reference`}
          </span>
          {!ticker && (
            <span className="text-textSecondary uppercase text-t11 tracking-wider" data-pane-scope title="The figures are every name in this cut, not the reference name's own">
              {seg === 'all' ? "all names'" : "the cut's names'"} {dteMax <= 1 ? '0DTE flow' : 'flow'}
            </span>
          )}
          {ticker && uncutNote && (
            <span className="text-warn uppercase text-t11 tracking-wider" title={`This pane is the name's money across ${uncutNote}`} data-pane-uncut>
              every expiry · not cut
            </span>
          )}
          {ticker && dteMax <= 1 && (
            <span className="text-textMuted uppercase text-t11 tracking-wider" title="The feed has no same-day-only minutes for one name, so this is every expiry">
              every expiry
            </span>
          )}
          <span title={`${coverTip || (ticker ? 'Minute ticks for the name' : 'Net flow by expiry')}. ${VENDOR_TOTAL_NOTE}`}>
            <span aria-hidden data-pane-legend="calls" className="inline-block align-middle w-3.5 mr-1 border-t-2" style={{ borderColor: inksNow.calls }} title="Solid line: net call premium" />
            <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net calls</span>
            <span className={ncp >= 0 ? 'text-bull' : 'text-bear'}>{tail ? fmtUsd(ncp) : '—'}</span>
          </span>
          <span title={`${coverTip ? `${coverTip}. ` : ''}${VENDOR_TOTAL_NOTE}`}>
            <span aria-hidden data-pane-legend="puts" className="inline-block align-middle w-3.5 mr-1 border-t-2 border-dashed" style={{ borderColor: inksNow.puts }} title="Dashed line: net put premium" />
            <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net puts</span>
            <span className={npp >= 0 ? 'text-bear' : 'text-bull'}>{tail ? fmtUsd(npp) : '—'}</span>
            {!ticker && tail && windowWords && <span className="text-textSecondary text-t11 ml-1" data-pane-window>· {windowWords}</span>}
          </span>
          {ticker && tail && (
            <span title={`Net calls less net puts, the minute ticks${coverTip ? ` · ${coverTip}` : ''}. The same figure as Intervals`}>
              <span className="text-textMuted uppercase text-t11 tracking-wider mr-1">net</span>
              <span className={ncp - npp >= 0 ? 'text-bull' : 'text-bear'}>{ncp - npp < 0 ? '−' : '+'}{fmtUsd(Math.abs(ncp - npp))}</span>
              <span className="text-textSecondary text-t11 ml-1" data-pane-window>· {windowWords}{isLiveDay() ? '' : `, ${shortDay(tapeSessionIso())}`}</span>
            </span>
          )}
          {headVol != null && tail && <span className="text-textSecondary">{headVol.toLocaleString('en-US')} vol</span>}
          {/* in the legend's own row, so a wrapped legend never leaves the button a line to itself */}
          {onExpand && (
            <button
              onClick={onExpand}
              title={expanded ? 'Leave full screen' : 'Full screen'}
              aria-label={expanded ? 'Leave full screen' : 'Show this pane full screen'}
              className="p-1.5 -my-1 -mr-1.5 max-sm:p-4 max-sm:-my-4 max-sm:-mr-4 rounded text-textSecondary hover:text-textPrimary hover:bg-ink/[0.04] transition-colors"
            >
              {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            </button>
          )}
        </span>
      </div>
      <div className="relative flex-1 min-h-0" onDoubleClick={resetView}>
        <div ref={containerRef} className="absolute inset-0" />
        {emptyNote && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <span className="font-mono text-t11 uppercase tracking-widest text-textMuted" data-pane-empty>{emptyNote}</span>
          </div>
        )}
        {/* the hover's readout, pinned top-left past the price axis; hidden at rest since the head holds the latest */}
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
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.spot }} />
            <span ref={tipSpotLabelRef} className="font-mono text-t11 uppercase tracking-wider text-textMuted">
              {ref}
            </span>
            <span ref={tipSpotRef} className="ml-auto font-mono text-t11 tnum text-textPrimary">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.calls }} />
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Net calls</span>
            <span ref={tipCallRef} className="ml-auto font-mono text-t11 tnum text-bull">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 cvd-hollow" style={{ background: inksNow.puts, color: inksNow.puts }} />
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Net puts</span>
            <span ref={tipPutRef} className="ml-auto font-mono text-t11 tnum text-bear">
              —
            </span>
          </span>
          <span className="flex items-center gap-1.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: inksNow.volLoud }} />
            {/* a cut's minutes carry a running net volume, so its bar is the change in it, not contracts traded */}
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted" title={ticker ? 'Contracts traded that minute' : "Change in the cut's net volume that minute, sign dropped"}>{ticker ? 'Volume' : 'Net vol chg'}</span>
            <span ref={tipVolRef} className={`${TIP_VOL_BASE} text-textSecondary`}>
              —
            </span>
          </span>
        </div>
        <ResetViewControl onReset={resetView} pillClass="right-16 top-2" />
      </div>
    </div>
  );
};

export default NetFlowPane;
