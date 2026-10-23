/*
==================================================
  SLAYER TERMINAL - THE PROFILE (components/gex/ExposureProfileView.tsx)

  The book's third view (the competitive audit,
  2026-10-13): dealer gamma AS A FUNCTION OF SPOT —
  the curve every desk draws under the name "gamma
  profile" (data/exposureCurve.ts). One line per
  drawn expiry, quiet; the total, loud; the ground
  tinted where hedging amplifies (above zero) and
  where it absorbs (below); spot, the zero crossing,
  the walls and the supreme as rules across it, in
  the house's inks. Hover a spot for the figures;
  click to keep the nearest strike; the arrow keys
  walk the curve.

  DRAWN BY THE CHART LIBRARY, the day box's way (the
  owner, 2026-10-14: the hand-drawn monospace SVG
  stood between two library charts — "two chart
  languages on one page"): the library's options
  chart, price along the foot, the total as its
  baseline series at zero, the dates its quiet
  lines, its scale and crosshair (dayChart.ts for the
  surface). The rules, their tags and the dates'
  names are the one thing the library has no idea
  of — a vertical line at a price along the foot —
  and stand over the plot, placed off the chart's
  own coordinates after every draw.
==================================================
*/

import { shownGamma } from './retailSign';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BaselineSeries, createOptionsChart, LineSeries, LineStyle, type IChartApiBase, type ISeriesApi, type LineData } from 'lightweight-charts';
import { buildExposureCurve } from '../../data/exposureCurve';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { useRoomSpot } from '../../pages/pinpoint/useRoomSpot';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { daySurface } from './dayChart';
import { ABSORB, AMPLIFY, CALL_WALL, FLIP, PUT_WALL, SUPREME, alpha, resolveInk } from './paletteInk';
import type { ExposureSurface } from '../../data/exposureSurface';

const SILVER = 'rgb(var(--silver))';
const fmtStrike = (v: number) => (!Number.isFinite(v) ? '—' : v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
/** a tag's width, near enough, for keeping the rules' tags off each other */
const TAG_PX = 6.4;
const TAG_ROW = 14;

interface Props {
  surface: ExposureSurface;
  /** The expiry columns drawn, as surface indices — the band's window */
  expiries: number[];
  liveSpot?: number;
  selectedStrike?: number | null;
  onSelectStrike?: (strike: number) => void;
  paper?: boolean;
  /** False while the book is a replayed minute's — the spot rule reads that minute, not the room */
  live?: boolean;
}

interface Rule {
  key: string;
  x: number;
  ink: string;
  word: string;
  dash?: boolean;
}

type Chart = IChartApiBase<number>;

const ExposureProfileView = ({ surface, expiries, liveSpot, selectedStrike, onSelectStrike, paper: paperProp, live = true }: Props) => {
  const paper = useResolvedTheme() === 'light' || !!paperProp;
  const curve = useMemo(() => buildExposureCurve(surface, expiries), [surface, expiries]);
  const { points } = curve;
  /* the room's price (one price on the page, 2026-10-14) */
  const roomSpot = useRoomSpot(surface.ticker, live);
  const spot = roomSpot ?? liveSpot ?? surface.spot;
  const x0 = points[0]?.spot ?? spot;
  const x1 = points[points.length - 1]?.spot ?? spot;
  const cents = surface.strikes.some(k => k % 1 !== 0);

  /* ---- the chart ---- */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const totalRef = useRef<ISeriesApi<'Baseline', number> | null>(null);
  const datesRef = useRef<ISeriesApi<'Line', number>[]>([]);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const maxAbsRef = useRef(curve.maxAbs);
  maxAbsRef.current = curve.maxAbs;

  /* the hovered point — the pointer's, or the keys' — and where its dot is on the chart */
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  /* the drawn geometry the overlay is placed by: the pane's size and every point's x */
  const [geo, setGeo] = useState<{ w: number; h: number; xs: number[]; dateYs: (number | null)[] } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = daySurface(host, paper);
    const chart = createOptionsChart(host, {
      autoSize: true,
      layout: { background: { color: s.bg }, textColor: s.text, fontFamily: "'Inter', sans-serif", fontSize: 10, attributionLogo: true },
      localization: { precision: cents ? 2 : 0 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      /* room over the top tick for the rules' tags; whole figures only on the scale */
      /* the axis as wide as its figures (2026-10-18) */
      rightPriceScale: { borderColor: s.line, minimumWidth: 0, entireTextOnly: true, scaleMargins: { top: 0.2, bottom: 0.08 } },
      timeScale: { borderColor: s.line, rightOffset: 0, fixLeftEdge: true, fixRightEdge: true, lockVisibleTimeRangeOnResize: true },
      crosshair: {
        vertLine: { color: s.crosshair, labelBackgroundColor: s.label },
        horzLine: { color: s.crosshair, labelBackgroundColor: s.label },
      },
      handleScroll: false,
      handleScale: false,
    });
    const amp = resolveInk(AMPLIFY, host);
    const abs = resolveInk(ABSORB, host);
    /* THE TOTAL AS A BASELINE AT ZERO — the book chart's own two-sided line, in the READER'S sign (the ship pass,
       2026-10-22, retailSign.ts): glacier and its ground above zero (dealers long gamma, hedging absorbs), ember and its
       ground below (it amplifies) — the Board's net GEX convention */
    const total = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: abs,
      topFillColor1: alpha(abs, paper ? 0.2 : 0.26),
      topFillColor2: alpha(abs, 0.03),
      bottomLineColor: amp,
      bottomFillColor1: alpha(amp, 0.03),
      bottomFillColor2: alpha(amp, paper ? 0.2 : 0.26),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 3,
      priceFormat: { type: 'custom', formatter: (v: number) => fmtUsd(v), minMove: 1 },
      /* the scale symmetric about zero, the dates' reach included — the curve reads as a balance */
      autoscaleInfoProvider: () => ({ priceRange: { minValue: -maxAbsRef.current, maxValue: maxAbsRef.current } }),
    });
    total.createPriceLine({ price: 0, color: s.zero, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    const quiet = alpha(readToken('--text-muted', undefined, host), 0.55);
    const dates = curve.expiries.map(() => chart.addSeries(LineSeries, { color: quiet, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, autoscaleInfoProvider: () => null }));
    chart.subscribeCrosshairMove(param => {
      if (param.point === undefined || param.logical === undefined || param.logical == null) {
        setHover(null);
        return;
      }
      const i = Math.max(0, Math.min(pointsRef.current.length - 1, Math.round(param.logical as number)));
      const p = pointsRef.current[i];
      if (!p) {
        setHover(null);
        return;
      }
      const x = chart.timeScale().timeToCoordinate(p.spot) ?? param.point.x;
      const y = total.priceToCoordinate(shownGamma(p.total)) ?? param.point.y;
      setHover({ i, x, y });
    });
    chartRef.current = chart;
    totalRef.current = total;
    datesRef.current = dates;
    return () => {
      chart.remove();
      chartRef.current = null;
      totalRef.current = null;
      datesRef.current = [];
    };
    // the dates' count is a series each; a new count remounts the chart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paper, cents, curve.expiries.length]);

  /* the data: price along the foot, the figures on the scale */
  const totalData = useMemo<LineData<number>[]>(() => points.map(p => ({ time: p.spot, value: shownGamma(p.total) })), [points]);
  useEffect(() => {
    const chart = chartRef.current;
    const total = totalRef.current;
    if (!chart || !total) return;
    total.setData(totalData);
    datesRef.current.forEach((d, i) => d.setData(points.map(p => ({ time: p.spot, value: shownGamma(p.byExpiry[i] ?? 0) }))));
    chart.timeScale().fitContent();
  }, [totalData, points, paper, cents]);

  /* THE GEOMETRY, READ OFF THE DRAWN CHART after every render: the rules, their tags and the dates' names are placed by
     it — a vertical line at a price along the foot is the one thing the library has no idea of */
  useEffect(() => {
    const chart = chartRef.current;
    const total = totalRef.current;
    if (!chart || !total || !points.length) return;
    const id = requestAnimationFrame(() => {
      const size = chart.paneSize();
      const xs = points.map(p => chart.timeScale().timeToCoordinate(p.spot) ?? NaN);
      const end = points[points.length - 1];
      const dateYs = datesRef.current.map((d, i) => d.priceToCoordinate(shownGamma(end.byExpiry[i] ?? 0)));
      setGeo(g => (g && g.w === size.width && g.h === size.height && g.xs.length === xs.length && g.xs.every((x, i) => x === xs[i]) && g.dateYs.every((y, i) => y === dateYs[i]) ? g : { w: size.width, h: size.height, xs, dateYs }));
    });
    return () => cancelAnimationFrame(id);
  });
  /* a price's x, between the two drawn points it falls between */
  const xOf = (s: number): number | null => {
    if (!geo || points.length < 2) return null;
    if (s <= x0) return geo.xs[0];
    if (s >= x1) return geo.xs[geo.xs.length - 1];
    const step = (x1 - x0) / (points.length - 1);
    const f = (s - x0) / step;
    const i = Math.min(points.length - 2, Math.floor(f));
    const a = geo.xs[i];
    const b = geo.xs[i + 1];
    return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * (f - i) : null;
  };

  /* the rules across the plot: spot, the zero crossing, the walls, the supreme, the kept strike — those inside the band */
  const { levels } = surface;
  const rules: Rule[] = [];
  const inBand = (v: number) => Number.isFinite(v) && v >= x0 && v <= x1;
  if (inBand(levels.putWall)) rules.push({ key: 'pw', x: levels.putWall, ink: PUT_WALL, word: `PUT WALL ${fmtStrike(levels.putWall)}` });
  if (inBand(levels.callWall)) rules.push({ key: 'cw', x: levels.callWall, ink: CALL_WALL, word: `CALL WALL ${fmtStrike(levels.callWall)}` });
  if (inBand(levels.supreme)) rules.push({ key: 'sup', x: levels.supreme, ink: SUPREME, word: `SUPREME ${fmtStrike(levels.supreme)}` });
  if (curve.flip != null && inBand(curve.flip)) rules.push({ key: 'flip', x: curve.flip, ink: FLIP, word: `ZERO GAMMA ${curve.flip.toFixed(2)}`, dash: true }); /* not "FLIP": the band's flip is a strike, this is the curve's zero (the paying-user audit's M5) */
  if (inBand(spot)) rules.push({ key: 'spot', x: spot, ink: SILVER, word: `SPOT ${spot.toFixed(2)}` });
  if (selectedStrike != null && inBand(selectedStrike)) rules.push({ key: 'kept', x: selectedStrike, ink: SILVER, word: `KEPT ${fmtStrike(selectedStrike)}`, dash: true });
  rules.sort((a, b) => a.x - b.x);
  /* the tags on as many rows as they need (2026-10-13: five levels within a strike or two of spot ran out of the rows
     and printed over each other): each takes the first row whose last tag ends before this one begins */
  const placed = rules.map(r => ({ ...r, px: xOf(r.x) }));
  const rowEnds: number[] = [];
  const rowOf = placed.map(r => {
    if (r.px == null) return 0;
    const half = (r.word.length * TAG_PX) / 2;
    const left = r.px - half;
    let row = rowEnds.findIndex(end => end < left - 6);
    if (row < 0) {
      rowEnds.push(-Infinity);
      row = rowEnds.length - 1;
    }
    rowEnds[row] = r.px + half;
    return row;
  });

  /* the pointer's point — the keys walk it too */
  const nearestStrike = (s: number) => surface.strikes.reduce((b, k) => (Math.abs(k - s) < Math.abs(b - s) ? k : b), surface.strikes[0] ?? s);
  const walk = (i: number) => {
    const chart = chartRef.current;
    const total = totalRef.current;
    const p = points[i];
    if (!chart || !total || !p) return;
    chart.setCrosshairPosition(p.total, p.spot, total);
    setHover({ i, x: chart.timeScale().timeToCoordinate(p.spot) ?? 0, y: total.priceToCoordinate(shownGamma(p.total)) ?? 0 });
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !points.length) return;
    const cur = hover?.i ?? Math.max(0, points.findIndex(p => p.spot >= spot));
    if (e.key === 'ArrowLeft') walk(Math.max(0, cur - 1));
    else if (e.key === 'ArrowRight') walk(Math.min(points.length - 1, cur + 1));
    else if (e.key === 'Home') walk(0);
    else if (e.key === 'End') walk(points.length - 1);
    else if ((e.key === 'Enter' || e.key === ' ') && hover) onSelectStrike?.(nearestStrike(points[hover.i].spot));
    else if (e.key === 'Escape') {
      setHover(null);
      chartRef.current?.clearCrosshairPosition();
    } else return;
    e.preventDefault();
  };
  useEffect(() => setHover(h => (h && h.i < points.length ? h : null)), [points]);

  /* the two heaviest dates named at their right ends (the re-audit's L4) — the thin lines were nameless off the card */
  const dateTags = (() => {
    const out: { e: number; y: number; word: string }[] = [];
    if (!geo || !points.length || curve.expiries.length < 2) return out;
    const weight = curve.expiries.map((_, i) => Math.max(...points.map(p => Math.abs(p.byExpiry[i]))));
    const top = curve.expiries.map((e, i) => ({ e, i, w: weight[i] })).sort((a, b) => b.w - a.w).slice(0, 2);
    for (const t of top) {
      const y = geo.dateYs[t.i];
      if (y != null) out.push({ e: t.e, y, word: surface.expiries[t.e]?.date ?? '' });
    }
    out.sort((a, b) => a.y - b.y);
    if (out.length === 2 && out[1].y - out[0].y < 13) out[1].y = out[0].y + 13;
    return out;
  })();

  const hp = hover ? points[hover.i] : null;
  const W = geo?.w ?? 0;
  const H = geo?.h ?? 0;
  const tagRows = rowEnds.length;
  /* THE CARD BESIDE ITS POINT, the day box's way (besideDot.ts) — but this card is a date a line tall, so it stands over
     the point only where the plot's head holds it, under it otherwise (2026-10-14: near the curve's crown it ran off
     the top) */
  const cardH = 78 + 16 * curve.expiries.length;
  const cardStyle = hover
    ? {
        left: hover.x > W / 2 ? hover.x - 12 : hover.x + 12,
        top: hover.y,
        transform: `translate(${hover.x > W / 2 ? '-100%' : '0'}, ${hover.y >= cardH + 12 || hover.y > H - cardH - 12 ? `calc(-100% - 12px)` : '12px'})`,
      }
    : undefined;

  return (
    <div className="relative flex h-full min-h-0 flex-col select-none" data-exposure-profile={surface.ticker} data-profile-flip={curve.flip != null ? curve.flip.toFixed(2) : undefined}>
      <div
        className="relative flex-1 min-h-0 outline-none"
        tabIndex={0}
        role="group"
        aria-label={`Dealer gamma across spot for ${surface.ticker}: ${fmtUsd(shownGamma(curve.atSpot))} at ${spot.toFixed(2)}${curve.flip != null ? `, zero gamma at ${curve.flip.toFixed(2)}` : ''} — the arrow keys walk the curve, Enter keeps the nearest strike`}
        onKeyDown={onKeys}
        onClick={() => {
          if (hover) onSelectStrike?.(nearestStrike(points[hover.i].spot));
        }}
        data-profile-plot
      >
        <div ref={hostRef} className="absolute inset-0" data-profile-chart />
        {/* THE RULES AND THEIR TAGS, over the plot, placed by the chart's own coordinates — over the library's canvases
            (they stand at z 1 and 2), under the glass */}
        {geo && W > 0 && (
          <div className="pointer-events-none absolute left-0 top-0 z-[5] overflow-hidden" style={{ width: W, height: H }} aria-hidden data-profile-rules>
            {placed.map((r, i) =>
              r.px == null ? null : (
                <div key={r.key} data-profile-rule={r.key}>
                  <div className="absolute" style={{ left: r.px, top: tagRows * TAG_ROW + 2, bottom: 0, borderLeft: `1px ${r.dash ? 'dashed' : 'solid'} ${r.ink}`, opacity: r.key === 'spot' ? 0.9 : 0.6 }} />
                  <div className="absolute -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-bold leading-none" style={{ left: r.px, top: rowOf[i] * TAG_ROW + 2, color: r.ink }}>
                    {r.word}
                  </div>
                </div>
              )
            )}
            {/* the sides, named where the scale's figures are (the plot's own words) */}
            <div className="absolute left-2 font-mono text-[11px]" style={{ top: tagRows * TAG_ROW + 6, color: ABSORB }}>
              absorbs
            </div>
            {/* over the library's attribution mark in the corner, not on it */}
            <div className="absolute left-2 bottom-8 font-mono text-[11px]" style={{ color: AMPLIFY }}>
              amplifies
            </div>
            {dateTags.map(t => (
              <div key={t.e} className="absolute right-1 -translate-y-1/2 font-mono text-[11px] text-textMuted" style={{ top: t.y }} data-profile-date={t.word}>
                {t.word}
              </div>
            ))}
          </div>
        )}
        {/* the figures under the pointer — the day box's glass, beside the point it reads */}
        {hp && hover && (
          <div
            className="pointer-events-none absolute z-10 w-[220px] rounded-md border border-borderSubtle px-2.5 py-2 font-mono text-[11px] text-textSecondary"
            style={{ ...cardStyle, background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }}
            data-theme="dark"
            data-chart-glass
            data-profile-card={hp.spot.toFixed(2)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold tnum text-textPrimary">at {hp.spot.toFixed(2)}</span>
              <span className="tnum text-textMuted">
                {hp.spot >= spot ? '+' : '−'}
                {Math.abs(((hp.spot - spot) / spot) * 100).toFixed(2)}%
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="text-textSecondary">Total</span>
              <span className="font-semibold tnum" style={{ color: hp.total >= 0 ? AMPLIFY : ABSORB }}>
                {fmtUsd(shownGamma(hp.total))} · {hp.total >= 0 ? 'amplifies' : 'absorbs'}
              </span>
            </div>
            {curve.expiries.map((e, i) => (
              <div key={e} className="flex items-baseline justify-between gap-2">
                <span className="text-textMuted">{surface.expiries[e]?.date}</span>
                <span className="tnum text-textSecondary">{fmtUsd(shownGamma(hp.byExpiry[i]))}</span>
              </div>
            ))}
            <div className="mt-1 text-textMuted">click to keep {fmtStrike(nearestStrike(hp.spot))}</div>
          </div>
        )}
        {points.length < 2 && <div className="absolute inset-0 grid place-items-center font-mono text-[11px] uppercase tracking-widest text-textMuted">No curve for this book yet</div>}
      </div>
      {/* what this is, in one line — short enough to stand whole (the paying-user audit's M5) */}
      <p className="shrink-0 truncate px-3 py-1 text-[11px] text-textMuted border-t border-borderSubtle/60">
        {W >= 760 ? 'Dealer gamma re-priced across spot · above zero hedging amplifies a move, below it absorbs · zero gamma is where it crosses — the flip in the head is read off the strikes, so the two differ' : W >= 420 ? 'Gamma across spot · above zero amplifies, below absorbs' : 'Gamma across spot'}
      </p>
    </div>
  );
};

export default ExposureProfileView;
