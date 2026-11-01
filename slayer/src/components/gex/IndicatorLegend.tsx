import { CALL_WALL, PUT_WALL } from './palette';
/* The chart's built-in indicators, listed top left the standard way: the name, its inputs, its live values in its own
   ink (the bar under the crosshair, else the last bar), and on hover the eye, the settings and the remove. A physics
   read also wears its plain name and its CALCULATED / MODEL tag, and its context line (the regime, the band's width).
   The eye and the timeframe bands are the settings' (data/indicatorLooks.ts); a row that is not drawn stays, dimmed.
   With two or more rows a caret folds the list to one "N indicators" chip, the way the standard desks do, so a long
   list never sits over the candles; the fold is remembered per pane in this browser. */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Settings2, X } from 'lucide-react';
import { MismatchDirection, type IChartApi, type ISeriesApi, type SeriesType } from 'lightweight-charts';
import { INDICATOR_ITEMS, indicatorBlurb, physicsOf } from './indicatorItems';
import { INDICATOR_INKS, type ChartIndicators } from './StrikeChart';
import IndicatorSettings, { PhysicsTag } from './IndicatorSettings';
import { drawnOn, inkAt, inputOf, lookOf, setLook, useLooksRev } from '../../data/indicatorLooks';

/** The parts whose value the row prints, in order, and how */
const VALUE_PARTS: Partial<Record<keyof ChartIndicators, { part: string; fmt: (v: number) => string }[]>> = {
  bb: [{ part: 'upper', fmt: v => v.toFixed(2) }, { part: 'basis', fmt: v => v.toFixed(2) }, { part: 'lower', fmt: v => v.toFixed(2) }],
  vwapBands: [{ part: 'up1', fmt: v => v.toFixed(2) }, { part: 'dn1', fmt: v => v.toFixed(2) }],
  sideVwap: [{ part: 'call', fmt: v => v.toFixed(2) }, { part: 'put', fmt: v => v.toFixed(2) }],
  macd: [{ part: 'line', fmt: v => v.toFixed(2) }, { part: 'signal', fmt: v => v.toFixed(2) }, { part: 'hist', fmt: v => v.toFixed(2) }],
  harBand: [{ part: 'up', fmt: v => v.toFixed(2) }, { part: 'dn', fmt: v => v.toFixed(2) }],
  volShock: [{ part: 'strip', fmt: v => `×${v.toFixed(2)}` }],
  gammaRegime: [],
  effRatio: [{ part: 'line', fmt: v => v.toFixed(2) }],
  amihud: [{ part: 'line', fmt: v => v.toFixed(4) }],
  sessions: [],
};

/* The fold, per pane, kept in this browser */
const FOLD_KEY = 'slayer:legend-folded:v1';
function readFolds(): Record<string, boolean> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(FOLD_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
function writeFold(pane: string, folded: boolean): void {
  try {
    const all = readFolds();
    if (folded) all[pane] = true;
    else delete all[pane];
    localStorage.setItem(FOLD_KEY, JSON.stringify(all));
  } catch {
    /* private mode: the fold holds for this visit */
  }
}
const DEFAULT_PARTS = [{ part: 'line', fmt: (v: number) => v.toFixed(2) }];

interface Props {
  on: (keyof ChartIndicators)[];
  top: number;
  mins: number;
  chart: () => IChartApi | null;
  seriesOf: (id: string) => ISeriesApi<SeriesType> | undefined;
  /** Bumps when the bars move, so the last values re-read */
  tick: string | number;
  /** A physics read's context line */
  extras?: Partial<Record<keyof ChartIndicators, string>>;
  onRemove?: (key: keyof ChartIndicators) => void;
  /** On but not drawn here, and the short reason (the market's shock on the market itself) */
  idle?: Partial<Record<keyof ChartIndicators, string>>;
  /** A narrow pane: values only, no inputs or context line */
  narrow?: boolean;
  /** The pane the fold is remembered for */
  paneKey?: string;
  /** Px from the plot's left edge (past a drawing rail docked there); 12 by default */
  left?: number;
}

const IndicatorLegend = ({ on, top, mins, chart, seriesOf, tick, extras, idle, onRemove, narrow = false, paneKey = 'chart', left = 12 }: Props) => {
  useLooksRev();
  const [folded, setFolded] = useState(() => !!readFolds()[paneKey]);
  useEffect(() => setFolded(!!readFolds()[paneKey]), [paneKey]);
  const fold = (v: boolean) => {
    setFolded(v);
    writeFold(paneKey, v);
  };
  const [idx, setIdx] = useState<number | null>(null);
  const [editing, setEditing] = useState<keyof ChartIndicators | null>(null);
  useEffect(() => {
    const c = chart();
    if (!c) return;
    const fn = (p: { logical?: number | null }) => setIdx(p.logical == null ? null : Math.round(p.logical));
    c.subscribeCrosshairMove(fn);
    return () => {
      try {
        c.unsubscribeCrosshairMove(fn);
      } catch {
        /* chart already gone */
      }
    };
    /* re-subscribed as the bars move: a chart rebuilt under the legend is picked up on its next bar */
  }, [chart, tick]);
  const valueOf = (key: keyof ChartIndicators, part: string): number | null => {
    const s = seriesOf(`${key}:${part}`);
    if (!s) return null;
    try {
      const d = (idx == null ? s.dataByIndex(Number.MAX_SAFE_INTEGER, MismatchDirection.NearestLeft) : s.dataByIndex(idx)) as { value?: number } | null;
      return typeof d?.value === 'number' && Number.isFinite(d.value) ? d.value : null;
    } catch {
      return null;
    }
  };
  if (on.length === 0) return null;
  const foldable = on.length >= 2;
  const chip = 'pointer-events-auto inline-flex items-center gap-1 h-[20px] pl-1 pr-1.5 rounded bg-canvas/75 backdrop-blur-[2px] font-mono text-t10 text-textSecondary hover:text-textPrimary hover:bg-ink/[0.08] transition-colors';
  if (foldable && folded)
    return (
      <div className="absolute z-10 pointer-events-auto select-none" style={{ top, left }} aria-label="Indicators on this pane" data-indicator-legend data-legend-folded>
        <button type="button" onClick={() => fold(false)} aria-expanded={false} title="Show the indicators" className={chip} data-legend-fold>
          <ChevronDown className="w-3 h-3" aria-hidden />
          <span className="tnum">{on.length} indicators</span>
        </button>
      </div>
    );
  return (
    <>
      <div className="absolute z-10 flex flex-col items-start gap-[3px] pointer-events-auto select-none" style={{ top, left, maxWidth: `calc(100% - ${84 + left}px)` }} aria-label="Indicators on this pane" data-indicator-legend>
        {on.map(key => {
          const item = INDICATOR_ITEMS.find(i => i.key === key);
          if (!item) return null;
          const look = lookOf(key);
          const phys = physicsOf(key);
          const why = idle?.[key];
          const drawn = drawnOn(key, mins) && !why;
          const ink = inkAt(look.ink ?? INDICATOR_INKS[key], look.opacity ?? 1);
          /* a switch prints its name when on (the Sessions indicator's Tokyo London New York), a number its value */
          const inputs = (item.inputs ?? []).map(i => (i.kind === 'toggle' ? (inputOf(key, i) >= 1 ? i.title : '') : String(inputOf(key, i)))).filter(Boolean).join(' ');
          const vals = look.legendValues === false || !drawn ? [] : (VALUE_PARTS[key] ?? DEFAULT_PARTS).map(p => ({ part: p.part, v: valueOf(key, p.part), fmt: p.fmt }));
          const extra = !narrow && drawn ? extras?.[key] : undefined;
          return (
            <div
              key={key}
              className="group pointer-events-auto inline-flex items-center gap-1.5 min-h-[20px] max-w-full pl-1.5 pr-1 rounded bg-canvas/75 backdrop-blur-[2px] font-mono text-t105 leading-none"
              title={indicatorBlurb(item.hint)}
              data-legend-indicator={key}
              data-hidden={!drawn || undefined}
            >
              <span className="inline-block w-2 h-[3px] rounded-full shrink-0" style={{ background: key === 'gammaRegime' ? `linear-gradient(90deg,${CALL_WALL} 50%,${PUT_WALL} 50%)` : ink }} aria-hidden />
              <span className={`whitespace-nowrap ${drawn ? 'text-textPrimary' : 'text-textMuted'}`}>{item.label}</span>
              {phys && !narrow && <span className="whitespace-nowrap text-textMuted">{phys.plain}</span>}
              {phys && <PhysicsTag tag={phys.tag} />}
              {inputs && !narrow && <span className="text-textMuted whitespace-nowrap tnum">{inputs}</span>}
              {vals.map(x => (
                <span key={x.part} className="whitespace-nowrap tnum" style={{ color: x.v == null ? undefined : ink }}>
                  {x.v == null ? <span className="text-textMuted">∅</span> : x.fmt(x.v)}
                </span>
              ))}
              {extra && <span className="min-w-0 truncate text-textSecondary">{extra}</span>}
              {why && <span className="whitespace-nowrap text-textMuted text-t9 uppercase tracking-wider">{why}</span>}
              {!drawn && !why && !look.hidden && <span className="whitespace-nowrap text-textMuted text-t9 uppercase tracking-wider">off on this timeframe</span>}
              <span className="inline-flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                <button type="button" onClick={() => setLook(key, { hidden: !look.hidden })} aria-pressed={!!look.hidden} title={look.hidden ? 'Show it' : 'Hide it — it stays on the pane'} className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors" data-legend-eye>
                  {look.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
                <button type="button" onClick={() => setEditing(key)} title="Settings — inputs, style, visibility" className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors" data-legend-settings>
                  <Settings2 className="w-3 h-3" />
                </button>
                {onRemove && (
                  <button type="button" onClick={() => onRemove(key)} title={`Take ${item.label} off this pane`} className="p-0.5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors" data-legend-remove>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {foldable && (
          <button type="button" onClick={() => fold(true)} aria-expanded title="Fold the indicators to one line" className={`${chip} w-[22px] justify-center px-0`} data-legend-fold>
            <ChevronUp className="w-3 h-3" aria-hidden />
          </button>
        )}
      </div>
      {editing && <IndicatorSettings indicator={editing} onClose={() => setEditing(null)} />}
    </>
  );
};

export default IndicatorLegend;
