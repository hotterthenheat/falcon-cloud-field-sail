/*
==================================================
  SLAYER TERMINAL - A NAME'S OVERVIEW (pages/record/StockName.tsx)

  /record/stocks/<T> — the page a Stocks row opens
  (the partner's review, 2026-09-13: "stop sending
  me to the pinpoint page… tell me all about the
  stock, like the compass analysis"; then, with his
  own overview page: "i need all the information he
  has on there but formatted much better and
  sticking to our type design pattern, with smooth
  transitions and all… if certain needs need bars or
  visual representations then go for it"). In the
  setup page's grammar: the way back and a jump line
  at the top, the name seeded behind its skeleton,
  then the boxes:

    THE NAME       price, change, the market's
                   phase, the screen and the lean in
                   the board's own words, the score,
                   the four pillars as bars WITH their
                   figures, the doors
    WHY NOW        the biggest current facts, what is
                   for the name and against it, the
                   paragraph from the raw data to the
                   signal, and whether the pillars
                   agree — with the main risk
    THE TREND ·    the sessions, the averages, the
    THE MONEY      structure's four flags · the book
                   on a price scale (the walls, the
                   flip, spot, the supreme), calls
                   against puts, the dark pool's lean
    THE NEWS ·     the wire, the next report, how the
    THE NUMBERS    last reports moved it · a SAMPLE,
                   said so, with fair value on a scale
    HOW THE SCORE  what carries it and what drags it
    IS MADE        (every factor in points), the
                   weights, the trend's part session
                   by session, the moves that would
                   change it, every source — and the
                   method behind a fold
    THE TIMELINE   what happened on the sessions on
                   hand, with the trend's part then
    THE TAPE       the biggest buys and sells, the
                   busiest calls and puts — doors to
                   the Weigher
    ON THE RECORD  insiders and Congress

  States, not orders (the Compass doctrine): the page
  says what it sees — the screen and the lean — never
  buy, hold or sell.
==================================================
*/

import { displayName, personDisplay } from '../../data/tickers';
import { PublishMove } from '../../components/record/publishMove';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ChevronDown } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { ensureBook, peekEntry, useBookRev } from '../../data/uwBook';
import GradeMeter, { GRADE_FILL, GRADE_INK } from '../../components/ui/GradeMeter';
import { gradeOfConviction, postureRead } from '../../data/darkpool';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import Fold from '../../components/ui/Fold';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import SessionsChart, { type ChartMark, type ChartPoint } from '../../components/record/SessionsChart';
import type { UTCTimestamp } from 'lightweight-charts';
import { fmtClockLocal, fmtDayLocal } from '../../components/gex/chartTime';
import { shownGamma } from '../../components/gex/retailSign';
import { When } from '../../components/record/when';
import { lastSessionIso, shortDay } from '../../data/nyDate';
import { StockGuide } from '../../components/record/StockGuide';
import { buildStockOverview, fmtMoney, gradeOf, gradeOfComposite, GRADES, ordinal, type Factor, type Grade, type Lean, type Pillar, type SourceStatus, type StockOverview, type TimelineKind } from '../../data/stockOverview';
import { TX_CODES, isChosenBuy } from '../../data/insiders';
import { bracketLabel, seatLabel } from '../../data/congress';
import { useInsiderFlow, useTickerCongress, useTickerNews } from '../../data/liveRecord';
import { useStockFile } from '../../data/stockFile';
import type { BookContract, FlowPrint } from '../../types/trace';
import { StockNameSkeleton } from './recordSkeletons';
import CompanyFile from '../../components/record/CompanyFile';
import { NewsFlag } from '../../components/record/impactMark';
import { untilWords } from '../../data/earningsFeed';
import NameBooks from '../../components/record/NameBooks';
import { StockFacts } from '../../components/vendor/LiveDesk';
import { stockBookKey, useVendorRow } from '../../data/vendorFeed';
import { nyClock, nyIsoDate, nySessionPhase, nyWallTime } from '../../core/nyTime';
import { isTradingDay, today as nyTodayDate } from '../../core/calendar';
import { LEVEL_ORDER, type LevelRole } from '../../core/walls';
import type { TickerLevels } from '../../data/levelsFor';
import { statHelp } from '../../components/record/statHelp';
import { useLiveQuote } from '../../data/liveQuote';

const SILVER = 'rgb(var(--silver))';
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Every bar on the page glides to its new width on the house curve — the scan tier re-reads the name every ten seconds */
const GLIDE = `width 520ms ${EASE}, left 520ms ${EASE}`;
/* the four public words, their inks and their meter are ui/GradeMeter.tsx — shared with the Tracker since 2026-09-19 */
const LEAN_INK: Record<Lean, string> = { bullish: 'text-bull', neutral: 'text-textPrimary', bearish: 'text-bear' };
const STATUS_WORD: Record<SourceStatus, string> = { live: 'live', sample: 'not on the feed', thin: 'thin' };
const STATUS_INK: Record<SourceStatus, string> = { live: 'text-select', sample: 'text-warn', thin: 'text-textMuted' };
const KIND_INK: Record<TimelineKind, string> = { earnings: 'text-warn', news: 'text-silver', breakout: 'text-bull', breakdown: 'text-bear', volume: 'text-textSecondary', session: 'text-textSecondary' };
/** The same kinds as marks on the sessions chart — token inks, resolved on the island */
const KIND_MARK: Record<TimelineKind, string> = { earnings: 'rgb(var(--warn))', news: 'rgb(var(--silver))', breakout: 'rgb(var(--bull))', breakdown: 'rgb(var(--bear))', volume: 'rgb(var(--silver))', session: 'rgb(var(--text-primary))' };
/** A dark print's bar in the posture's ink: accumulation for, distribution against, the rest muted */
const INTENT_INK: Record<string, string> = { ACCUMULATION: 'rgb(var(--bull))', DISTRIBUTION: 'rgb(var(--bear))' };
/** The timeline's grade chip, in the report's three tones */
const LANE_TONE: Record<'good' | 'bad' | 'quiet', string> = {
  good: 'bg-bull/10 text-bull border-bull/20',
  bad: 'bg-bear/10 text-bear border-bear/20',
  quiet: 'bg-ink/[0.05] text-textSecondary border-borderSubtle',
};

/* ---- THE TIMELINE'S STRIP — the At the wall report's own lane (Noah, 2026-09-13, with its screenshot: "the timeline should have this
   type of design pattern… our neat clean concise look"): a hairline for the sessions on hand, a tick per mark in its ink, "now" as a
   silver tick, a card naming the session and the mark under the pointer ------------------------------------------------------ */
interface LaneTick {
  /** Which session on hand, the strip's x */
  i: number;
  ink: string;
  when: string;
  text: string;
  score: number | null;
  /** A full-height tick: a break, a big session */
  tall: boolean;
}
const SW = 600;
const SH = 28;
const MarkStrip = ({ ticks, n, label }: { ticks: LaneTick[]; n: number; label: string }) => {
  const ref = useRef<SVGSVGElement>(null);
  const [hot, setHot] = useState<LaneTick | null>(null);
  const span = Math.max(1, n - 1);
  const x = (i: number) => 8 + (i / span) * (SW - 16);
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg || !ticks.length) return;
    const r = svg.getBoundingClientRect();
    const u = ((e.clientX - r.left) / r.width) * SW;
    const near = ticks.reduce((b, t) => (Math.abs(x(t.i) - u) < Math.abs(x(b.i) - u) ? t : b), ticks[0]);
    setHot(Math.abs(x(near.i) - u) < 14 ? near : null);
  };
  const stacked = hot ? ticks.filter(t => t.i === hot.i) : [];
  const cardLeft = hot ? (x(hot.i) / SW) * 100 : 0;
  const onRight = hot ? x(hot.i) < SW * 0.6 : true;
  return (
    <div className="relative" onPointerLeave={() => setHot(null)}>
      <svg ref={ref} viewBox={`0 0 ${SW} ${SH}`} width="100%" height={SH} preserveAspectRatio="none" data-lane-strip onPointerMove={onMove} style={{ display: 'block', cursor: ticks.length ? 'crosshair' : 'default' }} role="img" aria-label={`${label}: ${ticks.length} on the sessions on hand`}>
        <line x1={8} x2={SW - 8} y1={SH / 2} y2={SH / 2} stroke="#ffffff" strokeOpacity={0.1} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {ticks.map((t, k) => (
          <line key={`${t.i}-${k}`} x1={x(t.i)} x2={x(t.i)} y1={t.tall ? 4 : 8} y2={t.tall ? SH - 4 : SH - 8} stroke={t.ink} strokeOpacity={hot && hot.i !== t.i ? 0.45 : 0.9} strokeWidth={t.tall ? 2 : 1.5} vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={SW - 8} x2={SW - 8} y1={6} y2={SH - 6} stroke={SILVER} strokeOpacity={0.6} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      </svg>
      {hot && (
        <div data-strip-card className="absolute -top-1 z-10 pointer-events-none rounded-md border border-borderMuted bg-card/95 backdrop-blur-sm shadow-[0_8px_24px_rgba(0,0,0,0.5)] px-2.5 py-1.5 whitespace-nowrap animate-soft-in" style={{ left: `${cardLeft}%`, transform: onRight ? 'translate(12px, -100%)' : 'translate(calc(-100% - 12px), -100%)' }}>
          {stacked.slice(0, 3).map((t, k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tnum text-textPrimary">{t.when}</span>
              <span className="text-[11px] font-medium" style={{ color: t.ink }}>
                {t.text}
              </span>
              {t.score != null && <span className="font-mono text-[10px] text-textMuted">the trend read {gradeOf(t.score)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
const KIND_WORD: Record<TimelineKind, string> = { earnings: 'report', news: 'the wire', breakout: 'breakout', breakdown: 'breakdown', volume: 'volume', session: 'session' };
const JUMPS: [string, string][] = [
  ['name', 'The name'],
  ['why', 'Why now'],
  ['trend', 'Trend'],
  ['money', 'Money'],
  ['news', 'News'],
  ['numbers', 'Numbers'],
  ['score', 'Behind the read'],
  ['timeline', 'Timeline'],
  ['buys', 'The tape'],
  ['insiders', 'Insiders'],
  ['congress', 'Congress'],
  ['who', 'Who is in it'],
];
const pct = (v: number, d = 1) => `${v >= 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;
/** A chart point's seconds, said as the reader's day or minute */
const dayOf = (t: number) => fmtDayLocal(t as UTCTimestamp);
/* THE PRINTS SPEAK NEW YORK'S CLOCK (audit round 7: "19:20 122K" under a heading of "09:30–15:59 ET" was the reader's
   own zone — the print crossed at 15:20 ET). The session's tape and its prints are the market's day. */
const clockOf = (t: number) => `${fmtClockLocal(t as UTCTimestamp, 'ny')} ET`;
const ago = (m: number) => (m < 1 ? 'just now' : m < 60 ? `${Math.round(m)}m ago` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m ago`);
const count = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`);
/** "09/18/2026" → "2026-09-18", the Weigher's date key */
const isoOf = (mmddyyyy: string) => {
  const [m, d, y] = mmddyyyy.split('/');
  return y && m && d ? `${y}-${m}-${d}` : mmddyyyy;
};

/* ---- the pieces ---------------------------------------------------------------- */

const Box = ({ title, sub, aside, testId, children }: { title: string; sub?: ReactNode; aside?: ReactNode; testId: string; children: ReactNode }) => (
  <div id={`stock-${testId}`} className="border border-borderSubtle rounded-md bg-panel flex flex-col scroll-mt-4" data-stock-box={testId}>
    <div className="px-5 pt-4 pb-3 flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">{title}</h3>
        {sub && <p className="mt-0.5 text-[11px] text-textMuted truncate">{sub}</p>}
      </div>
      {aside}
    </div>
    {children}
  </div>
);
const Fact = ({ label, children, testId, tip }: { label: string; children: ReactNode; testId?: string; tip?: string }) => (
  <div className="min-w-0">
    <dt className="text-[10px] text-textMuted whitespace-nowrap cursor-help" title={tip ?? statHelp(label)}>{label}</dt>
    {/* a figure wraps at its dots rather than being cut to "0…" in a narrow column (the dossier sweep, 2026-10-22) */}
    <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary break-words" data-stock-fact={testId}>
      {children}
    </dd>
  </div>
);
const Door = ({ onClick, onWarm, children }: { onClick: () => void; onWarm?: () => void; children: ReactNode }) => (
  <button type="button" onClick={onClick} onMouseEnter={onWarm} className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
    <ArrowUpRight className="w-3 h-3" />
    {children}
  </button>
);
const StatusTag = ({ status }: { status: SourceStatus }) => (
  <span className={`font-mono text-[8px] uppercase tracking-widest ${STATUS_INK[status]}`} data-stock-status={status}>
    {STATUS_WORD[status]}
  </span>
);
/** A pillar as its word and the meter — its figure stays inside the engine */
const PillarBar = ({ p, big = false, held = false }: { p: Pillar; big?: boolean; held?: boolean }) => {
  const grade = gradeOf(p.score);
  /* a provisional read holds its words until the sources it stands on are in (round 8) */
  if (held && p.inRead) {
    return (
      <div className="min-w-0" data-stock-pillar={p.key} data-grade="reading" title="Held until the sources this read stands on are in">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-textMuted truncate">{p.name}</span>
          <span className={`ml-auto shrink-0 font-mono ${big ? 'text-[11px]' : 'text-[10px]'} text-textMuted animate-pulse`}>reading…</span>
        </div>
        <div className="mt-1 h-[6px] rounded-full bg-ink/[0.04]" />
      </div>
    );
  }
  /* a pillar the read leaves out says so, instead of a grade it does not have (the news: shown, never scored) */
  if (!p.inRead) {
    return (
      <div className="min-w-0" data-stock-pillar={p.key} data-grade="none" title="Shown for context — the board has no wire for every name, so the read leaves this out on both">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[10px] text-textMuted truncate">{p.name}</span>
          <span className={`ml-auto shrink-0 font-mono ${big ? 'text-[11px]' : 'text-[10px]'} text-textMuted`}>not scored</span>
        </div>
        <div className="mt-1 h-[6px] rounded-full bg-ink/[0.04]" />
      </div>
    );
  }
  return (
    <div className="min-w-0" data-stock-pillar={p.key} data-grade={grade}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-[10px] text-textMuted truncate">{p.name}</span>
        {p.status !== 'live' && <StatusTag status={p.status} />}
        <span className={`ml-auto shrink-0 font-mono ${big ? 'text-[13px]' : 'text-[12px]'} font-semibold ${GRADE_INK[grade]}`}>{grade}</span>
      </div>
      <div className="mt-1">
        <GradeMeter grade={grade} />
      </div>
    </div>
  );
};
/** A signed bar from the middle: right in green for the name, left in red against it — `v` in −1…+1 */
const SignedBar = ({ v, thick = false }: { v: number; thick?: boolean }) => {
  const a = Math.min(1, Math.abs(v));
  return (
    <span className={`relative block ${thick ? 'h-[6px]' : 'h-[4px]'} rounded-full bg-ink/[0.06] overflow-hidden`}>
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink/25" />
      <span className={`absolute inset-y-0 rounded-full ${v >= 0 ? 'bg-bull' : 'bg-bear/70'}`} style={{ transition: GLIDE, ...(v >= 0 ? { left: '50%', width: `${a * 50}%` } : { left: `${50 - a * 50}%`, width: `${a * 50}%` }) }} />
    </span>
  );
};
const FactorRow = ({ f }: { f: Factor }) => (
  <div className="px-5 py-2 grid items-center gap-x-4 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr) 96px' }} data-stock-factor={f.key} data-lean={f.lean.toFixed(2)}>
    <span className="min-w-0">
      {/* wraps on a phone (round 9: "Price against its 2…", "ADX, the trend's …" cut at 390) */}
      <span className="block text-[11px] text-textPrimary truncate max-sm:whitespace-normal max-sm:break-words">
        {f.label}
        {f.context && <span className="ml-1.5 font-mono text-[8px] uppercase tracking-widest text-textMuted" title="Shown for context; not in the read">context</span>}
      </span>
      <span className="block text-[9px] text-textMuted truncate max-sm:whitespace-normal max-sm:break-words">{f.note}</span>
    </span>
    <span className="font-mono text-[11px] tnum text-textPrimary truncate max-sm:whitespace-normal max-sm:break-words">{f.value}</span>
    <SignedBar v={f.lean} />
  </div>
);
/** How far a print landed from its estimate — a percent, or cents when the estimate is a few cents and a percent explodes */
/* cents, not a percent, when the estimate is small or the two sit on opposite sides of zero — "beat by 542.9%" on a
   -0.07 estimate said nothing (the Dossier sweep, 2026-10-22); one rule for the table, the numbers box and the factor */
export const centsGap = (actual: number, est: number) => Math.abs(est) < 0.25 || Math.sign(actual) !== Math.sign(est);
const epsGap = (actual: number, est: number) => (centsGap(actual, est) ? `${Math.round(Math.abs(actual - est) * 100)}¢` : `${Math.abs(((actual - est) / Math.abs(est || 1)) * 100).toFixed(1)}%`);

const Money = ({ v, signed = true }: { v: number; signed?: boolean }) => <span className={signed ? (v >= 0 ? 'text-bull' : 'text-bear') : ''}>{fmtMoney(v)}</span>;

/** A two-sided share bar: the left side's share of the whole, the rest to the right */
const ShareBar = ({ left, leftInk = 'bg-bull', rightInk = 'bg-bear/80' }: { left: number; leftInk?: string; rightInk?: string }) => (
  <div className="flex h-[6px] rounded-full overflow-hidden bg-ink/[0.06]">
    <span className={`h-full ${leftInk}`} style={{ width: `${left}%`, transition: GLIDE }} />
    <span className={`h-full ${rightInk}`} style={{ width: `${100 - left}%`, transition: GLIDE }} />
  </div>
);

/** A scale's hover read — a small card over the point under the pointer (a drawn scale is never a still picture) */
const ScaleCard = ({ at, children }: { at: number; children: ReactNode }) => (
  <div className="absolute -top-1 z-10 pointer-events-none -translate-x-1/2 -translate-y-full rounded-md border border-borderSubtle px-2 py-1.5 whitespace-nowrap text-[10px] text-textSecondary" style={{ left: `${Math.max(12, Math.min(88, at))}%`, background: 'rgba(8,8,10,0.9)', backdropFilter: 'blur(3px)' }} data-scale-card>
    {children}
  </div>
);

/** THE BOOK ON A PRICE SCALE — the put wall, the flip, spot, the call wall and the supreme on one line, each named in its ink.
    A label that would sit on its neighbour's takes the upper row; the ticks stay where the prices are. Hover a mark for its read. */
const LEVEL_WORDS: Record<string, string> = {
  put: 'dealer hedging bids there — support',
  flip: 'above it dealers absorb moves, below it they amplify them',
  spot: 'the last price',
  call: 'dealer hedging supplies stock there — resistance',
  supreme: 'the heaviest strike on the book',
};
/* the flip is drawn only when levelsFor found one — null means net gamma does not cross zero within ±10%, and the scale
   says so instead of putting a "flip" on spot (the third audit, 2026-10-23: GME read "25.14 FLIP · 25.14 SPOT") */
/* ONE ORDER, EVERY ROLE (round 6, the house's LEVEL_ORDER in core/walls.ts: supreme · call wall · put wall · flip): a strike
   that is several levels is one mark naming all of them in that order (AAPL's 350 "supreme · call wall"), and each
   figure is the one Pinpoint prints — the supreme by its net, a wall by the leg that makes it */
type LegsAt = TickerLevels['legsAt'];
const ROLE_KEY: Record<LevelRole, string> = { supreme: 'supreme', 'call wall': 'call', 'put wall': 'put', flip: 'flip' };
const ROLE_INK: Record<LevelRole, string> = { supreme: 'rgb(var(--supreme))', 'call wall': 'rgb(var(--bull))', 'put wall': 'rgb(var(--bear))', flip: SILVER };
/* a whole strike as written, any other to the cent — "212.50", as Pinpoint prints it */
const levelPrice = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(2));
/** The figure behind one role at its strike: "net +$1.2B" for the supreme, "calls +$…" / "puts −$…" for a wall */
const roleFigure = (role: LevelRole, strike: number, legsAt?: LegsAt): string | null => {
  const legs = legsAt?.(strike);
  if (!legs) return null;
  if (role === 'supreme') return `net ${legs.net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(legs.net))}`;
  if (role === 'call wall') return `calls ${legs.call >= 0 ? '+' : '−'}${fmtMoney(Math.abs(legs.call))}`;
  if (role === 'put wall') return `puts ${legs.put >= 0 ? '+' : '−'}${fmtMoney(Math.abs(legs.put))}`;
  return null;
};
/** The scope's levels grouped by strike, in LEVEL_ORDER: each group one price and every role it holds */
const levelGroups = (lv: { supreme: number; callWall: number | null; putWall: number | null; flip: number | null }) => {
  const at: Record<LevelRole, number | null> = { supreme: lv.supreme, 'call wall': lv.callWall, 'put wall': lv.putWall, flip: lv.flip };
  const groups: { price: number; roles: LevelRole[] }[] = [];
  for (const role of LEVEL_ORDER) {
    const price = at[role];
    if (price == null) continue;
    const g = groups.find(x => Math.abs(x.price - price) < 1e-9);
    if (g) g.roles.push(role);
    else groups.push({ price, roles: [role] });
  }
  return groups;
};
/** The levels as one line, in the house order: "350 supreme · call wall (net +$… · calls +$…) · 340 put wall (puts −$…) · flip 340.82" */
const LevelsLine = ({ levels }: { levels: Pick<TickerLevels, 'supreme' | 'callWall' | 'putWall' | 'flip' | 'legsAt'> }) => (
  <p className="mt-1 font-mono text-[10px] tnum text-textSecondary" data-stock-levels-line>
    {levelGroups(levels).map((g, i) => {
      const figs = g.roles.map(r => roleFigure(r, g.price, levels.legsAt)).filter(Boolean);
      return (
        <span key={g.price}>
          {i ? ' · ' : ''}
          {/* roles sharing a strike join with "and" — "call wall · put wall 212.5" read as a missing value (round 9) */}
          <span style={{ color: ROLE_INK[g.roles[0]] }}>{g.roles.length > 1 ? `${g.roles.slice(0, -1).join(', ')} and ${g.roles[g.roles.length - 1]}` : g.roles[0]}</span> {levelPrice(g.price)}
          {figs.length ? <span className="text-textMuted"> ({figs.join(' · ')})</span> : null}
        </span>
      );
    })}
    {levels.flip == null ? <span className="text-textMuted">{' · '}flip none within ±10%</span> : null}
  </p>
);
const LevelsScale = ({ spot, putWall, flip, callWall, supreme, legsAt }: { spot: number; putWall: number | null; flip: number | null; callWall: number | null; supreme: number; legsAt?: LegsAt }) => {
  const [hot, setHot] = useState<string | null>(null);
  const marks = [
    ...levelGroups({ supreme, callWall, putWall, flip }).map(g => ({
      key: g.roles.map(r => ROLE_KEY[r]).join('-'),
      price: g.price,
      word: g.roles.join(' · '),
      ink: ROLE_INK[g.roles[0]],
      roles: g.roles,
    })),
    { key: 'spot', price: spot, word: 'spot', ink: 'rgb(var(--text-primary))', roles: [] as LevelRole[] },
  ].sort((a, b) => a.price - b.price);
  const lo = marks[0].price;
  const hi = marks[marks.length - 1].price;
  const pad = Math.max((hi - lo) * 0.12, spot * 0.004);
  const x = (p: number) => ((p - (lo - pad)) / (hi - lo + 2 * pad)) * 100;
  /* two rows of words: a mark within a tenth of the scale of the one before it goes to the other row */
  const rows: number[] = [];
  marks.forEach((m, i) => {
    const prev = marks[i - 1];
    rows.push(prev && x(m.price) - x(prev.price) < 11 ? (rows[i - 1] === 0 ? 1 : 0) : 0);
  });
  const hotMark = marks.find(m => m.key === hot) ?? null;
  const hotFigs = hotMark ? hotMark.roles.map(r => roleFigure(r, hotMark.price, legsAt)).filter(Boolean) : [];
  return (
    <div className="relative">
      {hotMark && (
        <ScaleCard at={x(hotMark.price)}>
          <span className="font-mono font-bold tnum" style={{ color: hotMark.ink }}>
            {hotMark.word} {hotMark.key === 'spot' ? hotMark.price.toFixed(2) : levelPrice(hotMark.price)}
          </span>
          {hotMark.key !== 'spot' && (
            <span className="font-mono tnum text-textPrimary">
              {' '}
              · {pct(((hotMark.price - spot) / spot) * 100)} from spot{hotFigs.length ? ` · ${hotFigs.join(' · ')}` : ''}
            </span>
          )}
          <span className="block text-textMuted">{hotMark.key === 'spot' ? LEVEL_WORDS.spot : hotMark.roles.map(r => LEVEL_WORDS[ROLE_KEY[r]]).join('; ')}</span>
        </ScaleCard>
      )}
      <svg width="100%" height={54} className="block overflow-visible" role="img" aria-label={`The book on a price scale: supreme ${supreme}, call wall ${callWall ?? 'none'}, put wall ${putWall ?? 'none'}, flip ${flip != null ? flip.toFixed(2) : 'none within ±10%'}, spot ${spot.toFixed(2)}`} data-stock-scale={hot ?? 'rest'}>
        <line x1="0%" x2="100%" y1={27} y2={27} stroke="rgb(var(--ink))" strokeOpacity={0.14} />
        {/* the likely range between the walls, faint */}
        {putWall != null && callWall != null && <rect x={`${x(Math.min(putWall, callWall))}%`} y={24} width={`${Math.abs(x(callWall) - x(putWall))}%`} height={6} fill={SILVER} fillOpacity={0.1} />}
        {marks.map((m, i) => {
          const up = rows[i] === 1;
          const isSpot = m.key === 'spot';
          const on = hot === m.key;
          return (
            <g key={m.key} data-scale-mark={m.key} onMouseEnter={() => setHot(m.key)} onMouseLeave={() => setHot(h => (h === m.key ? null : h))} style={{ cursor: 'default' }}>
              {/* a wide silent hit area, so the mark is easy to hover */}
              <rect x={`calc(${x(m.price)}% - 12px)`} y={0} width={24} height={54} fill="transparent" />
              <line x1={`${x(m.price)}%`} x2={`${x(m.price)}%`} y1={isSpot ? 18 : 22} y2={isSpot ? 36 : 32} stroke={m.ink} strokeWidth={isSpot || on ? 2 : 1.25} strokeDasharray={m.key === 'flip' ? '2 2' : undefined} />
              <text x={`${x(m.price)}%`} y={up ? 12 : 46} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, Menlo, monospace" fill={m.ink} fontWeight={isSpot || on ? 700 : 500}>
                {/* a strike prints as written; an interpolated level (the flip) to the cent, never fifteen decimals */}
                {isSpot ? m.price.toFixed(2) : levelPrice(m.price)}
              </text>
              <text x={`${x(m.price)}%`} y={up ? 4 : 54} textAnchor="middle" fontSize={7.5} fontFamily="ui-monospace, Menlo, monospace" letterSpacing={0.6} fill={m.ink} fillOpacity={on ? 1 : 0.75}>
                {m.word.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

/** The structure's four flags: the last five sessions' swings against the five before */
const Flags = ({ flags }: { flags: NonNullable<StockOverview['trend']['flags']> }) => {
  const items: [string, string, boolean, boolean][] = [
    ['HH', 'higher highs', flags.hh, true],
    ['HL', 'higher lows', flags.hl, true],
    ['LH', 'lower highs', flags.lh, false],
    ['LL', 'lower lows', flags.ll, false],
  ];
  return (
    <span className="inline-flex items-center gap-1.5" data-stock-flags={items.filter(i => i[2]).map(i => i[0]).join(' ')}>
      {items.map(([code, word, on, good]) => (
        <span key={code} title={word} className={`inline-flex items-center h-5 px-1.5 rounded border font-mono text-[9px] font-bold tracking-wider transition-colors ${on ? (good ? 'border-bull/40 text-bull bg-bull/10' : 'border-bear/40 text-bear bg-bear/10') : 'border-borderSubtle text-textMuted/60'}`} data-flag={code} data-on={on || undefined}>
          {code}
        </span>
      ))}
    </span>
  );
};

/** A busiest contract — a door to the Weigher with the contract picked */
const ContractRow = ({ c, maxVol, onOpen, onWarm }: { c: BookContract; maxVol: number; onOpen: () => void; onWarm?: () => void }) => (
  <button type="button" onClick={onOpen} onMouseEnter={onWarm} onFocus={onWarm} title="Weigh this contract" className="group/door w-full text-left px-3 sm:px-5 py-2 border-t border-borderSubtle/40 grid grid-cols-[92px_64px_minmax(0,1fr)_12px] sm:grid-cols-[112px_96px_minmax(0,1fr)_72px_24px] items-center gap-x-2 sm:gap-x-3 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] outline-none transition-colors" data-stock-contract={c.key} data-contract-strike={c.strike} data-contract-right={c.right}>
    <span className="font-mono text-[11px] font-bold text-textPrimary group-hover/door:text-silver transition-colors">
      {c.strike}
      {c.right} <span className="text-[9px] font-normal text-textMuted">· {c.expiry.slice(0, 5)}</span>
    </span>
    <span className="font-mono text-[10px] tnum text-textSecondary">{fmtMoney(c.premium)}</span>
    <span className="flex items-center gap-2 min-w-0">
      <span className="relative w-full max-w-[120px] min-w-[20px] h-[4px] rounded-full bg-ink/[0.06] sm:shrink-0">
        <span className={`absolute inset-y-0 left-0 rounded-full ${c.right === 'C' ? 'bg-bull/80' : 'bg-bear/70'}`} style={{ width: `${Math.max(6, (c.volume / maxVol) * 100)}%`, transition: GLIDE }} />
      </span>
      <span className="font-mono text-[10px] tnum text-textPrimary">{c.volume.toLocaleString()}</span>
    </span>
    {/* a phone keeps the contract, its money and its volume; how it was bought is the first thing a 360px row gives up (the
        phone sweep, 2026-09-19: the row's fixed columns alone were 392px — it pushed the page sideways) */}
    <span className="max-sm:hidden font-mono text-[9px] tnum text-textMuted text-right">{c.sweepPct >= 20 ? 'swept' : `${c.askPct.toFixed(0)}% ask`}</span>
    <ArrowUpRight className="w-3 h-3 text-textMuted group-hover/door:text-silver transition-colors justify-self-end" />
  </button>
);
/** One of the tape's biggest prints on the name — a door to the Weigher with the contract picked */
const PrintRow = ({ p, maxPrem, onOpen, onWarm }: { p: FlowPrint; maxPrem: number; onOpen: () => void; onWarm?: () => void }) => (
  <button type="button" onClick={onOpen} onMouseEnter={onWarm} onFocus={onWarm} title="Weigh this contract" className="group/door w-full text-left px-3 sm:px-5 h-[34px] border-t border-borderSubtle/40 grid grid-cols-[88px_minmax(0,1fr)_64px_12px] sm:grid-cols-[44px_112px_minmax(0,1fr)_72px_48px_24px] items-center gap-x-2 sm:gap-x-3 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] outline-none transition-colors" data-stock-print={p.id} data-print-side={p.side}>
    {/* on a phone the row is the contract, its size and its money — the time and the sweep mark come back at 640px (its
        fixed columns alone were 400px) */}
    <span className="max-sm:hidden font-mono text-[10px] tnum text-textMuted">{p.time}</span>
    <span className="font-mono text-[11px] font-bold text-textPrimary group-hover/door:text-silver transition-colors">
      {p.strike}
      {p.right} <span className="text-[9px] font-normal text-textMuted">· {p.dte}d</span>
    </span>
    <span className="flex items-center gap-2 min-w-0">
      <span className="max-sm:hidden relative w-full max-w-[110px] h-[4px] rounded-full bg-ink/[0.06] shrink-0">
        <span className={`absolute inset-y-0 left-0 rounded-full ${p.side === 'ASK' ? 'bg-bull/80' : 'bg-bear/70'}`} style={{ width: `${Math.max(6, (p.premium / maxPrem) * 100)}%`, transition: GLIDE }} />
      </span>
      <span className="font-mono text-[10px] tnum text-textSecondary whitespace-nowrap">
        {p.size.toLocaleString()} @ {p.fill.toFixed(2)}
      </span>
    </span>
    <span className="font-mono text-[11px] tnum font-semibold text-textPrimary text-right">{fmtMoney(p.premium)}</span>
    <span className={`max-sm:hidden font-mono text-[8px] uppercase tracking-widest text-right ${p.sweep ? 'text-silver' : 'text-textMuted'}`}>{p.sweep ? 'sweep' : p.legs > 1 ? `×${p.legs}` : ''}</span>
    <ArrowUpRight className="w-3 h-3 text-textMuted group-hover/door:text-silver transition-colors justify-self-end" />
  </button>
);

/* ---- the page ------------------------------------------------------------------- */

const StockName = () => {
  const { ticker = '' } = useParams();
  const T = ticker.toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const { changeTicker } = useTicker();
  const bookRev = useBookRev();
  /* THE LIGHT BOOK FIRST (the round-8 audit: 143 calls on AAPL, 187 on SPY — most of them the full book's forty dates).
     The page opens on the name's whole-book strikes and its front expiry; the forty dates behind the All-expiries
     levels load once that panel is on screen, or at once when the book is already whole (Pinpoint shares the cache). */
  const [allWanted, setAllWanted] = useState(false);
  const allRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => setAllWanted(!!peekEntry(T)?.everFull), [T]);
  useEffect(() => {
    ensureBook(T, allWanted ? 'full' : 'board');
  }, [T, allWanted]);
  /* the wire moves on its own; the book republishes through bookRev */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);
  /* the wire only (round 6): the whole record (congress and insider books) is not this page's */
  /* the name's own headlines (round 8): one call, not the whole day's wire and a bars call per story's name */
  const recordNews = useTickerNews(T);
  /* the wire's empty line waits for the read to settle (audit round 7: "NOTHING ON THE WIRE TODAY" showed mid-read) */
  const wireReading = recordNews.status === 'loading';
  const file = useStockFile(T);
  /* the quote carries the regular session's change and the extended-hours move apart (data/liveQuote.ts) */
  const quote = useLiveQuote(T);
  /* the day the name's stories are from — the wire day (data/liveRecord.ts): today, or on a weekend the last session */
  /* a headline that says the stock is up (or down) on a session that closed the other way */
  const closedAgainst = (headline: string, atMs: number): string | null => {
    if (!quote || quote.phase === 'regular') return null;
    const up = /\b(up|rises?|rose|gains?|gained|jumps?|jumped|climbs?|climbed|higher|record high|surges?|surged|rall(?:y|ies|ied))\b/i.test(headline);
    const down = /\b(down|falls?|fell|drops?|dropped|slides?|slid|slips?|slipped|lower|sinks?|sank|tumbles?|tumbled|plunges?|plunged)\b/i.test(headline);
    if (up === down) return null;
    const closed = quote.phase === 'pre' ? null : quote.changePct;
    if (closed == null || !Number.isFinite(closed) || Math.abs(closed) < 0.01) return null;
    if (quote.regDate && nyIsoDate(atMs) !== quote.regDate) return null;
    if ((up && closed < 0) || (down && closed > 0)) return `intraday; closed ${closed >= 0 ? '+' : '−'}${Math.abs(closed).toFixed(2)}%`;
    return null;
  };
  const view = useMemo(() => buildStockOverview(T, file.flow, { allExpiries: allWanted }), [T, tick, recordNews, bookRev, file, quote, allWanted]);
  const viewReady = !!view;
  useEffect(() => {
    if (allWanted || !viewReady) return;
    const el = allRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setAllWanted(true);
      return;
    }
    /* a reader who scrolls to the panel asks for it; a panel that merely lands in the first screen does not (a wide
       desk shows it at once — the forty dates stay a click away, "Read every expiry") */
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting) && window.scrollY > 120) setAllWanted(true);
    });
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      if (window.scrollY > 120 && r.top < window.innerHeight && r.bottom > 0) setAllWanted(true);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, [allWanted, viewReady, T]);
  /* THE READ IS HELD WHILE ITS SOURCES LAND (the round-8 audit: "Reads strong · Leans bullish · The money good" at "5 of
     9 sources live", then "Reads good · The money poor"). The words wait for the quote, the regular closes and the tapes;
     past 40 seconds a source that has not answered no longer holds them, and the read says it is provisional. */
  const [holdStart] = useState(() => Date.now());
  const settling = view?.settling ?? [];
  const holdTimedOut = tick > 0 && Date.now() - holdStart > 40_000;
  const held = settling.length > 0 && !holdTimedOut;
  const provisional = settling.length > 0;
  const insiders = useInsiderFlow(T, 90);
  const marketAll = useMemo(() => insiders.trades.filter(t => TX_CODES[t.code].openMarket), [insiders]);
  /* the rows are the newest five; the foot's totals are every open-market trade of the 90 days — said so (the retail
     test, round 7: "sold $95.5M" under five rows that add to far less read as a mismatch) */
  const marketInsiders = useMemo(() => [...marketAll].sort((a, b) => (b.tradedOn ?? '').localeCompare(a.tradedOn ?? '') || a.daysAgo - b.daysAgo).slice(0, 5), [marketAll]);
  /* the name's own Congress reports, not the market book's latest few weeks */
  const congressBook = useTickerCongress(T, 180);
  const congressAll = useMemo(() => [...congressBook.trades].sort((a, b) => a.filedDaysAgo - b.filedDaysAgo), [congressBook]);
  const congress = useMemo(() => congressAll.slice(0, 5), [congressAll]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  /* THE KEPT PRINT on today's tape — a click on a bar keeps it; another name lets it go */
  const [printFocus, setPrintFocus] = useState<number | null>(null);
  useEffect(() => setPrintFocus(null), [T]);

  const jump = (id: string) => document.getElementById(`stock-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const back = (
    <div className="flex items-center gap-4 flex-wrap" data-name-back>
      <Link to="/dossier/stocks" className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> The board
      </Link>
      {view && (
        /* on a phone the chips are one row that scrolls sideways — wrapped, they stood three lines tall over the page */
        <nav className="ml-auto flex items-center gap-1 flex-wrap font-mono text-[9px] uppercase tracking-widest max-sm:ml-0 max-sm:w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden max-sm:[&>button]:shrink-0" aria-label="Sections of the page" data-stock-jumps>
          {JUMPS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => jump(id)} className="inline-flex items-center h-6 px-2 rounded-md text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-stock-jump={id}>
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
  if (!view) {
    return (
      <>
        {back}
        <StockNameSkeleton />
      </>
    );
  }

  const openOnMap = () => {
    changeTicker(T);
    navigate('/pinpoint/map');
  };
  const weigh = (c?: { strike: number; right: 'C' | 'P'; expiry: string }) => navigate('/weigher', { state: { weigh: c ? { ticker: T, strike: c.strike, right: c.right, expiry: isoOf(c.expiry) } : { ticker: T }, wayBack: location.pathname } });
  const warm = () => {};
  const byKey = Object.fromEntries(view.pillars.map(p => [p.key, p])) as Record<Pillar['key'], Pillar>;
  const { money, trend, news, numbers, agreement } = view;
  const storyDayWord = (() => {
    const times = news.stories.map(st => st.item.atMs).filter(Number.isFinite);
    const day = times.length ? nyIsoDate(Math.min(...times)) : lastSessionIso();
    if (day === nyIsoDate()) return 'today';
    const [y, m, d] = day.split('-').map(Number);
    return `since ${new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })} ${shortDay(day)}`;
  })();
  /* the read's word — the only form the engine's figure takes on this page */
  const grade = gradeOfComposite(view.composite);
  const maxVol = Math.max(1, ...money.busiest.calls.map(c => c.volume), ...money.busiest.puts.map(c => c.volume));
  const maxPrem = Math.max(1, ...view.prints.buys.map(p => p.premium), ...view.prints.sells.map(p => p.premium));
  const prem = money.callPremium + money.putPremium;
  const callShare = prem > 0 ? (100 * money.callPremium) / prem : 50;
  const sidePrem = money.bullishPremium + money.bearishPremium;
  const bullShare = sidePrem > 0 ? (100 * money.bullishPremium) / sidePrem : 50;
  const sessionWord = file.session ? shortDay(file.session) : 'the session';
  /* THE SCREENER'S FIGURES WEAR THE SCREENER ROW'S OWN DATE (audit round 7: on a Saturday the Oct 22 row read "option
     premium · Oct 23" — the label took the clock's session, not the data's) */
  const screenDay = typeof file.screen?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(file.screen.date) ? String(file.screen.date).slice(0, 10) : null;
  const screenWord = screenDay ? shortDay(screenDay) : sessionWord;
  const up = view.changePct >= 0;
  /* THE BADGE FROM WHAT LOADED (audit round 10: "8 of 9 sources live · insiders and congress not live" beside both
     sections' live rows — the source was the market-wide book; the page reads the name's own) */
  const pageSources = view.sources.map(s => {
    if (s.key !== 'record') return s;
    const iLive = insiders.status === 'live';
    const cLive = congressBook.status === 'live';
    if (!iLive && !cLive) return s;
    const iN = marketAll.length;
    const cN = congressAll.length;
    return { ...s, status: 'live' as const, stamp: `${iLive ? `${iN} open-market insider ${iN === 1 ? 'trade' : 'trades'} in 90 days` : 'insiders reading'} · ${cLive ? `${cN} congress ${cN === 1 ? 'report' : 'reports'} in 180 days` : 'congress reading'}` };
  });
  const live = pageSources.filter(s => s.status === 'live').length;
  const completeness = Math.round((100 * live) / Math.max(1, pageSources.length));
  const maxPts = Math.max(0.1, ...view.contributions.map(c => Math.abs(c.points)));
  const maxDelta = Math.max(1, ...view.moves.map(m => Math.abs(m.delta)));
  const forIt = view.contributions.filter(c => c.points > 0).length;
  const againstIt = view.contributions.filter(c => c.points < 0).length;
  const trajectory = numbers.epsGrowthPct == null ? null : numbers.epsGrowthPct > 12 ? 'accelerating' : numbers.epsGrowthPct > 3 ? 'steady' : 'slowing';
  const insiderTotal = insiders.bought + insiders.sold;
  /* THE SESSIONS ON THE CHART: the closes on their dates, the marks that matter on them */
  const sessionPoints: ChartPoint[] = trend.times.map((t, i) => ({ time: t, value: trend.closes[i] })).slice(-30);
  /* THE MARKS SIT ON THE LINE, small, in their kind's ink, and say nothing on the plot (Noah, 2026-09-29, with the box in
     front of him: "i hate this chart" — three white circles each captioned "session" stacked over the line, arrows with
     words under it, a whole line painted red). The card under the pointer and the timeline strip below carry the words. */
  const sessionMarks: ChartMark[] = view.timeline.filter(t => t.time != null).map(t => ({ time: t.time!, color: KIND_MARK[t.kind], on: true, size: 0.34, shape: 'circle' as const, text: `${KIND_WORD[t.kind]} · ${t.text}` }));
  /* the levels named INSIDE the plot at their left end — the axis keeps the figures alone (four named tags collided there) */
  const sessionLines = [
    ...(trend.ema20 != null ? [{ price: trend.ema20, color: SILVER, title: '20-day EMA', style: 'dashed' as const, name: 'plot' as const }] : []),
    ...(money.levelsAll?.complete && money.levelsAll.putWall != null ? [{ price: money.levelsAll.putWall, color: 'rgb(var(--bear))', title: 'support', style: 'dashed' as const, name: 'plot' as const }] : []),
    ...(money.levelsAll?.complete && money.levelsAll.callWall != null ? [{ price: money.levelsAll.callWall, color: 'rgb(var(--bull))', title: 'resistance', style: 'dashed' as const, name: 'plot' as const }] : []),
  ];
  /* the scale holds the line and any level near it (within a quarter of the line's own span past either end), with a
     little air — a wall far from the line is left off the scale rather than flattening thirty sessions into a thread */
  const sessionRange = ((): readonly [number, number] | undefined => {
    if (sessionPoints.length < 2) return undefined;
    const vs = sessionPoints.map(p => p.value);
    let lo = Math.min(...vs);
    let hi = Math.max(...vs);
    const pad = Math.max((hi - lo) * 0.25, 1e-6);
    for (const l of sessionLines) if (l.price >= lo - pad && l.price <= hi + pad) (lo = Math.min(lo, l.price)), (hi = Math.max(hi, l.price));
    const air = Math.max((hi - lo) * 0.06, 1e-4);
    return [lo - air, hi + air];
  })();
  /* THE DARK PRINTS ON TODAY'S TAPE: the session minute by minute as the line, the off-exchange prints summed per minute as bars under
     it at their true minute (a print's clock matched to the bar of that minute), the biggest of each minute kept for the card */
  const todayPoints: ChartPoint[] = [...new Map(money.today.map(c => [c.time, { time: c.time, value: c.close }])).values()].sort((a, b) => a.time - b.time);
  /* a print's clock is New York's: the bars are matched on New York's minute, not the reader's (round 6: in another zone
     half the prints matched the wrong hour and the rest fell back, the bars smeared over the morning) */
  const minuteOf = new Map(money.today.map(c => [nyClock(c.time * 1000), c.time]));
  const darkMinutes = (() => {
    const byMin = new Map<string, { time: number; value: number; n: number; biggest: (typeof money.dark.prints)[number] }>();
    for (const p of money.dark.prints) {
      let time = minuteOf.get(p.time);
      if (time == null) {
        const [h, m] = p.time.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;
        /* the print's minute on ITS session's New York clock — the browser's today stamped them a day on (the stray "23") */
        const [y, mo, dd] = (file.session || nyIsoDate()).split('-').map(Number);
        time = Math.floor(nyWallTime(y, mo, dd, h, m) / 1000);
      }
      /* one bar per minute, keyed by the minute itself (two clocks in one minute drew two bars at one time — the chart
         refuses an unordered series) */
      const key = String(time);
      const had = byMin.get(key);
      if (had) {
        had.value += p.size;
        had.n += 1;
        if (p.size > had.biggest.size) had.biggest = p;
      } else byMin.set(key, { time, value: p.size, n: 1, biggest: p });
    }
    return [...byMin.values()].sort((a, b) => a.time - b.time);
  })();
  const darkPoints: ChartPoint[] = darkMinutes.map(m => ({ time: m.time, value: m.value, color: INTENT_INK[m.biggest.intent] ?? 'rgb(var(--text-muted))' }));
  const keptPrint = printFocus != null ? darkMinutes.find(m => m.time === printFocus) ?? null : null;
  const largestPrints = [...darkMinutes].sort((a, b) => b.biggest.size - a.biggest.size).slice(0, 5);

  /* THE TIMELINE'S LANES — a row per kind of mark on the sessions on hand, in the report's grammar */
  const tickInk = (kind: TimelineKind, text: string) => (kind === 'session' ? (text.includes('+') ? 'rgb(var(--bull))' : 'rgb(var(--bear))') : KIND_MARK[kind]);
  const laneOf = (key: string, label: string, ink: string, kinds: TimelineKind[]) => {
    const entries = view.timeline.filter(t => kinds.includes(t.kind));
    const ticks: LaneTick[] = entries
      .map(t => ({ i: t.time != null ? trend.times.indexOf(t.time) : t.kind === 'news' ? trend.times.length - 1 : -1, ink: tickInk(t.kind, t.text), when: t.when, text: `${KIND_WORD[t.kind]} · ${t.text}`, score: t.score, tall: t.kind === 'breakout' || t.kind === 'breakdown' || t.kind === 'session' }))
      .filter(t => t.i >= 0);
    const ups = entries.filter(t => t.kind === 'breakout' || (t.kind === 'session' && t.text.includes('+'))).length;
    const downs = entries.filter(t => t.kind === 'breakdown' || (t.kind === 'session' && !t.text.includes('+'))).length;
    const n = entries.length;
    let grade: { words: string; tone: 'good' | 'bad' | 'quiet' };
    if (key === 'earnings') grade = n === 0 ? { words: 'no report on hand', tone: 'quiet' } : entries[0].text.startsWith('beat') ? { words: 'beat', tone: 'good' } : { words: 'missed', tone: 'bad' };
    else if (key === 'news') grade = n === 0 ? { words: `nothing ${storyDayWord}`, tone: 'quiet' } : { words: `${n} ${storyDayWord}`, tone: 'quiet' };
    else if (key === 'volume') grade = n === 0 ? { words: 'none on hand', tone: 'quiet' } : { words: `${n} ${n === 1 ? 'session' : 'sessions'}`, tone: 'quiet' };
    else grade = n === 0 ? { words: 'none on hand', tone: 'quiet' } : { words: `${ups} up · ${downs} down`, tone: ups > downs ? 'good' : downs > ups ? 'bad' : 'quiet' };
    const last = entries[0] ?? null;
    return {
      key,
      label,
      ink,
      ticks,
      figure: key === 'earnings' ? last?.when ?? '—' : String(n),
      grade,
      facts: [
        { k: 'Marks', v: String(n) },
        /* a full ISO date (the report's lane) does not fit the narrow column — it read "2026-08…"; month/day as the others */
        { k: 'Last', v: last?.when ? (/^\d{4}-\d{2}-\d{2}$/.test(last.when) ? `${last.when.slice(5, 7)}/${last.when.slice(8, 10)}` : last.when) : '—' },
        { k: 'Trend then', v: last?.score != null ? gradeOf(last.score) : '—', cls: last?.score != null ? GRADE_INK[gradeOf(last.score)] : undefined },
        { k: 'The last', v: last?.text ?? '—', cls: last ? 'text-textSecondary' : undefined },
      ],
    };
  };
  const lanes = [
    laneOf('breaks', 'Breaks', KIND_MARK.breakout, ['breakout', 'breakdown']),
    laneOf('volume', 'Heavy volume', KIND_MARK.volume, ['volume']),
    laneOf('session', 'Big sessions', 'rgb(var(--text-primary))', ['session']),
    laneOf('news', 'The wire', KIND_MARK.news, ['news']),
    laneOf('earnings', 'The last report', KIND_MARK.earnings, ['earnings']),
  ];

  return (
    <>
      {back}
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read a name" testId="stock-guide" viewport>
        <StockGuide view={view} />
      </GuideFocus>

      {/* THE NAME */}
      <div id="stock-name" className="border border-borderSubtle rounded-md bg-panel scroll-mt-4" data-stock-name={T} data-stock-screen={view.screen} data-stock-lean={view.lean} data-stock-grade={grade}>
        <div className="px-5 pt-4 pb-4 flex items-start gap-6 flex-wrap">
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <CompanyLogo ticker={T} size={34} />
            <div className="min-w-0">
              <div className="h-6 flex items-center gap-2.5">
                <h3 className="text-[15px] font-semibold leading-tight text-textPrimary truncate"><CompanyTitle ticker={T} name={view.name} /></h3>
                <span className="font-mono text-[11px] font-bold text-textSecondary">{T}</span>
                <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the read, the pillars and the factors mean" testId="stock-guide" />
              </div>
              {/* the price line wraps, never truncates (audit round 5, phone: "… after hours 19:59 ET · +…") */}
              <p className="mt-0.5 text-[11px] leading-snug text-textMuted whitespace-normal break-words" title={view.priceLine ?? undefined}>
                <span className="font-mono text-[12px] tnum text-textPrimary">
                  $<AnimatedNumber value={view.price} format={v => v.toFixed(2)} />
                </span>
                {view.priceLine ? <span className="font-mono tnum text-textMuted" data-stock-price-line> {view.priceLine.replace(/^[\d.]+\s?/, '')}</span> : null}{' '}
                {view.lastSession ? (
                  <span className={`font-mono tnum ${view.lastSession.pct >= 0 ? 'text-bull' : 'text-bear'}`} title="Before the open: the last regular session's change, close against the close before it" data-stock-day>
                    · {pct(view.lastSession.pct, 2)} {view.lastSession.date ? shortDay(view.lastSession.date) : 'last session'}
                  </span>
                ) : (
                  <span className={`font-mono tnum ${up ? 'text-bull' : 'text-bear'}`} title="The regular session's change: the regular close (or the last print in the session) against the close before it" data-stock-day>· {pct(view.changePct, 2)} {view.marketWord === 'market open' ? 'today' : 'the session'}</span>
                )}
                {view.extLine ? <span className="font-mono tnum text-textSecondary" data-stock-ext> · {view.extLine}</span> : <> · {view.marketWord}</>}
                {view.sector ? ` · ${view.sector}` : ''}
              </p>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {/* THE READ, in one of three words — the figure behind it is the engine's (Noah, 2026-09-19) */}
            <Fact label="Reads" testId="screen">
              {held ? (
                <span className="text-[13px] font-semibold text-textMuted animate-pulse" title={`Held until ${settling.join(', ')} ${settling.length === 1 ? 'is' : 'are'} in`} data-stock-held>
                  reading…
                </span>
              ) : (
                <span className={`text-[14px] font-bold ${GRADE_INK[grade]}`}>
                  {grade}
                  {provisional && <span className="ml-1.5 font-mono text-[8px] font-normal uppercase tracking-widest text-warn" title={`Still waiting on ${settling.join(', ')}`}>provisional</span>}
                </span>
              )}
            </Fact>
            <Fact label="Leans" testId="lean">
              {held ? <span className="font-semibold text-textMuted">—</span> : <span className={`font-semibold ${LEAN_INK[view.lean]}`}>{view.lean}</span>}
            </Fact>
          </dl>
        </div>
        {/* THE FOUR PILLARS, with their figures */}
        {/* Two by two on a phone (the phone pass, 2026-09-13): four across ran the pillars' words into each other at 390 */}
        <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3" data-stock-pillars>
          {view.pillars.map(p => (
            <PillarBar key={p.key} p={p} big held={held} />
          ))}
        </div>
        <div className="px-5 pb-4 flex items-center gap-2 flex-wrap" data-stock-doors>
          <Door onWarm={warm} onClick={openOnMap}>
            The Map
          </Door>
          <Door onWarm={warm} onClick={() => weigh()}>
            Weigh it
          </Door>
          <Door onWarm={warm} onClick={() => navigate('/compass', { state: { tickerFilter: T } })}>
            Compass
          </Door>
          {news.nextEarnings && <Door onClick={() => navigate(`/dossier/earnings/${T}`)}>Earnings</Door>}
          <Door onClick={() => navigate('/dossier/news', { state: { name: T } })}>The wire</Door>
          {/* WHICH SOURCE IS OUT, AND WHETHER THE READ NEEDS IT (round 9: "8 of 9 sources live" named neither) — the scored
              read is the screener row's alone (trend, numbers, money); every source here is shown beside it */}
          <span
            className={`ml-auto font-mono text-[9px] uppercase tracking-widest text-textMuted ${live < pageSources.length ? 'cursor-help' : ''}`}
            data-stock-completeness={completeness}
            title={
              live < pageSources.length
                ? `Not live: ${pageSources.filter(x => x.status !== 'live').map(x => `${x.label} (${x.stamp})`).join('; ')}. The read itself — the trend, the numbers and the money — is scored off the screener row alone, so it does not wait on ${pageSources.length - live === 1 ? 'it' : 'them'}; the boxes that show ${pageSources.length - live === 1 ? 'it' : 'them'} say so.`
                : 'Every source on the page is live. The read is scored off the screener row; the rest is shown beside it.'
            }
          >
            {live} of {pageSources.length} sources live
            {live < pageSources.length ? <span className="normal-case tracking-normal"> · {pageSources.filter(x => x.status !== 'live').map(x => x.label.toLowerCase()).join(', ')} not live · not in the read</span> : null}
          </span>
        </div>
      </div>

      {/* WHY NOW — the facts, the thesis, the paragraph, the agreement */}
      <Box title="Why now" sub="The biggest facts on the name right now, what is for it and against it, and whether the four pillars agree" testId="why">
        {held ? (
          <div className="px-5 pb-4 flex flex-col gap-2" data-stock-why-held>
            <p className="text-[12px] leading-relaxed text-textMuted animate-pulse">Reading {settling.join(', ')} — the read and its reasons appear once the sources it stands on are in.</p>
          </div>
        ) : (
        <>
        <div className="px-5 pb-3 flex flex-col gap-2">
          {provisional && <p className="font-mono text-[9px] uppercase tracking-widest text-warn">Provisional · {settling.join(', ')} did not answer yet</p>}
          <p className="text-[12px] leading-relaxed text-textPrimary/90" data-stock-why>
            <RichRead text={view.whyNow} />
          </p>
          <p className="text-[12px] leading-relaxed text-textSecondary" data-stock-thesis>
            <RichRead text={view.thesis} />
          </p>
          <p className="text-[12px] leading-relaxed text-textSecondary" data-stock-explanation>
            <RichRead text={view.explanation} />
          </p>
        </div>
        <div className="px-5 py-3 border-t border-borderSubtle/40 flex items-center gap-2 flex-wrap" data-stock-agreement={agreement.aligned}>
          <span className="font-mono text-[9px] uppercase tracking-widest text-textMuted mr-1">
            {agreement.lean === 'neutral' ? (
              <>
                the read is <span className={LEAN_INK.neutral}>neutral</span> · {agreement.pillars.filter(p => p.stance === 'for').length} pull for · {agreement.pillars.filter(p => p.stance === 'against').length} against
              </>
            ) : (
              <>
                {agreement.aligned} of {agreement.pillars.length} agree · the read leans <span className={LEAN_INK[agreement.lean]}>{agreement.lean}</span>
              </>
            )}
          </span>
          {agreement.pillars.map(p => (
            <span key={p.key} className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border font-mono text-[10px] tnum transition-colors ${p.agrees ? 'border-borderMuted text-textPrimary bg-ink/[0.04]' : 'border-borderSubtle text-textMuted'}`} data-stock-agree={p.key} data-agrees={p.agrees || undefined} data-stance={p.stance}>
              <span className={`w-1.5 h-1.5 rounded-full ${GRADE_FILL[gradeOf(p.score)]}`} />
              {p.name.replace('The ', '')} <span className={GRADE_INK[gradeOf(p.score)]}>{gradeOf(p.score)}</span>
              <span className={`text-[8px] uppercase tracking-widest ${p.stance === 'agrees' ? 'text-textSecondary' : p.stance === 'argues' ? 'text-warn' : p.stance === 'for' ? 'text-bull' : p.stance === 'against' ? 'text-bear' : 'text-textMuted'}`}>{p.stance === 'middle' ? 'middle' : p.stance === 'for' ? 'pulls for' : p.stance === 'against' ? 'pulls against' : p.stance}</span>
            </span>
          ))}
          <span className="basis-full text-[11px] text-textSecondary" data-stock-risk>
            {agreement.risk}
          </span>
        </div>
        </>
        )}
      </Box>

      {/* THE TREND · THE MONEY */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="The trend" sub={`The screener's trend measures · the swing structure from the name's own ${trend.sessions} sessions`} aside={<PillarBarSmall p={byKey.trend} held={held} />} testId="trend">
          <div className="px-5 pb-3">
            <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
              <Fact label="20-day EMA" testId="ema20" tip="The 20-day exponential moving average (the screener's ema_20), and the last regular close against it — the figure the trend factor scores">
                {trend.ema20 != null ? (
                  <>
                    {trend.ema20.toFixed(2)} <span className={`${trend.refClose >= trend.ema20 ? 'text-bull' : 'text-bear'}`}>{pct(((trend.refClose - trend.ema20) / trend.ema20) * 100)}</span>
                  </>
                ) : (
                  <span className="text-textMuted">—</span>
                )}
              </Fact>
              <Fact label="50 · 200-day SMA" testId="smas" tip="The 50- and 200-day simple moving averages (the screener's sma_50 and sma_200)">
                {trend.sma50 != null ? trend.sma50.toFixed(2) : <span className="text-textMuted">needs 50</span>} <span className="text-textMuted">·</span> {trend.sma200 != null ? trend.sma200.toFixed(2) : <span className="text-textMuted">needs 200</span>}
              </Fact>
              <Fact label="Above its averages" testId="above">
                {trend.above.count} <span className="text-textMuted">of {trend.above.of} on hand</span>
              </Fact>
              <Fact label="RSI · ADX" testId="rsi" tip="RSI and ADX over 14 sessions — the screener's rsi_14 and adx_14, the same figures the factors below score">
                {trend.rsi14 != null ? trend.rsi14.toFixed(0) : '—'} <span className="text-textMuted">·</span> {trend.adx14 != null ? trend.adx14.toFixed(0) : '—'}
              </Fact>
              <Fact label={`Range · ${screenWord}${file.rangeAsOf ? ` · to ${file.rangeAsOf}` : ''}`} testId="atr">
                {trend.atrPercentile != null ? (
                  <>
                    {trend.rangeToday != null ? trend.rangeToday.toFixed(2) : ''} <span className="text-textMuted">· {ordinal(trend.atrPercentile)} pct</span>
                  </>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label={trend.source === 'screener' ? 'The week · the month' : '5 · 20 sessions'} testId="changes" tip={trend.source === 'screener' ? "The screener's one_week_perc and one_month_perc — the month is the figure 'The last month' scores" : 'The change over the last 5 and 20 sessions on hand'}>
                {trend.change5Pct != null ? <span className={trend.change5Pct >= 0 ? 'text-bull' : 'text-bear'}>{pct(trend.change5Pct)}</span> : '—'} <span className="text-textMuted">·</span>{' '}
                {trend.change20Pct != null ? <span className={trend.change20Pct >= 0 ? 'text-bull' : 'text-bear'}>{pct(trend.change20Pct)}</span> : '—'}
              </Fact>
            </dl>
          </div>
          {/* THE SESSIONS ON HAND, on the chart library: the closes as ONE LINE in the page's ink (a whole line in red or green
              said one thing about thirty sessions), the 20-day and the walls as price lines named inside the plot, the
              timeline's marks on the line, a card under the pointer. The chart FILLS the box's spare room — the box stands
              as tall as The money beside it, and the room used to be a void between the structure line and the factors. */}
          {sessionPoints.length > 2 && (
            <div className="px-5 pb-3 flex-1 min-h-[220px] flex flex-col" data-stock-sessions>
              <SessionsChart
                testId="sessions"
                kind="line"
                fill
                ink="rgb(var(--text-primary))"
                points={sessionPoints}
                range={sessionRange}
                lines={sessionLines}
                marks={sessionMarks}
                clock="day"
                scale="price"
                cardH={96}
                card={({ point: p, prev, marks }) =>
                  p && (
                    <>
                      <span className="font-mono text-[11px] font-bold tnum text-textPrimary">{dayOf(p.time)}</span>
                      <span className="font-mono tnum">
                        closed <span className="text-textPrimary">{p.value.toFixed(2)}</span>
                        {prev && (
                          <span className={p.value >= prev.value ? 'text-bull' : 'text-bear'}>
                            {' '}
                            {pct(((p.value - prev.value) / prev.value) * 100)}
                          </span>
                        )}
                        {trend.ema20 != null && <span className="text-textMuted"> · {pct(((p.value - trend.ema20) / trend.ema20) * 100)} from the 20-day EMA</span>}
                      </span>
                      {marks.map(m => (
                        <span key={m.text} className="text-[10px] leading-snug" style={{ color: m.color }}>
                          {m.text}
                        </span>
                      ))}
                    </>
                  )
                }
              />
            </div>
          )}
          {/* the structure and its four flags; the walls are named on the chart now, not repeated here */}
          <div className="px-5 pb-3 flex items-center gap-3 text-[11px] text-textSecondary">
            <span className="truncate">
              The structure: <span className="text-textPrimary">{trend.structure}</span>
            </span>
            {trend.flags && <Flags flags={trend.flags} />}
          </div>
          <div>
            {byKey.trend.factors.map(f => (
              <FactorRow key={f.key} f={f} />
            ))}
          </div>
        </Box>
        <Box title="The money" sub="The live book · all expiries (every listed date) unless marked Today · DEX, vanna and charm summed over every strike, dealer side" aside={<PillarBarSmall p={byKey.money} held={held} />} testId="money">
          <dl className="px-5 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <Fact label="Net DEX · VEX" testId="dex" tip="Dealers' side, every strike of the live book. DEX in dollars of stock: the vendor's delta × open interest × 100 (share units, as /greek-exposure prints them) × the price. VEX is not on the vendor's greek rows — it reads — rather than a figure made of rounding">
              <Money v={money.netDex} /> <span className="text-textMuted">·</span> {money.netVex != null ? <Money v={money.netVex} /> : <span className="text-textMuted">—</span>}
              {/* one plain line (round 9: "Net DEX −$30.8B" with no word on what it is) */}
              <span className="block text-[9px] font-sans text-textMuted leading-snug" data-stock-fact="dex-says">
                {money.netDex < 0 ? "dealers' options leave them short this much stock, before their hedge" : "dealers' options leave them long this much stock, before their hedge"}
              </span>
            </Fact>
            <Fact label="Vanna · charm" testId="vanna" tip="Dealers' side, every strike of the live book, in dollars: vanna per volatility point (the vendor's vanna × open interest × 100 × 1% of the price), charm per session (× the price ÷ 252). The vendor's /greek-exposure totals are the same sums in share units, from its daily snapshot">
              <Money v={money.netVanna} /> <span className="text-textMuted">·</span> <Money v={money.netCharm} />
            </Fact>
            <Fact label="Open interest" testId="oi">
              <OpenInterest ticker={view.ticker} fallbackCall={money.callOI} fallbackPut={money.putOI} />
            </Fact>
            <Fact label={money.volumeAvgIs30 ? "Volume · 30-day avg" : "Volume · usual"} testId="volume">
              {money.volumeToday != null ? count(money.volumeToday) : '—'} <span className="text-textMuted">· {money.volumeAvg != null ? count(money.volumeAvg) : '—'}</span>
              {money.rvolPaced && (
                <span className={money.rvol != null && money.rvol >= 1.3 ? 'text-silver' : 'text-textMuted'} title={money.rvolPaced.basis === 'paced' ? `The session's volume so far against the share of a usual day that trades by now (${Math.round(money.rvolPaced.share * 100)}%) — 1.00× is on pace for an ordinary day. Of a full day so far: ${money.rvolPaced.raw.toFixed(2)}×.` : money.rvolPaced.basis === 'full' ? "The whole session's volume against its 30-day average." : 'Too early in the session to pace — shown, not read.'}>
                  {' '}· {money.rvolPaced.label}
                </span>
              )}
            </Fact>
            <Fact label="Closed in its range" testId="close">
              {money.closeInRange != null ? (
                <>
                  {Math.round(money.closeInRange * 100)}% <span className="text-textMuted">up from the low</span>
                </>
              ) : (
                '—'
              )}
            </Fact>
            <Fact label="Unusual" testId="unusual">
              {prem > 0 ? (
                <>
                  {money.unusual} <span className="text-textMuted">at 2× OI</span>
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
            <Fact label={file.tapes === 'loading' || money.darkWindow.complete ? `Dark · ${sessionWord}` : 'Recent dark'} testId="darkshare" tip={`The off-exchange prints of 10K shares or $500K+ in hand${money.darkWindow.complete ? ' — the session paged back to the open' : money.darkWindow.cover ? `, from ${money.darkWindow.cover} ET on (the tape in hand stops there)` : ''}: dollars · prints, extended hours included. Own-terms prints (average-price, contingent, reference-price, derivative-priced${money.darkWindow.ownTerms ? ` — ${money.darkWindow.ownTerms} of them` : ''}) are left out. The buyer/seller read under it is on the regular session's prints at the quote alone${money.darkWindow.outsideRead ? ` — ${money.darkWindow.read.toLocaleString('en-US')} prints, ${fmtMoney(money.darkWindow.readNotional)}; the other ${money.darkWindow.outsideRead.toLocaleString('en-US')} (extended hours, or no quote to read against) are on the card, not in the read` : ''}`}>
              {money.dark.prints.length ? (
                <>
                  {fmtMoney(money.dark.totalNotional)} <span className="text-textMuted">· {money.dark.prints.length.toLocaleString('en-US')} prints</span>
                  {/* the card's set and the read's set, both stated (audit round 6: "$806M · 648" beside a read of 630) */}
                  {money.darkWindow.outsideRead ? (
                    <span className="block text-[10px] text-textMuted" data-name-fact="darkread">
                      {/* said plainly (round 9: "read: 600 in session" beside 620 was two counts unexplained) */}
                      buyer/seller read on the {money.darkWindow.read.toLocaleString('en-US')} regular-hours prints ({fmtMoney(money.darkWindow.readNotional)}); {money.darkWindow.outsideRead.toLocaleString('en-US')} outside hours or unquoted are not read
                    </span>
                  ) : null}
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
          </dl>
          {/* TWO SCOPES, TWO ROWS (audit round 5: "Net GEX · all expiries $29.0M · absorbing" sat beside "TODAY · net GEX
              −$73.9M · amplifying" and read as a contradiction). Both are Pinpoint's levelsFor, each under its own header —
              the nearest expiry first, then the whole book — and the one line under them says why their signs can differ. */}
          <div className="px-5 pb-2 flex flex-col gap-2" data-stock-gex-scopes>
            {/* NO PROVISIONAL FIGURE, PINPOINT'S RULE (the Pinpoint audit, round 6): the nearest expiry printed the ATM-vol
                flip and then another (SPY 771.26 → 772.17), the whole book printed before the expired contracts came off
                (SPY −$17.7B and "no flip", true −$14.7B and 776.60). Every level reads "…" until levelsFor says the scope is
                complete, and the scope's own label (levelsFor.scopeLabel) heads it, verbatim. */}
            <div className="rounded border border-borderSubtle/70 px-3 py-2" data-stock-levels-scope={money.levelsToday ? (money.levelsToday.complete ? 'today' : 'today-pending') : 'today-none'} data-complete={money.levelsToday?.complete ? 'yes' : 'no'} title="Pinpoint's nearest-expiry scope: the contracts of the nearest live expiry alone (after the bell, the next session's)">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="font-mono text-[9px] uppercase tracking-widest text-textPrimary font-semibold" data-stock-scope-label>{money.levelsToday ? money.levelsToday.scopeLabel : 'Nearest expiry'}</span>
                {money.levelsToday ? (
                  <span className="font-mono text-[11px] tnum" data-stock-gex-next>
                    net GEX{' '}
                    {money.levelsToday.complete ? (
                      <>
                        <Money v={money.levelsToday.netGex} /> {money.levelsToday.regime ? <span className="text-textMuted">· {money.levelsToday.regime === 'SHORT' ? 'amplifying' : 'absorbing'}</span> : null}
                      </>
                    ) : (
                      <span className="text-textMuted">…</span>
                    )}
                  </span>
                ) : null}
              </div>
              {money.levelsToday && !money.levelsToday.complete ? (
                <p className="mt-1 font-mono text-[10px] tnum text-textMuted" data-stock-levels-provisional>supreme … · call wall … · put wall … · flip … <span className="normal-case">— reading this name's front expiry</span></p>
              ) : money.levelsToday ? (
                <LevelsLine levels={money.levelsToday} />
              ) : (
                <p className="mt-1 font-mono text-[10px] text-textMuted">Reading the options book…</p>
              )}
            </div>
            <div ref={allRef} className="rounded border border-borderSubtle/70 px-3 py-2" data-stock-levels-scope="all" data-complete={money.levelsAll?.complete ? 'yes' : 'no'}>
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <span className="font-mono text-[9px] uppercase tracking-widest text-textPrimary font-semibold">{money.levelsAll ? money.levelsAll.scopeLabel : 'All expiries'} · every listed date</span>
                <span className="font-mono text-[11px] tnum" data-stock-gex-all title="Net gamma exposure over every strike of every listed expiry — the figure Pinpoint shows on All expiries. Positive: dealers are long gamma and their hedging absorbs moves; negative: it amplifies them">
                  net GEX{' '}
                  {money.levelsAll?.complete ? (
                    <>
                      <Money v={money.levelsAll.netGex} /> <span className="text-textMuted">· {money.levelsAll.regime === 'SHORT' ? 'amplifying' : 'absorbing'}</span>
                    </>
                  ) : (
                    <span className="text-textMuted">…</span>
                  )}
                </span>
              </div>
              {money.levelsAll?.complete ? (
                <>
                  <LevelsScale spot={view.price} putWall={money.levelsAll.putWall} flip={money.levelsAll.flip} callWall={money.levelsAll.callWall} supreme={money.levelsAll.supreme} legsAt={money.levelsAll.legsAt} />
                  <LevelsLine levels={money.levelsAll} />
                  {money.levelsAll.flip == null && <p className="font-mono text-[10px] text-textMuted" data-stock-flip="none">No flip within ±10% — net gamma stays {money.levelsAll.regime === 'SHORT' ? 'short' : 'long'} across the range.</p>}
                </>
              ) : (
                allWanted ? (
                  <p className="py-2 font-mono text-[10px] text-textMuted" data-stock-levels-pending>supreme … · call wall … · put wall … · flip … — the levels are given once every listed expiry is in.</p>
                ) : (
                  <p className="py-2 font-mono text-[10px] text-textMuted" data-stock-levels-deferred>
                    The whole book's levels read every listed expiry{peekEntry(T)?.expiries?.length ? ` (${peekEntry(T)!.expiries.length} dates)` : ''} —{' '}
                    <button type="button" onClick={() => setAllWanted(true)} className="text-textSecondary hover:text-textPrimary underline decoration-dotted underline-offset-2" data-stock-levels-load>
                      read every expiry
                    </button>
                    , or scroll here and they load.
                  </p>
                )
              )}
            </div>
            <p className="text-[10.5px] leading-relaxed text-textMuted" data-stock-gex-note>
              The two scopes can differ in sign: the nearest expiry's dealers can be short gamma (amplifying) while the whole book is long (absorbing), or the reverse. Each figure is right for its own contracts; the nearest expiry drives {isTradingDay(nyTodayDate()) && nySessionPhase() === 'open' ? 'the rest of today' : 'the next session'}, the whole book the weeks after.
            </p>
          </div>
          {prem > 0 ? (
          <div className="px-5 pb-2" data-stock-flow>
            <div className="flex items-center justify-between gap-2 font-mono text-[10px] tnum">
              <span className={callShare >= 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>calls {fmtMoney(money.callPremium)}</span>
              <span className="text-[9px] uppercase tracking-widest text-textMuted text-center" title="The screener's call_premium and put_premium: every dollar paid for calls and for puts">option premium · {screenWord} · {Math.round(callShare)}% calls</span>
              <span className={callShare < 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>puts {fmtMoney(money.putPremium)}</span>
            </div>
            <div className="mt-1.5">
              <ShareBar left={callShare} />
            </div>
            {sidePrem > 0 && (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] tnum" data-stock-side>
                  <span className={bullShare >= 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>bullish {fmtMoney(money.bullishPremium)}</span>
                  <span className="text-[9px] uppercase tracking-widest text-textMuted text-center" title="Bullish: calls bought at the ask and puts sold at the bid. Bearish: puts bought at the ask and calls sold at the bid. The screener's bullish_premium and bearish_premium">the side of the trade · {Math.round(bullShare)}% bullish</span>
                  <span className={bullShare < 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>bearish {fmtMoney(money.bearishPremium)}</span>
                </div>
                <div className="mt-1.5">
                  <ShareBar left={bullShare} />
                </div>
              </>
            )}
            {file.tapes === 'loading' && (
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-widest text-textMuted" data-stock-alerts="reading">reading the flow alerts of {sessionWord}…</p>
            )}
            {file.tapes === 'live' && money.askSharePct != null && money.sweepSharePct != null && (
              <p className="mt-1.5 font-mono text-[9px] uppercase tracking-widest text-textMuted" data-stock-alerts>
                {money.flowWindow.complete
                  ? `${money.flowWindow.alerts.toLocaleString('en-US')} flow alerts on ${sessionWord}`
                  : `the latest ${money.flowWindow.alerts.toLocaleString('en-US')} flow alerts on ${sessionWord}, ${money.flowWindow.from}–${money.flowWindow.to} ET`}{' '}
                · {money.askSharePct.toFixed(1)}% of their premium filled on the ask · {money.sweepSharePct.toFixed(0)}% swept
              </p>
            )}
          </div>
          ) : (
            <div className="px-5 pb-2 font-mono text-[10px] uppercase tracking-widest text-textMuted">No option premium on the screener yet</div>
          )}
          {file.tapes === 'loading' && (
            <div className="px-5 pb-3 font-mono text-[10px] uppercase tracking-widest text-textMuted" data-stock-dark="reading">Reading the dark-pool prints of {sessionWord}, paged back to the open…</div>
          )}
          {money.dark.prints.length > 0 && (
          <div className="px-5 pb-3" data-stock-dark={money.darkWindow.read ? money.dark.posture : 'none'} title="Each print set against the NBBO mid at its own print time: paid over the mid is buyer-initiated (buying), sold under it seller-initiated (selling). Average-price, prior-reference, contingent and derivative-priced prints and every print outside 09:30–16:00 ET are shown on the tape but not read">
            {/* THE CAPTION ON ITS OWN LINE (round 11: the long caption ran over "selling" and "buying" at the bar's ends) */}
            <p className="font-mono text-[9px] uppercase tracking-widest text-textMuted leading-snug" data-stock-dark-caption>
                {money.darkWindow.read
                  ? `dark pool · ${postureRead(money.dark)} · ${money.darkWindow.read.toLocaleString('en-US')} regular-session ${money.darkWindow.read === 1 ? 'print' : 'prints'} of 10K shares or $500K+ on ${sessionWord}${money.darkWindow.complete ? (money.darkWindow.from ? `, ${money.darkWindow.from}–${money.darkWindow.to} ET` : '') : `, from ${money.darkWindow.cover ?? money.darkWindow.from} ET to the close only — the tape in hand stops there`}${money.dark.largest ? ` · the largest ${fmtMoney(money.dark.largest.notional)} at ${money.dark.largest.price.toFixed(2)}` : ''}`
                  : `dark pool · no read · none of the ${money.darkWindow.inHand} prints in hand is a sized regular-session print priced at the quote`}
            </p>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] tnum">
              <span className={money.dark.netPosturePct < 0 ? 'text-bear font-semibold' : 'text-textSecondary'}>selling</span>
              <span className={money.dark.netPosturePct > 0 ? 'text-bull font-semibold' : 'text-textSecondary'}>buying</span>
            </div>
            <div className="mt-1.5">
              <SignedBar v={money.dark.netPosturePct / 100} thick />
            </div>
          </div>
          )}
          {/* Today's session, from the live book. Off-exchange prints only when the feed has them. */}
          {/* the line is the chart: without the session's minutes there is no price to set the prints under */}
          {todayPoints.length > 1 && (
            <div className="px-5 pb-3" data-stock-dark-prints={darkPoints.length}>
              <div className="mb-1 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-textMuted">
                <span>{darkPoints.length > 1 ? `${sessionWord} tape · the off-exchange prints of 10K shares or $500K+ under it, shares by minute` : `${sessionWord} tape`}</span>
                <span>{darkPoints.length > 1 ? `${money.dark.prints.length} ${money.dark.prints.length === 1 ? 'print' : 'prints'}` : ''}</span>
              </div>
              <SessionsChart
                testId="dark-prints"
                zone="ny"
                kind="line"
                height={132}
                ink="rgb(var(--text-secondary))"
                points={todayPoints}
                bars={darkPoints}
                clock="clock"
                scale="price"
                cardH={84}
                focus={printFocus}
                onFocus={setPrintFocus}
                card={({ time, point, bar, kept }) => {
                  const m = bar ? darkMinutes.find(d => d.time === time) : null;
                  return (
                    <>
                      <span className="font-mono text-[11px] font-bold tnum text-textPrimary">
                        {clockOf(time)}
                        {point && <span className="text-textMuted font-normal"> · {point.value.toFixed(2)}</span>}
                        {m && <span className="text-textMuted font-normal"> · {m.n === 1 ? 'one print' : `${m.n} prints`}</span>}
                        {kept && <span className="text-silver font-normal text-[9px] uppercase tracking-widest"> · kept</span>}
                      </span>
                      {m ? (
                        <>
                          <span className="font-mono tnum">
                            <span className="text-textPrimary">{count(m.value)}</span> shares · the largest {count(m.biggest.size)} @ {m.biggest.price.toFixed(2)} · {fmtMoney(m.biggest.notional)}
                          </span>
                          <span className="text-[10px] leading-snug" style={{ color: INTENT_INK[m.biggest.intent] ?? 'rgb(var(--text-secondary))' }}>
                            {m.biggest.intent.toLowerCase()} · {m.biggest.venue}
                          </span>
                        </>
                      ) : (
                        <span className="text-[10px] text-textMuted">no off-exchange print this minute</span>
                      )}
                    </>
                  );
                }}
              />
              {/* THE KEPT PRINT, or the largest to keep — a click on a bar keeps it too */}
              <div className="mt-1.5 min-h-[26px] flex items-center gap-2 flex-wrap font-mono text-[10px] tnum" data-stock-print-focus={printFocus ?? 'none'}>
                {keptPrint ? (
                  <>
                    <span className="text-[9px] uppercase tracking-widest text-silver">kept</span>
                    <span className="font-semibold text-textPrimary">{clockOf(keptPrint.time)}</span>
                    <span className="text-textSecondary">
                      {count(keptPrint.biggest.size)} @ {keptPrint.biggest.price.toFixed(2)} · {fmtMoney(keptPrint.biggest.notional)} · {keptPrint.biggest.venue}
                    </span>
                    <span style={{ color: INTENT_INK[keptPrint.biggest.intent] ?? 'rgb(var(--text-secondary))' }}>
                      {keptPrint.biggest.intent.toLowerCase()} · a {gradeOfConviction(keptPrint.biggest.conviction)} read
                    </span>
                    <span className="text-textMuted">
                      {pct(keptPrint.biggest.vsSpotPct)} from spot{keptPrint.biggest.atLevel ? ' · on a shelf' : ''}
                    </span>
                    <button type="button" onClick={() => setPrintFocus(null)} className="ml-auto inline-flex items-center h-5 px-1.5 rounded border border-borderSubtle text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-stock-print-release>
                      let go
                    </button>
                    <span className="basis-full text-[10.5px] font-sans text-textSecondary truncate" data-stock-print-read>
                      {keptPrint.biggest.read}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-[9px] uppercase tracking-widest text-textMuted" title="Click one, or a bar on the tape, to keep it">
                      the largest ·
                    </span>
                    {largestPrints.map(m => (
                      <button key={m.time} type="button" onClick={() => setPrintFocus(m.time)} className="inline-flex items-center gap-1.5 h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted transition-colors" title={`${clockOf(m.time)} · ${count(m.biggest.size)} @ ${m.biggest.price.toFixed(2)} · ${m.biggest.venue}`} data-stock-print-chip={m.time}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: INTENT_INK[m.biggest.intent] ?? 'rgb(var(--text-muted))' }} />
                        <span className="text-textPrimary">{clockOf(m.time)}</span>
                        <span className="text-textSecondary">{count(m.biggest.size)}</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="mt-auto">
            {byKey.money.factors.map(f => (
              <FactorRow key={f.key} f={f} />
            ))}
          </div>
        </Box>
      </div>

      {/* THE NEWS · THE NUMBERS */}
      <CompanyFile ticker={T} />
      <NameBooks ticker={T} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="The news" sub={`The wire on ${T} · ${wireReading && news.stories.length === 0 ? 'reading' : `${news.stories.length} ${news.stories.length === 1 ? 'story' : 'stories'} ${storyDayWord}`}${news.reports.length ? ` · the last ${news.reports.length} earnings ${news.reports.length === 1 ? "report" : "reports"}` : ''}`} aside={<PillarBarSmall p={byKey.news} held={held} />} testId="news">
          {news.stories.length === 0 ? (
            <div className="px-5 pb-4 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{wireReading ? 'Reading the wire' : recordNews.status === 'sim' ? 'This read did not land' : `Nothing on the wire ${storyDayWord}`}</div>
          ) : (
            <div>
              {news.stories.map(s => (
                <button key={s.id} type="button" onClick={() => navigate('/dossier/news', { state: { selectedId: s.id, name: T } })} className="group w-full text-left px-5 h-[34px] grid items-center gap-x-3 border-t border-borderSubtle/40 hover:bg-ink/[0.03] transition-colors" style={{ gridTemplateColumns: '64px minmax(0, 1fr) 64px 56px' }} data-stock-story={s.id}>
                  <span className="font-mono text-[10px] tnum text-textMuted">{ago(s.item.minutesAgo)}</span>
                  <span className="min-w-0 truncate text-[11.5px] text-textSecondary group-hover:text-textPrimary transition-colors" title={closedAgainst(s.item.headline, s.item.atMs) ?? undefined}>
                    {/* A HEADLINE'S MOVE THE CLOSE UNDID (round 11: "APPLE SHARES TOUCH RECORD HIGH, LAST UP 0.4%" while AAPL
                        closed −0.14%) — said beside it */}
                    {closedAgainst(s.item.headline, s.item.atMs) ? <span className="text-warn">{closedAgainst(s.item.headline, s.item.atMs)} · </span> : null}
                    {s.item.headline}
                  </span>
                  <NewsFlag major={s.item.major} lean={s.grade === 'ALLY' ? 'positive' : s.grade === 'THREAT' ? 'negative' : null} />
                  <span className="text-right font-mono text-[11px] font-semibold tnum whitespace-nowrap"><PublishMove p={s.item.prediction} short /></span>
                </button>
              ))}
            </div>
          )}
          {/* THE LAST REPORTS — what it earned against the estimate, and how the stock took it */}
          {news.reports.length > 0 && (
            <div className="border-t border-borderSubtle/40" data-stock-reports={news.reports.length}>
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: '78px 52px minmax(0, 1fr) 96px' }}>
                <span className="whitespace-nowrap">Report</span>
                <span className="whitespace-nowrap">EPS</span>
                {/* one line on a phone: the long heads wrapped three deep over the first row (the Dossier sweep, 2026-10-22) */}
                <span className="min-w-0 truncate">Against the estimate</span>
                <span className="text-right whitespace-nowrap"><span className="max-sm:hidden">The session after</span><span className="sm:hidden">Day after</span></span>
              </div>
              {news.reports.map(r => (
                <div key={r.label} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: '78px 52px minmax(0, 1fr) 96px' }} data-stock-report={r.label}>
                  <span className="font-mono text-[10px] tnum text-textSecondary whitespace-nowrap">{r.label}</span>
                  <span className={`font-mono text-[11px] tnum ${r.epsActual == null ? 'text-textMuted' : 'text-textPrimary'}`}>{r.epsActual == null ? '—' : r.epsActual.toFixed(2)}</span>
                  <span className={`min-w-0 truncate font-mono text-[10px] tnum ${r.result === 'beat' ? 'text-bull' : r.result === 'miss' ? 'text-bear' : 'text-textSecondary'}`} title={r.estOff && r.epsEst != null ? `The vendor's estimate, ${r.epsEst.toFixed(2)}, is far off this name's other estimates — likely a vendor error, so no beat or miss size is read from it` : r.result == null ? 'The vendor has no street estimate for this report, so it is not called a beat or a miss' : undefined}>
                    {r.result == null || r.epsActual == null || r.epsEst == null ? (
                      <span className="text-textMuted">{r.epsActual == null ? 'no EPS on file' : 'no estimate on file'}</span>
                    ) : r.estOff ? (
                      <>
                        <span className="text-textMuted">vs {r.epsEst.toFixed(2)} · </span>
                        <span className="text-warn">estimate looks off</span>
                      </>
                    ) : r.result === 'inline' ? (
                      <>in line <span className="text-textMuted">with {r.epsEst.toFixed(2)}</span></>
                    ) : (
                      <>
                        {r.result === 'beat' ? 'beat' : 'missed'} <span className="text-textMuted">{r.epsEst.toFixed(2)} by</span> {epsGap(r.epsActual, r.epsEst)}
                      </>
                    )}
                  </span>
                  <span className={`text-right font-mono text-[11px] tnum font-semibold ${r.movePct == null ? 'text-textMuted' : r.movePct >= 0 ? 'text-bull' : 'text-bear'}`}>{r.movePct == null ? '—' : pct(r.movePct)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-auto">
            {byKey.news.factors.map(f => (
              <FactorRow key={f.key} f={f} />
            ))}
            <div className="px-5 py-2.5 border-t border-borderSubtle/40 flex items-center gap-3 min-w-0 font-mono text-[10px] tnum" data-stock-next-earnings>
              {news.nextEarnings ? (
                <span className="text-textSecondary truncate min-w-0">
                  reports <span className="text-textPrimary">{news.nextEarnings.label}</span> · {untilWords(news.nextEarnings.daysOut)} {news.nextEarnings.impliedMovePct > 0 ? <> · the options price <span className="text-textPrimary">±{news.nextEarnings.impliedMovePct.toFixed(1)}%</span></> : <> · not priced yet</>}
                  {!news.nextEarnings.confirmed && <span className="text-warn" title="The company has not announced this date yet — it is Unusual Whales' estimate and can move"> · date estimated</span>}
                  {news.nextEarnings.timeKnown === false && <span className="text-textMuted"> · time not set</span>}
                  {news.reaction && (
                    <span className="text-textMuted">
                      {' '}
                      · the last {news.reaction.reports} {news.reaction.reports === 1 ? 'report' : 'reports'} moved it ±{news.reaction.pct.toFixed(1)}% on average
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-textMuted truncate min-w-0">
                  {/ETF|ETN|fund|trust/i.test(String(file.screen?.issue_type ?? '')) ? 'a fund — funds do not report earnings' : 'no report date on file'}{news.reaction ? ` · the last ${news.reaction.reports} ${news.reaction.reports === 1 ? 'report' : 'reports'} moved it ±${news.reaction.pct.toFixed(1)}% on average` : ''}
                </span>
              )}
              <Link to="/dossier/news" state={{ name: T }} className="ml-auto shrink-0 inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors whitespace-nowrap">
                <ArrowUpRight className="w-3 h-3" /> the wire
              </Link>
            </div>
          </div>
        </Box>
        <Box
          title="The numbers"
          sub={numbers.sample ? (file.status === 'loading' ? 'Reading the last print' : 'No print on this feed yet') : 'The last print, earnings growth, the dividend and the market cap'}
          aside={
            <div className="flex items-center gap-3">
              {numbers.sample ? null : <PillarBarSmall p={byKey.numbers} held={held} />}
            </div>
          }
          testId="numbers"
        >
          {numbers.sample ? (
            <div className="px-5 pb-4 font-mono text-[10px] uppercase tracking-widest text-textMuted" data-stock-sample>
              {file.status === 'loading' ? 'Reading the last print' : 'No print on this feed yet'}
            </div>
          ) : (
          <>
          <dl className="px-5 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            {numbers.epsActual != null && (
            <Fact label="EPS · last print" testId="eps">
              {numbers.epsActual < 0 ? '−' : ''}${Math.abs(numbers.epsActual).toFixed(2)}{numbers.epsSurprisePct != null && numbers.epsEstimate != null ? <> <span className={numbers.epsSurprisePct >= 0 ? 'text-bull' : 'text-bear'}>{centsGap(numbers.epsActual, numbers.epsEstimate) ? `${numbers.epsActual - numbers.epsEstimate >= 0 ? '+' : '−'}${Math.round(Math.abs(numbers.epsActual - numbers.epsEstimate) * 100)}¢` : pct(numbers.epsSurprisePct)}</span></> : null}
            </Fact>
            )}
            {numbers.epsGrowthPct != null && (
            <Fact label="EPS growth · year over year" testId="growth" tip="The latest quarter's earnings per share against the same quarter a year before (the screener's eps_growth_4q), to two decimals">
              <span className={numbers.epsGrowthPct >= 0 ? 'text-bull' : 'text-bear'}>{pct(numbers.epsGrowthPct, 2)}</span>
              {trajectory ? <span className="text-textMuted"> · {trajectory}</span> : null}
            </Fact>
            )}
            {numbers.beats != null && (
            <Fact label="Beat · in line · miss" testId="health" tip="Of the last reports with both an actual and an estimate: beat, in line (equal to the cent), missed">
              <span className="text-bull">{numbers.beats}</span> · {numbers.inline ?? 0} · <span className="text-bear">{numbers.misses ?? 0}</span> <span className="text-textMuted">of {numbers.beatOf}</span>
            </Fact>
            )}
            {numbers.dividendYieldPct != null && (
            <Fact label="Dividend yield" testId="div">
              {numbers.dividendYieldPct.toFixed(2)}%
            </Fact>
            )}
            {/* no market cap here: "The company" carries it from the name's own card, and the screener's figure beside it
                disagreed by a few percent ($5.16T against $5.28T — the Dossier sweep, 2026-10-22) */}
            <StockFacts ticker={T} />
          </dl>
          <div className="mt-auto">
            {byKey.numbers.factors.map(f => (
              <FactorRow key={f.key} f={f} />
            ))}
          </div>
          </>
          )}
        </Box>
      </div>

      {/* BEHIND THE READ — the old "How the score is made", in words (Noah, 2026-09-19: no score, point, weight or cut of
          ours reaches the screen; they sort the rows and pick the word, and stay inside the engine) */}
      <Box title="Behind the read" sub="What is for the name and what is against it, factor by factor · how each pillar reads · the read session by session · what would change it · where every figure comes from" testId="score">
        {/* The three columns under each other below lg (the phone pass, 2026-09-13): three tables in 356px were three unreadable ones */}
        <div className="grid border-t border-borderSubtle/60 grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {/* WHAT IS FOR IT, WHAT IS AGAINST IT — every factor, the heaviest first; the bar is a length, never a figure */}
          <div className="border-r border-borderSubtle/60 min-w-0 max-xl:border-r-0 max-xl:border-b">
            <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0, 1fr) 88px 56px' }}>
              <span>Factor</span>
              <span className="text-center">Against · for</span>
              <span className="text-right">Says</span>
            </div>
            {view.contributions.map(c => {
              const side = c.points > 0 ? 'for' : c.points < 0 ? 'against' : 'even';
              return (
                <div key={c.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 88px 56px' }} data-stock-contribution={c.key} data-side={side}>
                  <span className="min-w-0 flex items-baseline gap-1.5 truncate">
                    <span className="text-[11px] text-textPrimary truncate">{c.label}</span>
                    <span className="font-mono text-[8px] uppercase tracking-widest text-textMuted shrink-0">{c.pillar}</span>
                  </span>
                  <SignedBar v={c.points / maxPts} />
                  <span className={`text-right font-mono text-[9px] font-semibold uppercase tracking-widest ${side === 'for' ? 'text-bull' : side === 'against' ? 'text-bear' : 'text-textMuted'}`}>{side}</span>
                </div>
              );
            })}
            <div className="px-5 h-[34px] border-t border-borderSubtle/60 flex items-center gap-3 font-mono text-[10px]" data-stock-for={forIt} data-stock-against={againstIt}>
              <span className="text-textSecondary">
                <span className="text-bull font-semibold">{forIt}</span> for it · <span className="text-bear font-semibold">{againstIt}</span> against
              </span>
              <span className="ml-auto text-textSecondary">
                the read {held ? <span className="text-textMuted animate-pulse">reading…</span> : <span className={`font-bold ${GRADE_INK[grade]}`}>{grade}</span>}
              </span>
            </div>
          </div>
          {/* THE PILLARS, THE SESSIONS, THE MOVES */}
          <div className="border-r border-borderSubtle/60 min-w-0 max-xl:border-r-0 max-xl:border-b">
            <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }}>
              <span>Pillar</span>
              <span />
              <span className="text-right">Reads</span>
            </div>
            {view.pillars.map(p => {
              const g = gradeOf(p.score);
              /* a pillar the read leaves out (the news) is "not scored" here as in the head — never a grade it does not
                 have (audit round 5: "not scored" above, "caution" here) */
              if (!p.inRead)
                return (
                  <div key={p.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }} data-stock-weight={p.key} data-grade="none">
                    <span className="text-[11px] text-textMuted flex items-center gap-2 truncate">{p.name}</span>
                    <span className="h-[6px] rounded-full bg-ink/[0.04]" />
                    <span className="text-right font-mono text-[10px] text-textMuted whitespace-nowrap">not scored</span>
                  </div>
                );
              return (
                <div key={p.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }} data-stock-weight={p.key} data-grade={g}>
                  <span className="text-[11px] text-textPrimary flex items-center gap-2 truncate">
                    {p.name}
                    {p.status !== 'live' && <StatusTag status={p.status} />}
                  </span>
                  <GradeMeter grade={g} />
                  <span className={`text-right font-mono text-[11px] font-semibold ${GRADE_INK[g]}`}>{g}</span>
                </div>
              );
            })}
            <div className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/60" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }}>
              <span className="text-[11px] font-semibold text-textPrimary">The read</span>
              <GradeMeter grade={grade} />
              <span className={`text-right font-mono text-[12px] font-bold ${GRADE_INK[grade]}`}>{grade}</span>
            </div>
            {/* the read, session by session — a pip per session in its word's ink and at its word's height; four steps, never a line */}
            <div className="px-5 py-2.5 border-t border-borderSubtle/40 flex flex-col gap-1.5" data-stock-series={view.series.length}>
              {view.series.length > 2 ? (
                <>
                  <div className="flex items-end gap-[2px] h-[20px]" role="img" aria-label={`The read over the last ${view.series.length} sessions`}>
                    {view.series.map(q => {
                      const g = gradeOfComposite(q.composite);
                      return <span key={q.time} title={`${dayOf(q.time)} · ${g}`} className={`flex-1 min-w-0 rounded-[1px] ${GRADE_FILL[g]} ${q.back === 0 ? '' : 'opacity-70'}`} style={{ height: `${(GRADES.indexOf(g) + 1) * 25}%` }} data-series-grade={g} />;
                    })}
                  </div>
                  <span className="text-[10.5px] leading-snug text-textSecondary">
                    The read over the last {view.series.length} sessions, the trend moving and the rest held at today's:{' '}
                    {(() => {
                      const word = (back: number) => {
                        const q = view.series.find(x => x.back === back);
                        return q ? gradeOfComposite(q.composite) : null;
                      };
                      const say = (g: Grade, when: string) => (
                        <>
                          <span className={`font-mono ${GRADE_INK[g]}`}>{g}</span> {when}
                        </>
                      );
                      const w20 = word(20);
                      const w5 = word(5);
                      return (
                        <>
                          {w20 ? <>{say(w20, 'twenty back')}, </> : w5 ? null : <>{say(gradeOfComposite(view.series[0].composite), 'at the start')}, </>}
                          {w5 && <>{say(w5, 'five back')}, </>}
                          {say(grade, 'now')}
                        </>
                      );
                    })()}
                    .
                  </span>
                </>
              ) : (
                <span className="text-[10.5px] text-textMuted">Too few sessions on hand for a history.</span>
              )}
            </div>
            {/* what would change it */}
            <div className="px-5 h-[22px] flex items-center border-t border-borderSubtle/40 text-[9px] uppercase tracking-widest text-textMuted">What would change it · a factor turned the other way</div>
            {view.moves.length === 0 && <div className="px-5 h-[26px] flex items-center border-t border-borderSubtle/40 text-[10.5px] text-textMuted">No factor leans far enough to change it.</div>}
            {view.moves.map(m => {
              const then = gradeOfComposite(m.to);
              const same = then === grade;
              return (
                <div key={m.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 64px 84px' }} data-stock-move={m.key} data-to-grade={then}>
                  <span className="text-[11px] text-textPrimary truncate">{m.label}</span>
                  <SignedBar v={m.delta / maxDelta} />
                  <span className={`text-right font-mono text-[10px] whitespace-nowrap ${same ? 'text-textMuted' : GRADE_INK[then]}`}>{same ? `stays ${then}` : `→ ${then}`}</span>
                </div>
              );
            })}
          </div>
          {/* THE SOURCES */}
          <div className="min-w-0">
            <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(0, 1.5fr)' }}>
              <span>Source</span>
              <span>Status</span>
              <span>As of</span>
            </div>
            {pageSources.map(s => (
              <div key={s.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(0, 1.5fr)' }} data-stock-source={s.key} data-status={s.status}>
                <span className="text-[11px] text-textPrimary truncate">{s.label}</span>
                <StatusTag status={s.status} />
                <span className="font-mono text-[10px] text-textSecondary truncate">{s.stamp}</span>
              </div>
            ))}
            <div className="px-5 py-3 border-t border-borderSubtle/40 text-[10.5px] leading-snug text-textSecondary">
              <span className="text-textPrimary">{completeness}%</span> of the page is live. The word is the Stocks board's own: both read the same screener row.
            </div>
          </div>
        </div>
        {/* THE METHOD, behind a fold */}
        <div className="border-t border-borderSubtle/60">
          <button type="button" onClick={() => setMethodOpen(v => !v)} aria-expanded={methodOpen} className="w-full px-5 h-[34px] flex items-center gap-2 font-mono text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-stock-method-door={methodOpen ? 'open' : 'shut'}>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${methodOpen ? 'rotate-180' : ''}`} />
            How it is put together · what was observed, what was derived from it, what was inferred
          </button>
          <Fold open={methodOpen} axis="y" testId="data-stock-method">
            <div className="px-5 pb-4 grid grid-cols-1 xl:grid-cols-3 gap-6">
              {(
                [
                  ['Observed · the raw data', view.method.observed],
                  ['Derived · the calculations', view.method.derived],
                  ['Inferred · the reads', view.method.inferred],
                ] as [string, string[]][]
              ).map(([title, items]) => (
                <div key={title} className="min-w-0">
                  <div className="text-[9px] uppercase tracking-widest text-textMuted">{title}</div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {items.map(t => (
                      <li key={t} className="text-[11px] leading-snug text-textPrimary/85 pl-3 relative before:absolute before:left-0 before:top-[7px] before:w-1 before:h-1 before:rounded-full before:bg-ink/40">
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Fold>
        </div>
      </Box>

      {/* THE TIMELINE — the At the wall report's rows: a row per kind of mark, its count and grade at the left, a strip of the sessions
          on hand with a tick per mark, the facts at the right (the same marks sit on the trend's chart above) */}
      <Box title="The timeline" sub={`What happened on the ${trend.sessions} sessions on hand · a break is a close beyond the prior ten sessions' highs or lows, heavy volume 1.6× the session before, a big session 2.5% either way`} testId="timeline">
        <ul className="flex flex-col" data-stock-lanes>
          {lanes.map(r => (
            <li key={r.key} className="border-t border-borderSubtle/50" data-stock-timeline={r.key} data-lane-ticks={r.ticks.length} data-kind={r.key}>
              {/* One column on a phone (the phone pass, 2026-09-13): the name, the strip, the facts under each other */}
              <div className="grid grid-cols-[200px_minmax(0,1fr)_auto] items-center gap-6 px-5 py-3 max-xl:grid-cols-1 max-xl:gap-3">
                <div className="min-w-0">
                  <span className="block text-[11px] font-semibold" style={{ color: r.ink }}>
                    {r.label}
                  </span>
                  <span className="block font-mono text-[15px] font-semibold tnum leading-tight text-textPrimary">{r.figure}</span>
                  <span className={`mt-1 inline-flex items-center h-5 px-2 rounded-full border text-[10px] font-medium ${LANE_TONE[r.grade.tone]}`} data-grade>
                    {r.grade.words}
                  </span>
                </div>
                <div className="min-w-0">
                  <MarkStrip ticks={r.ticks} n={trend.times.length} label={r.label} />
                  <div className="flex justify-between font-mono text-[9px] tnum text-textMuted px-1 -mt-0.5">
                    {/* the year when the span runs past one (round 9: "Aug 14 → now" over 301 sessions) */}
                    <span>{trend.times.length ? `${dayOf(trend.times[0])}${new Date(trend.times[0] * 1000).getUTCFullYear() !== new Date().getUTCFullYear() || trend.times.length > 250 ? `, ${new Date(trend.times[0] * 1000).getUTCFullYear()}` : ''}` : ''}</span>
                    <span>now</span>
                  </div>
                </div>
                {/* Fixed tracks, so every row's strip ends on the same line whatever the words in the last fact */}
                <dl className="grid grid-cols-[52px_72px_64px_236px] gap-x-5 max-xl:flex max-xl:flex-wrap max-xl:gap-y-1.5">
                  {r.facts.map(f => (
                    <div key={f.k} className="min-w-0">
                      <dt className="text-[10px] text-textMuted whitespace-nowrap" title={statHelp(f.k)}>{f.k}</dt>
                      <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap truncate ${f.cls ?? 'text-textPrimary'}`}>{f.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      </Box>

      {/* THE TAPE — the biggest buys and sells, then the busiest calls and puts; each pair shares one bottom edge */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Biggest buys" sub={`The richest flow alerts on the name on ${sessionWord}, paid on the ask · click one to weigh it`} testId="buys">
          <div className="pb-2 mt-auto">
            {view.prints.buys.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{file.tapes === 'loading' ? 'Reading the flow alerts…' : <>No rich alerts paid up on {T} on {sessionWord}</>}</div>}
            {view.prints.buys.map(p => (
              <PrintRow key={p.id} p={p} maxPrem={maxPrem} onWarm={warm} onOpen={() => weigh(p)} />
            ))}
          </div>
        </Box>
        <Box title="Biggest sells" sub={`The richest flow alerts on the name on ${sessionWord}, hit on the bid · click one to weigh it`} testId="sells">
          <div className="pb-2 mt-auto">
            {view.prints.sells.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{file.tapes === 'loading' ? 'Reading the flow alerts…' : <>No rich alerts hit the bid on {T} on {sessionWord}</>}</div>}
            {view.prints.sells.map(p => (
              <PrintRow key={p.id} p={p} maxPrem={maxPrem} onWarm={warm} onOpen={() => weigh(p)} />
            ))}
          </div>
        </Box>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Busiest calls" sub={`The three busiest by volume on ${sessionWord} · click one to weigh it`} testId="calls">
          <div className="pb-2 mt-auto">
            {money.busiest.calls.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{money.levelsToday ? <>No call volume on the book on {sessionWord}</> : 'Reading the options book…'}</div>}
            {money.busiest.calls.map(c => (
              <ContractRow key={c.key} c={c} maxVol={maxVol} onWarm={warm} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
        <Box title="Busiest puts" sub={`The three busiest by volume on ${sessionWord} · click one to weigh it`} testId="puts">
          <div className="pb-2 mt-auto">
            {money.busiest.puts.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{money.levelsToday ? <>No put volume on the book on {sessionWord}</> : 'Reading the options book…'}</div>}
            {money.busiest.puts.map(c => (
              <ContractRow key={c.key} c={c} maxVol={maxVol} onWarm={warm} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
      </div>

      {/* ON THE RECORD */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch" data-name-record>
        {/* NOTHING IS "NOTHING" UNTIL THE READ IS IN (the retail test, round 6: NVDA "nothing on the record · bought nothing ·
            sold nothing" at 25s, "sold $968M" at 45s) */}
        <Box title="What its insiders did" sub={`Open-market trades in the last 90 days · ${insiders.status === 'loading' ? 'reading…' : insiders.status === 'sim' ? 'the read did not land' : insiders.trades.length ? insiders.signal : 'nothing filed'}`} testId="insiders">
          {marketInsiders.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted" data-name-insiders-empty={insiders.status ?? 'live'}>{insiders.status === 'loading' ? 'Reading the filings…' : insiders.status === 'sim' ? 'This read did not land' : 'Nothing on the record in 90 days'}</div>
          ) : (
            <>
              {/* On a phone: when, who, the trade and its value — the shares and the plan go (the phone pass, 2026-09-13) */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_44px_60px_60px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_44px_64px]">
                <span>When</span>
                <span className="truncate">Who · holds after</span>
                <span>Trade</span>
                <span className="text-right max-xl:hidden">Shares</span>
                <span className="text-right">Value</span>
                <span className="text-right max-xl:hidden whitespace-nowrap">Chose to?</span>
              </div>
              {marketInsiders.map(t => (
                <div key={t.id} className="px-5 h-[38px] grid items-center gap-x-3 border-t border-borderSubtle/40 grid-cols-[96px_minmax(0,1fr)_44px_60px_60px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_44px_64px]" data-name-insider={t.id}>
                  <When days={t.daysAgo} size={10} />
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="text-[11px] font-semibold text-textPrimary truncate">{personDisplay(t.person)}</span>
                    <span className="text-[9px] text-textMuted truncate">
                      {t.role} · holds {count(t.heldAfter)} after
                    </span>
                  </span>
                  <span className={`font-mono text-[10px] ${t.kind === 'BUY' ? 'text-bull' : 'text-bear'}`}>{t.kind === 'BUY' ? 'Bought' : 'Sold'}</span>
                  <span className="text-right font-mono text-[10px] tnum text-textPrimary max-xl:hidden">{Math.round(t.shares).toLocaleString('en-US')}</span>
                  <span className="text-right font-mono text-[10px] tnum font-semibold text-textPrimary">{fmtMoney(t.value)}</span>
                  <span className={`text-right font-mono text-[8px] uppercase tracking-widest max-xl:hidden ${t.plan === 'discretionary' ? (isChosenBuy(t) ? 'text-textPrimary font-bold' : 'text-textSecondary') : 'text-textMuted'}`}>
                    {t.entity && t.plan !== 'plan' ? 'corporate' : t.plan === 'discretionary' ? 'chosen' : t.plan === 'plan' ? 'planned' : 'unstated'}
                  </span>
                </div>
              ))}
            </>
          )}
          <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex flex-col gap-1.5 font-mono text-[10px] tnum" data-name-foot="insiders">
            <div className="flex items-center gap-4">
              <span className="text-textSecondary">
                bought <span className={insiders.bought > 0 ? 'text-bull' : 'text-textMuted'}>{insiders.bought > 0 ? fmtMoney(insiders.bought) : 'nothing'}</span> · sold{' '}
                <span className={insiders.sold > 0 ? 'text-bear' : 'text-textMuted'}>{insiders.sold > 0 ? fmtMoney(insiders.sold) : 'nothing'}</span>
                {insiders.buyerCluster > 1 && <span className="text-silver"> · {insiders.buyerCluster} buyers inside a month</span>}
                {marketAll.length > marketInsiders.length && (
                  <span className="text-textMuted">
                    {' '}
                    · over all {marketAll.length} open-market trades of the 90 days — the newest {marketInsiders.length} shown above
                  </span>
                )}
              </span>
              <Link to="/dossier/insiders" className="ml-auto inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
                <ArrowUpRight className="w-3 h-3" /> every insider
              </Link>
            </div>
            {insiderTotal > 0 && <ShareBar left={(100 * insiders.bought) / insiderTotal} />}
          </div>
        </Box>
        <Box title="What Congress reported" sub={`STOCK Act reports of trades in this stock made in the last 180 days${congressBook.complete ? '' : ' — the latest 200 reports only'} · the newest five filed`} testId="congress">
          {congress.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-[10px] uppercase tracking-widest text-textMuted">{congressBook.status === 'loading' ? 'Reading the reports' : congressBook.status === 'sim' ? 'This read did not land' : 'No trade in this stock reported in 180 days'}</div>
          ) : (
            <>
              {/* On a phone: filed, member, type — the amount and the lag go (the phone pass, 2026-09-13) */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_88px_132px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_88px]">
                <span>Filed</span>
                <span>Member</span>
                <span>Type</span>
                <span className="max-xl:hidden">Amount disclosed</span>
                <span className="text-right max-xl:hidden">Lag</span>
              </div>
              {congress.map(t => (
                <div key={t.id} className="px-5 h-[38px] grid items-center gap-x-3 border-t border-borderSubtle/40 grid-cols-[96px_minmax(0,1fr)_88px_132px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_88px]" data-name-congress={t.id}>
                  <When days={t.filedDaysAgo} size={10} />
                  <span className="min-w-0 flex flex-col leading-tight">
                    <span className="text-[11px] font-semibold text-textPrimary truncate">{t.member.name}</span>
                    <span className="text-[9px] text-textMuted truncate">
                      {seatLabel(t.member)} · {t.member.chamber}
                    </span>
                  </span>
                  <span className={`font-mono text-[10px] ${t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}`}>{t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : t.type === 'Sale (Partial)' ? 'Sale · partial' : 'Sale'}{t.assetKind === 'Stock Option' ? <span className="text-textMuted" data-name-congress-option> · option</span> : null}</span>
                  <span className="font-mono text-[10px] tnum text-textPrimary truncate max-xl:hidden">{bracketLabel(t.bracket)}</span>
                  <span className={`text-right font-mono text-[10px] tnum max-xl:hidden ${t.late ? 'text-bear' : 'text-textSecondary'}`}>
                    {t.lagDays}d{t.late ? ' late' : ''}
                  </span>
                </div>
              ))}
            </>
          )}
          <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex items-center gap-4 font-mono text-[10px] tnum" data-name-foot="congress">
            {congressAll.length > 0 && (
              <span className="text-textSecondary">
                {congressAll.length} {congressAll.length === 1 ? 'report' : 'reports'} in 180 days · {congressAll.filter(t => t.type === 'Purchase').length} purchases · {congressAll.filter(t => t.type !== 'Purchase' && t.type !== 'Exchange').length} sales
              </span>
            )}
            <Link to="/dossier/congress" className="ml-auto inline-flex items-center gap-1 text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
              <ArrowUpRight className="w-3 h-3" /> every report
            </Link>
          </div>
        </Box>
      </div>
    </>
  );
};

/** The pillar's bar as a box's aside — the same bar, a shorter track */
const PillarBarSmall = ({ p, held = false }: { p: Pillar; held?: boolean }) => (
  <div className="w-[150px] shrink-0">
    <PillarBar p={p} held={held} />
  </div>
);

/* THE NAME'S WHOLE OPEN INTEREST, from the vendor's per-expiry rows (the ship pass, 2026-10-22): the snapshot's chain
   carries only the front expiry, so AAPL read "120K" — one expired date — against 4.7M across the 23 still listed.
   Expired dates are dropped; with no rows yet the chain's own figure stands; with nothing at all, a dash — never
   "0 · 50% calls". */
function OpenInterest({ ticker, fallbackCall, fallbackPut }: { ticker: string; fallbackCall: number; fallbackPut: number }) {
  const row = useVendorRow(stockBookKey(ticker), 'oi-expiry');
  const today = nyIsoDate();
  let call = 0;
  let put = 0;
  if (row?.state === 'live' && Array.isArray(row.data)) {
    for (const r of row.data as Record<string, unknown>[]) {
      if (String(r.expiry ?? '').slice(0, 10) < today) continue;
      call += Number(r.call_oi) || 0;
      put += Number(r.put_oi) || 0;
    }
  }
  if (call + put <= 0) {
    call = fallbackCall;
    put = fallbackPut;
  }
  const oi = call + put;
  if (oi <= 0) return <span className="text-textMuted">—</span>;
  const share = (100 * call) / oi;
  return (
    <>
      {count(oi)} <span className={share >= 50 ? 'text-bull' : 'text-bear'}>{share >= 50 ? `${share.toFixed(0)}% calls` : `${(100 - share).toFixed(0)}% puts`}</span>
    </>
  );
}

/* THE COMPANY'S NAME, never the ticker twice (the ship pass: SOUN read "SOUN SOUN") — names outside the built-in lists
   come from the vendor's info row, set in title case with the short acronyms kept ("SOUNDHOUND AI" → "Soundhound AI") */
const titleCase = (raw: string) => displayName(raw);
function CompanyTitle({ ticker, name }: { ticker: string; name: string }) {
  const info = useVendorRow(stockBookKey(ticker), 'info');
  if (name && name.toUpperCase() !== ticker.toUpperCase()) return <>{displayName(name)}</>;
  const full = info?.state === 'live' ? String((info.data as { full_name?: string } | null)?.full_name ?? '') : '';
  return <>{full ? titleCase(full) : name}</>;
}

export default StockName;
