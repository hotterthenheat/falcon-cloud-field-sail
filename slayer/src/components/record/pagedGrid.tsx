import { useRef, useState } from 'react';
import type { AgGridReact } from 'ag-grid-react';
import { PageBar } from '../ui/PageBar';


/* FIFTY ROWS A PAGE for the long books (the Dossier sweep, 2026-10-22): twenty houses file ~1,700 lines and a fund holds
   ~500, and a grid grown to all of them made pages tens of thousands of pixels tall. The grid pages itself, so the sort
   still runs over every row; the house page bar sits under it. */
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
