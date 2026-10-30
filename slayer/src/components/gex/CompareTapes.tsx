/* Compare's "Since the open": both names as one line of percent from its own open, same weight, own ink,
   with the gap under them as a stepped band in the leader's ink. The read line speaks the minute under the pointer. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BaselineSeries, createChart, LineSeries, LineStyle, LineType, type IChartApi, type ISeriesApi, type LineData, type Time, type UTCTimestamp } from 'lightweight-charts';
import { useResolvedSession } from '../../data/uwBook';
import type { DeskSession } from '../../data/deskSession';
import { currentSessionBars, minuteInSession, sessionMeta } from '../../data/deskSession';
import { thetaChartBars, thetaChartNote, wantChartTape } from '../../data/thetaCandles';
import { usePrintRev, useTapeRev } from '../../data/thetaTape';
import { DayRef } from '../../data/bookWindow';
import { nyIsoDate, nyMinutes } from '../../core/nyTime';
import { DARK_FIGURE_SURFACE } from './candleTheme';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { alpha, resolveInk } from './paletteInk';
import { fmtClockLocal, nyTickMarks } from './chartTime';
import { TAPES_H, TAPES_READ_H } from './compareSkeletons';

const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`;

interface Props {
  a: string;
  b: string;
  aInk: string;
  bInk: string;
  /** Bumped on every tick, so the lines fold in the newest minute */
  revision: number;
}

interface Point {
  time: number;
  a: number | null;
  b: number | null;
  /** The two prices at that minute, for the hover card */
  ca: number | null;
  cb: number | null;
}

/** A name's ThetaData bars in the latest occurrence of this session. The join is every session; the newest calendar day is not the cut — it drops yesterday's cash session and splits overnight. */
const sessionSeries = (t: string, session: DeskSession) => {
  const all = thetaChartBars(t, 1, session);
  const inWin = all.filter(b => minuteInSession(nyMinutes(b.time * 1000), session));
  return { drawn: currentSessionBars(inWin, session), joined: all.length };
};

/** Both names as percent from each name's own open, on the union of their minutes in this session */
function buildToday(a: string, b: string, session: DeskSession): { points: Point[]; lastA: number | null; lastB: number | null; gap: { min: number; max: number } | null; joined: number } {
  const aS = sessionSeries(a, session);
  const bS = sessionSeries(b, session);
  const ba = aS.drawn;
  const bb = bS.drawn;
  const pct = (bars: typeof ba) => {
    const m = new Map<number, { p: number; c: number }>();
    const open0 = bars[0]?.open;
    if (!open0) return m;
    for (const bar of bars) m.set(bar.time, { p: (bar.close / open0 - 1) * 100, c: bar.close });
    return m;
  };
  const pa = pct(ba);
  const pb = pct(bb);
  const times = [...new Set([...pa.keys(), ...pb.keys()])].sort((x, y) => x - y);
  const points: Point[] = times.map(t => ({ time: t, a: pa.get(t)?.p ?? null, b: pb.get(t)?.p ?? null, ca: pa.get(t)?.c ?? null, cb: pb.get(t)?.c ?? null }));
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.a == null || p.b == null) continue;
    const g = p.a - p.b;
    min = Math.min(min, g);
    max = Math.max(max, g);
  }
  const lastA = ba.length ? pa.get(ba[ba.length - 1].time)?.p ?? null : null;
  const lastB = bb.length ? pb.get(bb[bb.length - 1].time)?.p ?? null : null;
  return { points, lastA, lastB, gap: Number.isFinite(min) ? { min, max } : null, joined: aS.joined + bS.joined };
}

/** The hover card's footprint — placed beside the pointer, kept inside the plot */
const CARD_W = 196;
const CARD_H = 100;

const CompareTapes = ({ a, b, aInk, bInk, revision }: Props) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineARef = useRef<ISeriesApi<'Line'> | null>(null);
  const lineBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const gapRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  /* The hover card: both prices, both percents and the gap, beside the pointer, flipping sides near the right edge. */
  const [hover, setHover] = useState<{ point: Point; left: number; top: number } | null>(null);
  const aRead = useResolvedSession(a);
  const bRead = useResolvedSession(b);
  const session = aRead.session !== 'rth' && aRead.session === bRead.session ? aRead.session : 'rth';
  /* the lines are ThetaData's bars (data/thetaTape.ts); with the terminal down they hold, stamped */
  useEffect(() => {
    const offs = [...wantChartTape(a, '1m', session), ...wantChartTape(b, '1m', session)];
    return () => offs.forEach(off => off());
  }, [a, b, session]);
  const tapeRev = useTapeRev();
  const printRev = usePrintRev();
  const today = useMemo(() => buildToday(a, b, session), [a, b, revision, session, tapeRev, printRev]);
  const tapeNote = thetaChartNote(a, 1, session) ?? thetaChartNote(b, 1, session);
  /* The bars' own day ("Today" only when the session is today's). */
  const lastT = today.points[today.points.length - 1]?.time;
  const barDay = lastT != null ? nyIsoDate(lastT * 1000) : null;
  const dayW = barDay ? DayRef(barDay) : 'Today';
  const pointsRef = useRef(today.points);
  pointsRef.current = today.points;

  /* Mount once, and again on a theme flip: the tapes read their inks at creation. */
  const appTheme = useResolvedTheme();
  /* On paper the chart sits on the page's inset with the page's inks (it has no Theme menu); on the dark terminal
     it is the dark island whatever candle theme is picked. */
  const paper = appTheme === 'light';
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const surface = paper
      ? { bg: readToken('--inset', undefined, host), text: readToken('--text-secondary', undefined, host), line: readToken('--ink', 0.16, host), crosshair: readToken('--ink', 0.4, host), label: readToken('--text-primary', undefined, host) }
      : DARK_FIGURE_SURFACE; /* the page, never the candle pick (candleTheme.ts: a figure is not a tape) */
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { color: surface.bg === 'transparent' ? readToken('--panel', undefined, host) : surface.bg }, textColor: surface.text, fontFamily: "'Inter', sans-serif", fontSize: 10, attributionLogo: true },
      /* New York's clock, like every other Pinpoint chart — on a UTC machine the axis read 15:00 → 19:55 */
      localization: { timeFormatter: (t: Time) => fmtClockLocal(t, 'ny') },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      /* Room above the lines, so the leader's live chip does not cover the top axis figure. */
      rightPriceScale: { borderColor: surface.line, scaleMargins: { top: 0.16, bottom: 0.28 } },
      timeScale: { borderColor: surface.line, timeVisible: true, secondsVisible: false, rightOffset: 4, tickMarkFormatter: nyTickMarks },
      crosshair: {
        vertLine: { color: surface.crosshair, labelBackgroundColor: surface.label },
        horzLine: { color: surface.crosshair, labelBackgroundColor: surface.label },
      },
      handleScroll: false,
      handleScale: false,
    });
    const pctFormat = { type: 'custom' as const, formatter: (v: number) => signedPct(v), minMove: 0.01 };
    /* Inks resolved off the plot's box: a token string handed to the library painted black. */
    const lineA = chart.addSeries(LineSeries, { color: resolveInk(aInk, host), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: pctFormat, crosshairMarkerRadius: 3 });
    const lineB = chart.addSeries(LineSeries, { color: resolveInk(bInk, host), lineWidth: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: pctFormat, crosshairMarkerRadius: 3 });
    lineA.createPriceLine({ price: 0, color: paper ? readToken('--ink', 0.32, host) : 'rgba(255,255,255,0.22)', lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    /* The gap as a stepped baseline in the leader's ink; a bar a minute read as a barcode. */
    const gapInkA = resolveInk(aInk, host);
    const gapInkB = resolveInk(bInk, host);
    const gap = chart.addSeries(BaselineSeries, {
      priceScaleId: 'gap',
      baseValue: { type: 'price', price: 0 },
      topLineColor: gapInkA,
      topFillColor1: alpha(gapInkA, 0.34),
      topFillColor2: alpha(gapInkA, 0.04),
      bottomLineColor: gapInkB,
      bottomFillColor1: alpha(gapInkB, 0.04),
      bottomFillColor2: alpha(gapInkB, 0.34),
      lineWidth: 1,
      lineType: LineType.WithSteps,
      priceFormat: pctFormat,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale('gap').applyOptions({ scaleMargins: { top: 0.76, bottom: 0.02 }, visible: false });
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.point) {
        setHover(null);
        return;
      }
      const t = param.time as number;
      const p = pointsRef.current.find(q => q.time === t);
      if (!p) {
        setHover(null);
        return;
      }
      const W = host.clientWidth;
      const H = host.clientHeight;
      const left = param.point.x + 16 + CARD_W <= W - 8 ? param.point.x + 16 : Math.max(8, param.point.x - 16 - CARD_W);
      const top = Math.max(8, Math.min(H - CARD_H - 8, param.point.y - CARD_H / 2));
      setHover({ point: p, left, top });
    });
    chartRef.current = chart;
    lineARef.current = lineA;
    lineBRef.current = lineB;
    gapRef.current = gap;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appTheme]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The inks follow the names */
  useEffect(() => {
    const host = hostRef.current;
    const ia = resolveInk(aInk, host);
    const ib = resolveInk(bInk, host);
    lineARef.current?.applyOptions({ color: ia });
    lineBRef.current?.applyOptions({ color: ib });
    gapRef.current?.applyOptions({ topLineColor: ia, topFillColor1: alpha(ia, 0.34), topFillColor2: alpha(ia, 0.04), bottomLineColor: ib, bottomFillColor1: alpha(ib, 0.04), bottomFillColor2: alpha(ib, 0.34) });
  }, [aInk, bInk]);

  /* The data, every tick */
  useEffect(() => {
    const lineA = lineARef.current;
    const lineB = lineBRef.current;
    const gap = gapRef.current;
    const chart = chartRef.current;
    if (!lineA || !lineB || !gap || !chart) return;
    const da: LineData<Time>[] = [];
    const db: LineData<Time>[] = [];
    const dg: LineData<Time>[] = [];
    for (const p of today.points) {
      const t = p.time as UTCTimestamp;
      if (p.a != null) da.push({ time: t, value: p.a });
      if (p.b != null) db.push({ time: t, value: p.b });
      if (p.a != null && p.b != null) dg.push({ time: t, value: p.a - p.b });
    }
    lineA.setData(da);
    lineB.setData(db);
    gap.setData(dg);
    chart.timeScale().fitContent();
  }, [today, aInk, bInk]);

  /* The read line speaks NOW; the card speaks the minute under the pointer */
  const at = today.points.length ? { a: today.lastA, b: today.lastB } : null;
  const gapNow = at && at.a != null && at.b != null ? at.a - at.b : null;
  const leader = gapNow == null ? null : Math.abs(gapNow) < 0.005 ? 'level' : gapNow > 0 ? a : b;
  const hp = hover?.point ?? null;
  const hoverGap = hp && hp.a != null && hp.b != null ? hp.a - hp.b : null;

  return (
    <section className="flex flex-col min-w-0" data-compare-tapes-band data-since-a={today.lastA?.toFixed(2)} data-since-b={today.lastB?.toFixed(2)}>
      {/* THE HEAD */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3 flex-wrap">
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary">Since the open{dayW === 'Today' ? '' : ` · ${dayW}`}</h3>
          </div>
          {/* truncate: unclipped, the line ran under the facts beside it ("…in the leader's ink" over "SPY +0.47%") */}
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
            {dayW}, both as percent from their own open · <span style={{ color: aInk }}>{a}</span> and <span style={{ color: bInk }}>{b}</span>, the same line each · the band beneath is the gap, in the leader's ink
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-x-6">
          <div>
            <dt className="text-t10 text-textMuted">Since the open</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum whitespace-nowrap" data-tapes-since>
              <span style={{ color: aInk }}>
                {a} {today.lastA == null ? '—' : signedPct(today.lastA)}
              </span>
              <span className="text-textMuted"> · </span>
              <span style={{ color: bInk }}>
                {b} {today.lastB == null ? '—' : signedPct(today.lastB)}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted">{dayW === 'Today' ? 'Ahead now' : 'Ahead at the close'}</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap" data-tapes-ahead>
              {today.lastA == null || today.lastB == null ? '—' : Math.abs(today.lastA - today.lastB) < 0.005 ? 'level' : `${today.lastA > today.lastB ? a : b} by ${Math.abs(today.lastA - today.lastB).toFixed(2)}%`}
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted">{dayW === 'Today' ? 'The gap today' : `The gap · ${barDay!.slice(5).replace('-', '/')}`}</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap" data-tapes-gap>
              {today.gap ? `${signedPct(today.gap.min)} to ${signedPct(today.gap.max)}` : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {/* THE CHART, and the card over it */}
      <div className={`relative border-t border-borderSubtle/60 ${paper ? 'bg-inset' : 'bg-panel'}`} style={{ height: TAPES_H }} data-chart-ink={paper ? undefined : ''} data-theme={paper ? 'light' : 'dark'} data-chart-ground={paper ? undefined : 'dark'}>
        <div ref={hostRef} className="absolute inset-0" data-tapes-chart />
        {hp && hover && (
          <div
            className="absolute z-10 pointer-events-none rounded-md border border-borderSubtle px-2.5 py-2 flex flex-col gap-1 text-t105 text-textSecondary"
            style={{ left: hover.left, top: hover.top, width: CARD_W, background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }}
            /* The card is dark glass, so its words take the dark set whatever the ground under it. */
            data-theme="dark"
            data-chart-glass
            data-tapes-card
          >
            <span className="font-mono text-t11 font-bold tnum text-textPrimary">{fmtClockLocal(hp.time as UTCTimestamp)}</span>
            <span className="flex items-center gap-1.5 font-mono tnum">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: aInk }} aria-hidden />
              <span className="font-semibold text-textPrimary">{a}</span>
              <span className="text-textSecondary">{hp.ca == null ? '—' : hp.ca.toFixed(2)}</span>
              <span className="ml-auto" style={{ color: aInk }}>
                {hp.a == null ? '—' : signedPct(hp.a)}
              </span>
            </span>
            <span className="flex items-center gap-1.5 font-mono tnum">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: bInk }} aria-hidden />
              <span className="font-semibold text-textPrimary">{b}</span>
              <span className="text-textSecondary">{hp.cb == null ? '—' : hp.cb.toFixed(2)}</span>
              <span className="ml-auto" style={{ color: bInk }}>
                {hp.b == null ? '—' : signedPct(hp.b)}
              </span>
            </span>
            <span className="border-t border-borderSubtle/60 pt-1 whitespace-nowrap">
              {hoverGap == null ? (
                <span className="text-textMuted">one of them has no bar here</span>
              ) : Math.abs(hoverGap) < 0.005 ? (
                'level'
              ) : (
                <>
                  <span className="text-textPrimary" style={{ color: hoverGap > 0 ? aInk : bInk }}>
                    {hoverGap > 0 ? a : b}
                  </span>{' '}
                  ahead by <span className="font-mono tnum text-textPrimary">{Math.abs(hoverGap).toFixed(2)}%</span>
                </>
              )}
            </span>
          </div>
        )}
      </div>

      <div className="px-5 border-t border-ink/[0.06] flex items-center gap-3 whitespace-nowrap overflow-hidden text-t105 text-textSecondary" style={{ height: TAPES_READ_H }} data-tapes-read>
        {at ? (
          <>
            <span className="font-mono text-t11 font-bold tnum text-textPrimary">now</span>
            <span className="font-mono tnum" style={{ color: aInk }}>
              {a} {at.a == null ? '—' : signedPct(at.a)}
            </span>
            <span className="font-mono tnum" style={{ color: bInk }}>
              {b} {at.b == null ? '—' : signedPct(at.b)}
            </span>
            {leader && (
              <span>
                {leader === 'level' ? 'level' : (
                  <>
                    <span className="text-textPrimary">{leader}</span> ahead by <span className="font-mono tnum text-textPrimary">{Math.abs(gapNow ?? 0).toFixed(2)}%</span>
                  </>
                )}
              </span>
            )}
            {tapeNote ? <span className={`ml-auto ${/offline/i.test(tapeNote) ? 'text-warn' : 'text-textMuted'}`} data-tape-note>{tapeNote}</span> : <span className="ml-auto text-textMuted">hover the chart for any minute</span>}
          </>
        ) : (
          <span className="text-textMuted">{today.joined > 0 ? `${sessionMeta(session).label} has no prints` : tapeNote ?? 'no session on the tape yet'}</span>
        )}
      </div>
    </section>
  );
};

export default CompareTapes;
