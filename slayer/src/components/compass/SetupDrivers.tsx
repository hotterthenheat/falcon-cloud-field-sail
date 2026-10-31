/* The book around a contract (restored from the owner's contract page): the strikes either side of the money on the
   same expiration, calls and puts, off the live quote. Each row says whether its quote passes the books' own checks
   (a bid over $0.15 and a spread at or under 8%) — the checks the scan can state. No model rank is here: a row is
   not a call. A row opens that contract's page. */

import { useMemo } from 'react';
import ContractLabel from '../ui/ContractLabel';
import type { Column } from '../ui/DataTable';
import { PhoneRow, TraceGrid } from '../trace/TraceBox';
import type { OptionRight } from '../../types/compass';
import type { ChainRow } from '../../data/thetaBook';
import { BID_MIN, SPREAD_MAX, spreadPass } from '../../data/compassParams';

export interface NeighborRow {
  strike: number;
  right: OptionRight;
  contract: string;
  bid: number;
  ask: number;
  /** (ask − bid) / mid, a fraction */
  spreadPct: number;
  delta: number;
  /** Strikes from the at-the-money strike, signed by moneyness: + out of the money */
  steps: number;
  reason: string;
  eligible: boolean;
  here: boolean;
}

const strikeWord = (k: number) => (k % 1 === 0 ? k.toFixed(0) : k.toFixed(2));

/** The chain rows as the table reads them, nearest the money first. */
export function neighborRows(ticker: string, chain: readonly ChainRow[], spot: number, here: { strike: number; right: OptionRight }): NeighborRow[] {
  const strikes = [...new Set(chain.map(r => r.strike))].sort((a, b) => a - b);
  if (!strikes.length) return [];
  let atm = strikes[0];
  for (const k of strikes) if (Math.abs(k - spot) < Math.abs(atm - spot)) atm = k;
  const ai = strikes.indexOf(atm);
  return chain
    .map(r => {
      const mid = r.bid > 0 && r.ask >= r.bid ? (r.bid + r.ask) / 2 : NaN;
      const spreadPct = Number.isFinite(mid) && mid > 0 ? (r.ask - r.bid) / mid : NaN;
      const raw = strikes.indexOf(r.strike) - ai;
      const steps = r.right === 'C' ? raw : -raw;
      const reason = !(r.bid > BID_MIN) ? `Bid at or under $${BID_MIN.toFixed(2)}` : !(spreadPct <= SPREAD_MAX + 1e-9) ? `Spread over ${Math.round(SPREAD_MAX * 100)}%` : '';
      return {
        strike: r.strike,
        right: r.right,
        contract: `${ticker} ${strikeWord(r.strike)}${r.right}`,
        bid: r.bid,
        ask: r.ask,
        spreadPct,
        delta: r.delta,
        steps,
        reason,
        eligible: spreadPass(r.bid, r.ask),
        here: Math.abs(r.strike - here.strike) < 1e-6 && r.right === here.right,
      };
    })
    .sort((a, b) => Math.abs(a.steps) - Math.abs(b.steps) || a.strike - b.strike || (a.right === 'C' ? -1 : 1));
}

interface SetupDriversProps {
  ticker: string;
  rows: NeighborRow[];
  onOpen?: (strike: number, right: OptionRight) => void;
  sub?: string;
}

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const awayWord = (steps: number) => (steps === 0 ? 'ATM' : `${Math.abs(steps)} ${steps > 0 ? 'OTM' : 'ITM'}`);

const SetupDrivers = ({ ticker, rows, onOpen, sub }: SetupDriversProps) => {
  const here = rows.find(r => r.here);
  const columns = useMemo<Column<NeighborRow>[]>(
    () => [
      { key: 'contract', header: 'Contract', sortValue: r => r.strike * (r.right === 'P' ? -1 : 1), render: r => <ContractLabel contract={r.contract} right={r.right} logo={ticker} size="sm" /> },
      { key: 'away', header: 'From ATM', align: 'right', sortValue: r => Math.abs(r.steps), render: r => <span className="font-mono text-t11 tnum text-textSecondary">{awayWord(r.steps)}</span> },
      { key: 'bid', header: 'Bid', align: 'right', sortValue: r => r.bid, render: r => <span className={`font-mono text-t11 tnum ${r.bid > BID_MIN ? 'text-textPrimary' : 'text-bear'}`}>{money(r.bid)}</span> },
      { key: 'ask', header: 'Ask', align: 'right', sortValue: r => r.ask, render: r => <span className="font-mono text-t11 tnum text-textPrimary">{money(r.ask)}</span> },
      {
        key: 'spread',
        header: 'Spread',
        align: 'right',
        sortValue: r => (Number.isFinite(r.spreadPct) ? r.spreadPct : 9),
        render: r => <span className={`font-mono text-t11 tnum ${r.spreadPct > SPREAD_MAX + 1e-9 ? 'text-bear' : 'text-textSecondary'}`}>{Number.isFinite(r.spreadPct) ? `${(r.spreadPct * 100).toFixed(1)}%` : '—'}</span>,
      },
      { key: 'delta', header: 'Delta', align: 'right', sortValue: r => (Number.isFinite(r.delta) ? Math.abs(r.delta) : -1), render: r => <span className={`font-mono text-t11 tnum ${r.delta >= 0 ? 'text-bull' : 'text-bear'}`}>{Number.isFinite(r.delta) ? r.delta.toFixed(2) : '—'}</span> },
      {
        key: 'status',
        header: 'Status',
        align: 'right',
        sortValue: r => (r.here ? 0 : r.eligible ? 1 : 2),
        render: r => (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className={`font-mono text-t11 whitespace-nowrap ${r.here ? 'text-textPrimary' : r.eligible ? 'text-textSecondary' : 'text-bear'}`}>{r.here ? 'This contract' : r.eligible ? 'Quote passes' : 'Rejected'}</span>
            {r.reason ? <span className="font-mono text-t9 text-textMuted whitespace-nowrap">{r.reason}</span> : null}
          </span>
        ),
      },
    ],
    [ticker],
  );
  if (!rows.length) return null;
  return (
    <div className="border border-borderSubtle rounded-md bg-panel overflow-hidden" data-setup-drivers={ticker} data-setup-book>
      <div className="px-5 pt-4 pb-3">
        <h3 className="text-t15 font-semibold leading-tight text-textPrimary">The contracts around it</h3>
        {sub ? <p className="mt-0.5 text-t11 text-textMuted truncate">{sub}</p> : null}
      </div>
      <TraceGrid
        rows={rows}
        columns={columns}
        widths={{ contract: 200, away: 88, bid: 76, ask: 76, spread: 80, delta: 72, status: 150 }}
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
            aside={r.here ? 'This contract' : r.eligible ? 'Quote passes' : 'Rejected'}
            figures={[`${awayWord(r.steps)}`, `bid ${money(r.bid)}`, `ask ${money(r.ask)}`, Number.isFinite(r.spreadPct) ? `${(r.spreadPct * 100).toFixed(1)}%` : '', r.reason].filter(Boolean)}
          />
        )}
      />
    </div>
  );
};

export default SetupDrivers;
