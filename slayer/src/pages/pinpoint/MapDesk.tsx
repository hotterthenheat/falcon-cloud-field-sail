/* The Map: the book by expiry first — the Exposure Ledger (matrix or ladder), the day box (the tape with the levels over
   the book's net through the session), the Trader's Clock and the levels report, every column with its own facts; one
   shared strike (FocusContext), each box able to hold its own name, and a replay on a minute grid. */

import FilterTabs from '../../components/ui/FilterTabs';
import { FLAT_DOOR, FLAT_ON } from '../../components/ui/flatDoor';
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { useIsPhone } from '../../components/ui/useMediaQuery';
import { snapshotOf, useBookRev, usePinpointFeed, ensureBook } from '../../data/uwBook';
import { useListedRev } from '../../data/listedNames';
import { sameName } from '../../data/spotGexBook';
import { useFocus } from '../../context/FocusContext';
import ScopeChip from '../../components/ui/ScopeChip';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { Deferred } from '../../components/ui/Skeleton';
import { CalendarInner, MapPageSkeleton } from './pinpointSkeletons';
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
import { setReplayLabel } from './replayState';
import { readPosition, usePositions } from '../../data/positions';
import { buildExposureProfile, type StrikeWindow } from '../../data/exposure';
import { levelsBook, levelsDate, levelsWords, sessionBook } from '../../data/bookWindow';
import { levelsForName, useLevelsRev } from '../../data/levelsScope';
import type { ExposureExpiry } from '../../types/gex';
import type { Candle, MarketSnapshot } from '../../types/market';
import { useOnScreen } from '../../components/ui/useOnScreen';

/** The book sweeps on its own cadence — the boxes must not vibrate with every tick. */
const SCAN_INTERVAL_MS = 10_000;
/* the window is the whole book: thirty strikes each side built once; each box draws what it needs */
const WINDOW: StrikeWindow = 30;
/** Your positions read against the 0DTE book — the same book the ladder tile draws */
const POSITIONS_EXPIRY: ExposureExpiry = '0DTE';
/* The day splits with the book: with names side by side the day row is one box a name under its pane (two, three or
   four columns), stacked on a phone. Literal classes, so Tailwind sees them. */
const DAY_COLS: Record<number, string> = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };

/** A day box's name when the day is split: the mark and the name, the chip's own clothes without its menu — the pane
    above owns the pick */
const NameMark = ({ t }: { t: string }) => (
  <span className="inline-flex items-center gap-1.5 h-6 pl-2 pr-2.5 rounded-md border border-borderSubtle bg-chip font-mono select-none" data-day-name={t}>
    <CompanyLogo ticker={t} size={14} />
    <span className="text-t12 font-semibold text-textPrimary leading-none">{t}</span>
  </span>
);

/* Each box can hold its own name: it follows the frame's name until its chip unlinks it, then reads its own snapshot.
   Held across route changes in a session, reset on reload. */
type BoxKey = 'calendar' | 'tape' | 'day' | 'report';
type Scopes = Partial<Record<BoxKey, string>>;
let scopesMemory: Scopes = {};

/** The four boxes as a pill rail on a phone: the pill sits on the box highest on screen (IntersectionObserver), a tap scrolls to another. */
const MAP_JUMPS = [
  { value: 'map-book', label: 'Book' },
  { value: 'map-session', label: 'The day' },
  { value: 'map-clock', label: 'Clock' },
  { value: 'map-report', label: 'Report' },
] as const;
type MapJump = (typeof MAP_JUMPS)[number]['value'];
/* not sticky on a phone (it floated over the book's axis): it stands at the page's head */
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
    <nav className="sm:hidden -mx-4 px-4 py-1.5 border-b border-borderSubtle/60 bg-panel" aria-label="Jump to a box" data-map-jumps={at}>
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
  useListedRev();
  const marketData = usePinpointFeed(activeTicker);
  const bookRev = useBookRev();
  const { focus, toggleFocus, focusOn } = useFocus();
  useLevelsRev();
  const phone = useIsPhone();

  /* type a strike to keep it: `/` opens a prompt, Enter keeps the nearest strike, Esc closes */
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

  /* One lens per page: the calendar's greek is the page's; the Map opens on all five (the pick is not stored). */
  /* Spot GEX, DEX, vanna and charm are on the book immediately. VEX, color, vomma, speed, veta and zomma
     are in the same greek control and draw once each expiry's contract vol is in — never as a separate card, never as $0. */
  const [greekPick, setGreekPick] = useState<string[]>(['gex', 'dex', 'vex', 'vanna', 'charm', 'color', 'vomma', 'speed', 'veta', 'zomma']);

  /* Replay: one position on the session, seconds from the open, and every box reads the book as it stood then
     (data/replay.ts). Esc, a name change or "Back to live" ends it; boxes pinned to another name stay live. */
  const [replay, setReplay] = useState<{ phase: 'play'; range: ReplayRange; pos: number; playing: boolean; pace: number } | null>(null);
  const replayOn = replay != null;
  const playing = replay;

  /* Scan-tier snapshot: the book sweeps every SCAN_INTERVAL_MS (a name change is immediate) — the one snapshot every
     box on the page reads */
  const [scan, setScan] = useState<MarketSnapshot | null>(null);
  const scanRef = useRef<MarketSnapshot | null>(null);
  const scanAtRef = useRef(0);
  useEffect(() => {
    if (!marketData || sameName(marketData.ticker) !== sameName(activeTicker)) {
      if (scanRef.current && sameName(scanRef.current.ticker) !== sameName(activeTicker)) {
        scanRef.current = null;
        setScan(null);
      }
      return;
    }
    const now = Date.now();
    /* a book that changes shape (the full book landing after the board read) is taken at once */
    const shape = (s: MarketSnapshot | null) => Object.keys(s?.uwChains ?? {}).length;
    /* a book whose dates or contract facts landed (a new uwByDate — uwBook never edits a chain in place) is taken at once */
    const due = !scanRef.current || now - scanAtRef.current >= SCAN_INTERVAL_MS || scanRef.current.ticker !== marketData.ticker || shape(scanRef.current) !== shape(marketData) || scanRef.current.uwByDate !== marketData.uwByDate;
    if (due) {
      scanRef.current = marketData;
      scanAtRef.current = now;
      setScan(marketData);
    }
  }, [marketData, activeTicker]);

  /* Own-name snapshots, one per name a box has stepped onto, rebuilt on the scan cadence like the frame's (uwBook snapshotOf). */
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

  /* the session on hand for the replay, and the book at the position, read once per replayed minute */
  const range = playing?.range ?? null;
  const framePos = playing && range ? snapPos(playing.pos, range.length) : 0;
  /* the boxes follow the track a beat behind; the track and its moment stay on the pointer */
  const minutePos = useDeferredValue(Math.floor(framePos / 60) * 60);
  const replayBars = useMemo(() => (range ? sectionBarsAt(range, minutePos) : undefined), [range, minutePos]);
  /* one price in the replay: the minute's book is handed that minute's close, so the spot row and the tape agree */
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
  /* the shell head names the moment replayed */
  const replayWords = playing && range ? `${replayDay(range)} · ${replayLabel(framePos, range)}` : null;
  useEffect(() => {
    setReplayLabel(replayWords);
    return () => setReplayLabel(null);
  }, [replayWords]);
  /* replay opens at the session's first bar, playing */
  const startReplay = () => {
    if (!scan) return;
    const r = replayRange(scan.ticker);
    if (!r) return;
    setReplay({ phase: 'play', range: r, pos: 0, playing: true, pace: 60 });
  };
  /** The transport: a bar of its own across the top of the book, on the session's own clock. */
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
      /* sentence case, the cards' grammar */
      className={`${FLAT_DOOR} ${replay ? FLAT_ON : ''}`}
      data-map-replay
    >
      <span className="inline-grid place-items-center">
        <span className="invisible col-start-1 row-start-1 inline-flex items-center gap-1" aria-hidden><Play className="w-3 h-3" /> Replaying</span>
        <span className="col-start-1 row-start-1 inline-flex items-center gap-1"><Play className="w-3 h-3" /> {replay ? 'Replaying' : 'Replay'}</span>
      </span>
    </button>
  );

  /* the names beside the calendar rewind with it; a name with no session on hand stays live */
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
  /* The names the book holds, host first (ExposureField onNames); more than one splits the day into a box a name. */
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
    return ownSnaps.get(t) ?? null;
  };
  /* a box nobody sees holds still while the replay runs and catches up when scrolled into view */
  const [calRef, calOn] = useOnScreen<HTMLDivElement>();
  /* The book at its natural width when the day stands beside it (640 or more); otherwise the book takes the row and the
     day goes under. 0 = unmeasured, or the profile. */
  const [bookW, setBookW] = useState(0);
  /* the band's own strip above the book and the day; its height comes off the book box's */
  const [bandSlot, setBandSlot] = useState<HTMLDivElement | null>(null);
  const [bandSlotH, setBandSlotH] = useState(0);
  /* the band in the head where the head has its room (in with 12px to spare, out only once it no longer fits) */
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
  /* the bars move while any box that reads them is on screen */
  if (!replayOn || reportOn || tapeOn || dayOn || !heldRef.current.bars) heldRef.current.bars = replayBars;
  const reportBars = useDeferredValue(heldRef.current.bars);
  /** The shared strike belongs to ONE name — a box on another name never draws it */
  const focusFor = (t: string) => (focus && focus.ticker === t ? focus.price : null);
  /** A box's chip: follows the frame, or holds its own name */
  const chipFor = (key: BoxKey, t: string) => (
    <ScopeChip
      closeOutside
      ticker={t}
      linked={scopes[key] === undefined}
      quote
      onToggleLink={() => setScope(key, scopes[key] === undefined ? t : undefined)}
      onPick={next => {
        const name = sameName(next);
        ensureBook(name, 'full', true);
        if (scopes[key] === undefined) changeTicker(next);
        else setScope(key, next);
      }}
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
  const calTicker = scopes.calendar ?? calSnap?.ticker ?? ticker;
  const tapeTicker = scopes.tape ?? tapeSnap?.ticker ?? ticker;
  const dayTicker = scopes.day ?? daySnap?.ticker ?? ticker;
  const reportTicker = scopes.report ?? reportSnap?.ticker ?? ticker;
  const pinnedBook = (key: BoxKey, snap: MarketSnapshot | null): MarketSnapshot | null => {
    const pinned = scopes[key];
    if (pinned && scan && pinned !== scan.ticker) return snap;
    return snap ?? scan;
  };

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

  /* the page stands in as its own four boxes while the first read walks in, so nothing moves when the book lands */
  if (!scan || !data) return <BookOrSkeleton tickers={[ticker]}><MapPageSkeleton /></BookOrSkeleton>;
  const calBook = pinnedBook('calendar', calSnap);
  const tapeBook = pinnedBook('tape', tapeSnap);
  const dayBook = pinnedBook('day', daySnap);
  const reportBook = pinnedBook('report', reportSnap);

  const keepTyped = (raw: string) => {
    const want = Number.parseFloat(raw.replace(/[^0-9.]/g, ''));
    setStrikeAsk(false);
    if (!Number.isFinite(want) || !scan.chain.length) return;
    let best = scan.chain[0].strike;
    for (const n of scan.chain) if (Math.abs(n.strike - want) < Math.abs(best - want)) best = n.strike;
    focusOn(best, ticker);
  };

  /* on a phone the book is taller than the screen: the page scrolls past it and the matrix shows ~20 strikes */
  const bookH = phone ? 'calc(100dvh + 300px)' : `calc(clamp(640px, 100dvh - 190px, 1000px) - ${bandSlotH > 0 ? bandSlotH + 8 : 0}px)`;
  /* The book stays the width of its panes. It used to stretch to the row whenever the day chart could not sit beside
     it (under ~1,070px of page), which is the old wide map. The day sits beside from 420px of room; under that it
     wraps, and the book does not grow to fill the gap. */
  const DAY_MIN = 420;
  const split = dayNames != null;
  const bookFits = bookW > 0 && (topRowW <= 0 || bookW <= topRowW);
  const bookStyleW = bookW > 0 ? (bookFits ? bookW : topRowW || bookW) : undefined;
  const dayBeside = !split && !!bookStyleW && topRowW > 0 && topRowW - bookStyleW - 16 >= DAY_MIN;
  const datesFor = (t: string): string[] | null => (nameDates[t]?.length ? nameDates[t] : bookDates);
  /* The levels are that name's, not the frame's: changing SPY's Levels card does not move QQQ's boxes. */
  const scopeOf = (snap: MarketSnapshot) => levelsForName(snap.ticker);
  const lv = (snap: MarketSnapshot): MarketSnapshot => levelsBook(snap, scopeOf(snap));
  const lvDates = (snap: MarketSnapshot): string[] | null => {
    const d = levelsDate(snap, scopeOf(snap));
    return d ? [d] : null;
  };
  const lvWords = (snap: MarketSnapshot): string => levelsWords(snap, scopeOf(snap));

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
            <label htmlFor="strike-ask" className="text-t11 text-textMuted">
              Keep a strike
            </label>
            <input
              id="strike-ask"
              ref={strikeInput}
              autoFocus
              inputMode="decimal"
              placeholder={scan.spot.toFixed(0)}
              className="w-24 slayer-field"
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setStrikeAsk(false);
                }
              }}
              onBlur={() => setStrikeAsk(false)}
            />
            <span className="text-t11 text-textMuted">Enter keeps it · Esc</span>
          </form>
        </div>
      )}
      {/* jump links on a phone (the page is ~3,000px tall there): the house pill rail, the pill on the box in view */}
      <MapJumps />
      {/* The calendar first: the same book by expiry (the Exposure Ledger with its one-row toolbar and the replay transport).
   The host names the book; the strike a capsule pins is the shared strike every box lights. */}
      {/* 870px holds the default window (±20 strikes at the ledger's 18px floor) with the toolbar, no scrolling */}
      {/* …and never past the fold: the box is the first screen's (never under 640, 1000 at most), so the matrix is not a scroll
         region inside a cut box */}
      {/* the book and the day side by side where they fit: the book at its natural width, the day taking the rest from 640px
         up at the book's height; narrower, the day wraps under the book */}
      <div id="map-book" className="flex flex-col gap-2 max-sm:scroll-mt-24 sm:scroll-mt-12" data-map-book-wrap>
      <div ref={setBandSlot} className={`empty:hidden border border-borderSubtle rounded-md bg-panel overflow-hidden [&>[data-ledger-toolbar]]:border-b-0`} data-map-band-slot />
      <div ref={setTopRow} className="flex flex-wrap items-stretch gap-4" data-map-top-row data-day-beside={dayBeside || undefined} data-band-need={bandNeed || undefined} data-head-room={headRoom || undefined} data-band-up={bandUp || undefined}>
      <div ref={calRef} className={`shrink-0 grow-0 max-w-full border border-borderSubtle rounded-md overflow-hidden flex flex-col`} style={{ width: split || !dayBeside ? '100%' : (bookStyleW ?? '100%'), height: bookH }} data-book-w={bookW || undefined} data-calendar data-scope-ticker={calTicker} data-on-screen={calOn}>
        <Deferred index={0} frames={0} fallback={<CalendarInner />} className="h-full min-h-0 flex flex-col animate-fade-in">
          {calBook ? (
          <ExposureField
            snapshot={calBook}
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
            /* names side by side: up to four books on the one band; a kept strike belongs to its own name */
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
          ) : (
            <div className="px-4 py-6 font-mono text-t11 text-textMuted">Still reading {scopes.calendar}</div>
          )}
        </Deferred>
      </div>
      {/* the tape: today's price with the book's levels on it, a bell on each level, 1σ to the close; foldable, remembered */}
      {/* …and the book through the day under it on the same clock (DayBox.tsx) */}
      {/* one name: the day stands beside the book. two or more: the day row is
          under the book, one column a name, the same tracks as the panes — never
          a second copy of the book sitting beside it */}
      {!dayNames && (
      <div ref={tapeRef} id="map-session" className={`flex-[1_1_420px] min-w-0 flex flex-col border border-borderSubtle rounded-md bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12`} style={dayBeside ? { height: bookH } : { minHeight: 520 }} data-session data-scope-ticker={tapeTicker} data-on-screen={tapeOn}>
        <DayBox scope={chipFor('tape', tapeTicker)}>
          {tapeBook ? (
            <>
          <TapeBox part snapshot={lv(tapeBook)} bars={playing && tapeTicker === ticker ? reportBars : undefined} focus={focusFor(tapeTicker)} onPick={price => toggleFocus(price, tapeTicker)} at={playing && tapeTicker === ticker ? replayMinute(framePos, range) : undefined} />
          <BookThroughDay part snapshot={lv(tapeBook)} bars={playing && tapeTicker === ticker ? reportBars : undefined} at={playing && tapeTicker === ticker ? replayMinute(framePos, range) : undefined} dates={lvDates(tapeBook)} bookLabel={lvWords(tapeBook)} />
            </>
          ) : (
            <div className="px-4 py-6 font-mono text-t11 text-textMuted">Still reading {scopes.tape}</div>
          )}
        </DayBox>
      </div>
      )}
      </div>
      {dayNames && (
        <div ref={tapeRef} id="map-session" className={`grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'} max-sm:scroll-mt-24 sm:scroll-mt-12`} data-session data-session-split={dayNames.length} data-on-screen={tapeOn}>
          {dayNames.map((t, i) => {
            const host = i === 0;
            const raw = host ? tapeBook : columnSnap(t);
            const snap = raw ? lv(raw) : null;
            if (!snap) {
              return (
                <div key={t} className="min-w-0 flex flex-col border border-borderSubtle rounded-md bg-panel px-4 py-6 font-mono text-t11 text-textMuted" data-session-box={t}>
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
      {/* the day: the Trader's Clock (today's hedging schedule) and the Wall Report Card (every level's record on today's tape),
         one box, two columns, the same strike shared */}
      {/* No overflow clip here: the clock's hover card rises above the strip and a
          long phase sentence would be cut at the box's top edge */}
      {/* the clock beside the report from 1,880px; `contents` below that, so the column lays them out one under the other */}
      {/* the two boxes end on one line: the clock stands as tall as the report and its strip takes the height */}
      {dayNames ? (
        <>
          <div className={`grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'}`} data-clock-split={dayNames.length}>
            {dayNames.map(t => {
              const host = t === ticker;
              const base = columnSnap(t);
              if (!base) {
                return (
                  <div key={t} className="min-w-0 border border-borderSubtle rounded-md bg-panel px-4 py-6 font-mono text-t11 text-textMuted">
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
                  <WallReportCard tight snapshot={sessionBook(base, scopeOf(base)).book ?? lv(base)} unavailable={sessionBook(base, scopeOf(base)).why} focus={focusFor(t)} onPick={price => toggleFocus(price, t)} scope={<NameMark t={t} />} span={sessionBook(base, scopeOf(base)).label} bars={playing ? (host ? reportBars : extraBars.get(t)) : undefined} />
                </div>
              );
            })}
          </div>
        </>
      ) : (
      <div className="contents min-[1880px]:grid min-[1880px]:grid-cols-[580px_minmax(0,1fr)] min-[1880px]:gap-4 min-[1880px]:items-stretch" data-map-wide-row>
      <div ref={dayRef} id="map-clock" className="flex flex-col border border-borderSubtle rounded-md bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12" data-day data-scope-ticker={dayTicker} data-on-screen={dayOn}>
        {dayBook ? (
        <TraderClock snapshot={lv(dayBook)} scope={chipFor('day', dayTicker)} dates={lvDates(dayBook)} at={playing && dayTicker === ticker ? replayMinute(framePos, range) : undefined} onSeek={playing && range && dayTicker === ticker ? (min) => setReplay(r => (r ? { ...r, playing: false, pos: posAtMinute(r.range, min) } : r)) : undefined} />
        ) : (
          <div className="px-4 py-6 font-mono text-t11 text-textMuted">Still reading {scopes.day}</div>
        )}
      </div>
      <div ref={reportRef} id="map-report" className="border border-borderSubtle rounded-md overflow-hidden bg-panel max-sm:scroll-mt-24 sm:scroll-mt-12" data-report data-scope-ticker={reportTicker} data-on-screen={reportOn}>
        {reportBook ? (
        <WallReportCard snapshot={sessionBook(reportBook, scopeOf(reportBook)).book ?? lv(reportBook)} unavailable={sessionBook(reportBook, scopeOf(reportBook)).why} focus={focusFor(reportTicker)} onPick={price => toggleFocus(price, reportTicker)} scope={chipFor('report', reportTicker)} span={sessionBook(reportBook, scopeOf(reportBook)).label} bars={playing && reportTicker === ticker ? reportBars : undefined} />
        ) : (
          <div className="px-4 py-6 font-mono text-t11 text-textMuted">Still reading {scopes.report}</div>
        )}
      </div>
      </div>
      )}
      {/* One name fills the page. Two or more stand in columns, each on its own expiries. */}
      <div className={dayNames ? `grid w-full grid-cols-1 gap-4 ${DAY_COLS[dayNames.length] ?? 'lg:grid-cols-2'}` : 'w-full min-w-0'} data-map-readings={dayNames?.length ?? 1}>
        {(dayNames ?? [ticker]).map(t => (
          <MapReadings key={t} ticker={t} dates={datesFor(t)} at={playing ? replayMinute(framePos, range) : null} />
        ))}
      </div>
      {/* your positions live on the Weigher's desk; the map keeps the marks they leave on its ladder (`marks`) */}
    </>
  );
};

export default MapDesk;
