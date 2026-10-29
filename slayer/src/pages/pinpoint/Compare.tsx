/* Compare: two names, read top to bottom — both books on one ruler with each name's read at its edge, then since the open
   (both as percent from their own open, the gap beneath). The first name follows the frame; the second opens on the index twin. */

import { nyClock } from '../../core/nyTime';
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
import { CompareAxisInner, ComparePageSkeleton, ComparePairInner, CompareSideInner, CompareTapesInner } from '../../components/gex/compareSkeletons';
import { BookOrSkeleton } from './BookDown';
import { aheadClock } from '../../data/ahead';
import { buildCompare, buildCompareSide, partnerFor, type Greek, type Reach } from '../../data/compare';
import { contractsReady, isContractGreek } from '../../data/exposureSurface';
import { useNameUnit } from '../../data/distanceUnits';
import { readSessionClock } from '../../data/moc';
import type { MarketSnapshot } from '../../types/market';
import type { ExposureExpiry } from '../../types/gex';
import { useNameLevels } from '../../data/levelsScope';
import { cadenceWords } from '../../data/bookWindow';
import { BOOK_TTL_MS, StaleMark } from '../../components/ui/liveRead';

/** The reads sweep on their own cadence — a comparison must not vibrate with every tick */
const SCAN_INTERVAL_MS = 10_000;
/** The two names' inks on the lines: the frame's name in the house white, the second in the first comparison ink (Terrain's set) */
const A_INK = 'rgb(var(--text-primary))';
const B_INK = '#5B9CF6';

/* New York's clock with its zone. */
const hhmmss = (d: Date) => nyClock(d, { seconds: true, zone: true });

/* Which side panels stand open beside the ruler: both by default; remembered and carried. */
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
  const [aScope, setAScopeState] = useState<string | undefined>(aMemory);
  const setAScope = (t: string | undefined) => {
    aMemory = t;
    setAScopeState(t);
  };
  const aTicker = aScope ?? activeTicker;
  const unit = useNameUnit(aTicker);
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
    /* A book that changes shape (its per-expiry chains landed) is taken at once, not at the next scan. */
    const shape = (s: MarketSnapshot | null) => Object.keys(s?.uwChains ?? {}).length;
    /* a book whose dates or contract facts landed (a new uwByDate — uwBook never edits a chain in place) is taken at once */
    const due = !scanRef.current || now - scanAtRef.current >= SCAN_INTERVAL_MS || scanRef.current.ticker !== marketData.ticker || shape(scanRef.current) !== shape(marketData) || scanRef.current.uwByDate !== marketData.uwByDate;
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
  /* Each name weighs its own levels. An expiry picked here stays on that name. */
  const scopeA = useNameLevels(aTicker);
  const scopeB = useNameLevels(bTicker);
  const [pickA, setPickA] = useState<ExposureExpiry | null>(null);
  const [pickB, setPickB] = useState<ExposureExpiry | null>(null);
  const expiryA: ExposureExpiry = pickA ?? scopeA;
  const expiryB: ExposureExpiry = pickB ?? scopeB;
  /* Nothing provisional: a side whose levels are not final is not built. */
  const finalSide = (s: MarketSnapshot | null, expiry: ExposureExpiry) => {
    if (!s) return null;
    const side = buildCompareSide(s, clock, expiry);
    return side && side.levels.complete === false ? null : side;
  };
  const sideA = useMemo(() => finalSide(snapOf(aTicker), expiryA), [aTicker, clock, nonce, expiryA, bookRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const sideB = useMemo(() => finalSide(snapOf(bTicker), expiryB), [bTicker, clock, nonce, expiryB, bookRev]); // eslint-disable-line react-hooks/exhaustive-deps
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
  /* The ruler runs two expected moves by default (about what a day reaches); the Reach card goes further. */
  const [reach, setReach] = useState<Reach>('two');
  /* The capsules' ramp, thermal by default. */
  const [palette, setPalette] = useState<'thermal' | 'house'>('thermal');
  /* One greek per page: the ruler, the reach sums and the Supreme row follow it; "All" shows five lanes and keeps the Supreme row on gamma. */
  /* The lanes drawn are the greeks ticked; the reach sums and the Supreme row follow the first. */
  const [greekPick, setGreekPick] = useState<string[]>(['gex']);
  /* the vendor's books carry no vega — never a $0 VEX lane */
  const greeks = useMemo(() => {
    const g = pickGreeks(greekPick);
    const ready = contractsReady(snapOf(aTicker)) || contractsReady(snapOf(bTicker));
    if (ready) return g;
    const kept = g.filter(x => !isContractGreek(x));
    return kept.length ? kept : pickGreeks(['gex']);
  }, [greekPick, aTicker, bTicker, nonce, bookRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const greek: Greek = greeks[0] ?? 'gex';
  /* The ruler fullscreen: the same box moved to the viewport, nothing remounts; Esc brings it back. */
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

  /* The first chip follows the frame with its silver link; the second is its own name with no link (following would make it the first). */
  const chipA = (
    <ScopeChip
      closeOutside
      ticker={aTicker}
      linked={aScope === undefined}
      full
      quote
      onToggleLink={() => setAScope(aScope === undefined ? aTicker : undefined)}
      onPick={next => (aScope === undefined ? changeTicker(next) : setAScope(next))}
    />
  );
  const chipB = <ScopeChip ticker={bTicker} quote closeOutside onPick={next => setB(next)} title="The second name — pick another" />;
  const onSwap = () => {
    const a = aTicker;
    const b = bTicker;
    if (aScope === undefined) changeTicker(b);
    else setAScope(b);
    setB(a);
  };

  /* Each side stands on its own: a side with final levels draws at once; the other and the ruler wait in skeletons and say whose levels are being read. */
  const solo = scan && !cmp ? (sideA ? { side: 'a' as const, s: sideA, waiting: bTicker } : sideB ? { side: 'b' as const, s: sideB, waiting: aTicker } : null) : null;
  if (scan && solo && peekEntry(solo.waiting)?.status !== 'error') {
    const self = buildCompare(solo.s, solo.s, clock);
    const panel = (stacked: boolean) => (
      <CompareSidePanel stacked={stacked} side={solo.side} s={solo.s} cmp={self} unit={unit} greek={greek} greeks={greeks} chip={solo.side === 'a' ? chipA : chipB} focus={solo.side === 'a' ? focusA : focusB} onPick={onPick} open={stacked ? true : sides[solo.side]} onToggle={stacked ? () => undefined : () => toggleSide(solo.side)} />
    );
    const waitSide = solo.side === 'a' ? 'b' : 'a';
    return (
      <>
        <div className="relative border border-borderSubtle rounded-md bg-panel" data-compare-ruler data-compare-solo={solo.s.ticker}>
          <div className="flex items-stretch min-w-0" data-compare-shell data-a={aTicker} data-b={bTicker}>
            {!belowLg && (solo.side === 'a' ? panel(false) : <CompareSideInner side="a" />)}
            <div className="flex-1 min-w-0" data-compare-middle>
              <CompareAxisInner />
            </div>
            {!belowLg && (solo.side === 'b' ? panel(false) : <CompareSideInner side="b" />)}
          </div>
          <div className="shrink-0 px-5 py-2.5 border-t border-borderSubtle/60 flex items-baseline gap-4 flex-wrap" data-compare-sentence>
            <p className="min-w-[min(18rem,100%)] flex-1 text-t12 leading-relaxed text-textSecondary" data-compare-waiting={solo.waiting}>
              Still reading {solo.waiting}'s levels — {solo.s.ticker}'s are in; the ruler draws both once {solo.waiting}'s contracts have landed.
            </p>
          </div>
          {belowLg && (
            <div className="grid grid-cols-1 gap-2 p-2 border-t border-borderSubtle/60" data-compare-stacked>
              {solo.side === 'a' ? panel(true) : null}
              <CompareSideInner side={waitSide} />
              {solo.side === 'b' ? panel(true) : null}
            </div>
          )}
        </div>
        <div className="border border-borderSubtle rounded-md bg-panel" data-compare-tapes>
          <Deferred index={1} fallback={<CompareTapesInner />} className="animate-fade-in">
            <CompareTapes a={aTicker} b={bTicker} aInk={A_INK} bInk={B_INK} revision={revision} />
          </Deferred>
        </div>
        <div className="border border-borderSubtle rounded-md bg-panel" data-compare-pair-box>
          <Deferred index={2} fallback={<ComparePairInner />} className="animate-fade-in">
            <ComparePair a={aTicker} b={bTicker} aInk={A_INK} bInk={B_INK} nonce={nonce} guideOpen={guideOpen} onGuide={() => setGuideOpen(v => !v)} />
          </Deferred>
        </div>
      </>
    );
  }
  if (!scan || !cmp) return <BookOrSkeleton tickers={[aTicker, bTicker]}><ComparePageSkeleton /></BookOrSkeleton>;

  const aBook = peekEntry(aTicker);
  const bBook = peekEntry(bTicker);
  const bookAt = [aBook?.at, bBook?.at].reduce<number | null>((best, at) => (at && at > 0 ? (best == null ? at : Math.min(best, at)) : best), null);
  const bookFault = aBook?.status === 'error' || bBook?.status === 'error' ? 'failed' as const : null;

  return (
    <>
      {/* Box 1: both books on one ruler, each name's read in a folding panel at its own edge; the box moves to the viewport in fullscreen. */}
      <motion.div
        layout
        transition={{ layout: { duration: 0.32, ease: [0.16, 1, 0.3, 1] } }}
        /* The page's own ground when full. */
        className={rulerFull ? 'fixed inset-0 z-[80] bg-canvas flex flex-col' : 'relative border border-borderSubtle rounded-md bg-panel'}
        data-compare-ruler
        data-full={rulerFull || undefined}
      >
        <div className={`flex items-stretch min-w-0 ${rulerFull ? 'flex-1 min-h-0' : ''}`} data-compare-shell data-a={aTicker} data-b={bTicker}>
          {!belowLg && <CompareSidePanel side="a" s={cmp.a} cmp={cmp} unit={unit} greek={greek} greeks={greeks} chip={chipA} focus={focusA} onPick={onPick} open={sides.a} onToggle={() => toggleSide('a')} full={rulerFull} />}
          <div className={`flex-1 min-w-0 ${rulerFull ? 'min-h-0 flex flex-col' : ''}`} data-compare-middle>
            <Deferred index={0} fallback={<CompareAxisInner />} className={rulerFull ? 'flex-1 min-h-0 flex flex-col' : 'animate-fade-in'}>
              <CompareAxis cmp={cmp} unit={unit} reach={reach} onReach={setReach} greeks={greeks} greekPick={greekPick} onGreekPick={v => setGreekPick(nextGreekPick(greekPick, v))} expiryA={expiryA} expiryB={expiryB} onExpiryA={setPickA} onExpiryB={setPickB} palette={palette} onPalette={setPalette} focusA={focusA} focusB={focusB} onPick={onPick} onGuide={() => setGuideOpen(v => !v)} guideOpen={guideOpen} full={rulerFull} onFull={setRulerFull} />
            </Deferred>
          </div>
          {!belowLg && <CompareSidePanel side="b" s={cmp.b} cmp={cmp} unit={unit} greek={greek} greeks={greeks} chip={chipB} focus={focusB} onPick={onPick} open={sides.b} onToggle={() => toggleSide('b')} full={rulerFull} />}
        </div>
        {/* THE SENTENCE — what the two say against each other, once, under the ruler (the old table's verdicts) */}
        <div className="shrink-0 px-5 py-2.5 border-t border-borderSubtle/60 flex items-baseline gap-4 flex-wrap" data-compare-sentence>
          {/* a floor, so on a phone the doors wrap under the sentence instead of squeezing it to two words a line */}
          <p className="min-w-[min(18rem,100%)] flex-1 text-t12 leading-relaxed text-textSecondary">{cmp.sentence}</p>
          <span className="shrink-0 flex items-center gap-3">
            <button type="button" onClick={onSwap} className="font-mono text-t9 uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors" title="Swap the two names" data-compare-swap>
              swap
            </button>
            <span className="font-mono text-t9 uppercase tracking-widest text-textMuted whitespace-nowrap tabular-nums" data-compare-updated>
              updated {scan.at} · {cadenceWords()}
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

      {/* Box 2, since the open: today's two lines and the gap under them. */}
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
