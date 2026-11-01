/*
==================================================
  SLAYER TERMINAL - THE PROFILE PANEL
  (components/gex/ProfilePanel.tsx)

  Option C (Noah, 2026-09-06: "go with C build it"):
  the Map's size rail and its forced-flow curve,
  redrawn as ONE panel beside the chart — two lanes
  on the chart's own price axis, one strike column
  between them, one head, one hover card. The way a
  volume profile hangs off a chart (TradingView's
  visible-range profile, Quantower's DOM Surface
  histograms), not two widgets glued to its edge.

  THE HAND is the one the cards under the chart use:
    · lane heads in sentence case, 10px, muted
    · bars as thin rows — a 1px edge, a 0.18 fill,
      a 2px bright end cap; ember where hedging
      amplifies a move, glacier where it absorbs
    · the flow as a 1.25px line over a 0.14 fill,
      two or three prices named, the rest quiet
    · walls, pin and supreme as the cards' chips
    · one tabular strike column, spot as a solid
      chip, the flip as a dashed rule across both
    · gridlines at 0.05, dividers at 0.08, the
      panel's edge at 0.14 — nothing at full white
    · the 196px hover card, price first

  DRAWN ON CANVAS at the device pixel ratio, every
  row at the height the chart puts that price
  (`PriceProjection`, polled in a frame loop — the
  mapping moves on autoscale, drag and resize, none
  of which are React renders), so the two halves
  cannot disagree about a price and every line is
  crisp. What used to be forty DOM rows and an SVG,
  each anti-aliased its own way, is one drawing.

  The rows outside the chart's plot are culled and
  counted (▲ 24 / ▼ 29 in the column), never
  squeezed: the chain is wider than the plot and the
  chart's zoom decides what is on screen.

  TWO HOSTS (2026-09-08, Noah: "put the map panel
  on terrain"): the Map, where it fills a fixed
  share beside the chart, and every Terrain pane,
  where it took the old strike rail's place — its
  drag grip (`width`/`onWidth`), its × (`onClose`),
  its Vol underlay (`ticker`: the session's traded
  volume by price under the size lane), and the
  lane choice in its own head (`onLane`). The old
  rail printed no figure anywhere; this one prints
  them in the capsules and in the read line.
==================================================
*/

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Info, X } from 'lucide-react';
import { snapshotOf } from '../../data/book/feed';
import { useBookRev } from '../../data/book/store';
import { useDeskSession } from '../../data/deskSession';
import { thetaChartBars } from '../../data/thetaCandles';
import { useTapeRev } from '../../data/thetaTape';
import Term from '../ui/Term';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { sinceOpenRead } from '../../data/levelview';
import { fmtFlow, type FlowLadder, type FlowRung } from '../../data/hedgeFlow';
import { sessionVolumeProfile, type VolumeProfile } from '../../data/volumeProfile';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './palette';
import * as TOKEN from './paletteInk';
import { HEAT_MODE, heatCellStyle, heatPaperLeg, heatRampColorFor, type HeatMode } from './heatmap';
import { splinePath } from './StrikePressureLadder';
import type { PriceProjection } from './StrikeChart';
import type { GexLevel, MarketSnapshot } from '../../types/market';
import ExposureField from './ExposureField';
import { RegimeTabs } from './regimeLazy';
import RailBuilding from './RailBuilding';
import FilterTabs from '../ui/FilterTabs';
import { CardRow, PointerFollowCard } from '../ui/PointerCard';
import { attachScrollMore } from '../ui/scrollMore';
import type { KeyLevels } from '../../types/gex';
import { FONT_SANS } from '../../theme/fonts';
import { readToken, useResolvedTheme } from '../../theme/theme';

export type ProfileLane = 'both' | 'size' | 'flow';
export const LANE_OPTIONS: DropdownOption<ProfileLane>[] = [
  { value: 'both', label: 'Both', hint: 'What sits at each strike, and what a move there costs, side by side' },
  { value: 'size', label: 'Size', hint: 'Only what sits at each strike' },
  { value: 'flow', label: 'Flow', hint: 'Only what a move to each strike costs' },
];
/** The Map hands ExposureLevels (with the pin); a Terrain pane hands KeyLevels (without) */
export type PanelLevels = KeyLevels & { pin?: number };
/** The narrowest the panel is drawn — the grip's floor. 180, not 132 (Noah, 2026-09-16, with
    the partner's ladder at three widths: "we should have a cutoff after a certain scaling
    becomes too minimum"): at 132 the ladder was a spine with pill legs and printed nothing. */
export const PROFILE_MIN_W = 180;
/** THE CHART'S FLOOR (Noah, 2026-10-18, the 2×2 with the rails open: "i dont think the live chart be allowed to become
    smaller than this view on the 4 way charts, you can decrease the size of the side panel but not the chart after this
    size"): the chart column beside this panel is never narrower than 576px — the column of a 2×2 pane at 1905 with the
    sidebar collapsed and the rail at rest, his view (measured: pane 918 = rail 340 + chart 576 + the border). The panel
    gives first, down to its own floor; a pane too narrow for both leaves the panel at its floor. */
export const CHART_MIN_W = 576;
/** The chart's floor beside the panel: a width in pixels, or 'half' — half the host (the three-up, Noah, 2026-10-18:
    "for 3 panes i would say half the of parent box should be the minimum a chart can be reduced to") */
export type ChartFloor = number | 'half';
/** The panel's ceiling in a host: 60% of it, or the host less the chart's floor — the lower — and never under its own floor */
export const panelCeiling = (host: number, floor: ChartFloor = CHART_MIN_W): number => {
  const room = floor === 'half' ? Math.round(host / 2) : Math.round(host - floor);
  return Math.max(PROFILE_MIN_W, Math.min(Math.round(host * 0.6), room));
};
/** THE REST WIDTH (the same day: "open the rail wider by rest and only fall to the floor on a
    four-up") — by the desk's pane count, since the panes' widths follow it: one pane or the
    fullscreen pane 520 (the top tier: the dollars at the tips, the Δ column, the key), two or
    four panes (two columns either way) 340, three across 240. The 60% ceiling of the pane
    still holds above it. */
/* 580 alone or expanded since 2026-10-15 (520 before): the width Noah stood the GEX tab at — the calendar's three expiries
   with their figures whole — "the exact default view" */
export const profileRestWidth = (panes: number, expanded: boolean): number => (expanded || panes === 1 ? 580 : panes === 3 ? 240 : 340);
/** THE TIERS (the partner's ladder drops its columns as it narrows; ours too): full — the Δ
    column, the key, the dollars past the tips when the lane has room; mid — the Δ column and
    a short key; thin — the strike and the legs alone. Below full, the hover card carries
    the figures the rows cannot print. */
export type ProfileTier = 'full' | 'mid' | 'thin';
export const profileTier = (panelW: number): ProfileTier => (panelW >= 440 ? 'full' : panelW >= 300 ? 'mid' : 'thin');

/* THE CALENDAR'S THERMAL RAMP (Noah, 2026-09-06: "go build the thermal
   capsules") — the same cells the Exposure Ledger under this map wears, so a
   strike reads the same colour above and below: pale yellow balanced, orange
   to deep red where hedging amplifies, sky to deep blue where it absorbs;
   the ink chosen by contrast (black on the yellow middle, white at the deep
   ends). Solid, never translucent — a low-alpha warm over black goes khaki. */
const heatOn = (value: number, maxAbs: number, mode: HeatMode, paper = false) => {
  const s = heatCellStyle(value, maxAbs, mode, paper);
  return { fill: String(s.backgroundColor ?? '#FFFFBF'), ink: String(s.color ?? '#0a0a0a') };
};
/* THE SIZE LANE IS THE LADDER (Noah, 2026-09-13, with the strike ladder's
   screenshot: "I would like this ladder to be our new size strike ladder…
   keep the flow section and let the page have both thermal and the house
   colours"): one row per strike, the put leg growing LEFT from a centre line
   and the call leg growing RIGHT, each a journey along the ramp from the
   centre's quiet to the colour its own strength earns, the figure past each
   tip, and THE SPINE — one curve through the rows leaning toward the side
   that dominates by the strike's net, its dashed ghost the same curve at the
   open. Drawn on the canvas at the chart's own rows, so it still lines up
   with the price axis the way the capsules did. */
export type ProfilePalette = 'thermal' | 'house';
export const PALETTE_OPTIONS: DropdownOption<ProfilePalette>[] = [
  { value: 'thermal', label: 'Thermal', hint: 'Yellow in the middle, red where hedging amplifies a move, blue where it absorbs one' },
  { value: 'house', label: 'House', hint: 'Gold where hedging amplifies, ice where it absorbs' },
];
/** The heat ramp a palette choice reads (the rail's, its Regime tab's, phone door included) */
export const modeOf = (p: ProfilePalette): HeatMode => (p === 'house' ? HEAT_MODE : 'thermal-yellow');
/** The spine may lean this far from the centre line, as a share of half the lane, either way */
const MAX_LEAN = 0.44;
/** Room kept at each end of the lane for a leg's figure; under it the figures wait for the read line */
const LEG_FIG_W = 40;
const SILVER = '#C7D3E8';
const INK = '#ededed';
const INK_2 = '#a3a3a3';
const INK_3 = '#7d7d7d';

/** The band the head owns — no row is drawn in it */
const HEAD_TOP = 30;
/** The panel's three views as the house's pill rail — one control, one in hand (Noah, 2026-10-15: "the ladder net and
    gex should look like 1 button that is active on one of them at a time not a dropdown like the rest") */
const VIEW_TABS = [
  { value: 'ladder', label: 'Ladder' },
  { value: 'net', label: 'Matrix' },
  { value: 'gex', label: 'Calendar' },
  { value: 'surface', label: 'Surface' },
  /* THE VIX TERM STRUCTURE (2026-10-31, from the data audit): one shared answer for the desk (data/regimeFeed.ts) */
  { value: 'regime', label: 'Regime' },
  /* PINPOINT'S BUILDING (2026-10-31, the owner: the overnight open-interest change is Building's, one view of it) */
  { value: 'building', label: 'Building' },
] as const;
type RailView = (typeof VIEW_TABS)[number]['value'];
/** The head on TWO ROWS below the full tier (2026-09-16: the view tabs and the host's Expiry
    card on the first, the lane tools on the second — one row cannot hold them all at 340) */
const HEAD_TOP_2 = 56;
/** The key under the head (the full and mid tiers): what the ramp, the spine, the ghost and the
    magenta mean — one line, drawn on the canvas */
const KEY_BAND = 16;
/** The column heads over the rows (every tier — the partner's header: STRIKE · Δ SPOT · ◂ PUTS ·
    CALLS ▸, and NET on the net view), drawn on the canvas */
const COL_HEAD = 13;
/** The lane the ▼ count sits in */
const FOOT_BAND = 14;
/** The strike column between the lanes — and the wider one that carries the Δ from spot beside
    the strike (the full and mid tiers) */
const COL_W = 60;
const COL_W_WIDE = 96;
/** A strike's label needs about this much line box */
const LABEL_PITCH = 12;

/* THE LANES' SPLIT (Noah, 2026-09-12: "the size gex and forced flow should
   have this default width but the ability to expand or compress them as
   well"): the size lane's share of the two, half by default, dragged on a
   sash over the strike column, double-click to reset. One store, module-wide
   and persisted, like the rail's prefs — a split set on any panel is the
   split on every panel. */
const SPLIT_KEY = 'slayer_profile_split';
const SPLIT_DEFAULT = 0.5;
const SPLIT_MIN = 0.25;
const SPLIT_MAX = 0.75;
let splitPref: number = (() => {
  try {
    const v = Number(localStorage.getItem(SPLIT_KEY));
    return Number.isFinite(v) && v >= SPLIT_MIN && v <= SPLIT_MAX ? v : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT;
  }
})();
const splitListeners = new Set<() => void>();
function setSplitPref(v: number): void {
  splitPref = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, v));
  try {
    localStorage.setItem(SPLIT_KEY, String(splitPref));
  } catch {
    /* storage off — the choice lives for the session */
  }
  splitListeners.forEach(fn => fn());
}
const splitSubscribe = (fn: () => void) => {
  splitListeners.add(fn);
  return () => {
    splitListeners.delete(fn);
  };
};
const splitSnapshot = () => splitPref;
const useSplitPref = () => useSyncExternalStore(splitSubscribe, splitSnapshot, splitSnapshot);

/* the figures' voice — Helvetica's digits are tabular (theme/fonts.ts) */
const FIG = FONT_SANS;
const SANS = FONT_SANS;

const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/* THE PANEL WEARS THE PAGE'S THEME (Noah, 2026-10-17, the light page with a dark tape beside a panel whose head
   had gone black: "on light theme why is this dark, i only decided to make the chart dark"). The chart alone keeps
   the pane's own theme; the panel beside it is its own island on the PAGE's theme — `data-theme` on its root, its
   own `bg-panel` ground over the pane's frame — so on paper it is light whatever the tape (the Ladder's inks the
   light set, read as TOKENS off that root — dark inks, hairlines and washes in ink alpha, the deep level inks, and
   the paper ramps (heatmap.ts `paper`) for the legs, the dashes and the capsules), and on the dark page it is the
   dark set below, exactly as it always was. (Before: the ladder took the CHART's ground — 2026-10-02, "the terrain
   still has one black one white fix that", a black ladder beside a Stone tape on the light page — which the page's
   theme answers the same way; and the GEX/Net tabs already drew on the page's theme, so a dark tape on paper split
   the panel in two.) */
interface PanelInks {
  ink: string;
  ink2: string;
  ink3: string;
  silver: string;
  silverSoft: string;
  callWall: string;
  putWall: string;
  supreme: string;
  supremeWash: string;
  flipRule: string;
  /** the flip's caption — on the light set the flip's own grey is 4.1:1 at 9px, so its words take the muted ink */
  flipText: string;
  hoverWash: string;
  headRule: string;
  colGround: string;
  divider: string;
  edge: string;
  grid: string;
  spotRule: string;
  spine: string;
  ghost: string;
  keyGhost: string;
  silFill: string;
  silStroke: string;
  /** the Vol underlay's neutral steel at an alpha */
  vol: (a: number) => string;
  /** the VPOC's word over it */
  volText: string;
  /** a level chip's ground, under its ink's wash */
  chipGround: string;
  spotChip: string;
  spotChipText: string;
  markFill: string;
  /** one of the inks above at an alpha */
  alpha: (c: string, a: number) => string;
}
const DARK_INKS: PanelInks = {
  ink: INK,
  ink2: INK_2,
  ink3: INK_3,
  silver: SILVER,
  silverSoft: rgba(SILVER, 0.6),
  callWall: CALL_WALL,
  putWall: PUT_WALL,
  supreme: SUPREME,
  supremeWash: rgba(SUPREME, 0.13),
  flipRule: rgba(FLIP, 0.7),
  flipText: rgba(FLIP, 0.9),
  hoverWash: 'rgba(255,255,255,0.04)',
  headRule: 'rgba(255,255,255,0.06)',
  colGround: 'rgba(255,255,255,0.025)',
  divider: 'rgba(255,255,255,0.08)',
  edge: 'rgba(255,255,255,0.14)',
  grid: 'rgba(255,255,255,0.05)',
  spotRule: 'rgba(237,237,237,0.3)',
  spine: 'rgba(237,237,237,0.85)',
  ghost: 'rgba(237,237,237,0.35)',
  keyGhost: 'rgba(237,237,237,0.4)',
  silFill: 'rgba(255,255,255,0.04)',
  silStroke: 'rgba(255,255,255,0.10)',
  vol: a => `rgba(226,234,244,${a})`,
  volText: 'rgba(226,234,244,0.55)',
  chipGround: '#0a0a0a',
  spotChip: INK,
  spotChipText: '#0a0a0a',
  markFill: '#0e0e0f',
  alpha: rgba,
};
/** The light set, read off the panel's box — resolved when the ground or the page's theme changes, never per frame */
const lightInks = (el: Element): PanelInks => {
  const t = (name: string, a?: number) => readToken(name, a, el);
  return {
    ink: t('--text-primary'),
    ink2: t('--text-secondary'),
    ink3: t('--text-muted'),
    silver: t('--silver'),
    silverSoft: t('--silver', 0.6),
    /* the dark set's walls (glacier, ember), cut deep for paper — never the sign's green and red */
    callWall: t('--glacier'),
    putWall: t('--ember'),
    supreme: t('--supreme'),
    /* 0.09: the supreme's own magenta label on its row stays 4.5:1 on the light page's panel */
    supremeWash: t('--supreme', 0.09),
    flipRule: t('--flip', 0.85),
    flipText: t('--text-muted'),
    hoverWash: t('--ink', 0.05),
    headRule: t('--ink', 0.1),
    colGround: t('--ink', 0.035),
    divider: t('--ink', 0.1),
    edge: t('--ink', 0.16),
    grid: t('--ink', 0.07),
    spotRule: t('--text-primary', 0.4),
    spine: t('--text-primary', 0.85),
    ghost: t('--text-primary', 0.4),
    keyGhost: t('--text-primary', 0.45),
    silFill: t('--ink', 0.05),
    silStroke: t('--ink', 0.16),
    vol: a => t('--silver', a),
    /* the steel at 0.55 is 2.9:1 on the light panel; at 0.85 it reads (5.9:1) */
    volText: t('--silver', 0.85),
    chipGround: t('--panel'),
    spotChip: t('--text-primary'),
    /* a chip filled with the primary ink takes the panel for its words (the theme rules) */
    spotChipText: t('--panel'),
    markFill: t('--panel'),
    alpha: TOKEN.alpha,
  };
};

interface ProfilePanelProps {
  /** Every strike in the window, ascending, the chosen greek's net parked there */
  rows: GexLevel[];
  /** The largest |value| in the window — the size lane's scale */
  maxAbs: number;
  /** Per strike, the put and call hedging behind the net — the ladder's two legs. Omitted, the
      net alone is drawn as one leg on its side. */
  legs?: ReadonlyMap<number, { put: number; call: number }>;
  /** Per strike, the net at the open as a ratio of now — the spine's dashed ghost */
  openRatio?: ReadonlyMap<number, number> | null;
  /** The ramp the legs and the flow wear — the thermal by default, or the house gold and
      ice. The host's choice (Terrain's desk bar carries the card: a rail's head is 132px
      on a three-up desk and cannot hold another card). */
  palette?: ProfilePalette;
  /** The chain's strike spacing — what one strike is worth in pixels */
  step: number;
  levels: PanelLevels;
  /** What a move to each strike forces dealers to trade */
  flow: FlowLadder | null;
  /** Which lanes to draw — the host's dropdown chooses, or the head's own when `onLane` is given */
  lane: ProfileLane;
  /** Given, the head carries the Lanes card itself (a Terrain pane has no row above the panel) */
  onLane?: (lane: ProfileLane) => void;
  /** The "How to read" door — the host opens the guide over the map box */
  onGuide?: () => void;
  guideOpen?: boolean;
  /** Names the size lane: "Size · GEX" */
  greek: string;
  /** The greek's two words for a strike's sign — gamma's push, delta's lean, vega's and
      vanna's and charm's own (2026-09-09). Omitted, gamma's. */
  words?: { pos: string; neg: string };
  focusPrice?: number | null;
  onSelect?: (price: number) => void;
  /** Where the chart beside this panel puts a price — read in the frame loop */
  projection: MutableRefObject<PriceProjection | null>;
  /** The name the panel reads. Given, the head grows the Vol switch: the
      session's traded volume by price, VPOC and value area, under the size
      lane — the old rail's overlay, kept (2026-09-08). */
  ticker?: string;
  /** Drawn at this width, with a drag grip on the left edge reporting the new
      width on release. Omitted, the panel fills its flex share (the Map). */
  width?: number;
  onWidth?: (px: number) => void;
  /** The chart's floor beside this panel — a width, or 'half' the host (panelCeiling); the 576 floor by default */
  chartFloor?: ChartFloor;
  /** The width the host rests this panel at (`profileRestWidth`) — the grip's double-click
      goes back to it, not to the floor */
  restWidth?: number;
  /** A card the host stands in the head beside the view tabs (Terrain's Expiry, 2026-09-16:
      "the expiry should be at the top next to the ladder and net buttons") */
  headCard?: ReactNode;
  /** Given, the head carries an × — a panel you can turn on from a toolbar and
      not off from itself is a panel that feels stuck to the page. */
  onClose?: () => void;
  closeHint?: string;
  className?: string;
  /** Phone sheet. Ladder only — the calendar is the crash, and it stays unmounted. */
  lockView?: 'ladder';
}

interface Placed {
  strike: number;
  y: number;
  value: number;
  rung: FlowRung | undefined;
}

interface Hover {
  strike: number;
  x: number;
  y: number;
  /** Pointer position in the page, for the same card the other tabs use */
  cx: number;
  cy: number;
}

const ProfilePanel = ({
  rows, maxAbs, legs, openRatio = null, palette = 'thermal', step, levels, flow, lane, onLane, greek, words = { pos: 'amplifies', neg: 'absorbs' }, focusPrice, onSelect, projection, onGuide, guideOpen = false,
  ticker, width, onWidth, restWidth, chartFloor = CHART_MIN_W, headCard, onClose, closeHint = 'Hide this panel', className = '', lockView,
}: ProfilePanelProps) => {
  const mode = modeOf(palette);
  /* ON PAPER (the page's light theme — the panel's own ground, never the chart's) the ramps are the paper ramps
     (heatmap.ts) and the canvas's inks the light set's tokens */
  const pageTheme = useResolvedTheme();
  const paper = pageTheme === 'light';
  const rootRef = useRef<HTMLDivElement | null>(null);
  /* the canvas's inks, re-read off the root when the page's theme changes (the root is the island that holds them) */
  const inksRef = useRef<PanelInks>(DARK_INKS);
  useEffect(() => {
    inksRef.current = paper && rootRef.current ? lightInks(rootRef.current) : DARK_INKS;
  }, [paper]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const railArmRef = useRef<() => void>(() => {});
  const placedRef = useRef<Placed[]>([]);
  const [hover, setHover] = useState<Hover | null>(null);
  /* THE VIEW of the size lane (Noah, 2026-09-16, on the partner's Net tab: "I actually like his
     net gamma mini bars, they do read, just change their colors"): the ladder — the legs and the
     spine — or the net: each strike's net as a figure and a row of dashes, one per tenth of the
     largest net on screen, walking the ramp the legs wear (ember where hedging amplifies, glacier
     where it absorbs). */
  /* THE GEX TAB (Noah, 2026-10-15: "there should be another tab called gex with the views of the calendar or the matrix
     because right now the ladder is strictly put vs calls"): the Map's book in the panel — ExposureField on its own band
     (View · Greek · Legs · Expiries · Strikes · Show, the guide, fullscreen), the canvas quiet behind it. The field cuts
     the expiries to what the panel's width holds and says so, so a wider panel shows more and a narrow one asks for
     width or fewer. Its snapshot is the name's live book, re-read every ten seconds while the tab is up. */
  /* GEX FIRST (Noah, 2026-10-15, with the panel in front of him: "the gex should also be the first thing that opens") */
  const [viewState, setView] = useState<RailView>(lockView ?? 'gex');
  const view = lockView ?? viewState;
  const onField = view === 'gex' || view === 'net' || view === 'surface';
  /* the Regime and Building tabs are DOM views over the quiet canvas, like the field: the ladder's pointer and drawing
     stand down while they are up */
  const onBoard = view === 'regime' || view === 'building';
  const quiet = onField || onBoard;
  const fieldView: 'matrix' | 'calendar' | 'profile' = view === 'net' ? 'matrix' : view === 'surface' ? 'profile' : 'calendar';
  const [gexTick, setGexTick] = useState(0);
  useEffect(() => {
    if (!onField) return;
    const id = globalThis.setInterval(() => setGexTick(t => t + 1), 10_000);
    return () => globalThis.clearInterval(id);
  }, [view]);
  /* THE HEAD LINE ON GEX: the field's three cards join the tabs on the panel's own head row through this slot (the
     field portals them in, DayBox's way), the row wraps as the panel narrows, and the book starts under the row's
     MEASURED height — one line on a wide panel, two or three on a narrow one */
  const [stripSlot, setStripSlot] = useState<HTMLElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headH, setHeadH] = useState(HEAD_TOP);
  useEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const read = () => setHeadH(Math.max(HEAD_TOP, Math.round(el.getBoundingClientRect().height)));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);
  const bookRev = useBookRev();
  const gexSnap = useMemo<MarketSnapshot | null>(() => {
    if (!onField || !ticker) return null;
    return snapshotOf(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, ticker, gexTick, bookRev]);
  /* where the rows start this frame — the head, plus the key when it is drawn */
  const headBandRef = useRef(HEAD_TOP);
  /* whether the rows PRINT their figures this frame — the card carries them only when they
     cannot (the partner's rule: the card once the numbers no longer fit) */
  const figuresRef = useRef(true);
  /* Where the plot ends and the chart's time-axis band begins — the read line's
     home — and how wide the panel is, which decides what the line and the head
     can hold (a docked Terrain pane's panel is 132px; the Map's is 42% of the box) */
  const [foot, setFoot] = useState<{ top: number; h: number; w: number } | null>(null);
  const footRef = useRef<{ top: number; h: number; w: number } | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  hoverRef.current = hover;

  /*
    THE GRIP (Terrain, 2026-08-29: "on full screen i should be able to drag the
    strikes out more to cover up more of the screen"). The width while the
    grip is held is local, so a drag never writes desk state per pointer move;
    the committed width lands once, on release. The ceiling — 60% of the
    surface the panel shares — is re-applied on every render, not only while
    dragging: a panel widened in the fullscreen pane must not keep that width
    when the pane collapses and swallow its own chart.
  */
  const [dragW, setDragW] = useState<number | null>(null);
  /* the width under the hand, written to the panel's box on each move: a drag is not a render per frame of every row */
  const dragRef = useRef<number | null>(null);
  const [hostW, setHostW] = useState(0);
  const sized = width != null;
  useEffect(() => {
    if (!sized) return;
    const host = rootRef.current?.parentElement;
    if (!host) return;
    setHostW(host.getBoundingClientRect().width);
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setHostW(e.contentRect.width);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [sized]);
  /* the 60% ceiling, and since 2026-10-18 the chart's floor beside it (panelCeiling) */
  const maxW = hostW > 0 ? panelCeiling(hostW, chartFloor) : Number.POSITIVE_INFINITY;
  const shownW = sized ? Math.min(dragRef.current ?? dragW ?? width, maxW) : undefined;
  const onGripDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (!onWidth) return;
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    if (!root) return;
    const startX = e.clientX;
    const startW = root.getBoundingClientRect().width;
    const host = root.parentElement?.getBoundingClientRect().width ?? startW * 3;
    const max = panelCeiling(host, chartFloor);
    let last = startW;
    dragRef.current = startW;
    setDragW(startW);
    const move = (ev: PointerEvent) => {
      last = Math.round(Math.min(max, Math.max(PROFILE_MIN_W, startW + (startX - ev.clientX))));
      dragRef.current = last;
      root.style.width = `${last}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      dragRef.current = null;
      setDragW(null);
      onWidth(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };
  /* THE SASH BETWEEN THE LANES — drag right to widen the size lane, left to widen the flow lane */
  const onSplitDown = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const root = rootRef.current;
    if (!root) return;
    const startX = e.clientX;
    const startSplit = liveSplit;
    const lanesW = Math.max(1, root.getBoundingClientRect().width - colW);
    let last = startSplit;
    const move = (ev: PointerEvent) => {
      last = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, startSplit + (ev.clientX - startX) / lanesW));
      setDragSplit(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      setDragSplit(null);
      setSplitPref(last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  /*
    THE VOL UNDERLAY — the old rail's T-10, kept. The capsules say where the
    BOOK is heavy; the profile says where the TAPE has traded, and the point is
    reading the two against each other, so it is an underlay at texture
    strength rather than a second lane. Off by default; the Vol switch in the
    head turns it on. Recomputed when the rows do — the host hands new rows
    every tick, so the session's newest minute is always folded in.
  */
  const [showVol, setShowVol] = useState(false);
  const deskSession = useDeskSession();
  const tapeRev = useTapeRev();
  const vp = useMemo<VolumeProfile | null>(
    () => {
      if (!showVol || !ticker) return null;
      const tape = thetaChartBars(ticker, 1, deskSession);
      return tape.length ? sessionVolumeProfile(tape, true) : null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showVol, ticker, rows, bookRev, deskSession, tapeRev]
  );
  const vpRef = useRef<VolumeProfile | null>(null);
  vpRef.current = vp;
  /* THE TWEEN (Noah, 2026-09-06: "the size and flow charts resizing… a quick
     jolt that looks ugly. make this smooth and flawless"). Every capsule
     keeps its drawn length and colour here and eases toward its target each
     frame — a scan tick, a new on-screen scale, a lens change: nothing jumps.
     A capsule entering the view grows in from a dot. Exponential smoothing
     with a 110ms time constant: settled in about 400ms, and a change that
     lands mid-glide simply bends the glide. */
  const animRef = useRef(new Map<string, { len: number; c: [number, number, number]; h: number }>());
  const lastTsRef = useRef(0);
  const lastPitchRef = useRef(0);
  /* The ladder's own window. It opens centered on the live price, with about 18px a strike.
     A wheel or a drag takes it over; until then it stays on the price. The chart's zoom does not move it. */
  const ladderView = useRef({ center: 0, rows: 0, touched: false, ticker: '' });
  const ladderGeom = useRef({ top: 0, height: 1, step: 1 });
  const settledRef = useRef(true);
  /* Bumped when the data changes so the frame loop redraws even if nothing moved */
  const dataRev = useRef(0);
  /* THE PALETTE GLIDE (Noah, 2026-09-16: "have the thermal to house transition of coloring be
     smooth, right now it just changes really quickly"): the loop paints every colour as a MIX of
     the ramp it is leaving and the ramp it is going to, the mix gliding 0 → 1 on the capsules'
     own time constant (~330ms to settle). Each ramp is read on its own magnitude curve and the
     two RESULTS are mixed, so a cell never crosses a curve neither ramp has. Turned back
     mid-glide, the mix simply reverses from where it stands. */
  const paletteRef = useRef<{ from: HeatMode; to: HeatMode; mix: number }>({ from: mode, to: mode, mix: 1 });
  useEffect(() => {
    const pal = paletteRef.current;
    if (pal.to === mode) return;
    if (pal.from === mode && pal.mix < 1) {
      pal.from = pal.to;
      pal.to = mode;
      pal.mix = 1 - pal.mix;
    } else {
      pal.from = pal.to;
      pal.to = mode;
      pal.mix = 0;
    }
    settledRef.current = false;
  }, [mode]);
  useEffect(() => {
    dataRev.current++;
  }, [rows, maxAbs, legs, openRatio, mode, step, levels, flow, lane, focusPrice, vp, view, paper, pageTheme]);

  const showSize = lane !== 'flow';
  const showFlow = lane !== 'size';
  const bothLanes = showSize && showFlow;
  /* the lanes' split — the reader's, live while the sash is in hand */
  const split = useSplitPref();
  const [dragSplit, setDragSplit] = useState<number | null>(null);
  const liveSplit = dragSplit ?? split;
  /* THE TIER, for the head, the sash and the card — the draw loop reads the same rule off its
     own width each frame */
  const panelW = foot?.w ?? 0;
  const tier = profileTier(panelW);
  const colW = tier === 'thin' ? COL_W : COL_W_WIDE;

  /* THE FRAME LOOP — draw when the chart's mapping, the size or the data moved */
  useEffect(() => {
    let raf = 0;
    let lastKey = '';
    const rungBy = new Map<number, FlowRung>();
    if (flow) for (const r of flow.rungs) rungBy.set(r.strike, r);

    const draw = (ts: number) => {
      raf = 0;
      let keep = true;
      try {
      const dt = lastTsRef.current ? Math.min(64, ts - lastTsRef.current) : 16;
      lastTsRef.current = ts;
      let k = 1 - Math.exp(-dt / 110);
      const root = rootRef.current;
      const canvas = canvasRef.current;
      const p = projection.current;
      if (!root || !canvas || !p) return;
      /* the GEX tab stands over a quiet canvas — the field draws the book (and the Regime and Building tabs theirs) */
      if (quiet) {
        if (lastKey !== 'gex') {
          const c2 = canvas.getContext('2d');
          if (c2 && canvas.width && canvas.height) c2.clearRect(0, 0, canvas.width, canvas.height);
          lastKey = 'gex';
        }
        keep = false;
        return;
      }
      const W = root.clientWidth;
      const Htot = root.clientHeight;
      if (W < 40 || Htot < 40) return;
      const H = p.plotHeight() || Htot;
      if (!footRef.current || footRef.current.top !== H || footRef.current.h !== Htot - H || footRef.current.w !== W) {
        footRef.current = { top: H, h: Htot - H, w: W };
        setFoot(footRef.current);
      }
      /* The pin is the Map's; a Terrain pane's levels carry none. NaN is never near anything. */
      const pin = levels.pin ?? Number.NaN;
      const tapeLast = typeof p.last === 'function' ? p.last() : null;
      const spotPx = tapeLast != null && Number.isFinite(tapeLast) && tapeLast > 0 ? tapeLast : levels.spot;
      const tierNow = profileTier(W);
      const colW = tierNow === 'thin' ? COL_W : COL_W_WIDE;
      const keyOn = false;
      const headTop = tierNow === 'full' ? HEAD_TOP : HEAD_TOP_2;
      const HEAD_BAND = headTop + (keyOn ? KEY_BAND : 0) + COL_HEAD;
      headBandRef.current = HEAD_BAND;
      /* THE LADDER'S OWN SCALE. Not the chart's. Opens on the live price with a row tall enough
         to read, and stays there until the reader zooms or drags. */
      const plotTop = HEAD_BAND;
      const plotH = Math.max(40, H - FOOT_BAND - plotTop);
      const fitRows = Math.max(10, Math.min(80, Math.round(plotH / 18)));
      const lv = ladderView.current;
      const sym = ticker ?? '';
      if (!lv.rows || lv.ticker !== sym) {
        lv.center = spotPx;
        lv.rows = fitRows;
        lv.touched = false;
        lv.ticker = sym;
      } else if (!lv.touched) {
        lv.center = spotPx;
        lv.rows = fitRows;
      }
      const span = Math.max(step, lv.rows * step);
      ladderGeom.current = { top: plotTop, height: plotH, step };
      const yFor = (price: number): number | null => {
        if (!Number.isFinite(price)) return null;
        return plotTop + (0.5 - (price - lv.center) / span) * plotH;
      };
      const y0 = yFor(spotPx) ?? plotTop;
      const y1 = yFor(spotPx + step) ?? y0 + 18;
      const pitch = Math.max(1, Math.abs(y1 - y0));
      if (lastPitchRef.current > 0 && Math.abs(pitch - lastPitchRef.current) / lastPitchRef.current > 0.04) k = 1;
      lastPitchRef.current = pitch;
      const spotY = yFor(spotPx) ?? -1;
      const hv = hoverRef.current;
      const key = `${W}|${Htot}|${H}|${lv.center.toFixed(2)}|${lv.rows.toFixed(2)}|${pitch.toFixed(2)}|${spotY.toFixed(1)}|${hv?.strike ?? ''}|${dataRev.current}`;
      if (key === lastKey && settledRef.current) { keep = false; return; }
      lastKey = key;
      /* Ease one capsule toward its target length and colour; says whether it got there */
      const anim = animRef.current;
      const touched = new Set<string>();
      let settled = true;
      /* THE PALETTE'S MIX THIS FRAME — every colour below reads `ramp` and `heat`, never a mode */
      const pal = paletteRef.current;
      if (pal.mix < 1) {
        pal.mix += (1 - pal.mix) * k;
        if (pal.mix > 0.995) pal.mix = 1;
        else settled = false;
      }
      type Rgb = [number, number, number];
      const mixRgb = (a: Rgb, b: Rgb): Rgb => [Math.round(a[0] + (b[0] - a[0]) * pal.mix), Math.round(a[1] + (b[1] - a[1]) * pal.mix), Math.round(a[2] + (b[2] - a[2]) * pal.mix)];
      const ramp = (sign: 1 | -1, t: number): Rgb =>
        pal.mix >= 1 ? heatRampColorFor(sign, t, pal.to, paper) : mixRgb(heatRampColorFor(sign, t, pal.from, paper), heatRampColorFor(sign, t, pal.to, paper));
      /* THE LADDER'S STRETCH of a ramp — the legs, the key's swatches, a leg leaving: on paper the window the house's
         ladders on paper read (heatmap.ts PAPER_WINDOW: quiet colour to the deep pole, never the grey); on a dark
         ground the whole ramp, as it always was */
      /* ON PAPER the legs take their own ramp (heatmap.ts heatPaperLeg): a soft tint of the pole at the centre to the deep
         pole at the tip, the whole journey — the ink ramp's deep window made every capsule the same dark red or blue
         (Noah, 2026-10-04). The palette glide mixes the two paper legs as it mixes the dark ramps. */
      const paperLeg = (sign: 1 | -1, t: number): Rgb => (pal.mix >= 1 ? heatPaperLeg(sign, t, pal.to) : mixRgb(heatPaperLeg(sign, t, pal.from), heatPaperLeg(sign, t, pal.to)));
      const legRamp = (sign: 1 | -1, t: number): Rgb => (paper ? paperLeg(sign, t) : ramp(sign, t));
      /* THE INKS this frame (PanelInks above) */
      const ink = inksRef.current;
      const rgbOf = (fill: string): Rgb => {
        const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(fill);
        return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255, 255, 191];
      };
      const heat = (value: number, max: number) => {
        const to = heatOn(value, max, pal.to, paper);
        if (pal.mix >= 1) return to;
        const from = heatOn(value, max, pal.from, paper);
        const [rr, gg, bb] = mixRgb(rgbOf(from.fill), rgbOf(to.fill));
        return { fill: `rgb(${Math.round(rr)},${Math.round(gg)},${Math.round(bb)})`, ink: pal.mix >= 0.5 ? to.ink : from.ink };
      };
      /* `h` is the capsule's height, eased too (2026-09-06: a zoom-in made the
         rows taller in one frame — the one jolt the length tween left) */
      const ease = (id: string, len: number, fill: string, dot: number, h: number) => {
        const m = /(\d+),\s*(\d+),\s*(\d+)/.exec(fill);
        const target: [number, number, number] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [255, 255, 191];
        let a = anim.get(id);
        if (!a) {
          a = { len: dot, c: target, h };
          anim.set(id, a);
        }
        touched.add(id);
        a.len += (len - a.len) * k;
        a.h += (h - a.h) * k;
        a.c = [a.c[0] + (target[0] - a.c[0]) * k, a.c[1] + (target[1] - a.c[1]) * k, a.c[2] + (target[2] - a.c[2]) * k];
        const far = Math.abs(len - a.len) > 0.25 || Math.abs(h - a.h) > 0.25 || Math.abs(target[0] - a.c[0]) + Math.abs(target[1] - a.c[1]) + Math.abs(target[2] - a.c[2]) > 1.5;
        if (far) settled = false;
        else {
          a.len = len;
          a.h = h;
          a.c = target;
        }
        const [r, g, b] = a.c;
        /* The ink follows the colour it sits on, so it never flips mid-glide */
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        return { len: a.len, h: a.h, fill: `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`, ink: lum > 150 ? '#0a0a0a' : '#ffffff' };
      };

      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(Htot * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(Htot * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${Htot}px`;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Htot);

      /* THE LANES. THE COLUMN COMES FIRST when only the size lane draws (Noah, 2026-09-16: "I
         want his layout verbatim, just with our colors" — the partner's STRIKE · Δ SPOT at the
         left, the lane after); with both lanes it stands between them as before. */
      const both = showSize && showFlow;
      const colFirst = showSize && !showFlow;
      /* the size lane takes its share of the two, the flow lane the rest */
      const sizeW = both ? Math.round((W - colW) * liveSplit) : W - colW;
      const sizeL = showSize ? (colFirst ? colW : 0) : -1;
      const sizeR = showSize ? (colFirst ? W : sizeW) : -1;
      const colL = colFirst ? 0 : showSize ? sizeW : 0;
      const colR = colL + colW;
      const flowL = showFlow ? colR : -1;
      const flowR = showFlow ? W : -1;
      /* THE LADDER'S NET COLUMN IS GONE (Noah, 2026-10-15: "remove the net from the view of the ladder") — the
         partner's wide row's NET figure at the lane's right edge drew when the lane had the room; the Net view
         stays its own */

      /* THE ROWS on screen, and the ones culled above and below */
      /* THE CAPSULE'S HEIGHT follows the row's pitch and stops at 14px (2026-10-04, beside his partner's rail: a wide
         price scale grew ours to 22px and the ladder read fat; capped, a wide scale leaves air round every capsule) */
      const barH = Math.max(4, Math.min(14, Math.round(pitch * 0.62)));
      const half = barH / 2;
      const placed: Placed[] = [];
      for (const r of rows) {
        const y = yFor(r.strike);
        if (y == null || !Number.isFinite(y)) continue;
        if (y - half < HEAD_BAND) continue;
        if (y + half > H - FOOT_BAND) continue;
        placed.push({ strike: r.strike, y, value: r.value, rung: rungBy.get(r.strike) });
      }
      placedRef.current = placed;
      const stride = Math.max(1, Math.ceil(LABEL_PITCH / pitch));
      const isLevel = (k: number) => near(k, levels.callWall) || near(k, levels.putWall) || near(k, levels.supreme) || near(k, pin);
      const isFocus = (k: number) => focusPrice != null && near(k, focusPrice);
      const isHover = (k: number) => hv != null && near(k, hv.strike);
      const labelled = (i: number, k: number) => i % stride === 0 || isLevel(k) || isFocus(k) || isHover(k);

      /* Hover wash first, under everything */
      if (hv) {
        const row = placed.find(r => near(r.strike, hv.strike));
        if (row) {
          ctx.fillStyle = ink.hoverWash;
          ctx.fillRect(0, row.y - pitch / 2, W, pitch);
        }
      }
      /* THE SUPREME'S ROW washed in its magenta across the panel (the partner's row) */
      {
        const row = placed.find(r => near(r.strike, levels.supreme));
        if (row) {
          ctx.fillStyle = ink.supremeWash;
          ctx.fillRect(0, row.y - pitch / 2, W, pitch);
        }
      }

      /* THE KEY under the head (the full and mid tiers, the ladder view): the ramp's two poles
         with their words, the spine, the ghost at the open, the supreme's magenta */
      if (keyOn) {
        const ky = headTop + KEY_BAND / 2 + 0.5;
        let kx = 8;
        const swatch = (sign: 1 | -1, w: number) => {
          const g = ctx.createLinearGradient(kx, 0, kx + w, 0);
          const [r0, g0, b0] = legRamp(sign, 0.15);
          const [r1, g1, b1] = legRamp(sign, 0.9);
          g.addColorStop(0, `rgb(${r0},${g0},${b0})`);
          g.addColorStop(1, `rgb(${r1},${g1},${b1})`);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.roundRect(kx, ky - 3, w, 6, 2);
          ctx.fill();
          kx += w + 4;
        };
        const word = (t: string, c = ink.ink2) => {
          ctx.font = `500 8.5px ${SANS}`;
          ctx.fillStyle = c;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(t, kx, ky);
          kx += ctx.measureText(t).width + 8;
        };
        const full = tierNow === 'full';
        swatch(1, 14);
        word(full ? 'puts amplify' : 'puts');
        swatch(-1, 14);
        word(full ? 'calls absorb' : 'calls');
        ctx.strokeStyle = ink.spine;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(kx + 12, ky);
        ctx.stroke();
        kx += 16;
        word(full ? 'the spine now' : 'now');
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = ink.keyGhost;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(kx + 12, ky);
        ctx.stroke();
        ctx.restore();
        kx += 16;
        word(full ? 'at the open' : 'open');
        ctx.fillStyle = ink.supreme;
        ctx.fillRect(kx, ky - 3, 6, 6);
        kx += 10;
        word('supreme', ink.supreme);
      }
      /* THE COLUMN HEADS over the rows: each lane's name centered over that lane, and STRIKE
         (with Δ SPOT beside it when the column is wide) centered over the strike column */
      {
        const hy = HEAD_BAND - COL_HEAD / 2 + 0.5;
        ctx.font = `600 11px ${FIG}`;
        ctx.fillStyle = ink.ink3;
        ctx.textBaseline = 'middle';
        if (showSize) {
          ctx.textAlign = 'center';
          ctx.fillText('◂ PUTS · CALLS ▸', sizeL + (sizeR - sizeL) / 2, hy);
        }
        /* The strike head sits on the same center as the numbers under it. Wide: STRIKE and Δ SPOT as one
           pair in the middle of the column when they fit; thin: the word alone, centered. */
        ctx.font = `600 11px ${FIG}`;
        ctx.fillStyle = ink.ink3;
        if (colW === COL_W_WIDE && view === 'ladder') {
          const strikeHead = 'STRIKE';
          const deltaHead = 'Δ SPOT';
          const sw = ctx.measureText(strikeHead).width;
          const dw = ctx.measureText(deltaHead).width;
          const gap = 10;
          if (sw + gap + dw <= colW - 8) {
            const start = colL + (colW - (sw + gap + dw)) / 2;
            ctx.textAlign = 'left';
            ctx.fillText(strikeHead, start, hy);
            ctx.fillText(deltaHead, start + sw + gap, hy);
          } else {
            ctx.textAlign = 'left';
            ctx.fillText(strikeHead, colL + 6, hy);
            ctx.textAlign = 'right';
            ctx.fillText(deltaHead, colR - 6, hy);
          }
        } else {
          ctx.textAlign = 'center';
          ctx.fillText('STRIKE', colL + colW / 2, hy);
        }
        if (showFlow) {
          ctx.textAlign = 'center';
          ctx.fillText('A MOVE FORCES', flowL + (flowR - flowL) / 2, hy);
        }
        ctx.strokeStyle = ink.headRule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(2, HEAD_BAND - 0.5);
        ctx.lineTo(W - 2, HEAD_BAND - 0.5);
        ctx.stroke();
      }

      /* The column's ground, the dividers, the panel's edge */
      ctx.fillStyle = ink.colGround;
      ctx.fillRect(colL, HEAD_BAND, colW, H - HEAD_BAND - FOOT_BAND);
      ctx.strokeStyle = ink.divider;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (showSize) {
        ctx.moveTo(colL + 0.5, HEAD_BAND);
        ctx.lineTo(colL + 0.5, H);
      }
      if (showFlow) {
        ctx.moveTo(colR - 0.5, HEAD_BAND);
        ctx.lineTo(colR - 0.5, H);
      }
      ctx.stroke();
      ctx.strokeStyle = ink.edge;
      ctx.beginPath();
      ctx.moveTo(0.5, 0);
      ctx.lineTo(0.5, Htot);
      ctx.stroke();

      /* THE VOL UNDERLAY — where the session has traded, as neutral steel
         under the size lane: bars growing from the column outward like the
         capsules over them, the value area's edges dashed, the VPOC solid.
         Traded volume carries no dealer meaning, so it takes none of the
         palette's inks. */
      const prof = vpRef.current;
      if (showSize && prof && prof.totalVolume > 0) {
        let maxV = 0;
        for (const b of prof.bins) maxV = Math.max(maxV, b.volume);
        if (maxV > 0) {
          const vSpan = Math.max(1, sizeR - sizeL - 10);
          for (const b of prof.bins) {
            const y = yFor(b.price);
            const y2 = yFor(b.price + prof.binSize);
            if (y == null || y2 == null || !Number.isFinite(y) || !Number.isFinite(y2)) continue;
            const top = Math.max(HEAD_BAND, Math.min(y, y2));
            const bot = Math.min(H - FOOT_BAND, Math.max(y, y2));
            if (bot - top < 0.5) continue;
            const isPoc = prof.vpoc !== null && Math.abs(b.price - prof.vpoc) < prof.binSize / 2;
            const len = (b.volume / maxV) * vSpan;
            ctx.fillStyle = ink.vol(isPoc ? 0.2 : 0.09);
            ctx.fillRect(sizeR - len, top, len, Math.max(1, bot - top - 1));
          }
          const rule = (price: number | null, alpha: number, dash: number[]) => {
            if (price === null) return;
            const y = yFor(price);
            if (y == null || y < HEAD_BAND || y > H - FOOT_BAND) return;
            ctx.save();
            ctx.strokeStyle = ink.vol(alpha);
            ctx.lineWidth = 1;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(sizeL + 4, Math.round(y) + 0.5);
            ctx.lineTo(sizeR - 2, Math.round(y) + 0.5);
            ctx.stroke();
            ctx.restore();
          };
          rule(prof.vah, 0.28, [3, 3]);
          rule(prof.val, 0.28, [3, 3]);
          rule(prof.vpoc, 0.4, []);
          if (prof.vpoc !== null) {
            const y = yFor(prof.vpoc);
            if (y != null && y > HEAD_BAND + 8 && y < H - FOOT_BAND) {
              ctx.font = `7px ${FIG}`;
              ctx.fillStyle = ink.volText;
              ctx.textAlign = 'left';
              ctx.textBaseline = 'bottom';
              ctx.fillText('VPOC', sizeL + 6, y - 2);
            }
          }
        }
      }

      /* Gridlines at the labelled rows */
      ctx.strokeStyle = ink.grid;
      ctx.beginPath();
      placed.forEach((r, i) => {
        if (!labelled(i, r.strike)) return;
        const yy = Math.round(r.y) + 0.5;
        if (showSize) {
          ctx.moveTo(sizeL + 6, yy);
          ctx.lineTo(sizeR - 2, yy);
        }
        if (showFlow) {
          ctx.moveTo(flowL + 2, yy);
          ctx.lineTo(flowR - 6, yy);
        }
      });
      ctx.stroke();

      /* THE FLIP — a dashed rule across both lanes */
      const flipY = yFor(levels.flip);
      if (flipY != null && flipY > HEAD_BAND && flipY < H - FOOT_BAND) {
        const yy = Math.round(flipY) + 0.5;
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = ink.flipRule;
        ctx.beginPath();
        ctx.moveTo(4, yy);
        ctx.lineTo(W - 4, yy);
        ctx.stroke();
        ctx.restore();
        ctx.font = `9px ${FIG}`;
        ctx.fillStyle = ink.flipText;
        ctx.textBaseline = 'bottom';
        if (showFlow) {
          ctx.textAlign = 'right';
          ctx.fillText(`flip ${fmtStrike(levels.flip)}`, W - 6, yy - 2);
        } else {
          /* the caption at the lane's right end — the figures live at its left */
          ctx.textAlign = 'right';
          ctx.fillText(`flip ${fmtStrike(levels.flip)}`, W - 6, yy - 2);
        }
      }

      /* THE SPOT RULE — under the bars; its chip comes last */
      const spotOn = spotY > HEAD_BAND && spotY < H - FOOT_BAND;
      if (spotOn) {
        const yy = Math.round(spotY) + 0.5;
        ctx.strokeStyle = ink.spotRule;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(W, yy);
        ctx.stroke();
      }

      /* THE CAPSULES — the ledger's cells turned sideways: one solid capsule
         per strike, its length the figure, its colour the thermal ramp, the
         figure printed inside at the outer end when there is room. Both lanes
         scale to the largest strike ON SCREEN so a zoomed-in chart still shows
         capsules that read as capsules. */
      const capsule = (x: number, yMid: number, len: number, fill: string, ring: string | null, h = barH) => {
        const y = Math.round(yMid - h / 2);
        const rad = Math.min(h / 2, len / 2);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(x, y, len, h, rad);
        ctx.fill();
        if (ring) {
          ctx.strokeStyle = ring;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(x - 0.5, y - 0.5, len + 1, h + 1, rad + 0.5);
          ctx.stroke();
        }
      };
      /* Words inside a capsule from 10px of row, one point smaller under 13 —
         a name must go INSIDE a capsule that reaches the edge, whatever the
         zoom, never over its figure (Noah, 2026-09-09) */
      const figureIn = (text: string, x: number, len: number, yMid: number, fg: string, outer: 'left' | 'right', font = `600 9px ${FIG}`) => {
        if (barH < 10) return;
        ctx.font = barH < 13 ? font.replace('9px', '8px') : font;
        const w = ctx.measureText(text).width;
        if (w + 12 > len) return;
        ctx.fillStyle = fg;
        ctx.textBaseline = 'middle';
        ctx.textAlign = outer === 'left' ? 'left' : 'right';
        ctx.fillText(text, outer === 'left' ? x + 6 : x + len - 6, yMid + 0.5);
      };
      const ringFor = (k: number) => (isFocus(k) ? ink.silver : isHover(k) ? ink.silverSoft : null);
      /* THE LEVEL NAMES — the cards' chips beside a capsule's end when there is
         room; when the capsule reaches the lane's edge (the wall is usually the
         longest) the name goes INSIDE it at the outer end and the figure moves
         to the inner end, so neither covers the other (Noah, 2026-09-06: "the
         call wall/put wall sometimes overlays the number of the strike when
         it's too long. find another way"). */
      const levelOf = new Map<number, { words: string; c: string }>();
      levelOf.set(levels.callWall, { words: 'Call wall', c: ink.callWall });
      levelOf.set(levels.putWall, { words: 'Put wall', c: ink.putWall });
      if (!near(levels.supreme, levels.callWall) && !near(levels.supreme, levels.putWall)) levelOf.set(levels.supreme, { words: 'Supreme', c: ink.supreme });
      if (Number.isFinite(pin) && !near(pin, levels.callWall) && !near(pin, levels.putWall) && !near(pin, levels.supreme)) levelOf.set(pin, { words: 'Max OI', c: ink.ink2 });
      const levelAt = (k: number) => {
        for (const [lk, v] of levelOf) if (near(lk, k)) return v;
        return undefined;
      };
      const chipW = (words: string) => {
        ctx.font = `500 10px ${SANS}`;
        return Math.ceil(ctx.measureText(words).width) + 12;
      };
      const insideNamed = new Set<number>();
      const NAME_FONT = `500 9px ${SANS}`;
      const figW = (text: string) => {
        ctx.font = `600 9px ${FIG}`;
        return ctx.measureText(text).width;
      };

      /* THE SIZE LANE IS THE LADDER — a centre line, the put leg growing left
         and the call leg right, each a journey along the ramp; the figures
         past the tips when the lane has room; the spine through the rows */
      /* THE SIGN'S SHADE — one colour per side off the ramp the legs wear (the partner's flat
         inks, ours): the put pole where hedging amplifies, the call pole where it absorbs */
      const sideInk = (sign: 1 | -1) => {
        const [rr, gg, bb] = ramp(sign, 0.8);
        return `rgb(${rr},${gg},${bb})`;
      };
      if (showSize) {
        const laneW = sizeR - sizeL;
        const mid = sizeL + laneW / 2;
        const figures = laneW >= 180 && barH >= 10;
        figuresRef.current = figures;
        const reach = Math.max(8, laneW / 2 - (figures ? LEG_FIG_W : 6) - 4);
        const legH = Math.max(3, Math.min(9, Math.round(barH * 0.55)));
        /* the legs' scale is the largest leg ON SCREEN, the spine's the largest |net| — both live, like the capsules' were */
        let legMax = 0;
        let netMax = 0;
        const legOf = (k: number, v: number) => {
          const l = legs?.get(k);
          if (l) return { put: Math.abs(l.put), call: Math.abs(l.call) };
          /* no legs known: the net alone on its side — positive is put-dominant */
          return v >= 0 ? { put: Math.abs(v), call: 0 } : { put: 0, call: Math.abs(v) };
        };
        for (const r of placed) {
          const l = legOf(r.strike, r.value);
          legMax = Math.max(legMax, l.put, l.call);
          netMax = Math.max(netMax, Math.abs(r.value));
        }
        if (!legMax) legMax = maxAbs || 1;
        if (!netMax) netMax = maxAbs || 1;
        /* the centre line */
        ctx.strokeStyle = ink.divider;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(mid) + 0.5, HEAD_BAND);
        ctx.lineTo(Math.round(mid) + 0.5, H - FOOT_BAND);
        ctx.stroke();
        const rampAt = (sign: 1 | -1, t: number) => {
          const [rr, gg, bb] = legRamp(sign, Math.max(0, Math.min(1, t)));
          return `rgb(${rr},${gg},${bb})`;
        };
        /** A leg: the ramp from the centre's quiet (t = 0) to the tip (t = its strength) */
        const leg = (side: 'put' | 'call', yMid: number, len: number, s: number, h: number, ring: string | null) => {
          if (len < 0.5) return;
          const sign: 1 | -1 = side === 'put' ? 1 : -1;
          const x0 = side === 'put' ? mid - len : mid;
          const x1 = side === 'put' ? mid : mid + len;
          const grad = ctx.createLinearGradient(mid, 0, side === 'put' ? mid - len : mid + len, 0);
          grad.addColorStop(0, rampAt(sign, 0));
          grad.addColorStop(1 / 3, rampAt(sign, s / 3));
          grad.addColorStop(2 / 3, rampAt(sign, (2 * s) / 3));
          grad.addColorStop(1, rampAt(sign, s));
          const y = Math.round(yMid - h / 2);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(x0, y, x1 - x0, h, 2);
          ctx.fill();
          if (ring) {
            ctx.strokeStyle = ring;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(x0 - 0.5, y - 0.5, x1 - x0 + 1, h + 1, 2.5);
            ctx.stroke();
          }
        };
        for (const r of placed) {
          const l = legOf(r.strike, r.value);
          const ring = ringFor(r.strike);
          /* the lengths ease, the way the capsules did; the colour follows the eased strength */
          const pt = ease(`p:${r.strike}`, l.put > 0 ? Math.max(2, (l.put / legMax) * reach) : 0, '', 0, legH);
          const ct = ease(`c:${r.strike}`, l.call > 0 ? Math.max(2, (l.call / legMax) * reach) : 0, '', 0, legH);
          leg('put', r.y, pt.len, Math.min(1, pt.len / reach), legH, ring);
          leg('call', r.y, ct.len, Math.min(1, ct.len / reach), legH, ring);
          if (figures) {
            ctx.font = `500 9px ${FIG}`;
            ctx.fillStyle = ink.ink;
            ctx.textBaseline = 'middle';
            if (l.put > 0) {
              ctx.textAlign = 'right';
              ctx.fillText(fmtUsd(l.put), mid - pt.len - 4, r.y + 0.5);
            }
            if (l.call > 0) {
              ctx.textAlign = 'left';
              ctx.fillText(fmtUsd(l.call), mid + ct.len + 4, r.y + 0.5);
            }
          }
        }
        /* THE SPINE — the contour through the rows, leaning toward the side that dominates
           by the strike's net (positive net is put-dominant: it leans left); its ghost at the open */
        if (placed.length > 1) {
          const lean = (laneW / 2) * MAX_LEAN;
          const pts = placed.map(r => ({ x: mid - (r.value / netMax) * lean, y: r.y })).sort((a, b) => a.y - b.y);
          const clampX = (v: number) => Math.max(sizeL + 2, Math.min(sizeR - 2, v));
          const hasGhost = !!openRatio && placed.some(r => openRatio.has(r.strike));
          if (hasGhost) {
            const gpts = placed
              .map(r => {
                const ratio = openRatio!.get(r.strike);
                const x = ratio == null ? mid - (r.value / netMax) * lean : mid - Math.max(-1.6, Math.min(1.6, ratio)) * ((r.value / netMax) * lean);
                return { x: clampX(x), y: r.y };
              })
              .sort((a, b) => a.y - b.y);
            ctx.save();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = ink.ghost;
            ctx.lineWidth = 1;
            ctx.stroke(new Path2D(splinePath(gpts, sizeL + 2, sizeR - 2)));
            ctx.restore();
          }
          ctx.strokeStyle = ink.spine;
          ctx.lineWidth = 1.5;
          ctx.stroke(new Path2D(splinePath(pts.map(q => ({ x: clampX(q.x), y: q.y })), sizeL + 2, sizeR - 2)));
          /* the strike in hand, marked on the spine */
          const mark = placed.find(r => isFocus(r.strike) || isHover(r.strike));
          if (mark) {
            ctx.fillStyle = ink.markFill;
            ctx.strokeStyle = ink.silver;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(clampX(mid - (mark.value / netMax) * lean), mark.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      /* THE FLOW LANE — THE LEVELS NAMED, THE REST A SILHOUETTE (Noah,
         2026-09-06: "still find the flow unappealing"). The flow is a running
         total, so drawn at every strike it is a smooth wedge — no rhythm, and
         the ramp across it turns into a rainbow. So the whole wedge sits
         behind in one quiet grey, and capsules are drawn ONLY where the number
         matters: the walls, the supreme, the pin, the kept strike and the one
         under the pointer — warm where that flow speeds the move up, cool where
         it slows it, the verb and the figure inside ("sell $118M"), or beside
         the capsule when it is too short to hold them. */
      if (showFlow && flow) {
        let onMax = 0;
        for (const r of placed) if (r.rung) onMax = Math.max(onMax, Math.abs(r.rung.flow));
        if (!onMax) onMax = flow.maxAbs || 1;
        const span = Math.max(1, flowR - flowL - 10);
        const x0 = flowL + 4;
        /* Every rung's length and colour eased, so the silhouette and the named
           capsules glide together */
        const eased = new Map<number, { len: number; h: number; fill: string; ink: string }>();
        for (const r of placed) {
          const g = r.rung;
          if (!g) continue;
          const mag = Math.abs(g.flow);
          const target = Math.max(barH, (mag / onMax) * span);
          eased.set(r.strike, ease(`f:${r.strike}`, target, heat(g.amplifies ? mag : -mag, onMax).fill, barH, barH));
        }
        /* The silhouette: the wedge above spot and the wedge below it, pinched to nothing at spot */
        const pts = placed.filter(r => r.rung).map(r => ({ x: x0 + Math.max(0, (eased.get(r.strike)?.len ?? barH) - barH), y: r.y }));
        if (spotY > HEAD_BAND && spotY < H - FOOT_BAND) pts.push({ x: x0, y: spotY });
        pts.sort((a, b) => a.y - b.y);
        if (pts.length > 1) {
          ctx.beginPath();
          ctx.moveTo(x0, pts[0].y);
          for (const q of pts) ctx.lineTo(q.x, q.y);
          ctx.lineTo(x0, pts[pts.length - 1].y);
          ctx.closePath();
          ctx.fillStyle = ink.silFill;
          ctx.fill();
          ctx.strokeStyle = ink.silStroke;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        /* The named strikes */
        const named = new Set<number>();
        const nameAt = (k: number | null | undefined) => {
          if (k == null) return;
          const row = placed.find(r => near(r.strike, k));
          if (!row || !row.rung || row.rung.flow === 0 || named.has(row.strike)) return;
          named.add(row.strike);
          const g = row.rung;
          const t = eased.get(row.strike);
          if (!t) return;
          const len = t.len;
          capsule(x0, row.y, len, t.fill, ringFor(row.strike), t.h);
          ctx.font = `600 9px ${FIG}`;
          const full = `${g.flow >= 0 ? 'buy' : 'sell'} ${fmtFlow(g.flow)}`;
          const fits = (s: string) => barH >= 10 && ctx.measureText(s).width + 12 <= len;
          /* The level's chip lives at this lane's right edge; a capsule that
             reaches it takes the name inside at its outer end instead */
          const lvl = levelAt(row.strike);
          if (lvl && x0 + len + 8 + chipW(lvl.words) > W - 6 && barH >= 10) {
            insideNamed.add(row.strike);
            figureIn(lvl.words, x0, len, row.y, t.ink, 'right', NAME_FONT);
            ctx.font = NAME_FONT;
            const nw = ctx.measureText(lvl.words).width;
            const short = fmtFlow(g.flow);
            if (nw + figW(full) + 20 <= len) figureIn(full, x0, len, row.y, t.ink, 'left');
            else if (nw + figW(short) + 20 <= len) figureIn(short, x0, len, row.y, t.ink, 'left');
            return;
          }
          if (fits(full)) figureIn(full, x0, len, row.y, t.ink, 'right');
          else if (fits(fmtFlow(g.flow))) figureIn(fmtFlow(g.flow), x0, len, row.y, t.ink, 'right');
          else {
            ctx.fillStyle = ink.ink2;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(full, x0 + len + 6, row.y + 0.5);
          }
        };
        nameAt(levels.callWall);
        nameAt(levels.putWall);
        nameAt(levels.supreme);
        nameAt(levels.pin);
        nameAt(focusPrice);
        nameAt(hv?.strike);
      }

      /* THE STRIKE COLUMN — the strike and its Δ from spot as one pair, centered in the column.
         A pair that will not fit falls back to strike at the left and Δ at the right. */
      ctx.textBaseline = 'middle';
      const cx = colL + colW / 2;
      const wide = colW === COL_W_WIDE;
      let lastLabelY = -1e9;
      placed.forEach((r, i) => {
        const hot = isFocus(r.strike) || isHover(r.strike);
        if (!labelled(i, r.strike)) return;
        if (!hot && Math.abs(r.y - lastLabelY) < LABEL_PITCH) return;
        if (spotOn && Math.abs(r.y - spotY) < 9) return; // the spot chip owns that height
        lastLabelY = r.y;
        const k = r.strike;
        const focus = isFocus(k);
        const strikeInk = focus ? ink.silver : near(k, levels.callWall) ? ink.callWall : near(k, levels.putWall) ? ink.putWall : near(k, levels.supreme) ? ink.supreme : near(k, pin) || isHover(k) ? ink.ink : wide ? ink.ink : ink.ink2;
        const label = fmtStrike(k);
        ctx.font = `${focus || wide ? '700 ' : ''}10px ${FIG}`;
        if (!wide) {
          ctx.fillStyle = strikeInk;
          ctx.textAlign = 'center';
          ctx.fillText(label, cx, r.y);
          return;
        }
        const d = ((k - spotPx) / spotPx) * 100;
        const dText = `${d > 0 ? '+' : ''}${d.toFixed(1)}%`;
        const sw = ctx.measureText(label).width;
        ctx.font = `11px ${FIG}`;
        const dw = ctx.measureText(dText).width;
        const gap = 8;
        ctx.textAlign = 'left';
        if (sw + gap + dw <= colW - 8) {
          const start = colL + (colW - (sw + gap + dw)) / 2;
          ctx.font = `700 10px ${FIG}`;
          ctx.fillStyle = strikeInk;
          ctx.fillText(label, start, r.y);
          ctx.font = `11px ${FIG}`;
          ctx.fillStyle = d > 0 ? 'rgb(var(--bull))' : d < 0 ? 'rgb(var(--bear))' : ink.ink3;
          ctx.fillText(dText, start + sw + gap, r.y);
        } else {
          ctx.font = `700 10px ${FIG}`;
          ctx.fillStyle = strikeInk;
          ctx.fillText(label, colL + 6, r.y);
          ctx.font = `11px ${FIG}`;
          ctx.fillStyle = d > 0 ? 'rgb(var(--bull))' : d < 0 ? 'rgb(var(--bear))' : ink.ink3;
          ctx.textAlign = 'right';
          ctx.fillText(dText, colR - 6, r.y);
        }
      });

      /* THE LEVEL NAMES — the cards' chips at the flow lane's right edge when
         that lane is drawn. The size lane is the ladder, so it marks a level the
         ladder's way: a stripe on the row's left edge in the level's colour, the
         strike label in that colour, and the name in the read line — never a
         chip over a leg's figure. */
      const chip = (k: number, words: string, c: string) => {
        const row = placed.find(r => near(r.strike, k));
        if (!row) return;
        if (showSize) {
          ctx.fillStyle = c;
          const sh = Math.max(4, Math.round(barH) + 2);
          /* the stripe on the panel's own left edge (the partner's), which is the column's when it comes first */
          ctx.fillRect(colFirst ? 0 : sizeL, Math.round(row.y - sh / 2), 2, sh);
        }
        if (!showFlow || insideNamed.has(row.strike)) return;
        ctx.font = `500 10px ${SANS}`;
        const w = Math.ceil(ctx.measureText(words).width) + 12;
        const x = W - 6 - w;
        const y = Math.round(row.y - 8) + 0.5;
        ctx.fillStyle = ink.chipGround;
        ctx.beginPath();
        ctx.roundRect(x, y, w, 16, 8);
        ctx.fill();
        ctx.fillStyle = ink.alpha(c, 0.14);
        ctx.fill();
        ctx.strokeStyle = ink.alpha(c, 0.5);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.textAlign = 'center';
        ctx.fillText(words, x + w / 2, row.y + 0.5);
      };
      chip(levels.callWall, 'Call wall', ink.callWall);
      chip(levels.putWall, 'Put wall', ink.putWall);
      if (!near(levels.supreme, levels.callWall) && !near(levels.supreme, levels.putWall)) chip(levels.supreme, 'Supreme', ink.supreme);
      if (Number.isFinite(pin) && !near(pin, levels.callWall) && !near(pin, levels.putWall) && !near(pin, levels.supreme)) chip(pin, 'Max OI', ink.ink2);

      /* THE SPOT CHIP — solid, in the column */
      if (spotOn) {
        const y = Math.round(spotY - 8);
        ctx.fillStyle = ink.spotChip;
        ctx.beginPath();
        ctx.roundRect(colL + 2, y, colW - 4, 16, 4);
        ctx.fill();
        ctx.fillStyle = ink.spotChipText;
        ctx.font = `700 10px ${FIG}`;
        ctx.textAlign = 'center';
        ctx.fillText(spotPx.toFixed(2), cx, spotY + 0.5);
      }

      /* THE MIRROR (Noah, 2026-09-06: "i love how this section zooms out… i
         want the opposite effect when zooming in… a zoom in bar by bar"): a
         size capsule whose strike has just left the view does not vanish — it
         shrinks back to a dot at the edge it left by, then goes; the entering
         glide run backwards. (The flow lane's entries are only the
         silhouette's memory and go at once.) A capsule that comes back
         mid-shrink simply grows again from where it was. */
      for (const [id, a] of anim) {
        if (touched.has(id)) continue;
        const isLeg = id.startsWith('p:') || id.startsWith('c:');
        if (!isLeg || !showSize) {
          anim.delete(id);
          continue;
        }
        const strike = Number(id.slice(2));
        const yRaw = yFor(strike);
        if (yRaw == null || !Number.isFinite(yRaw)) {
          anim.delete(id);
          continue;
        }
        /* a leg whose strike has left the view shrinks back into the centre line, then goes */
        a.len += (0 - a.len) * k;
        if (a.len < 0.5) {
          anim.delete(id);
          continue;
        }
        settled = false;
        const yc = Math.min(H - FOOT_BAND - a.h / 2, Math.max(HEAD_BAND + a.h / 2, yRaw));
        const laneW = ((showFlow ? Math.round((W - colW) * liveSplit) : W - colW) || 1);
        const mid = (colFirst ? colW : 0) + laneW / 2;
        const sign: 1 | -1 = id.startsWith('p:') ? 1 : -1;
        const [rr, gg, bb] = legRamp(sign, 0.5);
        ctx.fillStyle = `rgba(${rr},${gg},${bb},0.6)`;
        ctx.beginPath();
        ctx.roundRect(sign === 1 ? mid - a.len : mid, Math.round(yc - a.h / 2), a.len, a.h, 2);
        ctx.fill();
      }
      settledRef.current = settled;
      } finally {
        if (keep) raf = requestAnimationFrame(draw);
      }
    };
    const arm = () => { if (!raf) raf = requestAnimationFrame(draw); };
    railArmRef.current = arm;
    raf = requestAnimationFrame(draw);
    const host = rootRef.current;
    const onWheel = (e: WheelEvent) => {
      if (view !== 'ladder') return;
      const g = ladderGeom.current;
      const lv = ladderView.current;
      if (!lv.rows || !(g.height > 0) || !(g.step > 0)) return;
      e.preventDefault();
      const rect = host?.getBoundingClientRect();
      const y = rect ? e.clientY - rect.top : g.top + g.height / 2;
      const t = (y - g.top) / g.height;
      const at = lv.center + (0.5 - t) * lv.rows * g.step;
      const next = Math.min(g.height / 4, Math.max(8, lv.rows * (e.deltaY > 0 ? 1.15 : 1 / 1.15)));
      lv.rows = next;
      lv.center = at - (0.5 - t) * next * g.step;
      lv.touched = true;
      arm();
    };
    host?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(raf);
      host?.removeEventListener('wheel', onWheel);
      railArmRef.current = () => {};
    };
  }, [rows, maxAbs, legs, openRatio, mode, step, levels, flow, lane, focusPrice, projection, showSize, showFlow, vp, liveSplit, view, paper, ticker]);

  /* THE POINTER — the nearest strike by height, anywhere in the lanes */
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (quiet) return;
    const root = rootRef.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const y = e.clientY - r.top;
    const x = e.clientX - r.left;
    if (dragYRef.current != null && (e.buttons & 1)) {
      const dy = e.clientY - dragYRef.current;
      if (Math.abs(dy) > 2) {
        draggedRef.current = true;
        dragYRef.current = e.clientY;
        const g = ladderGeom.current;
        const lv = ladderView.current;
        if (lv.rows && g.height > 0) {
          lv.center += (dy / g.height) * lv.rows * g.step;
          lv.touched = true;
        }
        railArmRef.current();
      }
      return;
    }
    if (y < headBandRef.current) {
      if (hoverRef.current) setHover(null);
      return;
    }
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const row of placedRef.current) {
      const d = Math.abs(row.y - y);
      if (d < bestD) {
        bestD = d;
        best = row;
      }
    }
    if (!best) return;
    if (!hoverRef.current || !near(hoverRef.current.strike, best.strike) || Math.abs(hoverRef.current.x - x) > 2) setHover({ strike: best.strike, x, y: best.y, cx: e.clientX, cy: e.clientY });
    railArmRef.current();
  };
  const onLeave = () => {
    setHover(null);
    dragYRef.current = null;
  };
  const draggedRef = useRef(false);
  const dragYRef = useRef<number | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (view !== 'ladder' || quiet) return;
    const t = e.target as HTMLElement;
    if (t.closest('button, [data-profile-views], [data-profile-tools], [data-split]')) return;
    dragYRef.current = e.clientY;
    draggedRef.current = false;
  };
  const onPointerUp = () => {
    dragYRef.current = null;
  };
  const onClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (quiet) return;
    if (hoverRef.current && onSelect) onSelect(hoverRef.current.strike);
  };

  /* THE READ LINE (Noah, 2026-09-06: "the card on hover blocks the view of
     the flow") — the Exposure Ledger's answer to the same problem, NO floating
     card: one fixed line in the chart's time-axis band under the lanes, which
     covers nothing. The hovered strike first, else the kept one, else the
     hint. The swatches read the same on-screen scale the capsules use. */
  const readStrike = hover?.strike ?? focusPrice ?? null;
  const readRow = readStrike != null ? placedRef.current.find(r => near(r.strike, readStrike)) ?? null : null;
  /* The part the strike plays, named here — the size lane marks it with a stripe and its colour, never a chip. In the
     level's TOKEN (paletteInk.ts): the dark island's are these very inks, and a light ground cuts them deep. */
  const readRole = readRow
    ? near(readRow.strike, levels.callWall)
      ? { words: 'Call wall', c: TOKEN.CALL_WALL }
      : near(readRow.strike, levels.putWall)
        ? { words: 'Put wall', c: TOKEN.PUT_WALL }
        : near(readRow.strike, levels.supreme)
          ? { words: 'Supreme', c: TOKEN.SUPREME }
          : levels.pin != null && near(readRow.strike, levels.pin)
            ? { words: 'Max OI', c: 'rgb(var(--text-secondary))' }
            : null
    : null;
  const tapeLast = projection.current?.last() ?? null;
  const liveSpot = tapeLast != null && tapeLast > 0 ? tapeLast : levels.spot;
  /* The ladder uses the same pointer card as the calendar and the matrix. The strip along the
     bottom was a second read of the same strike, and it quoted a different price than the candle. */
  const cardOn = view === 'ladder' && !!hover && !!readRow;
  const cardRow = cardOn && readRow ? readRow : null;
  const cardLegs = cardRow ? legs?.get(cardRow.strike) ?? null : null;
  const cardLevel = cardRow ? rows.find(r => near(r.strike, cardRow.strike)) ?? null : null;
  const sinceOpen = cardRow && openRatio ? sinceOpenRead(openRatio.get(cardRow.strike)) : null;
  const cardKept = !!cardRow && focusPrice != null && near(focusPrice, cardRow.strike);
  const fromSpot = cardRow && liveSpot > 0 ? ((cardRow.strike - liveSpot) / liveSpot) * 100 : null;
  const card = cardRow && hover && (
    <PointerFollowCard
      start={{ x: hover.cx, y: hover.cy }}
      width={220}
      dense
      testId="data-profile-card"
      testValue={cardRow.strike}
      title={<>{ticker ? `${ticker} ` : ''}{fmtStrike(cardRow.strike)}</>}
      aside={fromSpot == null ? undefined : `${fromSpot > 0 ? '+' : ''}${fromSpot.toFixed(2)}%`}
      foot={cardKept ? 'Kept · click to let go' : 'Click to keep'}
    >
      {cardLegs && <CardRow k="Puts" v={Math.abs(cardLegs.put) > 0 ? fmtUsd(Math.abs(cardLegs.put)) : '—'} />}
      {cardLegs && <CardRow k="Calls" v={Math.abs(cardLegs.call) > 0 ? fmtUsd(Math.abs(cardLegs.call)) : '—'} />}
      <CardRow k="Net" v={cardRow.value === 0 ? '—' : fmtUsd(Math.abs(cardRow.value))} sub={cardRow.value === 0 ? undefined : cardRow.value > 0 ? words.pos : words.neg} />
      <CardRow k="Open int" v={cardLevel && (cardLevel.callOI != null || cardLevel.putOI != null) ? ((cardLevel.callOI ?? 0) + (cardLevel.putOI ?? 0)).toLocaleString('en-US') : '—'} />
      <CardRow k="Since open" v={sinceOpen == null ? '—' : sinceOpen.figure ?? sinceOpen.short} ink={sinceOpen == null ? undefined : sinceOpen.dir < 0 ? 'rgb(var(--bear))' : sinceOpen.dir > 0 ? 'rgb(var(--bull))' : undefined} />
      {readRole && <CardRow k="Level" v={readRole.words} ink={readRole.c} />}
    </PointerFollowCard>
  );

  /* HOW TO READ THIS (Noah, 2026-09-06: "how can someone know this info in the
     page?" — they couldn't): the two lanes defined in plain words, drawn as
     two figures in the panel's own hand, and today's walls read both ways —
     see ProfileGuide.tsx. */
  /* The door only — the host opens the guide as a FOCUS over the whole map
     box, the rest blurred behind it (Noah, 2026-09-06: "a focus and blur
     effect on the how to read card"), the way the trader's clock keeps a
     phase. */
  /* Narrow, the door is its icon alone and the Lanes card waits for room —
     a docked Terrain pane's panel is 132px, and the words would push the ×
     off the edge. The card comes back first (250px: a three-up pane's panel
     dragged to its 60% ceiling holds it), the door's words after. */
  const narrow = panelW > 0 && panelW < 320;
  const roomForLanes = panelW >= 250;
  const guide = onGuide && (
    <button
      type="button"
      data-profile-guide
      aria-pressed={guideOpen}
      onClick={onGuide}
      aria-label="How to read"
      className="pointer-events-auto shrink-0 inline-flex items-center gap-1 h-6 px-1.5 rounded-md text-t10 text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] aria-pressed:text-textPrimary transition-colors"
      title="What the two lanes mean"
    >
      <Info className="w-3 h-3" />
      {!narrow && 'How to read'}
    </button>
  );
  /* THE HEAD'S TOOLS (Noah, 2026-09-06): the Lanes card when the host has no row of its own
     for it, the Vol switch, the door — and the ×, which keeps the first row's right edge
     whatever the tier. Below the full tier the head is TWO ROWS: the view tabs and the host's
     card on the first, these tools on the second (a 340 head cannot hold them all on one). */
  const twoRowHead = tier !== 'full';
  const laneTools = (
    <>
      {onLane && (roomForLanes || twoRowHead) && <DropdownSelect label="Lanes" value={lane} options={LANE_OPTIONS} onChange={onLane} title="What the panel draws" testId="lanes" align={twoRowHead ? 'start' : 'end'} size="sm" />}
      {ticker && showSize && (
        <button
          type="button"
          onClick={() => setShowVol(v => !v)}
          aria-pressed={showVol}
          title="Volume profile — the session's traded volume by price, VPOC and value area, under the size lane"
          className={`shrink-0 h-6 rounded px-1.5 font-mono text-t9 font-bold uppercase tracking-widest transition-colors ${
            showVol ? 'bg-ink/[0.14] text-textPrimary' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.08]'
          }`}
          data-profile-vol
        >
          Vol
        </button>
      )}
      {guide}
    </>
  );
  const tabsRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const el = tabsRef.current;
    if (!el) return;
    return attachScrollMore(el);
  }, [showSize, onField]);
  /* the tab in hand is always in view in a rail narrower than its tabs */
  useEffect(() => {
    const el = tabsRef.current;
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !on) return;
    const left = on.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft) el.scrollLeft = left - 8;
    else if (left + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = left + on.offsetWidth - el.clientWidth + 8;
  }, [view, shownW, showSize]);
  const closeDoor = onClose && (
    <button
      type="button"
      onClick={onClose}
      aria-label={ticker ? `Hide the ${ticker} panel` : 'Hide this panel'}
      title={closeHint}
      className="hit-24 shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.08] transition-colors"
      data-profile-close
    >
      <X className="w-3 h-3" />
    </button>
  );
  /* THE VIEW TABS in the Expiry card's own clothes — the dropdown trigger's chip, the one in
     hand wearing the silver edge (Noah, 2026-09-16: "those buttons should match the formatting
     of the expiry button") */
  /* A narrow panel (a pane of a 2–4 layout) keeps every tab whole: the rail takes the row's room, scrolls sideways
     inside it with a fade at the edge that has more (ui/scrollMore.ts), and never runs under the close door */
  const narrowTabs = (shownW ?? rootRef.current?.clientWidth ?? 999) < 420;
  const viewTabs = showSize && (
    <span ref={tabsRef} className="pointer-events-auto min-w-0 max-w-full inline-flex items-center overflow-x-auto scroll-row" data-profile-views data-profile-view-now={view} title="Ladder: the put and call legs at each strike · Net: the matrix — put, call and net at every strike · GEX: the calendar — the book by expiry, every greek">
      <FilterTabs options={VIEW_TABS} value={view} onChange={setView} ariaLabel="Ladder, Net or GEX" paper={paper} size={narrowTabs ? 'sm' : 'md'} />
    </span>
  );

  return (
    <div
      ref={rootRef}
      className={`relative h-full select-none bg-panel ${sized ? 'shrink-0' : 'flex-1 min-w-0'} ${className}`}
      style={sized ? { width: shownW } : undefined}
      onPointerMove={onMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onDoubleClick={() => {
        if (view !== 'ladder') return;
        ladderView.current.touched = false;
        railArmRef.current();
      }}
      onPointerLeave={onLeave}
      onClick={onClick}
      /* THE PANEL'S OWN ISLAND on the page's theme (2026-10-17): the pane's box is a dark island stamped with the
         chart's ground, and this root re-stamps the page's, so the head, the rail, the field in it and the canvas's
         inks all read one set — the page's — whatever the tape beside them wears */
      data-theme={paper ? 'light' : 'dark'}
      data-profile-panel
      data-lane={lane}
      aria-label={ticker ? `${ticker} exposure by strike` : undefined}
    >
      {/* THE GRIP IS SEEN (Noah, 2026-10-17: "i have to find the horizontal drag line because i cant see it … there
          should be a slight hinted vertical line that shows the divide between the two and thats where i should be
          able to drag"): the panel's own left edge, with a hairline down its whole height at rest — the divide — that
          brightens under the pointer and stays bright while it drags. The hand lands on the line it sees. */}
      {sized && onWidth && (
        <span
          onPointerDown={onGripDown}
          onDoubleClick={() => onWidth(restWidth ?? PROFILE_MIN_W)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize the panel — double-click to reset"
          title="Drag to resize · double-click to reset"
          className="group/grip absolute left-0 inset-y-0 -ml-1 w-2 z-30 cursor-col-resize"
          data-profile-grip
          data-profile-grip-live={dragW != null || undefined}
        >
          <span
            aria-hidden="true"
            className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors duration-150 ${dragW != null ? 'bg-silver/70' : 'bg-ink/[0.16] group-hover/grip:bg-silver/70'}`}
            data-profile-grip-line
          />
        </span>
      )}
      {/* The sash between the two lanes, over the strike column's left edge —
          the lanes' split, live under the hand */}
      {bothLanes && (
        <span
          onPointerDown={onSplitDown}
          onDoubleClick={() => setSplitPref(SPLIT_DEFAULT)}
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to widen one lane and narrow the other — double-click to reset"
          title="Drag to widen one lane and narrow the other · double-click to reset"
          className="absolute inset-y-0 -ml-1 w-2 z-30 cursor-col-resize hover:bg-ink/[0.10] transition-colors"
          style={{ left: `calc((100% - ${colW}px) * ${liveSplit})` }}
          data-profile-split-grip
        />
      )}
      <canvas ref={canvasRef} className="absolute inset-0 block" aria-hidden />
      {/* THE HEAD — the view tabs and the host's Expiry card first, the lanes' names after them
          on the full tier, the tools at the end; below the full tier a second row takes the
          tools, and the column heads under it name the lanes */}
      <div
        ref={headRef}
        className={`absolute inset-x-0 top-0 flex flex-col px-2 ${quiet ? 'pointer-events-auto' : 'pointer-events-none'}`}
        style={quiet ? undefined : { height: twoRowHead ? HEAD_TOP_2 : HEAD_TOP }}
        data-profile-head
        data-head-rows={quiet ? undefined : twoRowHead ? 2 : 1}
      >
        {/* on GEX the row WRAPS: the tabs, then the field's cards through the slot, the close door pinned at the right */}
        <div className={`flex items-center gap-1.5 min-w-0 ${quiet ? 'flex-wrap gap-y-1 py-[3px] pr-7' : ''}`} style={quiet ? { minHeight: HEAD_TOP } : { height: HEAD_TOP }}>
          {viewTabs}
          {onField && <div ref={setStripSlot} className="contents" data-profile-head-slot />}
          {headCard && !quiet && (
            <span className="pointer-events-auto shrink-0 inline-flex" data-profile-head-card>
              {headCard}
            </span>
          )}
          {!twoRowHead && showSize && !quiet && (
            <span className="min-w-0 flex-1 flex items-center justify-center gap-2 text-t10 text-textMuted" data-lane-head="size">
              <Term k="Size at a strike" className="pointer-events-auto truncate">
                Size · {greek}
                <span className="text-textMuted"> · puts ◂ ▸ calls</span>
              </Term>
            </span>
          )}
          {!twoRowHead && showFlow && !quiet && (
            <span className="min-w-0 flex-1 flex items-center justify-center gap-2 text-t10 text-textMuted" data-lane-head="flow">
              <Term k="What a move forces" className="pointer-events-auto truncate">
                What a move forces <span className="text-textMuted">· from gamma</span>
              </Term>
            </span>
          )}
          <span className={quiet ? 'absolute right-1.5 top-[3px] shrink-0 flex items-center pointer-events-auto' : 'ml-auto shrink-0 flex items-center gap-1 pointer-events-auto'} data-profile-tools={twoRowHead ? undefined : ''}>
            {!twoRowHead && !quiet && laneTools}
            {closeDoor}
          </span>
        </div>
        {twoRowHead && !quiet && (
          <div className="flex items-center gap-1 pointer-events-auto" style={{ height: HEAD_TOP_2 - HEAD_TOP }} data-profile-tools>
            {laneTools}
          </div>
        )}
      </div>
      {view === 'ladder' && card}
      {/* THE GEX VIEW: the Map's book — the calendar or the matrix — on the field's own band, the whole panel under the
          tabs; the panel's pointer and click stay out of it (the field keeps its own hover and its own kept strike) */}
      {/* no stopPropagation on the box: the house's pointer card follows the pointer through a window listener, and a
          stop here starved it (Noah: "the hover effect … doesnt move with the mouse"); the panel's own handlers are
          gated on the view instead */}
      {onField && gexSnap && (gexSnap.chain?.length ?? 0) > 0 && (
        <div className="absolute inset-x-0 bottom-0 overflow-y-auto overflow-x-hidden pointer-events-auto select-text bg-panel" style={{ top: headH }} data-profile-gex>
          <ExposureField snapshot={gexSnap} toolbar="panel" viewLock={fieldView} legsLock={view === 'net' ? 'all' : undefined} selectedStrike={focusPrice ?? null} onSelectStrike={onSelect} fullMode="portal" narrowHint="widen the panel or pick fewer" headSlot={stripSlot} />
        </div>
      )}
      {/* THE REGIME AND BUILDING TABS: their own views under the head, the canvas quiet behind them */}
      {view === 'regime' && (
        <div className="absolute inset-x-0 bottom-0 pointer-events-auto select-text bg-panel" style={{ top: headH }} data-profile-regime>
          <RegimeTabs.Regime mode={mode} paper={paper} />
        </div>
      )}
      {view === 'building' && ticker && (
        <div className="absolute inset-x-0 bottom-0 pointer-events-auto select-text bg-panel" style={{ top: headH }} data-profile-building>
          <RailBuilding ticker={ticker} focus={focusPrice ?? null} onPick={onSelect} />
        </div>
      )}
      {onField && (!gexSnap || (gexSnap.chain?.length ?? 0) === 0) && (
        <p className="absolute inset-x-0 bottom-0 flex items-center justify-center px-6 text-center font-mono text-t12 text-textSecondary" style={{ top: headH }} data-profile-gex-empty>
          No nodes on this name. The book comes back when the chain quotes.
        </p>
      )}
    </div>
  );
};

export default ProfilePanel;
