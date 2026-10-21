/*
  THE LIVE FUTURES TAPE.

  Futures lived only inside Paper and Backtest. This is the tape: the
  contract, the print, the side, and under it the rate strip (SOFR and the
  Treasury curve) the equity book is priced against. Sample until the CME
  endpoints and the Theta rate history are plugged in.
*/

import { useMemo } from 'react';
import { buildFuturesTape, buildRates } from '../../data/fileBooks';
import { sessionMeta, useDeskSession } from '../../data/deskSession';

const FuturesTape = () => {
  const session = useDeskSession();
  const prints = useMemo(() => buildFuturesTape(session), [session]);
  const rates = useMemo(() => buildRates(), []);
  const meta = sessionMeta(session);
  return (
    <div data-futures-tape>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        <div>
          <dt className="text-[10px] text-textMuted">Session</dt>
          <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{meta.label} · {meta.window}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-textMuted">Prints</dt>
          <dd className="mt-0.5 font-mono text-[12px] tnum text-textPrimary">{prints.length}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-textMuted">Status</dt>
          <dd className="mt-0.5 font-mono text-[12px] uppercase tracking-widest text-warn">sample</dd>
        </div>
      </dl>
      <p className="text-[12px] leading-relaxed text-textSecondary">
        The CME contracts that are actually trading, newest first. Equity options do not print here. The session card in the head is the same one Pinpoint and the rest of Trace read.
      </p>
      <div className="overflow-x-auto border border-borderSubtle rounded-md bg-panel" data-futures-prints>
        <div className="min-w-[340px]">
        <div className="px-3 sm:px-5 h-[22px] grid items-center gap-x-2 text-[9px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: '72px 52px minmax(0,1fr) 40px 44px' }}>
          <span>Time</span>
          <span>Contract</span>
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Side</span>
        </div>
        {prints.map(p => (
          <div key={p.id} className="px-3 sm:px-5 h-[32px] grid items-center gap-x-2 border-t border-borderSubtle/40" style={{ gridTemplateColumns: '72px 52px minmax(0,1fr) 40px 44px' }}>
            <span className="font-mono text-[11px] tnum text-textMuted">{p.time}</span>
            <span className="font-mono text-[12px] font-bold text-textPrimary">{p.contract}</span>
            <span className="font-mono text-[12px] tnum text-textPrimary">{p.price.toFixed(2)}</span>
            <span className="text-right font-mono text-[11px] tnum text-textSecondary">{p.size}</span>
            <span className={`text-right font-mono text-[10px] uppercase tracking-widest ${p.side === 'buy' ? 'text-bull' : 'text-bear'}`}>{p.side}</span>
          </div>
        ))}
        </div>
      </div>
      <section className="border border-borderSubtle rounded-md bg-panel" data-rates>
        <div className="px-5 pt-4 pb-3">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[15px] font-semibold text-textPrimary">Rates</h3>
            <span className="font-mono text-[8px] uppercase tracking-widest text-warn">sample</span>
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted">SOFR and the Treasury curve the options are discounted against</p>
        </div>
        {rates.map(r => (
          <div key={r.tenor} className="px-5 h-[32px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: '120px 1fr 80px 72px' }}>
            <span className="text-[12px] text-textPrimary">{r.name}</span>
            <span className="text-[12px] text-textSecondary">{r.tenor}</span>
            <span className="text-right font-mono text-[12px] tnum text-textPrimary">{r.rate.toFixed(3)}%</span>
            <span className={`text-right font-mono text-[11px] tnum ${r.changeBp > 0 ? 'text-bear' : r.changeBp < 0 ? 'text-bull' : 'text-textMuted'}`}>
              {r.changeBp > 0 ? '+' : ''}{r.changeBp.toFixed(1)} bp
            </span>
          </div>
        ))}
        <div className="h-3" />
      </section>
    </div>
  );
};

export default FuturesTape;
