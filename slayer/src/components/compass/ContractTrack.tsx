/* The contract's premium chart. One pane. High, low, and last are the candles on this chart, not a second book. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';
import { TimeframeStrip } from '../gex/ChartToolbar';
import { chartGround, chartSurface, getCandleTheme, useCandleThemeKey } from '../gex/candleTheme';
import { resolveInk } from '../gex/paletteInk';
import ContractPremiumPane from '../gex/ContractPremiumPane';
import ContractPick, { type ConPickRow } from './ContractPick';
import { quoteContract, type ContractQuote } from '../../data/contractQuote';
import type { Timeframe } from '../../data/timeframe';
import type { OptionRight, Setup } from '../../types/compass';
import type { SetupMarks } from './setupMarksPrimitive';

/** The plan. A half-price stop and a 3× target are named on the price rail with the high, the low and the entry.
    They are not drawn through the candles — the rail carries the label. */
const PLAN_STOP = 0.4678;
const PLAN_TPS = [1.5, 2, 3] as const;

interface ContractTrackProps {
  setup: Setup;
  revision: number;
  retired?: boolean;
  tracked?: boolean;
  spot?: number;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  loadPickRows?: () => ConPickRow[];
  onOpenContract?: (strike: number, right: OptionRight, sleeve?: Setup['sleeve']) => void;
  quotedAt?: number;
  volume?: number;
  part?: 'chart' | 'stats';
  timeframe?: Timeframe;
  onTimeframe?: (tf: Timeframe) => void;
  quote?: ContractQuote;
  traded?: { time: number; open: number; high: number; low: number; close: number; volume?: number }[] | null;
  emptyNote?: string;
  pathNote?: string;
}

const px2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n: number) => Math.round(n).toLocaleString('en-US');

const SPOT_NAME: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'SPX', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX' };

const ReadoutCell = ({ k, v }: { k: string; v: string }) => (
  <span className="shrink-0 whitespace-nowrap">
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{k}</span>
    <span className="ml-1.5 font-mono text-t11 tnum text-textPrimary">{v}</span>
  </span>
);

const LevelCell = ({ k, v, pip }: { k: string; v: string; pip: string }) => (
  <span className="inline-flex items-center gap-1.5 shrink-0">
    <span className={`h-1.5 w-1.5 rounded-full ${pip}`} />
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{k}</span>
    <span className="font-mono text-t13 tnum text-textPrimary">{v}</span>
  </span>
);

const ContractTrack = ({
  setup,
  revision,
  spot = 0,
  loadPickRows,
  onOpenContract,
  quotedAt = 0,
  volume = 0,
  timeframe: timeframeProp,
  onTimeframe,
  quote: cardQuote,
  traded,
}: ContractTrackProps) => {
  const [localTf, setLocalTf] = useState<Timeframe>('5m');
  const timeframe = timeframeProp ?? localTf;
  const setTimeframe = onTimeframe ?? setLocalTf;
  const themeKey = useCandleThemeKey();
  const tapeRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const [topMargin, setTopMargin] = useState(0.18);
  const [bar, setBar] = useState<{ open: number; high: number; low: number; close: number } | null>(null);
  const [scale, setScale] = useState<'price' | 'levels'>('price');

  useEffect(() => {
    const measure = () => {
      const tape = tapeRef.current?.clientHeight ?? 0;
      const chrome = chromeRef.current?.clientHeight ?? 0;
      if (tape > 0 && chrome > 0) setTopMargin(Math.min(0.28, Math.max(0.1, (chrome + 8) / tape)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (tapeRef.current) ro.observe(tapeRef.current);
    if (chromeRef.current) ro.observe(chromeRef.current);
    return () => ro.disconnect();
  }, []);

  const iv = setup.greeks.iv / 100;
  const sessions = Math.max(setup.sessionsLeft, 0.5);
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
    return { high, low, last: traded[traded.length - 1].close };
  }, [traded]);
  const shown = bar;
  const markWord = shown ? 'C' : 'Last';
  const markPx = shown ? shown.close : (series?.last ?? book.mark);
  const spotName = SPOT_NAME[setup.ticker] ?? setup.ticker;
  const up = book.entryPremium > 0 && book.bid > 0 ? ((book.bid - book.entryPremium) / book.entryPremium) * 100 : NaN;
  const upWord = Number.isFinite(up) ? `${up >= 0 ? '+' : '−'}${Math.abs(up).toFixed(1)}%` : '—';
  const dayOpen = traded && traded.length ? traded[0].open : 0;
  const today = dayOpen > 0 && book.bid > 0 ? ((book.bid - dayOpen) / dayOpen) * 100 : NaN;
  const todayWord = Number.isFinite(today) ? `${today >= 0 ? '+' : '−'}${Math.abs(today).toFixed(1)}%` : '—';
  const rung = (mult: number) => (book.entryPremium > 0 ? Number((book.entryPremium * mult).toFixed(2)) : 0);
  const sellAt = rung(PLAN_TPS[0]);
  const tp2 = rung(PLAN_TPS[1]);
  const tp3 = rung(PLAN_TPS[2]);
  const stopPx = book.stopPremium > 0 ? book.stopPremium : rung(PLAN_STOP);
  const base = book.entryPremium > 0 ? book.entryPremium : book.mark;
  const onTape = (p: number) => p > 0 && base > 0 && p >= base * 0.88 && p <= base * 1.15;

  const framePrices = useMemo(
    () => (scale === 'levels' ? [book.entryPremium, stopPx, sellAt, tp2, tp3].filter(p => p > 0 && p >= (book.entryPremium || p) * 0.88 && p <= (book.entryPremium || p) * 1.15) : []),
    [scale, book.entryPremium, stopPx, sellAt, tp2, tp3],
  );

  const marks = useMemo<SetupMarks>(() => {
    const surface = chartSurface(getCandleTheme());
    const host = tapeRef.current;
    const lastT = (traded && traded.length ? traded[traded.length - 1].time : Math.floor(Date.now() / 1000)) as UTCTimestamp;
    return {
      entry: book.entryPremium > 0 ? { time: lastT, price: book.entryPremium, mid: book.entryPremium } : { time: lastT, price: book.mark, mid: book.mark },
      entryWord: book.entryPremium > 0 ? 'Entry' : 'Last',
      floor: onTape(stopPx) ? { price: stopPx, brokeAt: null } : null,
      targets: [sellAt, tp2, tp3].filter(p => onTape(p)).map((price, i) => ({ level: i + 1, price, won: book.bid > 0 && book.bid + 1e-9 >= price })),
      silver: resolveInk('rgb(var(--silver))', host),
      bg: surface.bg,
      bull: resolveInk('rgb(var(--bull))', host),
      bear: resolveInk('rgb(var(--bear))', host),
      ink: resolveInk('rgb(var(--text-primary))', host),
      hot: null,
      insetTop: 92,
      bare: true,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.ticker, book.entryPremium, stopPx, book.bid, book.mark, themeKey, traded, sellAt, tp2, tp3]);

  return (
    <div
      ref={tapeRef}
      className="relative h-full min-h-[280px] overflow-hidden border border-borderSubtle rounded-md bg-panel"
      data-premium-track
      data-setup-chart="premium"
      data-stock-pane="off"
      data-option-entry={book.entryPremium}
      data-option-stop={stopPx}
      data-stat-bid={book.bid}
      data-stat-ask={book.ask}
      data-stat-mark={book.mark}
      data-theme="dark"
      data-chart-ground={chartGround(themeKey)}
    >
      <ContractPremiumPane
        ticker={setup.ticker}
        strike={setup.strike}
        right={setup.right}
        tYears={sessions / 252}
        iv={iv}
        timeframe={timeframe}
        revision={revision}
        rules
        grid
        levels={[
          ...(series && series.high > 0 ? [{ price: series.high, label: 'High', color: resolveInk('rgb(var(--silver))', tapeRef.current), style: 'dotted' as const }] : []),
          ...(series && series.low > 0 ? [{ price: series.low, label: 'Low', color: resolveInk('rgb(var(--silver))', tapeRef.current), style: 'dotted' as const }] : []),
          ...(book.entryPremium > 0 ? [{ price: book.entryPremium, label: 'Entry', color: '#FF9500', style: 'solid' as const, axisOnly: true }] : []),
          ...(stopPx > 0 ? [{ price: stopPx, label: 'Stop', color: resolveInk('rgb(var(--bear))', tapeRef.current), style: 'dashed' as const, axisOnly: true }] : []),
          ...(sellAt > 0 ? [{ price: sellAt, label: 'TP1', color: '#30D158', style: 'dashed' as const, axisOnly: true }] : []),
          ...(tp2 > 0 ? [{ price: tp2, label: 'TP2', color: '#64D2FF', style: 'dashed' as const, axisOnly: true }] : []),
          ...(tp3 > 0 ? [{ price: tp3, label: 'TP3', color: '#BF5AF2', style: 'dashed' as const, axisOnly: true }] : []),
        ]}
        marks={marks}
        spot={spot}
        framePrices={framePrices}
        topMargin={topMargin}
        bound
        traded={traded}
        onBar={setBar}
      />
      <div ref={chromeRef} className="absolute top-0 inset-x-0 z-20 pointer-events-none" data-chart-chrome>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0 pl-2 pr-3 py-1.5 select-none pointer-events-auto">
          {loadPickRows && onOpenContract ? (
            <ContractPick
              label={`${setup.contract} · ${setup.expiry}`}
              current={{ strike: setup.strike, right: setup.right, sleeve: setup.sleeve }}
              loadRows={loadPickRows}
              onPick={onOpenContract}
            />
          ) : (
            <span className="inline-flex items-center h-7 px-3 rounded-full bg-ink/[0.06] font-mono text-t11 font-bold text-textPrimary shrink-0">
              {setup.contract} · {setup.expiry}
            </span>
          )}
          <TimeframeStrip value={timeframe} onChange={setTimeframe} only={['5m', '15m', '30m', '1h', '1D', '1W', '1m']} />
          <span className="inline-flex items-center h-7 rounded-full bg-ink/[0.06] p-0.5 shrink-0" data-chart-scale={scale}>
            <button type="button" onClick={() => setScale('price')} title="Price lets the candles set the scale." className={`h-6 px-2 rounded-full font-mono text-t11 ${scale === 'price' ? 'bg-ink/10 text-textPrimary' : 'text-textMuted'}`}>Price</button>
            <button type="button" onClick={() => setScale('levels')} title="Levels keeps the entry, the stop, and the three targets on the scale." className={`h-6 px-2 rounded-full font-mono text-t11 ${scale === 'levels' ? 'bg-ink/10 text-textPrimary' : 'text-textMuted'}`}>Levels</button>
          </span>
        </div>
        <p className="px-3 pb-1 font-mono text-t11 text-textSecondary truncate pointer-events-none" data-chart-scale-why>
          {scale === 'price' ? 'Price lets the candles set the scale.' : 'Levels keeps the entry, the stop, and the three targets on the scale.'}
        </p>
        <div className="px-3 py-1 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0" data-readout-line>
          <ReadoutCell k="O" v={shown ? px2(shown.open) : '—'} />
          <ReadoutCell k="H" v={shown ? px2(shown.high) : '—'} />
          <ReadoutCell k="L" v={shown ? px2(shown.low) : '—'} />
          <ReadoutCell k={markWord} v={px2(markPx)} />
          <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 min-w-0">
            <ReadoutCell k="Day" v={series ? `${px2(series.low)}–${px2(series.high)}` : '—'} />
            <ReadoutCell k="Vol" v={volume > 0 ? count(volume) : '—'} />
            <ReadoutCell k={spotName} v={spot > 0 ? px2(spot) : '—'} />
          </span>
        </div>
        <div className="px-3 pb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <span className="inline-flex items-baseline gap-1.5 shrink-0" data-today-pct={Number.isFinite(today) ? today.toFixed(1) : ''}>
            <span className={`font-mono text-t16 font-semibold tnum leading-none ${!Number.isFinite(today) ? 'text-textMuted' : today >= 0 ? 'text-bull' : 'text-bear'}`}>{todayWord}</span>
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Today</span>
          </span>
          <span className="inline-flex items-baseline gap-1.5 shrink-0" data-live-pct={Number.isFinite(up) ? up.toFixed(1) : ''}>
            <span className={`font-mono text-t16 font-semibold tnum leading-none ${!Number.isFinite(up) ? 'text-textMuted' : up >= 0 ? 'text-bull' : 'text-bear'}`}>{upWord}</span>
            <span className="font-mono text-t11 uppercase tracking-wider text-textMuted">Call</span>
          </span>
          <span className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-1 min-w-0">
            <LevelCell k="Entry" v={book.entryPremium > 0 ? px2(book.entryPremium) : '—'} pip="bg-warn" />
            <LevelCell k="Stop" v={stopPx > 0 ? px2(stopPx) : '—'} pip="bg-bear" />
            <LevelCell k="TP1" v={sellAt > 0 ? px2(sellAt) : '—'} pip="bg-[#30D158]" />
            <LevelCell k="TP2" v={tp2 > 0 ? px2(tp2) : '—'} pip="bg-[#64D2FF]" />
            <LevelCell k="TP3" v={tp3 > 0 ? px2(tp3) : '—'} pip="bg-[#BF5AF2]" />
          </span>
        </div>
      </div>
    </div>
  );
};

export default ContractTrack;
