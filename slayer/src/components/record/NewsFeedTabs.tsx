/* Every headline as one feed with tabs (all, following, earnings, data, analyst, deals, other); a click opens the story
   above and flies the map to its city. A followed name's bell is the shell's own news alert (alertStore.armNews). */

import { PublishMove } from './publishMove';
import { useMediaQuery } from '../ui/useMediaQuery';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Plus, X } from 'lucide-react';
import { freshnessOf, type EconEvent, type GeoNewsEvent } from '../../data/newsroom';
import { followName, setFollowAlerts, unfollowName, useFollows } from '../../data/newsFollows';
import { NEWS_ROW_H, NEWS_WINDOW_H, NEWS_WINDOW_ROWS } from '../../pages/record/recordSkeletons';
import CatTag from '../news/CatTag';
import CardTabs from '../ui/CardTabs';
import CompanyLogo from '../ui/CompanyLogo';
import NewsWindow from './NewsWindow';
import TickerLookup from '../ui/TickerLookup';
import { ImpactLegend, ImpactMark, NEWS_FLAG_TIP, NewsFlag, tierOf } from './impactMark';

/** MACRO only for an economy or market story; an untagged company story is not macro */
export const nameWord = (item: { ticker: string | null; category: string; mentions?: string[] }): string => item.ticker ?? (item.mentions?.length ? `mentions ${item.mentions[0]}` : item.category === 'Macro' ? 'MACRO' : 'NO NAME');
import { useBoardNames } from '../../data/boardNames';

type FeedTab = 'all' | 'following' | 'earnings' | 'data' | 'analyst' | 'deals' | 'other';
const FEED_TABS = [
  { value: 'all', label: 'All finance news' },
  { value: 'following', label: 'Following' },
  { value: 'earnings', label: 'Earnings news' },
  { value: 'data', label: 'Data news' },
  { value: 'analyst', label: 'Analyst' },
  { value: 'deals', label: 'Deals, product & rules' },
  /* the stories of no named beat have a tab of their own */
  { value: 'other', label: 'Other company news' },
] as const;
/** The wire's columns — the same seven the rows under the map wear */
const FEED_COLS = '72px 104px 96px 72px minmax(0, 1fr) 76px 72px';
/** the window's pinned column head */
const NEWS_HEAD_H = 22;
/** The tab in hand outlives the page — back from a story's page, the reader lands on the tab they left */
/* it opens on a kind, not on All: the list above already holds every story */
let tabMemory: FeedTab = 'earnings';

interface Props {
  events: GeoNewsEvent[];
  calendar: EconEvent[];
  selectedId: string | null;
  onPick: (e: GeoNewsEvent) => void;
  /** 'reading' while the wire is still being read — the empty line waits for it; 'failed' when it did not answer */
  wire?: 'reading' | 'failed' | 'read';
}

/** One story in the feed. Memoized: a pick redraws the rows whose open state changed, not the window. */
const FeedRow = memo(function FeedRow({ e, open, stacked, onBoard, ringing, onPick }: { e: GeoNewsEvent; open: boolean; stacked: boolean; onBoard: boolean; ringing: boolean; onPick: (e: GeoNewsEvent) => void }) {
  const faded = freshnessOf(e) === 'faded';
  if (stacked)
    return (
      <button
        type="button"
        onClick={() => onPick(e)}
        className={`group w-full text-left px-4 py-2.5 flex flex-col gap-1 border-t border-borderSubtle/40 transition-colors ${open ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.05]'} ${faded && !open ? 'opacity-60' : ''}`}
        data-news-feed-row={e.id}
        data-open={open || undefined}
      >
        <span className="flex items-start gap-2 min-w-0">
          <span className="mt-[5px] shrink-0">
            <ImpactMark tier={tierOf(e.severity)} />
          </span>
          <span className={`min-w-0 line-clamp-2 text-t125 leading-snug ${open ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'} transition-colors`}>{e.item.headline}</span>
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
            <span className="text-textSecondary">{nameWord(e.item)}</span>
          )}
          <span>·</span>
          <CatTag category={e.item.category} size={9} />
          {(e.item.major || onBoard) && <NewsFlag major={e.item.major} onBoard={onBoard} />}
          <span className="ml-auto tnum font-semibold">
            <PublishMove p={e.item.prediction} short />
          </span>
        </span>
      </button>
    );
  return (
    <button
      type="button"
      onClick={() => onPick(e)}
      className={`group w-full text-left px-5 py-2 grid items-start gap-x-3 border-t border-borderSubtle/40 transition-colors max-lg:min-w-[900px] ${open ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : 'hover:bg-silver/[0.05]'} ${faded && !open ? 'opacity-60' : ''}`}
      style={{ minHeight: NEWS_ROW_H, gridTemplateColumns: FEED_COLS }}
      data-news-feed-row={e.id}
      data-open={open || undefined}
    >
      <span className="h-5 flex items-center font-mono text-t10 tnum text-textSecondary">{e.item.time}</span>
      <span className="min-w-0 h-5 inline-flex items-center gap-1.5 font-mono text-t11 font-bold text-textPrimary">
        {e.item.ticker ? (
          <>
            <CompanyLogo ticker={e.item.ticker} size={14} />
            {e.item.ticker}
            {ringing && <Bell className="w-2.5 h-2.5 text-silver" aria-label="the bell rings on this name" data-feed-bell />}
          </>
        ) : (
          <span className="text-textSecondary">{nameWord(e.item)}</span>
        )}
      </span>
      <span className="min-w-0 h-5 flex items-center">
        <CatTag category={e.item.category} size={9} />
      </span>
      <span className="h-5 flex items-center"><NewsFlag major={e.item.major} onBoard={onBoard} /></span>
      <span className="min-w-0 flex items-center gap-2">
        <ImpactMark tier={tierOf(e.severity)} />
        <span className={`min-w-0 break-words whitespace-normal leading-relaxed text-t12 ${open ? 'text-textPrimary' : 'text-textSecondary group-hover:text-textPrimary'} transition-colors`}>{e.item.headline}</span>
        <span className="font-mono text-t9 text-textMuted whitespace-nowrap">{e.item.source}</span>
      </span>
      {/* an unmeasured story carries no move — the same "—" the wire's own rows show, never "+0.0% · poor" */}
      <span className="h-5 flex items-center justify-end font-mono text-t11 font-semibold tnum whitespace-nowrap"><PublishMove p={e.item.prediction} short /></span>
      <span className="h-5 flex items-center justify-end font-mono text-t10 text-textSecondary truncate" data-news-row-also title={(e.item.tickers ?? []).slice(1).join(', ') || undefined}>
        {(e.item.tickers ?? []).length > 1 ? `${e.item.tickers![1]}${e.item.tickers!.length > 2 ? ` +${e.item.tickers!.length - 2}` : ''}` : '—'}
      </span>
    </button>
  );
});

/* A row's height before it is measured: the headline's lines at the window's width (Inter at ~0.5em a character, fitted to the measured rows). */
const feedEstimate = (stacked: boolean) => (e: GeoNewsEvent, width: number): number => {
  const len = e.item.headline.length;
  /* a phone's row clamps its headline to two lines, which nearly every headline fills: one height */
  if (stacked) return 76;
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const rowW = vw < 1024 ? Math.max(900, width) : width || 900;
  /* the seven columns and their gaps, the impact square and the source's name beside the headline */
  const lines = Math.max(1, Math.ceil((len * 6) / Math.max(80, rowW - 604 - 16 - (e.item.source.length * 5.4 + 8))));
  return Math.max(NEWS_ROW_H, Math.round(17 + Math.max(20, lines * 19.5)));
};
const storyKey = (e: GeoNewsEvent) => e.id;

const NewsFeedTabs = ({ events, calendar, selectedId, onPick, wire = 'read' }: Props) => {
  const [tab, setTabState] = useState<FeedTab>(tabMemory);
  const setTab = (t: FeedTab) => {
    tabMemory = t;
    setTabState(t);
  };
  const follows = useFollows();
  const ringing = useMemo(() => new Set(follows.filter(f => f.alerts).map(f => f.ticker)), [follows]);
  const followed = useMemo(() => new Set(follows.map(f => f.ticker)), [follows]);
  const boardNames = useBoardNames();
  const boardSet = useMemo(() => new Set(boardNames), [boardNames]);
  const onBoard = (e: GeoNewsEvent) => (e.item.tickers ?? (e.item.ticker ? [e.item.ticker] : [])).some(t => boardSet.has(t));
  const [adding, setAdding] = useState(false);
  /* on a phone each row stacks: the headline, then time · name · kind · flag · move */
  const stacked = useMediaQuery('(max-width: 639.98px)');
  /* the open row stays in the window (NewsWindow brings it into view on a pick and on a tab change) */
  const windowRef = useRef<HTMLDivElement | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const onRowPick = useCallback((e: GeoNewsEvent) => pickRef.current(e), []);
  const estimate = useMemo(() => feedEstimate(stacked), [stacked]);
  const addRef = useRef<HTMLDivElement | null>(null);
  /* the add menu closes on a click outside it or Escape, the way every picker menu does */
  useEffect(() => {
    if (!adding) return;
    const away = (ev: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(ev.target as Node)) setAdding(false);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAdding(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [adding]);

  const rows = useMemo(() => {
    const newest = [...events].sort((a, b) => a.item.minutesAgo - b.item.minutesAgo);
    switch (tab) {
      case 'following':
        return newest.filter(e => e.item.ticker && followed.has(e.item.ticker));
      case 'earnings':
        return newest.filter(e => e.item.category === 'Earnings' || e.item.category === 'Guidance');
      case 'data':
        return newest.filter(e => e.item.category === 'Macro');
      case 'analyst':
        return newest.filter(e => e.item.category === 'Analyst');
      case 'deals':
        return newest.filter(e => e.item.category === 'M&A' || e.item.category === 'Product' || e.item.category === 'Regulatory');
      case 'other':
        return newest.filter(e => e.item.category === 'General');
      default:
        return newest;
    }
  }, [events, tab, followed]);
  /* the prints that already landed today, on the Data tab, the latest first */
  const printed = useMemo(() => (tab === 'data' ? calendar.filter(c => c.inMinutes < 0).sort((a, b) => b.inMinutes - a.inMinutes) : []), [calendar, tab]);
  const counts = useMemo(() => {
    const c = { all: events.length, following: 0, earnings: 0, data: 0, analyst: 0, deals: 0, other: 0 };
    for (const e of events) {
      if (e.item.ticker && followed.has(e.item.ticker)) c.following++;
      const k = e.item.category;
      if (k === 'Earnings' || k === 'Guidance') c.earnings++;
      else if (k === 'Macro') c.data++;
      else if (k === 'Analyst') c.analyst++;
      else if (k === 'M&A' || k === 'Product' || k === 'Regulatory') c.deals++;
      else c.other++;
    }
    return c;
  }, [events, followed]);
  const tabOptions = useMemo(() => FEED_TABS.map(t => ({ value: t.value, label: `${t.label} · ${counts[t.value]}` })), [counts]);

  return (
    <div data-news-feed={tab}>
      {/* the tabs, a hairline gliding between them */}
      <div className="px-5 min-h-[38px] py-1 border-b border-borderSubtle flex items-center gap-x-4 gap-y-1 flex-wrap" data-news-feed-tabs>
        <CardTabs options={tabOptions} value={tab} onChange={setTab} ariaLabel="Which news" />
      </div>

      {/* the names you follow, on the Following tab: a chip per name with its bell */}
      {tab === 'following' && (
        <div className="px-5 h-[44px] border-b border-borderSubtle/60 flex items-center gap-2 flex-wrap" data-news-follows={follows.length}>
          <span className="font-mono text-t9 uppercase tracking-widest text-textMuted mr-1">Following</span>
          {follows.length === 0 && <span className="text-t11 text-textSecondary">no names yet — add one and its stories gather here</span>}
          {follows.map(f => (
            <span key={f.ticker} className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-md border border-borderSubtle bg-chip font-mono text-t11 font-semibold text-textPrimary" data-follow={f.ticker} data-alerts={f.alerts || undefined}>
              <CompanyLogo ticker={f.ticker} size={12} />
              {f.ticker}
              <button
                type="button"
                onClick={() => setFollowAlerts(f.ticker, !f.alerts)}
                title={f.alerts ? `The bell rings when a headline lands on ${f.ticker} · click to take it off` : `Ring the bell when a headline lands on ${f.ticker}`}
                aria-pressed={f.alerts}
                className={`ml-1 inline-flex items-center justify-center w-5 h-5 rounded transition-colors ${f.alerts ? 'text-silver bg-silver/[0.12]' : 'text-textMuted hover:text-textPrimary hover:bg-ink/[0.06]'}`}
                data-follow-bell={f.alerts ? 'set' : 'off'}
              >
                {f.alerts ? <Bell className="w-3 h-3" /> : <BellOff className="w-3 h-3" />}
              </button>
              <button type="button" onClick={() => unfollowName(f.ticker)} title={`Stop following ${f.ticker}`} aria-label={`Stop following ${f.ticker}`} className="inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-follow-remove>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <div ref={addRef} className="relative">
            <button
              type="button"
              onClick={() => setAdding(v => !v)}
              aria-expanded={adding}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border bg-chip transition-colors font-mono select-none ${adding ? 'border-silver/50' : 'border-borderSubtle hover:border-borderMuted'}`}
              data-follow-add
            >
              <Plus className="w-3 h-3 text-textMuted" />
              <span className="text-t11 font-semibold text-textPrimary">Follow a name</span>
            </button>
            {adding && (
              <div role="dialog" aria-label="Follow a name" className="absolute left-0 top-full mt-1 z-[60] w-72 max-h-[320px] border border-borderMuted bg-panel/95 backdrop-blur-xl rounded-md shadow-2xl shadow-black/60 overflow-y-auto overscroll-contain animate-slide-in" data-follow-menu>
                <div className="px-2.5 py-1.5 border-b border-borderSubtle text-t10 text-textSecondary">Its stories gather on this tab — ring the bell to be told of each one</div>
                <TickerLookup
                  onPick={sym => {
                    followName(sym);
                    setAdding(false);
                  }}
                />
              </div>
            )}
          </div>
          <span className="ml-auto font-mono text-t9 uppercase tracking-widest text-textMuted">the bell rings in the alerts drawer when a headline lands</span>
        </div>
      )}

      {/* the rows; below lg they scroll sideways at a readable width */}
      {/* the feed scrolls inside its box past twenty rows */}
      <div ref={windowRef} className={`relative overflow-y-auto overscroll-contain ${stacked ? '' : 'max-lg:overflow-x-auto'}`} style={{ maxHeight: NEWS_WINDOW_H, overflowAnchor: 'none' }} data-news-feed-window={rows.length + printed.length > NEWS_WINDOW_ROWS || undefined} data-news-feed-stacked={stacked || undefined}>
      {!stacked && <div className="sticky top-0 z-10 bg-panel px-5 h-[22px] grid items-center gap-x-3 text-t9 uppercase tracking-widest text-textMuted max-lg:min-w-[900px]" style={{ gridTemplateColumns: FEED_COLS }}>
        <span title="When the headline crossed, New York time">Time</span>
        <span title="The first stock the headline names; MACRO for an economy story; NO TICKER for an untagged company story">Name</span>
        <span title="What sort of story it is, read from the headline">Kind</span>
        <span title={NEWS_FLAG_TIP}>Flag</span>
        <span className="flex items-center gap-4">
          <span>Headline</span>
          <span className="max-lg:hidden">
            <ImpactLegend />
          </span>
        </span>
        <span className="text-right" title="How the named stock has moved so far today — a fact, not a forecast">Today</span>
        <span className="text-right" title="The other stocks the headline names">Also</span>
      </div>}
      {printed.map(p => (
        <div key={p.id} className="px-5 py-2 grid items-start gap-x-3 border-t border-borderSubtle/40 max-lg:min-w-[900px]" style={{ minHeight: NEWS_ROW_H, gridTemplateColumns: FEED_COLS }} data-news-print-row={p.id}>
          <span className="font-mono text-t10 tnum text-textSecondary">{p.timeLabel}</span>
          <span className="font-mono text-t11 font-bold text-textSecondary">{p.region}</span>
          <span className="font-mono text-t9 uppercase tracking-widest text-textSecondary">print</span>
          <span className="font-mono text-t9 font-semibold uppercase tracking-widest text-textSecondary">landed</span>
          <span className="min-w-0 flex items-center gap-2">
            <ImpactMark tier={p.impact} />
            <span className="min-w-0 break-words whitespace-normal leading-relaxed text-t12 text-textPrimary">{p.title}</span>
            {p.forecast && (
              <span className="font-mono text-t10 tnum text-textSecondary whitespace-nowrap">
                fcst <span className="text-textPrimary">{p.forecast}</span>
                {p.previous ? (
                  <>
                    {' '}
                    · prev <span className="text-textPrimary">{p.previous}</span>
                  </>
                ) : null}
              </span>
            )}
          </span>
          <span />
          <span />
        </div>
      ))}
      {rows.length === 0 && printed.length === 0 && (
        <div className="px-5 py-6 text-center font-mono text-t10 uppercase tracking-widest text-textMuted" data-news-feed-empty>
          {wire === 'reading' ? 'Reading the wire' : wire === 'failed' ? 'This read did not land' : tab === 'following' ? 'Nothing yet on the names you follow' : 'Nothing on the wire here today'}
        </div>
      )}
      <NewsWindow box={windowRef} items={rows} keyOf={storyKey} estimate={estimate} head={stacked ? 0 : NEWS_HEAD_H} initialHeight={NEWS_WINDOW_H} openKey={selectedId} reveal={tab} above={`${tab}|${printed.length}|${rows.length === 0}`} className={stacked ? '' : 'max-lg:min-w-[900px]'}>
        {e => <FeedRow e={e} open={e.id === selectedId} stacked={stacked} onBoard={onBoard(e)} ringing={!!e.item.ticker && ringing.has(e.item.ticker)} onPick={onRowPick} />}
      </NewsWindow>
      </div>
    </div>
  );
};

export default NewsFeedTabs;
