/*
  THE FUTURES TAPE — honest about its feed.

  Futures lived only inside Paper and Backtest. This page was to be the tape: the contract, the print, the side, and
  under it the rate strip (SOFR and the Treasury curve) the equity book is priced against.

  NOT ON THE FEED (the ship pass, 2026-10-22): the Unusual Whales plan carries no CME futures (docs/DATA_SOURCES.md),
  and the Treasury curve is the ThetaData terminal's, which Trace does not read. The page had drawn a generated tape —
  ESZ6 at 5814 beside an S&P at 7,700 — under "the CME contracts that are actually trading". A made-up print is never
  shown as a market: the page now says what it would show and why it is empty, and keeps the session card.
*/

import { sessionMeta, useDeskSession } from '../../data/deskSession';
import { Fact, TraceBox } from '../../components/trace/TraceBox';

const WOULD_SHOW: { what: string; why: string }[] = [
  { what: 'The CME tape', why: 'ES, NQ, RTY, CL and GC prints — the contract, the price, the size and the side' },
  { what: 'The rate strip', why: 'SOFR and the Treasury curve the options are discounted against' },
];

const FuturesTape = () => {
  const session = useDeskSession();
  const meta = sessionMeta(session);
  return (
    <div className="flex flex-col gap-3" data-futures-tape>
      <TraceBox
        title="The futures tape"
        sub="CME futures and the rate curve beside the equity book"
        testId="futures"
        facts={
          <>
            <Fact label="Session" testId="session">
              {meta.label} <span className="text-textSecondary">· {meta.window}</span>
            </Fact>
            <Fact label="Status" testId="status">
              <span className="text-textMuted">not on this feed</span>
            </Fact>
          </>
        }
        controls={null}
        sentence="The market-data plan behind Trace carries options, stocks, dark pool and flow — not CME futures or the Treasury curve. Nothing is drawn here until a feed that carries them is connected; no sample prints stand in for a market."
      >
        <div className="border-t border-borderSubtle" data-futures-unavailable>
          {WOULD_SHOW.map(w => (
            <div key={w.what} className="px-5 py-3 border-t border-borderSubtle/40 first:border-t-0 flex flex-col sm:flex-row sm:items-baseline gap-x-4 gap-y-0.5">
              <span className="text-t12 font-semibold text-textPrimary sm:w-40 shrink-0">{w.what}</span>
              <span className="text-t12 text-textSecondary">{w.why}</span>
              <span className="sm:ml-auto font-mono text-t10 uppercase tracking-widest text-textMuted shrink-0">not connected</span>
            </div>
          ))}
        </div>
      </TraceBox>
    </div>
  );
};

export default FuturesTape;
