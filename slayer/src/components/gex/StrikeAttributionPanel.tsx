import { useMemo, useState } from 'react';
import { attributionWords, buildStrikeAttribution } from '../../data/attribution';
import { fmtGexUsd as fmtUsd } from '../../data/gex';
import { CALL_SIDE, PUT_SIDE } from './paletteInk';
import Term from '../ui/Term';
import type { FlowPrint } from '../../types/trace';

/*
==================================================
  SLAYER TERMINAL - STRIKE ATTRIBUTION — P-19
  (components/gex/StrikeAttributionPanel.tsx)
==================================================

  THE WALL STOPS BEING A NUMBER AND BECOMES A LIST OF TRADES. Trace shows
  prints with no structural context; the map shows structure with no prints.
  This is the join, and it reads off the SAME flowTape the tape desk does —
  a second source would let the two desks disagree about what traded.

  THE SENTENCE COMES FIRST, the rows second. "3 prints, but 98% of the
  premium is ONE call order" is the read; the table is the evidence for it.
  A reader who only takes the first line has still learned the thing that
  changes the trade.

  ROWS CARRY WHAT A PRINT MEANT, not everything a print has. Time, right,
  size, premium, and how it filled — a sweep that paid the offer is a
  different event from a mid-print of the same size, and that is the column
  a reader is actually scanning for. The full drilldown lives on Trace; this
  is the join, not a second tape.
*/

const MAX_ROWS = 8;

const StrikeAttributionPanel = ({
  prints,
  strike,
  step,
}: {
  prints: FlowPrint[];
  strike: number;
  step: number;
}) => {
  const attr = useMemo(() => buildStrikeAttribution(prints, strike, step), [prints, strike, step]);
  const [open, setOpen] = useState(false);
  const rows = open ? attr.prints : attr.prints.slice(0, MAX_ROWS);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="font-mono text-t10 uppercase tracking-widest text-textMuted">
          <Term k="Attribution">Built by</Term>
        </span>
        <span className="font-mono text-t11 text-textPrimary">{attributionWords(attr)}</span>
      </div>

      {attr.prints.length > 0 && (
        <>
          <div className="flex items-baseline gap-3 flex-wrap font-mono text-t10 tnum">
            <span className="text-textMuted">
              calls <span style={{ color: CALL_SIDE }}>{fmtUsd(attr.callPremium)}</span>
            </span>
            <span className="text-textMuted">
              puts <span style={{ color: PUT_SIDE }}>{fmtUsd(attr.putPremium)}</span>
            </span>
            <span className="text-textMuted">
              {attr.contracts.toLocaleString()} contracts
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Time', 'R', 'Size', 'Premium', 'Fill'].map(h => (
                    <th
                      key={h}
                      className="px-1.5 py-0.5 text-left font-mono text-t9 uppercase tracking-wider text-textMuted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(p => (
                  <tr key={p.id}>
                    <td className="px-1.5 py-0.5 font-mono text-t10 tnum text-textSecondary">{p.time}</td>
                    <td
                      className="px-1.5 py-0.5 font-mono text-t10 font-bold"
                      style={{ color: p.right === 'C' ? CALL_SIDE : PUT_SIDE }}
                    >
                      {p.right}
                    </td>
                    <td className="px-1.5 py-0.5 font-mono text-t10 tnum text-textSecondary">
                      {p.size.toLocaleString()}
                    </td>
                    <td className="px-1.5 py-0.5 font-mono text-t10 tnum text-textPrimary">{fmtUsd(p.premium)}</td>
                    <td className="px-1.5 py-0.5 font-mono text-t10 text-textMuted">{p.side}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {attr.prints.length > MAX_ROWS && (
            <button type="button" onClick={() => setOpen(v => !v)} className="self-start font-mono text-t9 text-textMuted hover:text-textPrimary" data-attr-more={open ? 'open' : 'shut'}>
              {open ? 'Hide' : `+${attr.prints.length - MAX_ROWS} more on the tape`}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default StrikeAttributionPanel;
