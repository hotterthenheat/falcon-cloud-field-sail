/* The forward test at the head of the record: every closed Model 1 and Model 3 call against its random-side twin and a
   coin flip between the two, from the same recorded fills (data/compassForward.ts over data/compassTwins.ts). Counts
   where the sample is small, day-clustered 95% intervals, no score, no fee. The export is the same rows as a CSV. */

import { useMemo } from 'react';
import { Download } from 'lucide-react';
import type { Signal } from '../../data/compassLedger';
import { useTwins } from '../../data/compassTwins';
import { forwardCsv, forwardTest, rateWords, MIN_SESSIONS, RESAMPLES, SMALL_N, type ForwardLine, type SideStat } from '../../data/compassForward';
import { downloadText } from '../../data/exportBook';
import { Tip } from '../ui/Tooltip';

const dollars = (v: number | null) => (v == null ? '—' : `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(v).toFixed(0)}`);
const plain = (v: number) => `$${Math.abs(v).toFixed(0)}`;
const band = (m: { mean: number | null; lo: number | null; hi: number | null }) =>
  m.mean == null ? '—' : `${dollars(m.mean)}${m.lo != null && m.hi != null ? ` [${dollars(m.lo)}, ${dollars(m.hi)}]` : ''}`;
const ink = (v: number | null) => (v == null || v === 0 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

/** One plain sentence: what the pairs say about the side the model chose. */
export function edgeWords(l: ForwardLine): string {
  const n = l.paired.n;
  if (!n) return `${l.label}: no call and twin have both closed yet.`;
  const { mean, lo, hi } = l.edge;
  const days = `${n} pair${n === 1 ? '' : 's'} over ${l.paired.days} session${l.paired.days === 1 ? '' : 's'}`;
  if (lo == null || hi == null || mean == null) return `${l.label}: ${mean == null ? '' : `the side it chose ${mean >= 0 ? 'beat' : 'trailed'} the other side by ${plain(mean)} a pair, `}${days}. Too few sessions to tell that from chance.`;
  if (lo > 0) return `${l.label}: the side it chose beat the other side by ${plain(mean)} a pair [${dollars(lo)}, ${dollars(hi)}], ${days}.`;
  if (hi < 0) return `${l.label}: the other side did better, by ${plain(mean)} a pair [${plain(hi)}, ${plain(lo)}], ${days}.`;
  return `${l.label}: the side it chose cannot be told from the other side yet (${dollars(mean)} a pair [${dollars(lo)}, ${dollars(hi)}], ${days}).`;
}

const Side = ({ s, testId }: { s: SideStat; testId: string }) => (
  <td className="py-1 pr-3 text-right align-top" data-forward={testId}>
    <span className="block text-textPrimary whitespace-nowrap">{rateWords(s)}</span>
    <span className={`block whitespace-nowrap ${ink(s.perCall.mean)}`}>{band(s.perCall)}</span>
  </td>
);

const ForwardRecord = ({ calls }: { calls: readonly Signal[] }) => {
  const twins = useTwins();
  const test = useMemo(() => forwardTest(calls, twins), [calls, twins]);
  const save = () => downloadText(`compass-forward-test-${new Date().toISOString().slice(0, 10)}.csv`, forwardCsv(calls, twins), 'text/csv;charset=utf-8');
  const shown = test.lines.filter(l => l.calls.n > 0);
  return (
    <section className="border-t border-borderSubtle px-4 sm:px-5 py-4" data-forward-test>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <h3 className="font-mono text-t10 uppercase tracking-widest text-textMuted">
            The forward test · {test.sessions} of {test.target} sessions
          </h3>
          <p className="mt-1 text-t12 leading-relaxed text-textSecondary max-w-3xl">
            Each call against its twin: the same instant, the same rule, the other side (a put for a call, at the mirrored strike), filled and closed by the call's own rules on its own recorded quotes. The coin flip takes one of the two at random. Ask in a minute later, bid out, no fees.
          </p>
        </div>
        <button type="button" onClick={save} className="slayer-chip uppercase tracking-wider shrink-0" data-forward-csv>
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 font-mono text-t11 text-textSecondary" data-forward-empty>No call has closed yet.</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1 text-t12 text-textPrimary" data-forward-read>
            {shown.filter(l => l.label !== 'Model 1 and 3' || shown.length > 2).map(l => (
              <li key={l.label}>{edgeWords(l)}</li>
            ))}
          </ul>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] font-mono text-t11 tnum" data-forward-table>
              <thead>
                <tr className="text-textMuted text-t9 uppercase tracking-widest">
                  <th className="text-left font-normal pb-1 pr-3">Model</th>
                  <th className="text-right font-normal pb-1 pr-3">Calls closed</th>
                  <th className="text-right font-normal pb-1 pr-3" title="Every closed call. Won, then net a contract a call, day-clustered 95% interval.">The calls</th>
                  <th className="text-right font-normal pb-1 pr-3" title="The calls whose twin also closed.">Paired calls</th>
                  <th className="text-right font-normal pb-1 pr-3" title="The same instants, the other side.">Their twins</th>
                  <th className="text-right font-normal pb-1 pr-3" title="A coin picks the call or its twin: the average of the two (its wins are the expected count).">Coin flip</th>
                  <th className="text-right font-normal pb-1 pr-3" title="Call minus twin, a contract a pair: what the side choice was worth.">Call − twin</th>
                  <th className="text-right font-normal pb-1" title={`Of ${RESAMPLES.toLocaleString('en-US')} coin-flip records over the same pairs (one flip a session), how many the calls' total beat.`}>Beat coin flips</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(l => (
                  <tr key={l.label} className="border-b border-borderSubtle/40 align-top" data-forward-row={l.label}>
                    <td className="py-1 pr-3 text-textPrimary whitespace-nowrap">{l.label}</td>
                    <td className="py-1 pr-3 text-right text-textPrimary">
                      {l.calls.n}
                      <span className="block text-textMuted">{l.calls.days} session{l.calls.days === 1 ? '' : 's'}</span>
                    </td>
                    <Side s={l.calls} testId="calls" />
                    <Side s={l.paired} testId="paired" />
                    <Side s={l.twins} testId="twins" />
                    <Side s={l.coin} testId="coin" />
                    <td className={`py-1 pr-3 text-right whitespace-nowrap ${ink(l.edge.mean)}`} data-forward="edge">{band(l.edge)}</td>
                    <td className="py-1 text-right whitespace-nowrap text-textPrimary" data-forward="beats">
                      {l.beatsCoin != null ? `${l.beatsCoin.toLocaleString('en-US')} of ${RESAMPLES.toLocaleString('en-US')}` : l.paired.n ? `Under ${MIN_SESSIONS} sessions` : '—'}
                      {l.unpaired ? (
                        <Tip label="Closed calls whose twin has not closed yet, or has no contract or no quote on the other side.">
                          <span className="block text-textMuted">{l.unpaired} unpaired</span>
                        </Tip>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 font-mono text-t10 text-textMuted">
            Won is a count below {SMALL_N} closed calls or {MIN_SESSIONS} sessions. Dollars are a contract, (exit − fill) × 100. Brackets are 95% intervals from {RESAMPLES.toLocaleString('en-US')} resamples of whole sessions, drawn from {MIN_SESSIONS} sessions on. The research protocol's live shadow runs {test.target} sessions.
          </p>
        </>
      )}
    </section>
  );
};

export default ForwardRecord;
