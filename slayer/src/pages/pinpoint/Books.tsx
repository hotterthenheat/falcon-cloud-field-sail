/* Pinpoint → Books: the two books of docs/TWO_BOOK_SPEC_V2.md side by side, never added together.
   - The open-interest book (Model 1): listed open interest, dealers long the calls and short the puts by convention;
     four figures are the listing's own exposures converted to house units, six are the house model on the same
     contracts (zero rate and carry, the listed row price).
   - The flow book (Model 2): today's prints, each signed by the side that crossed the quote; the modelled dealer is the
     other side; revalued now from current quotes at the spot implied by the forwards.
   Each board carries its provenance, unit, model, timestamp and the share priced on a modelled vol. One time unit per
   board (per hour when any contract has under a day left). Sources are described, never named (owner's rule). */

import { useTicker } from '../../context/MarketDataContext';
import { useTwoBooks } from '../../data/twobook/useTwoBooks';
import type { FlowBoardWire } from '../../data/twobook/flowBook';
import type { Model1Metric, Model1Wire } from '../../data/twobook/model1';

const ORDER = ['GEX', 'DEX', 'VANNA', 'CHARM', 'VEGA', 'VOMMA', 'COLOR', 'SPEED', 'VETA', 'ZOMMA'] as const;
type Name = (typeof ORDER)[number];

const WHAT: Record<Name, string> = {
  GEX: 'hedge change for a 1% move',
  DEX: 'dollar delta',
  VANNA: 'delta change per vol point',
  CHARM: 'delta change per',
  VEGA: 'per vol point',
  VOMMA: 'vega change per vol point',
  COLOR: 'GEX change per',
  SPEED: 'speed part of GEX change per 1%',
  VETA: 'vega change per',
  ZOMMA: 'GEX change per vol point',
};
const TIMED = new Set<Name>(['CHARM', 'COLOR', 'VETA']);

const PROV_WORDS: Record<string, string> = {
  OBSERVED: 'observed',
  CALCULATED: 'calculated',
  MODELED: 'modelled',
  APPROX: 'approximate',
  EXPIRED: 'expired',
  UNAVAILABLE: 'unavailable',
  READING: 'reading the prints…',
};

export function fmtMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : v > 0 ? '+' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const clock = (ms: number | null | undefined) =>
  ms == null || !Number.isFinite(ms) ? '—' : new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms)) + ' ET';

function Row({ name, value, per, prov, unit, rate }: { name: Name; value: number | null; per?: string; prov: string; unit: 'day' | 'hour'; rate?: boolean }) {
  const perWords = TIMED.has(name) ? `${WHAT[name]} calendar ${unit}${rate && unit === 'hour' ? ' (rate)' : ''}` : per ?? WHAT[name];
  return (
    <tr className="border-t border-borderMuted/60" data-book-metric={name}>
      <td className="py-1 pr-2 font-mono text-t11 text-textPrimary">{name}</td>
      <td className={`py-1 pr-2 text-right font-mono text-t12 tabular-nums ${value != null && value < 0 ? 'text-bear' : 'text-textPrimary'}`}>{fmtMoney(value)}</td>
      <td className="py-1 pr-2 text-t10 text-textMuted">{perWords}</td>
      <td className="py-1 text-right text-t10 text-textMuted">{PROV_WORDS[prov] ?? prov.toLowerCase()}</td>
    </tr>
  );
}

function Card({ title, line, children, testId }: { title: string; line: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="rounded-lg border border-borderMuted bg-panel/40 p-3 min-w-0" data-testid={testId}>
      <h2 className="text-t14 font-medium text-textPrimary">{title}</h2>
      <p className="mt-0.5 text-t11 text-textMuted">{line}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Facts({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-t11">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-textMuted">{k}</dt>
          <dd className="font-mono text-textPrimary min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function OiBoard({ w }: { w: Model1Wire }) {
  if (!w.available) return <p className="text-t12 text-textMuted">Unavailable for {w.ticker}: {w.why}. The flow book beside it still reads today&apos;s prints.</p>;
  const m = (n: Name): Model1Metric | undefined => (w.four as Record<string, Model1Metric> | null)?.[n] ?? (w.six as Record<string, Model1Metric> | null)?.[n];
  return (
    <>
      <Facts
        items={[
          ['As of', clock(w.at)],
          ['Priced at', `${w.price} (the listed row price)`],
          ['Unit', `house units; time rates per calendar ${w.unit}`],
          ['Model', 'four: the listing’s exposures, converted · six: house model, zero rate and carry'],
          ['Position', 'dealers long listed calls, short listed puts (convention, not observed)'],
          ['Vol', `${pct(w.oi.share.approx)} of open interest on listed vols (approximate) · ${pct(w.oi.share.modeled)} on the nearest strike’s vol (modelled)`],
        ]}
      />
      <table className="mt-2 w-full">
        <tbody>
          {ORDER.map(n => {
            const x = m(n);
            return <Row key={n} name={n} value={x?.value ?? null} prov={x?.provenance ?? 'UNAVAILABLE'} unit={w.unit} rate={w.rateNotForecast} />;
          })}
        </tbody>
      </table>
      <ul className="mt-2 space-y-0.5 text-t10 text-textMuted">
        {w.flagged.map(f => (
          <li key={f.expiry}>
            {f.expiry} on its own line (it may hold contracts settled this morning): GEX {fmtMoney(f.GEX)}, DEX {fmtMoney(f.DEX)} — outside the totals.
          </li>
        ))}
        {w.dropped.rows > 0 && <li>{w.dropped.rows} rows of expired contracts left out (GEX {fmtMoney(w.dropped.GEX)}, charm {fmtMoney(w.dropped.CHARM)}).</li>}
        <li>The listing&apos;s own delta sign (puts not turned): {fmtMoney(w.dexVendorSign)} — shown for reference only.</li>
        {w.notes.map(n => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

function FlowBoard({ w }: { w: FlowBoardWire }) {
  /* nothing read yet: say so rather than print zeros */
  const t = w.flow.prints > 0 ? (w.totals as Record<Name, number> | null) : null;
  const flagged = (w.flow.buckets.BUY ?? 0) + (w.flow.buckets.SELL ?? 0);
  const all = Object.values(w.flow.buckets).reduce((a, b) => a + b, 0);
  return (
    <>
      <Facts
        items={[
          ['Valued at', `${clock(w.valuedAt)}${w.live ? ' (live)' : ''}`],
          ['Spot', w.spot ? `${w.spot.S.toFixed(2)} implied by the forwards${w.spot.prov === 'APPROX' ? ' (approximate: one forward)' : ''}` : '—'],
          ['Rate', w.rate ? `${(w.rate.r * 100).toFixed(2)}% (overnight rate of ${w.rate.day})` : '—'],
          ['Unit', `house units; time rates per calendar ${w.unit}${w.rateNotForecast ? ' (instantaneous rate)' : ''}`],
          ['Model', 'house model on current quotes; each expiry priced off its own forward'],
          ['Position', 'opposite the side that crossed the quote (modelled, not observed)'],
          ['Inventory', `${w.flow.contracts} contracts carry net prints · Σ|C| ${Math.round(w.absC).toLocaleString()} · ${pct(w.modeledShare)} on the nearest strike’s vol (modelled)`],
          ['Prints', `${w.flow.prints.toLocaleString()} read through ${clock(w.through)} · ${all ? pct(flagged / all) : '—'} of contracts signed · ${w.flow.unlinkedCancels} cancels not linked`],
          ['Population', w.population],
        ]}
      />
      <table className="mt-2 w-full">
        <tbody>
          {ORDER.map(n => (
            <Row key={n} name={n} value={t?.[n] ?? null} prov={t ? 'MODELED' : w.flow.prints ? 'UNAVAILABLE' : 'READING'} unit={w.unit} rate={w.rateNotForecast} />
          ))}
        </tbody>
      </table>
      <Facts
        items={[
          ['GEX change for +1%', `${fmtMoney(w.totalGexChange1pct)} (speed and gamma together)`],
          ['Hedge', w.hedge ? `${fmtMoney(w.hedge.hedge_dollars)} of the underlying${w.hedge.esEquivalent != null ? ` ≈ ${Math.round(w.hedge.esEquivalent).toLocaleString()} index futures (beta 1)` : ''}` : '—'],
        ]}
      />
      {w.fault && <p className="mt-1 text-t10 text-bear">{w.fault}</p>}
    </>
  );
}

export default function Books() {
  const { activeTicker } = useTicker();
  const { oi, flow } = useTwoBooks(activeTicker);
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3" data-testid="pinpoint-books">
      <p className="mb-2 text-t11 text-textMuted">
        {activeTicker}: two separate books. Opposite signs between them are meaningful; they are never added together, and neither is verified dealer inventory.
      </p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Open-interest book" line="Listed open interest from the last report, priced as listed" testId="book-oi">
          {oi.data ? <OiBoard w={oi.data} /> : <p className="text-t12 text-textMuted">{oi.error ? `Not available: ${oi.error}` : 'Reading the listed book…'}</p>}
        </Card>
        <Card title="Flow book" line="Today's prints, signed by the side that crossed, revalued now" testId="book-flow">
          {flow.data ? <FlowBoard w={flow.data} /> : <p className="text-t12 text-textMuted">{flow.error ? `Not available: ${flow.error}` : 'Reading today’s prints…'}</p>}
        </Card>
      </div>
    </div>
  );
}
