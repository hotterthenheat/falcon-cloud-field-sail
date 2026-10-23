/*
==================================================
  SLAYER TERMINAL - THE BOOK THROUGH THE DAY
  (components/gex/BookThroughDay.tsx)

  Exposure OVER TIME (the competitive audit, 2026-10-
  13: the one chart the Map had none of — the book is
  a moving thing, and the day's record of it is what
  a trader reads a regime change off): the whole
  book's net gamma through the session (data/
  bookMarket.ts getGexHistory, a book a minute) as a
  baseline at zero — the line and its ground red where
  hedging amplified (above zero), green where it
  absorbed (below); spot beside it, quiet, on its own
  scale. Hover for the minute; the replay cuts it at
  its minute. On the feed the per-minute net is the
  vendor's minute gamma, drawn in the book's unit so the last print
  is the net the matrix adds up to — not an open-interest ramp.

  ONE FACE (the owner, 2026-10-14: "remove the strike
  x time, you have to understand this is mostly for
  retail users they dont know how to utilize that"):
  the strike-by-minute heat surface beside it is gone;
  the net line says the one thing a trader reads off
  this box — whether hedging is pushing moves along or
  holding them back, and when that changed.

  DRAWN BY THE CHART LIBRARY, Compare's way (the
  owner, 2026-10-14 — dayChart.ts): the net is the
  library's baseline series, the clock and the scale
  are its own, minute for minute under the tape above.
==================================================
*/

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BaselineSeries, createChart, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type LineData, type Time, type UTCTimestamp } from 'lightweight-charts';
import { sessionBars } from '../../data/levelview';
import { bookMinuteKind, deskBars, peekSettledNet, useBookMinutes, useBookRev } from '../../data/uwBook';
import { roomLevels } from '../../data/roomLevels';
import { nyIsoDate } from '../../core/nyTime';
import { expirySpan, longDay } from '../../data/bookWindow';
import { levelNetPath } from '../../data/flipLevel';
import { nySessionPhase } from '../../core/nyTime';

const inSessionNow = (): boolean => nySessionPhase() === 'open';
import { sessionOfMinute, useDeskSession } from '../../data/deskSession';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { hhmm } from '../../data/ahead';
import { axisForSession } from '../../data/dayAxis';
import { besideDot } from './besideDot';
import { nyMinutes } from '../../core/nyTime';
/* THE NET IN THE BOARD'S INKS (the ship pass, 2026-10-22 — it was the thermal pair, warm above zero, on the house's
   inverted sign): retail sign, green above zero where hedging absorbs, red below where it amplifies — the net line, its
   ground, the head's figure and the pointer's card */
import { LONG_GAMMA, SHORT_GAMMA, alpha, resolveInk } from './paletteInk';
import { readSessionClock } from '../../data/moc';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { setDayHover, clearDayHover, useDayHover } from '../../data/dayHover';
import { CLOCK_SCALE, dayChartOptions, dayClock, daySurface, feedSeries, syncDayScale } from './dayChart';
import { PlayheadPrimitive } from './playheadPrimitive';
import type { Candle, MarketSnapshot } from '../../types/market';

/** A FACT ON A PART'S ONE LINE (Noah, 2026-10-14: "very little chart and huge words taking up 1/3 of the space"): the name
    in tracked capitals, the figure beside it — the page head's grammar, one row, so the chart has the height */
const PartFact = ({ label, children, title }: { label: string; children: ReactNode; title?: string }) => (
  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono" title={title}>
    <span className="text-[11px] uppercase tracking-wider text-textMuted">{label}</span>
    <span className="text-[12px] font-semibold tnum text-textPrimary">{children}</span>
  </span>
);

interface Props {
  snapshot: MarketSnapshot;
  /** The day so far, handed in — the replay reads the bars up to its position; the history is cut to the last one */
  bars?: readonly Candle[];
  scope?: ReactNode;
  /** A part of the day box (DayBox.tsx): no head of its own, the facts in a row, the clock shared with the tape above */
  part?: boolean;
  /** Minutes from midnight ET the replay stands at — given, the axis is the whole session, as the tape's */
  at?: number | null;
  /** The expiries the net is sized to — the book's window. The minute path is the whole book; the last print is this window. */
  dates?: readonly string[] | null;
  /** The contracts the net is read off, in words ("Today · Oct 22", "All expiries") — the Levels card's */
  bookLabel?: string | null;
}

interface Minute {
  time: number;
  min: number;
  net: number;
  spot: number | null;
}

/** THE HEDGING AXIS'S FIGURE (Noah, 2026-10-18: the Day's axes as thin as Terrain's): the scale's own short form —
    "800M", "-478M", "4.8M", "-1.2B" — no dollar sign and no idle decimal. Measured in the library: at the Day's 10px
    font a price axis ("518.00") is 52px wide, "$800M"/"-$478M" make it 60, and "800M"/"-478M" bring it back to 52 —
    and the tape over it shares this axis's width. The dollars are said by the facts beside the chart ("NET NOW
    -$417.9M"), the scale only counts. */
const axisUsd = (v: number): string => {
  const a = Math.abs(v);
  const sign = v < 0 && a >= 0.5 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e7) return `${sign}${Math.round(a / 1e6)}M`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)}K`;
  return `${sign}${a.toFixed(0)}`;
};

/** A straight line (the open-interest reconstruction) is not a hedging path. */
const isRamp = (values: number[]): boolean => {
  const n = values.length;
  if (n < 8) return false;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += i;
    my += values[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    const dy = values[i] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (syy < 1e-9) return true;
  return (sxy * sxy) / (sxx * syy) > 0.97;
};

const BookThroughDay = ({ snapshot, bars: barsProp, scope, part = false, at, dates, bookLabel }: Props) => {
  const paper = useResolvedTheme() === 'light';
  const ticker = snapshot.ticker;
  const desk = useDeskSession();
  const shown = barsProp?.length ? sessionOfMinute(nyMinutes(barsProp[0].time * 1000)) : desk;
  const bars = useMemo(() => {
    if (barsProp?.length) return barsProp;
    if (shown !== 'rth') return deskBars(ticker, shown) ?? [];
    return sessionBars(ticker) ?? [];
  }, [ticker, barsProp, shown]);
  const vendor = useBookMinutes(ticker);

  /* THE MINUTES: volume gamma through the session, in the book's unit.
     The open-interest series and the reconstructed ramp are straight
     (or one-sided) lines — they are not the path, and they are not drawn.
     A replay still cuts the series at its minute. */
  const bookNet = useMemo(() => {
    let n = 0;
    for (const s of snapshot.chain) n += s.netGex;
    return n;
  }, [snapshot]);
  /* nothing provisional (the fourth audit's M1: "NET GEX −$17.7B" — the whole book, the settled day in it — for seconds) */
  const netPending = !!snapshot.liveBook && roomLevels(snapshot, '0DTE')?.complete === false;
  const minutes = useMemo<Minute[]>(() => {
    const priceAt = new Map(bars.map(b => [Math.floor(b.time / 60) * 60, b.close] as const));
    const endMin = at == null ? Infinity : at;
    let lo = -Infinity;
    let hi = Infinity;
    if (bars.length) {
      lo = Infinity;
      hi = -Infinity;
      for (const b of bars) {
        const m = nyMinutes(b.time * 1000);
        if (m < lo) lo = m;
        if (m > hi) hi = m;
      }
    }
    /* THE LEVELS' SCOPE, RE-PRICED AT EACH MINUTE'S PRICE (the fifth audit, 2026-10-23: the vendor's whole-book minute
       series — the settled day in it — drew −13B…−18B under a Today headline of −$3.1B, and NVDA's line read green
       0…700M under "−$73.9M amplifies"). The line is the headline's own contracts (data/flipLevel.ts levelNetPath),
       the open interest as it stands priced at each minute's price — the vendor's method, on the scope — so it ends at
       the headline's figure, in its sign and its inks. Outside the session it ends at the close the levels are priced at. */
    if (snapshot.liveBook) {
      if (netPending) return [];
      const cut = bars.filter(b => nyMinutes(b.time * 1000) <= endMin);
      const pts = cut.map(b => ({ time: Math.floor(b.time / 60) * 60, min: nyMinutes(b.time * 1000), price: b.close }));
      const lastBar = cut[cut.length - 1];
      if (at == null && lastBar && !inSessionNow() && Math.abs(lastBar.close - snapshot.spot) > 1e-9 && nyMinutes(lastBar.time * 1000) < 16 * 60) {
        const t = Math.floor(lastBar.time / 60) * 60 + 60;
        pts.push({ time: t, min: nyMinutes(t * 1000), price: snapshot.spot });
      }
      if (pts.length < 2) return [];
      /* each minute at its own time to expiry (the tenth audit's retail finding) */
      const read = levelNetPath(snapshot, snapshot.chain, pts.map(p => p.price), pts.map(p => p.time * 1000 + 60_000));
      if (!read) return [];
      /* a figure the chart cannot draw is not drawn (the library throws past ±9×10^13 and the page stops) */
      return pts.map((p, i) => ({ time: p.time, min: p.min, net: read.path[i], spot: p.price })).filter(m => Number.isFinite(m.net) && Math.abs(m.net) < 1e13);
    }
    const pool = vendor ?? [];
    let kept = pool.filter(m => m.min >= lo && m.min <= hi && m.min <= endMin);
    if (kept.length < 2) kept = pool.filter(m => m.min <= endMin);
    if (kept.length >= 2 && !isRamp(kept.map(m => m.net))) {
      /* THE VENDOR'S OWN SERIES, AS PRINTED (the Pinpoint audit, 2026-10-22): it was scaled by book net ÷ last minute so
         its last print met the open-interest net — when the two differed in sign the scale went negative and the whole
         day drew inverted (TSLA: the vendor read +$480M, long, then −$586M; the morning drew red). The line is the
         vendor's volume-based dealer gamma per 1% (spot-exposures), in the retail sign — positive = dealers long gamma =
         absorbs — and is labelled as that; the open-interest book's net is its own figure beside it. */
      return kept.map(m => ({ time: m.time, min: m.min, net: -m.net, spot: m.spot ?? priceAt.get(m.time) ?? null }));
    }
    return [];
  }, [bars, vendor, at, bookNet, snapshot, netPending]);

  /* the tape's clock, off the same bars (data/dayAxis.ts): live, the session so far */
  const phase = readSessionClock().phase;
  const live = at == null && (phase === 'OPEN' || phase === 'AUCTION');
  const span = axisForSession(bars, shown, live);
  const FROM = span.from;
  const TO = span.to;
  const dayStart = span.dayStart;

  /* ---- the chart ---- */
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const netRef = useRef<ISeriesApi<'Baseline'> | null>(null);
  const spotRef = useRef<ISeriesApi<'Line'> | null>(null);
  const clockRef = useRef<ISeriesApi<'Line'> | null>(null);
  const playheadRef = useRef<PlayheadPrimitive | null>(null);
  const fedNet = useRef<readonly LineData<Time>[] | null>(null);
  const fedSpot = useRef<readonly LineData<Time>[] | null>(null);
  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;
  const indexOf = useMemo(() => new Map(minutes.map((m, i) => [m.time, i] as const)), [minutes]);
  const indexRef = useRef(indexOf);
  indexRef.current = indexOf;

  /* the hovered minute, and where its point is on the chart */
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const hoverRef = useRef(hover);
  hoverRef.current = hover;
  /* the pointer past the last book: the same minute the tape calls an estimate, here just "not yet" */
  const [ahead, setAhead] = useState<{ min: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const s = daySurface(host, paper);
    const chart = createChart(host, dayChartOptions(s, { clock: true, logo: true }));
    const amp = resolveInk(SHORT_GAMMA, host);
    const abs = resolveInk(LONG_GAMMA, host);
    /* THE NET AS A BASELINE AT ZERO — the library's own two-sided line, Compare's gap band, in the retail sign (the ship
       pass, 2026-10-22): green and its ground above zero (dealers long gamma, hedging absorbs), red below (short gamma,
       it amplifies) — the Board's net GEX inks */
    const net = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: 0 },
      topLineColor: abs,
      topFillColor1: alpha(abs, paper ? 0.22 : 0.3),
      topFillColor2: alpha(abs, 0.03),
      bottomLineColor: amp,
      bottomFillColor1: alpha(amp, 0.03),
      bottomFillColor2: alpha(amp, paper ? 0.22 : 0.3),
      lineWidth: 2,
      priceLineVisible: false,
      /* NO LAST-VALUE TAG (the fourth audit's m6: the axis read −17.6B — the session's whole book, the contracts that
         settled at 4:00 included — beside "NET GEX −$3.1B"): the line is the session's path; the figure that names the book
         is the headline's, and the line's own last print is under Details with the settled contracts taken off */
      lastValueVisible: false,
      crosshairMarkerRadius: 3,
      /* the axis's figures without the idle decimal ("$800M", not "$800.0M"): the axis is as wide as its widest
         figure and the tape over it shares that width (2026-10-18) — a shorter figure brings both to the edge */
      priceFormat: { type: 'custom', formatter: axisUsd, minMove: 1 },
    });
    net.createPriceLine({ price: 0, color: s.zero, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
    /* spot beside it, quiet, on a scale of its own that prints nothing */
    const spot = chart.addSeries(LineSeries, { priceScaleId: 'spot', color: alpha(readToken('--text-muted', undefined, host), 0.6), lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    /* room over the top tick: at 0.1 the scale's top figure was cut by the pane's edge */
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.14, bottom: 0.08 } });
    chart.priceScale('spot').applyOptions({ scaleMargins: { top: 0.14, bottom: 0.08 }, visible: false });
    /* the clock (dayChart.ts dayClock): every minute of the session, hidden, on a scale of its own */
    const clockS = chart.addSeries(LineSeries, { visible: false, priceScaleId: CLOCK_SCALE, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const playhead = new PlayheadPrimitive();
    playhead.setColor(readToken('--silver', undefined, host));
    net.attachPrimitive(playhead);
    chart.subscribeCrosshairMove(param => {
      /* the tape's minute is set on this chart from code — no pointer behind it, nothing to answer */
      if (!param.sourceEvent) {
        if (param.point === undefined && hoverRef.current) setHover(null);
        return;
      }
      if (param.point === undefined || param.time === undefined) {
        setHover(null);
        setAhead(null);
        return;
      }
      const i = indexRef.current.get(param.time as number);
      const mi = i != null ? minutesRef.current[i] : null;
      if (i == null || !mi) {
        const last = minutesRef.current[minutesRef.current.length - 1];
        const min = nyMinutes((param.time as number) * 1000);
        if (last && min > last.min) {
          const x = chart.timeScale().timeToCoordinate(param.time) ?? param.point.x;
          setAhead({ min, x, y: param.point.y });
        } else setAhead(null);
        setHover(null);
        return;
      }
      const x = chart.timeScale().timeToCoordinate(param.time) ?? param.point.x;
      const y = net.priceToCoordinate(mi.net) ?? param.point.y;
      setAhead(null);
      setHover({ i, x, y });
    });
    chartRef.current = chart;
    /* the axis as wide as its figures, shared with the tape over it (2026-10-18) */
    const unsync = syncDayScale(chart, ticker, 'hedge');
    netRef.current = net;
    spotRef.current = spot;
    clockRef.current = clockS;
    playheadRef.current = playhead;
    fedNet.current = null;
    fedSpot.current = null;
    return () => {
      unsync();
      chart.remove();
      chartRef.current = null;
      netRef.current = null;
      playheadRef.current = null;
    };
  }, [paper]);

  /* the clock, when the day's span moves */
  useEffect(() => {
    const chart = chartRef.current;
    const c = clockRef.current;
    if (!chart || !c || !bars.length) return;
    c.setData(dayClock(dayStart, FROM, TO));
    chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStart, FROM, TO, paper, bars.length > 0]);

  /* the net and spot — the newest minute only, unless the day itself changed */
  const netPoints = useMemo<LineData<Time>[]>(() => minutes.map(m => ({ time: m.time as UTCTimestamp, value: m.net })), [minutes]);
  const spotPoints = useMemo<LineData<Time>[]>(() => {
    if (!minutes.length) return [];
    return minutes.filter(m => m.spot != null).map(m => ({ time: m.time as UTCTimestamp, value: m.spot! }));
  }, [minutes]);
  /* A new expiry rescales every minute, and so does a new last print (the
     path is sized so its end is the window's net). The fast path only writes
     the last point when the times match, which left the old line on screen. */
  {
    const prev = fedNet.current;
    if (prev && prev.length === netPoints.length && prev.length > 1) {
      for (let i = 0; i < prev.length - 1; i++) {
        if (prev[i].value !== netPoints[i].value) {
          fedNet.current = null;
          break;
        }
      }
    }
  }
  useEffect(() => {
    const book = netPoints.length > 0;
    const host = hostRef.current;
    if (netRef.current) feedSeries(netRef.current, netPoints, fedNet);
    if (spotRef.current) {
      spotRef.current.applyOptions({
        lineStyle: LineStyle.Dotted,
        lineWidth: 1,
        color: alpha(readToken('--text-muted', undefined, host ?? undefined), 0.6),
        lastValueVisible: false,
        priceLineVisible: false,
      });
      feedSeries(spotRef.current, book ? spotPoints : [], fedSpot);
    }
    const chart = chartRef.current;
    if (chart) {
      chart.priceScale('right').applyOptions({ visible: book });
      chart.priceScale('spot').applyOptions({ visible: false });
    }
  }, [netPoints, spotPoints, paper]);

  /* THE MINUTE, SHARED (idea 1): the pointer's minute told to the tape above; the tape's set here as this chart's own
     crosshair */
  const hm = hover ? minutes[hover.i] : null;
  const shared = useDayHover();
  const shareMin = hm ? hm.min : ahead?.min ?? null;
  useEffect(() => {
    if (!part) return;
    if (shareMin != null) setDayHover({ min: shareMin, from: 'through', ticker });
    else clearDayHover(ticker, 'through');
  }, [part, shareMin, ticker]);
  useEffect(() => () => clearDayHover(ticker, 'through'), [ticker]);
  useEffect(() => {
    const chart = chartRef.current;
    const net = netRef.current;
    if (!chart || !net || hover || ahead) return;
    if (part && shared?.from === 'tape' && shared.ticker === ticker && minutes.length && dayStart) {
      const t = (dayStart + shared.min * 60) as UTCTimestamp;
      const i = indexOf.get(t);
      if (i != null) {
        chart.setCrosshairPosition(minutes[i].net, t, net);
        return;
      }
      const last = minutes[minutes.length - 1];
      if (clockRef.current && last && shared.min > last.min) {
        chart.setCrosshairPosition(last.net, t, clockRef.current);
        return;
      }
    }
    chart.clearCrosshairPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, hover == null, ahead == null, part, ticker]);
  useEffect(() => setHover(h => (h && h.i < minutes.length ? h : null)), [minutes]);

  const playTime = minutes.length ? (minutes[minutes.length - 1].time as UTCTimestamp) : null;
  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    const head = playheadRef.current;
    if (!chart || !head) return;
    const place = () => head.setTime(playTime);
    place();
    chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    const ro = host ? new ResizeObserver(place) : null;
    if (host && ro) ro.observe(host);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(place);
      ro?.disconnect();
    };
  }, [playTime]);

  const flips = useMemo(() => {
    let n = 0;
    for (let i = 1; i < minutes.length; i++) if (Math.sign(minutes[i].net) !== Math.sign(minutes[i - 1].net) && minutes[i].net !== 0 && minutes[i - 1].net !== 0) n++;
    return n;
  }, [minutes]);
  const last = minutes[minutes.length - 1];
  /* THE KEYS WALK IT TOO (the re-audit's M6) — the tape's walk: left and right along the minutes */
  const walk = (i: number) => {
    const chart = chartRef.current;
    const net = netRef.current;
    const mi = minutes[i];
    if (!chart || !net || !mi) return;
    chart.setCrosshairPosition(mi.net, mi.time as UTCTimestamp, net);
    setHover({ i, x: chart.timeScale().timeToCoordinate(mi.time as UTCTimestamp) ?? 0, y: net.priceToCoordinate(mi.net) ?? 0 });
  };
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || !minutes.length) return;
    const i = hover?.i ?? minutes.length - 1;
    if (e.key === 'ArrowLeft') walk(Math.max(0, i - 1));
    else if (e.key === 'ArrowRight') walk(Math.min(minutes.length - 1, i + 1));
    else if (e.key === 'Home') walk(0);
    else if (e.key === 'End') walk(minutes.length - 1);
    else if (e.key === 'Escape') {
      setHover(null);
      chartRef.current?.clearCrosshairPosition();
    } else return;
    e.preventDefault();
  };
  const plotW = hostRef.current?.clientWidth ?? 0;
  useBookRev();
  /* WHICH SERIES THE LINE IS, SAID WHERE IT IS SHOWN (the second re-audit, 2026-10-22) */
  const kind = vendor ? bookMinuteKind(ticker) : null;
  /* THE LINE'S LAST PRINT IS THE VENDOR'S LAST PRINT, LESS WHAT HAS SETTLED (the third audit, 2026-10-23): the drawn line
     stops with the session's bars (15:55), but the vendor prints on after the bell — TSLA's line read +$396.0M against
     the vendor's last +$291.0M (= the net), NVDA +$47.1M against +$29.3M — and after the close the vendor's whole-book
     total still counts the contracts that settled at 4:00 (SPY −$17.6B against the −$14.7B net: Oct 22's −$3.03B). The
     figure is the last print the vendor sent (the replay's own minute in a replay), with the settled contracts' live
     gamma taken off — so it IS the All-expiries net. */
  const pool = vendor ?? [];
  const lastPrint = at == null ? pool[pool.length - 1] ?? null : last ?? null;
  const settled = at == null && kind === 'oi' ? peekSettledNet(ticker) : 0;
  const lineNow = snapshot.liveBook ? last?.net ?? null : lastPrint ? (at == null ? -lastPrint.net : lastPrint.net) - (settled ?? 0) : null;
  const lineDay = lastPrint ? nyIsoDate(lastPrint.time * 1000) : null;
  const lineDayWords = lineDay && lineDay !== nyIsoDate() ? ` · ${expirySpan([lineDay])} session` : '';
  const barDay = bars.length ? nyIsoDate(bars[bars.length - 1].time * 1000) : null;
  const scoped = !!snapshot.liveBook;
  const kindWord = scoped
    ? `Net GEX through ${barDay && barDay !== nyIsoDate() ? longDay(barDay) : 'the day'} · ${bookLabel ?? 'these contracts'} at each minute's price`
    : kind === 'oi' ? `Dealer gamma through the day · all expiries, the session's own included${lineDayWords}` : `Dealer hedging · the session's trades${lineDayWords}`;
  const kindTitle = scoped
    ? `The net GEX of the contracts the Levels card reads (${bookLabel ?? 'its scope'}) — their open interest as it stands now, re-priced at each minute's price${barDay && barDay !== nyIsoDate() ? ` through ${longDay(barDay)}'s session` : ''}. The vendor's own minute series does the same for the whole book; this is the same measure on the headline's contracts, so the line ends at the Net GEX beside it, in its sign: green above zero (dealers long gamma, their hedging absorbs), red below (it amplifies)`
    : kind === 'oi'
      ? "The vendor's open-interest dealer gamma per 1% move on every expiry, re-priced at each minute's price (spot-exposures) — the same measure as the levels' net GEX. Through the session it counts the contracts expiring that day; after the close those settle, and the figure under Details takes them off, so it equals the All-expiries net"
      : "The vendor's dealer gamma per 1% move from the session's trades (volume-based, minute by minute) — a different measure from the open-interest book the levels are read from";
  const [showDetails, setShowDetails] = useState(false);
  const bookWords = bookLabel ?? expirySpan(dates);

  /* A CLEAR RULE OVER THE BOOK (Noah, 2026-10-14: "the book and the day should have clear cut horizontal line between them
     distinguishing them, the book is a separate thing"): the part opens with the box's own hairline at full strength */
  return (
    /* AS A PART: the lower of the day box's two charts, edge to edge under one rule, its own clock and mark along its foot
       (Noah, 2026-10-15: "2 separate tradingview charts not one big one" — then "no padding, their respected charts should
       fill the entire container") */
    <section className={`relative flex flex-col min-w-0 ${part ? 'flex-1 min-h-0 border-t border-borderSubtle' : ''}`} data-through-day data-through-part={part || undefined}>
      {/* AS A PART: ONE LINE — the word and the facts beside it (2026-10-14) */}
      <div className={part ? 'px-4 min-h-9 py-1 flex items-center gap-x-4 gap-y-1 flex-wrap' : 'px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap'}>
        <div className={part ? 'flex items-center gap-3 flex-wrap' : 'min-w-0 flex-1'}>
          <div className="flex items-center gap-3 flex-wrap">
            {part ? (
              /* NAMED FOR WHAT IT SHOWS (Noah, 2026-10-15: "'the book' … give me informative names as to what they do"):
                 the dealers' hedging through the day — amplifying or absorbing, as the figure beside it says */
              <span className="text-[12px] font-semibold text-textPrimary sm:whitespace-nowrap min-w-0" data-through-part-word title={kindTitle}>
                {kindWord}
              </span>
            ) : (
              <h3 className="text-[16px] font-semibold leading-tight text-textPrimary">The book through the day</h3>
            )}
            {!part && scope}
          </div>
          {!part && <p className="mt-0.5 text-[11px] text-textMuted">The book’s net gamma through the session, spot faint beside it</p>}
        </div>
            {part && (
          <>
            {/* ONE HEADLINE, IN THE LEVELS CARD'S SCOPE (the retail test, 2026-10-23: "LINE NOW −$17.6B amplifies" beside
                "NET GEX −$3.1B", NVDA "+$29.3M absorbs" beside "−$73.8M" and an AMPLIFY badge). The scope's net leads, with
                its verb; the line's all-expiries figure sits under Details, labelled, with no verb of its own. */}
            <PartFact label={`Net GEX${bookWords ? ` · ${bookWords}` : ''}`} title={`Net GEX on every strike of the contracts the Levels card reads (${bookWords ?? 'its scope'}, open interest, retail sign) — the Board's, the Agenda's and Compare's figure. Positive (green): dealers long gamma, their hedging absorbs moves; negative (red): it amplifies them`}>
              {netPending ? (
                <span className="text-textMuted" title="Still loading the Levels card's contracts">…</span>
              ) : (
                <span style={{ color: -bookNet >= 0 ? LONG_GAMMA : SHORT_GAMMA }} data-through-book={Math.round(-bookNet)}>
                  {-bookNet > 0 ? '+' : ''}
                  {fmtUsd(-bookNet)} · {-bookNet >= 0 ? 'absorbs' : 'amplifies'}
                </span>
              )}
            </PartFact>
            {last && <PartFact label="Line changed sign" title={`How many times through the session the line${scoped ? '' : ' (every expiry)'} flipped between absorbing and amplifying`}>{flips === 0 ? 'not yet' : `${flips} ${flips === 1 ? 'time' : 'times'}`}</PartFact>}
            <button
              type="button"
              className="inline-flex items-baseline gap-1 font-mono text-[11px] uppercase tracking-wider text-textMuted hover:text-textPrimary underline-offset-2 hover:underline"
              aria-expanded={showDetails}
              onClick={() => setShowDetails(v => !v)}
              data-through-details-toggle
            >
              Details {showDetails ? '▴' : '▾'}
            </button>
            {showDetails && (
              <span className="inline-flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded border border-borderSubtle/70 px-2 py-0.5" data-through-details>
                {lineNow != null && (
                  <PartFact
                    label={scoped ? `Line's last point${last ? ` · ${hhmm(last.min)}` : ''}` : `Line's last print · all expiries${lastPrint ? ` · ${hhmm(nyMinutes(lastPrint.time * 1000))}` : ''}`}
                    title={scoped ? `${kindTitle}.` : `${kindTitle}.${settled ? ` The contracts that settled at 4:00 (${settled > 0 ? '+' : ''}${fmtUsd(settled)}) are taken off.` : ''}${kind === 'oi' ? ' It is the All-expiries net as of that minute: with Levels on All expiries the Net GEX above is the same measure, re-priced at the latest price, so after the bell the two differ only by the move since the vendor\'s last print.' : ''}`}
                  >
                    <span data-through-net={Math.round(lineNow)}>
                      {lineNow > 0 ? '+' : ''}
                      {fmtUsd(lineNow)}
                      {!scoped && settled ? <span className="ml-1 font-normal text-textMuted">(settled contracts off)</span> : null}
                    </span>
                  </PartFact>
                )}
                <PartFact label="Books kept" title="How many minutes of the session have a reading of the book behind this line">
                  {minutes.length} {minutes.length === 1 ? 'minute' : 'minutes'}
                </PartFact>
              </span>
            )}
          </>
        )}
        {part && !last && (
          <PartFact label="Path">not in</PartFact>
        )}
        {!part && last && (
          <dl className="grid grid-cols-3 gap-x-6">
            <div>
              <dt className="text-[11px] text-textMuted">Net now</dt>
              <dd className="mt-0.5 font-mono text-[14px] tnum whitespace-nowrap" style={{ color: last.net >= 0 ? LONG_GAMMA : SHORT_GAMMA }} data-through-net={Math.round(last.net)}>
                {last.net > 0 ? '+' : ''}
                {fmtUsd(last.net)} · {last.net >= 0 ? 'absorbs' : 'amplifies'}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-textMuted">Net changed sign</dt>
              <dd className="mt-0.5 font-mono text-[14px] tnum text-textPrimary whitespace-nowrap">{flips === 0 ? 'not yet' : `${flips} ${flips === 1 ? 'time' : 'times'}`}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-textMuted">Books kept</dt>
              <dd className="mt-0.5 font-mono text-[14px] tnum text-textPrimary whitespace-nowrap">{minutes.length} {minutes.length === 1 ? 'minute' : 'minutes'}</dd>
            </div>
          </dl>
        )}
        {!part && !last && (
          <p className="font-mono text-[12px] text-textMuted">The hedging path is not in yet.</p>
        )}
      </div>
      <div className={part ? 'flex-1 min-h-0 flex flex-col border-t border-borderSubtle/60' : 'border-t border-borderSubtle/60'}>
        <div
          className={`relative ${part ? 'flex-[1_1_280px] min-h-[240px]' : 'h-[260px]'} outline-none`}
          tabIndex={0}
          role="group"
          aria-label={`${ticker}'s net gamma through the day — the arrow keys walk the minutes`}
          onKeyDown={onKeys}
          data-through-plot
        >
          {/* the canvas clipped to the box's bottom corners (the card is rounded-md over a 1px border); the cards are its
              siblings and never clip */}
          <div ref={hostRef} className={part ? 'absolute inset-0 overflow-hidden rounded-b-[5px]' : 'absolute inset-0'} data-through-chart />
          {minutes.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-[11px] text-textMuted" data-through-empty>
              No hedging path for {ticker} on this feed.
            </p>
          )}
          {hm && hover && (
            /* Compare's glass, beside the point it reads (components/gex/besideDot.ts) */
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-[11px] text-textSecondary"
              style={{ ...besideDot(hover.x, hover.y, hover.x > plotW / 2), background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }}
              data-theme="dark"
              data-chart-glass
              data-through-card={hhmm(hm.min)}
            >
              <span className="font-bold tnum text-textPrimary">{hhmm(hm.min)}</span>
              <span className="ml-2 tnum" style={{ color: hm.net >= 0 ? LONG_GAMMA : SHORT_GAMMA }}>
                {hm.net > 0 ? '+' : ''}
                {fmtUsd(hm.net)} · {hm.net >= 0 ? 'absorbs' : 'amplifies'}
              </span>
              {hm.spot != null && <span className="ml-2 tnum text-textMuted">spot {hm.spot.toFixed(2)}</span>}
            </div>
          )}
          {ahead && !hover && (
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-[11px] text-textSecondary"
              style={{ ...besideDot(ahead.x, ahead.y, ahead.x > plotW / 2), background: 'rgba(8,8,10,0.88)', backdropFilter: 'blur(3px)' }}
              data-theme="dark"
              data-chart-glass
              data-through-ahead={hhmm(ahead.min)}
            >
              <span className="font-bold tnum text-textPrimary">{hhmm(ahead.min)}</span>
              <span className="ml-2 text-textMuted">ahead · the book stops at {minutes.length ? hhmm(minutes[minutes.length - 1].min) : 'now'}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default BookThroughDay;
