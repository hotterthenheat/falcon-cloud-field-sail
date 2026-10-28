/*
  The book the 0DTE scan reads. ATM ± 4, calls and puts.
  Ordered by the checks we can calculate — eligible, then the
  tighter spread — not by strike. The model rank is not here.
*/

import { useMemo } from 'react';
import ContractLabel from '../ui/ContractLabel';
import type { Column } from '../ui/DataTable';
import { PhoneRow, TraceGrid } from '../trace/TraceBox';
import type { OptionRight } from '../../types/compass';

export interface NeighborRow {
  strike: number;
  right: OptionRight;
  contract: string;
  bid: number;
  ask: number;
  mid: number;
  /** (ask − bid) / mid, a fraction. */
  spreadPct: number;
  /** Strikes from the at-the-money strike. */
  steps: number;
  /** Out of the money, percent of spot. Negative is in the money. */
  otmPct: number;
  /** First failed check, or empty when the quote passes. */
  reason: string;
  /** Bid, ask, and spread pass. Session is not part of this. */
  eligible: boolean;
  /** Quote passes and the session can take an entry. Still not a fill. */
  entryQualified: boolean;
  here: boolean;
  /** Stock price where the 0DTE stop bid is hit. Null off 0DTE. */
  breakSpot: number | null;
  /** Strike sits outside the name's 1σ band. */
  wing: boolean;
}

interface SetupDriversProps {
  ticker: string;
  rows: NeighborRow[];
  onOpen?: (strike: number, right: OptionRight) => void;
  /** 0DTE: the stock price that hits this row’s stop bid. */
  breaks?: boolean;
  /** Side label when the book is split. */
  label?: string;
  /** The line under the title. */
  sub?: string;
}

const SetupDrivers = ({ ticker, rows, onOpen, breaks = false, label, sub }: SetupDriversProps) => {
  const here = rows.find(r => r.here);
  const columns = useMemo<Column<NeighborRow>[]>(() => {
    const cols: Column<NeighborRow>[] = [
      {
        key: 'contract',
        header: 'Contract',
        sortValue: r => r.strike * (r.right === 'P' ? -1 : 1),
        render: r => <ContractLabel contract={r.contract} right={r.right} logo={ticker} size="sm" />,
      },
      {
        key: 'bid',
        header: 'Bid',
        align: 'right',
        sortValue: r => r.bid,
        render: r => <span className={`font-mono text-[11px] tnum ${r.bid > 0.15 ? 'text-textPrimary' : 'text-bear'}`}>${r.bid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>,
      },
      {
        key: 'ask',
        header: 'Ask',
        align: 'right',
        sortValue: r => r.ask,
        render: r => <span className="font-mono text-[11px] tnum text-textPrimary">${r.ask.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>,
      },
      {
        key: 'spread',
        header: 'Spread',
        align: 'right',
        sortValue: r => r.spreadPct,
        render: r => (
          <span className={`font-mono text-[11px] tnum ${r.spreadPct > 0.08 ? 'text-bear' : 'text-textSecondary'}`}>
            {(r.spreadPct * 100).toFixed(1)}%
          </span>
        ),
      },
    ];
    if (breaks) {
      cols.push({
        key: 'breaks',
        header: 'Modeled',
        align: 'right',
        sortValue: r => r.breakSpot ?? 0,
        render: r => (
          <span className="font-mono text-[11px] tnum text-bear">
            {r.breakSpot == null ? '—' : `${r.right === 'P' ? '≥' : '≤'} $${r.breakSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        ),
      });
    } else {
      cols.push({
        key: 'away',
        header: 'From ATM',
        align: 'right',
        sortValue: r => Math.abs(r.steps),
        render: r => (
          <span className="font-mono text-[11px] tnum text-textSecondary">
            {r.steps === 0 ? 'ATM' : `${r.steps > 0 ? '+' : '−'}${Math.abs(r.steps)}`}
          </span>
        ),
      });
    }
    cols.push({
      key: 'pick',
      header: 'Status',
      align: 'right',
      sortValue: r => (r.here ? 0 : r.eligible ? 1 : 2),
      render: r => {
        const word = r.here ? 'Selected' : r.entryQualified ? 'Entry qualified' : r.eligible ? 'Market eligible' : 'Rejected';
        const ink = r.here ? 'text-textPrimary' : r.eligible ? 'text-textSecondary' : 'text-bear';
        const why = r.reason || (r.here ? 'This contract' : 'No model');
        return (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className={`font-mono text-[11px] whitespace-nowrap ${ink}`}>{word}</span>
            <span className="font-mono text-[9px] text-textMuted whitespace-nowrap">{why}</span>
          </span>
        );
      },
    });
    return cols;
  }, [ticker, breaks]);

  const widths: Record<string, number> = breaks
    ? { contract: 188, bid: 72, ask: 72, spread: 72, breaks: 120, pick: 128 }
    : { contract: 200, bid: 72, ask: 72, spread: 80, away: 88, pick: 128 };

  if (!rows.length) return null;
  return (
    <div className="border border-borderSubtle rounded-md bg-panel overflow-hidden" data-setup-drivers={ticker} data-setup-book>
      <div className="px-5 pt-4 pb-3">
        <div className="h-6 flex items-center gap-3">
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">{label ?? 'The book it scans'}</h3>
        </div>
        {sub ? <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">{sub}</p> : null}
      </div>
      <TraceGrid
        rows={rows}
        columns={columns}
        widths={widths}
        lockColumns
        rowKey={r => `${r.strike}${r.right}`}
        onRowClick={onOpen ? r => (r.here ? undefined : onOpen(r.strike, r.right)) : undefined}
        selectedKey={here ? `${here.strike}${here.right}` : null}
        autoHeight
        animate={false}
        testId="setup-drivers"
        phoneRow={r => (
          <PhoneRow
            title={<ContractLabel contract={r.contract} right={r.right} logo={ticker} size="sm" />}
            aside={r.here ? 'Selected' : r.entryQualified ? 'Entry qualified' : r.eligible ? 'Market eligible' : 'Rejected'}
            figures={[
              `bid $${r.bid.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              `ask $${r.ask.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              `${(r.spreadPct * 100).toFixed(1)}%`,
              breaks && r.breakSpot != null ? `${r.right === 'P' ? '≥' : '≤'} $${r.breakSpot.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : r.steps === 0 ? 'ATM' : `${r.steps > 0 ? '+' : '−'}${Math.abs(r.steps)}`,
              r.reason,
            ].filter(Boolean)}
          />
        )}
      />
    </div>
  );
};

export default SetupDrivers;
