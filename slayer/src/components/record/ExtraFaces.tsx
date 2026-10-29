import { useMemo } from 'react';
import { ownerWord } from '../../data/whalesMap';
import { CoSub } from './CoName';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../ui/houseGrid';
import CompanyLogo from '../ui/CompanyLogo';
import { tickerName } from '../../data/tickers';
import { buildHoldings, type HoldingRow } from '../../data/fileBooks';
import type { InsiderTrade, ReportOwner } from '../../types/record';
import { useCongressBook } from '../../data/liveRecord';
import { phonePin } from './pagedGrid';

/*
  The second face under the grid Congress and Insiders already own.
  Same house grid as the tape above — not a second table.
*/

const defaultColDef = { sortable: true, resizable: true, suppressMovable: true };

const MemberCell = ({ data }: ICellRendererParams<HoldingRow>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-member={data.memberId}>
      <span className="text-t12 font-semibold text-textPrimary truncate">{data.member}</span>
      <span className="font-mono text-t10 text-textMuted">{data.seat}</span>
    </span>
  ) : null;

const HoldName = ({ data }: ICellRendererParams<HoldingRow>) =>
  data && !data.ticker ? (
    <span className="flex items-center min-w-0 w-full h-full overflow-hidden" title={data.asset}>
      <span className="text-t12 text-textPrimary truncate">{data.asset}</span>
    </span>
  ) : data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-t12 font-bold text-textPrimary">{data.ticker}</span>
        <CoSub ticker={data.ticker} vendor={false} />
      </span>
    </span>
  ) : null;

const BracketCell = ({ data }: ICellRendererParams<HoldingRow>) => (data ? <span className="font-mono text-t11 tnum text-textPrimary">{data.bracket}</span> : null);
const OwnerCell = ({ data }: ICellRendererParams<HoldingRow>) => (data ? <span className={`font-mono text-t8 uppercase tracking-widest ${data.owner === 'Self' ? 'text-textPrimary' : 'text-textMuted'}`}>{ownerWord(data.owner as ReportOwner)}</span> : null);

export const CongressHoldings = ({ since }: { since?: string | null } = {}) => {
  const navigate = useNavigate();
  const congress = useCongressBook();
  const rows = useMemo(() => {
    if (congress.status !== 'live') return [];
    return buildHoldings(congress.trades);
  }, [congress]);
  const columnDefs = useMemo<ColDef<HoldingRow>[]>(
    () => [
      { headerName: 'Member', field: 'member', cellDataType: false, flex: 1.2, minWidth: 140, cellRenderer: MemberCell, headerTooltip: 'The member who reported the purchase — the reports read show no full sale of it since' },
      { headerName: 'Name', field: 'ticker', flex: 1.3, minWidth: 170, cellRenderer: HoldName, headerTooltip: 'The holding' },
      { headerName: 'Bracket', field: 'bracket', flex: 1.2, minWidth: 180, cellRenderer: BracketCell, headerTooltip: 'The disclosed bracket — never a midpoint' },
      { headerName: 'Owner', field: 'owner', width: 100, cellRenderer: OwnerCell, headerTooltip: "Whose holding — the member's own, or a joint account" },
    ],
    [],
  );
  const open = (e: RowClickedEvent<HoldingRow>) => {
    if (!e.data) return;
    navigate(`/dossier/congress/${e.data.memberId}`);
  };
  return (
    <div data-congress-holdings>
      <div className="px-5 border-t border-borderSubtle/60">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>Bought, no sale reported since</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">{/* (round 9) which window it covers — every report read, not the window above */}over every report read{since ? `, trades since ${since.slice(5, 7)}/${since.slice(8, 10)}/${since.slice(2, 4)}` : ''} — not only the window above · purchases with no later sale of the same asset in them (a filing rarely says full or partial) · not a holdings disclosure · a row opens that member’s book</span>
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle">
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<HoldingRow>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows(congress.status === 'live' ? 'No holding on this cut' : congress.status === 'sim' ? 'This read did not land' : 'Reading the reports…')}
            key={congress.status}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.key}
            onRowClicked={open}
            rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
            suppressCellFocus
            animateRows={false}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
          />
        </AgGridProvider>
      </div>
    </div>
  );
};

interface SectorRow {
  sector: string;
  buys: number;
  sales: number;
  boughtM: number;
  soldM: number;
  netM: number;
}
const SectorCell = ({ data }: ICellRendererParams<SectorRow>) => (data ? <span className="text-t12 font-semibold text-textPrimary">{data.sector}</span> : null);
const BuysCell = ({ data }: ICellRendererParams<SectorRow>) => (data ? <span className="font-mono text-t11 tnum text-bull">{data.buys.toLocaleString('en-US')} <span className="text-textMuted">· {fmtM(data.boughtM)}</span></span> : null);
const SalesCell = ({ data }: ICellRendererParams<SectorRow>) => (data ? <span className="font-mono text-t11 tnum text-bear">{data.sales.toLocaleString('en-US')} <span className="text-textMuted">· {fmtM(data.soldM)}</span></span> : null);
const NetCell = ({ data }: ICellRendererParams<SectorRow>) => (data ? <span className={`font-mono text-t11 tnum ${data.netM > 0 ? 'text-bull' : data.netM < 0 ? 'text-bear' : 'text-textMuted'}`}>{data.netM > 0 ? '+' : data.netM < 0 ? '−' : ''}{fmtM(Math.abs(data.netM))}</span> : null);
const fmtM = (m: number) => (m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : m >= 1 ? `$${m.toFixed(1)}M` : `$${Math.round(m * 1000)}K`);

/** The vendor's sector words, said the house way; a filing without one is "Not stated", never folded into a catch-all */
const SECTOR_WORD: Record<string, string> = {
  healthcare: 'Health Care',
  'financial services': 'Financials',
  technology: 'Technology',
  'real estate': 'Real Estate',
  industrials: 'Industrials',
  energy: 'Energy',
  'consumer cyclical': 'Consumer Discretionary',
  'basic materials': 'Materials',
  'consumer defensive': 'Consumer Staples',
  utilities: 'Utilities',
  'communication services': 'Communication',
};
const sectorWord = (raw?: string) => (raw ? SECTOR_WORD[raw.trim().toLowerCase()] ?? raw.trim() : 'Not stated');

/* BY SECTOR, ON THE PAGE'S OWN CUT (the data audit, 2026-10-22): the table summed the whole feed, every window and
   cut ignored, under the house universe's sectors — 2,508 buys and 3,047 sales fell to "Other". It now adds up the
   rows the grid above shows (window, role and names applied), by Unusual Whales' own sector field. */
export const InsiderSectorFlow = ({ trades, windowDays, state = 'read' }: { trades: readonly InsiderTrade[]; windowDays: number; state?: 'reading' | 'failed' | 'read' }) => {
  const rows = useMemo(() => {
    const map = new Map<string, SectorRow>();
    for (const t of trades) {
      if (t.code !== 'P' && t.code !== 'S') continue;
      const sector = sectorWord(t.sector);
      const row = map.get(sector) ?? { sector, buys: 0, sales: 0, boughtM: 0, soldM: 0, netM: 0 };
      if (t.kind === 'BUY') {
        row.buys += 1;
        row.boughtM += t.value / 1e6;
      } else {
        row.sales += 1;
        row.soldM += t.value / 1e6;
      }
      row.netM = row.boughtM - row.soldM;
      map.set(sector, row);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.netM) - Math.abs(a.netM));
  }, [trades]);
  const columnDefs = useMemo<ColDef<SectorRow>[]>(
    () => [
      { headerName: 'Sector', field: 'sector', flex: 1.4, minWidth: 160, cellRenderer: SectorCell, headerTooltip: "The company's sector as Unusual Whales files it" },
      { headerName: 'Buys', field: 'boughtM', width: 150, cellRenderer: BuysCell, type: 'rightAligned', headerTooltip: 'Open-market purchases in the sector on this cut, and the dollars' },
      { headerName: 'Sales', field: 'soldM', width: 150, cellRenderer: SalesCell, type: 'rightAligned', headerTooltip: 'Open-market sales in the sector on this cut, and the dollars' },
      { headerName: 'Net', field: 'netM', width: 110, cellRenderer: NetCell, type: 'rightAligned', sort: 'desc', comparator: (a: number, b: number) => Math.abs(a) - Math.abs(b), headerTooltip: 'Dollars bought minus dollars sold — every dollar counts the same, chosen or planned. Largest either way first' },
    ],
    [],
  );
  return (
    <div data-insider-sectors>
      <div className="px-5 border-t border-borderSubtle/60">
        <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>By sector</span>
          <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary">the open-market rows on this cut, last {windowDays} days, added up by sector · the net is dollars bought minus dollars sold, a planned sale counted like a chosen one</span>
        </div>
      </div>
      {/* an empty cut says so in a sentence — never a grid of headers over nothing (the retail test, 2026-10-23: GME) */}
      {rows.length === 0 ? (
        <p className="px-5 py-3 border-t border-borderSubtle text-t12 text-textSecondary" data-insider-sectors-empty>
          {state === 'reading'
            ? 'Reading the filings — the sectors add up once the open-market rows land.'
            : state === 'failed'
              ? 'This read did not land, so there is nothing to add up by sector yet.'
              : `No open-market purchase or sale on this cut in the last ${windowDays} days, so there is nothing to add up by sector.`}
        </p>
      ) : (
      <div className="slayer-board border-t border-borderSubtle">
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<SectorRow>
            {...phonePin}
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('No open-market trade on this cut')}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => p.data.sector}
            suppressCellFocus
            animateRows={false}
            tooltipShowDelay={350}
            tooltipHideDelay={8000}
          />
        </AgGridProvider>
      </div>
      )}
    </div>
  );
};
