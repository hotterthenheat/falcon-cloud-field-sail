/*
  TRACKER — the setups you keep.
  One ledger. A row opens the setup. Expiry is the contract's day, not the day you clicked track.
*/

import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTracker } from '../context/TrackerContext';
import { useMarketData } from '../context/MarketDataContext';
import Simulator from '../core/simulator';
import { makeSetup } from '../data/compass';
import { COMPASS_SET } from '../data/compassUniverse';
import { bookToday, isoDate } from '../core/calendar';
import type { Setup, SleeveKey } from '../types/compass';
import type { TrackedSetup } from '../types/tracker';
import TraceBox, { Fact, PhoneRow, TraceGrid } from '../components/trace/TraceBox';
import type { Column } from '../components/ui/DataTable';
import ContractLabel from '../components/ui/ContractLabel';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const sleeveOf = (tracked: TrackedSetup): SleeveKey => tracked.sleeve ?? 'odte';
const dayOf = (iso: string) => `${SHORT[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const trackedDay = (at: number) => {
  const d = new Date(at);
  return `${SHORT[d.getMonth()]} ${d.getDate()}`;
};

/** A name matches the whole ticker. "QQQ" is QQQ, not TQQQ. */
const matchesQuery = (ticker: string, label: string, raw: string) => {
  const tokens = raw.trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) return true;
  const names = tokens.filter(t => /^[A-Z]{1,6}$/.test(t));
  const rest = tokens.filter(t => !/^[A-Z]{1,6}$/.test(t));
  if (names.length && !names.some(t => t === ticker)) return false;
  return rest.every(t => label.toUpperCase().includes(t));
};

interface Row {
  tracked: TrackedSetup;
  live: Setup;
  expired: boolean;
}

const rebuildLive = (tracked: TrackedSetup): Setup => {
  Simulator.register(tracked.ticker);
  const cfg = Simulator.TICKERS[tracked.ticker];
  return makeSetup(tracked.ticker, cfg.currentPrice, tracked.strike, tracked.right, tracked.scanner, cfg.iv, sleeveOf(tracked));
};

const Tracker = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { trackedSetups, untrackSetup } = useTracker();
  const { marketData } = useMarketData();
  const [q, setQ] = useState('');
  const [focusId] = useState<string | null>(() => (location.state as { focus?: string } | null)?.focus ?? null);

  const book = useMemo(() => trackedSetups.filter(t => COMPASS_SET.has(t.ticker)), [trackedSetups]);
  const liveData = useMemo<Row[]>(() => {
    void marketData;
    const today = isoDate(bookToday());
    return book.map(tracked => {
      const live = rebuildLive(tracked);
      return { tracked, live, expired: live.expiryDate < today };
    });
  }, [book, marketData]);

  const rows = useMemo(() => liveData.filter(r => matchesQuery(r.tracked.ticker, r.live.contract, q)), [liveData, q]);
  const cut = useMemo(() => {
    let expired = 0;
    for (const r of rows) if (r.expired) expired += 1;
    return { n: rows.length, expired };
  }, [rows]);

  const columns = useMemo<Column<Row>[]>(() => [
    {
      key: 'contract',
      header: 'Contract',
      sortValue: r => r.live.contract,
      render: r => <ContractLabel contract={r.live.contract} right={r.live.right} logo={r.tracked.ticker} size="sm" />,
    },
    {
      key: 'premium',
      header: 'Premium',
      align: 'right',
      sortValue: r => r.live.mid,
      render: r => <span className="tnum text-textPrimary">${r.live.mid.toFixed(2)}</span>,
    },
    {
      key: 'expiry',
      header: 'Expiry',
      align: 'right',
      sortValue: r => r.live.expiryDate,
      render: r => <span className={`tnum ${r.expired ? 'text-bear' : 'text-textSecondary'}`}>{dayOf(r.live.expiryDate)}</span>,
    },
    {
      key: 'tracked',
      header: 'Tracked',
      align: 'right',
      sortValue: r => r.tracked.trackedAt,
      render: r => <span className="tnum text-textMuted">{trackedDay(r.tracked.trackedAt)}</span>,
    },
    {
      key: 'untrack',
      header: '',
      align: 'right',
      render: r => (
        <button
          type="button"
          className="slayer-chip uppercase tracking-wider"
          onClick={e => {
            e.stopPropagation();
            untrackSetup(r.tracked.id);
          }}
        >
          Untrack
        </button>
      ),
    },
  ], [untrackSetup]);

  return (
    <TraceBox
      title={embedded ? 'Tracker' : 'Tracker'}
      sub={book.length ? 'A row opens the setup' : 'Nothing kept yet'}
      testId="tracker"
      foldOnPhone
      facts={
        <>
          <Fact label="Kept" testId="n">{cut.n.toLocaleString('en-US')}</Fact>
          <Fact label="Expired" testId="expired">{cut.expired.toLocaleString('en-US')}</Fact>
        </>
      }
      controls={
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="SPY QQQ NVDA" aria-label="Find a tracked name" className="w-44 max-sm:w-full slayer-field" data-span data-tracker-search />
      }
      sentence={false}
    >
      {rows.length === 0 ? (
        <div className="border-t border-borderSubtle px-5 py-10 font-mono text-[11px] text-textMuted">
          {q.trim() ? (
            `No tracked setup matches “${q.trim()}”.`
          ) : (
            <>
              Nothing tracked. Search a name on the{' '}
              <button type="button" onClick={() => navigate('/compass')} className="text-textPrimary hover:text-silver">scan</button>
              {' '}and choose Track setup.
            </>
          )}
        </div>
      ) : (
        <TraceGrid
          rows={rows}
          columns={columns}
          widths={{ contract: 210, premium: 96, expiry: 96, tracked: 96, untrack: 96 }}
          lockColumns
          rowKey={r => r.tracked.id}
          onRowClick={r => navigate(`/compass/${r.tracked.id}`)}
          selectedKey={focusId}
          autoHeight
          initialSort={{ key: 'tracked', dir: 'desc' }}
          animate={false}
          testId="tracker-book"
          emptyText=""
          phoneRow={r => (
            <PhoneRow
              title={<ContractLabel contract={r.live.contract} right={r.live.right} logo={r.tracked.ticker} size="sm" />}
              aside={<span className="tnum text-textPrimary">${r.live.mid.toFixed(2)}</span>}
              figures={[
                <span key="s">{r.expired ? 'Expired' : 'Open'} · {dayOf(r.live.expiryDate)}{r.tracked.markAtTrack != null && r.tracked.markAtTrack > 0 ? ` · ${(((r.live.mid - r.tracked.markAtTrack) / r.tracked.markAtTrack) * 100).toFixed(0)}%` : ''}</span>,
                <button
                  key="u"
                  type="button"
                  className="slayer-chip uppercase tracking-wider"
                  onClick={e => {
                    e.stopPropagation();
                    untrackSetup(r.tracked.id);
                  }}
                >
                  Untrack
                </button>,
              ]}
            />
          )}
        />
      )}
    </TraceBox>
  );
};

export default Tracker;
