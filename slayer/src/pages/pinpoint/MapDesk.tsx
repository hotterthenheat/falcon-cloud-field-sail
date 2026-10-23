/*
==================================================
  SLAYER TERMINAL - THE MAP
  (pages/pinpoint/MapDesk.tsx)

  The book by expiry, FIRST (Noah, 2026-09-12:
  "remove this entire section from the pinpoint
  map page. the first thing that should be shown
  is the heatmap and this is already shown in
  multiple pages like the terrain and pulse
  pages"). The day-on-one-chart box that opened
  this page since band 2 (the tape with the dealer
  levels drawn on it, the strike rail fused to its
  price axis as one profile panel, its own head,
  fullscreen, drawing rail and replay pick) is
  GONE — Terrain and Pulse carry that chart. What
  is left is the read, top to bottom: the Exposure
  Ledger (the same book by expiry, as a heatmap or
  a ladder), the Trader's Clock, the Wall Report
  Card, your positions. One strike shared across
  them (FocusContext); each box can step onto its
  own name; the replay runs the boxes on a minute
  grid from the calendar's own strip.

  NOTHING HERE IS NEW MACHINERY. The book is
  `buildExposureProfile` — the same one the Strike
  Pressure Ladder widget reads — under the calendar's
  expiries, greek and window. The Calendar (the
  Exposure Ledger) is band 3 of the blank canvas.

  THE PARTNER'S MAP, TAKEN WHOLE (Noah, 2026-10-14,
  with three pictures of newslyer's Map: "i want all
  of these things in my map section but fixing up
  any bugs he has … we will add all of it and
  more"): the band in its own strip (or in the head
  when the head has the room), the book packed to
  its panes with THE DAY beside it — the tape with
  the levels on it over the book's net gamma through
  the session, on one clock (DayBox) — the trader's
  clock and the levels report in one mono grammar,
  every column carrying its own facts, the profile
  as the book's third view, Legs, More (where the
  book comes from, two exports), the Levels scope,
  the replay as a bar across the book that the head
  names, the kept strike typed with `/`, jump links
  on a phone, every box folding. His feed and house
  market seam (bookMarket, useRoomScan) is OUR scan
  and the simulator here (pages/pinpoint/
  useRoomSpot.ts for the one price), and the boxes
  fade in as the house's do — his "no motion" rule
  stays his.
==================================================
*/

import FilterTabs from '../../components/ui/FilterTabs';
import { FLAT_DOOR, FLAT_ON } from '../../components/ui/flatDoor';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { snapshotOf, useBookRev, usePinpointFeed } from '../../data/uwBook';
import { useFocus } from '../../context/FocusContext';
import ScopeChip from '../../components/ui/ScopeChip';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { Deferred } from '../../components/ui/Skeleton';
import { CalendarInner, DayInner, MapPageSkeleton, ReportInner } from './pinpointSkeletons';
import { BookOrSkeleton } from './BookDown';
import ExposureField from '../../components/gex/ExposureField';
import TraderClock from '../../components/gex/TraderClock';
import WallReportCard from '../../components/gex/WallReportCard';
import TapeBox from '../../components/gex/TapeBox';
import BookThroughDay from '../../components/gex/BookThroughDay';
import DayBox from '../../components/gex/DayBox';
import ReplayStrip from '../../components/gex/ReplayStrip';
import { MapReadings } from '../../components/vendor/LiveDesk';
import { posAtMinute, replayDay, replayLabel, replayMinute, replayRange, replaySections, replayStart, sectionBarsAt, snapPos, snapshotAt, type ReplayRange } from '../../data/replay';
import { readSessionClock } from '../../data/moc';
import { setReplayLabel } from './replayState';
import { readPosition, usePositions } from '../../data/positions';
import { buildExposureProfile, type StrikeWindow } from '../../data/exposure';
import { levelsBook, levelsDate, levelsWords, sessionBook } from '../../data/bookWindow';
import { useLevelsScope } from '../../data/levelsScope';
import type { ExposureExpiry } from '../../types/gex';
import type { Candle, MarketSnapshot } from '../../types/market';
import { useOnScreen } from '../../components/ui/useOnScreen';

/** The book sweeps on its own cadence — the boxes must not vibrate with every tick. */
const SCAN_INTERVAL_MS = 10_000;
/* THE WINDOW IS THE WHOLE BOOK (Noah, 2026-09-05): thirty strikes each side are
   built once; the boxes draw whatever of them they need. */
const WINDOW: StrikeWindow = 30;
/** Your positions read against the 0DTE book — the same book the ladder tile draws */
const POSITIONS_EXPIRY: ExposureExpiry = '0DTE';
/* THE DAY SPLITS WITH THE BOOK (Noah, 2026-10-14, with the picture of two panes and a line down the day box: "if we have
   multiple views then the day and the book should be divided like the image showed for 2 views, 4 different
   views/tickers should show a 4 way and i think you can figure something out for the 3 way"): with names side by side
   the day row is one box a name under its pane — two, three or four equal columns, the panes' own tracks, so each
   name's tape and book stand under its figures; stacked on a phone. Literal classes, so Tailwind sees them. */
const DAY_COLS: Record<number, string> = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };

/** A day box's name when the day is split: the mark and the name, the chip's own clothes without its menu — the pane
    above owns the pick */
const NameMark = ({ t }: { t: string }) => (
  <span className="inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-md border border-borderSubtle bg-chip font-mono select-none" data-day-name={t}>
    <CompanyLogo ticker={t} size={14} />
    <span className="text-[12px] font-semibold text-textPrimary leading-none">{t}</span>
  </span>
);

/*
  EACH BOX CAN HOLD ITS OWN NAME (Noah, 2026-09-06: "i should be able to change
  tickers on each singular section as i please … they should all start off as
  one"). The scoping rule, box by box: a box FOLLOWS the frame's name until its
  chip unlinks it, then it reads its own snapshot (the simulator's pure read,
  refreshed on the scan cadence) and its chip wears the name. Held across route
  changes within a session and reset on reload, so every visit starts as one.
*/
type BoxKey = 'calendar' | 'tape' | 'day' | 'report';
type Scopes = Partial<Record<BoxKey, string>>;
let scopesMemory: Scopes = {};

/** THE FOUR BOXES AS A PILL RAIL on a phone: the holo pill sits on the box in view (an IntersectionObserver reads which of
    the four stands highest on the screen), and a tap scrolls to any other — the rail Terrain's panel tabs and the journal
    wear, never four bare buttons of their own */
const MAP_JUMPS = [
  { value: 'map-book', label: 'Book' },
  { value: 'map-session', label: 'The day' },
  { value: 'map-clock', label: 'Clock' },
  { value: 'map-report', label: 'Report' },
] as const;
type MapJump = (typeof MAP_JUMPS)[number]['value'];
const MapJumps = () => {
  const [at, setAt] = useState<MapJump>('map-book');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, number>();
    const obs = new IntersectionObserver(
      entries => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        let best: MapJump = 'map-book';
        let ratio = -1;
        for (const j of MAP_JUMPS) {
          const r = seen.get(j.value) ?? 0;
          if (r > ratio) {
            ratio = r;
            best = j.value;
          }
        }
        setAt(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    for (const j of MAP_JUMPS) {
      const el = document.getElementById(j.value);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);
  return (
    <nav className="sm:hidden sticky top-9 z-20 -mx-4 px-4 py-1.5 border-b border-borderSubtle/60 bg-panel/95 backdrop-blur-sm" aria-label="Jump to a box" data-map-jumps={at}>
      <FilterTabs
        options={MAP_JUMPS}
        value={at}
        onChange={id => {
          setAt(id);
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        ariaLabel="Jump to a box"
      />
    </nav>
  );
};

const MapDesk = () => {
  const { activeTicker, changeTicker } = useTicker();
  const marketData = usePinpointFeed(activeTicker);
  const bookRev = useBookRev();
  const { focus, toggleFocus, focusOn } = useFocus();
  const levelsScope = useLevelsScope();

  /* TYPE A STRIKE TO KEEP IT (idea 8, 2026-10-13): `/` opens a small prompt; Enter keeps the nearest strike the chain
     has, everywhere on the page; Esc closes. Caught before the command line, which `/` opens on pages with no search. */
  const [strikeAsk, setStrikeAsk] = useState(false);
  const strikeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (document.querySelector('[role="dialog"], [data-guide-layer], [data-strike-ask]')) return;
      e.preventDefault();
      e.stopPropagation();
      setStrikeAsk(true);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  /* Which boxes have stepped off the frame, and onto which name */
  const [scopes, setScopesState] = useState<Scopes>(scopesMemory);
  const setScope = (key: BoxKey, t: string | undefined) =>
    setScopesState(prev => {
      const next = { ...prev };
      if (t === undefined) delete next[key];
      else next[key] = t;
      scopesMemory = next;
      return next;
    });

  /* ONE LENS PER PAGE (Noah, 2026-09-08, "do the sync"): the calendar's Greek is
     the page's — the calendar's "All" is the five greeks side by side.
     THE MAP OPENS ON ALL FIVE (Noah, 2026-09-21: "the initial render of the
     pinpoint map page should be the 5 box setup always") — the ladder with a
     pane a greek, the net bar in each; the pick is the page's for the visit,
     never stored, so every visit opens the same way. */
  /* GEX ALONE BY REST (the owner, 2026-10-14, after a walk through the page as a retail user: five greeks by forty
     strikes was two hundred figures before the price chart, a thousand pixels down). One greek, so the book packs to
     its one column and the day stands beside it on a desk; the band's Greek card opens the rest. */
  const [greekPick, setGreekPick] = useState<string[]>(['gex']);

  /* REPLAY (2026-09-08): one position on today's session — seconds from the
     open — and every box reads the book as it stood then (data/replay.ts).
     The strip on the calendar's band is the transport; it starts from the open
     (the chart whose bar picked the minute is gone from this page). Esc, a
     name change, or "Back to live" ends it. Boxes pinned to another name stay
     live. */
  const [replay, setReplay] = useState<{ phase: 'play'; range: ReplayRange; pos: number; playing: boolean; pace: number } | null>(null);
  const replayOn = replay != null;
  const playing = replay;

  /* Scan-tier snapshot: the book sweeps every SCAN_INTERVAL_MS (a name change is immediate) — the one snapshot every
     box on the page reads */
  const [scan, setScan] = useState<MarketSnapshot | null>(null);
  const scanRef = useRef<MarketSnapshot | null>(null);
  const scanAtRef = useRef(0);
  useEffect(() => {
    if (!marketData) return;
    const now = Date.now();
    /* the full book (every expiry's own chain) lands a few seconds after the board read — inside the sweep's window,
       so it was dropped and the page sat on the whole-book-only read until the next refresh (the UI sweep, 2026-10-22:
       the Map crowned the whole book's supreme while the other pages read today's) — a book that changes SHAPE is taken
       at once */
    const shape = (s: MarketSnapshot | null) => Object.keys(s?.uwChains ?? {}).length;
    /* a book whose dates or contract facts landed (a new uwByDate — uwBook never edits a chain in place) is taken at once */
    const due = !scanRef.current || now - scanAtRef.current >= SCAN_INTERVAL_MS || scanRef.current.ticker !== marketData.ticker || shape(scanRef.current) !== shape(marketData) || scanRef.current.uwByDate !== marketData.uwByDate;
    if (due) {
      scanRef.current = marketData;
      scanAtRef.current = now;
      setScan(marketData);
    }
  }, [marketData]);

  /* THE OWN-NAME SNAPSHOTS — one per name a box has stepped onto, rebuilt on
     the scan cadence like the frame's own. A pure read of the simulator. */
  const pinnedKey = [scopes.calendar, scopes.tape, scopes.day, scopes.report].filter(Boolean).join('|');
  const ownSnaps = useMemo(() => {
    const m = new Map<string, MarketSnapshot>();
    if (!scan || !pinnedKey) return m;
    for (const t of new Set(pinnedKey.split('|'))) {
      if (t === scan.ticker) continue;
      try {
        const live = snapshotOf(t, 'full');
        if (live) m.set(t, live);
      } catch {
        /* a name the sim can't build — the box stays on the frame's */
      }
    }
    return m;
  }, [scan, pinnedKey, bookRev]);

  /* The session on hand for the replay, and the book at the position — THE
     MINUTE GRID (2026-09-11): the calendar, the clock and the report read the
     book once per replayed minute; their surfaces are the page's heaviest. */
  const range = playing?.range ?? null;
  const framePos = playing && range ? snapPos(playing.pos, range.length) : 0;
  /* the boxes follow the track a beat behind (the audit's H7: a drag step took 110–190ms to paint) — the track and its
     moment stay on the pointer */
  const minutePos = useDeferredValue(Math.floor(framePos / 60) * 60);
  const replayBars = useMemo(() => (range ? sectionBarsAt(range, minutePos) : undefined), [range, minutePos]);
  /* ONE PRICE IN THE REPLAY TOO (2026-10-14): the minute's book carries the price it was figured at — the bar's open —
     while the tape's Last is that minute's close; the book is handed the close, so the spot row and the tape agree */
  const replaySnapMinute = useMemo(() => {
    if (!range || !scan) return null;
    const snap = snapshotAt(scan, range, minutePos);
    const close = replayBars?.[replayBars.length - 1]?.close;
    return snap && close != null && Number.isFinite(close) && close !== snap.spot ? { ...snap, spot: close } : snap;
  }, [range, scan, minutePos, replayBars]);
  useEffect(() => {
    if (!playing?.playing || !range) return;
    const id = window.setInterval(() => {
      setReplay(r => {
        if (!r || !r.playing) return r;
        const next = r.pos + r.pace * 0.25;
        return next >= range.length ? { ...r, pos: range.length, playing: false } : { ...r, pos: next };
      });
    }, 250);
    return () => window.clearInterval(id);
  }, [playing?.playing, playing?.pace, range]);
  useEffect(() => {
    if (!replayOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setReplay(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [replayOn]);
  /* A replay was recorded in one name's world — a new name ends it */
  useEffect(() => setReplay(null), [scan?.ticker]);
  /* THE SHELL HEAD SAYS IT TOO (the audit's M8, 2026-10-13): the moment replayed, as a tag beside the page's name */
  const replayWords = playing && range ? `${replayDay(range)} · ${replayLabel(framePos, range)}` : null;
  useEffect(() => {
    setReplayLabel(replayWords);
    return () => setReplayLabel(null);
  }, [replayWords]);
  /* outside the session the door replays the LAST session, and says so (the audit's L4) */
  const marketOpen = (() => {
    const c = readSessionClock();
    return c.phase === 'OPEN' || c.phase === 'AUCTION';
  })();
  /* Replay opens at the session's first bar, PLAYING (the paying-user audit's H7: it opened paused and looked dead) */
  const startReplay = () => {
    if (!scan) return;
    const r = replayRange(scan.ticker);
    if (!r) return;
    setReplay({ phase: 'play', range: r, pos: 0, playing: true, pace: 60 });
  };
  /** THE TRANSPORT (the paying-user audit's C3 and H7, 2026-10-13): a bar of its own across the top of the book — in the band
      it widened the band and the page under it jumped 34px, and its track was 180px for a whole session. Its clock is the
      session's own (the first bar's minute), the one the head's tag and the trader's clock read. */
  const replayTransport = replay ? (
    <ReplayStrip
      compact
      wide
      phase={replay.phase}
      pos={playing?.pos ?? 0}
      length={playing?.range.length ?? 0}
      day={playing ? replayDay(playing.range) : undefined}
      startMin={playing ? replayStart(playing.range) : undefined}
      sections={playing ? replaySections(playing.range).map(s => ({ u0: playing.range.length ? s.start / playing.range.length : 0, u1: playing.range.length ? s.end / playing.range.length : 1, label: s.label })) : undefined}
      playing={playing?.playing ?? false}
      onPlay={p => setReplay(r => (r ? { ...r, playing: p } : r))}
      pace={playing?.pace ?? 60}
      onPace={pace => setReplay(r => (r ? { ...r, pace } : r))}
      onSeek={pos => setReplay(r => (r ? { ...r, pos } : r))}
      onExit={() => setReplay(null)}
    />
  ) : undefined;
  /** The band's door: Replay, or — while one runs — the way back, pressed */
  const replayBar = (
    <button
      type="button"
      onClick={replay ? () => setReplay(null) : startReplay}
      aria-pressed={!!replay}
      title={replay ? 'Back to live (Esc)' : 'Replay the day from its first print — premarket, the cash session, after hours — and the track marks each one'}
      /* sentence case, the cards' grammar since 2026-10-10 (the audit's M3) */
      className={`${FLAT_DOOR} ${replay ? FLAT_ON : ''}`}
      data-map-replay
    >
      <Play className="w-3 h-3" /> {replay ? 'Replaying' : 'Replay'}
    </button>
  );

  /* THE NAMES BESIDE THE CALENDAR'S REWIND WITH IT (2026-09-13): a column's
     book is its name's own session at the replayed minute — a name with no
     session on hand stays live */
  const columnSnap = useCallback(
    (t: string): MarketSnapshot | null => {
      const live = snapshotOf(t, 'full');
      if (!live) return null;
      if (!range) return live;
      const own = replayRange(t);
      /* at the host's MINUTE (replay.ts posAtMinute) — the name's own session may start later than the host's */
      return own ? snapshotAt(live, own, posAtMinute(own, replayMinute(minutePos, range))) : live;
    },
    [range, minutePos, bookRev]
  );
  /* THE NAMES THE BOOK HOLDS, host first (ExposureField onNames): more than one, and the day splits into a box a name */
  const [bookNames, setBookNames] = useState<string[]>([]);
  /* the Expiries card's dates — the clock, the report and the tape read this window, not a book of their own */
  const [bookDates, setBookDates] = useState<string[] | null>(null);
  const [nameDates, setNameDates] = useState<Record<string, string[]>>({});
  const dayNames = bookNames.length > 1 ? bookNames : null;
  /* the other names' bars at the replayed minute — each name's own session, as its column reads it (columnSnap) */
  const extraBars = useMemo(() => {
    const m = new Map<string, Candle[] | undefined>();
    if (!replayOn || !dayNames) return m;
    const atMin = replayMinute(minutePos, range);
    for (const t of dayNames.slice(1)) {
      const own = replayRange(t);
      m.set(t, own ? sectionBarsAt(own, posAtMinute(own, atMin)) : undefined);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayOn, dayNames, minutePos, range]);
  /** The snapshot a box reads: the frame's (rewound to the minute while replaying), or its own */
  const snapFor = (key: BoxKey): MarketSnapshot | null => {
    if (!scan) return null;
    const t = scopes[key];
    if (!t || t === scan.ticker) return replaySnapMinute ?? scan;
    return ownSnaps.get(t) ?? scan;
  };
  /* A BOX NOBODY SEES HOLDS STILL while the replay runs (2026-09-11): off
     screen, a box keeps the moment it last showed; scrolled into view, it
     catches up on its next render. What it reads arrives DEFERRED. */
  const [calRef, calOn] = useOnScreen<HTMLDivElement>();
  /* THE BOOK AT ITS NATURAL WIDTH WHEN THE DAY STANDS BESIDE IT (2026-10-13, the owner: "compact and tight grouped",
     then "i dont want any deadspace"): the field says how wide its panes are at their natural widths; where the day box
     fits beside that (640 or more), the book is that wide and the day takes the rest; where it does not, the book takes
     the whole row, its panes fill it, and the day goes under — 0 = unmeasured, or the profile */
  const [bookW, setBookW] = useState(0);
  /* THE BAND'S OWN STRIP (2026-10-13): the field draws its band here, above the book and the day, so the book box is only
     as wide as its panes; its height is taken off the book box's, so the two together keep the first screen's height */
  const [bandSlot, setBandSlot] = useState<HTMLDivElement | null>(null);
  const [bandSlotH, setBandSlotH] = useState(0);
  /* THE BAND IN THE HEAD WHERE THE HEAD HAS ITS ROOM (2026-10-13, "i dont want any deadspace"): the head's side (the facts,
     the room between, the Levels and Ruler cards) measured against the band's named row; in, with 12px to spare, and out
     only once it no longer fits, so a fact's width ticking by a figure never throws it back and forth */
  const [bandNeed, setBandNeed] = useState(0);
  const [headBand, setHeadBand] = useState<HTMLElement | null>(null);
  const [headRoom, setHeadRoom] = useState(0);
  useLayoutEffect(() => {
    const slot = document.getElementById('pinpoint-head-band');
    const side = slot?.closest('[data-shell-side]') as HTMLElement | null;
    if (!slot || !side) return;
    setHeadBand(slot);
    const read = () => {
      const facts = side.querySelector<HTMLElement>('[data-shell-facts]')?.offsetWidth ?? 0;
      const cards = side.querySelector<HTMLElement>('[data-shell-cards]')?.offsetWidth ?? 0;
      const room = Math.floor(side.clientWidth - facts - cards - 48);
      setHeadRoom(prev => (Math.abs(prev - room) < 2 ? prev : room));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(side);
    return () => ro.disconnect();
  }, []);
  const [bandUp, setBandUp] = useState(false);
  useEffect(() => {
    if (bandNeed <= 0 || headRoom <= 0) return;
    setBandUp(up => (up ? headRoom >= bandNeed : headRoom >= bandNeed + 12));
  }, [bandNeed, headRoom]);
  /* the top row's width, to know whether the day box stands beside the book (the same rule the row's wrap follows: the
     book at its width, 16px, and 640 for the day) — beside, it takes the book box's height exactly and its two charts
     share it; under the book it keeps its own */
  const [topRow, setTopRow] = useState<HTMLDivElement | null>(null);
  const [topRowW, setTopRowW] = useState(0);
  useLayoutEffect(() => {
    if (!topRow) return;
    const read = () => setTopRowW(prev => (prev === topRow.clientWidth ? prev : topRow.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(topRow);
    return () => ro.disconnect();
  }, [topRow]);
  useLayoutEffect(() => {
    if (!bandSlot) return;
    const read = () => setBandSlotH(prev => (prev === bandSlot.offsetHeight ? prev : bandSlot.offsetHeight));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(bandSlot);
    return () => ro.disconnect();
  }, [bandSlot]);
  const [tapeRef, tapeOn] = useOnScreen<HTMLDivElement>();
  const [dayRef, dayOn] = useOnScreen<HTMLDivElement>();
  const [reportRef, reportOn] = useOnScreen<HTMLDivElement>();
  const heldRef = useRef<{ calendar: MarketSnapshot | null; tape: MarketSnapshot | null; day: MarketSnapshot | null; report: MarketSnapshot | null; bars: Candle[] | undefined }>({ calendar: null, tape: null, day: null, report: null, bars: undefined });
  const shown = (key: BoxKey, on: boolean): MarketSnapshot | null => {
    const fresh = snapFor(key);
    if (!replayOn || on || !heldRef.current[key]) heldRef.current[key] = fresh;
    return heldRef.current[key];
  };
  const calSnap = useDeferredValue(shown('calendar', calOn));
  const tapeSnap = useDeferredValue(shown('tape', tapeOn));
  const daySnap = useDeferredValue(shown('day', dayOn));
  const reportSnap = useDeferredValue(shown('report', reportOn));
  /* the bars move while ANY box that reads them is on the screen — the tape and the day box read them too, and gated on
     the report alone the tape stood still through a replay on a laptop screen, where the report sits below the fold
     (2026-10-14) */
  if (!replayOn || reportOn || tapeOn || dayOn || !heldRef.current.bars) heldRef.current.bars = replayBars;
  const reportBars = useDeferredValue(heldRef.current.bars);
  /** The shared strike belongs to ONE name — a box on another name never draws it */
  const focusFor = (t: string) => (focus && focus.ticker === t ? focus.price : null);
  /** A box's chip: follows the frame, or holds its own name */
  const chipFor = (key: BoxKey, t: string) => (
    <ScopeChip
      ticker={t}
      linked={scopes[key] === undefined}
      quote
      onToggleLink={() => setScope(key, scopes[key] === undefined ? t : undefined)}
      onPick={next => (scopes[key] === undefined ? changeTicker(next) : setScope(key, next))}
    />
  );

  /* THE BOOK the positions read against — the frame's, at the replayed minute */
  const frameSnap = replaySnapMinute ?? scan;
  const data = useMemo(() => {
    if (!frameSnap) return null;
    try {
      return buildExposureProfile(frameSnap, POSITIONS_EXPIRY, WINDOW);
    } catch {
      return null;
    }
  }, [frameSnap]);

  const ticker = frameSnap?.ticker ?? activeTicker;
  const focusPrice = focusFor(ticker);
  const calTicker = calSnap?.ticker ?? ticker;
  const tapeTicker = tapeSnap?.ticker ?? ticker;
  const dayTicker = daySnap?.ticker ?? ticker;
  const reportTicker = reportSnap?.ticker ?? ticker;

  /* YOUR POSITIONS on this name (roadmap step 6): read against the 0DTE book,
     once per scan; the ledger's marks and the box read the same map */
  const positions = usePositions(ticker);
  const reads = useMemo(() => new Map(data ? positions.map(p => [p.id, readPosition(p, data)]) : []), [positions, data]);
  const marks = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of positions) {
      const s = reads.get(p.id)?.sentence ?? '';
      m.set(p.strike, m.has(p.strike) ? `${m.get(p.strike)}\n${s}` : s);
    }
    return m;
  }, [positions, reads]);

  /* The page stands in as its own four boxes while the first read walks in
     (Noah, 2026-09-08: a stock skeleton "doesn't take the shape of its
     container") — the same shapes the route's fallback and the deferred
     mounts use, so nothing on the page moves when the book lands. */
  if (!scan || !data) return <BookOrSkeleton tickers={[ticker]}><MapPageSkeleton /></BookOrSkeleton>;

  const keepTyped = (raw: string) => {
    const want = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
    setStrikeAsk(false);
    if (!Number.isFinite(want) || !scan.chain.length) return;
    let best = scan.chain[0].strike;
    for (const n of scan.chain) if (Math.abs(n.strike - want) < Math.abs(best - want)) best = n.strike;
    focusOn(best, ticker);
  };

  const bookH = `calc(clamp(640px, 100dvh - 190px, 1000px) - ${bandSlotH > 0 ? bandSlotH + 8 : 0}px)`;
  /* The book stays the width of its panes. It used to stretch to the row whenever the day chart could not sit beside
     it (under ~1,070px of page), which is the old wide map. The day sits beside from 420px of room; under that it
     wraps, and the book does not grow to fill the gap. */
  const DAY_MIN = 420;
  const split = dayNames != null;
  const bookFits = bookW > 0 && (topRowW <= 0 || bookW <= topRowW);
  const bookStyleW = bookW > 0 ? (bookFits ? bookW : topRowW || bookW) : undefined;
  const dayBeside = !split && !!bookStyleW && topRowW > 0 && topRowW - bookStyleW - 16 >= DAY_MIN;
  const datesFor = (t: string): string[] | null => (nameDates[t]?.length ? nameDates[t] : bookDates);
  /* THE LEVELS ARE THE LEVELS CARD'S, NOT THE MATRIX'S WINDOW (the ship pass, 2026-10-22): the tape's lines, the clock,
     the report and the hedging path read their supreme, walls, flip and net off the Levels card's contracts — the same
     book the Board, the Agenda and Compare read — while the matrix above may show more dates. */
  const lv = (snap: MarketSnapshot): MarketSnapshot => levelsBook(snap, levelsScope);
  const lvDates = (snap: MarketSnapshot): string[] | null => {
    const d = levelsDate(snap, levelsScope);
    return d ? [d] : null;
  };
  const lvWords = (snap: MarketSnapshot): string => levelsWords(snap, levelsScope);

  return (
    <>
      {strikeAsk && (
        <div className="fixed inset-x-0 top-16 z-[95] flex justify-center pointer-events-none" data-strike-ask>
          <form
            className="pointer-events-auto flex items-center gap-3 rounded-md border border-silver/40 bg-card/95 backdrop-blur-md px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
            onSubmit={e => {
              e.preventDefault();
              keepTyped(strikeInput.current?.value ?? '');
            }}
          >
            <label htmlFor="strike-ask" className="text-[11px] text-textMuted">
              Keep a strike
            </label>
            <input
              id="strike-ask"
              ref={strikeInput}
              autoFocus
              inputMode="decimal"
              placeholder={scan.spot.toFixed(0)}
              className="w-20 bg-transparent font-mono text-[12px] tnum text-textPrimary outline-none border-b border-borderMuted focus:border-silver placeholder:text-textMuted/60"
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setStrikeAsk(false);
                }
              }}
              onBlur={() => setStrikeAsk(false)}
            />
            <span className="text-[11px] text-textMuted">Enter keeps it · Esc</span>
          </form>
        </div>
      )}
      {/* JUMP LINKS ON A PHONE (idea 7, 2026-10-13): the page is 3,000px tall there; a sticky row under the phone strip
          lands on any box in one tap — ON THE HOUSE PILL RAIL since 2026-10-19 (Noah, a phone still of four bare outlined
          buttons: the same disease as the control piles), the pill on the box in view */}
      <MapJumps />
      {/* THE CALENDAR, FIRST — the same book by expiry, the Exposure Ledger with
          its one-row toolbar (greek · expiries · strikes · palette · Now | After
          the bell · the read · fullscreen) and the replay's transport. The host
          names the book, so the ledger's head carries no name or search. The
          strike a capsule pins is the same shared strike every box lights. */}
      {/* 870px = the whole default window (±20 strikes at the ledger's 18px
          floor) with the toolbar and the read line, no scrolling — the lock
          walk's first fix (Noah, 2026-09-09: "the heatmap length is a bit
          short so make it taller"; at 600 only 25 of the 40 rows showed) */}
      {/* …AND NEVER PAST THE FOLD (the audit's M9, 2026-10-13): on a 900px screen the fixed box ran 62px under the fold
          and the matrix inside it scrolled in a box that was itself cut — two scroll regions nested. The box is the
          first screen's (the shell's chrome above it is ~174px, 16 of air under), never under 640 — and 1000 at most
          since 2026-10-13 (the owner's tall screen: forty rows of the matrix at 20px need ~900 to stand unscrolled). */}
      {/* THE BOOK AND THE DAY SIDE BY SIDE WHERE THEY FIT (2026-10-13, the dead-space scan: three packed matrix panes on a
          3,000px screen left 1,300px of the box empty): the book box at its natural width, the day box taking the rest
          from 640px up and stretched to the book's height, its two charts sharing the extra; where the day box would
          be under 640 it wraps under the book at the page's full width, as before. */}
      <div id="map-book" className="flex flex-col gap-2 max-sm:scroll-mt-24 sm:scroll-mt-12" data-map-book-wrap>
      <div ref={setBandSlot} className={`empty:hidden border border-borderSubtle rounded-md bg-panel overflow-hidden [&>[data-ledger-toolbar]]:border-b-0`} data-map-band-slot />
      <div ref={setTopRow} className="flex flex-wrap items-stretch gap-4" data-map-top-row data-day-beside={dayBeside || undefined} data-band-need={bandNeed || undefined} data-head-room={headRoom || undefined} data-band-up={bandUp || undefined}>
      <div ref={calRef} className={`shrink-0 grow-0 max-w-full border border-borderSubtle rounded-md overflow-hidden flex flex-col`} style={{ width: split || !dayBeside ? '100%' : (bookStyleW ?? '100%'), height: bookH }} data-book-w={bookW || undefined} data-calendar data-scope-ticker={calTicker} data-on-screen={calOn}>
        <Deferred index={0} frames={0} fallback={<CalendarInner />} className="h-full min-h-0 flex flex-col animate-fade-in">
          <ExposureField
            snapshot={calSnap ?? scan}
            toolbar="band"
            lead={chipFor('calendar', calTicker)}
            greeks={greekPick}
            onGreeks={setGreekPick}
            fullMode="move"
            fresh={replayOn && calTicker === ticker}
            after={calTicker === ticker ? replayBar : undefined}
            above={calTicker === ticker ? replayTransport : undefined}
            selectedStrike={focusFor(calTicker)}
            marks={calTicker === ticker ? marks : undefined}
            onSelectStrike={price => toggleFocus(price, calTicker)}
            /* NAMES SIDE BY SIDE (2026-09-12): up to four books on the one band; a
               kept strike belongs to its own name */
            multi
            selectedStrikeFor={focusFor}
            onSelectStrikeFor={(t, price) => toggleFocus(price, t)}
            snapshotFor={columnSnap}
            onNaturalWidth={setBookW}
            onNames={setBookNames}
            onExpiries={setBookDates}
            onNameDates={setNameDates}
            headSlot={bandUp && headBand ? headBand : bandSlot}
            onBandNeed={setBandNeed}
            pack={!split && bookW > 0}
          />
        </Deferred>
      </div>
      {/* THE TAPE (the competitive audit, 2026-10-13): today's price with the book's levels on it, a bell on each level,
          the expected move to the close — the chart practitioners open first, on this page rather than Terrain alone;
          foldable, remembered. The replay rewinds it with the report's bars. */}
      {/* …AND THE BOOK THROUGH THE DAY UNDER IT ON THE SAME CLOCK (idea 1, 2026-10-13): one box, the tape over the net
          gamma, the minute under the pointer marked on both — DayBox.tsx */}
      {/* one name: the day stands beside the book. two or more: the day row is
          under the book, one column a name, the same tracks as the panes — never
          a second copy of the book sitting beside it */}
      {!dayNames && (
      <div ref={tapeRef} id="map-session" className={`flex-[1_1_420px] min-w-0 flex flex-col border border-borderSubtle rounded-md bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12`} style={dayBeside ? { height: bookH } : { minHeight: 520 }} data-session data-scope-ticker={tapeTicker} data-on-screen={tapeOn}>
        <DayBox scope={chipFor('tape', tapeTicker)}>
          <TapeBox part snapshot={lv(tapeSnap ?? scan)} bars={playing && tapeTicker === ticker ? reportBars : undefined} focus={focusFor(tapeTicker)} onPick={price => toggleFocus(price, tapeTicker)} at={playing && tapeTicker === ticker ? replayMinute(framePos, range) : undefined} />
          <BookThroughDay part snapshot={lv(tapeSnap ?? scan)} bars={playing && tapeTicker === ticker ? reportBars : undefined} at={playing && tapeTicker === ticker ? replayMinute(framePos, range) : undefined} dates={lvDates(tapeSnap ?? scan)} bookLabel={lvWords(tapeSnap ?? scan)} />
        </DayBox>
      </div>
      )}
      </div>
      {dayNames && (
        <div ref={tapeRef} id="map-session" className={`grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'} max-sm:scroll-mt-24 sm:scroll-mt-12`} data-session data-session-split={dayNames.length} data-on-screen={tapeOn}>
          {dayNames.map((t, i) => {
            const host = i === 0;
            const raw = host ? tapeSnap ?? scan : columnSnap(t);
            const snap = raw ? lv(raw) : null;
            if (!snap) {
              return (
                <div key={t} className="min-w-0 flex flex-col border border-borderSubtle rounded-md bg-panel px-4 py-6 font-mono text-[11px] text-textMuted" data-session-box={t}>
                  Still reading {t}
                </div>
              );
            }
            const bars = playing ? (host ? reportBars : extraBars.get(t)) : undefined;
            const at = playing ? replayMinute(framePos, range) : undefined;
            return (
              <div key={t} className="min-w-0 flex flex-col border border-borderSubtle rounded-md bg-panel" data-session-box={t} data-scope-ticker={t}>
                <DayBox scope={<NameMark t={t} />}>
                  <TapeBox part snapshot={snap} bars={bars} focus={focusFor(t)} onPick={price => toggleFocus(price, t)} at={at} />
                  <BookThroughDay part snapshot={snap} bars={bars} at={at} dates={lvDates(snap)} bookLabel={lvWords(snap)} />
                </DayBox>
              </div>
            );
          })}
        </div>
      )}
      </div>
      {/* THE DAY — the two tools nobody ships (roadmap step 5, 2026-09-05):
          the Trader's Clock, today's hedging schedule with the book's figures
          in it, and the Wall Report Card, every level's record on today's
          tape. One box, two columns, the same strike shared. */}
      {/* No overflow clip here: the clock's hover card rises above the strip and a
          long phase sentence would be cut at the box's top edge */}
      {/* THE CLOCK BESIDE THE REPORT from 1,880px (idea 4, 2026-10-13): both ran the full width for a 178px strip and
          370px of rows; side by side a big monitor's page is a screen shorter. `contents` below that, so the flex column
          above still lays them out one under the other. */}
      {/* THE TWO BOXES END ON ONE LINE (Noah, 2026-10-14, with the picture: "the sizing needs to be fixed on the left box"): the
          clock stands as tall as the report beside it and its strip takes the height over its words — his cut let each keep
          its own height, which left the clock short with air under it */}
      {dayNames ? (
        <>
          <div className={`grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'}`} data-clock-split={dayNames.length}>
            {dayNames.map(t => {
              const host = t === ticker;
              const base = columnSnap(t);
              if (!base) {
                return (
                  <div key={t} className="min-w-0 border border-borderSubtle rounded-md bg-panel px-4 py-6 font-mono text-[11px] text-textMuted">
                    Still reading {t}
                  </div>
                );
              }
              return (
                <div key={t} ref={host ? dayRef : undefined} id={host ? 'map-clock' : undefined} className="min-w-0 flex flex-col border border-borderSubtle rounded-md bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12" data-day data-scope-ticker={t} data-on-screen={host ? dayOn : undefined}>
                  <TraderClock snapshot={lv(base)} scope={<NameMark t={t} />} dates={lvDates(base)} at={playing ? replayMinute(framePos, range) : undefined} onSeek={playing && range ? (min) => setReplay(r => (r ? { ...r, playing: false, pos: posAtMinute(r.range, min) } : r)) : undefined} />
                </div>
              );
            })}
          </div>
          <div className={`grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'}`} data-report-split={dayNames.length}>
            {dayNames.map(t => {
              const host = t === ticker;
              const base = columnSnap(t);
              if (!base) return null;
              return (
                <div key={t} ref={host ? reportRef : undefined} id={host ? 'map-report' : undefined} className="min-w-0 border border-borderSubtle rounded-md overflow-hidden bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12" data-report data-scope-ticker={t} data-on-screen={host ? reportOn : undefined}>
                  <WallReportCard tight snapshot={sessionBook(base, levelsScope).book ?? lv(base)} unavailable={sessionBook(base, levelsScope).why} focus={focusFor(t)} onPick={price => toggleFocus(price, t)} scope={<NameMark t={t} />} span={sessionBook(base, levelsScope).label} bars={playing ? (host ? reportBars : extraBars.get(t)) : undefined} />
                </div>
              );
            })}
          </div>
        </>
      ) : (
      <div className="contents min-[1880px]:grid min-[1880px]:grid-cols-[580px_minmax(0,1fr)] min-[1880px]:gap-4 min-[1880px]:items-stretch" data-map-wide-row>
      <div ref={dayRef} id="map-clock" className="flex flex-col border border-borderSubtle rounded-md bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12" data-day data-scope-ticker={dayTicker} data-on-screen={dayOn}>
        <TraderClock snapshot={lv(daySnap ?? scan)} scope={chipFor('day', dayTicker)} dates={lvDates(daySnap ?? scan)} at={playing && dayTicker === ticker ? replayMinute(framePos, range) : undefined} onSeek={playing && range && dayTicker === ticker ? (min) => setReplay(r => (r ? { ...r, playing: false, pos: posAtMinute(r.range, min) } : r)) : undefined} />
      </div>
      <div ref={reportRef} id="map-report" className="border border-borderSubtle rounded-md overflow-hidden bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12" data-report data-scope-ticker={reportTicker} data-on-screen={reportOn}>
        <WallReportCard snapshot={sessionBook(reportSnap ?? scan, levelsScope).book ?? lv(reportSnap ?? scan)} unavailable={sessionBook(reportSnap ?? scan, levelsScope).why} focus={focusFor(reportTicker)} onPick={price => toggleFocus(price, reportTicker)} scope={chipFor('report', reportTicker)} span={sessionBook(reportSnap ?? scan, levelsScope).label} bars={playing && reportTicker === ticker ? reportBars : undefined} />
      </div>
      </div>
      )}
      {/* One name fills the page. Two or more stand in columns, each on its own expiries. */}
      <div className={dayNames ? `grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'}` : 'w-full min-w-0'} data-map-readings={dayNames?.length ?? 1}>
        {(dayNames ?? [ticker]).map(t => (
          <MapReadings key={t} ticker={t} dates={datesFor(t)} at={playing ? replayMinute(framePos, range) : null} />
        ))}
      </div>
      {/* YOUR POSITIONS left this page for the Weigher's desk (Noah, 2026-09-14: "this is a
          feature a weigher section should have and not a pinpoint map section") — the map keeps
          the marks the positions leave on its ladder (`marks` above) */}
    </>
  );
};

export default MapDesk;
