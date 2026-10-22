/*
==================================================
  SLAYER TERMINAL - STOCKS (pages/record/Stocks.tsx)

  How every name screens. Four sleeves — the trend
  (momentum), the numbers (quality), the money (flow)
  and the news — each read against the 50 line and
  rolled into one screen: STRONG, MIXED or WEAK. The
  same sleeves rolled up by sector are THE ROTATION,
  so who leads and which names carry it come from one
  composite, never two opinions.

  Walked into the Record (Noah, 2026-09-10: "i think
  it needs to be apart of the records section and
  also needs to go through the extensive walk"). The
  old page — a metric grid of five cards, a ladder
  panel with a summary paragraph, a filter-tab table
  with a thesis strip — is now the Record's one box:

    THE HEAD      the names and how they split, the
                  breadth, the leading and trailing
                  sector (each a door to its names)
    THE CARDS     Screen · Sector · Names, and the
                  Filter as a card reading the page
    THE SENTENCE
    THE ROTATION  every sector ranked, leader first,
                  its bar the share of the leader's
                  screen, its direction word and its
                  two windows — a card keeps the grid
                  to its names
    THE GRID      in a window a screen tall: the name,
                  its sector, the price and the day,
                  the 30-day line, the four sleeves as
                  BARS ONLY (the figures stay inside
                  the engine — Noah, 2026-08-16), the
                  screen word, and the read in plain
                  words. A row opens the name on the Map.

  States, not orders: STRONG / MIXED / WEAK are what
  the data says about a name, never an instruction.
==================================================
*/

import { CONTROLS_LINE } from '../../components/trace/TraceBox';
import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../../components/ui/houseGrid';
import { FeedFallback } from '../../components/ui/liveRead';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti, { type MultiGroup } from '../../components/ui/DropdownMulti';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import Sparkline from '../../components/compass/Sparkline';
import { SectorMark } from '../../components/trace/SectorMark';
import { StocksGuide } from '../../components/record/StocksGuide';
import { useBoardNames } from '../../data/boardNames';
import { buildSectorBoard, type SectorRow, type StockPick, type StockSleeves, type StockVerdict } from '../../data/stocks';
import { useLiveStocks } from '../../data/liveFiles';
import { gradeOfComposite, type Grade } from '../../data/stockOverview';
import { SECTORS, type Sector } from '../../data/universe';
import { ROTATION_SECTORS } from './recordSkeletons';

type ScreenPick = 'all' | Grade;
type SectorPick = 'all' | Sector;
type NamesPick = 'all' | 'board';

/** User-facing screen words — the data's read, never an instruction */
/* strong · good · caution · poor (Noah, 2026-09-19): the same four words the name's own page says, off the same
   cuts (stockOverview.ts `gradeOfComposite`), never a figure of ours. STRONG wears a ring: it is the rare one. */
const gradeOfPick = (p: StockPick): Grade => gradeOfComposite(p.composite);
const SCREEN_DOT: Record<Grade, string> = { strong: 'bg-bull ring-2 ring-bull/30', good: 'bg-bull', caution: 'bg-warn', poor: 'bg-bear' };
const GRADE_RANK: Grade[] = ['strong', 'good', 'caution', 'poor'];

const SCREEN_OPTIONS: DropdownOption<ScreenPick>[] = [
  { value: 'all', label: 'Every screen', hint: 'Strong, good, caution and poor' },
  { value: 'strong', label: 'Strong', hint: 'Nearly everything lines up at once — rare on purpose' },
  { value: 'good', label: 'Good', hint: 'All four sleeves point the same way' },
  { value: 'caution', label: 'Caution', hint: 'The sleeves disagree — a catalyst decides' },
  { value: 'poor', label: 'Poor', hint: 'The data argues against the name' },
];
const SECTOR_OPTIONS: DropdownOption<SectorPick>[] = [{ value: 'all', label: 'Every sector', hint: 'The ten sectors the universe files' }, ...SECTORS.map(s => ({ value: s, label: s }))];
const NAMES_OPTIONS: DropdownOption<NamesPick>[] = [
  { value: 'all', label: 'Every name', hint: 'The whole universe' },
  { value: 'board', label: 'Your board', hint: 'The names on your Board' },
];

/* Direction of relative strength over two windows — a different axis from
   the ladder's rank. LEADING is the ladder's absolute top only (ties share it),
   the one magenta on the page; the phase words say which way a sector moves. */
const PHASE_WORD: Record<SectorRow['phase'], string> = { LEADING: 'RISING', IMPROVING: 'TURNING UP', WEAKENING: 'ROLLING OVER', LAGGING: 'FALLING' };
const PHASE_INK: Record<SectorRow['phase'], string> = { LEADING: 'text-bull', IMPROVING: 'text-flip', WEAKENING: 'text-warn', LAGGING: 'text-bear' };
const PHASE_BAR: Record<SectorRow['phase'], string> = { LEADING: 'bg-bull', IMPROVING: 'bg-flip', WEAKENING: 'bg-warn', LAGGING: 'bg-bear/80' };

/** The two consumer sectors by their second word on a card 150px wide — the mark and the grid carry the whole name */
const SHORT_SECTOR: Partial<Record<Sector, string>> = { 'Consumer Discretionary': 'Discretionary', 'Consumer Staples': 'Staples' };

const signedPct = (v: number, d = 1) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}%`;
const dirInk = (v: number) => (v >= 0 ? 'text-bull' : 'text-bear');
/** "A, B and C" — never "A and B and C" */
const listPhrase = (items: string[]) => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/* ---- cells --------------------------------------------------------------------- */

const NameCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        <span className="text-[10px] text-textMuted truncate">{data.name}</span>
      </span>
    </span>
  ) : null;

const SectorCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-textSecondary">
      <SectorMark sector={data.sector} />
      {data.sector}
    </span>
  ) : null;

const LastCell = ({ data }: ICellRendererParams<StockPick>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">${data.price.toFixed(2)}</span> : null);
const TodayCell = ({ data }: ICellRendererParams<StockPick>) => (data ? <span className={`font-mono text-[11px] tnum ${dirInk(data.changePct)}`}>{signedPct(data.changePct, 2)}</span> : null);
const TrendCell = ({ data }: ICellRendererParams<StockPick>) => {
  if (!data || data.trend.length < 2) return <span className="font-mono text-[10px] text-textMuted">—</span>;
  return <Sparkline data={data.trend} up={data.trend[data.trend.length - 1] >= data.trend[0]} width={72} height={20} />;
};

/** A sleeve as a bar against the 50 line. A quiet sleeve was not on the feed and stays out of the screen. */
const sleeveCell =
  (key: keyof StockSleeves) =>
  ({ data }: ICellRendererParams<StockPick>) => {
    if (!data) return null;
    if (data.quiet.includes(key)) return <span className="font-mono text-[10px] text-textMuted" title="Not on this feed — left out of the screen">—</span>;
    const v = data.sleeves[key];
    return (
      <span className="flex items-center h-full w-full pr-2" title={v > 50 ? 'Above the 50 line — for the name' : 'Below the 50 line — against it'}>
        <span className="relative flex-1 h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
          <span className={`absolute left-0 top-0 h-full rounded-full ${v > 50 ? 'bg-bull' : 'bg-bear/70'}`} style={{ width: `${v}%` }} />
        </span>
      </span>
    );
  };

const ScreenCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-textPrimary">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SCREEN_DOT[gradeOfPick(data)]}`} />
      {gradeOfPick(data).toUpperCase()}
    </span>
  ) : null;

const WhyCell = ({ data }: ICellRendererParams<StockPick>) =>
  data ? (
    <span className="block text-[11px] text-textSecondary truncate" title={data.thesis}>
      {data.thesis}
    </span>
  ) : null;

/* ---- the rotation -------------------------------------------------------------- */

/** One sector on the ladder: the rank and mark, the bar as a share of the leader's screen, the direction word, the two windows. A click keeps the grid to its names. */
const SectorCard = ({ s, rank, leader, top, on, onToggle }: { s: SectorRow; rank: number; leader: boolean; top: number; on: boolean; onToggle: () => void }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={on}
    title={`${s.note} ${on ? 'Click to show every sector.' : `Click to keep the grid to ${s.sector}.`}`}
    className={`group text-left rounded-md border px-3 py-2.5 transition-colors min-w-0 ${on ? 'border-silver/60 bg-silver/[0.08]' : 'border-borderMuted bg-card hover:border-silver/40 hover:bg-silver/[0.05]'}`}
    data-stocks-sector={s.sector}
    data-on={on || undefined}
  >
    <span className="flex items-center gap-1.5 min-w-0 h-[18px]">
      <span className="font-mono text-[9px] text-textMuted tnum">{String(rank).padStart(2, '0')}</span>
      <SectorMark sector={s.sector} />
      <span className="text-[11px] font-bold text-textPrimary truncate">{SHORT_SECTOR[s.sector] ?? s.sector}</span>
    </span>
    <span className="mt-1.5 block h-[4px] rounded-full bg-ink/[0.06] overflow-hidden">
      <span className={`block h-full rounded-full ${leader ? 'bg-supreme' : PHASE_BAR[s.phase]}`} style={{ width: `${Math.round((s.score / top) * 100)}%` }} />
    </span>
    <span className={`mt-1 block h-[12px] font-mono text-[8px] uppercase tracking-widest whitespace-nowrap ${leader ? 'text-supreme' : PHASE_INK[s.phase]}`}>{leader ? 'LEADING' : PHASE_WORD[s.phase]}</span>
    <span className="mt-0.5 block h-[12px] font-mono text-[9px] tnum whitespace-nowrap">
      <span className="text-textMuted">1w </span>
      <span className={dirInk(s.rs1w)}>{signedPct(s.rs1w)}</span>
      <span className="text-textMuted"> · 1m </span>
      <span className={dirInk(s.rs1m)}>{signedPct(s.rs1m)}</span>
    </span>
  </button>
);

/* ---- the page ------------------------------------------------------------------ */

const Stocks = () => {
  const navigate = useNavigate();
  const boardNames = useBoardNames();
  const [screen, setScreen] = useState<ScreenPick>('all');
  const [sector, setSector] = useState<SectorPick>('all');
  const [names, setNames] = useState<NamesPick>('all');
  const [guideOpen, setGuideOpen] = useState(false);

  /* The board is deterministic per session day; the rotation rolls it up */
  const liveBoard = useLiveStocks();
  const picks = liveBoard.picks;
  /* no names, no rotation: with nothing landed the sector ladder was ranking empty sectors ("LEADING" on all ten) and
     the sentence called the leader — the page now says the read did not land, or that it is still reading */
  const failed = liveBoard.status === 'error' || (liveBoard.status === 'live' && picks.length === 0);
  const waiting = liveBoard.status === 'loading' && picks.length === 0;
  const quiet = failed || waiting;
  const sectors = useMemo(() => buildSectorBoard(picks), [picks]);
  const top = sectors[0];
  const bottom = sectors[sectors.length - 1];

  /* The cards cut the board; the Filter keeps from the cut */
  const cut = useMemo(() => {
    const board = new Set(boardNames);
    return picks.filter(p => (screen === 'all' || gradeOfPick(p) === screen) && (sector === 'all' || p.sector === sector) && (names === 'all' || board.has(p.ticker)));
  }, [picks, screen, sector, names, boardNames]);

  /* THE FILTER reads the names on the cut; any pick matching keeps the row. Names
     only — the sectors are the Sector card's and the rotation's (Noah, 2026-09-10:
     a Filter holding Technology contradicted every other sector he clicked) */
  const [filter, setFilter] = useState<string[]>([]);
  const filterGroups = useMemo<MultiGroup[]>(() => {
    const byName = new Map(cut.map(p => [p.ticker, p.name]));
    filter.forEach(f => {
      const key = f.replace(/^name:/, '');
      if (!byName.has(key)) byName.set(key, picks.find(p => p.ticker === key)?.name ?? key);
    });
    return [{ title: 'Names on the page', options: [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([t, n]) => ({ value: `name:${t}`, label: t, hint: n, count: cut.some(p => p.ticker === t) ? 1 : 0 })) }];
  }, [cut, filter, picks]);
  const rows = useMemo(() => {
    if (filter.length === 0) return cut;
    const on = new Set(filter);
    return cut.filter(p => on.has(`name:${p.ticker}`));
  }, [cut, filter]);

  const facts = useMemo(() => {
    const count = (g: Grade) => rows.filter(p => gradeOfPick(p) === g).length;
    const strong = count('strong');
    const good = count('good');
    const weak = count('poor');
    const scored = rows.filter(p => !p.quiet.includes('momentum'));
    const breadth = scored.length ? Math.round((scored.filter(p => p.sleeves.momentum > 50).length / scored.length) * 100) : 0;
    return { names: rows.length, strong, good, mixed: rows.length - strong - good - weak, weak, breadth };
  }, [rows]);

  /* The leader is never called a laggard in the same breath: rank and direction are different axes */
  const laggards = sectors.filter(s => s.phase === 'LAGGING' && s.score !== top.score).map(s => s.sector);
  const toggleSector = (s: Sector) => setSector(v => (v === s ? 'all' : s));

  const sentence = useMemo<ReactNode>(
    () => (
      <>
        <span className="text-supreme font-semibold">{top.sector}</span> leads the rotation, {sectors[1].sector} close behind
        {laggards.length > 0 ? (
          <>
            {' — '}
            <span className="text-bear font-semibold">{listPhrase(laggards)}</span> {laggards.length === 1 ? 'is' : 'are'} falling on both windows
          </>
        ) : (
          ' — no sector is falling on both windows'
        )}
        . <span className="text-textPrimary font-semibold">{facts.breadth}%</span> of the names here sit above their trend;{' '}
        <span className="text-bull font-semibold">{facts.strong + facts.good}</span> read good or better, <span className="text-bear font-semibold">{facts.weak}</span> poor.
      </>
    ),
    [top, sectors, laggards, facts]
  );

  const newsQuiet = picks.length > 0 && picks.every(p => p.quiet.includes('news'));

  const columnDefs = useMemo<ColDef<StockPick>[]>(() => {
    const cols: ColDef<StockPick>[] = [
      /* the fixed widths add to ~1130px so the Why column lands inside a laptop's grid instead of past its right edge */
      { headerName: 'Name', field: 'ticker', flex: 1.2, minWidth: 150, cellRenderer: NameCell, headerTooltip: 'The company — click the row to open the name’s file' },
      { headerName: 'Sector', field: 'sector', width: 150, cellRenderer: SectorCell, headerTooltip: 'The sector the name files under' },
      { headerName: 'Last', field: 'price', width: 88, cellRenderer: LastCell, type: 'rightAligned', headerTooltip: 'The last price' },
      { headerName: 'Today', field: 'changePct', width: 80, cellRenderer: TodayCell, type: 'rightAligned', headerTooltip: "Today's change" },
      { headerName: 'Year', field: 'trend', width: 92, cellRenderer: TrendCell, sortable: false, headerTooltip: 'The close a year ago, then six months, three months, a month, a week, and now. Not a daily path.' },
      { headerName: 'Trend', colId: 'momentum', valueGetter: p => p.data?.sleeves.momentum ?? 0, width: 88, cellRenderer: sleeveCell('momentum'), headerTooltip: 'RSI — above the 50 line the trend is up, below it is not. A dash is left out of the screen.' },
      { headerName: 'Numbers', colId: 'quality', valueGetter: p => p.data?.sleeves.quality ?? 0, width: 88, cellRenderer: sleeveCell('quality'), headerTooltip: 'Earnings growth over the last four quarters. Above the 50 line is growing. A dash means the feed has no growth figure.' },
      { headerName: 'Money', colId: 'flow', valueGetter: p => p.data?.sleeves.flow ?? 0, width: 88, cellRenderer: sleeveCell('flow'), headerTooltip: 'Call premium against put premium. Above the 50 line the money is buying. A dash means no premium on the feed.' },
    ];
    if (!newsQuiet) cols.push({ headerName: 'News', colId: 'news', valueGetter: p => p.data?.sleeves.news ?? 0, width: 88, cellRenderer: sleeveCell('news'), headerTooltip: "The wire's lean on the name. A dash stays out of the screen." });
    cols.push(
      { headerName: 'Screen', field: 'verdict', width: 100, cellRenderer: ScreenCell, comparator: (_a: StockVerdict, _b: StockVerdict, na, nb) => GRADE_RANK.indexOf(na.data ? gradeOfPick(na.data) : 'poor') - GRADE_RANK.indexOf(nb.data ? gradeOfPick(nb.data) : 'poor'), headerTooltip: 'The sleeves that have a number, rolled into one word. What the data says, never an instruction.' },
      { headerName: 'Why', field: 'thesis', flex: 2, minWidth: 150, cellRenderer: WhyCell, sortable: false, headerTooltip: 'What is for the name, what is against it — hover for the whole line' },
    );
    return cols;
  }, [newsQuiet]);
  const defaultColDef = useMemo<ColDef<StockPick>>(() => ({ sortable: true, resizable: true, suppressMovable: true }), []);

  /* THE CUT GLIDES IN (Noah, 2026-09-10: "clicking on any of the sectors should
     have the smooth glide animation that we have… it just appears"). The old
     page keyed its table by the filter so a swap faded up softly; the grid
     stays mounted here, so its window replays the house soft-in on every new
     cut instead — the rows land in place under it, nothing shuffles. */
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cutKey = `${screen}|${sector}|${names}|${filter.join(',')}`;
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    el.classList.remove('animate-soft-in');
    void el.offsetWidth; // the reflow that lets the animation start again
    el.classList.add('animate-soft-in');
  }, [cutKey]);

  /* A row opens the name's own page (the partner's review, 2026-09-13: "stop
     sending me to the pinpoint page") — the Map is a door on that page */
  const open = (e: RowClickedEvent<StockPick>) => {
    if (!e.data) return;
    navigate(`/dossier/stocks/${e.data.ticker}`);
  };

  return (
    <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-stocks data-screen={screen} data-sector={sector} data-rows={rows.length}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the screens" testId="stocks-guide" viewport>
        <StocksGuide />
      </GuideFocus>
      {/* THE HEAD */}
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="h-6 flex items-center gap-3">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary whitespace-nowrap">How every name screens</h3>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the sleeves, the screen and the rotation mean" testId="stocks-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
            The trend, the numbers and the money, each from the screener and rolled into one screen. The wire does not mark a lean, so news stays out · the best first · a row opens the name
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted">Names</dt>
            <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary whitespace-nowrap" data-stocks-names>
              {quiet ? '—' : <>{facts.names} <span className="text-textMuted">·</span> <span className="text-bull font-semibold">{facts.strong} strong</span> <span className="text-textMuted">·</span> <span className="text-bull">{facts.good} good</span> <span className="text-textMuted">·</span> <span className="text-warn">{facts.mixed} caution</span> <span className="text-textMuted">·</span> <span className="text-bear">{facts.weak} poor</span></>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Above their trend</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${quiet ? 'text-textMuted' : facts.breadth >= 55 ? 'text-bull' : facts.breadth <= 40 ? 'text-bear' : 'text-textPrimary'}`} data-stocks-breadth>
              {quiet ? '—' : `${facts.breadth}%`}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Leading sector</dt>
            <dd className="mt-0.5 whitespace-nowrap" data-stocks-leader>
              {quiet ? <span className="font-mono text-[12px] text-textMuted">—</span> : <button type="button" onClick={() => toggleSector(top.sector)} title={`Keep the grid to ${top.sector}`} className="font-mono text-[12px] tnum text-supreme font-semibold hover:underline underline-offset-2">
                {top.sector}
              </button>}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] text-textMuted">Trailing sector</dt>
            <dd className="mt-0.5 whitespace-nowrap" data-stocks-trailer>
              {quiet ? <span className="font-mono text-[12px] text-textMuted">—</span> : <button type="button" onClick={() => toggleSector(bottom.sector)} title={`Keep the grid to ${bottom.sector}`} className="font-mono text-[12px] tnum text-bear hover:underline underline-offset-2">
                {bottom.sector}
              </button>}
            </dd>
          </div>
        </dl>
      </div>
      {/* THE ONE LINE OF CONTROLS */}
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`} data-stocks-controls>
        <DropdownSelect label="Screen" value={screen} options={SCREEN_OPTIONS} onChange={setScreen} title="Which screens" testId="stocks-screen" />
        <DropdownSelect label="Sector" value={sector} options={SECTOR_OPTIONS} onChange={setSector} title="Which sector" testId="stocks-sector" />
        <DropdownSelect label="Names" value={names} options={NAMES_OPTIONS} onChange={setNames} title="Which companies" testId="stocks-names" />
        <DropdownMulti label="Filter" values={filter} groups={filterGroups} onChange={setFilter} title="The names on the page right now — tick any number; only those stay" testId="stocks-filter" />
      </div>
      {failed ? (
        <FeedFallback />
      ) : (
        <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary" data-stocks-sentence>
          {waiting ? 'Reading the screens.' : sentence}
        </p>
      )}
      {/* THE ROTATION */}
      <div className="px-5 pb-3 border-t border-borderSubtle/60" data-stocks-rotation>
        {/* on a phone the head stacks: the label over its words (the device sweep, 2026-10-19: on one line they ran into each other) */}
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>The rotation</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">every sector ranked by its names' screens, leader first · the two windows against the tape · click a sector to keep the grid to its names</span>
        </div>
        {/* every sector across from 1280; six on a small laptop, four on a tablet, two on a phone (the device sweep,
            2026-10-18: eleven across at 360 left a card 30px wide and cut its two windows, and at 1024 still 70px) */}
        {/* five across from a laptop up (the dossier sweep, 2026-10-22: ten across left each card ~105px, the names cut to
            "Tech…" and the 1m figure past the card's edge) — two rows of five, ranked left to right */}
        {quiet ? (
          <div className="h-[70px] flex items-center font-mono text-[10px] uppercase tracking-widest text-textMuted">{failed ? 'This read did not land' : 'Reading the screens'}</div>
        ) : (
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 lg:grid-cols-5" data-sectors={ROTATION_SECTORS}>
          {sectors.map((s, i) => (
            <SectorCard key={s.sector} s={s} rank={i + 1} leader={s.score === top.score} top={top.score} on={sector === s.sector} onToggle={() => toggleSector(s.sector)} />
          ))}
        </div>
        )}
      </div>
      {/* THE GRID — grown to its rows, the page scrolls (2026-09-11, the Compass board's rule) */}
      <div ref={gridRef} className="slayer-board border-t border-borderSubtle" data-stocks-grid>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<StockPick>
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
            overlayNoRowsTemplate={noRows(failed ? 'This read did not land' : waiting ? 'Reading the screens' : 'No name on this cut')}
            key={failed ? 'failed' : waiting ? 'waiting' : 'live'}
          />
        </AgGridProvider>
      </div>
    </div>
  );
};

export default Stocks;
