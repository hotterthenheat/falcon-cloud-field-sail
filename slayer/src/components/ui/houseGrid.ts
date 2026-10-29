/* The one AG Grid setup: the modules the grids use and a Quartz theme whose values are the house CSS variables,
   so a theme flip re-inks every grid. A feature outside GRID_MODULES needs its module added here (dev's ValidationModule names it). */

import {
  CellStyleModule,
  ClientSideRowModelApiModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  EventApiModule,
  ExternalFilterModule,
  PaginationModule,
  RenderApiModule,
  RowApiModule,
  RowAutoHeightModule,
  RowSelectionModule,
  RowStyleModule,
  ScrollApiModule,
  TooltipModule,
  ValidationModule,
  themeQuartz,
  type Module,
} from 'ag-grid-community';

export const GRID_MODULES: Module[] = [
  ClientSideRowModelModule,
  ClientSideRowModelApiModule,
  RowApiModule,
  ColumnApiModule,
  ScrollApiModule,
  RenderApiModule,
  EventApiModule,
  PaginationModule,
  RowSelectionModule,
  ExternalFilterModule,
  RowStyleModule,
  CellStyleModule,
  TooltipModule,
  RowAutoHeightModule,
  ColumnAutoSizeModule,
  ...(import.meta.env?.DEV ? [ValidationModule] : []),
];

export const GRID_THEME = themeQuartz.withParams({
  backgroundColor: 'rgb(var(--panel))',
  foregroundColor: 'rgb(var(--text-primary))',
  headerBackgroundColor: 'rgb(var(--chip))',
  headerTextColor: 'rgb(var(--grid-head))',
  headerFontSize: 11,
  headerFontWeight: 600,
  headerHeight: 30,
  rowHeight: 44,
  fontSize: 11,
  fontFamily: 'inherit',
  borderColor: 'rgb(var(--border-subtle))',
  rowBorder: true,
  columnBorder: false,
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  headerColumnBorder: false,
  rowHoverColor: 'rgb(var(--ink) / 0.03)',
  selectedRowBackgroundColor: 'rgb(var(--silver) / 0.06)',
  accentColor: 'rgb(var(--silver))',
  cellHorizontalPadding: 12,
  iconSize: 12,
  /* the grid's scrollbars and form controls follow the page's color-scheme */
  browserColorScheme: 'inherit',
});

/** The house empty-grid line, in place of the grid's own "No Rows To Show". */
export const noRows = (text: string): string =>
  `<span class="font-mono text-t10 uppercase tracking-widest text-textMuted">${text}</span>`;
