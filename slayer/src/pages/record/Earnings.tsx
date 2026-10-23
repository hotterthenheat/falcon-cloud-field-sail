/*
==================================================
  SLAYER TERMINAL - EARNINGS (pages/record/Earnings.tsx)

  Who reports when, and what the options charge for
  it — the calendar page under the Record, walked
  into the house grammar (2026-09-09; the old hub's
  composition strip, chip rows and hand-rolled table
  are gone). Two boxes, read top to bottom:

    WHO REPORTS   the head with four facts, one line
                  of cards (Week · Show · Layout ·
                  Name), the sentence, then the week
                  as THE BOARD of five days (the
                  default since 2026-09-10, Noah) —
                  every name a card with our expected
                  move on its shelf, before the open or
                  after the close — or as a list of
                  days: dates down the left, every name
                  a door, the macro calendar beside
                  them, today on the silver rail. The
                  fortnight ridge that sat at the cards'
                  right is gone the same day ("glitchy
                  and buggy … it moves awfully weird and
                  i dont even know what it does"): its
                  caption changed width on every hover
                  and pushed the bars along, and the
                  board already shows the fortnight day
                  by day.
    EVERY REPORT  the house grid: both weeks, every
                  figure the calendar carries, a row
                  opens the name's page

  THE BOARD AND THE WEEK LIST show the names the room
  would recognise first, then the largest implied
  moves — four cards a shelf on the board, eight
  doors on the list — and a "+ more" door opens the
  rest of that day in place. Nothing is dropped.
  EVERY REPORT holds the whole fortnight, paged.
==================================================
*/

import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Moon, Search, Sunrise, X } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import { FeedFallback } from '../../components/ui/liveRead';
import DropdownSelect, { CARD, type DropdownOption } from '../../components/ui/DropdownSelect';
import TickerLookup from '../../components/ui/TickerLookup';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { EarningsGuide } from '../../components/record/EarningsGuide';
import { TableSkeleton } from '../../components/ui/Skeleton';
import { richText, stateOf, type VolState } from '../../components/earnings/volState';
import { weekDayDate, weekDayLabel, type EarningsEvent, type NextReport } from '../../data/earnings';
import { MIN_PRICED_PRINTS, untilWords, useEarningsCoverage, useEarningsHistories, useEarningsPending, useEarningsFailed, useEveryReport, useLiveReactions, useNextReport, useNextReportPending, historyMissed } from '../../data/earningsFeed';
import { nyTodayIso } from '../../data/nyDate';
import { nyMinutes } from '../../core/nyTime';
import { macroWindow, type MacroDate } from '../../data/events';
import { useBoardNames } from '../../data/boardNames';
import { statHelp } from '../../components/record/statHelp';
import { phonePin, usePagedGrid } from '../../components/record/pagedGrid';

type WeekPick = '0' | '1' | 'both';
type ShowPick = 'all' | VolState;
type Layout = 'list' | 'board';

/** A shelf on the board, and the week's list, before "+ more" opens that day. */
const SHELF = 4;
const LIST_CAP = 8;
const rankEvents = (list: EarningsEvent[]) =>
  [...list].sort((a, b) => Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0) || b.impliedMovePct - a.impliedMovePct);

/* on a Saturday or a Sunday the board opens on the COMING week (data/nyDate.ts boardMondayIso) — the hint says so (the
   third audit, 2026-10-23: it said "the current week" over next week's dates) */
const nyWeekend = (): boolean => {
  const d = new Date(`${nyTodayIso()}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};
const WEEK_OPTIONS: DropdownOption<WeekPick>[] = [
  { value: '0', label: 'This week', hint: nyWeekend() ? 'Monday to Friday of the coming week — on a weekend the board opens on the week ahead' : 'Monday to Friday of the current week' },
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
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The macro calendar's words on the list — the event, not the engine's label */
const MACRO_WORD: Record<string, string> = { 'FOMC decision': 'FOMC', 'NFP release': 'Payrolls', 'CPI release': 'CPI' };

/** The pricing in the page's words: how the options price sits against the usual move */
export const PRICED_WORD: Record<VolState, string> = { RICH: 'rich', INLINE: 'fair', CHEAP: 'cheap' };
export const PRICED_INK: Record<VolState, string> = { RICH: 'text-warn', INLINE: 'text-textPrimary', CHEAP: 'text-bull' };
/* a report whose time the vendor does not have ("unknown") is not "after the close" (the re-audit, 2026-10-22) */
export const slotWord = (e: { slot: EarningsEvent['slot']; timeKnown?: boolean }) => (e.timeKnown === false ? 'time not set' : e.slot === 'BMO' ? 'before the open' : 'after the close');
/** How many past moves the usual move averages — the live feed says; the sample has eight */
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
const SetTag = ({ confirmed }: { confirmed: boolean }) => <span className={`font-mono text-[8px] uppercase tracking-widest ${confirmed ? 'text-textMuted' : 'text-warn'}`} title={confirmed ? 'The company has set the date' : "The date is Unusual Whales' estimate — the company has not set it"}>{confirmed ? 'confirmed' : 'date estimated'}</span>;

const Fact = ({ label, children, testId, clip }: { label: string; children: React.ReactNode; testId?: string; clip?: boolean }) => (
  <div className={clip ? 'min-w-0 max-w-[320px]' : undefined}>
    <dt className="text-[10px] text-textMuted whitespace-nowrap cursor-help" title={statHelp(label)}>{label}</dt>
    {/* one line on a desk; on a phone a busy day wraps. A long today line truncates — the board holds the names. */}
    <dd className={`mt-0.5 font-mono text-[12px] tnum text-textPrimary ${clip ? 'truncate' : 'sm:whitespace-nowrap'}`} data-earnings-fact={testId}>
      {children}
    </dd>
  </div>
);

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
        <span className="font-mono text-[12px] font-bold text-textPrimary">{e.ticker}</span>
        <span className={`font-mono text-[11px] tnum ${e.reported ? moveInk(e) : e.impliedMovePct > 0 ? priceInk(e) : 'text-textMuted'}`}>{moveText(e)}</span>
        <SlotMark slot={e.slot} timeKnown={e.timeKnown} />
      </span>
      <span className="text-[10px] text-textMuted truncate max-w-[180px]">{e.name}</span>
    </span>
  </button>
);

/** A macro date on the list — a quiet chip */
const MacroChip = ({ m }: { m: MacroDate }) => (
  <span title={m.detail} className="inline-flex items-center self-center h-6 rounded-md border border-borderSubtle bg-chip px-2 font-mono text-[9px] uppercase tracking-widest text-textSecondary whitespace-nowrap" data-earnings-macro>
    {MACRO_WORD[m.label] ?? m.label}
  </span>
);

/** The board's cell: the mark, the ticker, our move, whether the date is set */
const Card = ({ e, onOpen, asked }: { e: EarningsEvent; onOpen: (t: string) => void; asked?: boolean }) => (
  <button
    type="button"
    onClick={() => onOpen(e.ticker)}
    title={`${e.name} — options price ${moveText(e)}, ${slotWord(e)} · open its page`}
    className={`group relative flex flex-col items-center gap-1.5 rounded-md border border-borderSubtle bg-chip px-2 pt-3 pb-2.5 transition-colors hover:border-borderMuted hover:bg-silver/[0.05] ${askedRing(!!asked)}`}
    data-earnings-card={e.ticker}
    data-asked={asked || undefined}
  >
    <CompanyLogo ticker={e.ticker} size={28} />
    <span className="font-mono text-[12px] font-bold text-textPrimary leading-none mt-0.5">{e.ticker}</span>
    <span className={`font-mono text-[11px] tnum leading-none ${e.reported ? moveInk(e) : pricedKnown(e) ? priceInk(e) : 'text-textMuted'}`}>{/* the move the options charge is known before the history lands; only rich/cheap waits on it */}{moveText(e)}</span>
    <SetTag confirmed={e.confirmed} />
  </button>
);

/* ---- the Name card -------------------------------------------------------------------- */

/** ASK FOR A NAME: a card on the line in the cards' clothes; it opens on the full listing's search (TickerLookup, the
    same body the chart's symbol button uses) and the answer stands under the line. */
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
          <span className="shrink-0 text-[9px] uppercase tracking-widest text-textMuted">Name</span>
          <span className={`min-w-0 truncate text-[11px] font-semibold ${asked ? 'text-textPrimary' : 'text-textSecondary'}`}>{asked ?? 'Any name'}</span>
          <ChevronDown className="w-3 h-3 shrink-0 text-textMuted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={`${CARD} w-[272px] p-0 overflow-hidden`} data-dropdown-card="earnings-name">
          <div className="px-3.5 pt-2.5 pb-1 font-mono text-[9px] uppercase tracking-widest text-textMuted">When a name reports next</div>
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

/** THE ANSWER: the name, the date, the slot, set or estimated, the options price when the fortnight holds it */
const Answer = ({ next, inWindow, onOpen, onClear }: { next: NextReport; inWindow: boolean; onOpen: (t: string) => void; onClear: () => void }) => {
  const navigate = useNavigate();
  const door = 'font-semibold text-textPrimary hover:text-silver transition-colors';
  return (
    <p className="px-5 pb-2 flex items-center gap-x-2 gap-y-1 flex-wrap text-[12px] leading-relaxed text-textSecondary" data-earnings-answer={next.ticker} data-answer-set={next.confirmed ? 'confirmed' : 'estimated'} data-answer-in-window={next.event ? 'yes' : 'no'}>
      <CompanyLogo ticker={next.ticker} size={16} />
      <span className="font-mono text-[12px] font-bold text-textPrimary">{next.ticker}</span>
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

const NameCell = ({ data }: ICellRendererParams<EarningsEvent>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        <span className="text-[10px] text-textMuted truncate">{data.name}</span>
      </span>
    </span>
  ) : null;

const WhenCell = ({ data }: ICellRendererParams<EarningsEvent>) =>
  data ? (
    <span className="flex flex-col leading-tight">
      <span className="font-mono text-[11px] tnum text-textPrimary">
        {data.dateLabel} <span className="text-textMuted">· {untilWords(data.daysOut)}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[10px]">
        <SlotMark slot={data.slot} timeKnown={data.timeKnown} className="w-2.5 h-2.5" />
        <span className="text-textSecondary">{slotWord(data)}</span>
        <SetTag confirmed={data.confirmed} />
      </span>
    </span>
  ) : null;

const IvCell = ({ data }: ICellRendererParams<EarningsEvent>) => (data ? pricedKnown(data) && data.ivRank > 0 ? <span className={`font-mono text-[11px] tnum ${data.ivRank >= 80 ? 'text-warn' : 'text-textPrimary'}`}>{data.ivRank}</span> : <span className="font-mono text-[11px] text-textMuted">—</span> : null);
/* a report with no straddle on the row (KARO's ±0.0%) is not priced — it says so; a report that is out shows the move the
   stock made, not the one the options had priced */
const signedPct = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
/* THE REACTION'S OWN SESSION (round 8: Thursday's after-close names read "moved −3.1%" on Friday at 10:30, mid-move):
   a report before the open reacts that session, one after the close (or with no time) the next weekday. While that
   session trades the move is said as "so far". */
const nextWeekday = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
};
const reactionSession = (e: EarningsEvent): string => (e.slot === 'BMO' && e.timeKnown !== false ? e.iso ?? '' : e.iso ? nextWeekday(e.iso) : '');
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
      <span className={`font-mono text-[11px] tnum font-semibold ${data.reported ? moveInk(data) : data.impliedMovePct > 0 ? 'text-textPrimary' : 'text-textMuted'}`}>{moveCellText(data)}</span>
      {data.reported && data.impliedMovePct > 0 ? <span className="font-mono text-[9px] tnum text-textMuted">priced ±{data.impliedMovePct.toFixed(1)}%</span> : null}
    </span>
  ) : null;
const UsualCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  if (data.history === false) return data.known ? <span className="font-mono text-[11px] text-textMuted" title="Reading the name's past reports">…</span> : <span className="font-mono text-[11px] text-textMuted" title="The board reads the past reports of the known names; this name's are on its own page">—</span>;
  if (!usualKnown(data)) return <span className="font-mono text-[11px] text-textMuted" title={data.classOf ? `A second share class — its reports are filed under ${data.classOf}` : 'No past move on file for this name'}>{data.classOf ? `see ${data.classOf}` : 'no history'}</span>;
  const n = histN(data);
  return (
    <span className="font-mono text-[11px] tnum text-textSecondary" title={`The average move the session after its last ${n} ${n === 1 ? 'report' : 'reports'}`}>
      ±{data.histAvgMovePct.toFixed(1)}%{n < 8 ? <span className="text-[9px] text-textMuted"> · {n} {n === 1 ? 'print' : 'prints'}</span> : null}
    </span>
  );
};
const PricedCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  if (!pricedKnown(data))
    return (
      <span className="font-mono text-[11px] text-textMuted" title={data.reported ? 'Reported — the move is in, so the premium is no longer priced' : usualKnown(data) ? `From ${histN(data)} ${histN(data) === 1 ? 'print' : 'prints'} — rich or cheap needs ${MIN_PRICED_PRINTS}` : 'No usual move to set the price against'}>
        —
      </span>
    );
  const s = stateOf(data);
  return (
    <span className={`font-mono text-[11px] tnum ${PRICED_INK[s]}`}>
      {richText(data.richness)}× <span className="text-[9px] uppercase tracking-widest">{PRICED_WORD[s]}</span>
    </span>
  );
};
/* BEAT · IN LINE · MISS, over the reports that carry both an actual and an estimate (the re-audit, 2026-10-22: BBD read
   "7 of 8" with six in line) */
const BeatCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  const b = data.beatCount ?? 0;
  const i = data.inlineCount ?? 0;
  const m = data.missCount ?? 0;
  const n = b + i + m;
  if (data.history === false || !n) return <span className="font-mono text-[11px] text-textMuted">—</span>;
  return (
    <span className="font-mono text-[11px] tnum text-textPrimary" title={`Of the last ${n} reports with an estimate: ${b} beat, ${i} in line, ${m} missed`}>
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
  /* EVERY REPORT, the known names marked — and the reader's own board names count as known: a name you follow is one
     you recognise, whatever its size */
  const live = useEveryReport();
  /* the reacting session's move so far, off the live price (round 9) */
  useLiveReactions(live);
  const pending = useEarningsPending();
  const failed = useEarningsFailed();
  const events = useMemo(() => {
    const mine = new Set(boardNames.map(t => t.toUpperCase()));
    return live.map(e => (e.known || !mine.has(e.ticker) ? e : { ...e, known: true }));
  }, [live, boardNames]);
  const knownEvents = useMemo(() => events.filter(e => e.known), [events]);
  /* the Fed's published FOMC dates and payrolls Friday; the CPI date the engine can only approximate stays off the board */
  const macro = useMemo(() => macroWindow(new Date(), 10, 20).filter(m => !/approximated/i.test(m.detail)), []);
  const [week, setWeekRaw] = useState<WeekPick>('0');
  /* THE WEEK OPENS WHERE REPORTS ARE LEFT (round 8: on Friday the default "This week" showed a week already reported,
     "113 known names, 0 still to report"). Once the lists are in, a this-week with no report left opens on next week;
     a reader's own pick is never overridden. */
  const [weekTouched, setWeekTouched] = useState(false);
  const setWeek = (w: WeekPick) => {
    setWeekTouched(true);
    setWeekRaw(w);
  };
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
  const [guideOpen, setGuideOpen] = useState(false);
  /* THE NAME ASKED FOR, and its answer */
  const [asked, setAsked] = useState<string | null>(null);
  const next = useNextReport(asked);
  const nextPending = useNextReportPending(asked);

  /* THE NAME FILTERS THE BOARD (the retail pass: NAME = AAPL did nothing visible) — a name in the fortnight keeps the
     board, the list and the grid to it; a name outside it says so under the line, with its page */
  /* in the window only when its NEXT report is (TSLA reported on Wednesday; its next is 01/27, outside) */
  const askedIn = asked != null && !!next && events.some(e => e.ticker === asked && e.iso === next.iso);
  const inWeeks = (e: EarningsEvent) => week === 'both' || String(e.weekIdx) === week;
  const shown = useMemo(() => {
    const cut = (show === 'all' ? events : events.filter(e => pricedKnown(e) && stateOf(e) === show)).filter(e => week === 'both' || String(e.weekIdx) === week);
    const named = askedIn ? cut.filter(e => e.ticker === asked) : cut;
    /* still to report first, soonest first; the reports already out follow, newest first */
    /* (round 9) within a day the known and the largest names first — page one opened on a run of obscure names with "—" */
    return [...named].sort((a, b) => Number(!!a.reported) - Number(!!b.reported) || (a.reported ? b.daysOut - a.daysOut : a.daysOut - b.daysOut) || Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0) || b.impliedMovePct - a.impliedMovePct);
  }, [events, show, askedIn, asked, week]);
  /* THE GRID PAGES ITSELF (the third audit, 2026-10-23): it was handed a 40-row slice, so a header sort ordered only the
     page in view. Every row goes in and the grid's own pagination pages it, as on Insiders and Congress — a sort runs
     over every report. A new cut starts on the first page. */
  const paged = usePagedGrid<EarningsEvent>();
  /* the grid page in view names its rows, so their past reports are read (audit round 7: every known name's history
     was read up front) */
  const [onPage, setOnPage] = useState<string[]>([]);
  const notePage = (api: { paginationGetCurrentPage: () => number; paginationGetPageSize: () => number; getDisplayedRowAtIndex: (i: number) => { data?: EarningsEvent } | undefined }) => {
    const size = api.paginationGetPageSize();
    const from = api.paginationGetCurrentPage() * size;
    const out: string[] = [];
    for (let i = from; i < from + size; i++) {
      const d = api.getDisplayedRowAtIndex(i)?.data;
      if (!d) break;
      if (d.known) out.push(d.ticker);
    }
    setOnPage(prev => (prev.join(',') === out.join(',') ? prev : out));
  };
  useEffect(() => {
    paged.props.ref.current?.api?.paginationGoToPage(0);
  }, [week, show, asked, paged.props.ref]);
  /* the pricing facts are told over the known names still to report whose usual move is in — a print that is out is
     not priced any more, and a count that grows as histories land says how many are in */
  /* the head counts the weeks the Week card shows — the same cut as the board and the grid */
  const weekEvents = events.filter(inWeeks);
  const weekKnown = knownEvents.filter(inWeeks);
  const ahead = weekKnown.filter(e => !e.reported);
  /* the week's known names whose past reports have not landed — the same names the head counts, so the figure is the
     progress of one stated set, never a fortnight-wide number that moved between loads (the retail test, 2026-10-23) */
  const weekHistOut = ahead.filter(e => e.history === false && !historyMissed(e.ticker)).length;
  const scored = ahead.filter(pricedKnown);
  const cover = useEarningsCoverage();
  const rich = scored.filter(e => stateOf(e) === 'RICH').length;
  const cheap = scored.filter(e => stateOf(e) === 'CHEAP').length;
  const fair = scored.length - rich - cheap;
  const biggest = ahead.reduce<EarningsEvent | null>((a, e) => (a === null || e.impliedMovePct > a.impliedMovePct ? e : a), null);
  const today = rankEvents(knownEvents.filter(e => e.daysOut === 0 && e.iso === nyTodayIso()));
  useEarningsHistories([...ahead.map(e => e.ticker), ...today.map(e => e.ticker), ...onPage]);
  const todayMore = events.filter(e => e.daysOut === 0 && e.iso === nyTodayIso()).length - today.length;

  const weeks: (0 | 1)[] = week === 'both' ? [0, 1] : [Number(week) as 0 | 1];
  const weekWords = week === 'both' ? 'over two weeks' : week === '0' ? 'this week' : 'next week';
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
        : `of the ${scored.length} with at least ${MIN_PRICED_PRINTS} past moves on file${weekHistOut ? ` (histories ${ahead.length - weekHistOut} of ${ahead.length} read)` : ''}, ${rich} priced rich, ${fair} fair, ${cheap} cheap`,
    ];
    if (biggest) parts.push(`the biggest move priced is ${biggest.ticker} at ±${biggest.impliedMovePct.toFixed(1)}% on ${biggest.dateLabel}`);
    parts.push(today.length ? `today: ${today.slice(0, 4).map(e => `${e.ticker} ${slotWord(e)}`).join(', ')}${today.length > 4 ? `, and ${today.length - 4} more known names` : ''}${todayMore > 0 ? `, ${todayMore} more on the list` : ''}` : todayMore > 0 ? `no known name reports today, ${todayMore} on the list do` : 'nothing reports today');
    if (cover.missed) parts.push(`${cover.missed} of the ${cover.slots} day lists did not answer, so the count is short`);
    return parts.join(' · ') + '.';
  }, [weekEvents.length, weekKnown.length, weekWords, ahead.length, scored.length, cover, rich, fair, cheap, biggest, today, todayMore]);

  const columnDefs = useMemo<ColDef<EarningsEvent>[]>(
    () => [
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 180, cellRenderer: NameCell, headerTooltip: 'The company — click the row to open its page' },
      { headerName: 'Reports', field: 'daysOut', width: 210, cellRenderer: WhenCell, headerTooltip: 'The date, before the open or after the close, and whether the company has confirmed it or it is still an estimate' },
      { headerName: 'Priced · or moved', field: 'impliedMovePct', width: 140, cellRenderer: MoveCell, type: 'rightAligned', headerTooltip: 'Before the print: the move the options charge — the at-the-money straddle as a percent of the stock ("priced"). Once the report is out: the move the stock made the session after ("moved"), or is making while that session trades ("so far"), with the price it had beside it' },
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
        <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the calendar" testId="earnings-guide" viewport>
          <EarningsGuide />
        </GuideFocus>
        {/* THE HEAD */}
        <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
          <div className="min-w-[min(18rem,100%)] flex-1">
            <div className="h-6 flex items-center gap-3">
              <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">Who reports</h3>
              <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the doors, the price and the words mean" testId="earnings-guide" />
            </div>
            <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">The fortnight's reports · the board holds the day's reports · the figure on a priced name is the move its options charge · click a name for its page</p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Fact label="Reports" testId="reports">
              {failed ? <span className="text-textMuted">—</span> : pending ? <span className="text-textMuted">reading the lists…</span> : <>{weekEvents.length.toLocaleString('en-US')} <span className="text-textMuted">· {weekWords} ·</span> {weekKnown.length.toLocaleString('en-US')} <span className="text-textMuted">known names</span>{cover.missed ? <span className="text-warn" title={`${cover.missed} of the ${cover.slots} day lists did not answer`}> · short</span> : null}</>}
            </Fact>
            <Fact label="Priced" testId="priced">
              {failed ? (
                <span className="text-textMuted">—</span>
              ) : pending ? (
                <span className="text-textMuted">reading the lists…</span>
              ) : ahead.length === 0 ? (
                /* nothing left to price is not "reading" (round 8: Friday's "reading the usual moves" stood all day) */
                <span className="text-textMuted" title={`Every known name ${weekWords} has reported — a report that is out is not priced any more`}>nothing left to price {weekWords}</span>
              ) : scored.length === 0 ? (
                <span className="text-textMuted">{weekHistOut > 0 ? 'reading the usual moves' : `none with ${MIN_PRICED_PRINTS}+ past moves on file`}</span>
              ) : (
                <span title={`Known names still to report ${weekWords} with at least ${MIN_PRICED_PRINTS} past moves on file: ${scored.length} of ${ahead.length}. A name with fewer, or none, is not called rich or cheap. Rich: the options charge more than 1.3× the usual move; cheap: under 0.85×; fair between`}>
                  {/* THE COUNT SAYS IT IS STILL COUNTING (round 9: the counts ticked up with no cue) */}
                  {weekHistOut > 0 && <span className="text-warn" title="The known names' past reports are read one by one (the feed allows three at a time); the counts grow as they land, and stop when every one is in" data-earnings-priced-reading>reading {ahead.length - weekHistOut} of {ahead.length} · so far </span>}
                  <span className={weekHistOut > 0 ? 'opacity-60' : ''}>
                    <span className="text-warn">{rich} rich</span> <span className="text-textMuted">·</span> {fair} fair <span className="text-textMuted">·</span> <span className="text-bull">{cheap} cheap</span>
                    <span className="text-textMuted"> · of {scored.length}</span>
                  </span>
                </span>
              )}
              {/* the colours' key, whatever the count says (round 9) */}
              {!failed && !pending && (
                <span className="block text-[9px] font-sans text-textMuted" data-earnings-legend>
                  <span className="text-warn">rich</span> over 1.3× the usual move · fair between · <span className="text-bull">cheap</span> under 0.85×
                </span>
              )}
            </Fact>
            <Fact label="Biggest priced move" testId="biggest">
              {biggest ? (
                <>
                  {biggest.ticker} ±{biggest.impliedMovePct.toFixed(1)}% <span className="text-textMuted">· {biggest.dateLabel} · known names, {weekWords}</span>
                </>
              ) : (
                <span className="text-textMuted">—</span>
              )}
            </Fact>
            <Fact label="Today" testId="today" clip>
              {today.length ? (
                <>
                  {today.slice(0, 3).map((e, i) => (
                    <span key={e.ticker}>
                      {i > 0 && <span className="text-textMuted"> · </span>}
                      {e.ticker} <span className="text-textMuted">{slotWord(e)}</span>
                    </span>
                  ))}
                  {today.length > 3 && <span className="text-textMuted"> · +{today.length - 3} more</span>}
                </>
              ) : (
                /* NEVER A FALSE "NOTHING" WHILE THE LISTS LOAD (audit round 5: "Today: nothing reports" at 35s, Reports —) */
                <span className="text-textMuted">{failed ? '—' : pending ? 'reading the day' : todayMore > 0 ? 'no known name' : 'nothing reports'}</span>
              )}
              {!pending && todayMore > 0 && <span className="text-textMuted"> · {todayMore} more on the list</span>}
            </Fact>
          </dl>
        </div>
        {/* THE ONE LINE OF CONTROLS */}
        <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-earnings-controls>
          <DropdownSelect label="Week" value={week} options={WEEK_OPTIONS} onChange={setWeek} title="Which week" testId="earnings-week" />
          <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="How the options price sits" testId="earnings-show" />
          <DropdownSelect label="Layout" value={layout} options={LAYOUT_OPTIONS} onChange={setLayout} title="The week as a board of the known names, or a list of every report" testId="earnings-layout" />
          <NameAsk asked={asked} onAsk={ask} />
        </div>
        {next && <Answer next={next} inWindow={askedIn} onOpen={open} onClear={() => setAsked(null)} />}
        {asked && !next && (
          <p className="px-5 pb-2 text-[12px] text-textSecondary" data-earnings-answer-pending>
            {nextPending ? `Reading when ${asked} reports…` : `${asked} has no report dated today or later on file.`}
          </p>
        )}
        {failed ? (
          <FeedFallback />
        ) : (
          <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-earnings-sentence>
            {pending ? 'Reading the fortnight.' : sentence}
          </p>
        )}
        {!pending && !failed && autoNext && week === '1' && (
          <p className="px-5 pb-3 -mt-1 text-[11px] text-textMuted" data-earnings-week-note>
            Every report this week is out, so the board opens on next week.{' '}
            <button type="button" onClick={() => setWeek('0')} className="font-semibold text-textSecondary hover:text-textPrimary transition-colors">
              See this week's results
            </button>
          </p>
        )}
        {!pending && !failed && week === '0' && thisWeekKnownLeft === 0 && nextWeekCount > 0 && (
          <p className="px-5 pb-3 -mt-1 text-[11px] text-textMuted" data-earnings-week-note>
            Every known name this week has reported{thisWeekLeft.length ? ` — ${thisWeekLeft.length} smaller ${thisWeekLeft.length === 1 ? 'name is' : 'names are'} still to come` : ''}; next week holds {nextWeekCount.toLocaleString('en-US')} reports.{' '}
            <button type="button" onClick={() => setWeek('1')} className="font-semibold text-textSecondary hover:text-textPrimary transition-colors" data-earnings-next-week>
              Go to next week
            </button>
          </p>
        )}

        {/* THE WEEK — the board, or a list of days; a failed read shows no empty days */}
        {failed ? null : pending ? (
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
                      <span className={`font-mono text-[14px] font-bold leading-none tnum ${isToday ? 'text-silver' : 'text-textPrimary'}`}>
                        {MONTHS[date.getMonth()]} {date.getDate()}
                      </span>
                      <span className={`mt-1 font-mono text-[9px] uppercase tracking-widest ${isToday ? 'text-silver' : 'text-textMuted'}`}>{isToday ? 'today' : DAYS[date.getDay()]}</span>
                      {dayEvents.length > 0 && (
                        <span className="mt-1 font-mono text-[9px] tnum text-textMuted" data-earnings-day-count>
                          {dayEvents.length} {dayEvents.length === 1 ? 'report' : 'reports'}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
                      {doors.map(e => (
                        <NameDoor key={e.ticker} e={e} onOpen={open} asked={e.ticker === asked} />
                      ))}
                      {more > 0 && (
                        <button type="button" onClick={() => setOpenDays(d => ({ ...d, [dayKey]: true }))} className="px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted hover:text-textPrimary" data-earnings-list-more={more}>
                          + {more} more
                        </button>
                      )}
                      {opened && dayEvents.length > LIST_CAP && (
                        <button type="button" onClick={() => setOpenDays(d => ({ ...d, [dayKey]: false }))} className="px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted hover:text-textPrimary">
                          Show fewer
                        </button>
                      )}
                      {dayMacro.map(m => (
                        <MacroChip key={m.iso + m.label} m={m} />
                      ))}
                      {dayEvents.length === 0 && dayMacro.length === 0 && <span className="px-2 font-mono text-[9px] uppercase tracking-widest text-textMuted">{show === 'all' ? 'nothing on the calendar' : 'none priced this way'}</span>}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div
            key={`board-${week}-${show}`}
            /* On a phone the five-day board scrolls sideways inside its box at a readable width (the phone pass, 2026-09-13) */
            className="border-t border-borderSubtle animate-soft-in max-lg:overflow-x-auto max-sm:overflow-x-visible min-w-0 max-w-full"
            data-earnings-board
          >
            {weeks.map(weekIdx => (
              /* on a phone the five days stand one under the other, full width (round 8: at 390 the sideways board cut its cards at the right edge with no cue to scroll) */
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
                  /* the macro calendar's dates under the day's head (2026-09-10 night: the list had them, the board did not) */
                  const dayMacro = macro.filter(m => m.iso === isoOf(weekDayDate(weekIdx, wd)));
                  const bmoList = bmo.list;
                  const amcList = amc.list;
                  /* EACH SHELF CARRIES ITS OWN "+ MORE" (round 8: Friday's "+13 more" sat under After the close, which held
                     one name — the thirteen were before the open) */
                  const shelf = (list: EarningsEvent[], slot: EarningsEvent['slot'], timed = true, hidden = 0) =>
                    list.length === 0 ? null : (
                      <div>
                        <span className="flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted">
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
                            className="mt-1.5 px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors"
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
                        <span className={`font-mono text-[11px] font-bold tnum ${isToday ? 'text-silver' : 'text-textPrimary'}`}>{label}</span>
                        {isToday && <span className="font-mono text-[8px] uppercase tracking-widest text-silver">today</span>}
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
                        dayMacro.length === 0 && more === 0 && <div className="mt-7 text-center font-mono text-[9px] uppercase tracking-widest text-textMuted">{show === 'all' ? 'no reports' : 'none priced this way'}</div>
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
                          className="mt-auto pt-3 self-start px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors"
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
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">Every report</h3>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            {week === 'both' ? 'Both weeks' : week === '0' ? 'This week' : 'Next week'} · {show === 'all' ? 'every report, the known names and the rest' : `the reports still to come priced ${PRICED_WORD[show]}`} · still to report first, soonest first, then the ones already out with their move · click a row for the name's page
          </p>
        </div>
        <div className="slayer-board border-t border-borderSubtle">
          {pending ? (
            <TableSkeleton rows={8} />
          ) : (
          <AgGridProvider modules={GRID_MODULES}>
            <AgGridReact<EarningsEvent>
              {...phonePin}
              {...paged.props}
              onPaginationChanged={e => {
                paged.props.onPaginationChanged(e);
                notePage(e.api);
              }}
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
