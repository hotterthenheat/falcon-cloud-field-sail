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
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Moon, Search, Sunrise, X } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME } from '../../components/ui/houseGrid';
import { PageBar } from '../../components/ui/PageBar';
import DropdownSelect, { CARD, type DropdownOption } from '../../components/ui/DropdownSelect';
import TickerLookup from '../../components/ui/TickerLookup';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { EarningsGuide } from '../../components/record/EarningsGuide';
import { TableSkeleton } from '../../components/ui/Skeleton';
import { stateOf, type VolState } from '../../components/earnings/volState';
import { weekDayDate, weekDayLabel, type EarningsEvent, type NextReport } from '../../data/earnings';
import { useEarningsPending, useEveryReport, useNextReport } from '../../data/earningsFeed';
import { macroWindow, type MacroDate } from '../../data/events';
import { useBoardNames } from '../../data/boardNames';

type WeekPick = '0' | '1' | 'both';
type ShowPick = 'all' | VolState;
type Layout = 'list' | 'board';

/** A shelf on the board, and the week's list, before "+ more" opens that day. */
const SHELF = 4;
const LIST_CAP = 8;
const REPORT_PAGE = 40;
const rankEvents = (list: EarningsEvent[]) =>
  [...list].sort((a, b) => Number(b.known) - Number(a.known) || (b.marketCap ?? 0) - (a.marketCap ?? 0) || b.impliedMovePct - a.impliedMovePct);

const WEEK_OPTIONS: DropdownOption<WeekPick>[] = [
  { value: '0', label: 'This week', hint: 'Monday to Friday of the current week' },
  { value: '1', label: 'Next week', hint: 'The week after' },
  { value: 'both', label: 'Both weeks', hint: 'The whole fortnight, one week under the other' },
];
const SHOW_OPTIONS: DropdownOption<ShowPick>[] = [
  { value: 'all', label: 'Every report', hint: 'Whatever the options charge' },
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
export const slotWord = (e: { slot: EarningsEvent['slot'] }) => (e.slot === 'BMO' ? 'before the open' : 'after the close');
const pricedKnown = (e: EarningsEvent) => e.history !== false;
const priceInk = (e: EarningsEvent) => (pricedKnown(e) ? PRICED_INK[stateOf(e)] : 'text-textPrimary');

/** The slot as a mark: dawn amber before the open, the moon after the close */
export const SlotMark = ({ slot, className = 'w-3 h-3' }: { slot: EarningsEvent['slot']; className?: string }) =>
  slot === 'BMO' ? <Sunrise className={`${className} text-warn`} aria-label="before the open" /> : <Moon className={`${className} text-moon`} aria-label="after the close" />;

/** Set by the company, or still an analyst's estimate — the same two words everywhere on the page */
const SetTag = ({ confirmed }: { confirmed: boolean }) => <span className={`font-mono text-[8px] uppercase tracking-widest ${confirmed ? 'text-textMuted' : 'text-warn'}`}>{confirmed ? 'confirmed' : 'estimated'}</span>;

const Fact = ({ label, children, testId, clip }: { label: string; children: React.ReactNode; testId?: string; clip?: boolean }) => (
  <div className={clip ? 'min-w-0 max-w-[320px]' : undefined}>
    <dt className="text-[10px] text-textMuted whitespace-nowrap">{label}</dt>
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
    title={`${e.name} — options price ±${e.impliedMovePct.toFixed(1)}%, ${slotWord(e)} · open its page`}
    className={`group flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 hover:border-borderSubtle hover:bg-silver/[0.05] transition-colors text-left ${askedRing(!!asked)}`}
    data-earnings-door={e.ticker}
    data-known={e.known || undefined}
    data-asked={asked || undefined}
  >
    <CompanyLogo ticker={e.ticker} size={22} />
    <span className="flex flex-col leading-tight">
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{e.ticker}</span>
        <span className={`font-mono text-[11px] tnum ${priceInk(e)}`}>±{e.impliedMovePct.toFixed(1)}%</span>
        <SlotMark slot={e.slot} />
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
    title={`${e.name} — options price ±${e.impliedMovePct.toFixed(1)}%, ${slotWord(e)} · open its page`}
    className={`group relative flex flex-col items-center gap-1.5 rounded-md border border-borderSubtle bg-chip px-2 pt-3 pb-2.5 transition-colors hover:border-borderMuted hover:bg-silver/[0.05] ${askedRing(!!asked)}`}
    data-earnings-card={e.ticker}
    data-asked={asked || undefined}
  >
    <CompanyLogo ticker={e.ticker} size={28} />
    <span className="font-mono text-[12px] font-bold text-textPrimary leading-none mt-0.5">{e.ticker}</span>
    <span className={`font-mono text-[11px] tnum leading-none ${pricedKnown(e) ? priceInk(e) : 'text-textMuted'}`}>{pricedKnown(e) ? `±${e.impliedMovePct.toFixed(1)}%` : '—'}</span>
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
const Answer = ({ next, onOpen, onClear }: { next: NextReport; onOpen: (t: string) => void; onClear: () => void }) => {
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
        <span className="text-textMuted">{next.daysOut === 0 ? ' · today' : ` · in ${next.daysOut}d`}</span>
      </span>
      <span className="inline-flex items-center gap-1.5">
        <SlotMark slot={next.slot} className="w-2.5 h-2.5" />
        {slotWord(next)}
      </span>
      <SetTag confirmed={next.confirmed} />
      {next.event ? (
        <>
          <span className="text-textMuted">·</span>
          <span>
            the options price <span className={`font-mono tnum ${priceInk(next.event)}`}>±{next.event.impliedMovePct.toFixed(1)}%</span>
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
    <span className="inline-flex items-center gap-2 min-w-0">
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
        {data.dateLabel} <span className="text-textMuted">· {data.daysOut === 0 ? 'today' : `in ${data.daysOut}d`}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-[10px]">
        <SlotMark slot={data.slot} className="w-2.5 h-2.5" />
        <span className="text-textSecondary">{slotWord(data)}</span>
        <SetTag confirmed={data.confirmed} />
      </span>
    </span>
  ) : null;

const MoveCell = ({ data }: ICellRendererParams<EarningsEvent>) => (data ? <span className="font-mono text-[11px] tnum font-semibold text-textPrimary">±{data.impliedMovePct.toFixed(1)}%</span> : null);
const UsualCell = ({ data }: ICellRendererParams<EarningsEvent>) => (data ? <span className="font-mono text-[11px] tnum text-textSecondary">{pricedKnown(data) ? `±${data.histAvgMovePct.toFixed(1)}%` : '—'}</span> : null);
const PricedCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  if (!pricedKnown(data)) return <span className="font-mono text-[11px] text-textMuted">—</span>;
  const s = stateOf(data);
  return (
    <span className={`font-mono text-[11px] tnum ${PRICED_INK[s]}`}>
      {data.richness.toFixed(2)}× <span className="text-[9px] uppercase tracking-widest">{PRICED_WORD[s]}</span>
    </span>
  );
};
const BeatCell = ({ data }: ICellRendererParams<EarningsEvent>) => {
  if (!data) return null;
  if (!pricedKnown(data) || !data.pastMoves.length) return <span className="font-mono text-[11px] text-textMuted">—</span>;
  const n = data.pastMoves.length;
  const beats = Math.round((data.beatRate8q / 100) * n);
  return <span className="font-mono text-[11px] tnum text-textPrimary">{beats} of {n}</span>;
};
const EstCell = ({ data }: ICellRendererParams<EarningsEvent>) =>
  data ? (
    pricedKnown(data) ? (
    <span className={`font-mono text-[11px] ${data.revisionTrend > 0.15 ? 'text-bull' : data.revisionTrend < -0.15 ? 'text-bear' : 'text-textMuted'}`}>
      {data.revisionTrend > 0.15 ? 'rising' : data.revisionTrend < -0.15 ? 'falling' : 'flat'}
    </span>
    ) : <span className="font-mono text-[11px] text-textMuted">—</span>
  ) : null;
const IvCell = ({ data }: ICellRendererParams<EarningsEvent>) => (data ? pricedKnown(data) && data.ivRank > 0 ? <span className={`font-mono text-[11px] tnum ${data.ivRank >= 80 ? 'text-warn' : 'text-textPrimary'}`}>{data.ivRank}</span> : <span className="font-mono text-[11px] text-textMuted">—</span> : null);

/* ---- the page ----------------------------------------------------------------------- */

const Earnings = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  /* EVERY REPORT, the known names marked — and the reader's own board names count as known: a name you follow is one
     you recognise, whatever its size */
  const live = useEveryReport();
  const pending = useEarningsPending();
  const events = useMemo(() => {
    const mine = new Set(boardNames.map(t => t.toUpperCase()));
    return live.map(e => (e.known || !mine.has(e.ticker) ? e : { ...e, known: true }));
  }, [live, boardNames]);
  const knownEvents = useMemo(() => events.filter(e => e.known), [events]);
  const macro = useMemo(() => macroWindow(new Date(), 10, 20), []);
  const [week, setWeek] = useState<WeekPick>('0');
  const [show, setShow] = useState<ShowPick>('all');
  const [layout, setLayout] = useState<Layout>('board');
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});
  const [reportPage, setReportPage] = useState(0);
  const [guideOpen, setGuideOpen] = useState(false);
  /* THE NAME ASKED FOR, and its answer */
  const [asked, setAsked] = useState<string | null>(null);
  const next = useNextReport(asked);

  const shown = useMemo(() => (show === 'all' ? events : events.filter(e => pricedKnown(e) && stateOf(e) === show)), [events, show]);
  const reportPages = Math.max(1, Math.ceil(shown.length / REPORT_PAGE));
  const reportAt = Math.min(reportPage, reportPages - 1);
  const reportRows = shown.slice(reportAt * REPORT_PAGE, (reportAt + 1) * REPORT_PAGE);
  /* the pricing facts are told over the known names whose usual move is in */
  const scored = knownEvents.filter(pricedKnown);
  const rich = scored.filter(e => stateOf(e) === 'RICH').length;
  const cheap = scored.filter(e => stateOf(e) === 'CHEAP').length;
  const fair = scored.length - rich - cheap;
  const biggest = knownEvents.reduce<EarningsEvent | null>((a, e) => (a === null || e.impliedMovePct > a.impliedMovePct ? e : a), null);
  const today = rankEvents(knownEvents.filter(e => e.daysOut === 0));
  const todayMore = events.filter(e => e.daysOut === 0).length - today.length;

  const weeks: (0 | 1)[] = week === 'both' ? [0, 1] : [Number(week) as 0 | 1];
  const open = (t: string) => navigate(`/dossier/earnings/${t}`);
  /* a name asked for inside the fortnight: the week turns to its page, its card wears the ring */
  const ask = (t: string) => {
    setAsked(t);
    const ev = events.find(e => e.ticker === t);
    if (ev && week !== 'both' && String(ev.weekIdx) !== week) setWeek(String(ev.weekIdx) as WeekPick);
  };

  const sentence = useMemo(() => {
    const parts = [`${events.length} reports over two weeks, ${knownEvents.length} of them known names`, `among those ${rich} priced rich, ${fair} fair, ${cheap} cheap`];
    if (biggest) parts.push(`the biggest move priced is ${biggest.ticker} at ±${biggest.impliedMovePct.toFixed(1)}% on ${biggest.dateLabel}`);
    parts.push(today.length ? `today: ${today.slice(0, 4).map(e => `${e.ticker} ${slotWord(e)}`).join(', ')}${today.length > 4 ? `, and ${today.length - 4} more known names` : ''}${todayMore > 0 ? `, ${todayMore} more on the list` : ''}` : todayMore > 0 ? `no known name reports today, ${todayMore} on the list do` : 'nothing reports today');
    return parts.join(' · ') + '.';
  }, [events.length, knownEvents.length, rich, fair, cheap, biggest, today, todayMore]);

  const columnDefs = useMemo<ColDef<EarningsEvent>[]>(
    () => [
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 180, cellRenderer: NameCell, headerTooltip: 'The company — click the row to open its page' },
      { headerName: 'Reports', field: 'daysOut', width: 210, cellRenderer: WhenCell, sort: 'asc', headerTooltip: 'The date, before the open or after the close, and whether the company has confirmed it or it is still an estimate' },
      { headerName: 'Options price', field: 'impliedMovePct', width: 124, cellRenderer: MoveCell, type: 'rightAligned', headerTooltip: 'The move the options charge for the print — the at-the-money straddle as a percent of the stock' },
      { headerName: 'Usually moves', field: 'histAvgMovePct', width: 124, cellRenderer: UsualCell, type: 'rightAligned', headerTooltip: 'The average move on the last eight prints' },
      { headerName: 'Priced', field: 'richness', width: 124, cellRenderer: PricedCell, type: 'rightAligned', headerTooltip: 'The options price over the usual move — rich above 1.3×, cheap below 0.85×, fair between' },
      { headerName: 'Beat', field: 'beatRate8q', width: 96, cellRenderer: BeatCell, type: 'rightAligned', headerTooltip: 'How many of the last eight quarters beat the estimate' },
      { headerName: 'Estimates', field: 'revisionTrend', width: 104, cellRenderer: EstCell, headerTooltip: 'Which way analyst estimates have drifted into the print' },
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
          <div className="min-w-0 flex-1">
            <div className="h-6 flex items-center gap-3">
              <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">Who reports</h3>
              <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the doors, the price and the words mean" testId="earnings-guide" />
            </div>
            <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">The fortnight's reports · the board holds the day's reports · the figure on a priced name is the move its options charge · click a name for its page</p>
          </div>
          <dl className="flex flex-wrap gap-x-6 gap-y-2">
            <Fact label="Reports" testId="reports">
              {pending ? <span className="text-textMuted">—</span> : <>{events.length} <span className="text-textMuted">· two weeks ·</span> {knownEvents.length} <span className="text-textMuted">known names</span></>}
            </Fact>
            <Fact label="Priced" testId="priced">
              {scored.length === 0 ? (
                <span className="text-textMuted">reading the usual moves</span>
              ) : (
                <>
                  <span className="text-warn">{rich} rich</span> <span className="text-textMuted">·</span> {fair} fair <span className="text-textMuted">·</span> <span className="text-bull">{cheap} cheap</span>
                </>
              )}
            </Fact>
            <Fact label="Biggest move" testId="biggest">
              {biggest ? (
                <>
                  {biggest.ticker} ±{biggest.impliedMovePct.toFixed(1)}% <span className="text-textMuted">· {biggest.dateLabel}</span>
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
                <span className="text-textMuted">{todayMore > 0 ? 'no known name' : 'nothing reports'}</span>
              )}
              {todayMore > 0 && <span className="text-textMuted"> · {todayMore} more on the list</span>}
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
        {next && <Answer next={next} onOpen={open} onClear={() => setAsked(null)} />}
        <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-earnings-sentence>
          {pending ? 'Reading the fortnight.' : sentence}
        </p>

        {/* THE WEEK — the board, or a list of days */}
        {pending ? (
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
            className="border-t border-borderSubtle animate-soft-in max-lg:overflow-x-auto min-w-0 max-w-full"
            data-earnings-board
          >
            {weeks.map(weekIdx => (
              <div key={weekIdx} className="grid grid-cols-5 gap-px bg-borderSubtle/60 border-b border-borderSubtle/60 last:border-0 max-lg:min-w-[640px]">
                {WEEKDAYS.map(wd => {
                  const { label, isToday } = weekDayLabel(weekIdx, wd);
                  const dayAll = shown.filter(e => e.weekIdx === weekIdx && e.weekday === wd);
                  const dayKey = `${weekIdx}-${wd}`;
                  const opened = !!openDays[dayKey];
                  const ranked = rankEvents(dayAll);
                  const take = (slot: EarningsEvent['slot']) => {
                    const all = ranked.filter(e => e.slot === slot);
                    const list = opened ? all : all.slice(0, SHELF);
                    return { list, hidden: all.length - list.length };
                  };
                  const bmo = take('BMO');
                  const amc = take('AMC');
                  const more = bmo.hidden + amc.hidden;
                  const capped = bmo.list.length + bmo.hidden > SHELF || amc.list.length + amc.hidden > SHELF;
                  /* the macro calendar's dates under the day's head (2026-09-10 night: the list had them, the board did not) */
                  const dayMacro = macro.filter(m => m.iso === isoOf(weekDayDate(weekIdx, wd)));
                  const bmoList = bmo.list;
                  const amcList = amc.list;
                  const shelf = (list: EarningsEvent[], slot: EarningsEvent['slot']) =>
                    list.length === 0 ? null : (
                      <div>
                        <span className="flex items-center gap-1.5 px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted">
                          <SlotMark slot={slot} className="w-2.5 h-2.5" /> {slot === 'BMO' ? 'before the open' : 'after the close'}
                        </span>
                        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                          {list.map(e => (
                            <Card key={e.ticker} e={e} onOpen={open} asked={e.ticker === asked} />
                          ))}
                        </div>
                      </div>
                    );
                  return (
                    <div key={wd} className={`bg-panel px-3 py-3 min-h-[176px] flex flex-col ${isToday ? 'bg-silver/[0.04]' : ''}`} data-earnings-board-day={label} data-today={isToday || undefined} data-more={more || undefined}>
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
                      {bmo.list.length + amc.list.length === 0 ? (
                        dayMacro.length === 0 && more === 0 && <div className="mt-7 text-center font-mono text-[9px] uppercase tracking-widest text-textMuted">{show === 'all' ? 'no reports' : 'none priced this way'}</div>
                      ) : (
                        <div className="mt-2.5 flex flex-col gap-3">
                          {shelf(bmoList, 'BMO')}
                          {shelf(amcList, 'AMC')}
                        </div>
                      )}
                      {(more > 0 || (opened && capped)) && (
                        <button
                          type="button"
                          onClick={() => setOpenDays(d => ({ ...d, [dayKey]: !opened }))}
                          title={opened ? 'Back to the names that matter' : 'The rest of this day'}
                          className={`${bmo.list.length + amc.list.length === 0 ? 'mt-7' : 'mt-auto pt-3'} self-start px-1 font-mono text-[9px] uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors`}
                          data-earnings-board-more={more || undefined}
                        >
                          {opened ? 'Show fewer' : `+ ${more} more`}
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
            Both weeks · {show === 'all' ? 'every report, the known names and the rest' : `the reports priced ${PRICED_WORD[show]}`} · soonest first · click a row for the name's page
          </p>
        </div>
        <div className="slayer-board border-t border-borderSubtle">
          {pending ? (
            <TableSkeleton rows={8} />
          ) : (
          <AgGridProvider modules={GRID_MODULES}>
            <AgGridReact<EarningsEvent>
              theme={GRID_THEME}
              domLayout="autoHeight"
              rowData={reportRows}
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
          {!pending && <PageBar page={reportAt} pages={reportPages} onPage={setReportPage} testId="earnings" />}
        </div>
      </div>
    </>
  );
};

export default Earnings;
