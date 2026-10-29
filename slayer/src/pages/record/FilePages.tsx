/* Institutions, Shorts, ETFs: the same reading order as the other lists — the head's facts, the controls, a sentence,
   the names to know, then the grid. A row opens the name. */

import { CoSub, useSeen } from '../../components/record/CoName';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { Controls, HeadFact, PhoneFold, RecordGrid, RecordHead, RecordPanel, Summary, ToKnow } from '../../components/record/RecordFrame';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { SectorMark } from '../../components/trace/SectorMark';
import { When } from '../../components/record/when';
import { EtfsGuide, InstitutionsGuide, ShortsGuide } from '../../components/record/FileGuides';
import { useBoardNames } from '../../data/boardNames';
import { houseSlug, positionWord, type EtfHolding, type EtfKind, type EtfRow, type InstitutionRow, type ShortRow } from '../../data/fileBooks';
import { HOUSE_LINES, SHORTS_MIN_FLOAT, SHORTS_SCREEN, fundHoldingsRead, useCompanyName, useEtfs, useInstitutions, useShorts, wantAllHouses, wantFundHoldings } from '../../data/liveFiles';
import { displayName, tickerName } from '../../data/tickers';
import { FeedFallback } from '../../components/ui/liveRead';

import { NAMES_TO_KNOW } from './recordSkeletons';
import { asOfDay, borrowM, moneyB, moneyM, signedM, signedPct } from './money';
import { SQUEEZE_INK, SQUEEZE_TIP, squeezeRead } from '../../data/squeeze';
import { CardLine } from '../../components/record/PhoneCards';

const ink = (n: number) => (n > 0 ? 'text-bull' : n < 0 ? 'text-bear' : 'text-textMuted');
const assetsB = (b: number) => moneyM(b * 1000);
/** Millions of shares, one way everywhere: a decimal under 100M, whole above, a B past a billion */
const sharesM = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)}B` : m >= 100 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`);

const CARD = (on: boolean) => `group text-left rounded-md border px-3 py-2.5 transition-colors min-w-0 ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`;

const Strip = ({ title, rest, testId, children }: { title: string; rest: string; testId: string; children: ReactNode }) => (
  <div className="px-5 pb-3 border-t border-borderSubtle/60" data-file-strip={testId}>
    <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
      <span>{title}</span>
      <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">{rest}</span>
    </div>
    {children}
  </div>
);

const defaultColDef = { sortable: true, resizable: true, suppressMovable: true };

/* ------------------------------------------------------------------ institutions */

type Window = 90 | 180 | 365;
type BookPick = 'any' | InstitutionRow['book'];
type HousePick = string;
type NamesPick = 'all' | 'board';

/* the window is when the latest 13F was filed; each house's latest 13F alone is read */
const WINDOW_OPTIONS: DropdownOption<Window>[] = [
  { value: 90, label: 'Filed ≤ 90 days', short: '90 days', hint: "Houses whose latest 13F was filed in the last 90 days" },
  { value: 180, label: 'Filed ≤ 180 days', short: '180 days', hint: "Houses whose latest 13F was filed in the last 180 days" },
  { value: 365, label: 'Filed ≤ 1 year', short: '1 year', hint: "Houses whose latest 13F was filed in the last year — still one 13F a house, the latest" },
];
/** "2026 Q2" → "Jun 30, 2026": the day a 13F's holdings are as of */
const QUARTER_END = ['Mar 31', 'Jun 30', 'Sep 30', 'Dec 31'];
const quarterEnd = (report: string): string | null => {
  const m = /^(\d{4}) Q([1-4])$/.exec(report);
  return m ? `${QUARTER_END[Number(m[2]) - 1]}, ${m[1]}` : null;
};
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
      {data.unlisted ? <span className="w-4 shrink-0" aria-hidden /> : <CompanyLogo ticker={data.ticker} size={16} />}
      <span className="flex flex-col leading-tight min-w-0" title={data.unlisted ? `${data.company ?? ''} — the filing gives no listed symbol` : undefined}>
        <span className={`font-mono text-t12 font-bold ${data.unlisted ? 'text-textSecondary' : 'text-textPrimary'}`}>{data.ticker}</span>
        {/* the listing's name, else the filing's; never the ticker said twice ("IVV · IVV") */}
        {data.unlisted ? <span className="text-t10 text-textMuted truncate" title={data.company ?? undefined}>{data.company}</span> : <CoSub ticker={data.ticker} fallback={data.company} />}
      </span>
    </span>
  ) : null;

/* the filing day and, under it, the quarter-end the holdings are as of */
const InstFiled = ({ data }: ICellRendererParams<InstitutionRow>) =>
  data ? (
    <span className="flex flex-col leading-tight">
      <When days={data.filedDaysAgo} />
      {quarterEnd(data.report) ? <span className="font-mono text-t9 text-textMuted">as of {quarterEnd(data.report)}</span> : null}
    </span>
  ) : null;
const InstHouse = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="text-t12 font-semibold text-textPrimary truncate" title={displayName(data.name)}>{displayName(data.name)}</span> : null);
const InstBook = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className={`font-mono text-t11 ${BOOK_INK[data.book]}`}>{data.book === 'stock' && data.security ? data.security : BOOK_WORD[data.book]}</span> : null);
const InstShares = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.sharesM.toFixed(1)}M</span> : null);
const InstValue = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{moneyB(data.valueB)}</span> : null);
/* no change reads "unchanged", never −0.0 */
const InstChange = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? Math.abs(data.changePct) < 0.05 ? <span className="font-mono text-t10 text-textMuted">unchanged</span> : <span className={`font-mono text-t11 tnum ${ink(data.changePct)}`}>{signedPct(data.changePct)}</span> : null);
const InstStatus = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span title={data.status === 'held' ? `Held: ${data.changePct >= 0 ? '+' : data.changePct < 0 ? '−' : ''}${Math.abs(data.changePct).toFixed(1)}% units versus the prior 13F, inside the ±2% band` : undefined} className={`font-mono text-t11 ${data.status === 'added' || data.status === 'new' ? 'text-bull' : data.status === 'cut' || data.status === 'closed' ? 'text-bear' : 'text-textSecondary'}`}>{positionWord(data.status)}</span> : null);
const InstBookPct = ({ data }: ICellRendererParams<InstitutionRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.pctOfBook.toFixed(1)}%</span> : null);

const InstCard = ({ row, on, onToggle }: { row: InstitutionRow; on: boolean; onToggle: () => void }) => (
  <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Showing ${row.ticker} only — click to show every name` : `Keep the grid to ${row.ticker}`} className={CARD(on)} data-institutions-know={row.ticker} data-on={on || undefined}>
    <span className="flex items-center gap-2 min-w-0">
      {row.unlisted ? null : <CompanyLogo ticker={row.ticker} size={18} />}
      <span className="font-mono text-t12 font-bold text-textPrimary">{row.ticker}</span>
      <span className="text-t10 text-textSecondary truncate" title={displayName(row.name)}>{displayName(row.name)}</span>
    </span>
    <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
      <span className="text-t13 font-bold text-textPrimary">{moneyB(row.valueB)}</span>
      <span className={`text-t10 ${BOOK_INK[row.book]}`}>{BOOK_WORD[row.book]}</span>
    </span>
    <span className={`mt-1 block font-mono text-t9 tnum ${ink(row.changePct)}`}>vs last filing {signedPct(row.changePct)}</span>
  </button>
);


/* under 640px each book is a card a row, the deciding fields on two lines */
const cellJsx = <T,>(Cell: (p: ICellRendererParams<T>) => ReactNode, data: T) => <Cell {...({ data } as ICellRendererParams<T>)} />;
const InstPhone = (r: InstitutionRow) => (
  <>
    <CardLine left={cellJsx(InstName, r)} right={cellJsx(InstValue, r)} />
    <CardLine muted left={<>{displayName(r.name)} · filed {cellJsx(InstFiled, r)}</>} right={<span className="inline-flex gap-2">{cellJsx(InstBook, r)} {cellJsx(InstStatus, r)}</span>} />
  </>
);
const ShortPhone = (r: ShortRow) => (
  <>
    <CardLine left={cellJsx(ShortName, r)} right={cellJsx(ShortInterest, r)} />
    <CardLine muted left={cellJsx(ShortSqueeze, r)} right={<span>{r.daysToCover.toFixed(1)} days to cover</span>} />
  </>
);
const HoldPhone = (h: EtfHolding) => <CardLine left={<span className="font-mono font-bold">{h.bond ? h.name : h.ticker}</span>} right={<span className="font-mono tnum">{h.weight.toFixed(2)}%</span>} />;
const EtfPhone = (r: EtfRow) => (
  <>
    <CardLine left={cellJsx(EtfName, r)} right={cellJsx(EtfAum, r)} />
    <CardLine muted left={cellJsx(EtfKindCell, r)} right={<span className="inline-flex gap-1">5-day {cellJsx(EtfFlow, r)}</span>} />
  </>
);

export const Institutions = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  const [window, setWindow] = useState<Window>(365);
  const [book, setBook] = useState<BookPick>('any');
  const [house, setHouse] = useState<HousePick>('any');
  const [names, setNames] = useState<NamesPick>('all');
  const live = useInstitutions();
  const feed = live.rows;
  /* the period the 13Fs cover */
  const periods = useMemo(() => [...new Set(feed.map(r => r.report).filter(r => r && r !== '—'))].sort().reverse(), [feed]);
  const periodWords = periods.length === 1 && quarterEnd(periods[0]) ? `13F for the quarter ending ${quarterEnd(periods[0])}` : periods.length > 1 ? `13Fs for the quarters ending ${periods.map(p => quarterEnd(p) ?? p).join(', ')}` : null;
  /* the rest of the houses are read when wanted: any cut, a pick, the grid's pages or the list's end */
  const allSentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!live.held) return;
    const el = allSentinel.current;
    if (!el) return;
    /* the reader's own scroll to the end of the list asks for the rest — the sentinel in view while the grid is still
       laying out does not */
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      if (globalThis.scrollY > 100 && r.top < globalThis.innerHeight + 200) wantAllHouses();
    };
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    return () => globalThis.removeEventListener('scroll', onScroll);
  }, [live.held]);
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
      { title: 'Houses', options: [...byHouse.entries()].sort(order).map(([n, c]) => ({ value: `house:${n}`, label: displayName(n), count: c })) },
    ];
  }, [cut, picks]);
  /* in the grid's own order (largest value first), so the phone's cards read the same */
  const rows = useMemo(() => {
    const on = new Set(picks);
    const out = picks.length === 0 ? [...cut] : cut.filter(r => on.has(`name:${r.ticker}`) || on.has(`house:${r.name}`));
    return out.sort((a, b) => b.valueB - a.valueB);
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
      {
        headerName: 'Filed',
        field: 'filedDaysAgo',
        width: 126,
        cellRenderer: InstFiled,
        /* by recency descending, so the arrow reads ↓ for newest first */
        comparator: (a: number, b: number) => b - a,
        headerTooltip: 'The day the 13F was filed, and how far back that is',
      },
      { headerName: 'House', field: 'name', flex: 1.2, minWidth: 140, cellRenderer: InstHouse, headerTooltip: 'The filer' },
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 170, cellRenderer: InstName, headerTooltip: 'The holding — click the row to open the house’s filing' },
      { headerName: 'Side', field: 'book', width: 88, cellRenderer: InstBook, headerTooltip: 'Call, put, or the shares. The filing does not name a strike or an expiry.' },
      { headerName: 'Status', field: 'status', width: 88, cellRenderer: InstStatus, headerTooltip: 'Against the prior 13F: new, added (2%+ more units), cut (2%+ fewer), closed, or held (within 2%)' },
      { headerName: 'Shares', field: 'sharesM', width: 96, cellRenderer: InstShares, type: 'rightAligned', headerTooltip: 'Shares reported, in millions' },
      { headerName: 'Value', field: 'valueB', width: 100, cellRenderer: InstValue, type: 'rightAligned', sort: 'desc', headerTooltip: 'The reported value; the grid opens on the largest lines' },
      { headerName: '% of 13F value', field: 'pctOfBook', width: 112, cellRenderer: InstBookPct, type: 'rightAligned', headerTooltip: 'This line’s value as a share of everything the house reported on its 13F, the whole filing' },
      { headerName: 'Vs last filing', field: 'changePct', width: 120, cellRenderer: InstChange, type: 'rightAligned', headerTooltip: 'Change versus the prior 13F, not versus yesterday' },
    ],
    [],
  );
  const cutKey = `${window}|${book}|${house}|${names}|${picks.join(',')}`;
  useEffect(() => {
    if (cutKey !== '365|any|any|all|') wantAllHouses();
  }, [cutKey]);

  /* reading, not nothing */
  const instReading = !failed && feed.length === 0 && (live.status === 'loading' || (!!live.progress && live.progress.done < live.progress.total));
  /* the cards and the largest line are over the houses read so far, said on them */
  const newestWords = live.held && live.progress ? `among the ${live.progress.done} newest filers` : '';
  const empty = failed ? 'This read did not land' : instReading ? 'Reading the 13Fs…' : 'No line on this cut';
  const pending = live.status === 'loading' && feed.length === 0;
  return (
    <RecordPanel testId="institutions" attrs={{ 'data-window': window }}>
      <RecordHead
        title="What the houses reported"
        guide={{ title: 'How to read the filings', door: 'What a line, a book and the change mean', testId: 'institutions-guide', body: <InstitutionsGuide /> }}
        kept={live.keptAt}
        line={<span title="A 13F is what a house held at the quarter's end, filed up to 45 days later — never today's positions">{periodWords ? <span className="text-textSecondary" data-institutions-period>{periodWords} · </span> : null}the largest {HOUSE_LINES} lines of the 40 largest houses · a row opens that house</span>}
        facts={
          <>
            <HeadFact label="Lines" testId="institutions-count">
              <span data-institutions-count>{failed ? '—' : pending ? '…' : facts.lines.toLocaleString('en-US')}</span>
            </HeadFact>
            <HeadFact label="Houses" testId="institutions-houses">
              {failed ? '—' : live.held && live.progress ? (
                <span className="text-textSecondary" title={`The ${live.progress.done} largest houses are read; the other ${live.progress.total - live.progress.done} when you go further`}>
                  {facts.houses.toLocaleString('en-US')} <span className="text-textMuted">of {live.progress.total} ·</span>{' '}
                  <button type="button" onClick={wantAllHouses} className="underline decoration-dotted underline-offset-2 hover:text-textPrimary" data-institutions-more>
                    read all
                  </button>
                </span>
              ) : live.progress ? <span className="text-textSecondary">{facts.houses.toLocaleString('en-US')} · reading {live.progress.done} of {live.progress.total}</span> : pending ? <span className="text-textMuted">…</span> : facts.houses.toLocaleString('en-US')}
            </HeadFact>
            <HeadFact label="Calls · puts">{failed ? '—' : pending ? '…' : <>{facts.calls} calls <span className="text-textMuted">·</span> {facts.puts} puts</>}</HeadFact>
            <HeadFact label="Largest line">{failed ? '—' : pending ? '…' : facts.lead ? `${facts.lead.ticker} ${moneyB(facts.lead.valueB)}` : '—'}</HeadFact>
          </>
        }
      />
      <PhoneFold label="Filters, summary and the lines to know" testId="institutions">
        <Controls testId="institutions">
          <DropdownSelect label="Window" value={window} options={WINDOW_OPTIONS} onChange={setWindow} title="How far back the filings run" testId="institutions-window" />
          <DropdownSelect label="Side" value={book} options={BOOK_OPTIONS} onChange={setBook} title="Shares, call, or put. Not a contract." testId="institutions-book" />
          <DropdownSelect label="House" value={house} options={houseOptions} onChange={setHouse} title="Which filer" testId="institutions-house" />
          <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="institutions-names" />
          <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names and houses on the page right now — tick any number; only those stay" testId="institutions-filter" />
        </Controls>
        {failed ? (
          <FeedFallback />
        ) : (
          <Summary testId="institutions">
            {facts.lead ? (
              <>
                <span className="text-textPrimary font-semibold">{displayName(facts.lead.name)}</span>’s largest line is <span className="text-textPrimary font-semibold">{facts.lead.ticker}</span>, {moneyB(facts.lead.valueB)}. {facts.houses.toLocaleString('en-US')} {facts.houses === 1 ? 'house' : 'houses'} filed {facts.lines.toLocaleString('en-US')} {facts.lines === 1 ? 'line' : 'lines'} on this cut — {facts.calls} marked call, {facts.puts} marked put, and a 13F names no strike.
              </>
            ) : live.status === 'loading' ? 'Reading the 13Fs.' : 'Nothing filed on this cut.'}
          </Summary>
        )}
        <ToKnow title="The lines to know" sub={`the largest line in each name${newestWords ? ` ${newestWords}` : ''} · a click keeps the grid to it`} testId="institutions" count={NAMES_TO_KNOW} empty={toKnow.length === 0 ? empty : null}>
          {toKnow.map(r => (
            <InstCard key={r.id} row={r} on={picks.includes(`name:${r.ticker}`)} onToggle={() => toggleName(r.ticker)} />
          ))}
        </ToKnow>
      </PhoneFold>
      <RecordGrid<InstitutionRow>
        testId="institutions"
        rows={rows}
        rowKey={r => r.id}
        card={InstPhone}
        onOpen={r => navigate(`/dossier/institutions/${houseSlug(r.name)}?line=${r.ticker}`)}
        empty={empty}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        gridProps={{ animateRows: false }}
      />
      <div ref={allSentinel} aria-hidden className="h-px" />
    </RecordPanel>
  );
};

/* ------------------------------------------------------------------ shorts */

type Show = 'all' | 'heavy';
type SectorPick = string;

const SHOW_OPTIONS: DropdownOption<Show>[] = [
  { value: 'all', label: 'Every name', short: 'All', hint: 'The whole short book' },
  /* the screen's floor is about 19% of the float */
  { value: 'heavy', label: '30% or more', hint: 'Thirty percent of the float or more sold short' },
];


const ShortName = ({ data }: ICellRendererParams<ShortRow>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
        {/* the listing's name, else the vendor's; never the ticker said twice */}
        <CoSub ticker={data.ticker} fallback={data.name} />
      </span>
    </span>
  ) : null;
const ShortSector = ({ data }: ICellRendererParams<ShortRow>) =>
  data ? (
    data.sector === '—' ? (
      <span className="text-t11 text-textMuted" title="The feed's file does not name a sector">—</span>
    ) : (
      <span className="inline-flex items-center gap-1.5 text-t11 text-textSecondary">
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
      <span className={`font-mono text-t11 tnum w-[52px] ${heavy ? 'text-bear font-semibold' : 'text-textPrimary'}`}>{data.interestPct.toFixed(2)}%</span>
      <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
        <span className={`absolute left-0 top-0 h-full rounded-full ${heavy ? 'bg-bear' : 'bg-silver'}`} style={{ width: `${Math.min(100, data.interestPct * 2)}%` }} />
      </span>
    </span>
  );
};
const ShortDays = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.daysToCover.toFixed(1)}</span> : null);
const ShortFloat = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-t11 tnum text-textSecondary">{sharesM(data.floatM)}</span> : null);
const ShortVol = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.shortVolRatio == null ? '—' : `${data.shortVolRatio.toFixed(0)}%`}</span> : null);
const ShortBorrow = ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.feeRate == null ? '—' : `${data.feeRate.toFixed(2)}%`}</span> : null);

const ShortCard = ({ row, on, onToggle }: { row: ShortRow; on: boolean; onToggle: () => void }) => {
  /* the screen carries no company name; a card asks the name's own stock card for it */
  const co = useCompanyName(row.ticker, true);
  const name = co && co.toUpperCase() !== row.ticker ? co : row.name && row.name !== row.ticker ? row.name : '';
  return (
  <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Showing ${row.ticker} only — click to show every name` : `Keep the grid to ${row.ticker}`} className={CARD(on)} data-shorts-know={row.ticker} data-on={on || undefined}>
    <span className="flex items-center gap-2 min-w-0">
      <CompanyLogo ticker={row.ticker} size={18} />
      <span className="font-mono text-t12 font-bold text-textPrimary">{row.ticker}</span>
      {name && <span className="text-t10 text-textSecondary truncate" title={name}>{name}</span>}
    </span>
    <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
      <span className={`text-t13 font-bold ${row.interestPct >= 30 ? 'text-bear' : 'text-textPrimary'}`}>{row.interestPct.toFixed(1)}%</span>
      <span className="text-t9 text-textSecondary">of the float</span>
    </span>
    <span className="mt-1 block font-mono text-t9 tnum text-textSecondary">{row.daysToCover.toFixed(1)} days to cover</span>
    {(() => {
      const q = squeezeRead(row);
      return (
        <span className="mt-1 block font-mono text-t9 uppercase tracking-widest truncate" title={`${q.facts.map(f => f.text).join(' · ')}\n${SQUEEZE_TIP}`}>
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
      <span className={`font-mono text-t10 font-semibold uppercase tracking-widest ${SQUEEZE_INK[q.word]}`}>{q.word}</span>
      {/* the setup sentence wraps to two lines rather than stop mid-sentence; the whole of it is on the hover */}
      <span className="text-t10 leading-[13px] text-textMuted whitespace-normal break-words line-clamp-2">{q.facts.map(f => f.text).slice(0, 2).join(' · ')}</span>
    </span>
  );
};

export const Shorts = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  const [show, setShow] = useState<Show>('all');
  const [sector, setSector] = useState<SectorPick>('all');
  const [names, setNames] = useState<NamesPick>('all');
  const liveShorts = useShorts();
  const failed = liveShorts.status === 'error';
  /* while the book is read every figure is "…" and the empty lines say it is reading */
  const waiting = liveShorts.status === 'loading' && liveShorts.rows.length === 0;
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
      { headerName: 'Shares short', field: 'shortSharesM', width: 120, cellRenderer: ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{sharesM(data.shortSharesM)}</span> : null), type: 'rightAligned', headerTooltip: 'Shares sold short, in millions' },
      { headerName: 'Days to cover', field: 'daysToCover', width: 120, cellRenderer: ShortDays, type: 'rightAligned', headerTooltip: 'How many days of normal trading it would take the shorts to buy back every share — shares short divided by average daily volume' },
      { headerName: 'Fee', field: 'feeRate', width: 80, cellRenderer: ShortBorrow, type: 'rightAligned', headerTooltip: 'The yearly fee to borrow on the settlement day (the short file shows today’s); a dash if not priced' },
      { headerName: 'Available', field: 'availableM', width: 110, cellRenderer: ({ data }: ICellRendererParams<ShortRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{borrowM(data.availableM)}</span> : null), type: 'rightAligned', headerTooltip: 'Shares left to borrow on the settlement day (the short file shows today’s); the feed caps it at 10M' },
      { headerName: 'Float', field: 'floatM', flex: 0.7, minWidth: 90, cellRenderer: ShortFloat, type: 'rightAligned', headerTooltip: 'Shares free to trade (the float), in millions — insiders’ locked-up shares are not in it' },
    ];
    if (hasShortVol) cols.splice(5, 0, { headerName: 'Short vol', field: 'shortVolRatio', width: 100, cellRenderer: ShortVol, type: 'rightAligned', headerTooltip: 'Short volume as a percent of the session’s volume' });
    return cols;
  }, [hasShortVol]);

  const empty = failed ? 'This read did not land' : waiting ? 'Reading the short book' : 'No name on this cut';
  const dash = failed ? '—' : waiting ? '…' : null;
  return (
    <RecordPanel testId="shorts" attrs={{ 'data-show': show }}>
      <RecordHead
        title="Where the short book sits"
        guide={{ title: 'How to read the short book', door: 'What short interest, days to cover and the fee mean', testId: 'shorts-guide', body: <ShortsGuide /> }}
        kept={liveShorts.keptAt}
        line={
          <span data-shorts-asof>
            <span className={facts.stale ? 'text-warn' : ''} title={facts.stale ? 'Short interest settles twice a month and is published about ten days after; the next settlement is not published yet, so this is the latest there is' : 'Short interest settles twice a month and is published about ten days later — never today'}>
              short interest as of {waiting ? '…' : asOfDay(facts.asOf)}{facts.stale ? ' · the next is not out yet' : ''}
            </span>{' '}
            · the {SHORTS_SCREEN} heaviest by % of float · a row opens the short file
          </span>
        }
        facts={
          <>
            <HeadFact label="Names" testId="shorts-count" tip={`Of the ${SHORTS_SCREEN} heaviest shorts by share of the float (floats of ${SHORTS_MIN_FLOAT / 1e6}M+ shares)`}>
              <span data-shorts-count>{dash ?? <>{facts.names}{facts.funds ? <span className="text-textMuted"> · {facts.funds} funds</span> : null}</>}</span>
            </HeadFact>
            <HeadFact label="Squeeze setups" testId="shorts-squeeze" tip={SQUEEZE_TIP}>
              <span data-shorts-squeeze>{dash ?? <><span className="text-bear">{facts.strong} strong</span> <span className="text-textMuted">·</span> <span className="text-warn">{facts.building} building</span> <span className="text-textMuted">of {facts.stocks}</span></>}</span>
            </HeadFact>
            <HeadFact label="At 20% or more" tone={facts.heavy ? 'text-bear' : undefined} tip="Stocks on this screen (funds left out) with at least 20% of the float sold short">
              {dash ?? facts.heavy}
            </HeadFact>
            <HeadFact label="Heaviest" tip="The stock (funds left out) with the largest share of its float sold short">
              {dash ?? (facts.lead ? `${facts.lead.ticker} ${facts.lead.interestPct.toFixed(1)}%` : '—')}
            </HeadFact>
            <HeadFact label="Median days to cover" tip="The middle of the stocks' days of normal volume needed to buy the shorts back">
              {dash ?? (facts.stocks ? facts.days.toFixed(1) : '—')}
            </HeadFact>
          </>
        }
      />
      <PhoneFold label="Filters, summary and the names to know" testId="shorts">
        <Controls testId="shorts">
          <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="Which short books" testId="shorts-show" />
          <DropdownSelect label="Sector" value={sector} options={sectorOptions} onChange={setSector} title="Which sector" testId="shorts-sector" />
          <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="shorts-names" />
          <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The names on the page right now — tick any number; only those stay" testId="shorts-filter" />
        </Controls>
        {failed ? (
          <FeedFallback />
        ) : (
          <Summary testId="shorts" more="The squeeze words here read the settlement alone; a name's file adds today's borrow, short volume and fails to deliver, and can read stronger. Funds are listed last, with no squeeze read: their short interest is creation and hedging.">
            {facts.lead ? (
              <>
                <span className={`font-semibold ${facts.lead.interestPct >= 30 ? 'text-bear' : 'text-textPrimary'}`}>{facts.lead.ticker}</span> is the heaviest stock short here, {facts.lead.interestPct.toFixed(1)}% of the float and {facts.lead.daysToCover.toFixed(1)} days to cover. <span className="text-bear font-semibold">{facts.heavy}</span> {facts.heavy === 1 ? 'stock sits' : 'stocks sit'} at 20% or more; the lightest is {facts.floor.toFixed(1)}%.
              </>
            ) : liveShorts.status === 'loading' ? 'Reading the short book.' : 'Nothing on this cut.'}
          </Summary>
        )}
        <ToKnow title="The names to know" sub="the heaviest short interest on this cut, funds left out · a click keeps the grid to it" testId="shorts" count={NAMES_TO_KNOW} empty={toKnow.length === 0 ? empty : null}>
          {toKnow.map(r => (
            <ShortCard key={r.ticker} row={r} on={picks.includes(`name:${r.ticker}`)} onToggle={() => toggleName(r.ticker)} />
          ))}
        </ToKnow>
      </PhoneFold>
      <RecordGrid<ShortRow>
        testId="shorts"
        rows={rows}
        rowKey={r => r.ticker}
        card={ShortPhone}
        onOpen={r => navigate(`/dossier/shorts/${r.ticker}`)}
        empty={empty}
        columnDefs={columnDefs}
        defaultColDef={defaultColDef}
        gridProps={{ animateRows: false }}
      />
    </RecordPanel>
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
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.etf}</span>
        <span className="text-t10 text-textMuted truncate" title={data.name}>{data.name}</span>
      </span>
    </span>
  ) : null;
const EtfKindCell = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className="font-mono text-t10 uppercase tracking-widest text-textSecondary">{KIND_WORD[data.kind]}</span> : null);
const EtfAum = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{assetsB(data.aumB)}</span> : null);
const EtfFlow = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className={`font-mono text-t11 tnum ${ink(data.flow5dM)}`}>{signedM(data.flow5dM)}</span> : null);
const EtfFee = ({ data }: ICellRendererParams<EtfRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.expensePct == null ? '—' : `${data.expensePct.toFixed(2)}%`}</span> : null);
/* the fund's holdings are read once its cell is on screen (liveFiles.wantFundHoldings) */
const EtfTop = ({ data }: ICellRendererParams<EtfRow>) => {
  const [ref, seen] = useSeen<HTMLSpanElement>();
  const etf = data?.etf ?? '';
  useEffect(() => {
    if (seen && etf) wantFundHoldings(etf);
  }, [seen, etf]);
  if (!data) return null;
  if (!fundHoldingsRead(data.etf)) return <span ref={ref} className="font-mono text-t11 text-textMuted" title="Reading the fund's holdings">…</span>;
  /* a fund with no line on the feed — a dash, not "— · 0.0%" */
  if (!data.topHolding || data.topHolding === '—' || !(data.topWeight > 0)) return <span ref={ref} className="font-mono text-t11 text-textMuted">—</span>;
  return (
    <span ref={ref} className="inline-flex items-center gap-1.5 min-w-0" title={`${data.topHolding} · ${data.topWeight.toFixed(2)}% of the fund`}>
      {/* a bond fund's largest line is an issue name, not a symbol — no logo for it */}
      {/^[A-Z][A-Z0-9.]{0,5}$/.test(data.topHolding) && <CompanyLogo ticker={data.topHolding} size={14} />}
      {/* the holding's name may give way; its weight, a number, never does */}
      <span className="font-mono text-t11 text-textSecondary truncate min-w-0">{data.topHolding}</span>
      <span className="shrink-0 font-mono text-t11 tnum text-textSecondary whitespace-nowrap">· {data.topWeight.toFixed(data.topWeight < 1 ? 2 : 1)}%</span>
    </span>
  );
};

const HoldName = ({ data }: ICellRendererParams<EtfHolding>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
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
      <span className="font-mono text-t11 tnum text-textPrimary w-[48px] text-right">{data.weight.toFixed(data.weight < 1 ? 2 : 1)}%</span>
    </span>
  );
};

const EtfCard = ({ row, on, onToggle }: { row: EtfRow; on: boolean; onToggle: () => void }) => (
  <button type="button" onClick={onToggle} aria-pressed={on} title={on ? `Showing ${row.etf} only — click to show every fund` : `Keep the grid to ${row.etf}`} className={CARD(on)} data-etf-know={row.etf} data-on={on || undefined}>
    <span className="flex items-center gap-2 min-w-0">
      <CompanyLogo ticker={row.etf} size={18} />
      <span className="font-mono text-t12 font-bold text-textPrimary">{row.etf}</span>
      <span className="text-t10 text-textSecondary truncate" title={row.name}>{row.name}</span>
    </span>
    <span className="mt-1.5 flex items-baseline gap-2 font-mono tnum">
      <span className={`text-t13 font-bold ${ink(row.flow5dM)}`}>{signedM(row.flow5dM)}</span>
      <span className="text-t9 text-textSecondary">five days</span>
    </span>
    <span className="mt-1 block font-mono text-t9 uppercase tracking-widest text-textMuted">{KIND_WORD[row.kind]}</span>
  </button>
);

export const EtfBook = () => {
  const navigate = useNavigate();
  const [flow, setFlow] = useState<FlowPick>('any');
  const [kind, setKind] = useState<KindPick>('any');
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
  useEffect(() => {
    if (focus) wantFundHoldings(focus.etf);
  }, [focus]);
  const holdings = useMemo(() => (focus ? liveEtfs.holdingsOf(focus.etf) : []), [focus, liveEtfs]);
  const facts = useMemo(() => {
    const inflow = [...rows].sort((a, b) => b.flow5dM - a.flow5dM)[0];
    const outflow = [...rows].sort((a, b) => a.flow5dM - b.flow5dM)[0];
    const aum = rows.reduce((s, r) => s + r.aumB, 0);
    const net = rows.reduce((s, r) => s + r.flow5dM, 0);
    return { funds: rows.length, aum, net, inflow, outflow };
  }, [rows]);
  /* the sessions every fund's flow is summed over (data/liveFiles.ts flow5 — one window for all) */
  const flowSpan = useMemo(() => {
    const r = feed.find(x => x.flowFrom && x.flowTo);
    if (!r?.flowFrom || !r.flowTo) return '';
    const md = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
    return `${md(r.flowFrom)}–${md(r.flowTo)}${r.flowDays && r.flowDays < 5 ? `, ${r.flowDays} days` : ''}`;
  }, [feed]);
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

  /* reading, not zero */
  const etfReading = !failed && liveEtfs.status === 'loading' && liveEtfs.rows.length === 0;
  const empty = failed ? 'This read did not land' : etfReading ? 'Reading the funds…' : 'No fund on this cut';
  const dash = failed ? '—' : etfReading ? <span className="text-textMuted">…</span> : null;
  const cover = focus ? liveEtfs.coverOf(focus.etf) : null;
  return (
    <RecordPanel testId="etf-book">
      <RecordHead
        title="What the funds hold"
        guide={{ title: 'How to read the funds', door: 'What a fund, a flow and a weight mean', testId: 'etfs-guide', body: <EtfsGuide /> }}
        kept={liveEtfs.keptAt}
        line="Assets, the fee and five-day flow · a row opens the fund"
        facts={
          <>
            <HeadFact label="Funds" testId="etf-count">
              <span data-etf-count>{dash ?? facts.funds}</span>
            </HeadFact>
            <HeadFact label="Assets">{dash ?? assetsB(facts.aum)}</HeadFact>
            <HeadFact label={`Five-day flow${flowSpan ? ` · ${flowSpan}` : ''}`} tone={etfReading ? 'text-textMuted' : ink(facts.net)} tip={`Money in or out of the funds, summed over the same sessions${flowSpan ? ` (${flowSpan})` : ''} for every fund`}>
              {dash ?? signedM(facts.net)}
            </HeadFact>
            <HeadFact label="In the book">{dash ?? (focus ? focus.etf : '—')}</HeadFact>
          </>
        }
      />
      <PhoneFold label="Filters, summary and the funds to know" testId="etfs">
        <Controls testId="etf">
          <DropdownSelect label="Flow" value={flow} options={FLOW_OPTIONS} onChange={setFlow} title="Money in, money out, or both" testId="etf-flow" />
          <DropdownSelect label="Kind" value={kind} options={KIND_OPTIONS} onChange={setKind} title="Which funds" testId="etf-kind" />
          <DropdownMulti label="Filter" values={picks} groups={filterGroups} onChange={setPicks} title="The funds on the page right now — tick any number; only those stay" testId="etf-filter" />
        </Controls>
        {failed ? (
          <FeedFallback />
        ) : (
          <Summary testId="etf">
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
                    The holdings under the grid are <span className="text-textPrimary font-semibold">{focus.etf}</span>'s{rows.length === 1 ? '' : ', the largest fund on this cut'}.
                  </>
                ) : null}
              </>
            ) : liveEtfs.status === 'loading' ? 'Reading the funds.' : 'No fund on this cut.'}
          </Summary>
        )}
        <ToKnow title="The funds to know" sub="the largest five-day flow, either way · a click keeps the grid to it" testId="etfs" count={NAMES_TO_KNOW} empty={toKnow.length === 0 ? empty : null}>
          {toKnow.map(r => (
            <EtfCard key={r.etf} row={r} on={picks.includes(`fund:${r.etf}`)} onToggle={() => toggleFund(r.etf)} />
          ))}
        </ToKnow>
      </PhoneFold>
      <RecordGrid<EtfRow> testId="etf" rows={rows} rowKey={r => r.etf} card={EtfPhone} onOpen={r => navigate(`/dossier/etfs/${r.etf}`)} empty={empty} columnDefs={columnDefs} defaultColDef={defaultColDef} gridProps={{ animateRows: false }} />
      {focus && (
        <>
          <Strip title={`What ${focus.etf} holds`} rest={`${cover && cover.lines ? `${cover.fundCount != null && cover.lines < cover.fundCount ? `the top ${cover.lines} of ${cover.fundCount.toLocaleString('en-US')} holdings` : `all ${cover.lines} holdings`}, ${cover.weight.toFixed(0)}% of the fund` : 'no holdings on file'} · as of ${asOfDay(focus.holdingsAsOf)}`} testId="etf-holdings">
            <span className="sr-only">{focus.name}</span>
          </Strip>
          <div data-etf-holdings={focus.etf}>
            <RecordGrid<EtfHolding> testId="etf-holdings-list" rows={holdings} rowKey={h => h.ticker} card={HoldPhone} empty={fundHoldingsRead(focus.etf) ? 'No holdings on file' : 'Reading the holdings…'} columnDefs={holdCols} defaultColDef={defaultColDef} gridProps={{ animateRows: false }} />
          </div>
        </>
      )}
    </RecordPanel>
  );
};
