/* The contract's premium chart. One pane. High, low, and last are the candles on this chart, not a second book. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import type { UTCTimestamp } from 'lightweight-charts';
import { TimeframeStrip } from '../gex/ChartToolbar';
import { chartGround, chartSurface, getCandleTheme, useCandleThemeKey } from '../gex/candleTheme';
import { resolveInk } from '../gex/paletteInk';
import ContractPremiumPane from '../gex/ContractPremiumPane';
import ContractPick, { type ConPickRow } from './ContractPick';
import { quoteContract, type ContractQuote } from '../../data/contractQuote';
import { underWord } from '../../data/compassSession';
import type { Timeframe } from '../../data/timeframe';
import type { OptionRight, Setup } from '../../types/compass';
import type { SetupMarks } from './setupMarksPrimitive';

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
  traded?: { time: number; open: number; high: number; low: number; close: number }[] | null;
  /** Why the session's chart is empty. Blank when the tape itself has not loaded. */
  emptyNote?: string;
  /** Set when the candles are the premium off the stock, not prints. */
  pathNote?: string;
  /** The exits drawn, as multiples of the entry (the late sweep sells at 2× and 3×) */
  multiples?: number[];
}

const px2 = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const count = (n: number) => Math.round(n).toLocaleString('en-US');

/** The index under a weekly root. A stock keeps its own name. Nasdaq is not stamped on until that feed is the price. */
const SPOT_NAME: Record<string, string> = { SPX: 'SPX', SPXW: 'SPX', XSP: 'SPX', RUT: 'RUT', RUTW: 'RUT', VIX: 'VIX' };

const ReadoutCell = ({ k, v }: { k: string; v: string }) => (
  <span className="shrink-0 whitespace-nowrap">
    <span className="font-mono text-t9 uppercase tracking-wider text-textMuted">{k}</span>
    <span className="ml-1 font-mono text-t10 tnum text-textPrimary">{v}</span>
  </span>
);

const ContractTrack = ({
  setup,
  revision,
  spot = 0,
  fullscreen = false,
  onToggleFullscreen,
  loadPickRows,
  onOpenContract,
  quotedAt = 0,
  volume = 0,
  timeframe: timeframeProp,
  onTimeframe,
  quote: cardQuote,
  traded,
  emptyNote = '',
  pathNote = '',
  multiples = [1.5, 2, 3],
}: ContractTrackProps) => {
  const [localTf, setLocalTf] = useState<Timeframe>('1m');
  const timeframe = timeframeProp ?? localTf;
  const setTimeframe = onTimeframe ?? setLocalTf;
  const themeKey = useCandleThemeKey();
  const tapeRef = useRef<HTMLDivElement | null>(null);
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const [topMargin, setTopMargin] = useState(0.18);
  const [bar, setBar] = useState<{ open: number; high: number; low: number; close: number } | null>(null);

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
  const tps = multiples.map((mult, i) => ({ level: i + 1, price: Number((book.entryPremium * mult).toFixed(2)) }));

  const framePrices = useMemo(
    () => [book.entryPremium, book.stopPremium, ...tps.map(t => t.price)].filter(p => p > 0 && p <= book.entryPremium * 1.7),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [book.entryPremium, book.stopPremium],
  );

  const marks = useMemo<SetupMarks>(() => {
    const surface = chartSurface(getCandleTheme());
    const host = tapeRef.current;
    const lastT = (traded && traded.length ? traded[traded.length - 1].time : Math.floor(Date.now() / 1000)) as UTCTimestamp;
    return {
      entry: { time: lastT, price: book.entryPremium, mid: book.mark },
      entryWord: 'ASK',
      /* no stop, no line (the late sweep holds without one) */
      floor: book.stopPremium > 0 ? { price: book.stopPremium, brokeAt: null } : null,
      targets: tps.map(t => ({ level: t.level, price: t.price, won: false })),
      silver: resolveInk('rgb(var(--silver))', host),
      bg: surface.bg,
      bull: resolveInk('rgb(var(--bull))', host),
      bear: resolveInk('rgb(var(--bear))', host),
      ink: resolveInk('rgb(var(--text-primary))', host),
      hot: null,
      insetTop: 48,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup.ticker, book.entryPremium, book.stopPremium, book.mark, themeKey, traded, multiples.join('|')]);

  return (
    <div
      ref={tapeRef}
      className="relative h-full min-h-[280px] overflow-hidden border border-borderSubtle rounded-md bg-panel"
      data-premium-track
      data-setup-chart="premium"
      data-stock-pane="off"
      data-option-entry={book.entryPremium}
      data-option-stop={book.stopPremium}
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
        rules={false}
        marks={marks}
        spot={spot}
        framePrices={framePrices}
        topMargin={topMargin}
        bound
        traded={traded}
        onBar={setBar}
      />
      <div ref={chromeRef} className="absolute top-0 inset-x-0 z-20" data-chart-chrome>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-2 pr-3 py-1.5 select-none">
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
          <TimeframeStrip value={timeframe} onChange={setTimeframe} only={['1m', '5m', '15m', '30m', '1h', '1D']} />
          {onToggleFullscreen && (
            <button type="button" onClick={onToggleFullscreen} className="slayer-chip px-2 ml-auto" data-premium-full>
              {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
        <div className="h-[23px] flex items-center gap-2.5 px-3 pointer-events-none overflow-hidden" data-readout-line>
          <ReadoutCell k="O" v={shown ? px2(shown.open) : '—'} />
          <ReadoutCell k="H" v={shown ? px2(shown.high) : '—'} />
          <ReadoutCell k="L" v={shown ? px2(shown.low) : '—'} />
          <ReadoutCell k={markWord} v={px2(markPx)} />
          {traded && traded.length === 0 && <span className="min-w-0 truncate font-mono text-t10 text-textMuted">{emptyNote || 'No print on the tape'}</span>}
          {traded == null && !pathNote && <span className="min-w-0 truncate font-mono text-t10 text-textMuted">Not on the tape</span>}
          {pathNote && <span className="min-w-0 truncate font-mono text-t10 text-textMuted">{pathNote}</span>}
          <span className="ml-auto flex items-center gap-2.5 min-w-0 max-sm:hidden">
            <ReadoutCell k="High" v={series ? px2(series.high) : '—'} />
            <ReadoutCell k="Low" v={series ? px2(series.low) : '—'} />
            <ReadoutCell k="Vol" v={volume > 0 ? count(volume) : '—'} />
            <ReadoutCell k={spotName} v={spot > 0 ? px2(spot) : '—'} />
            <ReadoutCell k="Tape" v={underWord(setup.ticker)} />
          </span>
        </div>
      </div>
    </div>
  );
};

export default ContractTrack;
