/* The ranked calls under the board's head: cards two across, or the same rows as a grid. The box grows with what
   the scan found and the page scrolls. */

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Setup } from '../../types/compass';
import type { Column } from '../ui/DataTable';
import ContractLabel from '../ui/ContractLabel';
import { TraceGrid, RestFoot, useRestCap, ROWS_AT_REST } from '../trace/TraceBox';
import SetupScanCard, { ownExpiry } from './SetupScanCard';
import { BOOK_NAME } from '../../data/compassParams';
import { STOP_KEEP } from '../../data/contractQuote';
import type { Signal } from '../../data/compassLedger';

type ScanLayout = 'cards' | 'table';

type Ranked = Setup & { rank: number; spark?: number[] };

interface SetupScanBoardProps {
  /** Flat, already-ranked (rank = index + 1). */
  setups: (Setup & { spark?: number[] })[];
  layout: ScanLayout;
  selectedId: string | null;
  onSelect: (setup: Setup) => void;
  onAnalysis: (setup: Setup) => void;
  /** Real-date chip for the active sleeve, e.g. "08/04/26". */
  expiryChip: string;
  /** What the empty board says while a sweep is still reading. */
  emptyLabel?: string;
  /** The call on record behind a card, when the board holds the session's record (a past session's calls) */
  callOf?: (id: string) => Signal | undefined;
  /** The card lit by the session's events or chart */
  hotId?: string | null;
}

const WIDTHS: Record<string, number> = { rank: 56, expiry: 150, book: 90, sigma: 110, premium: 96, breaks: 120, open: 72 };
const TOOLTIPS: Record<string, string> = {
  sigma: 'One standard deviation of the underlying to expiry, from the quote implied vol. A dash means the quote had no vol.',
  premium: 'The ask on this quote.',
  breaks: `${BOOK_NAME.A} and ${BOOK_NAME.B}: 0.4678 times the ask. ${BOOK_NAME.C} has no stop.`,
  book: `${BOOK_NAME.A} is the near book. ${BOOK_NAME.B} is the far book. ${BOOK_NAME.C} is the close lottery.`,
};

const STEP = 80;
/** Past this, "show all" would mount every cell at once. Reveal a step at a time. */
const HUGE = 400;

const MoreFoot = ({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) => {
  const open = shown < total;
  const next = Math.min(STEP, total - shown);
  return (
    <div className="px-5 py-2.5 border-t border-borderSubtle flex items-center gap-2 text-t11 text-textSecondary">
      <span>{open ? `The first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} setups` : `All ${total.toLocaleString('en-US')} setups`}</span>
      <span className="text-textSecondary" aria-hidden>·</span>
      <button type="button" onClick={onMore} className="font-semibold text-textPrimary hover:text-silver transition-colors">
        {open ? `Show ${next.toLocaleString('en-US')} more` : `Show the first ${ROWS_AT_REST}`}
      </button>
    </div>
  );
};

const SetupScanBoard = ({ setups, layout, selectedId, onSelect, onAnalysis, expiryChip, emptyLabel, callOf, hotId = null }: SetupScanBoardProps) => {
  const ranked = useMemo<Ranked[]>(() => setups.map((s, i) => ({ ...s, rank: i + 1 })), [setups]);
  const cap = useRestCap(ranked);
  const huge = ranked.length > HUGE;
  const [shownN, setShownN] = useState(ROWS_AT_REST);
  const listKey = `${ranked.length}:${ranked[0]?.id ?? ''}`;
  useEffect(() => {
    setShownN(ROWS_AT_REST);
  }, [listKey]);
  const shown = huge ? ranked.slice(0, shownN) : layout === 'cards' ? cap.shown : ranked;

  const columns = useMemo<Column<Ranked>[]>(() => {
    const cols: Column<Ranked>[] = [
      { key: 'rank', header: '#', sortValue: r => r.rank, render: r => <span className="font-mono text-t10 text-textMuted tnum">{r.rank}</span> },
      {
        key: 'contract',
        header: 'Contract',
        sortValue: r => r.ticker,
        render: r => (
          <span className="inline-flex items-center gap-2 min-w-0">
            <ContractLabel contract={r.contract} right={r.right} logo={r.ticker} size="sm" />
          </span>
        ),
      },
      { key: 'expiry', header: 'Expiry', render: r => <span className="font-mono text-t11 text-textSecondary whitespace-normal">{ownExpiry(r)}</span> },
      {
        key: 'book',
        header: 'Book',
        sortValue: r => r.band ?? '',
        render: r => <span className="font-mono text-t11 text-textPrimary">{r.band === 'top' ? BOOK_NAME.A : r.band === 'wing' ? BOOK_NAME.B : r.band === 'lottery' ? BOOK_NAME.C : '—'}</span>,
      },
      { key: 'sigma', header: '1σ to expiry', align: 'right', sortValue: r => r.sigmaMovePct, render: r => <span className="font-mono text-t11 tnum text-textPrimary">{r.greeks.iv > 0 && r.sigmaMovePct > 0 ? `±${r.sigmaMovePct}%` : '—'}</span> },
      { key: 'premium', header: 'Ask', align: 'right', sortValue: r => (r.ask > 0 ? r.ask : -1), render: r => <span className="font-mono text-t11 tnum text-textPrimary">{r.ask > 0 ? `$${r.ask.toFixed(2)}` : '—'}</span> },
      { key: 'breaks', header: 'Stop', align: 'right', sortValue: r => (r.band === 'lottery' || !(r.ask > 0) ? 0 : r.ask * STOP_KEEP), render: r => {
        if (r.band === 'lottery') return <span className="font-mono text-t11 tnum text-warn">No stop</span>;
        if (r.band !== 'top' && r.band !== 'wing') return <span className="font-mono text-t11 text-textMuted">Not a call</span>;
        if (!(r.ask > 0)) return <span className="font-mono text-t11 text-textMuted">—</span>;
        return <span className="font-mono text-t11 tnum text-warn">${(r.ask * STOP_KEEP).toFixed(2)}</span>;
      } },
    ];
    cols.push({
      key: 'open',
      header: '',
      align: 'right',
      render: r => (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            onAnalysis(r);
          }}
          className="slayer-chip uppercase tracking-wider"
        >
          Open <ArrowUpRight className="w-3 h-3" />
        </button>
      ),
    });
    return cols;
  }, [onAnalysis]);

  if (setups.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] border-t border-borderSubtle px-6" data-compass-board="empty">
        <span className="max-w-md text-center text-t125 text-textSecondary leading-relaxed">{emptyLabel || 'Nothing cleared the bar on this sweep'}</span>
      </div>
    );
  }

  if (layout === 'table') {
    return (
      <div data-compass-board="table">
        <TraceGrid
          rows={shown}
          columns={columns}
          widths={WIDTHS}
          tooltips={TOOLTIPS}
          rowKey={r => r.id}
          onRowClick={onSelect}
          selectedKey={selectedId}
          autoHeight
          initialSort={{ key: 'rank', dir: 'asc' }}
          emptyText="Nothing cleared the bar on this sweep"
          testId="compass-board"
        />
        {huge && <MoreFoot shown={shown.length} total={ranked.length} onMore={() => setShownN(n => (n >= ranked.length ? ROWS_AT_REST : Math.min(ranked.length, n + STEP)))} />}
      </div>
    );
  }

  /* The cards, two across — the box grows with them */
  return (
    <div key="cards" className="border-t border-borderSubtle px-5 pt-4 pb-5 animate-soft-in" data-compass-board="cards">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {shown.map(s => (
          <SetupScanCard key={s.id} setup={s} rank={s.rank} spark={s.spark} selected={s.id === selectedId} hot={s.id === hotId} signal={callOf?.(s.id)} onSelect={onSelect} onAnalysis={onAnalysis} expiryChip={expiryChip} />
        ))}
      </div>
      {huge ? (
        <MoreFoot shown={shown.length} total={ranked.length} onMore={() => setShownN(n => (n >= ranked.length ? ROWS_AT_REST : Math.min(ranked.length, n + STEP)))} />
      ) : (
        <RestFoot cap={cap} noun="setups" testId="compass-cards" />
      )}
    </div>
  );
};

export default SetupScanBoard;
