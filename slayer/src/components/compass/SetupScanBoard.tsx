/* The ranked calls under the board's head: cards two across, or the same rows as a grid. The box grows with what
   the scan found and the page scrolls. */

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Setup } from '../../types/compass';
import type { Column } from '../ui/DataTable';
import ContractLabel from '../ui/ContractLabel';
import { TraceGrid, RestFoot, useRestCap, ROWS_AT_REST } from '../trace/TraceBox';
import SetupScanCard, { ownExpiry } from './SetupScanCard';
import { STOP_KEEP } from '../../data/contractQuote';
import { RIDING_WORD, modelOfBand } from '../../data/compassParams';

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
}

const WIDTHS: Record<string, number> = { rank: 56, expiry: 150, model: 150, sigma: 110, premium: 96, breaks: 120, open: 72 };
export const SCAN_TOOLTIPS: Record<string, string> = {
  sigma: 'One standard deviation of the underlying to expiry, from the quote implied vol. A dash means the quote had no vol.',
  premium: 'The ask on this quote.',
  breaks: 'Model 1: 0.4678 times the ask. Model 3 has no stop.',
  model: `Model 1 is the entry model: near the money, or far from it with ${RIDING_WORD} on the exit. Model 3 is the late sweep, same-day only.`,
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

/** The table view's columns (exported for scripts/compass-words-proof.ts: the grid renders only in a browser). */
export function scanColumns(onAnalysis: (setup: Setup) => void): Column<Ranked>[] {
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
      key: 'model',
      header: 'Model',
      sortValue: r => r.band ?? '',
      render: r => <span className="font-mono text-t11 text-textPrimary">{r.band === 'wing' ? `${modelOfBand(r.band)} · ${RIDING_WORD}` : modelOfBand(r.band) || '—'}</span>,
    },
    { key: 'sigma', header: '1σ to expiry', align: 'right', sortValue: r => r.sigmaMovePct, render: r => <span className="font-mono text-t11 tnum text-textPrimary">{r.greeks.iv > 0 && r.sigmaMovePct > 0 ? `±${r.sigmaMovePct}%` : '—'}</span> },
    { key: 'premium', header: 'Ask', align: 'right', sortValue: r => (r.ask > 0 ? r.ask : r.mid), render: r => <span className="font-mono text-t11 tnum text-textPrimary">${(r.ask > 0 ? r.ask : r.mid).toFixed(2)}</span> },
    { key: 'breaks', header: 'Stop', align: 'right', sortValue: r => (r.band === 'lottery' ? 0 : (r.ask > 0 ? r.ask : r.mid) * STOP_KEEP), render: r => {
      if (r.band === 'lottery') return <span className="font-mono text-t11 tnum text-warn">No stop</span>;
      if (r.band !== 'top' && r.band !== 'wing') return <span className="font-mono text-t11 text-textMuted">Not a call</span>;
      return <span className="font-mono text-t11 tnum text-warn">${((r.ask > 0 ? r.ask : r.mid) * STOP_KEEP).toFixed(2)}</span>;
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
}

const SetupScanBoard = ({ setups, layout, selectedId, onSelect, onAnalysis, expiryChip, emptyLabel }: SetupScanBoardProps) => {
  const ranked = useMemo<Ranked[]>(() => setups.map((s, i) => ({ ...s, rank: i + 1 })), [setups]);
  const cap = useRestCap(ranked);
  const huge = ranked.length > HUGE;
  const [shownN, setShownN] = useState(ROWS_AT_REST);
  const listKey = `${ranked.length}:${ranked[0]?.id ?? ''}`;
  useEffect(() => {
    setShownN(ROWS_AT_REST);
  }, [listKey]);
  const shown = huge ? ranked.slice(0, shownN) : layout === 'cards' ? cap.shown : ranked;

  const columns = useMemo(() => scanColumns(onAnalysis), [onAnalysis]);

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
          tooltips={SCAN_TOOLTIPS}
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
          <SetupScanCard key={s.id} setup={s} rank={s.rank} spark={s.spark} selected={s.id === selectedId} onSelect={onSelect} onAnalysis={onAnalysis} expiryChip={expiryChip} />
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
