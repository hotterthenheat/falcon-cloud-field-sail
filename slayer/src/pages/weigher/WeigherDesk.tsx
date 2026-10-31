/* The Weigher desk: the chart, the live chain, the name lists and the weigh-up of one contract on one static desk,
   with the positions and watchlist under them marked at live quotes. */

import { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Maximize2, Minimize2, Plus, Scale } from 'lucide-react';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME } from '../../components/ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import ExpiryCard, { type ExpiryChoice } from '../../components/ui/ExpiryCard';
import DropdownMulti from '../../components/ui/DropdownMulti';
import CardTabs from '../../components/ui/CardTabs';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { Fact } from '../../components/trace/TraceBox';
import { WeigherGuide } from '../../components/weigher/WeigherGuide';
import { TimeframeStrip } from '../../components/gex/ChartToolbar';
import SessionBook from '../../components/ui/SessionBook';
import { chartGround, useCandleThemeKey } from '../../components/gex/candleTheme';
import { onGlide } from '../../core/glide';
import { DOCK_ROOM } from '../../data/editorDock';
import { useTicker } from '../../context/MarketDataContext';
import { snapshotOf, useBookRev } from '../../data/uwBook';
import { thetaMove, useThetaPrice } from '../../data/thetaQuote';
import { closeMoveTitle, signedPct } from '../../data/dayChange';
import { buildPrints, fmtUsd } from '../../data/gex';
import { useLevelsFor } from '../../data/levelsFor';
import { paneLevels } from '../terrain/paneLevels';
import { useLevelsScope } from '../../data/levelsScope';
import { etClock, keepTheta, keptTheta, offlineWords, useThetaDown } from '../../data/thetaFeed';
import { thetaUseHere } from '../../data/theta';
import {
  blankChain,
  dteForDate,
  listLiveExpiries,
  listedOpen,
  loadLiveChain,
  attachHistory,
  attachPrior,
  attachSession,
  refreshLiveChain,
  keepSlow,
  optionsOpen,
  readLegs,
  exitPrice,
  type DeskChain,
  type DeskContract,
  type ListedExpiry,
  type ScanPreset,
  type ScanRow,
} from '../../data/weigherDesk';
import { scoreLiveContract, type LiveScore } from '../../data/compassModel';
import { pricerFor, yearFracLeft } from '../../data/weigherGate';
import { printOf } from '../../data/compassParams';
import { paintLive, useWeigherContract, useWeigherSpot, useWeigherTape } from '../../data/weigherTape';
import { useDeskSession, sessionMeta, sessionOfMinute } from '../../data/deskSession';
import { nyMinutes } from '../../core/nyTime';
import { expiryFor, isTradingDay, isoDate, today, MONTHS } from '../../core/calendar';
import { addToWatchlist, closeWatched, hasOpenWatched, removeWatched, restampWatch, tickWatchlist, useWatchlist, watchedFor } from '../../data/watchlist';
import type { WatchedContract } from '../../types/watchlist';
import { costOf } from '../../data/positionCurve';
import { removePosition, useAllPositions } from '../../data/positions';
import { buildBook } from '../../data/bookAtStrike';
import BookBlock from '../../components/weigher/BookBlock';
import StrikeCase from '../../components/weigher/StrikeCase';
import PositionForm from '../../components/gex/PositionForm';
import PositionDeskCard, { CARD_VIEWS, type CardView } from '../../components/weigher/PositionDeskCard';
import { monthDay, ListGrid, type ListRow } from '../../components/weigher/PositionsList';
import { buildExposureProfile } from '../../data/exposure';
import type { ExposureProfileData } from '../../types/gex';
import { useScreenerQuotes, peekBatchQuote } from '../../data/liveFiles';
import { useTopNet } from '../../data/traceLive';
import { useIsBelowXl, useIsPhone, useIsPortraitDesk } from '../../components/ui/useMediaQuery';
import { DESK_TOP_DEFAULT, clampDeskTop, deskRows, readDeskTop, saveDeskTop } from './deskSplit';
import { readDeskPrefs } from '../../data/deskPrefs';
import StrikeChart, {
  CHART_STYLES,
  DEFAULT_INDICATORS,
  DEFAULT_OVERLAYS,
  type ChartIndicators,
  type ChartOverlays,
  type ChartStyle,
} from '../../components/gex/StrikeChart';
import ChartToolbar from '../../components/gex/ChartToolbar';
import TickerQuickPick from '../../components/gex/TickerQuickPick';
import { ChartSkeleton, Deferred } from '../../components/ui/Skeleton';
import SpotPrice from '../../components/gex/SpotPrice';
import ContractPremiumPane from '../../components/gex/ContractPremiumPane';
import { useFadeClose } from '../../components/ui/useFadeClose';
import { fmtStrike, CHAIN_COLUMNS, DEFAULT_COLS, COLUMN_GROUPS, ChainCard } from '../../components/weigher/ChainGrid';
import { TIMEFRAMES, type Timeframe } from '../../data/timeframe';
import type { OptionRight } from '../../types/compass';
const STAMP_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', second: '2-digit' });

/* Still v2 on purpose: the desk went static and the stored `layout` field simply stopped being read — but the
   tickers, columns, depth and every other choice in the same record survive the change untouched. */
const DESK_KEY = 'slayer_weigher_desk_v2';

/** The heavy tables' sweep cadence — the chain and scanner rebuild on this
    clock and hold still in between, the Pulse contract. Charts and prices
    stay on the 1s tick. */
const SCAN_MS = 3000;
/* The light tick's beat with no simulator behind it: the live chain refreshes on its own timer. */
const PUMP_MS = 3000;

/** How far the chain reaches each side of spot. The book maintains ~30; the ladder synthesizes honest wings beyond
    it (see buildDeskChain). The second ask was a migration bug wearing a feature-request coat: his stored depth
    (30) was still on the previous list, so it validated and never fell forward. */
/** Listed strikes each side of the price. Not the Compass span. */
const DESK_DEPTHS = [12, 20, 40] as const;
/* The chain head's room, in px of card. One row where the four cards fit; otherwise they drop to their own row. */
const CHAIN_ONE_ROW_PX = 790;
const CHAIN_NAMED_ROW_PX = 610;
const SIDE_OPTIONS: DropdownOption<OptionRight>[] = [
  { value: 'C', label: 'Calls', hint: 'The right to buy', tone: 'bull' },
  { value: 'P', label: 'Puts', hint: 'The right to sell', tone: 'bear' },
];
const REACH_OPTIONS: DropdownOption<number>[] = [
  { value: 12, label: '±12', hint: 'Up to twelve listed strikes each side of the price. Fewer if that chain lists fewer.' },
  { value: 20, label: '±20', hint: 'Up to twenty listed strikes each side of the price. Fewer if that chain lists fewer.' },
  { value: 40, label: '±40', hint: 'Up to forty listed strikes each side of the price. Fewer if that chain lists fewer.' },
];
/** What the desk's list card lists: THE WATCHLIST first, then the scanner's three cuts. The card opens on the
    watchlist whenever anything is watched. */
type ListKind = ScanPreset | 'watchlist';
/** Which of the bottom row's three cards stand folded to their heads (kept in `slayer_weigher_folds`):
    Your positions · the Watchlist · The position */
type Folds = { positions: boolean; watchlist: boolean; position: boolean };
const KIND_OPTIONS: DropdownOption<ListKind>[] = [
  { value: 'watchlist', label: 'Watchlist', hint: 'The contracts you watch — marked when added, tracked as if bought' },
  { value: 'gainers', label: 'Gainers today', hint: 'The largest gains this session first', tone: 'bull' },
  { value: 'losers', label: 'Losers today', hint: 'The largest losses this session first', tone: 'bear' },
  { value: 'voliv', label: 'Top net premium', hint: 'The names with the most net option premium today, either way' },
];
/** Names the gainers and losers are read from. The price and the day's change are the screener's. */
const SCAN_NAMES = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'AMD', 'AVGO', 'GOOGL', 'NFLX', 'MU', 'INTC', 'AMAT', 'ARM', 'SMCI', 'PLTR', 'HOOD', 'COIN', 'ORCL', 'CRM', 'UBER', 'BA', 'JPM', 'XLF', 'GLD', 'TLT', 'SMH'];
const fmtDay = (d: Date) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
const marketClosedToday = () => !isTradingDay(today());

interface DeskState {
  ticker: string;
  dte: number;
  /** Option symbol for this expiration. Empty until the listed chain says which root. */
  optRoot: string;
  lens: 'stock' | 'contract';
  right: OptionRight;
  preset: ListKind;
  depth: number;
  /** Which catalog columns the chain shows, in catalog order */
  cols: string[];
  /** The chart's own settings, kept with the desk: absent until the reader changes one */
  chart?: DeskChart;
}
interface DeskChart {
  timeframe?: Timeframe;
  overlays?: Partial<ChartOverlays>;
  style?: ChartStyle;
  indicators?: Partial<ChartIndicators>;
}
/** A stored chart, kept to what the chart still knows: a known timeframe and style, and only the switches it has */
function chartOf(raw: unknown): DeskChart | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  const flags = <T extends object>(v: unknown, keys: T): Partial<T> => {
    const out: Record<string, boolean> = {};
    if (v && typeof v === 'object') for (const k of Object.keys(keys)) if (typeof (v as Record<string, unknown>)[k] === 'boolean') out[k] = (v as Record<string, boolean>)[k];
    return out as Partial<T>;
  };
  return {
    timeframe: TIMEFRAMES.some(t => t.value === c.timeframe) ? (c.timeframe as Timeframe) : undefined,
    style: CHART_STYLES.some(t => t.value === c.style) ? (c.style as ChartStyle) : undefined,
    overlays: flags(c.overlays, DEFAULT_OVERLAYS),
    indicators: flags(c.indicators, DEFAULT_INDICATORS),
  };
}

/* An old record may still carry `layout`/`rowsV`/`colsV` from the movable
   era — parsed and ignored here, and the next save sheds them for good. */
function loadDesk(): DeskState {
  const def: DeskState = { ticker: 'SPY', dte: 0, optRoot: '', lens: 'stock', right: 'C', preset: 'watchlist', depth: 20, cols: DEFAULT_COLS };
  /* the list card opens on the watchlist whenever anything is watched — Robinhood's list is
     always the first thing on the page; the reader's cut holds for the session after that */
  const opensOnList = (d: DeskState): DeskState => (hasOpenWatched() ? { ...d, preset: 'watchlist' } : d);
  try {
    const raw = localStorage.getItem(DESK_KEY);
    if (!raw) return def;
    const c = JSON.parse(raw) as Partial<DeskState>;
    // Stored columns keep only keys the catalog still knows, in its order;
    // an empty or unknown set falls back to the default chain.
    const storedCols = Array.isArray(c.cols) ? (c.cols as string[]) : null;
    const cols = storedCols ? CHAIN_COLUMNS.map(x => x.key).filter(k => storedCols.includes(k)) : [];
    return opensOnList({
      ticker: typeof c.ticker === 'string' && c.ticker ? c.ticker : def.ticker,
      /* any horizon inside ninety days — a contract's own expiry, carried in by a deep link, is kept across a
         refresh */
      dte: typeof c.dte === 'number' && Number.isInteger(c.dte) && c.dte >= 0 && c.dte <= 90 ? c.dte : def.dte,
      optRoot: typeof c.optRoot === 'string' ? c.optRoot.trim().toUpperCase() : '',
      lens: c.lens === 'contract' ? 'contract' : 'stock',
      right: c.right === 'P' ? 'P' : 'C',
      preset: c.preset === 'losers' || c.preset === 'voliv' || c.preset === 'gainers' || c.preset === 'watchlist' ? c.preset : def.preset,
      depth: typeof c.depth === 'number' && (DESK_DEPTHS as readonly number[]).includes(c.depth) ? c.depth : 20,
      cols: cols.length ? cols : [...def.cols],
      chart: chartOf(c.chart),
    });
  } catch {
    return def;
  }
}

/* The card shell: the cards keep their translucent fill from the wash days, but not the backdrop blur: with the
   wash gone there is nothing under a card but the shell's flat canvas, and a backdrop-filter over a flat ground is
   a compositing cost that paints nothing. */
/* The card is a PANEL: the 55% near-black wash it wore read as the same panel on the dark canvas and as a mid-grey
   slab on the light one */
const DeskCard = ({
  title,
  actions,
  under,
  children,
  fold,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  /** A second head row, under the title's (the chain's cards when the card is too narrow for one line — see
      `CHAIN_ONE_ROW_PX`): one block with the first, so the rule between the head and the body moves under it */
  under?: React.ReactNode;
  children: React.ReactNode;
  /** A card that folds to its head: the chevron beside the title. The two list cards fold through their column's
      rows (the cell shrinks, the card is clipped); a card that folds ITSELF (`self` — the position card, whose row
      is as tall as it is) glides its body from its height to nothing and stands at its own height. */
  fold?: { open: boolean; onToggle: () => void; testId?: string; self?: boolean };
}) => (
  /* a card that folds itself stands at its own height only while FOLDED; open, it fills its cell like the others */
  <div className={`${fold?.self && !fold.open ? '' : 'h-full '}flex flex-col overflow-hidden rounded-md border border-ink/[0.07] bg-panel`} data-folded={fold && !fold.open ? '' : undefined}>
    {/* min-h, not h: a crowded actions strip (the chain's) wraps, and the
        header must GROW with it — with a fixed height the wrapped chips
        slid under the table and its sticky header ate their clicks. */}
    {/* ON A TOUCH SCREEN the head is 44 tall (the last-targets pass, 2026-10-30): its small controls' finger boxes
        (`.hit-24`, 44 × 44 there) fit inside the card, which clips, instead of being cut by its edge or covered by
        the table's header under it. */}
    <div className={`shrink-0 flex items-center gap-2 pr-2.5 py-0.5 min-h-8 [@media(pointer:coarse)]:min-h-11 ${under ? '' : 'border-b border-ink/[0.05]'}`}>
      {/* The title takes its NATURAL width and keeps it — flex-1 here let the chain's loaded strip squeeze it down
          to "C…". The actions take the remainder and wrap; the header grows to fit them. */}
      {/* gap-4 on a touch screen: the chevron's finger box reaches 22px from its centre, past a title that is tabs */}
      <div className="select-none flex items-center gap-2 [@media(pointer:coarse)]:gap-4 pl-2.5 self-stretch shrink-0">
        {fold && (
          <button
            type="button"
            onClick={fold.onToggle}
            aria-expanded={fold.open}
            title={fold.open ? 'Fold the card to its head' : 'Open the card'}
            /* -ml-1 at a desk; on a touch screen 4px in, so the 44px box stands inside the card's clipped edge */
            className="hit-24 inline-flex items-center justify-center w-4 h-4 -ml-1 [@media(pointer:coarse)]:ml-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors"
            data-fold={fold.testId}
          >
            <ChevronDown className={`w-3 h-3 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${fold.open ? '' : '-rotate-90'}`} />
          </button>
        )}
        {title && (
          <span className="font-mono text-t10 font-semibold uppercase tracking-widest text-textPrimary whitespace-nowrap">{title}</span>
        )}
      </div>
      {/* NO overflow-x-auto here: overflow-x forces overflow-y clipping too, and it cut the chain's ticker
          dropdown to a 26px sliver below the header. Wide strips wrap instead; the header grows. */}
      {actions && (
        <span className="ml-auto flex flex-1 flex-wrap items-center justify-end gap-1.5 min-w-0">{actions}</span>
      )}
    </div>
    {under && (
      <div className="shrink-0 flex flex-wrap items-center gap-1.5 px-2.5 pb-1.5 border-b border-ink/[0.05]" data-card-under>
        {under}
      </div>
    )}
    {fold?.self ? (
      /* the body on one grid row, 1fr open and 0fr folded — the same glide the left column's rows
         ride; the content stays mounted (the chart, the ruler, the tab keep their state) and is
         clipped while folded */
      <div className="flex-grow min-h-0 grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ gridTemplateRows: fold.open ? '1fr' : '0fr' }} data-fold-body>
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    ) : (
      <div className="flex-grow min-h-0">{children}</div>
    )}
  </div>
);

/* ---- the chain card -------------------------------------------------------- */
/* ---- the scanner as a grid -------------------------------------------------- */
const SCAN_THEME = GRID_THEME.withParams({ rowHeight: 34, headerHeight: 28, fontSize: 11 });
const SCAN_COL: ColDef<ScanRow> = { sortable: false, resizable: false, suppressMovable: true };
const SCAN_EMPTY: Record<ScanPreset, string> = { gainers: 'No names up today', losers: 'No names down today', voliv: 'Nothing on the tape' };

const ScanGrid = memo(function ScanGrid({ rows, ticker, preset, onPick, waiting }: { rows: ScanRow[]; ticker: string; preset: ScanPreset; onPick: (t: string) => void; waiting?: boolean }) {
  const gridRef = useRef<AgGridReact<ScanRow>>(null);
  const columnDefs = useMemo<ColDef<ScanRow>[]>(
    () => [
      {
        colId: 'ticker',
        headerName: 'Name',
        flex: 1.3,
        minWidth: 110,
        cellRenderer: ({ data }: ICellRendererParams<ScanRow>) =>
          data ? (
            <span className="inline-flex items-center gap-2">
              <CompanyLogo ticker={data.ticker} size={16} />
              <span className="font-mono text-[11px] font-semibold text-textPrimary" data-scan-name>
                {data.ticker}
              </span>
            </span>
          ) : null,
      },
      { colId: 'last', headerName: 'Last', width: 88, type: 'rightAligned', cellRenderer: ({ data }: ICellRendererParams<ScanRow>) => (data && data.last > 0 ? <span className="font-mono text-[11px] tnum text-textPrimary">${data.last.toFixed(2)}</span> : <span className="font-mono text-t10 text-textMuted">—</span>) },
      {
        colId: 'change',
        headerName: 'Change',
        width: 88,
        type: 'rightAligned',
        cellRenderer: ({ data }: ICellRendererParams<ScanRow>) =>
          data && Number.isFinite(data.changePct) ? (
            <span className={`font-mono text-[11px] font-semibold tnum ${data.changePct >= 0 ? 'text-bull' : 'text-bear'}`}>
              {data.changePct >= 0 ? '+' : ''}
              {data.changePct.toFixed(2)}%
            </span>
          ) : (
            <span className="font-mono text-t10 text-textMuted">—</span>
          ),
      },
      { colId: 'net', headerName: 'Net prem', width: 96, type: 'rightAligned', headerTooltip: 'Net option premium today: bought at the ask less sold at the bid', cellRenderer: ({ data }: ICellRendererParams<ScanRow>) => (data && Number.isFinite(data.netPremium) ? <span className={`font-mono text-t10 tnum ${data.netPremium >= 0 ? 'text-bull' : 'text-bear'}`}>{fmtUsd(data.netPremium)}</span> : <span className="font-mono text-t10 text-textMuted">—</span>) },
    ],
    []
  );
  /* The desk's name wears the house selection — synced once the grid has
     its rows (the first effect fires before the grid exists) */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const api = gridRef.current?.api;
    if (!api || !ready) return;
    api.forEachNode(n => {
      const on = n.data?.ticker === ticker;
      if (n.isSelected() !== on) n.setSelected(on);
    });
  }, [ticker, rows, ready]);
  return (
    <div className="slayer-board h-full" data-scan-grid={preset}>
      <AgGridProvider modules={GRID_MODULES}>
        <AgGridReact<ScanRow>
          ref={gridRef}
          theme={SCAN_THEME}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={SCAN_COL}
          getRowId={p => p.data.ticker}
          onRowClicked={(e: RowClickedEvent<ScanRow>) => e.data && onPick(e.data.ticker)}
          rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: false }}
          suppressCellFocus
          animateRows={false}
          onFirstDataRendered={() => setReady(true)}
          tooltipShowDelay={350}
          overlayNoRowsTemplate={`<span class="font-mono text-t10 uppercase tracking-widest text-textMuted">${waiting ? 'Reading the session' : SCAN_EMPTY[preset]}</span>`}
        />
      </AgGridProvider>
    </div>
  );
});

/** One chain row, with the spot rule under it when it brackets the market. Clicking it puts the strike on the scale
    - the Strike card carries the weigh-up now, so the ladder itself stays clean. */
/* The contract capsule's OWN menu - in the contract lens the capsule's job is stepping between CONTRACTS, so its
   door lists the chain's strikes, opened with the one on the scale centred. The ticker door still lives where
   tickers are the subject: the stock lens and the chain header. */
const StrikePickInner = ({
  label,
  contracts,
  sel,
  onPick,
}: {
  label: string;
  contracts: DeskContract[];
  sel: number | null;
  onPick: (strike: number) => void;
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Window-capture Escape - the TickerQuickPick contract: the innermost
    // open thing gets the key and nothing behind it sees it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // The menu opens with the selection in the MIDDLE - stepping strikes
  // should feel like nudging a dial, not re-finding your place in a list.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
    });
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        title="Switch strike"
        className="inline-flex items-center justify-between gap-2 h-7 min-w-[112px] px-3 rounded-full bg-ink/[0.06] hover:bg-ink/[0.10] font-mono text-[11px] font-bold text-textPrimary transition-colors"
      >
        {label}
        <ChevronDown className={`w-3 h-3 text-textSecondary transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-52 border border-borderMuted bg-panel rounded-md shadow-2xl shadow-black/60 overflow-hidden animate-slide-in">
          <div className="px-3 py-1.5 border-b border-borderSubtle flex items-center justify-between font-mono text-t9 font-semibold uppercase tracking-widest text-textMuted select-none">
            <span>Strike</span>
            <span>Mark</span>
          </div>
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {[...contracts].reverse().map(c => {
              const active = sel != null && Math.abs(c.strike - sel) < 1e-9;
              return (
                <button
                  key={c.strike}
                  aria-selected={active}
                  onClick={() => {
                    setOpen(false);
                    onPick(c.strike);
                  }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-1 font-mono text-[11px] tnum transition-colors ${
                    active ? 'bg-silver/[0.08] text-silver font-bold' : 'text-textPrimary hover:bg-ink/[0.04]'
                  }`}
                >
                  <span>{fmtStrike(c.strike)}</span>
                  <span className={active ? '' : 'text-textSecondary'}>${c.mark.toFixed(2)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* The picker lists 301 strikes while open; memoised so a light tick does not
   re-render the whole list under the pointer. Its props are stable: the
   side's contracts are memoised on the desk, onPick is the setter itself. */
const StrikePick = memo(StrikePickInner);

/* The desk's clock, kept in a leaf so the desk renders once per applied tick: a beat every few seconds, and
   again whenever the live vendor book lands or refreshes. */
const TickPump = memo(function TickPump({ onTick }: { onTick: () => void }) {
  const rev = useBookRev();
  useEffect(() => {
    onTick();
  }, [rev, onTick]);
  useEffect(() => {
    const id = window.setInterval(onTick, PUMP_MS);
    return () => window.clearInterval(id);
  }, [onTick]);
  return null;
});

/* The rail's subject is the app's name. This leaf follows it in — on arrival
   the desk takes the rail's name over its own saved one, and a rail or palette
   pick moves it after — and pushes a name picked on the desk itself out, without
   the desk subscribing to the market tick (that would repaint the chain every
   snapshot). */
const ShellFollow = memo(function ShellFollow({ ticker, onExternal }: { ticker: string; onExternal: (t: string) => void }) {
  const { activeTicker, changeTicker } = useTicker();
  const echo = useRef(false);
  const activeRef = useRef(activeTicker);
  activeRef.current = activeTicker;
  const externalRef = useRef(onExternal);
  externalRef.current = onExternal;
  /* the desk's name as last seen: only a name the desk moved to goes out — the saved one it opened on does not */
  const seenRef = useRef(ticker);
  useEffect(() => {
    if (seenRef.current === ticker) return;
    seenRef.current = ticker;
    if (activeRef.current === ticker) return;
    echo.current = true;
    changeTicker(ticker);
  }, [ticker, changeTicker]);
  useEffect(() => {
    if (echo.current) {
      echo.current = false;
      return;
    }
    if (activeTicker === ticker) return;
    externalRef.current(activeTicker);
  }, [activeTicker, ticker]);
  return null;
});

/* ---- the desk -------------------------------------------------------------- */
/** What a deep link may carry: a name alone (Trace's "Weigh it"), or THE contract — the Record's busiest rows: the
    side and the expiry DATE pick the chain, the strike picks the row */
export interface WeighRequest {
  ticker: string;
  strike?: number;
  right?: 'C' | 'P';
  expiry?: string;
}

const WeigherDesk = ({ incoming }: { incoming?: WeighRequest | null }) => {
  /* Two tiers: the light tick feeds the cheap readouts (prices, mood, bar appends); the scan tick, every few seconds, the heavy rebuilds
     (the 301-strike chain, the scanner). */
  const [tick, setTick] = useState(0);
  const [scanTick, setScanTick] = useState(0);
  const lastScanRef = useRef(0);
  /* The chart's chrome wears the ground of the tape's theme (the store's, on this desk — index.css re-scopes the
     strip's tokens under the stamp) */
  const chartThemeKey = useCandleThemeKey();
  /* Both tiers publish as transitions: the scan rebuild is a 54–103 ms render, and as a transition React lets a click land first. */
  const applyTick = useCallback(() => {
    const now = Date.now();
    const sweep = now - lastScanRef.current >= SCAN_MS;
    if (sweep) lastScanRef.current = now;
    startTransition(() => setTick(t => t + 1));
    /* The scan lands a frame after the light tick, never in the same commit (together they were one 87 ms task). */
    if (sweep) window.setTimeout(() => startTransition(() => setScanTick(t => t + 1)), 32);
  }, []);
  /* No tick under the hand: while a pointer is down, ticks are stashed and the newest applied on release (they were 51 and 85 ms tasks mid-drag). */
  const pointerDownRef = useRef(false);
  const pendingTickRef = useRef(false);
  const onTick = useCallback(() => {
    if (pointerDownRef.current) {
      pendingTickRef.current = true;
      return;
    }
    applyTick();
  }, [applyTick]);
  useEffect(() => {
    const down = () => {
      pointerDownRef.current = true;
    };
    const up = () => {
      if (!pointerDownRef.current) return;
      pointerDownRef.current = false;
      if (pendingTickRef.current) {
        pendingTickRef.current = false;
        applyTick();
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, [applyTick]);

  const [desk, setDesk] = useState<DeskState>(loadDesk);
  const isPhone = useIsPhone();
  const [sel, setSel] = useState<number | null>(null);
  /* opens on the desk's timeframe when the reader set one (Settings › The desk) */
  /* the chart's settings, as the reader left them on this desk (DESK_KEY) */
  const [timeframe, setTimeframe] = useState<Timeframe>(() => desk.chart?.timeframe ?? readDeskPrefs().opensOn.timeframe ?? '1m');
  const [overlays, setOverlays] = useState<ChartOverlays>(() => ({ ...DEFAULT_OVERLAYS, ...desk.chart?.overlays }));
  const [chartStyle, setChartStyle] = useState<ChartStyle>(() => desk.chart?.style ?? 'candles');
  const [indicators, setIndicators] = useState<ChartIndicators>(() => ({ ...DEFAULT_INDICATORS, ...desk.chart?.indicators }));
  /* what the chart opened on is not a choice: a desk that never changed its chart keeps following Settings › The desk */
  const chartOpened = useRef<string | null>(null);
  useEffect(() => {
    const chart: DeskChart = { timeframe, overlays, style: chartStyle, indicators };
    const key = JSON.stringify(chart);
    chartOpened.current ??= key;
    if (key === chartOpened.current && !desk.chart) return;
    setDesk(d => (JSON.stringify(d.chart) === key ? d : { ...d, chart }));
  }, [timeframe, overlays, chartStyle, indicators]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      localStorage.setItem(DESK_KEY, JSON.stringify(desk));
    } catch {
      /* storage can be full or off — never fatal */
    }
  }, [desk]);

  const { ticker, dte, optRoot, lens, right, preset, depth, cols } = desk;
  const patch = (p: Partial<DeskState>) => setDesk(d => ({ ...d, ...p }));

  /* The market's own session now: closed on a weekend or holiday, else the clock's window */
  const session = useMemo(() => (marketClosedToday() ? 'closed' : sessionOfMinute(nyMinutes())), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chain, setChain] = useState<DeskChain>(() => blankChain(ticker, dte));
  const [listed, setListed] = useState<{ rows: ListedExpiry[]; down: boolean; takenAt?: number } | null>(null);
  const [chainWait, setChainWait] = useState(true);
  const loadedKey = useRef('');
  const [liveScore, setLiveScore] = useState<LiveScore | null>(null);
  const quoteFor = (strike: number, leg: 'C' | 'P', expiry: string) => {
    if (!chain.expiryIso || chain.expiryIso !== expiry || chain.source !== 'live') return { listed: false, low: null, high: null };
    const row = chain.rows.find(r => Math.abs(r.strike - strike) < 1e-6);
    if (!row) return { listed: false, low: null, high: null };
    const c = leg === 'C' ? row.call : row.put;
    const low = c.low > 0 && c.high >= c.low ? c.low : null;
    const high = c.low > 0 && c.high >= c.low ? c.high : null;
    /* A 0 bid is not a price paid. The mid of a 0 bid must not be stamped. */
    const mark = c.bid > 0 && c.mark > 0 ? c.mark : null;
    return { listed: true, low, high, mark };
  };
  /* The terminal coming back re-lists and re-reads what it could not */
  const thetaOff = useThetaDown();
  useEffect(() => {
    if (thetaUseHere() !== 'all') return;
    let dead = false;
    setListed(prev => (prev && !prev.down ? prev : null));
    listLiveExpiries(ticker).then(rows => {
      if (!dead) setListed(rows);
    });
    return () => {
      dead = true;
    };
  }, [ticker, thetaOff]);
  /* The list is fetched with the name. When the clock crosses that root's stop, drop the same-day row without
     reloading every expiry. The chain effect then leaves a finished 0DTE. */
  useEffect(() => {
    setListed(prev => {
      if (!prev) return prev;
      const rows = listedOpen(prev.rows);
      if (rows === prev.rows) return prev;
      return { ...prev, rows };
    });
  }, [tick]);
  /* a new name starts from an empty chain, never the last name's */
  useEffect(() => {
    setListed(null);
    setChainWait(true);
    loadedKey.current = '';
    setChain(blankChain(ticker, dte));
    /* the chain this browser kept for the desk's own expiry paints while the expiries are read */
    let dead = false;
    void keptTheta<DeskChain>(`chain:${ticker}|${optRoot || ticker}|${isoDate(expiryFor(dte).date)}`).then(kept => {
      if (dead || !kept || !Array.isArray(kept.data?.rows) || !kept.data.rows.length) return;
      setChain(prev => (prev.rows.length || prev.ticker !== kept.data.ticker ? prev : { ...kept.data, takenAt: kept.at, kept: true }));
      setChainWait(false);
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);
  useEffect(() => {
    if (listed === null) return;
    if (!listed.rows.length) {
      setChain({ ...blankChain(ticker, dte), source: 'live', rows: [], offline: listed.down });
      setChainWait(false);
      return;
    }
    const row = listed.rows.find(e => e.dte === dte && (!optRoot || e.root === optRoot)) ?? listed.rows.find(e => e.dte === dte);
    if (!optRoot) {
      const front = listed.rows.find(e => e.weekday === 0) ?? listed.rows[0];
      patch({ dte: front.dte, optRoot: front.root });
      return;
    }
    if (!row) {
      const next = listed.rows.find(e => e.weekday === 0) ?? listed.rows[0];
      patch({ dte: next.dte, optRoot: next.root });
      return;
    }
    if (optRoot !== row.root) {
      patch({ optRoot: row.root });
      return;
    }
    const root = row.root || ticker;
    const key = `${ticker}|${dte}|${root}|${depth}`;
    const keptKey = `chain:${ticker}|${root}|${row.iso}`;
    const quiet = loadedKey.current === key;
    let dead = false;
    if (!quiet) {
      setChainWait(true);
      setChain({ ...blankChain(ticker, dte), source: 'live', rows: [], optRoot: root });
      /* the chain this browser kept paints first, stamped, until the terminal answers */
      void keptTheta<DeskChain>(keptKey).then(kept => {
        if (dead || !kept || !Array.isArray(kept.data?.rows) || !kept.data.rows.length) return;
        setChain(prev => (prev.rows.length ? prev : { ...kept.data, takenAt: kept.at, kept: true, offline: thetaOff }));
        setChainWait(false);
      });
    }
    const range = Math.min(40, Math.max(12, depth));
    const applySlow = (slow: DeskChain) => {
      if (dead || loadedKey.current !== key) return;
      setChain(prev => (prev.ticker === slow.ticker && prev.expiryIso === slow.expiryIso && prev.optRoot === slow.optRoot ? keepSlow(prev, slow) : prev));
    };
    loadLiveChain(ticker, dte, range, root).then(next => {
      if (dead) return;
      setChainWait(false);
      if (next.offline) {
        /* the terminal did not answer: whatever is on screen stays, marked offline */
        setChain(prev => (prev.rows.length ? { ...prev, offline: true } : { ...next }));
        return;
      }
      loadedKey.current = key;
      setChain({ ...next, takenAt: Date.now() });
      if (!next.rows.length) return;
      attachSession(next).then(applySlow);
      attachHistory(next).then(slow => {
        applySlow(slow);
        const painted = slow.rows.some(r => Number.isFinite(r.call.prevClose) || Number.isFinite(r.put.prevClose));
        if (painted || dead) return;
        window.setTimeout(() => {
          if (dead || loadedKey.current !== key) return;
          attachHistory(next).then(applySlow);
        }, 2000);
      });
      attachPrior(next).then(applySlow);
    });
    return () => {
      dead = true;
    };
    // patch only writes state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, dte, optRoot, depth, listed]);
  const chainRef = useRef(chain);
  chainRef.current = chain;
  /* the live chain, with its slow fields, is kept for the next visit at most every 10 s */
  const keepTimer = useRef(0);
  const keptAt = useRef({ key: '', at: 0 });
  useEffect(() => {
    if (chain.source !== 'live' || chain.offline || chain.kept || !chain.rows.length || !chain.expiryIso || keepTimer.current) return;
    const key = `chain:${chain.ticker}|${chain.optRoot || chain.ticker}|${chain.expiryIso}`;
    if (keptAt.current.key === key && Date.now() - keptAt.current.at < 30_000) return;
    /* a few seconds after a live read, so the session's volume and yesterday's close are on it */
    keepTimer.current = window.setTimeout(() => {
      keepTimer.current = 0;
      const c = chainRef.current;
      const at = `chain:${c.ticker}|${c.optRoot || c.ticker}|${c.expiryIso}`;
      if (c.source !== 'live' || c.offline || c.kept || !c.rows.length || at !== key) return;
      keptAt.current = { key, at: Date.now() };
      keepTheta(key, c);
    }, 4_000);
  }, [chain]);
  useEffect(() => () => window.clearTimeout(keepTimer.current), []);
  /* A new NBBO every second while the options trade and the tab is in view; once a minute outside the session */
  useEffect(() => {
    let dead = false;
    let n = 0;
    let lastAt = 0;
    const busy = { current: false };
    const id = window.setInterval(() => {
      const cur = chainRef.current;
      const wantIso = isoDate(expiryFor(dte).date);
      const wantRoot = optRoot || cur.optRoot || ticker;
      /* nothing while the tab is hidden, or while this room is kept behind a page that reads Unusual Whales */
      if (dead || busy.current || cur.source !== 'live' || !cur.rows.length || document.visibilityState === 'hidden' || thetaUseHere() !== 'all') return;
      if (cur.ticker !== ticker || cur.expiryIso !== wantIso) return;
      if (cur.optRoot && cur.optRoot !== wantRoot) return;
      if (Date.now() - lastAt < (optionsOpen() ? 1000 : 60_000)) return;
      lastAt = Date.now();
      busy.current = true;
      n += 1;
      const range = Math.min(40, Math.max(12, depth));
      const pass = n;
      refreshLiveChain(cur, range)
        .then(next => {
          if (dead) return null;
          if (next === 'offline') {
            setChain(prev => (prev.offline ? prev : { ...prev, offline: true }));
            return null;
          }
          if (!next || next.ticker !== ticker || next.expiryIso !== wantIso || (next.optRoot && next.optRoot !== wantRoot)) return null;
          setChain(prev => (prev.ticker === ticker && prev.expiryIso === wantIso && (!prev.optRoot || prev.optRoot === wantRoot) ? { ...keepSlow(next, prev), takenAt: Date.now(), offline: false } : prev));
          if (pass % 4 !== 0 && !cur.offline) return null;
          return attachSession(next);
        })
        .then(slow => {
          if (!slow || dead) return;
          setChain(prev => (prev.ticker === slow.ticker && prev.expiryIso === slow.expiryIso && prev.optRoot === slow.optRoot ? keepSlow(prev, slow) : prev));
        })
        .finally(() => {
          busy.current = false;
        });
    }, 1000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [ticker, dte, optRoot, depth]);
  const topNet = useTopNet(30);
  const quoteNames = useMemo(() => {
    if (preset === 'watchlist') return [] as string[];
    const extra = topNet.rows.map(r => r.ticker).filter(Boolean);
    return [...new Set([...SCAN_NAMES, ...extra])];
  }, [preset, topNet.rows]);
  const scanQuotes = useScreenerQuotes(quoteNames);
  const scan = useMemo(() => {
    if (preset === 'watchlist') return [];
    if (preset === 'voliv') {
      return topNet.rows
        .filter(r => r.ticker && Number.isFinite(r.net) && r.net !== 0)
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
        .slice(0, 24)
        .map(r => {
          const q = peekBatchQuote(r.ticker);
          return { ticker: r.ticker, last: q?.price ?? 0, changePct: q?.pct ?? Number.NaN, netPremium: r.net };
        });
    }
    const rows: ScanRow[] = [];
    for (const name of SCAN_NAMES) {
      const q = peekBatchQuote(name);
      if (!q || q.pct == null || !(q.price > 0)) continue;
      rows.push({ ticker: name, last: q.price, changePct: q.pct, netPremium: Number.NaN });
    }
    rows.sort((a, b) => (preset === 'losers' ? a.changePct - b.changePct : b.changePct - a.changePct));
    return rows;
  }, [preset, scanQuotes.rev, topNet.rows]);
  /* The walls, flip and supreme are the house's (data/levelsFor.ts), the same as Pinpoint's and the Terrain's */
  const house = useLevelsFor(ticker, useLevelsScope());
  const levels = useMemo(() => paneLevels(house?.spot ?? null, house), [house]);
  const under = printOf(ticker);
  const bookSession = useDeskSession();
  const tape = useWeigherSpot(under);
  const weighed = useWeigherTape(under, timeframe, bookSession);
  const liveSpot = chain.source === 'live' && chain.spot > 0 ? chain.spot : tape && tape.spot > 0 ? tape.spot : 0;
  /* The header speaks the app's one convention (data/dayChange.ts moveOffCloses), as the rail does: the last trade, the
     day's change of the regular session, and outside it the extended move apart. The chain keeps its own quoted spot. */
  const { held: headHeld } = useThetaPrice(under);
  const headMove = thetaMove(headHeld?.value);
  const headSpot = headHeld && headHeld.value.price > 0 ? headHeld.value.price : liveSpot;
  const dayPct = headMove ? headMove.pct : null;
  const chartTape = useMemo(() => {
    const ivs = chain.rows
      .flatMap(r => [r.call.iv, r.put.iv])
      .map(v => (v > 3 ? v / 100 : v))
      .filter(v => v >= 0.01 && v <= 8)
      .sort((a, b) => a - b);
    const bars = weighed.ready && weighed.note == null && sessionOfMinute(nyMinutes()) === bookSession && liveSpot > 0 ? paintLive(weighed.bars, liveSpot, Math.floor(Date.now() / 1000), timeframe, bookSession) : weighed.bars;
    return {
      bars,
      iv: ivs.length ? ivs[Math.floor(ivs.length / 2)] : 0.2,
      key: `weigher:${under}:${timeframe}:${bookSession}`,
      clock: 'ny' as const,
      native: true as const,
      note: weighed.ready ? weighed.note : 'Loading this session.',
    };
  }, [weighed, chain.rows, under, timeframe, bookSession, liveSpot]);
  const prints = useMemo(() => buildPrints(ticker, liveSpot || levels.spot), [ticker, liveSpot, levels.spot]); // eslint-disable-line react-hooks/exhaustive-deps
  /* The rail's expiries — and the one a deep link asked for when the rail
     does not list it (a contract's own Friday), in date order */
  const expiries = useMemo(() => listedOpen(listed?.rows ?? []), [listed, tick]);
  const expiryOptions = useMemo<ExpiryChoice<number>[]>(
    () =>
      expiries.map(e => ({
        value: e.dte,
        label: e.label,
        hint: e.iso,
        date: new Date(`${e.iso}T12:00:00`),
      })),
    [expiries],
  );
  const shownCols = useMemo(() => CHAIN_COLUMNS.filter(c => cols.includes(c.key)), [cols]);
  // One array per chain per side — the picker's memo depends on this identity.
  const sideContracts = useMemo(() => chain.rows.map(r => (right === 'C' ? r.call : r.put)), [chain, right]);

  /* FULLSCREEN takeovers — the pressure ladder's grammar: portal to <body>, Esc exits on a fade, page scroll locks
     underneath. One card at a time; its grid cell goes blank behind the takeover so no chart runs twice. */
  const [full, setFull] = useState<'chart' | 'chain' | null>(null);
  /* the chain card's measured width — what its head lays itself out by (see `chainHead`); read before the first paint,
     so the head never opens broken and then mends itself */
  const chainRO = useRef<ResizeObserver | null>(null);
  const [chainW, setChainW] = useState(0);
  const chainBoxRef = useCallback((el: HTMLDivElement | null) => {
    chainRO.current?.disconnect();
    chainRO.current = null;
    if (!el) return;
    setChainW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(entries => setChainW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    chainRO.current = ro;
  }, []);
  const [guideOpen, setGuideOpen] = useState(false);
  const { closing, close } = useFadeClose(() => setFull(null));
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      // A modal over the takeover took the key already (Modal marks it)
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [full, close]);

  const fullBtn = (card: 'chart' | 'chain') => (
    <button
      onClick={() => setFull(card)}
      title={card === 'chart' ? 'Fullscreen chart' : 'Fullscreen chain'}
      className="hit-24 p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
    >
      <Maximize2 className="w-3 h-3" />
    </button>
  );

  const selected: DeskContract | null = useMemo(() => {
    if (sel == null) return null;
    const row = chain.rows.find(r => Math.abs(r.strike - sel) < 1e-9);
    return row ? (right === 'C' ? row.call : row.put) : null;
  }, [chain, sel, right]);
  const contractTape = useWeigherContract(chain.optRoot || ticker, chain.expiryIso || '', selected?.strike ?? 0, right, timeframe, bookSession, lens === 'contract' && selected != null);
  const tradedBars = useMemo(() => {
    if (!contractTape.bars) return null;
    /* The last candle is the last trade. A mid is not a trade, and a missing trade does not paint one. */
    if (contractTape.note || !selected || !Number.isFinite(selected.last) || !(selected.last > 0)) return contractTape.bars;
    if (sessionOfMinute(nyMinutes()) !== bookSession) return contractTape.bars;
    return paintLive(contractTape.bars, selected.last, Math.floor(Date.now() / 1000), timeframe, bookSession);
  }, [contractTape, selected, bookSession, timeframe]);
  useEffect(() => {
    if (!selected || chain.source !== 'live') {
      setLiveScore(null);
      return;
    }
    let dead = false;
    const rows = chain.rows.flatMap(r => [
      { strike: r.strike, right: 'C' as const, bid: r.call.bid, ask: r.call.ask },
      { strike: r.strike, right: 'P' as const, bid: r.put.bid, ask: r.put.ask },
    ]);
    scoreLiveContract({
      ticker,
      strike: selected.strike,
      right: selected.right,
      expiryIso: chain.expiryIso,
      bid: selected.bid,
      ask: selected.ask,
      spot: chain.spot,
      rows,
    }).then(s => {
      if (!dead) setLiveScore(s);
    });
    return () => {
      dead = true;
    };
  }, [ticker, selected, chain.source, chain.expiryIso, chain.spot, chain.rows]);

  const pickTicker = (t: string) => {
    if (t === ticker) return;
    setSel(null);
    setListSel(null);
    patch({ ticker: t, lens: 'stock', optRoot: '' });
  };

  /* A deep link arrives with a name (Trace's "Weigh it") — or with a CONTRACT. It repoints the desk once; after
     that the desk's own pickers own the ticker again, and the stored desk state carries it to the next visit. A
     contract also sets the side and the nearest listed expiry, and asks for its strike. */
  const [pendingPick, setPendingPick] = useState<{ ticker: string; dte: number; strike: number } | null>(null);
  /* The list's pick — the row the reader pressed on the positions or the watchlist card; the card draws it until
     the reader presses a strike on the chain or moves the desk to another name (declared here so those pickers can
     let it go) */
  const [listSel, setListSel] = useState<string | null>(null);
  /* The card's face — Our read or Simulated returns (declared here so the pickers can turn it; the rule is below,
     with the row the card draws) */
  const [cardView, setCardView] = useState<CardView>('read');
  /* Point the desk at a contract — the deep link's move, and a watchlist row's */
  const pointTo = useCallback(
    (req: WeighRequest) => {
      const t = req.ticker;
      setSel(null);
      /* the contract's OWN expiry, as the desk's horizon for that date — listed
         on the rail when the rail has it, added to the rail when it does not */
      const near = req.expiry ? dteForDate(req.expiry) : null;
      setPendingPick(req.strike == null ? null : { ticker: t, dte: near ?? dte, strike: req.strike });
      patch({ ticker: t, lens: 'stock', ...(req.right ? { right: req.right } : {}), ...(near != null ? { dte: near, optRoot: t } : { optRoot: '' }) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dte]
  );
  useEffect(() => {
    if (incoming) pointTo(incoming);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);
  /* The pick lands once the chain for THAT name and expiry is up — on the
     row's own strike when the chain lists it, else the nearest listed one */
  const [reveal, setReveal] = useState<{ strike: number; n: number } | null>(null);
  /* The case's doors point the desk at the other contract: the same strike on another expiry goes through the deep
     link's pending pick, so the chain for that expiry opens on the strike, its dropdown unfolded; another strike
     on this expiry is picked and revealed outright. */
  const pointToContract = useCallback(
    (strike: number, toDte: number, nextRight?: OptionRight) => {
      setListSel(null);
      setCardView('read');
      if (nextRight) patch({ right: nextRight });
      /* The case passes calendar days. Match the listed date, then the desk's own horizon for that date — a weekday count is not that key. */
      const wantIso = isoDate(expiryFor(toDte).date);
      const row = expiries.find(e => e.iso === wantIso) ?? expiries.find(e => e.dte === toDte);
      const horizon = row?.dte ?? toDte;
      if (horizon !== dte) {
        setPendingPick({ ticker, dte: horizon, strike });
        patch({ dte: horizon, ...(row ? { optRoot: row.root } : {}) });
      } else {
        setSel(strike);
        setReveal(r => ({ strike, n: (r?.n ?? 0) + 1 }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ticker, dte, expiries]
  );
  /* The light when the chart turns to a premium: whenever the contract lens comes up, or the contract under it
     changes — a double click on the chain, the Premium tab, a door in the case while the premium is up — ARRIVED
     for a moment: the chart's box wears the Tracker's ring once (`animate-focus-flash`). */
  const [arrived, setArrived] = useState<{ n: number } | null>(null);
  const litRef = useRef<string | null>(null);
  useEffect(() => {
    if (lens !== 'contract' || sel == null) {
      litRef.current = null;
      return;
    }
    const key = `${sel}:${right}:${dte}`;
    if (litRef.current === key) return;
    litRef.current = key;
    setArrived(a => ({ n: (a?.n ?? 0) + 1 }));
  }, [lens, sel, right, dte]);
  useEffect(() => {
    if (!arrived) return;
    const t = window.setTimeout(() => setArrived(null), 2200);
    return () => window.clearTimeout(t);
  }, [arrived]);
  useEffect(() => {
    if (!pendingPick || pendingPick.ticker !== ticker || pendingPick.dte !== dte || !chain.rows.length) return;
    const want = pendingPick.strike;
    const nearest = chain.rows.reduce((best, r) => (Math.abs(r.strike - want) < Math.abs(best.strike - want) ? r : best), chain.rows[0]);
    setPendingPick(null);
    setSel(nearest.strike);
    /* and the chain scrolls to it, its weigh-up open — not to the market */
    setReveal(r => ({ strike: nearest.strike, n: (r?.n ?? 0) + 1 }));
  }, [pendingPick, chain, ticker, dte]);

  /* ONE click weighs, TWO clicks chart. The single click only moves the Strike card; the chart keeps whatever lens
     it had — except when the click CLEARS the selection, because a contract lens with no contract has nothing to
     show and falls back to the stock tape. */
  /* What the last single click did, and when — the double-click rule below
     needs to know whether the first click of a pair CLOSED the row. */
  const lastToggle = useRef<{ strike: number; off: boolean; at: number } | null>(null);
  const pickStrike = useCallback((strike: number, clicks = 1) => {
    /* the reader's own press on the chain — the card follows the chain again, on its read */
    setListSel(null);
    setCardView('read');
    if (clicks >= 2) {
      /* A quick re-click on the OPEN row arrives as the second click of a double (e.detail 2): the first click
         closed the row, and treating the second as "chart it" re-opened it and flipped the chart. */
      const last = lastToggle.current;
      if (last && last.off && Math.abs(last.strike - strike) < 1e-9 && Date.now() - last.at < 700) return;
      setSel(strike);
      setDesk(d => ({ ...d, lens: 'contract' }));
      return;
    }
    setSel(cur => {
      const next = cur != null && Math.abs(cur - strike) < 1e-9 ? null : strike;
      lastToggle.current = { strike, off: next == null, at: Date.now() };
      if (next == null) setDesk(d => ({ ...d, lens: 'stock' }));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tYears = yearFracLeft(chain.expiryIso || isoDate(chain.expiry.date));
  /* the payoff curve prices on the clock and carry the row was read on (its quoted IV moved onto the trading clock) */
  const priceAt = useMemo(() => (selected ? pricerFor(chain, selected) : undefined), [selected, chain.ticker, chain.expiryIso]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Floating identity, defined once and rendered inside EACH lens's chart
     box — over the plot, below the toolbar (it was landing on the Tools
     row). */
  // 
  // timeframes on the left, pushing the timeframes and tools down to the
  // right") - an inline group, nothing floating.
  const identity = (
    <span className="inline-flex items-center gap-2 select-none shrink-0">
      <TickerQuickPick ticker={ticker} onPick={pickTicker} />
      {/* Keyed by its subject, so switching from the stock to a contract mounts at the new value instead of rolling through every number between. */}
      {headSpot > 0 && <SpotPrice key={`spot:${ticker}`} value={headSpot} />}
      {dayPct != null && headMove && (
        <span className={`font-mono text-[11px] font-semibold tnum ${dayPct >= 0 ? 'text-bull' : 'text-bear'}`} title={closeMoveTitle(headMove)} data-weigher-day>
          {dayPct >= 0 ? '\u25b2' : '\u25bc'} {signedPct(dayPct)}
        </span>
      )}
      {headMove && headMove.ext != null && (
        <span className="font-mono text-[10px] tnum text-textMuted" title={closeMoveTitle(headMove)} data-weigher-ext>
          {headMove.extWord === 'pre-market' ? 'PM' : 'AH'} {signedPct(headMove.ext)}
        </span>
      )}
    </span>
  );

  /* In the contract lens the strip speaks the CONTRACT \u2014 same capsule, same ticker door behind it, but the
     name is the whole contract and the tick is its mark against yesterday's modeled close, the reference's own
     "$0.38 \u25bc $0.07 (15.56%)" grammar. */
  /* The chain refreshes every few seconds, but the capsule's price ticks with the tape: one contract re-priced per second is cheap. */
  const shownMark = selected && Number.isFinite(selected.mark) ? selected.mark : null;
  const contractChg = shownMark != null && selected && Number.isFinite(selected.prevClose) ? shownMark - selected.prevClose : null;
  const contractChgPct = contractChg != null && selected && selected.prevClose > 0 ? (contractChg / selected.prevClose) * 100 : null;
  const contractIdentity = selected != null && sel != null && (
    <span className="inline-flex items-center gap-2 select-none shrink-0">
      <StrikePick
        label={`${ticker} ${fmtStrike(sel)} ${right === 'C' ? 'Call' : 'Put'}`}
        contracts={sideContracts}
        sel={sel}
        onPick={setSel}
      />
      {/* keyed by the contract: another strike is another number, not a move of this one (see `identity`) */}
      {shownMark != null && <SpotPrice key={`mark:${ticker}:${sel}${right}:${dte}`} value={shownMark} />}
      {contractChg != null && contractChgPct != null && (
        <span className={`font-mono text-[11px] font-semibold tnum ${contractChg >= 0 ? 'text-bull' : 'text-bear'}`}>
          {contractChg >= 0 ? '\u25b2' : '\u25bc'} ${Math.abs(contractChg).toFixed(2)} ({Math.abs(contractChgPct).toFixed(2)}%)
        </span>
      )}
    </span>
  );

  /* The Stock/Premium door in the strip's SECOND slot, the setup page's grammar — it used to sit at the far right
     and say Contract. Premium needs a picked contract; with none picked the door stays on Stock. */
  const lensTabs = (
    <CardTabs
      ariaLabel="Chart view"
      options={[
        { value: 'stock', label: 'Stock' },
        { value: 'contract', label: 'Premium' },
      ]}
      value={lens}
      onChange={v => (v === 'contract' ? selected && patch({ lens: 'contract' }) : patch({ lens: 'stock' }))}
    />
  );

  /* The card bodies live in consts so the SAME JSX serves the grid cell and
     the fullscreen takeover — one source, two frames, no drift. */
  const chartStrip = (
    <div
      /* NO band. The Terrain floating chrome grammar instead: the strip is transparent and each control carries
         its own pill, so the tape runs untouched to the card's top edge. */
      /* Clear of the price axis. The strip spans the card, so its right cluster used to land on the axis column; a
         right inset the width of that column keeps every control inside the plot, where the tape is, and off the
         numbers. */
      /* pr-[68px], down from 76: the axis column is 54, so 14px stays clear of it — and the 8px is what keeps the
         whole strip on ONE row at 1905 now that the toolbar no longer squeezes (below). */
      className="absolute top-0 inset-x-0 z-20 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-2 pr-[68px] py-1 select-none"
      /* Floating chrome the chart's scripts legend measures and sits under */
      data-chart-chrome
    >
      {/* The same strip as pulse, slot for slot: the identity, the Stock/Premium door, then the toolbar —
          timeframes, overlays, indicators, alerts, theme — and the expand door last. On the half-width card the
          toolbar drops its words (compact icons); in fullscreen it wears Pulse's full words. */}
      {lens === 'contract' && selected != null && sel != null ? (
        <>
          {contractIdentity}
          {lensTabs}
          <TimeframeStrip value={timeframe} onChange={setTimeframe} />
          <SessionBook />
          {/* The premium lens has no toolbar to carry the door, so it stands alone at the end */}
          <span className="ml-auto flex items-center gap-1.5">
            {full === 'chart' ? (
              <button
                onClick={close}
                title="Exit fullscreen (Esc)"
                className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
              >
                <Minimize2 className="w-3 h-3" />
              </button>
            ) : (
              fullBtn('chart')
            )}
          </span>
        </>
      ) : (
        <>
          {identity}
          {lensTabs}
          {/* `spread` + the room to spread in — Pulse's rule: the timeframes keep the left, the divider becomes
              the spacer, Indicators · Alerts · Candles · Overlays · Theme land at the right edge beside the expand
              door. Compact (the card) stays packed — there is no room to spread across. */}
          {/* Its floor is its own row: this wrapper was `min-w-0`, so when the identity and the tabs left it less
              than a row's worth, it shrank to one icon's width and the toolbar's own wrap stacked its six controls
              into a COLUMN, with the identity centred beside it. */}
          <div className={isPhone ? 'basis-full flex flex-wrap items-center gap-1.5' : 'flex-1 min-w-fit flex items-center gap-1.5'}>
            <SessionBook />
            <ChartToolbar
              minimal
              candles
              /* on a phone the controls sit packed on one row under the name; spread across a narrow strip they stacked into a column over the tape */
              spread={!isPhone}
              alertTicker={ticker}
              alertSpot={levels.spot}
              compact={full !== 'chart'}
              timeframe={timeframe}
              onTimeframe={setTimeframe}
              overlays={overlays}
              onOverlays={setOverlays}
              chartStyle={chartStyle}
              onChartStyle={setChartStyle}
              indicators={indicators}
              onIndicators={setIndicators}
              paneId="weigher"
              fullscreen={full === 'chart'}
              /* The door rides the toolbar: it used to stand alone after it with `ml-auto`, so when the toolbar
                 wrapped to a row of its own the door was left behind on the first row, or dropped to a third. */
              onToggleFullscreen={full === 'chart' ? close : () => setFull('chart')}
            />
          </div>
        </>
      )}
    </div>
  );

  const chartBody = (
    /* A dark island on any page: the tape and its strip read the dark tokens — and the strip the ground of the
       tape's theme */
    <div className="relative h-full bg-panel" data-theme="dark" data-chart-ground={chartGround(chartThemeKey)} data-tape-session={bookSession} data-tape-tf={timeframe} data-tape-bars={chartTape.bars.length} data-tape-first={chartTape.bars[0]?.time ?? 0} data-tape-note={chartTape.note ?? ''}>
      {/* THE RING when the chart turns to a premium, fullscreen — the Tracker's card flash, once (`arrived`); just inside
          the screen's edge, where an outset ring would fall off it. Docked, the ring stands round the card (the frame) */}
      {arrived && full === 'chart' && <div key={arrived.n} className="absolute inset-0.5 z-30 pointer-events-none rounded-md animate-focus-flash" data-weigher-flash />}
      <div className="absolute inset-0">
        {lens === 'contract' && selected ? (
          /* Keyed remount: stepping strikes lands the new premium tape on a
             soft fade instead of a hard cut. */
          <div key={`${ticker}:${sel}:${right}:${dte}`} className="h-full animate-soft-in">
            <ContractPremiumPane
              ticker={ticker}
              strike={selected.strike}
              right={right}
              tYears={tYears}
              iv={selected.iv > 3 ? selected.iv / 100 : selected.iv}
              priceAt={priceAt}
              spot={chain.spot}
              timeframe={timeframe}
              revision={tick}
              /* the wheel is the page's over the docked pane, as over the stock chart beside it */
              pageScroll={full !== 'chart'}
              traded={tradedBars}
              tradedAsIs
            />
          </div>
        ) : (
          /* The chart mounts a frame after the page paints, behind its skeleton */
          <Deferred fallback={<ChartSkeleton className="h-full" />} className="h-full animate-fade-in">
            <StrikeChart
              ticker={ticker}
              paneId="weigher"
              revision={tick}
              levels={levels}
              timeframe={timeframe}
              keepView
              /* The wheel belongs to the page over the docked chart; fullscreen keeps the wheel zoom, as Terrain
                 below lg does — the same trade, see `pageScroll` */
              pageScroll={full !== 'chart'}
              overlays={overlays}
              chartStyle={chartStyle}
              indicators={indicators}
              prints={prints}
              tape={chartTape}
              height={180}
              frameless
            />
          </Deferred>
        )}
      </div>
      {chartStrip}
    </div>
  );

  /* The chain's line of cards: the name's own door, then Side · Expiry (as dates, the Map's spelling) · Reach (the
     strike distance is a choice, not a cap) · Columns (the catalog, in catalog order), and the expected move as a
     fact. The head knows its room. */
  const chainName = <TickerQuickPick ticker={ticker} onPick={pickTicker} slim />;
  const chainFeedWords = (() => {
    const stamp = (at: number) => STAMP_FMT.format(new Date(at));
    if (chain.offline) return offlineWords(chain.takenAt ?? listed?.takenAt ?? 0);
    if (listed === null || (chainWait && !chain.rows.length)) return 'Pulling';
    if (chain.kept && chain.takenAt) return `Kept · as of ${etClock(chain.takenAt)}`;
    if (!listed.rows.length || !chain.rows.length) return 'No listed options';
    const at = chain.quotedAt || chain.takenAt || 0;
    if (!at) return fmtDay(chain.expiry.date);
    return optionsOpen() ? `Live · ${fmtDay(chain.expiry.date)} · ${stamp(at)} ET` : `${fmtDay(chain.expiry.date)} · quotes as of ${etClock(at)}`;
  })();
  const chainMove = (
    <span className="inline-flex items-center gap-2">
      {chain.expectedMovePct > 0 && (
        <span className="font-mono text-t9 tnum text-textMuted whitespace-nowrap" title={`One standard move (1σ) the at-the-money options charge for by this expiry, ${fmtDay(chain.expiry.date)}, off this chain's own quotes (the calendar days to it included) — Pinpoint's "one move" and Terrain's cone read their own vol and clock, so they can differ by a few hundredths`} data-chain-move>
          ±{chain.expectedMovePct.toFixed(1)}% 1σ
        </span>
      )}
      <span className={`font-mono text-t9 uppercase tracking-widest whitespace-nowrap ${chain.offline ? 'text-bear' : 'text-textMuted'}`} data-chain-feed={chain.offline ? 'offline' : chain.kept ? 'kept' : 'live'} title={chain.offline ? 'Live data is not answering. The chain is the last one it gave.' : undefined}>
        {chainFeedWords}
      </span>
    </span>
  );
  const chainCards = (bare: boolean) => (
    <>
      <DropdownSelect label="Side" value={right} options={SIDE_OPTIONS} onChange={v => patch({ right: v })} title="Calls or puts" testId="weigher-side" bare={bare} />
      <ExpiryCard label="Expiry" value={dte} choices={expiryOptions} onChange={v => { const row = expiries.find(e => e.dte === v); patch({ dte: v, ...(row ? { optRoot: row.root } : {}) }); }} title="Which contracts the chain lists. Only a day that has contracts." testId="weigher-expiry" bare={bare} />
      <DropdownSelect label="Reach" value={depth} options={REACH_OPTIONS} onChange={v => patch({ depth: v })} title="How many strikes each side of the market" testId="weigher-reach" bare={bare} />
      <DropdownMulti
        label="Columns"
        values={cols}
        groups={COLUMN_GROUPS}
        onChange={next => patch({ cols: CHAIN_COLUMNS.map(c => c.key).filter(k => next.includes(k)) })}
        emptyWord="Strike only"
        title="Which facts the chain shows"
        testId="weigher-columns"
        align="end"
        bare={bare}
      />
    </>
  );
  const chainActions = (
    <span className="flex items-center gap-1.5 flex-wrap">
      {chainName}
      {chainCards(false)}
      {chainMove}
    </span>
  );
  const chainHead: 'one' | 'two' | 'bare' = chainW === 0 || chainW >= CHAIN_ONE_ROW_PX ? 'one' : chainW >= CHAIN_NAMED_ROW_PX ? 'two' : 'bare';

  /* The weigh-up is gone: the Compass grade, the board's rank and the doors to the setup page left the card with
     it — the card is the contract's page now */
  /* The watchlist on the desk. The store's housekeeping — today's close, the bell — rides the desk's tick; the
     rows are priced on the sweep, like the chain. */
  const watchlist = useWatchlist();
  useEffect(() => {
    tickWatchlist();
  }, [tick]);
  /* One list, two kinds of rows: the contracts you watch and the positions you own or sold (the Map's "Your
     positions", moved here) — priced on the sweep, open rows first, newest first */
  const positions = useAllPositions();
  const legKey = useMemo(() => {
    const keys: string[] = [];
    for (const p of positions) keys.push(`${p.ticker}|${p.expiry}|${p.strike}|${p.right}`);
    for (const w of watchlist) if (w.status === 'open') keys.push(`${w.ticker}|${w.expiry}|${w.strike}|${w.right}`);
    return [...new Set(keys)].sort().join(',');
  }, [positions, watchlist]);
  const [legBook, setLegBook] = useState<Map<string, { bid: number | null; ask: number | null; prev: number | null; at: number; live: boolean }>>(new Map());
  useEffect(() => {
    if (!legKey || chainWait) return;
    let dead = false;
    const legs = legKey.split(',').map(key => {
      const [sym, expiry, strike, side] = key.split('|');
      return { ticker: sym, expiry, strike: Number(strike), right: (side === 'P' ? 'P' : 'C') as OptionRight };
    });
    const pull = async () => {
      if (document.visibilityState === 'hidden' || thetaUseHere() !== 'all') return;
      const got = await readLegs(legs).catch(() => null);
      if (dead || !got) return;
      setLegBook(prev => {
        /* a leg the read did not quote keeps its last bid and ask */
        const next = new Map(prev);
        const now = Date.now();
        for (const [k, q] of got) {
          const was = next.get(k);
          if (q.bid != null || q.ask != null) next.set(k, { bid: q.bid, ask: q.ask, prev: q.prev ?? was?.prev ?? null, at: now, live: true });
          else if (was) next.set(k, { ...was, live: false });
          else next.set(k, { bid: null, ask: null, prev: q.prev, at: 0, live: false });
        }
        return next;
      });
    };
    void pull();
    const id = window.setInterval(() => void pull(), 8000);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [legKey, chainWait]);
  const liveOf = (sym: string, expiry: string, strike: number, right: 'C' | 'P') => {
    const onChain = chain.source === 'live' && chain.ticker === sym && chain.expiryIso === expiry ? chain.rows.find(r => Math.abs(r.strike - strike) < 1e-6) : undefined;
    const leg = onChain ? (right === 'C' ? onChain.call : onChain.put) : null;
    const quoted = legBook.get(`${sym}|${expiry}|${strike}|${right}`);
    const onThisChain = !!leg && (Number.isFinite(leg.bid) || Number.isFinite(leg.ask));
    const bid = onThisChain ? (Number.isFinite(leg.bid) ? leg.bid : null) : quoted?.bid ?? null;
    const ask = onThisChain ? (Number.isFinite(leg.ask) ? leg.ask : null) : quoted?.ask ?? null;
    /* The mid is only a stamp for a real bid. A 0 bid must not become one. */
    const mid = bid != null && bid > 0 && ask != null && ask >= bid && ask > 0 ? Number(((bid + ask) / 2).toFixed(2)) : null;
    const prev = leg && leg.prevClose > 0 ? leg.prevClose : quoted?.prev ?? null;
    const live = onThisChain ? !chain.offline && !chain.kept : !!quoted?.live;
    const markAt = live ? null : onThisChain ? chain.takenAt ?? null : quoted?.at || null;
    return { bid, ask, mid, prev, live, markAt };
  };
  /* TWO CARDS: the positions you own or sold in one, the contracts you watch in the other — the same rows, priced
     on the sweep, newest first, a watched row's settled ones last */
  const ownRows = useMemo<ListRow[]>(
    () =>
      positions
        .map<ListRow>(p => {
          const { bid, ask, prev } = liveOf(p.ticker, p.expiry, p.strike, p.right);
          const px = exitPrice(p.side, bid, ask);
          const sign = p.side === 'long' ? 1 : -1;
          const per = 100 * p.contracts;
          const cost = costOf(p);
          const total = px != null && cost ? (px - cost.value) * sign * per : null;
          const totalR = px != null && cost && cost.value > 0 ? ((px - cost.value) / cost.value) * sign : null;
          const today = px != null && prev != null ? (px - prev) * sign * per : null;
          const todayR = px != null && prev != null && prev > 0 ? ((px - prev) / prev) * sign : null;
          return { kind: 'own', id: p.id, p, value: px, today, todayR, total, totalR };
        })
        .sort((a, b) => (b.kind === 'own' ? b.p.addedAt : 0) - (a.kind === 'own' ? a.p.addedAt : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, chain, legBook]
  );
  const watchRows = useMemo<ListRow[]>(() => {
    const rank = (w: WatchedContract) => (w.status === 'open' ? 0 : 1);
    return [...watchlist].sort((a, b) => rank(a) - rank(b) || b.addedAt - a.addedAt).map<ListRow>(w => {
      const open = w.status === 'open';
      const q = open ? liveOf(w.ticker, w.expiry, w.strike, w.right) : null;
      /* A watch is as if bought: the live price is the bid, and 0 stays 0. */
      const px = open ? exitPrice('long', q?.bid ?? null, q?.ask ?? null) : w.closedMark ?? null;
      const prev = open ? q?.prev ?? null : null;
      const quoteLive = open ? !!q?.live : true;
      const markAt = open ? q?.markAt ?? null : null;
      const live = px != null && Number.isFinite(px) ? px : null;
      const per = 100 * w.size;
      const addedDay = isoDate(new Date(w.addedAt));
      const todayKey = isoDate(today());
      const since = live != null ? (live - w.addedMark) * per : NaN;
      const todayMove = addedDay === todayKey ? since : live != null && prev != null ? (live - prev) * per : NaN;
      const todayRate = addedDay === todayKey
        ? (live != null && w.addedMark > 0 ? (live - w.addedMark) / w.addedMark : NaN)
        : live != null && prev != null && prev > 0 ? (live - prev) / prev : NaN;
      return {
        kind: 'watch',
        id: w.id,
        w,
        r: {
          mark: live ?? NaN,
          prevClose: prev ?? NaN,
          todayDollars: todayMove,
          todayR: todayRate,
          totalDollars: since,
          totalR: live != null && w.addedMark > 0 ? (live - w.addedMark) / w.addedMark : NaN,
          breakeven: Number((w.right === 'C' ? w.strike + w.addedMark : w.strike - w.addedMark).toFixed(2)),
          toBreakevenPct: NaN,
          spot: chain.ticker === w.ticker ? chain.spot : NaN,
          dte: 0,
          live: quoteLive,
          markAt,
        },
      };
    });
  }, [watchlist, chain, legBook]);
  useEffect(() => {
    for (const w of watchlist) {
      if (w.status !== 'open') continue;
      const { mid } = liveOf(w.ticker, w.expiry, w.strike, w.right);
      if (mid != null && mid > 0) restampWatch(w.id, mid, chain.ticker === w.ticker && chain.spot > 0 ? chain.spot : 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlist, chain, legBook]);
  const listRows = useMemo<ListRow[]>(() => [...ownRows, ...watchRows], [ownRows, watchRows]);
  const watchReq = useMemo(() => (sel != null ? { ticker, strike: sel, right, expiry: isoDate(chain.expiry.date) } : null), [ticker, sel, right, chain.expiry.date]);
  /* the picked contract's watched row — open, or its latest settled one */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const watched = useMemo(() => (watchReq ? watchedFor(watchReq) : null), [watchReq, watchlist]);
  const watching = watched?.status === 'open';
  /* The row the card draws: the row the reader pressed on a list, while the desk is on its name — else the picked
     contract's own row (an open watched one first, then a position) — else none. */
  const cardRow = useMemo<ListRow | null>(() => {
    const chosen = listSel ? listRows.find(r => r.id === listSel) : null;
    if (chosen && (chosen.kind === 'watch' ? chosen.w : chosen.p).ticker === ticker) return chosen;
    const same = (r: ListRow) => {
      const c = r.kind === 'watch' ? r.w : r.p;
      return !!watchReq && c.ticker === watchReq.ticker && c.right === watchReq.right && c.expiry === watchReq.expiry && Math.abs(c.strike - watchReq.strike) < 1e-9;
    };
    return listRows.find(r => same(r) && (r.kind === 'own' || r.w.status === 'open')) ?? listRows.find(r => same(r)) ?? null;
  }, [listRows, listSel, watchReq, ticker]);
  /* The card's two faces: Our read — the case for the contract in hand — or Simulated returns. A strike pressed on
     the chain opens the card on the read; a row pressed on a list opens it on the returns; the head's switch turns
     it either way until the next pick. */
  const cardRowId = cardRow ? cardRow.id : null;
  useEffect(() => {
    if (!cardRowId) setCardView('read');
  }, [cardRowId]);
  const caseForRow = useMemo(() => {
    if (!cardRow) return true;
    if (sel == null) return false;
    const c = cardRow.kind === 'watch' ? cardRow.w : cardRow.p;
    return c.ticker === ticker && c.right === right && Math.abs(c.strike - sel) < 1e-9 && c.expiry === isoDate(chain.expiry.date);
  }, [cardRow, sel, ticker, right, chain.expiry.date]);
  /* The ring on the card when it turns to a new case: the Tracker's flash, once, whenever the case's contract
     changes — a strike pressed, a door in the case, another expiry — and not when the card turns to a position. */
  const [caseArrived, setCaseArrived] = useState<{ n: number } | null>(null);
  const caseKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = !cardRow && selected && sel != null ? `${ticker}:${sel}:${right}:${dte}` : null;
    if (key === caseKeyRef.current) return;
    caseKeyRef.current = key;
    if (key) setCaseArrived(a => ({ n: (a?.n ?? 0) + 1 }));
  }, [cardRow, selected, sel, ticker, right, dte]);
  useEffect(() => {
    if (!caseArrived) return;
    const t = window.setTimeout(() => setCaseArrived(null), 2200);
    return () => window.clearTimeout(t);
  }, [caseArrived]);
  /* THE DOOR: watch the picked contract — the store marks it at this tick's price — and the
     list card turns to the watchlist, where its row now stands selected */
  const quoteAt = useCallback((strike: number): number | null => {
    const row = chain.rows.find(r => Math.abs(r.strike - strike) < 1e-6);
    const leg = row ? (right === 'C' ? row.call : row.put) : null;
    if (!leg || !(leg.bid > 0)) return null;
    if (leg.mark > 0) return leg.mark;
    if (leg.ask >= leg.bid) return Number(((leg.bid + leg.ask) / 2).toFixed(2));
    return null;
  }, [chain.rows, right]);
  const watchIt = useCallback(() => {
    if (!watchReq) return;
    const mark = quoteAt(watchReq.strike);
    if (!watching && mark != null) addToWatchlist({ ...watchReq, mark, spot: chain.spot > 0 ? chain.spot : undefined });
    patch({ preset: 'watchlist' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchReq, watching, quoteAt, chain.spot]);
  const pickRow = useCallback(
    (row: ListRow) => {
      const c = row.kind === 'watch' ? row.w : row.p;
      setListSel(row.id);
      setCardView('returns');
      pointTo({ ticker: c.ticker, strike: c.strike, right: c.right, expiry: c.expiry });
    },
    [pointTo]
  );
  /* The trash bin on a list row: a watched contract leaves the list, a position is removed — the row glides out
     (animateRows) and the card follows the list */
  const removeRow = useCallback((row: ListRow) => {
    if (row.kind === 'watch') removeWatched(row.w.id);
    else removePosition(row.p.id);
    setListSel(s => (s === row.id ? null : s));
  }, []);
  /* The bottom row's cards fold to their heads: a folded list card gives its room to the other; both folded, the
     column is two heads; the position card folds too — its body glides away and the row settles on the column's
     floor. Kept in this browser. */
  const [folds, setFolds] = useState<Folds>(() => {
    try {
      const raw = localStorage.getItem('slayer_weigher_folds');
      const v = raw ? (JSON.parse(raw) as Partial<Folds>) : {};
      return { positions: v.positions === true, watchlist: v.watchlist === true, position: v.position === true };
    } catch {
      return { positions: false, watchlist: false, position: false };
    }
  });
  const toggleFold = useCallback((key: keyof Folds) => {
    setFolds(f => {
      const next = { ...f, [key]: !f[key] };
      try {
        localStorage.setItem('slayer_weigher_folds', JSON.stringify(next));
      } catch {
        /* storage off — the fold lives for the session */
      }
      return next;
    });
  }, []);
  const columnRows = `${folds.positions ? 'minmax(33px, 0fr)' : 'minmax(0, 1fr)'} ${folds.watchlist ? 'minmax(33px, 0fr)' : 'minmax(0, 1fr)'}`;
  /* A position just added lands on the desk: the form saved it, the list has it — its row is picked so the card
     turns to it on the soft fade */
  const knownPositions = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set(positions.map(p => p.id));
    const known = knownPositions.current;
    knownPositions.current = ids;
    if (!known) return;
    const fresh = positions.find(p => !known.has(p.id));
    const row = fresh ? listRows.find(r => r.id === fresh.id) : null;
    if (row) pickRow(row);
  }, [positions, listRows, pickRow]);
  /* The door on every chain row: the strikes of this ladder that are on the list, and the +: it picks the strike,
     watches it if it is not watched yet, and turns the list card to the watchlist — the position lands in the card
     the moment it is entered */
  const expiryIso = isoDate(chain.expiry.date);
  const watchedStrikes = useMemo(() => new Set(watchlist.filter(w => w.status === 'open' && w.ticker === ticker && w.right === right && w.expiry === expiryIso).map(w => w.strike)), [watchlist, ticker, right, expiryIso]);
  const watchFromChain = useCallback(
    (strike: number) => {
      setSel(strike);
      const mark = quoteAt(strike);
      if (!watchedStrikes.has(strike) && mark != null) addToWatchlist({ ticker, strike, right, expiry: expiryIso, mark, spot: chain.spot > 0 ? chain.spot : undefined });
      patch({ preset: 'watchlist' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchedStrikes, ticker, right, expiryIso, quoteAt, chain.spot]
  );

  /* The day's dealer map for the name — the position card's sketch draws its walls and flip on the price axis and
     its read speaks against it (the Positions panel reads every position against the 0DTE book, thirty strikes
     each side); rebuilt on the sweep */
  const profile = useMemo<ExposureProfileData | null>(() => {
    try {
      const snap = snapshotOf(ticker);
      return snap ? buildExposureProfile(snap, '0DTE', 30) : null;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, scanTick]);
  /* Our two cents: THE BOOK for the desk's name — every strike's shape, lean, part, record, close odds and change
     (data/bookAtStrike.ts) — read by the chain's column and the strike's third block; and the lists' HEDGING word,
     the position card's own verdict for every row, a profile per name on the scan */
  const book = useMemo(() => (profile ? buildBook(ticker, profile) : null), [profile, ticker]);
  const bookAt = useCallback((strike: number) => book?.rows.get(strike) ?? null, [book]);
  const drillBook = useCallback((c: DeskContract) => <BookBlock read={bookAt(c.strike)} c={c} />, [bookAt]);
  /* The case for the strike: the word and its line, for it and against it, what has to happen, the alternatives as
     doors, the same strike down the calendar, what to look at for the horizon (components/weigher/StrikeCase.tsx,
     data/strikeCase.ts). */
  const drillCase = useCallback(
    (c: DeskContract) => <StrikeCase ticker={ticker} c={c} right={right} chain={chain} profile={profile} book={book} tick={scanTick} score={liveScore} listed={expiries.map(e => ({ dte: e.dte, iso: e.iso, weekday: e.weekday, label: e.label }))} onPickAlt={pointToContract} />,
    [ticker, right, chain, profile, book, scanTick, pointToContract, liveScore, expiries]
  );

  const belowLg = useIsBelowXl();
  const portraitDesk = useIsPortraitDesk();
  const [top, setTop] = useState<number>(readDeskTop);
  const frameRef = useRef<HTMLDivElement | null>(null);
  /* a drag's window listeners, taken down on release — or when the desk unmounts mid-drag */
  const sashOff = useRef<(() => void) | null>(null);
  useEffect(() => () => sashOff.current?.(), []);
  const onSashDown = useCallback((e: React.PointerEvent) => {
    const frame = frameRef.current;
    if (!frame) return;
    e.preventDefault();
    sashOff.current?.();
    const move = (ev: PointerEvent) => {
      const r = frame.getBoundingClientRect();
      setTop(clampDeskTop(ev.clientY - r.top));
    };
    const off = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (sashOff.current === off) sashOff.current = null;
    };
    const up = () => {
      off();
      setTop(v => {
        saveDeskTop(v);
        return v;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    sashOff.current = off;
  }, []);
  const resetSash = useCallback(() => {
    setTop(DESK_TOP_DEFAULT);
    saveDeskTop(DESK_TOP_DEFAULT);
  }, []);

  const windowed = useMemo(() => {
    if (!chain.rows.length || !(chain.spot > 0)) return chain;
    const above = chain.rows.map(r => r.strike).filter(k => k > chain.spot).sort((a, b) => a - b).slice(0, depth);
    const below = chain.rows.map(r => r.strike).filter(k => k < chain.spot).sort((a, b) => b - a).slice(0, depth);
    const keep = new Set<number>([...above, ...below, ...chain.rows.map(r => r.strike).filter(k => k === chain.spot)]);
    const rows = chain.rows.filter(r => keep.has(r.strike));
    return rows.length === chain.rows.length ? chain : { ...chain, rows };
  }, [chain, depth]);

  const chainBody = (
    <ChainCard
      inlineDrill
      chain={windowed}
      right={right}
      sel={sel}
      onSelect={pickStrike}
      cols={shownCols}
      centerKey={`${ticker}:${dte}:${optRoot}:${depth}:${windowed.rows.length}`}
      reveal={reveal}
      watched={watchedStrikes}
      onWatch={watchFromChain}
      book={bookAt}
      drillExtra={drillBook}
      emptyText={chain.offline ? 'Live data offline — reconnecting' : listed === null || chainWait ? 'Reading the chain' : 'No listed contracts'}
    />
  );

  /* The whole desk holds still for the sidebar's glide. */
  const deskRef = useRef<HTMLDivElement | null>(null);
  useEffect(
    () =>
      onGlide(
        () => {
          const el = deskRef.current;
          if (!el) return;
          el.style.width = `${el.getBoundingClientRect().width}px`;
          /* And it rides the glide as ONE compositor layer: the sidebar's width shifts the whole column sideways
             every frame, and without a layer the chart's canvases and both tables re-rasterise on each of them
             (the residual after the width hold — measured 21–35ms worst frames against Compass's 14). */
          el.style.willChange = 'transform';
        },
        () => {
          const el = deskRef.current;
          if (!el) return;
          el.style.width = '';
          el.style.willChange = '';
        }
      ),
    []
  );

  const onShellName = useCallback((t: string) => {
    setSel(null);
    setListSel(null);
    setDesk(d => (d.ticker === t ? d : { ...d, ticker: t, lens: 'stock', optRoot: '' }));
  }, []);

  return (
    /* The desk is the first screenful's remainder: the shell hands /weigher
       exactly one viewport of height (the footer waits one slight scroll
       below), and this column absorbs it — the "100%" the 60/40 splits. */
    <div ref={deskRef} className="relative flex-1 min-h-0 flex flex-col" data-weigher-desk>
      <ShellFollow ticker={ticker} onExternal={onShellName} />
      <TickPump onTick={onTick} />

      {/* ONE strip of chrome, the Trace verdict applied here — the page identity on the left and the session read
          on the right. Weight at both ends, the card-head law. The session read, not a badge. */}
      {/* The shell head — the page's icon and name over one line, the house head every walked page wears; the
          session read rides at the right as two labelled facts. */}
      <header className="shrink-0 flex items-start gap-6 flex-wrap pb-3 border-b border-borderSubtle" data-shell data-weigher-shell>
        <div className="min-w-0 flex-1">
          <div className="h-6 flex items-center gap-2.5" data-shell-page>
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-md border border-borderSubtle text-textSecondary shrink-0" aria-hidden="true">
              <Scale className="w-3.5 h-3.5" />
            </span>
            <h1 className="text-[15px] font-semibold leading-tight text-textPrimary">Weigher</h1>
            <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the chain, the read and the chart mean" testId="weigher-guide" />
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">Chart, chain and watchlist on one desk — pick a name, pick a contract, watch it</p>
        </div>
        <dl
          className="flex flex-wrap gap-x-6 gap-y-2"
          data-shell-facts
          title={session === 'rth' ? 'New York is open, 9:30 AM to 4:00 PM ET' : session === 'closed' ? 'New York is closed today' : 'Outside the regular session, 9:30 AM to 4:00 PM ET'}
        >
          <Fact label="Session" testId="session">
            {session === 'rth' ? 'Regular session' : <span className="text-moon">{session === 'closed' ? 'Closed' : sessionMeta(session).label}</span>}
          </Fact>
        </dl>
      </header>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the Weigher" testId="weigher-guide" viewport>
        <WeigherGuide />
      </GuideFocus>

      {/* The static frame: four cells, drawn once. */}
      {/* On a phone, a column: the four cards under each other at a readable height each — the chart at three
          fifths of the screen, the chain a screen, the scanner three fifths — and the page scrolls (the shell
          drops the viewport frame below md). Four cells in a 390px frame were four unreadable ones. */}
      {/* The window and the row under it: the chart and the chain in a window at the reader's height (the sash),
          the watchlist and the position in a row that grows with its cards — the page scrolls, like every other
          page. The phone's column never sees the style; its cards stack at their own heights. */}
      {belowLg && portraitDesk && (
        <p className="mt-3 text-[11px] text-textMuted" data-portrait-note>
          Built for a wide screen — on a tall one the chart and the chain stack, each at its full width.
        </p>
      )}
      <div
        ref={frameRef}
        className="relative mt-4 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5 max-xl:grid-cols-1 max-xl:grid-rows-none max-xl:auto-rows-auto"
        style={belowLg ? undefined : { gridTemplateRows: deskRows(top) }}
        data-weigher-frame
        data-desk-top={belowLg ? undefined : top}
      >
        <div className="relative min-h-0 min-w-0 max-xl:h-[60vh]">
          {/* NOT a DeskCard: the chart card has no header row — the strip inside chartBody is its whole chrome. */}
          <div className="h-full relative overflow-hidden rounded-md border border-ink/[0.07] bg-panel">
            {full === 'chart' ? <div className="h-full" /> : chartBody}
          </div>
          {/* THE RING round the card when the chart turns to a premium: a sibling of the card, not a child — the
              card clips its children at its edge, and the ring stands just outside the border, as the Tracker's
              does round its card */}
          {arrived && full !== 'chart' && <div key={arrived.n} className="absolute inset-0 z-30 pointer-events-none rounded-md animate-focus-flash" data-weigher-flash />}
        </div>

        <div ref={chainBoxRef} className="min-h-0 min-w-0 max-xl:h-[70dvh]" data-chain-head={chainHead}>
          <DeskCard
            title="Chain"
            actions={
              chainHead === 'one' ? (
                <>
                  {chainActions}
                  {fullBtn('chain')}
                </>
              ) : (
                /* the row's whole width: the chain's identity beside its title, the door at the row's end */
                <span className="flex flex-1 items-center gap-1.5 min-w-0">
                  {chainName}
                  {chainMove}
                  <span className="ml-auto inline-flex">{fullBtn('chain')}</span>
                </span>
              )
            }
            under={chainHead === 'one' ? undefined : chainCards(chainHead === 'bare')}
          >
            {full === 'chain' ? <div className="h-full" /> : chainBody}
          </DeskCard>
        </div>

        <div className="min-h-0 min-w-0 grid gap-2.5 min-h-[438px] transition-[grid-template-rows] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ gridTemplateRows: columnRows }} data-left-column data-folds={`${folds.positions ? 'p' : ''}${folds.watchlist ? 'w' : ''}${folds.position ? 'c' : ''}`}>
          {/* Two cards in the left column: YOUR POSITIONS — the ones you own or sold, the Map's form to add one —
              over THE WATCHLIST, the contracts you watch (its List control turns it into the scanner's roster). */}
          <div className="min-h-0" data-positions-card>
            <DeskCard
              title="Your positions"
              fold={{ open: !folds.positions, onToggle: () => toggleFold('positions'), testId: 'positions' }}
              actions={
                /* Add a position — the Map's form, here now: strike · call or put · own or sold · contracts ·
                   expires · what you paid */
                <PositionForm
                  ticker={ticker}
                  quoteFor={quoteFor}
                  /* a strike the chain lists: the money rounded to a dollar (244 on a name that steps by 2.50)
                     made positions no chain row could answer to */
                  defaultStrike={sel ?? (chain.rows.length ? chain.rows.reduce((best, r) => (Math.abs(r.strike - (liveSpot || levels.spot)) < Math.abs(best.strike - (liveSpot || levels.spot)) ? r : best), chain.rows[0]).strike : Math.round(liveSpot || levels.spot))}
                  align="end"
                  trigger={
                    /* the small size — a 28px control filled the head's 32px line to the borders */
                    <button className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-borderSubtle bg-ink/[0.03] hover:bg-ink/[0.06] font-mono text-t9 uppercase tracking-wider text-textSecondary hover:text-textPrimary transition-colors" title="Add a position you own or sold — its simulated returns land in the card" data-add-position>
                      <Plus className="w-3 h-3" />
                      Add a position
                    </button>
                  }
                />
              }
            >
              <ListGrid rows={ownRows} selectedId={cardRow?.id ?? null} onPick={pickRow} onRemove={removeRow} emptyText="No positions yet — add one you own or sold" testId="positions" />
            </DeskCard>
          </div>
          <div className="min-h-0" data-watchlist-card>
            <DeskCard
              title={preset === 'watchlist' ? 'Watchlist' : 'Scanner'}
              fold={{ open: !folds.watchlist, onToggle: () => toggleFold('watchlist'), testId: 'watchlist' }}
              actions={<DropdownSelect label="List" value={preset} options={KIND_OPTIONS} onChange={v => patch({ preset: v })} title="What this card lists" testId="weigher-kind" align="end" size="sm" />}
            >
              {/* The house grid — the roster as an AG Grid window: the head pinned, the rows in the house's
                  clothes, the desk's name in the where-you-are selection; a row puts that name on the desk. The
                  watchlist wears the same window: a row puts that CONTRACT on the desk. */}
              {/* the swap between the list and a scanner's cut lands on the house's soft fade */}
              <div key={preset} className="h-full animate-soft-in-slow" data-list-view={preset}>
                {preset === 'watchlist' ? <ListGrid rows={watchRows} selectedId={cardRow?.id ?? null} onPick={pickRow} onRemove={removeRow} emptyText="Nothing watched yet — press + on a strike in the chain" testId="watchlist" /> : <ScanGrid rows={scan} ticker={ticker} preset={preset} onPick={pickTicker} waiting={!scanQuotes.settled && scan.length === 0} />}
              </div>
            </DeskCard>
          </div>
        </div>

        {/* The position card fills the row: open, it is as tall as the row, and the row is as tall as the taller
            column — the card itself when its chart is up, the two lists' 438 floor otherwise — with the slack
            going into its body (PositionDeskCard, the settled box). */}
        <div className={`relative min-h-0 min-w-0 ${folds.position ? 'self-start' : ''}`} data-position-card>
          {/* the ring round the card when it turns to a new case — a sibling of the card, which clips its children */}
          {caseArrived && <div key={caseArrived.n} className="absolute inset-0 z-30 pointer-events-none rounded-md animate-focus-flash" data-case-flash />}
          <DeskCard
            /* the head is the switch between the card's two faces */
            title={
              <span data-card-view={cardView}>
                <CardTabs options={CARD_VIEWS} value={cardView} onChange={setCardView} ariaLabel="Our read, or the simulated returns" />
              </span>
            }
            fold={{ open: !folds.position, onToggle: () => toggleFold('position'), testId: 'position', self: true }}
            actions={
              cardRow || (selected && sel != null) ? (
                /* the card's own contract where it draws a row — its strike AND its date, which the chain may not
                   list */
                <span className="font-mono text-t10 font-semibold tnum text-textSecondary whitespace-nowrap" data-position-head>
                  {(() => {
                    const c = cardRow ? (cardRow.kind === 'watch' ? cardRow.w : cardRow.p) : null;
                    return c ? `${c.ticker} ${fmtStrike(c.strike)}${c.right} · ${monthDay(c.expiry)}` : `${ticker} ${fmtStrike(sel!)}${right}${chain.expiryIso ? ` · ${monthDay(chain.expiryIso)}` : ''}`;
                  })()}
                </span>
              ) : undefined
            }
          >
            <PositionDeskCard
              picked={selected}
              row={cardRow}
              profile={profile}
              ticker={ticker}
              expiryIso={chain.expiryIso}
              chainSpot={chain.spot}
              onWatch={watchIt}
              onClose={cardRow?.kind === 'watch' ? () => closeWatched(cardRow.w.id) : undefined}
              onRemove={cardRow?.kind === 'watch' ? () => removeWatched(cardRow.w.id) : undefined}
              onRemovePosition={cardRow?.kind === 'own' ? () => removePosition(cardRow.p.id) : undefined}
              contractKey={`${ticker}-${sel ?? 'none'}-${right}-${chain.expiry.dte}`}
              theCase={selected && sel != null ? drillCase(selected) : undefined}
              face={cardView}
              caseForRow={caseForRow}
              quoteFor={quoteFor}
            />
          </DeskCard>
        </div>

        {/* THE SASH, in the gap under the window — invisible until the pointer finds it, like
            every sash on the desk */}
        {!belowLg && (
          <span
            onPointerDown={onSashDown}
            onDoubleClick={resetSash}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to make the chart and the chain taller or shorter — double-click to reset"
            title="Drag to resize the window · double-click to reset"
            className="absolute inset-x-0 h-2.5 z-30 cursor-row-resize hover:bg-ink/[0.10] transition-colors"
            style={{ top }}
            data-weigher-sash
          />
        )}
      </div>

      {/* Portal, not a plain fixed div: the cards' backdrop-blur creates a containing block for position:fixed, so
          an in-place overlay would size itself to the card. Escaping to <body> is the only way out (the ladder
          widget learned this first). */}
      {full === 'chart' &&
        createPortal(
          /* The Pulse takeover's grammar: the chart IS the screen — no
             padding frame, no Back row; the strip inside chartBody carries
             every control plus the minimize door, and Esc still works. */
          <div
            className={`fixed inset-0 z-[80] bg-canvas flex flex-col animate-soft-in transition-opacity duration-200 ease-out ${
              closing ? 'opacity-0' : ''
            }`}
            /* the script editor's dock takes the right edge while it is open (data/editorDock.ts) */
            style={DOCK_ROOM}
          >
            <div className="flex-1 min-h-0">{chartBody}</div>
          </div>,
          document.body
        )}
      {full === 'chain' &&
        createPortal(
          /* The chain is the screen — no frame round it, no border, no rounding: the chart's takeover grammar,
             edge to edge */
          <div
            className={`fixed inset-0 z-[80] bg-panel flex flex-col animate-soft-in transition-opacity duration-200 ease-out ${
              closing ? 'opacity-0' : ''
            }`}
          >
            <div className="flex-1 min-h-0 bg-panel overflow-hidden flex flex-col">
              {/* ONE row — the chain's own controls, and the minimize door. */}
              <div className="shrink-0 flex items-center gap-2 px-2.5 py-1.5 border-b border-ink/[0.05]">
                <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5 min-w-0">{chainActions}</span>
                <button
                  onClick={close}
                  title="Exit fullscreen (Esc)"
                  className="p-1 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.05] transition-colors"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 min-h-0">{chainBody}</div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default WeigherDesk;
