/*
==================================================
  SLAYER TERMINAL - THE PAIR
  (components/gex/ComparePair.tsx)

  WHICH OF THE TWO HAS BEEN STRONGER — and is today's
  gap between them normal, or stretched? One name's
  price divided by the other's, one point a day.

  REBUILT 2026-09-20 (Noah: "it has no interactivity
  at all and i dont know what it does") onto the
  house's small chart; REDRAWN 2026-09-29 (the
  partner: "hard to read") as one silver line in a
  soft band; THE LIBRARY DIRECT since 2026-10-15
  (Noah: "the pair should be a trading view chart").

  SAID BY THE DRAWING (Noah, the same day, on that
  cut: "still looks so bland and like plain html …
  i dont even know whats its suppose to showcase
  cause when i hover over the dots i see nothing
  informative"). The line is a BASELINE at the
  average: above it the ratio is in the first
  name's territory and wears its ink with its ground
  under it, below it the second name's in the
  second's — the two inks the page gives the names
  everywhere — so "SPY ahead" and "QQQ ahead" are
  the two halves of the plot, said at its right
  edge. The usual range is a soft band whose edges
  and average are named on the plot at the left,
  the average's figure on the scale as the library's
  own dashed line. A day that closed outside the
  range is a warm mark ON the line, today a silver
  one. THE CARD: the house's pointer card on any day
  under the crosshair, the marks included — the two
  closes in their inks, the ratio, where that day
  sat and which name was further ahead than usual.
  The legend at the plot's top left reads the same
  day; today at rest.
==================================================
*/

import { longDay } from '../../data/bookWindow';
import { nyIsoDate } from '../../core/nyTime';
import { readMarketState } from '../../data/marketState';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BaselineSeries, LineStyle, createChart, createSeriesMarkers, type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp } from 'lightweight-charts';
import { buildPair, pairPlace, type DailyClose, type Pair } from '../../data/compare';
import { whalesDaily, type UwDaily } from '../../data/whales';
import { GuideDoor } from '../ui/GuideFocus';
import { CardRow, PointerFollowCard } from '../ui/PointerCard';
import { PlotNotesPrimitive } from '../record/plotNotesPrimitive';
import { daySurface } from './dayChart';
import { fmtDayLocal } from './chartTime';
import { nyTickMarks } from '../../core/nyTime';
import { useResolvedTheme } from '../../theme/theme';
import { THERMAL_WARM, alpha, resolveInk } from './paletteInk';
import { PAIR_H, PAIR_READ_H } from './compareSkeletons';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const fmtRatio = (v: number) => v.toFixed(v >= 10 ? 2 : 3);
const fmtClose = (v: number) => v.toFixed(2);
const dayWords = (t: number) => new Date(t * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

interface Props {
  a: string;
  b: string;
  aInk: string;
  bInk: string;
  /** Bumped on the scan cadence — the pair does not need every tick */
  nonce: number;
  /** The page's guide, from this box's head */
  guideOpen?: boolean;
  onGuide?: () => void;
}

interface Day {
  ratio: number;
  closeA: number;
  closeB: number;
  today: boolean;
}

const ComparePair = ({ a, b, aInk, bInk, nonce, guideOpen = false, onGuide }: Props) => {
  const paper = useResolvedTheme() === 'light';
  /* the months of sessions behind the range — the vendor's daily bars, regular session only */
  const [daily, setDaily] = useState<{ a: string; b: string; da: DailyClose[]; db: DailyClose[] } | null>(null);
  useEffect(() => {
    let live = true;
    const closes = (rows: UwDaily[]) =>
      (Array.isArray(rows) ? rows : [])
        .filter(r => !r.market_time || r.market_time === 'r')
        .map(r => ({ date: String(r.date ?? '').slice(0, 10), close: Number(r.close) }))
        .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.close > 0);
    Promise.all([whalesDaily(a).catch(() => [] as UwDaily[]), whalesDaily(b).catch(() => [] as UwDaily[])]).then(([ra, rb]) => {
      if (live) setDaily({ a, b, da: closes(ra), db: closes(rb) });
    });
    return () => {
      live = false;
    };
  }, [a, b]);
  const fit = daily && daily.a === a && daily.b === b ? daily : null;
  const pair: Pair = useMemo(() => buildPair(a, b, fit?.da, fit?.db), [a, b, nonce, fit]); // eslint-disable-line react-hooks/exhaustive-deps

  /* every completed session, and today's point one step past the last */
  const done = pair.sessions.length > 1 ? pair.sessions.slice(0, -1) : pair.sessions;
  const last = pair.sessions[pair.sessions.length - 1];
  const todayAt = pair.today[pair.today.length - 1] ?? (pair.sessions.length > 1 ? last : undefined);
  const hasBand = pair.mean != null && pair.sd != null && pair.sd > 0;
  const top = hasBand ? (pair.mean as number) + (pair.sd as number) : null;
  const bottom = hasBand ? (pair.mean as number) - (pair.sd as number) : null;
  const isOutside = (v: number) => top != null && bottom != null && (v > top || v < bottom);

  const byTime = useMemo(() => {
    const m = new Map<number, Day>();
    for (const p of done) m.set(p.time, { ...p, today: false });
    if (todayAt && pair.now != null) m.set(todayAt.time, { ratio: pair.now, closeA: todayAt.closeA, closeB: todayAt.closeB, today: true });
    return m;
  }, [done, todayAt, pair.now]);
  const points = useMemo(() => [...byTime.entries()].sort((x, y) => x[0] - y[0]).map(([time, p]) => ({ time, value: p.ratio })), [byTime]);
  /* the baseline: the average of the sessions — the plain mean of the points where the range has none yet */
  const base = pair.mean ?? (points.length ? points.reduce((s, p) => s + p.value, 0) / points.length : 1);
  const outsideCount = done.filter(p => isOutside(p.ratio)).length;
  const nowPlace = pair.now != null ? pairPlace(pair.now, pair.mean, pair.sd) : null;
  const band = top != null && bottom != null ? `${fmtRatio(bottom)} – ${fmtRatio(top)}` : '—';

  /* THE CHART — the library's, once per host and theme */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const notesRef = useRef<PlotNotesPrimitive | null>(null);
  const marksRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  /** The day under the crosshair — the card's and the legend's; null at rest */
  const [hover, setHover] = useState<number | null>(null);
  const pointerAt = useRef({ x: 0, y: 0 });
  const [made, setMade] = useState(0);
  const drawn = points.length > 1;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = daySurface(host, paper);
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: s.bg }, textColor: s.text, fontFamily: "'Inter', sans-serif", fontSize: 10, attributionLogo: true },
      localization: { timeFormatter: (t: Time) => fmtDayLocal(t, 'ny') },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      /* whole figures only on the scale, three places: two names a cent apart read as the same figure at two */
      /* the axis as wide as its figures (2026-10-18) */
      rightPriceScale: { borderColor: s.line, minimumWidth: 0, entireTextOnly: true, scaleMargins: { top: 0.14, bottom: 0.1 } },
      timeScale: { borderColor: s.line, timeVisible: false, secondsVisible: false, rightOffset: 2, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true, tickMarkFormatter: nyTickMarks },
      crosshair: {
        vertLine: { color: s.crosshair, labelBackgroundColor: s.label },
        horzLine: { color: s.crosshair, labelBackgroundColor: s.label },
      },
      handleScroll: false,
      handleScale: false,
    });
    const inkA = resolveInk(aInk, host);
    const inkB = resolveInk(bInk, host);
    /* THE LINE IS A BASELINE AT THE AVERAGE: the first name's territory above it in its ink with its ground under it, the
       second's below in the second's — the book's own two-sided line, in the names' inks */
    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: base },
      topLineColor: inkA,
      topFillColor1: alpha(inkA, paper ? 0.2 : 0.3),
      topFillColor2: alpha(inkA, 0.02),
      bottomLineColor: inkB,
      bottomFillColor1: alpha(inkB, 0.02),
      bottomFillColor2: alpha(inkB, paper ? 0.22 : 0.32),
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
      priceLineVisible: true,
      priceLineStyle: LineStyle.Dotted,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    const notes = new PlotNotesPrimitive();
    series.attachPrimitive(notes);
    const marks = createSeriesMarkers(series, []);
    chart.subscribeCrosshairMove(p => setHover(p.time == null ? null : Number(p.time)));
    chartRef.current = chart;
    seriesRef.current = series;
    notesRef.current = notes;
    marksRef.current = marks;
    linesRef.current = [];
    setMade(n => n + 1);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      notesRef.current = null;
      marksRef.current = null;
      linesRef.current = [];
    };
    /* `drawn`: the host only mounts once there are points — the daily sessions land after the first paint, and a chart
       made only on the theme left the box blank under a full read line */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, aInk, bInk, drawn]);

  /* THE DATA: the points on the baseline, the usual range as a band named at the left, the average as the library's
     dashed line with its figure on the scale, the marks on the line */
  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const host = hostRef.current;
    if (!chart || !series || !host) return;
    series.applyOptions({ baseValue: { type: 'price', price: base } });
    series.setData(points.map(p => ({ time: p.time as UTCTimestamp, value: p.value })));
    const silver = resolveInk(SILVER, host);
    const warm = resolveInk(THERMAL_WARM, host);
    const ground = daySurface(host, paper).bg;
    notesRef.current?.update({
      bands: top != null && bottom != null ? [{ from: bottom, to: top, fill: alpha(silver, paper ? 0.08 : 0.06), edge: alpha(silver, 0.3) }] : [],
      notes:
        top != null && bottom != null && pair.mean != null
          ? [
              { price: top, text: 'usual high', color: alpha(silver, 0.9) },
              { price: pair.mean, text: 'average', color: alpha(silver, 0.9) },
              { price: bottom, text: 'usual low', color: alpha(silver, 0.9), below: true },
            ]
          : [],
      ground,
    });
    for (const l of linesRef.current) series.removePriceLine(l);
    linesRef.current = [];
    if (pair.mean != null) linesRef.current.push(series.createPriceLine({ price: pair.mean, color: alpha(silver, 0.6), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' }));
    const marks: SeriesMarker<Time>[] = [];
    for (const [time, p] of byTime) {
      if (p.today) marks.push({ time: time as UTCTimestamp, position: 'atPriceMiddle', price: p.ratio, shape: 'circle', color: silver, size: 0.8 });
      else if (isOutside(p.ratio)) marks.push({ time: time as UTCTimestamp, position: 'atPriceMiddle', price: p.ratio, shape: 'circle', color: warm, size: 0.6 });
    }
    marksRef.current?.setMarkers(marks);
    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, byTime, top, bottom, pair.mean, base, paper, made]);

  /* THE DAY IN HAND: the crosshair's, today at rest */
  const hovering = hover != null && byTime.has(hover);
  const shownTime = hovering ? hover : (todayAt?.time ?? null);
  /* THE LAST POINT NAMED BY ITS OWN DAY (the fifth audit, 2026-10-23: "Today" on Thursday's close at 01:00 Friday) */
  const lastDay = todayAt ? nyIsoDate(todayAt.time * 1000) : null;
  const lastWord = !lastDay || lastDay === nyIsoDate() ? 'Today' : longDay(lastDay);
  const shown = shownTime != null ? byTime.get(shownTime) : null;
  const shownPlace = shown ? pairPlace(shown.ratio, pair.mean, pair.sd) : null;
  const warmCss = THERMAL_WARM;
  const aheadWords = (place: ReturnType<typeof pairPlace>) => (!place ? null : place.ahead === 'a' ? `${a} further ahead of ${b} than on an average day` : place.ahead === 'b' ? `${b} further ahead of ${a} than on an average day` : 'right where the two usually sit');

  return (
    <section className="flex flex-col min-w-0" data-compare-pair data-place={nowPlace?.where}>
      {/* THE HEAD — the title, what the line is, and the guide's door; the figures are the read line's */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6">
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-3 min-w-0">
            <h3 className="shrink-0 text-[15px] font-semibold leading-tight text-textPrimary">The pair</h3>
            <span className="min-w-0 truncate text-[11px] text-textSecondary">which of the two has been stronger, and whether {lastWord === 'Today' ? "today's" : `${lastWord}'s`} gap is normal</span>
            {onGuide && <GuideDoor open={guideOpen} onClick={onGuide} title="What the line, the range and the marks mean" testId="pair-guide" />}
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            {a}'s price divided by {b}'s, one point a day · above the average <span style={{ color: aInk }}>{a}</span> is ahead of usual, below it <span style={{ color: bInk }}>{b}</span> is · the band is the usual range · a warm mark closed outside it · hover any day
          </p>
        </div>
      </div>

      {/* THE CHART — the library's, edge to edge in its box; the names' halves said at its right, the legend at its left */}
      <div
        className="relative border-t border-borderSubtle/60"
        style={{ height: PAIR_H }}
        data-pair-chart
        data-points={points.length}
        onMouseMove={e => {
          pointerAt.current = { x: e.clientX, y: e.clientY };
        }}
      >
        {points.length > 1 ? (
          <>
            <div ref={hostRef} className="absolute inset-0" data-pair-host />
            {/* the two halves, named where they lie — the first name's above the average, the second's below */}
            <span className="absolute top-2 z-10 pointer-events-none font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ right: 72, color: aInk }} data-pair-half="a">
              ▲ {a} ahead
            </span>
            <span className="absolute z-10 pointer-events-none font-mono text-[10px] font-semibold uppercase tracking-widest" style={{ right: 72, bottom: 34, color: bInk }} data-pair-half="b">
              ▼ {b} ahead
            </span>
            {shown && shownTime != null && (
              <div className="absolute top-2 left-3 z-10 pointer-events-none flex items-center gap-2 font-mono text-[11px] tnum whitespace-nowrap" data-pair-legend data-legend-time={shownTime}>
                <span className="font-semibold text-textPrimary">{shown.today ? lastWord : dayWords(shownTime)}</span>
                {/* "still moving" only while the session is — after the bell today's ratio is a close like any other day's */}
                {shown.today && readMarketState().word === 'live' && (
                  <span className="text-[9px] uppercase tracking-widest" style={{ color: SILVER }}>
                    still moving
                  </span>
                )}
                <span className="text-textSecondary">
                  <span style={{ color: aInk }}>{a}</span> <span className="text-textPrimary">{fmtClose(shown.closeA)}</span> ÷ <span style={{ color: bInk }}>{b}</span> <span className="text-textPrimary">{fmtClose(shown.closeB)}</span> ={' '}
                  <span className="font-bold text-textPrimary">{fmtRatio(shown.ratio)}</span>
                </span>
              </div>
            )}
            {/* THE CARD on the day under the crosshair — the marks included: the two closes in their inks, the ratio, where
                that day sat against the usual range and which name was further ahead than usual */}
            {hovering && shown && shownTime != null && (
              <PointerFollowCard start={pointerAt.current} width={248} testId="data-pair-card" testValue={`${shownTime}`} title={shown.today ? lastWord : dayWords(shownTime)} aside={shown.today && readMarketState().word === 'live' ? 'still moving' : isOutside(shown.ratio) ? 'closed outside the range' : 'closed inside the range'}>
                <CardRow k={a} v={fmtClose(shown.closeA)} ink={aInk} sub={shown.today ? 'last' : 'close'} />
                <CardRow k={b} v={fmtClose(shown.closeB)} ink={bInk} sub={shown.today ? 'last' : 'close'} />
                <CardRow k={`${a} ÷ ${b}`} v={fmtRatio(shown.ratio)} />
                {shownPlace && (
                  <span className="col-span-2 mt-0.5 leading-snug" style={{ color: shownPlace.where === 'inside' ? 'rgb(var(--text-secondary))' : warmCss }}>
                    {shownPlace.words}
                  </span>
                )}
                {shownPlace && <span className="col-span-2 text-textMuted leading-snug">{aheadWords(shownPlace)}</span>}
              </PointerFollowCard>
            )}
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-[11px] text-textMuted">not enough sessions on the tape yet</div>
        )}
      </div>

      {/* THE READ LINE — where today stands, at rest: the ratio, the usual range, where today sits, the days outside */}
      <div className="px-5 border-t border-ink/[0.06] flex items-center gap-3 whitespace-nowrap overflow-hidden text-[10.5px] text-textSecondary" style={{ height: PAIR_READ_H }} data-pair-read>
        {pair.now != null ? (
          <>
            <span className="font-mono text-[11px] font-bold tnum text-textPrimary">now</span>
            <span className="font-mono tnum text-textPrimary" data-pair-now>
              {a} ÷ {b} {fmtRatio(pair.now)}
            </span>
            {hasBand && (
              <span className="font-mono tnum text-textMuted" data-pair-band>
                usual {band} · {done.length} sessions
              </span>
            )}
            {nowPlace && (
              <span style={{ color: nowPlace.where === 'inside' ? undefined : warmCss }} data-pair-sits>
                {nowPlace.words}
              </span>
            )}
            {hasBand && (
              <span className="inline-flex items-center gap-1.5 text-textMuted">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: warmCss }} aria-hidden />
                {outsideCount} of {done.length} days closed outside
              </span>
            )}
            <span className="ml-auto inline-flex items-center gap-1.5 text-textMuted">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SILVER }} aria-hidden />
              {lastWord === 'Today' ? 'today' : lastWord}
            </span>
          </>
        ) : (
          <span className="text-textMuted">not enough sessions on the tape yet</span>
        )}
      </div>

      <p className="px-5 pb-4 pt-2 min-h-[44px] text-[12px] leading-relaxed text-textSecondary" data-pair-sentence>
        {pair.sentence}
      </p>
    </section>
  );
};

export default ComparePair;
