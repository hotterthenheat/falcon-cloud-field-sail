/* A name's page (/dossier/stocks/:ticker): the name and its grade, why now, the trend, the news and reports, and the
   record open; the options book, the numbers, how the read is made, the timeline and the tape fold under More. */

import { displayName, personDisplay } from '../../data/tickers';
import { PublishMove } from '../../components/record/publishMove';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, ChevronDown } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import GradeMeter, { GRADE_FILL, GRADE_INK } from '../../components/ui/GradeMeter';
import { gradeOfConviction, postureRead } from '../../data/darkpool';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import Fold from '../../components/ui/Fold';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import SessionsChart, { type ChartMark, type ChartPoint } from '../../components/record/SessionsChart';
import type { UTCTimestamp } from 'lightweight-charts';
import { fmtDayLocal } from '../../components/gex/chartTime';
import { When } from '../../components/record/when';
import { lastSessionIso, shortDay } from '../../data/nyDate';
import { StockGuide } from '../../components/record/StockGuide';
import { buildStockOverview, fmtMoney, gradeHelp, gradeOf, gradeOfComposite, GRADES, type Factor, type Grade, type Lean, type Pillar, type SourceStatus, type StockOverview, type TimelineKind } from '../../data/stockOverview';
import { keptWords } from '../../data/feedStore';
import { TX_CODES, isChosenBuy } from '../../data/insiders';
import { bracketLabel, seatLabel } from '../../data/congress';
import { useInsiderFlow, useTickerCongress, useTickerNews } from '../../data/liveRecord';
import { useStockFile, quarterFacts, type StockFile } from '../../data/stockFile';
import type { BookContract, FlowPrint } from '../../types/trace';
import { StockNameSkeleton } from './recordSkeletons';
import CompanyFile from '../../components/record/CompanyFile';
import { NewsFlag } from '../../components/record/impactMark';
import { untilWords } from '../../data/earningsFeed';
import NameBooks from '../../components/record/NameBooks';
import { StockFacts } from '../../components/vendor/LiveDesk';
import { stockBookKey, useVendorRow } from '../../data/vendorFeed';
import { useCompanyName } from '../../data/liveFiles';
import { useLiveQuote, type LiveQuote } from '../../data/liveQuote';
import { nyClock, nyIsoDate, nySessionPhase, nyWallTime } from '../../core/nyTime';
import { isTradingDay, today as nyTodayDate } from '../../core/calendar';
import { statHelp } from '../../components/record/statHelp';
import { ago, Box as RecordBox, Door, Fact as RecordFact } from '../../components/record/ui';
import { pctInk, signedPct } from './money';

const SILVER = 'rgb(var(--silver))';
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
/** Every bar on the page glides to its new width on the house curve — the scan tier re-reads the name every ten seconds */
const GLIDE = `width 520ms ${EASE}, left 520ms ${EASE}`;
const LEAN_INK: Record<Lean, string> = { bullish: 'text-bull', neutral: 'text-textPrimary', bearish: 'text-bear' };
const STATUS_WORD: Record<SourceStatus, string> = { live: 'live', sample: 'not on the feed', thin: 'thin' };
const STATUS_INK: Record<SourceStatus, string> = { live: 'text-select', sample: 'text-warn', thin: 'text-textMuted' };
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

/* ---- the timeline's strip: a hairline for the sessions on hand, a tick per mark, a card under the pointer ---- */
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
              <span className="font-mono text-t11 font-semibold tnum text-textPrimary">{t.when}</span>
              <span className="text-t11 font-medium" style={{ color: t.ink }}>
                {t.text}
              </span>
              {t.score != null && <span className="font-mono text-t10 text-textMuted">the trend read {gradeOf(t.score)}</span>}
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
  ['news', 'News'],
  ['insiders', 'Insiders'],
  ['congress', 'Congress'],
  ['money', 'Options'],
  ['numbers', 'Numbers'],
  ['who', 'Who holds it'],
  ['score', 'How it is read'],
  ['timeline', 'Timeline'],
  ['buys', 'The tape'],
]
/** A chart point's seconds, said as the reader's day or minute */
const dayOf = (t: number) => fmtDayLocal(t as UTCTimestamp);
/* a print's clock, New York's, said as ET */
const clockOf = (t: number) => nyClock(t * 1000, { zone: true });
const count = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v)}`);
/** "09/18/2026" → "2026-09-18", the Weigher's date key */
const isoOf = (mmddyyyy: string) => {
  const [m, d, y] = mmddyyyy.split('/');
  return y && m && d ? `${y}-${m}-${d}` : mmddyyyy;
};

/* ---- the pieces ---------------------------------------------------------------- */

const Box = (p: Omit<Parameters<typeof RecordBox>[0], 'scope'>) => <RecordBox scope="stock" {...p} />;
const Fact = (p: Omit<Parameters<typeof RecordFact>[0], 'scope'>) => <RecordFact scope="stock" {...p} />;
const StatusTag = ({ status }: { status: SourceStatus }) => (
  <span className={`font-mono text-t8 uppercase tracking-widest ${STATUS_INK[status]}`} data-stock-status={status}>
    {STATUS_WORD[status]}
  </span>
);
/** A pillar as its word and the meter — its figure stays inside the engine */
const PillarBar = ({ p, big = false, held = false }: { p: Pillar; big?: boolean; held?: boolean }) => {
  const grade = gradeOf(p.score);
  /* a provisional read holds its words until the sources it stands on are in */
  if (held && p.inRead) {
    return (
      <div className="min-w-0" data-stock-pillar={p.key} data-grade="reading" title="Held until the sources this read stands on are in">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-t10 text-textMuted truncate">{p.name}</span>
          <span className={`ml-auto shrink-0 font-mono ${big ? 'text-t11' : 'text-t10'} text-textMuted animate-pulse`}>reading…</span>
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
          <span className="text-t10 text-textMuted truncate">{p.name}</span>
          <span className={`ml-auto shrink-0 font-mono ${big ? 'text-t11' : 'text-t10'} text-textMuted`}>not scored</span>
        </div>
        <div className="mt-1 h-[6px] rounded-full bg-ink/[0.04]" />
      </div>
    );
  }
  return (
    <div className="min-w-0" data-stock-pillar={p.key} data-grade={grade}>
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-t10 text-textMuted truncate">{p.name}</span>
        {p.status !== 'live' && <StatusTag status={p.status} />}
        <span className={`ml-auto shrink-0 font-mono ${big ? 'text-t13' : 'text-t12'} font-semibold ${GRADE_INK[grade]}`}>{grade}</span>
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
      {/* wraps on a phone */}
      <span className="block text-t11 text-textPrimary truncate max-sm:whitespace-normal max-sm:break-words">
        {f.label}
        {f.context && <span className="ml-1.5 font-mono text-t8 uppercase tracking-widest text-textMuted" title="Shown for context; not in the read">context</span>}
      </span>
      <span className="block text-t9 text-textMuted truncate max-sm:whitespace-normal max-sm:break-words">{f.note}</span>
    </span>
    <span className="font-mono text-t11 tnum text-textPrimary truncate max-sm:whitespace-normal max-sm:break-words">{f.value}</span>
    <SignedBar v={f.lean} />
  </div>
);
/** How far a print landed from its estimate — a percent, or cents when the estimate is a few cents and a percent explodes */
/* Cents, not a percent, when the estimate is small or the two sit either side of zero; one rule for every table. */
export const centsGap = (actual: number, est: number) => Math.abs(est) < 0.25 || Math.sign(actual) !== Math.sign(est);
const epsGap = (actual: number, est: number) => (centsGap(actual, est) ? `${Math.round(Math.abs(actual - est) * 100)}¢` : `${Math.abs(((actual - est) / Math.abs(est || 1)) * 100).toFixed(1)}%`);


/** A two-sided share bar: the left side's share of the whole, the rest to the right */
const ShareBar = ({ left, leftInk = 'bg-bull', rightInk = 'bg-bear/80' }: { left: number; leftInk?: string; rightInk?: string }) => (
  <div className="flex h-[6px] rounded-full overflow-hidden bg-ink/[0.06]">
    <span className={`h-full ${leftInk}`} style={{ width: `${left}%`, transition: GLIDE }} />
    <span className={`h-full ${rightInk}`} style={{ width: `${100 - left}%`, transition: GLIDE }} />
  </div>
);

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
        <span key={code} title={word} className={`inline-flex items-center h-5 px-1.5 rounded border font-mono text-t9 font-bold tracking-wider transition-colors ${on ? (good ? 'border-bull/40 text-bull bg-bull/10' : 'border-bear/40 text-bear bg-bear/10') : 'border-borderSubtle text-textMuted/60'}`} data-flag={code} data-on={on || undefined}>
          {code}
        </span>
      ))}
    </span>
  );
};

/** A busiest contract — a door to the Weigher with the contract picked */
const ContractRow = ({ c, maxVol, onOpen, onWarm }: { c: BookContract; maxVol: number; onOpen: () => void; onWarm?: () => void }) => (
  <button type="button" onClick={onOpen} onMouseEnter={onWarm} onFocus={onWarm} title="Weigh this contract" className="group/door w-full text-left px-3 sm:px-5 py-2 border-t border-borderSubtle/40 grid grid-cols-[92px_64px_minmax(0,1fr)_12px] sm:grid-cols-[112px_96px_minmax(0,1fr)_72px_24px] items-center gap-x-2 sm:gap-x-3 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] outline-none transition-colors" data-stock-contract={c.key} data-contract-strike={c.strike} data-contract-right={c.right}>
    <span className="font-mono text-t11 font-bold text-textPrimary group-hover/door:text-silver transition-colors">
      {c.strike}
      {c.right} <span className="text-t9 font-normal text-textMuted">· {c.expiry.slice(0, 5)}</span>
    </span>
    <span className="font-mono text-t10 tnum text-textSecondary">{fmtMoney(c.premium)}</span>
    <span className="flex items-center gap-2 min-w-0">
      <span className="relative w-full max-w-[120px] min-w-[20px] h-[4px] rounded-full bg-ink/[0.06] sm:shrink-0">
        <span className={`absolute inset-y-0 left-0 rounded-full ${c.right === 'C' ? 'bg-bull/80' : 'bg-bear/70'}`} style={{ width: `${Math.max(6, (c.volume / maxVol) * 100)}%`, transition: GLIDE }} />
      </span>
      <span className="font-mono text-t10 tnum text-textPrimary">{c.volume.toLocaleString()}</span>
    </span>
    {/* on a phone the row keeps the contract, its money and its volume */}
    <span className="max-sm:hidden font-mono text-t9 tnum text-textMuted text-right">{c.sweepPct >= 20 ? 'swept' : `${c.askPct.toFixed(0)}% ask`}</span>
    <ArrowUpRight className="w-3 h-3 text-textMuted group-hover/door:text-silver transition-colors justify-self-end" />
  </button>
);
/** One of the tape's biggest prints on the name — a door to the Weigher with the contract picked */
const PrintRow = ({ p, maxPrem, onOpen, onWarm }: { p: FlowPrint; maxPrem: number; onOpen: () => void; onWarm?: () => void }) => (
  <button type="button" onClick={onOpen} onMouseEnter={onWarm} onFocus={onWarm} title="Weigh this contract" className="group/door w-full text-left px-3 sm:px-5 h-[34px] border-t border-borderSubtle/40 grid grid-cols-[88px_minmax(0,1fr)_64px_12px] sm:grid-cols-[44px_112px_minmax(0,1fr)_72px_48px_24px] items-center gap-x-2 sm:gap-x-3 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] outline-none transition-colors" data-stock-print={p.id} data-print-side={p.side}>
    {/* on a phone the row is the contract, its size and its money; the time and the sweep mark return at 640px */}
    <span className="max-sm:hidden font-mono text-t10 tnum text-textMuted">{p.time}</span>
    <span className="font-mono text-t11 font-bold text-textPrimary group-hover/door:text-silver transition-colors">
      {p.strike}
      {p.right} <span className="text-t9 font-normal text-textMuted">· {p.dte}d</span>
    </span>
    <span className="flex items-center gap-2 min-w-0">
      <span className="max-sm:hidden relative w-full max-w-[110px] h-[4px] rounded-full bg-ink/[0.06] shrink-0">
        <span className={`absolute inset-y-0 left-0 rounded-full ${p.side === 'ASK' ? 'bg-bull/80' : 'bg-bear/70'}`} style={{ width: `${Math.max(6, (p.premium / maxPrem) * 100)}%`, transition: GLIDE }} />
      </span>
      <span className="font-mono text-t10 tnum text-textSecondary whitespace-nowrap">
        {p.size.toLocaleString()} @ {p.fill.toFixed(2)}
      </span>
    </span>
    <span className="font-mono text-t11 tnum font-semibold text-textPrimary text-right">{fmtMoney(p.premium)}</span>
    <span className={`max-sm:hidden font-mono text-t8 uppercase tracking-widest text-right ${p.sweep ? 'text-silver' : 'text-textMuted'}`}>{p.sweep ? 'sweep' : p.legs > 1 ? `×${p.legs}` : ''}</span>
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
  const [more, setMore] = useState(false);
  /* the read is rebuilt every ten seconds only while the session trades and the tab is shown */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden && isTradingDay(nyTodayDate()) && nySessionPhase() === 'open') setTick(t => t + 1);
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);
  const [holdTimedOut, setHoldTimedOut] = useState(false);
  useEffect(() => {
    setHoldTimedOut(false);
    const id = window.setTimeout(() => setHoldTimedOut(true), 40_000);
    return () => window.clearTimeout(id);
  }, [T]);
  /* the name's own headlines: one call */
  const recordNews = useTickerNews(T);
  /* the wire's empty line waits for the read to settle */
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => buildStockOverview(T, file.flow), [T, tick, recordNews, file, quote]);
  /* The read is held while the quote, the regular closes and the tapes land; past 40 seconds it is shown, marked provisional. */
  const settling = view?.settling ?? [];
  const held = settling.length > 0 && !holdTimedOut;
  const provisional = settling.length > 0;
  const insiders = useInsiderFlow(T, 90);
  const marketAll = useMemo(() => insiders.trades.filter(t => TX_CODES[t.code].openMarket), [insiders]);
  /* the rows are the newest five; the foot's totals are every open-market trade of the 90 days */
  const marketInsiders = useMemo(() => [...marketAll].sort((a, b) => (b.tradedOn ?? '').localeCompare(a.tradedOn ?? '') || a.daysAgo - b.daysAgo).slice(0, 5), [marketAll]);
  /* the name's own Congress reports, not the market book's latest few weeks */
  const congressBook = useTickerCongress(T, 180);
  const congressAll = useMemo(() => [...congressBook.trades].sort((a, b) => a.filedDaysAgo - b.filedDaysAgo), [congressBook]);
  const congress = useMemo(() => congressAll.slice(0, 5), [congressAll]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [printFocus, setPrintFocus] = useState<number | null>(null);
  useEffect(() => setPrintFocus(null), [T]);

  const jump = (id: string) => {
    const go = () => document.getElementById(`stock-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (document.getElementById(`stock-${id}`)) return go();
    setMore(true);
    window.setTimeout(go, 60);
  };
  const back = (
    <div className="flex items-center gap-4 flex-wrap" data-name-back>
      <Link to="/dossier/stocks" className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
        <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> The board
      </Link>
      {view && (
        /* on a phone the chips are one row that scrolls sideways — wrapped, they stood three lines tall over the page */
        <nav className="ml-auto flex items-center gap-1 flex-wrap font-mono text-t9 uppercase tracking-widest max-sm:ml-0 max-sm:w-full max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden max-sm:[&>button]:shrink-0" aria-label="Sections of the page" data-stock-jumps>
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
    if (file.status === 'loading') {
      return (
        <>
          {back}
          <StockNameSkeleton />
        </>
      );
    }
    return (
      <>
        {back}
        <NameWithoutBook ticker={T} file={file} quote={quote} />
      </>
    );
  }

  const openOnMap = () => {
    changeTicker(T);
    navigate('/pinpoint/map');
  };
  const weigh = (c?: { strike: number; right: 'C' | 'P'; expiry: string }) => navigate('/weigher', { state: { weigh: c ? { ticker: T, strike: c.strike, right: c.right, expiry: isoOf(c.expiry) } : { ticker: T }, wayBack: location.pathname } });
  const byKey = Object.fromEntries(view.pillars.map(p => [p.key, p])) as Record<Pillar['key'], Pillar>;
  const { money, trend, news, numbers, agreement } = view;
  const filed = quarterFacts(file.quarters);
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
  /* the screener's figures wear the screener row's own date */
  const screenDay = typeof file.screen?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(file.screen.date) ? String(file.screen.date).slice(0, 10) : null;
  const screenWord = screenDay ? shortDay(screenDay) : sessionWord;
  const up = view.changePct >= 0;
  /* the record source counts the name's own filings, not the market-wide book */
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
  const growthFactor = byKey.numbers.factors.find(f => f.key === 'growth') ?? null;
  const insiderTotal = insiders.bought + insiders.sold;
  /* the closes on their dates, and the marks that matter on them */
  const sessionPoints: ChartPoint[] = trend.times.map((t, i) => ({ time: t, value: trend.closes[i] })).slice(-30);
  /* the marks sit small on the line in their kind's ink; the card and the timeline carry the words */
  const sessionMarks: ChartMark[] = view.timeline.filter(t => t.time != null).map(t => ({ time: t.time!, color: KIND_MARK[t.kind], on: true, size: 0.34, shape: 'circle' as const, text: `${KIND_WORD[t.kind]} · ${t.text}` }));
  /* the levels named INSIDE the plot at their left end — the axis keeps the figures alone (four named tags collided there) */
  const sessionLines = [...(trend.ema20 != null ? [{ price: trend.ema20, color: SILVER, title: '20-day EMA', style: 'dashed' as const, name: 'plot' as const }] : [])];
  /* the scale holds the line and any level near it (within a quarter of the line's own span past either end), with a
     little air — a level far from the line is left off the scale rather than flattening thirty sessions into a thread */
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
  /* The session's minutes as the line, the off-exchange prints summed per New York minute as bars under it, the biggest
     of each minute kept for the card. */
  const todayPoints: ChartPoint[] = [...new Map(money.today.map(c => [c.time, { time: c.time, value: c.close }])).values()].sort((a, b) => a.time - b.time);
  /* a print's clock is New York's, so the bars are matched on New York's minute */
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

  /* the timeline's lanes: a row per kind of mark on the sessions on hand */
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
    if (key === 'earnings') grade = n === 0 ? { words: 'no report on hand', tone: 'quiet' } : entries[0].text.startsWith('beat') ? { words: 'beat', tone: 'good' } : entries[0].text.startsWith('missed') ? { words: 'missed', tone: 'bad' } : entries[0].text.startsWith('in line') ? { words: 'in line', tone: 'quiet' } : { words: 'no estimate', tone: 'quiet' };
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
        /* A full ISO date does not fit the narrow column; month/day as the others. */
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
                <h3 className="text-t15 font-semibold leading-tight text-textPrimary truncate"><CompanyTitle ticker={T} name={view.name} /></h3>
                <span className="font-mono text-t11 font-bold text-textSecondary">{T}</span>
                <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the read, the pillars and the factors mean" testId="stock-guide" />
              </div>
              {/* the price line wraps, never truncates */}
              <p className="mt-0.5 text-t11 leading-snug text-textMuted whitespace-normal break-words" title={view.priceLine ?? undefined}>
                <span className="font-mono text-t12 tnum text-textPrimary">
                  $<AnimatedNumber value={view.price} format={v => v.toFixed(2)} />
                </span>
                {view.priceLine ? <span className="font-mono tnum text-textMuted" data-stock-price-line> {view.priceLine.replace(/^[\d.]+\s?/, '')}</span> : null}{' '}
                {view.lastSession ? (
                  <span className={`font-mono tnum ${view.lastSession.pct >= 0 ? 'text-bull' : 'text-bear'}`} title="Before the open: the last regular session's change, close against the close before it" data-stock-day>
                    · {signedPct(view.lastSession.pct, 2)} {view.lastSession.date ? shortDay(view.lastSession.date) : 'last session'}
                  </span>
                ) : (
                  <span className={`font-mono tnum ${up ? 'text-bull' : 'text-bear'}`} title="The regular session's change: the regular close (or the last print in the session) against the close before it" data-stock-day>· {signedPct(view.changePct, 2)} {view.marketWord === 'market open' ? 'today' : 'the session'}</span>
                )}
                {view.extLine ? <span className="font-mono tnum text-textSecondary" data-stock-ext> · {view.extLine}</span> : <> · {view.marketWord}</>}
                {view.sector ? ` · ${view.sector}` : ''}
                {file.keptAt ? <span className="font-mono text-warn" title="The answers this browser kept, shown until the fresh read lands" data-stock-kept> · as of {keptWords(file.keptAt)}</span> : null}
              </p>
            </div>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            {/* the read, in one word; the figure behind it stays in the engine */}
            <Fact label="Reads" testId="screen" tip={gradeHelp(view)}>
              {held ? (
                <span className="text-t13 font-semibold text-textMuted animate-pulse" title={`Held until ${settling.join(', ')} ${settling.length === 1 ? 'is' : 'are'} in`} data-stock-held>
                  reading…
                </span>
              ) : (
                <span className={`text-t14 font-bold ${GRADE_INK[grade]}`}>
                  {grade}
                  {provisional && <span className="ml-1.5 font-mono text-t8 font-normal uppercase tracking-widest text-warn" title={`Still waiting on ${settling.join(', ')}`}>provisional</span>}
                </span>
              )}
            </Fact>
            <Fact label="Leans" testId="lean">
              {held ? <span className="font-semibold text-textMuted">—</span> : <span className={`font-semibold ${LEAN_INK[view.lean]}`}>{view.lean}</span>}
            </Fact>
          </dl>
        </div>
        {/* the pillars, two by two on a phone */}
        <div className="px-5 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3" data-stock-pillars>
          {view.pillars.map(p => (
            <PillarBar key={p.key} p={p} big held={held} />
          ))}
        </div>
        <div className="px-5 pb-4 flex items-center gap-2 flex-wrap" data-stock-doors>
          <Door onClick={openOnMap}>
            The Map
          </Door>
          <Door onClick={() => weigh()}>
            Weigh it
          </Door>
          <Door onClick={() => navigate('/compass', { state: { tickerFilter: T } })}>
            Compass
          </Door>
          {news.nextEarnings && <Door onClick={() => navigate(`/dossier/earnings/${T}`)}>Earnings</Door>}
          <Door onClick={() => navigate('/dossier/news', { state: { name: T } })}>The wire</Door>
          {/* which source is out; the grade is scored off the screener row alone, every other source is shown beside it */}
          <span
            className={`ml-auto font-mono text-t9 uppercase tracking-widest text-textMuted ${live < pageSources.length ? 'cursor-help' : ''}`}
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
      <Box title="Why now" sub="What is for the name, what is against it, and whether the pillars agree" testId="why">
        {held ? (
          <div className="px-5 pb-4 flex flex-col gap-2" data-stock-why-held>
            <p className="text-t12 leading-relaxed text-textMuted animate-pulse">Reading {settling.join(', ')} — the read and its reasons appear once the sources it stands on are in.</p>
          </div>
        ) : (
        <>
        <div className="px-5 pb-3 flex flex-col gap-2">
          {provisional && <p className="font-mono text-t9 uppercase tracking-widest text-warn">Provisional · {settling.join(', ')} did not answer yet</p>}
          <p className="text-t12 leading-relaxed text-textPrimary/90" data-stock-why>
            <RichRead text={view.whyNow} />
          </p>
          <p className="text-t12 leading-relaxed text-textSecondary" data-stock-thesis>
            <RichRead text={view.thesis} />
          </p>
          <p className="text-t12 leading-relaxed text-textSecondary" data-stock-explanation>
            <RichRead text={view.explanation} />
          </p>
        </div>
        <div className="px-5 py-3 border-t border-borderSubtle/40 flex items-center gap-2 flex-wrap" data-stock-agreement={agreement.aligned}>
          <span className="font-mono text-t9 uppercase tracking-widest text-textMuted mr-1">
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
            <span key={p.key} className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-md border font-mono text-t10 tnum transition-colors ${p.agrees ? 'border-borderMuted text-textPrimary bg-ink/[0.04]' : 'border-borderSubtle text-textMuted'}`} data-stock-agree={p.key} data-agrees={p.agrees || undefined} data-stance={p.stance}>
              <span className={`w-1.5 h-1.5 rounded-full ${GRADE_FILL[gradeOf(p.score)]}`} />
              {p.name.replace('The ', '')} <span className={GRADE_INK[gradeOf(p.score)]}>{gradeOf(p.score)}</span>
              <span className={`text-t8 uppercase tracking-widest ${p.stance === 'agrees' ? 'text-textSecondary' : p.stance === 'argues' ? 'text-warn' : p.stance === 'for' ? 'text-bull' : p.stance === 'against' ? 'text-bear' : 'text-textMuted'}`}>{p.stance === 'middle' ? 'middle' : p.stance === 'for' ? 'pulls for' : p.stance === 'against' ? 'pulls against' : p.stance}</span>
            </span>
          ))}
          <span className="basis-full text-t11 text-textSecondary" data-stock-risk>
            {agreement.risk}
          </span>
        </div>
        </>
        )}
      </Box>

      {/* five sections open; the options book, the numbers, the read's workings, the timeline and the tape fold under More */}
      <Box title="The trend" sub={`The screener's trend measures · the swing structure from the name's own ${trend.sessions} sessions`} aside={<PillarBarSmall p={byKey.trend} held={held} />} testId="trend">
          <div className="px-5 pb-3">
            <dl className="grid grid-cols-3 gap-x-4 gap-y-2">
              <Fact label="20-day EMA" testId="ema20" tip="The 20-day exponential moving average (the screener's ema_20), and the last regular close against it — the figure the trend factor scores">
                {trend.ema20 != null ? (
                  <>
                    {trend.ema20.toFixed(2)} <span className={`${trend.refClose >= trend.ema20 ? 'text-bull' : 'text-bear'}`}>{signedPct(((trend.refClose - trend.ema20) / trend.ema20) * 100)}</span>
                  </>
                ) : (
                  <span className="text-textMuted">—</span>
                )}
              </Fact>
              <Fact label="50 · 200-day SMA" testId="smas" tip="The 50- and 200-day simple moving averages (the screener's sma_50 and sma_200)">
                {trend.sma50 != null ? trend.sma50.toFixed(2) : <span className="text-textMuted">needs 50</span>} <span className="text-textMuted">·</span> {trend.sma200 != null ? trend.sma200.toFixed(2) : <span className="text-textMuted">needs 200</span>}
              </Fact>
              <Fact label="Above its averages" testId="above" tip="How many of the 20-day, 50-day and 200-day averages the last regular close is above">
                {trend.above.count} <span className="text-textMuted">of {trend.above.of}</span>
              </Fact>
              <Fact label="RSI · ADX" testId="rsi" tip="RSI and ADX over 14 sessions — the screener's rsi_14 and adx_14, the same figures the factors below score">
                {trend.rsi14 != null ? trend.rsi14.toFixed(0) : '—'} <span className="text-textMuted">·</span> {trend.adx14 != null ? trend.adx14.toFixed(0) : '—'}
              </Fact>
              <Fact label={`Day's range · ${screenWord}${file.rangeAsOf ? ` · to ${file.rangeAsOf}` : ''}`} testId="atr" tip={`The session's high minus its low, against the ${trend.sessions} sessions on hand`}>
                {trend.atrPercentile != null && trend.rangeToday != null ? (
                  <>
                    ${trend.rangeToday.toFixed(2)} <span className="text-textMuted">· wider than {Math.max(0, trend.atrPercentile - Math.round(100 / Math.max(1, trend.sessions)))}% of days</span>
                  </>
                ) : (
                  '—'
                )}
              </Fact>
              <Fact label={trend.source === 'screener' ? 'The week · the month' : '5 · 20 sessions'} testId="changes" tip={trend.source === 'screener' ? "The screener's one_week_perc and one_month_perc — the month is the figure 'The last month' scores" : 'The change over the last 5 and 20 sessions on hand'}>
                {trend.change5Pct != null ? <span className={pctInk(trend.change5Pct)}>{signedPct(trend.change5Pct)}</span> : '—'} <span className="text-textMuted">·</span>{' '}
                {trend.change20Pct != null ? <span className={pctInk(trend.change20Pct)}>{signedPct(trend.change20Pct)}</span> : '—'}
              </Fact>
            </dl>
          </div>
          {/* The sessions on hand as one line in the page's ink, the 20-day EMA named inside the plot, the timeline's
             marks on the line; the chart fills the box's spare height. The walls are on Pinpoint. */}
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
                      <span className="font-mono text-t11 font-bold tnum text-textPrimary">{dayOf(p.time)}</span>
                      <span className="font-mono tnum">
                        closed <span className="text-textPrimary">{p.value.toFixed(2)}</span>
                        {prev && (
                          <span className={p.value >= prev.value ? 'text-bull' : 'text-bear'}>
                            {' '}
                            {signedPct(((p.value - prev.value) / prev.value) * 100)}
                          </span>
                        )}
                        {trend.ema20 != null && <span className="text-textMuted"> · {signedPct(((p.value - trend.ema20) / trend.ema20) * 100)} from the 20-day EMA</span>}
                      </span>
                      {marks.map(m => (
                        <span key={m.text} className="text-t10 leading-snug" style={{ color: m.color }}>
                          {m.text}
                        </span>
                      ))}
                    </>
                  )
                }
              />
            </div>
          )}
          {/* the structure and its four flags */}
          <div className="px-5 pb-3 flex items-center gap-3 text-t11 text-textSecondary">
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
        <Box title="The news" sub={`The wire on ${T} · ${wireReading && news.stories.length === 0 ? 'reading' : `${news.stories.length} ${news.stories.length === 1 ? 'story' : 'stories'} ${storyDayWord}`}${news.reports.length ? ` · the last ${news.reports.length} earnings ${news.reports.length === 1 ? "report" : "reports"}` : ''}`} aside={<PillarBarSmall p={byKey.news} held={held} />} testId="news">
          {news.stories.length === 0 ? (
            <div className="px-5 pb-4 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{wireReading ? 'Reading the wire' : recordNews.status === 'sim' ? 'This read did not land' : `Nothing on the wire ${storyDayWord}`}</div>
          ) : (
            <div>
              {news.stories.map(s => (
                <button key={s.id} type="button" onClick={() => navigate('/dossier/news', { state: { selectedId: s.id, name: T } })} className="group w-full text-left px-5 h-[34px] grid items-center gap-x-3 border-t border-borderSubtle/40 hover:bg-ink/[0.03] transition-colors" style={{ gridTemplateColumns: '64px minmax(0, 1fr) 64px 56px' }} data-stock-story={s.id}>
                  <span className="font-mono text-t10 tnum text-textMuted">{ago(s.item.minutesAgo)}</span>
                  <span className="min-w-0 truncate text-t115 text-textSecondary group-hover:text-textPrimary transition-colors" title={closedAgainst(s.item.headline, s.item.atMs) ?? undefined}>
                    {/* a headline's move that the close undid is said beside it */}
                    {closedAgainst(s.item.headline, s.item.atMs) ? <span className="text-warn">{closedAgainst(s.item.headline, s.item.atMs)} · </span> : null}
                    {s.item.headline}
                  </span>
                  <NewsFlag major={s.item.major} />
                  <span className="text-right font-mono text-t11 font-semibold tnum whitespace-nowrap"><PublishMove p={s.item.prediction} short /></span>
                </button>
              ))}
            </div>
          )}
          {/* the last reports: what it earned against the estimate, and the move the session after */}
          {news.reports.length > 0 && (
            <div className="border-t border-borderSubtle/40" data-stock-reports={news.reports.length}>
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: '78px 52px minmax(0, 1fr) 96px' }}>
                <span className="whitespace-nowrap">Report</span>
                <span className="whitespace-nowrap">EPS</span>
                {/* one line on a phone */}
                <span className="min-w-0 truncate">Against the estimate</span>
                <span className="text-right whitespace-nowrap"><span className="max-sm:hidden">The session after</span><span className="sm:hidden">Day after</span></span>
              </div>
              {news.reports.map(r => (
                <div key={r.label} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: '78px 52px minmax(0, 1fr) 96px' }} data-stock-report={r.label}>
                  <span className="font-mono text-t10 tnum text-textSecondary whitespace-nowrap">{r.label}</span>
                  <span className={`font-mono text-t11 tnum ${r.epsActual == null ? 'text-textMuted' : 'text-textPrimary'}`}>{r.epsActual == null ? '—' : r.epsActual.toFixed(2)}</span>
                  <span className={`min-w-0 truncate font-mono text-t10 tnum ${r.result === 'beat' ? 'text-bull' : r.result === 'miss' ? 'text-bear' : 'text-textSecondary'}`} title={r.estOff && r.epsEst != null ? `The street estimate, ${r.epsEst.toFixed(2)}, is far off this name's other estimates — likely a bad figure, so no beat or miss size is read from it` : r.result == null ? 'No street estimate for this report, so it is not called a beat or a miss' : undefined}>
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
                  <span className={`text-right font-mono text-t11 tnum font-semibold ${r.movePct == null ? 'text-textMuted' : r.movePct >= 0 ? 'text-bull' : 'text-bear'}`}>{r.movePct == null ? '—' : signedPct(r.movePct)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-auto">
            {byKey.news.factors.map(f => (
              <FactorRow key={f.key} f={f} />
            ))}
            <div className="px-5 py-2.5 border-t border-borderSubtle/40 flex items-center gap-3 min-w-0 font-mono text-t10 tnum" data-stock-next-earnings>
              {news.nextEarnings ? (
                <span className="text-textSecondary truncate min-w-0">
                  reports <span className="text-textPrimary">{news.nextEarnings.label}</span> · {untilWords(news.nextEarnings.daysOut)} {news.nextEarnings.impliedMovePct > 0 ? <> · the options price <span className="text-textPrimary">±{news.nextEarnings.impliedMovePct.toFixed(1)}%</span></> : <> · not priced yet</>}
                  {!news.nextEarnings.confirmed && <span className="text-warn" title="The company has not announced this date yet — it is our data provider's estimate and can move"> · date estimated</span>}
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
              <Link to="/dossier/news" state={{ name: T }} className="ml-auto shrink-0 inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors whitespace-nowrap">
                <ArrowUpRight className="w-3 h-3" /> the wire
              </Link>
            </div>
          </div>
        </Box>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch" data-name-record>
        {/* nothing reads "nothing" until the read is in */}
        <Box title="What its insiders did" sub={`Open-market trades in the last 90 days · ${insiders.status === 'loading' ? 'reading…' : insiders.status === 'sim' ? 'the read did not land' : insiders.trades.length ? insiders.signal : 'nothing filed'}`} testId="insiders">
          {marketInsiders.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted" data-name-insiders-empty={insiders.status ?? 'live'}>{insiders.status === 'loading' ? 'Reading the filings…' : insiders.status === 'sim' ? 'This read did not land' : 'Nothing on the record in 90 days'}</div>
          ) : (
            <>
              {/* on a phone: when, who, the trade and its value */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_44px_60px_60px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_44px_64px]">
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
                    <span className="text-t11 font-semibold text-textPrimary truncate">{personDisplay(t.person)}</span>
                    <span className="text-t9 text-textMuted truncate">
                      {t.role} · holds {count(t.heldAfter)} after
                    </span>
                  </span>
                  <span className={`font-mono text-t10 ${t.kind === 'BUY' ? 'text-bull' : 'text-bear'}`}>{t.kind === 'BUY' ? 'Bought' : 'Sold'}</span>
                  <span className="text-right font-mono text-t10 tnum text-textPrimary max-xl:hidden">{Math.round(t.shares).toLocaleString('en-US')}</span>
                  <span className="text-right font-mono text-t10 tnum font-semibold text-textPrimary">{fmtMoney(t.value)}</span>
                  <span className={`text-right font-mono text-t8 uppercase tracking-widest max-xl:hidden ${t.plan === 'discretionary' ? (isChosenBuy(t) ? 'text-textPrimary font-bold' : 'text-textSecondary') : 'text-textMuted'}`}>
                    {t.entity && t.plan !== 'plan' ? 'corporate' : t.plan === 'discretionary' ? 'chosen' : t.plan === 'plan' ? 'planned' : 'unstated'}
                  </span>
                </div>
              ))}
            </>
          )}
          <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex flex-col gap-1.5 font-mono text-t10 tnum" data-name-foot="insiders">
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
              <Link to="/dossier/insiders" className="ml-auto inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
                <ArrowUpRight className="w-3 h-3" /> every insider
              </Link>
            </div>
            {insiderTotal > 0 && <ShareBar left={(100 * insiders.bought) / insiderTotal} />}
          </div>
        </Box>
        <Box title="What Congress reported" sub={`STOCK Act reports in this stock, last 180 days${congressBook.complete ? '' : ' · latest 200 only'} · newest five`} testId="congress">
          {congress.length === 0 ? (
            <div className="px-5 pb-5 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{congressBook.status === 'loading' ? 'Reading the reports' : congressBook.status === 'sim' ? 'This read did not land' : 'No trade in this stock reported in 180 days'}</div>
          ) : (
            <>
              {/* on a phone: filed, member and type */}
              <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted grid-cols-[96px_minmax(0,1fr)_88px_132px_64px] max-xl:grid-cols-[96px_minmax(0,1fr)_88px]">
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
                    <span className="text-t11 font-semibold text-textPrimary truncate">{t.member.name}</span>
                    <span className="text-t9 text-textMuted truncate">
                      {seatLabel(t.member)} · {t.member.chamber}
                    </span>
                  </span>
                  <span className={`font-mono text-t10 ${t.type === 'Purchase' ? 'text-bull' : t.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}`}>{t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : t.type === 'Sale (Partial)' ? 'Sale · partial' : 'Sale'}{t.assetKind === 'Stock Option' ? <span className="text-textMuted" data-name-congress-option> · option</span> : null}</span>
                  <span className="font-mono text-t10 tnum text-textPrimary truncate max-xl:hidden">{bracketLabel(t.bracket)}</span>
                  <span className={`text-right font-mono text-t10 tnum max-xl:hidden ${t.late ? 'text-bear' : 'text-textSecondary'}`}>
                    {t.lagDays}d{t.late ? ' late' : ''}
                  </span>
                </div>
              ))}
            </>
          )}
          <div className="mt-auto px-5 py-2.5 border-t border-borderSubtle/40 flex items-center gap-4 font-mono text-t10 tnum" data-name-foot="congress">
            {congressAll.length > 0 && (
              <span className="text-textSecondary">
                {congressAll.length} {congressAll.length === 1 ? 'report' : 'reports'} in 180 days · {congressAll.filter(t => t.type === 'Purchase').length} purchases · {congressAll.filter(t => t.type !== 'Purchase' && t.type !== 'Exchange').length} sales
              </span>
            )}
            <Link to="/dossier/congress" className="ml-auto inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
              <ArrowUpRight className="w-3 h-3" /> every report
            </Link>
          </div>
        </Box>
      </div>
      <button type="button" onClick={() => setMore(v => !v)} aria-expanded={more} className="w-full h-9 rounded-md border border-borderSubtle bg-panel flex items-center justify-center gap-2 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-stock-more={more ? 'open' : 'shut'}>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${more ? 'rotate-180' : ''}`} />
        {more ? 'Less' : 'More'} on {T} · the options, the numbers, how the read is made, the timeline and the tape
      </button>
      {more && (
        <>
        <Box title="The options" sub={`What traded in ${T}'s options on ${screenWord} · the dealer book is on Pinpoint`} aside={<PillarBarSmall p={byKey.money} held={held} />} testId="money">
          <dl className="px-5 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            <Fact label="Open interest" testId="oi" tip="Contracts open on every listed expiry, and the side that holds more">
              <OpenInterest ticker={view.ticker} fallbackCall={money.callOI} fallbackPut={money.putOI} />
            </Fact>
            <Fact label={money.volumeAvgIs30 ? 'Volume · 30-day avg' : 'Volume · usual'} testId="volume" tip="Shares traded today against the name's usual day">
              {money.volumeToday != null ? count(money.volumeToday) : '—'} <span className="text-textMuted">· {money.volumeAvg != null ? count(money.volumeAvg) : '—'}</span>
              {money.rvolPaced && (
                <span className={money.rvol != null && money.rvol >= 1.3 ? 'text-silver' : 'text-textMuted'} title={money.rvolPaced.basis === 'paced' ? `Paced to the clock: ${Math.round(money.rvolPaced.share * 100)}% of a usual day trades by now. 1.00× is an ordinary day.` : money.rvolPaced.basis === 'full' ? "The whole session's volume against its 30-day average." : 'Too early in the session to pace — shown, not read.'}>
                  {' '}· {money.rvolPaced.label}
                </span>
              )}
            </Fact>
            <Fact label={money.today.length && nySessionPhase() === 'open' ? 'Where it trades in its range' : 'Where it closed in its range'} testId="close" tip="The last regular minute against the session's own low (0%) and high (100%)">
              {money.closeInRange != null ? (
                <>
                  {Math.round(money.closeInRange * 100)}% <span className="text-textMuted">up from the low</span>
                </>
              ) : (
                <span className="text-textMuted">{file.tapes === 'loading' ? 'reading…' : '—'}</span>
              )}
            </Fact>
            <Fact label="Unusual alerts" testId="unusual" tip="Flow alerts on the session on contracts that traded at least twice their open interest">
              {file.tapes === 'live' ? (
                <>
                  {money.unusual} <span className="text-textMuted">of {money.flowWindow.alerts}</span>
                </>
              ) : (
                <span className="text-textMuted">reading…</span>
              )}
            </Fact>
          </dl>
          <div className="px-5 pb-2 flex items-center gap-2 flex-wrap text-t11 text-textSecondary" data-stock-pinpoint>
            <span>Walls, the flip and dealer gamma for {T}:</span>
            <Door onClick={openOnMap}>The map on Pinpoint</Door>
          </div>
          {prem > 0 ? (
          <div className="px-5 pb-2" data-stock-flow>
            <div className="flex items-center justify-between gap-2 font-mono text-t10 tnum">
              <span className={callShare >= 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>calls {fmtMoney(money.callPremium)}</span>
              <span className="text-t9 uppercase tracking-widest text-textMuted text-center" title="The screener's call_premium and put_premium: every dollar paid for calls and for puts">option premium · {screenWord} · {Math.round(callShare)}% calls</span>
              <span className={callShare < 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>puts {fmtMoney(money.putPremium)}</span>
            </div>
            <div className="mt-1.5">
              <ShareBar left={callShare} />
            </div>
            {sidePrem > 0 && (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 font-mono text-t10 tnum" data-stock-side>
                  <span className={bullShare >= 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>bullish {fmtMoney(money.bullishPremium)}</span>
                  <span className="text-t9 uppercase tracking-widest text-textMuted text-center" title="Bullish: calls bought at the ask, puts sold at the bid. Bearish: puts bought at the ask, calls sold at the bid">the side of the trade · {Math.round(bullShare)}% bullish</span>
                  <span className={bullShare < 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>bearish {fmtMoney(money.bearishPremium)}</span>
                </div>
                <div className="mt-1.5">
                  <ShareBar left={bullShare} />
                </div>
              </>
            )}
            {file.tapes === 'loading' && (
              <p className="mt-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted" data-stock-alerts="reading">reading the flow alerts of {sessionWord}…</p>
            )}
            {file.tapes === 'live' && money.askSharePct != null && Number.isFinite(money.askSharePct) && money.sweepSharePct != null && Number.isFinite(money.sweepSharePct) && (
              <p className="mt-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted" data-stock-alerts>
                {money.flowWindow.complete
                  ? `${money.flowWindow.alerts.toLocaleString('en-US')} flow alerts on ${sessionWord}`
                  : `the latest ${money.flowWindow.alerts.toLocaleString('en-US')} flow alerts on ${sessionWord}, ${money.flowWindow.from}–${money.flowWindow.to} ET`}{' '}
                · {money.askSharePct.toFixed(1)}% of the sided premium on the ask · {money.sweepSharePct.toFixed(0)}% swept
              </p>
            )}
          </div>
          ) : (
            <div className="px-5 pb-2 font-mono text-t10 uppercase tracking-widest text-textMuted">No option premium on the screener yet</div>
          )}
          {file.tapes === 'loading' && (
            <div className="px-5 pb-3 font-mono text-t10 uppercase tracking-widest text-textMuted" data-stock-dark="reading">Reading the dark-pool prints of {sessionWord}, paged back to the open…</div>
          )}
          {money.dark.prints.length > 0 && (
          <div className="px-5 pb-3" data-stock-dark={money.darkWindow.read ? money.dark.posture : 'none'} title="Each print against the quote's mid at its time: over it buying, under it selling. Own-terms and after-hours prints are not read">
            {/* the caption on its own line, clear of the bar's end words */}
            <p className="font-mono text-t9 uppercase tracking-widest text-textMuted leading-snug" data-stock-dark-caption>
                {money.darkWindow.read
                  ? `off-exchange · ${money.dark.postureNote || postureRead(money.dark)} · ${money.darkWindow.read.toLocaleString('en-US')} ${money.darkWindow.read === 1 ? 'print' : 'prints'} of 10K shares or $500K+ on ${sessionWord}${money.darkWindow.complete ? '' : `, from ${money.darkWindow.cover ?? money.darkWindow.from} ET`}`
                  : `dark pool · no read · none of the ${money.darkWindow.inHand} prints in hand is a sized regular-session print priced at the quote`}
            </p>
            <div className="mt-1 flex items-center justify-between font-mono text-t10 tnum">
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
              <div className="mb-1 flex items-center justify-between font-mono text-t9 uppercase tracking-widest text-textMuted">
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
                      <span className="font-mono text-t11 font-bold tnum text-textPrimary">
                        {clockOf(time)}
                        {point && <span className="text-textMuted font-normal"> · {point.value.toFixed(2)}</span>}
                        {m && <span className="text-textMuted font-normal"> · {m.n === 1 ? 'one print' : `${m.n} prints`}</span>}
                        {kept && <span className="text-silver font-normal text-t9 uppercase tracking-widest"> · kept</span>}
                      </span>
                      {m ? (
                        <>
                          <span className="font-mono tnum">
                            <span className="text-textPrimary">{count(m.value)}</span> shares · the largest {count(m.biggest.size)} @ {m.biggest.price.toFixed(2)} · {fmtMoney(m.biggest.notional)}
                          </span>
                          <span className="text-t10 leading-snug" style={{ color: INTENT_INK[m.biggest.intent] ?? 'rgb(var(--text-secondary))' }}>
                            {m.biggest.intent.toLowerCase()} · {m.biggest.venue}
                          </span>
                        </>
                      ) : (
                        <span className="text-t10 text-textMuted">no off-exchange print this minute</span>
                      )}
                    </>
                  );
                }}
              />
              {/* the kept print, or the largest to keep; a click on a bar keeps it too */}
              <div className="mt-1.5 min-h-[26px] flex items-center gap-2 flex-wrap font-mono text-t10 tnum" data-stock-print-focus={printFocus ?? 'none'}>
                {keptPrint ? (
                  <>
                    <span className="text-t9 uppercase tracking-widest text-silver">kept</span>
                    <span className="font-semibold text-textPrimary">{clockOf(keptPrint.time)}</span>
                    <span className="text-textSecondary">
                      {count(keptPrint.biggest.size)} @ {keptPrint.biggest.price.toFixed(2)} · {fmtMoney(keptPrint.biggest.notional)} · {keptPrint.biggest.venue}
                    </span>
                    <span style={{ color: INTENT_INK[keptPrint.biggest.intent] ?? 'rgb(var(--text-secondary))' }}>
                      {keptPrint.biggest.intent.toLowerCase()} · a {gradeOfConviction(keptPrint.biggest.conviction)} read
                    </span>
                    <span className="text-textMuted">
                      {signedPct(keptPrint.biggest.vsSpotPct)} from spot{keptPrint.biggest.atLevel ? ' · on a shelf' : ''}
                    </span>
                    <button type="button" onClick={() => setPrintFocus(null)} className="ml-auto inline-flex items-center h-5 px-1.5 rounded border border-borderSubtle text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors" data-stock-print-release>
                      let go
                    </button>
                    <span className="basis-full text-t105 font-sans text-textSecondary truncate" data-stock-print-read>
                      {keptPrint.biggest.read}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-t9 uppercase tracking-widest text-textMuted" title="Click one, or a bar on the tape, to keep it">
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
      <CompanyFile ticker={T} />
      <NameBooks ticker={T} />
        <Box
          title="The numbers"
          sub={numbers.revenueActualB != null ? 'Revenue, margins, the last print and the dividend' : numbers.sample ? (file.status === 'loading' ? 'Reading the last print' : 'No print on this feed yet') : 'The last print, earnings growth, the dividend and the market cap'}
          aside={
            <div className="flex items-center gap-3">
              {numbers.sample ? null : <PillarBarSmall p={byKey.numbers} held={held} />}
            </div>
          }
          testId="numbers"
        >
          {numbers.sample ? (
            <div className="px-5 pb-4 font-mono text-t10 uppercase tracking-widest text-textMuted" data-stock-sample>
              {file.status === 'loading' ? 'Reading the last print' : 'No print on this feed yet'}
            </div>
          ) : (
          <>
          <dl className="px-5 pb-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
            {numbers.epsActual != null && (
            <Fact label="EPS · last print" testId="eps">
              {numbers.epsActual < 0 ? '−' : ''}${Math.abs(numbers.epsActual).toFixed(2)}{numbers.epsSurprisePct != null && numbers.epsEstimate != null ? <> <span className={numbers.epsSurprisePct >= 0 ? 'text-bull' : 'text-bear'}>{centsGap(numbers.epsActual, numbers.epsEstimate) ? `${numbers.epsActual - numbers.epsEstimate >= 0 ? '+' : '−'}${Math.round(Math.abs(numbers.epsActual - numbers.epsEstimate) * 100)}¢` : signedPct(numbers.epsSurprisePct)}</span></> : null}
            </Fact>
            )}
            {growthFactor && (
            <Fact label="Earnings growth" testId="growth" tip="The 1-, 2- and 3-year EPS changes, each as a rate a year; the slowest of them is the figure the numbers pillar scores">
              <span className={growthFactor.context ? 'text-textSecondary' : growthFactor.lean >= 0 ? 'text-bull' : 'text-bear'}>{growthFactor.value}</span>
              <span className="block text-t9 font-sans text-textMuted">{growthFactor.note}</span>
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
            {numbers.revenueActualB != null && (
            <Fact label="Revenue · last quarter" testId="revenue" tip="Total revenue on the latest quarterly income statement">
              {fmtMoney(numbers.revenueActualB * 1e9)}
              {numbers.revenueGrowthPct != null && <span className={numbers.revenueGrowthPct >= 0 ? 'text-bull' : 'text-bear'}> {numbers.revenueGrowthPct >= 0 ? '+' : '−'}{Math.abs(numbers.revenueGrowthPct).toFixed(1)}% y/y</span>}
            </Fact>
            )}
            {numbers.operatingMarginPct != null && (
            <Fact label="Operating margin" testId="op-margin" tip="Operating income divided by revenue, latest quarter">
              {numbers.operatingMarginPct.toFixed(1)}%
            </Fact>
            )}
            {filed.grossMarginPct != null && (
            <Fact label="Gross margin" testId="gross-margin" tip="Gross profit divided by revenue, latest quarter">
              {filed.grossMarginPct.toFixed(1)}%
            </Fact>
            )}
            {numbers.freeCashFlowMarginPct != null && (
            <Fact label="Free cash flow margin" testId="fcf-margin" tip="Operating cash flow minus capital expenditure, divided by revenue, latest quarter">
              {numbers.freeCashFlowMarginPct.toFixed(1)}%
            </Fact>
            )}
            {file.street && (
            <Fact label="Analyst target" testId="target" tip={`Median of the latest target from each firm in the last 180 days. ${file.street.firms} ${file.street.firms === 1 ? 'firm' : 'firms'}, as of ${shortDay(file.street.asOf)}. Low ${fmtMoney(file.street.low)} · high ${fmtMoney(file.street.high)}.`}>
              {fmtMoney(file.street.median)} <span className="text-textMuted">{file.street.firms} {file.street.firms === 1 ? 'firm' : 'firms'} · {fmtMoney(file.street.low)}–{fmtMoney(file.street.high)}</span>
            </Fact>
            )}
            {/* no market cap here: "The company" carries the name's own */}
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
      {/* How the read is made, in words: every factor for or against, each pillar, the trend over time, what would change it. */}
      <Box title="How the read is made" sub="Each factor for or against, each pillar, what would change it, the sources" testId="score">
        {/* the three columns stack below xl */}
        <div className="grid border-t border-borderSubtle/60 grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
          {/* every factor, the heaviest first; the bar is a length, never a figure */}
          <div className="border-r border-borderSubtle/60 min-w-0 max-xl:border-r-0 max-xl:border-b">
            <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0, 1fr) 88px 56px' }}>
              <span>Factor</span>
              <span className="text-center">Against · for</span>
              <span className="text-right">Says</span>
            </div>
            {view.contributions.map(c => {
              const side = c.points > 0 ? 'for' : c.points < 0 ? 'against' : 'even';
              return (
                <div key={c.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 88px 56px' }} data-stock-contribution={c.key} data-side={side}>
                  <span className="min-w-0 flex items-baseline gap-1.5 truncate">
                    <span className="text-t11 text-textPrimary truncate">{c.label}</span>
                    <span className="font-mono text-t8 uppercase tracking-widest text-textMuted shrink-0">{c.pillar}</span>
                  </span>
                  <SignedBar v={c.points / maxPts} />
                  <span className={`text-right font-mono text-t9 font-semibold uppercase tracking-widest ${side === 'for' ? 'text-bull' : side === 'against' ? 'text-bear' : 'text-textMuted'}`}>{side}</span>
                </div>
              );
            })}
            <div className="px-5 h-[34px] border-t border-borderSubtle/60 flex items-center gap-3 font-mono text-t10" data-stock-for={forIt} data-stock-against={againstIt}>
              <span className="text-textSecondary">
                <span className="text-bull font-semibold">{forIt}</span> for it · <span className="text-bear font-semibold">{againstIt}</span> against
              </span>
              <span className="ml-auto text-textSecondary">
                the read {held ? <span className="text-textMuted animate-pulse">reading…</span> : <span className={`font-bold ${GRADE_INK[grade]}`}>{grade}</span>}
              </span>
            </div>
          </div>
          <div className="border-r border-borderSubtle/60 min-w-0 max-xl:border-r-0 max-xl:border-b">
            <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }}>
              <span>Pillar</span>
              <span />
              <span className="text-right">Reads</span>
            </div>
            {view.pillars.map(p => {
              const g = gradeOf(p.score);
              /* a pillar the read leaves out is "not scored", never a grade it does not have */
              if (!p.inRead)
                return (
                  <div key={p.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }} data-stock-weight={p.key} data-grade="none">
                    <span className="text-t11 text-textMuted flex items-center gap-2 truncate">{p.name}</span>
                    <span className="h-[6px] rounded-full bg-ink/[0.04]" />
                    <span className="text-right font-mono text-t10 text-textMuted whitespace-nowrap">not scored</span>
                  </div>
                );
              return (
                <div key={p.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }} data-stock-weight={p.key} data-grade={g}>
                  <span className="text-t11 text-textPrimary flex items-center gap-2 truncate">
                    {p.name}
                    {p.status !== 'live' && <StatusTag status={p.status} />}
                  </span>
                  <GradeMeter grade={g} />
                  <span className={`text-right font-mono text-t11 font-semibold ${GRADE_INK[g]}`}>{g}</span>
                </div>
              );
            })}
            <div className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/60" style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 64px' }}>
              <span className="text-t11 font-semibold text-textPrimary">The read</span>
              <GradeMeter grade={grade} />
              <span className={`text-right font-mono text-t12 font-bold ${GRADE_INK[grade]}`}>{grade}</span>
            </div>
            {/* the read, session by session — a pip per session in its word's ink and at its word's height; four steps, never a line */}
            <div className="px-5 py-2.5 border-t border-borderSubtle/40 flex flex-col gap-1.5" data-stock-series={view.series.length}>
              {view.series.length > 2 ? (
                <>
                  <div className="flex items-end gap-[2px] h-[20px]" role="img" aria-label={`The trend over the last ${view.series.length} sessions`}>
                    {view.series.map(q => {
                      const g = gradeOf(q.trend);
                      return <span key={q.time} title={`${dayOf(q.time)} · ${g}`} className={`flex-1 min-w-0 rounded-[1px] ${GRADE_FILL[g]} ${q.back === 0 ? '' : 'opacity-70'}`} style={{ height: `${(GRADES.indexOf(g) + 1) * 25}%` }} data-series-grade={g} />;
                    })}
                  </div>
                  <span className="text-t105 leading-snug text-textSecondary">
                    The trend alone over the last {view.series.length} sessions, off the daily bars:{' '}
                    {(() => {
                      const word = (back: number) => {
                        const q = view.series.find(x => x.back === back);
                        return q ? gradeOf(q.trend) : null;
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
                          {w20 ? <>{say(w20, 'twenty back')}, </> : w5 ? null : <>{say(gradeOf(view.series[0].trend), 'at the start')}, </>}
                          {w5 && <>{say(w5, 'five back')}, </>}
                          {say(gradeOf(view.series[view.series.length - 1].trend), 'now')}
                        </>
                      );
                    })()}
                    .
                  </span>
                </>
              ) : (
                <span className="text-t105 text-textMuted">Too few sessions on hand for a history.</span>
              )}
            </div>
            {/* what would change it */}
            <div className="px-5 h-[22px] flex items-center border-t border-borderSubtle/40 text-t9 uppercase tracking-widest text-textMuted">What would change it · a factor turned the other way</div>
            {view.moves.length === 0 && <div className="px-5 h-[26px] flex items-center border-t border-borderSubtle/40 text-t105 text-textMuted">No factor leans far enough to change it.</div>}
            {view.moves.map(m => {
              const then = gradeOfComposite(m.to);
              const same = then === grade;
              return (
                <div key={m.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 64px 84px' }} data-stock-move={m.key} data-to-grade={then}>
                  <span className="text-t11 text-textPrimary truncate">{m.label}</span>
                  <SignedBar v={m.delta / maxDelta} />
                  <span className={`text-right font-mono text-t10 whitespace-nowrap ${same ? 'text-textMuted' : GRADE_INK[then]}`}>{same ? `stays ${then}` : `→ ${then}`}</span>
                </div>
              );
            })}
          </div>
          <div className="min-w-0">
            <div className="px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(0, 1.5fr)' }}>
              <span>Source</span>
              <span>Status</span>
              <span>As of</span>
            </div>
            {pageSources.map(s => (
              <div key={s.key} className="px-5 h-[26px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(0, 1fr) 48px minmax(0, 1.5fr)' }} data-stock-source={s.key} data-status={s.status}>
                <span className="text-t11 text-textPrimary truncate">{s.label}</span>
                <StatusTag status={s.status} />
                <span className="font-mono text-t10 text-textSecondary truncate">{s.stamp}</span>
              </div>
            ))}
            <div className="px-5 py-3 border-t border-borderSubtle/40 text-t105 leading-snug text-textSecondary">
              <span className="text-textPrimary">{completeness}%</span> of the page is live. The word is the Stocks board's own: both read the same screener row.
            </div>
          </div>
        </div>
        {/* the method, behind a fold */}
        <div className="border-t border-borderSubtle/60">
          <button type="button" onClick={() => setMethodOpen(v => !v)} aria-expanded={methodOpen} className="w-full px-5 h-[34px] flex items-center gap-2 font-mono text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-stock-method-door={methodOpen ? 'open' : 'shut'}>
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
                  <div className="text-t9 uppercase tracking-widest text-textMuted">{title}</div>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {items.map(t => (
                      <li key={t} className="text-t11 leading-snug text-textPrimary/85 pl-3 relative before:absolute before:left-0 before:top-[7px] before:w-1 before:h-1 before:rounded-full before:bg-ink/40">
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

      {/* The timeline: a row per kind of mark, its count and grade, a strip of the sessions on hand, the facts at the right. */}
      <Box title="The timeline" sub={`Breaks, heavy volume, big sessions and the wire over the ${trend.sessions} sessions on hand`} testId="timeline">
        <ul className="flex flex-col" data-stock-lanes>
          {lanes.map(r => (
            <li key={r.key} className="border-t border-borderSubtle/50" data-stock-timeline={r.key} data-lane-ticks={r.ticks.length} data-kind={r.key}>
              {/* one column on a phone */}
              <div className="grid grid-cols-[200px_minmax(0,1fr)_auto] items-center gap-6 px-5 py-3 max-xl:grid-cols-1 max-xl:gap-3">
                <div className="min-w-0">
                  <span className="block text-t11 font-semibold" style={{ color: r.ink }}>
                    {r.label}
                  </span>
                  <span className="block font-mono text-t15 font-semibold tnum leading-tight text-textPrimary">{r.figure}</span>
                  <span className={`mt-1 inline-flex items-center h-5 px-2 rounded-full border text-t10 font-medium ${LANE_TONE[r.grade.tone]}`} data-grade>
                    {r.grade.words}
                  </span>
                </div>
                <div className="min-w-0">
                  <MarkStrip ticks={r.ticks} n={trend.times.length} label={r.label} />
                  <div className="flex justify-between font-mono text-t9 tnum text-textMuted px-1 -mt-0.5">
                    {/* the year when the span runs past one */}
                    <span>{trend.times.length ? `${dayOf(trend.times[0])}${new Date(trend.times[0] * 1000).getUTCFullYear() !== new Date().getUTCFullYear() || trend.times.length > 250 ? `, ${new Date(trend.times[0] * 1000).getUTCFullYear()}` : ''}` : ''}</span>
                    <span>now</span>
                  </div>
                </div>
                {/* Fixed tracks, so every row's strip ends on the same line whatever the words in the last fact */}
                <dl className="grid grid-cols-[52px_72px_64px_236px] gap-x-5 max-xl:flex max-xl:flex-wrap max-xl:gap-y-1.5">
                  {r.facts.map(f => (
                    <div key={f.k} className="min-w-0">
                      <dt className="text-t10 text-textMuted whitespace-nowrap" title={statHelp(f.k)}>{f.k}</dt>
                      <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap truncate ${f.cls ?? 'text-textPrimary'}`}>{f.v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </li>
          ))}
        </ul>
      </Box>

      {/* the tape: the biggest buys and sells, then the busiest calls and puts */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Biggest buys" sub={`The richest flow alerts on the name on ${sessionWord}, paid on the ask · click one to weigh it`} testId="buys">
          <div className="pb-2 mt-auto">
            {view.prints.buys.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{file.tapes === 'loading' ? 'Reading the flow alerts…' : <>No rich alerts paid up on {T} on {sessionWord}</>}</div>}
            {view.prints.buys.map(p => (
              <PrintRow key={p.id} p={p} maxPrem={maxPrem} onOpen={() => weigh(p)} />
            ))}
          </div>
        </Box>
        <Box title="Biggest sells" sub={`The richest flow alerts on the name on ${sessionWord}, hit on the bid · click one to weigh it`} testId="sells">
          <div className="pb-2 mt-auto">
            {view.prints.sells.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{file.tapes === 'loading' ? 'Reading the flow alerts…' : <>No rich alerts hit the bid on {T} on {sessionWord}</>}</div>}
            {view.prints.sells.map(p => (
              <PrintRow key={p.id} p={p} maxPrem={maxPrem} onOpen={() => weigh(p)} />
            ))}
          </div>
        </Box>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        <Box title="Busiest calls" sub={`The three busiest by volume on ${sessionWord} · click one to weigh it`} testId="calls">
          <div className="pb-2 mt-auto">
            {money.busiest.calls.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{file.status === 'live' ? <>No call volume on {sessionWord}</> : 'Reading the chain…'}</div>}
            {money.busiest.calls.map(c => (
              <ContractRow key={c.key} c={c} maxVol={maxVol} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
        <Box title="Busiest puts" sub={`The three busiest by volume on ${sessionWord} · click one to weigh it`} testId="puts">
          <div className="pb-2 mt-auto">
            {money.busiest.puts.length === 0 && <div className="px-5 pb-3 pt-1 font-mono text-t10 uppercase tracking-widest text-textMuted">{file.status === 'live' ? <>No put volume on {sessionWord}</> : 'Reading the chain…'}</div>}
            {money.busiest.puts.map(c => (
              <ContractRow key={c.key} c={c} maxVol={maxVol} onOpen={() => weigh(c)} />
            ))}
          </div>
        </Box>
      </div>

        </>
      )}
    </>
  );
};

/** The pillar's bar as a box's aside — the same bar, a shorter track */
const PillarBarSmall = ({ p, held = false }: { p: Pillar; held?: boolean }) => (
  <div className="w-[150px] shrink-0">
    <PillarBar p={p} held={held} />
  </div>
);

/* The name's whole open interest from the per-expiry rows, expired dates dropped; the chain's own figure until they land. */
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

/* the company's name, never the ticker twice */
function CompanyTitle({ ticker, name }: { ticker: string; name: string }) {
  const n = useCompanyName(ticker, true, true);
  if (n === '') return <span className="opacity-60">…</span>;
  if (n.toUpperCase() !== ticker.toUpperCase()) return <>{displayName(n)}</>;
  if (name && name.toUpperCase() !== ticker.toUpperCase()) return <>{displayName(name)}</>;
  return <>{ticker}</>;
}

/** A name whose options book has not landed. The file still shows the print, the next report and the statements. */
function NameWithoutBook({ ticker, file, quote }: { ticker: string; file: StockFile; quote: LiveQuote | null }) {
  const dates = file.earnings
    .map(e => String(e.report_date ?? '').slice(0, 10))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  const today = nyIsoDate();
  const next = dates.find(d => d >= today) ?? null;
  const px = quote ? (quote.phase !== 'regular' && quote.extPrice != null && quote.extPrice > 0 ? quote.extPrice : quote.spot > 0 ? quote.spot : null) : null;
  /* the day's change (data/dayChange.ts): the regular session's, never the after-hours move in its place */
  const pct = quote && Number.isFinite(quote.changePct) ? quote.changePct : null;
  const filed = quarterFacts(file.quarters);
  return (
    <div className="border border-borderSubtle rounded-md bg-panel px-5 py-4" data-stock-empty={ticker}>
      <div className="flex items-center gap-3 min-w-0">
        <CompanyLogo ticker={ticker} size={28} />
        <div className="min-w-0">
          <h3 className="text-t15 font-semibold leading-tight text-textPrimary truncate"><CompanyTitle ticker={ticker} name="" /></h3>
          <p className="font-mono text-t11 text-textMuted">{ticker}</p>
        </div>
        <div className="ml-auto text-right font-mono tnum">
          {px != null ? (
            <>
              <div className="text-t15 font-semibold text-textPrimary">{px.toFixed(2)}</div>
              {pct != null && <div className={`text-t11 ${pct >= 0 ? 'text-bull' : 'text-bear'}`}>{pct >= 0 ? '+' : '−'}{Math.abs(pct).toFixed(2)}%</div>}
            </>
          ) : (
            <div className="text-t11 text-textMuted">No print yet</div>
          )}
        </div>
      </div>
      <p className="mt-3 text-t12 text-textSecondary">
        {file.status === 'loading' ? 'The stock file is still being read.' : 'The stock file did not come back for this name, so there is no read. The figures below are what did.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-t11 text-textSecondary">
        <span>{next ? `Next report · ${shortDay(next)}` : file.status === 'error' ? 'The stock file did not load.' : 'No earnings date on this file.'}</span>
        {filed.revenue != null && <span>Revenue · {fmtMoney(filed.revenue)}{filed.revenueGrowthPct != null ? ` · ${filed.revenueGrowthPct >= 0 ? '+' : '−'}${Math.abs(filed.revenueGrowthPct).toFixed(1)}% y/y` : ''}</span>}
        {filed.grossMarginPct != null && <span>Gross margin · {filed.grossMarginPct.toFixed(1)}%</span>}
        {filed.operatingMarginPct != null && <span>Operating margin · {filed.operatingMarginPct.toFixed(1)}%</span>}
        {file.street && <span>Analyst target · {fmtMoney(file.street.median)} · {file.street.firms} {file.street.firms === 1 ? 'firm' : 'firms'}</span>}
      </div>
    </div>
  );
}

export default StockName;
