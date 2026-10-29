/*
  Pulse's live chart tile: the house chart on the tile's name with its own toolbar, compares and fullscreen,
  and the book's levels drawn on it.
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ChartToolbar from '../../../components/gex/ChartToolbar';
import CompareControl from '../../../components/gex/CompareControl';
import StrikeChart, { DEFAULT_INDICATORS, DEFAULT_OVERLAYS, type ChartIndicators, type ChartOverlays, type ChartStyle, type CompareEntry, type CompareMode } from '../../../components/gex/StrikeChart';
import StrikeExposureBand, { type BandMetric } from '../../../components/gex/StrikeExposureBand';
import TickerQuickPick from '../../../components/gex/TickerQuickPick';
import { chartGround, useCandleThemeKey } from '../../../components/gex/candleTheme';
import { FOCUS, SUPREME, alpha } from '../../../components/gex/paletteInk';
import { useFadeClose } from '../../../components/ui/useFadeClose';
import { useFocus, useFocusedStrike } from '../../../context/FocusContext';
import { readDeskPrefs } from '../../../data/deskPrefs';
import { DOCK_ROOM } from '../../../data/editorDock';
import { buildExposureProfile } from '../../../data/exposure';
import { buildPrints } from '../../../data/gex';
import { levelsOf } from './derive';
import { fmtTwin, twinFamilyFor, twinPrice } from '../../../data/indexTwins';
import { buildLevelRead } from '../../../data/levelview';
import { TIMEFRAMES, type Timeframe } from '../../../data/timeframe';
import type { TileProps, TileState } from '../tile';
import { LiveSpot, fmtStrike } from './parts';

/** The tile's interval: its own pick, else the desk's (Settings › The desk), else one minute */
export const chartTf = (state: TileState): Timeframe => {
  const own = TIMEFRAMES.find(t => t.value === state.tf)?.value;
  return own ?? readDeskPrefs().opensOn.timeframe ?? '1m';
};

/* Compare-line inks, blue leading like TradingView's; four slots. None of these collide with the field (gold/steel), the
   levels (magenta/green/red/baby-blue), or the voices (lime/mint). */
/* No simulated prints are drawn; the live chart's flow markers come with the live tape (Terrain draws none either). */
const NO_PRINTS: [] = [];
const COMPARE_INKS = ['#5B9CF6', '#BBB2E8', '#EDE4CD', '#6BD3C7'];

const ChartTile = ({ ctx, state, set, lift, pickTicker }: TileProps) => {
  const timeframe = chartTf(state);
  const [overlays, setOverlays] = useState<ChartOverlays>(DEFAULT_OVERLAYS);
  const [compares, setCompares] = useState<CompareEntry[]>([]);
  const [chartStyle, setChartStyle] = useState<ChartStyle>('candles');
  const [indicators, setIndicators] = useState<ChartIndicators>(DEFAULT_INDICATORS);
  const [replay, setReplay] = useState(false);
  /* Draw mode — the rail, the marks and the floating mark bar all live inside StrikeChart; the host only holds the mode.
     Marks are stored per ticker, so a line drawn here IS the line drawn on Terrain. */
  const [drawing, setDrawing] = useState(false);
  /* Which greek the docked strike band draws. Per instance, like the interval and the overlays. */
  const [bandMetric, setBandMetric] = useState<BandMetric>('dex');
  const [full, setFull] = useState(false);
  /* Mode 3 of 3 (Noah, 2026-08-23: "the full full screen one") — the taskbar itself disappears and the tape IS the
     screen; Esc steps back down to fullscreen. Only reachable FROM fullscreen. */
  const [superFull, setSuperFull] = useState(false);
  const { closing: fullClosing, close: closeFull } = useFadeClose(() => {
    setFull(false);
    setDrawing(false);
  });

  const addCompare = (t: string, mode: CompareMode) =>
    setCompares(cs => {
      if (cs.length >= 4 || cs.some(c => c.ticker === t) || t === ctx.ticker) return cs;
      const ink = COMPARE_INKS.find(i => !cs.some(c => c.ink === i)) ?? COMPARE_INKS[0];
      return [...cs, { ticker: t, mode, ink }];
    });
  const removeCompare = (t: string, mode: CompareMode) => setCompares(cs => cs.filter(c => !(c.ticker === t && c.mode === mode)));

  /* Panel black, not inset — the tile's chrome is the panel's, and a second black against it read as a seam (Noah,
     2026-08-23: "i see 2 different shades"). The tape paints its own theme inside the chart; the strip and the legend over
     it wear that theme's GROUND (2026-09-13) — the tile stamps it, index.css re-scopes their tokens. */
  const surface = 'rgb(var(--panel))';
  const ground = chartGround(useCandleThemeKey());
  /* The tile's body — the section its toolbar's menus stay inside (2026-09-13) */
  const bodyRef = useRef<HTMLDivElement | null>(null);

  /* the chart's own levels — the rule Terrain's panes draw by */
  const levels = useMemo(() => levelsOf(ctx.snapshot), [ctx.snapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Dark-pool prints for the DP overlay, pinned to the name so the lines do not wander with the tick */
  const prints = useMemo(() => buildPrints(ctx.ticker, levels.spot), [ctx.ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  /* THE DOCKED BAND'S BOOK, rebuilt per tick from the desk's own snapshot: today's expiry, ten strikes each side — the
     window the desk's other tiles read. Built only while the band is actually drawn. */
  const bandData = useMemo(
    () => (overlays.dexStrike ? buildExposureProfile(ctx.snapshot, '0DTE', 10) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overlays.dexStrike, ctx.snapshot, ctx.revision]
  );

  /* A strike kept on a Pinpoint page: the focus line, while the tile is on that name */
  const focus = useFocusedStrike(ctx.ticker);
  const { clearFocus } = useFocus();
  /* What the focused level is doing today — distance, tests, gamma trend — re-read per revision so the distance walks with the tape */
  const levelRead = useMemo(
    () => (focus != null ? buildLevelRead(ctx.ticker, focus) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus, ctx.ticker, ctx.revision]
  );

  /* THE ONE FULLSCREEN BUTTON is the tile head's (Noah, 2026-09-12): the head hands this chart a one-shot token and the
     chart lifts its own fullscreen — the rest of the toolbar, the editor dock, total fullscreen and Esc's ladder all ride
     on it. The toolbar's own button only shows the way back once up. */
  useEffect(() => {
    if (lift) setFull(true);
  }, [lift]);

  /* Esc exits (fading), and the page's scroll locks underneath. Esc steps DOWN the ladder: total fullscreen → fullscreen → desk. */
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      /* a modal over the takeover took the key already (Modal marks it) */
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (superFull) {
        setSuperFull(false);
        return;
      }
      closeFull();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full, superFull, closeFull]);

  /* leaving fullscreen by any road also leaves total fullscreen */
  useEffect(() => {
    if (!full) setSuperFull(false);
  }, [full]);


  const body = (
    <div
      ref={bodyRef}
      className="relative h-full min-h-0"
      style={{ background: surface }}
      /* A DARK ISLAND on any page (2026-09-12): the tape, its strip and its legend read the dark tokens */
      data-theme="dark"
      /* …and the strip and the legend the ground of the tape's theme (2026-09-13) */
      data-chart-ground={ground}
      data-chart-tile={timeframe}
      data-chart-full={full || undefined}
    >
      {/* THE TASKBAR (settled 2026-08-23 against TradingView's): chrome, not an object — full width, fused to the top edge,
          no container, no border. The tape runs full-bleed underneath and the bar is a veil over it: 55% of the surface
          plus a soft blur. In total fullscreen it rests invisible at the top edge and comes up when the pointer reaches it. */}
      <div
        className={`absolute top-0 inset-x-0 z-10 w-full select-none flex flex-wrap items-center backdrop-blur-md backdrop-saturate-150 ${full ? 'px-3 py-2 gap-3' : 'px-2 py-1.5 gap-2'}${
          superFull ? ' opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-200' : ''
        }`}
        data-taskbar-rest={superFull ? 'hidden' : undefined}
        style={{ background: 'rgb(var(--panel) / 0.55)' }}
        /* Floating chrome the chart's scripts legend measures and sits under (2026-09-10) */
        data-chart-chrome
      >
        {/* Fullscreen earns the TradingView move (Noah, 2026-08-17): change the name without leaving the takeover. Docked,
            the name is changed on the tile's head. */}
        {full && pickTicker && (
          <>
            <span className="inline-flex items-center gap-2">
              <TickerQuickPick ticker={ctx.ticker} onPick={pickTicker} />
              {/* TV's "+" beside the symbol capsule — compare symbols */}
              <CompareControl current={ctx.ticker} compares={compares} onAdd={addCompare} onRemove={removeCompare} />
              {/* The price twins on index names (Noah, 2026-08-18) — the cash index and the futures beside the ETF */}
              {(() => {
                const fam = twinFamilyFor(ctx.ticker);
                if (!fam) return null;
                return (
                  <span className="font-mono text-t10 text-textMuted tnum">
                    {fam.index} {fmtTwin(twinPrice(fam, 'index', levels.spot, levels.spot))} · {fam.futures} {fmtTwin(twinPrice(fam, 'futures', levels.spot, levels.spot))}
                  </span>
                );
              })()}
            </span>
            <span className="w-px h-4 bg-borderSubtle shrink-0 mx-1.5" aria-hidden />
          </>
        )}
        {/* Spread, the TradingView grammar: timeframes pinned left, every other control pushed to the right edge */}
        <div className="flex-1 min-w-fit">
          <ChartToolbar
            minimal
            candles
            menuSide="bottom"
            /* Docked, the menus are the small ones, and every menu stays inside the tile (Noah, 2026-09-13) */
            dense={!full}
            menuBounds={bodyRef}
            spread
            timeframe={timeframe}
            onTimeframe={tf => set({ tf })}
            overlays={overlays}
            onOverlays={setOverlays}
            /* The quartet rides ONLY in fullscreen (Noah, 2026-08-23: "remove those sections completely unless... full
               screen"); the settings themselves persist across modes. */
            replay={replay}
            onToggleReplay={full ? () => setReplay(r => !r) : undefined}
            chartStyle={chartStyle}
            onChartStyle={full ? setChartStyle : undefined}
            indicators={indicators}
            onIndicators={full ? setIndicators : undefined}
            paneId="pulse:main"
            /* The Alerts door rides where Indicators does (the alerts rule, 2026-09-11: set in place) */
            alertTicker={full ? ctx.ticker : undefined}
            alertSpot={levels.spot}
            /* the door's own focus would hold the resting taskbar up (focus-within) — let it go as the tape takes the screen */
            onTotalFullscreen={
              full
                ? () => {
                    setSuperFull(true);
                    (document.activeElement as HTMLElement | null)?.blur();
                  }
                : undefined
            }
            fullscreen={full}
            /* Docked, the tile head carries the one fullscreen button; up, the toolbar's button is the way back (beside Esc) */
            onToggleFullscreen={full ? closeFull : undefined}
          />
        </div>
        {/* The FOCUS line's chip — a strike kept on a Pinpoint page. Says what the dashed line on the tape IS, and is the
            way to take it down by hand. */}
        {focus != null && (
          <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded border font-mono text-t9 uppercase tracking-widest animate-soft-in" style={{ color: FOCUS, borderColor: alpha(FOCUS, 0.4), background: alpha(FOCUS, 0.06) }} data-chart-focus>
            Focus
            <span className="text-t11 font-bold tnum normal-case tracking-normal">{fmtStrike(focus)}</span>
            {/* the strike's standing right now — it wears the supreme's magenta on the tape while it holds the crown */}
            {Math.abs(levels.supreme - focus) < 1e-9 && (
              <span className="font-bold" style={{ color: SUPREME }}>
                Supreme
              </span>
            )}
            {/* the level's read — the three things that decide whether a level is about to matter: distance, tests today,
                gamma trend. Neutral ink: none of these is a market direction. */}
            {levelRead && (
              <span className="inline-flex items-center gap-1.5 normal-case tracking-normal text-t10 text-textSecondary tnum">
                <span aria-hidden="true" className="text-textMuted">
                  ·
                </span>
                <span className="text-textPrimary">
                  {levelRead.distPct > 0 ? '+' : ''}
                  {levelRead.distPct.toFixed(2)}%
                </span>
                <span aria-hidden="true" className="text-textMuted">
                  ·
                </span>
                <span title="Times price has tested this level this session">{levelRead.touches === 0 ? 'untested today' : `tested ${levelRead.touches}× · last ${levelRead.lastTouch}`}</span>
                <span aria-hidden="true" className="text-textMuted">
                  ·
                </span>
                <span title="Gamma at this strike, now against the session open">
                  {levelRead.trend === 'NEW' ? 'gamma new since open' : `gamma ${levelRead.trend.toLowerCase()} ${levelRead.changePct! > 0 ? '+' : ''}${levelRead.changePct!.toFixed(0)}%`}
                </span>
              </span>
            )}
            <button type="button" onClick={clearFocus} aria-label="Let go of the strike" title="Let go of the strike" className="inline-flex items-center justify-center w-4 h-4 rounded hover:bg-ink/[0.08] transition-colors">
              <X className="w-3 h-3" />
            </button>
          </span>
        )}
      </div>
      {/* THE WAY BACK FROM MODE 3, always on screen at rest-dim — never a screen with nothing on it */}
      {superFull && (
        <button
          onClick={() => setSuperFull(false)}
          title="Back to fullscreen — the toolbar returns (Esc); or reach the top edge for it"
          className="absolute top-2 right-2 z-20 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border border-ink/[0.08] bg-canvas/40 backdrop-blur-[3px] font-mono text-t9 uppercase tracking-widest text-textSecondary opacity-40 hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          data-total-esc
        >
          Esc · the toolbar
        </button>
      )}
      {/* A COLUMN, so the docked band can take a row of its own beneath the tape. The tape owns the whole window and runs
          under the translucent bar, edge to edge. */}
      <div className="absolute inset-0 flex flex-col">
        {/* The chart legend (Noah, 2026-08-23, TradingView's grammar): name · interval · the live tick, floating on the
            tape's top-left just under the taskbar. Facts only. pointer-events-none: the tape pans straight through it. */}
        <div className={`absolute left-2 z-10 pointer-events-none select-none flex flex-col gap-1 font-mono ${superFull ? 'top-2' : full ? 'top-12' : 'top-10'}`} data-chart-chrome>
          <div className="flex items-baseline gap-1.5">
            <span className="text-t11 font-semibold text-textPrimary">{ctx.ticker}</span>
            <span className="text-t10 text-textMuted" aria-hidden>
              ·
            </span>
            <span className="text-t10 text-textMuted">{timeframe}</span>
            <span className="text-t10 text-textMuted" aria-hidden>
              ·
            </span>
            <LiveSpot ticker={ctx.ticker} fallback={levels.spot} className="text-t11 font-semibold tnum text-textPrimary" />
          </div>
          {/* one quiet row per comparison — its line ink, its name, and the only hand-removal outside the + menu */}
          {compares.map(c => (
            <div key={`${c.ticker}:${c.mode}`} className="flex items-center gap-1.5">
              <span className="w-2 h-[3px] rounded-full" style={{ background: c.ink }} aria-hidden />
              <span className="text-t10 font-semibold" style={{ color: c.ink }}>
                {c.ticker}
              </span>
              <LiveSpot ticker={c.ticker} className="text-t10 tnum text-textSecondary" />
              <button
                onClick={() => removeCompare(c.ticker, c.mode)}
                aria-label={`Remove ${c.ticker} comparison`}
                title="Remove comparison"
                className="pointer-events-auto inline-flex items-center justify-center w-4 h-4 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
        {/* a name change breathes in instead of hard-swapping the tape */}
        <div key={ctx.ticker} className="min-h-0 flex-1 animate-soft-in-slow">
          <StrikeChart
            ticker={ctx.ticker}
            paneId="pulse:main"
            revision={ctx.revision}
            flowPrints={NO_PRINTS}
            levels={levels}
            timeframe={timeframe}
            overlays={overlays}
            prints={prints}
            compares={compares}
            chartStyle={chartStyle}
            indicators={indicators}
            replay={replay}
            onExitReplay={() => setReplay(false)}
            focusPrice={focus}
            drawing={drawing}
            onExitDraw={() => setDrawing(false)}
            /* THE RAIL ONLY IN FULLSCREEN (Noah, 2026-09-12: "the live chart on pulse shouldnt even show the toolbar until
               user decides to enter the full screen size") — no way in while docked, so no rail */
            onEnterDraw={full ? () => setDrawing(true) : undefined}
            railTopOk={full}
            height={full ? 460 : 180}
            frameless
          />
        </div>
        {/* Docked BELOW the tape rather than inside it, and toggled from the same Overlays menu as the panes */}
        {bandData && <StrikeExposureBand data={bandData} metric={bandMetric} onMetric={setBandMetric} plotHeight={full ? 120 : 76} onClose={() => setOverlays(o => ({ ...o, dexStrike: false }))} />}
      </div>
    </div>
  );

  /* Portal, not a plain fixed div: the grid positions tiles with CSS transforms, and a transformed ancestor becomes the
     containing block for position:fixed — an in-place overlay would size itself to the tile. */
  if (full) {
    return createPortal(
      /* Edge to edge — no padding, no frame, no rounded corners: the chart IS the screen (Noah, 2026-08-23) */
      <div
        className={`fixed inset-0 z-[80] flex flex-col animate-soft-in transition-opacity duration-200 ease-out ${fullClosing ? 'opacity-0' : ''}`}
        /* the script editor's dock takes the right edge while it is open (data/editorDock.ts) */
        style={{ background: surface, ...DOCK_ROOM }}
        data-theme="dark"
      >
        <div className="flex-1 min-h-0">{body}</div>
      </div>,
      document.body
    );
  }

  return body;
};

export default ChartTile;
