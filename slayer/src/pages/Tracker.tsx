/*
  The contracts you track from Compass, marked at their live vendor quote: what it was when you tracked it, what it
  is now, and whether its expiry has passed. A contract with no live quote yet shows a dash, never a model price.
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bookmark, Trash2, ArrowUpRight } from 'lucide-react';
import { useTracker } from '../context/TrackerContext';
import { isoDate, today } from '../core/calendar';
import { peekMark, useMarks } from '../data/weigherChain';
import type { SleeveKey } from '../types/compass';
import type { TrackedSetup } from '../types/tracker';
import PageHeader from '../components/ui/PageHeader';
import SegmentedControl from '../components/ui/SegmentedControl';
import Panel from '../components/ui/Panel';
import SignalBadge from '../components/ui/SignalBadge';
import DataTable, { type Column } from '../components/ui/DataTable';

const TAB_OPTIONS = [
  { value: 'setups', label: 'Cards' },
  { value: 'contracts', label: 'Table' },
] as const;

type TabKey = (typeof TAB_OPTIONS)[number]['value'];

/* Rows kept before the expiry was stored only know their tenor: 0DTE ends on its tracked day, a weekly within seven. */
const DAYS_BY_SLEEVE: Partial<Record<SleeveKey, number>> = { odte: 0, weekly: 7 };

const sleeveOf = (tracked: TrackedSetup): SleeveKey => tracked.sleeve ?? 'odte';

function expiryOf(tracked: TrackedSetup): string | null {
  if (tracked.expiry) return tracked.expiry;
  const days = DAYS_BY_SLEEVE[sleeveOf(tracked)];
  if (days == null) return null;
  const d = new Date(tracked.trackedAt);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

interface Row {
  tracked: TrackedSetup;
  expiry: string | null;
  expired: boolean;
  /** The mark when tracked: the card's mark, else the ask */
  then: number | null;
  /** The live mark now */
  now: number | null;
  changePct: number | null;
}

const money = (v: number | null) => (v != null && v > 0 ? `$${v.toFixed(2)}` : '—');
const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);
const ink = (v: number | null) => (v == null || v === 0 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

const TrackedCard = ({ row, onUntrack, onReview, spotlight = false }: { row: Row; onUntrack: () => void; onReview: () => void; spotlight?: boolean }) => {
  const { tracked, expired } = row;
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (spotlight) cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [spotlight]);
  return (
    <div ref={cardRef} className={`border border-borderSubtle bg-panel rounded-lg overflow-hidden flex flex-col ${spotlight ? 'animate-focus-flash' : ''}`}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-borderSubtle">
        <span className="font-mono text-sm font-bold text-textPrimary tracking-tight">{tracked.contract}</span>
        {expired ? <SignalBadge tone="bear">EXPIRED</SignalBadge> : null}
        <span className="ml-auto font-mono text-[9px] text-textMuted uppercase tracking-wider">Tracked {new Date(tracked.trackedAt).toLocaleDateString()}</span>
      </div>
      <div className={`grid grid-cols-3 gap-px bg-borderSubtle/30 ${expired ? 'opacity-50' : ''}`}>
        <div className="bg-panel px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-widest text-textMuted">When tracked</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-textPrimary tnum">{money(row.then)}</div>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-widest text-textMuted">Now</div>
          <div className="mt-0.5 font-mono text-sm font-semibold text-textPrimary tnum">{expired ? '—' : money(row.now)}</div>
        </div>
        <div className="bg-panel px-3 py-2.5">
          <div className="font-mono text-[9px] uppercase tracking-widest text-textMuted">Change</div>
          <div className={`mt-0.5 font-mono text-sm font-semibold tnum ${ink(row.changePct)}`}>{expired ? '—' : pct(row.changePct)}</div>
        </div>
      </div>
      <div className="px-4 py-2.5 font-mono text-[10px] text-textSecondary">
        {expired
          ? `Expired ${row.expiry ?? ''} — tracking ended.`
          : row.now == null
            ? 'Waiting for the contract’s live quote.'
            : `Expires ${row.expiry ?? '—'}. Marked at the live quote.`}
      </div>
      <div className="flex items-center gap-2 px-4 py-3 mt-auto border-t border-borderSubtle">
        {expired ? (
          <span className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-borderSubtle bg-ink/[0.02] font-mono text-[10px] text-textMuted uppercase tracking-wider cursor-not-allowed select-none">Expired</span>
        ) : (
          <button onClick={onReview} className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-borderSubtle bg-ink/[0.03] hover:bg-ink/[0.06] font-mono text-[10px] text-textSecondary hover:text-textPrimary uppercase tracking-wider transition-colors">
            <ArrowUpRight className="w-3 h-3" /> Review
          </button>
        )}
        <button onClick={onUntrack} className="flex items-center gap-1 px-3 py-1.5 rounded-md border border-bear/20 bg-bear/5 hover:bg-bear/10 font-mono text-[10px] text-bear uppercase tracking-wider transition-colors ml-auto">
          <Trash2 className="w-3 h-3" /> Untrack
        </button>
      </div>
    </div>
  );
};

const TABLE_COLUMNS: Column<Row>[] = [
  { key: 'contract', header: 'Contract', render: r => <span className="font-semibold text-textPrimary">{r.tracked.contract}</span> },
  { key: 'expiry', header: 'Expiry', render: r => (r.expired ? <SignalBadge tone="bear">EXPIRED</SignalBadge> : <span className="text-textSecondary">{r.expiry ?? '—'}</span>) },
  { key: 'then', header: 'When tracked', align: 'right', sortValue: r => r.then ?? -1, render: r => <span className="text-textPrimary tnum">{money(r.then)}</span> },
  { key: 'now', header: 'Now', align: 'right', sortValue: r => r.now ?? -1, render: r => <span className="text-textPrimary tnum">{r.expired ? '—' : money(r.now)}</span> },
  { key: 'change', header: 'Change', align: 'right', sortValue: r => r.changePct ?? -1e9, render: r => <span className={`tnum ${ink(r.changePct)}`}>{r.expired ? '—' : pct(r.changePct)}</span> },
  { key: 'tracked', header: 'Tracked', render: r => <span className="text-textMuted">{new Date(r.tracked.trackedAt).toLocaleDateString()}</span> },
];

/** `embedded`: under the Compass shell, which wears the head */
const Tracker = ({ embedded = false }: { embedded?: boolean } = {}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { trackedSetups, untrackSetup } = useTracker();
  const [tab, setTab] = useState<TabKey>('setups');
  const [focusId] = useState<string | null>(() => (location.state as { focus?: string } | null)?.focus ?? null);

  const todayIso = isoDate(today());
  const wanted = useMemo(
    () => trackedSetups.flatMap(t => {
      const e = expiryOf(t);
      return e && e >= todayIso ? [{ ticker: t.ticker, expiry: e }] : [];
    }),
    [trackedSetups, todayIso]
  );
  const marksRev = useMarks(wanted);

  const rows = useMemo<Row[]>(
    () => trackedSetups.map(tracked => {
      const expiry = expiryOf(tracked);
      const expired = expiry != null && expiry < todayIso;
      const then = tracked.markAtTrack && tracked.markAtTrack > 0 ? tracked.markAtTrack : tracked.askAtTrack && tracked.askAtTrack > 0 ? tracked.askAtTrack : null;
      const live = expiry && !expired ? peekMark(tracked.ticker, expiry, tracked.strike, tracked.right) : null;
      const now = live && live.mark > 0 ? live.mark : null;
      const changePct = then != null && now != null ? (now / then - 1) * 100 : null;
      return { tracked, expiry, expired, then, now, changePct };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trackedSetups, todayIso, marksRev]
  );

  const handleReview = (tracked: TrackedSetup) => {
    navigate('/compass', { state: { monitor: { ticker: tracked.ticker, strike: tracked.strike, right: tracked.right, scanner: tracked.scanner, sleeve: sleeveOf(tracked) } } });
  };

  return (
    <>
      {!embedded && <PageHeader breadcrumb={['Terminal', 'Tracker']} title="Setup Tracker" subtitle="Every contract you track, marked at its live quote — as cards or as a table" />}
      <div className="flex items-center gap-3">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-widest text-textMuted">View</span>
        <SegmentedControl ariaLabel="Tracker view" options={TAB_OPTIONS} value={tab} onChange={setTab} />
        <span className="font-mono text-[10px] text-textMuted uppercase tracking-wider">
          {trackedSetups.length} tracked setup{trackedSetups.length === 1 ? '' : 's'}
        </span>
      </div>
      {trackedSetups.length === 0 ? (
        <Panel className="w-full" bodyClassName="flex flex-col items-center justify-center py-16 gap-4">
          <Bookmark className="w-10 h-10 text-textMuted/40" />
          <span className="font-mono text-[11px] text-textMuted uppercase tracking-widest">No tracked setups yet</span>
          <p className="text-[12px] text-textSecondary text-center max-w-sm leading-relaxed">
            Go to{' '}
            <button onClick={() => navigate('/compass')} className="text-select hover:underline">
              Compass
            </button>
            , pick a setup, and click <strong className="text-textPrimary">Track Setup +</strong> to bookmark it here.
          </p>
        </Panel>
      ) : tab === 'setups' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 animate-view-in">
          {rows.map(row => (
            <TrackedCard key={row.tracked.id} row={row} onUntrack={() => untrackSetup(row.tracked.id)} onReview={() => handleReview(row.tracked)} spotlight={row.tracked.id === focusId} />
          ))}
        </div>
      ) : (
        <Panel title="Tracked setups" flush className="w-full animate-view-in">
          <DataTable columns={TABLE_COLUMNS} rows={rows} rowKey={r => r.tracked.id} maxHeight="520px" />
        </Panel>
      )}
    </>
  );
};

export default Tracker;
