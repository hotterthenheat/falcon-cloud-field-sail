/* The wire: the head's facts, one line of controls, the story list with the story in hand beside it, the map under
   them (loaded once near the screen), then every headline by kind and the day's calendar. */

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
import { RecordHead } from '../../components/record/RecordFrame';
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
import { buildRoomInsights, clusterByCity, freshnessOf, severityWord, type CityPing, type GeoNewsEvent } from '../../data/newsroom';
import { useEconFeed, useNewsCoverage, useNewsFeed } from '../../data/liveRecord';
import { nyClock } from '../../core/nyTime';
import { ImpactLegend, ImpactMark, NEWS_FLAG_TIP, NewsFlag, tierOf } from '../../components/record/impactMark';
import NewsFeedTabs, { keepInWindow, nameWord } from '../../components/record/NewsFeedTabs';
import NewsCalendar from '../../components/record/NewsCalendar';
import { useMediaQuery } from '../../components/ui/useMediaQuery';
import { NEWS_ROW_H, NEWS_WINDOW_H, NEWS_WINDOW_ROWS } from './recordSkeletons';
import { signedPct } from './money';
import { Door, Fact as RecordFact, ago } from '../../components/record/ui';

const Fact = (p: Omit<Parameters<typeof RecordFact>[0], 'scope'>) => <RecordFact scope="news" {...p} />;

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

type CategoryPick = 'all' | NewsCategory;
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
const NAMES_OPTIONS: DropdownOption<NamesPick>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'Every story on the wire' },
  { value: 'board', label: 'Your board', hint: 'Stories on the names on your Board' },
  { value: 'macro', label: 'Macro only', hint: 'The economy, the Fed, markets and policy — stories with no company as their subject' },
];
/* beside the story card (lg to 2xl) the rows drop the kind and also columns so the headline keeps its width */
const BAND_COLS = 'grid-cols-[72px_104px_96px_72px_minmax(0,1fr)_76px_72px] lg:max-2xl:grid-cols-[60px_92px_64px_minmax(0,1fr)_72px]';
const SORT_OPTIONS: DropdownOption<Sort>[] = [
  { value: 'matters', label: 'What matters', hint: 'Major stories on your Board first, then your Board, other major stories, named stocks, the rest; newest first in each' },
  { value: 'newest', label: 'Newest', hint: 'The latest story first' },
  { value: 'move', label: 'Biggest move', hint: 'The named stock that had moved most when its story crossed, first' },
  { value: 'loud', label: 'Loudest', hint: 'Major stories and big movers first' },
];

/* sport, fashion and lifestyle — press releases that are not market news */
const LIFESTYLE_RE = /\b(?:fc|football|soccer|bundesliga|premier league|la liga|serie a|champions league|world cup|nba|nfl|mlb|nhl|wnba|formula (?:1|one)|f1|grand prix|nascar|olympics?|tennis|golf|pga|ufc|esports?|stadium|jersey|kit sponsor|bayern|real madrid|barcelona|manchester united|fashion|runway|couture|apparel collection|capsule collection|handbags?|sneakers?|fragrance|cosmetics|skincare|beauty|lifestyle|wellness|recipes?|celebrity|red carpet|film festival|concert|album|music video|call of duty|modern warfare)\b/i;

/* Not lifted whatever the flag: a preview is not a result, a product release is not the lead, and on the Macro beat only
   the hard economy (the Fed, the data, rates, the indexes) leads. */
const PREVIEW_RE = /\b(?:to focus on|what to expect|preview|ahead of (?:its |the )?(?:earnings|results|report)|earnings (?:preview|report to)|expected to report|will report|set to report|things to watch|to watch)\b/i;
const HARD_MACRO_RE = /\b(?:fed|fomc|powell|cpi|ppi|pce|inflation|gdp|payrolls?|jobs report|jobless claims|unemployment|rate (?:cut|hike|decision)s?|interest rates?|treasury yields?|central bank|ecb|boj|boe|recession|s&p 500|nasdaq|dow jones|stock futures|government shutdown|debt ceiling)\b/i;
const LIFT_BEATS = new Set(['Earnings', 'M&A', 'Guidance', 'Analyst', 'Regulatory']);
/* Near-duplicates are one story: two headlines within six hours whose significant words overlap 60%+ fold into the
   newest, which carries "+N similar". */
const DUP_STOP = new Set(['that', 'with', 'from', 'this', 'have', 'will', 'over', 'into', 'after', 'about', 'says', 'said', 'amid', 'than', 'their', 'more', 'year', 'week', 'first', 'news', 'update', 'report', 'reports']);
const dupWords = (h: string): Set<string> => new Set(h.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 4 && !DUP_STOP.has(w)));
const dupClose = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size < 3 || b.size < 3) return false;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / Math.min(a.size, b.size) >= 0.6 && both >= 3;
};

/* The tape: the newest headlines on the cut in a seamless loop over the map. It runs one loop and rests, holds still
   under the pointer, can be pulled by wheel or drag, steps with its arrows, and stands still under reduced motion. */
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

  /* the loop's controls, for the handlers outside it: `settle` stops a running drift where it stands (into xRef),
     `kick` runs the frame loop for a glide, a pull or a wheel, and `resume` lets the drift go on if nothing holds it */
  const loopRef = useRef<{ settle: () => void; kick: () => void; resume: () => void } | null>(null);

  /* The drift runs on the compositor (a linear Web Animation of the strip's transform), so the page draws no frames of
     its own while the tape slides; the frame loop runs only while a step glides or a hand pulls. The drift pauses
     while the tape is off screen or the tab is hidden, and rests after one loop. */
  useEffect(() => {
    const strip = stripRef.current;
    const half = halfRef.current;
    const box = boxRef.current;
    if (!strip || !half) return;
    const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let last = 0;
    /* the half's width is read on resize, not per frame, so nothing here forces a layout */
    let halfW = 0;
    /* how far the tape has drifted on its own; it rests after one loop */
    let drifted = 0;
    let drift: Animation | null = null;
    let driftFrom = 0;
    let driftLen = 0;
    let driftMs = 1;
    let onScreen = true;
    const tx = (x: number) => `translate3d(${x.toFixed(2)}px,0,0)`;
    const paint = (x: number) => {
      strip.style.transform = tx(x);
    };
    /* the two halves are identical, so a half's width is a full turn: x stays in (−halfW, 0] */
    const wrap = (x: number) => {
      if (halfW <= 0) return x;
      let r = x % halfW;
      if (r > 0) r -= halfW;
      return r === 0 ? 0 : r;
    };
    const settle = () => {
      if (!drift) return;
      const t = drift.currentTime;
      const moved = Math.min(driftLen, Math.max(0, ((typeof t === 'number' ? t : 0) / driftMs) * driftLen));
      drifted += moved;
      xRef.current = wrap(driftFrom - moved);
      paint(xRef.current);
      const a = drift;
      drift = null;
      a.cancel();
    };
    const resume = () => {
      if (drift || raf || still || halfW <= 0 || drifted >= halfW - 0.5 || !onScreen || document.hidden) return;
      const h = holdRef.current;
      if (h.hover || h.focus || h.drag || targetRef.current != null || typeof strip.animate !== 'function') return;
      const x0 = xRef.current;
      const len = halfW - drifted;
      const end = x0 - len;
      /* past one half the strip jumps back a half, unseen, as the frame loop's wrap did */
      const k = (x0 + halfW) / len;
      const frames: Keyframe[] =
        end > -halfW
          ? [{ transform: tx(x0) }, { transform: tx(end) }]
          : [{ transform: tx(x0), offset: 0 }, { transform: tx(-halfW), offset: k }, { transform: tx(0), offset: k }, { transform: tx(end + halfW), offset: 1 }];
      driftFrom = x0;
      driftLen = len;
      driftMs = (len / halfW) * TAPE_SECONDS_PER_LOOP * 1000;
      const a = strip.animate(frames, { duration: driftMs, easing: 'linear', fill: 'forwards' });
      drift = a;
      a.onfinish = () => {
        if (drift === a) settle();
      };
    };
    const frame = (ts: number) => {
      const dt = last ? Math.min(64, ts - last) : 16;
      last = ts;
      let x = xRef.current;
      const target = targetRef.current;
      if (target != null) {
        x += (target - x) * (1 - Math.exp(-dt / 90));
        if (Math.abs(target - x) < 0.5) {
          x = target;
          targetRef.current = null;
        }
      }
      /* the loop: the two halves are identical, so a half's width is a full turn */
      if (halfW > 0 && x <= -halfW) {
        x += halfW;
        if (targetRef.current != null) targetRef.current += halfW;
      } else if (halfW > 0 && x > 0) {
        x -= halfW;
        if (targetRef.current != null) targetRef.current -= halfW;
      }
      xRef.current = x;
      paint(x);
      if (targetRef.current != null || holdRef.current.drag) raf = requestAnimationFrame(frame);
      else {
        raf = 0;
        last = 0;
        resume();
      }
    };
    const kick = () => {
      settle();
      if (!raf) raf = requestAnimationFrame(frame);
    };
    loopRef.current = { settle, kick, resume };
    paint(xRef.current);
    const measure = () => {
      const w = half.offsetWidth;
      if (w === halfW) return;
      settle();
      halfW = w;
      xRef.current = wrap(xRef.current);
      paint(xRef.current);
      resume();
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(half);
    else measure();
    const io =
      box && typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(es => {
            onScreen = es.some(e => e.isIntersecting);
            if (onScreen) resume();
            else settle();
          })
        : null;
    io?.observe(box!);
    const onVisible = () => (document.hidden ? settle() : resume());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      settle();
      cancelAnimationFrame(raf);
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      loopRef.current = null;
    };
  }, [tape.length > 0]);

  /* a native wheel listener, since React's is passive and the page would scroll under a pull */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      e.preventDefault();
      targetRef.current = null;
      loopRef.current?.settle();
      xRef.current -= d;
      loopRef.current?.kick();
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
  }, []);

  /* A STEP: the next (or the previous) headline's start lands behind the lead, gliding */
  const step = (dir: 1 | -1) => {
    const half = halfRef.current;
    const halfW = half?.offsetWidth ?? 0;
    if (!half || halfW <= 0) return;
    loopRef.current?.settle();
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
    loopRef.current?.kick();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    loopRef.current?.settle();
    dragRef.current = { startX: e.clientX, x0: xRef.current, moved: false };
    holdRef.current.drag = true;
    targetRef.current = null;
    loopRef.current?.kick();
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
      onPointerEnter={() => {
        holdRef.current.hover = true;
        loopRef.current?.settle();
      }}
      onPointerLeave={() => {
        holdRef.current.hover = false;
        endDrag();
        loopRef.current?.resume();
      }}
      /* a KEYBOARD focus holds it (a Tab onto a headline must not have it slide away); a click's
         focus does not, or the tape would stand still after every pick and every arrow */
      onFocus={e => {
        holdRef.current.focus = e.target.matches(':focus-visible');
        if (holdRef.current.focus) loopRef.current?.settle();
      }}
      onBlur={() => {
        holdRef.current.focus = false;
        loopRef.current?.resume();
      }}
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
                    className={`group inline-flex items-center gap-2 mr-9 min-h-[24px] transition-colors ${e.id === selectedId ? 'text-textPrimary' : 'text-textSecondary hover:text-textPrimary'}`}
                    title={`${e.item.headline} · ${e.item.source} · ${ago(e.item.minutesAgo)}`}
                    data-news-tape-item={half === 0 ? e.id : undefined}
                  >
                    <ImpactMark tier={tierOf(e.severity)} />
                    {/* the loop's second half is drawn as CSS content and aria-hidden, so the headlines are not in the page's text twice */}
                    {half === 0 ? (
                      <>
                        <span className="font-mono text-t10 font-bold text-textPrimary">{nameWord(e.item)}</span>
                        <span className="text-t11 whitespace-normal">{e.item.headline}</span>
                        <span className="font-mono text-t9 text-textMuted">{ago(e.item.minutesAgo)}</span>
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-t10 font-bold text-textPrimary before:content-[attr(data-copy)]" data-copy={nameWord(e.item)} />
                        <span className="text-t11 whitespace-normal before:content-[attr(data-copy)]" data-copy={e.item.headline} />
                        <span className="font-mono text-t9 text-textMuted before:content-[attr(data-copy)]" data-copy={ago(e.item.minutesAgo)} />
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

/** A name's news alert, set from the story card: the bell rings when a headline lands on this name (alertStore armNews). */
const NewsAlertDoor = ({ ticker }: { ticker: string }) => {
  const alerts = useAlerts(ticker);
  const set = alerts.find(a => a.kind === 'news') ?? null;
  return (
    <button
      type="button"
      onClick={() => (set ? removeAlert(ticker, set.id) : armNews(ticker, Date.now()))}
      aria-pressed={!!set}
      title={set ? `The bell rings when a headline lands on ${ticker} · click to take it off` : `Ring the bell when a headline lands on ${ticker}`}
      className={`inline-flex items-center gap-1 h-6 px-2 rounded-md border font-mono text-t9 uppercase tracking-widest transition-colors ${set ? 'border-silver/50 text-silver bg-silver/[0.08]' : 'border-borderSubtle bg-chip hover:border-borderMuted text-textSecondary hover:text-textPrimary'}`}
      data-news-alert={set ? 'set' : 'off'}
    >
      <Bell className="w-3 h-3" />
      {set ? `Alert set · ${ticker}` : `Alert me · ${ticker}`}
    </button>
  );
};

/** "Fri Oct 23" for a "2026-10-23" */
const weekdayDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 12)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${shortDay(iso)}`;
};

/** A figure on the story card — label over value, the card's own smaller scale */
/* the figure wraps inside its own column */
const Figure = ({ label, tone = 'text-textPrimary', children, title }: { label: string; tone?: string; children: React.ReactNode; title?: string }) => (
  <div className="min-w-0 overflow-hidden" title={title}>
    <div className="text-t9 text-textMuted whitespace-nowrap truncate">{label}</div>
    <div className={`mt-0.5 font-mono text-t12 font-semibold tnum whitespace-normal break-words ${tone}`}>{children}</div>
  </div>
);

/** The story's text: the first paragraph in the open, the rest behind "Read the whole story" (the house's fold), the source's door at the end */
const StoryText = ({ storyId, body, source, url }: { storyId: string; body: string[]; source: string; url?: string }) => {
  const [whole, setWhole] = useState(true);
  /* a new story opens with every paragraph. Fold is a choice, not the default. */
  useEffect(() => setWhole(true), [storyId]);
  if (!body.length) return null;
  const [first, ...rest] = body;
  return (
    <div className="flex flex-col gap-2" data-news-body data-news-body-open={whole || undefined}>
      <p className="text-t125 leading-relaxed text-textSecondary">{first}</p>
      {rest.length > 0 && (
        <>
          <Fold axis="y" open={whole} testId="data-news-body-fold">
            <div className="flex flex-col gap-2 pb-1">
              {rest.map((para, i) => (
                <p key={i} className="text-t125 leading-relaxed text-textSecondary">
                  {para}
                </p>
              ))}
            </div>
          </Fold>
          <button
            type="button"
            onClick={() => setWhole(w => !w)}
            aria-expanded={whole}
            className="self-start inline-flex items-center gap-1 font-mono text-t10 uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors"
            data-news-body-door
          >
            {whole ? 'Fold the story' : 'Read the whole story'}
            <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${whole ? 'rotate-180' : ''}`} aria-hidden />
          </button>
        </>
      )}
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="self-start inline-flex items-center gap-1 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-news-body-source>
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

  /* stories drip in through the session; the page re-reads every half minute while shown */
  const [wireRev, setWireRev] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => !document.hidden && setWireRev(r => r + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const news = useNewsFeed();
  /* what the wire on the page covers: the whole day once the read has reached New York's midnight, else since when */
  const coverage = useNewsCoverage();
  /* On a weekend, a holiday or before a trading day's first story, the wire is the last session's, said with its day. */
  const wireDayWord = coverage.today ? 'today' : weekdayDay(coverage.day);
  const sinceText = coverage.since > 0 ? ` · and ${coverage.since.toLocaleString('en-US')} ${coverage.since === 1 ? 'story' : 'stories'} since` : '';
  const coverText = coverage.fromMs == null
    ? 'Reading the wire'
    : coverage.wholeDay
      ? coverage.today ? 'Every story on the wire today' : `${wireDayWord}'s wire${sinceText}`
      : `The wire since ${coverage.today ? '' : `${wireDayWord}, `}${nyClock(coverage.fromMs, { zone: true })}${coverage.reading ? ', reading further back' : ''}`;
  const econ = useEconFeed();
  const events = useMemo(() => (news.status === 'live' ? news.events : []), [news, wireRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const calendar = useMemo(() => (econ.status === 'live' ? econ.events : []), [econ, wireRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const note = news.status === 'loading' ? 'Reading the wire.' : news.status === 'sim' ? 'This read did not land — the wire did not answer, so nothing here is a quiet day.' : events.length === 0 ? 'The wire came back with nothing in this window.' : `${events.length.toLocaleString('en-US')} stories on the wire.`;

  /* the wire's clock, re-read with it */
  const at = useMemo(() => now(), [wireRev]); // eslint-disable-line react-hooks/exhaustive-deps
  const insights = useMemo(() => buildRoomInsights(events), [events]);

  /* the controls cut the wire; the map and the list read the same cut */
  const [category, setCategory] = useState<CategoryPick>('all');
  const [names, setNames] = useState<NamesPick>('all');
  const [sort, setSort] = useState<Sort>('matters');
  const boardSet = useMemo(() => new Set(boardNames), [boardNames]);
  const onBoard = (e: GeoNewsEvent) => (e.item.tickers ?? (e.item.ticker ? [e.item.ticker] : [])).some(t => boardSet.has(t));
  /* The filter lists every name and city the other controls leave, with counts; any pick (`name:NVDA`, `city:Riyadh`)
     keeps its rows. */
  /* a name's page opens the wire on that name */
  const [picks, setPicks] = useState<string[]>(() => {
    const n = (location.state as { name?: string } | null)?.name;
    return n ? [`name:${n.toUpperCase()}`] : [];
  });
  const cut = useMemo(() => {
    const board = new Set(boardNames);
    return events.filter(e => {
      if (category !== 'all' && e.item.category !== category) return false;
      if (names === 'board' && !(e.item.ticker && board.has(e.item.ticker))) return false;
      /* macro is the Macro beat (whalesMap categoryOf) — an unnamed company press release is not macro */
      if (names === 'macro' && (e.item.ticker || e.item.category !== 'Macro')) return false;
      return true;
    });
  }, [events, category, names, boardNames]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const nameCount = new Map<string, number>();
    const cityCount = new Map<string, number>();
    cut.forEach(e => {
      const n = e.item.ticker ?? nameWord(e.item);
      nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
      /* a story with no city of its own is on no pin */
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
  const similarRef = useRef<Map<string, number>>(new Map());
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
        /* a routine notice the vendor flags major (a dividend, a results date, a conference slot) is not lifted for the flag */
        /* a press release from a company the page does not list never leads the wire */
        const lifted = (e: GeoNewsEvent) =>
          e.item.major && !PREVIEW_RE.test(e.item.headline) && !(e.item.ticker == null && e.item.category !== 'Macro') &&
          (LIFT_BEATS.has(e.item.category) || (e.item.category === 'Macro' && HARD_MACRO_RE.test(e.item.headline)));
        /* a sport, fashion or lifestyle release ranks last off the Board */
        const rank = (e: GeoNewsEvent) => (onBoard(e) ? (lifted(e) ? 0 : 1) : LIFESTYLE_RE.test(e.item.headline) && e.item.category !== 'Earnings' && e.item.category !== 'M&A' ? 5 : lifted(e) ? 2 : e.item.ticker || e.item.category === 'Macro' ? 3 : 4);
        return rank(a) - rank(b) || a.item.minutesAgo - b.item.minutesAgo;
      },
      /* before the open a story ranks by the last session's move its row shows; one with no move sinks */
      move: (a, b) => moveKey(b) - moveKey(a) || a.item.minutesAgo - b.item.minutesAgo,
      loud: (a, b) => b.severity - a.severity,
    };
 const sorted = [...kept].sort(by[sort]);
    /* the near-duplicates fold into the first of them in this order */
    const out: GeoNewsEvent[] = [];
    const sigs: { words: Set<string>; at: number; idx: number }[] = [];
    const folded = new Map<string, number>();
    for (const e of sorted) {
      const words = dupWords(e.item.headline);
      const twin = sigs.find(g => Math.abs(g.at - e.item.minutesAgo) <= 360 && dupClose(g.words, words));
      if (twin) {
        const head = out[twin.idx];
        folded.set(head.id, (folded.get(head.id) ?? 0) + 1);
        continue;
      }
      sigs.push({ words, at: e.item.minutesAgo, idx: out.length });
      out.push(e);
    }
    similarRef.current = folded;
    return out;
  
  }, [cut, picks, sort]);
  const pins = useMemo(() => clusterByCity(rows), [rows]);
  /* the heat: each story's city, weighed by how hard it lands */
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

  /* the story in hand: the Pulse tile's deep link opens on its story, else the first */
  const [selectedId, setSelectedId] = useState<string | null>(() => (location.state as { selectedId?: string } | null)?.selectedId ?? null);
  /* the lead follows the order until the reader picks a story */
  const pickedRef = useRef(!!(location.state as { selectedId?: string } | null)?.selectedId);
  useEffect(() => {
    if (rows.length === 0) return;
    if (!pickedRef.current ? selectedId !== rows[0].id : !selectedId || !rows.some(r => r.id === selectedId)) setSelectedId(rows[0].id);
  }, [rows, selectedId]);
  const selected = rows.find(r => r.id === selectedId) ?? events.find(e => e.id === selectedId) ?? null;
  /* a story picked by hand flies the map to its city; the one picked for the reader does not move it */
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  /* the open row stays in the window: a pick from the tape or the map lands below the fold otherwise */
  const rowsRef = useRef<HTMLDivElement | null>(null);
  /* below 640px each story stacks: the headline first, its facts under it */
  const stacked = useMediaQuery('(max-width: 639.98px)');
  /* the map is shut on a phone; open on a desk, it loads once its box is near the screen */
  const [mapOpen, setMapOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapNear, setMapNear] = useState(false);
  useEffect(() => {
    const el = mapRef.current;
    if (mapNear || !mapOpen || !el) return;
    if (typeof IntersectionObserver === 'undefined') return setMapNear(true);
    const io = new IntersectionObserver(es => es.some(e => e.isIntersecting) && setMapNear(true), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [mapOpen, mapNear]);
  useEffect(() => {
    keepInWindow(rowsRef.current, selectedId ? `[data-news-row="${selectedId}"]` : null);
  }, [selectedId]);
  const pick = (e: GeoNewsEvent) => {
    pickedRef.current = true;
    setSelectedId(e.id);
    if (e.origin.city) setFlyTo({ lng: e.origin.lng, lat: e.origin.lat, key: `${e.id}:${Date.now()}` });
  };
  /* the tape: the newest headlines on the cut, whatever the sort */
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

  /* the headline count keeps the folded near-duplicates */
  const storyCount = rows.length + [...similarRef.current.values()].reduce((a, n) => a + n, 0);
  /* The biggest move is named only once every name today's stories are about has answered (useSetMoves, in bulk off the
     screener); until then the chip counts the read. */
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
  /* with no economic release ahead, the next earnings report on the near lists is the next print */
  const reportsQ = useNearReports();
  const [matesOpen, setMatesOpen] = useState(true);
  const nextReport = useMemo(() => {
    const today = nyTodayIso();
    const ahead = reportsQ.events.filter(e => !e.reported && (e.iso ?? '') >= today);
    if (!ahead.length) return null;
    const order = (e: (typeof ahead)[number]) => `${e.iso}|${e.slot === 'BMO' && e.timeKnown !== false ? 0 : 1}`;
    const first = [...ahead].sort((a, b) => order(a).localeCompare(order(b)) || Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0))[0];
    const mates = ahead.filter(e => order(e) === order(first)).map(e => e.ticker);
    return { e: first, same: mates.length, mates, total: ahead.length, today: first.iso === today, scope: reportsQ.fortnight ? "on the fortnight's lists" : 'today and next session' };
  }, [reportsQ]);

  const openName = (t: string) => {
    changeTicker(t);
    navigate('/pinpoint/map');
  };

  /* the list's rows, drawn again only when the rows, the open story, the layout or the Board change — a hover on the
     map, a tick of the clock or the tape's own moves leave a day's hundreds of rows alone */
  const rowList = useMemo(
    () =>
      rows.map(e => {
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
                    <span className={`min-w-0 line-clamp-2 text-t125 leading-snug ${open ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'} transition-colors`}>{e.item.headline}{similarRef.current.get(e.id) ? <span className="ml-1.5 font-mono text-t9 text-textMuted" data-news-similar={similarRef.current.get(e.id)}>+{similarRef.current.get(e.id)} similar</span> : null}</span>
                  </span>
                  <span className="min-w-0 flex items-center gap-1.5 font-mono text-t10 text-textMuted whitespace-nowrap overflow-hidden">
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
                    {(e.item.major || onBoard(e)) && <NewsFlag major={e.item.major} onBoard={onBoard(e)} />}
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
                className={`group w-full text-left px-5 py-2 grid items-start gap-x-3 border-t border-borderSubtle/40 transition-colors max-lg:min-w-[900px] ${BAND_COLS} ${open ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.05]'} ${faded && !open ? 'opacity-60' : ''}`}
                style={{ minHeight: NEWS_ROW_H }}
                data-news-row={e.id}
                data-open={open || undefined}
              >
                <span className="h-5 flex items-center font-mono text-t10 tnum text-textSecondary">{e.item.time}</span>
                <span className="min-w-0 h-5 inline-flex items-center gap-1.5 font-mono text-t11 font-bold text-textPrimary">
                  {e.item.ticker ? (
                    <>
                      <CompanyLogo ticker={e.item.ticker} size={14} />
                      {e.item.ticker}
                    </>
                  ) : (
                    <span className="text-textSecondary">{storyNameWord(e.item)}</span>
                  )}
                </span>
                <span className="min-w-0 h-5 flex items-center lg:max-2xl:hidden">
                  <CatTag category={e.item.category} size={9} />
                </span>
                {/* "major" and "board" stack inside their column rather than run into the impact square */}
                <span className="min-h-5 min-w-0 flex items-center"><NewsFlag major={e.item.major} onBoard={onBoard(e)} className="flex-wrap gap-y-0.5 leading-[13px] min-w-0" /></span>
                <span className="min-w-0 flex items-center gap-2">
                  <ImpactMark tier={tierOf(e.severity)} />
                  <span className={`min-w-0 break-words whitespace-normal leading-relaxed text-t12 ${open ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'} transition-colors`}>{e.item.headline}{similarRef.current.get(e.id) ? <span className="ml-1.5 font-mono text-t9 text-textMuted" title="Near-duplicate headlines within six hours, folded into this one" data-news-similar={similarRef.current.get(e.id)}>+{similarRef.current.get(e.id)} similar</span> : null}</span>
                </span>
                <span className="h-5 flex items-center justify-end font-mono text-t11 font-semibold tnum whitespace-nowrap"><PublishMove p={e.item.prediction} short /></span>
                <span className="h-5 flex items-center justify-end font-mono text-t10 text-textSecondary truncate lg:max-2xl:hidden" data-news-row-also title={(e.item.tickers ?? []).slice(1).join(', ') || undefined}>
                  {(e.item.tickers ?? []).length > 1 ? `${e.item.tickers![1]}${e.item.tickers!.length > 2 ? ` +${e.item.tickers!.length - 2}` : ''}` : '—'}
                </span>
              </button>
            );
          }),
    // pick, onBoard and similarRef read only stable setters, boardSet and the rows themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selectedId, stacked, boardSet],
  );

  /* the kind pills, a rail over the list */
  const kindPills = CATEGORY_OPTIONS.map(o => {
      const on = o.value === category;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => setCategory(o.value)}
          aria-pressed={on}
          title={o.hint}
          /* the silver surface, not the silver ink, for contrast on paper */
          className={`shrink-0 h-6 px-3 rounded-full font-mono text-t10 tracking-wide transition-colors ${on ? 'bg-silverFill text-onfoil font-semibold' : 'text-textSecondary hover:text-textPrimary hover:bg-ink/[0.06]'}`}
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
        <RecordHead
          title="The wire"
          guide={{ title: 'How to read the wire', door: 'What the pins, the flags and the numbers mean', testId: 'news-guide', body: <NewsGuide /> }}
          kept={news.keptAt}
          line={<span data-news-coverage>{coverText} · a row opens the story beside the list</span>}
          facts={
            <>
            <Fact label="Stories" testId="stories" tip={`Headlines on the wire after the cards and the filter${coverage.reading ? ' — still reading back, the count grows' : ''}`} partial={coverage.reading && rows.length > 0}>
              {news.status === 'loading' && rows.length === 0 ? (
                <span className="text-textMuted">Reading</span>
              ) : news.status === 'sim' ? (
                <span className="text-textMuted">—</span>
              ) : (
                <>
                  {storyCount.toLocaleString('en-US')}
                  {coverage.reading && <span className="text-t9"> · so far</span>}
                </>
              )}
            </Fact>
            <>
                <Fact label="Major" testId="major" tip="Headlines Unusual Whales flags as major" partial={coverage.reading && rows.length > 0}>
                  {news.status === 'loading' && rows.length === 0 ? <span className="text-textMuted">Reading</span> : news.status === 'sim' ? <span className="text-textMuted">—</span> : <>{rows.filter(r => r.item.major).length}{coverage.reading && <span className="text-t9"> · so far</span>}</>}
                </Fact>
                <Fact label="On your Board" testId="board" tip="Headlines that name a stock on your Board" partial={coverage.reading && rows.length > 0}>
                  {news.status === 'loading' && rows.length === 0 ? <span className="text-textMuted">Reading</span> : news.status === 'sim' ? <span className="text-textMuted">—</span> : <>{rows.filter(onBoard).length}{coverage.reading && <span className="text-t9"> · so far</span>}</>}
                </Fact>
            </>
            <Fact label={biggest && !moveDayIsToday ? `Biggest move · ${shortDay(biggest.date)}` : coverage.today ? 'Biggest move today' : `Biggest move · ${shortDay(coverage.day)}`} testId="biggest" tip={`The regular session's change${biggest && !moveDayIsToday ? ` on ${shortDay(biggest.date)}, the last session` : ''} — not the move when the story crossed — over every name ${coverage.today ? "today's" : `${wireDayWord}'s`} stories are about (${moveNames.length} names, read in bulk off the screener; the regular close is each name's daily row — ${setMoves.moves.size} read, the other ${Math.max(0, setMoves.screened - setMoves.moves.size)} ruled out because their whole session range sits inside the leader's move)`}>
              {coverage.reading ? (
                <span className="text-textMuted">reading {coverage.today ? "today's" : `${wireDayWord}'s`} stories{namesSoFar ? ` · ${namesSoFar} names so far` : ''}</span>
              ) : biggest ? (
                <>
                  {biggest.ticker} <span className={biggest.pct >= 0 ? 'text-bull' : 'text-bear'}>{signedPct(biggest.pct)}</span>
                  <span className="text-textMuted"> · of {setMoves.screened} {setMoves.screened === 1 ? "name" : "names"}</span>
                </>
              ) : (
                <span className="text-textMuted">{moveNames.length ? (setMoves.complete ? 'no regular close on these names' : `reading ${Math.min(setMoves.screened, moveNames.length)} of ${moveNames.length} names`) : 'no named stories yet'}</span>
              )}
            </Fact>
            <Fact label="Next print" testId="next" tip="The next economic release on the calendar — today's or a later day's, the high-impact ones first; with none ahead, the next earnings report">
              {nextPrint ? (
                <>
                  {nextPrint.title} <span className={nextPrint.inMinutes < 90 ? 'text-warn' : 'text-textMuted'}>· {nextPrint.dayLabel} {nextPrint.timeLabel} · in {nextPrint.inMinutes < 60 ? `${nextPrint.inMinutes}m` : `${Math.floor(nextPrint.inMinutes / 60)}h ${nextPrint.inMinutes % 60}m`}</span>
                </>
              ) : (
                nextReport ? (
                  <span title={`No economic release is ahead on the calendar; the next earnings report still to come — ${nextReport.total.toLocaleString('en-US')} ${nextReport.scope}`} data-news-next="earnings">
                    {/* "VZ and 11 more report Mon before the open" */}
                    {matesOpen
                      ? (nextReport.mates.length <= 1
                        ? nextReport.mates[0]
                        : `${nextReport.mates.slice(0, -1).join(', ')} and ${nextReport.mates[nextReport.mates.length - 1]}`)
                      : nextReport.e.ticker}
                    <span className="text-textMuted">
                      {nextReport.same > 1 && !matesOpen ? (
                        <button type="button" onClick={() => setMatesOpen(true)} className="hover:text-textPrimary" data-news-more="shut">
                          {` and ${nextReport.same - 1} more report`}
                        </button>
                      ) : nextReport.same === 1 ? ' reports' : ' report'}
                      {' '}{nextReport.today ? 'today' : nextReport.e.iso ? weekdayDay(nextReport.e.iso).split(' ')[0] : nextReport.e.dateLabel} {nextReport.e.timeKnown === false ? '(time not set)' : nextReport.e.slot === 'BMO' ? 'before the open' : 'after the close'}
                      {nextReport.same > 1 && matesOpen && (
                        <button type="button" onClick={() => setMatesOpen(false)} className="hover:text-textPrimary" data-news-more="open">
                          {' '}· Hide
                        </button>
                      )}
                    </span>
                  </span>
                ) : (
                  <span className="text-textMuted">{econ.status === 'loading' || reportsQ.status === 'loading' ? 'reading the calendar' : econ.status === 'sim' && reportsQ.status === 'sim' ? 'the calendar did not answer' : 'nothing ahead on the calendar'}</span>
                )
              )}
            </Fact>
            </>
          }
        />
        {/* on a phone the controls are a grid of equal cells */}
        <div className={`px-5 pb-3 ${CONTROLS_LINE}`} data-news-controls>
          <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Whose stories" testId="news-names" />
          <DropdownSelect label="Sort" value={sort} options={SORT_OPTIONS} onChange={setSort} title="The order of the wire" testId="news-sort" />
          <div className="ml-auto" title="The names and cities on the wire right now — tick any number; the map and the list keep only those">
            <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="Keep only these" testId="news-filter" />
          </div>
        </div>

        {/* the story list first, the story in hand beside it; the map loads below, once it is near the screen */}
        <div className="px-5 py-2 border-t border-borderSubtle flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0" role="group" aria-label="What kind of story" data-news-kinds={category}>
          {kindPills}
          <span className="ml-auto pl-3 shrink-0 max-sm:hidden">
            <ImpactLegend />
          </span>
        </div>
        <div className="grid border-t border-borderSubtle grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]" data-news-band>
          <div className="min-w-0 lg:border-r lg:border-borderSubtle">
        {/* every story on the cut, in the chosen order */}
        {/* below lg the rows scroll sideways at a readable width */}
        {/* a day of the wire is hundreds of rows, so the list scrolls inside a window with its head pinned */}
        <div ref={rowsRef} className={`relative overflow-y-auto overscroll-contain ${stacked ? '' : 'max-lg:overflow-x-auto'}`} style={{ maxHeight: NEWS_WINDOW_H }} data-news-rows data-news-window={rows.length > NEWS_WINDOW_ROWS || undefined} data-news-stacked={stacked || undefined}>
          {!stacked && <div className={`sticky top-0 z-10 bg-panel px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted max-lg:min-w-[900px] ${BAND_COLS}`}>
            <span title="When the headline crossed, New York time">Time</span>
            <span title="The first stock the headline names; MACRO for an economy or market story; NO NAME for an unlisted company's story">Name</span>
            <span className="lg:max-2xl:hidden" title="What sort of story it is, read from the headline">Kind</span>
            <span title={NEWS_FLAG_TIP}>Flag</span>
            <span>Headline</span>
            <span className="text-right" title="How the named stock had moved on the session when the story crossed — a snapshot at publish, not today's move now">At publish</span>
            <span className="text-right lg:max-2xl:hidden" title="The other stocks the headline names">Also</span>
          </div>}
          {rows.length === 0 && <div className="px-5 py-6 text-center font-mono text-t10 uppercase tracking-widest text-textMuted">{news.status === 'loading' || coverage.reading ? 'Reading the wire' : news.status === 'sim' ? 'This read did not land' : 'Nothing on the tape for these cards'}</div>}
          {rowList}
        </div>
          </div>
          <div className="min-w-0 px-4 pt-3 pb-3 flex flex-col gap-3 overflow-y-auto lg:sticky lg:top-0 lg:self-start lg:max-h-[min(80vh,720px)] max-lg:border-t max-lg:border-borderSubtle" data-news-story={selected?.id}>
            {selected ? (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.item.ticker ? (
                    <button type="button" onClick={() => openName(selected.item.ticker!)} className="hit inline-flex items-center gap-1.5 min-h-[24px] group" title={`Open ${selected.item.ticker} on the Map`}>
                      <CompanyLogo ticker={selected.item.ticker} size={16} />
                      <span className="font-mono text-t12 font-bold text-textPrimary group-hover:underline underline-offset-2">{selected.item.ticker}</span>
                    </button>
                  ) : (
                    <span className="font-mono text-t12 font-bold text-textPrimary">{nameWord(selected.item)}</span>
                  )}
                  <NewsFlag major={selected.item.major} onBoard={onBoard(selected)} />
                  <CatTag category={selected.item.category} size={9} />
                  <span className="ml-auto font-mono text-t9 text-textMuted whitespace-nowrap">
                    {selected.item.source} · {ago(selected.item.minutesAgo)}
                  </span>
                </div>
                <p className="text-t13 leading-snug text-textPrimary" data-news-headline>
                  {selected.item.headline}
                </p>
                {/* the story's opening paragraph, the rest behind one fold, and the source's door when the provider gives one */}
                <StoryText storyId={selected.id} body={selected.item.body} source={selected.item.source} url={selected.item.url} />
                {/* the impact, as a meter, in the grade's ink */}
                <div>
                  <div className="flex items-center justify-between text-t9 text-textMuted">
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
                    <span className="block h-full rounded-full bg-ink/40" style={{ width: `${selected.severity * 10}%`, transition: `width 520ms ${EASE}` }} />
                  </div>
                </div>
                {/* how the named stock has traded */}
                <div className="grid grid-cols-2 gap-3" data-news-numbers>
                  <Figure label="Move at publish" title="The named stock's regular-session move when the story crossed, the pre-market or after-hours move apart — a snapshot, not now">
                    <PublishMove p={selected.item.prediction} />
                  </Figure>
                  {selected.item.ticker ? (
                    selectedQuote?.phase === 'pre' && selectedQuote.lastSessionPct != null ? (
                      <Figure label={`Last session${selectedQuote.regDate ? ` · ${shortDay(selectedQuote.regDate)}` : ''}`} title={`Before the open: the last regular session's change${extendedLine(selectedQuote) ? ` · ${extendedLine(selectedQuote)}, kept apart` : ''}`} tone={selectedQuote.lastSessionPct >= 0 ? 'text-bull' : 'text-bear'}>
                        {signedPct(selectedQuote.lastSessionPct)}
                      </Figure>
                    ) : (
                      <Figure label={selectedQuote && selectedQuote.phase !== 'regular' ? 'The session' : 'Today'} title={`The regular session's change${extendedLine(selectedQuote) ? ` · ${extendedLine(selectedQuote)}, kept apart` : ''}`} tone={selectedQuote ? (selectedQuote.changePct >= 0 ? 'text-bull' : 'text-bear') : 'text-textMuted'}>
                        {selectedQuote ? signedPct(selectedQuote.changePct) : '—'}
                      </Figure>
                    )
                  ) : null}
                </div>
                {selected.item.prediction.playbook ? (
                <div key={selected.id} className="flex flex-col gap-2 animate-soft-in text-t115 leading-relaxed text-textSecondary">
                  <div>
                    <div className="text-t9 uppercase tracking-widest text-textMuted">At publish</div>
                    <p className="mt-0.5">
                      <RichRead text={selected.item.prediction.playbook} />
                    </p>
                  </div>
                </div>
                ) : null}
                {/* a macro story has no name of its own, so its door is the index */}
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
              <div className="flex-1 flex items-center justify-center font-mono text-t10 uppercase tracking-widest text-textMuted">{news.status === 'loading' || coverage.reading ? 'Reading the wire' : news.status === 'sim' ? 'This read did not land' : 'Nothing on the wire for these cards'}</div>
            )}
          </div>
        </div>
        <p className="px-5 pb-4 pt-3 border-t border-borderSubtle/40 text-t12 leading-relaxed text-textSecondary" data-news-sentence>
          <RichRead text={note} />
        </p>
        <div ref={mapRef} className="border-t border-borderSubtle" data-news-map-box>
          <button type="button" onClick={() => setMapOpen(v => !v)} aria-expanded={mapOpen} className="w-full px-5 h-9 flex items-center gap-2 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors" data-news-map-door={mapOpen ? 'open' : 'shut'}>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${mapOpen ? 'rotate-180' : ''}`} />
            The map · {pins.length} {pins.length === 1 ? 'city' : 'cities'} the stories come from
            <HeatLegend className="ml-auto normal-case tracking-normal max-sm:hidden" />
          </button>
          {mapOpen && (
            <div className="flex flex-col border-t border-borderSubtle/60">
              <NewsTape tape={tape} selectedId={selectedId} onPick={pick} />
              <div className="px-2 py-2 flex flex-col items-center">
              <div className="relative w-full" data-news-stage>
                {mapNear ? <NewsMap className="absolute inset-0" pins={pins} selectedCity={selected?.origin.city ?? null} hoverCity={hoverCity?.city ?? null} onPick={p => { const e = rows.find(r => r.id === p.topId) ?? events.find(r => r.id === p.topId); if (e) pick(e); else setSelectedId(p.topId); }} onHover={setHoverCity} heat={heat} reach={reach} at={at} flyTo={flyTo} /> : null}
              </div>
              </div>
            <div className="px-4 min-h-[26px] py-1 border-t border-ink/[0.06] flex items-center gap-3 font-mono text-t10 text-textSecondary whitespace-normal" data-news-map-read>
              {hoverCity ? (
                <>
                  <span className="font-bold text-textPrimary">{hoverCity.city}</span>
                  <span>
                    {hoverCity.n} {hoverCity.n === 1 ? 'story' : 'stories'}
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
          )}
        </div>
      </div>

      {/* All news: every headline as a feed with tabs, and the names you follow */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-news-all>
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-t15 font-semibold leading-tight text-textPrimary">All news</h3>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">The same wire, a tab per kind · follow a name and ring the bell on it</p>
        </div>
        <div className="border-t border-borderSubtle">
          <NewsFeedTabs events={events} calendar={calendar} selectedId={selectedId} onPick={pick} wire={news.status === 'loading' || coverage.reading ? 'reading' : news.status === 'sim' ? 'failed' : 'read'} />
        </div>
      </div>

      {/* The day: the month on the record, and what the wire adds up to */}
      <div className="border border-borderSubtle rounded-md bg-panel" data-news-day>
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-t15 font-semibold leading-tight text-textPrimary">The day</h3>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">The month: data, earnings, the FDA, the schedule and the posts</p>
        </div>
        <div className="border-t border-borderSubtle">
          {/* the month is read once the wire's first page is in, so the headlines land first */}
          {news.status === 'loading' ? (
            <div className="px-5 py-8 font-mono text-t10 uppercase tracking-widest text-textMuted animate-pulse" data-news-day-pending>
              Reading the month after the headlines…
            </div>
          ) : (
            <NewsCalendar />
          )}
        </div>
        {/* the reads, across under the month */}
        {/* two by two on a phone */}
        <div className="grid border-t border-borderSubtle max-md:!grid-cols-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, insights.length)}, minmax(0, 1fr))` }} data-news-reads>
          {insights.map((i, k) => (
            <div key={i.key} className={`px-5 py-3 ${k > 0 ? 'border-l border-borderSubtle/40' : ''} max-md:border-l-0 max-md:[&:nth-child(even)]:border-l max-md:[&:nth-child(n+3)]:border-t max-md:border-borderSubtle/40`} data-news-read={i.key}>
              <div className={`text-t10 font-semibold uppercase tracking-widest ${i.ink === 'bull' ? 'text-bull' : i.ink === 'bear' ? 'text-bear' : 'text-textPrimary'}`}>{i.title}</div>
              <p className="mt-1 text-t115 leading-relaxed text-textPrimary/85">
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
