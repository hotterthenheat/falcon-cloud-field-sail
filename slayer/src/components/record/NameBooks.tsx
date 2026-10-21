import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { houseSlug } from '../../data/fileBooks';
import { useShortRow } from '../../data/liveFiles';
import { stockBookKey, useVendor, useVendorRow } from '../../data/vendorFeed';
import { FILE_TTL_MS, FeedFallback, StaleMark, TickFigure, quietText, type FeedFault } from '../ui/liveRead';

/*
  Who is in the name. One box on the name's page: the largest house,
  the short-interest print, the fund that holds the most. A row opens
  that house, that short file, or that fund. The market tide is not
  here. It is the same on every name, and it lives on the wire.
*/

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[10px] text-textMuted">{label}</dt>
    <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-textPrimary whitespace-nowrap truncate">{children}</dd>
  </div>
);

const Row = ({ onClick, testId, cells }: { onClick: () => void; testId: string; cells: ReactNode[] }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full text-left px-5 h-[34px] grid items-center gap-x-3 border-t border-borderSubtle/40 hover:bg-ink/[0.03] transition-colors"
    style={{ gridTemplateColumns: 'minmax(0,1.4fr) 72px 88px' }}
    data-name-who={testId}
  >
    {cells.map((c, i) => (
      <span key={i} className={i === 0 ? 'truncate text-[12px] text-textPrimary' : 'text-right font-mono text-[11px] tabular-nums text-textSecondary truncate'}>
        {c}
      </span>
    ))}
  </button>
);

const NameBooks = ({ ticker }: { ticker: string }) => {
  const navigate = useNavigate();
  useVendor('dossier', ticker, `/dossier/stocks/${ticker}`);
  const own = useVendorRow(stockBookKey(ticker), 'inst-own');
  const held = useVendorRow(stockBookKey(ticker), 'etf-exposure');
  const shortLive = useShortRow(ticker);
  const short = shortLive.row;
  const houses = people(own?.state === 'live' ? own.data : null);
  const funds = people(held?.state === 'live' ? held.data : null);
  const largest = houses[0];
  const fund = funds[0];
  const fault: FeedFault | null = own?.fault ?? held?.fault ?? (shortLive.status === 'error' ? 'failed' : null);
  const at = own?.okAt ?? held?.okAt ?? null;
  const listed = houses.length + funds.length + (short ? 1 : 0);
  const waiting = !own || own.state === 'loading' || !held || held.state === 'loading' || shortLive.status === 'loading';
  const missed = listed === 0 && !waiting && (own?.state === 'error' || held?.state === 'error' || shortLive.status === 'error');
  return (
    <section id="stock-who" className="border border-borderSubtle rounded-md bg-panel scroll-mt-4" data-name-books={ticker}>
      <div className="px-5 pt-4 pb-3 flex items-start gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold leading-tight text-textPrimary inline-flex items-center gap-2">
            Who is in it
            <StaleMark at={at} ttlMs={FILE_TTL_MS} fault={fault} />
          </h3>
          <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">Who reported the shares, and which funds hold the name</p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2">
          <Fact label="Largest house">{largest ? largest.name : own?.state === 'loading' ? '…' : '—'}</Fact>
          <Fact label="Short interest">{short ? <TickFigure value={short.interestPct}>{`${short.interestPct.toFixed(2)}%`}</TickFigure> : shortLive.status === 'loading' ? '…' : '—'}</Fact>
          <Fact label="Largest fund">{fund ? fund.name : held?.state === 'loading' ? '…' : '—'}</Fact>
          <Fact label="Holders">{own?.state === 'live' || own?.okAt ? own?.n ?? '—' : '—'}</Fact>
        </dl>
      </div>
      {missed ? (
        <FeedFallback fault={fault} />
      ) : listed > 0 ? (
        <div className="sticky top-0 z-10 bg-panel px-5 h-7 grid items-center gap-x-3 border-t border-borderSubtle text-[10px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: 'minmax(0,1.4fr) 72px 88px' }}>
          <span>Name</span>
          <span className="text-right">Weight</span>
          <span className="text-right tabular-nums">Value</span>
        </div>
      ) : null}
      {houses.map(r => (
        <Row key={r.name} testId={r.name} onClick={() => navigate(`/dossier/institutions/${houseSlug(r.name)}?line=${ticker}`)} cells={[r.name, r.mid || 'Shares', r.right]} />
      ))}
      {short && (
      <Row testId="short" onClick={() => navigate(`/dossier/shorts/${ticker}`)} cells={['The short print', <TickFigure key="d" value={short.daysToCover}>{`${short.daysToCover.toFixed(1)} days`}</TickFigure>, <TickFigure key="s" value={short.shortSharesM}>{`${short.shortSharesM.toFixed(1)}M`}</TickFigure>]} />
      )}
      {funds.map(f => (
        <Row key={f.name} testId={f.name} onClick={() => navigate(`/dossier/etfs/${f.etf || f.name}`)} cells={[f.name, f.mid, f.right]} />
      ))}
      <div className="h-3" />
    </section>
  );
};

function people(data: unknown): { name: string; mid: string; right: string; etf: string }[] {
  if (!Array.isArray(data)) return [];
  return data.slice(0, 5).map(r => {
    if (!r || typeof r !== 'object') return { name: '—', mid: '', right: '', etf: '' };
    const o = r as Record<string, unknown>;
    const name = quietText(String(o.name || o.short_name || o.full_name || o.etf || '—'));
    const weight = o.weight != null ? quietText(`${o.weight}%`) : '';
    const units = o.units != null ? quietText(String(o.units)) : o.shares != null ? quietText(String(o.shares)) : '';
    const value = o.value != null ? quietText(String(o.value)) : '';
    return { name, mid: weight || units, right: value || quietText(String(o.etf || '')), etf: quietText(String(o.etf || '')) };
  });
}

export default NameBooks;
