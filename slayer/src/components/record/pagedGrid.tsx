import { useRef, useState } from 'react';
import type { AgGridReact } from 'ag-grid-react';
import { PageBar } from '../ui/PageBar';


/* Fifty rows a page for the long books; the grid pages itself, so a sort still runs over every row. */
const GRID_PAGE = 50;
export function usePagedGrid<T>() {
  const ref = useRef<AgGridReact<T> | null>(null);
  const [at, setAt] = useState({ page: 0, pages: 1 });
  const props = {
    ref,
    pagination: true,
    paginationPageSize: GRID_PAGE,
    paginationPageSizeSelector: false as const,
    suppressPaginationPanel: true,
    onPaginationChanged: (e: { api: { paginationGetCurrentPage: () => number; paginationGetTotalPages: () => number } }) => {
      const page = e.api.paginationGetCurrentPage();
      const pages = Math.max(1, e.api.paginationGetTotalPages() || 1);
      setAt(prev => (prev.page === page && prev.pages === pages ? prev : { page, pages }));
    },
  };
  const bar = (count: number, testId: string) =>
    count > GRID_PAGE ? <PageBar page={at.page} pages={Math.max(at.pages, Math.ceil(count / GRID_PAGE))} onPage={n => ref.current?.api.paginationGoToPage(n)} testId={testId} /> : null;
  return { props, bar };
}

/* Under 640px a grid scrolls sideways in its own box with its first column pinned. Spread on every Dossier grid. */
type PinApi = { api: { isDestroyed?: () => boolean; getAllDisplayedColumns: () => { getColId: () => string; getPinned: () => unknown }[]; applyColumnState: (p: { state: { colId: string; pinned: 'left' | null }[] }) => unknown } };
const pinFirst = (e: PinApi) => {
  if (typeof window === 'undefined' || window.innerWidth >= 640 || e.api.isDestroyed?.()) return;
  const cols = e.api.getAllDisplayedColumns();
  const first = cols[0];
  if (first && !first.getPinned()) e.api.applyColumnState({ state: [{ colId: first.getColId(), pinned: 'left' }] });
};
/* new column defs (a column that appears once its data lands) reset the column state, so the pin is laid again then */
export const phonePin = { onFirstDataRendered: pinFirst, onRowDataUpdated: pinFirst, onNewColumnsLoaded: pinFirst };
