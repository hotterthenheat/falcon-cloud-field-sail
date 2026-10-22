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
import { deskBars, peekIv, ensureOiChange, peekOiChange, useBookRev } from '../../data/uwBook';
import { valueOiChange } from '../../data/building';
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
  'call wall': 'the strike above price with the most call hedging; it tends to slow a rise.',
  'put wall': 'the strike below price with the most put hedging; it tends to slow a fall.',
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
const WallReportCard = ({ snapshot, focus, onPick, scope, span, bars: barsProp, tight = false }: { snapshot: MarketSnapshot; focus: number | null; onPick: (price: number) => void; scope?: ReactNode; /** The expiry window the levels are read from ("Oct 21 → Oct 30") — the Map's book is wider than the Agenda's next session, so its walls can differ and the head says which window */ span?: string | null; /** The day so far, handed in — the Map's replay reads the bars up to its position (2026-09-08) */ bars?: readonly Candle[]; /** A name beside others — the phone's columns, so a third of the page still reads */ tight?: boolean }) => {
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
  const oiAt = useMemo(() => {
    ensureOiChange(snapshot.ticker);
    const ch = peekOiChange(snapshot.ticker);
    return ch && ch.rows.length ? valueOiChange(snapshot, snapshot.chain, ch) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, bookRev]);
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
        const now = node.netGex;
        const added = (v?.call ?? 0) + (v?.put ?? 0);
        const size = Math.abs(now) - Math.abs(now - added);
        if (Math.abs(size) < 0.05 * Math.max(1, Math.abs(now))) {
          trendWord = 'steady overnight';
          trend = 'about where it was before yesterday’s trading';
        } else {
          trendFig = `${size > 0 ? '+' : '−'}${fmtUsdShort(Math.abs(size))}`;
          trendWord = size > 0 ? 'added overnight' : 'taken off overnight';
          trend = `${trendFig} ${trendWord}`;
        }
      }
      const lastTouch = ticks.length ? nyClock(ticks[ticks.length - 1].time * 1000) : null;
      const grade: Row['grade'] =
        tests === 0 ? { words: 'untested', tone: 'quiet' } : broke === 0 ? { words: `held every test`, tone: 'good' } : held === 0 ? { words: 'broke every test', tone: 'bad' } : { words: `broke ${broke} of ${tests}`, tone: broke * 2 >= tests ? 'bad' : 'quiet' };
      return { key, label, ink, labels: [{ label, ink }], price, side, ticks, tests, held, broke, last: lastTouch, trend, trendFig, trendWord, grade, rate: RATE_OF[key] ?? null };
    };
    const spot = levels.spot;
    const out: Row[] = [
      mk('call', 'Call wall', CALL_WALL, levels.callWall, 'call'),
      /* no crossing within ±10% is no flip, and no row — the card's foot says so */
      ...(levels.flipFound === false ? [] : [mk('flip', 'Gamma flip', FLIP, levels.flip, levels.flip >= spot ? 'call' : 'put')]),
      mk('put', 'Put wall', PUT_WALL, levels.putWall, 'put'),
      /* a pin only where dealers are long gamma and price is near it (data/exposure.ts) */
      ...(levels.pinFound === false ? [] : [mk('pin', 'Gamma pin', 'rgb(var(--text-primary))', levels.pin, levels.pin >= spot ? 'call' : 'put')]),
      mk('supreme', 'Supreme', SUPREME, levels.supreme, levels.supreme >= spot ? 'call' : 'put'),
    ];
    // Highest price first — the section reads like the ladder above it
    const sorted = out.sort((a, b) => b.price - a.price || a.key.localeCompare(b.key));
    /* ONE ROW WHERE LEVELS COINCIDE (the audit's M5, 2026-10-13): the pin, the put wall and the supreme on one strike
       printed three rows with the same price, strip, chip and facts. Levels that share a strike and a side share a row,
       their names stacked in their own inks — the levels are the levels, only the presentation merges. */
    const merged: Row[] = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.price - r.price) < 1e-9 && last.side === r.side) {
        last.labels.push({ label: r.label, ink: r.ink });
        last.rate = last.rate ?? r.rate;
        last.key = `${last.key}+${r.key}`;
        last.label = `${last.label} · ${r.label}`;
      } else merged.push(r);
    }
    return merged;
  }, [snapshot, bars, levelsScope, session, oiAt]);
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
        <h3 className="text-[16px] font-semibold leading-tight text-textPrimary">How the levels held today</h3>
        {scope}
        {span && <span className="font-mono text-[11px] text-textMuted whitespace-nowrap" title="The contracts these levels are read from — the Levels card at the top of the page, the same as the Board's" data-report-span>{span}</span>}
        <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the rows, the strips and the ticks mean" testId="report-guide" />
        <FoldDoor open={open} onToggle={toggleOpen} what="the report" testId="report" />
        {rates.insideMove.n > 0 && (
          <span
            className="ml-auto inline-flex items-baseline gap-2 font-mono whitespace-nowrap"
            title={`How many of the ${rates.insideMove.n} sessions before today closed inside the one move their options priced at the open`}
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
      {open && (
        <div className="font-mono" role="table" aria-label="Today's levels and how each held" data-level-rows>
          {/* THE COLUMNS, NAMED ONCE (the matrix's own head): a row per level under them */}
          <div className={`${grid} h-8 items-center border-t border-borderSubtle/60 text-[11px] uppercase tracking-wider text-textMuted`} role="row">
            <span role="columnheader" title="Which level the row is: call wall, put wall, flip, pin or supreme — hover a row for what it means">Level</span>
            <span role="columnheader" className={`${desk} text-right`} title="The level's price">Strike</span>
            <span role="columnheader" className={desk}>
              Session <span className="normal-case tracking-normal tnum">{first != null ? `${hhmm(first)} → ${last != null ? hhmm(last) : 'now'}` : ''}</span>
            </span>
            <span role="columnheader" className="text-right" title="How many one-minute bars reached the level today">Tests</span>
            <span role="columnheader" className="text-right" title="Tests where the bar closed back on the near side — the level held">Held</span>
            <span role="columnheader" className="text-right" title="Tests where the bar closed through the level">Broke</span>
            <span role="columnheader" className="text-right" title="The time price last reached the level">Last</span>
            <span role="columnheader" className={desk} title="How the hedging at the level changed in the overnight open-interest count — yesterday's trading, on the Levels card's contracts, valued at today's price. The flip is a price, not a strike, so it has none">Built overnight</span>
            <span role="columnheader" className={`${desk} text-right whitespace-nowrap`} title={rates.sessions > 0 ? `How often the level's first test held, over the ${rates.sessions} sessions before today — each read off its own open, never a later book` : 'No sessions before today on hand'}>
              Before today
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
                  title={`${r.labels.map(l => `${l.label} ${fmtStrike(r.price)}: ${LEVEL_TIPS[l.label.toLowerCase()] ?? ''}`).join('\n')}\n${r.grade.words} · click to keep the strike`}
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
