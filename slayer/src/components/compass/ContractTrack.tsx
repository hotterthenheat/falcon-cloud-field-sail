/* The contract's premium chart: Terrain's chart on the contract's own bars (ContractChart), with the setup's marks on
   it — the entry line (the fill once it filled, the call's ask before), the take-profit rungs and the standing stop,
   every percent measured from that one base — and the minute it was called and the minute it left. High, low and last
   are the candles on this chart, not a second book. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createSeriesMarkers, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type SeriesType, type Time, type UTCTimestamp } from 'lightweight-charts';
import ContractChart, { ReadoutCell, type ContractBar } from '../gex/ContractChart';
import type { ChartLayerApi } from '../gex/StrikeChart';
import { chartSurface, getCandleTheme, useCandleThemeKey } from '../gex/candleTheme';
import { resolveInk } from '../gex/paletteInk';
import ContractPick, { type ConPickRow } from './ContractPick';
import { SetupMarksPrimitive, type SetupMarks } from './setupMarksPrimitive';
import { quoteContract, type ContractQuote } from '../../data/contractQuote';
import { underWord } from '../../data/compassSession';
import { tfMinutes, type Timeframe } from '../../data/timeframe';
import type { OptionRight, Setup } from '../../types/compass';

interface ContractTrackProps {
  setup: Setup;
  revision: number;
  tracked?: boolean;
  spot?: number;
  loadPickRows?: () => ConPickRow[];
  onOpenContract?: (strike: number, right: OptionRight, sleeve?: Setup['sleeve']) => void;
  quotedAt?: number;
  volume?: number;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  quote?: ContractQuote;
  traded?: ContractBar[] | null;
  /** Why the session's chart is empty. Blank when the tape itself has not loaded. */
  emptyNote?: string;
  /** Said while the bars load (or why they cannot) */
  pathNote?: string;
  /** The exits drawn, as multiples of the entry (the late sweep sells at 2× and 3×) */
  multiples?: number[];
  /** What the entry line is: the fill once it filled, the call's ask before. Every percent on the chart is from it. */
  entryWord?: string;
  /** The minute the call fired, and the minute it left (with how), when it has */
  calledAt?: number;
  exit?: { at: number; result: 'win' | 'loss' | 'flat' } | null;
  /** A live call: the bars grow and the axis card counts the bar down. A past call is read off its session. */
  live?: boolean;
}

/** The index under a weekly root. A stock keeps its own name. */
const SPOT_NAME: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'SPX', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX' };

const px2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n: number) => Math.round(n).toLocaleString('en-US');

/** The bar a moment sits in: the last bar at or before it, inside a few of this interval's bars (a minute with no trade
    has no bar) */
function barAt(bars: readonly ContractBar[], ms: number, stepSec: number): number | null {
  if (!(ms > 0) || !bars.length) return null;
  const t = Math.floor(ms / 1000);
  let at: ContractBar | null = null;
  for (const b of bars) {
    if (b.time > t) break;
    at = b;
  }
  return at && t - at.time < Math.max(stepSec * 6, 300) ? at.time : null;
}

/* What is hung on the chart's price series: the marks primitive (entry, rungs, stop), the call and exit arrows and the
   room the scale keeps for them. A chart style swap hands over a new series; everything is hung again on it (TradeTape's
   grammar). */
const SetupMarksLayer = ({ api, marks, arrows, room }: { api: ChartLayerApi; marks: SetupMarks; arrows: SeriesMarker<Time>[]; room: number[] }) => {
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const primRef = useRef<SetupMarksPrimitive | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [seriesN, setSeriesN] = useState(0);
  useEffect(() => {
    let raf = 0;
    const watch = () => {
      const series = api.series();
      if (series !== seriesRef.current) {
        seriesRef.current = series;
        primRef.current = null;
        markersRef.current = null;
        if (series) {
          const prim = new SetupMarksPrimitive();
          series.attachPrimitive(prim);
          primRef.current = prim;
          markersRef.current = createSeriesMarkers(series, []);
        }
        setSeriesN(n => n + 1);
      }
      raf = requestAnimationFrame(watch);
    };
    raf = requestAnimationFrame(watch);
    return () => {
      cancelAnimationFrame(raf);
      /* only while the chart stands: a primitive taken off a removed chart throws a frame later */
      const series = api.chart() && api.series() === seriesRef.current ? seriesRef.current : null;
      if (series) {
        try {
          if (primRef.current) series.detachPrimitive(primRef.current);
          markersRef.current?.detach();
        } catch {
          /* the series went with its chart */
        }
      }
      seriesRef.current = null;
      primRef.current = null;
      markersRef.current = null;
    };
  }, [api]);
  useEffect(() => {
    primRef.current?.setData(marks);
  }, [marks, seriesN]);
  useEffect(() => {
    markersRef.current?.setMarkers(arrows);
  }, [arrows, seriesN]);
  const roomKey = room.map(p => p.toFixed(2)).join('|');
  useEffect(() => {
    api.room(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, roomKey, seriesN]);
  return null;
};

const ContractTrack = ({
  setup,
  revision,
  spot = 0,
  loadPickRows,
  onOpenContract,
  quotedAt = 0,
  volume = 0,
  timeframe,
  onTimeframe,
  quote: cardQuote,
  traded = null,
  emptyNote = '',
  pathNote = '',
  multiples = [1.5, 2, 3],
  entryWord = 'ASK',
  calledAt = 0,
  exit = null,
  live = true,
}: ContractTrackProps) => {
  const themeKey = useCandleThemeKey();
  const inkRef = useRef<HTMLSpanElement | null>(null);
  const book = cardQuote ?? quoteContract({
    ticker: setup.ticker,
    contract: setup.contract,
    strike: setup.strike,
    right: setup.right,
    spot,
    bid: setup.bid,
    ask: setup.ask > 0 ? setup.ask : setup.mid,
    ivPct: setup.greeks.iv,
    quotedAt,
    source: 'theta',
  });
  const series = useMemo(() => {
    if (!traded?.length) return null;
    let high = traded[0].high;
    let low = traded[0].low;
    for (const b of traded) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
    }
    return { high, low };
  }, [traded]);
  const spotName = SPOT_NAME[setup.ticker] ?? setup.ticker;
  const multKey = multiples.join('|');
  const tps = useMemo(() => multiples.map((mult, i) => ({ level: i + 1, price: Number((book.entryPremium * mult).toFixed(2)) })), [book.entryPremium, multKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the scale keeps the entry, the stop and the near rungs in view; a rung far off the session docks at the edge instead
     of squashing the candles into a line */
  const room = useMemo(
    () => [book.entryPremium, book.stopPremium, ...tps.map(t => t.price)].filter(p => p > 0 && p <= book.entryPremium * 1.7),
    [book.entryPremium, book.stopPremium, tps]
  );

  const marks = useMemo<SetupMarks>(() => {
    const surface = chartSurface(getCandleTheme());
    const host = inkRef.current;
    const lastT = (traded && traded.length ? traded[traded.length - 1].time : Math.floor(Date.now() / 1000)) as UTCTimestamp;
    return {
      /* the entry line and every percent on the chart measure from the same price: the fill, or the call's ask */
      entry: book.entryPremium > 0 ? { time: lastT, price: book.entryPremium, mid: book.entryPremium } : null,
      entryWord,
      /* no stop, no line (the late sweep holds without one) */
      floor: book.stopPremium > 0 ? { price: book.stopPremium, brokeAt: null } : null,
      targets: book.entryPremium > 0 ? tps.map(t => ({ level: t.level, price: t.price, won: false })) : [],
      silver: resolveInk('rgb(var(--silver))', host),
      bg: surface.bg,
      bull: resolveInk('rgb(var(--bull))', host),
      bear: resolveInk('rgb(var(--bear))', host),
      ink: resolveInk('rgb(var(--text-primary))', host),
      hot: null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.ticker, book.entryPremium, book.stopPremium, themeKey, traded, tps, entryWord]);

  /* the call's minute and the exit's, on the bars they fell in */
  const step = Math.round(tfMinutes(timeframe) * 60);
  const arrows = useMemo<SeriesMarker<Time>[]>(() => {
    if (!traded?.length) return [];
    const host = inkRef.current;
    const out: SeriesMarker<Time>[] = [];
    const callBar = barAt(traded, calledAt, step);
    if (callBar != null) out.push({ time: callBar as UTCTimestamp, position: 'belowBar', shape: 'arrowUp', color: resolveInk('rgb(var(--silver))', host), text: 'Call' });
    const outBar = exit ? barAt(traded, exit.at, step) : null;
    if (outBar != null && exit) out.push({ time: outBar as UTCTimestamp, position: 'aboveBar', shape: 'arrowDown', color: resolveInk(exit.result === 'win' ? 'rgb(var(--bull))' : exit.result === 'loss' ? 'rgb(var(--bear))' : 'rgb(var(--text-primary))', host), text: 'Out' });
    return out.sort((a, b) => (a.time as number) - (b.time as number));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traded, calledAt, exit?.at, exit?.result, step, themeKey]);

  /* a past call opens on its trade: the run-up before the call, the call to the exit, and a little after it (the house
     chart's focus, in place of the session's) */
  const view = useMemo(() => {
    if (live || !(calledAt > 0)) return null;
    const from = Math.floor(calledAt / 1000);
    const to = exit && exit.at > calledAt ? Math.floor(exit.at / 1000) : from;
    return { from: from - 60 * step, to: to + 18 * step };
  }, [live, calledAt, exit?.at, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const identity = loadPickRows && onOpenContract ? (
    <ContractPick label={`${setup.contract} · ${setup.expiry}`} current={{ strike: setup.strike, right: setup.right, sleeve: setup.sleeve }} loadRows={loadPickRows} onPick={onOpenContract} />
  ) : (
    <span className="inline-flex items-center h-7 px-3 rounded-full bg-ink/[0.06] font-mono text-t11 font-bold text-textPrimary shrink-0 whitespace-nowrap">
      {setup.contract} · {setup.expiry}
    </span>
  );

  return (
    <div
      className="relative h-full min-h-[280px]"
      data-premium-track
      data-setup-chart="premium"
      data-option-entry={book.entryPremium}
      data-option-stop={book.stopPremium}
      data-stat-bid={book.bid}
      data-stat-ask={book.ask}
      data-stat-mark={book.mark}
      data-setup-arrows={arrows.map(a => a.text).join(',')}
    >
      <span ref={inkRef} className="hidden" data-chart-ink aria-hidden="true" />
      <ContractChart
        ticker={setup.ticker}
        contractKey={`${setup.ticker}|${setup.expiryDate}|${setup.strike}|${setup.right}`}
        bars={traded}
        timeframe={timeframe}
        onTimeframe={onTimeframe}
        revision={revision}
        identity={identity}
        live={live}
        emptyNote={emptyNote || 'No print on the tape.'}
        loadingNote={pathNote || 'Reading the bars.'}
        readoutExtra={
          <>
            <ReadoutCell k="High" v={series ? px2(series.high) : '—'} />
            <ReadoutCell k="Low" v={series ? px2(series.low) : '—'} />
            {live && <ReadoutCell k="Vol" v={volume > 0 ? count(volume) : '—'} />}
            <ReadoutCell k={spotName} v={spot > 0 ? px2(spot) : '—'} />
            {live && <ReadoutCell k="Tape" v={underWord(setup.ticker)} />}
          </>
        }
        layer={(api, chromeH) => <SetupMarksLayer api={api} marks={{ ...marks, insetTop: chromeH }} arrows={arrows} room={room} />}
        view={view}
      />
    </div>
  );
};

export default ContractTrack;
