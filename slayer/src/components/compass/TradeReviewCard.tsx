/* One trade, reviewed after the session: the verdict and its cause first, then the numbers that make it (the fill
   and the exit, where the money went), then the entry snapshot (the inputs that pushed Model 1 up and held it down).
   The model is named, never scored: no score and no score's weight is printed. */

import type { TradeReview, Driver } from '../../data/compassStudy';
import ContractLabel from '../ui/ContractLabel';
import { Tip } from '../ui/Tooltip';
import { Link } from 'react-router-dom';
import { MODEL_WORD, RIDING_WORD, modelOfBook } from '../../data/compassParams';

const usd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}$${Math.abs(v).toFixed(2)}`);
const px = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `$${v.toFixed(2)}`);
const pct = (v: number | null | undefined, digits = 2) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}%`);
const ink = (v: number | null | undefined) => (v == null || !Number.isFinite(v) || Math.abs(v) < 0.005 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

const Num = ({ label, value, tone = 'text-textPrimary', title }: { label: string; value: string; tone?: string; title?: string }) => (
  <div className="min-w-0" title={title}>
    <div className="font-mono text-t9 uppercase tracking-widest text-textMuted">{label}</div>
    <div className={`mt-0.5 font-mono text-t13 font-semibold tnum truncate ${tone}`}>{value}</div>
  </div>
);

const Drivers = ({ title, rows }: { title: string; rows: Driver[] }) => (
  <div className="min-w-0">
    <div className="font-mono text-t9 uppercase tracking-widest text-textMuted">{title}</div>
    {rows.length ? (
      <ul className="mt-1 space-y-0.5">
        {rows.map(d => (
          <li key={d.col} className="flex items-baseline gap-2 font-mono text-t11 tnum">
            <span className="text-textSecondary truncate">{d.name}</span>
            <span className="text-textMuted">{d.value == null ? 'missing' : Math.abs(d.value) >= 100 ? d.value.toFixed(0) : d.value.toPrecision(3)}</span>
            <span className={`ml-auto ${d.credit > 0 ? 'text-bull' : 'text-bear'}`}>{d.credit > 0 ? 'up' : 'down'}</span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="mt-1 font-mono text-t11 text-textMuted">No model row ({MODEL_WORD[3]} is a rule, not a score).</p>
    )}
  </div>
);

const CAUSE_INK: Record<string, string> = {
  'direction right': 'text-bull',
  'IV expansion': 'text-bull',
  'still open': 'text-textSecondary',
  'not filled': 'text-textMuted',
};

const TradeReviewCard = ({ r, compact = false }: { r: TradeReview; compact?: boolean }) => {
  const a = r.after;
  const p = a.parts;
  const right = r.contract.trim().endsWith('C') ? 'C' : 'P';
  const spread = p.spreadIn == null && p.spreadOut == null ? null : -((p.spreadIn ?? 0) + (p.spreadOut ?? 0));
  return (
    <article id={r.key} className="border border-borderSubtle bg-panel rounded-md overflow-hidden" data-trade-review={r.key}>
      <header className="flex items-center gap-2 flex-wrap px-3.5 py-2.5 border-b border-borderSubtle">
        <ContractLabel contract={r.contract} right={right} logo={r.contract.split(' ')[0]} size="sm" />
        <span className="font-mono text-t10 font-bold uppercase tracking-wider text-textPrimary border border-silver/50 rounded px-1.5 py-0.5">{modelOfBook(r.book) || r.book}</span>
        {r.would ? (
          <Tip label="A mark scored late from recorded quotes cleared every gate. Late marks are never calls and never take a seat: this is what it would have done.">
            <span className="font-mono text-t10 text-warn border border-warn/40 rounded px-1.5 py-0.5">Would have called</span>
          </Tip>
        ) : (
          <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">Live call</span>
        )}
        <span className="font-mono text-t10 text-textMuted tnum">{r.mark} ET mark</span>
        <span className={`ml-auto font-mono text-t11 uppercase tracking-wider ${CAUSE_INK[r.verdict.cause] ?? 'text-bear'}`}>{r.verdict.cause}</span>
        {r.key.includes('|') && (
          <Link to={`/compass/${r.key.split('|')[1]}?day=${r.key.split('|')[0]}`} state={{ from: 'Review' }} className="slayer-chip uppercase tracking-wider" data-review-contract>
            Inside the contract
          </Link>
        )}
      </header>
      <div className="px-3.5 py-3 flex flex-col gap-3">
        <p className="text-t12 leading-relaxed text-textPrimary" data-review-line>{r.verdict.line}</p>
        {r.verdict.flags.length > 0 && (
          <p className="font-mono text-t10 text-warn">{r.verdict.flags.join(' · ')}</p>
        )}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <Num label="Model" value={r.book === 'C' ? MODEL_WORD[3] : r.book === 'A' && r.p2 != null && r.p2 >= 0.5 ? RIDING_WORD : MODEL_WORD[1]} title={r.book === 'C' ? `${MODEL_WORD[3]} is the late sweep: a rule, not a score.` : undefined} />
          <Num label="At call" value={`${r.snapshot.bid.toFixed(2)}×${r.snapshot.ask.toFixed(2)}`} />
          <Num label="Fill" value={a.fill == null ? '—' : `${px(a.fill)} ${a.fillAt ?? ''}`} />
          <Num label="Exit" value={a.exit == null ? '—' : `${px(a.exit)} ${a.exitAt ?? ''}`} title={a.why} />
          <Num label="P&L" value={usd(a.pnl)} tone={ink(a.pnl)} />
          <Num label="Held" value={a.heldMin == null ? '—' : `${a.heldMin}m`} />
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 border-t border-borderSubtle/60 pt-3" data-review-parts>
          <Num label="Direction" value={usd(p.direction)} tone={ink(p.direction)} title="The underlying's move, repriced at the fill's implied vol and time" />
          <Num label="Decay" value={usd(p.decay)} tone={ink(p.decay)} title="Time passing at the exit's price of the underlying" />
          <Num label="IV" value={usd(p.iv)} tone={ink(p.iv)} title="The change in implied vol from the fill to the exit" />
          <Num label="Spread" value={usd(spread)} tone={ink(spread)} title="The ask paid over the mid, and the mid over the exit price" />
          <Num label="Underlying" value={pct(a.underMove)} tone={ink(a.underMove)} title="Its move from the fill to the exit, signed for the side" />
        </div>
        {!compact && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-borderSubtle/60 pt-3">
            <Num label="IV fill → exit" value={a.ivFill == null ? '—' : `${(a.ivFill * 100).toFixed(1)}% → ${a.ivExit == null ? '—' : `${(a.ivExit * 100).toFixed(1)}%`}`} />
            <Num label="Mid fill → exit" value={a.midFill == null ? '—' : `${a.midFill.toFixed(2)} → ${a.midExit == null ? '—' : a.midExit.toFixed(2)}`} />
            <Num label="Underlying best · worst" value={`${pct(a.underBest)} · ${pct(a.underWorst)}`} />
            <Num label="Best bid to the flat" value={px(a.bestBid)} tone={a.targetLater ? 'text-warn' : 'text-textPrimary'} />
          </div>
        )}
        {!compact && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-borderSubtle/60 pt-3" data-review-drivers>
            <Drivers title={`Pushed ${MODEL_WORD[1]} up`} rows={r.snapshot.up} />
            <Drivers title={`Held ${MODEL_WORD[1]} down`} rows={r.snapshot.down} />
          </div>
        )}
      </div>
    </article>
  );
};

export default TradeReviewCard;
