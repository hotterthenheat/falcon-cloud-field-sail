/*
==================================================
  SLAYER TERMINAL - EXPOSURE FIELD
  The exposure matrix's successor — the head the grid
  never had, over the Ledger:

    the head    whose book (with a search to change
                it), the SUPREME as a magenta door
                that pins its strike, fullscreen;
                beneath, GREEK (GEX · DEX · VEX ·
                All), EXPIRIES, STRIKES each side
    the Ledger  ExposureLedger — strike × expiry in
                the house capsules, full: the rows
                share the height, the figure in every
                cell, a fixed read line, hover lights
                the capsule, click pins

  HISTORY, so nobody rebuilds it by accident: the
  redesign arc of 2026-09-03…05 tried a flat SVG
  field, a three.js terrain, the Reach (each expiry
  as a curve at its σ·√T width), the WHEEL (spot at
  the hub, strikes as rings, expiries as rays — "this
  is the one", then removed whole when Noah's
  partners did not approve), a wind map on Plot's
  vector mark, Observable's hexbin on Plot's hexbin
  transform, and a stretched honeycomb with the
  figures inside. Noah closed the arc on 2026-09-05:
  "i feel like im trying too hard to recreate the
  wheel. lets revert back to capsules just make our
  capsules nice and full." The capsules are the view.

  THE BOOK IS BUILT WHOLE (±30) over the calendar and
  the window is a view of it — the presets set it,
  the field scrolls it. Hover any cell for every
  figure at that strike and expiry.
==================================================
*/

import { cloneElement, isValidElement, startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import Fold from '../ui/Fold';
import ScopeChip from '../ui/ScopeChip';
import ExpiryRangeCard, { type ExpiryDay, type ExpiryShortcut } from '../ui/ExpiryRangeCard';
import { expiryFor } from '../../core/calendar';
import DropdownMulti from '../ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import { undoable } from '../ui/undo';
import LedgerGuide, { guideTitle } from './LedgerGuide';
import { attachScrollMore } from '../ui/scrollMore';
import { FLAT_DOOR, FLAT_ON } from '../ui/flatDoor';
import { createPortal } from 'react-dom';
import { ArrowLeft, Crosshair, Maximize2, Minimize2, Plus, X } from 'lucide-react';
import { ensureBook, snapshotOf } from '../../data/uwBook';
import TickerLookup from '../ui/TickerLookup';
import useFocusTrap from '../ui/useFocusTrap';
import { useAnchoredMenu } from '../ui/useAnchoredMenu';
import BookRead, { ReadDoor } from './BookRead';
import ExposureLedger, { SinceBadge, columnsThatFit } from './ExposureLedger';
import { useResolvedTheme } from '../../theme/theme';
import { GREEK_PICK_OPTIONS, nextGreekPick, pickGreeks, type SurfaceCell } from './exposureView';
import CompanyLogo from '../ui/CompanyLogo';
import TickerSearch from '../ui/TickerSearch';
import { useFadeClose } from '../ui/useFadeClose';
import { fmtUsd } from '../../data/gex';
import { STRIKE_WINDOWS, type StrikeWindow } from '../../data/exposure';
import { useLevelsScope } from '../../data/levelsScope';
import ColumnFacts from './ColumnFacts';
import { roomLevels } from '../../data/roomLevels';
import { expirySpan, levelsBook } from '../../data/bookWindow';
import { shownGreek } from './retailSign';
import { useLedgerPalette } from '../../data/ledgerPalette';
import MoreDoor from './MoreDoor';
import { todayColumn, buildExposureSurface, CALENDAR_DTES, GREEKS, type ExposureSurface, type Greek } from '../../data/exposureSurface';
import { snapshotAtOpen } from '../../data/levelview';
import { HEAT_MODE, heatCellStyle, heatRampColorFor } from './heatmap';
import type { MarketSnapshot } from '../../types/market';
import { VIEWS_FOR, readLedgerView, writeLedgerView, type LedgerView } from './ledgerView';
import ExposureMatrix from './ExposureMatrix';
import { DataCard } from './BookProvenance';
import { ABSORB, AMPLIFY, THERMAL_COOL, THERMAL_WARM } from './paletteInk';
import ExposureProfileView from './ExposureProfileView';

/* THE LEGS (the competitive audit, 2026-10-13 — a net-only grid was the category's toy-grade marker): the net, one leg
   alone, or both side by side on the matrix (the two columns a greek, the bars mirrored at the seam). The calendar's
   capsule carries one figure, so Both is the matrix's alone there. */
export type LegsPick = 'net' | 'call' | 'put' | 'both' | 'all';
const legsOptions = (calendar: boolean): DropdownOption<LegsPick>[] => [
  /* THE WHOLE BOOK IN ONE ROW (the owner, 2026-10-14): each leg in its own column and the net they add to, under every
     greek — the matrix's own, as Both is; a calendar cell carries one figure, so there it picks a leg */
  { value: 'all', label: 'Put · Call · Net', short: 'All', hint: calendar ? 'On the matrix only — each leg in its own column and the net' : 'Each leg in its own column and the net they add to, under every greek', disabled: calendar },
  { value: 'net', label: 'Net', hint: 'The two legs added — the sign is the side that wins the strike' },
  { value: 'call', label: 'Calls', hint: 'The call leg alone — what dealers hedge against the calls open there' },
  { value: 'put', label: 'Puts', hint: 'The put leg alone — what dealers hedge against the puts open there' },
  { value: 'both', label: 'Both', hint: calendar ? 'On the matrix only — the two legs side by side' : 'The two legs side by side, each in its own column, the bars mirrored at the seam', disabled: calendar },
];

interface ExposureFieldProps {
  /** Null before the first tick — the panel waits rather than throws. */
  snapshot: MarketSnapshot | null | undefined;
  /** Strikes each side of spot. Given: the host's control seeds the window (its own presets stay hidden inline). */
  half?: StrikeWindow;
  hoverStrike?: number | null;
  selectedStrike?: number | null;
  onHoverStrike?: (strike: number | null) => void;
  onSelectStrike?: (strike: number) => void;
  openRatio?: Map<number, number> | null;
  /** Given, the head carries the ticker search — the panel can change whose book it shows */
  onTicker?: (ticker: string) => void;
  /** 'desk' = the Pulse widget's two-row head (name, search, supreme, then the
      strips). 'band' = ONE toolbar row for the Map's Calendar band (2026-09-05):
      the host names the book, so only the strips, the book toggle, the supreme
      door and fullscreen — the "better custom button section" Noah asked for. */
  toolbar?: 'desk' | 'band' | 'panel';
  /** Your positions, strike → the read for it — the ledger marks those rows */
  marks?: ReadonlyMap<number, string>;
  /** What leads the band head — the host's scope chip (which name this book is) */
  lead?: ReactNode;
  /** ONE LENS PER PAGE (Noah, 2026-09-08, "do the sync"): given, the host owns
      the greek — its ladder and this calendar read the same one, and a change
      in either place moves both. Absent, the panel keeps its own (Pulse). */
  /** The greek pick — the greeks ticked, or ['all'] (see exposureView.ts) */
  greeks?: string[];
  onGreeks?: (values: string[]) => void;
  /** Rebuild on every snapshot — the Map's replay hands one in every frame (2026-09-08) */
  fresh?: boolean;
  /** What follows the strips on the band head — the Map's replay transport, so the calendar carries the position */
  after?: ReactNode;
  /** A bar across the top of the book, under the band — the Map's replay transport (2026-10-13: in the band it widened the
      band and the page under it jumped 34px) */
  above?: ReactNode;
  /** THE NAMES THE BOOK HOLDS, host first (Noah, 2026-10-14: the day box splits with the book — a tape and a book through
      the day a name, under its pane) */
  onNames?: (names: string[]) => void;
  /** The expiry dates the Expiries card is holding, nearest first. The clock, the level report and the tape read this
      same window — not a book of their own. */
  onExpiries?: (dates: string[]) => void;
  /** A name that left the band. Absent, or a name missing from the map, follows the band. */
  onNameDates?: (overrides: Record<string, string[]>) => void;
  /** THE FULLSCREEN'S SHAPE (Noah, 2026-09-10: "i really love the full screen
      transition on the two books on one ruler … make that the same for the
      heatmap and ladder"): 'move' = the ruler's own — THIS BOX glides to the
      whole viewport and back on a layout animation, nothing remounts (the Map);
      'portal' = a fixed layer fading in over the page, for hosts whose ancestors
      carry a transform (Pulse's tiles) and would trap a fixed box. */
  fullMode?: 'move' | 'portal';
  /** THE ONE FULLSCREEN BUTTON is the host's (Pulse's tile head, 2026-09-12):
      a one-shot token lifts this box's own fullscreen (its pickers survive,
      which the tile takeover's remount would not give)… */
  fullOpen?: number;
  /** …and while docked under such a head the box's own button stays hidden —
      up, it is the way back beside Esc. The Map keeps its own button. */
  headFull?: boolean;
  /** NAMES SIDE BY SIDE (Noah, 2026-09-12: "multiple names to be shown side by
      side for both the ladder and the calendar layout… up to 4 names max"):
      given, the band carries a Names control and the box splits into a column
      per name — the host's first, up to three more — every column on the one
      band's choices (view · greek · expiries · strikes · show · colours), each
      with its own head, read line and kept strike. Remembered. */
  multi?: boolean;
  /** The kept strike of another column's name, and the pick on it — a strike
      belongs to a name (520 on SPY is not 440 on QQQ) */
  selectedStrikeFor?: (ticker: string) => number | null;
  onSelectStrikeFor?: (ticker: string, strike: number) => void;
  /** The book of a name beside the host's — the host's replay rewinds every
      column through this (the Map hands the minute's snapshot); absent, the
      simulator's live read */
  snapshotFor?: (ticker: string) => MarketSnapshot | null;
  /** Given, the names' panes PACK to their content (2026-10-13, the owner: "compact and tight grouped") and the field
      tells the host how wide it would be at its widest — the panes' natural widths, or the band's named row if that is
      wider; 0 while unmeasured or on the profile, which fills its room */
  onNaturalWidth?: (px: number) => void;
  /** What to do when the width cuts the expiries, in the host's words — "widen the window" by rest; Terrain's panel
      says "widen the panel or pick fewer expiries" (2026-10-15) */
  narrowHint?: string;
  /** THE TAB IS THE VIEW (2026-10-17, Terrain's panel): the host locks the view — the matrix on its Net tab, the calendar
      on its GEX tab — and the View card goes; left out, the reader picks */
  viewLock?: LedgerView;
  /** …and the legs: put · call · net ('all') on the Net tab; left out, the host's rule (the net alone in a panel) */
  legsLock?: LegsPick;
  /** The band's one row with its words, measured — the host decides where it has the room (2026-10-13) */
  onBandNeed?: (px: number) => void;
  /** Given (the Map, 2026-10-13), the band is drawn into this element — a strip of its own above the book and the day —
      rather than across the top of the book: a band needs ~1,800px for its words, one name's pane 443, and inside the
      box the band's width was the box's. Fullscreen draws it in place, as before. */
  headSlot?: HTMLElement | null;
  /** The host stands something beside the book (the Map's day box): pack the panes to their natural widths. Otherwise —
      and always in fullscreen — they fill their room, so no width is left empty (2026-10-13) */
  pack?: boolean;
}

/** The names beside the host's — three at most, so four side by side */
const EXTRA_MAX = 3;
const NAMES_KEY = 'slayer_ledger_names';
const GREEKS_KEY = 'slayer_ledger_greeks';
const readNames = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(NAMES_KEY) || '[]');
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').slice(0, EXTRA_MAX) : [];
  } catch {
    return [];
  }
};
/** The columns' tracks — always four, so a name arriving or leaving is one
    track gliding between 0fr and 1fr, never a grid re-laid at once */
const TRACKS = 1 + EXTRA_MAX;
/** A column leaving glides shut over this, then goes */
/* NO GLIDE (the owner, 2026-10-14: "remove all the motion designs"): a name taken off goes at once and the columns
   beside it take their slots at once; the timers and the transitions that carried the glide run at zero */
const LEAVE_MS = 0;
/** The read fades over this before it goes (the house's close rule: a timer, never an animation's end) */
const READ_CLOSE_MS = 200;
/** With this many names side by side a column's head has no room for quotes or the supreme's total, and a read takes the whole column */
const TIGHT_AT = 3;
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** A column's book: the name's snapshot at the moment shown and the surface built from it */
interface ColumnBook {
  ticker: string;
  snapshot: MarketSnapshot;
  surface: ExposureSurface;
}

/** The whole book — every window is a view of it */
const WHOLE_BOOK: StrikeWindow = 30;
/* THE LEDGER'S WINDOWS (2026-09-22, Noah: "i would like 20 to be the default but to have a few more options for the
   user to choose from", then "15 should be the absolute smallest strike size"): 15 · 20 · 25 · 30 each side, 20 by
   rest. The floor of 20 (2026-09-05, "no 10's or 15's") guarded a calendar whose cells went empty at narrow windows;
   the fit rule (2026-09-14) guards that now, and 15 is his floor. 30 is every strike the chain has. */
const LEDGER_WINDOWS: StrikeWindow[] = [15, 20, 25, 30];
const LEDGER_REST: StrikeWindow = 20;
/* THE CEILING OF EXPIRIES by greeks side by side (Noah, 2026-09-22: "7 being the max when you are choosing all 5
   greeks"): the most the band draws at once, whatever the width — the page never changes shape by itself */
const EXPIRY_CEILING: Record<number, number> = { 1: 20, 2: 15, 3: 10, 4: 8, 5: 7 };
/** What the columns are drawn from — one snapshot of the picks that change the book's SHAPE (the soft swap) */
interface DrawnShape {
  view: LedgerView;
  rings: number;
  greeks: Greek[];
  range: { from: number; through: number };
  afterBell: boolean;
  legs: LegsPick;
}
/** The old shape's fade-out; the new one's fade-in is index.css's view-in (320ms) */
const SWAP_OUT_MS = 0;
/** THE BAND'S ROOM (measured 2026-09-22 with the cards at rest, all five greeks, seven expiries): the picks need
    989px with their names and ~700 bare; the doors 644 with their words and ~390 compact (the supreme as its strike,
    the read and the guide as their icons). ONE ROW, as long as it can be one row (Noah, on the landing still's second
    row: "top buttons are being kicked out and placed underneath"): named at 1,672 and up, the picks BARE from 1,390
    (a desk with the sidebar open), the doors COMPACT too from 1,140 (the landing's still, the rail folded); only
    under that two tidy rows, the picks bare under 1,021 there too. Names in the tooltips throughout.
    MEASURED, NOT ONLY BY WIDTH (the re-audit's H1, 2026-10-13): the Data, Legs and Export cards put sixteen pieces on
    the band, over the one row's room at 1920 — so the pieces are measured (bandOver) and a band over its room goes to
    the two tidy rows WITH their words; one row only where the words fit. */
const BAND_ONE_ROW_PX = 1672;
const BAND_BARE_ROW_PX = 1390;
const BAND_TIGHT_ROW_PX = 1140;
const BAND_NAMED_ROW_PX = 1100; /* the named picks with Legs need ~1,090 (re-measured 2026-10-13: 1,080 wrapped, 1,114 held) */
/** Under this the two rows scroll sideways with their words (a phone, or a window narrower than the two tidy rows: at
    682px of band they ran to four) — the re-audit's H2 */
const BAND_SCROLL_PX = 700;
/** The doors with their words (data, names, biggest moves, replay, export, the supreme with its date and figure, the
    read, how to read, fullscreen) measure ~912px; under this much band they go compact and the colours switch, which
    the bare picks' row cannot hold there either, leads their row — two rows on a 1024 desk, not four */
const BAND_DOORS_WORDS_PX = 960;
/** The band's doors whose words can go, the least read first — each to its icon, its words in its tooltip */
type DoorKey = 'guide' | 'focus' | 'more' | 'read' | 'supreme';
const DOOR_ORDER: DoorKey[] = ['guide', 'focus', 'more', 'read', 'supreme'];
const DOOR_SEL: Record<DoorKey, string> = {
  guide: '[data-guide-door="ledger-guide"]',
  focus: '[data-ledger-focus-door]',
  more: '[data-ledger-more]',
  read: '[data-ledger-read]',
  supreme: '[data-ledger-supreme] [data-door-words]',
};
/** A band shape's named row: its width, and what each door's words cost */
interface BandMeasure {
  need: number;
  savings: Partial<Record<DoorKey, number>>;
}
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
const GREEK_LABEL: Record<Greek, string> = { gex: 'GEX', dex: 'DEX', vex: 'VEX', vanna: 'VANNA', charm: 'CHARM' };
/*
  THE HEAD IN THE APPROVED GRAMMAR (Noah, 2026-09-06: "our heatmap header
  needs a fixing. the buttons are quite horrid"): one thin line of labelled
  DROPDOWN CARDS, one plain line under every choice, never a row of chips.
  Expiries are spelled as DATES ("Through Sep 18"), not counts — it is not a
  date picker, because the calendar shows many expiries side by side and the
  choice is how far along it to read, but the choice should read as a date.
*/
/* The greeks are a MULTI pick now (Noah, 2026-09-10: "you can either choose 1
   or 2 or 3 or 4 or all") — the options and the pick rules live in
   exposureView.ts, shared with the Map's head. */
const GREEK_GROUPS = [{ title: 'What the cells measure', options: GREEK_PICK_OPTIONS }];
/* the five alone — a column beside another name shows one greek at a time */
const SINGLE_GREEK_OPTIONS: DropdownOption<string>[] = GREEK_PICK_OPTIONS.filter(o => o.value !== 'all').map(o => ({ value: o.value, label: o.label, hint: o.hint }));
/* THE COLOURS SWITCH is components/gex/ColoursSwitch.tsx */
/* THE VIEW (Noah, 2026-09-10, his partner's "inventory & sensitivity by
   strike": "the net, put, call ratios with the bar for each section looks
   good. make a new button that allows for either the heatmap or this") —
   the same book two ways: the calendar's capsules by strike and expiry, or
   the matrix — one row per strike, put · call · net, a figure and its bar.
   (The ladder, a third way, was removed 2026-09-30 at his word.)
   WHICH ONE A HOST OPENS ON, and where its pick is kept, is ledgerView.ts. */
/* THE SWITCH BETWEEN THE VIEWS IS A CUT WITH THE HOUSE'S FADE (2026-09-22). The flight of pieces built 2026-09-13 —
   the ladder's bars cut into capsules and flown to the calendar and back — went at Noah's word: "way too laggy and
   doesn't work as i would like". The arriving view fades in over the house's 200ms; nothing is cloned, measured or
   flown. */
const VIEW_OPTION: Record<LedgerView, DropdownOption<LedgerView>> = {
  /* the net alone since 2026-10-12 — the hint says what the table draws (the audit's H7, 2026-10-13) */
  matrix: { value: 'matrix', label: 'Matrix', hint: "One row per strike — each greek's net, a figure and its bar; put and call on the card" },
  calendar: { value: 'calendar', label: 'Calendar', hint: 'Strike by expiry — every cell a capsule' },
  profile: { value: 'profile', label: 'Profile', hint: 'Dealer gamma across spot — the curve the flip is read off, a line per expiry and the total' },
};
const SHOW_OPTIONS: DropdownOption<'now' | 'after'>[] = [
  { value: 'now', label: 'Now', hint: 'The calendar as it stands' },
  { value: 'after', label: 'After the close', hint: "The same calendar once today's contracts have expired" },
];

function listedIso(snap: MarketSnapshot | null | undefined): string[] {
  return (snap?.uwExpiries ?? [])
    .filter(e => snap?.uwByDate?.[e.date]?.length)
    .sort((a, b) => a.date.localeCompare(b.date) || a.dte - b.dte)
    .map(e => e.date);
}

const ISO_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortIso(iso: string): string {
  const parts = iso.slice(0, 10).split('-');
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!m || !d) return iso.slice(0, 10);
  return `${ISO_MONTHS[m - 1]} ${d}`;
}

const ExposureField = ({ snapshot, half: halfProp, hoverStrike, selectedStrike, onHoverStrike, onSelectStrike, openRatio, onTicker, toolbar = 'desk', marks, lead, greeks: greeksProp, onGreeks, fresh = false, after, fullMode = 'portal', fullOpen, headFull = false, multi = false, selectedStrikeFor, onSelectStrikeFor, snapshotFor, onNaturalWidth, onBandNeed, headSlot, pack = false, above, onNames, onExpiries, onNameDates, narrowHint = 'widen the window', viewLock, legsLock }: ExposureFieldProps) => {
  const [ownPick, setOwnPick] = useState<string[]>(['gex']);
  const pick = greeksProp ?? ownPick;
  /* the page's theme: on paper the island and everything drawn in it wear the light set and the paper ramps */
  const paper = useResolvedTheme() === 'light';
  const setPick = (next: string[]) => {
    const settled = nextGreekPick(pick, next);
    setOwnPick(settled);
    onGreeks?.(settled);
  };
  /* The greeks drawn — a stable array per pick, so the grid and the ladder memo on it */
  /* A LIVE BOOK HAS NO VEGA: the vendor's per-strike exposure carries gamma, delta, vanna and charm only, and VEX drew
     a column of $0 down every strike (the Pinpoint sweep, 2026-10-22). On a live book it is not offered, not drawn. */
  const noVex = !!snapshot?.liveBook;
  const greeks = useMemo(() => {
    const g = pickGreeks(pick);
    if (!noVex) return g;
    const kept = g.filter(x => x !== 'vex');
    return kept.length ? kept : (['gex'] as Greek[]);
  }, [pick, noVex]);
  const greekGroups = useMemo(
    () => (noVex ? [{ title: GREEK_GROUPS[0].title, options: GREEK_PICK_OPTIONS.filter(o => o.value !== 'vex').map(o => (o.value === 'all' ? { ...o, label: 'All four', hint: 'GEX, DEX, vanna and charm side by side' } : o)) }] : GREEK_GROUPS),
    [noVex]
  );
  /* THE WINDOW OF EXPIRIES (Noah, 2026-09-22: "it forces you to start from the current date and goes through to the
     date you choose… there should be some sort of max, 7 being the max when you are choosing all 5 greeks"): From and
     Through, as indices into the book's expiries, nearest first. THE CEILING is by how many greeks stand side by side —
     seven with five, more with fewer — and the window is clamped to it whenever the pick changes, so the page never
     draws more than it said it would. What FITS at the width still cuts under the ceiling (below). */
  const ceiling = EXPIRY_CEILING[Math.min(5, Math.max(1, greeks.length))] ?? 7;
  /* three expiries by rest in Terrain's panel — today, tomorrow and the week's ("Today → Oct 19", Noah's default view,
     2026-10-15); the Map opens on eight */
  const [range, setRange] = useState<{ from: number; through: number }>({ from: 0, through: Math.min(toolbar === 'panel' ? 2 : 7, ceiling - 1) });
  useEffect(() => {
    setRange(r => (r.through - r.from + 1 > ceiling ? { from: r.from, through: r.from + ceiling - 1 } : r));
  }, [ceiling]);
  /* WHAT FITS (Noah, 2026-09-14: three names through Oct 26 left every capsule empty — "reads as
     a website bug/flaw"): each calendar pane reports how many expiries it can print at its
     measured width with its greeks (ExposureLedger `onFit`); the band draws no deeper than the
     least of them, and its Expiries card offers no deeper — an empty capsule is never on the
     screen, whatever the window, the sidebar, the names or the greeks do. Infinity until a pane
     has measured, and on the ladder (no capsules there). */
  const fitRef = useRef(new Map<string, number>());
  const [fitDepth, setFitDepth] = useState<number>(Infinity);
  /* …and the fewest greeks any ledger could draw beside its strike column (2026-10-17): the ledger cuts greeks before
     it would print a cell without its figure; the note below says what was cut */
  const greeksFitRef = useRef(new Map<string, number>());
  const [fitGreeks, setFitGreeks] = useState<number>(Infinity);
  const reportFit = useCallback((key: string, n: number | null, g?: number | null) => {
    if (n == null) fitRef.current.delete(key);
    else fitRef.current.set(key, n);
    if (g == null) greeksFitRef.current.delete(key);
    else greeksFitRef.current.set(key, g);
    let min = Infinity;
    for (const v of fitRef.current.values()) if (v < min) min = v;
    setFitDepth(prev => (prev === min ? prev : min));
    let gmin = Infinity;
    for (const v of greeksFitRef.current.values()) if (v < gmin) gmin = v;
    setFitGreeks(prev => (prev === gmin ? prev : gmin));
  }, []);
  /* BOOK AFTER THE BELL (the roadmap's band 3, 2026-09-05): today's column
     taken out — the book as it stands at the next open. The ledger says how
     much of the book that is. */
  const [afterBell, setAfterBell] = useState(false);
  /* THE PALETTE, a try (Noah, 2026-09-05: "can we try the thermal design
     just for a try") — the thermal leads while it is on trial; the house
     ramp is one click away. Only this grid reads it. */
  /* the ramp the book is painted in — Settings › Appearance (data/ledgerPalette.ts) */
  const palette = useLedgerPalette();
  /* THE VIEW — the matrix or the calendar; remembered per host (ledgerView.ts): the Map's band opens on the matrix */
  const viewHost = toolbar === 'band' ? 'map' : 'tile';
  /* IN TERRAIN'S PANEL (Noah, 2026-10-15: "this should cater to complimenting the terrain chart not acting like how it
     does on pinpoint … i just see so many buttons that take over the space of the calendar"): three cards on one row —
     the view, the greek, the expiries — the net alone in every cell (the matrix keeps every greek, "just no put call"),
     no name row (the pane names the name), no doors, no facts line; the fit's note in one short line */
  const panel = toolbar === 'panel';
  const [viewState, setView] = useState<LedgerView>(() => readLedgerView(viewHost));
  const view: LedgerView = viewLock ?? viewState;
  /* THE LEGS — put · call · net by rest (the partner's matrix, taken 2026-10-14). THE PICK IS THE READER'S AND STAYS
     (his cut wrote 'net' into the pick whenever the calendar came up, so a visit to the calendar and back lost the
     matrix's three legs): a calendar cell carries one figure, so on the calendar Both and All DRAW as the net, and the
     matrix takes the pick back the moment it returns */
  const [legs, setLegs] = useState<LegsPick>('all');
  const legsDrawn: LegsPick = legsLock ?? (panel ? 'net' : view === 'calendar' && (legs === 'both' || legs === 'all') ? 'net' : legs);
  /* A FIRST-VISIT NOTE over the book (idea 12, 2026-10-13): three lines once, dismissed for good on this machine — the
     guides stay for the full read */
  const [noteSeen, setNoteSeen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('slayer_map_note') === '1';
    } catch {
      return true;
    }
  });
  const dismissNote = () => {
    setNoteSeen(true);
    try {
      localStorage.setItem('slayer_map_note', '1');
    } catch {
      /* storage off */
    }
  };
  /* THE DATA DOOR (components/gex/BookProvenance.tsx): where the figures come from and how they are computed */
  const [dataOpen, setDataOpen] = useState(false);
  /* THE LEVELS ARE THE LEVELS CARD'S (the ship pass, 2026-10-22 — they were the Expiries window's, so the Map named a
     supreme of eight dates beside the Board's supreme of today). The Expiries card picks the matrix's columns; the named
     levels (supreme, walls, flip) are the Levels card's, the same on every Pinpoint page. */
  const levelsScope = useLevelsScope();
  const listedDates = useMemo(() => {
    return (snapshot?.uwExpiries ?? [])
      .filter(e => snapshot?.uwByDate?.[e.date]?.length)
      .sort((a, b) => a.date.localeCompare(b.date) || a.dte - b.dte);
  }, [snapshot]);
  const chosenDates = useMemo(() => {
    if (!listedDates.length) return [] as string[];
    const last = listedDates.length - 1;
    const lo = Math.max(0, Math.min(range.from, last));
    const hi = Math.max(lo, Math.min(range.through, last));
    const today = listedDates.find(e => e.dte === 0)?.date;
    const dates = listedDates.slice(lo, hi + 1).map(e => e.date);
    if (!(afterBell && today)) return dates;
    /* After the bell today's contracts are gone. Dropping them could leave the window EMPTY ("Today" alone), and an
       empty window falls back to the whole book (the UI sweep, 2026-10-22) — Today rolls to the next listed date */
    const kept = dates.filter(d => d !== today);
    if (kept.length) return kept;
    const next = listedDates.find(e => e.date > today)?.date;
    return next ? [next] : kept;
  }, [listedDates, range.from, range.through, afterBell]);
  const chosenKey = chosenDates.join(',');
  useEffect(() => {
    onExpiries?.(chosenDates);
  }, [chosenKey, onExpiries]);
  const [ownDates, setOwnDates] = useState<Record<string, string[]>>({});
  const [ownFocus, setOwnFocus] = useState<Record<string, boolean>>({});
  const ownKey = Object.entries(ownDates).map(([k, v]) => `${k}:${v.join(',')}`).join('|');
  useEffect(() => {
    onNameDates?.(ownDates);
  }, [ownKey, onNameDates, ownDates]);
  const scopedCache = useRef(new WeakMap<ExposureSurface, { key: string; out: ExposureSurface }>());
  const scoped = (surf: ExposureSurface, snap: MarketSnapshot, dates: string[] = chosenDates): ExposureSurface => {
    const key = `${levelsScope}|${dates.join(',')}`;
    const hit = scopedCache.current.get(surf);
    if (hit?.key === key) return hit.out;
    /* THE LEVELS ARE THE LEVELS CARD'S (the ship pass, 2026-10-22): the matrix draws the Expiries card's dates, but the
       supreme, the walls and the flip it names are read off the Levels card's contracts — the Board's, the Agenda's and
       Compare's book — so SPY's supreme is one strike on every page. The magenta row is that strike. */
    const lvBook = levelsBook(snap, levelsScope);
    const levels = roomLevels(lvBook, '0DTE');
    if (!levels) return surf;
    let out = surf;
    const si = surf.strikes.indexOf(levels.supreme);
    let supreme = surf.supreme;
    if (si >= 0) {
      const dtes = new Set((snap.uwExpiries ?? []).filter(e => dates.includes(e.date)).map(e => e.dte));
      let e = 0;
      let value = 0;
      let total = 0;
      for (let i = 0; i < surf.expiries.length; i++) {
        if (dtes.size && !dtes.has(surf.expiries[i].dte)) continue;
        const v = surf.net.gex[i]?.[si] ?? 0;
        total += v;
        if (Math.abs(v) > Math.abs(value)) {
          value = v;
          e = i;
        }
      }
      /* the door's amount is the strike's net on the Levels card's contracts, not the window's sum */
      const node = lvBook.chain.find(n => n.strike === levels.supreme);
      supreme = { ...surf.supreme, gex: { strike: levels.supreme, e, value, total: node ? node.callGex + node.putGex : total } };
    }
    out = { ...surf, levels, supreme };
    scopedCache.current.set(surf, { key, out });
    return out;
  };
  /** The expiry columns drawn for a book, nearest first: the window, without today after the bell, then the
      ceiling, then what fits (every pane reports its own; the least wins) — read off a shape (the live picks for the
      card's words, the drawn snapshot for the columns; see the soft swap below) */
  const windowFor = (surface: ExposureSurface, sh: { range: { from: number; through: number }; afterBell: boolean; greeks: Greek[] }): number[] => {
    const todayIdx = todayColumn(surface);
    const last = surface.expiries.length - 1;
    const lo = Math.max(0, Math.min(sh.range.from, last));
    const hi = Math.max(lo, Math.min(sh.range.through, last));
    const all = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const live = sh.afterBell && todayIdx >= 0 ? all.filter(i => i !== todayIdx) : all;
    const cap = EXPIRY_CEILING[Math.min(5, Math.max(1, sh.greeks.length))] ?? 7;
    return (live.length ? live : all.slice(0, 1)).slice(0, cap);
  };
  const shownFor = (surface: ExposureSurface, sh: { range: { from: number; through: number }; afterBell: boolean; greeks: Greek[] }): number[] => windowFor(surface, sh).slice(0, Math.max(1, fitDepth));
  const indicesFor = (surface: ExposureSurface, snap: MarketSnapshot, dates: string[], greekCount: number): number[] => {
    const iso = listedIso(snap);
    const cap = EXPIRY_CEILING[Math.min(5, Math.max(1, greekCount))] ?? 7;
    if (dates.length && iso.length === surface.expiries.length) {
      const want = new Set(dates);
      const idx = iso.flatMap((d, i) => (want.has(d) ? [i] : []));
      if (idx.length) return idx.slice(0, cap);
    }
    return windowFor(surface, { range, afterBell, greeks: Array.from({ length: Math.max(1, greekCount) }, () => 'gex' as Greek) });
  };
  const pickView = (v: LedgerView) => {
    setView(v);
    writeLedgerView(viewHost, v);
  };
  /* the band's measured width — what its head lays itself out by (see `bandRows`); read before the first paint, so
     the head never opens ragged and then mends itself */
  const bandRO = useRef<ResizeObserver | null>(null);
  const [bandW, setBandW] = useState(0);
  const bandEl = useRef<HTMLDivElement | null>(null);
  const bandRef = useCallback((el: HTMLDivElement | null) => {
    bandRO.current?.disconnect();
    bandRO.current = null;
    bandEl.current = el;
    if (!el) return;
    setBandW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(entries => setBandW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    bandRO.current = ro;
  }, []);
  /* …AND WHAT ITS PIECES NEED (the audit's M1, 2026-10-13): the thresholds were measured with the picks bare and assume
     the doors fit, so fullscreen at 1440 — the Back door added, the width just over BAND_BARE_ROW_PX — wrapped "How to
     read" and the exit under the row, the ragged case the modes were written against. Measured after every commit: the
     sum of the pieces' widths and their gaps against the band's room; over it, the two tidy rows. The pieces' widths are
     their own in either layout, so the answer holds still. */
  const [bandOver, setBandOver] = useState(false);
  /* …AND WHAT THE NAMED ROW NEEDS, measured whenever the band is drawn with its words (2026-10-13): the box that packs to
     its panes is never narrower than this, and a band at least this wide keeps its words on one row whatever the
     fixed thresholds below say — they were measured for the widest band, five greeks and every door */
  /* …AND WHAT THE DOORS' WORDS COST (the paying-user audit, 2026-10-13: the calendar's band at 1920 was two rows, half
     of each empty, for ~170px of door words): measured with the words on — each door's width over its 28px icon, the
     supreme's figure — so a band a few doors' words over its room drops THOSE words, one door at a time, and stays one
     row. Kept per shape of the band (the view, the names, the picks' words): a shape not yet measured is drawn named
     once, before paint, and measured. */
  const [measures, setMeasures] = useState<Record<string, BandMeasure>>({});
  const shapeRef = useRef('');
  const namedNow = useRef(false);
  /* a coarse pointer — a phone, a tablet — read once and on change (index.css's .hit is gated the same way) */
  const [coarsePointer, setCoarsePointer] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const on = () => setCoarsePointer(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useLayoutEffect(() => {
    const el = bandEl.current;
    if (!el) return;
    let need = 0;
    let n = 0;
    el.querySelectorAll<HTMLElement>(':scope > :not([data-ledger-toolbar-row]), :scope > [data-ledger-toolbar-row] > *').forEach(it => {
      const w = it.offsetWidth;
      if (w > 0) {
        need += w;
        n++;
      }
    });
    need += Math.max(0, n - 1) * 8; /* gap-x-2 */
    const over = need > el.clientWidth - 24; /* px-3 each side */
    setBandOver(prev => (prev === over ? prev : over));
    if (namedNow.current && need > 0) {
      const savings: Partial<Record<DoorKey, number>> = {};
      for (const k of DOOR_ORDER) {
        const d = el.querySelector<HTMLElement>(DOOR_SEL[k]);
        if (!d) continue;
        const sv = k === 'supreme' ? d.offsetWidth + 4 : d.offsetWidth - 28;
        if (sv > 0) savings[k] = Math.floor(sv);
      }
      const key = shapeRef.current;
      setMeasures(prev => {
        const old = prev[key];
        if (old && Math.abs(old.need - need) < 2 && DOOR_ORDER.every(k => Math.abs((old.savings[k] ?? 0) - (savings[k] ?? 0)) < 2)) return prev;
        return { ...prev, [key]: { need: Math.ceil(need), savings } };
      });
    }
  });
  /* THE STRIKES: each side of spot — the ledger's own presets, 20 by rest; a host may seed its own */
  const seed: number = halfProp ?? LEDGER_REST;
  const [rings, setRings] = useState<number>(seed);
  useEffect(() => setRings(seed), [seed]);
  /* THE SOFT SWAP (Noah, 2026-09-22, right after the flight went: "the transitions between the views and the
     transitions of strikes and greek amounts need to be smooth, right now everything changes way too quickly"): a
     change of WHAT IS DRAWN — the view, the strikes, the greeks, the expiry window, the bell — is never a cut. The
     body fades out on the old shape (SWAP_OUT_MS), then the new shape mounts and fades in (index.css view-in); the
     cards up top show the new pick at once. The columns render from ONE SNAPSHOT of the shape (`drawn`), and the
     live picks catch up as the fade lands. Nothing is cloned or measured — two short opacity fades, cheap at any
     size. Reduced motion: the cut. */
  const liveShape: DrawnShape = { view, rings, greeks, range, afterBell, legs: legsDrawn };
  const liveKey = `${view}|${rings}|${greeks.join(',')}|${range.from}-${range.through}|${afterBell ? 'a' : 'n'}|${legsDrawn}`;
  const [drawn, setDrawn] = useState<{ key: string; shape: DrawnShape }>({ key: liveKey, shape: liveShape });
  const [fading, setFading] = useState(false);
  const [swapped, setSwapped] = useState(false);
  useEffect(() => {
    if (liveKey === drawn.key) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setDrawn({ key: liveKey, shape: liveShape });
      return;
    }
    setFading(true);
    const t = window.setTimeout(() => {
      setDrawn({ key: liveKey, shape: liveShape });
      setFading(false);
      setSwapped(true);
    }, SWAP_OUT_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);
  const d = drawn.shape;
  /* THE GUIDE AS A FOCUS (Noah, 2026-09-06, after the Map's: "i love this,
     keep it in the design pattern style. i think the heatmap needs one as
     well"): the card centred over the calendar, the grid blurred behind it;
     Esc (captured, so fullscreen stays) or a click on the blur lets go. */
  const [guideOpen, setGuideOpen] = useState(false);
  /* THE READ (2026-09-12, BookRead.tsx): the book's read as a glass card over
     the right of the ladder or the calendar. The pointer's strike goes to it
     through a ref — only the card re-renders on a move, never the grid.
     A READ PER NAME (Noah, 2026-09-13: "the read card on multiple ticker
     cards… should that be an in-card design because right now it just
     defaults to the left one"): each column's head carries its own door and
     its read opens over its own book — two can stand open side by side. Kept
     by name; a closing read fades on a timer before it goes. */
  const [reads, setReads] = useState<Record<string, 'open' | 'closing'>>({});
  const readTimers = useRef<Record<string, number>>({});
  useEffect(() => () => Object.values(readTimers.current).forEach(id => window.clearTimeout(id)), []);
  const readOf = (t: string) => reads[t];
  const closeRead = (t: string) => {
    setReads(r => (r[t] === 'open' ? { ...r, [t]: 'closing' } : r));
    window.clearTimeout(readTimers.current[t]);
    readTimers.current[t] = window.setTimeout(() => {
      setReads(r => {
        if (r[t] !== 'closing') return r;
        const next = { ...r };
        delete next[t];
        return next;
      });
    }, READ_CLOSE_MS);
  };
  const toggleRead = (t: string) => {
    if (reads[t] === 'open') closeRead(t);
    else {
      window.clearTimeout(readTimers.current[t]);
      setReads(r => ({ ...r, [t]: 'open' }));
    }
  };
  /* THE POINTER FEED OF EACH COLUMN — the host's through `pointedRef` (the
     chart's ladder washes with it too), the others' by name: a read card
     subscribes to its own column's rows and nothing else re-renders on a move */
  const pointedFor = useRef(new Map<string, (strike: number | null) => void>());
  const subscribers = useRef(new Map<string, (fn: (strike: number | null) => void) => () => void>());
  const subscribeFor = (t: string) => {
    let s = subscribers.current.get(t);
    if (!s) {
      s = fn => {
        pointedFor.current.set(t, fn);
        return () => {
          if (pointedFor.current.get(t) === fn) pointedFor.current.delete(t);
        };
      };
      subscribers.current.set(t, s);
    }
    return s;
  };
  /* THE LEAD GREEK — the first one drawn: the read card and the supreme follow it. (On the ladder a click on a lane's
     head picked it; the ladder is gone, 2026-09-30.) */
  const leadGreek: Greek = greeks[0];
  const pointedRef = useRef<((strike: number | null) => void) | null>(null);
  const subscribePointed = useCallback((fn: (strike: number | null) => void) => {
    pointedRef.current = fn;
    return () => {
      if (pointedRef.current === fn) pointedRef.current = null;
    };
  }, []);
  /* FULLSCREEN — portaled to <body>, edge to edge, Esc leaves, the page
     scroll locks under it. */
  const [full, setFull] = useState(false);
  /* IN AND OUT OVER HALF A SECOND, not the chart's 200ms (Noah, 2026-09-10:
     "the full screen of both the heatmap and the ladder is very quick
     transition but it should be smooth") — the slow soft-in on the way up,
     a 400ms fade on the way down; opacity only, never a transform. */
  const { closing, close: fadeClose } = useFadeClose(() => {
    setFull(false);
    onHoverStrike?.(null);
  }, 400);
  /* the moving box needs no fade — the layout animation IS the way back */
  const close = fullMode === 'move'
    ? () => {
        setFull(false);
        onHoverStrike?.(null);
      }
    : fadeClose;
  /* the host's tile head asked for it */
  useEffect(() => {
    if (fullOpen) setFull(true);
  }, [fullOpen]);
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

  /* THE BOOK, REBUILT WHEN IT MATTERS (2026-09-06, the perf sweep): fifteen
     expiries × a priced chain each, plus the grid's re-render, was ~50ms on
     EVERY 1.5s tick in dev — the one long task left at idle. Open interest
     moves slowly; a rebuild happens when spot has moved a tenth of a percent
     since the last one, when six seconds have passed, or when the name
     changes. The head's price and change stay live off the snapshot, and
     the ledger's spot rule reads the live spot too. */
  const builtRef = useRef<{ surface: ExposureSurface; spot: number; at: number; dates: number } | null>(null);
  /* how many expiries have their own chain — they land seconds after the whole book. Not in the reuse test, a surface
     built off the whole book alone was kept through a quiet tape (after the bell spot never moves): the card read
     "Today" over a single all-dates column and the matrix crowned the book's supreme, not the window's (2026-10-22) */
  const datesIn = snapshot?.uwByDate ? Object.values(snapshot.uwByDate).filter(c => c?.length).length : 0;
  const surface = useMemo(() => {
    if (!snapshot) return null;
    const b = builtRef.current;
    const now = Date.now();
    if (!fresh && b && b.surface.ticker === snapshot.ticker && b.dates === datesIn && Math.abs(snapshot.spot - b.spot) / b.spot < 0.001 && now - b.at < 6000) return b.surface;
    const next = buildExposureSurface(snapshot, WHOLE_BOOK, CALENDAR_DTES);
    builtRef.current = { surface: next, spot: snapshot.spot, at: now, dates: datesIn };
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, datesIn]);

  /* THE NAMES BESIDE THE HOST'S — kept on this machine; a name the host
     already shows is never doubled. Their books are the simulator's pure read,
     rebuilt whenever the host's surface is (the same cadence), so the columns
     never disagree about the moment. */
  const [extra, setExtra] = useState<string[]>(() => (multi ? readNames() : []));
  const hostTicker = surface?.ticker ?? snapshot?.ticker ?? '';
  const names = useMemo(() => extra.filter(t => t !== hostTicker), [extra, hostTicker]);
  /* the host hears the columns as they stand — the Map lays a day box under each */
  useEffect(() => {
    if (hostTicker) onNames?.([hostTicker, ...names]);
  }, [hostTicker, names, onNames]);
  const writeNames = (next: string[]) => {
    setExtra(next);
    try {
      localStorage.setItem(NAMES_KEY, JSON.stringify(next));
    } catch {
      /* storage off — the choice lives for the session */
    }
  };
  /* A COLUMN LEAVES BY GLIDING SHUT (Noah, 2026-09-13: "the exiting and
     entering of these things… should be smooth and quick, not jittery"): a
     name taken off stays in its slot as a leaving column — its track at 0fr,
     its panel fading — for LEAVE_MS, then goes; the columns after it slide
     over on real layout. `order` keeps every column in the slot it had. */
  const [leaving, setLeaving] = useState<Record<string, true>>({});
  const leaveTimers = useRef<Record<string, number>>({});
  useEffect(() => () => Object.values(leaveTimers.current).forEach(id => window.clearTimeout(id)), []);
  const orderRef = useRef<string[]>([]);
  const addName = (sym: string) => {
    const t = sym.toUpperCase();
    if (!t || t === hostTicker || extra.includes(t) || names.length >= EXTRA_MAX) return;
    arrivingRef.current.add(t);
    warmedRef.current.delete(t);
    window.clearTimeout(leaveTimers.current[t]);
    setLeaving(l => {
      if (!l[t]) return l;
      const next = { ...l };
      delete next[t];
      return next;
    });
    writeNames([...extra, t]);
  };
  /* THE COLUMNS' GLIDE IS A GLIDE (2026-10-12, Noah: taking a name off "is very glitchy and laggy"): without the
     word, every frame of the 280ms track transition re-measured every pane, re-fit its expiries and REMOUNTED its
     grid — 308 remounts and two long tasks for one name leaving, the widths landing in five jumps. Declared, the
     ledgers hold their measure through it and take one read when it ends — the sidebar's rule, the desk's. */
  const islandRef = useRef<HTMLDivElement | null>(null);
  /* THE PANES' NATURAL WIDTHS (2026-10-13, the owner: "all you did was add a bunch of space … i want it to look compact
     and tight grouped"): each view tells the field how wide it is at its widest — the matrix its strike column and its
     legs at their ceiling, the calendar its strike column and the wanted dates at CELL_MAX — keyed by name and view */
  const [naturals, setNaturals] = useState<Record<string, number>>({});
  const naturalHandles = useRef(new Map<string, (px: number) => void>());
  const naturalFor = (ticker: string, v: LedgerView) => {
    const k = `${ticker}|${v}`;
    let f = naturalHandles.current.get(k);
    if (!f) {
      f = (px: number) => setNaturals(prev => (Math.abs((prev[k] ?? 0) - px) < 1 ? prev : { ...prev, [k]: Math.round(px) }));
      naturalHandles.current.set(k, f);
    }
    return f;
  };
  /* TAKEN OFF, AND BACK IN ONE CLICK (the paying-user audit's H6, 2026-10-13): an X beside a name was final, the one
     destructive click on the page with no way back — the house's undo chip offers it for six seconds, into the same slot */
  const restoreName = (t: string, at: number) => {
    if (!t || t === hostTicker || extra.includes(t) || names.length >= EXTRA_MAX) return;
    arrivingRef.current.add(t);
    warmedRef.current.delete(t);
    window.clearTimeout(leaveTimers.current[t]);
    setLeaving(l => {
      if (!l[t]) return l;
      const next = { ...l };
      delete next[t];
      return next;
    });
    const next = [...extra];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, t);
    writeNames(next);
  };
  const restoreRef = useRef(restoreName);
  restoreRef.current = restoreName;
  const removeName = (t: string) => {
    const at = extra.indexOf(t);
    arrivingRef.current.delete(t);
    warmedRef.current.delete(t);
    writeNames(extra.filter(x => x !== t));
    undoable({ label: `${t} taken off`, key: `map-name-${t}`, undo: () => restoreRef.current(t, at) });
    setReads(r => {
      if (!r[t]) return r;
      const next = { ...r };
      delete next[t];
      return next;
    });
    setLeaving(l => ({ ...l, [t]: true }));
    window.clearTimeout(leaveTimers.current[t]);
    leaveTimers.current[t] = window.setTimeout(() => {
      setLeaving(l => {
        const next = { ...l };
        delete next[t];
        return next;
      });
    }, LEAVE_MS);
  };
  /* A NAME CHANGED IN PLACE — the column's own chip picked another: the same
     slot, the new book; its greek and its read are the new name's own */
  const renameName = (t: string, sym: string) => {
    const next = sym.toUpperCase();
    if (!next || next === t || next === hostTicker || extra.includes(next)) return;
    orderRef.current = orderRef.current.map(x => (x === t ? next : x));
    writeNames(extra.map(x => (x === t ? next : x)));
  };
  /* EACH NAME ITS OWN GREEK (Noah, 2026-09-12: "they should be allowed to
     follow different greeks"): with names side by side the band's Greek card
     steps down and every column's head carries its own — the host's bound to
     the page's greek, the others kept here by name (`slayer_ledger_greeks`) */
  const [greekByName, setGreekByName] = useState<Record<string, string[]>>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(GREEKS_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  });
  const greeksOf = (t: string): string[] => greekByName[t] ?? ['gex'];
  const setGreeksOf = (t: string, next: string[]) => {
    const settled = nextGreekPick(greeksOf(t), next);
    const all = { ...greekByName, [t]: settled };
    setGreekByName(all);
    try {
      localStorage.setItem(GREEKS_KEY, JSON.stringify(all));
    } catch {
      /* storage off — the choice lives for the session */
    }
  };
  /* A NAME NEVER READ BEFORE LANDS AFTER THE GLIDE: the simulator walks a new
     name's history in on the main thread (~0.6s) the first time it is asked
     for, and nothing on screen moves meanwhile — so a cold name's column
     opens at once with a skeleton inside, and its book is asked for on a
     timer once the columns have settled (one name at a time, the Board's
     rule); a name the terminal already carries builds on the spot. */
  const [warmed, setWarmed] = useState(0);
  const warmedRef = useRef(new Set<string>());
  /** Names just added through the door — built after the glide, like a cold one (see `extraBooks`) */
  const arrivingRef = useRef(new Set<string>());
  /* THE BOOK AT THE OPEN, A NAME AT A TIME (2026-10-12, the calendar's "since the open" badges): the same surface
     built off the session's opening snapshot, once per name and kept — the open does not move during a session. A
     name whose session has no opening snapshot yet gets null and no badges. Only the calendar reads it. */
  const openRef = useRef(new Map<string, ExposureSurface | null>());
  const openSurfaceOf = (t: string): ExposureSurface | null => {
    const kept = openRef.current.get(t);
    if (kept !== undefined) return kept;
    let built: ExposureSurface | null = null;
    try {
      const snap = snapshotAtOpen(t);
      built = snap ? buildExposureSurface(snap, WHOLE_BOOK, CALENDAR_DTES, 'snapshot') : null;
    } catch {
      built = null;
    }
    /* a session without its opening snapshot is asked again next time; a built one is kept */
    if (built) openRef.current.set(t, built);
    return built;
  };
  /* EACH NAME'S BOOK, REBUILT WHEN IT MATTERS — the host's rule (above) for the names beside it (2026-10-12, Noah:
     taking a name off "is very glitchy and laggy"): every recompute here rebuilt EVERY remaining name's surface
     (fifteen expiries × a priced chain, ~50ms a name) and, the surfaces being new objects, re-rendered every
     capsule — on a name leaving, on a name arriving, and on the host's every rebuild. A name's surface is kept
     until its spot has moved a tenth of a percent or six seconds have passed; the replay rebuilds every frame. */
  const extraCache = useRef(new Map<string, { surface: ExposureSurface; spot: number; at: number }>());
  const namesSeen = useRef(names);
  const extraBooks = useMemo(() => {
    if (!multi || !surface) return [];
    const out: { ticker: string; book: ColumnBook | null }[] = [];
    const now = Date.now();
    /* a change of the NAMES (one leaving, one arriving) reuses every kept book whatever its age — the tick that
       follows refreshes them; a click never pays for a rebuild (a profile of a name leaving found two rebuilds in
       the click's own task, the cache having aged past six seconds) */
    const namesChanged = namesSeen.current !== names;
    namesSeen.current = names;
    for (const t of names) {
      const ready = snapshotFor ? snapshotFor(t) : snapshotOf(t, 'full');
      if (!ready) {
        if (!snapshotFor) ensureBook(t, 'full');
        out.push({ ticker: t, book: null });
        continue;
      }
      try {
        const snap = ready;
        if (!snap) {
          out.push({ ticker: t, book: null });
          continue;
        }
        const kept = extraCache.current.get(t);
        let built: ExposureSurface;
        if (!fresh && kept && (namesChanged || (Math.abs(snap.spot - kept.spot) / kept.spot < 0.001 && now - kept.at < 6000))) built = kept.surface;
        else {
          built = buildExposureSurface(snap, WHOLE_BOOK, CALENDAR_DTES);
          extraCache.current.set(t, { surface: built, spot: snap.spot, at: now });
        }
        out.push({ ticker: t, book: { ticker: t, snapshot: snap, surface: built } });
      } catch {
        /* a name the sim can't build — the column is skipped */
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multi, names, surface, snapshotFor, warmed, fresh]);
  useEffect(() => {
    const cold = extraBooks.filter(c => !c.book && !warmedRef.current.has(c.ticker)).map(c => c.ticker);
    if (!cold.length) return;
    let cancelled = false;
    let timer = 0;
    const run = (i: number) => {
      timer = window.setTimeout(
        () => {
          if (cancelled) return;
          const t = cold[i];
          try {
            ensureBook(t, 'full');
          } catch {
            /* the book isn't in yet — the column goes on the next build */
          }
          warmedRef.current.add(t);
          arrivingRef.current.delete(t);
          /* the book's build and the column's first render as a transition — sliced, never one long task */
          startTransition(() => setWarmed(n => n + 1));
          if (i + 1 < cold.length) run(i + 1);
        },
        i === 0 ? LEAVE_MS + 60 : 40
      );
    };
    run(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [extraBooks]);
  /* the last book of every name, so a leaving column still has one to draw while it glides shut */
  const lastBooks = useRef(new Map<string, ColumnBook>());
  for (const c of extraBooks) if (c.book) lastBooks.current.set(c.ticker, c.book);
  /* THE COLUMNS IN THEIR SLOTS: the names present, the leaving ones still in
     place, a new name at the end */
  const present = new Map(extraBooks.map(c => [c.ticker, c]));
  orderRef.current = [...orderRef.current.filter(t => present.has(t) || leaving[t]), ...extraBooks.map(c => c.ticker).filter(t => !orderRef.current.includes(t))];
  const columns = orderRef.current
    .filter(t => present.has(t) || leaving[t])
    .map(t => ({ ticker: t, book: present.get(t)?.book ?? lastBooks.current.get(t) ?? null, host: false, leaving: !present.has(t) }));
  /* THE FOCUS DOOR (Noah, 2026-10-12: "focus should also only be a button up top where it only focuses on the nodes
     with the large percentages and not allowed on the random click of any node"): on, every calendar pane softens
     behind its badged nodes — the biggest moves since the open; off by the door again or Escape; never while the
     replay runs (no badges there) */
  const [focusOn, setFocusOn] = useState(false);
  useEffect(() => {
    if (!focusOn && !Object.values(ownFocus).some(Boolean)) return;
    const h = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setFocusOn(false);
        setOwnFocus({});
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [focusOn, ownFocus]);
  /* ADD A NAME — the Board's own menu: the trigger on the band, the lookup in a portal */
  const [adding, setAdding] = useState(false);
  const addRootRef = useRef<HTMLSpanElement | null>(null);
  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const { anchorRef: addAnchor, placed: addPlaced } = useAnchoredMenu<HTMLButtonElement>(adding, 'bottom', 288, 'start');
  useFocusTrap(adding, addMenuRef);
  useEffect(() => {
    if (!adding) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (addRootRef.current?.contains(t) || addMenuRef.current?.contains(t)) return;
      setAdding(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setAdding(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [adding]);

  const supremeGreek: Greek = greeks[0] ?? 'gex';
  /* the Levels card's contracts, in a word, for the supreme door */
  const levelsLabel = levelsScope === 'ALL' ? 'all expiries' : 'today';
  /* the book's strikes either side of spot — the Strikes menu's counts */
  const bookAbove = surface ? surface.strikes.filter(k => k >= surface.spot).length : WHOLE_BOOK;
  const bookBelow = surface ? surface.strikes.filter(k => k < surface.spot).length : WHOLE_BOOK;
  /* WHAT A PANE'S HEAD NEEDS side by side: the name, the supreme and the greek at their own widths, the read's door and
     the ×, the gaps and the padding — read off the heads drawn, after every commit (the content's widths, never the
     pane's, so the answer holds still) */
  const [headNeed, setHeadNeed] = useState(0);
  useLayoutEffect(() => {
    const island = islandRef.current;
    if (!island) return;
    let need = 0;
    island.querySelectorAll<HTMLElement>('[data-field-column-head]').forEach(h => {
      const main = h.querySelector<HTMLElement>('[data-field-head-main]');
      const doors = h.querySelector<HTMLElement>('[data-field-head-doors]');
      if (!main || !doors) return;
      /* THE CONTENT'S OWN WIDTH, never scrollWidth (the port, 2026-10-14): scrollWidth is the box's width when the content
         does not overflow it, so the host's short head read as "the pane and two pixels", the island packed to that, the
         pane grew, the head read two more — a layout loop React stopped at its depth limit with two names beside each
         other. The pieces' widths and their gaps are the need. */
      const kids = Array.from(main.children) as HTMLElement[];
      const content = kids.reduce((w, k) => w + k.getBoundingClientRect().width, 0) + Math.max(0, kids.length - 1) * 8;
      need = Math.max(need, Math.ceil(content) + doors.offsetWidth + 8 + 24 + 2);
    });
    setHeadNeed(prev => (Math.abs(prev - need) < 2 ? prev : Math.ceil(need)));
  });
  if (!snapshot || !surface) {
    return (
      <div className="h-full min-h-[300px] grid place-items-center font-mono text-[11px] text-textMuted uppercase tracking-widest">
        Waiting for the first tick
      </div>
    );
  }
  /* The SUPREME is the heaviest STRIKE of the whole book — the one the chart
     wears in magenta — shown with the date carrying most of it. The heaviest
     single cell is the grid's star, a different fact with its own plain name. */
  /* the door crowns what the matrix crowns: the WINDOW's supreme (scoped to the Expiries card), not the front book's —
     the two disagreed (775 on the door, 760 in magenta on the grid) once the per-date chains landed (2026-10-22) */
  const crowned = scoped(surface, snapshot);
  const supreme = crowned.supreme[supremeGreek];
  const supremeEx = crowned.expiries[supreme.e];
  const liveChange = snapshot.changePercent;
  const up = liveChange >= 0;
  /* the expiries drawn for the host's book: the window, the ceiling, what fits (see `windowFor`) */
  const shownIdx = shownFor(surface, { range, afterBell, greeks });
  const ex = surface.expiries;
  /* THE CALENDAR IS THE CONTROL (Noah, 2026-09-12: "i dont even see the
     calendar page"): every expiry the book holds is a lit day; since
     2026-09-22 the card picks a WINDOW of them — From and Through — with
     shortcuts, and says the ceiling. */
  const beside = extraBooks.length > 0 ? ` beside ${1 + extraBooks.length} names` : '';
  const expiryDays: ExpiryDay[] = ex.map((e, i) => ({
    value: i,
    date: expiryFor(e.dte).date,
    label: e.dte === 0 ? 'Today' : e.date,
    hint: e.dte === 0 ? `${e.date} — the contracts that expire at the bell` : `${e.date} — ${e.dte} ${e.dte === 1 ? 'day' : 'days'} out`,
  }));
  const lastIdx = Math.max(0, ex.length - 1);
  const weekEnd = ex.reduce((last, e, i) => (e.dte <= 5 ? i : last), 0);
  const shortcuts: ExpiryShortcut[] = [
    { label: 'Today only', hint: 'The contracts that expire at the bell', from: 0, through: 0 },
    { label: 'This week', hint: 'Every expiry inside the week', from: 0, through: Math.min(weekEnd, ceiling - 1) },
    { label: `Next ${Math.min(7, ceiling, ex.length)}`, hint: `The nearest ${Math.min(7, ceiling, ex.length)} expiries`, from: 0, through: Math.min(6, ceiling - 1, lastIdx) },
  ];
  const ceilingWhy = greeks.length >= 5 ? `${ceiling} at most with five greeks` : greeks.length === 1 ? `up to ${Math.min(ceiling, ex.length)} with one greek` : `${ceiling} at most with ${greeks.length} greeks`;
  const wanted = windowFor(surface, { range, afterBell, greeks }).length;
  /* the greeks the host's ledger could draw — fewer than picked when the box is narrower than one expiry of them */
  const greeksCut = view === 'calendar' && extraBooks.length === 0 && fitGreeks < greeks.length ? fitGreeks : null;
  const greekNames = (gs: Greek[]) => gs.map(g => GREEK_LABEL[g] ?? g.toUpperCase()).join(', ');
  const fitNote =
    wanted > shownIdx.length || greeksCut != null
      ? panel
        ? `Only ${greeksCut != null ? `${greekNames(greeks.slice(0, greeksCut))} of ${greeks.length} greeks` : ''}${greeksCut != null && wanted > shownIdx.length ? ' and ' : ''}${wanted > shownIdx.length ? `${shownIdx.length} of ${wanted} expiries` : ''} fit — ${narrowHint}.`
        : `Only ${greeksCut != null ? `${greekNames(greeks.slice(0, greeksCut))} of the ${greeks.length} greeks` : ''}${greeksCut != null && wanted > shownIdx.length ? ' and ' : ''}${wanted > shownIdx.length ? `${shownIdx.length} of the ${wanted} expiries` : ''} you chose fit${beside} at this width — ${extraBooks.length > 0 ? 'take a name off or widen the window' : narrowHint} to see the rest.`
      : undefined;
  /* THE BAND SAYS WHAT IS TRUE OF EVERY COLUMN; THE COLUMN SAYS WHAT IS TRUE
     OF ITS NAME (Noah, 2026-09-13: "with multiple tickers doesn't that mean
     the top left ticker shouldn't exist? only when the user decides to click
     out the other 2 then the last one should reoccur and take that spot"):
     with names side by side the band's per-name pieces — the scope chip, the
     Greek card, the supreme fact, the read's door — FOLD SHUT on the band as
     every column's head unfolds with its own; the last column taken off, they
     fold back open in their spots. Folds, not glides: nothing scales, nothing
     remounts, the neighbours slide over on real layout. */
  const many = extraBooks.length > 0;
  const tight = 1 + extraBooks.length >= TIGHT_AT;
  /* the band's mode by its measured width (see BAND_*_ROW_PX); the desk toolbar (Pulse) has no band and never
     measures, so its cards keep their names */
  /* the band's shape — what its named row's width depends on — and that shape's measure */
  shapeRef.current = `${view}|${many ? extraBooks.length : 0}|${greeks.length}|${legs}|${range.from}-${range.through}|${afterBell ? 'a' : 'n'}|${fresh ? 'r' : ''}|${shownIdx.length}`;
  const measured = measures[shapeRef.current];
  const namedNeed = measured?.need ?? 0;
  /* …and on a coarse pointer (a tablet) while the picks cannot be named on one row: a thumb cannot hover a bare pick's
     tooltip, and at 682px (a tablet with the rail folded) the two tidy rows ran to four */
  const bandScroll = toolbar === 'band' && bandW > 0 && (bandW < BAND_SCROLL_PX || (coarsePointer && bandW < BAND_NAMED_ROW_PX));
  const namedFits = toolbar === 'band' && namedNeed > 0 && bandW >= namedNeed + 24;
  /* THE DOORS' WORDS GO ONE DOOR AT A TIME, the least read first, until the row fits — the picks keep theirs */
  const compactDoors = new Set<DoorKey>();
  let doorsFit = false;
  if (toolbar === 'band' && measured && !namedFits && !bandScroll) {
    const over = measured.need + 24 - bandW;
    let saved = 0;
    for (const k of DOOR_ORDER) {
      if (saved >= over) break;
      const sv = measured.savings[k] ?? 0;
      if (sv > 0) {
        compactDoors.add(k);
        saved += sv;
      }
    }
    doorsFit = saved >= over;
  }
  /* a shape not yet measured is drawn named — once, before paint (the measure runs in a layout effect) */
  const measuring = toolbar === 'band' && bandW > 0 && !measured && !bandScroll;
  const bandMode: 'one' | 'doors' | 'bare' | 'tight' | 'two' = bandW === 0 || namedFits || measuring ? 'one' : doorsFit ? 'doors' : bandW >= BAND_ONE_ROW_PX ? 'one' : bandW >= BAND_BARE_ROW_PX ? 'bare' : bandW >= BAND_TIGHT_ROW_PX ? 'tight' : 'two';
  /* TWO TIDY ROWS WITH THEIR WORDS when the pieces are over the one row's room (the re-audit's H1): bare picks were
     the price of staying on one row; a band that wraps anyway pays it for nothing. And under BAND_SCROLL_PX (a phone)
     the two rows scroll sideways with their words (H2) — a bare pick's name lives in a tooltip no thumb can hover. */
  const overNamed = bandOver && bandMode !== 'two';
  const stripsBare = toolbar === 'band' && !overNamed && !bandScroll && (bandMode === 'bare' || bandMode === 'tight' || (bandMode === 'two' && bandW < BAND_NAMED_ROW_PX));
  /* …and on the two rows under BAND_NAMED_ROW_PX (a 1024 desk, the picks already bare) the doors go compact too: with
     their words they ran to four rows there, the read, the guide and the fullscreen door alone on the last */
  const doorsTightTwo = toolbar === 'band' && !overNamed && !bandScroll && bandMode === 'two' && bandW < BAND_DOORS_WORDS_PX;
  const doorsTight = (toolbar === 'band' && !overNamed && bandMode === 'tight') || doorsTightTwo;
  /* one door's words: gone with every door's (tight), or with its own in 'doors' — which is never gated on `overNamed`:
     that was read off the named two-row layout, and it would never leave it */
  const doorCompact = (k: DoorKey) => doorsTight || (bandMode === 'doors' && compactDoors.has(k));
  namedNow.current = toolbar === 'band' && !stripsBare && !doorsTight && !bandScroll && bandMode !== 'doors';
  /* THE BAND IN GROUPS (the owner, 2026-10-14: "15 equally weighted pills with no grouping or separators"): the name ·
     what you are looking at (View, Greek, Legs) · which data (Expiries, Strikes, Show) · what you can do (Names, Biggest
     moves, Replay · More) · the name's own (Supreme, The read, the guide, fullscreen). A hairline between the groups; none
     on a phone's scrolling rows, where it would be one more thing to scroll past. */
  const divider = toolbar === 'band' && !bandScroll ? <span aria-hidden className="h-5 w-px shrink-0 bg-borderSubtle" data-band-divider /> : null;
  const strips = (
    <>
      {divider}
      {/* bare in the panel (2026-10-15): "Calendar", "GEX" and "Today → Oct 19" say what they are without their label words,
          and the three cards then share the panel's one head line with the tabs at 580px */}
      {!viewLock && <DropdownSelect label="View" value={view} options={VIEWS_FOR[viewHost].map(v => VIEW_OPTION[v])} onChange={pickView} title="The matrix, the calendar or the profile" testId="ledger-view" bare={stripsBare || panel} flat={toolbar === 'band'} />}
      {/* with names side by side the greek steps down to each column's head; the profile draws GEX alone (its foot says
          so), so the card steps aside there rather than read "All five" over a chart it does not govern (the re-audit's M2) */}
      {view !== 'profile' && (
        <Fold open={!many} gap={8} testId="data-band-greek">
          <DropdownMulti label="Greek" values={pick} groups={greekGroups} onChange={setPick} emptyWord="All" clearWord={noVex ? 'Clear · all four' : 'Clear · all five'} title={noVex ? 'One, some, or all four' : 'One, some, or all five'} testId="ledger-greek" align="start" bare={stripsBare || panel} flat={toolbar === 'band'} />
        </Fold>
      )}
      {/* the profile draws the net alone — the card steps aside there */}
      {view !== 'profile' && !panel && <DropdownSelect label="Legs" value={legsDrawn} options={legsOptions(view === 'calendar')} onChange={setLegs} title="Which legs the cells carry" testId="ledger-legs" bare={stripsBare} flat={toolbar === 'band'} />}
      {divider}
      {/* the trigger says the window DRAWN when the fit cuts the one chosen — "Today → Oct 16 · 4 of 7" (the audit's H4) */}
      <ExpiryRangeCard label="Expiries" days={expiryDays} from={range.from} through={range.through} onChange={(from, through) => { setOwnDates({}); setRange({ from, through }); }} ceiling={ceiling} ceilingWhy={ceilingWhy} shortcuts={shortcuts} title="Which expiries every name follows. A name can leave this from its own column; changing it here puts every name back on it." testId="ledger-expiries" note={fitNote} bare={stripsBare || panel} flat={toolbar === 'band'} cut={{ through: shownIdx[shownIdx.length - 1] ?? range.through, shown: shownIdx.length, wanted }} />
      {!panel && <DropdownSelect
        label="Strikes"
        value={rings}
        /* THE COUNTS THE GRID DRAWS (the paying-user audit's L4/M6, 2026-10-13): the menu said 41 rows for twenty each side
           and 61 for thirty while the grid drew 40 and 60 (spot sits between two strikes, not on a row), and The read
           said 60 under a 40-row grid. Counted off the book itself — a vendor's chain can hold fewer — and the widest
           window is named for what it is: the whole book */
        options={LEDGER_WINDOWS.map(w => {
          const up = Math.min(w, bookAbove);
          const down = Math.min(w, bookBelow);
          /* the trigger says "±20" (the band's one row at 1920 — the paying-user audit, 2026-10-13); the rows say it whole */
          return w === WHOLE_BOOK
            ? { value: w as number, label: 'All', hint: `Every strike the book holds — ${up + down} rows, ${up} above spot and ${down} below` }
            : { value: w as number, label: `${w} each side`, short: `±${w}`, hint: `${up + down} rows — ${up} strikes above spot and ${down} below` };
        })}
        onChange={setRings}
        title="How many strikes around spot"
        testId="ledger-strikes"
        bare={stripsBare}
        flat={toolbar === 'band'}
      />}
      {/* a face of its own, so "Now" alone on a bare band still says which card it is (the audit's L2) */}
      {!panel && <DropdownSelect label="Show" value={afterBell ? 'after' : 'now'} options={SHOW_OPTIONS} onChange={v => setAfterBell(v === 'after')} title="The book as it stands now, or as it will stand after today's expiries" testId="ledger-show" bare={stripsBare} flat={toolbar === 'band'} />}
      {/* the colours switch left the band for Settings › Appearance (idea 10, 2026-10-13): a preference made once, not a
          read, and 150px of every row */}
    </>
  );
  const supremeDoor = (
    <button
      onClick={() => onSelectStrike?.(supreme.strike)}
      title={supremeGreek === 'gex' ? `The supreme: the strike with the most hedging on it, read off the Levels card's contracts (${levelsLabel}) — the same strike the Board, the Agenda and Compare show. Click to keep the strike` : `The strike with the most ${GREEK_LABEL[supremeGreek]} on the front expiry. Click to keep the strike`}
      /* the cards' 28px (it stood 32 on a 28px row), sentence case like them, and a button's hover edge (the audit's M2, M3, L10) */
      /* A QUIET CHIP WITH A MAGENTA MARK (the owner, 2026-10-14: "the loudest thing on the screen is the magenta Supreme
         pill, which is a secondary fact"): the chip is the band's, the dot is the supreme's — the one place magenta stands
         here, as it stands on the strike itself */
      className={toolbar === 'band' ? `${FLAT_DOOR} ml-auto gap-2` : 'hit ml-auto inline-flex items-center gap-2 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono transition-colors'}
      data-ledger-supreme={doorCompact('supreme') ? 'compact' : 'full'}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-supreme" />
      {/* the window it is crowned over, said on the door — the Agenda and the Board crown the Levels card's (today's), so
          a wider window here can name another strike (the UI sweep, 2026-10-22) */}
      <span className="text-[11px] text-textMuted">Supreme{!doorCompact('supreme') && supremeGreek === 'gex' && <span className="text-textMuted/70"> · {levelsLabel}</span>}</span>
      <span className="text-[11px] font-semibold tnum text-textPrimary whitespace-nowrap">
        {fmtStrike(supreme.strike)}
        {/* tight: the strike alone — the date and the amount stay in the title */}
        {!doorCompact('supreme') && (
          <>
            {' '}
            {/* the amount, not the date (the band's one row at 1920): the date is in the title and on the strike's card */}
            <span data-door-words>
              <span className="text-textMuted font-normal">·</span> {fmtUsd(shownGreek(supremeGreek, supreme.total))}
            </span>
          </>
        )}
      </span>
    </button>
  );
  /* on the band every door wears the same edge — the guide and fullscreen had none (the owner, 2026-10-14) */
  const guideButton = <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title={view === 'profile' ? 'What the curve means' : view === 'matrix' ? 'What the matrix means' : 'What the calendar means'} testId="ledger-guide" compact={doorCompact('guide')} size={toolbar === 'band' ? 'md' : 'sm'} className={toolbar === 'band' ? `font-mono uppercase tracking-wider px-2${many ? ' ml-auto' : ''}` : ''} />;
  /* where the book comes from and the two exports, behind one door (MoreDoor.tsx) */
  const moreDoor = toolbar === 'band' ? <MoreDoor surface={scoped(surface, snapshot)} greeks={greeks} expiries={shownIdx} onData={() => setDataOpen(true)} compact={doorCompact('more')} /> : null;
  /* THE READ's door — beside the guide's; lit while the card is up. The band's opens the host's read */
  const readDoor = <ReadDoor open={readOf(surface.ticker) === 'open'} onClick={() => toggleRead(surface.ticker)} compact={doorCompact('read')} flat={toolbar === 'band'} />;
  const fullButton =
    headFull && !full ? null : (
      <button
        onClick={() => (full ? close() : setFull(true))}
        title={full ? 'Exit fullscreen (Esc)' : 'Fullscreen'}
        className={`hit shrink-0 inline-flex items-center justify-center rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors ${toolbar === 'band' ? 'w-7 h-7' : 'p-1.5'}`}
      >
        {full ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    );
  const backButton = full ? (
    <button
      onClick={close}
      className={`${FLAT_DOOR} group`}
    >
      <ArrowLeft className="w-3 h-3 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> Back
    </button>
  ) : null;

  /* THE BAND HEAD KNOWS ITS ROOM (Noah, 2026-09-22, the landing's Map still at 1440: "the top of the images… have
     unorganized buttons like we had before" — the one row wrapped wherever it ran out, leaving the supreme, the read
     and the doors ragged on a second line; then, on two tidy rows: "top buttons are being kicked out and placed
     underneath"). Measured off the band itself, before the first paint, the Weigher's way: ONE ROW for as long as
     it can be one — the picks bare, then the doors compact — and only under that TWO TIDY ROWS: the picks (the
     name, view, greek, expiries, strikes, show, colours) on the first, the doors (names, replay, the supreme, the
     read, how to read, fullscreen) on the second, the fullscreen door last on either. See BAND_*_ROW_PX. */
  const bandRows: 'one' | 'two' = bandMode === 'two' || bandOver ? 'two' : 'one';
  /* THE PHONE'S ROWS SAY THEY GO ON: a fade at the edge with more behind it, none at the end (data-scroll-more, index.css) */
  useEffect(() => {
    if (!bandScroll) return;
    const el = bandEl.current;
    if (!el) return;
    const offs = [...el.querySelectorAll<HTMLElement>('[data-ledger-toolbar-row]')].map(attachScrollMore);
    return () => offs.forEach(off => off());
  }, [bandScroll, bandRows]);

  const leadFold = lead ? (
    <Fold open={!many} gap={8} testId="data-band-lead">
      <span className="shrink-0 inline-flex items-center">{lead}</span>
    </Fold>
  ) : null;
  /* THE FOCUS DOOR — beside Names: the calendar's biggest moves since the open, sharp over a softened board. Only on
     the calendar, never in the replay (no badges there); the word says what it keeps. */
  /* NAMED FOR WHAT IT KEEPS (the audit's H9, 2026-10-13): "Focus" was also the shell chip's word for a kept strike, so one
     word named two things on one screen; the door says "Biggest moves". And it STAYS on the matrix, disabled, rather
     than coming and going with the view and shifting the doors beside it (the audit's L9). */
  const focusDoor = (
    <button
      type="button"
      onClick={() => {
        setOwnFocus({});
        setFocusOn(v => !v);
      }}
      aria-pressed={focusOn}
      disabled={fresh}
      title={fresh ? 'Not while the replay runs' : focusOn ? 'Back to the whole board (Esc)' : 'Keep only the biggest moves since the open sharp — the badged nodes'}
      aria-label="Biggest moves"
      className={`${FLAT_DOOR} disabled:opacity-50 ${doorCompact('focus') ? 'w-7 justify-center px-0' : ''} ${focusOn ? FLAT_ON : ''}`}
      data-ledger-focus-door={focusOn ? 'on' : 'off'}
    >
      <Crosshair className="w-3 h-3" />
      {!doorCompact('focus') && <span>Biggest moves</span>}
    </button>
  );
  const namesDoor = multi && (
        <span ref={addRootRef} className="relative inline-flex">
          <button
            ref={addAnchor}
            type="button"
            onClick={() => setAdding(v => !v)}
            aria-expanded={adding}
            disabled={names.length >= EXTRA_MAX}
            title={names.length >= EXTRA_MAX ? 'Four names at most — take one off to add another' : 'Show another name beside this one — up to four side by side'}
            className={`${FLAT_DOOR} disabled:opacity-50 ${adding ? 'bg-ink/[0.06] text-textPrimary' : ''}`}
            data-ledger-add
          >
            <Plus className="w-3 h-3" />
            {/* the count is the book, one name or four — a blank Names control reads as broken */}
            <span>Names</span>
            <span className="text-[11px] font-semibold text-textPrimary tnum">{1 + names.length}</span>
          </button>
          {adding &&
            addPlaced &&
            createPortal(
              <div
                ref={addMenuRef}
                role="dialog"
                aria-label="Show another name beside this one"
                style={{ position: 'fixed', ...addPlaced.box }}
                className="z-[120] w-72 border border-borderMuted bg-panel/80 backdrop-blur-xl backdrop-saturate-150 rounded-md shadow-2xl shadow-black/60 overflow-x-hidden overflow-y-auto overscroll-contain"
                data-ledger-add-menu
              >
                <div className="px-2.5 py-1.5 border-b border-borderSubtle text-[11px] text-textMuted">Show another name beside this one — up to four side by side, on the same choices</div>
                <TickerLookup
                  onPick={sym => {
                    addName(sym);
                    setAdding(false);
                  }}
                />
              </div>,
              document.body
            )}
        </span>
      );
  /* the supreme and the read are one name's — they step down into the columns' heads with the chip */
  const doors = (
    <>
      {bandRows === 'one' && divider}
      {namesDoor}
      {/* only where it works (the paying-user audit's L7): a greyed door on the matrix and the profile was a control that
          said no every time it was tried */}
      {view === 'calendar' && focusDoor}
      {after}
      {divider}
      {moreDoor}
      {/* ONE SUPREME AND ONE READ ARE ONE NAME'S. With names side by side each column carries its own — a single
         chip in the band would be the first name pretending to be the page. */}
      {!many && (
        <Fold open gap={8} className="ml-auto" testId="data-band-supreme">
          {supremeDoor}
        </Fold>
      )}
      {!many && (
        <Fold open gap={8} testId="data-band-read">
          {readDoor}
        </Fold>
      )}
      {guideButton}
      {fullButton}
    </>
  );
  const head = toolbar === 'band' ? (
    bandRows === 'one' ? (
      <div ref={bandRef} className="shrink-0 flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5 border-b border-borderSubtle/60 bg-panel" data-ledger-toolbar data-ledger-toolbar-rows="one" data-ledger-toolbar-mode={bandMode}>
        {backButton}
        {leadFold}
        {strips}
        {doors}
      </div>
    ) : (
      /* on a phone each row is 44px tall (py-2 round 28px controls): a scrolling row clips what hangs outside it, so the
         thumb's box (.hit, index.css) needs the row itself to be the box */
      <div ref={bandRef} className={`shrink-0 flex flex-col px-3 border-b border-borderSubtle/60 bg-panel ${bandScroll ? 'gap-y-0 py-0' : 'gap-y-1.5 py-1.5'}`} data-ledger-toolbar data-ledger-toolbar-rows="two" data-ledger-toolbar-mode={bandMode} data-ledger-toolbar-scroll={bandScroll ? '' : undefined}>
        <div className={`flex items-center gap-x-2 gap-y-1.5 ${bandScroll ? 'flex-nowrap overflow-x-auto scroll-row [&>*]:shrink-0 py-2' : 'flex-wrap'}`} data-ledger-toolbar-row="picks">
          {backButton}
          {leadFold}
          {strips}
        </div>
        <div className={`flex items-center gap-x-2 gap-y-1.5 ${bandScroll ? 'flex-nowrap overflow-x-auto scroll-row [&>*]:shrink-0 py-2' : 'flex-wrap'}`} data-ledger-toolbar-row="doors">
          {doors}
        </div>
      </div>
    )
  ) : panel ? (
    headSlot ? (
      /* ON THE PANEL'S OWN HEAD LINE (Noah, 2026-10-15: "the view, greek and exp should sit even higher on the same line as
         the ladder net and gex to give the map even more space"): the three cards are the host row's own items through
         its slot, the fit's note a line of its own under them when it bites */
      <>
        {strips}
        {fitNote && (
          <p className="basis-full -mt-0.5 pb-0.5 text-[10.5px] leading-snug text-textSecondary" data-fit-note>
            {fitNote}
          </p>
        )}
      </>
    ) : (
      /* the panel's head: the three cards on one wrapping row, the fit's note under them when it bites — nothing else */
      <div className="shrink-0 border-b border-borderSubtle/60" data-ledger-toolbar-mode="panel">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1.5">{strips}</div>
        {fitNote && (
          <p className="px-2 pb-1.5 -mt-0.5 text-[10.5px] leading-snug text-textSecondary" data-fit-note>
            {fitNote}
          </p>
        )}
      </div>
    )
  ) : (
    <div className="shrink-0 border-b border-borderSubtle/60">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 pt-2 pb-1.5">
        {backButton}
        {/* The name, its price, its change — the panel says whose book this is; the search changes whose. */}
        <span className="inline-flex items-center gap-2 font-mono">
          <CompanyLogo ticker={surface.ticker} size={18} />
          <span className="text-[14px] font-bold text-textPrimary">{surface.ticker}</span>
          <span className="text-[12px] tnum text-textPrimary">${snapshot.spot.toFixed(2)}</span>
          <span className={`text-[11px] tnum ${up ? 'text-bull' : 'text-bear'}`}>
            {up ? '+' : ''}
            {liveChange.toFixed(2)}%
          </span>
        </span>
        {onTicker && <TickerSearch value={surface.ticker} onChange={onTicker} />}
        {/* The supreme — one door, the supreme ink, the thing the eye lands on. */}
        {supremeDoor}
        {readDoor}
        {fullButton}
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 pb-2">{strips}</div>
      {/* THE CUT, SAID IN THE OPEN (Noah, 2026-10-15, on Terrain's panel: "if its too narrow it should notify the user
          to either expand the gex view or decrease the amount of exp") — the Expiries card carries the same words
          inside; here they stand under the strips where the eye is */}
      {fitNote && (
        <p className="px-3 pb-2 -mt-0.5 text-[11px] leading-snug text-textPrimary" data-fit-note>
          {fitNote}
        </p>
      )}
    </div>
  );

  // The host's ladder washes the same strike — the only thing the pointer leaves the panel for
  const onPointerLive = (cell: SurfaceCell | null) => {
    pointedRef.current?.(cell?.strike ?? null);
    onHoverStrike?.(cell?.strike ?? null);
  };
  /* STABLE HANDLES AND LISTS FOR THE PANES (2026-10-12): the panes are memoised; a fresh arrow or array a render
     would undo that, so the handlers go through refs and a list is the same array while its values are */
  const onPointerRef = useRef(onPointerLive);
  onPointerRef.current = onPointerLive;
  const onPointer = useCallback((cell: SurfaceCell | null) => onPointerRef.current(cell), []);
  const onSelectStrikeForRef = useRef(onSelectStrikeFor);
  onSelectStrikeForRef.current = onSelectStrikeFor;
  const handlesRef = useRef(new Map<string, { keep: (s: number) => void; point: (cell: SurfaceCell | null) => void }>());
  const handlesFor = (t: string) => {
    let h = handlesRef.current.get(t);
    if (!h) {
      h = { keep: (s: number) => onSelectStrikeForRef.current?.(t, s), point: (cell: SurfaceCell | null) => pointedFor.current.get(t)?.(cell?.strike ?? null) };
      handlesRef.current.set(t, h);
    }
    return h;
  };
  const listsRef = useRef(new Map<string, unknown[]>());
  const same = <T,>(key: string, next: T[]): T[] => {
    const prev = listsRef.current.get(key) as T[] | undefined;
    if (prev && prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
    listsRef.current.set(key, next);
    return next;
  };
  /* the host first, then every column in its slot — a leaving one at 0fr */
  const allColumns: { ticker: string; book: ColumnBook | null; host: boolean; leaving: boolean }[] = [{ ticker: surface.ticker, book: { ticker: surface.ticker, snapshot, surface }, host: true, leaving: false }, ...columns];
  /* THE TRACKS MOVE ONE FRAME AFTER THE COLUMNS CHANGE (2026-10-12, Noah: "some weird resize happens last second"):
     the panes re-fit for their promised width in the same task as the change; moved in that task, the tracks'
     transition was already a hundred milliseconds in when it first painted, and a pane stretched its old columns
     for a third of the glide before the new fit landed and the capsules snapped narrower. Now the columns commit,
     every pane lays itself out for the destination, and only then do the tracks begin to move. */
  /* NAMES SIDE BY SIDE ON A PHONE ARE A SWIPE (the paying-user audit's C4, 2026-10-13): three panes in 358px cut every
     figure to "$1.4" with its M or B gone; under 640px each name takes the whole width and the island scrolls sideways
     between them, a name at a time */
  const islandRoomNow = islandRef.current?.parentElement?.clientWidth ?? 0;
  const carousel = islandRoomNow > 0 && islandRoomNow < 640 && allColumns.filter(c => !c.leaving).length > 1;
  const targetTracks = Array.from({ length: TRACKS }, (_, i) => (i < allColumns.length && !allColumns[i].leaving ? (carousel ? 'calc(100% - 8px)' : '1fr') : carousel ? '0px' : '0fr')).join(' ');
  /* THE TRACKS ARE THE COLUMNS, AT ONCE (the owner, 2026-10-14): a name added or taken off moved the tracks a frame
     after the columns, with a glide that held every pane's measure for 80ms — the new column stood 2px wide for a frame,
     then the widths landed in steps. The tracks are now the columns' own, in the same commit, and nothing glides. */
  const tracks = targetTracks;
  /* THE PROMISE (2026-10-12, with the columns' glide): every column says the width it will have when the tracks
     settle — the island's inner width shared by the columns staying — so each pane lays itself out for the
     destination at once and holds there through the glide (ExposureLedger reads it as `promisedWidth`) */
  const staying = allColumns.filter(c => !c.leaving).length;
  /* THE ISLAND PACKS TO ITS PANES (2026-10-13): as wide as the names standing need at their widest — the widest pane's
     natural width each, its 1px rules and, side by side, its 4px margins and the island's 4px padding — and no wider;
     the profile fills its room. A name not yet measured borrows the widest measured, so an arriving column never
     throws the island open for a frame. */
  const packs = !!onNaturalWidth && d.view !== 'profile';
  const knownNaturals = allColumns.filter(c => !c.leaving).map(c => naturals[`${c.ticker}|${d.view}`]).filter((v): v is number => v > 0);
  /* …and never narrower than a pane's head, side by side (headNeed) */
  const paneNatural = knownNaturals.length ? Math.max(...knownNaturals, many ? headNeed : 0) : 0;
  const naturalW = packs && paneNatural > 0 ? staying * (paneNatural + 2 + (many ? 8 : 0)) + (many ? 8 : 0) : 0;
  const islandMax = pack && !full ? naturalW : 0;
  const islandRoom = islandRef.current?.parentElement?.clientWidth ?? islandRef.current?.clientWidth ?? 0;
  /* THE ROOM AS IT IS AFTER THE COMMIT (2026-10-14): the island's room is read in render, off the DOM the last commit
     left — a name added made the host widen the book in the same commit, and the panes were drawn one frame at the old
     room's share (204px each) before they took the new one. Re-read before paint, re-rendered at once if it moved. */
  const roomSeen = useRef(0);
  roomSeen.current = islandRoom;
  const [, reroom] = useState(0);
  useLayoutEffect(() => {
    const now = islandRef.current?.parentElement?.clientWidth ?? islandRef.current?.clientWidth ?? 0;
    if (now !== roomSeen.current) reroom(n => n + 1);
  });
  const islandW = islandMax > 0 && islandRoom > 0 ? Math.min(islandMax, islandRoom) : islandRef.current?.clientWidth ?? 0;
  const tileW = carousel ? Math.max(0, islandW - 16) : islandW > 0 && staying > 0 ? Math.floor((islandW - (many ? 8 : 0)) / staying) : 0;

  /* the band's named row is the floor — measured once it has been drawn with its words, the widest band's threshold until
     then, so a box packing to one narrow pane never squeezes the band into its phone rows before it has been measured */
  /* the Map's band goes up to the Pinpoint head; the panel's three cards go up to the panel's own head line (2026-10-15) */
  const headOut = (toolbar === 'band' || panel) && !!headSlot && !full;
  useEffect(() => {
    if (namedNeed > 0) onBandNeed?.(namedNeed);
  }, [namedNeed, onBandNeed]);
  const hostNatural = naturalW > 0 ? (headOut ? naturalW : Math.max(naturalW, namedNeed > 0 ? namedNeed + 48 : BAND_ONE_ROW_PX)) + 2 : 0;
  /* told before paint (a layout effect): the Map sizes the book and decides where the day box stands in the same frame */
  useLayoutEffect(() => {
    onNaturalWidth?.(hostNatural);
  }, [hostNatural, onNaturalWidth]);

  const body = (
    <div className="relative h-full min-h-0 flex flex-col">
      {headOut && headSlot ? createPortal(head, headSlot) : head}
      {above && <div className="shrink-0 border-b border-borderSubtle/60 bg-panel" data-field-above>{above}</div>}
      {toolbar === 'band' && !noteSeen && (
        <div className="shrink-0 flex items-start gap-3 px-4 py-2 border-b border-borderSubtle/60 bg-silver/[0.04] text-[11px] text-textSecondary" data-map-note>
          <p className="min-w-0 flex-1 leading-relaxed">
            <span className="font-semibold text-textPrimary">First time here?</span> Each row is a strike. Ember means dealer hedging pushes a move along there, glacier means it holds one back. A strike in magenta is the supreme, green the call wall, red the put wall. Click a row to keep it on every box.
          </p>
          <button type="button" onClick={dismissNote} className="hit shrink-0 h-6 px-2 rounded-md border border-borderSubtle bg-chip font-mono text-[11px] text-textPrimary hover:border-borderMuted transition-colors" data-map-note-close>
            Got it
          </button>
        </div>
      )}
      {/* THE BOOK IS A DARK ISLAND on either theme — the calendar's capsules and the
          ladder's bars wear the heat ramp, cut for a dark ground (Noah, 2026-09-12:
          "these ladders need gray or black as the background") */}
      {/* ONE COLUMN PER NAME — the host's first, the names added beside it; all
          on the band's one set of choices, each with its own head (when there
          is more than one), its own read line and its own kept strike */}
      {/* PANES APART (Noah, 2026-09-12, on four ladders: "everything seems so
          compressed into each other… hard to distinguish where one ends and
          the other begins"): with names side by side the island turns to the
          canvas ground and every name stands as its own bordered panel with a
          gutter of ground between — the house's boxes, inside the box */}
      {/* FOUR TRACKS, ALWAYS: a name arriving is its track gliding 0fr → 1fr
          (the others narrowing to make room on the same glide), a name leaving
          is its track gliding shut with its panel fading — the grid is never
          re-laid at once. A cell clips its panel; the panel keeps a 4px margin
          inside the island's 4px padding, the 8px gutters of ground between. */}
      <div
        /* THE ISLAND IS PART OF THE PAGE ON PAPER (2026-09-22): the light theme's soft inset grey and the page's inks;
           the dark terminal keeps its black island to the digit */
        data-theme={paper ? 'light' : 'dark'}
        className={`relative flex-1 min-h-0 grid motion-reduce:transition-none ${many ? 'bg-canvas p-1' : paper ? 'bg-inset p-0' : 'bg-panel p-0'}`}
        style={{ gridTemplateColumns: tracks, maxWidth: islandMax > 0 ? islandMax : undefined, ...(carousel ? { overflowX: 'auto', scrollSnapType: 'x mandatory', overscrollBehaviorX: 'contain' } : null) }}
        ref={islandRef}
        data-field-packed={islandMax > 0 ? islandMax : undefined}
        data-field-island
        data-field-columns={1 + extraBooks.length}
      >
        {allColumns.map(c => {
          const kept = c.host ? selectedStrike : selectedStrikeFor?.(c.ticker) ?? null;
          const keep = c.host ? onSelectStrike : handlesFor(c.ticker).keep;
          /* the column's own greeks — the host's are the page's */
          const colPick = c.host ? pick : greeksOf(c.ticker);
          /* ONE GREEK PER NAME when names stand side by side (Noah, 2026-09-12) — the host's too:
             a multi pick made before a name arrived kept five greeks in a third of the band
             (2026-09-14), the widest way to empty the capsules */
          const colGreeks = same(`g:${c.ticker}`, c.host ? (many ? d.greeks.slice(0, 1) : d.greeks) : (noVex ? pickGreeks(colPick).filter(g => g !== 'vex') : pickGreeks(colPick)));
          const colGreek: Greek = c.host ? leadGreek : colGreeks[0] ?? 'gex';
          const read = readOf(c.ticker);
          /* the host's chip is the band's own, stepped down — in the own-name chip's
             clothes so the chips side by side look alike; a quote only while there
             is room for one */
          /* no quote on the chip (2026-10-14): the facts row under the head prints the price, the change, the flip and
             the dealers for every column — the chip is the name alone */
          const chip = c.host ? (
            isValidElement(lead) ? cloneElement(lead as ReactElement<{ quote?: boolean; full?: boolean }>, { quote: false, full: !tight }) : lead
          ) : (
            <ScopeChip ticker={c.ticker} quote={false} onPick={sym => renameName(c.ticker, sym)} title={`${c.ticker} in this column · pick another name for it`} />
          );
          const removeDoor = !c.host && (
            <button
              type="button"
              onClick={() => removeName(c.ticker)}
              title={`Take ${c.ticker} off`}
              className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
              data-field-remove={c.ticker}
            >
              <X className="w-3 h-3" />
            </button>
          );
          const cell = (children: ReactNode) => (
            <div
              key={c.ticker}
              className="min-w-0 min-h-0 overflow-hidden flex flex-col motion-reduce:transition-none"
              /* a leaving column fades on a layer of its own — composited, not repainted a frame (2026-10-12) */
              style={{ opacity: c.leaving ? 0 : 1, transition: `opacity ${LEAVE_MS}ms ${EASE}`, willChange: c.leaving ? 'opacity' : undefined, scrollSnapAlign: carousel ? 'start' : undefined }}
              aria-hidden={c.leaving || undefined}
              data-field-cell={c.ticker}
              data-field-leaving={c.leaving || undefined}
              data-tile-width={!c.leaving && tileW > 0 ? tileW : undefined}
            >
              <div
                className={`relative flex-1 min-h-0 flex flex-col ${paper ? 'bg-inset' : 'bg-panel'} rounded-md border overflow-hidden motion-reduce:transition-none ${many ? 'mx-1 border-borderSubtle' : 'mx-0 border-transparent'}`}
                style={{ transition: `margin ${LEAVE_MS}ms ${EASE}, border-color ${LEAVE_MS}ms ${EASE}` }}
                data-field-column={c.ticker}
                data-field-host={c.host || undefined}
              >
                {children}
              </div>
            </div>
          );
          const book = c.book;
          if (!book)
            /* COLD — the column is open, the book on its way (its chip and its × already its own) */
            return cell(
              <>
                <Fold axis="y" open={many} className="shrink-0" testId="data-field-column-fold">
                  <div className="flex items-center gap-2 px-3 h-9 border-b border-borderSubtle/60 bg-ink/[0.03] font-mono min-w-0" data-field-column-head={c.ticker}>
                    <span className="shrink-0 inline-flex items-center">{chip}</span>
                    <span className="ml-auto text-[11px] uppercase tracking-widest text-textMuted truncate">Reading the book…</span>
                    {removeDoor}
                  </div>
                </Fold>
                {/* THE COLD COLUMN STANDS IN AS ITS OWN SHAPE (Noah, 2026-10-12: the calendar's skeleton "looks like the
                    forced flow skeleton load and not the nodes look"): on the calendar, a grid of capsules the width
                    the column will have — the strike column, as many date columns as will fit the promised width, a
                    spot row in the middle; on the matrix, a bar a row as before */}
                {view === 'calendar' ? (
                  (() => {
                    const colsFit = Math.max(1, Math.min(7, columnsThatFit(Math.max(120, (tileW || 400) - 10))));
                    return (
                      <div className="flex-1 min-h-0 grid animate-pulse px-1 pb-1" aria-hidden data-field-cold={c.ticker} style={{ gridTemplateColumns: `56px repeat(${colsFit}, minmax(0, 1fr))`, gridTemplateRows: `22px 22px repeat(20, minmax(18px, 1fr)) 28px repeat(20, minmax(18px, 1fr))` }}>
                        <div className="row-span-2 px-2 flex items-end pb-1 border-b border-borderSubtle">
                          <div className="h-[9px] w-9 rounded-full bg-ink/[0.06]" />
                        </div>
                        <div className="px-2 flex items-center justify-center border-b-0" style={{ gridColumn: `span ${colsFit}` }}>
                          <div className="h-[9px] w-20 rounded-full bg-ink/[0.06]" />
                        </div>
                        {Array.from({ length: colsFit }, (_, i) => (
                          <div key={`h-${i}`} className="px-2 flex items-center justify-end border-b border-borderSubtle">
                            <div className="h-[9px] w-10 rounded-full bg-ink/[0.06]" />
                          </div>
                        ))}
                        {Array.from({ length: 41 }, (_, r) =>
                          r === 20 ? (
                            <div key="spot" className="px-1.5 flex items-center gap-1.5" style={{ gridColumn: `span ${colsFit + 1}` }}>
                              <span className="h-px flex-grow bg-gradient-to-r from-ink/[0.04] via-ink/[0.14] to-ink/[0.18]" />
                              <div className="h-[15px] w-12 rounded-[3px] bg-ink/[0.1]" />
                              <span className="h-px flex-grow bg-gradient-to-l from-ink/[0.04] via-ink/[0.14] to-ink/[0.18]" />
                            </div>
                          ) : (
                            [
                              <div key={`s-${r}`} className="pl-2 flex items-center">
                                <div className="h-[9px] w-7 rounded-full bg-ink/[0.06]" />
                              </div>,
                              ...Array.from({ length: colsFit }, (_, i) => (
                                <div key={`c-${r}-${i}`} className="px-[3px] py-[2px] flex items-center">
                                  <div className="h-full w-full rounded-full bg-ink/[0.06]" />
                                </div>
                              )),
                            ]
                          )
                        )}
                      </div>
                    );
                  })()
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col gap-[9px] px-3 py-3 animate-pulse" aria-hidden data-field-cold={c.ticker}>
                    {Array.from({ length: 40 }, (_, i) => (
                      <div key={i} className="h-[9px] rounded-full bg-ink/[0.06]" style={{ width: `${34 + 58 * (1 - Math.abs(i - 20) / 20)}%` }} />
                    ))}
                  </div>
                )}
              </>
            );
          /* the surface as drawn: its levels are the expiries the reader picked — the band's, unless this name left them */
          const namePick = (ownDates[c.ticker]?.length ? ownDates[c.ticker] : chosenDates).filter(d => !!book.snapshot.uwByDate?.[d]?.length);
          const dates = namePick.length ? namePick : chosenDates;
          const surfDrawn = scoped(book.surface, book.snapshot, dates);
          const colWindow = same(`e:${c.ticker}:${dates.join(',')}`, indicesFor(book.surface, book.snapshot, dates, colGreeks.length));
          const colShown = same(`s:${c.ticker}:${dates.join(',')}:${fitDepth}`, colWindow.slice(0, Math.max(1, fitDepth)));
          const followed = c.ticker in ownFocus ? ownFocus[c.ticker] : focusOn;
          const colFocus = followed && view === 'calendar' && !fresh;
          const iso = listedIso(book.snapshot);
          const expiryValue = ownDates[c.ticker]?.length === 1 && iso.includes(ownDates[c.ticker][0]) ? ownDates[c.ticker][0] : '';
          const sup = surfDrawn.supreme[colGreeks[0] ?? 'gex'];
          const supEx = surfDrawn.expiries[sup.e];
          return cell(
            <>
              {/* THE COLUMN'S HEAD unfolds when a second name arrives and folds
                  away with the last one taken off: the name's chip (the host's
                  follows the terminal, the others change in place), its
                  supreme, its one greek, its read's door, and × on the added */}
              <Fold axis="y" open={many} className="shrink-0" testId="data-field-column-fold">
                {/* THE × NEVER LEAVES THE PANE (the owner, 2026-10-14: "the matrix when i have two rows only i cant click X
                    cause i cant see it"): two names on the matrix packed each pane to its table, 374px, under a head that
                    needs ~505 — the read's door and the × sat past the pane's edge, clipped. The name, the supreme and the
                    greek are one group that gives way; the read and the × stand pinned at the right, and the island packs
                    the panes no narrower than their heads (headNeed below). */}
                <div className="flex items-center gap-2 px-3 h-9 border-b border-borderSubtle/60 bg-ink/[0.03] font-mono min-w-0" data-field-column-head={c.ticker}>
                  <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden" data-field-head-main>
                  <span className="shrink-0 inline-flex items-center">{chip}</span>
                  <button
                    type="button"
                    onClick={() => keep?.(sup.strike)}
                    title={`${c.ticker}'s heaviest strike on the expiries in hand, by ${GREEK_LABEL[colGreeks[0] ?? 'gex']} — most of it on ${supEx?.date ?? ''} · click to keep the strike`}
                    className="shrink-0 inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono transition-colors"
                    data-column-supreme={sup.strike}
                  >
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-supreme" />
                    <span className="text-[11px] text-textMuted">Supreme</span>
                    <span className="text-[11px] font-semibold tnum text-textPrimary whitespace-nowrap">
                      {fmtStrike(sup.strike)}
                      {!tight && (
                        <>
                          {' '}
                          <span className="text-textMuted font-normal">·</span> {fmtUsd(shownGreek(colGreeks[0] ?? 'gex', sup.total))}
                        </>
                      )}
                    </span>
                  </button>
                  {/* ONE GREEK PER NAME when names stand side by side (Noah,
                      2026-09-12: "only one should be allowed for the multiple
                      ticker choice") — a single choice, never the multi pick */}
                  {many && (
                    <span className="ml-auto shrink-0 inline-flex items-center gap-1.5">
                      <DropdownSelect<string>
                        label="Expiries"
                        value={expiryValue}
                        options={[{ value: '', label: 'With the band', hint: 'Follows the expiries on the band' }, ...iso.map(d => ({ value: d, label: shortIso(d), hint: `${c.ticker} only` }))]}
                        onChange={v => setOwnDates(prev => {
                          const next = { ...prev };
                          if (!v) delete next[c.ticker];
                          else next[c.ticker] = [v];
                          return next;
                        })}
                        title={`Which expiries ${c.ticker} reads. The band still sets every name that follows it.`}
                        testId={`ledger-expiries-${c.ticker}`}
                        align="end"
                      />
                      <button
                        type="button"
                        onClick={() => setOwnFocus(prev => ({ ...prev, [c.ticker]: !(c.ticker in prev ? prev[c.ticker] : focusOn) }))}
                        aria-pressed={followed}
                        title={`Biggest moves on ${c.ticker} only`}
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-md border transition-colors ${followed ? 'border-silver/60 bg-silver/[0.12] text-textPrimary' : 'border-borderSubtle bg-chip text-textMuted hover:text-textPrimary'}`}
                        data-column-focus={c.ticker}
                      >
                        <Crosshair className="w-3 h-3" />
                      </button>
                    </span>
                  )}
                  <span className={`${many ? '' : 'ml-auto '}shrink-0 inline-flex items-center`}>
                    <DropdownSelect<string>
                      label="Greek"
                      value={colGreeks[0] ?? 'gex'}
                      options={noVex ? SINGLE_GREEK_OPTIONS.filter(o => o.value !== 'vex') : SINGLE_GREEK_OPTIONS}
                      onChange={g => (c.host ? setPick([g]) : setGreeksOf(c.ticker, [g]))}
                      title={`What ${c.ticker}'s cells measure`}
                      testId={`ledger-greek-${c.ticker}`}
                      align="end"
                    />
                  </span>
                  </div>
                  <div className="shrink-0 flex items-center gap-2" data-field-head-doors>
                    <ReadDoor compact open={read === 'open'} onClick={() => toggleRead(c.ticker)} name={c.ticker} testId="data-column-read" />
                    {removeDoor}
                  </div>
                </div>
              </Fold>
              {/* EACH NAME'S OWN FACTS OVER ITS OWN COLUMN, one name or four (the owner, 2026-10-14: the head printed the
                  room's name alone above a book of four) — ColumnFacts.tsx */}
              {!panel && <ColumnFacts ticker={c.ticker} snapshot={levelsBook(book.snapshot, levelsScope)} scope="0DTE" width={tileW} fresh={fresh} />}
              <div className="relative flex-1 min-h-0" data-ledger-body={c.ticker}>
                {/* the arriving view fades in — opacity only, the way a box of figures is allowed to */}
                {/* the shape on screen: out on the old, in on the new (the soft swap above) */}
                <div
                  key={drawn.key}
                  className="h-full min-h-0 flex flex-col"
                  /* THE READ MAKES ROOM (the paying-user audit's M10, 2026-10-13): laid over the right of the book it hid two
                     greeks of a five-greek calendar; the book now steps left of it and re-fits — the read's own width, 460 or
                     62% of the pane, the panel's own rule (BookRead) */
                  style={{ opacity: fading ? 0 : 1, transition: `opacity ${SWAP_OUT_MS}ms ease-in`, paddingRight: read === 'open' && !tight ? 'min(460px, 62%)' : undefined }}
                  data-ledger-view={d.view}
                  data-ledger-shape={drawn.key}
                  data-ledger-fading={fading || undefined}
                >
                  {d.view === 'profile' ? (
                    <ExposureProfileView surface={surfDrawn} expiries={colShown} liveSpot={book.snapshot.spot} live={!fresh} selectedStrike={kept} onSelectStrike={keep} paper={paper} />
                  ) : d.view === 'matrix' ? (
                    <ExposureMatrix onNatural={packs ? naturalFor(c.ticker, 'matrix') : undefined} surface={surfDrawn} liveSpot={book.snapshot.spot} live={!fresh} greeks={colGreeks} expiries={colShown} rings={d.rings} hoverStrike={c.host ? hoverStrike : undefined} palette={palette} selectedStrike={kept} marks={c.host ? marks : undefined} onPointer={c.host ? onPointer : handlesFor(c.ticker).point} onSelectStrike={keep} lead={c.host ? leadGreek : undefined} legs={d.legs} />
                  ) : (
                    <ExposureLedger wantCols={colGreeks.length * colWindow.length} onNatural={packs ? naturalFor(c.ticker, 'calendar') : undefined} surface={surfDrawn} liveSpot={book.snapshot.spot} live={!fresh} open={view === 'calendar' && !fresh ? openSurfaceOf(book.ticker) : null} focusOn={colFocus} greeks={colGreeks} expiries={colWindow} rings={d.rings} leg={d.legs === 'both' || d.legs === 'all' ? 'net' : d.legs} hoverStrike={c.host ? hoverStrike : undefined} palette={palette} afterBell={d.afterBell} selectedStrike={kept} marks={c.host ? marks : undefined} onPointer={c.host ? onPointer : handlesFor(c.ticker).point} onSelectStrike={keep} onExpiry={(many || onExpiries) ? i => { const date = listedIso(book.snapshot)[i]; if (many && date) { setOwnDates(prev => ({ ...prev, [c.ticker]: [date] })); return; } setOwnDates({}); setRange({ from: i, through: i }); } : undefined} fitKey={c.ticker} onFit={reportFit} paper={paper} />
                  )}
                </div>
                {/* THE READ — this name's, glass over the right of its own book
                    (the whole column when names are tight), in its lead greek */}
                {read && (
                  <BookRead
                    surface={surfDrawn}
                    snapshot={book.snapshot}
                    greek={colGreek}
                    mode={palette === 'thermal' ? 'thermal-yellow' : HEAT_MODE}
                    expiries={colShown}
                    afterBell={d.afterBell}
                    rings={d.rings as StrikeWindow}
                    selectedStrike={kept}
                    fill={tight}
                    closing={read === 'closing'}
                    subscribePointed={c.host ? subscribePointed : subscribeFor(c.ticker)}
                    onKeep={keep}
                    onClose={() => closeRead(c.ticker)}
                  />
                )}
              </div>
            </>
          );
        })}
      </div>
      {/* THE LEGEND (the owner, 2026-10-14: "the colours aren't explained"): one line under the grid saying what the two
          sides and the three strike inks mean — the capsules' own ramp, so the swatches match the board */}
      {toolbar === 'band' && view !== 'profile' && (
        <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-0.5 px-3 py-1 border-t border-borderSubtle/60 bg-panel font-mono text-[11px] text-textMuted" data-ledger-legend>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-[3px] w-4 rounded-full" style={{ background: palette === 'thermal' ? THERMAL_WARM : AMPLIFY }} />
            pushes a move along
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-[3px] w-4 rounded-full" style={{ background: palette === 'thermal' ? THERMAL_COOL : ABSORB }} />
            holds one back
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-supreme" />
            supreme
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bull" />
            call wall
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bear" />
            put wall
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-[3px] w-4 rounded-full bg-silver" />
            kept
          </span>
          {/* WHICH CONTRACTS, SAID (the ship pass, 2026-10-22): the figures are the Expiries card's dates summed; the
              supreme and the walls marked on them are the Levels card's — the Board's — so the two can differ */}
          {chosenDates.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-textMuted/80" title="The dollar figures add up the dates on the Expiries card. The supreme, call wall and put wall marked on them come from the Levels card at the top of the page — the same levels the Board, the Agenda and Compare show." data-legend-scope>
              figures: {expirySpan(chosenDates)} · levels: {levelsLabel}
            </span>
          )}
          {/* the calendar's pills, named (2026-10-14 — a bare "−96%" on a cell said neither what fell nor since when) */}
          {view === 'calendar' && (
            <span className="inline-flex items-center gap-1.5" data-legend-since>
              <span aria-hidden className="inline-flex items-center rounded-full border border-borderSubtle px-0.5">
                <SinceBadge text="−96%" dir={-1} />
              </span>
              change since the open, on the ten biggest moves
            </span>
          )}
        </div>
      )}
      {/* THE GUIDE IN FOCUS — over the whole page, the way the clock's and the report's are (2026-10-14: inside the matrix's
          own pane the card was cut to ~330px and its 400px drawings clipped mid-word — "it looks broken in the one place
          that's meant to teach") */}
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title={guideTitle(view)} testId="ledger-guide" viewport>
        <LedgerGuide surface={scoped(surface, snapshot)} greek={supremeGreek} view={view} mode={palette === 'thermal' ? 'thermal-yellow' : undefined} paper={paper} />
      </GuideFocus>
      {/* WHERE THIS BOOK COMES FROM — the source, the freshness, the formula, the sign, the levels (BookProvenance.tsx) */}
      <GuideFocus open={dataOpen} onClose={() => setDataOpen(false)} title="Where this book comes from" testId="ledger-data" width={480}>
        <DataCard ticker={surface.ticker} surface={scoped(surface, snapshot)} greeks={greeks} expiries={shownIdx} rings={rings} view={view} />
      </GuideFocus>
    </div>
  );

  /* THE SAME BOX, MOVED (the ruler's own, Compare.tsx): one box wears the page's shape or the viewport's — the head, the
     grid and the ladder never remount. No layout animation since 2026-10-14 (the owner: no motion between states): a
     layout box painted one frame at its old size whenever the book's width changed, a name added among them */
  if (fullMode === 'move') {
    return (
      <div
        /* THE GROUND IS THE PAGE'S when full (Noah, 2026-09-10: "the background
           becomes more ashy/gray when we full screen the ladder") — the box's
           panel grey over a whole screen read as a wash; the canvas black is
           what every other takeover stands on */
        className={full ? 'fixed inset-0 z-[80] bg-canvas flex flex-col' : 'relative h-full min-h-0 flex flex-col'}
        data-ledger-full={full || undefined}
      >
        <div className="flex-1 min-h-0 overflow-hidden">{body}</div>
      </div>
    );
  }

  // Portal, not a plain fixed div: a transformed ancestor (the Pulse grid's
  // tiles) would become the containing block for position:fixed. Snug to
  // the edges — no frame, no padding.
  return full
    ? createPortal(
        <div
          className={`fixed inset-0 z-[80] bg-panel flex flex-col animate-takeover-in transition-opacity duration-[400ms] ease-in-out ${
            closing ? 'opacity-0' : ''
          }`}
          data-ledger-full
        >
          <div className="flex-1 min-h-0 overflow-hidden">{body}</div>
        </div>,
        document.body
      )
    : body;
};

export { GREEKS };
export default ExposureField;
