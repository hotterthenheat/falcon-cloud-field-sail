/*
==================================================
  SLAYER TERMINAL - EXPOSURE LEDGER
  Strike × expiry in the house capsules, one greek
  at a time or all five side by side — the grid
  Skylit is known for, in the house's own cells
  (Noah, 2026-09-03: "dates with the ability to only
  show vex, dex, or gex individually or all 3 side
  by side… the king node stands out" — 09-04: the
  house word is SUPREME, "king" is theirs; 09-09:
  "the 'all' is only dex, vex, gex. not vanna and
  charm" — All is the five now, and a cell too
  narrow for "-$272.1M" prints "-272M", or the
  colour alone).

  CAPSULES, FULL (Noah, 2026-09-05, closing the
  redesign arc — terrain, reach, wheel, wind map,
  hexbin, honeycomb: "i feel like im trying too hard
  to recreate the wheel. lets revert back to capsules
  just make our capsules nice and full"):
    · the rows share the panel's whole height — no
      dead surface under the grid (fullscreen used to
      fill a third of the screen); each capsule fills
      its cell, and the figure inside scales with the
      row (9–13px); more rows than fit scroll
    · every cell is a HeatPill on the house ramp
      (ember amplifies, glacier absorbs, the dark
      zero), sized against the whole surface's scale
      so a far expiry's quiet cells read quiet next
      to today's loud ones
    · HOVER lights the capsule (silver ring) with a
      quiet wash along its row and down its column,
      and ONE FIXED READ LINE above the grid carries
      strike · date · put · call · net · OI · the
      verdict — no card under the pointer (the thing
      Noah would not have back); a click PINS it
      (the ring stays, the strike label goes silver),
      clicking empty space lets go
    · the SUPREME — the heaviest STRIKE of the whole book, the chart's
      magenta — wears the magenta tag on its row and the ring on the date
      carrying most of it; the heaviest single CELL wears a plain star
      (2026-09-08: the two had shared one word and named different strikes);
      spot runs through the rows as a rule
==================================================
*/

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import HeatPill from './HeatPill';
import { HEAT_MODE, heatLaneColor, type HeatMode } from './heatmap';
import RoomSpotRule from './RoomSpotRule';
import { useRoomSpotRead } from '../../pages/pinpoint/useRoomSpot';
import { fmtUsd } from '../../data/gex';
import { shownGreek } from './retailSign';
import { todayColumn, GREEK_UNIT, type ExposureSurface, type Greek } from '../../data/exposureSurface';
import { LONG_GAMMA, SHORT_GAMMA, SUPREME } from './paletteInk';
import { strikeRole, underlineClass } from './strikeRole';
import StrikeNum, { hasCents } from './StrikeNum';
import { afterGlide, onGlide, promisedWidth } from '../../core/glide';
import { netInk } from './ExposureReadout';
import type { SurfaceCell } from './exposureView';
import { sinceOpenRead } from '../../data/levelview';
import PointerCard, { CardRow, PointerFollowCard, letGoWords } from '../ui/PointerCard';
import { BOOK_TTL_MS, StaleMark, useTickFlash } from '../ui/liveRead';
import { peekEntry } from '../../data/uwBook';

const letGo = letGoWords();
import { CARD_W } from './ExposureMatrix';

interface ExposureLedgerProps {
  surface: ExposureSurface;
  /** The live spot for the rule between the rows — the surface itself is rebuilt only when spot has moved (see ExposureField) */
  liveSpot?: number;
  /** False while the book is a replayed minute's — the spot row reads that minute, not the room (2026-10-14) */
  live?: boolean;
  /** The same book as it stood at the session's open (levelview's `snapshotAtOpen` through `buildExposureSurface`),
      for every cell's "since the open" badge; null or absent, no badges */
  open?: ExposureSurface | null;
  /** THE FOCUS (Noah, 2026-10-12): the scrim over the board with only the badged nodes — the biggest moves since the
      open — kept sharp; a door on the band, never a click on a node */
  focusOn?: boolean;
  /** The greeks drawn, in the book's order — one, some, or all five (a stable array) */
  greeks: Greek[];
  /** Which leg the capsules carry (the band's Legs card, 2026-10-13): the net, or one leg alone */
  leg?: 'net' | 'call' | 'put';
  /** The expiry columns the host wants, as surface indices, nearest first (its window after the bell and its
      ceiling); this box cuts them to what fits its width */
  expiries: number[];
  /** Strikes each side of spot — the head's window */
  rings: number;
  /** A strike another surface is hovering (the ladder) — its row washes here too */
  hoverStrike?: number | null;
  /** The capsules' ramp: the house ember/glacier, or the thermal try (cool absorbs · yellow balanced · warm amplifies) */
  palette?: 'house' | 'thermal';
  /** The columns the host WANTS drawn (its window, before the fit) — the pane's natural width is read off them, so a
      narrow pane's fit never shrinks the width it asks for (2026-10-13) */
  wantCols?: number;
  /** The grid's width at its widest — the strike column and the wanted columns at CELL_MAX — told to the host, which
      packs the names' panes to it (2026-10-13) */
  onNatural?: (px: number) => void;
  /** BOOK AFTER THE BELL (band 3, 2026-09-05): today's column taken out — the book as it stands at the next open */
  afterBell?: boolean;
  selectedStrike?: number | null;
  /** YOUR POSITIONS (2026-09-05): strike → the read for it; the strike label wears a silver "you" */
  marks?: ReadonlyMap<number, string>;
  onPointer?: (cell: SurfaceCell | null, clientX: number, clientY: number) => void;
  onSelectStrike?: (strike: number) => void;
  /** A date head was clicked — the host reads that one expiry. Absent, the date is not a control. */
  onExpiry?: (index: number) => void;
  /** WHAT FITS, reported upward (2026-09-14): how many expiries this pane can print at its
      measured width with its greeks — null while unmeasured or on unmount. The band takes the
      least across its names and offers no deeper choice. */
  fitKey?: string;
  /** On paper (the light page): the island's grey, the page's inks, the tint ramp — the host says so */
  paper?: boolean;
  /** How many expiries fit at CELL_MIN_W with the greeks drawn — and how many of the wanted greeks are drawn (the
      box narrower than one expiry of them cuts greeks before it would print a cell without its figure, 2026-10-17) */
  onFit?: (key: string, expiries: number | null, greeksDrawn?: number | null) => void;
}

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
/* the side inks as tokens (2026-09-16): the dark set IS #F5C542 / #7ABDD7; the light set cuts them for paper */
const PUT_INK = 'rgb(var(--ember))';
const CALL_INK = 'rgb(var(--glacier))';
/** The strike and its tag slot — "497.50" plus two short tags on one right edge */
export const STRIKE_W = 104;
/** The narrowest cell that still prints a figure ("272M"). Under it the colour stood alone — and
    an empty capsule "reads as a website bug/flaw" (Noah, 2026-09-14, three names through Oct 26),
    so it is never drawn: the ledger draws only the columns that fit its box, and the band's
    Expiries card offers only those (see `onFit`). */
/* …AND NEVER NARROWER THAN ITS DATE HEAD (the audit's H3, 2026-10-13): at 42 a 1920 desk with the rail open drew
   43px columns under 44px of "OCT 14" and every head lost its first letter. A column that cannot print its head does
   not fit: the narrow head is 40px of mono at its natural tracking inside 4px of padding. */
export const CELL_MIN_W = 48;
/** How many columns a pane this wide can print figures in */
export const columnsThatFit = (paneW: number) => Math.max(1, Math.floor((paneW - STRIKE_W) / CELL_MIN_W));
/** A row never thinner than this — past it the grid scrolls */
const ROW_MIN = 18;
/** The spot row: the pill (16px) with air above and below it, the Weigher chain's way — at a row's own height the
    pill touched the capsules (Noah, 2026-10-12: "top and bottom spacing is off notice how close they are") */
const SPOT_H = 28;
const HEAD_H = 44;
/* A CELL'S NATURAL WIDTH (the owner, 2026-10-13: "its so wide" — one date on a 3000px screen was a 570px capsule a
   row — then "compact and tight grouped" and "i dont want any deadspace"): 120 is where the full figure (71), the star
   (96) and a four-character since-open chip (119) all still print. The pane's natural width is read off it; where the
   Map stands the day box beside the book the panes pack to it, and elsewhere the cells share the pane, never leaving
   air after the last one. */
export const CELL_MAX = 120;
/** How many nodes a board badges with their move since the open — the biggest ones (Noah, 2026-10-12) */
const SINCE_SHOWN = 10;
/** …and no node whose move is under this share of the board's heaviest cell: a quiet board wears no badge */
const SINCE_FLOOR = 0.05;
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
/** The figure for a narrow cell — "−272M" where "-$272.1M" would not fit (All at
    forty columns): the dollar sign goes, THE MINUS STAYS (the paying-user audit's
    H2, 2026-10-13: on the ember-and-glacier ramp a pale capsule could be either
    side, and a figure that hides its sign is a figure to hover) */
const fmtShortUsd = (v: number) => {
  const a = Math.abs(v);
  const sign = v < 0 && a >= 0.5 ? '−' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}${Math.round(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)}K`;
  return `${sign}${a.toFixed(0)}`;
};
/** A mono figure's glyph at a size, bold — measured off "−$272.1M" at 13px (61px) */
const GLYPH = 0.6;
/** What a cell prints: the full figure, the short one, or the colour alone */
type Figure = 'full' | 'short' | 'none';
const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'VEX', vanna: 'VANNA', charm: 'CHARM' };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Focus {
  strike: number;
  e: number;
  greek: Greek;
}

/* THE READ LINE IS GONE (2026-10-12, the partner through Noah: he "hates how these sit at the top of the section
   making the page look off"; Noah: "do you think they should only be visible on node click?"; my call, his "build
   it"): the words it carried now ride THE POINTER CARD — the matrix's and the ladder's, one piece — beside the
   cell under the pointer, and a click keeps that same card on the node until the next click. The pane is the grid
   alone. The SUPREME chip in the pane head and The Read door say what the line said at rest. */

/* THE CELL, MEMOISED FOR REAL (2026-09-06, the perf sweep). The pill was
   memo'd but every cell handed it a fresh closure and a fresh star element
   on every render, so a tick re-rendered all eight hundred — 35ms of every
   desk open and a slice of every scan tick. The cell now takes primitives
   and two stable handlers, and its figures are rounded to the three digits
   the pill prints: a tick that does not move a printed figure does not
   touch that cell. */
const q3 = (x: number) => (x === 0 ? 0 : Number(x.toPrecision(3)));

interface LedgerCellProps {
  strike: number;
  e: number;
  g: Greek;
  v: number;
  maxAbs: number;
  date: string;
  first: boolean;
  wash: string;
  isKing: boolean;
  ring?: string;
  star: boolean;
  /** SINCE THE OPEN (2026-10-12, Noah: Skylit's velocity figures "on the node"): the cell's figure by the since-open
      rule — "+37%", "4.2×", "new today" — and which way (1 building, −1 bleeding, 0 flat or flipped); null when the
      open has nothing to compare */
  since: string | null;
  sinceDir: 1 | -1 | 0;
  /** How much of it the cell has room for: the figure in its chip, a dot alone, or nothing (the card has it) */
  sinceLane: 'figure' | 'dot' | 'none';
  /** The dot beside the figure (room for it) rather than at the capsule's edge */
  dotBeside: boolean;
  /** Kept sharp above the focus scrim — one of the board's biggest moves while the focus door is open */
  kept: boolean;
  fontSize: number;
  figure: Figure;
  mode?: HeatMode;
  paper?: boolean;
  /** The pinned cell — the one the focus mode keeps sharp */
  pinned?: boolean;
  /** The pane's id stem — the cell's own id is `${idBase}-${g}-${e}-${strike}`, the keys' active descendant */
  idBase: string;
  onHover: (f: Focus | null, x: number, y: number) => void;
  onPick: (f: Focus, x: number, y: number) => void;
}

/** The badge's ink: green building, red bleeding, quiet otherwise — the Building page's own colours for what today added
    and what left */
const sinceInk = (dir: 1 | -1 | 0) => (dir === 1 ? 'rgb(var(--bull))' : dir === -1 ? 'rgb(var(--bear))' : 'rgb(var(--text-muted))');
/* at the house's 11px floor (the audit's H5b, 2026-10-13 — it was 7.5px); the chip stands only where the column has room
   for its own words (`laneFor` below), the dot everywhere else */
export const SinceBadge = ({ text, dir }: { text: string; dir: 1 | -1 | 0 }) => (
  <span className="rounded-full px-1 py-0 font-mono text-[11px] font-semibold tnum tabular-nums leading-none whitespace-nowrap" style={{ background: 'rgb(var(--panel) / 0.88)', color: sinceInk(dir), textShadow: 'none' }} data-since={dir}>
    {text}
  </span>
);

const LedgerCell = memo(({ strike, e, g, v, maxAbs, date, first, wash, isKing, ring, star, since, sinceDir, sinceLane, dotBeside, kept, fontSize, figure, mode, paper, pinned, idBase, onHover, onPick }: LedgerCellProps) => {
  const flash = useTickFlash(v);
  return (
  <div
    data-cell
    data-cell-key={`${g}|${e}|${strike}`}
    id={`${idBase}-${g}-${e}-${strike}`.replace(/\./g, '_')}
    aria-label={`${fmtStrike(strike)} on ${date} · ${fmtUsd(shownGreek(g, v))}${since ? ` · ${since} since the open` : ''}`}
    data-pinned={pinned ? '' : undefined}
    data-kept={kept ? '' : undefined}
    className={`relative min-w-0 px-[3px] py-[2px] cursor-default select-none tabular-nums ${first ? 'border-l border-borderSubtle/60 pl-[2px]' : ''} ${wash}`}
    onPointerEnter={ev => onHover({ strike, e, greek: g }, ev.clientX, ev.clientY)}
    onPointerMove={ev => onHover({ strike, e, greek: g }, ev.clientX, ev.clientY)}
    onPointerLeave={ev => onHover(null, ev.clientX, ev.clientY)}
    onClick={ev => onPick({ strike, e, greek: g }, ev.clientX, ev.clientY)}
  >
    <HeatPill
      value={v}
      maxAbs={maxAbs}
      className={`h-full tabular-nums ${isKing ? 'font-bold' : ''}`}
      fontSize={fontSize}
      mode={mode}
      paper={paper}
      tight={figure !== 'full'}
      selected={!!ring}
      ringColor={ring}
      marker={star ? <span className="text-textPrimary">★</span> : undefined}
      badge={since && sinceLane === 'figure' ? <SinceBadge text={since} dir={sinceDir} /> : undefined}
      dot={since && sinceLane === 'dot' ? sinceInk(sinceDir) : undefined}
      dotBeside={dotBeside}
      title={undefined}
    >
      {figure === 'full' ? fmtUsd(shownGreek(g, v)) : figure === 'short' ? fmtShortUsd(shownGreek(g, v)) : ''}
    </HeatPill>
    {flash.dir && <span key={flash.gen} aria-hidden className={`pointer-events-none absolute inset-[2px] rounded-full ${flash.dir === 'up' ? 'tick-up' : 'tick-down'}`} />}
  </div>
  );
});

const ExposureLedger = ({ surface, liveSpot, live = true, open = null, focusOn = false, greeks: greeksWanted, leg = 'net', expiries, rings, hoverStrike, palette = 'house', afterBell = false, selectedStrike, marks, onPointer, onSelectStrike, onExpiry, fitKey, onFit, paper = false, wantCols, onNatural }: ExposureLedgerProps) => {
  const [box, setBox] = useState({ w: 0, h: 0 });
  /* NEVER A CELL WITHOUT ITS FIGURE (Noah, 2026-10-17, the panel narrowed until the capsules went blank: "stopping a
     user from making the screen so small to the point where the node numbers disappear"): the expiries were already
     cut to what fits at CELL_MIN_W, but a box narrower than ONE expiry of the greeks picked still had to print them
     all — three greeks in two columns' width, the short figure gone. The greeks are cut the same way the expiries are,
     the first ones kept, and the field is told (onFit) so its note says so. Unmeasured, every greek (that frame is
     never drawn). */
  const greeks = useMemo(() => {
    if (box.w <= 0) return greeksWanted;
    const fit = Math.max(1, Math.min(greeksWanted.length, columnsThatFit(box.w)));
    return fit < greeksWanted.length ? greeksWanted.slice(0, fit) : greeksWanted;
  }, [greeksWanted, box.w]);
  const mode = palette === 'thermal' ? ('thermal-yellow' as const) : undefined;
  /* one leg alone is painted against its own heaviest cell — the net's scale would read a call leg against puts it
     never had */
  const paintMax = useMemo(() => {
    const m = {} as Record<Greek, number>;
    for (const g of greeks) {
      if (leg === 'net') {
        m[g] = surface.maxAbs[g];
        continue;
      }
      let best = 1;
      for (const row of surface[leg][g]) for (const v of row) if (Math.abs(v) > best) best = Math.abs(v);
      m[g] = best;
    }
    return m;
  }, [surface, greeks, leg]);
  /* ON PAPER the calendar is part of the page (2026-09-22): the island's soft grey, the page's inks, the tint ramp on
     the capsules (heatmap.ts, PAPER); the host stamps the theme and the ground, this only has to say `paper` */
  const ground = paper ? 'bg-inset' : 'bg-panel';

  /* THE ROWS FILL THE HEIGHT — measured so the figure inside can scale with them (and the
     columns are cut to the width, below) */
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** True while a glide with a promised width is on — the grid holds that width (see the glide hook below) */
  const [gliding, setGliding] = useState(false);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    /* A FRAME AFTER THE COMMIT (2026-09-06, the perf sweep): read inside it,
       the two sizes forced the desk's whole layout early — 16ms of every
       open on the profiler. The grid stays invisible for that one frame
       (see the body below) so the figures never pop from 9px to 13px. And
       not per frame of a sidebar glide either: once, when it ends. */
    const first = requestAnimationFrame(read);
    const ro = new ResizeObserver(() => afterGlide(read));
    ro.observe(el);
    /* …unless the host has promised where it is going (the desk's tiles,
       2026-09-12): then once at the START, for that width, so the figures fit
       the destination from the first frame of the glide */
    const off = onGlide(
      () => {
        const w = promisedWidth(el);
        /* THE GRID IS PINNED THROUGH THE GLIDE (2026-10-12): laid out once at the promised width and held there
           while the pane glides round it — laid out every frame, three panes of capsules were ~30ms a frame of
           browser layout (a profile: nearly all "(program)", not our code) and a name leaving dropped frames.
           AT ONCE, in the task that changed the columns: the band holds its tracks still for one frame after
           the change, so this re-fit (a column more or less, every pane) is on screen before anything moves — as a
           deferred transition it landed a third of the way through the glide, and the capsules snapped. */
        if (w != null) setBox(prev => (prev.w === w ? prev : { w, h: prev.h }));
        setGliding(w != null);
      },
      () => setGliding(false)
    );
    return () => {
      cancelAnimationFrame(first);
      ro.disconnect();
      off();
    };
  }, []);
  /* ONLY THE COLUMNS THAT FIT (Noah, 2026-09-14): the expiries this box can print at CELL_MIN_W
     with its greeks side by side — the cut every other count below rides on. Unmeasured, no cut
     (the grid is invisible for that frame anyway). */
  const fitExpiries = box.w > 0 ? Math.max(1, Math.floor(columnsThatFit(box.w) / Math.max(1, greeks.length))) : null;
  const greeksDrawn = box.w > 0 ? greeks.length : null;
  useEffect(() => {
    if (!onFit || !fitKey) return;
    onFit(fitKey, fitExpiries, greeksDrawn);
    return () => onFit(fitKey, null, null);
  }, [onFit, fitKey, fitExpiries, greeksDrawn]);

  /* THE COLUMNS, as surface indices — the host's window (today gone after the bell, its ceiling), cut here to what
     fits: the book at the next open when the host says so */
  const todayIdx = todayColumn(surface);
  const shownIdx = useMemo(() => {
    const live = expiries.filter(i => i >= 0 && i < surface.expiries.length);
    const list = live.length ? live : [Math.max(0, todayIdx)];
    return list.slice(0, Math.max(1, fitExpiries ?? Infinity));
  }, [surface, expiries, todayIdx, fitExpiries]);
  /* FOCUS: the pinned cell holds, else the hovered, else the supreme */
  const [hovered, setHovered] = useState<Focus | null>(null);
  const [pinned, setPinned] = useState<Focus | null>(null);
  /* THE ROWS HOLD UNDER THE POINTER (2026-10-12, the second half of the partner's "shaky" calendar): the rows are the
     window's rings each side of spot, so every time spot crossed a strike the book was rebuilt around it and EVERY
     row slid one step — under a still pointer another cell arrived, and its words with it (a probe caught 196 → 196.5
     in the hovered pane). Now, while the pointer is on the grid or a cell is pinned, the strikes drawn are kept and
     only the spot rule steps between them; the rings re-centre the moment the pointer leaves — or at once if spot
     walks past the strikes drawn, the rings or the book change. */
  const inBoxRef = useRef(false);
  const heldRef = useRef<number[] | null>(null);
  const [left, setLeft] = useState(0);
  /* THE ROWS SPLIT ROUND THE PRICE NOW (one price on the page, 2026-10-14): the first strike at or over the room's price
     (pages/pinpoint/useRoomScan.ts) — the grid re-renders on it only when the price crosses a strike; the pill between
     the rows reads the price itself (RoomSpotRule). Infinity when the price stands over every strike. */
  const spotAt = useRoomSpotRead(
    surface.ticker,
    sp => {
      const price = sp ?? liveSpot ?? surface.spot;
      return surface.strikes.find(s => s >= price) ?? Infinity;
    },
    Object.is,
    live
  );
  // Descending, the ledger's way — the window's rings each side of spot
  const { above, below } = useMemo(() => {
    const desc = [...surface.strikes].sort((a, b) => b - a);
    const n = Math.max(1, rings);
    const fresh = [...desc.filter(s => s >= spotAt).slice(-n), ...desc.filter(s => s < spotAt).slice(0, n)];
    const held = heldRef.current;
    const hold =
      (inBoxRef.current || pinned) &&
      held != null &&
      held.length === fresh.length &&
      spotAt <= held[0] &&
      spotAt > held[held.length - 1] && // strictly: the spot rule always has a row under it

      held.every(s => surface.strikes.includes(s));
    const list = hold && held ? held : fresh;
    heldRef.current = list;
    return { above: list.filter(s => s >= spotAt), below: list.filter(s => s < spotAt) };
    // `left` counts the pointer's exits from the grid — the rings re-centre then, not between two cells
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, rings, pinned, left, spotAt]);
  const strikes = useMemo(() => [...above, ...below], [above, below]);
  /** The longest strike this book prints — the strike column's reserve (see the head) */
  const cents = useMemo(() => hasCents(surface.strikes), [surface]);
  const widestStrike = useMemo(() => surface.strikes.map(fmtStrike).reduce((a, b) => (b.length > a.length ? b : a), ''), [surface]);
  const cols = greeks.length * shownIdx.length;
  const pinStrike = surface.front.strikes.find(r => r.pin)?.strike;
  /* THE SUPREME on the columns DRAWN: the book's heaviest strike, on whichever
     drawn date carries most of it (after the bell, today is out of the running) */
  const supremeFor = useCallback(
    (g: Greek) => {
      const sup = surface.supreme[g];
      if (shownIdx.includes(sup.e)) return { strike: sup.strike, e: sup.e, value: sup.value };
      const si = surface.strikes.indexOf(sup.strike);
      let best = { strike: sup.strike, e: shownIdx[0] ?? 0, value: 0 };
      if (si >= 0)
        for (const e of shownIdx) {
          const v = surface.net[g][e][si] ?? 0;
          if (Math.abs(v) > Math.abs(best.value)) best = { strike: sup.strike, e, value: v };
        }
      return best;
    },
    [surface, shownIdx]
  );
  /* The heaviest CELL among the columns DRAWN — the star, never the supreme */
  const kingFor = useCallback(
    (g: Greek) => {
      const k = surface.king[g];
      if (shownIdx.includes(k.e)) return k;
      let best = { strike: strikes[0] ?? surface.spot, e: shownIdx[0] ?? 0, value: 0 };
      for (const e of shownIdx)
        for (const strike of strikes) {
          const v = surface.net[g][e][surface.strikes.indexOf(strike)] ?? 0;
          if (Math.abs(v) > Math.abs(best.value)) best = { strike, e, value: v };
        }
      return best;
    },
    [surface, shownIdx, strikes]
  );

  const rowH = Math.max(ROW_MIN, (box.h - HEAD_H - SPOT_H) / Math.max(1, strikes.length));
  // The figure scales with the row AND must fit the column: "-$272.1M" is eight
  // mono glyphs at ~0.62em each inside the capsule's 16px of padding (All at
  // 24 columns on a 1900 screen truncated at 13px — measured 2026-09-05).
  /* the strike column's measured width (the grid sizes it to its content; STRIKE_W is only the reserve the band
     counts columns with) — read off the sticky head, which every keyed grid renders anew */
  const [strikeHead, setStrikeHead] = useState<HTMLDivElement | null>(null);
  const [strikeW, setStrikeW] = useState(STRIKE_W);
  useLayoutEffect(() => {
    if (!strikeHead) return;
    const read = () => {
      const w = strikeHead.offsetWidth;
      if (w > 0) setStrikeW(prev => (prev === w ? prev : w));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(strikeHead);
    return () => ro.disconnect();
  }, [strikeHead]);
  const cellW = (box.w - strikeW) / Math.max(1, cols);
  /* THE PANE'S NATURAL WIDTH, told to the host (2026-10-13): the strike column as measured, the wanted columns at
     CELL_MAX, the grid's 4px of right padding */
  const natural = strikeW > 0 ? strikeW + Math.max(cols, wantCols ?? 0) * CELL_MAX + 4 : 0;
  useLayoutEffect(() => {
    if (natural > 0) onNatural?.(natural);
  }, [natural, onNatural]);
  /* the floor is 10px, not 9 (the partner, 2026-09-14: the figures "difficult to see") — a 20px
     row held 9px type; a short figure at 10px bold is 32px in a 42px cell, the full one 65 in 71 */
  /* …AND 11 SINCE 2026-10-13 (the audit's M10): the terminal's floor, which every other word on the page keeps — the
     short figure at 11px bold is 35px in a 48px cell; the full one switches to the short one a little earlier */
  const fontSize = clamp(Math.min(rowH * 0.46, (cellW - 22) / (8 * 0.68)), 11, 13);
  /* Under 71px the full figure no longer fits at 9px (All at forty columns
     on a page-width calendar): print the short one on half the padding. Under
     CELL_MIN_W the colour would stand alone — unreachable now that the columns
     are cut to the width (the branch stays for the unmeasured frame). The date
     heads lose their "· 2d" the same way. */
  const figure: Figure = cellW >= 71 ? 'full' : cellW >= CELL_MIN_W ? 'short' : 'none';
  /* THE DATE HEAD'S "· 2d" ONLY WHERE IT FITS (2026-10-13): the cut was a fixed 60px from before the 11px floor, and the
     full head is ~100px at 11px — "OCT 14 · TODAY" ran over its neighbours and back over the strike column. Measured off
     the widest full head among the columns drawn (11px mono, wider tracking: ~7.2px a character, and the 16px padding). */
  const widestHead = shownIdx.reduce((m, e) => {
    const ex = surface.expiries[e];
    return ex ? Math.max(m, `${ex.date} · ${e === todayIdx ? 'today' : ex.short}`.length) : m;
  }, 0);
  const narrowHead = cellW < widestHead * 7.2 + 16;
  /* a greek's group head too narrow for its unit (a phone's five groups of one column) prints the greek alone */
  const narrowGroup = cellW * shownIdx.length < 96;
  const rowsTemplate = [
    `${HEAD_H / 2}px ${HEAD_H / 2}px`,
    above.length ? `repeat(${above.length}, minmax(${ROW_MIN}px, 1fr))` : '',
    `${SPOT_H}px`,
    below.length ? `repeat(${below.length}, minmax(${ROW_MIN}px, 1fr))` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const heaviestExpiry = useCallback(
    (strike: number, g: Greek) => {
      const s = surface.strikes.indexOf(strike);
      let best = 0;
      let bestV = -1;
      for (const e of shownIdx) {
        const v = Math.abs(surface.net[g][e][s] ?? 0);
        if (v > bestV) {
          bestV = v;
          best = e;
        }
      }
      return best;
    },
    [surface, shownIdx]
  );
  // The host owns the strike; the cell (its expiry) is ours — keep the two in step
  useEffect(() => {
    if (selectedStrike == null) setPinned(null);
    else setPinned(prev => (prev && prev.strike === selectedStrike ? prev : { strike: selectedStrike, e: heaviestExpiry(selectedStrike, greeks[0]), greek: greeks[0] }));
  }, [selectedStrike, heaviestExpiry, greeks]);
  useEffect(() => {
    setPinned(prev => (prev && !greeks.includes(prev.greek) ? { ...prev, greek: greeks[0] } : prev));
  }, [greeks]);

  /* THE CARD ON A HOVER AND ON A CLICK (the owner, 2026-10-13, reversing 10-12's click-only calendar — "theirs no
     hover ability you have to click on each strike"): the matrix's pointer card follows the pointer across the cells;
     a click KEEPS it where the pointer was, tied to its cell (an offset from the cell's box, re-read on scroll and
     resize), until the next click. */
  const [keptAt, setKeptAt] = useState<{ key: string; dx: number; dy: number } | null>(null);
  const [keptPos, setKeptPos] = useState<{ x: number; y: number } | null>(null);
  /* where the pointer was when the hover began — the follow card tracks it from there by itself */
  const [hoverStart, setHoverStart] = useState<{ x: number; y: number } | null>(null);
  const leaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const hoverCell = (f: Focus | null, x: number, y: number) => {
    if (leaveTimer.current) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = 0;
    }
    if (f) {
      setHovered(prev => (prev?.strike === f.strike && prev?.e === f.e && prev?.greek === f.greek ? prev : f));
      setHoverStart(prev => prev ?? { x, y });
    } else {
      /* a beat before it goes, so crossing from one cell to the next never remounts the card (the matrix's 70ms) */
      leaveTimer.current = window.setTimeout(() => {
        leaveTimer.current = 0;
        setHovered(null);
        setHoverStart(null);
      }, 70);
    }
    onPointer?.(f ? { strike: f.strike, e: f.e } : null, x, y);
  };
  /* Stable handles for the memoised cells — the latest closures behind them */
  const hoverRef = useRef(hoverCell);
  hoverRef.current = hoverCell;
  const onHoverCell = useCallback((f: Focus | null, x: number, y: number) => hoverRef.current(f, x, y), []);
  const keyOf = (c: Focus) => `${c.greek}|${c.e}|${c.strike}`;
  const keepAt = (cell: Focus, x?: number, y?: number) => {
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-cell-key="${keyOf(cell)}"]`);
    const r = el?.getBoundingClientRect();
    setKeptAt({ key: keyOf(cell), dx: r && x != null ? x - r.left : (r?.width ?? 40), dy: r && y != null ? y - r.top : (r?.height ?? 14) / 2 });
  };
  const pick = (cell: Focus | null, x?: number, y?: number) => {
    if (!cell) {
      if (pinned) onSelectStrike?.(pinned.strike); // the host toggles it off
      return;
    }
    if (pinned && pinned.strike === cell.strike) {
      if (pinned.e === cell.e && pinned.greek === cell.greek) onSelectStrike?.(cell.strike); // the same cell again — let go
      else {
        setPinned(cell); // the same strike, another cell — the pin moves along the row
        keepAt(cell, x, y);
      }
      return;
    }
    setPinned(cell);
    keepAt(cell, x, y);
    onSelectStrike?.(cell.strike);
  };
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const onPickCell = useCallback((cell: Focus, x: number, y: number) => pickRef.current(cell, x, y), []);
  /* the kept card's place: its cell's box plus the offset, read again whenever the box scrolls or the window moves;
     a pin the host set (the strike picked elsewhere) anchors at the cell's right edge */
  useLayoutEffect(() => {
    if (!pinned) {
      setKeptPos(null);
      return;
    }
    const box = boxRef.current;
    const key = keyOf(pinned);
    const read = () => {
      const el = box?.querySelector<HTMLElement>(`[data-cell-key="${key}"]`);
      if (!el) {
        setKeptPos(null);
        return;
      }
      const r = el.getBoundingClientRect();
      /* WHERE THE HOVER CARD WAS (the paying-user audit's L8, 2026-10-13): the click's point on the cell, so keeping a
         card never moves it — the card stands above that point (PointerCard), off the cell it describes; a pin the
         host set has no click and anchors at the cell's right edge */
      const at = keptAt && keptAt.key === key ? keptAt : null;
      setKeptPos(at ? { x: r.left + at.dx, y: r.top + at.dy } : { x: r.right, y: r.top + r.height / 2 });
    };
    read();
    box?.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, { capture: true, passive: true });
    return () => {
      box?.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
      window.removeEventListener('scroll', read, { capture: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, keptAt, box.w, box.h, strikes, shownIdx]);

  /* THE FOCUS MODE WAS THE PIN (Noah, 2026-09-07: a pinned cell sharp, the rest softened, a click anywhere outside
     letting go). SINCE 2026-10-12 IT IS THE DOOR (Noah: "focus should also only be a button up top where it only
     focuses on the nodes with the large percentages and not allowed on the random click of any node"): the scrim
     answers the `focusOn` prop alone and keeps the badged nodes sharp (index.css, `data-kept`); a click on a cell
     KEEPS it — the ring, its row and column lit, its card on it — and a second click lets go. */
  /* …AND A CLICK OUTSIDE THE CALENDAR LETS GO TOO (Noah, later the same day: "the click card should be removed if i
     click outside of the calendar view so i dont have to click that specific node again to exit it"). Not
     "outside": another cell or strike (they move the pin), the surfaces that pick a strike themselves (the Map's
     profile panel, the position gutter — they own their own toggle; this listener runs AFTER React's, and on a
     panel click it used to re-toggle what the panel had just let go of), menus, doors and any control. */
  useEffect(() => {
    if (!pinned) return;
    const h = (ev: MouseEvent) => {
      const t = ev.target as Element | null;
      if (t?.closest('[data-cell],[data-strike],[data-profile-panel],[data-position-gutter],[data-dropdown],[data-dropdown-card],[role="menu"],[data-focus-chip],[data-guide-door],button,a,input,select,textarea')) return;
      pickRef.current(null);
    };
    /* …AND ESCAPE (the paying-user audit's H6, 2026-10-13: the keys sheet said Esc lets go of what is kept, and on the
       calendar it did not). It lets go first and stops there — the replay and fullscreen wait for the next press */
    const k = (ev: globalThis.KeyboardEvent) => {
      if (ev.key !== 'Escape' || ev.defaultPrevented) return;
      if ((ev.target as Element | null)?.closest?.('input,textarea,select,[role="menu"],[role="dialog"]')) return;
      ev.preventDefault();
      pickRef.current(null);
    };
    document.addEventListener('click', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('click', h);
      document.removeEventListener('keydown', k);
    };
  }, [pinned]);

  /* THE KEYS REACH THE CELLS (the audit's H10, 2026-10-13): the grid is one tab stop; the arrows walk the cells — up and
     down the strikes, left and right along the dates and the greeks — Home and End jump to a row's ends, Enter or Space
     keeps the cell: the same ring, wash and card a pointer gives, through the same hover and pick. The walk starts on
     the kept cell, else the first cell of the strike just over spot, and only from the keys (:focus-visible) — a click
     inside the box focuses it too, and changes nothing. */
  const [keyCell, setKeyCell] = useState<Focus | null>(null);
  const idBase = `ledger-${surface.ticker}`;
  const cellId = (f: Focus) => `${idBase}-${f.greek}-${f.e}-${f.strike}`.replace(/\./g, '_');
  const columnsList = useMemo(() => greeks.flatMap(g => shownIdx.map(e => ({ g, e }))), [greeks, shownIdx]);
  const cellBox = (f: Focus) => {
    const el = boxRef.current?.querySelector<HTMLElement>(`[data-cell-key="${keyOf(f)}"]`);
    const r = el?.getBoundingClientRect();
    return el && r ? { el, x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  };
  const walkTo = (f: Focus) => {
    setKeyCell(f);
    const c = cellBox(f);
    c?.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    hoverCell(f, c?.x ?? 0, c?.y ?? 0);
  };
  const leaveKeys = () => {
    setKeyCell(null);
    hoverCell(null, 0, 0);
  };
  const firstCell = (): Focus | null => (strikes.length ? { strike: above[above.length - 1] ?? strikes[0], e: shownIdx[0] ?? 0, greek: greeks[0] } : null);
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || !strikes.length || !columnsList.length) return;
    const cur = keyCell ?? pinned ?? firstCell()!;
    const si = Math.max(0, strikes.indexOf(cur.strike));
    const ci = Math.max(0, columnsList.findIndex(c => c.g === cur.greek && c.e === cur.e));
    const col = (i: number) => columnsList[Math.max(0, Math.min(columnsList.length - 1, i))];
    let next: Focus | null = null;
    /* j and k walk the strikes too, the way every list in a terminal walks (the paying-user audit's H6) */
    if (e.key === 'ArrowDown' || e.key === 'j') next = { ...cur, strike: strikes[Math.min(strikes.length - 1, si + 1)] };
    else if (e.key === 'ArrowUp' || e.key === 'k') next = { ...cur, strike: strikes[Math.max(0, si - 1)] };
    else if (e.key === 'ArrowRight') next = { ...cur, greek: col(ci + 1).g, e: col(ci + 1).e };
    else if (e.key === 'ArrowLeft') next = { ...cur, greek: col(ci - 1).g, e: col(ci - 1).e };
    else if (e.key === 'Home') next = { ...cur, greek: col(0).g, e: col(0).e };
    else if (e.key === 'End') next = { ...cur, greek: col(columnsList.length - 1).g, e: col(columnsList.length - 1).e };
    else if ((e.key === 'Enter' || e.key === ' ') && keyCell) {
      e.preventDefault();
      const c = cellBox(keyCell);
      pick(keyCell, c?.x, c?.y);
      return;
    } else return;
    e.preventDefault();
    if (next) walkTo(next);
  };

  const supremeGreek = greeks[0];
  const supremeDefault = supremeFor(supremeGreek);
  /* THE HOVER GOES ON WHILE A CELL IS KEPT (the owner, 2026-10-14: a click keeps, "but for normal should just be an easy
     hover"): the kept cell keeps its card, and the pointer still reads every other cell out — one card at a time, the kept
     one back when the pointer leaves */
  const hoveringElsewhere = !!(pinned && hovered && !(hovered.strike === pinned.strike && hovered.e === pinned.e && hovered.greek === pinned.greek));
  const focus: Focus = hoveringElsewhere ? hovered! : pinned ?? hovered ?? { strike: supremeDefault.strike, e: supremeDefault.e, greek: supremeGreek };
  const fs = surface.strikes.indexOf(focus.strike);
  const ex = surface.expiries[focus.e];
  /* THE CARD SAYS WHAT THE CELL SAYS (Noah, 2026-10-17, the supreme node's hover: the capsule read −$254.0M and its card
     −$254.1M): a cell prints its figure at three significant figures (q3, below), so the card's legs and net are read
     through the same q3 — one figure for one cell, on the capsule and on the card */
  const putV = fs >= 0 ? q3(surface.put[focus.greek][focus.e][fs]) : 0;
  const callV = fs >= 0 ? q3(surface.call[focus.greek][focus.e][fs]) : 0;
  const netV = fs >= 0 ? q3(surface.net[focus.greek][focus.e][fs]) : 0;
  const oi = fs >= 0 ? surface.oi[focus.e][fs] : 0;
  const gexV = fs >= 0 ? surface.net.gex[focus.e][fs] : 0;
  const distPct = ((focus.strike - surface.spot) / surface.spot) * 100;
  const kingHere = kingFor(focus.greek);
  const isKingCell = kingHere.strike === focus.strike && kingHere.e === focus.e;
  const isSupreme = surface.supreme[focus.greek].strike === focus.strike;
  /* HOW MUCH OF THIS BOOK DIES AT THE BELL — today's column against every
     column drawn (today counted back in when it is hidden), in the window */
  const bell = (() => {
    if (todayIdx < 0) return null;
    // The same book either way: today plus the columns that stand beside it
    // NOW — so the figure does not move when the toggle flips
    const all = shownIdx.includes(todayIdx) ? shownIdx : [todayIdx, ...shownIdx.slice(0, Math.max(0, shownIdx.length - 1))];
    let dies = 0;
    let total = 0;
    for (const e of all)
      for (const strike of strikes) {
        const v = Math.abs(surface.net[focus.greek][e][surface.strikes.indexOf(strike)] ?? 0);
        total += v;
        if (e === todayIdx) dies += v;
      }
    return total > 0 ? Math.round((100 * dies) / total) : 0;
  })();
  const bellWords = bell == null ? null : afterBell ? `after the close · today's ${bell}% has expired` : `${bell}% of this expires today at the close`;
  /* AN EMPTY CELL SAYS SO (the owner, 2026-10-14, after a walk as a user: a $0 cell read "put-heavy" and "peak · hedging
     amplifies a move here" — zero is at or over zero, and in an all-negative row it was the row's peak): no leg at all
     is "nothing here", not a side that wins */
  const empty = Math.abs(putV) < 1e-9 && Math.abs(callV) < 1e-9;
  const verdict = empty
    ? 'nothing here · no hedging at this strike for this date'
    : focus.greek === 'gex'
      ? gexV >= 0
        ? 'peak · hedging amplifies a move here'
        : 'well · hedging absorbs a move here'
      : netV >= 0
        ? 'the put side wins here'
        : 'the call side wins here';
  const verdictInk = empty ? 'rgb(var(--text-muted))' : focus.greek === 'gex' ? (gexV >= 0 ? SHORT_GAMMA : LONG_GAMMA) : netInk(focus.greek, netV);
  const { levels } = surface;
  const role = focus.strike === levels.callWall ? 'call wall' : focus.strike === levels.putWall ? 'put wall' : focus.strike === pinStrike ? 'pin' : null;
  /* SINCE THE OPEN, PER CELL (2026-10-12): the open's book beside today's, matched by strike and by date (the open's
     window sat around the open's price, so its rows are not today's rows), and read by the one since-open rule —
     "+37%" / "4.2×" by the ratio open-over-now, words when a percent would mislead. The figure rides the capsule in
     a chip when the column has room, a dot when it has a little, and the read line always carries it. */
  const openIdx = useMemo(
    () => (open ? { strikes: new Map(open.strikes.map((s, i) => [s, i] as const)), expiries: new Map(open.expiries.map((x, i) => [x.date, i] as const)) } : null),
    [open]
  );
  type Since = { text: string; dir: 1 | -1 | 0; size: number; /** "−96%" / "4.2×", or null where words say it better */ figure: string | null; /** "bleeding", "building", "new today", "flipped sides", "about flat" */ words: string };
  const sinceCache = useMemo(() => new Map<string, Since | null>(), [open, surface]);
  const sinceCell = (g: Greek, e: number, strike: number): Since | null => {
    if (!open || !openIdx) return null;
    const key = `${g}|${e}|${strike}`;
    const hit = sinceCache.get(key);
    if (hit !== undefined) return hit;
    let out: Since | null = null;
    const si = openIdx.strikes.get(strike);
    const ei = openIdx.expiries.get(surface.expiries[e]?.date ?? '');
    const s = surface.strikes.indexOf(strike);
    if (si != null && ei != null && s >= 0) {
      const now = surface.net[g][e][s];
      const was = open.net[g][ei][si];
      if (Number.isFinite(now) && Number.isFinite(was) && Math.abs(now) >= 1e-9) {
        const ratio = was / now;
        const read = sinceOpenRead(ratio);
        /* how much moved, for the exceptional cut below: the DOLLARS that came or went, as a share of the board's
           heaviest cell — a node of nothing that flipped its sign or doubled is not abnormal, a wall that lost a
           third of itself is */
        const size = Math.abs(now - was) / Math.max(1, surface.maxAbs[g]);
        if (read) out = { text: read.figure ?? read.short, dir: read.dir, size, figure: read.figure, words: read.short };
      }
    }
    sinceCache.set(key, out);
    return out;
  };
  /* THE MOVE SINCE THE OPEN, IN THE CARD TOO (2026-10-14 — the capsule's bare "−96%" pill said neither what fell nor since
     when; its words lived in the aria-label alone) */
  const sinceHere = sinceCell(focus.greek, focus.e, focus.strike);
  /* ONLY THE EXCEPTIONAL NODES WEAR IT (Noah, 2026-10-12: "only shown for a certain number of nodes that we consider
     exceptional or abnormal"): the ten biggest moves since the open on this board, among the cells drawn — biggest
     in dollars against the board's heaviest cell, at least a twentieth of it — and only moves the since-open rule
     calls building or bleeding (past ±15%), new today, or flipped. A quiet board wears none. The read line still
     says it for any cell under the pointer. */
  const exceptional = useMemo(() => {
    const set = new Set<string>();
    if (!open || !openIdx) return set;
    const scored: { key: string; size: number }[] = [];
    for (const g of greeks)
      for (const e of shownIdx)
        for (const strike of strikes) {
          const r = sinceCell(g, e, strike);
          if (!r || r.size < SINCE_FLOOR) continue;
          if (r.dir === 0 && r.text !== 'flipped sides' && r.text !== 'new today') continue;
          scored.push({ key: `${g}|${e}|${strike}`, size: r.size });
        }
    scored.sort((a, b) => b.size - a.size);
    for (const s of scored.slice(0, SINCE_SHOWN)) set.add(s.key);
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openIdx, surface, greeks, shownIdx, strikes]);
  /* while the focus door is open, the kept nodes' strike labels and date heads stay readable above the scrim too */
  const keptRows = useMemo(() => new Set(focusOn ? [...exceptional].map(k => Number(k.split('|')[2])) : []), [focusOn, exceptional]);
  const keptCols = useMemo(() => new Set(focusOn ? [...exceptional].map(k => k.split('|').slice(0, 2).join('|')) : []), [focusOn, exceptional]);
  /* the kept strikes, highest first — the summary line names them (the audit's M12) */
  const keptStrikes = useMemo(() => [...keptRows].sort((a, b) => b - a), [keptRows]);
  /* the chip beside a full figure needs ~128px (the figure at 13px is 60, the chip 26, the padding 16, the star's
     lane after that); under it the dot rides the capsule's edge wherever a figure prints at all */
  /* …at 11px the chip's width is its words' ("−45%" 35px, "flipped sides" 96): the chip where the column holds the figure,
     the chip and their air, the dot where it does not (the audit's H5b) */
  const laneFor = (text: string | null): 'figure' | 'dot' | 'none' => (text && cellW >= 60 + text.length * 6.8 + 8 + 24 ? 'figure' : figure !== 'none' ? 'dot' : 'none');
  /* the dot beside the figure from 56px — under that the short figure fills the capsule and the dot rides the edge */
  const dotBeside = cellW >= 56;
  /* THE FULL FIGURE ONLY WHERE IT FITS BESIDE WHAT THE CELL ALSO WEARS (the paying-user audit's H1, 2026-10-13): one
     width rule for every cell printed "−$10.…" wherever a since-dot, the star or a chip took a slice of the capsule —
     the cell now prints the short figure when the full one and its company do not fit, never a cut one */
  const figureFor = (v: number, star: boolean, lane: 'figure' | 'dot' | 'none', chip: string | null): Figure => {
    if (figure !== 'full') return figure;
    const company = (star ? fontSize * 0.9 + 4 : 0) + (lane === 'dot' && dotBeside ? 8 : 0) + (lane === 'figure' && chip ? chip.length * 6.8 + 12 : 0);
    return fmtUsd(-Math.abs(v)).length * fontSize * GLYPH + company + 16 + 6 <= cellW ? 'full' : 'short';
  };
  /* THE CARD'S WORDS — the kept cell's; nothing at rest or under a mere hover */
  const cardAside = `${ex?.date ?? ''} · ${focus.e === todayIdx ? 'today' : (ex?.short ?? '')} · ${distPct >= 0 ? '+' : '−'}${Math.abs(distPct).toFixed(2)}%`;
  const legMax = Math.max(1, Math.abs(putV), Math.abs(callV));
  const pct = (v: number) => `${Math.round((Math.abs(v) / legMax) * 100)}%`;
  /* THE TAGS ON A LINE OF THEIR OWN (Noah, 2026-10-12: "this should be better formatted" — three tags and the date
     on one head line wrapped "PUT WALL" and "★ HEAVIEST CELL" over two lines each): the head is the strike and the
     date; the wall, the supreme and the star read on one line under it */
  const cardTags = [
    role && <span key="role" className="whitespace-nowrap text-textSecondary">{role}</span>,
    isSupreme && (
      <span key="supreme" className="whitespace-nowrap" style={{ color: SUPREME }}>
        supreme
      </span>
    ),
    isKingCell && <span key="king" className="whitespace-nowrap text-textSecondary">★ heaviest cell</span>,
  ].filter(Boolean);
  const cardBody = (
    <>
      {/* THE TAGS WRAP BY TAG (Noah, 2026-10-17: "i found heaviest bleeding again" — PUT WALL · SUPREME · ★ HEAVIEST CELL
          ran past the card's edge on one line): each tag is whole, the line breaks between them */}
      {cardTags.length > 0 && <span className="col-span-2 -mt-0.5 mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] uppercase tracking-widest">{cardTags}</span>}
      <CardRow k="Put" v={fmtUsd(shownGreek(focus.greek, putV))} sub={pct(putV)} ink={PUT_INK} />
      <CardRow k="Call" v={fmtUsd(shownGreek(focus.greek, callV))} sub={pct(callV)} ink={CALL_INK} />
      <CardRow k={`Net · ${GREEK_LABEL[focus.greek]}`} v={fmtUsd(shownGreek(focus.greek, netV))} sub={empty ? 'nothing' : netV >= 0 ? 'put-heavy' : 'call-heavy'} ink={empty ? 'rgb(var(--text-muted))' : heatLaneColor(netV, surface.maxAbs[focus.greek], mode ?? HEAT_MODE, 0.35, paper)} />
      {oi > 0 && <CardRow k="Open interest" v={oi.toLocaleString('en-US')} sub="contracts" />}
      {sinceHere && <CardRow k="Since the open" v={sinceHere.figure ?? sinceHere.words} sub={sinceHere.figure ? sinceHere.words : undefined} ink={sinceInk(sinceHere.dir)} />}
    </>
  );
  const cardTitle = fmtStrike(focus.strike);
  const cardFoot = (
    <>
      <span style={{ color: verdictInk }}>{verdict}</span>
      {pinned && <span className="block mt-0.5 text-[11px] uppercase tracking-wider text-textMuted">kept · {letGo}</span>}
    </>
  );
  /* While a node is in focus the pointer stops washing rows and columns — two
     highlights at once is no highlight */
  const hoverRow = pinned ? null : (hovered?.strike ?? hoverStrike ?? null);
  /* The scrim's blur outlives the pin by the length of its fade — dropping the
     radius the moment the pin goes would un-blur the grid in one frame under a
     scrim that is still fading. Between times the layer sits at blur(0), which
     measured free. */
  const [scrim, setScrim] = useState(false);
  useEffect(() => {
    if (focusOn) {
      setScrim(true);
      return;
    }
    const t = window.setTimeout(() => setScrim(false), 460);
    return () => window.clearTimeout(t);
  }, [focusOn]);
  /* The star and the supreme per greek, once per render rather than once per cell */
  const kings = useMemo(() => new Map(greeks.map(g => [g, kingFor(g)] as const)), [greeks, kingFor]);
  const supremes = useMemo(() => new Map(greeks.map(g => [g, supremeFor(g)] as const)), [greeks, supremeFor]);
  const supremeStrike = surface.supreme[supremeGreek].strike;
  /* A ROW'S LEVEL IN THE STRIKE'S INK (strikeRole.ts, 2026-10-13): the words after the strike made the column as wide as
     its widest label; the strike carries its level in its ink and its underline, the words on its title */
  const roleOf = (strike: number) =>
    strikeRole(strike, { supreme: supremeStrike, callWall: levels.callWall, putWall: levels.putWall, flip: levels.flip, pin: pinStrike, owned: !!marks?.has(strike) });
  const showStar = cellW >= 96;
  const book = peekEntry(surface.ticker);

  return (
    <div className="h-full min-h-0 flex flex-col" data-ledger>
      {/* WHAT THE FOCUS KEPT, IN WORDS (the audit's M12, 2026-10-13): the count and the strikes, highest first, each a
          keep — ONE LINE ABOVE THE GRID (the owner, 2026-10-13: laid over the grid's foot it wrapped to three lines, hid
          the last rows and sat at a different height in every column); past the width it scrolls sideways */}
      {focusOn && keptStrikes.length > 0 && (
        <div className={`shrink-0 h-7 flex items-center gap-x-2 px-3 border-b border-borderSubtle ${ground} font-mono text-[11px] whitespace-nowrap overflow-x-auto scroll-row`} data-ledger-focus-summary={exceptional.size}>
          <span className="shrink-0 text-textSecondary">
            {exceptional.size} biggest {exceptional.size === 1 ? 'move' : 'moves'} since the open
            {keptStrikes.length < exceptional.size ? `, on ${keptStrikes.length} ${keptStrikes.length === 1 ? 'strike' : 'strikes'}` : ''}
          </span>
          <span className="shrink-0 text-textMuted">·</span>
          {keptStrikes.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => onSelectStrike?.(s)}
              title={`Keep ${fmtStrike(s)}`}
              className={`shrink-0 tnum tabular-nums rounded px-1 transition-colors ${pinned?.strike === s ? 'text-silver' : 'text-textPrimary hover:text-silver'}`}
            >
              {fmtStrike(s)}
            </button>
          ))}
        </div>
      )}
      {/* THE GRID — rows share the height; past ROW_MIN it scrolls */}
      <div className="relative flex-1 min-h-0">
        <div className="pointer-events-none absolute right-2 top-1 z-30">
          <StaleMark at={book?.at} ttlMs={BOOK_TTL_MS} fault={book?.status === 'error' ? 'failed' : null} />
        </div>
        {/* THE FOCUS SCRIM — one layer for the blur and the dim (see index.css) */}
        <div
          aria-hidden
          data-ledger-scrim={focusOn ? '' : undefined}
          className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${focusOn ? 'opacity-100' : 'opacity-0'}`}
          /* ONLY THE OPACITY ANIMATES. The radius holds while the scrim is up
             and the layer stays mounted at blur(0) between times, so the first
             frame has nothing to allocate. Measured on a 320-cell calendar,
             frames in 700ms against 101 idle: blurring every cell 46 (a 120ms
             stall) · this 94 in and 101 out · easing the radius on the scrim
             instead 85 and 89 — re-blurring the backdrop every frame costs
             more than the fade is worth. */
          style={{ backdropFilter: `blur(${scrim ? 3 : 0}px)`, WebkitBackdropFilter: `blur(${scrim ? 3 : 0}px)`, background: paper ? 'rgb(var(--inset) / 0.66)' : 'rgba(10,10,10,0.66)' }}
        />
        <div
          ref={boxRef}
          className="h-full overflow-auto"
          /* Invisible for the one frame before its box is measured (see the effect above); no sideways scrollbar
             flashing while the grid holds its promised width through a glide */
          style={box.w ? (gliding ? { overflowX: 'hidden' } : undefined) : { visibility: 'hidden' }}
          tabIndex={0}
          role="group"
          aria-label="The book by strike and expiry — the arrow keys walk the cells, Enter keeps one"
          aria-activedescendant={keyCell ? cellId(keyCell) : undefined}
          onFocus={e => {
            if (e.target !== e.currentTarget || keyCell || !e.currentTarget.matches(':focus-visible')) return;
            const start = pinned ?? firstCell();
            if (start) walkTo(start);
          }}
          onBlur={e => {
            if (e.target === e.currentTarget) leaveKeys();
          }}
          onKeyDown={onKeys}
          onPointerEnter={() => {
            inBoxRef.current = true;
          }}
          onPointerLeave={() => {
            inBoxRef.current = false;
            setLeft(n => n + 1);
          }}
        >
        {/* Keyed on the head's choices: a change of greek, expiries, window or
            palette FADES the new grid in rather than snapping (Noah, 2026-09-05:
            "a smooth transition between changes … same with the heatmap") */}
        <div
          /* THE PALETTE IS NOT IN THE KEY (2026-09-13; Noah: the ladder's "trans from thermal colour
             to house colour" for the calendar too): keyed on it, a Colours switch remounted every
             cell and the new ramp snapped in; on the same cells the pill's own 700ms colour
             transition carries each fill and ink from one ramp to the other, the ladder's way */
          /* THE FIT IS NOT A CHOICE (2026-10-12): keyed on the HEAD'S window, not on the columns that fit — a pane
             widening or narrowing adds or drops a column in place (its cells keyed by date and strike stay), where
             keying on the fit remounted every cell of every pane as a name left (~66ms, the last of the exit's jank) */
          key={`${greeks.join(',')}-${expiries.join('|')}-${rings}-${afterBell ? 'after' : 'now'}-${leg}`}
          data-ledger-focus={focusOn ? '' : undefined}
          className="grid min-h-full pr-1"
          /* THE STRIKE COLUMN IS AS WIDE AS ITS WIDEST ROW and the cells take the rest (Noah, 2026-10-12: "let the
             container fit that empty space … the nodes should get longer equally"); its width is measured off the
             head below for the figures' sizing */
          /* …AND PAINTED ONCE: `will-change: transform` through the glide gives the pinned grid a layer of its own, so
             the frames in between only composite it as the pane clips it — a trace of a name leaving put PAINT first
             (135ms in 700ms: four panes of shadowed capsules repainted every frame), style recalc second, layout third */
          style={{ gridTemplateColumns: `max-content repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: rowsTemplate, ...(gliding && box.w > 0 ? { width: box.w, willChange: 'transform' } : null) }}
        >
          {/* HEAD — sticky under scroll */}
          <div ref={setStrikeHead} className={`sticky top-0 z-10 ${ground} pl-2 pr-1.5 flex flex-col items-end justify-end pb-1 font-mono text-[11px] font-semibold uppercase tracking-normal text-textSecondary border-b border-borderSubtle`} style={{ gridRow: 'span 2' }}>
            {/* THE COLUMN'S WIDTH IS RESERVED (2026-10-12, the replay): the widest row this book can print — its
                longest strike with the two widest tags — set invisibly here, so a wall tag moving from row to row
                never moves the column, and the cells beside it keep their width while the replay runs */}
            <span aria-hidden className="invisible block h-0 w-max overflow-hidden whitespace-nowrap normal-case tracking-normal text-[11px] font-bold tnum tabular-nums">
              {widestStrike}
            </span>
            Strike
          </div>
          {greeks.map(g => (
            <div
              key={`g-${g}`}
              /* min-w-0 and a cut: on a phone five groups of one 45px column overprinted each other's words (the audit's 2.13) */
              className={`sticky top-0 z-10 ${ground} ${narrowGroup ? 'px-0.5 tracking-wider' : 'px-2 tracking-widest'} flex items-center justify-center min-w-0 overflow-hidden font-mono text-[11px] font-bold uppercase text-textPrimary border-l border-borderSubtle`}
              style={{ gridColumn: `span ${shownIdx.length}` }}
              title={`${GREEK_LABEL[g]} · ${GREEK_UNIT[g]}`}
            >
              <span className="truncate">
                {GREEK_LABEL[g]}
                {/* normal-case: the head's capitals turned DEX's "1σ" into "1Σ" (the paying-user audit's M9) */}
                {!narrowGroup && <span className="ml-1 font-normal normal-case tracking-normal text-textMuted">· {GREEK_UNIT[g]}</span>}
              </span>
            </div>
          ))}
          {greeks.map(g =>
            shownIdx.map((e, ci) => {
              const exp = surface.expiries[e];
              return (
                <div
                  key={`h-${g}-${exp.dte}`}
                  data-exp-head
                  data-pinned-col={pinned && pinned.greek === g && pinned.e === e ? '' : undefined}
                  data-kept-col={keptCols.has(`${g}|${e}`) ? '' : undefined}
                  /* narrow: the date at its natural tracking in 2px of padding — 40px in a 48px column (the audit's H3) */
                  /* THE DATE OVER THE MIDDLE OF ITS COLUMN (Noah, 2026-10-15: "i want the dates to be centered in the middle not on
                     the right") — the capsules under it are centred in the column, so the head stands over them */
                  className={`sticky z-10 ${ground} ${narrowHead ? 'px-0.5 tracking-normal' : 'px-2 tracking-wider'} overflow-hidden flex items-center justify-center font-mono text-[11px] uppercase text-textSecondary border-b border-borderSubtle whitespace-nowrap ${
                    ci === 0 ? 'border-l' : ''
                  } ${(pinned ? pinned.greek === g && pinned.e === e : hovered && hovered.greek === g && hovered.e === e) ? 'text-textPrimary' : ''}`}
                  style={{ top: HEAD_H / 2 }}
                >
                  {onExpiry ? (
                    <button
                      type="button"
                      onClick={() => onExpiry(e)}
                      title={`Read ${exp.date} only`}
                      aria-pressed={expiries.length === 1 && expiries[0] === e}
                      data-expiry-pick={e}
                      className={`bg-transparent border-0 p-0 font-inherit uppercase cursor-pointer hover:text-textPrimary ${e === todayIdx || (expiries.length === 1 && expiries[0] === e) ? 'text-textPrimary font-bold' : ''}`}
                    >
                      {exp.date}
                      {!narrowHead && <span className="text-textMuted">&nbsp;· {e === todayIdx ? 'today' : exp.short}</span>}
                    </button>
                  ) : (
                    <>
                      <span className={e === todayIdx ? 'text-textPrimary font-bold' : ''}>{exp.date}</span>
                      {!narrowHead && <span className="text-textMuted">&nbsp;· {e === todayIdx ? 'today' : exp.short}</span>}
                    </>
                  )}
                </div>
              );
            })
          )}

          {/* ROWS */}
          {strikes.map((strike, si) => {
            const s = surface.strikes.indexOf(strike);
            const isPinnedRow = strike === pinned?.strike;
            const isSupremeRow = strike === supremeStrike;
            const role = roleOf(strike);
            const isHoverRow = strike === hoverRow;
            const rowWash = isHoverRow ? 'bg-silver/[0.05]' : '';
            return [
              /* THE SPOT RULE RUNS UNDER THE NODES ALONE (Noah, 2026-10-12: "centered in the middle in relation to
                 the amount of nodes not the entire width"): the strike column's cell of this row stays empty, the
                 rule spans the cell columns, so the pill is at the middle of the nodes */
              si === above.length && <div key="spot-strike" aria-hidden />,
              si === above.length && (
                <div key="spot" data-spot-row className="px-1.5 flex items-center" style={{ gridColumn: `span ${cols}` }}>
                  <RoomSpotRule ticker={surface.ticker} fallback={liveSpot ?? surface.spot} centre live={live} />
                </div>
              ),
              <div
                key={`s-${strike}`}
                data-strike={strike}
                data-pinned-row={isPinnedRow ? '' : undefined}
                data-kept-row={keptRows.has(strike) ? '' : undefined}
                onClick={() => onSelectStrike?.(strike)}
                className={`pl-2 pr-1.5 flex items-center justify-end overflow-hidden font-mono text-[11px] tnum tabular-nums cursor-pointer whitespace-nowrap ${rowWash} ${
                  isPinnedRow ? `text-silver font-bold ${paper ? '' : 'shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]'}` : role.ink ? 'font-bold' : 'text-textPrimary'
                }`}
                style={!isPinnedRow && role.ink ? { color: role.ink } : undefined}
                title={role.words.length ? `${fmtStrike(strike)} · ${role.words.join(' · ')}` : undefined}
                aria-label={role.words.length ? `${fmtStrike(strike)} · ${role.words.join(' · ')}` : undefined}
                data-supreme-row={isSupremeRow ? '' : undefined}
                data-row-roles={role.words.length ? role.words.join(' · ') : undefined}
              >
                {/* THE STRIKE COLUMN AT THE FAR LEFT, ITS LEVEL IN ITS INK (strikeRole.ts, 2026-10-13): the column is the
                    strike's own width and the strike sits flush right, so the capsules start right after it */}
                <span className={underlineClass(role.underline)}>
                  <StrikeNum v={strike} cents={cents} />
                </span>
              </div>,
              ...greeks.flatMap(g => {
                const king = kings.get(g)!;
                const sup = supremes.get(g)!;
                const maxAbs = q3(paintMax[g]);
                return shownIdx.map((e, ci) => {
                  const exp = surface.expiries[e];
                  const isKing = king.e === e && king.strike === strike;
                  const isSupremeCell = sup.e === e && sup.strike === strike;
                  const isPinned = !!pinned && pinned.strike === strike && pinned.e === e && pinned.greek === g;
                  const isHover = !pinned && !!hovered && hovered.strike === strike && hovered.e === e && hovered.greek === g;
                  const colWash = !pinned && hovered && hovered.greek === g && hovered.e === e && !isHoverRow ? 'bg-silver/[0.05]' : '';
                  const ring = isHover || isPinned ? SILVER : isSupremeCell ? SUPREME : undefined;
                  const sc = exceptional.has(`${g}|${e}|${strike}`) ? sinceCell(g, e, strike) : null;
                  const v = q3(surface[leg][g][e][s]);
                  return (
                    <LedgerCell
                      key={`c-${g}-${exp.dte}-${strike}`}
                      strike={strike}
                      e={e}
                      g={g}
                      v={v}
                      maxAbs={maxAbs}
                      date={exp.date}
                      first={ci === 0}
                      wash={rowWash || colWash}
                      isKing={isKing}
                      ring={ring}
                      star={isKing && showStar}
                      since={sc?.text ?? null}
                      sinceDir={sc?.dir ?? 0}
                      sinceLane={laneFor(sc?.text ?? null)}
                      idBase={idBase}
                      dotBeside={dotBeside}
                      kept={focusOn && exceptional.has(`${g}|${e}|${strike}`)}
                      fontSize={fontSize}
                      figure={figureFor(v, isKing && showStar, sc ? laneFor(sc.text) : 'none', sc?.text ?? null)}
                      mode={mode}
                      paper={paper}
                      pinned={isPinned}
                      onHover={onHoverCell}
                      onPick={onPickCell}
                    />
                  );
                });
              }),
            ];
          })}
          </div>
        </div>
      </div>
      {/* THE CARD — following the pointer over the cells, and on the clicked node (see `keptPos`) until the next click */}
      {hovered && hoverStart && (!pinned || hoveringElsewhere) && (
        <PointerFollowCard start={hoverStart} dense width={CARD_W} title={cardTitle} aside={cardAside} foot={cardFoot} testId="data-ledger-card" testValue={keyOf(focus)}>
          {cardBody}
        </PointerFollowCard>
      )}
      {pinned && keptPos && !hoveringElsewhere && (
        <PointerCard x={keptPos.x} y={keptPos.y} width={CARD_W} still dense title={cardTitle} aside={cardAside} foot={cardFoot} testId="data-ledger-card" testValue={keyOf(focus)}>
          {cardBody}
        </PointerCard>
      )}
    </div>
  );
};

/* MEMOISED (2026-10-12, a name leaving the band): the band re-renders on every change of its columns, and every
   pane with it — 280 cell elements a pane just to find nothing changed. With its lists and handlers held stable
   by the band, a pane renders only for its own changes. */
export default memo(ExposureLedger);
