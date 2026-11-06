/* The Trader's Clock: today's 09:30–16:00 session as 78 five-minute blocks in the phases hedging lives by, each with today's figures
   (the lunch pin, the charm window, the share expiring at 4:00). The phases are a rule of thumb; now is readSessionClock (New York). */

import { GLOSSARY } from './glossary';
import { drawnLevels, levelsFor } from '../../data/levelsFor';
import { levelsForName } from '../../data/levelsScope';
import { bellNone as bellNoneWords, BELL_NONE_TITLE } from '../../data/flipLevel';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import FoldDoor from './FoldDoor';
import { useBoxFold } from '../../data/boxFold';
import { surfaceBellShare, buildExposureSurface, CALENDAR_DTES } from '../../data/exposureSurface';
import { roomLevels } from '../../data/roomLevels';
import { buildVannaCharm } from '../../data/vannacharm';
import { readSessionClock } from '../../data/moc';
import { sessionMeta, sessionOfMinute, minuteInSession, type DeskSession } from '../../data/deskSession';
import { deskBars, peekBellShare } from '../../data/book/levels';
import { useResolvedSession } from '../../data/book/feed';
import { bellDay } from '../../data/bookWindow';
import { nyMinutes } from '../../core/nyTime';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import ClockGuide from './ClockGuide';
import type { MarketSnapshot } from '../../types/market';
import { alpha, pressureInks } from './paletteInk';
import { useLedgerPalette } from '../../data/ledgerPalette';
import { fmtStrike } from '../../core/format';
import { nextOpenWords } from '../../data/marketState';
import { nextOpenLine, sessionAt } from '../../core/session';

const LIVE = 'rgb(var(--select))';
const SILVER = 'rgb(var(--silver))';
const OPEN_MIN = 9 * 60 + 30;
const CLOSE_MIN = 16 * 60;
const SPAN = CLOSE_MIN - OPEN_MIN; // 390 trading minutes
const BLOCK_MIN = 5;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

interface Phase {
  key: string;
  from: number;
  to: number;
  name: string;
  /** What dominates, with today's figures in it */
  words: (f: ClockFacts) => string;
  /** How hard hedging pushes in this phase, 0..1 — the block's shade */
  weight: number;
  /** What the hedging does to a move in this phase, where the rule of thumb is
      clear enough to say — the hover card's one meaningful ink. The morning
      depends on which side of the flip price is, so it says nothing. */
  pressure?: 'absorbs' | 'amplifies';
}

export interface ClockFacts {
  pin: number | null;
  charmStrike: number | null;
  charmMoves: string | null;
  bellShare: number | null;
  supreme: number | null;
  flip: number | null;
  /** The flip is still being read (its contracts or pricing landing): a null flip then is "…", never "no flip" */
  flipPending?: boolean;
}

/* The schedule, in trading minutes from midnight ET. Weights are the strip's
   own emphasis — a hedging day is quiet in the middle and loud at both ends,
   and the close is the loudest hour of all. */
export const PHASES: Phase[] = [
  {
    key: 'open',
    from: OPEN_MIN,
    to: 10 * 60,
    name: 'The open',
    weight: 0.75,
    pressure: 'amplifies',
    words: f => `the day's walls get set — ${f.supreme != null ? `the heaviest strike (the supreme) is ${fmtStrike(f.supreme)}` : 'the heaviest strike is being decided'}; today's option premium burns fastest here`,
  },
  {
    key: 'morning',
    from: 10 * 60,
    to: 11 * 60 + 30,
    name: 'The morning',
    weight: 0.5,
    words: f => `the trend hour — ${f.flip != null ? `${fmtStrike(f.flip)} is the flip, where dealer hedging switches between absorbing and chasing moves` : f.flipPending ? 'the flip is still being priced (…)' : 'no flip within reach, so the hedging leans one way all day'}`,
  },
  {
    key: 'lunch',
    from: 11 * 60 + 30,
    to: 14 * 60,
    name: 'Lunch',
    weight: 0.3,
    pressure: 'absorbs',
    words: f => `volatility usually goes quiet${f.pin != null ? ` — ${fmtStrike(f.pin)} holds the most open interest, a heavy strike, not a level price is drawn to` : ''}`,
  },
  {
    key: 'charm',
    from: 14 * 60,
    to: 15 * 60 + 30,
    name: 'Charm window',
    weight: 0.7,
    pressure: 'amplifies',
    words: f => `dealers unwind hedges as today's options lose their delta (charm) — ${f.charmStrike != null ? `strongest at ${fmtStrike(f.charmStrike)}` : 'this is the force now'}${f.charmMoves ? ` · ${f.charmMoves}` : ''}`,
  },
  {
    key: 'turn',
    from: 15 * 60 + 30,
    to: 15 * 60 + 50,
    name: 'The turn',
    weight: 0.9,
    pressure: 'absorbs',
    words: f => `today's gamma peaks, then starts to fade — on a long-gamma book moves tend to be damped most now${f.pin != null ? `; the most open interest is at ${fmtStrike(f.pin)}` : ''}`,
  },
  {
    key: 'auction',
    from: 15 * 60 + 50,
    to: CLOSE_MIN,
    name: 'The close',
    weight: 1,
    pressure: 'amplifies',
    /* "At the close", not "4:00": the box prints its hours as 09:30 … 16:00. */
    words: f => `the closing auction — ${f.bellShare != null ? `${f.bellShare}% of the gamma expires at the close (${bellDay().date})` : 'the session’s gamma expires at the close'}`,
  },
];

interface Win {
  from: number;
  to: number;
  wraps: boolean;
  span: number;
}

function windowOf(session: DeskSession): Win {
  if (session === 'rth') return { from: OPEN_MIN, to: CLOSE_MIN, wraps: false, span: SPAN };
  const w = sessionMeta(session);
  return { from: w.from, to: w.to, wraps: w.wraps, span: w.wraps ? 24 * 60 - w.from + w.to : w.to - w.from };
}

function offsetOf(min: number, win: Win): number {
  if (!win.wraps) return min - win.from;
  return min >= win.from ? min - win.from : 24 * 60 - win.from + min;
}

function minuteOf(offset: number, win: Win): number {
  if (!win.wraps) return win.from + offset;
  return (win.from + offset) % (24 * 60);
}

function rangeBetween(bars: readonly { time: number; high: number; low: number }[], from: number, to: number): number {
  let lo = Infinity;
  let hi = -Infinity;
  let n = 0;
  for (const b of bars) {
    const m = nyMinutes(b.time * 1000);
    const inside = to > from ? m >= from && m < to : m >= from || m < to;
    if (!inside) continue;
    lo = Math.min(lo, b.low);
    hi = Math.max(hi, b.high);
    n++;
  }
  return n ? hi - lo : 0;
}

/** The hours of a window that is not the cash session. Each one says what actually printed. */
function hourPhases(win: Win, bars: readonly { time: number; high: number; low: number }[]): Phase[] {
  const spans: { from: number; to: number; range: number }[] = [];
  let off = 0;
  while (off < win.span) {
    const from = minuteOf(off, win);
    const step = (Math.floor(from / 60) + 1) * 60 - from || 60;
    const toOff = Math.min(win.span, off + step);
    const to = minuteOf(toOff, win);
    spans.push({ from, to, range: rangeBetween(bars, from, to) });
    if (toOff <= off) break;
    off = toOff;
  }
  const max = spans.reduce((m, s) => Math.max(m, s.range), 0);
  return spans.map(s => ({
    key: `h${s.from}`,
    from: s.from,
    to: s.to,
    name: hhmm(s.from),
    weight: max > 0 && s.range > 0 ? 0.35 + 0.65 * (s.range / max) : 0.2,
    words: f => {
      const where = f.pin != null ? `. The most open interest is at ${fmtStrike(f.pin)}` : '';
      if (!(s.range > 0)) return `no print in this hour${where}`;
      let lo = Infinity;
      let hi = -Infinity;
      for (const b of bars) {
        const m = nyMinutes(b.time * 1000);
        const inside = s.to > s.from ? m >= s.from && m < s.to : m >= s.from || m < s.to;
        if (!inside) continue;
        lo = Math.min(lo, b.low);
        hi = Math.max(hi, b.high);
      }
      return `printed ${lo.toFixed(2)}–${hi.toFixed(2)}${where}`;
    },
  }));
}
/* One-word phase names; under `lg` they stand on two rows with the close's at the strip's right edge. The full names are in the card. */
const SHORT_NAME: Record<string, string> = { open: 'Open', morning: 'Morning', lunch: 'Lunch', charm: 'Charm', turn: 'Turn', auction: 'Close' };
const PRESSURE_WORDS = { absorbs: 'absorbs moves', amplifies: 'amplifies moves' } as const;
/* A block's ink is the hedging pair (ember amplifies, glacier absorbs); the morning, which leans with the flip, in the page's ink. */
/* The pressure pair follows the Map's palette (paletteInk pressureInks). */

/* A fact on the head's line: its name in tracked capitals, the figure beside it. */
const CLOCK_TIPS: Record<string, string> = {
  Now: "The time in New York and the part of the trading day it falls in",
  Next: 'The next part of the day and how long until it starts',
  'Expires at the close': "The share of all the name's hedging, every expiry counted, in contracts that expire at 4:00 today",
};
const ClockFact = ({ label, children, tip }: { label: string; children: ReactNode; tip?: string }) => (
  <span className="inline-flex items-baseline gap-2 whitespace-nowrap pr-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-borderSubtle [&:not(:first-child)]:pl-3" title={tip ?? CLOCK_TIPS[label]}>
    <span className="text-t11 uppercase tracking-wider text-textMuted">{label}</span>
    <span className="text-t13 font-semibold text-textPrimary">{children}</span>
  </span>
);

/** What the reader has kept: one block, or one whole phase */
type Pin = { kind: 'block'; i: number } | { kind: 'phase'; key: string } | null;

/** `scope`: the host's chip naming the figures' name. `at`: minutes from midnight ET to stand at instead of now (the Map's replay).
    `onSeek`: during a replay a click moves it to that minute instead of keeping a block. */
const TraderClock = ({ snapshot, scope, at, onSeek, dates }: { snapshot: MarketSnapshot; scope?: ReactNode; at?: number | null; onSeek?: (min: number) => void; /** The date the levels are read off (the Levels card). The share that dies at the close is of the whole book. */ dates?: readonly string[] | null }) => {
  const clock = readSessionClock();
  const [hover, setHover] = useState<number | null>(null);
  const [pin, setPin] = useState<Pin>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  /* the box folds to its head, remembered (data/boxFold.ts) */
  const [open, toggleOpen] = useBoxFold('clock');
  /* Under 520 px the strip holds 26 quarter-hour blocks (78 would be ~2 px buttons); a kept block reads as its first minute. */
  const [stripW, setStripW] = useState(0);
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const read = () => setStripW(prev => (prev === el.clientWidth ? prev : el.clientWidth));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);
  const narrow = stripW > 0 && stripW < 520;
  /* the phase names on two rows, short, when the strip is under 760px — measured off the strip, not the window, so the
     clock laid beside the report on a wide desk (idea 4) reads as it does on a phone */
  const twoRows = stripW > 0 && stripW < 760;
  const read = useResolvedSession(snapshot.ticker);
  const shown: DeskSession = at != null ? sessionOfMinute(at) : read.session;
  const cash = shown === 'rth';
  const win = useMemo(() => windowOf(shown), [shown]);
  const tape = useMemo(() => {
    if (cash) return [];
    const all = deskBars(snapshot.ticker, shown) ?? [];
    if (at == null) return all;
    const first = all.length ? nyMinutes(all[0].time * 1000) : win.from;
    const key = (m: number) => (win.wraps && m < first ? m + 24 * 60 : m);
    const cut = key(at);
    return all.filter(b => key(nyMinutes(b.time * 1000)) <= cut);
  }, [cash, snapshot, shown, at, win]);
  const phases = useMemo(() => (cash ? PHASES : hourPhases(win, tape)), [cash, win, tape]);
  const blockMin = narrow ? 15 : BLOCK_MIN;
  const blocks = win.span / blockMin;
  const pctAt = (min: number) => (offsetOf(min, win) / win.span) * 100;
  const phaseAtMin = (min: number) => phases.find(p => (p.to > p.from ? min >= p.from && min < p.to : min >= p.from || min < p.to)) ?? phases[phases.length - 1];
  const blockRanges = useMemo(() => {
    if (cash) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < blocks; i++) out.push(rangeBetween(tape, minuteOf(i * blockMin, win), minuteOf((i + 1) * blockMin, win)));
    return out;
  }, [cash, blocks, blockMin, tape, win]);
  const maxRange = blockRanges.reduce((m, r) => Math.max(m, r), 0);
  /* a kept block means a different minute once the blocks change size — let it go rather than keep the wrong one */
  useEffect(() => {
    setPin(p => (p?.kind === 'block' ? null : p));
    setHover(null);
  }, [narrow, shown]);
  /* The guide as a focus over the whole box. */
  const [guideOpen, setGuideOpen] = useState(false);
  /* the strip's two inks and the hover card's word — the Map's palette, thermal by rest */
  const PRESSURE_INK = pressureInks(useLedgerPalette());

  /* A click on a block keeps it; a click on a phase name keeps the phase; again lets go. In a replay the click scrubs instead. */
  const onBlockClick = (i: number) => {
    if (onSeek) {
      onSeek(minuteOf(i * blockMin, win));
      return;
    }
    setPin(p => (p?.kind === 'block' && p.i === i ? null : { kind: 'block', i }));
  };
  const onNameClick = (key: string) => {
    if (onSeek) {
      const phase = phases.find(p => p.key === key);
      if (phase) onSeek(phase.from);
      return;
    }
    setPin(p => (p?.kind === 'phase' && p.key === key ? null : { kind: 'phase', key }));
  };

  /* A click anywhere outside the strip and its names lets go */
  useEffect(() => {
    if (!pin) return;
    const onDown = (e: PointerEvent) => {
      const root = stripRef.current;
      if (root && !root.contains(e.target as Node)) setPin(null);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [pin]);

  /* Today's figures, off the same engines the rest of the page reads */
  const facts = useMemo<ClockFacts>(() => {
    let pinStrike: number | null = null;
    let supreme: number | null = null;
    let flip: number | null = null;
    let charmStrike: number | null = null;
    let charmMoves: string | null = null;
    let bellShare: number | null = null;
    let wallsIn = true;
    let flipPending = false;
    try {
      /* the same levels the tape and the report read — the book's window, not a tighter slice */
      const levels = roomLevels(snapshot, '0DTE');
      if (levels) {
        pinStrike = levels.pinFound === false ? null : levels.pin;
        supreme = levels.supreme;
        flip = levels.flipFound === false ? null : levels.flip;
      }
      /* On a live book the named levels are levelsFor's, in the Levels card's scope, through the one gate (drawnLevels).
         Nothing comes off a stand-in book: no supreme or pin until the scope's own contracts are in, no flip until it is
         final. The pin stays today's. */
      if (snapshot.liveBook) {
        const d = drawnLevels(levelsFor(snapshot.ticker, levelsForName(snapshot.ticker)));
        wallsIn = d.wallsIn;
        supreme = d.supreme;
        flip = d.flip;
        flipPending = !d.flipIn;
        if (!d.wallsIn) pinStrike = null;
      }
    } catch {
      /* no chain yet */
    }
    try {
      /* the charm read names the walls it moves, so it waits for them too */
      if (!wallsIn) throw new Error('levels pending');
      const vc = buildVannaCharm(snapshot, 'CHARM', -1);
      charmStrike = vc.read.charm.price;
      const moved = vc.shifts.filter(s => Math.abs(s.projected - s.current) > 1e-9);
      /* The engine's labels carry its own word "node"; the reader gets the level's name alone */
      charmMoves = moved.length ? `into the close it moves ${moved.map(s => `${s.label.toLowerCase().replace(/\s*node\b/, '')} ${fmtStrike(s.current)} → ${fmtStrike(s.projected)}`).join(', ')}` : 'the levels hold into the close';
    } catch {
      /* no chain yet */
    }
    try {
      /* The Board's share: the feed's gamma per expiry, today's date against every live date; the older reads stand in until it lands. */
      const feed = peekBellShare(snapshot.ticker);
      if (feed.share != null || feed.why === 'none' || snapshot.liveBook) {
        /* a live book waits for the Board's share ("…") rather than print a different one in the meantime */
        bellShare = feed.share;
      } else {
        bellShare = surfaceBellShare(buildExposureSurface(snapshot, 20, CALENDAR_DTES));
      }
    } catch {
      /* no surface yet */
    }
    return { pin: pinStrike, supreme, flip, flipPending, charmStrike, charmMoves, bellShare };
  }, [snapshot, dates]);

  /* no share because nothing on the name expires today — said on the figure's hover */
  const bellPeek = peekBellShare(snapshot.ticker);
  const bellNone = bellPeek.share == null && bellPeek.why === 'none';

  /* Where NOW sits — New York minutes; outside the session there is no lit block */
  const [h, m] = clock.etTime.split(':').map(Number);
  const rawNow = at != null ? at : h * 60 + m;
  const nowMin = cash && at != null ? Math.max(OPEN_MIN, Math.min(CLOSE_MIN - 1, at)) : rawNow;
  const inSession = cash ? (at != null ? true : clock.phase === 'OPEN' || clock.phase === 'AUCTION') : minuteInSession(nowMin, shown);
  const nowBlock = inSession ? Math.min(blocks - 1, Math.floor(offsetOf(nowMin, win) / blockMin)) : null;
  const phaseIndex = inSession ? phases.findIndex(p => offsetOf(nowMin, win) >= offsetOf(p.from, win) && offsetOf(nowMin, win) < Math.max(offsetOf(p.to, win), offsetOf(p.from, win) + 1)) : -1;
  const current = phaseIndex >= 0 ? phases[phaseIndex] : null;
  const nextPhase = current && phaseIndex < phases.length - 1 ? phases[phaseIndex + 1] : null;

  /* What is kept, and what the card shows: the hovered block first, else the
     kept block; a kept phase rings its blocks and owns the sentence */
  const keptBlock = pin?.kind === 'block' ? pin.i : null;
  const keptPhase = pin?.kind === 'phase' ? phases.find(p => p.key === pin.key) ?? null : null;
  const shownBlock = hover ?? keptBlock;
  /* One tab stop: the kept (or current) block takes Tab; Left/Right move, Enter keeps, Escape lets go. */
  const focusBlock = keptBlock ?? nowBlock ?? 0;
  const onStripKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = hover ?? keptBlock ?? nowBlock ?? 0;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1);
    else if (e.key === 'ArrowRight') next = Math.min(blocks - 1, cur + 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = blocks - 1;
    else if (e.key === 'Escape') {
      setPin(null);
      setHover(null);
      return;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onBlockClick(cur);
      return;
    } else return;
    e.preventDefault();
    setHover(next);
  };
  /* The strip is one target (a slider): the block under the pointer is the one it means, so a finger or a mouse never
     has to land on a 10-20 px block, and the 2 px gaps between them are not dead. */
  const blockAt = (e: { clientX: number; currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!(r.width > 0)) return null;
    return Math.max(0, Math.min(blocks - 1, Math.floor(((e.clientX - r.left) / r.width) * blocks)));
  };
  /* the guide draws the desk's 78 five-minute blocks whatever the strip's width — the cash session's picture */
  const guideNow = cash && inSession ? Math.min(SPAN / BLOCK_MIN - 1, Math.floor((nowMin - OPEN_MIN) / BLOCK_MIN)) : null;
  const shownMin = shownBlock != null ? minuteOf(shownBlock * blockMin, win) : null;
  const shownPhase = shownMin != null ? phaseAtMin(shownMin) : null;
  const cardPct = shownBlock != null ? ((shownBlock + 0.5) / blocks) * 100 : 0;
  const cardOnRight = shownBlock != null ? shownBlock < blocks * 0.6 : true;
  /* The card opens under the strip, or over it near the screen's foot; read only while a block is shown. */
  const cardAbove = shownBlock != null && typeof window !== 'undefined' && (stripRef.current?.getBoundingClientRect().bottom ?? 0) + 150 > window.innerHeight;

  const untilNext = nextPhase ? offsetOf(nextPhase.from, win) - offsetOf(nowMin, win) : 0;
  const keptMin = keptBlock != null ? minuteOf(keptBlock * blockMin, win) : null;
  const keptPhaseNow = keptMin != null ? phaseAtMin(keptMin) : null;
  const line = keptPhaseNow
    ? `${hhmm(keptMin!)}, ${cash ? keptPhaseNow.name.toLowerCase() : keptPhaseNow.name} — ${keptPhaseNow.words(facts)}.`
    : keptPhase
      ? `${keptPhase.name}, ${hhmm(keptPhase.from)} to ${hhmm(keptPhase.to)} — ${keptPhase.words(facts)}.`
      : current
        ? `${current.name} — ${current.words(facts)}${nextPhase ? `. ${nextPhase.name} in ${untilNext} minutes.` : '.'}`
        : cash
          ? `${clock.label} — when it opens: ${PHASES[0].words(facts)}.`
          : `${sessionMeta(shown).label.toLowerCase()} · ${sessionMeta(shown).window}.`;

  const lookingAt = keptPhaseNow ? `${hhmm(keptMin!)} · ${keptPhaseNow.name}` : keptPhase ? `${keptPhase.name} · ${hhmm(keptPhase.from)}–${hhmm(keptPhase.to)}` : null;

  return (
    <section className="relative h-full flex flex-col min-w-0" data-trader-clock>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the clock" testId="clock-guide" viewport>
        <ClockGuide nowBlock={guideNow} line={line} bellShare={facts.bellShare} pin={facts.pin} supreme={facts.supreme} charmStrike={facts.charmStrike} />
      </GuideFocus>
      {/* The head: the name, its scope and doors, then the facts on one mono line (beside the report they take the line under the name). */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
        <h3 className="text-t16 font-semibold leading-tight text-textPrimary">The trader's clock</h3>
        {scope}
        <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the strip and the phases mean" testId="clock-guide" />
        <FoldDoor open={open} onToggle={toggleOpen} what="the clock" testId="clock" />
        <div className="ml-auto flex items-baseline flex-wrap gap-y-1 font-mono" data-clock-facts>
          {lookingAt ? (
            <ClockFact label="Looking at">
              <span className="tnum" style={{ color: SILVER }} data-clock-looking>
                {lookingAt}
              </span>
              <button onClick={() => setPin(null)} className="hit ml-3 text-t11 font-medium uppercase tracking-wider text-textMuted hover:text-textPrimary transition-colors" data-back-to-now>
                Back to now
              </button>
            </ClockFact>
          ) : (
            <>
              <ClockFact label="Now">
                <span data-clock-now>
                  {inSession && current ? (
                    <>
                      <span className="tnum">{hhmm(nowMin)}</span> <span className="font-normal text-textSecondary" title={current.key === 'charm' ? GLOSSARY.charm : undefined}>{(SHORT_NAME[current.key] ?? current.name).toLowerCase()}</span>
                    </>
                  ) : (
                    <span className="font-normal text-textSecondary">{cash ? clock.label.toLowerCase() : 'outside this window'}</span>
                  )}
                </span>
              </ClockFact>
              <ClockFact label="Next">
                {nextPhase ? (
                  <>
                    <span className="font-normal text-textSecondary underline decoration-dotted decoration-textMuted/60 underline-offset-2 cursor-help" title={`${nextPhase.name} starts in ${untilNext} minutes${nextPhase.key === 'charm' ? `\n${GLOSSARY.charm}` : ''}`}>{(SHORT_NAME[nextPhase.key] ?? nextPhase.name).toLowerCase()}</span> <span className="tnum">{untilNext}m</span>
                  </>
                ) : inSession ? (
                  <span className="font-normal text-textSecondary">{cash ? 'the close' : shown === 'pre' ? 'the open' : 'the end'}</span>
                ) : (
                  <>
                    {/* the day it opens when that is not today (a weekend, a holiday, after the close) */}
                    <span className="font-normal text-textSecondary" title={nextOpenWords() ? `The market's next session: ${nextOpenWords()!.long}` : undefined}>{cash ? (nextOpenLine(sessionAt(Date.now(), 'equityOption')) ?? 'regular session opens 9:30 AM ET') : sessionMeta(shown).label.toLowerCase()}</span>{' '}
                    {!cash && <span className="tnum">{hhmm(win.from)}</span>}
                  </>
                )}
              </ClockFact>
            </>
          )}
          {/* In the page's ink; magenta is the supreme's marker alone. */}
          {/* After the close the share is the next session's, said with its day (bookWindow bellDay). */}
          <ClockFact label={bellDay().clock} tip={`${bellDay().tip(snapshot.ticker)} — every expiry counted`}>
            <span
              className="tnum"
              data-clock-bell
              title={facts.bellShare != null ? `${facts.bellShare}% — ${bellDay().tip(snapshot.ticker)}` : bellNone ? BELL_NONE_TITLE(snapshot.ticker) : 'Still reading the expiry list'}
            >
              {facts.bellShare != null ? `${facts.bellShare}%` : bellNone ? bellNoneWords() : '…'}
            </span>
            {facts.bellShare != null && <span className="ml-1.5 font-normal text-textSecondary">of gamma</span>}
          </ClockFact>
        </div>
      </div>

      {open && (
      <div className="px-5 pb-4 flex-1 flex flex-col justify-center" ref={stripRef}>
        {/* The strip keeps its 28 px; beside the report the phases, strip and hours centre in the height the box has. */}
        {/* Phase names on one row at their phase's start, except the turn (20 min) ends at 15:50 where the close's (10 min) begins. */}
        {/* ON A TOUCH SCREEN the two rows stand 46 apart and the strip starts under the second's finger boxes (the
            last-targets pass, 2026-10-30): a name over another 18px below it shared its 44px box with that one */}
        <div className={`relative ${narrow ? 'h-9 [@media(pointer:coarse)]:h-[74px]' : 'h-[18px]'}`} data-clock-phases>
          {phases.map((p, i) => {
            const active = current?.key === p.key;
            const kept = keptPhase?.key === p.key || (keptBlock != null && phaseAtMin(minuteOf(keptBlock * blockMin, win)).key === p.key);
            const turn = cash && p.key === 'turn';
            const last = cash ? p.key === 'auction' : i === phases.length - 1;
            /* With something kept, its name stays sharp and the others go soft with their blocks */
            const nameCls = kept ? 'text-textPrimary' : pin ? 'text-textMuted/50 hover:text-textPrimary' : active ? '' : 'text-textMuted hover:text-textPrimary';
            return (
              <button
                key={p.key}
                data-phase-name={p.key}
                aria-pressed={keptPhase?.key === p.key}
                onClick={() => onNameClick(p.key)}
                /* Under lg: every other name on the second row. */
                /* The close's name on the strip's right edge at every width; from its own start it ran past the box. */
                /* pt-[7px] -mt-[7px]: the name's box reaches 24px up into the head's gap (the strip is under it), the word stays put */
                /* !absolute: on a touch screen the Pinpoint frame's `.hit` on every button (position: relative) won, and the
                   names fell into a row of their own, off their phases and past the box's edge (the last-targets pass) */
                className={`hit !absolute pt-[7px] -mt-[7px] font-mono text-t11 font-semibold uppercase tracking-wider whitespace-nowrap ${nameCls} ${narrow && i % 2 === 1 ? 'top-[18px] [@media(pointer:coarse)]:top-[46px]' : 'top-0'} ${last ? '!left-auto !right-0 !translate-x-0' : ''} ${turn && !narrow ? '!left-auto !right-[52px] !translate-x-0' : ''}`}
                style={{
                  left: `${pctAt(turn ? p.to : p.from)}%`,
                  transform: turn ? 'translateX(calc(-100% - 6px))' : last ? 'translateX(2px)' : undefined,
                  ...(active ? { color: SILVER } : {}),
                }}
                title={`${hhmm(p.from)}–${hhmm(p.to)} — ${onSeek ? 'click to move the replay here' : 'click to keep this phase'}${p.key === 'charm' ? `\n${GLOSSARY.charm}` : ''}`}
              >
                {SHORT_NAME[p.key] ?? hhmm(p.from)}
              </button>
            );
          })}
        </div>

        {/* THE STRIP — 78 five-minute blocks; shade = the phase's weight, silver = now */}
        {/* Beside the report (from 1,880 px) the strip takes the box's spare height; 22 px otherwise. */}
        <div className="relative flex flex-col" onPointerLeave={() => setHover(null)}>
          {/* a narrow strip is the thumb's height (44px) — the blocks are the targets, and 10px wide is all the width a quarter
              hour gets on a phone; the height is ours to give */}
          <div
            className={`flex gap-[2px] cursor-pointer rounded-[2px] focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-silver/60 ${narrow ? 'h-11' : 'h-7'}`}
            data-clock-strip
            data-block-minutes={blockMin}
            role="slider"
            tabIndex={0}
            aria-label={`Today's session as ${narrow ? 'fifteen' : 'five'}-minute blocks, shaded by how hard hedging pushes — the arrow keys walk them, Enter keeps one`}
            aria-valuemin={0}
            aria-valuemax={blocks - 1}
            aria-valuenow={hover ?? focusBlock}
            aria-valuetext={(() => {
              const at = minuteOf((hover ?? focusBlock) * blockMin, win);
              return `${hhmm(at)} · ${phaseAtMin(at).name}`;
            })()}
            onKeyDown={onStripKeys}
            onFocus={() => setHover(h => h ?? focusBlock)}
            onBlur={() => setHover(null)}
            onPointerMove={e => {
              const i = blockAt(e);
              if (i != null && i !== hover) setHover(i);
            }}
            onClick={e => {
              const i = blockAt(e);
              if (i != null) onBlockClick(i);
            }}
          >
            {Array.from({ length: blocks }, (_, i) => {
              const min = minuteOf(i * blockMin, win);
              const p = phaseAtMin(min);
              const isNow = nowBlock === i;
              const future = nowBlock != null && i > nowBlock;
              const inCurrent = current?.key === p.key;
              const hovered = hover === i;
              /* What is kept is in focus and the rest dims and blurs; a block under the pointer is always in focus. */
              const inFocus = hovered || (keptPhase ? p.key === keptPhase.key : keptBlock != null ? i === keptBlock : true);
              const soft = !!pin && !inFocus;
              /* The phase you are in sits a touch brighter than its weight alone;
                 the block under the pointer, or a kept one, brighter still */
              const depth = cash
                ? Math.min(0.95, 0.3 + p.weight * 0.45 + (inCurrent ? 0.08 : 0) + (hovered ? 0.25 : 0) + (!hovered && pin && inFocus ? 0.15 : 0))
                : (maxRange > 0 && (blockRanges[i] ?? 0) > 0 ? Math.min(0.95, 0.28 + 0.62 * ((blockRanges[i] ?? 0) / maxRange) + (hovered ? 0.12 : 0)) : 0.16);
              const wash = !cash || !p.pressure ? `rgb(var(--text-primary) / ${(depth * (cash ? 0.55 : 0.7)).toFixed(3)})` : alpha(PRESSURE_INK[p.pressure], depth);
              const boundary = i > 0 && phaseAtMin(minuteOf(i * blockMin - 1, win)).key !== p.key;
              const dim = hover != null && !hovered;
              return (
                <div
                  key={i}
                  data-block={i}
                  data-phase={p.key}
                  data-focus={pin ? (inFocus ? 'in' : 'soft') : undefined}
                  data-kept={keptBlock === i ? 'true' : undefined}
                  className={`flex-1 min-w-0 rounded-[2px] ${boundary ? 'ml-[3px]' : ''}`}
                  style={{
                    /* the ink's wash — light on the dark terminal, near-black on paper (the white washes were "so bright") */
                    background: isNow ? LIVE : wash,
                    opacity: soft ? 0.3 : dim ? 0.55 : future ? 0.45 : 1,
                    filter: soft ? 'blur(1.2px)' : undefined,
                    boxShadow: isNow ? `0 0 0 1px ${LIVE}` : undefined,
                  }}
                />
              );
            })}
          </div>
          {/* the hours under the strip */}
          <div className="relative h-4 mt-1">
            {(cash ? [OPEN_MIN, 10 * 60, 11 * 60, 12 * 60, 13 * 60, 14 * 60, 15 * 60, CLOSE_MIN] : [minuteOf(win.span, win)]).map(t => (
              <span
                key={t}
                /* A phone's strip labels four hours, not eight. */
                className={`absolute top-0 font-mono text-t11 tnum text-textMuted ${twoRows && (cash ? t === 10 * 60 || t === 11 * 60 || t === 13 * 60 || t === 15 * 60 : false) ? 'hidden' : ''}`}
                style={{ left: `${pctAt(t)}%`, transform: pctAt(t) > 96 ? 'translateX(-100%)' : pctAt(t) < 4 ? undefined : 'translateX(-50%)' }}
              >
                {hhmm(t)}
              </span>
            ))}
          </div>
          {/* THE CARD — the hovered block's, else the kept block's: the minute, its
              phase, the phase's sentence for today, and one meaningful ink */}
          {shownBlock != null && shownMin != null && shownPhase && (
            <div
              data-clock-card
              data-kept={keptBlock === shownBlock ? 'true' : 'false'}
              className={`absolute z-10 pointer-events-none rounded-lg border border-borderMuted bg-card/95 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] px-3 py-2 ${narrow ? 'left-0 right-0' : 'w-[300px]'}`}
              /* The card sits under the strip so it never covers the box's facts; on a narrow strip it takes the strip's width. */
              style={{ ...(cardAbove ? { bottom: 'calc(100% + 22px)' } : { top: 'calc(100% + 4px)' }), ...(narrow ? {} : { left: `${cardPct}%`, transform: cardOnRight ? 'translateX(12px)' : 'translateX(calc(-100% - 12px))' }) }}
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-t12 font-semibold tnum" style={{ color: keptBlock === shownBlock ? SILVER : undefined }}>
                  {hhmm(shownMin)}
                </span>
                <span className="text-t11 font-medium text-textPrimary">{shownPhase.name}</span>
                <span className="ml-auto font-mono text-t11 tnum text-textMuted">
                  {hhmm(shownPhase.from)}–{hhmm(shownPhase.to)}
                </span>
              </div>
              <p className="mt-1 text-t11 leading-snug text-textSecondary">{shownPhase.words(facts)}.</p>
              {shownPhase.pressure && (
                <span className="mt-1 block font-mono text-t11 font-semibold uppercase tracking-wider" data-pressure={shownPhase.pressure} style={{ color: PRESSURE_INK[shownPhase.pressure] }}>
                  {PRESSURE_WORDS[shownPhase.pressure]}
                </span>
              )}
              <span className="block mt-1 text-t11 text-textMuted">{onSeek ? 'click to move the replay here' : keptBlock === shownBlock ? 'kept · click anywhere else to let go' : 'click to keep · the phase names above keep a whole phase'}</span>
            </div>
          )}
        </div>

        {/* No sentence under the strip: the phase's words are the card's and the guide's. */}
      </div>
      )}
    </section>
  );
};

export default TraderClock;
