/* The whole book's net gamma through the session (bookMarket getGexHistory, a book a minute) as a baseline at zero,
   spot quiet on its own scale; on the feed the minute net is the vendor's minute gamma. Drawn by lightweight-charts (dayChart.ts). */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BaselineSeries, createChart, LineSeries, LineStyle, type IChartApi, type ISeriesApi, type LineData, type Time, type UTCTimestamp } from 'lightweight-charts';
import { sessionBars } from '../../data/levelview';
import { bookMinuteKind, deskBars, peekSettledNet, useBookMinutes, useBookRev, useResolvedSession } from '../../data/uwBook';
import { roomLevels } from '../../data/roomLevels';
import { nyIsoDate } from '../../core/nyTime';
import { expirySpan, longDay } from '../../data/bookWindow';
import { levelNetPath } from '../../data/flipLevel';
import { nySessionPhase } from '../../core/nyTime';

const inSessionNow = (): boolean => nySessionPhase() === 'open';
import { sessionOfMinute } from '../../data/deskSession';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { hhmm } from '../../data/ahead';
import { axisForSession } from '../../data/dayAxis';
import { besideDot } from './besideDot';
import { nyMinutes } from '../../core/nyTime';
/* Retail sign in the board's inks: green above zero where hedging absorbs, red below where it amplifies. */
import { LONG_GAMMA, SHORT_GAMMA, alpha, resolveInk } from './paletteInk';
import { readSessionClock } from '../../data/moc';
import { readToken, useResolvedTheme } from '../../theme/theme';
import { setDayHover, clearDayHover, useDayHover } from '../../data/dayHover';
import { CLOCK_SCALE, dayChartOptions, dayClock, daySurface, feedSeries, syncDayScale } from './dayChart';
import { PlayheadPrimitive } from './playheadPrimitive';
import type { Candle, MarketSnapshot } from '../../types/market';

/** A fact on one line (tracked capitals, the figure beside it) so the chart keeps the height. */
const PartFact = ({ label, children, title }: { label: string; children: ReactNode; title?: string }) => (
  <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap font-mono" title={title}>
    <span className="text-t11 uppercase tracking-wider text-textMuted">{label}</span>
    <span className="text-t12 font-semibold tnum text-textPrimary">{children}</span>
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

/** The axis's short form ("800M", "-1.2B"): no dollar sign keeps the axis at 52 px, the width the tape above shares;
    the dollars are in the facts beside the chart. */
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
  const read = useResolvedSession(ticker);
  const shown = barsProp?.length ? sessionOfMinute(nyMinutes(barsProp[0].time * 1000)) : read.session;
  const bars = useMemo(() => {
    if (barsProp?.length) return barsProp;
    if (shown !== 'rth') return deskBars(ticker, shown) ?? [];
    return sessionBars(ticker) ?? [];
  }, [ticker, barsProp, shown]);
  const vendor = useBookMinutes(ticker);

  /* The minutes: volume gamma through the session, in the book's unit. The open-interest series are near-straight lines
     and are not drawn; a replay cuts the series at its minute. */
  const bookNet = useMemo(() => {
    let n = 0;
    for (const s of snapshot.chain) n += s.netGex;
    return n;
  }, [snapshot]);
  /* Nothing provisional: no line while the scope's book is still loading. */
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
    /* The line is the headline's own contracts (flipLevel levelNetPath) re-priced at each minute's price,
       so it ends at the headline's figure; outside the session it ends at the close the levels are priced at. */
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
      /* Each minute at its own time to expiry. */
      const read = levelNetPath(snapshot, snapshot.chain, pts.map(p => p.price), pts.map(p => p.time * 1000 + 60_000));
      if (!read) return [];
      /* a figure the chart cannot draw is not drawn (the library throws past ±9×10^13 and the page stops) */
      return pts.map((p, i) => ({ time: p.time, min: p.min, net: read.path[i], spot: p.price })).filter(m => Number.isFinite(m.net) && Math.abs(m.net) < 1e13);
    }
    const pool = vendor ?? [];
    let kept = pool.filter(m => m.min >= lo && m.min <= hi && m.min <= endMin);
    if (kept.length < 2) kept = pool.filter(m => m.min <= endMin);
    if (kept.length >= 2 && !isRamp(kept.map(m => m.net))) {
      /* The vendor's volume-based dealer gamma per 1% (spot-exposures) as printed, in the retail sign (positive = absorbs).
         Never rescaled to the OI net: a scale of opposite sign inverted the whole day. */
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
    /* The net as a baseline at zero, retail sign: green above (dealers long gamma, absorbs), red below (amplifies). */
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
      /* No last-value tag: the book's figure is the headline's; the axis tag would show the whole book, settled contracts included. */
      lastValueVisible: false,
      crosshairMarkerRadius: 3,
      /* The axis's figures without the idle decimal: the axis is as wide as its widest figure, and the tape above shares it. */
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
    /* The axis as wide as its figures, shared with the tape over it. */
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
  /* Left and right keys walk the minutes, as on the tape. */
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
  /* Which series the line is, said where it is shown. */
  const kind = vendor ? bookMinuteKind(ticker) : null;
  /* The line's last figure is the vendor's last print less the gamma of contracts settled at 4:00,
     so it equals the all-expiries net (the vendor keeps printing, and counting settled contracts, after the bell). */
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
    ? `The net GEX of the contracts the Levels card reads (${bookLabel ?? 'its scope'}) — their open interest as it stands now, re-priced at each minute's price${barDay && barDay !== nyIsoDate() ? ` through ${longDay(barDay)}'s session` : ''}. The feed's own minute series does the same for the whole book; this is the same measure on the headline's contracts, so the line ends at the Net GEX beside it, in its sign: green above zero (dealers long gamma, their hedging absorbs), red below (it amplifies)`
    : kind === 'oi'
      ? "The feed's open-interest dealer gamma per 1% move on every expiry, re-priced at each minute's price (spot-exposures) — the same measure as the levels' net GEX. Through the session it counts the contracts expiring that day; after the close those settle, and the figure under Details takes them off, so it equals the All-expiries net"
      : "Dealer gamma per 1% move from the session's trades (volume-based, minute by minute) — a different measure from the open-interest book the levels are read from";
  const [showDetails, setShowDetails] = useState(false);
  const bookWords = bookLabel ?? expirySpan(dates);

  /* The part opens with the box's hairline at full strength, a clear rule between the book and the day. */
  return (
    /* As a part: the lower of the day box's two charts, edge to edge, with its own clock along its foot. */
    <section className={`relative flex flex-col min-w-0 ${part ? 'flex-1 min-h-0 border-t border-borderSubtle' : ''}`} data-through-day data-through-part={part || undefined}>
      {/* As a part: one line, the word and the facts beside it. */}
      <div className={part ? 'px-4 min-h-9 py-1 flex items-center gap-x-4 gap-y-1 flex-wrap' : 'px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap'}>
        <div className={part ? 'flex items-center gap-3 flex-wrap' : 'min-w-0 flex-1'}>
          <div className="flex items-center gap-3 flex-wrap">
            {part ? (
              /* Named for what it shows: the dealers' hedging through the day. */
              <span className="text-t12 font-semibold text-textPrimary sm:whitespace-nowrap min-w-0" data-through-part-word title={kindTitle}>
                {kindWord}
              </span>
            ) : (
              <h3 className="text-t16 font-semibold leading-tight text-textPrimary">The book through the day</h3>
            )}
            {!part && scope}
          </div>
          {!part && <p className="mt-0.5 text-t11 text-textMuted">The book’s net gamma through the session, spot faint beside it</p>}
        </div>
            {part && (
          <>
            {/* One headline in the Levels card's scope, with its verb; the line's all-expiries figure sits under Details with no verb. */}
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
              /* z-[3]: its finger box reaches over the chart's top edge, whose canvases lightweight-charts stacks at z 1–2
                 (the last-targets pass) */
              className="hit-24 z-[3] inline-flex items-baseline gap-1 font-mono text-t11 uppercase tracking-wider text-textMuted hover:text-textPrimary underline-offset-2 hover:underline"
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
                    title={scoped ? `${kindTitle}.` : `${kindTitle}.${settled ? ` The contracts that settled at 4:00 (${settled > 0 ? '+' : ''}${fmtUsd(settled)}) are taken off.` : ''}${kind === 'oi' ? ' It is the All-expiries net as of that minute: with Levels on All expiries the Net GEX above is the same measure, re-priced at the latest price, so after the bell the two differ only by the move since the last print.' : ''}`}
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
          <PartFact label="Path">still reading</PartFact>
        )}
        {!part && last && (
          <dl className="grid grid-cols-3 gap-x-6">
            <div>
              <dt className="text-t11 text-textMuted">Net now</dt>
              <dd className="mt-0.5 font-mono text-t14 tnum whitespace-nowrap" style={{ color: last.net >= 0 ? LONG_GAMMA : SHORT_GAMMA }} data-through-net={Math.round(last.net)}>
                {last.net > 0 ? '+' : ''}
                {fmtUsd(last.net)} · {last.net >= 0 ? 'absorbs' : 'amplifies'}
              </dd>
            </div>
            <div>
              <dt className="text-t11 text-textMuted">Net changed sign</dt>
              <dd className="mt-0.5 font-mono text-t14 tnum text-textPrimary whitespace-nowrap">{flips === 0 ? 'not yet' : `${flips} ${flips === 1 ? 'time' : 'times'}`}</dd>
            </div>
            <div>
              <dt className="text-t11 text-textMuted">Books kept</dt>
              <dd className="mt-0.5 font-mono text-t14 tnum text-textPrimary whitespace-nowrap">{minutes.length} {minutes.length === 1 ? 'minute' : 'minutes'}</dd>
            </div>
          </dl>
        )}
        {!part && !last && (
          <p className="font-mono text-t12 text-textMuted">The hedging path is not in yet.</p>
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
            <p className="absolute inset-0 flex items-center justify-center px-6 text-center font-mono text-t11 text-textMuted" data-through-empty>
              No hedging path for {ticker} on this feed.
            </p>
          )}
          {hm && hover && (
            /* Compare's glass, beside the point it reads (components/gex/besideDot.ts) */
            <div
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-t11 text-textSecondary"
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
              className="pointer-events-none absolute z-10 whitespace-nowrap rounded-md border border-borderSubtle px-2.5 py-1.5 font-mono text-t11 text-textSecondary"
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
