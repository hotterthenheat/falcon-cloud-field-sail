/* REVIEW · what a strike opens onto. */

import Term from '../ui/Term';
import type { ContractDay, ContractId, Quote } from '../../data/review/quotes';

const count = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

const Stat = ({ label, value, term, ink }: { label: string; value: string; term?: string; ink?: string }) => (
  <span className="flex flex-col gap-0.5 min-w-0">
    <span className="font-mono text-t9 uppercase tracking-widest text-silver whitespace-nowrap">{term ? <Term k={term as never}>{label}</Term> : label}</span>
    <span className={`font-mono text-t11 font-semibold tnum ${ink ?? 'text-textPrimary'}`}>{value}</span>
  </span>
);

const money = (v: number) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : '—');
const greek = (v: number, on: boolean) => (on && Number.isFinite(v) ? v.toFixed(4) : '—');

/* Every figure is the recorded day's: the bid, the ask and the mid at the clock's minute, the mid's range so far, the
   prints so far; the IV and the greeks are computed from the mid and the name's price */
const ContractDrill = ({ contract, quote: q, day: d }: { contract: ContractId; quote: Quote; day: ContractDay }) => (
  <div className="px-4 py-3 bg-silver/[0.04] border-y border-borderSubtle/70 flex flex-col gap-3 animate-soft-in" data-chain-drill={contract.strike}>
    <div className="flex flex-col gap-2">
      <span className="font-mono text-t9 font-bold uppercase tracking-widest text-textSecondary">Stats</span>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        <Stat label="Bid" value={q.dead ? '—' : money(q.bid)} />
        <Stat label="Mid" term="Mark" value={q.dead ? '—' : money(q.mark)} />
        <Stat label="Ask" value={q.dead ? '—' : money(q.ask)} />
        <Stat label="Mid high so far" value={money(d.high)} />
        <Stat label="Mid low so far" value={money(d.low)} />
        <Stat label="Last print" value={money(d.last)} />
        <Stat label="Volume so far" term="Volume" value={Number.isFinite(d.volume) ? count(d.volume) : '—'} />
        <Stat label="IV" term="IV" value={q.iv > 0 ? `${(q.iv * 100).toFixed(2)}%` : '—'} />
        <Stat label="Breakeven" term="Breakeven" value={money(d.breakeven)} />
        <Stat label="Name must move" value={Number.isFinite(d.toBreakevenPct) ? `${d.toBreakevenPct >= 0 ? '+' : ''}${d.toBreakevenPct.toFixed(1)}%` : '—'} ink={!Number.isFinite(d.toBreakevenPct) ? undefined : d.toBreakevenPct >= 0 ? 'text-bull' : 'text-bear'} />
      </div>
    </div>
    <div className="flex flex-col gap-2">
      <span className="font-mono text-t9 font-bold uppercase tracking-widest text-textSecondary">The Greeks</span>
      <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        <Stat label={q.greekNote ? `Delta · ${q.greekNote}` : 'Delta'} term="Delta" value={greek(q.delta, q.iv > 0)} />
        <Stat label="Gamma" term="Gamma" value={greek(q.gamma, q.iv > 0)} />
        <Stat label="Theta / session" term="Theta" value={greek(q.theta, q.iv > 0)} />
        <Stat label="Vega / 1.00" term="Vega" value={greek(q.vega, q.iv > 0)} />
        <Stat label="Rho / 1.00" term="Rho" value={greek(q.rho, q.iv > 0)} />
      </div>
    </div>
  </div>
);

export default ContractDrill;
