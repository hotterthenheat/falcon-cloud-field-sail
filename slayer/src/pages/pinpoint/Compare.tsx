/*
==================================================
  SLAYER TERMINAL - COMPARE
  (pages/pinpoint/Compare.tsx)

  The seventh page of Pinpoint (2026-09-08, Noah:
  "a compare page of 2 different stocks/tickers in
  multiple ways you see fit"). Two names, three
  boxes, read top to bottom:

    HEAD TO HEAD    the same ten reads for both,
                    side by side, each figure over
                    its bar on a track, a card on
                    the row under the pointer
    ONE RULER       both books at their distance
                    from their own spot — one grows
                    left, the other right
    SINCE THE OPEN  today's session, both names as
                    one line each of percent from
                    their own open, the gap beneath

  A COMPOSITION: the reads are the Board's, Ahead's
  and Targets'; the ruler is the desk's; the lines
  are the chart library's. The first name follows
  the frame (or holds its own); the second is the
  page's, opening on the index twin. Each name's
  chip sits at the head of its own column, and the
  two sides keep that order in every box.
==================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useTicker } from '../../context/MarketDataContext';
import { snapshotOf, useBookRev, usePinpointFeed, peekEntry } from '../../data/uwBook';
import { useFocus } from '../../context/FocusContext';
import ScopeChip from '../../components/ui/ScopeChip';
import { Deferred } from '../../components/ui/Skeleton';
import GuideFocus from '../../components/ui/GuideFocus';
import CompareSidePanel from '../../components/gex/CompareSidePanel';
import { useIsBelowXl } from '../../components/ui/useMediaQuery';
import CompareAxis from '../../components/gex/CompareAxis';
import { nextGreekPick, pickGreeks } from '../../components/gex/exposureView';
import CompareTapes from '../../components/gex/CompareTapes';
import ComparePair from '../../components/gex/ComparePair';
import CompareGuide from '../../components/gex/CompareGuide';
import { CompareAxisInner, ComparePageSkeleton, ComparePairInner, CompareTapesInner } from '../../components/gex/compareSkeletons';
import { BookOrSkeleton } from './BookDown';
import { aheadClock } from '../../data/ahead';
import { buildCompare, buildCompareSide, partnerFor, type Greek, type Reach } from '../../data/compare';
import { useDistanceUnit } from '../../data/distanceUnits';
import { readSessionClock } from '../../data/moc';
import type { MarketSnapshot } from '../../types/market';
import type { ExposureExpiry } from '../../types/gex';
import { BOOK_TTL_MS, StaleMark } from '../../components/ui/liveRead';

/** The reads sweep on their own cadence — a comparison must not vibrate with every tick */
const SCAN_INTERVAL_MS = 10_000;
/** The two names' inks on the lines: the frame's name in the house white, the second in the first comparison ink (Terrain's set) */
const A_INK = 'rgb(var(--text-primary))';
const B_INK = '#5B9CF6';

const hhmmss = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

/* WHICH SIDES STAND OPEN beside the ruler (the partner's cut, 2026-10-18): both by rest; remembered, carried */
const SIDES_KEY = 'slayer_compare_sides';
type Sides = { a: boolean; b: boolean };
const readSides = (): Sides => {
  try {
    const v = JSON.parse(localStorage.getItem(SIDES_KEY) ?? '') as Partial<Sides>;
    return { a: v.a !== false, b: v.b !== false };
  } catch {
    return { a: true, b: true };
  }
};

/* The first name follows the frame until its chip holds one; the second is
   the page's own, remembered across route changes within a session */
let aMemory: string | undefined;
let bMemory: string | null = null;

const Compare = () => {
  const { activeTicker, changeTicker } = useTicker();
  const marketData = usePinpointFeed(activeTicker);
  const bookRev = useBookRev();
  const { focus, toggleFocus } = useFocus();
  const unit = useDistanceUnit();
  const [aScope, setAScopeState] = useState<string | undefined>(aMemory);
  const setAScope = (t: string | undefined) => {
    aMemory = t;
    setAScopeState(t);
  };
  const aTicker = aScope ?? activeTicker;
  /* a door that names the second name (Pulse's Head to head tile) opens the page on that pair */
  const location = useLocation();
  const [bState, setBState] = useState<string | null>(() => {
    const asked = (location.state as { pair?: string } | null)?.pair;
    if (asked) bMemory = asked;
    return bMemory;
  });
  const setB = (t: string) => {
    bMemory = t;
    setBState(t);
  };
  /* Never the same name twice: a change that lands the two on one name moves the second to its partner */
  const bTicker = bState && bState !== aTicker ? bState : partnerFor(aTicker);

  /* THE CLOCK — New York time, re-read every 15s; the expected move runs on it */
  const [clockRaw, setClockRaw] = useState(() => readSessionClock());
  useEffect(() => {
    const id = globalThis.setInterval(() => setClockRaw(readSessionClock()), 15_000);
    return () => globalThis.clearInterval(id);
  }, []);
  const clock = useMemo(() => aheadClock(clockRaw), [clockRaw]);

  /* Scan-tier snapshot: the reads sweep every SCAN_INTERVAL_MS (a name change is immediate) */
  const [scan, setScan] = useState<{ snap: MarketSnapshot; at: string; nonce: number } | null>(null);
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
    const due = !scanRef.current || now - scanAtRef.current >= SCAN_INTERVAL_MS || scanRef.current.ticker !== marketData.ticker || shape(scanRef.current) !== shape(marketData);
    if (due) {
      scanRef.current = marketData;
      scanAtRef.current = now;
      setScan({ snap: marketData, at: hhmmss(new Date(now)), nonce: now });
    }
  }, [marketData]);
  const nonce = scan?.nonce ?? 0;

  /* The chart folds in the newest bar on every tick — the same counter Terrain keeps */
  const revRef = useRef(0);
  const revision = useMemo(() => ++revRef.current, [marketData]);

  /* The two snapshots: the frame's own when the first name follows it, else a pure read of the simulator */
  const snapOf = (t: string): MarketSnapshot | null => {
    if (scan && scan.snap.ticker === t) return scan.snap;
    try {
      return snapshotOf(t, 'full');
    } catch {
      return null;
    }
  };
  /* Which contracts both books weigh — the Map's Expiry card, on the ruler's
     head (Noah, 2026-09-10: "missing some top buttons") */
  const [expiry, setExpiry] = useState<ExposureExpiry>('0DTE');
  const sideA = useMemo(() => {
    const s = snapOf(aTicker);
    return s ? buildCompareSide(s, clock, expiry) : null;
  }, [aTicker, clock, nonce, expiry, bookRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const sideB = useMemo(() => {
    const s = snapOf(bTicker);
    return s ? buildCompareSide(s, clock, expiry) : null;
  }, [bTicker, clock, nonce, expiry, bookRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmp = useMemo(() => (sideA && sideB ? buildCompare(sideA, sideB, clock) : null), [sideA, sideB, clock]);

  const [guideOpen, setGuideOpen] = useState(false);
  const belowLg = useIsBelowXl();
  const [sides, setSidesState] = useState<Sides>(readSides);
  const toggleSide = (k: 'a' | 'b') =>
    setSidesState(prev => {
      const next = { ...prev, [k]: !prev[k] };
      try {
        localStorage.setItem(SIDES_KEY, JSON.stringify(next));
      } catch {
        /* storage off — the fold lives for the page */
      }
      return next;
    });
  /* How far the ruler runs — two expected moves (2026-09-29: at three, nearly half the drawing was strikes too light to
     draw; two is about what a day can reach, and the drawing is mostly capsules). It was three on the taller drawing
     (2026-09-09: "cover more of the capsules"); the Reach card still goes there. */
  const [reach, setReach] = useState<Reach>('two');
  /* The capsules' ramp — the calendar's Colours card, thermal by default (Noah,
     2026-09-10: "the house color vs thermal color button") */
  const [palette, setPalette] = useState<'thermal' | 'house'>('thermal');
  /* ONE GREEK PER PAGE, the Map's rule: the ruler, the reach sums and the Supreme
     row follow it — "All" shows the five lanes (narrow on the page, the screen in fullscreen) and leaves the
     card's Supreme row on gamma */
  /* THE GREEKS ARE A PICK (Noah, 2026-09-10: "choose the amount of greeks they
     want to compare and not handicap them to 1 or 4") — the lanes drawn are
     the greeks ticked; the reach sums and the Supreme row follow the first */
  const [greekPick, setGreekPick] = useState<string[]>(['gex']);
  const greeks = useMemo(() => pickGreeks(greekPick), [greekPick]);
  const greek: Greek = greeks[0] ?? 'gex';
  /* THE RULER FULLSCREEN (Noah, 2026-09-09): the same box moved to the whole
     viewport, the Map's way — one body, one drawing, nothing remounts. Esc
     brings it back. */
  const [rulerFull, setRulerFull] = useState(false);
  useEffect(() => {
    if (!rulerFull) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRulerFull(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [rulerFull]);
  const focusFor = (t: string) => (focus && focus.ticker === t ? focus.price : null);
  const focusA = focusFor(aTicker);
  const focusB = focusFor(bTicker);
  const onPick = (strike: number, t: string) => toggleFocus(strike, t);

  /* The two chips wear the same clothes (Noah, 2026-09-09): the first in the
     full following look with its silver link, the second its own name with no
     link at all — it cannot follow the frame, that would make it the first. */
  const chipA = (
    <ScopeChip
      ticker={aTicker}
      linked={aScope === undefined}
      full
      quote
      onToggleLink={() => setAScope(aScope === undefined ? aTicker : undefined)}
      onPick={next => (aScope === undefined ? changeTicker(next) : setAScope(next))}
    />
  );
  const chipB = <ScopeChip ticker={bTicker} quote onPick={next => setB(next)} title="The second name — pick another" />;
  const onSwap = () => {
    const a = aTicker;
    const b = bTicker;
    if (aScope === undefined) changeTicker(b);
    else setAScope(b);
    setB(a);
  };

  if (!scan || !cmp) return <BookOrSkeleton tickers={[aTicker, bTicker]}><ComparePageSkeleton /></BookOrSkeleton>;

  const aBook = peekEntry(aTicker);
  const bBook = peekEntry(bTicker);
  const bookAt = [aBook?.at, bBook?.at].reduce<number | null>((best, at) => (at && at > 0 ? (best == null ? at : Math.min(best, at)) : best), null);
  const bookFault = aBook?.status === 'error' || bBook?.status === 'error' ? 'failed' as const : null;

  return (
    <>
      {/* BOX 1 — THE TWO BOOKS ON ONE RULER, A NAME'S READ ON EACH SIDE (the partner's cut, 2026-10-18: the Head to head
          box is gone; each name's read stands in a folding panel at its own edge of the ruler; the same box moves to the
          viewport in fullscreen) */}
      <motion.div
        layout
        transition={{ layout: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
        /* the page's own ground when full, not the box's panel grey (Noah, 2026-09-10: "ashy/gray") */
        className={rulerFull ? 'fixed inset-0 z-[80] bg-canvas flex flex-col' : 'relative border border-borderSubtle rounded-md bg-panel'}
        data-compare-ruler
        data-full={rulerFull || undefined}
      >
        <div className={`flex items-stretch min-w-0 ${rulerFull ? 'flex-1 min-h-0' : ''}`} data-compare-shell data-a={aTicker} data-b={bTicker}>
          {!belowLg && <CompareSidePanel side="a" s={cmp.a} cmp={cmp} unit={unit} greek={greek} greeks={greeks} chip={chipA} focus={focusA} onPick={onPick} open={sides.a} onToggle={() => toggleSide('a')} full={rulerFull} />}
          <div className={`flex-1 min-w-0 ${rulerFull ? 'min-h-0 flex flex-col' : ''}`} data-compare-middle>
            <Deferred index={0} fallback={<CompareAxisInner />} className={rulerFull ? 'flex-1 min-h-0 flex flex-col' : 'animate-fade-in'}>
              <CompareAxis cmp={cmp} unit={unit} reach={reach} onReach={setReach} greeks={greeks} greekPick={greekPick} onGreekPick={v => setGreekPick(nextGreekPick(greekPick, v))} expiry={expiry} onExpiry={setExpiry} palette={palette} onPalette={setPalette} focusA={focusA} focusB={focusB} onPick={onPick} onGuide={() => setGuideOpen(v => !v)} guideOpen={guideOpen} full={rulerFull} onFull={setRulerFull} />
            </Deferred>
          </div>
          {!belowLg && <CompareSidePanel side="b" s={cmp.b} cmp={cmp} unit={unit} greek={greek} greeks={greeks} chip={chipB} focus={focusB} onPick={onPick} open={sides.b} onToggle={() => toggleSide('b')} full={rulerFull} />}
        </div>
        {/* THE SENTENCE — what the two say against each other, once, under the ruler (the old table's verdicts) */}
        <div className="shrink-0 px-5 py-2.5 border-t border-borderSubtle/60 flex items-baseline gap-4 flex-wrap" data-compare-sentence>
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-textSecondary">{cmp.sentence}</p>
          <span className="shrink-0 flex items-center gap-3">
            <button type="button" onClick={onSwap} className="font-mono text-[9px] uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors" title="Swap the two names" data-compare-swap>
              swap
            </button>
            <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted whitespace-nowrap tabular-nums" data-compare-updated>
              updated {scan.at} · every 10s
            </span>
            <StaleMark at={bookAt} ttlMs={BOOK_TTL_MS} fault={bookFault} />
          </span>
        </div>
        {/* ON A PHONE the two reads stack under the ruler as cards — there is no edge to fold them into */}
        {belowLg && !rulerFull && (
          <div className="grid grid-cols-1 gap-2 p-2 border-t border-borderSubtle/60" data-compare-stacked>
            <CompareSidePanel stacked side="a" s={cmp.a} cmp={cmp} unit={unit} greek={greek} greeks={greeks} chip={chipA} focus={focusA} onPick={onPick} open onToggle={() => undefined} />
            <CompareSidePanel stacked side="b" s={cmp.b} cmp={cmp} unit={unit} greek={greek} greeks={greeks} chip={chipB} focus={focusB} onPick={onPick} open onToggle={() => undefined} />
          </div>
        )}
        <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read this page" testId="compare-guide" viewport>
          <CompareGuide cmp={cmp} />
        </GuideFocus>
      </motion.div>

      {/* BOX 2 — SINCE THE OPEN: today's two lines, the same for both, and the gap under them */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-compare-tapes>
        <Deferred index={1} fallback={<CompareTapesInner />} className="animate-fade-in">
          <CompareTapes a={aTicker} b={bTicker} aInk={A_INK} bInk={B_INK} revision={revision} />
        </Deferred>
      </div>

      {/* BOX 3 — THE PAIR: is today's gap usual, session by session */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-compare-pair-box>
        <Deferred index={2} fallback={<ComparePairInner />} className="animate-fade-in">
          <ComparePair a={aTicker} b={bTicker} aInk={A_INK} bInk={B_INK} nonce={nonce} guideOpen={guideOpen} onGuide={() => setGuideOpen(v => !v)} />
        </Deferred>
      </div>
    </>
  );
};

export default Compare;
