/* Who reports when, and what the options charge for it: the head's facts, one line of controls, the week as a board of
   five days (or a list of days), then every report in a paged grid. */

import { Controls, PhoneFold, RecordHead, Summary } from '../../components/record/RecordFrame';
import { createStore, useStore } from '../../data/feedStore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Moon, Search, Sunrise, X } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import { FeedFallback } from '../../components/ui/liveRead';
import DropdownSelect, { CARD, type DropdownOption } from '../../components/ui/DropdownSelect';
import TickerLookup from '../../components/ui/TickerLookup';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { EarningsGuide } from '../../components/record/EarningsGuide';
import { TableSkeleton } from '../../components/ui/Skeleton';
import { richText, stateOf, type VolState } from '../../components/earnings/volState';
import { weekDayDate, weekDayLabel, type EarningsEvent, type NextReport } from '../../data/earnings';
import { signedPct as signedPctOf } from './money';
import { MIN_PRICED_PRINTS, untilWords, useEarningsCoverage, useEarningsHistories, useEarningsPending, useEarningsFailed, useEarningsKeptAt, useEveryReport, useLiveReactions, useNextReport, useNextReportPending, historyMissed, ensureLastWeek, useLastWeekStatus, reactionIsoOf } from '../../data/earningsFeed';
import { nyTodayIso } from '../../data/nyDate';
import { nyMinutes } from '../../core/nyTime';
import { macroWindow, type MacroDate } from '../../data/events';
import { useBoardNames } from '../../data/boardNames';
import { phonePin, usePagedGrid } from '../../components/record/pagedGrid';
import { Fact as RecordFact } from '../../components/record/ui';
import { MONTHS } from '../../core/calendar';

const Fact = (p: Omit<Parameters<typeof RecordFact>[0], 'scope'>) => <RecordFact scope="earnings" {...p} />;

type WeekPick = '-1' | '0' | '1' | 'both';
type ShowPick = 'all' | VolState;
type Layout = 'list' | 'board';

/** A shelf on the board, and the week's list, before "+ more" opens that day. */
const SHELF = 4;
const LIST_CAP = 8;
const rankEvents = (list: EarningsEvent[]) =>
  [...list].sort((a, b) => Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0) || b.impliedMovePct - a.impliedMovePct);

/* on a weekend the board opens on the coming week (nyDate.ts boardMondayIso), and the hint says so */
const nyWeekend = (): boolean => {
  const d = new Date(`${nyTodayIso()}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};
const WEEK_OPTIONS: DropdownOption<WeekPick>[] = [
  { value: '-1', label: 'Last week', hint: nyWeekend() ? 'Monday to Friday of the week just reported, with each name\'s move' : 'Monday to Friday of the week before this one, with each name\'s move' },
  { value: '0', label: nyWeekend() ? 'Coming week' : 'This week', hint: nyWeekend() ? 'Monday to Friday of the coming week — on a weekend the board opens on the week ahead' : 'Monday to Friday of the current week' },
  { value: '1', label: 'Next week', hint: 'The week after' },
  { value: 'both', label: 'Both weeks', hint: 'The whole fortnight, one week under the other' },
];
const SHOW_OPTIONS: DropdownOption<ShowPick>[] = [
  { value: 'all', label: 'Every report', short: 'All', hint: 'Whatever the options charge' },
  { value: 'RICH', label: 'Priced rich', hint: 'Options charge more than 1.3× what the name usually moves' },
  { value: 'INLINE', label: 'Priced fair', hint: 'The charge is close to the usual move' },
  { value: 'CHEAP', label: 'Priced cheap', hint: 'Options charge less than 0.85× the usual move' },
];
const LAYOUT_OPTIONS: DropdownOption<Layout>[] = [
  { value: 'board', label: 'Board', hint: 'Five days across, the known names as cards' },
  { value: 'list', label: 'List', hint: 'Dates down the left, every name as a door' },
];

const WEEKDAYS = [1, 2, 3, 4, 5] as const;
/** The largest names reporting today, as chips in the head */
const TODAY_CHIPS = 8;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The macro calendar's words on the list — the event, not the engine's label */
const MACRO_WORD: Record<string, string> = { 'FOMC decision': 'FOMC', 'NFP release': 'Payrolls', 'CPI release': 'CPI' };

/** The pricing in the page's words: how the options price sits against the usual move */
export const PRICED_WORD: Record<VolState, string> = { RICH: 'rich', INLINE: 'fair', CHEAP: 'cheap' };
export const PRICED_INK: Record<VolState, string> = { RICH: 'text-warn', INLINE: 'text-textPrimary', CHEAP: 'text-bull' };
/* a report whose time the feed does not have is not "after the close" */
export const slotWord = (e: { slot: EarningsEvent['slot']; timeKnown?: boolean }) => (e.timeKnown === false ? 'time not set' : e.slot === 'BMO' ? 'before the open' : 'after the close');
/** How many past moves the usual move averages */
const histN = (e: EarningsEvent) => (e.history === false ? 0 : e.histCount ?? e.pastMoves.length);
/** A usual move exists: at least one past move on file */
const usualKnown = (e: EarningsEvent) => histN(e) > 0 && e.histAvgMovePct > 0;
/** Rich, fair or cheap: enough past moves, and the report not out yet (a reported row carries its move, not a price) */
const pricedKnown = (e: EarningsEvent) => !e.reported && histN(e) >= MIN_PRICED_PRINTS && e.richness > 0;
const priceInk = (e: EarningsEvent) => (pricedKnown(e) ? PRICED_INK[stateOf(e)] : 'text-textPrimary');

/** The slot as a mark: dawn amber before the open, the moon after the close */
export const SlotMark = ({ slot, className = 'w-3 h-3', timeKnown }: { slot: EarningsEvent['slot']; className?: string; timeKnown?: boolean }) =>
  timeKnown === false ? <span className={`${className} inline-block rounded-full border border-textMuted/60`} aria-label="time not set" title="The report's time is not set" /> : slot === 'BMO' ? <Sunrise className={`${className} text-warn`} aria-label="before the open" /> : <Moon className={`${className} text-moon`} aria-label="after the close" />;

/** Set by the company, or still an analyst's estimate — the same two words everywhere on the page */
const SetTag = ({ confirmed }: { confirmed: boolean }) => <span className={`font-mono text-t8 uppercase tracking-widest ${confirmed ? 'text-textMuted' : 'text-warn'}`} title={confirmed ? 'The company has set the date' : "The date is our data provider's estimate — the company has not set it"}>{confirmed ? 'confirmed' : 'date estimated'}</span>;

/* ---- the list's doors and chips ---------------------------------------------------- */

/** The asked name's door or card wears the where-you-are ring */
const askedRing = (on: boolean) => (on ? 'border-silver/60 shadow-[0_0_0_1px_rgb(var(--silver)/0.35)]' : '');

/** A name on the list: the mark, the ticker, our move, its slot, the company — one door to its page */
const NameDoor = ({ e, onOpen, asked }: { e: EarningsEvent; onOpen: (t: string) => void; asked?: boolean }) => (
  <button
    type="button"
    onClick={() => onOpen(e.ticker)}
    title={`${e.name} — options price ${moveText(e)}, ${slotWord(e)} · open its page`}
    className={`group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-borderSubtle hover:bg-silver/[0.05] transition-colors text-left ${askedRing(!!asked)}`}
    data-earnings-door={e.ticker}
    data-known={e.known || undefined}
    data-asked={asked || undefined}
  >
    <CompanyLogo ticker={e.ticker} size={22} />
    <span className="flex flex-col leading-tight">
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-t12 font-bold text-textPrimary">{e.ticker}</span>
        <span className={`font-mono text-t11 tnum ${e.reported ? moveInk(e) : e.impliedMovePct > 0 ? priceInk(e) : 'text-textMuted'}`}>{moveText(e)}</span>
        <SlotMark slot={e.slot} timeKnown={e.timeKnown} />
      </span>
      <span className="text-t10 text-textMuted truncate max-w-[180px]">{e.name}</span>
    </span>
  </button>
);

/** A macro date on the list — a quiet chip */
const MacroChip = ({ m }: { m: MacroDate }) => (
  <span title={m.detail} className="inline-flex items-center self-center h-6 rounded-md border border-borderSubtle bg-chip px-2 font-mono text-t9 uppercase tracking-widest text-textSecondary whitespace-nowrap" data-earnings-macro>
    {MACRO_WORD[m.label] ?? m.label}
  </span>
);

/** The board's cell: the mark, the ticker, our move, whether the date is set */
/* a card or grid row asks for its name's past reports once it comes into view; one observer for the page */
const seenNames = new Set<string>();
const seenStore = createStore(0);
let seenTimer: number | null = null;
const markSeen = (t: string) => {
  if (seenNames.has(t)) return;
  seenNames.add(t);
  if (seenTimer != null) return;
  seenTimer = window.setTimeout(() => {
    seenTimer = null;
    seenStore.set(n => n + 1);
  }, 300);
};
let seenIo: IntersectionObserver | null = null;
const seenObserver = (): IntersectionObserver | null => {
  if (typeof IntersectionObserver === 'undefined') return null;
  seenIo ??= new IntersectionObserver(
    entries => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target as HTMLElement;
        const t = el.dataset.seenName;
        /* a card that stays — the first paint of a week the board turns away from at once (Friday's, before "opens
           on next week") is not a card the reader saw */
        if (t) window.setTimeout(() => {
          if (el.isConnected) markSeen(t);
        }, 600);
        seenIo?.unobserve(el);
      }
    },
    { rootMargin: '0px' }
  );
  return seenIo;
};
function useSeenRef<T extends HTMLElement>(ticker: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || seenNames.has(ticker)) return;
    const io = seenObserver();
    if (!io) {
      markSeen(ticker);
      return;
    }
    el.dataset.seenName = ticker;
    io.observe(el);
    return () => io.unobserve(el);
  }, [ticker]);
  return ref;
}
function useSeenNames(): string[] {
  const rev = useStore(seenStore);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => [...seenNames].sort(), [rev]);
}
/** The Priced tile's sample: the largest known names still to report, read whatever is on screen, said plainly */
const PRICED_SAMPLE = 20;

const Card = ({ e, onOpen, asked }: { e: EarningsEvent; onOpen: (t: string) => void; asked?: boolean }) => {
  const ref = useSeenRef<HTMLButtonElement>(e.ticker);
  return (
  <button
    ref={ref}
    type="button"
    onClick={() => onOpen(e.ticker)}
    title={`${e.name} — options price ${moveText(e)}, ${slotWord(e)} · open its page`}
    className={`group relative flex flex-col items-center gap-1.5 rounded-md border border-borderSubtle bg-chip px-2 pt-3 pb-2.5 transition-colors hover:border-borderMuted hover:bg-silver/[0.05] ${askedRing(!!asked)}`}
    data-earnings-card={e.ticker}
    data-asked={asked || undefined}
  >
    <CompanyLogo ticker={e.ticker} size={28} />
    <span className="font-mono text-t12 font-bold text-textPrimary leading-none mt-0.5">{e.ticker}</span>
    <span className={`font-mono text-t11 tnum leading-none ${e.reported ? moveInk(e) : pricedKnown(e) ? priceInk(e) : 'text-textMuted'}`}>{/* the move the options charge is known before the history lands; only rich/cheap waits on it */}{moveText(e)}</span>
    <SetTag confirmed={e.confirmed} />
  </button>
  );
};

/* ---- the Name card -------------------------------------------------------------------- */

/** Ask for a name: it opens the full listing's search (TickerLookup) and the answer stands under the line. */
const NameAsk = ({ asked, onAsk }: { asked: string | null; onAsk: (t: string) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-dropdown="earnings-name"
          aria-label={`Name: ${asked ?? 'any name'}`}
          title="Any ticker — when it reports next"
          className="group inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono select-none"
        >
          <Search className="w-3 h-3 shrink-0 text-textMuted" aria-hidden="true" />
          <span className="shrink-0 text-t9 uppercase tracking-widest text-textMuted">Name</span>
          <span className={`min-w-0 truncate text-t11 font-semibold ${asked ? 'text-textPrimary' : 'text-textSecondary'}`}>{asked ?? 'Any name'}</span>
          <ChevronDown className="w-3 h-3 shrink-0 text-textMuted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={`${CARD} w-[272px] p-0 overflow-hidden`} data-dropdown-card="earnings-name">
          <div className="px-3.5 pt-2.5 pb-1 font-mono text-t9 uppercase tracking-widest text-textMuted">When a name reports next</div>
          <TickerLookup
            active={asked ?? undefined}
            onPick={t => {
              onAsk(t);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

/** the answer: the name, the date, the slot, set or estimated, the options price when the fortnight holds it */
const Answer = ({ next, inWindow, onOpen, onClear }: { next: NextReport; inWindow: boolean; onOpen: (t: string) => void; onClear: () => void }) => {
  const navigate = useNavigate();
  const door = 'font-semibold text-textPrimary hover:text-silver transition-colors';
  return (
    <p className="px-5 pb-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-t12 leading-relaxed text-textSecondary" data-earnings-answer={next.ticker} data-answer-set={next.confirmed ? 'confirmed' : 'estimated'} data-answer-in-window={next.event ? 'yes' : 'no'}>
      <CompanyLogo ticker={next.ticker} size={16} />
      <span className="font-mono text-t12 font-bold text-textPrimary">{next.ticker}</span>
      {next.name !== next.ticker && <span className="text-textMuted">{next.name}</span>}
      <span className="text-textMuted">·</span>
      <span>
        reports <span className="font-mono tnum text-textPrimary">{next.dateLabel}</span>
        <span className="text-textMuted">{` · ${untilWords(next.daysOut)}`}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <SlotMark slot={next.slot} timeKnown={next.event?.timeKnown} className="w-2.5 h-2.5" />
        {slotWord(next)}
      </span>
      <SetTag confirmed={next.confirmed} />
      {!inWindow ? (
        <>
          <span className="text-warn">— outside this window, the board is not cut to it</span>
          <span className="text-textMuted">·</span>
          <button type="button" onClick={() => onOpen(next.ticker)} className={door} data-earnings-answer-door>
            Its earnings page
          </button>
        </>
      ) : next.event ? (
        <>
          <span className="text-textMuted">·</span>
          <span>
            {next.event.impliedMovePct > 0 ? (
              <>
                the options price <span className={`font-mono tnum ${priceInk(next.event)}`}>±{next.event.impliedMovePct.toFixed(1)}%</span>
              </>
            ) : (
              <span className="text-textMuted">no options price on the row yet</span>
            )}
          </span>
          <span className="text-textMuted">·</span>
          <button type="button" onClick={() => onOpen(next.ticker)} className={door} data-earnings-answer-door>
            Open its page
          </button>
        </>
      ) : (
        <>
          <span className="text-textMuted">· the options price is read inside the fortnight</span>
          <span className="text-textMuted">·</span>
          <button type="button" onClick={() => navigate(`/dossier/stocks/${next.ticker}`)} className={door} data-earnings-answer-door>
            Its stock page
          </button>
        </>
      )}
      <button type="button" onClick={onClear} title="Clear the name" aria-label="Clear the name" className="inline-flex items-center justify-center w-5 h-5 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-earnings-answer-clear>
        <X className="w-3 h-3" />
      </button>
    </p>
  );
};

/* ---- the grid's cells --------------------------------------------------------------- */

const NameCell = ({ data }: ICellRendererParams<EarningsEvent>) => (data ? <NameCellIn data={data} /> : null);
const NameCellIn = ({ data }: { data: EarningsEvent }) => {
  const ref = useSeenRef<HTMLSpanElement>(data.ticker);
  return (
    <span ref={ref} className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
        <span className="text-t10 text-textMuted truncate">{data.name}</span>
      </span>
    </span>
  );
};

const WhenCell = ({ data }: ICellRendererParams<EarningsEvent>) =>
  data ? (
    <span className="flex flex-col leading-tight">
      <span className="font-mono text-t11 tnum text-textPrimary">
        {data.dateLabel} <span className="text-textMuted">· {untilWords(data.daysOut)}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-t10">
        <SlotMark slot={data.slot} timeKnown={data.timeKnown} className="w-2.5 h-2.5" />
        <span className="text-textSecondary">{slotWord(data)}</span>
        <SetTag confirmed={data.confirmed} />
      </span>
    </span>
  ) : null;

const IvCell = ({ data }: ICellRendererParams<EarningsEvent>) => (data ? pricedKnown(data) && data.ivRank > 0 ? <span className={`font-mono text-t11 tnum ${data.ivRank >= 80 ? 'text-warn' : 'text-textPrimary'}`}>{data.ivRank}</span> : <span className="font-mono text-t11 text-textMuted">—</span> : null);
/* a report with no straddle on the row (KARO's ±0.0%) is not priced — it says so; a report that is out shows the move the
   stock made, not the one the options had priced */
const signedPct = (v: number) => signedPctOf(v, 1);
/* the session that reacts to a report, on the feed's one holiday-aware rule */
const reactionSession = (e: EarningsEvent): string => e.reactionIso ?? (e.iso ? reactionIsoOf(e.iso, e.slot, e.timeKnown !== false) : '');
const reactionLive = (e: EarningsEvent): boolean => {
  if (!e.reported || e.actualMovePct == null) return false;
  const m = nyMinutes();
  return reactionSession(e) === nyTodayIso() && m >= 4 * 60 && m < 16 * 60;
};
const moveText = (e: EarningsEvent) => (e.reported ? (e.actualMovePct != null ? (reactionLive(e) ? `${signedPct(e.actualMovePct)} so far` : `moved ${signedPct(e.actualMovePct)}`) : 'reported') : e.impliedMovePct > 0 ? `±${e.impliedMovePct.toFixed(1)}%` : '—');
/** The grid's move column, per row: what the options price before the print, the move the stock made (or is making) after */
const moveCellText = (e: EarningsEvent) =>
  e.reported ? (e.actualMovePct != null ? (reactionLive(e) ? `${signedPct(e.actualMovePct)} so far` : `moved ${signedPct(e.actualMovePct)}`) : 'reported') : e.impliedMovePct > 0 ? `±${e.impliedMovePct.toFixed(1)}% priced` : 'not priced';
const moveInk = (e: EarningsEvent) => (e.reported ? (e.actualMovePct == null ? 'text-textMuted' : e.actualMovePct > 0 ? 'text-bull' : e.actualMovePct < 0 ? 'text-bear' : 'text-textPrimary') : '');
const MoveCell = ({ data }: ICellRendererParams<EarningsEvent>) =>
  data ? (
    <span className="flex flex-col items-end leading-tight" title={data.reported ? `Reported — ${reactionLive(data) ? 'the move so far in the session reacting to it' : 'the move the stock made the session after'}; the options had priced ±${data.impliedMovePct.toFixed(1)}%` : 'The move the options charge for the print — the at-the-money straddle as a percent of the stock'}>
      <span className={`font-mono text-t11 tnum font-semibold ${data.reported ? moveInk(data) : data.impliedMovePct > 0 ? 'text-textPrimary' : 'text-textMuted'}`}>{moveCellText(data)}</span>
      {data.reported && data.impliedMovePct > 0 ? <span className="font-mono text-t9 tnum text-textMuted">priced ±{data.impliedMovePct.toFixed(1)}%</span> : null}
    </span>
  ) : null;
const UsualCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  if (data.history === false) return data.known ? <span className="font-mono text-t11 text-textMuted" title="Reading the name's past reports">…</span> : <span className="font-mono text-t11 text-textMuted" title="The board reads the past reports of the known names; this name's are on its own page">—</span>;
  if (!usualKnown(data)) return <span className="font-mono text-t11 text-textMuted" title={data.classOf ? `A second share class — its reports are filed under ${data.classOf}` : 'No past move on file for this name'}>{data.classOf ? `see ${data.classOf}` : 'no history'}</span>;
  const n = histN(data);
  return (
    <span className="font-mono text-t11 tnum text-textSecondary" title={`The average move the session after its last ${n} ${n === 1 ? 'report' : 'reports'}`}>
      ±{data.histAvgMovePct.toFixed(1)}%{n < 8 ? <span className="text-t9 text-textMuted"> · {n} {n === 1 ? 'print' : 'prints'}</span> : null}
    </span>
  );
};
const PricedCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  if (!pricedKnown(data))
    return (
      <span className="font-mono text-t11 text-textMuted" title={data.reported ? 'Reported — the move is in, so the premium is no longer priced' : usualKnown(data) ? `From ${histN(data)} ${histN(data) === 1 ? 'print' : 'prints'} — rich or cheap needs ${MIN_PRICED_PRINTS}` : 'No usual move to set the price against'}>
        —
      </span>
    );
  const s = stateOf(data);
  return (
    <span className={`font-mono text-t11 tnum ${PRICED_INK[s]}`}>
      {richText(data.richness)}× <span className="text-t9 uppercase tracking-widest">{PRICED_WORD[s]}</span>
    </span>
  );
};
/* beat, in line and miss over the reports with both an actual and an estimate */
const BeatCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  const b = data.beatCount ?? 0;
  const i = data.inlineCount ?? 0;
  const m = data.missCount ?? 0;
  const n = b + i + m;
  if (data.history === false || !n) return <span className="font-mono text-t11 text-textMuted">—</span>;
  return (
    <span className="font-mono text-t11 tnum text-textPrimary" title={`Of the last ${n} reports with an estimate: ${b} beat, ${i} in line, ${m} missed`}>
      <span className="text-bull">{b}</span>
      <span className="text-textMuted">·</span>
      {i}
      <span className="text-textMuted">·</span>
      <span className="text-bear">{m}</span>
    </span>
  );
};
/* ---- the page ----------------------------------------------------------------------- */

const Earnings = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  /* every report, the known names marked; a name on the reader's own board counts as known */
  const live = useEveryReport();
  /* the reacting session's move so far, off the live price */
  useLiveReactions(live);
  const pending = useEarningsPending();
  const keptAt = useEarningsKeptAt();
  const failed = useEarningsFailed();
  const events = useMemo(() => {
    const mine = new Set(boardNames.map(t => t.toUpperCase()));
    return live.map(e => (e.known || !mine.has(e.ticker) ? e : { ...e, known: true }));
  }, [live, boardNames]);
  const knownEvents = useMemo(() => events.filter(e => e.known), [events]);
  /* the Fed's published FOMC dates and payrolls Friday; the CPI date the engine can only approximate stays off the board */
  const macro = useMemo(() => macroWindow(new Date(), 10, 20).filter(m => !/approximated/i.test(m.detail)), []);
  const [week, setWeekRaw] = useState<WeekPick>('0');
  /* Once the lists are in, a this-week with no report left opens on next week; a reader's own pick is never overridden. */
  const [weekTouched, setWeekTouched] = useState(false);
  const setWeek = (w: WeekPick) => {
    setWeekTouched(true);
    setWeekRaw(w);
  };
  /* last week is read on the reader's ask — ten list calls, never on a cold visit */
  const lastWeek = useLastWeekStatus();
  useEffect(() => {
    if (week === '-1') ensureLastWeek();
  }, [week]);
  const weekend = nyWeekend();
  const weekPending = pending || (week === '-1' && lastWeek !== 'live' && lastWeek !== 'sim');
  const thisWeekLeft = useMemo(() => events.filter(e => e.weekIdx === 0 && !e.reported), [events]);
  const thisWeekKnownLeft = useMemo(() => thisWeekLeft.filter(e => e.known).length, [thisWeekLeft]);
  const nextWeekCount = useMemo(() => events.filter(e => e.weekIdx === 1).length, [events]);
  const [autoNext, setAutoNext] = useState(false);
  useEffect(() => {
    if (weekTouched || pending || failed || !events.length) return;
    if (thisWeekLeft.length === 0 && nextWeekCount > 0 && week === '0') {
      setWeekRaw('1');
      setAutoNext(true);
    }
  }, [weekTouched, pending, failed, events.length, thisWeekLeft.length, nextWeekCount, week]);
  const [show, setShow] = useState<ShowPick>('all');
  const [layout, setLayout] = useState<Layout>('board');
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  /* the name asked for, and its answer */
  const [asked, setAsked] = useState<string | null>(null);
  const next = useNextReport(asked);
  const nextPending = useNextReportPending(asked);

  /* a name in the fortnight keeps the board, the list and the grid to it; one outside it is said under the line */
  /* in the window only when its NEXT report is (TSLA reported on Wednesday; its next is 01/27, outside) */
  const askedIn = asked != null && !!next && events.some(e => e.ticker === asked && e.iso === next.iso);
  const shown = useMemo(() => {
    const cut = (show === 'all' ? events : events.filter(e => pricedKnown(e) && stateOf(e) === show)).filter(e => week === 'both' || String(e.weekIdx) === week);
    const named = askedIn ? cut.filter(e => e.ticker === asked) : cut;
    /* still to report first, soonest first; the reports already out follow, newest first */
    /* within a day the known and the largest names first */
    /* within a day: before the open, then after the close, then time not set */
    const slotRank = (e: EarningsEvent) => (e.timeKnown === false ? 2 : e.slot === 'BMO' ? 0 : 1);
    return [...named].sort((a, b) => Number(!!a.reported) - Number(!!b.reported) || (a.reported ? b.daysOut - a.daysOut : a.daysOut - b.daysOut) || slotRank(a) - slotRank(b) || Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0) || b.impliedMovePct - a.impliedMovePct);
  }, [events, show, askedIn, asked, week]);
  /* every row goes into the grid and its own pagination pages it, so a sort runs over every report */
  const paged = usePagedGrid<EarningsEvent>();
  useEffect(() => {
    paged.props.ref.current?.api?.paginationGoToPage(0);
  }, [week, show, asked, paged.props.ref]);
  /* the pricing facts are told over the known names still to report whose usual move is in — a print that is out is
     not priced any more, and a count that grows as histories land says how many are in */
  /* the head counts `shown` — the same cut as the board, not the whole week after Show or a name filter */
  const weekEvents = shown;
  const weekKnown = shown.filter(e => e.known);
  const ahead = weekKnown.filter(e => !e.reported);
  /* the week's known names whose past reports have not landed: one stated set, the same the head counts */
  /* the priced counts are over a stated sample: the largest known names still to report */
  const sample = useMemo(() => [...ahead].sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0)).slice(0, PRICED_SAMPLE), [ahead]);
  const sampled = ahead.length > sample.length;
  const weekHistOut = sample.filter(e => e.history === false && !historyMissed(e.ticker)).length;
  const scored = sample.filter(pricedKnown);
  const cover = useEarningsCoverage();
  const rich = scored.filter(e => stateOf(e) === 'RICH').length;
  const cheap = scored.filter(e => stateOf(e) === 'CHEAP').length;
  const fair = scored.length - rich - cheap;
  const pricedPool = sample.filter(e => e.impliedMovePct > 0);
  const biggest = pricedPool.reduce<EarningsEvent | null>((a, e) => (a === null || e.impliedMovePct > a.impliedMovePct ? e : a), null);
  const todayAll = rankEvents(shown.filter(e => e.daysOut === 0 && e.iso === nyTodayIso()));
  const seen = useSeenNames();
  useEarningsHistories([...sample.map(e => e.ticker), ...seen, ...(show !== 'all' ? ahead.map(e => e.ticker) : [])]);

  const weeks: (-1 | 0 | 1)[] = week === 'both' ? [0, 1] : [Number(week) as -1 | 0 | 1];
  const weekWords = week === 'both' ? 'over two weeks' : week === '-1' ? 'last week' : week === '0' ? (weekend ? 'the coming week' : 'this week') : 'next week';
  const open = (t: string) => navigate(`/dossier/earnings/${t}`);
  /* a name asked for inside the fortnight: the week turns to its page, its card wears the ring */
  const ask = (t: string) => {
    setAsked(t);
    const ev = events.find(e => e.ticker === t);
    if (ev && week !== 'both' && String(ev.weekIdx) !== week) setWeek(String(ev.weekIdx) as WeekPick);
  };

  const sentence = useMemo(() => {
    const parts = [
      `${weekEvents.length.toLocaleString('en-US')} reports ${weekWords}, ${weekKnown.length.toLocaleString('en-US')} of them known names, ${ahead.length.toLocaleString('en-US')} of those still to report`,
      ahead.length === 0
        ? 'nothing is left to price — a report that is out carries its move instead'
        : `of ${sampled ? `the ${sample.length} largest of them` : 'those'}, ${scored.length} with at least ${MIN_PRICED_PRINTS} past moves on file${weekHistOut ? ` (histories ${sample.length - weekHistOut} of ${sample.length} read so far)` : ''}: ${rich} priced rich, ${fair} fair, ${cheap} cheap`,
    ];
    if (biggest) parts.push(`the biggest move priced among the largest known names is ${biggest.ticker} at ±${biggest.impliedMovePct.toFixed(1)}% on ${biggest.dateLabel}`);
    if (cover.missed) parts.push(`${cover.missed} of the ${cover.slots} day lists did not answer, so the count is short`);
    return parts.join(' · ') + '.';
  }, [weekEvents.length, weekKnown.length, weekWords, ahead.length, scored.length, sample.length, sampled, weekHistOut, cover, rich, fair, cheap, biggest]);

  const columnDefs = useMemo<ColDef<EarningsEvent>[]>(
    () => [
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 180, cellRenderer: NameCell, headerTooltip: 'The company — click the row to open its page' },
      { headerName: 'Reports', field: 'daysOut', width: 210, cellRenderer: WhenCell, headerTooltip: 'The date, before the open or after the close, and whether the company has confirmed it or it is still an estimate' },
      { headerName: 'Priced · or moved', colId: 'impliedMovePct', width: 140, cellRenderer: MoveCell,
        /* the cell's own text is its value, so it re-renders when the live reaction lands; it sorts on the implied move */
        valueGetter: p => (p.data ? `${moveCellText(p.data)}|${p.data.impliedMovePct}` : ''),
        comparator: (_a, _b, na, nb) => (na.data?.impliedMovePct ?? 0) - (nb.data?.impliedMovePct ?? 0), type: 'rightAligned', headerTooltip: 'Before the print, the move the options charge; after it, the move the stock made (or is making, "so far")' },
      { headerName: 'Usually moves', field: 'histAvgMovePct', width: 136, cellRenderer: UsualCell, type: 'rightAligned', headerTooltip: 'The average move the session after its last eight reports — or fewer, said beside it, when fewer are on file' },
      { headerName: 'Priced', field: 'richness', width: 124, cellRenderer: PricedCell, type: 'rightAligned', headerTooltip: 'The options price over the usual move — rich above 1.3×, cheap below 0.85×, fair between' },
      { headerName: 'Beat · in line · miss', field: 'beatRate8q', width: 130, cellRenderer: BeatCell, type: 'rightAligned', headerTooltip: 'Of the last eight reports that carry both an actual and an estimate: how many beat, came in line (equal to the cent) and missed' },
      { headerName: 'IV rank', field: 'ivRank', width: 92, cellRenderer: IvCell, type: 'rightAligned', headerTooltip: 'Where implied volatility sits against its own past year, 0 to 100 — 80 and up is dear' },
    ],
    []
  );
  const defaultColDef = useMemo<ColDef<EarningsEvent>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);
  const onRow = (e: RowClickedEvent<EarningsEvent>) => {
    if (e.data) open(e.data.ticker);
  };

  return (
    <>
      {/* BOX 1 — WHO REPORTS */}
      <div className="relative border border-borderSubtle rounded-md bg-panel" data-earnings data-week={week} data-show={show} data-layout={layout} data-asked={asked ?? undefined} data-known={knownEvents.length} data-reports={events.length}>
        <RecordHead
          title="Who reports"
          guide={{ title: 'How to read the calendar', door: 'What the doors, the price and the words mean', testId: 'earnings-guide', body: <EarningsGuide /> }}
          kept={keptAt}
          line="The fortnight's reports · a priced name shows the move its options charge"
          facts={
            <>
            <Fact label="Reports" testId="reports">
              {failed ? <span className="text-textMuted">—</span> : weekPending ? <span className="text-textMuted">reading the lists…</span> : <>{weekEvents.length.toLocaleString('en-US')} <span className="text-textMuted">· {weekWords} ·</span> {weekKnown.length.toLocaleString('en-US')} <span className="text-textMuted">known names</span>{cover.missed ? <span className="text-warn" title={`${cover.missed} of the ${cover.slots} day lists did not answer`}> · short</span> : null}</>}
            </Fact>
            <Fact label="Priced" testId="priced">
              {failed ? (
                <span className="text-textMuted">—</span>
              ) : weekPending ? (
                <span className="text-textMuted">reading the lists…</span>
              ) : ahead.length === 0 ? (
                /* nothing left to price is not "reading" */
                <span className="text-textMuted" title={`Every known name ${weekWords} has reported — a report that is out is not priced any more`}>nothing left to price {weekWords}</span>
              ) : scored.length === 0 ? (
                <span className="text-textMuted">{weekHistOut > 0 ? `reading the usual moves · ${sample.length - weekHistOut} of ${sample.length}` : `none with ${MIN_PRICED_PRINTS}+ past moves on file`}</span>
              ) : (
                <span title={`${sampled ? `The ${sample.length} largest of the ${ahead.length} known names` : 'Known names'} still to report ${weekWords}, with at least ${MIN_PRICED_PRINTS} past moves on file: ${scored.length} of ${sample.length}. A name with fewer, or none, is not called rich or cheap. Rich: the options charge more than 1.3× the usual move; cheap: under 0.85×; fair between`}>
                  {/* the count says it is still counting */}
                  {weekHistOut > 0 && <span className="text-warn" title="The known names' past reports are read a few at a time; the counts grow until every one is in" data-earnings-priced-reading>reading {sample.length - weekHistOut} of {sample.length} · so far </span>}
                  <span className={weekHistOut > 0 ? 'opacity-60' : ''}>
                    <span className="text-warn">{rich} rich</span> <span className="text-textMuted">·</span> {fair} fair <span className="text-textMuted">·</span> <span className="text-bull">{cheap} cheap</span>
                    <span className="text-textMuted"> · of {scored.length}{sampled ? ` · the ${sample.length} largest of ${ahead.length}` : ''}</span>
                  </span>
                </span>
              )}
              {/* the colours' key, whatever the count says */}
              {!failed && !pending && (
                <span className="block text-t9 font-sans text-textMuted" data-earnings-legend>
                  <span className="text-warn">rich</span> over 1.3× the usual move · fair between · <span className="text-bull">cheap</span> under 0.85×
                </span>
              )}
            </Fact>
            <Fact label="Biggest priced move" testId="biggest">
              {biggest ? (
                <>
                  {biggest.ticker} ±{biggest.impliedMovePct.toFixed(1)}% <span className="text-textMuted">· {biggest.dateLabel} · the largest known names, {weekWords}</span>
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
            <Fact label="Today" testId="today">
              {todayAll.length ? (
                <span className="flex flex-wrap items-center gap-1.5 max-w-[34rem]" data-earnings-today={todayAll.length}>
                  {todayAll.slice(0, TODAY_CHIPS).map(e => (
                    <button key={e.ticker} type="button" onClick={() => open(e.ticker)} title={`${e.name} · ${slotWord(e)}`} className="inline-flex items-center gap-1 h-6 px-1.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted transition-colors" data-earnings-today-chip={e.ticker}>
                      <CompanyLogo ticker={e.ticker} size={12} />
                      <span className="font-bold text-textPrimary">{e.ticker}</span>
                      {e.timeKnown !== false && <span className="text-t9 text-textMuted">{e.slot === 'BMO' ? 'pre' : 'post'}</span>}
                    </button>
                  ))}
                  {todayAll.length > TODAY_CHIPS && (
                    <button type="button" onClick={() => setLayout('list')} className="text-t11 text-textMuted hover:text-textPrimary transition-colors" data-earnings-today-more>
                      +{todayAll.length - TODAY_CHIPS} more →
                    </button>
                  )}
                </span>
              ) : (
                <span className="text-textMuted">{failed ? '—' : pending ? 'reading the day' : 'nothing reports'}</span>
              )}
            </Fact>
            </>
          }
        />
        <PhoneFold label="Week, filters and summary" testId="earnings">
        <Controls testId="earnings">
          <DropdownSelect label="Week" value={week} options={WEEK_OPTIONS} onChange={setWeek} title="Which week" testId="earnings-week" />
          <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="How the options price sits" testId="earnings-show" />
          <DropdownSelect label="Layout" value={layout} options={LAYOUT_OPTIONS} onChange={setLayout} title="The week as a board of the known names, or a list of every report" testId="earnings-layout" />
          <NameAsk asked={asked} onAsk={ask} />
        </Controls>
        {next && <Answer next={next} inWindow={askedIn} onOpen={open} onClear={() => setAsked(null)} />}
        {asked && !next && (
          <p className="px-5 pb-2 text-t12 text-textSecondary" data-earnings-answer-pending>
            {nextPending ? `Reading when ${asked} reports…` : `${asked} has no report dated today or later on file.`}
          </p>
        )}
        {failed ? <FeedFallback /> : <Summary testId="earnings">{pending ? 'Reading the fortnight.' : weekPending ? "Reading last week's lists." : sentence}</Summary>}
        </PhoneFold>
        {!pending && !failed && autoNext && week === '1' && (
          <p className="px-5 pb-3 -mt-1 text-t11 text-textMuted" data-earnings-week-note>
            Every report this week is out, so the board opens on next week.{' '}
            <button type="button" onClick={() => setWeek('0')} className="font-semibold text-textSecondary hover:text-textPrimary transition-colors">
              See this week's results
            </button>
          </p>
        )}
        {/* on a weekend last week is a click away */}
        {!pending && !failed && weekend && week === '0' && (
          <p className="px-5 pb-3 -mt-1 text-t11 text-textMuted" data-earnings-week-note="weekend">
            On a weekend the board opens on the coming week.{' '}
            <button type="button" onClick={() => setWeek('-1')} className="font-semibold text-textSecondary hover:text-textPrimary transition-colors" data-earnings-last-week>
              See last week's results
            </button>
          </p>
        )}
        {!pending && !failed && week === '-1' && (
          <p className="px-5 pb-3 -mt-1 text-t11 text-textMuted" data-earnings-week-note="last">
            {lastWeek === 'live' || lastWeek === 'sim' ? (lastWeek === 'sim' ? "Last week's lists did not answer." : 'Last week — every report is out, each with the move the stock made the session after.') : "Reading last week's lists…"}{' '}
            <button type="button" onClick={() => setWeek('0')} className="font-semibold text-textSecondary hover:text-textPrimary transition-colors">
              {weekend ? 'Back to the coming week' : 'Back to this week'}
            </button>
          </p>
        )}
        {!pending && !failed && week === '0' && !weekend && thisWeekKnownLeft === 0 && nextWeekCount > 0 && (
          <p className="px-5 pb-3 -mt-1 text-t11 text-textMuted" data-earnings-week-note>
            Every known name this week has reported{thisWeekLeft.length ? ` — ${thisWeekLeft.length} smaller ${thisWeekLeft.length === 1 ? 'name is' : 'names are'} still to come` : ''}; next week holds {nextWeekCount.toLocaleString('en-US')} reports.{' '}
            <button type="button" onClick={() => setWeek('1')} className="font-semibold text-textSecondary hover:text-textPrimary transition-colors" data-earnings-next-week>
              Go to next week
            </button>
          </p>
        )}

        {/* the week: the board, or a list of days; a failed read shows no empty days */}
        {failed ? null : pending || (week === '-1' && (lastWeek === 'idle' || lastWeek === 'loading')) ? (
          <div className="border-t border-borderSubtle" data-earnings-pending>
            <TableSkeleton rows={6} />
          </div>
        ) : layout === 'list' ? (
          <div key={`list-${week}-${show}`} className="border-t border-borderSubtle animate-soft-in" data-earnings-list>
            {weeks.map(weekIdx =>
              WEEKDAYS.map(wd => {
                const date = weekDayDate(weekIdx, wd);
                const { isToday } = weekDayLabel(weekIdx, wd);
                const iso = isoOf(date);
                const dayKey = `${weekIdx}-${wd}`;
                const opened = !!openDays[dayKey];
                const dayEvents = rankEvents(shown.filter(e => e.weekIdx === weekIdx && e.weekday === wd));
                const doors = opened ? dayEvents : dayEvents.slice(0, LIST_CAP);
                const more = dayEvents.length - doors.length;
                const dayMacro = macro.filter(m => m.iso === iso);
                const past = !isToday && date.getTime() < new Date().setHours(0, 0, 0, 0);
                return (
                  <div
                    key={`${weekIdx}-${wd}`}
                    className={`flex items-stretch border-b border-borderSubtle/60 last:border-0 min-h-[58px] ${isToday ? 'bg-silver/[0.04] shadow-[inset_2px_0_0_0_rgba(199,211,232,0.7)]' : ''} ${past ? 'opacity-50' : ''}`}
                    data-earnings-day={iso}
                    data-today={isToday || undefined}
                  >
                    <div className="w-28 shrink-0 px-5 py-3 border-r border-borderSubtle/60 flex flex-col justify-center">
                      <span className={`font-mono text-t14 font-bold leading-none tnum ${isToday ? 'text-silver' : 'text-textPrimary'}`}>
                        {MONTHS[date.getMonth()]} {date.getDate()}
                      </span>
                      <span className={`mt-1 font-mono text-t9 uppercase tracking-widest ${isToday ? 'text-silver' : 'text-textMuted'}`}>{isToday ? 'today' : DAYS[date.getDay()]}</span>
                      {dayEvents.length > 0 && (
                        <span className="mt-1 font-mono text-t9 tnum text-textMuted" data-earnings-day-count>
                          {dayEvents.length} {dayEvents.length === 1 ? 'report' : 'reports'}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                      {doors.map(e => (
                        <NameDoor key={e.ticker} e={e} onOpen={open} asked={e.ticker === asked} />
                      ))}
                      {more > 0 && (
                        <button type="button" onClick={() => setOpenDays(d => ({ ...d, [dayKey]: true }))} className="px-1 font-mono text-t9 uppercase tracking-widest text-textMuted hover:text-textPrimary" data-earnings-list-more={more}>
                          + {more} more
                        </button>
                      )}
                      {opened && dayEvents.length > LIST_CAP && (
                        <button type="button" onClick={() => setOpenDays(d => ({ ...d, [dayKey]: false }))} className="px-1 font-mono text-t9 uppercase tracking-widest text-textMuted hover:text-textPrimary">
                          Show fewer
                        </button>
                      )}
                      {dayMacro.map(m => (
                        <MacroChip key={m.iso + m.label} m={m} />
                      ))}
                      {dayEvents.length === 0 && dayMacro.length === 0 && <span className="px-2 font-mono text-t9 uppercase tracking-widest text-textMuted">{show === 'all' ? 'nothing on the calendar' : 'none priced this way'}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div
            key={`board-${week}-${show}`}
            /* on a phone the five-day board scrolls sideways at a readable width */
            className="border-t border-borderSubtle animate-soft-in max-lg:overflow-x-auto max-sm:overflow-x-visible min-w-0 max-w-full"
            data-earnings-board
          >
            {weeks.map(weekIdx => (
              /* on a phone the five days stand one under the other */
              <div key={weekIdx} className="grid grid-cols-5 gap-px bg-borderSubtle/60 border-b border-borderSubtle/60 last:border-0 max-lg:min-w-[1000px] max-sm:min-w-0 max-sm:grid-cols-1">
                {WEEKDAYS.map(wd => {
                  const { label, isToday } = weekDayLabel(weekIdx, wd);
                  const dayAll = shown.filter(e => e.weekIdx === weekIdx && e.weekday === wd);
                  const dayKey = `${weekIdx}-${wd}`;
                  const opened = !!openDays[dayKey];
                  const ranked = rankEvents(dayAll);
                  const take = (slot: EarningsEvent['slot'], timed: boolean) => {
                    const all = ranked.filter(e => (timed ? e.timeKnown !== false && e.slot === slot : e.timeKnown === false));
                    const list = opened ? all : all.slice(0, SHELF);
                    return { list, hidden: all.length - list.length };
                  };
                  const bmo = take('BMO', true);
                  const amc = take('AMC', true);
                  const unset = take('AMC', false);
                  const more = bmo.hidden + amc.hidden + unset.hidden;
                  const capped = bmo.list.length + bmo.hidden > SHELF || amc.list.length + amc.hidden > SHELF || unset.list.length + unset.hidden > SHELF;
                  /* the macro calendar's dates under the day's head */
                  const dayMacro = macro.filter(m => m.iso === isoOf(weekDayDate(weekIdx, wd)));
                  const bmoList = bmo.list;
                  const amcList = amc.list;
                  /* each shelf carries its own "+ more" */
                  const shelf = (list: EarningsEvent[], slot: EarningsEvent['slot'], timed = true, hidden = 0) =>
                    list.length === 0 ? null : (
                      <div>
                        <span className="flex items-center gap-1.5 px-1 font-mono text-t9 uppercase tracking-widest text-textSecondary">
                          <SlotMark slot={slot} timeKnown={timed} className="w-2.5 h-2.5" /> {!timed ? 'time not set' : slot === 'BMO' ? 'before the open' : 'after the close'}
                        </span>
                        <div className="mt-1.5 grid grid-cols-2 max-sm:grid-cols-3 gap-1.5">
                          {list.map(e => (
                            <Card key={e.ticker} e={e} onOpen={open} asked={e.ticker === asked} />
                          ))}
                        </div>
                        {hidden > 0 && (
                          <button
                            type="button"
                            onClick={() => setOpenDays(d => ({ ...d, [dayKey]: true }))}
                            title={`The rest of this day ${!timed ? 'with no time set' : slot === 'BMO' ? 'before the open' : 'after the close'}`}
                            className="mt-1.5 px-1 min-h-[24px] max-sm:min-h-[40px] font-mono text-t9 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors"
                            data-earnings-board-more={hidden}
                            data-shelf={!timed ? 'unset' : slot}
                          >
                            + {hidden} more {!timed ? 'time not set' : slot === 'BMO' ? 'before the open' : 'after the close'}
                          </button>
                        )}
                      </div>
                    );
                  return (
                    <div key={wd} className={`bg-panel px-3 py-3 min-h-[176px] max-sm:min-h-0 flex flex-col ${isToday ? 'bg-silver/[0.04]' : ''}`} data-earnings-board-day={label} data-today={isToday || undefined} data-more={more || undefined}>
                      <div className="flex items-center justify-between">
                        <span className={`font-mono text-t11 font-bold tnum ${isToday ? 'text-silver' : 'text-textPrimary'}`}>{label}</span>
                        {isToday && <span className="font-mono text-t8 uppercase tracking-widest text-silver">today</span>}
                      </div>
                      <span className={`block h-px mt-1.5 ${isToday ? 'bg-silver' : 'bg-borderSubtle'}`} />
                      {dayMacro.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5" data-earnings-board-macro>
                          {dayMacro.map(m => (
                            <MacroChip key={m.iso + m.label} m={m} />
                          ))}
                        </div>
                      )}
                      {bmo.list.length + amc.list.length + unset.list.length === 0 ? (
                        dayMacro.length === 0 && more === 0 && <div className="mt-7 text-center font-mono text-t9 uppercase tracking-widest text-textMuted">{show === 'all' ? 'no reports' : 'none priced this way'}</div>
                      ) : (
                        <div className="mt-2.5 flex flex-col gap-3">
                          {shelf(bmoList, 'BMO', true, bmo.hidden)}
                          {shelf(amcList, 'AMC', true, amc.hidden)}
                          {shelf(unset.list, 'AMC', false, unset.hidden)}
                        </div>
                      )}
                      {opened && capped && (
                        <button
                          type="button"
                          onClick={() => setOpenDays(d => ({ ...d, [dayKey]: false }))}
                          title="Back to the names that matter"
                          className="mt-auto pt-3 self-start px-1 font-mono text-t9 uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors"
                        >
                          Show fewer
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BOX 2 — EVERY REPORT, the house grid */}
      <div className="border border-borderSubtle rounded-md overflow-hidden bg-panel" data-earnings-grid>
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-t15 font-semibold leading-tight text-textPrimary">Every report</h3>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
            {week === 'both' ? 'Both weeks' : week === '-1' ? 'Last week' : week === '0' ? (weekend ? 'The coming week' : 'This week') : 'Next week'} · {show === 'all' ? 'every report, the known names and the rest' : `the reports still to come priced ${PRICED_WORD[show]}`} · still to report first, soonest first, then the ones already out with their move · click a row for the name's page
          </p>
        </div>
        <div className="slayer-board border-t border-borderSubtle">
          {pending || (week === '-1' && (lastWeek === 'idle' || lastWeek === 'loading')) ? (
            <TableSkeleton rows={8} />
          ) : (
          <AgGridProvider modules={GRID_MODULES}>
            <AgGridReact<EarningsEvent>
              {...phonePin}
              {...paged.props}
              theme={GRID_THEME}
              domLayout="autoHeight"
              rowData={shown}
              overlayNoRowsTemplate={noRows(failed ? 'This read did not land' : 'No report on this cut')}
              key={failed ? 'failed' : 'live'}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              getRowId={p => `${p.data.ticker}-${p.data.weekIdx}-${p.data.weekday}`}
              onRowClicked={onRow}
              rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
              suppressCellFocus
              suppressAnimationFrame
              rowBuffer={200}
              animateRows
              tooltipShowDelay={350}
              tooltipHideDelay={8000}
            />
          </AgGridProvider>
          )}
          {!pending && paged.bar(shown.length, 'earnings')}
        </div>
      </div>
    </>
  );
};

export default Earnings;
