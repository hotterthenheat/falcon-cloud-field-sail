/*
==================================================
  SLAYER TERMINAL - CHART TOOLBAR
  The big chart's control strip: timeframes, an
  Overlays multi-select (every layer independent),
  the candle theme, and fullscreen takeover. Compact
  dropdowns, terminal grammar.
==================================================
*/

import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMarketData } from '../../context/MarketDataContext';
import ThemePreview from './ThemePreview';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from '../ui/useAnchoredMenu';
import { motion } from 'framer-motion';
import {
  Activity,
  CandlestickChart,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Fullscreen,
  Grid2x2,
  Layers,
  Camera,
  Maximize2,
  Minimize2,
  Palette,
  Play,
  Star,
  Pin,
  PanelsTopLeft,
  CodeXml,
} from 'lucide-react';
import SlowTip from '../ui/SlowTip';
import { useHoverOpen } from '../ui/useHoverOpen';
import { toggleTfFavourite, useTfFavourites } from '../../data/tfFavourites';
import { toggleBarPin, useBarPins } from '../../data/barPins';
import { TIMEFRAMES, frameServed, type Timeframe } from '../../data/timeframe';
import { TREND_GLYPH, type TrendState } from '../../data/confluence';
import {
  CANDLE_THEMES,
  CANDLE_THEME_OPTIONS,
  setCandleTheme,
  useCandleThemeKey,
  type CandleTheme,
  type CandleThemeKey,
} from './candleTheme';
import {
  CHART_STYLES,
  INDICATOR_INKS,
  MAX_SUB_PANES,
  PRICE_SCALES,
  SUB_PANE_ORDER,
  type ChartIndicators,
  type ChartOverlays,
  type ChartStyle,
  type PriceScale,
} from './StrikeChart';
import { INDICATOR_ITEMS, indicatorBlurb } from './indicatorItems';
import { NODE_ALERT_PCTS, NODE_LOOKS, setDeskPrefs, useDeskPrefs, type FlowFilters } from '../../data/deskPrefs';
import { FLOW_CHIPS } from '../../data/flowBuckets';
/* The scripts library loads the first time its menu opens, not with every chart */
const ScriptLibrary = lazy(() => import('../scripts/ScriptLibrary'));
import { usePaneScripts } from '../../data/paneScripts';
import AlertsMenu from './AlertsMenu';
import { useAlerts } from './alertStore';
import JingleBell from '../ui/JingleBell';
import { BAR_CLOCKS } from '../../data/altBars';
import { MENU_EDGE, type MenuSide } from '../ui/menuPlacement';
import { OPENING_RANGES, type OpeningRange } from '../../data/sessionLevels';
import { copySnapshot, openSnapshot, saveSnapshot, snapshotBlob } from './snapshot';

interface ChartToolbarProps {
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  /** Only these intervals — a chart whose tape cannot make one must not offer it (Review's backtest replays one-minute
      bars: no 15s; and a year of them is too few weeks for a weekly) */
  timeframes?: Timeframe[];
  /** the trend each timeframe is in, for the glyph on its pill (TimeframeStrip) */
  trend?: TrendByTf;
  overlays: ChartOverlays;
  onOverlays: (next: ChartOverlays) => void;
  /** Minimal mode: timeframes + overlays only (expanded flow-board charts). */
  minimal?: boolean;
  /** Adds the candle-theme dropdown back in minimal mode (4-way board cells). */
  candles?: boolean;
  /** Restrict the Overlays menu to these keys — a chart that can't draw a
      layer must not offer its toggle (campaign map: levels + volume only). */
  overlayKeys?: (keyof ChartOverlays)[];
  /** Restrict the Indicators menu the same way: a tape that is not the name's price (an option contract's premium) has
      no book to weight by, so "From the book" is not offered on it. */
  indicatorKeys?: (keyof ChartIndicators)[];
  /** Expected move is one overlay. Its horizon lives in that menu, not on the desk. */
  coneHorizon?: 'session' | 'week' | 'next';
  onConeHorizon?: (next: 'session' | 'week' | 'next') => void;
  trailGreek?: 'gex' | 'dex' | 'vex';
  onTrailGreek?: (next: 'gex' | 'dex' | 'vex') => void;
  /** Span the full width: timeframes pinned left, every other control pushed
      right (fullscreen stays last, so it lands furthest right). The divider
      becomes the invisible spacer that does the pushing. */
  spread?: boolean;
  /**
   * EVERY CONTROL AT ITS SMALLEST — for a strip that has to fit a phone.
   *
   * Two changes, and both are about line count rather than taste. The seven
   * timeframe buttons collapse into one trigger that opens them as a menu:
   * they need 251px laid out, which is most of a 390px screen and the single
   * biggest reason the strip wrapped. And every dropdown drops its word for
   * its icon, keeping the word as the hover/AT name — the same trade
   * `vertical` already makes for a side-docked toolbox.
   *
   * Measured at 390px: a 218px strip before, 75px after. (The phone host then
   * spends some of that back on 40px touch targets, landing at 105px — still
   * an eighth of the screen where the first attempt took a quarter.)
   */
  compact?: boolean;
  /** THE INTERVALS STAY BUTTONS in a compact strip — one press from any other, TradingView's way (the desks, 2026-09-22:
      "you can change timeframes easily"); compact then only sheds the dropdowns' words */
  keepIntervals?: boolean;
  /**
   * THE SMALL MENUS — for a DOCKED pane (Noah, 2026-09-13, three menus open
   * over a two-up Terrain desk: "on non full screen views be sure to make
   * this dropdown boxes smaller"). Every row is one line with its sentence
   * as the hover name; the price scale and the bar clock are one row of
   * chips each (the Opening range's grammar); the Theme menu is the list
   * alone — the 620px preview card is fullscreen's. The controls are the
   * same, only the room they take. Off by default: the Weigher's card and a
   * takeover keep the full menus.
   */
  dense?: boolean;
  /**
   * THE PANE'S BOX — every menu this strip opens stays inside it (Noah,
   * 2026-09-13, the right-hand pane's menus hanging into the left one:
   * "aren't in their section"), and the dense Theme menu sizes its preview to
   * fit it. A host on a desk of several panes passes its own box; a chart
   * that owns the screen or a card can leave it out, and the window bounds
   * the menus as before.
   */
  menuBounds?: RefObject<HTMLElement | null>;
  /** Stack the strip top-to-bottom — the floating toolbox docked to a side
      edge (Noah, 2026-08-23). Ignores `spread`. */
  vertical?: boolean;
  /** Which side the dropdown menus open toward — a side-docked toolbox has
      no room below itself. */
  menuSide?: MenuSide;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  replay?: boolean;
  onToggleReplay?: () => void;
  /** The tape's SHAPE (candles/bars/line/…) — TradingView's picker, distinct
      from the color theme (Noah, 2026-08-23) */
  chartStyle?: ChartStyle;
  onChartStyle?: (s: ChartStyle) => void;
  /** Indicator overlays — EMAs, VWAP */
  indicators?: ChartIndicators;
  onIndicators?: (next: ChartIndicators) => void;
  /** THE SCRIPT LIBRARY'S DOOR (2026-09-10): the pane this toolbar drives.
      Given, the Indicators control opens the library — the Slayer scripts,
      the technicals in Pine, the chart's own tools and the reader's scripts,
      with a count of what is on this pane. Absent, the old menu of built-ins. */
  paneId?: string;
  /** The main price scale's mode — linear / log / percent / indexed (T-7) */
  priceScale?: PriceScale;
  onPriceScale?: (s: PriceScale) => void;
  /*
    SOMETHING ELSE ON THE TAPE IS HOLDING THE AXIS, and what.

    A `%` comparison rides the main right scale, so the axis has to be in
    percent for the two lines to be comparable at all — the reader's pick
    cannot win while one is up. Handed in rather than inferred here, from the
    ONE place that decides it (`priceScaleLockedBy`), so this menu can never
    report a mode the chart is not actually drawing.

    A control that silently does nothing is the thing this desk keeps ruling
    out; a control that SAYS why it is held is the alternative.
  */
  priceScaleLock?: { mode: PriceScale; reason: string } | null;
  /** Which opening range the session-levels overlay draws — T-6. Rendered as
      a choice ON that overlay's own row, so it is where the thing it changes
      is rather than in a menu of its own. */
  sessionOr?: OpeningRange;
  onSessionOr?: (o: OpeningRange) => void;
  /* Shows the Alerts menu. Both are needed: the symbol the alerts belong to,
     and where the market is — which fixes the side a new alert has to be
     crossed from, and seeds the box near the price rather than at zero. */
  /* The Alerts door, WIRED (Noah, 2026-08-28 — the blank-shell rule is
     retired; the cooking is done). It takes the symbol and the spot so an
     alert it arms is bound to a real name at a real price. The bell wears a
     count of firings not yet looked at; opening the menu clears it. */
  alertTicker?: string;
  alertSpot?: number;
  /** Mode 3 (Noah, 2026-08-23): TOTAL fullscreen — the taskbar itself goes
      away and only Esc brings it back. TradingView's corner-bracket icon. */
  onTotalFullscreen?: () => void;
  /** Opens the 4-way board page — four charts, each with its own controls. */
  /** T-23 — export this pane as a PNG (levels, drawings, watermark). Lives
      in the Candles menu: a menu row costs no toolbar width, and the strip's
      one-row budget is measured to the pixel. */
  onExportPng?: () => void;
  /** T-15 — the bar CLOCK: 'time', or a range/volume key from
      data/altBars.ts's BAR_CLOCKS. Same width budget as T-23: a section in
      the Candles menu, not a trigger of its own. */
  barClock?: string;
  onBarClock?: (key: string) => void;
  /* PER-PANE CANDLE THEME (Noah, 2026-08-25: "if i change the theme for 1
     chart it should NOT change for all the others"). Ours, kept through the
     port — unwired callers keep following the app-wide store. */
  themeKey?: CandleThemeKey;
  onThemeKey?: (key: CandleThemeKey) => void;
  /** What rides the strip RIGHT AFTER THE INTERVALS, a hairline before it — a desk's full screen puts its RP&L and UP&L
      there (Noah, 2026-09-22: "put the p and l buttons in between timeframes and the indicator button on the top … on full
      screen of course"). A spread strip's gap starts after it, so a top-docked rail still centres in what is left. */
  afterIntervals?: ReactNode;
  /** THE LESSER CONTROLS A HOST BRINGS (2026-10-17): rendered in the right cluster after Alerts — Terrain's link chip
      and its Compare door live here since the "+" beside the symbol opens tabs */
  rightExtras?: ReactNode;
  /** THE CAMERA (Noah, 2026-10-18, TradingView's): the host hands back the pane's picture; the menu saves it, copies it
      or opens it in a new tab */
  onSnapshot?: () => Promise<HTMLCanvasElement | null> | HTMLCanvasElement | null;
  snapshotName?: string;
  /** THE TICKER BAR'S TALL FORM (ported from the partner tree, 2026-11-01 — openmarket's row, measured there): Terrain's
      44px bar under the tab strip carries the active pane's controls — the timeframes as a tray with its favourites and
      chevron menu, 28px triggers, the right cluster as 32px squares (the word on the slow hover, ui/SlowTip), the
      pinned panels and the PANELS door; Replay and fullscreen leave the row (Replay is a Panels row, the pane's corner
      chip is the fullscreen door). The row never wraps. */
  tall?: boolean;
  /** What stands right after the left cluster on the tall bar — Terrain's layout door, openmarket's order */
  afterLeft?: ReactNode;
  /** THE PANELS (the tall bar only): every side panel and tool the host offers, in sections — the Panels door lists them
      with a pin beside each, and the pinned ones stand on the bar (data/barPins.ts) */
  panels?: BarPanel[];
  /** The fullscreen takeover's row: the timeframe tray and the Indicators door, nothing else */
  takeover?: boolean;
}

const TIMEFRAME_OPTIONS = TIMEFRAMES.map(t => ({ value: t.value, label: t.label }));

const INTERVAL_GROUPS = [
  { id: 'minute' as const, label: 'Minutes' },
  { id: 'hour' as const, label: 'Hours' },
  { id: 'day' as const, label: 'Days' },
];

/** The interval list: minutes, hours, then date frames. A star pins a row onto the strip. */
function IntervalMenu({
  value,
  onChange,
  pins,
  onPin,
  trend,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  pins: readonly Timeframe[];
  onPin: (tf: Timeframe) => void;
  trend?: TrendByTf;
}) {
  return (
    <div role="group" aria-label="Timeframe" className="min-w-[220px] py-1">
      {INTERVAL_GROUPS.map(g => (
        <div key={g.id}>
          <div className="px-3 pt-2 pb-1 font-mono text-t9 uppercase tracking-wider text-textMuted">{g.label}</div>
          {TIMEFRAMES.filter(t => t.group === g.id).map(opt => {
            const active = opt.value === value;
            const served = frameServed(opt.value);
            const pinned = pins.includes(opt.value);
            const state = trend && opt.value in trend ? trend[opt.value] ?? null : undefined;
            const held = served ? undefined : `${opt.menu} is not on this feed yet`;
            return (
              <div key={opt.value} className={`flex items-center ${active ? 'bg-ink/[0.06]' : served ? 'hover:bg-ink/[0.03]' : ''}`}>
                <button
                  type="button"
                  aria-pressed={active}
                  aria-disabled={!served}
                  title={held}
                  onClick={() => {
                    if (served) onChange(opt.value);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left font-mono text-t11 ${active ? 'text-textPrimary' : served ? 'text-textSecondary' : 'cursor-default text-textMuted opacity-45'}`}
                >
                  <Check className={`h-3 w-3 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
                  <span className="truncate">{opt.menu}</span>
                  {state !== undefined && <TrendGlyph state={state} />}
                </button>
                {served && (
                <button
                  type="button"
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${opt.menu}` : `Pin ${opt.menu}`}
                  title={pinned ? 'On the strip' : 'Pin to the strip'}
                  onClick={() => onPin(opt.value)}
                  className={`mr-1.5 grid h-6 w-6 place-items-center rounded ${pinned ? 'text-textPrimary' : 'text-textMuted hover:text-textPrimary'}`}
                >
                  <Star className={`h-3 w-3 ${pinned ? 'fill-current' : ''}`} aria-hidden />
                </button>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Bare timeframe strip — floating labels, no box, no dividers. The active
    one earns a BUBBLE (Noah, 2026-08-23): a fully-round chip that springs
    from timeframe to timeframe as one continuous piece, stretching to each
    label's width on the way. layoutId is namespaced per strip — the 4-way
    board mounts four of these and the bubbles must not jump between cells. */
/** The trend a timeframe is in, for the glyph on its pill — the confluence's five (data/confluence.ts); a timeframe
    not in the map wears no glyph, one with too little history a dash */
export type TrendByTf = Partial<Record<Timeframe, TrendState | null>>;

/** THE ARROW RIDES THE PILL (Noah, 2026-10-17: "the arrows should be on the actual timeframe change buttons"): the
    confluence's read for a timeframe, as a small glyph after its label — up in the bull ink, down in the bear, flat
    muted, no view a dash. The title says it in words. */
const TrendGlyph = ({ state }: { state: TrendState | null }) => (
  <span aria-hidden className={`text-t8 leading-none ${state === 'up' ? 'text-bull' : state === 'down' ? 'text-bear' : 'text-textMuted'}`} data-tf-trend={state ?? 'none'}>
    {state === null ? '–' : TREND_GLYPH[state]}
  </span>
);
const trendTitle = (label: string, state: TrendState | null | undefined): string | undefined =>
  state === undefined ? undefined : state === null ? `${label} — too little history for a trend yet` : state === 'flat' ? `${label} — flat` : `${label} — trending ${state}`;

export const TimeframeStrip = ({
  value,
  onChange,
  vertical = false,
  only,
  trend,
}: {
  value: Timeframe;
  onChange: (tf: Timeframe) => void;
  vertical?: boolean;
  only?: Timeframe[];
  trend?: TrendByTf;
}) => {
  const uid = useId();
  const options = (only ? TIMEFRAME_OPTIONS.filter(o => only.includes(o.value)) : TIMEFRAME_OPTIONS).filter(o => frameServed(o.value));
  return (
    <div
      role="group"
      aria-label="Timeframe"
      /* flex-wrap: a flex ITEM wider than its line does not split, it SPILLS,
         and the page starts scrolling sideways. Seven timeframes need 251px
         and a 390px screen gives the rail 213 once Terrain's layout picker is
         beside it. Wrapping changes nothing at any width where they already
         fit. */
      className={`inline-flex gap-0.5 ${vertical ? 'flex-col items-stretch' : 'flex-wrap items-center'}`}
    >
      {options.map(opt => {
        const active = opt.value === value;
        const state = trend && opt.value in trend ? trend[opt.value] ?? null : undefined;
        return (
          <button
            key={opt.value}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            title={trendTitle(opt.label, state)}
            className={`relative px-2 py-1 rounded-full font-mono text-t11 transition-colors ${
              active
                ? 'text-textPrimary font-semibold'
                : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.03]'
            }`}
            data-tf={opt.value}
          >
            {active && (
              <motion.span
                layoutId={`tf-bubble-${uid}`}
                className="absolute inset-0 rounded-full bg-ink/[0.10]"
                transition={{ type: 'spring', stiffness: 480, damping: 28 }}
                aria-hidden
              />
            )}
            <span className="relative inline-flex items-baseline gap-1">
              {opt.label}
              {state !== undefined && <TrendGlyph state={state} />}
            </span>
          </button>
        );
      })}
    </div>
  );
};

/* ---- THE TIMEFRAME TRAY (the tall bar, ported from the partner tree 2026-11-01) --------------------------------
   openmarket's, measured there: 32px, padding 2, a 1px gap, radius 8, a faint ground; the rungs 28px at 12px/500 with
   10px sides, radius 6; THE ONE IN HAND IS ITS INK ALONE on the dark tray (a 10% pill on paper, index.css); the chevron
   22 wide, opening ON THE HOVER (ui/useHoverOpen) and on a press. The menu: 168 wide, sections by unit under 10px bold
   heads that fold on a press, 30px rows with the whole word, the one in hand inverted on the dark menu, a star at the
   row's end on its hover — silver when starred. A starred row lands on the tray with the menu still open. */
const UNIT_OF: Record<string, string> = { minute: 'Minutes', hour: 'Hours', day: 'Days' };
const unitOf = (tf: Timeframe): string => UNIT_OF[TIMEFRAMES.find(t => t.value === tf)?.group ?? ''] ?? 'Seconds';
const wordOf = (tf: Timeframe): string => TIMEFRAMES.find(t => t.value === tf)?.menu ?? (tf === '15s' ? '15 seconds' : tf);
/* a folded unit stays folded while the app runs */
const foldedUnits = new Set<string>();
const TF_MENU_W = 168;

const TimeframeRows = ({ value, options, trend, onPick }: { value: Timeframe; options: { value: Timeframe; label: string }[]; trend?: TrendByTf; onPick: (tf: Timeframe) => void }) => {
  const favourites = useTfFavourites();
  const [, bump] = useState(0);
  const units: string[] = [];
  for (const o of options) if (!units.includes(unitOf(o.value))) units.push(unitOf(o.value));
  return (
    <div role="group" aria-label="Timeframe" data-tf-rows>
      {units.map((unit, ui) => {
        const folded = foldedUnits.has(unit);
        return (
          <div key={unit} className={ui > 0 ? 'mt-1.5 pt-1.5 border-t border-borderSubtle/70' : ''} data-tf-section={unit} data-folded={folded || undefined}>
            <button
              type="button"
              onClick={() => {
                if (folded) foldedUnits.delete(unit);
                else foldedUnits.add(unit);
                bump(n => n + 1);
              }}
              aria-expanded={!folded}
              className="flex items-center justify-between w-full h-6 px-2.5 rounded-md font-mono text-t10 font-bold uppercase tracking-[0.06em] text-textMuted hover:text-textSecondary transition-colors duration-100"
              data-tf-section-head
            >
              <span>{unit}</span>
              <ChevronDown className={`w-3 h-3 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${folded ? '' : 'rotate-180'}`} aria-hidden />
            </button>
            {!folded &&
              options
                .filter(o => unitOf(o.value) === unit)
                .map(opt => {
                  const active = opt.value === value;
                  const fav = favourites.includes(opt.value);
                  return (
                    <div
                      key={opt.value}
                      role="button"
                      tabIndex={0}
                      aria-pressed={active}
                      onClick={() => onPick(opt.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onPick(opt.value);
                        }
                      }}
                      className={`tf-row group flex items-center justify-between gap-3 h-[30px] px-2.5 rounded-lg cursor-pointer text-t13 transition-colors duration-100 ${
                        active ? 'tf-row-on font-medium' : 'text-textSecondary'
                      }`}
                      data-tf-row={opt.value}
                    >
                      <span title={trendTitle(opt.label, trend && opt.value in trend ? trend[opt.value] ?? null : undefined)}>{wordOf(opt.value)}</span>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          toggleTfFavourite(opt.value);
                        }}
                        aria-pressed={fav}
                        aria-label={fav ? `Take ${opt.label} off the strip` : `Keep ${opt.label} on the strip`}
                        title={fav ? 'On the strip — press to take it off' : 'Keep it on the strip'}
                        className={`shrink-0 inline-flex items-center justify-center w-[18px] h-4 rounded transition-[color,opacity,background-color] duration-150 hover:bg-ink/[0.06] ${
                          fav ? 'opacity-100 text-silver' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-textMuted hover:text-textPrimary'
                        }`}
                        data-tf-star={opt.value}
                        data-on={fav || undefined}
                      >
                        <Star className="w-3 h-3" strokeWidth={1.5} fill={fav ? 'currentColor' : 'none'} />
                      </button>
                    </div>
                  );
                })}
          </div>
        );
      })}
    </div>
  );
};

const TimeframeTray = ({ value, onChange, trend, bounds }: { value: Timeframe; onChange: (tf: Timeframe) => void; trend?: TrendByTf; bounds?: RefObject<HTMLElement | null> }) => {
  const options = TIMEFRAME_OPTIONS.filter(o => frameServed(o.value));
  const favourites = useTfFavourites();
  const pinned = options.filter(o => favourites.includes(o.value) || o.value === value);
  const [more, setMore] = useState(false);
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(more, 'bottom', TF_MENU_W, 'start', bounds);
  const hover = useHoverOpen(true, setMore, menuRef);
  useEffect(() => {
    if (!more) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMore(false);
    };
    /* capture: the innermost thing open takes Escape — the desk behind would close its pane on the same key */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMore(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [more, anchorRef, menuRef]);
  return (
    <div role="group" aria-label="Timeframe" className="shrink-0 inline-flex items-center h-8 p-0.5 gap-px rounded-lg bg-ink/[0.04]" data-tf-strip={pinned.length} data-tf-tall="">
      {pinned.map(opt => {
        const active = opt.value === value;
        const state = trend && opt.value in trend ? trend[opt.value] ?? null : undefined;
        return (
          <button
            key={opt.value}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            title={trendTitle(opt.label, state)}
            className={`relative inline-flex items-center h-7 px-2.5 rounded-md font-mono text-t12 font-medium transition-colors duration-200 ${active ? 'text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}
            data-tf={opt.value}
          >
            {opt.label}
          </button>
        );
      })}
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setMore(m => !m)}
        {...hover.trigger}
        aria-haspopup="menu"
        aria-expanded={more}
        aria-label="Every timeframe — star the ones to keep on the strip"
        className={`inline-flex items-center justify-center w-[22px] h-7 rounded-md transition-colors duration-200 ${more ? 'text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}
        data-tf-more
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${more ? 'rotate-180' : ''}`} />
      </button>
      {more &&
        placed &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Every timeframe"
            style={{ position: 'fixed', ...placed.box, width: TF_MENU_W }}
            {...hover.menu}
            className="tf-menu z-[120] p-1.5 rounded-xl border border-borderMuted shadow-xl shadow-black/25 overflow-y-auto overscroll-contain animate-fade-in"
            data-tf-menu
            data-toolbar-menu=""
          >
            <TimeframeRows
              value={value}
              options={options}
              trend={trend}
              onPick={tf => {
                onChange(tf);
                setMore(false);
              }}
            />
          </div>,
          document.body
        )}
    </div>
  );
};

/* ---- THE PANELS MENU (the tall bar, ported from the partner tree 2026-11-01) -----------------------------------
   openmarket's Panels door measured there: a card in two columns, sections under 10px bold uppercase heads, 32px rows —
   a 24px glyph box with a 14px icon, the name at 12.5px medium, the keys as 20px capsules, a 24px pin at the end
   (filled when set) — the row in use on the lifted ground, a blocked row dimmed with its reason. The pin puts the row
   on the bar as a 32px icon button; the row itself opens or closes the room. Ours lists OUR rooms. */
export type BarPanelSection = 'tools' | 'book' | 'tape' | 'news' | 'lists' | 'yours';
export interface BarPanel {
  id: string;
  label: string;
  /** a lucide icon with no size class — the bar and the menu size it */
  icon: ReactNode;
  section: BarPanelSection;
  /** the room is up (replaying, the rail shown, the drawer open…) */
  on?: boolean;
  /** the hotkey, as its key caps */
  keys?: string[];
  press: () => void;
  /** the press leaves the bar (a drawer, a dialog, the takeover): the menu closes with it */
  closes?: boolean;
  /** why it cannot be pressed now — printed on the row, the row dimmed */
  blocked?: string;
}
const PANEL_SECTIONS: Record<BarPanelSection, string> = { tools: 'Tools', book: 'The book', tape: 'The tape', news: 'News', lists: 'Lists', yours: 'Yours' };
/* three blocks of two columns — a section with no rows draws nothing, so a host with fewer rooms shows fewer heads */
const PANEL_BLOCKS: BarPanelSection[][] = [
  ['tools', 'book'],
  ['tape', 'news'],
  ['lists', 'yours'],
];

const BarPanelsMenu = ({ panels, pins, close }: { panels: BarPanel[]; pins: readonly string[]; close: () => void }) => {
  const column = (section: BarPanelSection) => {
    const rows = panels.filter(p => p.section === section);
    if (rows.length === 0) return <div className="min-w-0" key={section} />;
    return (
      <div className="flex flex-col min-w-0" key={section} data-panels-section={section}>
        <div className="px-2.5 pt-2 pb-1 text-t10 font-bold uppercase tracking-[0.06em] text-textMuted select-none truncate">{PANEL_SECTIONS[section]}</div>
        {rows.map(p => {
          const pinned = pins.includes(p.id);
          return (
            <div
              key={p.id}
              className={`flex items-center h-8 pl-1.5 pr-1 rounded-md transition-colors ${
                p.blocked ? 'text-textSecondary' : p.on ? 'bg-ink/[0.08] text-textPrimary' : 'text-textSecondary hover:bg-ink/[0.06] hover:text-textPrimary'
              }`}
              data-panel-row={p.id}
              data-on={p.on ? '' : undefined}
            >
              <button
                type="button"
                onClick={
                  p.blocked
                    ? undefined
                    : () => {
                        p.press();
                        if (p.closes) close();
                      }
                }
                aria-pressed={!!p.on}
                aria-disabled={p.blocked ? true : undefined}
                className={`flex-1 min-w-0 flex items-center gap-2 h-full text-left ${p.blocked ? 'cursor-default' : ''}`}
              >
                <span className={`w-6 h-6 inline-flex items-center justify-center shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5 ${p.blocked ? 'opacity-45' : ''}`}>{p.icon}</span>
                <span className={`flex-1 min-w-0 truncate text-t125 font-medium ${p.blocked ? 'opacity-45' : ''}`}>{p.label}</span>
                {p.blocked ? (
                  <span className="shrink-0 text-t105 font-medium text-textMuted whitespace-nowrap underline decoration-dotted decoration-ink/30 underline-offset-[3px]">{p.blocked}</span>
                ) : (
                  p.keys && (
                    <span className="inline-flex items-center gap-[3px] shrink-0">
                      {p.keys.map(k => (
                        <kbd key={k} className="inline-flex items-center justify-center min-w-[20px] h-5 px-0.5 rounded border border-ink/[0.12] bg-ink/[0.05] text-t105 font-medium leading-none text-textPrimary">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  )
                )}
              </button>
              <SlowTip label={pinned ? 'Unpin from the bar' : 'Pin to the bar'}>
                <button
                  type="button"
                  onClick={() => toggleBarPin(p.id)}
                  aria-pressed={pinned}
                  aria-label={pinned ? `Unpin ${p.label} from the bar` : `Pin ${p.label} to the bar`}
                  className={`ml-0.5 w-6 h-6 inline-flex items-center justify-center rounded-[5px] shrink-0 transition-colors ${
                    pinned ? 'text-textPrimary [&_svg]:fill-current hover:bg-ink/[0.08]' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.08]'
                  }`}
                  data-panel-pin={p.id}
                  data-pinned={pinned ? '' : undefined}
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              </SlowTip>
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div className="p-1.5 w-[508px] max-w-[calc(100vw-24px)] flex flex-col" data-panels-menu>
      {PANEL_BLOCKS.filter(block => block.some(section => panels.some(p => p.section === section))).map((block, i) => (
        <div key={block.join('+')} className={`grid grid-cols-2 gap-x-2 ${i > 0 ? 'mt-1.5 pt-0.5 border-t border-ink/[0.07]' : ''}`}>
          {block.map(column)}
        </div>
      ))}
    </div>
  );
};

/** THE TRIGGER'S CLASSES, two sizes: the hover chip's 22px, and the ticker bar's 28 (ChartToolbar `tall`) */
const TRIGGER = (tall: boolean) =>
  tall
    ? 'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md font-mono text-t11 uppercase tracking-wider whitespace-nowrap transition-colors'
    : 'hit-24 inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider transition-colors';

/* TradingView-style glyphs beside each chart-style row (Noah, 2026-08-23) —
   hand-drawn 14px marks, all in the house white via currentColor. */
const STYLE_GLYPHS: Record<ChartStyle, ReactNode> = {
  bars: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <path d="M4 2v9M2.5 5H4M4 8h1.5M10 3v9M8.5 10H10M10 5h1.5" />
    </svg>
  ),
  candles: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="currentColor" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
      <path fill="none" d="M4 1.5v2M4 8.5v2.5M10 2.5v2M10 10v1.5" />
      <rect x="2.9" y="3.5" width="2.2" height="5" rx="0.4" />
      <rect x="8.9" y="4.5" width="2.2" height="5.5" rx="0.4" />
    </svg>
  ),
  hollow: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
      <path d="M4 1.5v2M4 8.5v2.5M10 2.5v2M10 10v1.5" />
      <rect x="2.9" y="3.5" width="2.2" height="5" rx="0.4" />
      <rect x="8.9" y="4.5" width="2.2" height="5.5" rx="0.4" />
    </svg>
  ),
  line: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10L5 6.5l3 2 4.5-5" />
    </svg>
  ),
  step: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10.5h3V7h3V3.5h4" />
    </svg>
  ),
  area: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 10L5 6.5l3 2 4.5-5V12h-11Z" fill="currentColor" opacity="0.25" stroke="none" />
      <path d="M1.5 10L5 6.5l3 2 4.5-5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  baseline: (
    <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 7h11" strokeWidth="1" strokeDasharray="2 1.6" opacity="0.55" />
      <path d="M1.5 9.5L5 4.5l3 4 4.5-5" strokeWidth="1.2" />
    </svg>
  ),
};

/* Two sections, because the two families cost the reader differently: an
   overlay rides the tape, a sub-pane takes height OFF it — which is also why
   the sub-panes carry T-3's cap (MAX_SUB_PANES, refused in place with the
   reason printed rather than a row that silently does nothing). */
/* The rows themselves live in indicatorItems.ts, shared with the script library. */

const OVERLAY_ITEMS: { key: keyof ChartOverlays; label: string; hint: string }[] = [
  { key: 'trails', label: 'Exposure nodes', hint: 'Dealer gamma by strike through the session: beads on the heavy strikes, the heaviest zones outlined and named at the edge, where each stands now. Live and Settled are its two books.' },
  { key: 'levels', label: 'Key levels', hint: "Call & put walls, flip and supreme — a ladder at the tape's right edge" },
  { key: 'darkpool', label: 'Dark pool', hint: 'Off-exchange print lines' },
  { key: 'volume', label: 'Volume', hint: 'Session bars along the floor' },
  { key: 'flow', label: 'Flow pane', hint: 'Net option premium a bar under the chart: calls bought at the ask and puts sold at the bid up, puts bought and calls sold down. The filters are the chips on its caption. Hidden while the name has no prints under them.' },
  { key: 'netDrift', label: 'Net drift', hint: 'The flow pane summed through each session, one line. Same prints, same filters.' },
  { key: 'volDrift', label: 'Vol drift', hint: 'Realised vol of these bars against the morning at-the-money IV. One number, not a made-up path.' },
  { key: 'dexStrike', label: 'Exposure by strike', hint: 'Delta, gamma or vega across the chain — docked under the tape' },
  { key: 'session', label: 'Session levels', hint: "Yesterday's high, low & close, the opening range and the first hour" },
  { key: 'cone', label: 'Expected move', hint: "The ±1σ/±2σ band the options priced for today, and what's left of it" },
  { key: 'wind', label: 'Wind · model forecast', hint: "A model's paths for the rest of today's session: the options' implied vol, bent by the dealer book (short gamma widens, long gamma holds, the heavy same-day strike pulls at the close). A forecast, not a market price." },
  { key: 'events', label: 'Events', hint: 'Earnings, FOMC/CPI/NFP and the biggest option prints, marked on the tape' },
  { key: 'alerts', label: 'Alert lines', hint: 'A dotted line where each price alert waits — the bell tells you either way' },
  { key: 'extHours', label: 'Extended hours', hint: 'A faint wash behind the pre-market, after-hours and overnight bars, each its own tint. Intraday only.' },
  { key: 'sessionBreaks', label: 'Session breaks', hint: 'A dashed rule where each session day starts. Intraday only.' },
];

/* T-15 — the overlays a rule clock holds: each assumes a fixed bar interval
   (bucketing, runway arithmetic or a time-anchored texture) that range and
   volume bars do not have. StrikeChart gates the drawing; this set keeps the
   MENU honest about it, and the two agree by construction because the chart
   gates on the same idea — no interval, no interval-based layer. */
const CLOCK_HELD_OVERLAYS = new Set<keyof ChartOverlays>([
  'trails', 'flow', 'netDrift', 'volDrift', 'session', 'cone', 'wind', 'events', 'extHours', 'sessionBreaks',
]);

/* Re-exported so every consumer keeps importing its menu vocabulary from the
   toolbar rather than reaching past it into the placement module. */
export type { MenuSide };

/* The caret points where the menu will pop (Noah, 2026-08-23) — down when it
   drops below, sideways when a side-docked toolbox throws it left or right. */
const MENU_SIDE_CARET = {
  bottom: ChevronDown,
  top: ChevronUp,
  left: ChevronLeft,
  right: ChevronRight,
} as const;

const Dropdown = ({
  label,
  icon,
  open,
  onToggle,
  menuSide = 'bottom',
  title,
  bounds,
  tall = false,
  square = false,
  triggerClass,
  caret = true,
  badge,
  hoverOpen,
  children,
}: {
  label: string;
  icon?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** the pointer resting on the trigger opens it, leaving trigger and menu closes it (ui/useHoverOpen) — the bar's style chip */
  hoverOpen?: (open: boolean) => void;
  /** the ticker bar's 28px trigger (see ChartToolbar `tall`) */
  tall?: boolean;
  /** the bar's right cluster: a 32px square, the icon alone, the word on the slow hover */
  square?: boolean;
  /** a trigger in its own dress (the bar's Panels word) */
  triggerClass?: string;
  caret?: boolean;
  /** a count in the square's corner */
  badge?: number;
  menuSide?: MenuSide;
  /** Hover name — carries the words when a compact trigger drops its label. */
  title?: string;
  /** The box the menu stays inside — the host's pane (see `menuBounds`). */
  bounds?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) => {
  /* The placement plumbing lives in useAnchoredMenu now — the symbol
     quick-pick and the compare '+' need the same thing, and this was the only
     copy that had it. */
  const { anchorRef, placed, menuRef } = useAnchoredMenu<HTMLButtonElement>(open, menuSide, undefined, 'end', bounds);

  const hover = useHoverOpen(!!hoverOpen, v => hoverOpen?.(v), menuRef);
  const Caret = MENU_SIDE_CARET[placed?.side ?? menuSide];
  /* ON THE BAR THE WORD COMES ON THE SLOW HOVER (ui/SlowTip), not the browser's title — except on a chip whose hover
     opens its menu: the menu is the answer (the name stays as the aria-label) */
  const slow = tall && !!title && !hoverOpen;
  const trigger = (
    <button
      ref={anchorRef}
      onClick={onToggle}
      {...hover.trigger}
      title={slow || hoverOpen ? undefined : title}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={label && !square ? undefined : title}
      className={
        square
          ? `relative inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors [&_svg]:w-[13px] [&_svg]:h-[13px] ${
              open ? 'bg-ink/[0.07] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'
            }`
          : `${triggerClass ?? TRIGGER(tall)} ${open ? 'bg-ink/[0.07] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.03]'}`
      }
      data-square={square ? '' : undefined}
    >
      {icon}
      {!square && label}
      {square && badge ? (
        <span className="absolute top-[1px] right-[1px] min-w-[14px] h-[14px] px-[3px] rounded-[7px] bg-textPrimary text-panel text-t9 font-extrabold leading-[14px] text-center tnum pointer-events-none" data-trigger-badge>
          {badge}
        </span>
      ) : null}
      {caret && !square && <Caret className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />}
    </button>
  );
  return (
  <div className="relative">
    {slow ? <SlowTip label={title as string}>{trigger}</SlowTip> : trigger}
    {open && placed && createPortal(
      /*
        THE MENU IS A PORTAL, and that is a correctness fix rather than a
        preference.

        It used to be `position: absolute` inside the toolbar. On Terrain the
        toolbar floats inside a pane whose box is `overflow-hidden` — which it
        has to be, for its rounded corners and to contain the chart — so the
        menu was CLIPPED at the pane's bottom edge. Measured at 1440x900 with
        four panes: the Overlays menu ran to y=696 against a pane clipping at
        y=475, and three of its eight rows were rendered, invisible and
        unclickable. The candle theme menu lost four of eleven. Turning a pane
        into a bigger one is not a fix; any ancestor with a scroll or a clip
        anywhere in the app would do the same thing again.

        Out at the body there is no ancestor left to clip it, so the only bound
        is the window — and the window is a bound the placement already knows
        how to respect: it caps the height to the room actually available and
        FLIPS to the other side when that room is not worth using.

        `overflow-x-hidden` keeps the rounded corners clipping the way the plain
        `overflow-hidden` did; `overscroll-contain` stops a flick that reaches
        the end of the list from scrolling the page underneath it.
      */
      <div
        ref={menuRef}
        data-toolbar-menu=""
        {...hover.menu}
        style={{
          position: 'fixed',
          left: placed.box.left,
          right: placed.box.right,
          top: placed.box.top,
          bottom: placed.box.bottom,
          maxHeight: placed.box.maxHeight,
        }}
        className="z-[120] min-w-[210px] overflow-y-auto overflow-x-hidden overscroll-contain border border-borderMuted bg-panel rounded-md shadow-2xl shadow-black/60 animate-slide-in"
      >
        {children}
      </div>,
      document.body
    )}
  </div>
  );
};

const ChartToolbar = ({
  timeframe,
  onTimeframe,
  overlays,
  onOverlays,
  minimal = false,
  candles = false,
  overlayKeys,
  indicatorKeys,
  coneHorizon,
  onConeHorizon,
  trailGreek,
  onTrailGreek,
  timeframes,
  trend,
  spread = false,
  compact = false,
  keepIntervals = false,
  dense = false,
  menuBounds,
  vertical = false,
  menuSide = 'bottom',
  fullscreen = false,
  onToggleFullscreen,
  replay = false,
  onToggleReplay,
  chartStyle = 'candles',
  onChartStyle,
  indicators,
  onIndicators,
  paneId,
  priceScale = 'normal',
  onPriceScale,
  barClock,
  onBarClock,
  themeKey: themeKeyProp,
  onThemeKey,
  priceScaleLock,
  onExportPng,
  sessionOr = 15,
  onSessionOr,
  alertTicker,
  alertSpot = 0,
  onTotalFullscreen,
  afterIntervals,
  rightExtras,
  onSnapshot,
  snapshotName,
  tall = false,
  afterLeft,
  panels,
  takeover = false,
}: ChartToolbarProps) => {
  const storeThemeKey = useCandleThemeKey();
  const themeKey = themeKeyProp ?? storeThemeKey;
  /* the nodes' look and the flow pane's filters are the reader's, on every chart */
  const deskPrefs = useDeskPrefs();
  const { activeTicker } = useMarketData();
  const [openMenu, setOpenMenu] = useState<'snapshot' | 
    'overlays' | 'candles' | 'style' | 'indicators' | 'alerts' | 'timeframe' | 'panels' | null
  >(null);
  /* the strip's pins are the favourites store's (data/tfFavourites.ts) — one set for every strip, the tall tray's too */
  const pins = useTfFavourites();
  const togglePin = toggleTfFavourite;
  const fullIntervals = !timeframes;
  const stripOnly = fullIntervals
    ? TIMEFRAMES.map(t => t.value).filter(v => frameServed(v) && ((v === '15s' ? v === timeframe : pins.includes(v)) || v === timeframe))
    : timeframes;
  /* How many are set on this name — the bell jingles when it rises. The
     unseen count and its badge left this bell for the sidebar's (the alerts
     rule, 2026-09-10: one inbox). */
  const armedHere = useAlerts(alertTicker ?? '').filter(a => !a.firedAt).length;
  const rootRef = useRef<HTMLDivElement | null>(null);
  /* The library, and what is on the pane for its count on the door */
  const [libraryOpen, setLibraryOpen] = useState(false);
  /* mounted from the first open on, so its own close animation and state survive */
  const [libraryAsked, setLibraryAsked] = useState(false);
  useEffect(() => {
    if (libraryOpen) setLibraryAsked(true);
  }, [libraryOpen]);
  const paneScripts = usePaneScripts(paneId);
  const onPaneCount = paneScripts.filter(p => p.chart.visible).length + (indicators ? INDICATOR_ITEMS.filter(i => indicators[i.key]).length : 0);
  /* The editor sits beside a full-screen chart only: this pane leaving full screen closes its dock (the draft stays) */
  /* the editor's dock stays open across full screen and back (the partner tree's c6d73e5): the shell's column gives it room */

  // Outside click closes whichever menu is open
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (rootRef.current?.contains(t)) return;
      /*
        THE MENU IS NO LONGER INSIDE THE TOOLBAR IN THE DOM.

        It portals to the body so a clipping ancestor cannot cut it off, which
        means a containment test against the toolbar alone now calls every
        click on a menu row an OUTSIDE click — the menu would close before the
        row it was clicked on could act. Every portalled panel carries
        `data-toolbar-menu`, so the test asks whether the click landed in one.
      */
      if (t instanceof Element && t.closest('[data-toolbar-menu]')) return;
      if (t instanceof Node && t.parentElement?.closest('[data-toolbar-menu]')) return;
      setOpenMenu(null);
    };
    /*
      ESCAPE CLOSES THE MENU, AND ONLY THE MENU.

      There was no Escape handler here at all, so the only thing listening was
      Terrain's — `window` keydown, bubble phase, which collapses the expanded
      pane (Terrain.tsx:855). Open a menu inside an expanded pane, press the
      key every reader presses to dismiss a menu, and the whole pane came down
      with it: the reader loses the pane to close a dropdown they could
      otherwise only dismiss by clicking elsewhere.

      CAPTURE PHASE, and it has to be. Terrain's listener is on the same
      target, so a bubble-phase handler here would fire alongside it rather
      than instead of it and the pane would still collapse.
      `stopImmediatePropagation` is the one that holds when both are on
      `window` — plain `stopPropagation` does not stop a second listener
      already attached to the same node.
    */
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpenMenu(null);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [openMenu]);

  const activeCandleLabel = CANDLE_THEME_OPTIONS.find(o => o.value === themeKey)?.label ?? 'Chrome';
  /* The Theme menu's live preview: the theme under the pointer (the current
     one until the pointer moves), drawn on the chart's own name — the alerts'
     name where the host gave one, the desk's active name otherwise */
  const [themePreview, setThemePreview] = useState<CandleThemeKey | null>(null);
  /* THE DENSE THEME MENU'S MEASURE (Noah, 2026-09-13: "i still want the
     preview image just smaller to fit that specific section and not bleed
     out"): the list narrows to 168px and the preview takes what the pane's
     width leaves beside it — 240px at most, 150 at least — so the whole
     menu sits inside the pane. Read at render: the strip re-renders when a
     menu opens, which is when the number matters. */
  const denseRoom = dense ? (menuBounds?.current?.getBoundingClientRect().width ?? 0) : 0;
  const themeListW = dense ? 168 : 212;
  const themePreviewW = dense ? Math.max(150, Math.min(240, (denseRoom || 480) - themeListW - 2 * MENU_EDGE - 22)) : 352;
  const themePreviewH = dense ? Math.round((themePreviewW * 200) / 352) : 200;
  const themeMenuW = dense ? themeListW + themePreviewW + 22 : 620;
  useEffect(() => {
    if (openMenu !== 'candles') setThemePreview(null);
  }, [openMenu]);
  const shownTheme = CANDLE_THEME_OPTIONS.find(o => o.value === (themePreview ?? themeKey)) ?? CANDLE_THEME_OPTIONS[0];
  const previewTicker = alertTicker ?? activeTicker;
  const pickTheme = (key: CandleThemeKey) => {
    if (onThemeKey) onThemeKey(key);
    else setCandleTheme(key);
    setOpenMenu(null);
  };
  const overlayItems = overlayKeys ? OVERLAY_ITEMS.filter(i => overlayKeys.includes(i.key)) : OVERLAY_ITEMS;
  const activeOverlayCount = overlayItems.filter(i => overlays[i.key]).length;

  /* THE BAR'S INDICATORS DOOR (the partner tree's, openmarket's "Indicators | 2" measured: 32 tall, 11px semibold, the
     icon 12, a 13px hairline at a quarter, then the count) — the same library, leading the right cluster */
  const indicatorsBar =
    onIndicators && indicators && paneId ? (
      <SlowTip label="Indicators and scripts">
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={libraryOpen}
          className={`inline-flex items-center gap-[7px] h-8 px-2.5 rounded-lg text-t11 font-semibold whitespace-nowrap transition-colors ${
            libraryOpen ? 'bg-ink/[0.07] text-textPrimary' : onPaneCount > 0 ? 'text-textPrimary hover:bg-ink/[0.05]' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'
          }`}
          data-scripts-door
        >
          <Activity className="w-3 h-3 text-bear" />
          <span className="leading-none">Indicators</span>
          {onPaneCount > 0 && (
            <>
              <span className="w-px h-[13px] bg-current opacity-25 shrink-0" aria-hidden />
              <span className="tnum leading-none" data-scripts-count>{onPaneCount}</span>
            </>
          )}
        </button>
      </SlowTip>
    ) : null;

  /* THE PANELS ON THE BAR: the host's rooms plus this toolbar's own Scripts row; the pinned ids come from the store */
  const barPins = useBarPins();
  const barPanels: BarPanel[] = tall
    ? [
        ...(panels ?? []),
        ...(onIndicators && indicators && paneId
          ? [{ id: 'scripts', section: 'yours' as const, label: 'Scripts', icon: <CodeXml />, on: libraryOpen, press: () => setLibraryOpen(true), closes: true }]
          : []),
      ]
    : [];
  const panelById = new Map(barPanels.map(p => [p.id, p]));

  /* the scripts library, mounted once whichever door opens it */
  const library = onIndicators && indicators && paneId ? (
    libraryAsked && (
              <Suspense fallback={null}>
              <ScriptLibrary
                open={libraryOpen}
                onClose={() => setLibraryOpen(false)}
                paneId={paneId}
                indicators={indicators}
                onIndicators={onIndicators}
                fullscreen={fullscreen}
                overlays={overlays}
                onOverlays={onOverlays}
                coneHorizon={coneHorizon}
                onConeHorizon={onConeHorizon}
                trailGreek={trailGreek}
                onTrailGreek={onTrailGreek}
                sessionOr={sessionOr}
                onSessionOr={onSessionOr}
                barClock={barClock}
              />
              </Suspense>
              )
  ) : null;

  /* THE TAKEOVER'S ROW (the partner tree's c6d73e5, openmarket's full screen: "everything is gone except for ticker,
     price, indicator, the exit full screen button and the timeframe change"): the tray and the Indicators door alone */
  if (takeover)
    return (
      <div ref={rootRef} className="flex items-center gap-1 flex-nowrap w-full" data-toolbar-takeover>
        <TimeframeTray value={timeframe} onChange={onTimeframe} trend={trend} bounds={menuBounds} />
        <span className="flex-1 min-w-0" data-toolbar-gap="" aria-hidden />
        {indicatorsBar}
        {library}
      </div>
    );

  return (
    <div
      ref={rootRef}
      className={`flex ${
        vertical
          ? 'flex-col items-stretch gap-1'
          : /* Spread works in compact too now (2026-09-13): the Weigher's
               docked strip hands this toolbar a row of its own when it wraps,
               and packed left it left the expand door mid-row. It used to be
               `spread && !compact`, when compact meant "no room to spread
               across" — the host's wrapper now grows to the row, so there is. */
            /* ON A TOUCH SCREEN the rows stand 48 apart, centre to centre, so each control's finger box (`.hit-24`,
               44 × 44 there) is its own and not the row's below (the last-targets pass, 2026-10-30) */
            tall
              ? `items-center gap-1 flex-nowrap ${spread ? 'w-full' : ''}`
              : `items-center gap-2 [@media(pointer:coarse)]:gap-y-6 flex-wrap ${spread ? 'w-full' : ''}`
      }`}
    >
      {tall ? (
        <TimeframeTray value={timeframe} onChange={onTimeframe} trend={trend} bounds={menuBounds} />
      ) : compact && !keepIntervals ? (
        <Dropdown
          label={TIMEFRAME_OPTIONS.find(o => o.value === timeframe)?.label ?? String(timeframe)}
          open={openMenu === 'timeframe'}
          onToggle={() => setOpenMenu(m => (m === 'timeframe' ? null : 'timeframe'))}
          menuSide={menuSide} bounds={menuBounds}
          title="Timeframe"
        >
          {fullIntervals ? (
            <IntervalMenu
              value={timeframe}
              pins={pins}
              trend={trend}
              onPin={togglePin}
              onChange={tf => {
                onTimeframe(tf);
                setOpenMenu(null);
              }}
            />
          ) : (
          <div role="group" aria-label="Timeframe">
            {(timeframes ? TIMEFRAME_OPTIONS.filter(o => timeframes.includes(o.value)) : TIMEFRAME_OPTIONS).map(opt => {
              const active = opt.value === timeframe;
              return (
                <button
                  key={opt.value}
                  aria-pressed={active}
                  aria-disabled={!frameServed(opt.value)}
                  title={frameServed(opt.value) ? undefined : `${opt.label} is not on this feed yet`}
                  onClick={() => {
                    if (!frameServed(opt.value)) return;
                    onTimeframe(opt.value);
                    setOpenMenu(null);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-t11 transition-colors ${
                    !frameServed(opt.value) ? 'cursor-default text-textMuted opacity-45' : active ? 'bg-ink/[0.06] text-textPrimary' : 'text-textSecondary hover:bg-ink/[0.03]'
                  }`}
                >
                  <Check className={`w-3 h-3 shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
                  {opt.label}
                  {trend && opt.value in trend && <TrendGlyph state={trend[opt.value] ?? null} />}
                </button>
              );
            })}
          </div>
          )}
        </Dropdown>
      ) : (
        <>
          <TimeframeStrip value={timeframe} onChange={onTimeframe} vertical={vertical} only={stripOnly} trend={trend} />
          {fullIntervals && !vertical && (
            <Dropdown
              label="All"
              title="All intervals"
              open={openMenu === 'timeframe'}
              onToggle={() => setOpenMenu(m => (m === 'timeframe' ? null : 'timeframe'))}
              menuSide={menuSide}
              bounds={menuBounds}
            >
              <IntervalMenu
                value={timeframe}
                pins={pins}
                trend={trend}
                onPin={togglePin}
                onChange={tf => {
                  onTimeframe(tf);
                  setOpenMenu(null);
                }}
              />
            </Dropdown>
          )}
        </>
      )}
      {afterIntervals && !vertical && (
        <>
          <span className="w-px h-4 shrink-0 bg-borderSubtle" aria-hidden />
          {afterIntervals}
        </>
      )}

      {/* THE WORKING CONTROLS ON THE LEFT, TradingView's order (Noah, 2026-10-17: "indicator and replay plus candles and
          timeframes on the left, the lesser important stuff on the right"): beside the timeframes — Candles (the tape's
          SHAPE and its axis), Indicators, Replay. Alerts leads the right cluster with the standing controls. */}
      {(onToggleReplay || onIndicators || onChartStyle || onPriceScale) && (
        <span className={`flex gap-1 ${vertical ? 'flex-col items-stretch' : tall ? 'items-center ml-2' : 'flex-wrap items-center [@media(pointer:coarse)]:gap-x-[18px] [@media(pointer:coarse)]:gap-y-6'}`} data-toolbar-left>
          {(onChartStyle || onPriceScale) && (
            <Dropdown
              label={vertical || compact || tall ? '' : 'Candles'}
              /* on the tall bar the trigger wears the SHAPE IN USE (openmarket's trigger shows its chart type) */
              icon={
                tall ? (
                  <span className="inline-flex text-textPrimary [&>svg]:w-[18px] [&>svg]:h-[13px]" aria-hidden>
                    {STYLE_GLYPHS[chartStyle]}
                  </span>
                ) : (
                  <CandlestickChart className="w-3 h-3 text-textPrimary" />
                )
              }
              title={onPriceScale ? 'Chart style & price scale' : 'Chart style'}
              open={openMenu === 'style'}
              onToggle={() => setOpenMenu(m => (m === 'style' ? null : 'style'))}
              hoverOpen={tall ? v => setOpenMenu(m => (v ? 'style' : m === 'style' ? null : m)) : undefined}
              menuSide={menuSide} bounds={menuBounds} tall={tall}
            >
              {/*
                TWO SECTIONS, ONE TRIGGER — the tape's SHAPE and the AXIS it
                is drawn on. T-7's price scale lives here rather than in a
                trigger of its own, and that was measured rather than chosen.

                The compact strip is 346px of controls, and the narrowest
                column it has to survive is 349 — three pixels of headroom, at
                1180 in every layout and at 1760 in the three-up. A trigger of
                its own is 69px with an icon and a caret and 39 stripped to
                its label alone; both put the theme button onto a second row
                over the tape at widths this file records as won ("four rows
                become one at 1180/1280 in every layout"). Nothing in the
                strip could pay for it without restyling controls that were
                not part of this work.

                It reads right here anyway: one menu for how this chart is
                drawn. And nothing is hidden by folding it in — a percent axis
                prints percentages on its own ticks and an indexed one prints
                100, so the chart states its own mode without a chip repeating
                it, which is the same rule that keeps names off the price axis.
              */}
              <div className="p-1.5 flex flex-col gap-0.5">
                {onChartStyle && CHART_STYLES.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => {
                      onChartStyle(opt.value);
                      setOpenMenu(null);
                    }}
                    className={`flex items-center gap-2.5 px-2.5 ${dense ? 'py-1' : 'py-1.5'} rounded font-mono text-t11 transition-colors ${
                      opt.value === chartStyle
                        ? 'bg-ink/[0.06] text-textPrimary font-semibold'
                        : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.03]'
                    }`}
                  >
                    {/* The glyph stays house white whatever the row state */}
                    <span className="text-textPrimary shrink-0 inline-flex" aria-hidden>
                      {STYLE_GLYPHS[opt.value]}
                    </span>
                    {opt.label}
                    {opt.value === chartStyle && <Check className="w-3 h-3 ml-auto text-select" />}
                  </button>
                ))}
                {/* DENSE: the four scales as one row of chips under their
                    word, the full name and its line as the hover name — the
                    Opening range's grammar (a docked pane's menu) */}
                {onPriceScale && dense && (
                  <div className="mt-1 pt-1.5 px-2.5 pb-1 border-t border-borderSubtle flex items-center gap-2">
                    <span className="font-mono text-t9 uppercase tracking-widest text-textMuted shrink-0">Price scale</span>
                    <span
                      role="group"
                      aria-label="Price scale"
                      className={`ml-auto inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5 ${priceScaleLock ? 'opacity-60' : ''}`}
                    >
                      {PRICE_SCALES.map(opt => {
                        const live = (priceScaleLock?.mode ?? priceScale) === opt.value;
                        return (
                          <button
                            key={opt.value}
                            disabled={!!priceScaleLock}
                            onClick={() => {
                              onPriceScale(opt.value);
                              setOpenMenu(null);
                            }}
                            aria-pressed={live}
                            title={priceScaleLock ? `${priceScaleLock.reason} — the axis is held` : `${opt.label} — ${opt.blurb}`}
                            className={`px-1.5 py-0.5 rounded font-mono text-t10 tnum transition-colors ${priceScaleLock ? 'cursor-not-allowed' : ''} ${
                              live
                                ? 'bg-ink/[0.16] text-textPrimary font-semibold'
                                : `text-textSecondary ${priceScaleLock ? '' : 'hover:text-textPrimary hover:bg-ink/[0.06]'}`
                            }`}
                          >
                            {opt.short}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                )}
                {onPriceScale && !dense && (
                  <>
                    <span className="mt-1 mb-0.5 px-2.5 pt-1.5 border-t border-borderSubtle font-mono text-t9 uppercase tracking-widest text-textMuted">
                      Price scale
                    </span>
                    {PRICE_SCALES.map(opt => {
                      /* LIVE is what the axis is drawing; CHOSEN is what the
                         reader picked. They differ only while a lock is up,
                         and then both are shown — a lock that silently
                         replaced their pick would read as the app forgetting
                         it. */
                      const live = (priceScaleLock?.mode ?? priceScale) === opt.value;
                      const chosen = priceScale === opt.value;
                      return (
                        <button
                          key={opt.value}
                          disabled={!!priceScaleLock}
                          onClick={() => {
                            onPriceScale(opt.value);
                            setOpenMenu(null);
                          }}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded font-mono text-t11 text-left transition-colors ${
                            priceScaleLock ? 'cursor-not-allowed opacity-60' : ''
                          } ${
                            live
                              ? 'bg-ink/[0.06] text-textPrimary font-semibold'
                              : `text-textSecondary ${priceScaleLock ? '' : 'hover:text-textPrimary hover:bg-ink/[0.03]'}`
                          }`}
                        >
                          <span className="shrink-0 w-8 text-textPrimary tnum" aria-hidden>
                            {opt.short}
                          </span>
                          <span className="flex flex-col min-w-0">
                            <span className="truncate">{opt.label}</span>
                            <span className="text-t9 text-textMuted truncate">{opt.blurb}</span>
                          </span>
                          {live && <Check className="w-3 h-3 ml-auto shrink-0 text-select" />}
                          {!live && chosen && (
                            <span className="ml-auto shrink-0 font-mono text-t8 uppercase tracking-wider text-textMuted">yours</span>
                          )}
                        </button>
                      );
                    })}
                    {priceScaleLock && (
                      <p className="px-2.5 pt-1.5 mt-0.5 border-t border-borderSubtle font-mono text-t9 leading-relaxed text-textMuted">
                        {priceScaleLock.reason}, so the axis is held in{' '}
                        {(PRICE_SCALES.find(o => o.value === priceScaleLock.mode) ?? PRICE_SCALES[0]).label.toLowerCase()}. Remove
                        it and your pick comes back.
                      </p>
                    )}
                  </>
                )}
                {/* DENSE: the five clocks as one row of chips, the same way */}
                {onBarClock && dense && (
                  <div className="mt-1 pt-1.5 px-2.5 pb-1 border-t border-borderSubtle flex items-center gap-2">
                    <span className="font-mono text-t9 uppercase tracking-widest text-textMuted shrink-0">Bar clock</span>
                    <span role="group" aria-label="Bar clock" className="ml-auto inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                      {BAR_CLOCKS.map(opt => {
                        const on = (barClock ?? 'time') === opt.key;
                        return (
                          <button
                            key={opt.key}
                            onClick={() => {
                              onBarClock(opt.key);
                              setOpenMenu(null);
                            }}
                            aria-pressed={on}
                            title={`${opt.label} — ${opt.blurb}`}
                            className={`px-1.5 py-0.5 rounded font-mono text-t10 tnum transition-colors ${
                              on ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
                            }`}
                          >
                            {opt.short}
                          </button>
                        );
                      })}
                    </span>
                  </div>
                )}
                {onBarClock && dense && (barClock ?? 'time') !== 'time' && (
                  <p className="px-2.5 pt-1 font-mono text-t9 leading-relaxed text-textMuted">
                    Rule bars fold the live seconds tape — no history before connect, and the interval-based overlays sit out.
                  </p>
                )}
                {onBarClock && !dense && (
                  <>
                    <span className="mt-1 mb-0.5 px-2.5 pt-1.5 border-t border-borderSubtle font-mono text-t9 uppercase tracking-widest text-textMuted">
                      Bar clock
                    </span>
                    {BAR_CLOCKS.map(opt => {
                      const on = (barClock ?? 'time') === opt.key;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => {
                            onBarClock(opt.key);
                            setOpenMenu(null);
                          }}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded font-mono text-t11 text-left transition-colors ${
                            on
                              ? 'bg-ink/[0.06] text-textPrimary font-semibold'
                              : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.03]'
                          }`}
                        >
                          <span className="flex flex-col min-w-0">
                            <span className="truncate">{opt.label}</span>
                            <span className="text-t9 text-textMuted truncate">{opt.blurb}</span>
                          </span>
                          {on && <Check className="w-3 h-3 ml-auto shrink-0 text-select" />}
                        </button>
                      );
                    })}
                    {(barClock ?? 'time') !== 'time' && (
                      <p className="px-2.5 pt-1 font-mono text-t9 leading-relaxed text-textMuted">
                        Rule bars fold the live seconds tape — no history before
                        connect, and the interval-based overlays sit out.
                      </p>
                    )}
                  </>
                )}
                {onExportPng && (
                  <>
                    <div className="mt-1 pt-1 border-t border-borderSubtle" />
                    <button
                      onClick={onExportPng}
                      title={dense ? 'This pane as an image — levels, drawings, watermark' : undefined}
                      className={`flex items-center gap-2 w-full px-2.5 ${dense ? 'py-1' : 'py-1.5'} rounded font-mono text-t11 text-left text-textSecondary hover:text-textPrimary hover:bg-ink/[0.03] transition-colors`}
                    >
                      <span className="flex flex-col min-w-0">
                        <span>Export PNG</span>
                        {!dense && <span className="text-t9 text-textMuted">This pane as an image — levels, drawings, watermark</span>}
                      </span>
                    </button>
                  </>
                )}
              </div>
            </Dropdown>
          )}
          {onIndicators && indicators && paneId && (
            <>
              {!tall && (
              <button
                onClick={() => setLibraryOpen(true)}
                title="Indicators and scripts"
                aria-haspopup="dialog"
                aria-expanded={libraryOpen}
                aria-label={vertical || compact ? 'Indicators and scripts' : undefined}
                className={`hit-24 inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider transition-colors ${
                  libraryOpen ? 'bg-ink/[0.07] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.03]'
                }`}
                data-scripts-door
              >
                <Activity className="w-3 h-3 text-bear" />
                {!(vertical || compact) && 'Indicators'}
                {onPaneCount > 0 && (
                  /* how many draw on this pane — silver, a where-you-are count, not a status */
                  <span className="min-w-[14px] h-[14px] px-1 rounded-full bg-silver/[0.15] text-silver font-mono text-t8 font-bold leading-[14px] text-center" data-scripts-count>
                    {onPaneCount}
                  </span>
                )}
              </button>
              )}
              {library}
            </>
          )}
          {onIndicators && indicators && !paneId && (
            <Dropdown
              label={vertical || compact ? '' : 'Indicators'}
              /* Signature inks on the tool icons (Noah, 2026-08-23) —
                 categorical identity, no house meaning: indicators wear the
                 blue their EMA lines lead with */
              icon={<Activity className="w-3 h-3 text-bear" />}
              title="Indicators"
              open={openMenu === 'indicators'}
              onToggle={() => setOpenMenu(m => (m === 'indicators' ? null : 'indicators'))}
              menuSide={menuSide} bounds={menuBounds}
            >
              <div className="p-1.5 flex flex-col gap-0.5 w-[min(300px,80vw)]">
                {(() => {
                  const items = indicatorKeys ? INDICATOR_ITEMS.filter(i => indicatorKeys.includes(i.key)) : INDICATOR_ITEMS;
                  const firstSub = items.findIndex(i => i.sub && i.group !== 'physics');
                  return items.map((item, idx) => {
                  const on = indicators[item.key];
                  const subsOn = SUB_PANE_ORDER.filter(k => indicators[k]).length;
                  /* The third sub-pane is refused, not shrunk into — the same
                     budget rule that caps Terrain at four panes. The row says
                     so instead of silently ignoring the click. */
                  /* T-15 — session-anchored VWAP has no session cuts to
                     find on a rule clock; the chart skips it and this row
                     says why instead of ticking a line that is not there. */
                  const heldByClock = (barClock ?? 'time') !== 'time' && (item.key === 'vwap' || item.key === 'vwapBands' || item.group === 'book' || item.key === 'harBand' || item.key === 'gammaRegime' || item.key === 'volShock');
                  const capped = (!!item.sub && !on && subsOn >= MAX_SUB_PANES) || heldByClock;
                  const prev = items[idx - 1];
                  return (
                    <div key={item.key} className="flex flex-col">
                    {item.group === 'book' && prev?.group !== 'book' && (
                      <div className="px-2.5 pt-1 font-mono text-t9 uppercase tracking-widest text-textMuted">From the book</div>
                    )}
                    {item.group !== 'book' && !item.sub && prev?.group === 'book' && (
                      <div className="px-2.5 pt-2 font-mono text-t9 uppercase tracking-widest text-textMuted">On the tape</div>
                    )}
                    {item.group === 'physics' && prev?.group !== 'physics' && (
                      <div className="px-2.5 pt-2 font-mono text-t9 uppercase tracking-widest text-textMuted">Physics reads · tested</div>
                    )}
                    {idx === firstSub && (
                      <div className="px-2.5 pt-2 font-mono text-t9 uppercase tracking-widest text-textMuted">
                        Own pane — two at most{capped ? '' : ''}
                      </div>
                    )}
                    <button
                      role="checkbox"
                      aria-checked={on}
                      disabled={capped}
                      title={
                        heldByClock
                          ? 'Needs time bars — the pane is on a rule clock'
                          : capped
                            ? 'Two sub-panes are the cap — turn one off first, or the tape shrinks past its floor'
                            : item.hint
                      }
                      onClick={() => !capped && onIndicators({ ...indicators, [item.key]: !on })}
                      className={`flex items-start gap-2.5 px-2.5 py-1.5 rounded text-left transition-colors ${
                        capped ? 'opacity-40 cursor-default' : 'hover:bg-ink/[0.03]'
                      }`}
                    >
                      <span
                        className={`mt-0.5 inline-flex w-4 h-4 shrink-0 items-center justify-center rounded-[3px] border ${
                          on ? 'bg-silverFill border-silverFill' : 'border-borderMuted'
                        }`}
                      >
                        {on && <Check className="w-3 h-3 text-onfoil" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="inline-block w-2 h-[3px] rounded-full shrink-0"
                            style={{ background: INDICATOR_INKS[item.key] }}
                            aria-hidden
                          />
                          <span className={`font-mono text-t11 font-semibold truncate ${on ? 'text-textPrimary' : 'text-textSecondary'}`}>
                            {item.label}
                          </span>
                        </span>
                        <span className="block text-t10 text-textSecondary leading-snug truncate">{indicatorBlurb(item.hint)}</span>
                      </span>
                    </button>
                    </div>
                  );
                });
                })()}
              </div>
            </Dropdown>
          )}
          {/* REPLAY STAYS IN THE COMPACT FORM (Noah, 2026-10-17: "where is the replay on the small screen?"): it shed there
              once for a 399px column at 1280 with two panes; the compact budget now carries its icon (TOOLBAR_COMPACT_PX
              in Terrain), the word drops like every other control's. */}
          {onToggleReplay && !tall && (
            <button
              onClick={onToggleReplay}
              title={replay ? 'Exit replay — P' : 'Replay session history — P'}
              className={`hit-24 inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider transition-colors ${
                /* Armed = the holo silver, never the live lime (Noah, 2026-09-08) */
                replay ? 'bg-silver/[0.12] text-silver' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.03]'
              }`}
            >
              <Play className="w-3 h-3" />
              {/* COMPACT DROPS THE WORD, like every other control in this
                  strip. It read `!vertical` alone, so Replay was the one
                  trigger here that kept its label at the size where the strip
                  has none to spare — measured: with Terrain wiring both the
                  pencil and this, the compact strip ran 418px into a 399px
                  column at 1280 with two panes and took a second row over the
                  tape. The `title` carries the word, as it does for
                  Indicators, Alerts and Candles. */}
              {!vertical && !compact && 'Replay'}
            </button>
          )}
        </span>
      )}

      {tall && afterLeft && <span className="shrink-0 inline-flex items-center ml-1" data-toolbar-after-left>{afterLeft}</span>}
      {/* on the tall bar the lesser chips a host brings (the link chip, Compare) stand on the left, after the style */}
      {tall && rightExtras && <span className="shrink-0 inline-flex items-center gap-1 ml-1" data-toolbar-extras>{rightExtras}</span>}

      {/* Spread mode: the divider stops being a line and becomes the spacer
          that shoves every following control to the right edge — the
          timeframes get the whole left side to breathe (Noah, 2026-08-23).
          Vertical turns it back into a line, lying flat. */}
      <span
        className={
          vertical
            ? 'h-px w-4 self-center bg-borderSubtle'
            : spread
              ? /* it fills the gap rather than pushing from it (ml-auto), so it
                   has a width — the chart's top-docked drawing rail centres
                   itself in this box (StrikeChart useToolbarGap, 2026-09-12) */
                'flex-1 min-w-0'
              : 'w-px h-4 shrink-0 bg-borderSubtle'
        }
        data-toolbar-gap={spread && !vertical ? '' : undefined}
        aria-hidden
      />

      {/* The TradingView quartet (Noah, 2026-08-23), his order: Replay ·
          Indicators · Alerts · Candles — leading the right cluster, away
          from the timeframes. Candles here is the tape's SHAPE
          (bars/line/area…), not the color theme; Alerts is live since
          2026-08-28 — armed watches, the fired log, and the bell's count. */}
      {(alertTicker || rightExtras) && (
        <span className={`flex gap-1 ${vertical ? 'flex-col items-stretch' : tall ? 'items-center justify-end' : 'flex-wrap items-center justify-end [@media(pointer:coarse)]:gap-x-[18px] [@media(pointer:coarse)]:gap-y-6'}`} data-toolbar-right>
          {tall && indicatorsBar}
          {alertTicker && (
            <Dropdown
              label={vertical || compact ? '' : 'Alerts'}
              icon={
                <span className="relative inline-flex">
                  {/* always in the alert ink here (the toolbar's own rule); it jingles when one is set (Noah, 2026-09-10) */}
                  <JingleBell count={armedHere} lit className="w-3 h-3" />
                </span>
              }
              title="Alerts"
              open={openMenu === 'alerts'}
              onToggle={() => setOpenMenu(m => (m === 'alerts' ? null : 'alerts'))}
              menuSide={menuSide} bounds={menuBounds} tall={tall} square={tall}
            >
              <AlertsMenu ticker={alertTicker} spot={alertSpot} tf={timeframe} />
            </Dropdown>
          )}
          {!tall && rightExtras}
        </span>
      )}

      {/* A hairline between the quartet and the standing controls */}
      {(alertTicker || rightExtras) && !tall && (
        <span className={vertical ? 'h-px w-4 self-center bg-borderSubtle' : 'w-px h-4 bg-borderSubtle'} aria-hidden />
      )}

      {/* The chart tools live in Indicators when this pane has the library.
          Desks without a pane id keep the overlays menu. */}
      {!paneId && (
      <Dropdown
        label={vertical || compact ? String(activeOverlayCount) : `Overlays ${activeOverlayCount}`}
        icon={<Layers className="w-3 h-3" />}
        title="Overlays"
        open={openMenu === 'overlays'}
        onToggle={() => setOpenMenu(m => (m === 'overlays' ? null : 'overlays'))}
        menuSide={menuSide} bounds={menuBounds} tall={tall} square={tall} badge={tall ? activeOverlayCount : undefined}
      >
        <div className="p-1.5 flex flex-col gap-0.5">
          {overlayItems.map(item => {
            const on = overlays[item.key];
            /* T-15 — these read a fixed bar interval and the rule clock has
               none; the chart gates them, and this row says so instead of
               offering a toggle that would silently draw nothing. */
            const heldByClock = (barClock ?? 'time') !== 'time' && CLOCK_HELD_OVERLAYS.has(item.key);
            return (
              <button
                key={item.key}
                /* The checkbox is drawn in PIXELS — a bordered square that
                   fills and takes a tick. A screen reader saw a plain button
                   and could not tell an overlay that is on from one that is
                   off, which is the only thing this row says. role/aria-checked
                   is the pairing that matches what is already drawn. */
                role="checkbox"
                aria-checked={on}
                aria-disabled={heldByClock}
                disabled={heldByClock}
                title={heldByClock ? 'Needs time bars — the pane is on a rule clock' : dense ? item.hint : undefined}
                onClick={() => !heldByClock && onOverlays({ ...overlays, [item.key]: !on })}
                /* Dense: one line, the sentence as the hover name */
                className={`flex ${dense ? 'items-center py-1' : 'items-start py-2'} gap-2.5 px-2.5 rounded text-left transition-colors ${
                  heldByClock ? 'opacity-40 cursor-default' : 'hover:bg-ink/[0.03]'
                }`}
              >
                <span
                  className={`mt-px inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
                    on && !heldByClock ? 'bg-silverFill border-silverFill' : 'border-borderMuted'
                  }`}
                >
                  {on && !heldByClock && <Check className="w-2.5 h-2.5 text-onfoil" />}
                </span>
                <span className="min-w-0">
                  <span className={`block font-mono text-t11 font-semibold ${on && !heldByClock ? 'text-textPrimary' : 'text-textSecondary'}`}>
                    {item.label}
                  </span>
                  {!dense && (
                    <span className="block text-t10 text-textSecondary leading-snug">
                      {heldByClock ? 'Needs time bars — held while the rule clock is on' : item.hint}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {/*
            THE OPENING RANGE, on the row of the overlay it belongs to.

            Not a trigger of its own: it is one setting of one overlay, and it
            means nothing at all while that overlay is off. Here it is where
            the thing it changes is, and it costs the control strip no width —
            which the strip cannot spare (see Terrain's TOOLBAR_FULL_PX).

            Rendered only when the overlay is ON, and disabled would be worse:
            a live control that does nothing teaches a reader the desk is
            broken, and this one has nothing to do until there are lines to
            change.
          */}
          {overlays.trails && overlayItems.some(i => i.key === 'trails') && (
            <div className="flex items-center gap-2 pl-[26px] pr-2.5 pb-2 -mt-1">
              <span className="font-mono text-t9 uppercase tracking-wider text-textMuted shrink-0">Draw</span>
              <span role="group" aria-label="How the exposure nodes draw" className="inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                {NODE_LOOKS.map(l => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => setDeskPrefs({ nodeLook: l.value })}
                    aria-pressed={deskPrefs.nodeLook === l.value}
                    title={l.hint}
                    data-node-look={l.value}
                    className={`px-1.5 py-0.5 rounded font-mono text-t10 transition-colors ${
                      deskPrefs.nodeLook === l.value ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
                    }`}
                  >
                    {l.label}
                  </button>
                ))}
              </span>
            </div>
          )}
          {overlays.trails && overlayItems.some(i => i.key === 'trails') && (
            <div className="flex items-center gap-2 pl-[26px] pr-2.5 pb-2 -mt-1" title="An alert when price comes this near one of the three heaviest nodes or the flip — once a level a session">
              <span className="font-mono text-t9 uppercase tracking-wider text-textMuted shrink-0">Alert near</span>
              <span role="group" aria-label="Node pressure alert" className="inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                <button
                  type="button"
                  onClick={() => onOverlays({ ...overlays, nodeAlert: false })}
                  aria-pressed={!overlays.nodeAlert}
                  className={`px-1.5 py-0.5 rounded font-mono text-t10 transition-colors ${!overlays.nodeAlert ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
                >
                  Off
                </button>
                {NODE_ALERT_PCTS.map(p => {
                  const on = !!overlays.nodeAlert && deskPrefs.nodeAlertPct === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setDeskPrefs({ nodeAlertPct: p });
                        if (!overlays.nodeAlert) onOverlays({ ...overlays, nodeAlert: true });
                      }}
                      aria-pressed={on}
                      data-node-alert={p}
                      className={`px-1.5 py-0.5 rounded font-mono text-t10 tnum transition-colors ${on ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
                    >
                      {p}%
                    </button>
                  );
                })}
              </span>
            </div>
          )}
          {overlays.flow && overlayItems.some(i => i.key === 'flow') && (
            <div className="flex flex-wrap items-center gap-1 pl-[26px] pr-2.5 pb-2 -mt-1" role="group" aria-label="Which prints the flow pane sums">
              {FLOW_CHIPS.map(c => (
                <span key={c.key} className="inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                  {c.options.map(o => {
                    const on = deskPrefs.flowFilters[c.key] === o.value;
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => setDeskPrefs({ flowFilters: { [c.key]: o.value } as Partial<FlowFilters> })}
                        aria-pressed={on}
                        title={c.hint}
                        className={`px-1 py-0.5 rounded font-mono text-t9 transition-colors ${on ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </span>
              ))}
            </div>
          )}
          {onTrailGreek && overlays.trails && overlayItems.some(i => i.key === 'trails') && (
            <div className="flex items-center gap-2 pl-[26px] pr-2.5 pb-2 -mt-1">
              <span className="font-mono text-t9 uppercase tracking-wider text-textMuted shrink-0">Greek</span>
              <span role="group" aria-label="Trail greek" className="inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                {(['gex', 'dex', 'vex'] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onTrailGreek(g)}
                    aria-pressed={trailGreek === g}
                    className={`px-1.5 py-0.5 rounded font-mono text-t10 uppercase transition-colors ${
                      trailGreek === g ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
                    }`}
                  >
                    {g === 'gex' ? 'gex' : g === 'dex' ? 'dex' : 'vega $'}
                  </button>
                ))}
              </span>
            </div>
          )}
          {onConeHorizon && overlays.cone && overlayItems.some(i => i.key === 'cone') && (
            <div className="flex items-center gap-2 pl-[26px] pr-2.5 pb-2 -mt-1">
              <span className="font-mono text-t9 uppercase tracking-wider text-textMuted shrink-0">Horizon</span>
              <span role="group" aria-label="Expected move horizon" className="inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                {(['session', 'week', 'next'] as const).map(h => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onConeHorizon(h)}
                    aria-pressed={coneHorizon === h}
                    className={`px-1.5 py-0.5 rounded font-mono text-t10 transition-colors ${
                      coneHorizon === h ? 'bg-ink/[0.16] text-textPrimary font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
                    }`}
                  >
                    {h === 'session' ? 'Session' : h === 'week' ? 'Week' : 'Next'}
                  </button>
                ))}
              </span>
            </div>
          )}
          {onSessionOr && overlays.session && overlayItems.some(i => i.key === 'session') && (
            <div className="flex items-center gap-2 pl-[26px] pr-2.5 pb-2 -mt-1">
              <span className="font-mono text-t9 uppercase tracking-wider text-textMuted shrink-0">Opening range</span>
              <span role="group" aria-label="Opening range minutes" className="inline-flex items-center gap-0.5 rounded border border-borderMuted p-0.5">
                {OPENING_RANGES.map(m => (
                  <button
                    key={m}
                    onClick={() => onSessionOr(m)}
                    aria-pressed={sessionOr === m}
                    title={`The session's first ${m} minutes`}
                    className={`px-1.5 py-0.5 rounded font-mono text-t10 tnum transition-colors ${
                      sessionOr === m
                        ? 'bg-ink/[0.16] text-textPrimary font-semibold'
                        : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'
                    }`}
                  >
                    {m}m
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
      </Dropdown>
      )}

      {(!minimal || candles) && (
      <Dropdown
        /* Minimal surfaces (desk widgets) drop the theme name from the
           trigger — at panel width the long label wrapped Expand off the
           row's right edge; the menu itself still shows the active theme. */
        /* "Theme", no longer "Candles" — that name now belongs to the chart
           STYLE picker beside the timeframes (Noah, 2026-08-23) */
        label={vertical || compact ? '' : minimal ? 'Theme' : `Theme · ${activeCandleLabel}`}
        title={`Candle theme · ${activeCandleLabel}`}
        icon={<Palette className="w-3 h-3 text-lilacline" />}
        open={openMenu === 'candles'}
        onToggle={() => setOpenMenu(m => (m === 'candles' ? null : 'candles'))}
        menuSide={menuSide} bounds={menuBounds} tall={tall} square={tall}
      >
        {/* THE CHART ITSELF IN EVERY THEME (Noah, 2026-09-11: "an actual high
            quality image of the layout on the chart like how we have it for
            the add widgets on pulse") — the Pulse widget-preview grammar: the
            names down the left, the hovered theme drawn on the right by the
            chart engine on today's bars for this name, one CTA under it. The
            swatch stays on each row as its mark. */}
        {/* DENSE (a docked pane): the same card, cut to the pane — the list
            at 168px with the line as the hover name, the preview sized to
            what the pane leaves beside it (themePreviewW above). */}
        <div className="flex" style={{ width: themeMenuW }} data-theme-menu data-dense={dense ? '' : undefined}>
          <div
            className={`shrink-0 overflow-y-auto border-r border-borderSubtle ${dense ? 'max-h-[320px]' : 'max-h-[380px]'}`}
            style={{ width: themeListW }}
          >
            {CANDLE_THEME_OPTIONS.map(opt => {
              const t: CandleTheme = CANDLE_THEMES[opt.value];
              const hollowUp = t.borderUp !== undefined && t.borderUp !== t.up;
              const shown = (themePreview ?? themeKey) === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => pickTheme(opt.value)}
                  onMouseEnter={() => setThemePreview(opt.value)}
                  onFocus={() => setThemePreview(opt.value)}
                  title={dense ? opt.hint : undefined}
                  className={`w-full text-left flex items-center gap-2.5 px-3 ${dense ? 'py-1.5' : 'py-2'} border-b border-borderSubtle/40 last:border-0 transition-colors ${shown ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.03]'}`}
                  data-theme-option={opt.value}
                >
                  <span className="inline-flex h-4 w-7 shrink-0 items-center justify-center gap-[3px] rounded-[3px] border border-ink/10" style={{ background: t.canvas?.bg ?? '#111214' }}>
                    <span className="w-[5px] h-[10px] rounded-[1px]" style={hollowUp ? { boxShadow: `inset 0 0 0 1px ${t.borderUp}` } : { background: t.up }} />
                    <span className="w-[5px] h-[10px] rounded-[1px]" style={{ background: t.down }} />
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className={`text-t12 font-semibold ${opt.value === themeKey ? 'text-silver' : 'text-textPrimary'}`}>{opt.label}</span>
                    {!dense && <span className="text-t10 text-textMuted truncate">{opt.hint}</span>}
                  </span>
                  {opt.value === themeKey && <Check className="w-3 h-3 ml-auto shrink-0 text-silver" />}
                </button>
              );
            })}
          </div>
          <div className={`flex-1 min-w-0 flex flex-col ${dense ? 'p-2.5 gap-1.5' : 'p-3 gap-2'}`}>
            <ThemePreview ticker={previewTicker} timeframe={timeframe} themeKey={themePreview ?? themeKey} width={themePreviewW} height={themePreviewH} />
            <span className={`font-semibold text-textPrimary ${dense ? 'text-t11' : 'text-t12'}`}>{shownTheme.label}</span>
            <span className={`text-textSecondary leading-snug ${dense ? 'text-t9' : 'text-t10'}`}>
              {dense ? shownTheme.hint : `${shownTheme.hint} · today's bars on ${previewTicker}, drawn by the chart itself`}
            </span>
            <button
              onClick={() => pickTheme(shownTheme.value)}
              className={`relative mt-auto w-full rounded holo-bg foil-glide text-onfoil hover:brightness-105 font-mono font-semibold uppercase tracking-wider transition-all ${
                dense ? 'py-1 text-t9' : 'py-1.5 text-t10'
              }`}
              data-theme-use
            >
              {shownTheme.value === themeKey ? `${shownTheme.label} is on` : `Use ${shownTheme.label}`}
            </button>
          </div>
        </div>
      </Dropdown>
      )}

      {/*
        GATED ON BEING WIRED, not on `minimal` — and shed in compact.

        It read `!minimal`, and NOTHING in the app passed `onToggleDrawing` —
        so the button never rendered anywhere, and the drawing layer under it
        (trendlines, levels, and T-1's measure) had no door at all. A mode flag
        was standing in for "did the host ask for this", which is what every
        other optional control here already tests directly.

        SHED IN COMPACT, with Replay. The two of them are the strip's only
        MODES, they were the only things T-1 and T-13 added to it, and
        together they took the compact strip from 350px to 420 against columns
        as narrow as 379 — a second row of chrome over the tape at ordinary
        laptop widths. Shedding both puts it back at exactly the 350 it was
        before either feature, so neither cost the narrow desk a pixel.

        BOTH KEEP A DOOR, which is what makes shedding them honest rather than
        hiding them: `d` toggles draw mode and `p` toggles replay, both on the
        active pane, both announced. And both modes are VISIBLE once on — draw
        mode raises its own tool strip, replay wears a badge in the identity
        row that is never shed.

        Terrain wires both per pane. The desks that pass no handler are
        unchanged, because the button was not reaching them either way.
      */}
      {/* THE CAMERA (Noah, 2026-10-18: "a feature on the task bar section (right side) like tradingview where you can
          take a screenshot of the screen"): the pane's picture — the head line, the tape as drawn, the rail beside it —
          saved as a PNG, copied to the clipboard, or opened in a new tab; the host composes it (snapshot.ts) */}
      {onSnapshot && (
        <span data-toolbar-snapshot>
          <Dropdown
            label=""
            icon={<Camera className="w-3.5 h-3.5" />}
            title="Snapshot — a picture of this chart"
            open={openMenu === 'snapshot'}
            onToggle={() => setOpenMenu(m => (m === 'snapshot' ? null : 'snapshot'))}
            menuSide={menuSide} bounds={menuBounds} tall={tall} square={tall}
          >
            <div className="p-1.5 flex flex-col gap-0.5 min-w-[184px]" data-snapshot-menu>
              <div className="px-2 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">Snapshot · the tape as it stands</div>
              {(
                [
                  ['save', 'Save as a picture', 'A PNG to your downloads'],
                  ['copy', 'Copy the picture', 'To the clipboard, for a message'],
                  ['open', 'Open in a new tab', 'The picture on its own'],
                ] as const
              ).map(([how, word, hint]) => (
                <button
                  key={how}
                  type="button"
                  onClick={async () => {
                    setOpenMenu(null);
                    const picture = await onSnapshot();
                    if (!picture) return;
                    const blob = await snapshotBlob(picture);
                    if (how === 'save') saveSnapshot(blob, snapshotName ?? 'chart.png');
                    else if (how === 'copy') {
                      if (!(await copySnapshot(blob))) saveSnapshot(blob, snapshotName ?? 'chart.png');
                    } else openSnapshot(blob);
                  }}
                  className="w-full flex flex-col items-start px-2 py-1.5 rounded text-left hover:bg-ink/[0.05] transition-colors"
                  data-snapshot-do={how}
                >
                  <span className="font-mono text-t11 text-textPrimary">{word}</span>
                  <span className="text-t10 text-textMuted">{hint}</span>
                </button>
              ))}
            </div>
          </Dropdown>
        </span>
      )}

      {tall && barPanels.length > 0 && (
        <>
          {barPins.map(id => {
            const p = panelById.get(id);
            if (!p) return null;
            return (
              <SlowTip key={p.id} label={p.blocked ? `${p.label} — ${p.blocked}` : p.label}>
                <button
                  type="button"
                  onClick={p.blocked ? undefined : () => p.press()}
                  aria-pressed={!!p.on}
                  aria-label={p.label}
                  aria-disabled={p.blocked ? true : undefined}
                  className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition-colors [&_svg]:w-[13px] [&_svg]:h-[13px] ${
                    p.blocked ? 'text-textMuted opacity-45 cursor-default' : p.on ? 'bg-ink/[0.07] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.05]'
                  }`}
                  data-bar-pin={p.id}
                  data-on={p.on ? '' : undefined}
                >
                  {p.icon}
                </button>
              </SlowTip>
            );
          })}
          <Dropdown
            label="Panels"
            icon={<PanelsTopLeft className="w-3 h-3" />}
            caret={false}
            triggerClass="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-t11 font-medium whitespace-nowrap transition-colors"
            open={openMenu === 'panels'}
            onToggle={() => setOpenMenu(m => (m === 'panels' ? null : 'panels'))}
            menuSide={menuSide} bounds={menuBounds} tall
          >
            <BarPanelsMenu panels={barPanels} pins={barPins} close={() => setOpenMenu(null)} />
          </Dropdown>
        </>
      )}

      {onToggleFullscreen && !tall && (
        <button
          onClick={onToggleFullscreen}
          title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen chart'}
          className="hit-24 inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider text-textMuted hover:text-textPrimary hover:bg-ink/[0.03] transition-colors"
        >
          {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      )}

      {onTotalFullscreen && !tall && (
        <button
          onClick={onTotalFullscreen}
          title="Total fullscreen — the taskbar goes too; Esc brings it back"
          className="hit-24 inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider text-textMuted hover:text-textPrimary hover:bg-ink/[0.03] transition-colors"
        >
          <Fullscreen className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default ChartToolbar;
