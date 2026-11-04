/* An option contract's own bars on the house chart: Terrain's chart (StrikeChart) fed the contract's premium as a host
   tape, with Terrain's toolbar over it — the intervals, chart styles, indicators, price scale, candle theme, export and
   fullscreen — the drawing rail, the crosshair's read line and the library's mark. Nothing read off the name is drawn
   on the premium (StrikeChart `ChartTape.premium`): no levels, no field, no flow, no book indicators. A host hangs its
   own marks on the series through `layer`. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import ChartToolbar from './ChartToolbar';
import StrikeChart, {
  DEFAULT_INDICATORS,
  DEFAULT_OVERLAYS,
  INDICATOR_INKS,
  type ChartIndicators,
  type ChartLayerApi,
  type ChartOverlays,
  type ChartStyle,
  type ChartTape,
  type CrosshairBar,
  type PriceScale,
} from './StrikeChart';
import { chartGround, useCandleThemeKey } from './candleTheme';
import { makeCell, useCell, type Cell } from './hoverCell';
import { DOCK_ROOM } from '../../data/editorDock';
import type { Timeframe } from '../../data/timeframe';
import type { KeyLevels } from '../../types/gex';

/** A bar of the contract: its premium, and the contracts that traded in it where the feed says */
export interface ContractBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/* A premium has no session book to weight by: the "From the book" lines are not offered (ChartToolbar `indicatorKeys`) */
const PREMIUM_INDICATORS: (keyof ChartIndicators)[] = ['ema9', 'ema21', 'ema50', 'sma', 'vwap', 'vwapBands', 'bb', 'rsi', 'macd', 'atrPane'];
/* …and of the overlays only the volume: the rest are the name's (its walls, its field, its flow, its cone) */
const PREMIUM_OVERLAYS: (keyof ChartOverlays)[] = ['volume'];
const overlaysAtRest = (): ChartOverlays => ({ ...(Object.fromEntries(Object.keys(DEFAULT_OVERLAYS).map(k => [k, false])) as unknown as ChartOverlays), volume: true });
const FRAMES: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1D'];

/* The reader's chart settings, kept between contracts and sessions — one set for every contract chart */
interface Prefs {
  chartStyle: ChartStyle;
  indicators: ChartIndicators;
  priceScale: PriceScale;
  volume: boolean;
}
const PREFS_KEY = 'slayer.contractChart';
function readPrefs(): Prefs {
  const rest: Prefs = { chartStyle: 'candles', indicators: DEFAULT_INDICATORS, priceScale: 'normal', volume: true };
  try {
    const kept = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (!kept) return rest;
    const indicators = { ...DEFAULT_INDICATORS };
    for (const k of PREMIUM_INDICATORS) if (typeof kept.indicators?.[k] === 'boolean') indicators[k] = kept.indicators[k];
    return { ...rest, ...kept, indicators, volume: kept.volume !== false };
  } catch {
    return rest;
  }
}

const px2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vol = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : Math.round(n).toLocaleString('en-US'));

/* One labelled figure on the read line — Terrain's */
export const ReadoutCell = ({ k, v, ink }: { k: string; v: string; ink?: string }) => (
  <span className="shrink-0 whitespace-nowrap">
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{k}</span>
    <span className="ml-1 font-mono text-t10 tnum text-textPrimary" style={ink ? { color: ink } : undefined}>
      {v}
    </span>
  </span>
);

/* The read line: the bar under the crosshair, else the newest bar. Its own layer: it changes at pointer rate, and only
   it repaints (hoverCell). */
const ReadLine = ({ cell, last, empty, extra }: { cell: Cell<CrosshairBar | null>; last: ContractBar | null; empty: string; extra?: ReactNode }) => {
  const hover = useCell(cell);
  const bar = hover ?? (last ? { open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume ?? null, indicators: [] as CrosshairBar['indicators'] } : null);
  return (
    <div className="min-h-[23px] flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-3 pb-1 pointer-events-none" data-readout-line data-readout-hover={hover ? '' : undefined}>
      {bar ? (
        <>
          <ReadoutCell k="O" v={bar.open != null ? px2(bar.open) : '—'} />
          <ReadoutCell k="H" v={bar.high != null ? px2(bar.high) : '—'} />
          <ReadoutCell k="L" v={bar.low != null ? px2(bar.low) : '—'} />
          <ReadoutCell k={hover ? 'C' : 'Last'} v={px2(bar.close)} />
          {bar.volume != null && bar.volume > 0 && <ReadoutCell k="V" v={vol(bar.volume)} />}
          {bar.indicators.map(ind => (
            <ReadoutCell key={ind.key} k={ind.key} v={ind.value.toFixed(2)} ink={ind.ink ?? INDICATOR_INKS[ind.key]} />
          ))}
        </>
      ) : (
        <span className="min-w-0 truncate font-mono text-t10 text-textMuted">{empty}</span>
      )}
      {extra ? <span className="ml-auto flex flex-wrap items-center gap-x-2.5 gap-y-0.5 min-w-0 max-sm:hidden">{extra}</span> : null}
    </div>
  );
};

interface ContractChartProps {
  /** The underlying. Only the house chart's name-keyed plumbing reads it; nothing of the name is drawn (`premium`). */
  ticker: string;
  /** The contract's own key: its drawings are kept under it */
  contractKey: string;
  /** The contract's bars at `timeframe`, oldest first. Null while they load; [] when the feed answered with no trades. */
  bars: ContractBar[] | null;
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  /** Bumps with each quote or tick */
  revision: number;
  /** The identity at the strip's left: the contract's capsule */
  identity: ReactNode;
  /** Why the chart is empty, said over it */
  emptyNote?: string;
  /** Said on the read line while the bars load */
  loadingNote?: string;
  /** Figures at the read line's right (the session's high and low, the underlying…) */
  readoutExtra?: ReactNode;
  /** Live: the price card on the axis counts down the bar. A past session's bars do not. */
  live?: boolean;
  /** The host's marks hung on the price series, with the chrome's height (its labels dock under it) */
  layer?: (api: ChartLayerApi, chromeH: number) => ReactNode;
  /** The window the chart opens on (unix seconds), in place of the session's: a past call's trade */
  view?: { from: number; to: number } | null;
  /** A row under the read line, inside the chrome the marks dock under. */
  under?: ReactNode;
}

const ContractChart = ({ ticker, contractKey, bars, timeframe, onTimeframe, revision, identity, emptyNote = '', loadingNote = 'Reading the bars.', readoutExtra, live = true, layer, view = null, under = null }: ContractChartProps) => {
  const themeKey = useCandleThemeKey();
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setPrefs(p => {
      const next = { ...p, [k]: v };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* storage off: the choice lives for the visit */
      }
      return next;
    });
  const overlays = useMemo<ChartOverlays>(() => ({ ...overlaysAtRest(), volume: prefs.volume }), [prefs.volume]);
  const [drawing, setDrawing] = useState(false);
  const [full, setFull] = useState(false);
  const [readout] = useState(() => makeCell<CrosshairBar | null>(null));
  useEffect(() => readout.set(null), [contractKey, timeframe, readout]);
  const exportRef = useRef<(() => void) | null>(null);

  /* the strip's room: the toolbar sheds its words under it, and the pencil needs a pointer and room to draw */
  const boxRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = useState(0);
  const [chromeH, setChromeH] = useState(64);
  useEffect(() => {
    const measure = () => {
      const w = boxRef.current?.clientWidth ?? 0;
      const h = chromeRef.current?.offsetHeight ?? 0;
      if (w > 0) setBoxW(w);
      if (h > 0) setChromeH(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (boxRef.current) ro.observe(boxRef.current);
    if (chromeRef.current) ro.observe(chromeRef.current);
    return () => ro.disconnect();
  }, [full]);
  const roomToDraw = boxW >= 560;
  useEffect(() => {
    if (!roomToDraw) setDrawing(false);
  }, [roomToDraw]);

  /* Esc steps out of fullscreen; the page under it does not scroll */
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      setFull(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full]);

  const tape = useMemo<ChartTape>(
    () => ({
      bars: (bars ?? []).map(b => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 })),
      iv: 0,
      key: `contract:${contractKey}`,
      native: true,
      premium: true,
      note: bars && bars.length === 0 ? emptyNote || null : null,
      view,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bars, contractKey, emptyNote, view?.from, view?.to]
  );
  const last = bars && bars.length ? bars[bars.length - 1] : null;
  const levels = useMemo<KeyLevels>(() => ({ spot: last?.close ?? 0, callWall: NaN, putWall: NaN, flip: NaN, supreme: NaN }), [last?.close]);
  const compact = boxW > 0 && boxW < 720;

  const body = (
    <div
      ref={boxRef}
      className={`relative h-full min-h-0 overflow-hidden bg-panel ${full ? '' : 'border border-borderSubtle rounded-md'}`}
      data-theme="dark"
      data-chart-ground={chartGround(themeKey)}
      data-contract-chart={contractKey}
      data-contract-bars={bars == null ? 'loading' : bars.length}
      data-chart-full={full || undefined}
    >
      <div className="absolute inset-0">
        <StrikeChart
          ticker={ticker}
          revision={revision}
          levels={levels}
          timeframe={timeframe}
          tape={tape}
          overlays={overlays}
          indicators={prefs.indicators}
          onIndicators={i => setPref('indicators', i)}
          chartStyle={prefs.chartStyle}
          priceScale={prefs.priceScale}
          drawing={roomToDraw && drawing}
          onEnterDraw={roomToDraw ? () => setDrawing(true) : undefined}
          onExitDraw={() => setDrawing(false)}
          railTopOk={full}
          priceTag={live}
          onReadout={readout.set}
          exportRef={exportRef}
          pageScroll={!full && boxW > 0 && boxW < 640}
          height={full ? 460 : 260}
          frameless
          layer={layer ? api => layer(api, chromeH) : undefined}
        />
      </div>
      {/* THE STRIP — the identity, then the house toolbar spread to the right edge; a veil over the tape, Terrain's
          fullscreen grammar. The read line rides under it. Both are chrome the chart measures and docks under. */}
      <div ref={chromeRef} className="absolute top-0 inset-x-0 z-20 select-none backdrop-blur-md backdrop-saturate-150" style={{ background: 'rgb(var(--panel) / 0.55)' }} data-chart-chrome data-chart-strip>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-2 pr-2 py-1.5">
          <span className="shrink-0 flex items-center gap-2">{identity}</span>
          <div className="flex-1 min-w-fit" data-contract-toolbar>
            <ChartToolbar
              minimal
              candles
              spread
              compact={compact}
              keepIntervals={boxW === 0 || boxW >= 520}
              dense={!full}
              menuBounds={full ? undefined : boxRef}
              timeframes={FRAMES}
              timeframe={timeframe}
              onTimeframe={onTimeframe}
              overlays={overlays}
              onOverlays={o => setPref('volume', o.volume)}
              overlayKeys={PREMIUM_OVERLAYS}
              indicators={prefs.indicators}
              onIndicators={i => setPref('indicators', i)}
              indicatorKeys={PREMIUM_INDICATORS}
              chartStyle={prefs.chartStyle}
              onChartStyle={s => setPref('chartStyle', s)}
              priceScale={prefs.priceScale}
              onPriceScale={s => setPref('priceScale', s)}
              onExportPng={() => exportRef.current?.()}
              fullscreen={full}
              onToggleFullscreen={() => setFull(f => !f)}
            />
          </div>
        </div>
        <ReadLine cell={readout} last={last} empty={bars == null ? loadingNote : emptyNote || 'No trades on this contract.'} extra={boxW === 0 || boxW >= 600 ? readoutExtra : undefined} />
        {under}
      </div>
    </div>
  );

  if (full) {
    return (
      <>
        {/* the chart's place on the page holds while it is up on the screen */}
        <div className="h-full rounded-md border border-borderSubtle bg-panel" aria-hidden="true" />
        {createPortal(
          <div className="fixed inset-0 z-[80] flex flex-col bg-panel animate-soft-in" style={DOCK_ROOM} data-theme="dark" role="dialog" aria-modal="true" aria-label="The contract's chart, full screen">
            <div className="flex-1 min-h-0">{body}</div>
          </div>,
          document.body
        )}
      </>
    );
  }
  return body;
};

export default ContractChart;
