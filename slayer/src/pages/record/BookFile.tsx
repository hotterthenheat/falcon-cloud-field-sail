/*
  A HOUSE, A SHORT FILE, A FUND.

  The same page the lists are. One bordered desk: the head and four
  facts, one line of controls with the way back on it, one sentence,
  then the house grid. Not a second, grayer page.
*/

import { CoSub } from '../../components/record/CoName';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { whalesScreener } from '../../data/whales';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import { EtfsGuide, InstitutionsGuide, ShortsGuide } from '../../components/record/FileGuides';
import { CongressGuide } from '../../components/record/CongressGuide';
import { When } from '../../components/record/when';
import CompanyLogo from '../../components/ui/CompanyLogo';
import {
  positionWord,
  weightSlices,
  type EtfHolding,
  type InstitutionRow,
  type PositionStatus,
} from '../../data/fileBooks';
import { extendedLine, priceWords, useLiveQuote } from '../../data/liveQuote';
import { lastSessionIso, nyTodayIso, shortDay as shortDayOf } from '../../data/nyDate';
import { FUND_TYPES, shortRowFromFile, useCompanyName, useEtfFile, useEtfWeights, useHouseBook, useShortRow, useStockCard } from '../../data/liveFiles';
import { SQUEEZE_INK, SQUEEZE_TIP, squeezeRead } from '../../data/squeeze';
import { useShortReads } from '../../data/shortFile';
import { displayName, tickerName } from '../../data/tickers';
import { AssetCell, BillsSwitch, CongressCard, assetKey, assetLine } from './Congress';
import { PhoneCards, usePhoneCards } from '../../components/record/PhoneCards';
import { holdingAssetKey } from '../../data/fileBooks';
import { asOfDay, borrowM, longDay, moneyB, signedM as moneyFlow } from './money';
import { usePagedGrid, phonePin } from '../../components/record/pagedGrid';
import { STOCK_ACT_DEADLINE_DAYS, bracketLabel, isTreasuryBill, seatLabel } from '../../data/congress';
import { memberFromRoster, useCongressCoverageQuiet, useCongressFeedIf, useCongressRoster, useCongressStatusQuiet, useMemberBook } from '../../data/liveRecord';
import { nyIsoDaysBack } from '../../data/nyDate';
import { reportDayLabelYear } from '../../data/earningsFeed';
import { congressFromWhales, ownerWord } from '../../data/whalesMap';
import { useVendor } from '../../data/vendorFeed';
import { HouseSectors, ShortHistory } from '../../components/vendor/LiveDesk';
import type { CongressTrade, ReportOwner } from '../../types/record';
import { statHelp } from '../../components/record/statHelp';

/* A UNIT CHANGE NEVER READS "−0.0M" (the retail test, round 6): no change says "unchanged"; a change under 50K units is
   said in thousands */
const unitsDelta = (m: number): string => {
  if (!Number.isFinite(m) || m === 0) return 'unchanged';
  const sign = m > 0 ? '+' : '−';
  const a = Math.abs(m);
  return a < 0.05 ? `${sign}${Math.max(1, Math.round(a * 1000))}K` : `${sign}${a.toFixed(1)}M`;
};

const KNOW = (on: boolean) => `group text-left rounded-md border px-3 py-2.5 transition-colors min-w-0 ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`;
const ink = (n: number) => (n > 0 ? 'text-bull' : n < 0 ? 'text-bear' : 'text-textMuted');
const defaultColDef = { sortable: true, resizable: true, suppressMovable: true };

const Page = ({ testId, children }: { testId: string; children: ReactNode }) => (
  <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-book-file={testId}>
    {children}
  </div>
);

const WayBack = ({ to, label }: { to: string; label: string }) => (
  <Link to={to} data-name-back className="group inline-flex items-center gap-1.5 font-mono text-t10 uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
    <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> {label}
  </Link>
);

const Missing = ({ to, label }: { to: string; label: string }) => (
  <>
    <WayBack to={to} label={label} />
    <Page testId="missing">
      <p className="px-5 py-4 text-t12 text-textSecondary">That record is not on this book.</p>
    </Page>
  </>
);

/** Still reading — never "not on this book" while the read is out (the ship pass, 2026-10-22: a slow filing read as a
    missing one) */
const Reading = ({ to, back, what }: { to: string; back: string; what: string }) => (
  <>
    <WayBack to={to} label={back} />
    <Page testId="reading">
      <p className="px-5 py-4 text-t12 text-textSecondary">Reading {what}…</p>
    </Page>
  </>
);

/* ------------------------------------------------------------------ house */

type BookPick = 'any' | InstitutionRow['book'];
type StatusPick = 'any' | PositionStatus;

const BOOK_OPTIONS: DropdownOption<BookPick>[] = [
  { value: 'any', label: 'Any side', short: 'All', hint: 'Shares, calls and puts' },
  { value: 'stock', label: 'Shares', hint: 'The filing left put/call empty' },
  { value: 'calls', label: 'Calls', hint: 'Marked call. No strike, no expiry' },
  { value: 'puts', label: 'Puts', hint: 'Marked put. No strike, no expiry' },
];
const STATUS_OPTIONS: DropdownOption<StatusPick>[] = [
  { value: 'any', label: 'Any change', short: 'All', hint: 'New, added, cut, closed and held' },
  { value: 'new', label: 'New', hint: 'Not on the prior 13F' },
  { value: 'added', label: 'Added', hint: 'At least 2% more units than last quarter', tone: 'bull' },
  { value: 'cut', label: 'Cut', hint: 'At least 2% fewer units than last quarter', tone: 'bear' },
  { value: 'closed', label: 'Closed', hint: 'Sold out, or nearly', tone: 'bear' },
  { value: 'held', label: 'Held', hint: 'Within 2% of last quarter’s units, either way' },
];

const STATUS_INK: Record<PositionStatus, string> = {
  new: 'text-silver',
  added: 'text-bull',
  cut: 'text-bear',
  closed: 'text-textMuted',
  held: 'text-textSecondary',
};

const HouseName = ({ data }: ICellRendererParams<InstitutionRow>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      {data.unlisted ? <span className="w-4 shrink-0" aria-hidden /> : <CompanyLogo ticker={data.ticker} size={16} />}
      <span className="flex flex-col leading-tight min-w-0" title={data.unlisted ? `${data.company ?? ''} — the filing gives no listed symbol` : undefined}>
        <span className={`font-mono text-t12 font-bold ${data.unlisted ? 'text-textSecondary' : 'text-textPrimary'}`}>{data.ticker}</span>
        {data.unlisted ? <span className="text-t10 text-textMuted truncate">{data.company}</span> : <CoSub ticker={data.ticker} />}
      </span>
    </span>
  ) : null;

export const HouseFile = () => {
  const { house: slug = '' } = useParams();
  const [search] = useSearchParams();
  const line = (search.get('line') ?? '').toUpperCase();
  const bookLive = useHouseBook(slug);
  const house = bookLive.name;
  const [book, setBook] = useState<BookPick>('any');
  const [status, setStatus] = useState<StatusPick>('any');
  const [guideOpen, setGuideOpen] = useState(false);
  const [focus, setFocus] = useState(line);
  const feed = bookLive.rows;
  const rows = useMemo(
    () => feed.filter(r => (book === 'any' || r.book === book) && (status === 'any' || r.status === status)),
    [feed, book, status],
  );
  const changed = useMemo(() => feed.filter(r => r.status !== 'held'), [feed]);
  const toKnow = useMemo(() => [...feed].sort((a, b) => b.valueB - a.valueB).slice(0, 6), [feed]);
  const value = feed.reduce((s, r) => s + r.valueB, 0);
  const cols = useMemo<ColDef<InstitutionRow>[]>(
    () => [
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 170, cellRenderer: HouseName, headerTooltip: 'The stock' },
      { headerName: 'Side', field: 'book', width: 84, valueFormatter: p => (p.value === 'stock' ? (p.data?.security ?? 'Shares') : p.value === 'calls' ? 'Call' : 'Put'), headerTooltip: 'Call, put, or the shares. The filing does not name a strike or an expiry.' },
      { headerName: 'Change', field: 'status', width: 92, cellRenderer: ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-t11 ${STATUS_INK[data.status]}`}>{positionWord(data.status)}</span> : null), headerTooltip: 'Against the house\'s prior 13F: new, added (2% more units or over), cut (2% fewer or over), sold out, or held (within 2% either way — NVDA +1.6% reads held)' },
      { headerName: 'Units', field: 'sharesM', width: 96, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(1)}M`, headerTooltip: 'Shares the house reported holding (for a call or put line, the shares the options cover), millions' },
      { headerName: 'Units Δ', field: 'unitsChangeM', width: 100, type: 'rightAligned', cellRenderer: ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-t11 tnum ${ink(data.unitsChangeM)}`}>{unitsDelta(data.unitsChangeM)}</span> : null), headerTooltip: 'Change in units since the house\'s prior 13F' },
      { headerName: 'Value', field: 'valueB', width: 96, type: 'rightAligned', valueFormatter: p => moneyB(Number(p.value)), headerTooltip: 'The line\'s market value on the filing' },
      { headerName: 'Avg price', field: 'avgPrice', width: 100, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `$${Number(p.value).toFixed(2)}` : '—'), headerTooltip: "Unusual Whales' estimate of the average price the house paid — '—' where it rests on a first buy the filing contradicts" },
      { headerName: '% of 13F value', field: 'pctOfBook', width: 112, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(1)}%`, headerTooltip: 'This line\'s reported value as a share of the total value of everything the house reported on its 13F (Unusual Whales\' perc_of_share_value) — over the whole filing, not only the lines read here' },
      { headerName: '% of co.', field: 'pctOfShares', width: 96, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `${Number(p.value).toFixed(2)}%` : '—'), headerTooltip: 'The share of the company\'s shares outstanding this house holds' },
      { headerName: 'First buy', field: 'firstBuy', width: 110, valueFormatter: p => (p.value && /^\d{4}-\d{2}-\d{2}/.test(String(p.value)) ? longDay(String(p.value)) : String(p.value ?? '—')), headerTooltip: "The first quarter this house reported owning the stock — '—' where the date is contradicted by the filing itself (units held in earlier quarters, or a first price far off the filing's own)" },
      { headerName: 'First price', field: 'firstPrice', width: 100, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `$${Number(p.value).toFixed(2)}` : '—'), headerTooltip: "The close on the day of the first buy. Not a strike. '—' where the first buy cannot be trusted (see First buy)" },
    ],
    [],
  );
  if (bookLive.status === 'loading' && !house) return <Reading to="/dossier/institutions" back="Institutions" what="the filing" />;
  if (!house) return <Missing to="/dossier/institutions" label="Institutions" />;
  const focused = rows.find(r => r.ticker === focus) ?? rows[0] ?? null;
  const callValue = feed.filter(r => r.book === 'calls').reduce((s, r) => s + r.valueB, 0);
  const putValue = feed.filter(r => r.book === 'puts').reduce((s, r) => s + r.valueB, 0);
  return (
    <>
    <WayBack to="/dossier/institutions" label="Institutions" />
    <Page testId={house}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the filing" testId="house-guide" viewport>
        <InstitutionsGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="min-w-0 truncate text-t15 font-semibold leading-tight text-textPrimary">{house ? displayName(house) : house}</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a 13F line means" testId="house-guide" />
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">This filing's {feed.length} largest lines by value. A call or a put is only the side.</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="The whole 13F as Unusual Whales totals it — every line the house reported, not only the ones below">Reported</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{bookLive.totalB != null ? moneyB(bookLive.totalB) : '—'}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={`The ${feed.length} largest lines read here, by value`}>Top {feed.length} lines</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{moneyB(value)}{bookLive.totalB ? <span className="text-textMuted"> · {Math.round((100 * value) / bookLive.totalB)}%</span> : null}</dd>
          </div>
          {/* THE WHOLE FILING'S CALLS AND PUTS (audit round 7: the cards read "Calls $0 · Puts $0" off the top 80 lines while
              BlackRock's 13F carries $12.8B of calls and $4.16B of puts — the feed's own call_value / put_value) */}
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={`Calls on the whole 13F as Unusual Whales totals it (call_value) — the market value of the shares the call lines cover${callValue > 0 ? `; ${moneyB(callValue)} of it in the ${feed.length} lines read below` : `; none of the ${feed.length} largest lines below is a call`}`}>Calls · whole 13F</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{bookLive.optionsB ? moneyB(bookLive.optionsB.calls) : '—'}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={`Puts on the whole 13F as Unusual Whales totals it (put_value)${putValue > 0 ? `; ${moneyB(putValue)} of it in the ${feed.length} lines read below` : `; none of the ${feed.length} largest lines below is a put`}`}>Puts · whole 13F</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{bookLive.optionsB ? moneyB(bookLive.optionsB.puts) : '—'}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Changed")}>Changed</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{changed.length}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-house-controls>
        <DropdownSelect label="Side" value={book} options={BOOK_OPTIONS} onChange={setBook} title="Shares, call, or put. Not a contract." testId="house-book" />
        <DropdownSelect label="Change" value={status} options={STATUS_OPTIONS} onChange={setStatus} title="What happened versus the prior 13F" testId="house-status" />
      </div>
      <p className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-house-sentence>
        {house ? displayName(house) : house} reported {bookLive.totalB != null ? moneyB(bookLive.totalB) : 'its book'} on its latest 13F. The {feed.length} largest lines, shown here, are {moneyB(value)}{bookLive.totalB ? ` (${Math.round((100 * value) / bookLive.totalB)}% of it)` : ''}{bookLive.optionsB ? <>; the whole filing holds {moneyB(bookLive.optionsB.calls)} of calls and {moneyB(bookLive.optionsB.puts)} of puts, {callValue + putValue > 0 ? `${moneyB(callValue)} and ${moneyB(putValue)} of them in these lines` : 'none of them among these lines'}</> : <>: calls {moneyB(callValue)}, puts {moneyB(putValue)}</>}; {changed.length} of them changed size by more than 2% versus the prior quarter.
        {line ? <> The line you opened is {line}.</> : null}
        {focused ? (focused.quarters.length > 1 ? <> {focused.quarters.length} quarters of {focused.ticker} sit under the grid, {focused.quarters[0]?.unitsM.toFixed(1)}M units in {focused.quarters[0]?.period} and {focused.quarters[focused.quarters.length - 1]?.unitsM.toFixed(1)}M now.</> : <> One quarter of {focused.ticker} is on file, {focused.quarters[0]?.unitsM.toFixed(1)}M units.</>) : null}
      </p>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="house-know">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The lines to know</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">the largest by value · click one to read its eight quarters</span>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {toKnow.map(r => (
            <button key={r.id} type="button" onClick={() => setFocus(r.ticker)} aria-pressed={focused?.ticker === r.ticker} className={KNOW(focused?.ticker === r.ticker)} data-house-know={r.ticker}>
              <span className="flex items-center gap-2 min-w-0">
                {r.unlisted ? null : <CompanyLogo ticker={r.ticker} size={18} />}
                <span className="font-mono text-t12 font-bold text-textPrimary truncate" title={r.unlisted ? r.company : undefined}>{r.ticker}</span>
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
                <span className="text-t13 font-bold text-textPrimary">{moneyB(r.valueB)}</span>
                <span className={`text-t9 ${ink(r.unitsChangeM)}`}>{unitsDelta(r.unitsChangeM)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-house-lines>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<InstitutionRow>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('No line on this book')}
            columnDefs={cols}
            defaultColDef={defaultColDef}
            getRowId={p => p.data?.id ?? ''}
            getRowStyle={p => (focused && p.data?.ticker === focused.ticker ? { background: 'rgb(var(--silver) / 0.08)' } : undefined)}
            onRowClicked={e => e.data && setFocus(e.data.ticker)}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
      </div>
      {focused && (
        <Board
          title={`${focused.quarters.length === 8 ? 'Eight' : focused.quarters.length} quarters · ${focused.ticker}`}
          rest="Units reported, oldest to newest. The last row is this filing."
          testId="house-quarters"
          rows={focused.quarters.map(q => ({ id: q.period, period: q.period, unitsM: q.unitsM }))}
          cols={QUARTER_COLS}
        />
      )}
      <HouseSectors />
    </Page>
    </>
  );
};

/* ------------------------------------------------------------------ short */

export const ShortFile = () => {
  const { ticker = '' } = useParams();
  const t = ticker.toUpperCase();
  const ok = /^[A-Z.]{1,6}$/.test(t);
  const shortLive = useShortRow(t);
  /* the file's own reads build the row for a name off the book, and fill what the screener row lacks */
  const reads = useShortReads(ok ? t : '');
  const card = useStockCard(ok ? t : '');
  const coName = useCompanyName(ok ? t : '', true);
  /* THE PRICE ON THE SHORT FILE (the retail test, round 7: GME's file had none) — the quote every page leads with */
  const quote = useLiveQuote(ok ? t : null);
  const priced = priceWords(quote);
  const isFund = card?.issueType ? FUND_TYPES.test(card.issueType) : undefined;
  const row = useMemo(() => {
    const made = ok ? shortRowFromFile(t, shortLive.row, reads) : null;
    return made ? { ...made, fund: made.fund ?? isFund, borrowAsOf: undefined } : null;
  }, [ok, t, shortLive.row, reads, isFund]);
  /* the Shorts list's read of the same name, from the settlement's figures alone — said beside this one when they differ */
  const listRead = useMemo(() => (shortLive.row ? squeezeRead(shortLive.row) : null), [shortLive.row]);
  const borrowDay = useMemo(() => {
    const rows = Array.isArray(reads.rebate) ? (reads.rebate as { timestamp?: string }[]) : [];
    const newest = rows.map(r => String(r.timestamp ?? '')).sort().reverse()[0];
    return newest ? newest.slice(0, 10) : null;
  }, [reads.rebate]);
  const fileWaiting = reads.waiting;
  /* THE SESSION'S FULL VOLUME (round 11), one screener row: the squeeze point is scored on short volume over it */
  const [fullVol, setFullVol] = useState<{ date: string; vol: number } | null>(null);
  useEffect(() => {
    if (!ok) return;
    let dead = false;
    whalesScreener([t])
      .then(rows => {
        const r = (Array.isArray(rows) ? rows : []).find(x => String(x.ticker || '').toUpperCase() === t);
        const v = Number(r?.stock_volume);
        if (!dead) setFullVol(r && v > 0 ? { date: String(r.date ?? '').slice(0, 10), vol: v } : null);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
    };
  }, [ok, t]);
  const [guideOpen, setGuideOpen] = useState(false);
  const [heavy, setHeavy] = useState<'any' | 'heavy'>('any');
  const [picks, setPicks] = useState<string[]>([]);
  const markets = useMemo(() => {
    if (!row) return [];
    return row.exchanges.map(e => ({ id: e.exchange, exchange: e.exchange, shortM: e.shortM, totalM: e.totalM, ratio: e.totalM ? (e.shortM / e.totalM) * 100 : 0 }));
  }, [row]);
  const shown = useMemo(() => {
    const cut = markets.filter(e => heavy === 'any' || e.ratio >= 50);
    return picks.length === 0 ? cut : cut.filter(e => picks.includes(e.exchange));
  }, [markets, heavy, picks]);
  const toKnow = useMemo(() => [...markets].sort((a, b) => b.ratio - a.ratio).slice(0, 6), [markets]);
  const toggle = (name: string) => setPicks(p => (p.includes(name) ? p.filter(x => x !== name) : [...p, name]));
  /* the latest session's short volume and the month's fails to deliver feed the squeeze read too */
  const squeeze = useMemo(() => {
    if (!row) return null;
    const since = nyIsoDaysBack(30);
    const fails = (Array.isArray(reads.ftd) ? reads.ftd : []) as { date?: string; quantity?: number | string }[];
    const recent = fails.filter(f => String(f.date ?? '') >= since).map(f => Number(f.quantity) || 0);
    /* the short volume against the session's full volume — the screener's day volume, the same session only */
    const full = fullVol && row.shortVolM != null && row.shortVolDate && fullVol.date === row.shortVolDate && fullVol.vol > 0 ? ((row.shortVolM * 1e6) / fullVol.vol) * 100 : null;
    return squeezeRead(row, {
      shortVolPct: row.shortVolRatio,
      shortVolFullPct: full,
      maxFtdShares: reads.ftd != null ? (recent.length ? Math.max(...recent) : 0) : null,
    });
  }, [row, reads, fullVol]);
  if (ok && !row && (shortLive.status === 'loading' || fileWaiting)) return <Reading to="/dossier/shorts" back="Shorts" what="the short print" />;
  if (!row) return <Missing to="/dossier/shorts" label="Shorts" />;
  const heavyBook = row.interestPct >= 8;
  const lead = toKnow[0];
  return (
    <>
    <WayBack to="/dossier/shorts" label="Shorts" />
    <Page testId={t}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the short" testId="short-guide" viewport>
        <ShortsGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="min-w-0 truncate text-t15 font-semibold leading-tight text-textPrimary">{t} short</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What interest, days to cover and the fee mean" testId="short-guide" />
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
            {[coName && coName !== t ? coName : row.name || '', row.sector && row.sector !== '—' ? row.sector : ''].filter(Boolean).concat(`short interest as of ${asOfDay(squeeze?.asOf)}${squeeze?.stale ? ' (stale)' : ''} — it settles twice a month`).join(' · ')}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="The stock's price now: in the session the last print; outside it the regular close, with the pre-market or after-hours print beside it">Price</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap" data-short-price>
              {priced ? (
                <>
                  ${priced.lead.toFixed(2)}
                  {quote && Number.isFinite(quote.changePct) ? <span className={quote.changePct >= 0 ? 'text-bull' : 'text-bear'}> {quote.changePct >= 0 ? '+' : '−'}{Math.abs(quote.changePct).toFixed(2)}%{quote.phase !== 'regular' && quote.regDate ? <span className="text-textMuted"> {shortDayOf(quote.regDate)}</span> : null}</span> : null}
                  {extendedLine(quote) ? <span className="text-textMuted"> · {extendedLine(quote)}</span> : null}
                </>
              ) : (
                <span className="text-textMuted">reading</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="The share of the float (the stock free to trade) sold short and not yet bought back">Interest</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap ${heavyBook ? 'text-bear font-semibold' : 'text-textPrimary'}`}>{row.interestPct.toFixed(2)}%</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="Days of normal trading volume the shorts would need to buy every share back">Days to cover</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{row.daysToCover.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title="Fee: what a short seller pays a year to borrow the shares — high means the shares are hard to find. Rebate: the interest the lender pays back on the cash collateral; negative means the short pays more">Fee · rebate</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap">{fileWaiting ? <span className="text-textMuted">reading today's borrow…</span> : <>{row.feeRate == null ? '—' : `${row.feeRate.toFixed(2)}%`} · {row.rebateRate == null ? '—' : `${row.rebateRate < 0 ? '−' : ''}${Math.abs(row.rebateRate).toFixed(2)}%`}</>}</dd>
          </div>
          {row.shortVolRatio != null ? (
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={`Of the last session's off-exchange volume reported to FINRA (dark pools and wholesalers — not the lit exchanges' trades), the share reported as short sales; market makers' hedges count too, so about half is ordinary. Source: ${row.shortVolSource ?? 'Unusual Whales short volume and ratio (FINRA)'}`}>Short volume · off-exchange</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary whitespace-nowrap">{row.shortVolRatio.toFixed(0)}%{row.shortVolDate ? <span className="text-textMuted"> · {asOfDay(row.shortVolDate)}</span> : null}</dd>
            {/* the source named on the card (audit round 6) */}
            <dd className="font-mono text-t9 text-textMuted whitespace-nowrap" data-short-vol-source>{row.shortVolSource?.startsWith('the by-market') ? 'FINRA CNMS · by-market rows' : 'FINRA CNMS · short volume read'}</dd>
          </div>
          ) : null}
        </dl>
      </div>
      {/* NO VERDICT ON THE SETTLEMENT ALONE (audit round 10: GME read "SQUEEZE WEAK" off the settlement's fee, "the feed
         sent no newer reading", before today's borrow landed and changed both) — held until the file's own reads settle */}
      {squeeze && fileWaiting && (
        <div className="mx-5 mb-3 rounded-md border border-borderMuted bg-card px-4 py-3" data-short-squeeze="reading">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-t10 font-semibold uppercase tracking-widest text-textPrimary cursor-help" title={SQUEEZE_TIP}>Squeeze setup</span>
            <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">reading today's borrow, the short volume and the fails…</span>
          </div>
        </div>
      )}
      {squeeze && !fileWaiting && (
        <div className="mx-5 mb-3 rounded-md border border-borderMuted bg-card px-4 py-3" data-short-squeeze={squeeze.word}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-t10 font-semibold uppercase tracking-widest text-textPrimary cursor-help" title={SQUEEZE_TIP}>Squeeze setup</span>
            <span className={`font-mono text-t13 font-bold uppercase tracking-widest ${SQUEEZE_INK[squeeze.word]}`}>{squeeze.word}</span>
            <span className="font-mono text-t10 text-textMuted">{squeeze.points} {squeeze.points === 1 ? 'point' : 'points'} · rules in the guide</span>
          </div>
          <ul className="mt-1.5 text-t12 leading-relaxed text-textSecondary list-disc pl-4">
            {squeeze.facts.map(f => (
              <li key={f.text}>{f.text}</li>
            ))}
          </ul>
          <p className={`mt-1 text-t10 ${squeeze.stale ? 'text-warn' : 'text-textMuted'}`}>
            Short interest as of {asOfDay(squeeze.asOf)}{squeeze.stale ? ' — a newer settlement should be out, so the shorts may have moved since' : ' — the latest settlement published; the next lands about seven business days after the 15th or month-end'}. {borrowDay ? `The fee and the shares to borrow are the latest reading, ${asOfDay(borrowDay)}.` : 'The fee and the shares to borrow are the settlement day’s — the feed sent no newer reading.'} A setup is not a forecast: it says the shorts would be squeezed if buyers came, not that they will.
          </p>
          {listRead && listRead.word !== squeeze.word ? (
            <p className="mt-1 text-t10 text-textSecondary" data-short-list-read={listRead.word}>
              The Shorts list reads this name <span className={`font-semibold uppercase ${SQUEEZE_INK[listRead.word]}`}>{listRead.word}</span>: it scores the settlement’s own figures only (fee {shortLive.row?.feeRate == null ? '—' : `${shortLive.row.feeRate.toFixed(2)}%`}, {borrowM(shortLive.row?.availableM ?? null)} to borrow on {asOfDay(shortLive.row?.borrowAsOf ?? listRead.asOf)}), while this file adds today’s borrow, the last session’s short volume and the fails to deliver.
            </p>
          ) : null}
        </div>
      )}
      <p className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-short-sentence>
        {row.shortSharesM.toFixed(1)}M shares short, {row.interestPct.toFixed(2)}% of a {row.floatM.toFixed(0)}M float, {row.daysToCover.toFixed(1)} days to cover.
        {row.availableM == null ? ' The feed did not say how many shares are left to borrow.' : row.availableM >= 10 - 1e-9 ? ' At least 10M shares are available to borrow.' : ` ${borrowM(row.availableM)} shares are available to borrow.`}
        {/* ONE MARKET IS NOT "THE HEAVIEST" (round 8: "FINRA CNMS printed the heaviest short volume, 51% of that market"
            with no other market on file). FINRA's CNMS rows are the off-exchange trades reported to its trade-reporting
            facilities — the dark pools and the wholesalers — so their total is off-exchange volume alone, never the day's. */}
        {lead && markets.length === 1 ? (
          <>
            {' '}
            On {row.exchangesDate ? asOfDay(row.exchangesDate) : 'the last session'}, {(lead.shortM).toFixed(2)}M of the {lead.totalM.toFixed(2)}M shares{' '}
            <span className="text-textPrimary font-semibold">{/finra/i.test(lead.exchange) ? 'traded off-exchange (reported to FINRA)' : `reported by ${lead.exchange}`}</span> were short sales, {lead.ratio.toFixed(0)}%
            {/finra/i.test(lead.exchange) ? ' — that total is off-exchange volume only; the lit exchanges’ trades are not in it' : ''}
            {row.exchangesDate && row.shortVolDate && row.exchangesDate !== row.shortVolDate ? ` (a session behind the ${row.shortVolRatio != null ? `${row.shortVolRatio.toFixed(0)}% ` : ''}short volume of ${asOfDay(row.shortVolDate)})` : ''}.
          </>
        ) : lead ? (
          <>
            {' '}
            <span className="text-textPrimary font-semibold">{lead.exchange}</span> printed the heaviest short volume{row.exchangesDate ? ` on ${asOfDay(row.exchangesDate)}` : ''}, {lead.ratio.toFixed(0)}% of that market{row.exchangesDate && row.shortVolDate && row.exchangesDate !== row.shortVolDate ? ` — the by-market figures are a session behind the ${row.shortVolRatio != null ? `${row.shortVolRatio.toFixed(0)}% ` : ''}short volume of ${asOfDay(row.shortVolDate)}` : ''}.
          </>
        ) : null}
      </p>
      {markets.length > 0 ? (
      <>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-short-controls>
        <DropdownSelect
          label="Market"
          value={heavy}
          options={[
            { value: 'any', label: 'Every market', short: 'All', hint: 'All of the session’s short volume' },
            { value: 'heavy', label: 'Half or more', hint: 'Short volume was half that market or more', tone: 'bear' },
          ]}
          onChange={setHeavy}
          title="Which markets"
          testId="short-market"
        />
      </div>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="short-know">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The markets to know</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">where the short volume printed{row.exchangesDate ? ` on ${asOfDay(row.exchangesDate)}` : ''} · click one to keep the grid to it</span>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {toKnow.map(e => (
            <button key={e.exchange} type="button" onClick={() => toggle(e.exchange)} aria-pressed={picks.includes(e.exchange)} className={KNOW(picks.includes(e.exchange))} data-short-know={e.exchange}>
              <span className="font-mono text-t12 font-bold text-textPrimary">{e.exchange}</span>
              <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
                <span className={`text-t13 font-bold ${e.ratio >= 50 ? 'text-bear' : 'text-textPrimary'}`}>{e.ratio.toFixed(0)}%</span>
                <span className="text-t9 text-textSecondary">of that market</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-book-grid="short-exchanges">
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={shown}
            overlayNoRowsTemplate={noRows('Nothing on this book')}
            columnDefs={EX_COLS}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.id}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
      </div>
      </>
      ) : null}
      <ShortHistory ticker={t} />
      {row.ftdDays.length > 0 ? <Board title="Fails to deliver" rest={`The day, the shares that failed, and the close · newest first, the latest on file ${asOfDay(row.ftdDays[0]?.date)} (the SEC publishes fails about two weeks late)`} testId="short-ftd" rows={row.ftdDays.map(d => ({ id: d.date, date: d.date, quantity: d.quantity, price: d.price }))} cols={FTD_COLS} /> : null}
    </Page>
    </>
  );
};

/* ------------------------------------------------------------------ fund */

export const FundFile = () => {
  const { etf = '' } = useParams();
  const fundLive = useEtfFile(etf.toUpperCase());
  const fund = fundLive.row;
  const [guideOpen, setGuideOpen] = useState(false);
  const [sector, setSector] = useState('all');
  const [picks, setPicks] = useState<string[]>([]);
  const fundPaged = usePagedGrid<EtfHolding>();
  const holdings = fundLive.holdings;
  const cover = fundLive.cover;
  /* THE WHOLE FUND'S SPLIT, NOT THE LINES READ (the data audit, 2026-10-22): the holdings route sends the largest 250 lines
     — 44% of IWM's 1,941 — and the page scaled those to 100% and called it "the book by country". The sector and
     country tables now read the fund's own weights (/etfs/{t}/weights), which cover the whole fund. */
  const weights = useEtfWeights(etf);
  const lineSectors = useMemo(() => weightSlices(holdings.map(h => ({ name: h.sector, weight: h.weight }))), [holdings]);
  const sectors = weights.sectors.length ? weights.sectors : [];
  const countries = weights.countries.length ? weights.countries : [];
  const partial = !!cover && cover.fundCount != null && cover.lines < cover.fundCount;
  const coverWords = cover && cover.lines > 0 ? `${partial ? `the top ${cover.lines} of ${cover.fundCount!.toLocaleString('en-US')} holdings` : `all ${cover.lines} holdings`} · ${cover.weight.toFixed(0)}% of the fund` : '';
  const sectorOptions = useMemo<DropdownOption<string>[]>(
    () => [{ value: 'all', label: 'Every sector', short: 'All', hint: 'Every line read' }, ...lineSectors.map(s => ({ value: s.name, label: s.name, hint: `${s.weight.toFixed(1)}% of the fund in the lines read` }))],
    [lineSectors],
  );
  const cut = useMemo(() => holdings.filter(h => sector === 'all' || h.sector === sector), [holdings, sector]);
  const rows = useMemo(() => (picks.length === 0 ? cut : cut.filter(h => picks.includes(h.ticker))), [cut, picks]);
  const toKnow = useMemo(() => [...cut].sort((a, b) => b.weight - a.weight).slice(0, 6), [cut]);
  const toggle = (ticker: string) => setPicks(p => (p.includes(ticker) ? p.filter(x => x !== ticker) : [...p, ticker]));
  const cols = useMemo<ColDef<EtfHolding>[]>(
    () => [
      {
        headerName: 'Name',
        headerTooltip: 'The holding — a stock, or a bond issue by name',
        field: 'ticker',
        flex: 1.4,
        minWidth: 180,
        cellRenderer: ({ data }: ICellRendererParams<EtfHolding>) =>
          data ? (
            data.bond ? (
              <span className="text-t12 text-textPrimary truncate" title={data.name}>{data.name}</span>
            ) : (
            <span className="inline-flex items-center gap-2 min-w-0">
              <CompanyLogo ticker={data.ticker} size={16} />
              <span className="flex flex-col leading-tight min-w-0">
                <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
                <CoSub ticker={data.ticker} />
              </span>
            </span>
            )
          ) : null,
      },
      { headerName: 'Sector', field: 'sector', flex: 1, minWidth: 140, headerTooltip: 'The sector it files under' },
      { headerName: 'Country', field: 'country', width: 140, headerTooltip: 'Where the company is based' },
      { headerName: 'Shares', field: 'sharesM', width: 120, type: 'rightAligned', valueFormatter: p => (p.data?.bond ? `${moneyB(Number(p.value) / 1000)} face` : `${Number(p.value).toFixed(1)}M`), headerTooltip: 'Shares held — for a bond line, the face amount' },
      {
        headerName: 'Weight',
        headerTooltip: "The share of the fund's money in this line, from the fund's own holdings file",
        field: 'weight',
        flex: 1,
        minWidth: 160,
        cellRenderer: ({ data }: ICellRendererParams<EtfHolding>) =>
          data ? (
            <span className="flex items-center gap-2 h-full w-full pr-2">
              <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
                <span className="absolute left-0 top-0 h-full rounded-full bg-silver" style={{ width: `${Math.min(100, data.weight * 4)}%` }} />
              </span>
              <span className="font-mono text-t11 tnum text-textPrimary w-[48px] text-right">{data.weight.toFixed(data.weight < 1 ? 2 : 1)}%</span>
            </span>
          ) : null,
      },
    ],
    [],
  );
  if (fundLive.status === 'loading' && !fund) return <Reading to="/dossier/etfs" back="ETFs" what="the fund" />;
  if (!fund) return <Missing to="/dossier/etfs" label="ETFs" />;
  const lead = toKnow[0];
  return (
    <>
    <WayBack to="/dossier/etfs" label="ETFs" />
    <Page testId={fund.etf}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the fund" testId="fund-guide" viewport>
        <EtfsGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="min-w-0 truncate text-t15 font-semibold leading-tight text-textPrimary">{fund.etf} · {fund.name}</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a weight, a flow and a holding mean" testId="fund-guide" />
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
            {fund.company} · {fund.domicile} · since {longDay(fund.inception)}{fund.holdingsAsOf ? ` · weights as of ${asOfDay(fund.holdingsAsOf)}` : ''}{coverWords ? ` · ${coverWords}` : ''}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Assets")}>Assets</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{moneyB(fund.aumB)}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Fee")}>Fee</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{fund.expensePct == null ? '—' : `${fund.expensePct.toFixed(2)}%`}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Five-day flow")}>Five-day flow</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap ${ink(fund.flow5dM)}`}>{moneyFlow(fund.flow5dM)}</dd>
          </div>
          <div>
            {/* dated by its session (round 11): outside the session it is the last session's, not "today" */}
            <dt className="text-t10 text-textMuted" title={`Option contracts traded on ${shortDayOf(lastSessionIso())}${lastSessionIso() === nyTodayIso() ? ', today' : ', the last session'}`}>Call · put volume · {shortDayOf(lastSessionIso())}</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum whitespace-nowrap">
              <span className="text-bull">{fund.callVol == null ? '—' : fund.callVol.toLocaleString('en-US')}</span>
              <span className="text-textMuted"> · </span>
              <span className="text-bear">{fund.putVol == null ? '—' : fund.putVol.toLocaleString('en-US')}</span>
            </dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-fund-controls>
        <DropdownSelect label="Sector" value={sector} options={sectorOptions} onChange={setSector} title="Which sector of the book" testId="fund-sector" />
      </div>
      <p className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-fund-sentence>
        {lead ? (
          <>
            <span className="text-textPrimary font-semibold">{lead.bond ? lead.name : lead.ticker}</span> is the largest line, {lead.weight.toFixed(2)}% of {fund.etf}{partial ? ` — the grid is ${coverWords}, so it does not add to 100%` : ''}. Five sessions: {fund.flows.map(f => `${f.day} ${moneyFlow(f.flowM)}`).join(', ')}.
          </>
        ) : holdings.length === 0 && fund.holdingsCount === 0 ? (
          `${fund.etf} holds no securities on file — ${fund.kind === 'commodity' ? 'the trust holds the commodity itself' : 'the fund lists no holdings'}.`
        ) : (
          'Nothing in this book on this cut.'
        )}
      </p>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="fund-know">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The lines to know</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">the largest weights · click one to keep the grid to it</span>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {toKnow.map(h => (
            <button key={h.ticker} type="button" onClick={() => toggle(h.ticker)} aria-pressed={picks.includes(h.ticker)} className={KNOW(picks.includes(h.ticker))} data-fund-know={h.ticker}>
              <span className="flex items-center gap-2 min-w-0">
                {h.bond ? (
                  <span className="text-t12 font-bold text-textPrimary truncate" title={h.name}>{h.name}</span>
                ) : (
                  <>
                    <CompanyLogo ticker={h.ticker} size={18} />
                    <span className="font-mono text-t12 font-bold text-textPrimary">{h.ticker}</span>
                    <CoSub ticker={h.ticker} className="text-t10 text-textSecondary truncate" />
                  </>
                )}
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
                <span className="text-t13 font-bold text-textPrimary">{h.weight.toFixed(h.weight < 1 ? 2 : 1)}%</span>
                <span className="text-t9 text-textSecondary">{h.sector}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-fund-holdings>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<EtfHolding>
            {...phonePin}
            {...fundPaged.props}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('No holding on file')}
            columnDefs={cols}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.ticker}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
        {fundPaged.bar(rows.length, 'fund-holdings')}
      </div>
      <Board title="Sectors" rest={weights.status === 'loading' ? 'Reading the fund’s weights' : 'The whole fund by sector, from the fund’s own weights — not only the lines above'} testId="fund-sectors" rows={sectors.map(s => ({ id: s.name, name: s.name, weight: s.weight }))} cols={SECTOR_COLS} reading={weights.status === 'loading'} />
      <Board title="Countries" rest={weights.status === 'loading' ? 'Reading the fund’s weights' : `The whole fund by country, from the fund’s own weights${(() => { const t = countries.reduce((a, c) => a + c.weight, 0); return countries.length && Math.abs(t - 100) > 2 ? ` — the fund's file adds to ${t.toFixed(0)}%, as sent` : ''; })()}`} testId="fund-countries" rows={countries.map(s => ({ id: s.name, name: s.name, weight: s.weight }))} cols={COUNTRY_COLS} reading={weights.status === 'loading'} />
    </Page>
    </>
  );
};


const Bar = ({ pct, heavy }: { pct: number; heavy?: boolean }) => (
  <span className="flex items-center gap-2 h-full w-full pr-2">
    <span className={`font-mono text-t11 tnum w-[44px] ${heavy ? 'text-bear font-semibold' : 'text-textPrimary'}`}>{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
    <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
      <span className={`absolute left-0 top-0 h-full rounded-full ${heavy ? 'bg-bear' : 'bg-silver'}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  </span>
);

type IdRow = { id: string };

const EX_COLS: ColDef<{ id: string; exchange: string; shortM: number; totalM: number; ratio: number }>[] = [
  { headerName: 'Exchange', field: 'exchange', flex: 1.2, minWidth: 140, headerTooltip: 'The trading venue that reported the short volume' },
  { headerName: 'Short', field: 'shortM', width: 110, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(2)}M`, headerTooltip: 'Shares sold short on that venue in the session, millions' },
  { headerName: 'Total', field: 'totalM', width: 110, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(2)}M`, headerTooltip: 'All shares traded on that venue in the session, millions' },
  { headerName: 'Of that market', field: 'ratio', flex: 1, minWidth: 140, cellRenderer: ({ data }: ICellRendererParams<{ ratio: number }>) => (data ? <Bar pct={data.ratio} heavy={data.ratio >= 50} /> : null), headerTooltip: 'Short sales as a share of that venue\'s volume — market makers\' hedges count, so about half is ordinary' },
];
const FTD_COLS: ColDef<{ id: string; date: string; quantity: number; price: number }>[] = [
  { headerName: 'Day', field: 'date', flex: 1, minWidth: 120, valueFormatter: p => reportDayLabelYear(String(p.value ?? '')), headerTooltip: 'The settlement day the shares failed to deliver' },
  { headerName: 'Shares', field: 'quantity', width: 120, type: 'rightAligned', valueFormatter: p => Number(p.value).toLocaleString('en-US'), headerTooltip: 'Shares sold but not delivered on time' },
  { headerName: 'Close', field: 'price', width: 100, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `$${Number(p.value).toFixed(2)}` : '—'), headerTooltip: 'The stock\'s close that day' },
];
const QUARTER_COLS: ColDef<{ id: string; period: string; unitsM: number }>[] = [
  { headerName: 'Quarter', field: 'period', flex: 1, minWidth: 120, headerTooltip: 'The 13F quarter the figure is from' },
  {
    headerName: 'Units',
    headerTooltip: 'Shares the house reported at the end of that quarter',
    field: 'unitsM',
    flex: 1.4,
    minWidth: 180,
    cellRenderer: ({ data }: ICellRendererParams<{ unitsM: number }>) =>
      data ? (
        <span className="flex items-center gap-2 h-full w-full pr-2">
          <span className="font-mono text-t11 tnum w-[56px] text-textPrimary">{data.unitsM.toFixed(1)}M</span>
          <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
            <span className="absolute left-0 top-0 h-full rounded-full bg-silver" style={{ width: `${Math.min(100, data.unitsM / 1.8)}%` }} />
          </span>
        </span>
      ) : null,
  },
];
const WEIGHT_BAR: ColDef<{ id: string; name: string; weight: number }> = { headerName: 'Weight', field: 'weight', flex: 1, minWidth: 140, cellRenderer: ({ data }: ICellRendererParams<{ weight: number }>) => (data ? <Bar pct={data.weight} /> : null), headerTooltip: 'Share of the whole' };
const SECTOR_COLS: ColDef<{ id: string; name: string; weight: number }>[] = [{ headerName: 'Sector', field: 'name', flex: 1.2, minWidth: 140, headerTooltip: 'The sector it files under' }, WEIGHT_BAR];
const COUNTRY_COLS: ColDef<{ id: string; name: string; weight: number }>[] = [{ headerName: 'Country', field: 'name', flex: 1.2, minWidth: 140, headerTooltip: 'Where the company is based' }, WEIGHT_BAR];

function Board<T extends IdRow>({ title, rest, testId, rows, cols, reading = false }: { title: string; rest: string; testId: string; rows: T[]; cols: ColDef<T>[]; /** the read is still out — never "nothing" before it lands (round 8) */ reading?: boolean }) {
  return (
    <div>
      <div className="px-5 border-t border-borderSubtle/60">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>{title}</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">{rest}</span>
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-book-grid={testId}>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<T>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows(reading ? 'Reading' : 'Nothing on file')}
            key={reading ? 'reading' : 'read'}
            columnDefs={cols}
            defaultColDef={defaultColDef}
            getRowId={p => p.data?.id ?? ''}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ member */

type TypePick = 'any' | 'Purchase' | 'Sale' | 'Exchange';
type OwnerPick = 'any' | ReportOwner;

const TYPE_OPTIONS: DropdownOption<TypePick>[] = [
  { value: 'any', label: 'Every report', short: 'All', hint: 'Purchases, sales and exchanges' },
  { value: 'Purchase', label: 'Purchases', hint: 'Bought', tone: 'bull' },
  { value: 'Sale', label: 'Sales', hint: 'Sold, full or partial', tone: 'bear' },
  { value: 'Exchange', label: 'Exchanges', hint: 'Swapped, not bought or sold' },
];
const OWNER_FILE_OPTIONS: DropdownOption<OwnerPick>[] = [
  { value: 'any', label: 'Any owner', short: 'All', hint: 'Self, spouse, joint or a dependent' },
  { value: 'Self', label: 'Self', hint: "The member's own holding" },
  { value: 'Undisclosed', label: 'Not stated', hint: 'The filing does not say whose holding it is' },
  { value: 'Spouse', label: 'Spouse', hint: "The spouse's holding" },
  { value: 'Joint', label: 'Joint', hint: 'A joint account' },
  { value: 'Dependent', label: 'Dependent', hint: "A dependent's holding" },
];

const typeOf = (t: CongressTrade): TypePick => (t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : 'Sale');

export const MemberFile = () => {
  const { member: id = '' } = useParams();
  const phone = usePhoneCards();
  useVendor('dossier', '', `/dossier/congress/${id}`);
  /* THE ROSTER NAMES THE MEMBER (round 8: the page walked the whole 90-day book for a name) — the book is read only
     for a member the roster does not list */
  const rosterStatus = useCongressRoster();
  const roster = memberFromRoster(id);
  const needBook = rosterStatus !== 'loading' && !roster;
  const feed = useCongressFeedIf(needBook, 365);
  const bookStatus = useCongressStatusQuiet();
  const congressStatus = needBook ? bookStatus : rosterStatus;
  const fromFeed = needBook ? feed.trades.find(t => t.member.id === id)?.member ?? null : null;
  /* the member's identity from the market book, else the politician roster (a member with no trade in the book's reach) */
  const member = fromFeed ?? (roster ? congressFromWhales([{ politician_id: id, name: roster.name, txn_type: 'Buy', transaction_date: nyIsoDaysBack(0), filed_at_date: nyIsoDaysBack(0) }], [roster]).trades[0]?.member ?? null : null);
  /* their own reports of trades made in the last year — not the latest 40 by name */
  const book = useMemberBook(id, member?.name ?? null);
  const coverage = useCongressCoverageQuiet();
  const [guideOpen, setGuideOpen] = useState(false);
  const [kind, setKind] = useState<TypePick>('any');
  const [owner, setOwner] = useState<OwnerPick>('any');
  const [picks, setPicks] = useState<string[]>([]);
  /* Treasury bills hidden by default, counted (audit round 5) — the equity trades surface */
  const [hideBills, setHideBills] = useState(true);
  const billsHidden = hideBills ? book.trades.filter(isTreasuryBill).length : 0;
  const trades = useMemo(() => (hideBills ? book.trades.filter(t => !isTreasuryBill(t)) : book.trades), [book.trades, hideBills]);
  const cut = useMemo(
    () => trades.filter(t => (kind === 'any' || typeOf(t) === kind) && (owner === 'any' || t.owner === owner)),
    [trades, kind, owner],
  );
  const rows = useMemo(() => (picks.length === 0 ? cut : cut.filter(t => picks.includes(assetKey(t)))), [cut, picks]);
  const toKnow = useMemo(() => {
    const by = new Map<string, CongressTrade>();
    for (const t of cut) {
      const k = assetKey(t);
      const have = by.get(k);
      if (!have || (t.bracket ?? -1) > (have.bracket ?? -1)) by.set(k, t);
    }
    return [...by.values()].sort((a, b) => (b.bracket ?? -1) - (a.bracket ?? -1)).slice(0, 6);
  }, [cut]);
  /* bought in the year's reports, with no full sale of the same asset in them since — what the reports show, NOT a
     holdings disclosure (that is the annual report, which this key cannot read) */
  const held = useMemo(() => {
    const ordered = [...trades].sort((a, b) => b.tradedDaysAgo - a.tradedDaysAgo);
    const open = new Map<string, CongressTrade>();
    for (const t of ordered) {
      const key = `${holdingAssetKey(t)}|${t.owner}`;
      if (t.type === 'Purchase') open.set(key, t);
      else if (t.type !== 'Exchange') open.delete(key);
    }
    return [...open.values()];
  }, [trades]);
  const cols = useMemo<ColDef<CongressTrade>[]>(
    () => [
      { headerName: 'Filed', field: 'filedDaysAgo', width: 146, cellRenderer: ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.filedDaysAgo} /> : null), headerTooltip: 'The day the report was filed' },
      {
        headerName: 'Asset',
        headerTooltip: 'The stock the report names',
        field: 'ticker',
        flex: 1.3,
        minWidth: 160,
        cellRenderer: AssetCell,
      },
      { headerName: 'Type', field: 'type', width: 130, cellRenderer: ({ data }: ICellRendererParams<CongressTrade>) => (data ? <span className={`font-mono text-t11 ${data.type === 'Purchase' ? 'text-bull' : data.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}`}>{data.type}</span> : null), headerTooltip: 'Purchase, sale (full or partial) or exchange' },
      { headerName: 'Owner', field: 'owner', width: 110, valueFormatter: p => (p.value ? ownerWord(p.value as ReportOwner) : ''), cellClass: 'uppercase', headerTooltip: 'Whose holding: the member\'s own, a spouse\'s, a joint account or a dependent\'s — "not stated" when the filing does not say' },
      { headerName: 'Amount', field: 'bracket', flex: 1.2, minWidth: 180, valueFormatter: p => (p.data ? amountWord(p.data) : ''), headerTooltip: 'The disclosed bracket — members report a range, never an exact figure' },
      { headerName: 'Lag', field: 'lagDays', width: 90, cellRenderer: ({ data }: ICellRendererParams<CongressTrade>) => (data ? <span className={`font-mono text-t11 tnum ${data.late ? 'text-bear' : 'text-textPrimary'}`} title={data.lagDays === 0 ? `Filed the day it traded (${data.tradedOn ?? ''}), as the filing records it` : undefined}>{data.lagDays === 0 ? 'same day' : `${data.lagDays}d`}</span> : null), headerTooltip: 'Days from the trade to the report; past 45 is late under the STOCK Act' },
    ],
    [],
  );
  if ((congressStatus === 'loading' || coverage.reading) && !member) {
    return (
      <>
        <WayBack to="/dossier/congress" label="Congress" />
        <Page testId="member-loading">
          <p className="px-5 py-8 text-t12 text-textSecondary">Reading the record.</p>
        </Page>
      </>
    );
  }
  if (!member) return <Missing to="/dossier/congress" label="Congress" />;
  /* "…" UNTIL THE REPORTS ARE READ (audit round 10: "Reports 0 · Purchases 0 · Sales 0 · Late 0 · T-bills hidden · 0"
     stood for a second and a half beside "Reading their reports") */
  const reading = book.status === 'loading';
  const dots = <span className="text-textMuted">…</span>;
  const late = trades.filter(t => t.late).length;
  const purchases = trades.filter(t => t.type === 'Purchase').length;
  const sales = trades.filter(t => t.type.startsWith('Sale')).length;
  const toggle = (ticker: string) => setPicks(p => (p.includes(ticker) ? p.filter(x => x !== ticker) : [...p, ticker]));
  return (
    <>
    <WayBack to="/dossier/congress" label="Congress" />
    <Page testId={member.id}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the book" testId="member-guide" viewport>
        <CongressGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="min-w-0 truncate text-t15 font-semibold leading-tight text-textPrimary">{member.name}</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a report, a bracket and a lag mean" testId="member-guide" />
          </div>
          <p className="mt-0.5 text-t11 text-textMuted whitespace-nowrap truncate">
            {/* the seat once — "R-OK-1 · OK-1" said the district twice */}
            {seatLabel(member) || '—'} · {member.chamber}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Reports")}>Reports</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-textPrimary">{reading ? dots : trades.length.toLocaleString('en-US')}{!reading && trades.length - purchases - sales > 0 ? <span className="text-textMuted"> · {(trades.length - purchases - sales).toLocaleString('en-US')} exchanged</span> : null}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Purchases")}>Purchases</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-bull">{reading ? dots : purchases}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Sales")}>Sales</dt>
            <dd className="mt-0.5 font-mono text-t12 tnum text-bear">{reading ? dots : sales}</dd>
          </div>
          <div>
            <dt className="text-t10 text-textMuted cursor-help" title={statHelp("Late")}>Late</dt>
            <dd className={`mt-0.5 font-mono text-t12 tnum ${late ? 'text-bear' : 'text-textPrimary'}`}>{reading ? dots : late}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-member-controls>
        <DropdownSelect label="Type" value={kind} options={TYPE_OPTIONS} onChange={setKind} title="Purchase, sale or exchange" testId="member-type" />
        <DropdownSelect label="Owner" value={owner} options={OWNER_FILE_OPTIONS} onChange={setOwner} title="Whose holding" testId="member-owner" />
        <BillsSwitch hide={hideBills} onToggle={() => setHideBills(v => !v)} hidden={billsHidden} testId="member-bills" reading={reading} />
      </div>
      <p className="px-5 pb-3 text-t12 leading-relaxed text-textSecondary" data-member-sentence>
        {book.status === 'loading'
          ? 'Reading their reports.'
          : book.status === 'sim'
            ? 'Their reports did not load.'
            : <>{trades.length.toLocaleString('en-US')} {trades.length === 1 ? 'report' : 'reports'} of trades made in the last year{book.complete ? '' : ` — the read stopped at ${trades.length}, so older ones in the year may be missing`}. {late === 0 ? 'None' : late} filed past {STOCK_ACT_DEADLINE_DAYS} days.{book.unreadTypes ? ` ${book.unreadTypes} with an unreadable type left out.` : ''}{billsHidden ? ` ${billsHidden.toLocaleString('en-US')} Treasury-bill ${billsHidden === 1 ? 'report is' : 'reports are'} hidden from these counts.` : ''} Amounts are the disclosed ranges, nothing finer.</>}
      </p>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="member-know">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The names to know</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">the largest bracket on this cut · click one to keep the grid to it</span>
        </div>
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-t10 uppercase tracking-widest text-textMuted">{book.status === 'loading' ? 'Reading their reports' : book.status === 'sim' ? 'This read did not land' : 'No report on this cut'}</div>
        ) : (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {toKnow.map(t => {
              const k = assetKey(t);
              const line = assetLine(t);
              return (
              <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={picks.includes(k)} className={KNOW(picks.includes(k))} data-member-know={k} title={line.sub ? `${line.title} · ${line.sub}` : line.title}>
                <span className="flex items-center gap-2 min-w-0">
                  {line.sym ? <CompanyLogo ticker={line.sym} size={18} /> : null}
                  <span className={`text-t12 font-bold text-textPrimary truncate ${line.sym ? 'font-mono' : ''}`}>{line.sym || k}</span>
                </span>
                <span className="mt-1.5 block font-mono text-t10 tnum text-textSecondary whitespace-normal break-words">{amountWord(t)}</span>
              </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-member-trades>
        {phone ? (
          <PhoneCards rows={rows} rowKey={t => t.id} card={t => CongressCard(t, false)} empty={book.status === 'loading' ? 'Reading their reports' : 'No report on this book'} testId="member-trades" resetKey={rows} />
        ) : (
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<CongressTrade>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows(book.status === 'loading' ? 'Reading their reports' : 'No report on this book')}
            key={book.status}
            columnDefs={cols}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.id}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
        )}
      </div>
      <Board
        title="Bought, no sale reported since"
        rest="Purchases in this year's reports with no later sale of any kind of the same asset in them (a partial sale takes the line off too) — not a holdings disclosure. The range, never a midpoint."
        testId="member-held"
        rows={held.map(t => ({ id: `${holdingAssetKey(t)}|${t.owner}`, ticker: assetLine(t).sym || assetLine(t).title, owner: ownerWord(t.owner), amount: amountWord(t) }))}
        cols={HELD_COLS}
        reading={book.status === 'loading'}
      />
    </Page>
    </>
  );
};

/** The disclosed amount as the list says it: an open-ended filing is "Over $1M", never the next bracket's range */
const amountWord = (t: CongressTrade): string =>
  t.amountOver != null ? `Over $${t.amountOver >= 1e6 ? `${t.amountOver / 1e6}M` : `${Math.round(t.amountOver / 1e3)}K`}` : bracketLabel(t.bracket);

const HELD_COLS: ColDef<{ id: string; ticker: string; owner: string; amount: string }>[] = [
  { headerName: 'Name', field: 'ticker', flex: 1, minWidth: 120, headerTooltip: 'The stock' },
  { headerName: 'Owner', field: 'owner', width: 120, headerTooltip: 'Whose holding: the member\'s own, a spouse\'s, a joint account or a dependent\'s' },
  { headerName: 'Amount', field: 'amount', flex: 1.4, minWidth: 200, headerTooltip: 'The disclosed bracket — members report a range, never an exact figure' },
];

