/* The Map's book switch and its "Sources & units" card (docs/TWO_BOOK.md §The Map). The switch sets which of the two books
   the whole Map draws — the matrix, the chart, the walls, the flip and the regime, and the pages that follow the Map's
   name (data/bookMode.ts). The card says what the book on screen is: when it was valued and at what price, its unit and
   model, its position assumption, the share priced on a modelled vol, what was left out, and the rest of the provenance
   the two-book spec asks every board to carry (§3.6, §8). The two books are never added together. Sources are described,
   never named. */

import { useEffect } from 'react';
import { BOOK_MODE_WORDS, setBookMode, useBookMode, type BookMode } from '../../data/bookMode';
import { useBookRev } from '../../data/book/store';
import { bookFor, flowFocus, peekBook } from '../../data/twobook/engineBook';
import type { FlowBoardWire } from '../../data/twobook/flowBook';
import type { Model1Wire } from '../../data/twobook/model1';
import PopoverCard from '../ui/PopoverCard';

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

const ORDER = ['GEX', 'DEX', 'VANNA', 'CHARM', 'VEGA', 'VOMMA', 'COLOR', 'SPEED', 'VETA', 'ZOMMA'] as const;
type Name = (typeof ORDER)[number];
const WHAT: Record<Name, string> = {
  GEX: 'hedge change for a 1% move',
  DEX: 'dollar delta',
  VANNA: 'delta change per vol point',
  CHARM: 'delta change per calendar',
  VEGA: 'per vol point',
  VOMMA: 'vega change per vol point',
  COLOR: 'GEX change per calendar',
  SPEED: 'speed part of GEX change per 1%',
  VETA: 'vega change per calendar',
  ZOMMA: 'GEX change per vol point',
};
const TIMED = new Set<Name>(['CHARM', 'COLOR', 'VETA']);
const PROV_WORDS: Record<string, string> = { OBSERVED: 'observed', CALCULATED: 'calculated', MODELED: 'modelled', APPROX: 'approximate', EXPIRED: 'expired', UNAVAILABLE: 'unavailable', READING: 'reading…' };

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

function Totals({ rows, unit, rate }: { rows: { name: Name; value: number | null; prov: string }[]; unit: 'day' | 'hour'; rate: boolean }) {
  return (
    <table className="mt-2 w-full" data-book-totals>
      <tbody>
        {rows.map(r => (
          <tr key={r.name} className="border-t border-borderMuted/60" data-book-metric={r.name} data-book-value={r.value ?? ''}>
            <td className="py-0.5 pr-2 font-mono text-t11 text-textPrimary">{r.name}</td>
            <td className={`py-0.5 pr-2 text-right font-mono text-t11 tabular-nums ${r.value != null && r.value < 0 ? 'text-bear' : 'text-textPrimary'}`}>{fmtMoney(r.value)}</td>
            <td className="py-0.5 pr-2 text-t10 text-textMuted">{TIMED.has(r.name) ? `${WHAT[r.name]} ${unit}${rate && unit === 'hour' ? ' (rate)' : ''}` : WHAT[r.name]}</td>
            <td className="py-0.5 text-right text-t10 text-textMuted">{PROV_WORDS[r.prov] ?? r.prov.toLowerCase()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OiCard({ w }: { w: Model1Wire }) {
  if (!w.available) return <p className="text-t11 text-textMuted">Unavailable for {w.ticker}: {w.why}.</p>;
  const m = (n: Name) => (w.four as Record<string, { value: number; provenance: string }> | null)?.[n] ?? (w.six as Record<string, { value: number; provenance: string }> | null)?.[n];
  return (
    <>
      <Facts
        items={[
          ['As of', clock(w.at)],
          ['Priced at', `${w.price} (the listed row price; index rows are rounded)`],
          ['Unit', `house units; time rates per calendar ${w.unit}${w.rateNotForecast ? ' (instantaneous rate)' : ''}`],
          ['Model', 'four: the listing’s own exposures, converted to house units · six: house model on the same contracts, zero rate and carry'],
          ['Position', 'dealers long the listed calls, short the listed puts (a convention, not observed positions)'],
          ['Vol', w.phase === 'rows' ? 'the contracts are still being read — the six follow' : `${pct(w.oi.share.approx)} of open interest on listed vols (approximate) · ${pct(w.oi.share.modeled)} on the nearest strike’s vol (modelled)`],
          ['Population', `${w.rows.used.toLocaleString()} rows at one timestamp${w.rows.otherTimestamp ? ` (${w.rows.otherTimestamp} of another left out)` : ''}${w.phase === 'full' ? ` · ${w.oi.contracts.toLocaleString()} contracts priced` : ''}`],
        ]}
      />
      <Totals rows={ORDER.map(n => ({ name: n, value: m(n)?.value ?? null, prov: m(n)?.provenance ?? (w.phase === 'rows' ? 'READING' : 'UNAVAILABLE') }))} unit={w.unit} rate={w.rateNotForecast} />
      <ul className="mt-2 space-y-0.5 text-t10 leading-relaxed text-textMuted">
        {w.flagged.map(f => (
          <li key={f.expiry}>
            {f.expiry} on its own line, outside the totals and the Map (it may hold contracts settled this morning): GEX {fmtMoney(f.GEX)}, DEX {fmtMoney(f.DEX)}.
          </li>
        ))}
        {w.dropped.rows > 0 && <li>{w.dropped.rows} rows of expired contracts left out (GEX {fmtMoney(w.dropped.GEX)}, charm {fmtMoney(w.dropped.CHARM)}).</li>}
        {w.oi.expired > 0 && <li>{w.oi.expired.toLocaleString()} expired contracts left out of the six.</li>}
        <li>The listing’s own delta sign (puts not turned): {fmtMoney(w.dexVendorSign)} — for reference only; the Map’s DEX turns the puts.</li>
        {w.notes.map(n => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

function FlowCard({ w }: { w: FlowBoardWire }) {
  const t = w.flow.prints > 0 ? (w.totals as Record<Name, number> | null) : null;
  const signed = (w.flow.buckets.BUY ?? 0) + (w.flow.buckets.SELL ?? 0);
  const all = Object.values(w.flow.buckets).reduce((a, b) => a + b, 0);
  const share = (k: string) => (all ? pct((w.flow.buckets[k] ?? 0) / all) : '—');
  return (
    <>
      <Facts
        items={[
          ['Valued at', `${clock(w.valuedAt)}${w.live ? ' (live)' : ''}`],
          ['Priced at', w.spot ? `${w.spot.S.toFixed(2)}, the spot the forwards imply${w.spot.prov === 'APPROX' ? ' (approximate: one forward)' : ''}` : '—'],
          ['Rate', w.rate ? `${(w.rate.r * 100).toFixed(2)}% (overnight rate of ${w.rate.day}); each expiry’s carry measured from its own forward` : '—'],
          ['Unit', `house units; time rates per calendar ${w.unit}${w.rateNotForecast ? ' (instantaneous rate)' : ''}`],
          ['Model', 'house model on current quotes, every vol solved from its own mid; each expiry priced off its own forward'],
          ['Position', 'opposite the side that crossed the quote (modelled, not observed); never open interest'],
          ['Vol', `${pct(w.modeledShare)} of the inventory on the nearest strike’s vol (modelled)`],
          ['Inventory', `${w.flow.contracts.toLocaleString()} contracts carry net prints · Σ|contracts| ${Math.round(w.absC).toLocaleString()}`],
          ['Prints', `${w.flow.prints.toLocaleString()} read through ${clock(w.through)}`],
          ['Signed', `${all ? pct(signed / all) : '—'} of contracts · inside the spread ${share('MID')} · multi-leg ${share('EXCLUDED_COMPLEX')} · stale quote ${share('EXCLUDED_STALE_QUOTE')} · late ${share('EXCLUDED_LATE')}`],
          ['Cancels', `${w.flow.linkedCancels} linked and removed · ${w.flow.unlinkedCancels} not linked`],
          ['Population', w.population],
        ]}
      />
      <Totals rows={ORDER.map(n => ({ name: n, value: t?.[n] ?? null, prov: t ? 'MODELED' : w.flow.prints ? 'UNAVAILABLE' : 'READING' }))} unit={w.unit} rate={w.rateNotForecast} />
      <ul className="mt-2 space-y-0.5 text-t10 leading-relaxed text-textMuted">
        <li>GEX change for +1%: {fmtMoney(w.totalGexChange1pct)} (speed and gamma together).</li>
        {w.hedge && <li>Hedge: {fmtMoney(w.hedge.hedge_dollars)} of the underlying{w.hedge.esEquivalent != null ? ` ≈ ${Math.round(w.hedge.esEquivalent).toLocaleString()} index futures (beta 1)` : ''}.</li>}
        <li>Today’s net prints, not inventory: prints cannot show opening against closing, or whether a dealer was the other side.</li>
        {w.fault && <li className="text-bear">{w.fault}</li>}
      </ul>
    </>
  );
}

/** The switch: the two books, one at a time — the whole Map follows it */
export function BookSwitch({ ticker, names = [] }: { ticker: string; names?: readonly string[] }) {
  const mode = useBookMode();
  useBookRev();
  const focusKey = [ticker, ...names].filter(Boolean).join(',');
  useEffect(() => {
    for (const t of focusKey.split(',')) flowFocus(t);
  }, [focusKey]);
  const pick = (m: BookMode) => setBookMode(m);
  const shown = bookFor(ticker);
  return (
    <span className="inline-flex items-center gap-1" data-book-switch={mode} data-book-shown={shown}>
      <span role="radiogroup" aria-label="Which book the Map draws" className="inline-flex items-center rounded-md border border-borderMuted p-px font-mono text-t10">
        {(['oi', 'flow'] as const).map(m => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            data-book-toggle={m}
            title={BOOK_MODE_WORDS[m].line}
            onClick={() => pick(m)}
            className={`px-1.5 py-0.5 rounded-[5px] transition-colors ${mode === m ? 'bg-ink/[0.1] text-textPrimary' : 'text-textMuted hover:text-textPrimary'}`}
          >
            {BOOK_MODE_WORDS[m].label}
          </button>
        ))}
      </span>
      <BookSourcesDoor ticker={ticker} />
    </span>
  );
}

/** "Sources & units": the provenance of the book on screen; it changes with the switch */
export function BookSourcesDoor({ ticker }: { ticker: string }) {
  useBookRev();
  const mode = bookFor(ticker);
  const got = peekBook(ticker, mode);
  const w = got.wire;
  return (
    <PopoverCard
      trigger={
        <button type="button" className="px-1 py-0.5 font-mono text-t10 text-textMuted hover:text-textPrimary underline-offset-2 hover:underline" data-book-sources-door>
          Sources &amp; units
        </button>
      }
      title={`${BOOK_MODE_WORDS[mode].label} · ${ticker}`}
      meta={mode === 'flow' ? 'model 2' : 'model 1'}
      width={440}
      testId="book-sources"
    >
      <div className="px-3 py-2.5" data-book-sources={mode}>
        <p className="mb-2 text-t11 leading-relaxed text-textSecondary">
          {BOOK_MODE_WORDS[mode].line}. The two books are separate: opposite signs between them are meaningful, they are never added together, and neither is verified dealer inventory. Every figure on the Map is this book’s, cell by cell; its totals are these.
        </p>
        {w ? w.model === 1 ? <OiCard w={w} /> : <FlowCard w={w} /> : <p className="text-t11 text-textMuted">{got.error ? `Not available: ${got.error}` : mode === 'flow' ? 'Reading today’s prints…' : 'Reading the listed book…'}</p>}
      </div>
    </PopoverCard>
  );
}
