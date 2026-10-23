/*
==================================================
  SLAYER TERMINAL - NEWS (pages/record/News.tsx)

  The wire, rebuilt from a blank canvas under the
  Record (Noah, 2026-09-09: "everything of benefit
  related to news, what it effects, numbers,
  interactive parts. but most importantly i want a
  2d map that has pins on the news you click").
  Two boxes, read top to bottom:

    THE WIRE    the head with four facts, one line
                of cards, then the MAP with a pin on
                every city the day's stories come
                from beside THE STORY in hand — its
                grade, its numbers, what the options
                book thinks of it, the odds, the
                playbook, what kills it, where it
                lands, and the doors — then every
                story as a row; a click on a row or
                a pin picks the story
    THE DAY     what is ahead on the calendar, and
                the reads the wire adds up to

  Everything speaks the two engines that were here
  before (data/news.ts, data/newsroom.ts); the room
  they used to fill is archived in
  docs/news-page-reference.md.
==================================================
*/

import { companyName } from '../../data/tickers';
import { extendedLine, useLiveQuote, useSetMoves } from '../../data/liveQuote';
import { PublishMove, storyNameWord } from '../../components/record/publishMove';
import { nyTodayIso, shortDay } from '../../data/nyDate';
import { useNearReports } from '../../data/earningsFeed';
import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Bell, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import Fold from '../../components/ui/Fold';
import { useTicker } from '../../context/MarketDataContext';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import AnimatedNumber from '../../components/ui/AnimatedNumber';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import CatTag from '../../components/news/CatTag';
import NewsMap, { HeatLegend, nextOpen, openSessions, type FlyTo, type HeatPoint, type Reach } from '../../components/record/NewsMap';
import { now } from '../../core/clock';
import { NewsGuide } from '../../components/record/NewsGuide';
import { useVendor } from '../../data/vendorFeed';
import { armNews, removeAlert, useAlerts } from '../../components/gex/alertStore';
import { useBoardNames } from '../../data/boardNames';
import { type NewsCategory } from '../../data/news';
import { lookup } from '../../data/universe';
import { buildRoomInsights, clusterByCity, freshnessOf, severityWord, type CityPing, type GeoNewsEvent, type NewsGrade } from '../../data/newsroom';
import { useEconFeed, useNewsCoverage, useNewsFeed } from '../../data/liveRecord';
import { nyClock } from '../../core/nyTime';
import { ImpactLegend, ImpactMark, NEWS_FLAG_TIP, NewsFlag, tierOf } from '../../components/record/impactMark';
import NewsFeedTabs, { keepInWindow, nameWord } from '../../components/record/NewsFeedTabs';
import NewsCalendar from '../../components/record/NewsCalendar';
import { useMediaQuery } from '../../components/ui/useMediaQuery';
import { NEWS_ROW_H, NEWS_WINDOW_H, NEWS_WINDOW_ROWS } from './recordSkeletons';

const SILVER = 'rgb(var(--silver))'; /* the silver token — deep steel on the light terminal (2026-09-12) */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const GRADE_BAR: Record<NewsGrade, string> = { THREAT: 'bg-bear/85', ALLY: 'bg-bull', WATCH: 'bg-ink/40' };
/** The grade in the page's words — how the story reads for the name (Noah, 2026-09-09: "positive, negative") */
/** A real vendor lean, when the feed ever sends one — Unusual Whales sends "neutral" on every headline today, so this is null */
const leanOf = (g: NewsGrade): 'positive' | 'negative' | null => (g === 'ALLY' ? 'positive' : g === 'THREAT' ? 'negative' : null);

type CategoryPick = 'all' | NewsCategory;
type LeanPick = 'any' | NewsGrade;
type NamesPick = 'all' | 'board' | 'macro';
type Sort = 'matters' | 'newest' | 'move' | 'loud';

const CATEGORY_OPTIONS: DropdownOption<CategoryPick>[] = [
  { value: 'all', label: 'All', hint: 'Every kind of story' },
  { value: 'Earnings', label: 'Earnings', hint: 'Prints and what they said' },
  { value: 'Guidance', label: 'Guidance', hint: 'What a company said about what is coming' },
  { value: 'Analyst', label: 'Analyst', hint: 'Upgrades, downgrades, targets' },
  { value: 'Macro', label: 'Macro', hint: 'The economy and its data, central banks and rates, currencies, markets, policy, geopolitics and the world — no single company' },
  { value: 'M&A', label: 'M&A', hint: 'Deals, bids, spin-offs' },
  { value: 'Product', label: 'Product', hint: 'Launches and reviews' },
  { value: 'Regulatory', label: 'Regulatory', hint: 'Courts, agencies, probes' },
  { value: 'General', label: 'General', hint: 'Stories the headline gives no beat — none of the above' },
];
const LEAN_OPTIONS: DropdownOption<LeanPick>[] = [
  { value: 'any', label: 'Any lean', short: 'All', hint: 'Positive, negative and neutral stories' },
  { value: 'ALLY', label: 'Positive', hint: 'Stories the model reads as good for the name', tone: 'bull' },
  { value: 'THREAT', label: 'Negative', hint: 'Stories the model reads as bad for the name', tone: 'bear' },
  { value: 'WATCH', label: 'Neutral', hint: 'Stories with no clear direction yet' },
];
const NAMES_OPTIONS: DropdownOption<NamesPick>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'Every story on the wire' },
  { value: 'board', label: 'Your board', hint: 'Stories on the names on your Board' },
  { value: 'macro', label: 'Macro only', hint: 'The economy, the Fed, markets and policy — stories with no company as their subject' },
];
const SORT_OPTIONS: DropdownOption<Sort>[] = [
  { value: 'matters', label: 'What matters', hint: 'Major stories on your Board first, then the rest of your Board, then other major stories, then stories with a named stock or about the economy, then the rest — newest first inside each. Routine notices the wire flags major (a dividend declared, a results date, a conference slot) and unlisted press releases are not lifted' },
  { value: 'newest', label: 'Newest', hint: 'The latest story first' },
  { value: 'move', label: 'Biggest move', hint: 'The named stock that had moved most on the session when its story crossed, first; a story that crossed before the open is ranked by its stock\'s last-session move, the move its row shows' },
  { value: 'loud', label: 'Loudest', hint: 'Major stories and big movers first' },
];

/* THE IMPACT MARK lives in components/record/impactMark.tsx since 2026-09-13 — the All news box and the month draw the same square */

/** A notice, not news: dividends declared, results dates and calls scheduled, conference slots, tokenized listings */
/* a figure's decimal point ("$15.63/share") is not the end of a sentence (the third audit, 2026-10-23) */
/* sport, fashion and lifestyle — press releases that are not market news */
const LIFESTYLE_RE = /\b(?:fc|football|soccer|bundesliga|premier league|la liga|serie a|champions league|world cup|nba|nfl|mlb|nhl|wnba|formula (?:1|one)|f1|grand prix|nascar|olympics?|tennis|golf|pga|ufc|esports?|stadium|jersey|kit sponsor|bayern|real madrid|barcelona|manchester united|fashion|runway|couture|apparel collection|capsule collection|handbags?|sneakers?|fragrance|cosmetics|skincare|beauty|lifestyle|wellness|recipes?|celebrity|red carpet|film festival|concert|album|music video|call of duty|modern warfare)\b/i;
const ROUTINE_RE = /\bdeclares?\b(?:[^.]|\.(?=\d)){0,40}\bdividends?\b|\bdividends?\b(?:[^.]|\.(?=\d)){0,20}\bdeclared\b|\b(?:to (?:announce|report|release|host)|announces?|schedules?|sets?)\b(?:[^.]|\.(?=\d)){0,60}\b(?:results|earnings release|conference call|webcast)\b(?:[^.]|\.(?=\d)){0,40}\b(?:on|date|dates|for)\b|\b(?:to )?(?:participate|present) (?:in|at)\b(?:[^.]|\.(?=\d)){0,40}\bconferences?\b|\btokeni[sz]ed\b|\bbinance futures\b|\belected\b(?:[^.]|\.(?=\d)){0,40}\bdirector\b/i;

const ago = (m: number) => (m < 1 ? 'just now' : m < 60 ? `${Math.round(m)}m ago` : `${Math.floor(m / 60)}h ${Math.round(m % 60)}m ago`);
const signed = (v: number, d = 1) => `${v >= 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`;

/*
  THE TAPE (2026-09-13), WITH A WAY BACK (Noah, 2026-09-16: "what if a user
  misses a key news event and it scrolled away too soon"): the newest 14
  headlines on the cut crossing the top of the map, two identical halves as
  one seamless loop. It used to be a CSS marquee that only paused under the
  pointer; now a frame loop drives it so it can be PULLED — it holds still
  under the pointer or a focus, the wheel or a drag moves it by hand, the
  arrows at its ends step one headline back or on with a glide, and it
  resumes when let go. The rows under the map stay the record — this is
  the glance, never the archive. Reduced motion: it stands still and the
  arrows and the wheel are the only way it moves.
*/
/** One loop of the tape at rest — the CSS marquee's 110s, kept */
const TAPE_SECONDS_PER_LOOP = 110;
/** The lead before the first headline (the halves' `pl-4`) — a step lands a headline behind it */
const TAPE_LEAD = 16;
/** A drag past this many px is a pull, not a click */
const TAPE_DRAG_PX = 4;

const NewsTape = ({ tape, selectedId, onPick }: { tape: GeoNewsEvent[]; selectedId: string | null; onPick: (e: GeoNewsEvent) => void }) => {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const halfRef = useRef<HTMLSpanElement | null>(null);
  /* where the strip stands, px ≤ 0; the loop wraps it by one half's width */
  const xRef = useRef(0);
  /* a step's destination — the loop glides there and holds */
  const targetRef = useRef<number | null>(null);
  const holdRef = useRef({ hover: false, focus: false, drag: false });
  const dragRef = useRef<{ startX: number; x0: number; moved: boolean } | null>(null);
  /* the click after a pull is the pull's, not the headline's */
  const pulledRef = useRef(false);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      const dt = last ? Math.min(64, ts - last) : 16;
      last = ts;
      const halfW = halfRef.current?.offsetWidth ?? 0;
      if (halfW <= 0) return;
      const h = holdRef.current;
      let x = xRef.current;
      const target = targetRef.current;
      if (target != null) {
        x += (target - x) * (1 - Math.exp(-dt / 90));
        if (Math.abs(target - x) < 0.5) {
          x = target;
          targetRef.current = null;
        }
      } else if (!(h.hover || h.focus || h.drag) && !still) {
        x -= (halfW / TAPE_SECONDS_PER_LOOP) * (dt / 1000);
      }
      /* the loop: the two halves are identical, so a half's width is a full turn */
      if (x <= -halfW) {
        x += halfW;
        if (targetRef.current != null) targetRef.current += halfW;
      } else if (x > 0) {
        x -= halfW;
        if (targetRef.current != null) targetRef.current -= halfW;
      }
      xRef.current = x;
      strip.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      strip.dataset.tapeX = String(Math.round(x));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tape.length > 0]);

  /* THE WHEEL PULLS IT — a native listener, because React's wheel is passive and the page
     would scroll under a pull; the map beside it takes the wheel the same way */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      targetRef.current = null;
      xRef.current -= d;
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  /* A STEP: the next (or the previous) headline's start lands behind the lead, gliding */
  const step = (dir: 1 | -1) => {
    const half = halfRef.current;
    const halfW = half?.offsetWidth ?? 0;
    if (!half || halfW <= 0) return;
    const lefts = [...half.children].map(c => (c as HTMLElement).offsetLeft - TAPE_LEAD);
    if (!lefts.length) return;
    const cur = (((-xRef.current) % halfW) + halfW) % halfW;
    let dist: number;
    if (dir === 1) {
      const next = lefts.find(l => l > cur + 1);
      dist = (next ?? lefts[0] + halfW) - cur;
    } else {
      const before = lefts.filter(l => l < cur - 1);
      const prev = before.length ? before[before.length - 1] : lefts[lefts.length - 1] - halfW;
      dist = cur - prev;
    }
    targetRef.current = xRef.current - dir * dist;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, x0: xRef.current, moved: false };
    holdRef.current.drag = true;
    targetRef.current = null;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (Math.abs(dx) > TAPE_DRAG_PX) d.moved = true;
    if (d.moved) xRef.current = d.x0 + dx;
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    pulledRef.current = d.moved;
    dragRef.current = null;
    holdRef.current.drag = false;
  };
  const onClickCapture = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (!pulledRef.current) return;
    pulledRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const arrow = 'shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle bg-chip text-textSecondary hover:text-textPrimary hover:border-borderMuted transition-colors';

  return (
    <div
      ref={boxRef}
      className="relative h-[30px] border-b border-ink/[0.06] flex items-center gap-1 px-1.5"
      data-news-tape={tape.length}
      onPointerEnter={() => (holdRef.current.hover = true)}
      onPointerLeave={() => {
        holdRef.current.hover = false;
        endDrag();
      }}
      /* a KEYBOARD focus holds it (a Tab onto a headline must not have it slide away); a click's
         focus does not, or the tape would stand still after every pick and every arrow */
      onFocus={e => (holdRef.current.focus = e.target.matches(':focus-visible'))}
      onBlur={() => (holdRef.current.focus = false)}
    >
      <button type="button" onClick={() => step(-1)} aria-label="Back one headline" title="Back one headline" className={arrow} data-news-tape-step="back">
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>
      <div
        /* the strip fades at both ends, so a headline running past an arrow dissolves instead of starting mid-word */
        className="relative flex-1 min-w-0 h-full overflow-hidden select-none cursor-grab active:cursor-grabbing [mask-image:linear-gradient(to_right,transparent,black_28px,black_calc(100%-28px),transparent)]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        data-news-tape-strip
      >
        {tape.length > 0 && (
          <div ref={stripRef} className="absolute inset-y-0 left-0 flex items-center whitespace-nowrap w-max will-change-transform">
            {[0, 1].map(half => (
              <span key={half} ref={half === 0 ? halfRef : undefined} className="inline-flex items-center pl-4" aria-hidden={half === 1 || undefined}>
                {tape.map(e => (
                  <button
                    key={`${half}-${e.id}`}
                    type="button"
                    tabIndex={half === 1 ? -1 : 0}
                    onClick={() => onPick(e)}
                    className={`group inline-flex items-center gap-2 mr-9 transition-colors ${e.id === selectedId ? 'text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}
                    title={`${e.item.headline} · ${e.item.source} · ${ago(e.item.minutesAgo)}`}
                    data-news-tape-item={half === 0 ? e.id : undefined}
                  >
                    <ImpactMark tier={tierOf(e.severity)} />
                    {/* THE LOOP'S SECOND HALF IS DRAWN, NOT WRITTEN (audit round 5: every tape headline sat twice in the page's
                        text, the wire read as listed twice): its words are CSS content, out of the text a reader or a
                        screen reader copies, and the half is aria-hidden */}
                    {half === 0 ? (
                      <>
                        <span className="font-mono text-[10px] font-bold text-textPrimary">{nameWord(e.item)}</span>
                        <span className="text-[11px] whitespace-normal">{e.item.headline}</span>
                        <span className="font-mono text-[9px] text-textMuted">{ago(e.item.minutesAgo)}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[10px] font-bold text-textPrimary before:content-[attr(data-copy)]" data-copy={nameWord(e.item)} />
                        <span className="text-[11px] whitespace-normal before:content-[attr(data-copy)]" data-copy={e.item.headline} />
                        <span className="font-mono text-[9px] text-textMuted before:content-[attr(data-copy)]" data-copy={ago(e.item.minutesAgo)} />
                      </>
                    )}
                  </button>
                ))}
              </span>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => step(1)} aria-label="On one headline" title="On one headline" className={arrow} data-news-tape-step="on">
        <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

/** A door out — small, labelled, never a naked icon; warms the name on hover so the landing is instant */
const Door = ({ onClick, onWarm, children }: { onClick: () => void; onWarm?: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    onMouseEnter={onWarm}
    className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted font-mono text-[9px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors"
  >
    <ArrowUpRight className="w-3 h-3" />
    {children}
  </button>
);

/** ALERTS ON A NAME'S NEWS (2026-09-13; the partner: "have alerts on for
    specific tickers"): the bell's own news alert, set from the story card —
    a headline landing on this name after now rings the bell (alertStore
    `armNews`, judged by the shell's watcher); lit holo silver while set, a
    second click takes it off. One per name (the store's own rule). */
const NewsAlertDoor = ({ ticker }: { ticker: string }) => {
  const alerts = useAlerts(ticker);
  const set = alerts.find(a => a.kind === 'news') ?? null;
  return (
    <button
      type="button"
      onClick={() => (set ? removeAlert(ticker, set.id) : armNews(ticker, Date.now()))}
      aria-pressed={!!set}
      title={set ? `The bell rings when a headline lands on ${ticker} · click to take it off` : `Ring the bell when a headline lands on ${ticker}`}
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border font-mono text-[9px] uppercase tracking-widest transition-colors ${set ? 'border-silver/50 text-silver bg-silver/[0.08]' : 'border-borderSubtle bg-chip hover:border-borderMuted text-textSecondary hover:text-textPrimary'}`}
      data-news-alert={set ? 'set' : 'off'}
    >
      <Bell className="w-3 h-3" />
      {set ? `Alert set · ${ticker}` : `Alert me · ${ticker}`}
    </button>
  );
};

const Fact = ({ label, children, testId, tip }: { label: string; children: React.ReactNode; testId?: string; tip?: string }) => (
  <div>
    <dt className="text-[10px] text-textMuted whitespace-nowrap cursor-help" title={tip}>{label}</dt>
    <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap max-w-[22ch] truncate" data-news-fact={testId}>
      {children}
    </dd>
  </div>
);

/** A figure on the story card — label over value, the card's own smaller scale */
/* the figure wraps inside its own column — "after hours +0.2% · 10/22 −4.6%" ran under the next figure (audit round 5) */
const Figure = ({ label, tone = 'text-textPrimary', children, title }: { label: string; tone?: string; children: React.ReactNode; title?: string }) => (
  <div className="min-w-0 overflow-hidden" title={title}>
    <div className="text-[9px] text-textMuted whitespace-nowrap truncate">{label}</div>
    <div className={`mt-0.5 font-mono text-[12px] font-semibold tnum whitespace-normal break-words ${tone}`}>{children}</div>
  </div>
);

/** The odds, Down against Up — NOT keyed by story, so the split slides between stories (the v1 contract) */
const OddsBar = ({ probUp }: { probUp: number }) => (
  <div data-news-odds>
    <div className="flex items-center justify-between font-mono text-[10px] tnum">
      <span className={probUp < 50 ? 'text-bear font-semibold' : 'text-textSecondary'}>
        down <AnimatedNumber value={100 - probUp} format={v => `${Math.round(v)}%`} />
      </span>
      <span className="text-[9px] uppercase tracking-widest text-textMuted">odds next session</span>
      <span className={probUp >= 50 ? 'text-bull font-semibold' : 'text-textSecondary'}>
        up <AnimatedNumber value={probUp} format={v => `${Math.round(v)}%`} />
      </span>
    </div>
    <div className="mt-1.5 flex h-[6px] rounded-full overflow-hidden bg-ink/[0.06]">
      <span className="h-full bg-bear/80" style={{ width: `${100 - probUp}%`, transition: `width 520ms ${EASE}` }} />
      <span className="h-full bg-bull" style={{ width: `${probUp}%`, transition: `width 520ms ${EASE}` }} />
    </div>
  </div>
);

/** The story's text: the first paragraph in the open, the rest behind "Read the whole story" (the house's fold), the source's door at the end */
const StoryText = ({ storyId, body, source, url }: { storyId: string; body: string[]; source: string; url?: string }) => {
  const [whole, setWhole] = useState(false);
  /* a new story opens folded — the same element re-read, never remounted (a keyed remount left the old body standing) */
  useEffect(() => setWhole(false), [storyId]);
  if (!body.length) return null;
  const [first, ...rest] = body;
  return (
    <div className="flex flex-col gap-2" data-news-body data-news-body-open={whole || undefined}>
      <p className="text-[12.5px] leading-relaxed text-textSecondary">{first}</p>
      {rest.length > 0 && (
        <>
          <Fold axis="y" open={whole} testId="data-news-body-fold">
            <div className="flex flex-col gap-2 pb-1">
              {rest.map((para, i) => (
                <p key={i} className="text-[12.5px] leading-relaxed text-textSecondary">
                  {para}
                </p>
              ))}
            </div>
          </Fold>
          <button
            type="button"
            onClick={() => setWhole(w => !w)}
            aria-expanded={whole}
            className="self-start inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors"
            data-news-body-door
          >
            {whole ? 'Fold the story' : 'Read the whole story'}
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${whole ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="self-start inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-news-body-source>
          Read it at {source} <ArrowUpRight className="w-3 h-3" aria-hidden />
        </a>
      )}
    </div>
  );
};

const News = () => {
  const location = useLocation();
  useVendor('dossier', '', '/dossier/news');
  const navigate = useNavigate();
  const { changeTicker } = useTicker();
  const boardNames = useBoardNames();

  /* THE WIRE TICKS — stories drip in through the session; re-read every half minute */
  const [wireRev, setWireRev] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setWireRev(r => r + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const news = useNewsFeed();
  /* what the wire on the page covers: the whole day once the read has reached New York's midnight, else since when */
  const coverage = useNewsCoverage();
  const coverText = coverage.fromMs == null ? 'Reading the wire' : coverage.wholeDay ? 'Every story on the wire today' : `The wire since ${nyClock(coverage.fromMs)} ET${coverage.reading ? ', reading further back' : ''}`;
  const econ = useEconFeed();
  const events = useMemo(() => (news.status === 'live' ? news.events : []), [news, wireRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const calendar = useMemo(() => (econ.status === 'live' ? econ.events : []), [econ, wireRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const mood = useMemo(() => {
    if (news.status !== 'live' || events.length === 0) {
      return { score: 0, label: 'MIXED' as const, unmarked: true, pending: news.status === 'loading', note: news.status === 'loading' ? 'Reading the wire.' : news.status === 'sim' ? 'This read did not land — the wire did not answer, so nothing here is a quiet day.' : 'The wire came back with nothing in this window.' };
    }
    const markedFor = events.filter(e => e.grade === 'ALLY').length;
    const markedAgainst = events.filter(e => e.grade === 'THREAT').length;
    const unmarked = markedFor === 0 && markedAgainst === 0;
    if (unmarked) return { score: 0, label: 'MIXED' as const, unmarked: true, pending: false, note: `${events.length} stories on the wire. None are marked for or against a name.` };
    const weight = events.reduce((a, e) => a + e.item.magnitude, 0) || 1;
    const score = events.reduce((a, e) => a + e.item.sentiment * e.item.magnitude, 0) / weight;
    const label = score > 0.15 ? 'LEANS BULLISH' as const : score < -0.15 ? 'LEANS BEARISH' as const : 'MIXED' as const;
    const note = label === 'LEANS BULLISH' ? `${markedFor} of ${events.length} stories read for the names.` : label === 'LEANS BEARISH' ? `${markedAgainst} of ${events.length} stories read against the names.` : 'The marks cancel. Single-name stories matter more than the tape.';
    return { score, label, unmarked: false, pending: false, note };
  }, [events, news.status]);

  /* THE MOMENT — the wire's clock, re-read with it. The page is live only:
     the day's drip bar under the map, which pulled the wire and the map back
     to any minute of the session, came off on 2026-09-13 (Noah: "remove the
     replay bar"). */
  const at = useMemo(() => now(), [wireRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const insights = useMemo(() => buildRoomInsights(events), [events]);

  /* THE CARDS cut the wire; the map and the list read the same cut */
  const [category, setCategory] = useState<CategoryPick>('all');
  const [lean, setLean] = useState<LeanPick>('any');
  const [names, setNames] = useState<NamesPick>('all');
  const [sort, setSort] = useState<Sort>('matters');
  const boardSet = useMemo(() => new Set(boardNames), [boardNames]);
  const onBoard = (e: GeoNewsEvent) => (e.item.tickers ?? (e.item.ticker ? [e.item.ticker] : [])).some(t => boardSet.has(t));
  /* THE FILTER reads what the other three cards leave on the wire — every
     name and every city there, with its count — and keeps any number of them
     (Noah: "it should read whats on the current page … so user can select
     what to add"). A pick is `name:NVDA` or `city:Riyadh`; any pick matching
     keeps the row. */
  /* a name's page opens the wire on that name (2026-09-13) */
  const [picks, setPicks] = useState<string[]>(() => {
    const n = (location.state as { name?: string } | null)?.name;
    return n ? [`name:${n.toUpperCase()}`] : [];
  });
  const cut = useMemo(() => {
    const board = new Set(boardNames);
    return events.filter(e => {
      if (category !== 'all' && e.item.category !== category) return false;
      if (lean !== 'any' && e.grade !== lean) return false;
      if (names === 'board' && !(e.item.ticker && board.has(e.item.ticker))) return false;
      /* macro is the Macro beat (whalesMap categoryOf) — an unnamed company press release is not macro */
      if (names === 'macro' && (e.item.ticker || e.item.category !== 'Macro')) return false;
      return true;
    });
  }, [events, category, lean, names, boardNames]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const nameCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    cut.forEach(e => {
      const n = e.item.ticker ?? nameWord(e.item);
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      /* a story with no city of its own is on no map pin — it is not a city named "" (the ship pass: it listed as "111") */
      if (e.origin.city) cityCount.set(e.origin.city, (cityCount.get(e.origin.city) ?? 0) + 1);
    });
    /* a pick whose name has left the cut stays listed so it can be unpicked */
    picks.forEach(p => {
      const [kind, key] = p.split(':');
      if (kind === 'name' && !nameCount.has(key)) nameCount.set(key, 0);
      if (kind === 'city' && !cityCount.has(key)) cityCount.set(key, 0);
    });
    const byCountThenName = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
    return [
      {
        title: 'Names on the wire',
        options: [...nameCount.entries()].sort(byCountThenName).map(([n, c]) => ({ value: `name:${n}`, label: n, hint: n === 'MACRO' ? 'Economy and market stories with no single name' : n === 'NO NAME' ? 'Company-beat stories (earnings, deals, analysts, courts) that name no listed company the page can find' : (lookup(n)?.name ?? (companyName(n) !== n ? companyName(n) : undefined)), count: c })),
      },
      {
        title: 'Cities on the map',
        options: [...cityCount.entries()].sort(byCountThenName).map(([c, n]) => ({ value: `city:${c}`, label: c, count: n })),
      },
    ];
  }, [cut, picks]);
  const rows = useMemo(() => {
    const moveKey = (e: GeoNewsEvent): number => {
      const p = e.item.prediction;
      const v = p.measured ? p.expMove1dPct : p.lastSession ? p.lastSession.pct : p.extMovePct;
      return v == null || !Number.isFinite(v) ? -1 : Math.abs(v);
    };
    const picked = new Set(picks);
    const kept = picked.size === 0 ? cut : cut.filter(e => picked.has(`name:${nameWord(e.item)}`) || picked.has(`city:${e.origin.city}`));
    const by: Record<Sort, (a: GeoNewsEvent, b: GeoNewsEvent) => number> = {
      newest: (a, b) => a.item.minutesAgo - b.item.minutesAgo,
      matters: (a, b) => {
        /* UW's MAJOR flag is shown as the vendor's, but a routine notice it flags (a dividend declared, a results date,
           a conference slot, a tokenized listing) is not lifted up the wire for it (the re-audit, 2026-10-22) */
        /* and a press release from a company the page does not list (no ticker, the Product beat — "MiniTool
           ShadowMaker 5.0 Introduces Cloud Sync") is never lifted to lead the wire (the third audit, 2026-10-23) */
        const lifted = (e: GeoNewsEvent) => e.item.major && !ROUTINE_RE.test(e.item.headline) && !(e.item.ticker == null && e.item.category !== 'Macro');
        /* (round 9) a sport, fashion or lifestyle press release ranks last off the Board — a Bayern Munich deal and a
           fashion launch sat high on "What matters" */
        const rank = (e: GeoNewsEvent) => (onBoard(e) ? (lifted(e) ? 0 : 1) : LIFESTYLE_RE.test(e.item.headline) && e.item.category !== 'Earnings' && e.item.category !== 'M&A' ? 5 : lifted(e) ? 2 : e.item.ticker || e.item.category === 'Macro' ? 3 : 4);
        return rank(a) - rank(b) || a.item.minutesAgo - b.item.minutesAgo;
      },
      /* OVERNIGHT EVERY STORY'S SESSION MOVE IS NONE YET (audit round 5: the sort did nothing before the open) — such a
         story ranks by the last session's move it carries, the figure its row shows; a story with no move sinks */
      move: (a, b) => moveKey(b) - moveKey(a) || a.item.minutesAgo - b.item.minutesAgo,
      loud: (a, b) => b.severity - a.severity,
    };
    return [...kept].sort(by[sort]);
  
  }, [cut, picks, sort]);
  const pins = useMemo(() => clusterByCity(rows), [rows]);
  /* THE HEAT: where the cut's stories come from, each story's city weighed by how hard it lands. The per-sector
     "where it lands" zones were a fixed template, not data, and are gone (the re-audit, 2026-10-22) */
  const heat = useMemo<HeatPoint[]>(() => {
    const sum = new Map<string, HeatPoint>();
    rows.forEach(e => {
      if (!e.origin.city) return;
      const key = `${e.origin.lat},${e.origin.lng}`;
      const had = sum.get(key);
      if (had) had.w += e.severity;
      else sum.set(key, { lat: e.origin.lat, lng: e.origin.lng, w: e.severity });
    });
    return [...sum.values()];
  }, [rows]);

  /* THE STORY IN HAND — the Pulse tile's deep link opens on its story; else the first */
  const [selectedId, setSelectedId] = useState<string | null>(() => (location.state as { selectedId?: string } | null)?.selectedId ?? null);
  /* THE LEAD FOLLOWS THE ORDER until the reader picks a story (the third audit, 2026-10-23: the first story of the first
     page, before the wire and the board had landed, stayed "featured" — a MiniTool press release as MACRO · MAJOR) */
  const pickedRef = useRef(!!(location.state as { selectedId?: string } | null)?.selectedId);
  useEffect(() => {
    if (rows.length === 0) return;
    if (!pickedRef.current ? selectedId !== rows[0].id : !selectedId || !rows.some(r => r.id === selectedId)) setSelectedId(rows[0].id);
  }, [rows, selectedId]);
  const selected = rows.find(r => r.id === selectedId) ?? events.find(e => e.id === selectedId) ?? null;
  /* THE GLIDE (2026-09-13; the partner: the map should "move in a flat
     manner" from place to place): a story picked by hand — a row, a pin, a
     headline on the tape — pans the world to its city on the house curve;
     the first story of the day, picked for the reader, does not move it */
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  /* the open row stays in the window: a pick from the tape or the map lands below the fold otherwise */
  const rowsRef = useRef<HTMLDivElement | null>(null);
  /* ON A PHONE THE WIRE STACKS (the owner's call, 2026-10-22): the seven-column table scrolled sideways and the headline —
     the reason anyone opens the page — started off-screen. Below 640 each story is the headline first, its facts under it */
  const stacked = useMediaQuery('(max-width: 639.98px)');
  useEffect(() => {
    keepInWindow(rowsRef.current, selectedId ? `[data-news-row="${selectedId}"]` : null);
  }, [selectedId]);
  const pick = (e: GeoNewsEvent) => {
    pickedRef.current = true;
    setSelectedId(e.id);
    if (e.origin.city) setFlyTo({ lng: e.origin.lng, lat: e.origin.lat, key: `${e.id}:${Date.now()}` });
  };
  /* THE TAPE — the newest headlines on the cut crossing the top of the map,
     whatever the sort (the partner: "no section for all news… I don't see
     any headlines whatsoever" — the rows sat under the fold) */
  const tape = useMemo(() => [...rows].sort((a, b) => a.item.minutesAgo - b.item.minutesAgo).slice(0, 14), [rows]);
  const reach = useMemo<Reach | null>(() => (selected ? { lat: selected.origin.lat, lng: selected.origin.lng, city: selected.origin.city, zones: [] } : null), [selected]);
  const sessionsOpen = useMemo(() => openSessions(at), [at]);
  /* nothing open (a night, a weekend): which market opens next and how long until it, so the read line never just says "no" */
  const nextUp = useMemo(() => (sessionsOpen.length ? null : nextOpen(at)), [sessionsOpen, at]);
  const untilWords = (ms: number) => {
    const m = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(m / 60);
    return h ? `${h}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;
  };
  const [hoverCity, setHoverCity] = useState<CityPing | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* THE FACTS */
  const positive = rows.filter(r => r.grade === 'ALLY').length;
  const negative = rows.filter(r => r.grade === 'THREAT').length;
  /* BIGGEST MOVE TODAY, OVER A COMPLETE, STATED SET (the fourth audit, 2026-10-23: "NVDA −4.4% · 3 of 86 read" while
     META −6.98% and AMD −8.10% had stories — the set was read a quote at a time and named before it was in). The set is
     every name today's stories are about, read in bulk off the screener for its regular-session change
     (data/liveQuote.ts useSetMoves), and the figure is given only once the whole set has answered. */
  const moveNames = useMemo(() => {
    if (coverage.reading) return [] as string[];
    const set = new Set<string>();
    for (const e of events) {
      if (e.item.ticker) set.add(e.item.ticker);
      for (const t of e.item.tickers ?? []) set.add(t);
    }
    return [...set].sort();
  }, [events, coverage.reading]);
  const setMoves = useSetMoves(moveNames);
  /* NO PROVISIONAL LEADER (audit round 10: "CBOE +3.8% · so far, of 10 names" stood ~20s, then "CNDT +17.8% · of 50
     names") — the chip names a leader only once the day's whole set is read, and counts the read until then */
  const namesSoFar = useMemo(() => {
    const set = new Set<string>();
    for (const e of events) {
      if (e.item.ticker) set.add(e.item.ticker);
      for (const t of e.item.tickers ?? []) set.add(t);
    }
    return set.size;
  }, [events]);
  const leaderOf = (m: typeof setMoves) => {
    let top: { ticker: string; pct: number; date: string } | null = null;
    for (const [t, q] of m.moves) {
      if (!top || Math.abs(q.pct) > Math.abs(top.pct) || (Math.abs(q.pct) === Math.abs(top.pct) && t < top.ticker)) top = { ticker: t, pct: q.pct, date: q.date };
    }
    return top;
  };
  const biggest = useMemo(() => (setMoves.complete ? leaderOf(setMoves) : null), [setMoves]); // eslint-disable-line react-hooks/exhaustive-deps
  const moveDayIsToday = biggest ? biggest.date === nyTodayIso() : true;
  const selectedQuote = useLiveQuote(selected?.item.ticker ?? null);
  const nextPrint = calendar.find(c => c.impact === 'high' && c.inMinutes >= 0) ?? calendar.find(c => c.inMinutes >= 0) ?? null;
  /* THE NEXT PRINT IS AN EARNINGS ONE TOO (round 8: "nothing ahead on the calendar" while the earnings calendar listed
     RCBC after today's close and ~710 reports next week): with no economic release ahead, the next report still to come
     on the fortnight's lists — read once the calendar below asks for them, after the headlines */
  const reportsQ = useNearReports();
  const nextReport = useMemo(() => {
    const today = nyTodayIso();
    const ahead = reportsQ.events.filter(e => !e.reported && (e.iso ?? '') >= today);
    if (!ahead.length) return null;
    const order = (e: (typeof ahead)[number]) => `${e.iso}|${e.slot === 'BMO' && e.timeKnown !== false ? 0 : 1}`;
    const first = [...ahead].sort((a, b) => order(a).localeCompare(order(b)) || Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0))[0];
    const same = ahead.filter(e => order(e) === order(first)).length;
    return { e: first, same, total: ahead.length, today: first.iso === today, scope: reportsQ.fortnight ? "on the fortnight's lists" : 'today and next session' };
  }, [reportsQ]);
  const unmarked = positive === 0 && negative === 0;
  const moodInk = mood.label === 'LEANS BULLISH' ? 'text-bull' : mood.label === 'LEANS BEARISH' ? 'text-bear' : 'text-textPrimary';

  const openName = (t: string) => {
    changeTicker(t);
    navigate('/pinpoint/map');
  };

  /* THE KIND PILLS, drawn twice: in the cluster over the map from tablet width, and on a rail above the map on a phone
     (Noah, 2026-10-19: "the buttons over the map on dossier is just covering the actual chart") */
  const kindPills = CATEGORY_OPTIONS.map(o => {
      const on = o.value === category;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => setCategory(o.value)}
          aria-pressed={on}
          title={o.hint}
          /* the silver SURFACE, not the silver ink (2026-09-16): on paper the ink is a deep steel and black on it was 2.4:1 */
          className={`shrink-0 h-6 px-3 rounded-full font-mono text-[10px] tracking-wide transition-colors ${on ? 'bg-silverFill text-[#0a0a0a] font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
          data-news-kind={o.value}
        >
          {o.label}
        </button>
      );
    });
  return (
    <>
      {/* BOX 1 — THE WIRE */}
      <div className="relative border border-borderSubtle rounded-md bg-panel" data-news data-news-wire>
        <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the wire" testId="news-guide" viewport>
          <NewsGuide />
        </GuideFocus>
        {/* THE HEAD */}
        <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
          <div className="min-w-[min(18rem,100%)] flex-1">
            <div className="h-6 flex items-center gap-3">
              <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">The wire</h3>
              <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the pins, the flags and the numbers mean" testId="news-guide" />
            </div>
            <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate" data-news-coverage>{coverText} · a pin on every city a story comes from · click a pin or a row and the story opens beside the map</p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Fact label="Stories" testId="stories" tip="Headlines on the wire after the cards and the filter">
              {news.status === 'loading' && rows.length === 0 ? (
                <span className="text-textMuted">Reading</span>
              ) : news.status === 'sim' ? (
                <span className="text-textMuted">—</span>
              ) : (
                <>
                  {rows.length.toLocaleString('en-US')}
                  {!unmarked && <span className="text-textMuted"> · {positive} positive · {negative} negative</span>}
                </>
              )}
            </Fact>
            {mood.unmarked ? (
              <>
                <Fact label="Major" testId="major" tip="Headlines Unusual Whales flags as major">
                  {news.status === 'loading' && rows.length === 0 ? <span className="text-textMuted">Reading</span> : news.status === 'sim' ? <span className="text-textMuted">—</span> : rows.filter(r => r.item.major).length}
                </Fact>
                <Fact label="On your Board" testId="board" tip="Headlines that name a stock on your Board">
                  {news.status === 'loading' && rows.length === 0 ? <span className="text-textMuted">Reading</span> : news.status === 'sim' ? <span className="text-textMuted">—</span> : rows.filter(onBoard).length}
                </Fact>
              </>
            ) : (
              <Fact label="The wire leans" testId="mood" tip="The vendor's own positive and negative marks, weighed">
                <span className={moodInk}>{mood.pending ? 'reading' : news.status === 'sim' ? '—' : mood.label === 'LEANS BULLISH' ? 'bullish' : mood.label === 'LEANS BEARISH' ? 'bearish' : 'mixed'}</span>
              </Fact>
            )}
            <Fact label={biggest && !moveDayIsToday ? `Biggest move · ${shortDay(biggest.date)}` : 'Biggest move today'} testId="biggest" tip={`The regular session's change${biggest && !moveDayIsToday ? ` on ${shortDay(biggest.date)}, the last session` : ''} — not the move when the story crossed — over every name today's stories are about (${moveNames.length} names, read in bulk off the screener; the regular close is each name's daily row — ${setMoves.moves.size} read, the other ${Math.max(0, setMoves.screened - setMoves.moves.size)} ruled out because their whole session range sits inside the leader's move)`}>
              {coverage.reading ? (
                <span className="text-textMuted">reading today's stories{namesSoFar ? ` · ${namesSoFar} names so far` : ''}</span>
              ) : biggest ? (
                <>
                  {biggest.ticker} <span className={biggest.pct >= 0 ? 'text-bull' : 'text-bear'}>{signed(biggest.pct)}</span>
                  <span className="text-textMuted"> · of {setMoves.screened} {setMoves.screened === 1 ? "name" : "names"}</span>
                </>
              ) : (
                <span className="text-textMuted">{moveNames.length ? (setMoves.complete ? 'no regular close on these names' : `reading ${Math.min(setMoves.screened, moveNames.length)} of ${moveNames.length} names`) : 'no named stories yet'}</span>
              )}
            </Fact>
            <Fact label="Next print" testId="next" tip="The next economic release on the calendar — today's or a later day's, the high-impact ones first; with none ahead, the next earnings report">
              {nextPrint ? (
                <>
                  {nextPrint.title} <span className={nextPrint.inMinutes < 90 ? 'text-warn' : 'text-textMuted'}>· {nextPrint.dayLabel} {nextPrint.timeLabel} ET · in {nextPrint.inMinutes < 60 ? `${nextPrint.inMinutes}m` : `${Math.floor(nextPrint.inMinutes / 60)}h ${nextPrint.inMinutes % 60}m`}</span>
                </>
              ) : (
                nextReport ? (
                  <span title={`No economic release is ahead on the calendar; the next earnings report still to come — ${nextReport.total.toLocaleString('en-US')} ${nextReport.scope}`} data-news-next="earnings">
                    {nextReport.e.ticker} reports{nextReport.same > 1 ? <span className="text-textMuted"> +{nextReport.same - 1}</span> : null}{' '}
                    <span className="text-textMuted">
                      · {nextReport.e.timeKnown === false ? 'time not set' : nextReport.e.slot === 'BMO' ? 'before the open' : 'after the close'} {nextReport.today ? 'today' : nextReport.e.dateLabel} · {nextReport.total.toLocaleString('en-US')} reports ahead{reportsQ.fortnight ? '' : ' by next session'}
                    </span>
                  </span>
                ) : (
                  <span className="text-textMuted">{econ.status === 'loading' || reportsQ.status === 'loading' ? 'reading the calendar' : econ.status === 'sim' && reportsQ.status === 'sim' ? 'the calendar did not answer' : 'nothing ahead on the calendar'}</span>
                )
              )}
            </Fact>
          </dl>
        </div>
        {/* THE ONE LINE OF CONTROLS */}
        {/* on a phone the line is a grid of equal cells, the Trace box's own (2026-10-19) — the legend takes a row */}
        <div className={`px-5 pb-3 ${CONTROLS_LINE}`} data-news-controls>
          {!unmarked && <DropdownSelect label="Lean" value={lean} options={LEAN_OPTIONS} onChange={setLean} title="Which way the story reads for the name" testId="news-lean" />}
          <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Whose stories" testId="news-names" />
          <DropdownSelect label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} title="The order of the wire" testId="news-sort" />
          <HeatLegend className="ml-2" />
          <div className="ml-auto" title="The names and cities on the wire right now — tick any number; the map and the list keep only those">
            <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="Keep only these" testId="news-filter" />
          </div>
        </div>

        {/* THE MAP AND THE STORY. The map keeps one shape — 4:3 standing up, 16:9 lying down —
            and never grows into a ribbon when the window is wide. The story sits beside it
            once the row has room, and under it when it does not. */}
        <div className="grid border-t border-borderSubtle grid-cols-1 lg:grid-cols-[minmax(0,860px)_minmax(280px,1fr)]" data-news-band>
          <div className="min-w-0 flex flex-col border-r border-borderSubtle max-lg:border-r-0 max-lg:border-b overflow-hidden">
            <NewsTape tape={tape} selectedId={selectedId} onPick={pick} />
            <div className="flex flex-col items-center gap-2 px-2 pt-2 pb-2">
              <div className="sm:hidden w-full shrink-0 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0" role="group" aria-label="What kind of story" data-news-kinds-rail={category}>
                {kindPills}
              </div>
              <div className="relative w-full" data-news-stage>
                <NewsMap className="absolute inset-0" pins={pins} selectedCity={selected?.origin.city ?? null} hoverCity={hoverCity?.city ?? null} onPick={p => { const e = rows.find(r => r.id === p.topId) ?? events.find(r => r.id === p.topId); if (e) pick(e); else setSelectedId(p.topId); }} onHover={setHoverCity} heat={heat} reach={reach} at={at} flyTo={flyTo} />
              </div>
              <div className="max-sm:hidden w-full flex justify-center" data-news-kinds={category}>
                <div className="inline-flex max-w-full items-center gap-1 p-1 rounded-full border border-borderSubtle bg-chip/90 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="What kind of story">
                  {kindPills}
                </div>
              </div>
            </div>
            <div className="px-4 min-h-[26px] py-1 border-t border-ink/[0.06] flex items-center gap-3 font-mono text-[10px] text-textSecondary whitespace-normal" data-news-map-read>
              {hoverCity ? (
                <>
                  <span className="font-bold text-textPrimary">{hoverCity.city}</span>
                  <span>
                    {hoverCity.n} {hoverCity.n === 1 ? 'story' : 'stories'}
                    {hoverCity.threats > 0 && <span className="text-bear"> · {hoverCity.threats} negative</span>}
                    {hoverCity.allies > 0 && <span className="text-bull"> · {hoverCity.allies} positive</span>}
                  </span>
                  <span className="text-textMuted break-words leading-relaxed">· {hoverCity.topHeadline}</span>
                  <span className="ml-auto text-textMuted">click for its loudest story</span>
                </>
              ) : (
                <>
                  <span className="text-textMuted break-words whitespace-normal leading-relaxed">
                    {pins.length} {pins.length === 1 ? 'city' : 'cities'} · the land warms where the news lands · the arcs are where the open story reaches · scroll to zoom, pull to pan
                  </span>
                  <span className="ml-auto shrink-0" data-news-session-read>
                    {sessionsOpen.length ? (
                      <>
                        <span className="text-silver">{sessionsOpen.map(s => s.label).join(', ')}</span> <span className="text-textMuted">open</span>
                      </>
                    ) : (
                      <span className="text-textMuted">
                        no cash session open
                        {nextUp && (
                          <>
                            {' · '}
                            <span className="text-textSecondary">{nextUp.session.label}</span> opens in {untilWords(nextUp.at.getTime() - at.getTime())}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* THE STORY IN HAND */}
          <div className="min-w-0 px-4 pt-3 pb-3 flex flex-col gap-3 overflow-y-auto lg:max-h-[min(70vh,640px)]" data-news-story={selected?.id}>
            {selected ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.item.ticker ? (
                    <button type="button" onClick={() => openName(selected.item.ticker!)} className="inline-flex items-center gap-1.5 group" title={`Open ${selected.item.ticker} on the Map`}>
                      <CompanyLogo ticker={selected.item.ticker} size={16} />
                      <span className="font-mono text-[12px] font-bold text-textPrimary group-hover:underline underline-offset-2">{selected.item.ticker}</span>
                    </button>
                  ) : (
                    <span className="font-mono text-[12px] font-bold text-textPrimary">{nameWord(selected.item)}</span>
                  )}
                  <NewsFlag major={selected.item.major} onBoard={onBoard(selected)} lean={leanOf(selected.grade)} />
                  <CatTag category={selected.item.category} size={9} />
                  <span className="ml-auto font-mono text-[9px] text-textMuted whitespace-nowrap">
                    {selected.item.source} · {ago(selected.item.minutesAgo)}
                  </span>
                </div>
                <p className="text-[13px] leading-snug text-textPrimary" data-news-headline>
                  {selected.item.headline}
                </p>
                {/* THE STORY (Noah, 2026-09-28: "some users actually want to read the story") — its opening paragraph, the
                    rest behind one door that unfolds in place, and the way to the source when the provider gives one */}
                <StoryText storyId={selected.id} body={selected.item.body} source={selected.item.source} url={selected.item.url} />
                {/* the impact, as a meter, in the grade's ink */}
                <div>
                  <div className="flex items-center justify-between text-[9px] text-textMuted">
                    <span className="inline-flex items-center gap-1.5">
                      <ImpactMark tier={tierOf(selected.severity)} />
                      <span>
                        Lands <span className="text-textSecondary">{severityWord(selected.severity)}</span>
                        {selected.origin.city ? <> · from <span className="text-textSecondary">{selected.origin.city}</span></> : null}
                      </span>
                    </span>
                    <span>{freshnessOf(selected)}</span>
                  </div>
                  <div className="mt-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
                    <span className={`block h-full rounded-full ${GRADE_BAR[selected.grade]}`} style={{ width: `${selected.severity * 10}%`, transition: `width 520ms ${EASE}` }} />
                  </div>
                </div>
                {/* THE NUMBERS — how the named stock has traded today */}
                <div className="grid grid-cols-2 gap-3" data-news-numbers>
                  <Figure label="Move at publish" title="The named stock's regular-session move when the story crossed, the pre-market or after-hours move apart — a snapshot, not now">
                    <PublishMove p={selected.item.prediction} />
                  </Figure>
                  {selected.item.ticker ? (
                    selectedQuote?.phase === 'pre' && selectedQuote.lastSessionPct != null ? (
                      <Figure label={`Last session${selectedQuote.regDate ? ` · ${shortDay(selectedQuote.regDate)}` : ''}`} title={`Before the open: the last regular session's change${extendedLine(selectedQuote) ? ` · ${extendedLine(selectedQuote)}, kept apart` : ''}`} tone={selectedQuote.lastSessionPct >= 0 ? 'text-bull' : 'text-bear'}>
                        {signed(selectedQuote.lastSessionPct)}
                      </Figure>
                    ) : (
                      <Figure label={selectedQuote && selectedQuote.phase !== 'regular' ? 'The session' : 'Today'} title={`The regular session's change${extendedLine(selectedQuote) ? ` · ${extendedLine(selectedQuote)}, kept apart` : ''}`} tone={selectedQuote ? (selectedQuote.changePct >= 0 ? 'text-bull' : 'text-bear') : 'text-textMuted'}>
                        {selectedQuote ? signed(selectedQuote.changePct) : '—'}
                      </Figure>
                    )
                  ) : null}
                </div>
                {selected.item.prediction.playbook ? (
                <div key={selected.id} className="flex flex-col gap-2 animate-soft-in text-[11.5px] leading-relaxed text-textSecondary">
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-textMuted">At publish</div>
                    <p className="mt-0.5">
                      <RichRead text={selected.item.prediction.playbook} />
                    </p>
                  </div>
                </div>
                ) : null}
                {/* THE DOORS — a macro story has no name of its own, so its door is the index */}
                <div className="mt-auto pt-2 border-t border-ink/[0.06] flex items-center gap-2 flex-wrap" data-news-doors>
                  {selected.item.ticker ? (
                    <>
                      <Door onClick={() => openName(selected.item.ticker!)}>
                        The Map
                      </Door>
                      <Door onClick={() => navigate('/weigher', { state: { weigh: { ticker: selected.item.ticker } } })}>
                        Weigh it
                      </Door>
                      <Door onClick={() => navigate('/compass', { state: { tickerFilter: selected.item.ticker } })}>
                        Compass
                      </Door>
                      {selected.item.category === 'Earnings' && <Door onClick={() => navigate(`/dossier/earnings/${selected.item.ticker}`)}>Earnings</Door>}
                      <NewsAlertDoor ticker={selected.item.ticker} />
                    </>
                  ) : (
                    <>
                      <Door onClick={() => openName('SPY')}>
                        SPY on the Map
                      </Door>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{news.status === 'loading' || coverage.reading ? 'Reading the wire' : news.status === 'sim' ? 'This read did not land' : 'Nothing on the wire for these cards'}</div>
            )}
          </div>
        </div>

        {/* THE ROWS — every story on the cut, in the chosen order */}
        {/* Below lg the rows scroll sideways inside their box at a readable width (the phone pass, 2026-09-13) */}
        {/* THE WIRE SCROLLS INSIDE ITS BOX past twenty rows (Noah, 2026-10-13, on the vendor feed: "it goes on forever"):
            a window of NEWS_WINDOW_H, the column head pinned at its top, the read line under it where it always was — the
            one list in the house that keeps a window (grids grow, the Compass board rule of 2026-09-11), because a day
            of the wire is hundreds of rows and the box is one of three on the page */}
        <div ref={rowsRef} className={`relative border-t border-borderSubtle overflow-y-auto overscroll-contain ${stacked ? '' : 'max-lg:overflow-x-auto'}`} style={{ maxHeight: NEWS_WINDOW_H }} data-news-rows data-news-window={rows.length > NEWS_WINDOW_ROWS || undefined} data-news-stacked={stacked || undefined}>
          {!stacked && <div className="sticky top-0 z-10 bg-panel px-5 h-[22px] grid items-center gap-x-3 text-[9px] uppercase tracking-widest text-textMuted max-lg:min-w-[900px]" style={{ gridTemplateColumns: '72px 104px 96px 72px minmax(0, 1fr) 76px 72px' }}>
            <span title="When the headline crossed, New York time">Time</span>
            <span title="The first stock the headline names — the wire's tag, or the listed company the headline names; MACRO for a story about the economy, markets, policy or the world that names none; NO NAME for a company-beat story that names no listed company">Name</span>
            <span title="What sort of story it is, read from the headline">Kind</span>
            <span title={NEWS_FLAG_TIP}>Flag</span>
            <span className="flex items-center gap-4">
              <span>Headline</span>
              {/* the legend sits under the cards line on a narrow page (the head's column has no room for it) */}
              <span className="max-lg:hidden">
                <ImpactLegend />
              </span>
            </span>
            <span className="text-right" title="How the named stock had moved on the session when the story crossed — a snapshot at publish, not today's move now">At publish</span>
            <span className="text-right" title="The other stocks the headline names">Also</span>
          </div>}
          {rows.length === 0 && <div className="px-5 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{news.status === 'loading' || coverage.reading ? 'Reading the wire' : news.status === 'sim' ? 'This read did not land' : 'Nothing on the tape for these cards'}</div>}
          {rows.map(e => {
            const open = e.id === selectedId;
            const faded = freshnessOf(e) === 'faded';
            if (stacked) {
              const move = e.item.prediction.measured ? e.item.prediction.expMove1dPct : null;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => pick(e)}
                  className={`group w-full text-left px-4 py-2.5 flex flex-col gap-1 border-t border-borderSubtle/40 transition-colors ${open ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.05]'} ${faded && !open ? 'opacity-60' : ''}`}
                  data-news-row={e.id}
                  data-open={open || undefined}
                >
                  <span className="flex items-start gap-2 min-w-0">
                    <span className="mt-[5px] shrink-0">
                      <ImpactMark tier={tierOf(e.severity)} />
                    </span>
                    <span className={`min-w-0 line-clamp-2 text-[12.5px] leading-snug ${open ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'} transition-colors`}>{e.item.headline}</span>
                  </span>
                  <span className="min-w-0 flex items-center gap-1.5 font-mono text-[10px] text-textMuted whitespace-nowrap overflow-hidden">
                    <span className="tnum text-textSecondary">{e.item.time}</span>
                    <span>·</span>
                    {e.item.ticker ? (
                      <span className="inline-flex items-center gap-1 font-bold text-textPrimary">
                        <CompanyLogo ticker={e.item.ticker} size={12} />
                        {e.item.ticker}
                      </span>
                    ) : (
                      <span className="text-textSecondary">{storyNameWord(e.item)}</span>
                    )}
                    <span>·</span>
                    <CatTag category={e.item.category} size={9} />
                    {(e.item.major || onBoard(e) || leanOf(e.grade)) && <NewsFlag major={e.item.major} onBoard={onBoard(e)} lean={leanOf(e.grade)} />}
                    {(move != null || e.item.prediction.extMovePct != null || e.item.prediction.lastSession) && <span className="ml-auto tnum font-semibold"><PublishMove p={e.item.prediction} short /> <span className="font-normal text-textMuted">at publish</span></span>}
                  </span>
                </button>
              );
            }
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => pick(e)}
                className={`group w-full text-left px-5 py-2 grid items-start gap-x-3 border-t border-borderSubtle/40 transition-colors max-lg:min-w-[900px] ${open ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.05]'} ${faded && !open ? 'opacity-60' : ''}`}
                style={{ minHeight: NEWS_ROW_H, gridTemplateColumns: '72px 104px 96px 72px minmax(0, 1fr) 76px 72px' }}
                data-news-row={e.id}
                data-open={open || undefined}
              >
                <span className="h-5 flex items-center font-mono text-[10px] tnum text-textSecondary">{e.item.time}</span>
                <span className="min-w-0 h-5 inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-textPrimary">
                  {e.item.ticker ? (
                    <>
                      <CompanyLogo ticker={e.item.ticker} size={14} />
                      {e.item.ticker}
                    </>
                  ) : (
                    <span className="text-textSecondary">{storyNameWord(e.item)}</span>
                  )}
                </span>
                <span className="min-w-0 h-5 flex items-center">
                  <CatTag category={e.item.category} size={9} />
                </span>
                <span className="h-5 flex items-center"><NewsFlag major={e.item.major} onBoard={onBoard(e)} lean={leanOf(e.grade)} /></span>
                <span className="min-w-0 flex items-center gap-2">
                  <ImpactMark tier={tierOf(e.severity)} />
                  <span className={`min-w-0 break-words whitespace-normal leading-relaxed text-[12px] ${open ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'} transition-colors`}>{e.item.headline}</span>
                </span>
                <span className="h-5 flex items-center justify-end font-mono text-[11px] font-semibold tnum whitespace-nowrap"><PublishMove p={e.item.prediction} short /></span>
                <span className="h-5 flex items-center justify-end font-mono text-[10px] text-textSecondary truncate" data-news-row-also title={(e.item.tickers ?? []).slice(1).join(', ') || undefined}>
                  {(e.item.tickers ?? []).length > 1 ? `${e.item.tickers![1]}${e.item.tickers!.length > 2 ? ` +${e.item.tickers!.length - 2}` : ''}` : '—'}
                </span>
              </button>
            );
          })}
        </div>
        <p className="px-5 pb-4 pt-3 border-t border-borderSubtle/40 text-[12px] leading-relaxed text-textSecondary" data-news-sentence>
          <RichRead text={mood.note} />
        </p>
      </div>

      {/* BOX 2 — ALL NEWS: every headline as a feed with tabs, and the names you follow (the partner's box, ported 2026-09-13) */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-news-all>
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">All news</h3>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">The same wire as above, a tab per kind — it opens on the earnings stories; All repeats the list above · follow a name and ring the bell on it · a click opens the story beside the map</p>
        </div>
        <div className="border-t border-borderSubtle">
          <NewsFeedTabs events={events} calendar={calendar} selectedId={selectedId} onPick={pick} wire={news.status === 'loading' || coverage.reading ? 'reading' : news.status === 'sim' ? 'failed' : 'read'} />
        </div>
      </div>

      {/* BOX 3 — THE DAY: the month on the record beside the day in hand (the partner's, ported 2026-09-13), and what the wire adds up to */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-news-day>
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">The day</h3>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">The month — data, earnings, the FDA, the public schedule, the posts — and what the wire adds up to</p>
        </div>
        <div className="border-t border-borderSubtle">
          {/* HEADLINES FIRST (round 8: the fortnight's 23 earnings lists, the FDA calendar and the posts were asked before the
              first page of headlines, which then landed ~12s in) — the month is read once the wire's first page is in */}
          {news.status === 'loading' ? (
            <div className="px-5 py-8 font-mono text-[10px] uppercase tracking-widest text-textMuted animate-pulse" data-news-day-pending>
              Reading the month after the headlines…
            </div>
          ) : (
            <NewsCalendar />
          )}
        </div>
        {/* THE READS — across, under the month, however many the wire adds up to */}
        {/* on a phone the reads stack two by two — four across left each a word to a line (the Dossier sweep, 2026-10-22) */}
        <div className="grid border-t border-borderSubtle max-md:!grid-cols-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, insights.length)}, minmax(0, 1fr))` }} data-news-reads>
          {insights.map((i, k) => (
            <div key={i.key} className={`px-5 py-3 ${k > 0 ? 'border-l border-borderSubtle/40' : ''} max-md:border-l-0 max-md:[&:nth-child(even)]:border-l max-md:[&:nth-child(n+3)]:border-t max-md:border-borderSubtle/40`} data-news-read={i.key}>
              <div className={`text-[10px] font-semibold uppercase tracking-widest ${i.ink === 'bull' ? 'text-bull' : i.ink === 'bear' ? 'text-bear' : 'text-textPrimary'}`}>{i.title}</div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-textPrimary/85">
                <RichRead text={i.read} />
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

export default News;
