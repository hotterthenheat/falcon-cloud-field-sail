/*
==================================================
  SLAYER TERMINAL - HOW THE LEVELS HELD TODAY
  (components/gex/WallReportCard.tsx)

  Levels earn trust in front of the reader (the
  Pinpoint roadmap, 2026-09-05). Every named level
  of today's map — the call wall, the flip, the put
  wall, the gamma pin, the supreme — with its record
  for the session: how many times price tested it,
  how many of those it held, how many it broke, when
  it was last touched, and whether the gamma behind
  it has grown or shrunk since the open.

  REDONE 2026-09-05 in the approved grammar (the
  positions cards): a row per level, hairlines and
  air instead of a table, labels over values, and
  the record drawn as a STRIP OF THE SESSION — one
  tick per test along the day, green where the
  level held, red where it broke — with a hover
  card that names the minute and the close. The
  strip is the picture the seven numbers used to
  stand in for.

  THE RECORD COMES OFF THE SAME BARS the chart
  draws, with the same rule the focus chip uses: a
  bar's range reaching the level is a test; a close
  beyond it after a test is a break. Nothing is
  judged by opinion.

  A ROW IS A STRIKE. Click one and it is the
  terminal's strike, on the rail above and the chip
  in the shell.
==================================================
*/

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { roomLevels } from '../../data/roomLevels';
import FoldDoor from './FoldDoor';
import { useBoxFold } from '../../data/boxFold';
import { sessionBars } from '../../data/levelview';
import { flipSidesWords } from '../../data/flipLevel';
import { flipCrossings } from '../../data/flipGauge';
import { deskBars, peekIv, ensureOiChange, peekOiChange, useBookRev } from '../../data/uwBook';
import { oiWhen, valueOiChange } from '../../data/building';
import { longDay, recordDay } from '../../data/bookWindow';
import { fmtDollars as fmtUsdShort } from '../../data/ahead';
import { sessionOfMinute, useDeskSession } from '../../data/deskSession';
import { nyClock, nyMinutes } from '../../core/nyTime';
import { baseRates, levelTicks, sessionRecords, type RecordLevel, type Tick } from '../../data/levelRecord';
import { CALL_WALL, FLIP, PUT_WALL, SUPREME } from './paletteInk';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import ReportGuide from './ReportGuide';
import type { Candle, MarketSnapshot } from '../../types/market';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const GREEN = 'rgb(var(--bull))';
const RED = 'rgb(var(--bear))';
const fmtStrike = (v: number) => (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
/* NEW YORK'S CLOCK, like "Last touched" beside it (the audit's H2, 2026-10-13): the browser's zone put 05:43 and 01:36 on one row for the same minute */
const hhmm = (unix: number) => nyClock(unix * 1000);

/* THE RULE FOR A TEST AND A BREAK lives in data/levelRecord.ts (`levelTicks`) since 2026-10-13, where the sessions before
   today are graded by the same rule — the base rates under the subtitle */

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
/* 28px since the report became one table (2026-10-14): a 40px row holds it, with price's path around the level still
   readable (the paying-user audit's H4) */
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
        {/* the session, as a hairline from the first bar to the newest — THE LEVEL, with price's path around it (the
            paying-user audit's H4, 2026-10-13: a bare hairline with three ticks said nothing between the tests; the path
            says how close price came and from which side) */}
        {/* the ink token, not white: on paper a white hairline was no hairline (the audit's H1) */}
        <line x1={8} x2={SW - 8} y1={SH / 2} y2={SH / 2} stroke="rgb(var(--ink))" strokeOpacity={0.18} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {/* no path of price round the level (Noah, 2026-10-14, with the picture: "remove the little charting looking thing … i like it as
            it was before") — the hairline and the ticks, as the report always drew them */}
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
          <span className="font-mono text-[11px] font-semibold tnum text-textPrimary">{hhmm(hover.time)}</span>
          <span className={`ml-2 text-[11px] font-medium ${hover.kind === 'broke' ? 'text-bear' : 'text-bull'}`}>{hover.kind === 'broke' ? 'broke' : 'tested, held'}</span>
          <span className="ml-2 font-mono text-[11px] tnum text-textMuted">close {hover.close.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
};

/* THE TABLE'S COLUMNS — the head row and every level row share them. On a phone: the level (its strike beside it), the
   three counts and the last touch; the strip, the trend and the base rate are the desk's. */
const GRID = 'grid gap-x-4 px-5 grid-cols-[minmax(0,1fr)_36px_36px_40px_48px] lg:grid-cols-[minmax(150px,1.1fr)_64px_minmax(180px,2fr)_40px_40px_44px_48px_minmax(120px,1fr)_92px]';

// ---- the section ----------------------------------------------------------------

/** `scope`: the host's chip saying which name's levels these are */
const WallReportCard = ({ snapshot, focus, onPick, scope, span, bars: barsProp, tight = false, unavailable: unavailableIn = null }: { snapshot: MarketSnapshot; focus: number | null; onPick: (price: number) => void; scope?: ReactNode; /** Plain words when the book today's session ran on is no longer available (after the close) — said instead of a table of zeros */ unavailable?: string | null; /** The expiry window the levels are read from ("Oct 21 → Oct 30") — the Map's book is wider than the Agenda's next session, so its walls can differ and the head says which window */ span?: string | null; /** The day so far, handed in — the Map's replay reads the bars up to its position (2026-09-08) */ bars?: readonly Candle[]; /** A name beside others — the phone's columns, so a third of the page still reads */ tight?: boolean }) => {
  const picked = useDeskSession();
  const session = barsProp?.length ? sessionOfMinute(nyMinutes(barsProp[0].time * 1000)) : picked;
  const bars = useMemo(() => {
    if (barsProp) return barsProp;
    if (session !== 'rth') return deskBars(snapshot.ticker, session) ?? [];
    return sessionBars(snapshot.ticker) ?? [];
  }, [snapshot, barsProp, session]);
  const grid = tight ? 'grid gap-x-3 px-3 grid-cols-[minmax(0,1fr)_32px_32px_36px_44px]' : GRID;
  const desk = tight ? 'hidden' : 'max-lg:hidden';
  const phone = tight ? '' : 'lg:hidden';
  /* THE BOOK HANDED IN IS ALREADY THE MAP'S WINDOW (bookForDates) — read as it stands, the band's own rule
     (ExposureField: a dated book is read '0DTE'). The desk's Levels card lives on the Board; read here it re-cut the
     window to the whole book under a head that still named the window (the ship pass, 2026-10-22). */
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
  /* NOTHING PROVISIONAL (the fourth audit's M1: "SUPREME 760" — the whole book's — for seconds before today's landed) */
  const pendingLevels = !!snapshot.liveBook && roomLevels(snapshot, '0DTE')?.complete === false;
  const unavailable = unavailableIn ?? (pendingLevels ? 'Loading the levels’ contracts…' : null);
  const rows = useMemo<Row[]>(() => {
    /* the room's one reading of the levels (data/roomLevels.ts): the band's window and scope, so the pin here is the pin
       the band tags (the re-audit's H6) */
    const levels = roomLevels(snapshot, levelsScope);
    if (!levels) return [];
    const mk = (key: string, label: string, ink: string, price: number, side: 'call' | 'put'): Row => {
      const ticks = levelTicks(bars, price, side);
      const broke = ticks.filter(t => t.kind === 'broke').length;
      const tests = ticks.length;
      const held = tests - broke;
      /* THE OVERNIGHT OPEN-INTEREST CHANGE AT THE LEVEL, NOT "GAMMA SINCE OPEN" (the Pinpoint audit, 2026-10-22: SPY 760
         read "39× growing", 764 "new today" and the flip — not a strike — "new today", off a history that walked today's
         volume onto the open interest; volume is not open interest). The vendor's count, contract by contract, on the
         Levels card's contracts only (Building's valueOiChange), as the change in the hedging's size at the strike. */
      let trend = 'not a strike';
      let trendFig = '';
      let trendWord = key === 'flip' ? 'not a strike' : '…';
      const v = key === 'flip' ? null : oiAt?.get(price);
      const node = snapshot.chain.find(n => Math.abs(n.strike - price) < 1e-9);
      if (key !== 'flip' && oiAt && node) {
        /* A WALL IS GRADED BY ITS OWN LEG (the eighth audit's M2: the 765 call wall "shrank $353M" off its net while 8,499
           calls were added to it): the call wall is the most call gamma, so its size is its call gamma; the put wall's its
           put gamma; the supreme (the most net) and the pin by the net — Building's rule (data/building.ts basis), decided
           by the strike so the levels sharing a row share one figure */
        const basis = price === levels.supreme ? 'net' : price === levels.callWall && price !== levels.putWall ? 'calls' : price === levels.putWall && price !== levels.callWall ? 'puts' : price === levels.callWall && price === levels.putWall ? 'both' : 'net';
        const now = basis === 'calls' ? node.callGex : basis === 'puts' ? node.putGex : node.netGex;
        const added = basis === 'calls' ? v?.call ?? 0 : basis === 'puts' ? v?.put ?? 0 : (v?.call ?? 0) + (v?.put ?? 0);
        const size = Math.abs(now) - Math.abs(now - added);
        const legWord = basis === 'net' ? '' : `${basis} `;
        const switched = basis === 'net' && Math.sign(now) !== Math.sign(now - added) && Math.abs(now - added) > 0.05 * Math.max(1, Math.abs(now));
        if (basis === 'both') {
          /* BOTH WALLS ON ONE STRIKE, EACH BY ITS OWN LEG (the ninth audit's M3): the call wall's calls and the put wall's
             puts, both said — never the net (NVDA 212.50 "shrank $14M" while both legs grew) */
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
          /* the wall's size in words, no sign beside a signed net (the seventh audit: "−$171M" read as the net falling) */
          trendFig = `${legWord}${size > 0 ? 'grew' : 'shrank'} ${fmtUsdShort(Math.abs(size))}`;
          /* the supreme that is also a wall: its net, then each wall's own leg (the ninth audit's M3) */
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
        /* THE BOARD'S COUNT, THE BOARD'S WORD (the ninth audit's M2): the flip is a price, not a strike — its row carries how
           many times price crossed it (one-minute closes changing side, data/flipGauge.ts flipCrossings) beside its tests */
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
    /* ONE COUNT PER STRIKE (the third audit, 2026-10-23: QQQ 708 read PUT WALL 32/23/9 and SUPREME 32/24/8 — the put wall
       was always tested from above, the supreme from its side of price, so one strike had two counts and two rows). Every
       level is tested from the side of price it sits on, so levels on one strike share one count and one row. */
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
    /* ONE ROW WHERE LEVELS COINCIDE (the audit's M5, 2026-10-13): the pin, the put wall and the supreme on one strike
       printed three rows with the same price, strip, chip and facts. Levels that share a strike and a side share a row,
       their names stacked in their own inks — the levels are the levels, only the presentation merges. */
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
    /* the names on a shared strike in the one order everywhere (core/walls.ts levelRoles): supreme · call wall · put wall,
       then the flip and the pin (the fourth audit's m1) */
    const ORDER = ['Supreme', 'Call wall', 'Put wall', 'Gamma flip', 'Gamma pin'];
    for (const r of merged) {
      r.labels.sort((a, b) => ORDER.indexOf(a.label) - ORDER.indexOf(b.label));
      r.label = r.labels.map(l => l.label).join(' · ');
    }
    /* THE ROWS IN THE ONE ORDER TOO (the sixth audit, 2026-10-23: Compare, the Dossier and this card listed the levels
       three ways) — supreme · call wall · put wall · flip, then the pin; a shared strike sits where its first name does */
    merged.sort((a, b) => ORDER.indexOf(a.labels[0]?.label ?? '') - ORDER.indexOf(b.labels[0]?.label ?? ''));
    return merged;
  }, [snapshot, bars, levelsScope, session, oiAt]);
  /* the flip's tip off THIS book's orientation (data/flipLevel.ts flipSidesWords) */
  const flipTip = useMemo(() => {
    const lv = roomLevels(snapshot, levelsScope);
    return lv && lv.flipFound !== false && lv.net != null ? flipSidesWords(lv.flip, lv.spot, lv.net) : null;
  }, [snapshot, levelsScope]);
  /* THE BASE RATES (data/levelRecord.ts): the sessions on hand before today, each level as it stood at its open, graded
     by the report's own rule — read, not stored; a machine on the vendor's two years grades two years */
  const rates = useMemo(() => baseRates(sessionRecords(snapshot.ticker, peekIv(snapshot.ticker))), [snapshot.ticker]);

  const first = bars[0]?.time;
  const last = bars[bars.length - 1]?.time;
  /* The guide as a focus over the whole box (the house pattern, 2026-09-06) */
  const [guideOpen, setGuideOpen] = useState(false);
  /* the box folds to its head, remembered (data/boxFold.ts) */
  const [open, toggleOpen] = useBoxFold('report');

  return (
    <section className="relative flex flex-col min-w-0" data-report-card>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the report" testId="report-guide" viewport>
        <ReportGuide rows={rows.map(r => ({ label: r.label, price: r.price, tests: r.tests, held: r.held, broke: r.broke, grade: r.grade.words, trend: r.trend }))} bars={bars.length} from={first != null ? hhmm(first) : null} />
      </GuideFocus>
      {/* THE HEAD: the name, its scope, its doors, and the one base rate that is not a row's (2026-10-14, the owner: the
          report was "AI slop" — a subtitle, a sentence over four labelled figures, a pill restating every row's counts, and
          five labels printed over again on each row). What a test and a break are, and how the rates are graded, is the
          guide's. */}
      <div className="px-5 pt-4 pb-3 flex items-center gap-x-3 gap-y-2 flex-wrap">
        {/* THE SESSION ON RECORD, NAMED (the fifth audit, 2026-10-23: "How the levels held today" over Thursday's bars at
            01:00 Friday) — "today" only while it is today's session */}
        <h3 className="text-[16px] font-semibold leading-tight text-textPrimary" data-report-day={rec.date}>How the levels held {rec.isToday ? 'today' : `· ${longDay(rec.date)}`}</h3>
        {scope}
        {span && <span className="font-mono text-[11px] text-textMuted whitespace-nowrap" title="The contracts these levels are read from — the Levels card at the top of the page, the same as the Board's" data-report-span>{span}</span>}
        <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the rows, the strips and the ticks mean" testId="report-guide" />
        <FoldDoor open={open} onToggle={toggleOpen} what="the report" testId="report" />
        {rates.insideMove.n > 0 && (
          <span
            className="ml-auto inline-flex items-baseline gap-2 font-mono whitespace-nowrap"
            title={`How many of the ${rates.insideMove.n} sessions before ${dayW} closed inside the one move their options priced at the open`}
            data-base-rate="close"
            data-base-rates={rates.sessions}
          >
            <span className="text-[11px] uppercase tracking-wider text-textMuted">Closed inside the expected move</span>
            <span className="text-[13px] font-semibold tnum text-textPrimary">
              {rates.insideMove.inside} of {rates.insideMove.n}
            </span>
          </span>
        )}
      </div>
      {open && unavailable && (
        <p className="px-5 pb-4 font-mono text-[12px] text-textSecondary border-t border-borderSubtle/60 pt-3" data-report-unavailable>
          {unavailable}
        </p>
      )}
      {open && !unavailable && (
        <div className="font-mono" role="table" aria-label={`${rec.isToday ? "Today's" : `${longDay(rec.date)}'s`} levels and how each held`} data-level-rows>
          {/* THE COLUMNS, NAMED ONCE (the matrix's own head): a row per level under them */}
          <div className={`${grid} h-8 items-center border-t border-borderSubtle/60 text-[11px] uppercase tracking-wider text-textMuted`} role="row">
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
                {/* THE WHOLE ROW KEEPS THE STRIKE (the audit: only the name did, and the row read as the target) */}
                <button
                  type="button"
                  onClick={() => onPick(r.price)}
                  className={`${grid} w-full min-h-10 py-1.5 items-center text-left hover:bg-ink/[0.03] transition-colors group`}
                  title={`${r.labels.map(l => `${l.label} ${fmtStrike(r.price)}: ${(l.label === 'Gamma flip' && flipTip) || (LEVEL_TIPS[l.label.toLowerCase()] ?? '')}`).join('\n')}\n${r.grade.words} · click to keep the strike`}
                  aria-pressed={isFocus}
                  data-level-pick
                >
                  <span className="min-w-0 flex items-baseline gap-x-2 flex-wrap" role="cell">
                    <span className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] font-semibold uppercase tracking-wider" data-level-labels={r.labels.length}>
                      {r.labels.map((l, i) => (
                        <span key={l.label} style={{ color: l.ink }}>
                          {i > 0 && <span className="font-normal text-textMuted">· </span>}
                          {l.label}
                        </span>
                      ))}
                    </span>
                    {/* on a phone the strike rides beside the name; on the desk it has its own column */}
                    <span className={`${phone} text-[13px] font-semibold tnum ${isFocus ? 'text-silver' : 'text-textPrimary'}`}>{fmtStrike(r.price)}</span>
                  </span>
                  <span role="cell" className={`${desk} text-right text-[13px] font-semibold tnum ${isFocus ? 'text-silver' : 'text-textPrimary group-hover:text-silver'}`}>
                    {fmtStrike(r.price)}
                  </span>
                  <span role="cell" className={`${desk} min-w-0`}>
                    <SessionStrip row={r} bars={bars} />
                  </span>
                  <span role="cell" className="text-right text-[12px] tnum text-textPrimary">{r.tests}</span>
                  <span role="cell" className={`text-right text-[12px] tnum ${r.held > 0 ? 'text-bull' : 'text-textMuted'}`}>{r.held}</span>
                  <span role="cell" className={`text-right text-[12px] tnum ${r.broke > 0 ? 'text-bear' : 'text-textMuted'}`}>{r.broke}</span>
                  <span role="cell" className={`text-right text-[12px] tnum ${r.last ? 'text-textPrimary' : 'text-textMuted'}`}>{r.last ?? '—'}</span>
                  <span role="cell" className={`${desk} min-w-0 whitespace-nowrap text-[12px]`}>
                    {r.trendFig && <span className="tnum font-semibold text-textPrimary mr-1.5">{r.trendFig}</span>}
                    <span className="text-textSecondary">{r.trendWord}</span>
                  </span>
                  <span role="cell" className={`${desk} text-right text-[12px] tnum ${rate ? 'text-textPrimary' : 'text-textMuted'}`} data-base-rate={r.rate ?? undefined}>
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
