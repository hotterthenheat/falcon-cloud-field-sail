import { useMemo, useState } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME } from '../ui/houseGrid';
import DropdownSelect, { type DropdownOption } from '../ui/DropdownSelect';
import { CONTROLS_LINE } from '../trace/TraceBox';
import { STATEMENT_PERIODS, buildStatements, type StatementLine } from '../../data/companyFile';

/*
  The three statements under a name. One desk: a card picks the statement,
  the grid is the lines, four quarters across. Figures are millions.
*/

type Which = 'income' | 'balance' | 'cash';

const OPTIONS: DropdownOption<Which>[] = [
  { value: 'income', label: 'Income', hint: 'Revenue down to earnings' },
  { value: 'balance', label: 'Balance sheet', hint: 'What it owns and what it owes' },
  { value: 'cash', label: 'Cash flow', hint: 'Operations, investing, financing' },
];

const money = (n: number, eps: boolean) => {
  if (eps) return n.toFixed(2);
  const sign = n < 0 ? '−' : '';
  const a = Math.abs(n);
  if (a >= 1000) return `${sign}$${(a / 1000).toFixed(1)}B`;
  return `${sign}$${a.toFixed(0)}M`;
};

const Statements = ({ ticker }: { ticker: string }) => {
  const book = useMemo(() => buildStatements(ticker), [ticker]);
  const [which, setWhich] = useState<Which>('income');
  const lines = book[which];
  const lead = which === 'income' ? 'Total revenue' : which === 'balance' ? 'Total assets' : 'Cash from operations';
  const leadLine = lines.find(l => l.name === lead) ?? lines[0];
  const latest = leadLine?.values[3] ?? 0;
  const cols = useMemo<ColDef<StatementLine>[]>(() => {
    const periodCols: ColDef<StatementLine>[] = STATEMENT_PERIODS.map((period, i) => ({
      headerName: period,
      colId: period,
      width: 110,
      type: 'rightAligned',
      valueGetter: p => p.data?.values[i] ?? 0,
      cellRenderer: ({ data }: ICellRendererParams<StatementLine>) => {
        if (!data) return null;
        const n = data.values[i] ?? 0;
        return <span className={`font-mono text-[11px] tnum ${n < 0 ? 'text-bear' : 'text-textPrimary'}`}>{data.name === 'Diluted shares' ? `${n.toFixed(0)}M` : money(n, data.name === 'EPS')}</span>;
      },
    }));
    return [{ headerName: 'Line', field: 'name', flex: 1.4, minWidth: 180, cellRenderer: ({ data }: ICellRendererParams<StatementLine>) => (data ? <span className="text-[12px] text-textPrimary">{data.name}</span> : null) }, ...periodCols];
  }, []);
  return (
    <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" data-statements={ticker}>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">The statements</h3>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">Four quarters, oldest first. A minus is cash out, or a loss.</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-[10px] text-textMuted">Latest {lead.toLowerCase()}</dt>
            <dd className={`mt-0.5 font-mono text-[12px] tnum whitespace-nowrap ${latest < 0 ? 'text-bear' : 'text-textPrimary'}`}>{money(latest, false)}</dd>
          </div>
        </dl>
      </div>
      <div className={`px-5 pb-2 ${CONTROLS_LINE}`}>
        <DropdownSelect label="Statement" value={which} options={OPTIONS} onChange={setWhich} title="Which statement" testId="statement-which" />
      </div>
      <p className="px-5 pb-3 text-[12px] leading-relaxed text-textSecondary">
        {lead} in {STATEMENT_PERIODS[3]} was {money(leadLine?.values[3] ?? 0, false)}. The four quarters read left to right, oldest first. A minus is cash out, or a loss.
      </p>
      <div className="slayer-board border-t border-borderSubtle" data-statement-grid={which}>
        <AgGridProvider modules={GRID_MODULES}>
          <AgGridReact<StatementLine>
            theme={GRID_THEME}
            domLayout="autoHeight"
            rowData={lines}
            columnDefs={cols}
            defaultColDef={{ sortable: false, resizable: true, suppressMovable: true }}
            getRowId={p => p.data.name}
            suppressCellFocus
            animateRows={false}
          />
        </AgGridProvider>
      </div>
    </div>
  );
};

export default Statements;
