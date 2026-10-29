/*
  On a phone Pulse is one chart holding the window, carrying the symbol picker, compare and the toolbar the desk
  would.
*/

import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import ChartToolbar from '../../components/gex/ChartToolbar';
import CompareControl from '../../components/gex/CompareControl';
import { LiveSpot } from './tiles/parts';
import StrikeChart, { DEFAULT_INDICATORS, DEFAULT_OVERLAYS, type ChartIndicators, type ChartOverlays, type ChartStyle, type CompareEntry, type CompareMode } from '../../components/gex/StrikeChart';
import StrikeExposureBand, { type BandMetric } from '../../components/gex/StrikeExposureBand';
import TickerQuickPick from '../../components/gex/TickerQuickPick';
import { chartGround, useCandleThemeKey } from '../../components/gex/candleTheme';
import { FOCUS, alpha } from '../../components/gex/paletteInk';
import { useFocus, useFocusedStrike } from '../../context/FocusContext';
import { readDeskPrefs } from '../../data/deskPrefs';
import { buildExposureProfile } from '../../data/exposure';
import { buildPrints } from '../../data/gex';
import { levelsOf } from './tiles/derive';
import type { Timeframe } from '../../data/timeframe';
import type { MarketSnapshot } from '../../types/market';

/* Compare-line inks, blue leading like TradingView's; four slots */
/* No simulated prints are drawn; the live chart's flow markers come with the live tape (Terrain draws none either). */
const NO_PRINTS: [] = [];
const COMPARE_INKS = ['#5B9CF6', '#BBB2E8', '#EDE4CD', '#6BD3C7'];
const fmtFocus = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));

interface Props {
  snapshot: MarketSnapshot;
  revision: number;
  onPick: (ticker: string) => void;
}

const PhoneChart = ({ snapshot, revision, onPick }: Props) => {
  const ticker = snapshot.ticker;
  const [timeframe, setTimeframe] = useState<Timeframe>(() => readDeskPrefs().opensOn.timeframe ?? '1m');
  const [overlays, setOverlays] = useState<ChartOverlays>(DEFAULT_OVERLAYS);
  const [compares, setCompares] = useState<CompareEntry[]>([]);
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [indicators, setIndicators] = useState<ChartIndicators>(DEFAULT_INDICATORS);
  const [bandMetric, setBandMetric] = useState<BandMetric>('dex');
  const focus = useFocusedStrike(ticker);
  const { clearFocus } = useFocus();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const ground = chartGround(useCandleThemeKey());

  const addCompare = (t: string, mode: CompareMode) =>
    setCompares(cs => {
      if (cs.length >= 4 || cs.some(c => c.ticker === t) || t === ticker) return cs;
      const ink = COMPARE_INKS.find(i => !cs.some(c => c.ink === i)) ?? COMPARE_INKS[0];
      return [...cs, { ticker: t, mode, ink }];
    });
  const removeCompare = (t: string, mode: CompareMode) => setCompares(cs => cs.filter(c => !(c.ticker === t && c.mode === mode)));

  const levels = useMemo(() => levelsOf(snapshot), [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  const prints = useMemo(() => buildPrints(ticker, levels.spot), [ticker]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the docked band's book — built only while the band is drawn */
  const bandData = useMemo(() => (overlays.dexStrike ? buildExposureProfile(snapshot, '0DTE', 10) : null), [overlays.dexStrike, snapshot]);

  return (
    /* A COLUMN: the tape takes what the strip under it leaves */
    <div ref={bodyRef} className="relative h-full min-h-0 flex flex-col" style={{ background: 'rgb(var(--panel))' }} data-theme="dark" data-chart-ground={ground}>
      {/* ONE LINE THAT WRAPS UNDER THE SYMBOL — 40px on every control in the strip and in the menus it opens */}
      <div className="order-last shrink-0 z-10 w-full select-none flex flex-wrap items-center border-t border-borderSubtle px-3 py-2 gap-3 [&_button]:min-h-[40px]" style={{ background: 'rgb(var(--panel))' }} data-chart-chrome>
        <span className="inline-flex items-center gap-2">
          <TickerQuickPick ticker={ticker} onPick={onPick} />
          <CompareControl current={ticker} compares={compares} onAdd={addCompare} onRemove={removeCompare} />
        </span>
        <span className="w-px h-4 bg-borderSubtle shrink-0 mx-1.5" aria-hidden />
        <div className="flex-1 min-w-fit">
          <ChartToolbar minimal candles menuSide="top" compact dense menuBounds={bodyRef} spread timeframe={timeframe} onTimeframe={setTimeframe} overlays={overlays} onOverlays={setOverlays} chartStyle={chartStyle} onChartStyle={setChartStyle} indicators={indicators} onIndicators={setIndicators} paneId="pulse:main" alertTicker={ticker} alertSpot={levels.spot} />
        </div>
        {focus != null && (
          <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded border font-mono text-t9 uppercase tracking-widest animate-soft-in" style={{ color: FOCUS, borderColor: alpha(FOCUS, 0.4), background: alpha(FOCUS, 0.06) }}>
            Focus
            <span className="text-t11 font-bold tnum normal-case tracking-normal">{fmtFocus(focus)}</span>
            <button onClick={clearFocus} aria-label="Let go of the strike" title="Let go of the strike" className="inline-flex items-center justify-center w-4 h-4 rounded hover:bg-ink/[0.08] transition-colors">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
      </div>
      <div className="relative flex-1 min-h-0 flex flex-col">
        {/* the legend: name · interval · the live tick; the tape pans straight through it */}
        <div className="absolute left-2 top-2 z-10 pointer-events-none select-none flex flex-col gap-1 font-mono" data-chart-chrome>
          <div className="flex items-baseline gap-1.5">
            <span className="text-t11 font-semibold text-textPrimary">{ticker}</span>
            <span className="text-t10 text-textMuted" aria-hidden>
              ·
            </span>
            <span className="text-t10 text-textMuted">{timeframe}</span>
            <span className="text-t10 text-textMuted" aria-hidden>
              ·
            </span>
            <LiveSpot ticker={ticker} fallback={levels.spot} className="text-t11 font-semibold tnum text-textPrimary" />
          </div>
          {compares.map(c => (
            <div key={`${c.ticker}:${c.mode}`} className="flex items-center gap-1.5">
              <span className="w-2 h-[3px] rounded-full" style={{ background: c.ink }} aria-hidden />
              <span className="text-t10 font-semibold" style={{ color: c.ink }}>
                {c.ticker}
              </span>
              <LiveSpot ticker={c.ticker} className="text-t10 tnum text-textSecondary" />
              <button onClick={() => removeCompare(c.ticker, c.mode)} aria-label={`Remove ${c.ticker} comparison`} title="Remove comparison" className="pointer-events-auto inline-flex items-center justify-center w-4 h-4 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors">
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
        <div key={ticker} className="min-h-0 flex-1 animate-soft-in-slow">
          <StrikeChart ticker={ticker} paneId="pulse:main" revision={revision} flowPrints={NO_PRINTS} levels={levels} timeframe={timeframe} overlays={overlays} prints={prints} compares={compares} chartStyle={chartStyle} indicators={indicators} focusPrice={focus} height={180} compact frameless />
        </div>
        {bandData && <StrikeExposureBand data={bandData} metric={bandMetric} onMetric={setBandMetric} plotHeight={48} onClose={() => setOverlays(o => ({ ...o, dexStrike: false }))} />}
      </div>
    </div>
  );
};

export default PhoneChart;
