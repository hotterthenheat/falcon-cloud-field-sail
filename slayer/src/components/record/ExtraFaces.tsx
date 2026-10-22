import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { type ColDef, type ICellRendererParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../ui/houseGrid';
import CompanyLogo from '../ui/CompanyLogo';
import { tickerName } from '../../data/tickers';
import { lookup } from '../../data/universe';
import { buildHoldings, type HoldingRow, type SectorFlowRow } from '../../data/fileBooks';
import { useLiveRecord } from '../../data/liveRecord';

/*
  The second face under the grid Congress and Insiders already own.
  Same house grid as the tape above — not a second table.
*/

const defaultColDef = { sortable: true, resizable: true, suppressMovable: true };

const MemberCell = ({ data }: ICellRendererParams<HoldingRow>) =>
  data ? (
    <span className="flex flex-col leading-tight min-w-0 text-left" data-open-member={data.memberId}>
      <span className="text-[12px] font-semibold text-textPrimary truncate">{data.member}</span>
      <span className="font-mono text-[10px] text-textMuted">{data.seat}</span>
    </span>
  ) : null;

const HoldName = ({ data }: ICellRendererParams<HoldingRow>) =>
  data ? (
    <span className="flex items-center gap-2 min-w-0 w-full h-full overflow-hidden">
      <CompanyLogo ticker={data.ticker} size={16} />
      <span className="flex flex-col leading-tight min-w-0">
        <span className="font-mono text-[12px] font-bold text-textPrimary">{data.ticker}</span>
        <span className="text-[10px] text-textMuted truncate">{tickerName(data.ticker)}</span>
      </span>
    </span>
  ) : null;

const BracketCell = ({ data }: ICellRendererParams<HoldingRow>) => (data ? <span className="font-mono text-[11px] tnum text-textPrimary">{data.bracket}</span> : null);
const OwnerCell = ({ data }: ICellRendererParams<HoldingRow>) => (data ? <span className={`font-mono text-[8px] uppercase tracking-widest ${data.owner === 'Self' ? 'text-textPrimary' : 'text-textMuted'}`}>{data.owner}</span> : null);

export const CongressHoldings = () => {
  const navigate = useNavigate();
  const record = useLiveRecord();
  const rows = useMemo(() => {
    if (record.congress.status !== 'live') return [];
    return buildHoldings(record.congress.trades);
  }, [record.congress]);
  const columnDefs = useMemo<ColDef<HoldingRow>[]>(
    () => [
      { headerName: 'Member', field: 'member', cellDataType: false, flex: 1.2, minWidth: 140, cellRenderer: MemberCell, headerTooltip: 'Who still holds it, from the filings in this window' },
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
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>What they still hold</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">open purchases, no later full sale · a row opens that member’s book</span>
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle">
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<HoldingRow>
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('No holding on this cut')}
            columnDefs={columnDefs}
            defaultColDef={defaultColDef}
            getRowId={p => `${p.data.member}-${p.data.ticker}`}
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

const SectorCell = ({ data }: ICellRendererParams<SectorFlowRow>) => (data ? <span className="text-[12px] font-semibold text-textPrimary">{data.sector}</span> : null);
const BuysCell = ({ data }: ICellRendererParams<SectorFlowRow>) => (data ? <span className="font-mono text-[11px] tnum text-bull">{data.buys}</span> : null);
const SalesCell = ({ data }: ICellRendererParams<SectorFlowRow>) => (data ? <span className="font-mono text-[11px] tnum text-bear">{data.sales}</span> : null);
const NetCell = ({ data }: ICellRendererParams<SectorFlowRow>) => (data ? <span className={`font-mono text-[11px] tnum ${data.netM > 0 ? 'text-bull' : data.netM < 0 ? 'text-bear' : 'text-textMuted'}`}>{data.netM > 0 ? '+' : ''}{data.netM.toFixed(1)}M</span> : null);

export const InsiderSectorFlow = () => {
  const record = useLiveRecord();
  const rows = useMemo(() => {
    if (record.insiders.status !== 'live') return [];
    const map = new Map<string, SectorFlowRow>();
    for (const t of record.insiders.trades) {
      if (t.code !== 'P' && t.code !== 'S') continue;
      const sector = lookup(t.ticker)?.sector ?? 'Other';
      const row = map.get(sector) ?? { sector, buys: 0, sales: 0, netM: 0 };
      if (t.kind === 'BUY') row.buys += 1;
      else row.sales += 1;
      row.netM += (t.kind === 'BUY' ? t.value : -t.value) / 1e6;
      map.set(sector, row);
    }
    return [...map.values()]
      .map(r => ({ ...r, netM: Number(r.netM.toFixed(1)) }))
      .sort((a, b) => Math.abs(b.netM) - Math.abs(a.netM));
  }, [record.insiders]);
  const columnDefs = useMemo<ColDef<SectorFlowRow>[]>(
    () => [
      { headerName: 'Sector', field: 'sector', flex: 1.4, minWidth: 160, cellRenderer: SectorCell, headerTooltip: 'The filings, added up by sector' },
      { headerName: 'Buys', field: 'buys', width: 90, cellRenderer: BuysCell, type: 'rightAligned', headerTooltip: 'Open-market buys in the sector' },
      { headerName: 'Sales', field: 'sales', width: 90, cellRenderer: SalesCell, type: 'rightAligned', headerTooltip: 'Open-market sales in the sector' },
      { headerName: 'Net', field: 'netM', width: 100, cellRenderer: NetCell, type: 'rightAligned', headerTooltip: 'Buys against sales, in millions' },
    ],
    [],
  );
  return (
    <div data-insider-sectors>
      <div className="px-5 border-t border-borderSubtle/60">
        <div className="h-[26px] flex items-center gap-3 text-[10px] font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
          <span>By sector</span>
          <span className="normal-case tracking-normal font-normal text-[10px] text-textSecondary">the same filings, added up · a chosen buy still counts more than a scheduled sale, and the net says so</span>
        </div>
      </div>
      <div className="slayer-board border-t border-borderSubtle">
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<SectorFlowRow>
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={rows}
            overlayNoRowsTemplate={noRows('No sector on this cut')}
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
    </div>
  );
};
