import { useEffect, useState, type ReactNode } from 'react';
import { uwCall } from '../../data/whales';
import { nyDayOfUtcStamp } from '../../data/nyDate';
import { useNavigate } from 'react-router-dom';
import { houseSlug } from '../../data/fileBooks';
import { useShortRow } from '../../data/liveFiles';
import { stockBookKey, useVendor, useVendorRow } from '../../data/vendorFeed';
import { FILE_TTL_MS, FeedFallback, StaleMark, TickFigure, quietText, type FeedFault } from '../ui/liveRead';
import { statHelp } from './statHelp';
import { useSeen } from './CoName';

/*
  Who is in the name. One box on the name's page: the largest house,
  the short-interest print, the fund that holds the most. A row opens
  that house, that short file, or that fund. The market tide is not
  here. It is the same on every name, and it lives on the wire.
*/

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="min-w-0">
    <dt className="text-[10px] text-textMuted cursor-help" title={statHelp(label)}>{label}</dt>
    <dd className="mt-0.5 font-mono text-[12px] tabular-nums text-textPrimary whitespace-nowrap truncate">{children}</dd>
  </div>
);

const COLS = 'minmax(0,1.4fr) 104px 104px';

/** A book's own head: its name, then the two figures it carries */
const Head = ({ cols }: { cols: [string, string, string] }) => (
  <div className="px-5 h-7 grid items-center gap-x-3 border-t border-borderSubtle text-[10px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: COLS }}>
    <span className="text-textPrimary font-semibold">{cols[0]}</span>
    <span className="text-right">{cols[1]}</span>
    <span className="text-right">{cols[2]}</span>
  </div>
);

const Row = ({ onClick, testId, cells }: { onClick: () => void; testId: string; cells: ReactNode[] }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full text-left px-5 h-[34px] grid items-center gap-x-3 border-t border-borderSubtle/40 hover:bg-ink/[0.03] transition-colors"
    style={{ gridTemplateColumns: COLS }}
    data-name-who={testId}
  >
    {cells.map((c, i) => (
      <span key={i} className={i === 0 ? 'truncate text-[12px] text-textPrimary' : 'text-right font-mono text-[11px] tabular-nums text-textSecondary truncate'}>
        {c}
      </span>
    ))}
  </button>
);

/* THE FUND'S OWN WEIGHT (the retail pass, 2026-10-22). /etfs/{t}/exposure — "which funds hold the name" — carries a
   weight that lags: SPY's AAPL read 5.80% there while SPY's own holdings file said 7.45% (updated 2026-10-20), and
   179.2M shares × $345.80 over SPY's $823B is 7.5%. So each fund listed here reads its weight off that fund's own
   holdings file (/etfs/{etf}/holdings), with the file's date; the exposure figure is only the fallback, marked as such. */
const fundWeights = new Map<string, Promise<Map<string, { weight: number; asOf: string | null }>>>();
const weightsOf = (etf: string) => {
  let hit = fundWeights.get(etf);
  if (!hit) {
    hit = uwCall(`/etfs/${encodeURIComponent(etf)}/holdings`).then(res => {
      const out = new Map<string, { weight: number; asOf: string | null }>();
      if (Array.isArray(res.data))
        for (const r of res.data as Record<string, unknown>[]) {
          const t = String(r.ticker || '').toUpperCase();
          const w = Number(r.weight);
          if (t && Number.isFinite(w)) out.set(t, { weight: w, asOf: nyDayOfUtcStamp(r.updated ? String(r.updated) : null) });
        }
      return out;
    });
    fundWeights.set(etf, hit);
  }
  return hit;
};
const shortDay = (iso: string | null) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
/* THE FUNDS' FILES WHEN THE FUNDS ARE ON SCREEN (audit round 10: five whole holdings files — VTI, VOO, SPY, IVV, VUG —
   were read at page load for one "% of the fund" figure each) */
function useOwnWeights(ticker: string, etfs: string[], seen: boolean): Record<string, { weight: number; asOf: string | null } | null> {
  const key = etfs.join(',');
  const [got, setGot] = useState<Record<string, { weight: number; asOf: string | null } | null>>({});
  useEffect(() => {
    if (!seen) return;
    let dead = false;
    const sym = ticker.toUpperCase();
    etfs.forEach(etf =>
      void weightsOf(etf).then(m => {
        if (!dead) setGot(g => ({ ...g, [etf]: m.get(sym) ?? null }));
      })
    );
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, key, seen]);
  return got;
}

const NameBooks = ({ ticker }: { ticker: string }) => {
  const navigate = useNavigate();
  useVendor('dossier', ticker, `/dossier/stocks/${ticker}`);
  const own = useVendorRow(stockBookKey(ticker), 'inst-own');
  const held = useVendorRow(stockBookKey(ticker), 'etf-exposure');
  const shortLive = useShortRow(ticker);
  /* THE NAME'S OWN SHORT PRINT (the re-audit, 2026-10-22: AAPL, TSLA, GME and SPY read "—" — only names on the Shorts
     screen had one). /shorts/{t}/interest-float/v2 is already on this page's book; its newest settlement is the figure,
     the Shorts screen's row only when the name's own read has not answered */
  const siRow = useVendorRow(stockBookKey(ticker), 'si');
  const own_si = (() => {
    const rows = siRow?.state === 'live' && Array.isArray(siRow.data) ? (siRow.data as Record<string, unknown>[]) : [];
    const last = rows.filter(r => r && r.market_date).sort((a, b) => String(b.market_date).localeCompare(String(a.market_date)))[0];
    if (!last) return null;
    const f = numOf(last.si_float);
    if (f == null) return null;
    return { interestPct: f <= 1.5 ? f * 100 : f, daysToCover: numOf(last.days_to_cover) ?? 0, shortSharesM: (numOf(last.short_interest) ?? 0) / 1e6, asOf: String(last.market_date).slice(0, 10) };
  })();
  const short = own_si ?? (shortLive.row ? { interestPct: shortLive.row.interestPct, daysToCover: shortLive.row.daysToCover, shortSharesM: shortLive.row.shortSharesM, asOf: null as string | null } : null);
  const houses = people(own?.state === 'live' ? own.data : null);
  const funds = people(held?.state === 'live' ? held.data : null);
  const [fundsRef, fundsSeen] = useSeen<HTMLDivElement>();
  const own_ = useOwnWeights(ticker, funds.map(f => f.etf).filter(Boolean), fundsSeen);
  const largest = houses[0];
  const fund = funds[0];
  const fault: FeedFault | null = own?.fault ?? held?.fault ?? (shortLive.status === 'error' ? 'failed' : null);
  const at = own?.okAt ?? held?.okAt ?? null;
  const listed = houses.length + funds.length + (short ? 1 : 0);
  const waiting = !own || own.state === 'loading' || !held || held.state === 'loading' || shortLive.status === 'loading';
  const missed = listed === 0 && !waiting && (own?.state === 'error' || held?.state === 'error' || shortLive.status === 'error');
  /* EVERY FACT ENDS IN AN ANSWER (the retail test, 2026-10-23: AAPL's four facts sat at "…" after 35s). A read in flight
     is "…", then "still reading" once it has taken 20s (the feed answers three calls at a time, the options book first);
     a read that failed says so; one that answered with nothing is a dash. */
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const id = window.setTimeout(() => setSlow(true), 20_000);
    return () => window.clearTimeout(id);
  }, [ticker]);
  const pending = <span className="text-textMuted">{slow ? 'still reading' : '…'}</span>;
  const failedWord = <span className="text-textMuted" title="The feed did not answer this read">did not answer</span>;
  const state = (row: { state: string } | null | undefined): 'wait' | 'error' | 'done' => (!row || row.state === 'loading' ? 'wait' : row.state === 'error' ? 'error' : 'done');
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
          <Fact label="Largest house">{largest ? largest.name : state(own) === 'wait' ? pending : state(own) === 'error' ? failedWord : '—'}</Fact>
          <Fact label="Short interest">
            {short ? (
              <button type="button" onClick={() => navigate(`/dossier/shorts/${ticker}`)} className="hover:underline underline-offset-2" title={`Short interest as a share of the float${short.asOf ? `, settlement ${short.asOf}` : ''} — open the short file`} data-name-short>
                <TickFigure value={short.interestPct}>{`${short.interestPct.toFixed(2)}%`}</TickFigure>
                {short.asOf ? <span className="text-textMuted"> · {shortDay(short.asOf)}</span> : null}
              </button>
            ) : state(siRow) === 'wait' ? pending : state(siRow) === 'error' ? failedWord : '—'}
          </Fact>
          <Fact label="Fund holding most">{fund ? <>{fund.etf || fund.name}{fund.units !== '—' ? <span className="text-textMuted"> · {fund.units} shares</span> : null}</> : state(held) === 'wait' ? pending : state(held) === 'error' ? failedWord : '—'}</Fact>
          {/* the ownership read answers fifty houses a page — fifty is the page, not the count, so it reads "50+" */}
          <Fact label="Holders">{own?.state === 'live' || own?.okAt ? (own?.n == null ? '—' : own.n >= 50 ? '50+' : own.n) : state(own) === 'wait' ? pending : state(own) === 'error' ? failedWord : '—'}</Fact>
        </dl>
      </div>
      {missed ? (
        <FeedFallback fault={fault} />
      ) : null}
      {/* THREE BOOKS, EACH UNDER ITS OWN HEAD (the Dossier sweep, 2026-10-22): one "Weight · Value" head sat over houses,
          the short print and the funds alike, and the houses' raw counts printed as "1162996939 336524794350" */}
      {houses.length > 0 && (
        <>
          <Head cols={['Houses', 'Shares', 'Value']} />
          {houses.map(r => (
            <Row key={r.name} testId={r.name} onClick={() => navigate(`/dossier/institutions/${houseSlug(r.name)}?line=${ticker}`)} cells={[r.name, r.units, r.value]} />
          ))}
        </>
      )}
      {short && (
        <>
          <Head cols={[short.asOf ? `The short print · ${shortDay(short.asOf)}` : 'The short print', 'Days to cover', 'Shares short']} />
          <Row testId="short" onClick={() => navigate(`/dossier/shorts/${ticker}`)} cells={[`${short.interestPct.toFixed(2)}% of the float`, <TickFigure key="d" value={short.daysToCover}>{`${short.daysToCover.toFixed(1)} days`}</TickFigure>, <TickFigure key="s" value={short.shortSharesM}>{shares(short.shortSharesM * 1e6)}</TickFigure>]} />
        </>
      )}
      {funds.length > 0 && (
        <>
          {/* ONE ORDER, ITS OWN HEAD (round 8: SPY's funds came in shares-held order under a "Weight" head, and "Largest
              fund" named a $436M fund): the funds holding the most shares of the name first, the shares beside each, then
              the name's weight inside that fund */}
          <Head cols={['Funds · most shares first', 'Shares held', 'Of the fund']} />
          {funds.map(f => {
            const mine = own_[f.etf];
            const cell = mine ? (
              <span title={`From ${f.etf}'s own holdings file${mine.asOf ? `, ${mine.asOf}` : ''}`}>
                {mine.weight.toFixed(2)}%{mine.asOf ? <span className="text-textMuted"> · {shortDay(mine.asOf)}</span> : null}
              </span>
            ) : mine === undefined ? (
              '…'
            ) : (
              <span title={`${f.etf}'s holdings file does not list this name in its top lines — Unusual Whales' exposure figure, which can lag`}>{f.weight} <span className="text-textMuted">est.</span></span>
            );
            return <Row key={f.name} testId={f.name} onClick={() => navigate(`/dossier/etfs/${f.etf || f.name}`)} cells={[<span key="n">{f.name}{f.etf ? <span className="text-textMuted"> · {f.etf}</span> : null}</span>, f.units, cell]} />;
          })}
        </>
      )}
      {/* always in the page, so the funds' files are read once this end of the box is near the screen */}
      <div ref={fundsRef} className="h-3" />
    </section>
  );
};

const shares = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : `${Math.round(n)}`);
const dollars = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${Math.round(n / 1e3)}K`);
const numOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

function people(data: unknown): { name: string; units: string; value: string; weight: string; etf: string }[] {
  if (!Array.isArray(data)) return [];
  /* most shares of the name first — the order the head says, whatever order the feed sent */
  const held = (r: unknown) => (r && typeof r === 'object' ? numOf((r as Record<string, unknown>).units ?? (r as Record<string, unknown>).shares) ?? 0 : 0);
  return [...data].sort((a, b) => held(b) - held(a)).slice(0, 5).map(r => {
    if (!r || typeof r !== 'object') return { name: '—', units: '—', value: '—', weight: '—', etf: '' };
    const o = r as Record<string, unknown>;
    const name = quietText(String(o.name || o.short_name || o.full_name || o.etf || '—'));
    const w = numOf(o.weight);
    const u = numOf(o.units ?? o.shares);
    const v = numOf(o.value);
    return {
      name,
      units: u != null && u > 0 ? shares(u) : '—',
      value: v != null && v > 0 ? dollars(v) : '—',
      /* the weight is a percent with up to six places ("5.803098") — two, everywhere */
      weight: w != null ? `${w.toFixed(2)}%` : '—',
      etf: quietText(String(o.etf || '')),
    };
  });
}

export default NameBooks;
