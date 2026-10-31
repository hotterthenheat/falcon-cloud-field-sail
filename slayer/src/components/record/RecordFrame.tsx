/* The skeleton every Dossier book shares: the panel, the head (title, guide door, one line, the facts), the controls
   folded on a phone, a one-line summary that opens on a tap, the cards to know, and the grid (phone cards under 640px). */

import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { type ColDef, type GetRowIdParams, type RowClickedEvent } from 'ag-grid-community';
import { AgGridProvider, AgGridReact, type AgGridReactProps } from 'ag-grid-react';
import GuideFocus, { GuideDoor } from '../ui/GuideFocus';
import { CONTROLS_LINE } from '../trace/TraceBox';
import { GRID_MODULES, GRID_THEME, noRows } from '../ui/houseGrid';
import { PhoneCards, usePhoneCards } from './PhoneCards';
import { phonePin, usePagedGrid } from './pagedGrid';
import { keptWords } from '../../data/feedStore';
import { statHelp } from './statHelp';

/** The book's panel */
export const RecordPanel = ({ testId, attrs, children }: { testId: string; attrs?: Record<string, string | number | boolean | undefined>; children: ReactNode }) => (
  <div className="relative border border-borderSubtle rounded-md overflow-hidden bg-panel flex flex-col" {...{ [`data-${testId}`]: true, ...attrs }}>
    {children}
  </div>
);

/** "as of 10:42 ET" while the book on screen is the answers this browser kept */
export const KeptNote = ({ at, testId }: { at: number | null | undefined; testId?: string }) =>
  at ? (
    <span className="font-mono text-t9 uppercase tracking-widest text-warn whitespace-nowrap" title="The answers this browser kept, shown until the fresh read lands" data-kept-note={testId ?? ''}>
      as of {keptWords(at)} · refreshing
    </span>
  ) : null;

/** One head figure: the label (its meaning on hover) over the value */
export const HeadFact = ({ label, tip, testId, partial, tone, children }: { label: string; tip?: string; testId?: string; partial?: boolean; tone?: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-t10 text-textMuted whitespace-nowrap cursor-help" title={tip ?? statHelp(label)}>
      {label}
    </dt>
    <dd className={`mt-0.5 font-mono text-t12 tnum whitespace-nowrap ${tone ?? 'text-textPrimary'} ${partial ? 'opacity-60' : ''}`} data-head-fact={testId} data-partial={partial ? '' : undefined}>
      {children}
    </dd>
  </div>
);

interface GuideProps {
  title: string;
  /** The door's hover */
  door: string;
  testId: string;
  body: ReactNode;
}

/** The head: the title with its guide door and the kept note, one line under it, a status line, the facts at the right */
export function RecordHead({ title, guide, line, status, kept, facts, children }: { title: ReactNode; guide?: GuideProps; line?: ReactNode; status?: ReactNode; kept?: number | null; facts?: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {guide && (
        <GuideFocus open={open} onClose={() => setOpen(false)} title={guide.title} testId={guide.testId} viewport>
          {guide.body}
        </GuideFocus>
      )}
      <div className="px-5 pt-4 pb-3 max-sm:px-4 max-sm:pt-3 max-sm:pb-2 flex items-start gap-x-6 gap-y-2 flex-wrap" data-record-head>
        <div className="min-w-[min(18rem,100%)] flex-1">
          <div className="min-h-6 flex items-center gap-3 flex-wrap">
            <h3 className="text-t15 font-semibold leading-tight text-textPrimary min-w-0 truncate">{title}</h3>
            {guide && <GuideDoor open={open} onClick={() => setOpen(v => !v)} title={guide.door} testId={guide.testId} />}
            <KeptNote at={kept} />
          </div>
          {line ? <p className="mt-0.5 text-t11 text-textMuted sm:truncate">{line}</p> : null}
          {status}
          {children}
        </div>
        {facts ? <dl className="flex flex-wrap gap-x-6 gap-y-2 min-w-0 max-w-full">{facts}</dl> : null}
      </div>
    </>
  );
}

/** On a phone the controls, the summary and the cards fold behind one row, so the first row of data is on the first screen */
export function PhoneFold({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  const phone = usePhoneCards();
  const [open, setOpen] = useState(false);
  if (!phone) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="mx-4 mb-2 min-h-10 px-3 rounded border border-borderMuted font-mono text-t10 uppercase tracking-widest text-textSecondary flex items-center justify-between"
        data-phone-more={testId}
        data-open={open ? 'open' : 'closed'}
      >
        <span>{label}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && children}
    </>
  );
}

/** The controls row */
export const Controls = ({ testId, children }: { testId: string; children: ReactNode }) => (
  <div className={`px-5 pb-2 max-sm:px-4 ${CONTROLS_LINE}`} {...{ [`data-${testId}-controls`]: true }}>
    {children}
  </div>
);

/** The read in a line: one line, the rest on a tap */
export function Summary({ testId, children, more }: { testId: string; children: ReactNode; more?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-5 pb-2 max-sm:px-4 flex items-start gap-2" data-record-summary={testId}>
      <p className={`min-w-0 flex-1 text-t12 leading-relaxed text-textSecondary ${open ? '' : 'line-clamp-1'}`} {...{ [`data-${testId}-sentence`]: true }}>
        {children}
        {open && more ? <span className="block mt-1 text-t11 text-textMuted">{more}</span> : null}
      </p>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="shrink-0 h-6 px-1.5 font-mono text-t9 uppercase tracking-widest text-textMuted hover:text-textPrimary transition-colors" data-summary-more={testId}>
        {open ? 'less' : 'more'}
      </button>
    </div>
  );
}

/** The cards to know: a titled strip, every card across on a wide desk */
export const ToKnow = ({ title, sub, testId, empty, count, children }: { title: string; sub?: string; testId: string; empty?: string | null; count: number; children: ReactNode }) => (
  <div className="px-5 pb-3 max-sm:px-4 border-t border-borderSubtle/60" {...{ [`data-${testId}-to-know`]: true }}>
    <div className="h-[26px] flex items-center gap-3 text-t10 font-semibold uppercase tracking-widest text-textPrimary max-sm:h-auto max-sm:flex-col max-sm:items-start max-sm:gap-0.5 max-sm:py-1.5">
      <span>{title}</span>
      {sub ? <span className="normal-case tracking-normal font-normal text-t10 text-textSecondary truncate">{sub}</span> : null}
    </div>
    {empty ? (
      <div className="h-[70px] flex items-center font-mono text-t10 uppercase tracking-widest text-textMuted">{empty}</div>
    ) : (
      <div className="grid gap-2 grid-cols-2 max-sm:[&>*:nth-child(n+3)]:hidden sm:grid-cols-3 xl:grid-cols-[repeat(var(--cards),minmax(0,1fr))]" style={{ '--cards': Math.max(1, count) } as CSSProperties}>
        {children}
      </div>
    )}
  </div>
);

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
