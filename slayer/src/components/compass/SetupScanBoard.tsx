/*
==================================================
  SLAYER TERMINAL - THE BOARD'S BODY (SetupScanBoard.tsx)
  The ranked setups under the box's head: the cards
  two across, or the same rows as THE GRID (the
  Trace walk's AG Grid). The box GROWS with what
  the sweep found and the page scrolls (Noah,
  2026-09-11: "the board box should be a box that
  can be lengthened when new cards are added") —
  the rail beside it sticks, the page carries its
  own door home.

  The walk (2026-09-11): the old Panel head, its
  Cards/Table tabs, the fixed window and the
  20-a-page pager are gone — the head is the box's
  (TraceBox), the layout is a card on the box's line.
==================================================
*/

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Setup } from '../../types/compass';
import { SCANNERS } from '../../types/compass';
import { timeIfSits } from '../../data/compass';
import type { Column } from '../ui/DataTable';
import SignalBadge from '../ui/SignalBadge';
import ContractLabel from '../ui/ContractLabel';
import { TraceGrid, RestFoot, useRestCap, ROWS_AT_REST } from '../trace/TraceBox';
import SetupScanCard from './SetupScanCard';
import { processState, PROCESS_META } from './setupProcess';

export type ScanLayout = 'cards' | 'table';

type Ranked = Setup & { rank: number; spark?: number[] };

/** Which kind found a setup — the id carries it (`TICKER-strike-R-kind-sleeve`) */
const kindOf = (s: Setup): string => {
  const m = s.id.match(/-[CP]-(.+)-(odte|weekly|swing|position|leaps)(?:-\d+d)?$/);
  const key = m?.[1];
  return SCANNERS.find(k => k.key === key)?.label ?? '';
};

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
  /** The closest contract when none cleared. Shown as a card, not a call. */
  near?: Setup | null;
  /** Under All kinds the grid says which kind found each row */
  showKind?: boolean;
}

const WIDTHS: Record<string, number> = { rank: 56, expiry: 150, state: 110, sigma: 96, premium: 96, breaks: 110, kind: 120, open: 72 };
const TOOLTIPS: Record<string, string> = {
  sigma: 'The one-sigma move of the stock to expiry — what the options price in',
  premium: 'The contract at the bid/ask midpoint',
  breaks: '0DTE: the bid that retires the trade. 1–7 DTE: what the ask gives up by expiry if the stock sits',
  state: 'Watch · proving itself. Active · the structure is in place. Moving · the contract trades like its trade. Fading · retiring',
};

/* A chip inside a grid cell keeps its OWN line height — the cell's is the
   row's 39px, and a chip that inherits it stands taller than its row (Noah,
   2026-09-11: "boxes bleeding into each other") */
const Chip = ({ children }: { children: React.ReactNode }) => <span className="inline-flex leading-normal">{children}</span>;

const STEP = 80;
/** Past this, "show all" would mount every cell at once. Reveal a step at a time. */
const HUGE = 400;

const MoreFoot = ({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) => {
  const open = shown < total;
  const next = Math.min(STEP, total - shown);
  return (
    <div className="px-5 py-2.5 border-t border-borderSubtle flex items-center gap-2 text-[11px] text-textSecondary">
      <span>{open ? `The first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} setups` : `All ${total.toLocaleString('en-US')} setups`}</span>
      <span className="text-textSecondary" aria-hidden>·</span>
      <button type="button" onClick={onMore} className="font-semibold text-textPrimary hover:text-silver transition-colors">
        {open ? `Show ${next.toLocaleString('en-US')} more` : `Show the first ${ROWS_AT_REST}`}
      </button>
    </div>
  );
};

const SetupScanBoard = ({ setups, layout, selectedId, onSelect, onAnalysis, expiryChip, emptyLabel, near, showKind = false }: SetupScanBoardProps) => {
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
      { key: 'rank', header: '#', sortValue: r => r.rank, render: r => <span className="font-mono text-[10px] text-textMuted tnum">{r.rank}</span> },
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
      { key: 'expiry', header: 'Expiry', render: r => <span className="font-mono text-[11px] text-textSecondary">{r.expiry} · {expiryChip}</span> },
      {
        key: 'state',
        header: 'State',
        sortValue: r => processState(r),
        render: r => {
          const state = processState(r);
          const meta = PROCESS_META[state];
          return (
            <Chip>
              <SignalBadge tone={meta.tone} dot pulse={meta.pulse}>
                {state}
              </SignalBadge>
            </Chip>
          );
        },
      },
      { key: 'sigma', header: '1σ move', align: 'right', sortValue: r => r.sigmaMovePct, render: r => <span className="font-mono text-[11px] tnum text-textPrimary">±{r.sigmaMovePct}%</span> },
      { key: 'premium', header: 'Ask', align: 'right', sortValue: r => (r.ask > 0 ? r.ask : r.mid), render: r => <span className="font-mono text-[11px] tnum text-textPrimary">${(r.ask > 0 ? r.ask : r.mid).toFixed(2)}</span> },
      { key: 'breaks', header: setups[0]?.sleeve === 'odte' ? 'Stop' : 'If it sits', align: 'right', sortValue: r => (r.sleeve === 'odte' ? (r.ask > 0 ? r.ask : r.mid) * (r.band === 'wing' ? 0.5 : r.band === 'scalp' ? 0.85 : 1 - 0.5322) : timeIfSits(r.spot ?? 0, r.strike, r.right, r.ask > 0 ? r.ask : r.mid)), render: r => {
        if (r.sleeve !== 'odte') {
          const sit = timeIfSits(r.spot ?? 0, r.strike, r.right, r.ask > 0 ? r.ask : r.mid);
          return <span className="font-mono text-[11px] tnum text-warn" title="The time in the ask, per contract. Gone by expiry if the stock is still here.">{sit > 0 ? `−$${sit.toFixed(0)}` : 'No time'}</span>;
        }
        return <span className="font-mono text-[11px] tnum text-warn">${((r.ask > 0 ? r.ask : r.mid) * (r.band === 'wing' ? 0.5 : r.band === 'scalp' ? 0.85 : 1 - 0.5322)).toFixed(2)}</span>;
      } },
    ];
    if (showKind) cols.push({ key: 'kind', header: 'Kind', sortValue: r => kindOf(r), render: r => <span className="text-[11px] text-textSecondary">{kindOf(r)}</span> });
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
          title="Open the setup's page"
          className="slayer-chip uppercase tracking-wider"
        >
          Open <ArrowUpRight className="w-3 h-3" />
        </button>
      ),
    });
    return cols;
  }, [expiryChip, showKind, onAnalysis, setups]);

  if (setups.length === 0) {
    if (near && near.p1 != null) {
      const card: Setup = { ...near, band: 'closest' };
      return (
        <div className="border-t border-borderSubtle px-5 pt-4 pb-5" data-compass-board="near">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <SetupScanCard setup={card} rank={1} selected={card.id === selectedId} onSelect={onSelect} onAnalysis={onAnalysis} expiryChip={expiryChip} />
          </div>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-center h-[200px] border-t border-borderSubtle px-6" data-compass-board="empty">
        <span className="max-w-md text-center text-[12.5px] text-textSecondary leading-relaxed">{emptyLabel || 'Nothing cleared the bar on this sweep'}</span>
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
