/* One shell for both practice desks: the account strip, the house chart with its top row, the measured heights,
   the takeover panel, two charts side by side, the clock and the book's rows. A desk only says what its kind is. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { SayPage } from '../layout/PageMeta';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Columns2, Maximize2, Minimize2, PanelRightClose, PanelRightOpen, SkipForward } from 'lucide-react';
import ChartToolbar from '../gex/ChartToolbar';
import PaneFoot from '../gex/PaneFoot';
import ReplayStrip from '../gex/ReplayStrip';
import StrikeChart, { DEFAULT_INDICATORS, DEFAULT_OVERLAYS, type ChartIndicators, type ChartLayerApi, type ChartOverlays, type ChartStyle, type ChartTape, type CrosshairSync, type PriceScale, type TradeMark } from '../gex/StrikeChart';
import { chartGround, useCandleThemeKey } from '../gex/candleTheme';
import { Fact } from '../trace/traceFrame';
import CardTabs from '../ui/CardTabs';
import CompanyLogo from '../ui/CompanyLogo';
import { useFadeClose } from '../ui/useFadeClose';
import DayCard from './DayCard';
import PositionLayer, { type PositionLayerProps } from './PositionLayer';
import RenameDoor from './RenameDoor';
import { dirInk, usd, usdSigned } from './words';
import { DOCK_ROOM, useEditorDock } from '../../data/editorDock';
import { dayNumber, daysBetween } from '../../data/review/history';
import { playStep } from '../../data/review/engine';
import type { OpeningRange } from '../../data/sessionLevels';
import { tfMinutes, type Timeframe } from '../../data/timeframe';
import type { KeyLevels } from '../../types/gex';

/* ---- the desk's looks, shared with the cards a desk brings ---- */
export const card = 'desk-card border border-borderSubtle rounded-md bg-panel overflow-clip';
export const head = 'h-9 px-4 flex items-center gap-3 border-b border-borderSubtle/70';
export const headWord = 'font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary';
export const smallDoor = 'inline-flex items-center leading-normal align-middle h-6 px-2 rounded-md border border-borderSubtle font-mono text-t10 text-textSecondary hover:text-textPrimary hover:border-borderMuted disabled:opacity-30 disabled:cursor-not-allowed transition-colors';
/** A door in the chart's top row — the house toolbar's own button, so the desk's doors and the toolbar's read as one row */
export const barDoor = 'inline-flex items-center gap-1.5 px-2 py-1 rounded font-mono text-t10 uppercase tracking-wider text-textMuted hover:text-textPrimary hover:bg-ink/[0.03] disabled:opacity-30 disabled:cursor-not-allowed transition-colors';

/* The desk's heights. The book is never shorter than BOOK_PX — its tabs, its column names and three rows — and
   grows with its rows; the desk is never shorter than a two-line top row, the chart's own floor, and the book. */
const BOOK_PX = 200;
const DESK_MIN_PX = 730;
const DESK_FOOT_PX = 12;
/** The takeover's panel, and the least the chart is left with beside it and the script editor */
const PANEL_PX = 440;
const TAPE_FLOOR_PX = 760;
/** The least each chart keeps for the two to stand side by side */
const SPLIT_PANE_PX = 560;
/* A card that grows to fill its column (the Live Chart's order on a future, `data-review-ticket-card="grow"`) is
   as tall as the column — so its OWN height is read from what is in it: each child at its own height (a column's
   child the same way, all the way down), the gaps between them and the padding round them. */
function ownHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  if (!/flex/.test(cs.display) || !cs.flexDirection.startsWith('column')) return el.offsetHeight;
  const px = (v: string) => parseFloat(v) || 0;
  const kids = ([...el.children] as HTMLElement[]).filter(k => {
    const s = getComputedStyle(k);
    return s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed';
  });
  return px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth) + kids.reduce((a, k) => a + ownHeight(k), 0) + px(cs.rowGap) * Math.max(0, kids.length - 1);
}

/** A grid's shapes (Paper's layouts): how its panes are laid out, as the grid's classes */
export type GridLayout = '1' | '2h' | '2v' | '3' | '4';
const GRID_CLASS: Record<GridLayout, string> = { '1': 'grid-cols-1 grid-rows-1', '2h': 'grid-cols-2 grid-rows-1', '2v': 'grid-cols-1 grid-rows-2', '3': 'grid-cols-2 grid-rows-2', '4': 'grid-cols-2 grid-rows-2' };
/** One pane of a grid: whose chart, at what interval — and what floats at its foot (a position's bar) */
interface GridPane {
  key: string;
  name: DeskName;
  timeframe: Timeframe;
  foot?: ReactNode;
}
/* The top row's widths, measured: the name, the toolbar with its words and the desk's doors need 1,113px in one
   row; the takeover's account figures add 215, and the third figure (the cash) 115 more. */
const HEAD_FULL_PX = 1130;
const HEAD_ACCOUNT_PX = 215;
const HEAD_CASH_PX = 135;
/** What a second name's capsule still costs the row once the row has given it room (`tight`) */
const HEAD_NAME_PX = 15;
/** The RP&L and UP&L badges, which ride the takeover's strip after the intervals (a hairline and two badges) */
const HEAD_PNL_PX = 230;

/* ---- the chart's settings: the reader's, kept from one session to the next, a set per kind of desk ---- */
interface ChartPrefs {
  timeframe: Timeframe;
  chartStyle: ChartStyle;
  indicators: ChartIndicators;
  overlays: ChartOverlays;
  priceScale: PriceScale;
  sessionOr: OpeningRange;
  /** Two names in the takeover: their charts side by side */
  split: boolean;
}
/** Every overlay off but the volume: the rest are the reader's to switch on */
const overlaysAtRest = (): ChartOverlays => ({ ...(Object.fromEntries(Object.keys(DEFAULT_OVERLAYS).map(k => [k, false])) as unknown as ChartOverlays), volume: true });
function readPrefs(key: string, timeframes: Timeframe[], overlayKeys: (keyof ChartOverlays)[]): ChartPrefs {
  const rest: ChartPrefs = { timeframe: '5m', chartStyle: 'candles', indicators: DEFAULT_INDICATORS, overlays: overlaysAtRest(), priceScale: 'normal', sessionOr: 15, split: true };
  try {
    const kept = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<ChartPrefs> | null;
    if (!kept) return rest;
    const overlays = overlaysAtRest();
    for (const k of overlayKeys) if (typeof kept.overlays?.[k] === 'boolean') overlays[k] = kept.overlays[k];
    return { ...rest, ...kept, timeframe: kept.timeframe && timeframes.includes(kept.timeframe) ? kept.timeframe : '5m', indicators: { ...DEFAULT_INDICATORS, ...kept.indicators }, overlays };
  } catch {
    return rest;
  }
}

/** One of the session's names (two at most), as the clock stands */
export interface DeskName {
  symbol: string;
  /** Its long name — a tooltip's */
  title: string;
  /** What it is called where it stands alone: the ticker, or a future's front month (ESM6) */
  label: string;
  priceWords: string;
  /** Since the day's open, in percent */
  dayPct: number;
  /** Positions open in it */
  held: number;
  /** What the chart draws — none: the live chart of `symbol` (a desk with no clock) */
  tape?: ChartTape;
  levels: KeyLevels;
  /** What is drawn over its chart: the fills, the position, its ways out — and what a drag or a × does */
  layer: Omit<PositionLayerProps, 'api' | 'ticker' | 'minutes'>;
  /** A long or a short drawn on its chart, placed (StrikeChart `onTradeMark`) */
  onTradeMark?: (mark: TradeMark) => void;
  /** What its chart says at its top left, after its name — the RP&L and UP&L badges (PnlBadges); in the full SCREEN
      they ride the top strip after the intervals instead, the chart's own name borderless at its left wall */
  corner?: ReactNode;
}

/** The desk's hands, as this render has them — what a desk's own doors, keys and notices reach for */
interface DeskHands {
  /** Stop the clock and put it there (clamped to the day) */
  seek: (minute: number, day?: string) => void;
  /** The clock is playing */
  playing: boolean;
  /** The top row has shed its words */
  compact: boolean;
  /** …or a second name's capsule is being paid for by words */
  tight: boolean;
  headW: number;
}

interface DeskFact {
  label: string;
  testId: string;
  node: ReactNode;
}

interface DeskShellProps {
  /** On a phone the desk's cards (the account, the chain and its order) come before the tape */
  phoneSideFirst?: boolean;
  session: { id: string; name: string; startDay?: string };
  kind?: 'futures' | 'paper';
  onRename?: (name: string) => void;
  /** The line under the session's name */
  subline?: string;
  /** The account strip's figures, in order */
  facts?: DeskFact[];
  /** A desk's OWN account strip, in place of the session's (the live paper desk's) */
  strip?: ReactNode;
  /** What stands where the head's single name would (a picker of the name on the desk) */
  picker?: ReactNode;
  /** The line under the desk */
  foot?: string;
  /** The live chart's heartbeat — bumped every tick of the feed, where there is no `clock` */
  revision?: number;
  /** One to four charts (see the head note) — in place of the names' own charts */
  grid?: {
    layout: GridLayout;
    panes: GridPane[];
    active: number;
    onActive: (i: number) => void;
    onTimeframe: (i: number, tf: Timeframe) => void;
    /** The crosshair travels between the panes */
    crosshair: boolean;
  };
  /** The takeover's head: what the account is worth, what is open — and a third figure while there is room */
  account: { equity: number; openPnl: number; third?: { label: string; value: string } };

  names: DeskName[];
  active: string;
  onSwitch: (symbol: string) => void;
  /** What the name switch is, for a screen reader */
  switchLabel: string;
  /** A capsule's logo and the pane's — a future is named by its letters already */
  logos?: boolean;
  /** What says a name holds something: how many (options), or that it does (a future holds one position a product) */
  heldAs?: 'count' | 'dot';

  /** THE CHART: where its settings are kept, and what this kind of tape can make */
  prefsKey: string;
  paneIds: [string, string];
  timeframes: Timeframe[];
  overlayKeys: (keyof ChartOverlays)[];

  /** THE CLOCK — none on a live desk: no replay bar, no jumps, no clock keys */
  clock?: {
    day: string;
    minute: number;
    /** The last minute the clock can stand on, and the minutes in the day */
    lastMin: number;
    dayMin: number;
    /** No further back than this, and the day after this one (none at the tape's end) */
    floorDay: string;
    tomorrow: string | null;
    /** The moment, and a minute's clock */
    words: string;
    wordsAt: (minute: number) => string;
    /** The day's marks on the bar, where an hour a mark is too many */
    marks?: { u: number; label: string }[];
    /** The engine's: it refuses what the rules refuse */
    move: (to: { day: string; minute: number }) => void;
    /** The reader's roll-over (set at the bell): playing, the clock stands on the bell a moment, then opens the next
        day and keeps playing — what "Open the next day" does (engine `playStep`) */
    roll?: boolean;
  };
  goToTitle?: string;
  nextDayTitle?: string;
  /** The desk's own jumps, between Go to and Next day */
  doors?: (hands: DeskHands) => ReactNode;
  /** What stands beside the chart, inside the tape — the Live Chart's ladder on a future: the chart gives it the
      room while it stands and takes it back when it goes (page and full screen alike) */
  chartSide?: ReactNode;
  /** The desk's own keys, by `KeyboardEvent.key` */
  keys?: Record<string, (hands: DeskHands) => void>;
  /** Over the tape: what this kind of day has to say (an option's bell) */
  notice?: (hands: DeskHands) => ReactNode;

  /** The cards at the right — the takeover's panel. `sideMinPx`: the least the card above the ticket keeps */
  full: boolean;
  /** The full screen fills the screen edge to edge: no padding round it, its chart and cards on hairlines (see the
      head note) */
  fullBleed?: boolean;
  /** The right column's width — the Live Chart widens it for a name's options chain; the takeover's panel takes the
      same */
  sideWidth?: number;
  onFull: (full: boolean) => void;
  side: ReactNode;
  sideMinPx: number;
  /** What the panel is called on its doors ("the chain follows the chart you touch"), and what it holds */
  panelWord: string;
  panelTitle: string;

  /** THE BOOK */
  tab: 'open' | 'orders' | 'closed';
  onTab: (tab: 'open' | 'orders' | 'closed') => void;
  counts: { open: number; working: number; closed: number };
  /** The rows of the tab in hand */
  book: ReactNode;
}

/** How long the playing clock stands on the bell before a roll-over opens the next day: six ticks, 1.5 s */
const BELL_HOLD_TICKS = 6;
/** …and how often it asks again while the next day's quotes have not loaded: sixty ticks, 15 s */
const ROLL_RETRY_TICKS = 60;

/** That address holds no session of this browser's */
export const DeskMissing = () => (
  <div className={`${card} px-6 py-14 text-center`} data-review-desk="missing">
    <p className="text-t13 text-textPrimary">That session is not on this machine.</p>
    <p className="mt-1 text-t11 text-textMuted">Sessions are kept in this browser until accounts carry them.</p>
    <Link to="/practice/backtest" className="mt-4 inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors">
      Your sessions <ArrowRight className="w-3 h-3" />
    </Link>
  </div>
);

const DeskShell = ({ phoneSideFirst = false, session, kind, onRename, subline = '', facts = [], strip: ownStrip, picker, foot, revision, grid, account, names, active, onSwitch, switchLabel, logos = false, heldAs = 'count', prefsKey, paneIds, timeframes, overlayKeys, clock, goToTitle = '', nextDayTitle = '', doors, chartSide, keys: ownKeys, notice, full, onFull, fullBleed = false, sideWidth = PANEL_PX, side, sideMinPx, panelWord, panelTitle, tab, onTab, counts, book }: DeskShellProps) => {
  const navigate = useNavigate();
  const themeKey = useCandleThemeKey();
  const [playing, setPlaying] = useState(false);
  const [pace, setPace] = useState(60);
  const [prefs, setPrefs] = useState<ChartPrefs>(() => readPrefs(prefsKey, timeframes, overlayKeys));
  const setPref = <K extends keyof ChartPrefs>(k: K, v: ChartPrefs[K]) =>
    setPrefs(p => {
      const next = { ...p, [k]: v };
      try {
        localStorage.setItem(prefsKey, JSON.stringify(next));
      } catch {
        /* a private window: the settings last as long as the page */
      }
      return next;
    });
  /** The name whose chart has the pencil in hand (two charts, one pencil) */
  const [drawingName, setDrawingName] = useState<string | null>(null);
  /** Each chart's hands, by name — the clock's bar across two charts reads the first one's price pane */
  const apis = useRef<Record<string, ChartLayerApi>>({});
  const exportRefA = useRef<(() => void) | null>(null);
  const exportRefB = useRef<(() => void) | null>(null);
  /* a grid's panes: an exporter each, and the crosshair's sinks (Terrain's rule — only the moment travels) */
  const gridExports = useRef<Record<string, { current: (() => void) | null }>>({});
  const gridExport = (key: string) => (gridExports.current[key] ??= { current: null });
  const sinks = useRef(new Map<string, CrosshairSync>()).current;
  const crossFrom = useRef<string | null>(null);
  const emitCross = (key: string, time: Parameters<CrosshairSync>[0]) => {
    /* a leave from a pane that is not the source is stale: the pointer went straight onto the next one */
    if (time === null && crossFrom.current !== key) return;
    crossFrom.current = time === null ? null : key;
    for (const [k, apply] of sinks) if (k !== key) apply(time);
  };
  /* the top row sheds its words when the tape is too narrow for them — measured, not typed */
  const headRef = useRef<HTMLDivElement | null>(null);
  const [headW, setHeadW] = useState(1400);
  /** The widest the row has been seen to WRAP at with its words on: at or under it, the toolbar sheds them */
  const [wrapW, setWrapW] = useState(0);

  /* THE TAKEOVER: the tape is the screen, the desk's cards a panel at its right */
  const [panelOpen, setPanelOpen] = useState(true);
  const { closing, close } = useFadeClose(() => onFull(false));
  /* the script editor takes the takeover's right edge; where that leaves the chart too little, the panel steps aside for it */
  const dock = useEditorDock();
  const panelStoodDown = useRef(false);
  useEffect(() => {
    if (!full) return;
    if (dock.open && window.innerWidth - dock.width - PANEL_PX < TAPE_FLOOR_PX) {
      setPanelOpen(open => {
        if (open) panelStoodDown.current = true;
        return false;
      });
    } else if (!dock.open && panelStoodDown.current) {
      panelStoodDown.current = false;
      setPanelOpen(true);
    }
  }, [full, dock.open, dock.width]);
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full, close]);

  /* THE CLOCK: session seconds a real second (the replay bar's paces), spent a whole minute at a time */
  const live = useRef({ clock, pace });
  live.current = { clock, pace };
  useEffect(() => {
    if (!playing || !live.current.clock) return;
    let owed = 0;
    /* ticks stood on the bell, and the day already rolled from (the next day's loads may take a while: asked once) */
    let atBell = 0;
    let rolled = '';
    const t = window.setInterval(() => {
      const { clock: c, pace: p } = live.current;
      if (!c) return;
      if (c.minute >= c.lastMin) {
        const to = playStep(c, 0, !!c.roll, c.tomorrow);
        if (!to) return setPlaying(false);
        /* the bell is seen for a moment, then the next session opens — asked once, and again every 15 s while the clock
           still stands on this bell (the terminal was away: the move waits on the recorded days) */
        atBell++;
        if (atBell < BELL_HOLD_TICKS || (rolled === c.day && atBell % ROLL_RETRY_TICKS !== 0)) return;
        rolled = c.day;
        owed = 0;
        c.move(to);
        return;
      }
      atBell = 0;
      owed += p * 0.25;
      const mins = Math.floor(owed / 60);
      if (mins < 1) return;
      owed -= mins * 60;
      const to = playStep(c, mins, !!c.roll, c.tomorrow);
      if (!to) return setPlaying(false);
      c.move(to);
      if (to.minute >= c.lastMin && !(c.roll && c.tomorrow)) setPlaying(false);
    }, 250);
    return () => window.clearInterval(t);
  }, [playing]);
  /** Play is offered while the day has minutes left — or, rolling over, while the tape has a next day */
  const canPlay = !!clock && (clock.minute < clock.lastMin || (!!clock.roll && !!clock.tomorrow));
  const seek = (minute: number, day = clock?.day ?? '') => {
    setPlaying(false);
    if (clock) clock.move({ day, minute: Math.max(0, Math.min(clock.lastMin, minute)) });
  };

  /* The desk's one height, measured: what the page's scroller leaves under whatever is above the grid — or what
     the side card's floor and the ticket need, when that is more. Read again when the window, the account strip or
     the ticket changes size. */
  const gridRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const main = grid?.closest('main');
    if (!grid || !main || full) return;
    const ro = new ResizeObserver(() => set());
    const set = () => {
      const ticketEl = grid.querySelector<HTMLElement>('[data-review-ticket-card]');
      const grows = ticketEl?.dataset.reviewTicketCard === 'grow';
      /* a growing card's rows change size without the card doing so: they are watched too, as they come */
      if (ticketEl && grows) for (const k of ticketEl.children) [k, ...k.children].forEach(x => ro.observe(x));
      const top = grid.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
      const fit = main.clientHeight - top - DESK_FOOT_PX;
      const right = sideMinPx + 10 + (ticketEl ? (grows ? ownHeight(ticketEl) : ticketEl.offsetHeight) : 0);
      /* the TAPE's height: the desk's, less the book's floor. The book may grow past its floor; the tape does not shrink. */
      grid.style.setProperty('--tape-h', `${Math.round(Math.max(DESK_MIN_PX, fit, right)) - 10 - BOOK_PX}px`);
    };
    set();
    ro.observe(main);
    const ticketEl = grid.querySelector<HTMLElement>('[data-review-ticket-card]');
    if (ticketEl) ro.observe(ticketEl);
    const above = grid.previousElementSibling;
    if (above) ro.observe(above);
    /* …and a row that comes or goes (a limit's price, a second target) is read again */
    const mo = ticketEl?.dataset.reviewTicketCard === 'grow' ? new MutationObserver(() => set()) : null;
    if (mo && ticketEl) mo.observe(ticketEl, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo?.disconnect();
    };
  }, [full, session.id, sideMinPx]);
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return;
    const set = () => setHeadW(el.clientWidth);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [full, session.id]);
  const two = names.length > 1;
  const gridOn = grid?.panes[Math.min(grid.active, grid.panes.length - 1)];
  /* The full screen's rp&L · UP&L, in the strip between the intervals and the indicators — the chart on the desk's */
  const stripCorner = full ? (gridOn ? gridOn.name.corner : (names.find(n => n.symbol === active) ?? names[0])?.corner) : undefined;
  const headBase = HEAD_FULL_PX + (full ? HEAD_ACCOUNT_PX : 0) + (two ? HEAD_NAME_PX : 0) + (stripCorner ? HEAD_PNL_PX : 0);
  /* the row wrapped with its words on: remember the width, and shed them at or under it (a wider row tries again) */
  useLayoutEffect(() => {
    const el = headRef.current;
    if (!el) return;
    if (headW > wrapW && headW >= headBase && el.offsetHeight > 44) setWrapW(headW);
  });
  const nameKey = names.map(n => n.symbol).join('+');
  useEffect(() => setWrapW(0), [nameKey, full, prefs.split]);

  const on = names.find(n => n.symbol === active) ?? names[0];
  const compact = headW <= wrapW || headW < headBase;
  const tight = two && !compact;
  /* Two charts side by side: the takeover, two names, the reader's switch on, and room for both (never over a
     desk's own grid) */
  const split = !grid && full && two && prefs.split && headW >= SPLIT_PANE_PX * 2;
  const shown = split ? names : [on];
  const paneIdOf = (n: DeskName) => paneIds[names.indexOf(n) <= 0 ? 0 : 1];
  const exportOf = (n: DeskName) => (names.indexOf(n) <= 0 ? exportRefA : exportRefB);
  const hands: DeskHands = { seek, playing, compact, tight, headW };

  /* THE KEYS. Read through a ref so the listener is bound once and always sees this render's hands. */
  const keyHands = useRef<Record<string, (shift: boolean) => void>>({});
  keyHands.current = {
    ...(clock
      ? {
          ' ': () => setPlaying(p => !p && canPlay),
          ArrowRight: (shift: boolean) => seek(clock.minute + (shift ? 5 : 1)),
          ArrowLeft: (shift: boolean) => seek(clock.minute - (shift ? 5 : 1)),
          End: () => seek(clock.lastMin),
          n: () => clock.tomorrow && seek(0, clock.tomorrow),
        }
      : {}),
    f: () => (full ? close() : onFull(true)),
    d: () => setDrawingName(n => (n ? null : gridOn ? gridOn.key : on.symbol)),
    t: () => document.querySelector<HTMLInputElement>('[data-ticket-field="qty"]')?.select(),
    '1': () => (grid ? grid.onActive(0) : names[0] && onSwitch(names[0].symbol)),
    '2': () => (grid ? grid.panes[1] && grid.onActive(1) : names[1] && onSwitch(names[1].symbol)),
    ...(grid ? { '3': () => grid.panes[2] && grid.onActive(2), '4': () => grid.panes[3] && grid.onActive(3) } : {}),
    '\\': () => full && setPanelOpen(v => !v),
    ...Object.fromEntries(Object.entries(ownKeys ?? {}).map(([k, fn]) => [k, () => fn(hands)])),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      /* a field has the caret, or something is open over the desk (a menu, a card, the script library): the keys are theirs */
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.getAttribute('role') === 'slider')) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return;
      const fn = keyHands.current[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!fn) return;
      e.preventDefault();
      /* a button that still has the focus would take Space for itself on the way up */
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      fn(e.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* the session's clock, as a bar — one of it, wherever it floats (a live desk has none) */
  const strip = clock && (
    <ReplayStrip
      phase="play"
      pos={(clock.minute + 1) * 60}
      length={clock.dayMin * 60}
      marks={clock.marks}
      words={clock.words}
      wordsAt={p => clock.wordsAt(Math.max(0, Math.round(p / 60) - 1))}
      counter={`day ${daysBetween(session.startDay ?? clock.day, clock.day).length}`}
      stateWord="New York"
      exitWords="Your sessions"
      playing={playing}
      onPlay={p => setPlaying(p && canPlay)}
      pace={pace}
      onPace={setPace}
      /* the pace's words are said in the candles THIS chart draws: 1× is a candle a second on 1m, one every five on 5m */
      candleMin={tfMinutes(prefs.timeframe)}
      onSeek={p => seek(Math.round(p / 60) - 1)}
      onExit={() => navigate('/practice/backtest')}
      step={60}
    />
  );
  const dayInk = (pct: number) => (pct >= 0 ? 'text-bull' : 'text-bear');
  const dayWordsOf = (pct: number) => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  const said = notice?.(hands);

  /* ---- THE TAPE ---- */
  const tape = (
    <div className={`${card} flex flex-col min-w-0 ${full ? 'flex-1 min-h-0' : 'lg:h-full'}`} data-review-tape={full ? 'full' : 'page'}>
      <div ref={headRef} className={`${head} flex-wrap h-auto min-h-9 py-1 gap-x-2 gap-y-1`} data-review-head>
        {two ? (
          /* THE SWITCH — both names with their price and their day; silver is where you are, a mark says what is open there */
          <span role="tablist" aria-label={switchLabel} className="inline-flex items-center gap-1" data-review-names>
            {names.map(n => {
              const here = n === on;
              return (
                <button key={n.symbol} type="button" role="tab" aria-selected={here} onClick={() => onSwitch(n.symbol)} title={here ? `${n.title} — on the desk` : `Put ${n.title} on the desk — ${on.symbol} keeps running`} className={`inline-flex items-center gap-1.5 h-6 ${logos ? 'pl-1.5 pr-2' : 'px-2'} rounded-md border font-mono text-t11 tnum transition-colors ${here ? 'border-silver/50 bg-silver/[0.10]' : 'border-borderSubtle hover:border-borderMuted'}`} data-review-name={n.symbol} data-on={here ? '' : undefined}>
                  {/* side by side each chart says its own price and day: here the switch is the name and what is open in it */}
                  {logos && (here || compact) && !split && <CompanyLogo ticker={n.symbol} size={13} />}
                  <span className={`font-bold ${here ? 'text-silver' : 'text-textSecondary'}`}>{n.symbol}</span>
                  {(here || compact) && !split && <span className={here ? 'text-textPrimary' : 'text-textSecondary'}>{n.priceWords}</span>}
                  {!split && <span className={`text-t10 font-semibold ${dayInk(n.dayPct)}`}>{dayWordsOf(n.dayPct)}</span>}
                  {n.held > 0 &&
                    (heldAs === 'dot' ? (
                      <span className="w-1.5 h-1.5 rounded-full bg-silver" title={`A position is open in ${n.symbol}`} />
                    ) : (
                      <span className="min-w-[14px] h-[14px] px-1 rounded-full bg-silver/[0.15] text-silver text-t8 font-bold leading-[14px] text-center" title={`${n.held} open in ${n.symbol}`}>
                        {n.held}
                      </span>
                    ))}
                </button>
              );
            })}
          </span>
        ) : picker ? (
          picker
        ) : (
          <span className="inline-flex items-center gap-2 font-mono text-t12 tnum">
            <span className="font-bold text-textPrimary">{on.label}</span>
            <span className="text-textPrimary">{on.priceWords}</span>
            <span className={`text-t11 font-semibold ${dayInk(on.dayPct)}`}>
              {on.dayPct >= 0 ? '▲ +' : '▼ '}
              {on.dayPct.toFixed(2)}%
            </span>
          </span>
        )}
        {/* in the takeover the account rides the tape's head: the strip it lives in is behind the screen */}
        {full && (
          <span className="inline-flex items-center gap-3 pl-3 ml-1 border-l border-borderSubtle font-mono text-t11 tnum whitespace-nowrap">
            {/* a tight row keeps the figure that moves while a trade is on — what is open, up or down */}
            {!compact && (
              <span>
                <span className="text-textMuted">worth</span> <span className="text-textPrimary">{usd(account.equity)}</span>
              </span>
            )}
            <span>
              <span className="text-textMuted">open</span> <span className={dirInk(account.openPnl)}>{usdSigned(account.openPnl)}</span>
            </span>
            {/* the third figure goes first when the row is tight: the ticket says it under every order */}
            {account.third && headW >= HEAD_FULL_PX + HEAD_ACCOUNT_PX + HEAD_CASH_PX && (
              <span>
                <span className="text-textMuted">{account.third.label}</span> <span className="text-textPrimary">{account.third.value}</span>
              </span>
            )}
          </span>
        )}
        <span className="w-px h-4 bg-borderSubtle shrink-0" aria-hidden />
        {/* The house toolbar, in the house order: the intervals at the left, the rest pushed right. Its floor is
            its own row (`min-w-fit`): on a narrow tape it wraps under the name whole, never into a pile. */}
        <div className="flex-1 min-w-fit" data-review-toolbar>
          <ChartToolbar
            minimal
            candles
            spread
            compact={compact}
            keepIntervals={headW >= 560}
            dense={!full}
            timeframes={timeframes}
            timeframe={gridOn ? gridOn.timeframe : prefs.timeframe}
            onTimeframe={tf => (grid && gridOn ? grid.onTimeframe(grid.active, tf) : setPref('timeframe', tf))}
            overlays={prefs.overlays}
            onOverlays={o => setPref('overlays', o)}
            overlayKeys={overlayKeys}
            indicators={prefs.indicators}
            onIndicators={i => setPref('indicators', i)}
            paneId={gridOn ? `${paneIds[0]}:${gridOn.key}` : paneIdOf(on)}
            fullscreen={full}
            chartStyle={prefs.chartStyle}
            onChartStyle={s => setPref('chartStyle', s)}
            priceScale={prefs.priceScale}
            onPriceScale={s => setPref('priceScale', s)}
            onExportPng={() => (gridOn ? gridExport(gridOn.key).current?.() : exportOf(on).current?.())}
            sessionOr={prefs.sessionOr}
            onSessionOr={o => setPref('sessionOr', o)}
            /* flat in the strip: the lift they wear floating over a chart is dropped */
            afterIntervals={stripCorner ? <span className="inline-flex items-center [&_*]:shadow-none" data-desk-strip-pnl>{stripCorner}</span> : undefined}
          />
        </div>
        {/* The desk's own doors, at the row's end: the clock's jumps, then the split, the panel and the fullscreen
            door — last, where the house puts it */}
        <span className="w-px h-4 bg-borderSubtle shrink-0" aria-hidden />
        {/* `ml-auto`: should the row ever wrap, the doors stay at the right edge, where they are looked for */}
        <span className="ml-auto flex items-center gap-1">
          {clock && <DayCard label={compact || tight ? '' : 'Go to'} value={clock.day} onChange={d => seek(d === clock.day ? clock.minute : 0, d)} min={clock.floorDay} title={goToTitle} testId="review-goto" size="sm" />}
          {doors?.(hands)}
          {clock && (
            <button type="button" onClick={() => clock.tomorrow && seek(0, clock.tomorrow)} disabled={!clock.tomorrow} title={nextDayTitle} className={barDoor} data-review-next-day>
              <SkipForward className="w-3 h-3" />
              {!compact && !tight && 'Next day'}
            </button>
          )}
          {full && two && (
            <button type="button" onClick={() => setPref('split', !prefs.split)} disabled={headW < SPLIT_PANE_PX * 2} title={headW < SPLIT_PANE_PX * 2 ? 'No room for two charts side by side here' : prefs.split ? `One chart — ${on.symbol} alone` : `${names.map(n => n.symbol).join(' and ')} side by side — the ${panelWord} follows the chart you touch`} aria-label={prefs.split ? 'One chart' : 'Two charts side by side'} aria-pressed={split} className={`${barDoor} ${split ? 'text-silver' : ''}`} data-review-split={split ? 'on' : 'off'}>
              <Columns2 className="w-3.5 h-3.5" />
            </button>
          )}
          {full && (
            <button type="button" onClick={() => setPanelOpen(v => !v)} title={panelOpen ? `Fold the ${panelWord} away` : panelTitle} aria-label={panelOpen ? `Fold the ${panelWord} away` : `Open the ${panelWord}`} aria-pressed={panelOpen} className={barDoor} data-review-panel-door={panelOpen ? 'open' : 'folded'}>
              {panelOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
            </button>
          )}
          <button type="button" onClick={() => (full ? close() : onFull(true))} title={full ? 'Exit fullscreen (Esc)' : `Fullscreen — the chart, with the ${panelWord} as a panel beside it`} aria-label={full ? 'Exit fullscreen' : 'Fullscreen'} className={barDoor} data-review-full={full ? 'on' : 'off'}>
            {full ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </span>
      </div>
      {/* the chart, and what the desk stands beside it (`chartSide`) */}
      <div className="flex-1 min-h-[430px] lg:min-h-0 flex min-w-0">
      <div className="relative flex-1 min-w-0 flex flex-col bg-panel" data-theme="dark" data-chart-ground={chartGround(themeKey)}>
        {/* ONE CHART — Or, in the takeover, the session's two side by side. Keyed by the name: the other name's
            tape is a chart of its own, and breathes in (the house's browse grammar). */}
        {grid ? (
          <div className={`flex-1 min-h-0 grid gap-px bg-borderSubtle ${GRID_CLASS[grid.layout]}`} data-desk-grid={grid.layout}>
            {grid.panes.map((p, i) => {
              const here = i === grid.active;
              const many = grid.panes.length > 1;
              return (
                <div key={p.key} className={`relative min-w-0 min-h-0 bg-panel animate-soft-in-slow ${grid.layout === '3' && i === 0 ? 'row-span-2' : ''}`} onPointerDownCapture={() => !here && grid.onActive(i)} data-desk-pane={i} data-desk-pane-name={p.name.symbol} data-on={here ? '' : undefined}>
                  <StrikeChart
                    ticker={p.name.symbol}
                    paneId={`${paneIds[0]}:${p.key}`}
                    revision={clock ? dayNumber(clock.day) * 2000 + clock.minute : (revision ?? 0)}
                    levels={p.name.levels}
                    timeframe={p.timeframe}
                    tape={p.name.tape}
                    overlays={prefs.overlays}
                    indicators={prefs.indicators}
                    chartStyle={prefs.chartStyle}
                    priceScale={prefs.priceScale}
                    sessionOr={prefs.sessionOr}
                    drawing={drawingName === p.key}
                    onEnterDraw={() => {
                      setDrawingName(p.key);
                      if (!here) grid.onActive(i);
                    }}
                    onExitDraw={() => setDrawingName(null)}
                    railTopOk={full && !many}
                    exportRef={gridExport(p.key)}
                    /* a floor, not a size: four panes share the tape's height */
                    height={many ? 160 : full ? 430 : 400}
                    frameless
                    onTradeMark={p.name.onTradeMark}
                    onCrosshair={grid.crosshair && many ? t => emitCross(p.key, t) : undefined}
                    syncRegister={grid.crosshair && many ? apply => (apply ? sinks.set(p.key, apply) : sinks.delete(p.key)) : undefined}
                    layer={api => {
                      apis.current[p.key] = api;
                      return (
                        <>
                          <PositionLayer api={api} ticker={p.name.symbol} minutes={tfMinutes(p.timeframe)} {...p.name.layer} />
                          {/* Every pane says whose it is and at what interval, at its top left against the wall:
                              "ES · 1m", no box round it — among several, the one on the desk in silver; then, on
                              the page, its corner (RP&L · UP&L) — in the full screen those ride the strip */}
                          <span className="absolute left-2 top-2 z-10 flex items-center gap-2 pointer-events-none" data-chart-chrome>
                            <span className="inline-flex items-center gap-1.5 h-6 font-mono text-t11 tnum whitespace-nowrap" data-chart-chrome data-desk-pane-chip={p.name.symbol}>
                              <span className={`font-bold ${!many ? 'text-textPrimary' : here ? 'text-silver' : 'text-textSecondary'}`}>{p.name.label}</span>
                              <span className="text-textMuted">·</span>
                              <span className="text-textMuted">{p.timeframe}</span>
                            </span>
                            {!full && p.name.corner}
                          </span>
                          {p.foot && (
                            <PaneFoot chart={api.chart} className="pl-14">
                              {p.foot}
                            </PaneFoot>
                          )}
                        </>
                      );
                    }}
                  />
                  {many && here && (
                    <span className="absolute inset-0 z-20 pointer-events-none ring-2 ring-inset ring-silver" aria-hidden="true" data-chart-ink data-desk-pane-edge>
                      <span className="absolute inset-x-0 top-0 h-[3px] bg-silver" />
                    </span>
                  )}
                  {many && !here && <span className="absolute inset-0 z-20 pointer-events-none" style={{ background: `rgb(var(--canvas) / ${grid.panes.length > 2 ? 0.16 : 0.3})` }} aria-hidden="true" data-chart-ink data-desk-pane-rest />}
                </div>
              );
            })}
          </div>
        ) : (
        <div className="flex-1 min-h-0 flex">
          {shown.map((n, i) => {
            const here = n === on;
            return (
              <div key={n.symbol} className={`relative flex-1 min-w-0 min-h-0 animate-soft-in-slow ${i > 0 ? 'border-l border-borderSubtle' : ''}`} onPointerDownCapture={() => !here && onSwitch(n.symbol)} data-review-pane={n.symbol} data-on={here ? '' : undefined}>
                <StrikeChart
                  ticker={n.symbol}
                  paneId={paneIdOf(n)}
                  revision={clock ? dayNumber(clock.day) * 2000 + clock.minute : (revision ?? 0)}
                  levels={n.levels}
                  timeframe={prefs.timeframe}
                  tape={n.tape}
                  overlays={prefs.overlays}
                  indicators={prefs.indicators}
                  chartStyle={prefs.chartStyle}
                  priceScale={prefs.priceScale}
                  sessionOr={prefs.sessionOr}
                  drawing={drawingName === n.symbol}
                  onEnterDraw={() => setDrawingName(n.symbol)}
                  onExitDraw={() => setDrawingName(null)}
                  /* only the takeover has a top band to spare — and only one chart can take it */
                  railTopOk={full && !split}
                  exportRef={exportOf(n)}
                  /* a floor, not a size: on the desk the chart takes what the book leaves (see DESK_MIN_PX) */
                  height={full ? 430 : 400}
                  frameless
                  onTradeMark={n.onTradeMark}
                  layer={api => {
                    apis.current[n.symbol] = api;
                    return (
                      <>
                        <PositionLayer api={api} ticker={n.symbol} minutes={tfMinutes(prefs.timeframe)} {...n.layer} />
                        {/* every chart says whose it is and at what interval at its top left, "ES · 1m" with no box round it — side
                            by side, the one on the desk in silver — then, on the page, its corner (RP&L · UP&L; in the full screen those
                            ride the strip); the chrome stamp sends the scripts' legend under it */}
                        <span className="absolute left-2 top-2 z-10 flex items-center gap-2 pointer-events-none" data-chart-chrome>
                          <span className="inline-flex items-center gap-1.5 h-6 font-mono text-t11 tnum whitespace-nowrap" data-chart-chrome data-review-pane-name={n.symbol}>
                            <span className={`font-bold ${!split ? 'text-textPrimary' : here ? 'text-silver' : 'text-textSecondary'}`}>{n.label}</span>
                            <span className="text-textMuted">·</span>
                            <span className="text-textMuted">{prefs.timeframe}</span>
                          </span>
                          {!full && n.corner}
                        </span>
                        {/* The clock's bar, at the foot of the price pane — hung off the time axis, an indicator
                            given a pane of its own had the bar lying across it. `pl-14` clears the drawing rail.
                            Side by side it is ONE bar across both charts (below), not one in each. */}
                        {!split && strip && (
                          <PaneFoot chart={api.chart} className="pl-14">
                            {strip}
                          </PaneFoot>
                        )}
                      </>
                    );
                  }}
                />
                {/* The chart on the desk is unmistakable: a 2px frame at full strength, in the chart's own ink
                    (pale silver on a dark tape, deep steel on Stone), a bar of it across the top — and the chart
                    that is NOT on the desk steps back a little, so the eye has one place to go. */}
                {split && here && (
                  <span className="absolute inset-0 z-20 pointer-events-none ring-2 ring-inset ring-silver" aria-hidden="true" data-chart-ink data-review-pane-edge>
                    <span className="absolute inset-x-0 top-0 h-[3px] bg-silver" />
                  </span>
                )}
                {/* a veil of the tape's own ground (an inline wash: the `bg-canvas/25` CLASS is made solid over a light tape by index.css) */}
                {split && !here && <span className="absolute inset-0 z-20 pointer-events-none" style={{ background: 'rgb(var(--canvas) / 0.3)' }} aria-hidden="true" data-chart-ink data-review-pane-rest />}
              </div>
            );
          })}
        </div>
        )}
        {/* …the ONE bar of a split desk: across the seam, over the left chart's empty runway and the right chart's oldest bars */}
        {split && strip && (
          <PaneFoot chart={() => apis.current[names[0].symbol]?.chart() ?? null} className="px-14" axisPad={false}>
            {strip}
          </PaneFoot>
        )}
        {said && <div className="absolute inset-x-0 top-3 z-30 flex justify-center px-3 pointer-events-none">{said}</div>}
      </div>
      {chartSide}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5" data-review-desk={session.id} data-review-kind={kind} data-review-clock={clock ? `${clock.day} ${clock.minute}` : undefined}>
      {/* THE ACCOUNT — what the session is worth as the clock stands (a desk's own strip, where it brings one) */}
      {ownStrip ?? (
      <div className={`${card} px-5 py-3 flex items-start gap-6 flex-wrap`} data-review-account>
        {/* the name keeps room to be read: where the facts leave it less, they go under it */}
        <div className="min-w-[min(100%,240px)] flex-1">
          <div className="h-6 flex items-center gap-2.5">
            {/* side by side: stacked, a dark badge and a four-colour mark bled into each other */}
            <span className="inline-flex items-center gap-1.5 shrink-0">
              {names.map(n => (
                <CompanyLogo key={n.symbol} ticker={n.symbol} size={18} />
              ))}
            </span>
            {/* the tab carries the session's name, never its id (layout/PageMeta) */}
            <SayPage words={session.name} />
            <h2 className="text-t15 font-semibold leading-tight text-textPrimary truncate">{session.name}</h2>
            {onRename && <RenameDoor name={session.name} onSave={onRename} className="w-5 h-5 shrink-0" />}
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">{subline}</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          {facts.map(f => (
            <Fact key={f.testId} label={f.label} testId={f.testId}>
              {f.node}
            </Fact>
          ))}
          <div className="min-w-0 self-end">
            <Link to={`/practice/backtest/${session.id}/report`} className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-borderSubtle bg-chip font-mono text-t10 uppercase tracking-wider text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-review-report-door>
              The report <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </dl>
      </div>
      )}

      {/* while the takeover is up the tape and the desk's cards live THERE — one chart, one ticket, wherever they are */}
      {/* The tape and the book at the left, the desk's cards at the right — two columns that do not push each
          other (the right one spans both rows). In the source the order is tape · cards · book, which is the order
          a phone stacks them in. */}
      <div ref={gridRef} className={`grid gap-2.5 ${full ? 'items-start' : 'items-start lg:items-stretch lg:grid-cols-[minmax(0,1fr)_var(--desk-side)] lg:grid-rows-[var(--tape-h)_auto]'}`} style={{ '--desk-side': `${sideWidth}px` } as CSSProperties} data-review-desk-grid>
        {!full && <div className="min-w-0 lg:min-h-0 lg:col-start-1 lg:row-start-1">{tape}</div>}
        {!full && (
          /* The right column is as tall as the left one, and never the other way round: its cards sit in a box
             laid OVER the cell (`absolute inset-0`), so a chain — which would otherwise ask for the height of
             every strike it holds — asks the grid for nothing, and takes what the tape and the book make */
          <div className={`min-w-0 lg:relative lg:col-start-2 lg:row-start-1 lg:row-span-2 ${phoneSideFirst ? 'max-lg:order-first' : ''}`}>
            <div className="flex flex-col gap-2.5 lg:absolute lg:inset-0">{side}</div>
          </div>
        )}
        <div className={`min-w-0 ${full ? '' : 'lg:col-start-1 lg:row-start-2'}`}>
          {/* POSITIONS · ORDERS · TRADES — the working orders counted on their tab, the closed trades on theirs */}
          <div className={`${card} min-w-0`} style={{ minHeight: BOOK_PX }} data-review-blotter={tab}>
            <div className="px-4 pt-1 border-b border-borderSubtle/70">
              <CardTabs
                ariaLabel="Positions, orders and trades"
                value={tab}
                onChange={onTab}
                options={[
                  { value: 'open', label: `Positions · ${counts.open}` },
                  { value: 'orders', label: `Orders · ${counts.working}` },
                  { value: 'closed', label: `Trades · ${counts.closed}` },
                ]}
              />
            </div>
            {/* the book grows with its rows (BOOK_PX is its floor): the chart above keeps its size, the page scrolls */}
            <div data-review-book-rows>{book}</div>
          </div>
        </div>
      </div>

      {full &&
        createPortal(
          <div className={`fixed inset-0 z-[80] flex animate-soft-in transition-opacity duration-200 ease-out ${fullBleed ? 'bg-borderSubtle gap-px' : 'bg-canvas p-2.5 gap-2.5'} ${closing ? 'opacity-0' : ''}`} style={DOCK_ROOM} data-review-takeover data-desk-flush={fullBleed ? '' : undefined}>
            {tape}
            {/* THE PANEL — the desk's cards beside the tape, the way the strike rail sits beside Terrain's chart */}
            {panelOpen && (
              <div className={`max-w-[46vw] shrink-0 min-h-0 flex flex-col ${fullBleed ? 'gap-px' : 'gap-2.5'} animate-soft-in`} style={{ width: sideWidth }} data-review-panel>
                {side}
              </div>
            )}
          </div>,
          document.body
        )}
      <p className="px-1 font-mono text-t10 text-textMuted">{foot ?? 'The recorded NBBO, minute by minute — practice, not advice. Past results, real or pretend, promise nothing. Every time is New York’s (ET).'}</p>
    </div>
  );
};

export default DeskShell;
