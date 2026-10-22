/*
  A HOUSE, A SHORT FILE, A FUND.

  The same page the lists are. One bordered desk: the head and four
  facts, one line of controls with the way back on it, one sentence,
  then the house grid. Not a second, grayer page.
*/

import { useMemo, useState, type ReactNode } from 'react';
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
import { useEtfFile, useHouseBook, useShortRow } from '../../data/liveFiles';
import { tickerName } from '../../data/tickers';
import { AssetCell, assetKey, assetLine } from './Congress';
import { moneyB, signedM as moneyFlow } from './money';
import { usePagedGrid } from '../../components/record/pagedGrid';
import { MEMBERS, STOCK_ACT_DEADLINE_DAYS, bracketLabel, seatLabel } from '../../data/congress';
import { useCongressFeed, useLiveRecord } from '../../data/liveRecord';
import { congressFromWhales } from '../../data/whalesMap';
import { congressBookKey, useVendor, useVendorRow } from '../../data/vendorFeed';
import { HouseSectors, ShortHistory } from '../../components/vendor/LiveDesk';
import type { UwCongress } from '../../data/whales';
import type { CongressTrade, ReportOwner } from '../../types/record';

const KNOW = (on: boolean) => `group text-left rounded-md border px-3 py-2.5 transition-colors min-w-0 ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`;
const ink = (n: number) => (n > 0 ? 'text-bull' : n < 0 ? 'text-bear' : 'text-textMuted');
const defaultColDef = { sortable: true, resizable: true, suppressMovable: true };

const Page = ({ testId, children }: { testId: string; children: ReactNode }) => (
  <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-book-file={testId}>
    {children}
  </div>
);

const WayBack = ({ to, label }: { to: string; label: string }) => (
  <Link to={to} data-name-back className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-textSecondary hover:text-textPrimary transition-colors">
    <ArrowLeft className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-hover:-translate-x-0.5" /> {label}
  </Link>
);

const Missing = ({ to, label }: { to: string; label: string }) => (
  <>
    <WayBack to={to} label={label} />
    <Page testId="missing">
      <p className="px-5 py-4 text-[12px] text-textSecondary">That record is not on this book.</p>
    </Page>
  </>
);

/* ------------------------------------------------------------------ house */

type BookPick = 'any' | InstitutionRow['book'];
type StatusPick = 'any' | PositionStatus;

const BOOK_OPTIONS: DropdownOption<BookPick>[] = [
  { value: 'any', label: 'Any side', hint: 'Shares, calls and puts' },
  { value: 'stock', label: 'Shares', hint: 'The filing left put/call empty' },
  { value: 'calls', label: 'Calls', hint: 'Marked call. No strike, no expiry' },
  { value: 'puts', label: 'Puts', hint: 'Marked put. No strike, no expiry' },
];
const STATUS_OPTIONS: DropdownOption<StatusPick>[] = [
  { value: 'any', label: 'Any change', hint: 'New, added, cut, closed and held' },
  { value: 'new', label: 'New', hint: 'Not on the prior 13F' },
  { value: 'added', label: 'Added', hint: 'More units than last quarter', tone: 'bull' },
  { value: 'cut', label: 'Cut', hint: 'Fewer units than last quarter', tone: 'bear' },
  { value: 'closed', label: 'Closed', hint: 'Sold out, or nearly', tone: 'bear' },
  { value: 'held', label: 'Held', hint: 'About the same as last quarter' },
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
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        <span className="text-[10px] text-textMuted truncate">{tickerName(data.ticker)}</span>
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
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 170, cellRenderer: HouseName },
      { headerName: 'Side', field: 'book', width: 84, valueFormatter: p => (p.value === 'stock' ? 'Shares' : p.value === 'calls' ? 'Call' : 'Put'), headerTooltip: 'Call, put, or the shares. The filing does not name a strike or an expiry.' },
      { headerName: 'Change', field: 'status', width: 92, cellRenderer: ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-[11px] ${STATUS_INK[data.status]}`}>{positionWord(data.status)}</span> : null) },
      { headerName: 'Units', field: 'sharesM', width: 96, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(1)}M` },
      { headerName: 'Units Δ', field: 'unitsChangeM', width: 100, type: 'rightAligned', cellRenderer: ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-[11px] tnum ${ink(data.unitsChangeM)}`}>{data.unitsChangeM > 0 ? '+' : ''}{data.unitsChangeM.toFixed(1)}M</span> : null) },
      { headerName: 'Value', field: 'valueB', width: 96, type: 'rightAligned', valueFormatter: p => moneyB(Number(p.value)) },
      { headerName: 'Avg price', field: 'avgPrice', width: 100, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `$${Number(p.value).toFixed(2)}` : '—') },
      { headerName: '% of book', field: 'pctOfBook', width: 100, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(1)}%` },
      { headerName: '% of co.', field: 'pctOfShares', width: 96, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(2)}%` },
      { headerName: 'First buy', field: 'firstBuy', width: 110 },
      { headerName: 'First price', field: 'firstPrice', width: 100, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `$${Number(p.value).toFixed(2)}` : '—'), headerTooltip: 'The close on the day of the first buy. Not a strike.' },
    ],
    [],
  );
  if (bookLive.status === 'loading' && !house) return <Missing to="/dossier/institutions" label="Reading the filing" />;
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
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">{house}</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a 13F line means" testId="house-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">This filing, line by line. A call or a put is only the side.</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted">Value</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{moneyB(value)}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Calls</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{moneyB(callValue)}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Puts</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{moneyB(putValue)}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Changed</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{changed.length}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-house-controls>
        <DropdownSelect label="Side" value={book} options={BOOK_OPTIONS} onChange={setBook} title="Shares, call, or put. Not a contract." testId="house-book" />
        <DropdownSelect label="Change" value={status} options={STATUS_OPTIONS} onChange={setStatus} title="What happened versus the prior 13F" testId="house-status" />
      </div>
      <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-house-sentence>
        {house} reported {moneyB(value)} across {feed.length} lines. Calls {moneyB(callValue)}, puts {moneyB(putValue)}. {changed.length} lines changed size versus the prior quarter.
        {line ? <> The line you opened is {line}.</> : null}
        {focused ? (focused.quarters.length > 1 ? <> {focused.quarters.length} quarters of {focused.ticker} sit under the grid, {focused.quarters[0]?.unitsM.toFixed(1)}M units in {focused.quarters[0]?.period} and {focused.quarters[focused.quarters.length - 1]?.unitsM.toFixed(1)}M now.</> : <> One quarter of {focused.ticker} is on file, {focused.quarters[0]?.unitsM.toFixed(1)}M units.</>) : null}
      </p>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="house-know">
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The lines to know</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">the largest by value · click one to read its eight quarters</span>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {toKnow.map(r => (
            <button key={r.id} type="button" onClick={() => setFocus(r.ticker)} aria-pressed={focused?.ticker === r.ticker} className={KNOW(focused?.ticker === r.ticker)} data-house-know={r.ticker}>
              <span className="flex items-center gap-2 min-w-0">
                <CompanyLogo ticker={r.ticker} size={18} />
                <span className="font-mono text-[12px] font-bold text-textPrimary">{r.ticker}</span>
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
                <span className="text-[13px] font-bold text-textPrimary">{moneyB(r.valueB)}</span>
                <span className={`text-[9px] ${ink(r.unitsChangeM)}`}>{r.unitsChangeM > 0 ? '+' : ''}{r.unitsChangeM.toFixed(1)}M</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-house-lines>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<InstitutionRow>
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
  const row = ok ? shortLive.row : null;
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
  if (ok && shortLive.status === 'loading') return <Missing to="/dossier/shorts" label="Reading the short print" />;
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
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">{t} short</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What interest, days to cover and the fee mean" testId="short-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            {[row.name || (tickerName(t) !== t ? tickerName(t) : ''), row.sector && row.sector !== '—' ? row.sector : ''].filter(Boolean).concat('the latest short-interest print').join(' · ')}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted">Interest</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${heavyBook ? 'text-bear font-semibold' : 'text-textPrimary'}`}>{row.interestPct.toFixed(2)}%</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Days to cover</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{row.daysToCover.toFixed(1)}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Fee · rebate</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{row.feeRate == null ? '—' : `${row.feeRate.toFixed(2)}%`} · {row.rebateRate == null ? '—' : `${row.rebateRate.toFixed(2)}%`}</dd>
          </div>
          {row.shortVolRatio != null ? (
          <div>
            <dt className="text-[10px] text-textMuted">Short volume</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{row.shortVolRatio.toFixed(0)}%</dd>
          </div>
          ) : null}
        </dl>
      </div>
      <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-short-sentence>
        {row.shortSharesM.toFixed(1)}M shares short, {row.interestPct.toFixed(2)}% of a {row.floatM.toFixed(0)}M float, {row.daysToCover.toFixed(1)} days to cover.
        {row.availableM == null ? ' The feed did not say how many shares are left to borrow.' : ` ${row.availableM.toFixed(2)}M shares are available to borrow.`}
        {lead ? (
          <>
            {' '}
            <span className="text-textPrimary font-semibold">{lead.exchange}</span> printed the heaviest short volume, {lead.ratio.toFixed(0)}% of that market.
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
            { value: 'any', label: 'Every market', hint: 'All of the session’s short volume' },
            { value: 'heavy', label: 'Half or more', hint: 'Short volume was half that market or more', tone: 'bear' },
          ]}
          onChange={setHeavy}
          title="Which markets"
          testId="short-market"
        />
      </div>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="short-know">
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The markets to know</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">where the short volume printed · click one to keep the grid to it</span>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {toKnow.map(e => (
            <button key={e.exchange} type="button" onClick={() => toggle(e.exchange)} aria-pressed={picks.includes(e.exchange)} className={KNOW(picks.includes(e.exchange))} data-short-know={e.exchange}>
              <span className="font-mono text-[12px] font-bold text-textPrimary">{e.exchange}</span>
              <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
                <span className={`text-[13px] font-bold ${e.ratio >= 50 ? 'text-bear' : 'text-textPrimary'}`}>{e.ratio.toFixed(0)}%</span>
                <span className="text-[9px] text-textSecondary">of that market</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-book-grid="short-exchanges">
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact
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
      {row.ftdDays.length > 0 ? <Board title="Fails to deliver" rest="The day, the shares that failed, and the close" testId="short-ftd" rows={row.ftdDays.map(d => ({ id: d.date, date: d.date, quantity: d.quantity, price: d.price }))} cols={FTD_COLS} /> : null}
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
  const sectors = useMemo(() => shareOf(weightSlices(holdings.map(h => ({ name: h.sector, weight: h.weight })))), [holdings]);
  const countries = useMemo(() => shareOf(weightSlices(holdings.map(h => ({ name: h.country, weight: h.weight })))), [holdings]);
  const sectorOptions = useMemo<DropdownOption<string>[]>(
    () => [{ value: 'all', label: 'Every sector', hint: 'The whole book' }, ...sectors.map(s => ({ value: s.name, label: s.name, hint: `${s.weight.toFixed(0)}% of the book` }))],
    [sectors],
  );
  const cut = useMemo(() => holdings.filter(h => sector === 'all' || h.sector === sector), [holdings, sector]);
  const rows = useMemo(() => (picks.length === 0 ? cut : cut.filter(h => picks.includes(h.ticker))), [cut, picks]);
  const toKnow = useMemo(() => [...cut].sort((a, b) => b.weight - a.weight).slice(0, 6), [cut]);
  const toggle = (ticker: string) => setPicks(p => (p.includes(ticker) ? p.filter(x => x !== ticker) : [...p, ticker]));
  const cols = useMemo<ColDef<EtfHolding>[]>(
    () => [
      {
        headerName: 'Name',
        field: 'ticker',
        flex: 1.4,
        minWidth: 180,
        cellRenderer: ({ data }: ICellRendererParams<EtfHolding>) =>
          data ? (
            <span className="inline-flex items-center gap-2 min-w-0">
              <CompanyLogo ticker={data.ticker} size={16} />
              <span className="flex flex-col leading-tight min-w-0">
                <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
                <span className="text-[10px] text-textMuted truncate">{tickerName(data.ticker)}</span>
              </span>
            </span>
          ) : null,
      },
      { headerName: 'Sector', field: 'sector', flex: 1, minWidth: 140 },
      { headerName: 'Country', field: 'country', width: 140 },
      { headerName: 'Shares', field: 'sharesM', width: 110, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(1)}M` },
      {
        headerName: 'Weight',
        field: 'weight',
        flex: 1,
        minWidth: 160,
        cellRenderer: ({ data }: ICellRendererParams<EtfHolding>) =>
          data ? (
            <span className="flex items-center gap-2 h-full w-full pr-2">
              <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
                <span className="absolute left-0 top-0 h-full rounded-full bg-silver" style={{ width: `${Math.min(100, data.weight * 4)}%` }} />
              </span>
              <span className="font-mono text-[11px] tnum text-textPrimary w-[48px] text-right">{data.weight.toFixed(1)}%</span>
            </span>
          ) : null,
      },
    ],
    [],
  );
  if (fundLive.status === 'loading' && !fund) return <Missing to="/dossier/etfs" label="Reading the fund" />;
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
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">{fund.etf} · {fund.name}</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a weight, a flow and a holding mean" testId="fund-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            {fund.company} · {fund.domicile} · since {fund.inception}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted">Assets</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">${fund.aumB.toFixed(0)}B</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Fee</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{fund.expensePct == null ? '—' : `${fund.expensePct.toFixed(2)}%`}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Five-day flow</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${ink(fund.flow5dM)}`}>{moneyFlow(fund.flow5dM)}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted" title="Option contracts traded today">Call · put volume</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum whitespace-nowrap">
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
      <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-fund-sentence>
        {lead ? (
          <>
            <span className="text-textPrimary font-semibold">{lead.ticker}</span> is the largest line, {lead.weight.toFixed(1)}% of {fund.etf}. Five sessions: {fund.flows.map(f => `${f.day} ${moneyFlow(f.flowM)}`).join(', ')}.
          </>
        ) : (
          'Nothing in this book on this cut.'
        )}
      </p>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="fund-know">
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The lines to know</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">the largest weights · click one to keep the grid to it</span>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {toKnow.map(h => (
            <button key={h.ticker} type="button" onClick={() => toggle(h.ticker)} aria-pressed={picks.includes(h.ticker)} className={KNOW(picks.includes(h.ticker))} data-fund-know={h.ticker}>
              <span className="flex items-center gap-2 min-w-0">
                <CompanyLogo ticker={h.ticker} size={18} />
                <span className="font-mono text-[12px] font-bold text-textPrimary">{h.ticker}</span>
                <span className="text-[10px] text-textSecondary truncate">{tickerName(h.ticker)}</span>
              </span>
              <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
                <span className="text-[13px] font-bold text-textPrimary">{h.weight.toFixed(1)}%</span>
                <span className="text-[9px] text-textSecondary">{h.sector}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-fund-holdings>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<EtfHolding>
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
      <Board title="Sectors" rest="The book by sector, the weights adding to the whole" testId="fund-sectors" rows={sectors.map(s => ({ id: s.name, name: s.name, weight: s.weight }))} cols={SECTOR_COLS} />
      <Board title="Countries" rest="The book by country" testId="fund-countries" rows={countries.map(s => ({ id: s.name, name: s.name, weight: s.weight }))} cols={COUNTRY_COLS} />
    </Page>
    </>
  );
};

const shareOf = (rows: { name: string; weight: number }[]) => {
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1;
  return rows.map(r => ({ name: r.name, weight: (r.weight / total) * 100 }));
};

const Bar = ({ pct, heavy }: { pct: number; heavy?: boolean }) => (
  <span className="flex items-center gap-2 h-full w-full pr-2">
    <span className={`font-mono text-[11px] tnum w-[44px] ${heavy ? 'text-bear font-semibold' : 'text-textPrimary'}`}>{pct.toFixed(0)}%</span>
    <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
      <span className={`absolute left-0 top-0 h-full rounded-full ${heavy ? 'bg-bear' : 'bg-silver'}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  </span>
);

type IdRow = { id: string };

const EX_COLS: ColDef<{ id: string; exchange: string; shortM: number; totalM: number; ratio: number }>[] = [
  { headerName: 'Exchange', field: 'exchange', flex: 1.2, minWidth: 140 },
  { headerName: 'Short', field: 'shortM', width: 110, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(2)}M` },
  { headerName: 'Total', field: 'totalM', width: 110, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(2)}M` },
  { headerName: 'Of that market', field: 'ratio', flex: 1, minWidth: 140, cellRenderer: ({ data }: ICellRendererParams<{ ratio: number }>) => (data ? <Bar pct={data.ratio} heavy={data.ratio >= 50} /> : null) },
];
const FTD_COLS: ColDef<{ id: string; date: string; quantity: number; price: number }>[] = [
  { headerName: 'Day', field: 'date', flex: 1, minWidth: 120 },
  { headerName: 'Shares', field: 'quantity', width: 120, type: 'rightAligned', valueFormatter: p => Number(p.value).toLocaleString('en-US') },
  { headerName: 'Close', field: 'price', width: 100, type: 'rightAligned', valueFormatter: p => (Number(p.value) > 0 ? `$${Number(p.value).toFixed(2)}` : '—') },
];
const QUARTER_COLS: ColDef<{ id: string; period: string; unitsM: number }>[] = [
  { headerName: 'Quarter', field: 'period', flex: 1, minWidth: 120 },
  {
    headerName: 'Units',
    field: 'unitsM',
    flex: 1.4,
    minWidth: 180,
    cellRenderer: ({ data }: ICellRendererParams<{ unitsM: number }>) =>
      data ? (
        <span className="flex items-center gap-2 h-full w-full pr-2">
          <span className="font-mono text-[11px] tnum w-[56px] text-textPrimary">{data.unitsM.toFixed(1)}M</span>
          <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
            <span className="absolute left-0 top-0 h-full rounded-full bg-silver" style={{ width: `${Math.min(100, data.unitsM / 1.8)}%` }} />
          </span>
        </span>
      ) : null,
  },
];
const WEIGHT_BAR: ColDef<{ id: string; name: string; weight: number }> = { headerName: 'Weight', field: 'weight', flex: 1, minWidth: 140, cellRenderer: ({ data }: ICellRendererParams<{ weight: number }>) => (data ? <Bar pct={data.weight} /> : null) };
const SECTOR_COLS: ColDef<{ id: string; name: string; weight: number }>[] = [{ headerName: 'Sector', field: 'name', flex: 1.2, minWidth: 140 }, WEIGHT_BAR];
const COUNTRY_COLS: ColDef<{ id: string; name: string; weight: number }>[] = [{ headerName: 'Country', field: 'name', flex: 1.2, minWidth: 140 }, WEIGHT_BAR];

function Board<T extends IdRow>({ title, rest, testId, rows, cols }: { title: string; rest: string; testId: string; rows: T[]; cols: ColDef<T>[] }) {
  return (
    <div>
      <div className="px-5 border-t border-borderSubtle/60">
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>{title}</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">{rest}</span>
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-book-grid={testId}>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<T>
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('Nothing on file')}
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
  { value: 'any', label: 'Every report', hint: 'Purchases, sales and exchanges' },
  { value: 'Purchase', label: 'Purchases', hint: 'Bought', tone: 'bull' },
  { value: 'Sale', label: 'Sales', hint: 'Sold, full or partial', tone: 'bear' },
  { value: 'Exchange', label: 'Exchanges', hint: 'Swapped, not bought or sold' },
];
const OWNER_FILE_OPTIONS: DropdownOption<OwnerPick>[] = [
  { value: 'any', label: 'Any owner', hint: 'Self, spouse, joint or a dependent' },
  { value: 'Self', label: 'Self', hint: "The member's own holding" },
  { value: 'Spouse', label: 'Spouse', hint: "The spouse's holding" },
  { value: 'Joint', label: 'Joint', hint: 'A joint account' },
  { value: 'Dependent', label: 'Dependent', hint: "A dependent's holding" },
];

const typeOf = (t: CongressTrade): TypePick => (t.type === 'Purchase' ? 'Purchase' : t.type === 'Exchange' ? 'Exchange' : 'Sale');

export const MemberFile = () => {
  const { member: id = '' } = useParams();
  useVendor('dossier', '', `/dossier/congress/${id}`);
  const record = useLiveRecord();
  const feed = useCongressFeed(365);
  const member = MEMBERS.find(m => m.id === id) ?? feed.trades.find(t => t.member.id === id)?.member ?? null;
  const reports = useVendorRow(congressBookKey(id), 'member-reports');
  const [guideOpen, setGuideOpen] = useState(false);
  const [kind, setKind] = useState<TypePick>('any');
  const [owner, setOwner] = useState<OwnerPick>('any');
  const [picks, setPicks] = useState<string[]>([]);
  const trades = useMemo(() => {
    if (!reports || reports.state !== 'live' || !Array.isArray(reports.data)) return [];
    return congressFromWhales(reports.data as UwCongress[]).trades;
  }, [reports]);
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
  const held = useMemo(() => {
    const ordered = [...trades].sort((a, b) => b.tradedDaysAgo - a.tradedDaysAgo);
    const open = new Map<string, CongressTrade>();
    for (const t of ordered) {
      const key = `${assetKey(t)}|${t.owner}`;
      if (t.type === 'Purchase' || t.type === 'Exchange') open.set(key, t);
      if (t.type === 'Sale (Full)') open.delete(key);
    }
    return [...open.values()];
  }, [trades]);
  const cols = useMemo<ColDef<CongressTrade>[]>(
    () => [
      { headerName: 'Filed', field: 'filedDaysAgo', width: 126, cellRenderer: ({ data }: ICellRendererParams<CongressTrade>) => (data ? <When days={data.filedDaysAgo} /> : null) },
      {
        headerName: 'Asset',
        field: 'ticker',
        flex: 1.3,
        minWidth: 160,
        cellRenderer: AssetCell,
      },
      { headerName: 'Type', field: 'type', width: 130, cellRenderer: ({ data }: ICellRendererParams<CongressTrade>) => (data ? <span className={`font-mono text-[11px] ${data.type === 'Purchase' ? 'text-bull' : data.type === 'Exchange' ? 'text-textMuted' : 'text-bear'}`}>{data.type}</span> : null) },
      { headerName: 'Owner', field: 'owner', width: 110 },
      { headerName: 'Amount', field: 'bracket', flex: 1.2, minWidth: 180, valueFormatter: p => bracketLabel(p.value as number | null) },
      { headerName: 'Lag', field: 'lagDays', width: 90, cellRenderer: ({ data }: ICellRendererParams<CongressTrade>) => (data ? <span className={`font-mono text-[11px] tnum ${data.late ? 'text-bear' : 'text-textPrimary'}`}>{data.lagDays}d</span> : null) },
    ],
    [],
  );
  if (record.congress.status === 'loading' && !member) {
    return (
      <>
        <WayBack to="/dossier/congress" label="Congress" />
        <Page testId="member-loading">
          <p className="px-5 py-8 text-[12px] text-textSecondary">Reading the record.</p>
        </Page>
      </>
    );
  }
  if (!member) return <Missing to="/dossier/congress" label="Congress" />;
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
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">{member.name}</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a report, a bracket and a lag mean" testId="member-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            {seatLabel(member) || '—'}
            {member.district ? ` · ${member.district}` : ''} · {member.chamber}
            {member.committees.length > 0 ? ` · ${member.committees.join(' · ')}` : ''}
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted">Reports</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{trades.length}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Purchases</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-bull">{purchases}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Sales</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-bear">{sales}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Late</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum ${late ? 'text-bear' : 'text-textPrimary'}`}>{late}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-member-controls>
        <DropdownSelect label="Type" value={kind} options={TYPE_OPTIONS} onChange={setKind} title="Purchase, sale or exchange" testId="member-type" />
        <DropdownSelect label="Owner" value={owner} options={OWNER_FILE_OPTIONS} onChange={setOwner} title="Whose holding" testId="member-owner" />
      </div>
      <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-member-sentence>
        {trades.length} reports in the last year. {late} filed past {STOCK_ACT_DEADLINE_DAYS} days. What they still hold is the annual disclosure, a range and nothing finer.
      </p>
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip="member-know">
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The names to know</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">the largest bracket on this cut · click one to keep the grid to it</span>
        </div>
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">No report on this cut</div>
        ) : (
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            {toKnow.map(t => {
              const k = assetKey(t);
              const line = assetLine(t);
              return (
              <button key={k} type="button" onClick={() => toggle(k)} aria-pressed={picks.includes(k)} className={KNOW(picks.includes(k))} data-member-know={k} title={line.sub ? `${line.title} · ${line.sub}` : line.title}>
                <span className="flex items-center gap-2 min-w-0">
                  {line.sym ? <CompanyLogo ticker={line.sym} size={18} /> : null}
                  <span className={`text-[12px] font-bold text-textPrimary truncate ${line.sym ? 'font-mono' : ''}`}>{line.sym || k}</span>
                </span>
                <span className="mt-1.5 block font-mono text-[10px] tnum text-textSecondary truncate">{bracketLabel(t.bracket)}</span>
              </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="slayer-board border-t border-borderSubtle" data-member-trades>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<CongressTrade>
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('No report on this book')}
            columnDefs={cols}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.id}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
      </div>
      <Board
        title="What they still hold"
        rest="The annual disclosure. The range, never a midpoint. No strike on an option."
        testId="member-held"
        rows={held.map(t => ({ id: `${assetKey(t)}-${t.owner}`, ticker: assetLine(t).sym || assetKey(t), owner: t.owner, amount: bracketLabel(t.bracket) }))}
        cols={HELD_COLS}
      />
    </Page>
    </>
  );
};

const HELD_COLS: ColDef<{ id: string; ticker: string; owner: string; amount: string }>[] = [
  { headerName: 'Name', field: 'ticker', flex: 1, minWidth: 120 },
  { headerName: 'Owner', field: 'owner', width: 120 },
  { headerName: 'Amount', field: 'amount', flex: 1.4, minWidth: 200 },
];

