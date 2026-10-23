/*
==================================================
  INSTITUTIONS, SHORTS, ETFs

  The same reading order as Congress, Insiders and
  Stocks — not a second table language:

    THE HEAD      the title, how to read, four facts
    THE CARDS     one line of dropdowns, Filter last
    THE SENTENCE
    THE NAMES     the lines worth knowing, a card
    TO KNOW       keeps the grid to that name
    THE GRID      the house grid, grown to its rows.
                  A row opens the name.

  ETFs add the fund's own weights under the grid,
  the way Congress keeps a second face — still the
  same grid.
==================================================
*/

import { CoSub } from '../../components/record/CoName';
import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type IRowNode, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { SectorMark } from '../../components/trace/SectorMark';
import { When } from '../../components/record/when';
import { EtfsGuide, InstitutionsGuide, ShortsGuide } from '../../components/record/FileGuides';
import { useBoardNames } from '../../data/boardNames';
import { houseSlug, positionWord, type EtfHolding, type EtfKind, type EtfRow, type InstitutionRow, type ShortRow } from '../../data/fileBooks';
import { HOUSE_LINES, SHORTS_MIN_FLOAT, SHORTS_SCREEN, useCompanyName, useEtfs, useInstitutions, useShorts } from '../../data/liveFiles';
import { tickerName } from '../../data/tickers';
import { FeedFallback } from '../../components/ui/liveRead';

import { NAMES_TO_KNOW } from './recordSkeletons';
import { asOfDay, borrowM, moneyB, moneyM, signedM } from './money';
import { SQUEEZE_INK, SQUEEZE_TIP, squeezeRead } from '../../data/squeeze';
import { usePagedGrid, phonePin } from '../../components/record/pagedGrid';
import { statHelp } from '../../components/record/statHelp';

const ink = (n: number) => (n > 0 ? 'text-bull' : n < 0 ? 'text-bear' : 'text-textMuted');
const signed = (n: number, digits = 1) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
const assetsB = (b: number) => moneyM(b * 1000);
/** Millions of shares, one way everywhere: a decimal under 100M, whole above, a B past a billion */
const sharesM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)}B` : m >= 100 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`);

const CARD = (on: boolean) => `group text-left rounded-md border px-3 py-2.5 transition-colors min-w-0 ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`;

const Strip = ({ title, rest, testId, children }: { title: string; rest: string; testId: string; children: ReactNode }) => (
  <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip={testId}>
    <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
      <span>{title}</span>
      <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">{rest}</span>
    </div>
    {children}
  </div>
);

const KnowGrid = ({ children }: { children: ReactNode }) => (
  <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-[repeat(var(--know),minmax(0,1fr))]" style={{ '--know': NAMES_TO_KNOW } as CSSProperties}>
    {children}
  </div>
);

const Page = ({ testId, children, attrs }: { testId: string; children: ReactNode; attrs?: Record<string, string | number> }) => (
  <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" {...{ [`data-${testId}`]: true, ...attrs }}>
    {children}
  </div>
);

const defaultColDef = { sortable: true, resizable: true, suppressMovable: true };

/* ------------------------------------------------------------------ institutions */

type Window = 90 | 180 | 365;
type BookPick = 'any' | InstitutionRow['book'];
type HousePick = string;
type NamesPick = 'all' | 'board';

const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  { value: 90, label: 'This quarter', hint: 'Filed in the last 90 days' },
  { value: 180, label: 'Half year', hint: 'Filed in the last 180 days' },
  { value: 365, label: 'The year', hint: 'Filed in the last year' },
];
const BOOK_OPTIONS: DropdownOption<BookPick>[] = [
  { value: 'any', label: 'Any side', short: 'All', hint: 'Shares, calls and puts' },
  { value: 'stock', label: 'Shares', hint: 'The filing left put/call empty' },
  { value: 'calls', label: 'Calls', hint: 'Marked call. No strike, no expiry' },
  { value: 'puts', label: 'Puts', hint: 'Marked put. No strike, no expiry' },
];
const NAMES_OPTIONS: DropdownOption<NamesPick>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'The whole book' },
  { value: 'board', label: 'Your board', hint: 'The names on your Board' },
];

const BOOK_INK: Record<InstitutionRow['book'], string> = { calls: 'text-textSecondary', puts: 'text-textSecondary', stock: 'text-textSecondary' };
const BOOK_WORD: Record<InstitutionRow['book'], string> = { calls: 'Call', puts: 'Put', stock: 'Shares' };

const InstName = ({ data }: ICellRendererParams<InstitutionRow>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        {/* the listing's name, else the filing's; never the ticker said twice ("IVV · IVV") */}
        <CoSub ticker={data.ticker} fallback={data.company} />
      </span>
    </span>
  ) : null;

const InstFiled = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <When days={data.filedDaysAgo} /> : null);
const InstHouse = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="text-[12px] font-semibold text-textPrimary truncate">{data.name}</span> : null);
const InstBook = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-[11px] ${BOOK_INK[data.book]}`}>{data.book === 'stock' && data.security ? data.security : BOOK_WORD[data.book]}</span> : null);
const InstShares = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.sharesM.toFixed(1)}M</span> : null);
const InstValue = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{moneyB(data.valueB)}</span> : null);
const InstChange = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-[11px] tnum ${ink(data.changePct)}`}>{signed(data.changePct)}%</span> : null);
const InstStatus = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span title={data.status === 'held' ? `Held: ${data.changePct >= 0 ? '+' : data.changePct < 0 ? '−' : ''}${Math.abs(data.changePct).toFixed(1)}% units versus the prior 13F, inside the ±2% band` : undefined} className={`font-mono text-[11px] ${data.status === 'added' || data.status === 'new' ? 'text-bull' : data.status === 'cut' || data.status === 'closed' ? 'text-bear' : 'text-textSecondary'}`}>{positionWord(data.status)}</span> : null);
const InstBookPct = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.pctOfBook.toFixed(1)}%</span> : null);

const InstCard = ({ row, on, onToggle }: { row: InstitutionRow; on: boolean; onToggle: () => void }) => (
  <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Showing ${row.ticker} only — click to show every name` : `Keep the grid to ${row.ticker}`} className={CARD(on)} data-institutions-know={row.ticker} data-on={on || undefined}>
    <span className="flex items-center gap-2 min-w-0">
      <CompanyLogo ticker={row.ticker} size={18} />
      <span className="font-mono text-[12px] font-bold text-textPrimary">{row.ticker}</span>
      <span className="text-[10px] text-textSecondary truncate">{row.name}</span>
    </span>
    <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
      <span className="text-[13px] font-bold text-textPrimary">{moneyB(row.valueB)}</span>
      <span className={`text-[10px] ${BOOK_INK[row.book]}`}>{BOOK_WORD[row.book]}</span>
    </span>
    <span className={`mt-1 block font-mono text-[9px] tnum ${ink(row.changePct)}`}>vs last filing {signed(row.changePct)}%</span>
  </button>
);

export const Institutions = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  const [window, setWindow] = useState<Window>(365);
  const [book, setBook] = useState<BookPick>('any');
  const [house, setHouse] = useState<HousePick>('any');
  const [names, setNames] = useState<NamesPick>('all');
  const [guideOpen, setGuideOpen] = useState(false);
  const live = useInstitutions();
  const feed = live.rows;
  /* a failed read is not an empty filing season */
  const failed = live.status === 'error';
  const houseOptions = useMemo<DropdownOption<string>[]>(() => [{ value: 'any', label: 'Every house', short: 'All', hint: 'The houses on this cut' }, ...live.houses.map(h => ({ value: h, label: h }))], [live.houses]);
  const board = useMemo(() => new Set(boardNames), [boardNames]);
  const [picks, setPicks] = useState<string[]>([]);
  const cut = useMemo(
    () => feed.filter(r => r.filedDaysAgo <= window && (book === 'any' || r.book === book) && (house === 'any' || r.name === house) && (names === 'all' || board.has(r.ticker))),
    [feed, window, book, house, names, board],
  );
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const byName = new Map<string, number>();
    const byHouse = new Map<string, number>();
    cut.forEach(r => {
      byName.set(r.ticker, (byName.get(r.ticker) ?? 0) + 1);
      byHouse.set(r.name, (byHouse.get(r.name) ?? 0) + 1);
    });
    picks.forEach(p => {
      const [kind, ...rest] = p.split(':');
      const key = rest.join(':');
      if (kind === 'name' && !byName.has(key)) byName.set(key, 0);
      if (kind === 'house' && !byHouse.has(key)) byHouse.set(key, 0);
    });
    const order = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
    return [
      { title: 'Names', options: [...byName.entries()].sort(order).map(([n, c]) => ({ value: `name:${n}`, label: n, hint: tickerName(n), count: c })) },
      { title: 'Houses', options: [...byHouse.entries()].sort(order).map(([n, c]) => ({ value: `house:${n}`, label: n, count: c })) },
    ];
  }, [cut, picks]);
  const rows = useMemo(() => {
    if (picks.length === 0) return cut;
    const on = new Set(picks);
    return cut.filter(r => on.has(`name:${r.ticker}`) || on.has(`house:${r.name}`));
  }, [cut, picks]);
  const toggleName = (ticker: string) => setPicks(p => (p.includes(`name:${ticker}`) ? p.filter(x => x !== `name:${ticker}`) : [...p, `name:${ticker}`]));
  const toKnow = useMemo(() => {
    const seen = new Set<string>();
    const out: InstitutionRow[] = [];
    /* the largest reported line in each name, biggest first — as the strip's own words say */
    for (const r of [...cut].sort((a, b) => b.valueB - a.valueB)) {
      if (seen.has(r.ticker)) continue;
      seen.add(r.ticker);
      out.push(r);
      if (out.length === NAMES_TO_KNOW) break;
    }
    return out;
  }, [cut]);
  const facts = useMemo(() => {
    const lead = [...rows].sort((a, b) => b.valueB - a.valueB)[0];
    return {
      lines: rows.length,
      houses: new Set(rows.map(r => r.name)).size,
      calls: rows.filter(r => r.book === 'calls').length,
      puts: rows.filter(r => r.book === 'puts').length,
      lead,
    };
  }, [rows]);
  const columnDefs = useMemo<ColDef<InstitutionRow>[]>(
    () => [
      /* newest filing first, and inside one filing day the biggest line first — the tie fell to feed order, so the
         grid opened on one house's small lines while the cards above led with another's biggest (2026-10-22) */
      {
        headerName: 'Filed',
        field: 'filedDaysAgo',
        width: 126,
        cellRenderer: InstFiled,
        sort: 'asc',
        /* newest filing first, the bigger line first within a filing — one sort, so the head carries no "1" and "2" */
        comparator: (a: number, b: number, na: IRowNode<InstitutionRow>, nb: IRowNode<InstitutionRow>) => a - b || (nb.data?.valueB ?? 0) - (na.data?.valueB ?? 0),
        headerTooltip: 'The day the 13F was filed, and how far back that is',
      },
      { headerName: 'House', field: 'name', flex: 1.2, minWidth: 140, cellRenderer: InstHouse, headerTooltip: 'The filer' },
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 170, cellRenderer: InstName, headerTooltip: 'The holding — click the row to open the house’s filing' },
      { headerName: 'Side', field: 'book', width: 88, cellRenderer: InstBook, headerTooltip: 'Call, put, or the shares. The filing does not name a strike or an expiry.' },
      { headerName: 'Status', field: 'status', width: 88, cellRenderer: InstStatus, headerTooltip: 'Against the prior 13F: new, added (2% more units or over), cut (2% fewer or over), closed, or held — within 2% either way, so a +1.6% line reads held' },
      { headerName: 'Shares', field: 'sharesM', width: 96, cellRenderer: InstShares, type: 'rightAligned', headerTooltip: 'Shares reported, in millions' },
      { headerName: 'Value', field: 'valueB', width: 100, cellRenderer: InstValue, type: 'rightAligned', headerTooltip: 'The reported value' },
      { headerName: '% of 13F value', field: 'pctOfBook', width: 112, cellRenderer: InstBookPct, type: 'rightAligned', headerTooltip: 'This line’s reported value as a share of the total value of everything the house reported on its 13F (Unusual Whales’ perc_of_share_value) — measured over the whole filing, not only the lines read here' },
      { headerName: 'Vs last filing', field: 'changePct', width: 120, cellRenderer: InstChange, type: 'rightAligned', headerTooltip: 'Change versus the prior 13F, not versus yesterday' },
    ],
    [],
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  /* FIFTY LINES A PAGE (the Dossier sweep, 2026-10-22): twenty houses file ~1,700 lines, and the grid grown to all of
     them made a page some 70,000px tall. The grid pages itself — the sort still runs over every line. */
  const paged = usePagedGrid<InstitutionRow>();
  const cutKey = `${window}|${book}|${house}|${names}|${picks.join(',')}`;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('animate-soft-in');
    void el.offsetWidth;
    el.classList.add('animate-soft-in');
  }, [cutKey]);
  const open = (e: RowClickedEvent<InstitutionRow>) => {
    if (!e.data) return;
    navigate(`/dossier/institutions/${houseSlug(e.data.name)}?line=${e.data.ticker}`);
  };

  return (
    <Page testId="institutions" attrs={{ 'data-window': window }}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the filings" testId="institutions-guide" viewport>
        <InstitutionsGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">What the houses reported</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a line, a book and the change mean" testId="institutions-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate" title="Each house's book is far longer than the lines read here: the largest 80 lines by value from its latest 13F, for the 40 largest houses">The largest {HOUSE_LINES} lines of each house's latest 13F, for the 40 largest houses — not every line · a row opens that house</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Lines")}>Lines</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-institutions-count>{failed ? '—' : <>{facts.lines.toLocaleString('en-US')}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Houses")}>Houses</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">
              {failed ? '—' : live.progress ? <span className="text-textSecondary" title="The rest of the houses are still landing">{facts.houses.toLocaleString('en-US')} · reading {live.progress.done} of {live.progress.total}</span> : <>{facts.houses.toLocaleString('en-US')}</>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Calls · puts")}>Calls · puts</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum whitespace-nowrap text-textPrimary">{failed ? '—' : <>{facts.calls} calls <span className="text-textMuted">·</span> {facts.puts} puts</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Largest line")}>Largest line</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{failed ? '—' : <>{facts.lead ? `${facts.lead.ticker} ${moneyB(facts.lead.valueB)}` : '—'}</>}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-institutions-controls>
        <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the filings run" testId="institutions-window" />
        <DropdownSelect label="Side" value={book} options={BOOK_OPTIONS} onChange={setBook} title="Shares, call, or put. Not a contract." testId="institutions-book" />
        <DropdownSelect label="House" value={house} options={houseOptions} onChange={setHouse} title="Which filer" testId="institutions-house" />
        <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="institutions-names" />
        <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names and houses on the page right now — tick any number; only those stay" testId="institutions-filter" />
      </div>
      <p className={`px-5 pb-3 text-[12px] leading-relaxed text-textSecondary ${failed ? 'hidden' : ''}`} data-institutions-sentence>
        {facts.lead ? (
          <>
            <span className="text-textPrimary font-semibold">{facts.lead.name}</span>’s largest line is <span className="text-textPrimary font-semibold">{facts.lead.ticker}</span>, {moneyB(facts.lead.valueB)}. {facts.houses.toLocaleString('en-US')} {facts.houses === 1 ? 'house' : 'houses'} filed {facts.lines.toLocaleString('en-US')} {facts.lines === 1 ? 'line' : 'lines'} on this cut — {facts.calls} marked call, {facts.puts} marked put, and no strike on any of them.
          </>
        ) : live.status === 'loading' ? (
          'Reading the 13Fs.'
        ) : failed ? null : (
          'Nothing filed on this cut.'
        )}
      </p>
      {failed && <FeedFallback />}
      <Strip title="The lines to know" rest="the largest reported line in each name, biggest first · click one to keep the grid to that name" testId="institutions">
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : 'No line on this cut'}</div>
        ) : (
          <KnowGrid>
            {toKnow.map(r => (
              <InstCard key={r.id} row={r} on={picks.includes(`name:${r.ticker}`)} onToggle={() => toggleName(r.ticker)} />
            ))}
          </KnowGrid>
        )}
      </Strip>
      <div ref={gridRef} className="slayer-board border-t border-borderSubtle" data-institutions-grid>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<InstitutionRow>
            {...phonePin}
            {...paged.props}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.id}
            onRowClicked={open}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows={false}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
            overlayNoRowsTemplate={noRows(failed ? 'This read did not land' : 'No line on this cut')}
            key={failed ? 'failed' : 'live'}
          />
        </AgGridProvider>
        {paged.bar(rows.length, 'institutions')}
      </div>
    </Page>
  );
};

/* ------------------------------------------------------------------ shorts */

type Show = 'all' | 'heavy';
type SectorPick = string;

const SHOW_OPTIONS: DropdownOption<Show>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'The whole short book' },
  /* the screen's own floor is ~19% of the float, so "8% or more" kept every row (the re-audit, 2026-10-22) */
  { value: 'heavy', label: '30% or more', hint: 'Thirty percent of the float or more sold short' },
];


const ShortName = ({ data }: ICellRendererParams<ShortRow>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        {/* the listing's name, else the vendor's; never the ticker said twice */}
        <CoSub ticker={data.ticker} fallback={data.name} />
      </span>
    </span>
  ) : null;
const ShortSector = ({ data }: ICellRendererParams<ShortRow>) =>
  data ? (
    data.sector === '—' ? (
      <span className="text-[11px] text-textMuted" title="The vendor's file does not name a sector">—</span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-textSecondary">
        <SectorMark sector={data.sector} />
        {data.sector}
      </span>
    )
  ) : null;
const ShortInterest = ({ data }: ICellRendererParams<ShortRow>) => {
  if (!data) return null;
  const heavy = data.interestPct >= 30;
  return (
    <span className="flex items-center gap-2 h-full w-full pr-2" title={heavy ? 'Thirty percent or more of the float sold short' : 'Short interest as a percent of the float'}>
      <span className={`font-mono text-[11px] tnum w-[52px] ${heavy ? 'text-bear font-semibold' : 'text-textPrimary'}`}>{data.interestPct.toFixed(2)}%</span>
      <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
        <span className={`absolute left-0 top-0 h-full rounded-full ${heavy ? 'bg-bear' : 'bg-silver'}`} style={{ width: `${Math.min(100, data.interestPct * 2)}%` }} />
      </span>
    </span>
  );
};
const ShortDays = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.daysToCover.toFixed(1)}</span> : null);
const ShortFloat = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-[11px] tnum text-textSecondary">{sharesM(data.floatM)}</span> : null);
const ShortVol = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.shortVolRatio == null ? '—' : `${data.shortVolRatio.toFixed(0)}%`}</span> : null);
const ShortBorrow = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.feeRate == null ? '—' : `${data.feeRate.toFixed(2)}%`}</span> : null);

const ShortCard = ({ row, on, onToggle }: { row: ShortRow; on: boolean; onToggle: () => void }) => {
  /* the screen carries no company name; a card asks the name's own stock card for it */
  const co = useCompanyName(row.ticker, true);
  const name = co && co.toUpperCase() !== row.ticker ? co : row.name && row.name !== row.ticker ? row.name : '';
  return (
  <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Showing ${row.ticker} only — click to show every name` : `Keep the grid to ${row.ticker}`} className={CARD(on)} data-shorts-know={row.ticker} data-on={on || undefined}>
    <span className="flex items-center gap-2 min-w-0">
      <CompanyLogo ticker={row.ticker} size={18} />
      <span className="font-mono text-[12px] font-bold text-textPrimary">{row.ticker}</span>
      {name && <span className="text-[10px] text-textSecondary truncate">{name}</span>}
    </span>
    <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
      <span className={`text-[13px] font-bold ${row.interestPct >= 30 ? 'text-bear' : 'text-textPrimary'}`}>{row.interestPct.toFixed(1)}%</span>
      <span className="text-[9px] text-textSecondary">of the float</span>
    </span>
    <span className="mt-1 block font-mono text-[9px] tnum text-textSecondary">{row.daysToCover.toFixed(1)} days to cover</span>
    {(() => {
      const q = squeezeRead(row);
      return (
        <span className="mt-1 block font-mono text-[9px] uppercase tracking-widest truncate" title={`${q.facts.map(f => f.text).join(' · ')}\n${SQUEEZE_TIP}`}>
          squeeze <span className={`font-semibold ${SQUEEZE_INK[q.word]}`}>{q.word}</span>
        </span>
      );
    })()}
  </button>
  );
};

/** The squeeze word and the facts behind it, in one cell */
const ShortSqueeze = ({ data }: ICellRendererParams<ShortRow>) => {
  if (!data) return null;
  const q = squeezeRead(data);
  return (
    <span className="flex flex-col leading-tight min-w-0" title={`${q.facts.map(f => f.text).join(' · ')}\n${SQUEEZE_TIP}`} data-squeeze={q.word}>
      <span className={`font-mono text-[10px] font-semibold uppercase tracking-widest ${SQUEEZE_INK[q.word]}`}>{q.word}</span>
      <span className="text-[10px] text-textMuted truncate">{q.facts.map(f => f.text).slice(0, 2).join(' · ')}</span>
    </span>
  );
};

export const Shorts = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  const [show, setShow] = useState<Show>('all');
  const [sector, setSector] = useState<SectorPick>('all');
  const [names, setNames] = useState<NamesPick>('all');
  const [guideOpen, setGuideOpen] = useState(false);
  const liveShorts = useShorts();
  const failed = liveShorts.status === 'error';
  const feed = liveShorts.rows;
  const board = useMemo(() => new Set(boardNames), [boardNames]);
  const cut = useMemo(
    () =>
      feed.filter(r => {
        if (show === 'heavy' && r.interestPct < 30) return false;
        if (sector !== 'all' && r.sector !== sector) return false;
        if (names === 'board' && !board.has(r.ticker)) return false;
        return true;
      }),
    [feed, show, sector, names, board],
  );
  const [picks, setPicks] = useState<string[]>([]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const byName = new Map(cut.map(r => [r.ticker, 1]));
    picks.forEach(p => {
      const key = p.replace(/^name:/, '');
      if (!byName.has(key)) byName.set(key, 0);
    });
    return [{ title: 'Names', options: [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => ({ value: `name:${n}`, label: n, hint: tickerName(n), count: c })) }];
  }, [cut, picks]);
  const rows = useMemo(() => (picks.length === 0 ? cut : cut.filter(r => picks.includes(`name:${r.ticker}`))), [cut, picks]);
  const toggleName = (ticker: string) => setPicks(p => (p.includes(`name:${ticker}`) ? p.filter(x => x !== `name:${ticker}`) : [...p, `name:${ticker}`]));
  /* the sectors the screen actually holds, by the stock screener's own word — not a list of ten the rows never carry */
  const sectorOptions = useMemo<DropdownOption<SectorPick>[]>(() => {
    const by = new Map<string, number>();
    feed.forEach(r => r.sector && r.sector !== '—' && by.set(r.sector, (by.get(r.sector) ?? 0) + 1));
    return [{ value: 'all', label: 'Every sector', short: 'All', hint: 'Every name on the screen' }, ...[...by.entries()].sort((a, b) => b[1] - a[1]).map(([sct, n]) => ({ value: sct, label: sct, hint: `${n} ${n === 1 ? 'name' : 'names'}` }))];
  }, [feed]);
  const toKnow = useMemo(() => cut.filter(r => !r.fund).slice(0, NAMES_TO_KNOW), [cut]);
  const facts = useMemo(() => {
    const stocks = rows.filter(r => !r.fund);
    /* every name on the screen is a heavy short already, so the count that says something is the 20% rung (2 points) */
    const heavy = stocks.filter(r => r.interestPct >= 20);
    const floor = stocks.length ? Math.min(...stocks.map(r => r.interestPct)) : 0;
    const reads = rows.map(r => squeezeRead(r));
    const strong = reads.filter(q => q.word === 'strong').length;
    const building = reads.filter(q => q.word === 'building').length;
    const asOf = reads.reduce<string | null>((m, q) => (q.asOf && (!m || q.asOf > m) ? q.asOf : m), null);
    const stale = reads.some(q => q.asOf === asOf && q.stale);
    /* the heaviest STOCK — a fund's short interest is creation and hedging, not a bet a squeeze can punish */
    const lead = [...stocks].sort((a, b) => b.interestPct - a.interestPct)[0];
    /* the stocks only: a fund's days to cover is creation and hedging, not a short that must be bought back */
    const dtc = stocks.map(r => r.daysToCover).filter(d => d > 0).sort((a, b) => a - b);
    const days = dtc.length ? (dtc.length % 2 ? dtc[(dtc.length - 1) / 2] : (dtc[dtc.length / 2 - 1] + dtc[dtc.length / 2]) / 2) : 0;
    return { names: rows.length, stocks: stocks.length, funds: rows.length - stocks.length, heavy: heavy.length, floor, lead, days, strong, building, asOf, stale };
  }, [rows]);
  const hasShortVol = rows.some(r => r.shortVolRatio != null);
  const columnDefs = useMemo<ColDef<ShortRow>[]>(() => {
    const cols: ColDef<ShortRow>[] = [
      { headerName: 'Name', field: 'ticker', flex: 1.4, minWidth: 180, cellRenderer: ShortName, /* the name lands after the row; the cell redraws when it does */ valueGetter: p => (p.data ? `${p.data.ticker}\u0000${p.data.name ?? ''}` : ''), comparator: (a: string, b: string) => a.localeCompare(b), headerTooltip: 'The company — click the row to open the short file' },
      { headerName: 'Squeeze setup', colId: 'squeeze', flex: 1.4, minWidth: 200, cellRenderer: ShortSqueeze, valueGetter: p => (p.data ? squeezeRead(p.data).points : 0), headerTooltip: SQUEEZE_TIP },
      { headerName: 'Sector', field: 'sector', flex: 1, minWidth: 150, cellRenderer: ShortSector, headerTooltip: 'The sector the name files under' },
      { headerName: 'Short interest', field: 'interestPct', width: 168, cellRenderer: ShortInterest, headerTooltip: 'The share of the tradable stock (the float) that has been sold short and not bought back. Red at 30% and above' },
      { headerName: 'Shares short', field: 'shortSharesM', width: 120, cellRenderer: ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{sharesM(data.shortSharesM)}</span> : null), type: 'rightAligned', headerTooltip: 'Shares sold short, in millions' },
      { headerName: 'Days to cover', field: 'daysToCover', width: 120, cellRenderer: ShortDays, type: 'rightAligned', headerTooltip: 'How many days of normal trading it would take the shorts to buy back every share — shares short divided by average daily volume' },
      { headerName: 'Fee', field: 'feeRate', width: 80, cellRenderer: ShortBorrow, type: 'rightAligned', headerTooltip: 'The annualized fee to borrow the shares on the settlement day — the short file shows today’s. A dash means the feed did not price the borrow.' },
      { headerName: 'Available', field: 'availableM', width: 110, cellRenderer: ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{borrowM(data.availableM)}</span> : null), type: 'rightAligned', headerTooltip: 'Shares available to borrow on the settlement day — the short file shows today’s. The feed caps the count at 10M — 10M+ means at least that many. A dash means the feed did not say.' },
      { headerName: 'Float', field: 'floatM', flex: 0.7, minWidth: 90, cellRenderer: ShortFloat, type: 'rightAligned', headerTooltip: 'Shares free to trade (the float), in millions — insiders’ locked-up shares are not in it' },
    ];
    if (hasShortVol) cols.splice(5, 0, { headerName: 'Short vol', field: 'shortVolRatio', width: 100, cellRenderer: ShortVol, type: 'rightAligned', headerTooltip: 'Short volume as a percent of the session’s volume' });
    return cols;
  }, [hasShortVol]);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cutKey = `${show}|${sector}|${names}|${picks.join(',')}`;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('animate-soft-in');
    void el.offsetWidth;
    el.classList.add('animate-soft-in');
  }, [cutKey]);
  const open = (e: RowClickedEvent<ShortRow>) => {
    if (!e.data) return;
    navigate(`/dossier/shorts/${e.data.ticker}`);
  };

  return (
    <Page testId="shorts" attrs={{ 'data-show': show }}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the short book" testId="shorts-guide" viewport>
        <ShortsGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">Where the short book sits</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What short interest, days to cover and the fee mean" testId="shorts-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate" data-shorts-asof>
            <span className={facts.stale ? 'text-warn' : ''} title="Short interest settles twice a month and is published about ten days later — the figure is never today's">
              short interest as of {asOfDay(facts.asOf)}{facts.stale ? ' (stale)' : ''}
            </span>{' '}
            · the {SHORTS_SCREEN} heaviest by % of float, floats of {SHORTS_MIN_FLOAT / 1e6}M+ shares · fee and shares to borrow as of that settlement — a name’s file has today’s · a row opens the short file
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={`Names on the grid after the cards — of the screen's ${SHORTS_SCREEN}: the latest settlement's heaviest shorts by share of the float, floats of ${SHORTS_MIN_FLOAT / 1e6}M shares or more`}>Names</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-shorts-count>{failed ? '—' : <>{facts.names}{facts.funds ? <span className="text-textMuted"> · {facts.funds} funds</span> : null}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={`${SQUEEZE_TIP}\nOn this list the read uses the settlement's figures only; a name's file adds today's borrow, the last session's short volume and the fails to deliver, so it can read stronger there.`}>Squeeze setups</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-shorts-squeeze>
              {failed ? '—' : <><span className="text-bear">{facts.strong} strong</span> <span className="text-textMuted">·</span> <span className="text-warn">{facts.building} building</span> <span className="text-textMuted">of {facts.stocks}</span></>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="Stocks on this screen (funds left out) with at least 20% of the float sold short — the rung the squeeze rule scores 2 points">At 20% or more</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${facts.heavy ? 'text-bear' : 'text-textPrimary'}`}>{failed ? '—' : <>{facts.heavy}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="The stock (funds left out) with the largest share of its float sold short on this screen">Heaviest</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{failed ? '—' : <>{facts.lead ? `${facts.lead.ticker} ${facts.lead.interestPct.toFixed(1)}%` : '—'}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title="The median, across the stocks here (funds left out), of the days of normal volume the shorts would need to buy back — half need more, half less">Median days to cover</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{failed ? '—' : <>{facts.stocks ? facts.days.toFixed(1) : '—'}</>}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-shorts-controls>
        <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Which short books" testId="shorts-show" />
        <DropdownSelect label="Sector" value={sector} options={sectorOptions} onChange={setSector} title="Which sector" testId="shorts-sector" />
        <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="shorts-names" />
        <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names on the page right now — tick any number; only those stay" testId="shorts-filter" />
      </div>
      <p className={`px-5 pb-3 text-[12px] leading-relaxed text-textSecondary ${failed ? 'hidden' : ''}`} data-shorts-sentence>
        {facts.lead ? (
          <>
            <span className={`font-semibold ${facts.lead.interestPct >= 30 ? 'text-bear' : 'text-textPrimary'}`}>{facts.lead.ticker}</span> is the heaviest stock short on this screen, {facts.lead.interestPct.toFixed(1)}% of the float and {facts.lead.daysToCover.toFixed(1)} days to cover. <span className="text-bear font-semibold">{facts.heavy}</span> {facts.heavy === 1 ? 'stock sits' : 'stocks sit'} at 20% or more, and the lightest here is still {facts.floor.toFixed(1)}%{facts.funds ? `; ${facts.funds} ${facts.funds === 1 ? 'fund is' : 'funds are'} listed with no squeeze read` : ''}. The squeeze words here read the settlement alone; a name's file adds today's borrow, short volume and fails to deliver, and can read stronger.
          </>
        ) : liveShorts.status === 'loading' ? (
          'Reading the short book.'
        ) : failed ? null : (
          'Nothing on this cut.'
        )}
      </p>
      {failed && <FeedFallback />}
      <Strip title="The names to know" rest="the heaviest short interest among the stocks on this cut (funds left out) · click a name to keep the grid to it" testId="shorts">
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : 'No name on this cut'}</div>
        ) : (
          <KnowGrid>
            {toKnow.map(r => (
              <ShortCard key={r.ticker} row={r} on={picks.includes(`name:${r.ticker}`)} onToggle={() => toggleName(r.ticker)} />
            ))}
          </KnowGrid>
        )}
      </Strip>
      <div ref={gridRef} className="slayer-board border-t border-borderSubtle" data-shorts-grid>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<ShortRow>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.ticker}
            onRowClicked={open}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows={false}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
            overlayNoRowsTemplate={noRows(failed ? 'This read did not land' : 'No name on this cut')}
            key={failed ? 'failed' : 'live'}
          />
        </AgGridProvider>
      </div>
    </Page>
  );
};

/* ------------------------------------------------------------------ etfs */

type FlowPick = 'any' | 'in' | 'out';
type KindPick = 'any' | EtfKind;

const FLOW_OPTIONS: DropdownOption<FlowPick>[] = [
  { value: 'any', label: 'Any flow', short: 'All', hint: 'Money in and money out' },
  { value: 'in', label: 'Money in', hint: 'Five-day flow above zero', tone: 'bull' },
  { value: 'out', label: 'Money out', hint: 'Five-day flow below zero', tone: 'bear' },
];
const KIND_OPTIONS: DropdownOption<KindPick>[] = [
  { value: 'any', label: 'Every fund', short: 'All', hint: 'Index, sector, Treasury, credit and commodity funds' },
  { value: 'broad', label: 'Broad', hint: 'The stock index funds' },
  { value: 'sector', label: 'Sector', hint: 'One sector' },
  { value: 'rates', label: 'Treasuries', hint: 'The Treasury fund' },
  { value: 'credit', label: 'Credit', hint: 'The corporate bond fund' },
  { value: 'commodity', label: 'Commodity', hint: 'The gold trust' },
];
const KIND_WORD: Record<EtfKind, string> = { broad: 'Broad', sector: 'Sector', rates: 'Treasuries', credit: 'Credit', commodity: 'Commodity' };

const EtfName = ({ data }: ICellRendererParams<EtfRow>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.etf} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.etf}</span>
        <span className="text-[10px] text-textMuted truncate">{data.name}</span>
      </span>
    </span>
  ) : null;
const EtfKindCell = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className="font-mono text-[10px] uppercase tracking-widest text-textSecondary">{KIND_WORD[data.kind]}</span> : null);
const EtfAum = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{assetsB(data.aumB)}</span> : null);
const EtfFlow = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className={`font-mono text-[11px] tnum ${ink(data.flow5dM)}`}>{signedM(data.flow5dM)}</span> : null);
const EtfFee = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.expensePct == null ? '—' : `${data.expensePct.toFixed(2)}%`}</span> : null);
const EtfTop = ({ data }: ICellRendererParams<EtfRow>) =>
  /* a fund with no line on the feed — a dash, not "— · 0.0%" */
  data && (!data.topHolding || data.topHolding === '—' || !(data.topWeight > 0)) ? (
    <span className="font-mono text-[11px] text-textMuted">—</span>
  ) : data ? (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={`${data.topHolding} · ${data.topWeight.toFixed(2)}% of the fund`}>
      {/* a bond fund's largest line is an issue name, not a symbol — no logo for it */}
      {/^[A-Z][A-Z0-9.]{0,5}$/.test(data.topHolding) && <CompanyLogo ticker={data.topHolding} size={14} />}
      <span className="font-mono text-[11px] tnum text-textSecondary truncate">
        {data.topHolding} · {data.topWeight.toFixed(data.topWeight < 1 ? 2 : 1)}%
      </span>
    </span>
  ) : null;

const HoldName = ({ data }: ICellRendererParams<EtfHolding>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        <CoSub ticker={data.ticker} />
      </span>
    </span>
  ) : null;
const HoldWeight = ({ data }: ICellRendererParams<EtfHolding>) => {
  if (!data) return null;
  return (
    <span className="flex items-center gap-2 h-full w-full pr-2">
      <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
        <span className="absolute left-0 top-0 h-full rounded-full bg-silver" style={{ width: `${Math.min(100, data.weight * 4)}%` }} />
      </span>
      <span className="font-mono text-[11px] tnum text-textPrimary w-[48px] text-right">{data.weight.toFixed(data.weight < 1 ? 2 : 1)}%</span>
    </span>
  );
};

const EtfCard = ({ row, on, onToggle }: { row: EtfRow; on: boolean; onToggle: () => void }) => (
  <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Showing ${row.etf} only — click to show every fund` : `Keep the grid to ${row.etf}`} className={CARD(on)} data-etf-know={row.etf} data-on={on || undefined}>
    <span className="flex items-center gap-2 min-w-0">
      <CompanyLogo ticker={row.etf} size={18} />
      <span className="font-mono text-[12px] font-bold text-textPrimary">{row.etf}</span>
      <span className="text-[10px] text-textSecondary truncate">{row.name}</span>
    </span>
    <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
      <span className={`text-[13px] font-bold ${ink(row.flow5dM)}`}>{signedM(row.flow5dM)}</span>
      <span className="text-[9px] text-textSecondary">five days</span>
    </span>
    <span className="mt-1 block font-mono text-[9px] uppercase tracking-widest text-textMuted">{KIND_WORD[row.kind]}</span>
  </button>
);

export const EtfBook = () => {
  const navigate = useNavigate();
  const [flow, setFlow] = useState<FlowPick>('any');
  const [kind, setKind] = useState<KindPick>('any');
  const [guideOpen, setGuideOpen] = useState(false);
  const liveEtfs = useEtfs();
  const failed = liveEtfs.status === 'error';
  const feed = liveEtfs.rows;
  const cut = useMemo(
    () => feed.filter(r => (flow === 'any' || (flow === 'in' ? r.flow5dM > 0 : r.flow5dM < 0)) && (kind === 'any' || r.kind === kind)),
    [feed, flow, kind],
  );
  const [picks, setPicks] = useState<string[]>([]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const byFund = new Map(cut.map(r => [r.etf, 1]));
    picks.forEach(p => {
      const key = p.replace(/^fund:/, '');
      if (!byFund.has(key)) byFund.set(key, 0);
    });
    return [{ title: 'Funds', options: [...byFund.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => ({ value: `fund:${n}`, label: n, hint: feed.find(r => r.etf === n)?.name, count: c })) }];
  }, [cut, picks, feed]);
  const rows = useMemo(() => (picks.length === 0 ? cut : cut.filter(r => picks.includes(`fund:${r.etf}`))), [cut, picks]);
  const toggleFund = (etf: string) => setPicks(p => (p.includes(`fund:${etf}`) ? p.filter(x => x !== `fund:${etf}`) : [...p, `fund:${etf}`]));
  const toKnow = useMemo(() => [...cut].sort((a, b) => Math.abs(b.flow5dM) - Math.abs(a.flow5dM)).slice(0, NAMES_TO_KNOW), [cut]);
  const focus = useMemo(() => [...rows].sort((a, b) => b.aumB - a.aumB)[0], [rows]);
  const holdings = useMemo(() => (focus ? liveEtfs.holdingsOf(focus.etf) : []), [focus, liveEtfs]);
  const facts = useMemo(() => {
    const inflow = [...rows].sort((a, b) => b.flow5dM - a.flow5dM)[0];
    const outflow = [...rows].sort((a, b) => a.flow5dM - b.flow5dM)[0];
    const aum = rows.reduce((s, r) => s + r.aumB, 0);
    const net = rows.reduce((s, r) => s + r.flow5dM, 0);
    return { funds: rows.length, aum, net, inflow, outflow };
  }, [rows]);
  const columnDefs = useMemo<ColDef<EtfRow>[]>(
    () => [
      { headerName: 'Fund', field: 'etf', flex: 1.3, minWidth: 180, cellRenderer: EtfName, headerTooltip: 'The fund — click the row to open the fund' },
      { headerName: 'Kind', field: 'kind', width: 104, cellRenderer: EtfKindCell, headerTooltip: 'A broad stock index, one sector, Treasuries, corporate credit, or a commodity' },
      { headerName: 'Assets', field: 'aumB', width: 100, cellRenderer: EtfAum, type: 'rightAligned', headerTooltip: 'Assets in the fund' },
      { headerName: 'Five-day flow', field: 'flow5dM', width: 130, cellRenderer: EtfFlow, type: 'rightAligned', headerTooltip: 'Money in or out over the last five sessions — not the price' },
      { headerName: 'Fee', field: 'expensePct', width: 72, cellRenderer: EtfFee, type: 'rightAligned', headerTooltip: 'The expense ratio' },
      { headerName: 'Largest holding', field: 'topHolding', flex: 1.2, minWidth: 160, cellRenderer: EtfTop, headerTooltip: 'The biggest weight in the fund' },
    ],
    [],
  );
  const holdPaged = usePagedGrid<EtfHolding>();
  const holdCols = useMemo<ColDef<EtfHolding>[]>(
    () => [
      { headerName: 'Name', field: 'ticker', flex: 1.4, minWidth: 180, cellRenderer: HoldName, headerTooltip: 'A holding. It stays on this page.' },
      { headerName: 'Sector', field: 'sector', flex: 1, minWidth: 120, headerTooltip: 'The sector the holding files under' },
      { headerName: 'Country', field: 'country', width: 130, headerTooltip: 'Where the company is based' },
      { headerName: 'Shares', field: 'sharesM', width: 100, type: 'rightAligned', valueFormatter: p => `${Number(p.value).toFixed(1)}M`, headerTooltip: 'Shares the fund holds, millions' },
      { headerName: 'Weight', field: 'weight', flex: 1, minWidth: 160, cellRenderer: HoldWeight, headerTooltip: "The share of the fund's money in this holding, from the fund's holdings file (date in the strip above)" },
    ],
    [],
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cutKey = `${flow}|${kind}|${picks.join(',')}`;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('animate-soft-in');
    void el.offsetWidth;
    el.classList.add('animate-soft-in');
  }, [cutKey]);
  const openFund = (e: RowClickedEvent<EtfRow>) => {
    if (!e.data) return;
    navigate(`/dossier/etfs/${e.data.etf}`);
  };

  return (
    <Page testId="etf-book">
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the funds" testId="etfs-guide" viewport>
        <EtfsGuide />
      </GuideFocus>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">What the funds hold</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What a fund, a flow and a weight mean" testId="etfs-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">Assets, the fee, and five-day flow · a row opens the fund</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Funds")}>Funds</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-etf-count>{failed ? '—' : <>{facts.funds}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Assets")}>Assets</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{failed ? '—' : <>{assetsB(facts.aum)}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("Five-day flow")}>Five-day flow</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${ink(facts.net)}`}>{failed ? '—' : <>{signedM(facts.net)}</>}</dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted cursor-help" title={statHelp("In the book")}>In the book</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap">{failed ? '—' : <>{focus ? focus.etf : '—'}</>}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-etf-controls>
        <DropdownSelect label="Flow" value={flow} options={FLOW_OPTIONS} onChange={setFlow} title="Money in, money out, or both" testId="etf-flow" />
        <DropdownSelect label="Kind" value={kind} options={KIND_OPTIONS} onChange={setKind} title="Which funds" testId="etf-kind" />
        <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The funds on the page right now — tick any number; only those stay" testId="etf-filter" />
      </div>
      <p className={`px-5 pb-3 text-[12px] leading-relaxed text-textSecondary ${failed ? 'hidden' : ''}`} data-etf-sentence>
        {facts.inflow && facts.outflow ? (
          <>
            {facts.inflow.flow5dM > 0 ? (
              <>
                <span className="text-bull font-semibold">{facts.inflow.etf}</span> took in the most over five sessions, {signedM(facts.inflow.flow5dM)}.
              </>
            ) : (
              <>No fund took money in on this cut.</>
            )}{' '}
            {facts.outflow.flow5dM < 0 ? (
              <>
                <span className="text-bear font-semibold">{facts.outflow.etf}</span> gave back the most, {signedM(facts.outflow.flow5dM)}.
              </>
            ) : (
              <>None gave money back.</>
            )}
            {focus ? (
              <>
                {' '}
                The weights under the grid are <span className="text-textPrimary font-semibold">{focus.etf}</span>
                {rows.length === 1 ? ', the fund this cut kept' : ', the largest fund on this cut'}.
              </>
            ) : null}
          </>
        ) : liveEtfs.status === 'loading' ? (
          'Reading the funds.'
        ) : failed ? null : (
          'No fund on this cut.'
        )}
      </p>
      {failed && <FeedFallback />}
      <Strip title="The funds to know" rest="the largest five-day flow, either way · click a fund to keep the grid to it" testId="etfs">
        {toKnow.length === 0 ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : 'No fund on this cut'}</div>
        ) : (
          <KnowGrid>
            {toKnow.map(r => (
              <EtfCard key={r.etf} row={r} on={picks.includes(`fund:${r.etf}`)} onToggle={() => toggleFund(r.etf)} />
            ))}
          </KnowGrid>
        )}
      </Strip>
      <div ref={gridRef} className="slayer-board border-t border-borderSubtle" data-etf-grid>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<EtfRow>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.etf}
            onRowClicked={openFund}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows={false}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
            overlayNoRowsTemplate={noRows(failed ? 'This read did not land' : 'No fund on this cut')}
            key={failed ? 'failed' : 'live'}
          />
        </AgGridProvider>
      </div>
      {focus && (
        <>
          <Strip title={`What ${focus.etf} holds`} rest={`the largest fund on this cut, or the one a card kept · ${(() => { const c = liveEtfs.coverOf(focus.etf); return c && c.lines ? `${c.fundCount != null && c.lines < c.fundCount ? `the top ${c.lines} of ${c.fundCount.toLocaleString('en-US')} holdings` : `all ${c.lines} holdings`}, ${c.weight.toFixed(0)}% of the fund · ` : 'no holdings on file · '; })()}weights as of ${asOfDay(focus.holdingsAsOf)}, the fund's own holdings file`} testId="etf-holdings">
            <span className="sr-only">{focus.name}</span>
          </Strip>
          <div className="slayer-board border-t border-borderSubtle" data-etf-holdings={focus.etf}>
            <AgGridProvider modules={GRID_MODULES}>
              <AgGridReact<EtfHolding>
                {...phonePin}
                {...holdPaged.props}
                theme={GRID_THEME}
                domLayout="autoHeight"
                rowData={holdings}
                columnDefs={holdCols}
                defaultColDef={defaultColDef}
                getRowId={p => p.data.ticker}
                rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
                suppressCellFocus
                animateRows={false}
                tooltipShowDelay={350}
                tooltipHideDelay={8000}
              />
            </AgGridProvider>
            {holdPaged.bar(holdings.length, 'etf-holdings')}
          </div>
        </>
      )}
    </Page>
  );
};
