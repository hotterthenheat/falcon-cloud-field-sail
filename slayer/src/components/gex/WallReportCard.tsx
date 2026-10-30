/* How the levels held today: each named level's session record (tests, holds, breaks, last touch, OI change) and a strip
   of the session, one tick per test. A test is a bar reaching the level; a close beyond it after a test is a break. A row click keeps the strike. */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { roomLevels } from '../../data/roomLevels';
import FoldDoor from './FoldDoor';
import { useBoxFold } from '../../data/boxFold';
import { sessionBars } from '../../data/levelview';
import { flipSidesWords } from '../../data/flipLevel';
import { flipCrossings } from '../../data/flipGauge';
import { deskBars, peekIv, ensureOiChange, peekOiChange, useBookRev, useResolvedSession } from '../../data/uwBook';
import { oiWhen, valueOiChange } from '../../data/building';
import { aheadWord, longDay, recordDay } from '../../data/bookWindow';
import { fmtDollars as fmtUsdShort } from '../../data/ahead';
import { sessionOfMinute } from '../../data/deskSession';
import { useTapeRev, wantTape } from '../../data/thetaTape';
import { nyClock, nyMinutes } from '../../core/nyTime';
import { baseRates, levelTicks, sessionRecords, type RecordLevel, type Tick } from '../../data/levelRecord';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './paletteInk';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import ReportGuide from './ReportGuide';
import type { Candle, MarketSnapshot } from '../../types/market';
import { fmtStrike } from '../../core/format';

const SILVER = 'rgb(var(--silver))';
const GREEN = 'rgb(var(--bull))';
const RED = 'rgb(var(--bear))';
/* New York's clock, as "Last touched" beside it. */
const hhmm = (unix: number) => nyClock(unix * 1000);

/* The rule for a test and a break lives in data/levelRecord.ts (`levelTicks`), which grades earlier sessions the same way. */

/** Each level in one plain line — the row's hover */
const LEVEL_TIPS: Record<string, string> = {
  'call wall': 'the strike with the most call gamma, either side of price; while dealers are long gamma there it tends to slow a rise, and once price is through it, it can act as support.',
  'put wall': 'the strike with the most put gamma, either side of price; below price it is support while it holds (dealers are short gamma there, so a break can accelerate); above price it is overhead put hedging, not a floor — a rally into it can speed up selling, or it can act as a magnet.',
  'gamma flip': 'where dealer hedging switches sides. Above it hedging absorbs moves, below it amplifies them.',
  flip: 'where dealer hedging switches sides. Above it hedging absorbs moves, below it amplifies them.',
  'gamma pin': 'the strike with the most open contracts near price; price often drifts toward it, mostly through lunch.',
  pin: 'the strike with the most open contracts near price; price often drifts toward it, mostly through lunch.',
  supreme: 'the single strike with the most dealer hedging on it.',
};

interface Row {
  key: string;
  label: string;
  ink: string;
  /** The names on this row — more than one where levels share a strike (see the merge below) */
  labels: { label: string; ink: string }[];
  price: number;
  side: 'call' | 'put';
  ticks: Tick[];
  tests: number;
  held: number;
  broke: number;
  last: string | null;
  trend: string;
  /** the trend as the table prints it: the figure first, the word after it */
  trendFig: string;
  trendWord: string;
  grade: { words: string; tone: 'good' | 'bad' | 'quiet' };
  /** which of the base rates speaks for this row — the first of its names that has one (the pin has none) */
  rate: RecordLevel | null;
}

/* which base rate a row's name reads (data/levelRecord.ts RecordLevel) */
const RATE_OF: Record<string, RecordLevel | undefined> = { call: 'callWall', put: 'putWall', flip: 'flip', supreme: 'supreme' };

// ---- the strip ----------------------------------------------------------------

const SW = 600;
/* 28 px strip in a 40 px row. */
const SH = 28;

const SessionStrip = ({ row, bars }: { row: Row; bars: readonly Candle[] }) => {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Tick | null>(null);
  const n = Math.max(1, bars.length - 1);
  const x = (i: number) => 8 + (i / n) * (SW - 16);
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg || !row.ticks.length) return;
    const r = svg.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * SW;
    const near = row.ticks.reduce((b, t) => (Math.abs(x(t.i) - u) < Math.abs(x(b.i) - u) ? t : b), row.ticks[0]);
    setHover(Math.abs(x(near.i) - u) < 14 ? near : null);
  };
  /* price above the level rides above the line, below it under — scaled to the farthest it went either way */
  const cardLeft = hover ? (x(hover.i) / SW) * 100 : 0;
  const onRight = hover ? x(hover.i) < SW * 0.6 : true;
  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg ref={ref} viewBox={`0 0 ${SW} ${SH}`} width="100%" height={SH} preserveAspectRatio="none" data-session-strip onPointerMove={onMove} style={{ display: 'block', cursor: row.ticks.length ? 'crosshair' : 'default' }} role="img" aria-label={`${row.label}: ${row.tests} tests along the session`}>
        {/* The session as a hairline from the first bar to the newest. */}
        {/* The ink token, not white, so the hairline shows on paper. */}
        <line x1={8} x2={SW - 8} y1={SH / 2} y2={SH / 2} stroke="rgb(var(--ink))" strokeOpacity={0.18} strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {/* one tick per test */}
        {row.ticks.map(t => (
          <line
            key={`${t.i}-${t.kind}`}
            x1={x(t.i)}
            x2={x(t.i)}
            y1={t.kind === 'broke' ? 4 : 8}
            y2={t.kind === 'broke' ? SH - 4 : SH - 8}
            stroke={t.kind === 'broke' ? RED : GREEN}
            strokeOpacity={hover && hover !== t ? 0.45 : 0.9}
            strokeWidth={t.kind === 'broke' ? 2 : 1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* now — the newest bar */}
        <line x1={SW - 8} x2={SW - 8} y1={6} y2={SH - 6} stroke={SILVER} strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      {hover && (
        <div
          data-strip-card
          className="absolute -top-1 z-10 pointer-events-none rounded-md border border-borderMuted bg-card/95 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] px-2.5 py-1.5 whitespace-nowrap"
          style={{ left: `${cardLeft}%`, transform: onRight ? 'translate(12px, -100%)' : 'translate(calc(-100% - 12px), -100%)' }}
        >
          <span className="font-mono text-t11 font-semibold tnum text-textPrimary">{hhmm(hover.time)}</span>
          <span className={`ml-2 text-t11 font-medium ${hover.kind === 'broke' ? 'text-bear' : 'text-bull'}`}>{hover.kind === 'broke' ? 'broke' : 'tested, held'}</span>
          <span className="ml-2 font-mono text-t11 tnum text-textMuted">close {hover.close.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
};

/* The table's columns, shared by the head and every row. On a phone: the level, three counts and the last touch. */
const GRID = 'grid gap-x-4 px-5 grid-cols-[minmax(0,1fr)_36px_36px_40px_48px] lg:grid-cols-[minmax(150px,1.1fr)_64px_minmax(180px,2fr)_40px_40px_44px_48px_minmax(120px,1fr)_92px]';

// ---- the section ----------------------------------------------------------------

/** `scope`: the host's chip saying which name's levels these are */
const WallReportCard = ({ snapshot, focus, onPick, scope, span, bars: barsProp, tight = false, unavailable: unavailableIn = null }: { snapshot: MarketSnapshot; focus: number | null; onPick: (price: number) => void; scope?: ReactNode; /** Plain words when the book today's session ran on is no longer available (after the close) — said instead of a table of zeros */ unavailable?: string | null; /** The expiry window the levels are read from ("Oct 21 → Oct 30") — the Map's book is wider than the Agenda's next session, so its walls can differ and the head says which window */ span?: string | null; /** The day so far, handed in; the Map's replay reads the bars up to its position. */ bars?: readonly Candle[]; /** A name beside others — the phone's columns, so a third of the page still reads */ tight?: boolean }) => {
  const read = useResolvedSession(snapshot.ticker);
  const session = barsProp?.length ? sessionOfMinute(nyMinutes(barsProp[0].time * 1000)) : read.session;
  const handed = barsProp != null;
  useEffect(() => {
    if (handed) return;
    return wantTape(snapshot.ticker, '1m', session);
  }, [snapshot.ticker, session, handed]);
  const tapeRev = useTapeRev();
  const bars = useMemo(() => {
    if (barsProp) return barsProp;
    if (session !== 'rth') return deskBars(snapshot.ticker, session) ?? [];
    return sessionBars(snapshot.ticker) ?? [];
  }, [snapshot, barsProp, session, tapeRev]);
  const grid = tight ? 'grid gap-x-3 px-3 grid-cols-[minmax(0,1fr)_32px_32px_36px_44px]' : GRID;
  const desk = tight ? 'hidden' : 'max-lg:hidden';
  const phone = tight ? '' : 'lg:hidden';
  /* The book handed in is already the Map's window (bookForDates), read as a dated book ('0DTE') like the band does. */
  const levelsScope = '0DTE' as const;
  /* the overnight open-interest change on these contracts, strike by strike (data/building.ts valueOiChange) */
  const bookRev = useBookRev();
  const rec = recordDay();
  const dayW = rec.isToday ? 'today' : longDay(rec.date);
  const oiNow = peekOiChange(snapshot.ticker);
  const oiWords = oiNow?.lastDate && oiNow.currDate ? oiWhen({ from: oiNow.lastDate, to: oiNow.currDate }) : null;
  const oiAt = useMemo(() => {
    ensureOiChange(snapshot.ticker);
    const ch = peekOiChange(snapshot.ticker);
    /* the session on record's own contracts count too (a settled date's book, graded before today's open) */
    return ch && ch.rows.length ? valueOiChange(snapshot, snapshot.chain, ch, recordDay().date) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, bookRev]);
  /* Nothing provisional: no levels until today's contracts land. */
  const pendingLevels = !!snapshot.liveBook && roomLevels(snapshot, '0DTE')?.complete === false;
  const unavailable = unavailableIn ?? (pendingLevels ? 'Loading the levels’ contracts…' : null);
  const rows = useMemo<Row[]>(() => {
    /* The room's one reading of the levels (data/roomLevels.ts), so the pin here is the pin the band tags. */
    const levels = roomLevels(snapshot, levelsScope);
    if (!levels) return [];
    const mk = (key: string, label: string, ink: string, price: number, side: 'call' | 'put'): Row => {
      const ticks = levelTicks(bars, price, side);
      const broke = ticks.filter(t => t.kind === 'broke').length;
      const tests = ticks.length;
      const held = tests - broke;
      /* The overnight open-interest change at the level (Building's valueOiChange, on the Levels card's contracts), not "gamma since
         the open": volume is not open interest. */
      let trend = 'not a strike';
      let trendFig = '';
      let trendWord = key === 'flip' ? 'not a strike' : '…';
      const v = key === 'flip' ? null : oiAt?.get(price);
      const node = snapshot.chain.find(n => Math.abs(n.strike - price) < 1e-9);
      if (key !== 'flip' && oiAt && node) {
        /* A wall is graded by its own leg: the call wall by its call gamma, the put wall by its put gamma, the supreme and pin by the net
           (data/building.ts basis), decided by strike so levels sharing a row share a figure. */
        const basis = price === levels.supreme ? 'net' : price === levels.callWall && price !== levels.putWall ? 'calls' : price === levels.putWall && price !== levels.callWall ? 'puts' : price === levels.callWall && price === levels.putWall ? 'both' : 'net';
        const now = basis === 'calls' ? node.callGex : basis === 'puts' ? node.putGex : node.netGex;
        const added = basis === 'calls' ? v?.call ?? 0 : basis === 'puts' ? v?.put ?? 0 : (v?.call ?? 0) + (v?.put ?? 0);
        const size = Math.abs(now) - Math.abs(now - added);
        const legWord = basis === 'net' ? '' : `${basis} `;
        const switched = basis === 'net' && Math.sign(now) !== Math.sign(now - added) && Math.abs(now - added) > 0.05 * Math.max(1, Math.abs(now));
        if (basis === 'both') {
          /* Both walls on one strike: each by its own leg, never the net. */
          const leg = (g: number, a: number) => Math.abs(g) - Math.abs(g - a);
          const cs = leg(node.callGex, v?.call ?? 0);
          const ps = leg(node.putGex, v?.put ?? 0);
          const w = (x: number) => (Math.abs(x) < 0.5 ? 'held' : `${x > 0 ? 'grew' : 'shrank'} ${fmtUsdShort(Math.abs(x))}`);
          trendFig = `calls ${w(cs)} · puts ${w(ps)}`;
          trendWord = oiWords?.day ? oiWords.day : 'overnight';
          trend = `the call wall and the put wall on one strike, each read by its own leg: its call gamma ${w(cs)}, its put gamma ${w(ps)} ${trendWord}`;
        } else if (switched) {
          /* a strike that changed sides has no one size — both figures, retail sign */
          const f = (x: number) => `${-x > 0 ? '+' : -x < 0 ? '−' : ''}${fmtUsdShort(Math.abs(x))}`;
          trendFig = `flipped ${f(now - added)} → ${f(now)}`;
          trendWord = oiWords?.day ? oiWords.day : 'overnight';
          trend = `${now < 0 ? 'call-heavy' : 'put-heavy'} now, ${now - added < 0 ? 'call-heavy' : 'put-heavy'} before ${oiWords?.trade ?? 'the overnight count'} (${f(now - added)} → ${f(now)})`;
        } else if (Math.abs(size) < 0.05 * Math.max(1, Math.abs(now))) {
          trendWord = 'steady';
          trend = `about where it was before ${oiWords?.trade ?? 'the overnight count'}`;
        } else {
          /* The wall's size in words, no sign beside a signed net. */
          trendFig = `${legWord}${size > 0 ? 'grew' : 'shrank'} ${fmtUsdShort(Math.abs(size))}`;
          /* The supreme that is also a wall: its net, then each wall's own leg. */
          if (basis === 'net' && price === levels.supreme && (price === levels.callWall || price === levels.putWall)) {
            const leg = (g: number, a: number) => Math.abs(g) - Math.abs(g - a);
            const w = (x: number) => (Math.abs(x) < 0.5 ? 'held' : `${x > 0 ? 'grew' : 'shrank'} ${fmtUsdShort(Math.abs(x))}`);
            const legs = [price === levels.callWall ? `calls ${w(leg(node.callGex, v?.call ?? 0))}` : null, price === levels.putWall ? `puts ${w(leg(node.putGex, v?.put ?? 0))}` : null].filter(Boolean).join(' · ');
            trendFig = `net ${trendFig} · ${legs}`;
          }
          trendWord = oiWords?.day ? oiWords.day : 'overnight';
          trend = `${basis === 'calls' ? 'its call gamma ' : basis === 'puts' ? 'its put gamma ' : ''}${size > 0 ? 'grew' : 'shrank'} ${fmtUsdShort(Math.abs(size))} ${trendWord}${basis === 'net' ? '' : ` — a ${basis === 'calls' ? 'call' : 'put'} wall is the most ${basis === 'calls' ? 'call' : 'put'} gamma, so it is read by that leg`}`;
        }
      }
      if (key === 'flip' && bars.length >= 2) {
        /* The flip is a price, not a strike: its row counts crossings (one-minute closes changing side, flipGauge flipCrossings). */
        const n = flipCrossings(bars, price);
        trendFig = `crossed ${n}×`;
        trendWord = 'not a strike';
        trend = `price crossed the flip ${n}× (closes changing side) — the count the Board prints; the tests are the bars that reached it`;
      }
      const lastTouch = ticks.length ? nyClock(ticks[ticks.length - 1].time * 1000) : null;
      const grade: Row['grade'] =
        tests === 0 ? { words: 'untested', tone: 'quiet' } : broke === 0 ? { words: `held every test`, tone: 'good' } : held === 0 ? { words: 'broke every test', tone: 'bad' } : { words: `broke ${broke} of ${tests}`, tone: broke * 2 >= tests ? 'bad' : 'quiet' };
      return { key, label, ink, labels: [{ label, ink }], price, side, ticks, tests, held, broke, last: lastTouch, trend, trendFig, trendWord, grade, rate: RATE_OF[key] ?? null };
    };
    const spot = levels.spot;
    /* One count per strike: every level is tested from the side of price it sits on, so levels on one strike share a count and a row. */
    const sideOf = (k: number): 'call' | 'put' => (k >= spot ? 'call' : 'put');
    const out: Row[] = [
      mk('call', 'Call wall', CALL_WALL, levels.callWall, sideOf(levels.callWall)),
      /* no crossing within ±10% is no flip, and no row — the card's foot says so */
      ...(levels.flipFound === false ? [] : [mk('flip', 'Gamma flip', FLIP, levels.flip, sideOf(levels.flip))]),
      mk('put', 'Put wall', PUT_WALL, levels.putWall, sideOf(levels.putWall)),
      /* a pin only where dealers are long gamma and price is near it (data/exposure.ts) */
      ...(levels.pinFound === false ? [] : [mk('pin', 'Gamma pin', 'rgb(var(--text-primary))', levels.pin, sideOf(levels.pin))]),
      mk('supreme', 'Supreme', SUPREME, levels.supreme, sideOf(levels.supreme)),
    ];
    // Highest price first — the section reads like the ladder above it
    const sorted = out.sort((a, b) => b.price - a.price || a.key.localeCompare(b.key));
    /* One row where levels coincide on a strike and side, their names stacked in their own inks. */
    const merged: Row[] = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.price - r.price) < 1e-9) {
        last.labels.push({ label: r.label, ink: r.ink });
        last.rate = last.rate ?? r.rate;
        last.key = `${last.key}+${r.key}`;
        last.label = `${last.label} · ${r.label}`;
      } else merged.push(r);
    }
    /* Names on a shared strike in the one order (core/walls.ts levelRoles), then the flip and the pin. */
    const ORDER = ['Supreme', 'Call wall', 'Put wall', 'Gamma flip', 'Gamma pin'];
    for (const r of merged) {
      r.labels.sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label));
      r.label = r.labels.map(l => l.label).join(' · ');
    }
    /* Rows in the same order; a shared strike sits where its first name does. */
    merged.sort((a, b) => ORDER.indexOf(a.labels[0]?.label ?? '') - ORDER.indexOf(b.labels[0]?.label ?? ''));
    return merged;
  }, [snapshot, bars, levelsScope, session, oiAt]);
  /* the flip's tip off THIS book's orientation (data/flipLevel.ts flipSidesWords) */
  const flipTip = useMemo(() => {
    const lv = roomLevels(snapshot, levelsScope);
    return lv && lv.flipFound !== false && lv.net != null ? flipSidesWords(lv.flip, lv.spot, lv.net) : null;
  }, [snapshot, levelsScope]);
  /* Base rates (data/levelRecord.ts): earlier sessions on hand, each level as it stood at that open, graded by the same rule. */
  const rates = useMemo(() => baseRates(sessionRecords(snapshot.ticker, peekIv(snapshot.ticker))), [snapshot.ticker]);

  const first = bars[0]?.time;
  const last = bars[bars.length - 1]?.time;
  /* The guide as a focus over the whole box. */
  const [guideOpen, setGuideOpen] = useState(false);
  /* the box folds to its head, remembered (data/boxFold.ts) */
  const [open, toggleOpen] = useBoxFold('report');

  return (
    <section className="relative flex flex-col min-w-0" data-report-card>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the report" testId="report-guide" viewport>
        <ReportGuide rows={rows.map(r => ({ label: r.label, price: r.price, tests: r.tests, held: r.held, broke: r.broke, grade: r.grade.words, trend: r.trend }))} bars={bars.length} from={first != null ? hhmm(first) : null} />
      </GuideFocus>
      {/* The head: the name, its scope, its doors, and the one base rate that is not a row's; definitions are the guide's. */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
        {/* The session on record, named: "today" only while it is today's session. */}
        {/* …and its book once the session has closed: a finished session is graded against its own book, dated beside the table. */}
        <h3 className="text-t16 font-semibold leading-tight text-textPrimary" data-report-day={rec.date}>How the levels held {rec.isToday && !rec.done ? 'today' : `· ${longDay(rec.date)}`}</h3>
        {scope}
        {rec.done && (
          <span className="font-mono text-t11 text-textSecondary whitespace-nowrap" title={`The levels in this table are the ones ${longDay(rec.date)}'s session ran on — this name's levels read ${aheadWord() === 'today' ? "today's" : "the next session's"} contracts, so its walls and supreme can differ`} data-report-book>
            {longDay(rec.date)}'s book · the head reads {aheadWord() === 'today' ? "today's" : "the next session's"}
          </span>
        )}
        {span && <span className="font-mono text-t11 text-textMuted whitespace-nowrap" title="The contracts these levels are read from — this name's levels, the same as the Board's" data-report-span>{span}</span>}
        <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the rows, the strips and the ticks mean" testId="report-guide" />
        <FoldDoor open={open} onToggle={toggleOpen} what="the report" testId="report" />
        {rates.insideMove.n > 0 && (
          <span
            className="ml-auto inline-flex items-baseline gap-2 font-mono whitespace-nowrap"
            title={`How many of the ${rates.insideMove.n} sessions before ${dayW} closed inside the one move their options priced at the open`}
            data-base-rate="close"
            data-base-rates={rates.sessions}
          >
            <span className="text-t11 uppercase tracking-wider text-textMuted">Closed inside the expected move</span>
            <span className="text-t13 font-semibold tnum text-textPrimary">
              {rates.insideMove.inside} of {rates.insideMove.n}
            </span>
          </span>
        )}
      </div>
      {open && unavailable && (
        <p className="px-5 pb-4 font-mono text-t12 text-textSecondary border-t border-borderSubtle/60 pt-3" data-report-unavailable>
          {unavailable}
        </p>
      )}
      {open && !unavailable && (
        <div className="font-mono" role="table" aria-label={`${rec.isToday ? "Today's" : `${longDay(rec.date)}'s`} levels and how each held`} data-level-rows>
          {/* THE COLUMNS, NAMED ONCE (the matrix's own head): a row per level under them */}
          <div className={`${grid} h-8 items-center border-t border-borderSubtle/60 text-t11 uppercase tracking-wider text-textMuted`} role="row">
            <span role="columnheader" title="Which level the row is: call wall, put wall, flip, pin or supreme — hover a row for what it means">Level</span>
            <span role="columnheader" className={`${desk} text-right`} title="The level's price">Strike</span>
            <span role="columnheader" className={desk}>
              Session <span className="normal-case tracking-normal tnum">{first != null ? `${hhmm(first)} → ${last != null ? hhmm(last) : 'now'}` : ''}</span>
            </span>
            <span role="columnheader" className="text-right" title={`How many one-minute bars reached the level ${rec.isToday ? 'today' : `on ${longDay(rec.date)}`}`}>Tests</span>
            <span role="columnheader" className="text-right" title="Tests where the bar closed back on the near side — the level held">Held</span>
            <span role="columnheader" className="text-right" title="Tests where the bar closed through the level">Broke</span>
            <span role="columnheader" className="text-right" title="The time price last reached the level">Last</span>
            <span role="columnheader" className={desk} title={`How the hedging at the level changed in the overnight open-interest count${oiWords ? ` — ${oiWords.long}` : ''}, on these contracts, each valued at its own gamma. The flip is a price, not a strike, so it has none${oiWords?.pending ? ` · ${oiWords.pending}` : ''}`}>{oiWords?.day ? `Built ${oiWords.day}` : oiNow ? 'Built overnight' : 'Built …'}</span>
            <span role="columnheader" className={`${desk} text-right whitespace-nowrap`} title={rates.sessions > 0 ? `How often the level's first test held, over the ${rates.sessions} sessions before ${dayW} — each read off its own open, never a later book` : `No sessions before ${dayW} on hand`}>
              Before {rec.isToday ? 'today' : rec.date.slice(5).replace('-', '/')}
            </span>
          </div>
          {rows.map(r => {
            const isFocus = focus != null && Math.abs(focus - r.price) < 1e-9;
            const rate = r.rate && rates.levels[r.rate].tested > 0 ? rates.levels[r.rate] : null;
            return (
              <div key={r.key} role="row" className={`border-t border-borderSubtle/40 ${isFocus ? 'bg-silver/[0.05]' : ''}`} data-level={r.key}>
                {/* The whole row keeps the strike. */}
                <button
                  type="button"
                  onClick={() => onPick(r.price)}
                  className={`${grid} w-full min-h-10 py-1.5 items-center text-left hover:bg-ink/[0.03] transition-colors group`}
                  title={`${r.labels.map(l => `${l.label} ${fmtStrike(r.price)}: ${(l.label === 'Gamma flip' && flipTip) || (LEVEL_TIPS[l.label.toLowerCase()] ?? '')}`).join('\n')}\n${r.grade.words} · click to keep the strike`}
                  aria-pressed={isFocus}
                  data-level-pick
                >
                  <span className="min-w-0 flex items-baseline gap-x-2 flex-wrap" role="cell">
                    <span className="flex flex-wrap items-baseline gap-x-1.5 text-t11 font-semibold uppercase tracking-wider" data-level-labels={r.labels.length}>
                      {r.labels.map((l, i) => (
                        <span key={l.label} style={{ color: l.ink }}>
                          {i > 0 && <span className="font-normal text-textMuted">· </span>}
                          {l.label}
                        </span>
                      ))}
                    </span>
                    {/* on a phone the strike rides beside the name; on the desk it has its own column */}
                    <span className={`${phone} text-t13 font-semibold tnum ${isFocus ? 'text-silver' : 'text-textPrimary'}`}>{fmtStrike(r.price)}</span>
                  </span>
                  <span role="cell" className={`${desk} text-right text-t13 font-semibold tnum ${isFocus ? 'text-silver' : 'text-textPrimary group-hover:text-silver'}`}>
                    {fmtStrike(r.price)}
                  </span>
                  <span role="cell" className={`${desk} min-w-0`}>
                    <SessionStrip row={r} bars={bars} />
                  </span>
                  <span role="cell" className="text-right text-t12 tnum text-textPrimary">{r.tests}</span>
                  <span role="cell" className={`text-right text-t12 tnum ${r.held > 0 ? 'text-bull' : 'text-textMuted'}`}>{r.held}</span>
                  <span role="cell" className={`text-right text-t12 tnum ${r.broke > 0 ? 'text-bear' : 'text-textMuted'}`}>{r.broke}</span>
                  <span role="cell" className={`text-right text-t12 tnum ${r.last ? 'text-textPrimary' : 'text-textMuted'}`}>{r.last ?? '—'}</span>
                  <span role="cell" className={`${desk} min-w-0 whitespace-nowrap text-t12`}>
                    {r.trendFig && <span className="tnum font-semibold text-textPrimary mr-1.5">{r.trendFig}</span>}
                    <span className="text-textSecondary">{r.trendWord}</span>
                  </span>
                  <span role="cell" className={`${desk} text-right text-t12 tnum ${rate ? 'text-textPrimary' : 'text-textMuted'}`} data-base-rate={r.rate ?? undefined}>
                    {rate ? `${rate.heldFirst} of ${rate.tested}` : '—'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default WallReportCard;
