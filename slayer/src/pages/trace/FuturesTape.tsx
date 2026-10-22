/*
  THE LIVE FUTURES TAPE.

  Futures lived only inside Paper and Backtest. This is the tape: the
  contract, the print, the side, and under it the rate strip (SOFR and the
  Treasury curve) the equity book is priced against. Sample until the CME
  endpoints and the Theta rate history are plugged in.

  In the Trace box's grammar (the audit, 2026-10-22): the same head, facts
  and sentence as every other Trace page, the tape as the box's body — it
  had stood as a loose dl and a paragraph butted against its table.
*/

import { useMemo } from 'react';
import { buildFuturesTape, buildRates } from '../../data/fileBooks';
import { sessionMeta, useDeskSession } from '../../data/deskSession';
import { Fact, TraceBox } from '../../components/trace/TraceBox';

/** Time · contract · price · size · side — the contract column wide enough that it never runs into the price */
const PRINT_COLS = '84px 88px minmax(0,1fr) 56px 56px';

const FuturesTape = () => {
  const session = useDeskSession();
  const prints = useMemo(() => buildFuturesTape(session), [session]);
  const rates = useMemo(() => buildRates(), []);
  const meta = sessionMeta(session);
  return (
    <div className="flex flex-col gap-3" data-futures-tape>
      <TraceBox
        title="The futures tape"
        sub="The CME contracts that are actually trading, newest first · equity options do not print here"
        testId="futures"
        facts={
          <>
            <Fact label="Session" testId="session">
              {meta.label} <span className="text-textSecondary">· {meta.window}</span>
            </Fact>
            <Fact label="Prints" testId="prints">
              {prints.length}
            </Fact>
            <Fact label="Status" testId="status">
              <span className="uppercase tracking-widest text-warn">sample</span>
            </Fact>
          </>
        }
        controls={null}
        sentence="The session card in the head is the same one Pinpoint and the rest of Trace read."
      >
        <div className="overflow-x-auto border-t border-borderSubtle" data-futures-prints>
          <div className="min-w-[360px]">
            <div className="px-3 sm:px-5 h-8 grid items-center gap-x-3 font-mono text-[10px] uppercase tracking-widest text-textMuted" style={{ gridTemplateColumns: PRINT_COLS }}>
              <span>Time</span>
              <span>Contract</span>
              <span>Price</span>
              <span className="text-right">Size</span>
              <span className="text-right">Side</span>
            </div>
            {prints.map(p => (
              <div key={p.id} className="px-3 sm:px-5 h-[32px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: PRINT_COLS }}>
                <span className="font-mono text-[11px] tnum text-textMuted">{p.time}</span>
                <span className="font-mono text-[12px] font-bold text-textPrimary">{p.contract}</span>
                <span className="font-mono text-[12px] tnum text-textPrimary">{p.price.toFixed(2)}</span>
                <span className="text-right font-mono text-[11px] tnum text-textSecondary">{p.size}</span>
                <span className={`text-right font-mono text-[10px] uppercase tracking-widest ${p.side === 'buy' ? 'text-bull' : 'text-bear'}`}>{p.side}</span>
              </div>
            ))}
          </div>
        </div>
      </TraceBox>
      <section className="border border-borderSubtle rounded-xs bg-panel" data-rates>
        <div className="px-5 pt-4 pb-3">
          <div className="h-6 flex items-center gap-2">
            <h3 className="text-[15px] font-semibold leading-tight text-textPrimary">Rates</h3>
            <span className="font-mono text-[9px] uppercase tracking-widest text-warn">sample</span>
          </div>
          <p className="mt-0.5 text-[11px] text-textMuted">SOFR and the Treasury curve the options are discounted against</p>
        </div>
        {rates.map(r => (
          <div key={`${r.name}-${r.tenor}`} className="px-5 h-[32px] grid items-center gap-x-3 border-t border-borderSubtle/40" style={{ gridTemplateColumns: 'minmax(80px,120px) 1fr 80px 72px' }}>
            <span className="text-[12px] text-textPrimary">{r.name}</span>
            <span className="text-[12px] text-textSecondary">{r.tenor}</span>
            <span className="text-right font-mono text-[12px] tnum text-textPrimary">{r.rate.toFixed(3)}%</span>
            <span className={`text-right font-mono text-[11px] tnum ${r.changeBp > 0 ? 'text-bear' : r.changeBp < 0 ? 'text-bull' : 'text-textMuted'}`}>
              {r.changeBp > 0 ? '+' : ''}
              {r.changeBp.toFixed(1)} bp
            </span>
          </div>
        ))}
        <div className="h-3" />
      </section>
    </div>
  );
};

export default FuturesTape;
