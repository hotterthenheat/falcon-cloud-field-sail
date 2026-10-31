/* The skeleton every Dossier book shares: the panel, the head (title, guide door, one line, the facts), the controls
   folded on a phone, a one-line summary that opens on a tap, the cards to know (recordHead.tsx, re-exported here), and
   the grid (phone cards under 640px). */

import { type ReactNode } from 'react';
import { type ColDef, type GetRowIdParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact, type AgGridReactProps } from 'ag-grid-react';
import { GRID_MODULES, GRID_THEME, noRows } from '../ui/houseGrid';
import { PhoneCards, usePhoneCards } from './PhoneCards';
import { phonePin, usePagedGrid } from './pagedGrid';

export { Controls, HeadFact, KeptNote, PhoneFold, RecordHead, RecordPanel, Summary, ToKnow } from './recordHead';

/** The book's grid: fifty rows a page on a desk, cards on a phone */
export function RecordGrid<T>({
  testId,
  rows,
  rowKey,
  card,
  onOpen,
  empty,
  columnDefs,
  defaultColDef,
  gridProps,
}: {
  testId: string;
  rows: T[];
  rowKey: (r: T) => string;
  card: (r: T) => ReactNode;
  onOpen?: (r: T) => void;
  empty: string;
  columnDefs: ColDef<T>[];
  defaultColDef?: ColDef<T>;
  gridProps?: Partial<AgGridReactProps<T>>;
}) {
  const phone = usePhoneCards();
  const paged = usePagedGrid<T>();
  return (
    <div className="slayer-board border-t border-borderSubtle" {...{ [`data-${testId}-grid`]: true }}>
      {phone ? (
        <PhoneCards rows={rows} rowKey={rowKey} card={card} onOpen={onOpen} empty={empty} testId={testId} resetKey={rows} />
      ) : (
        <>
          <AgGridProvider modules={GRID_MODULES}>
            <AgGridReact<T>
              {...phonePin}
              {...paged.props}
              theme={GRID_THEME}
              domLayout="autoHeight"
              rowData={rows}
              overlayNoRowsTemplate={noRows(empty)}
              /* the overlay is read once, so a new state is a new grid */
              key={empty}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef ?? { sortable: true, resizable: true, suppressMovable: true }}
              getRowId={(p: GetRowIdParams<T>) => rowKey(p.data)}
              onRowClicked={onOpen ? (e: RowClickedEvent<T>) => e.data && onOpen(e.data) : undefined}
              rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
              suppressCellFocus
              animateRows
              tooltipShowDelay={350}
              tooltipHideDelay={8000}
              {...gridProps}
            />
          </AgGridProvider>
          {paged.bar(rows.length, `${testId}-grid`)}
        </>
      )}
    </div>
  );
}
