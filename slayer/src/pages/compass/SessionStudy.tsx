/* The session study: every contract in the scan's strike band that made a 50%+ move by the books' own definitions,
   what the model read at that mark and the gate that stopped it; the miss reasons; Model 1's calibration on the
   day's labelled rows; and suggested changes with their evidence. Nothing here is applied.
   "All sessions" pools every labelled day (data/compassStudy.ts poolStudies): the calibration with 95% intervals, the
   threshold sweep, the miss reasons, the inputs over time, and a plain verdict on reading Model 1 as a probability,
   which never lifts the "Unvalidated" label by itself. */

import { useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import TraceBox, { Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import type { Column } from '../../components/ui/DataTable';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ContractLabel from '../../components/ui/ContractLabel';
import { EmptyBox, ErrorBox, LoadingBox } from '../../components/ui/states';
import { useCompassDoc, useAllCalls } from '../../data/compassReviewFeed';
import { useCompassFeed } from '../../data/compassFeed';
import type { Signal } from '../../data/compassLedger';
import { P1_MIN, modelWordOf } from '../../data/compassParams';
import { POOL_BAR, type Mover, type PooledStudy, type Rate } from '../../data/compassStudy';
import { isoDate } from '../../core/calendar';
import { expiryOfDay, useReviewDay } from './SessionReview';
import { fillableBoard, type FillableRow } from '../../data/fillableBoard';

const blank = <span className="text-textMuted">—</span>;
const COLUMNS: Column<Mover>[] = [
  { key: 'contract', header: 'Contract', sortValue: r => r.contract, render: r => <ContractLabel contract={r.contract} right={r.contract.endsWith('C') ? 'C' : 'P'} logo={r.contract.split(' ')[0]} size="sm" /> },
  { key: 'sleeve', header: 'Sleeve', sortValue: r => r.sleeve, render: r => <span className="text-textSecondary">{r.sleeve === 'odte' ? '0DTE' : '1–7 DTE'}</span> },
  { key: 'mark', header: 'Mark ET', sortValue: r => r.mark, render: r => <span className="tnum text-textPrimary">{r.mark}</span> },
  { key: 'ask', header: 'Ask', align: 'right', sortValue: r => r.ask, render: r => <span className="tnum">{r.ask.toFixed(2)}</span> },
  { key: 'best', header: 'Best bid', align: 'right', sortValue: r => r.bestBid, render: r => <span className="tnum text-bull">{r.bestBid.toFixed(2)} <span className="text-textMuted">{r.bestAt}</span></span> },
  { key: 'ratio', header: 'Move', align: 'right', sortValue: r => r.ratio, render: r => <span className="tnum text-bull">{r.ratio.toFixed(2)}×</span> },
  { key: 'stop', header: 'Stop first', align: 'right', sortValue: r => (r.stopFirst ? 1 : 0), render: r => (r.stopFirst ? <span className="text-warn">Yes</span> : <span className="text-textMuted">No</span>) },
  { key: 'p1', header: 'Model 1', sortValue: r => (r.p1 == null ? -1 : r.p1 + 1e-12 >= P1_MIN ? 1 : 0), render: r => (r.p1 == null ? blank : <span className={r.p1 + 1e-12 >= P1_MIN ? 'text-textPrimary' : 'text-textSecondary'}>{r.p1 + 1e-12 >= P1_MIN ? 'Cleared' : 'Under the line'}</span>) },
  { key: 'gate', header: 'What stopped it', sortValue: r => r.gate, render: r => <span className="text-textSecondary">{r.gate}</span> },
  { key: 'held', header: 'Held down by', sortValue: r => r.heldDown[0]?.name ?? '', render: r => (r.heldDown.length ? <span className="text-textMuted">{r.heldDown.map(d => d.name).join(', ')}</span> : blank) },
];
const WIDTHS: Record<string, number> = { contract: 150, sleeve: 74, mark: 70, ask: 64, best: 116, ratio: 70, stop: 76, p1: 80, gate: 230, held: 300 };

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="border-t border-borderSubtle px-4 sm:px-5 py-4">
    <h3 className="font-mono text-t10 uppercase tracking-widest text-textMuted">{title}</h3>
    <div className="mt-2">{children}</div>
  </section>
);

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const band = (r: Rate) => (r.n ? `${(r.lo95 * 100).toFixed(1)}–${(r.hi95 * 100).toFixed(1)}%` : '—');
const signed = (v: number, d = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}`;
const BOOK: Record<string, string> = { A: modelWordOf({ book: 'A' }), B: modelWordOf({ book: 'B' }), C: modelWordOf({ book: 'C' }), R: modelWordOf({ book: 'R' }) };
const money = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`);
const takenLine = (s: Signal) => {
  const o = s.outcome;
  if (!o?.fill) return o?.status === 'unavailable' ? 'No quote a minute later. Never filled.' : 'Not filled yet.';
  if (o.status !== 'closed' || !o.exit) return 'Still open.';
  const measured = (s.book === 'A' || s.book === 'B') && o.peak > 0;
  return measured ? `Left on ${o.exit.why}. While it was open the bid reached ${o.peak.toFixed(2)}.` : `Left on ${o.exit.why}.`;
};

const whyTaken = (s: Signal): string => {
  if (s.book === 'R') {
    return s.right === 'C'
      ? 'The close broke under the last 30 closes. Tail risk bought the call. Sell the bid when the close comes back through that low, or after 30 minutes if it does not.'
      : 'The close broke above the last 30 closes. Tail risk bought the put. Sell the bid when the close comes back through that high, or after 30 minutes if it does not.';
  }
  if (s.book === 'C') return 'Model 3, the late sweep. No model score. 3× inside 120 seconds, or 2× inside 30 seconds. Flat at 15:50.';
  if (s.book === 'B' || s.runner) return `${modelWordOf(s)}. The stop ratchets. Flat at 15:55.`;
  return 'Model 1. Out at 1.50× the ask, or the stop at 0.4678× the fill.';
};

const leftOnTable = (s: Signal): string => {
  const o = s.outcome;
  if (!o?.fill || o.status !== 'closed' || !o.exit) return o?.status === 'unavailable' ? 'No quote a minute later. Never filled.' : 'Still open. No hindsight until it closes.';
  const fill = o.fill.ask;
  const peak = o.peak;
  const measured = (s.book === 'A' || s.book === 'B') && peak > 0;
  if (!measured) return `Left on ${o.exit.why}.`;
  if (!(fill > 0) || !(peak > fill)) return `Left on ${o.exit.why}. While it was open the bid reached ${peak.toFixed(2)}.`;
  const held = ((peak - fill) / fill) * 100;
  const got = ((o.exit.px - fill) / fill) * 100;
  return `Left on ${o.exit.why}. While it was open the bid reached ${peak.toFixed(2)}, ${held >= 0 ? '+' : '−'}${Math.abs(held).toFixed(1)}% instead of ${got >= 0 ? '+' : '−'}${Math.abs(got).toFixed(1)}%. The live rule is not changed.`;
};

const catchLine = (gate: string): string => {
  if (gate === 'Model 1 under the threshold') return 'Model 1 was under the bar. Catching it means lowering that bar. Not applied.';
  if (gate === 'outside the books’ strike band') return 'The strike sat outside the book. Catching it means a wider band. Not applied.';
  if (gate === 'seats full') return 'The book already held its seats. Catching it means another open ticket. Not applied.';
  if (gate === 'theta burns the stop before the flat') return 'Decay would have eaten the stop before the flat. The rule stood aside. Not applied.';
  if (gate === 'side or drive rule') return 'The side or the drive rule said no. Catching it means dropping that rule. Not applied.';
  if (gate === 'bid at or under $0.15') return 'The bid was at or under $0.15. The book does not buy that. Not applied.';
  if (gate === 'spread over 8%') return 'The spread was over 8% of the mid. Catching it means paying a wider market. Not applied.';
  if (gate.startsWith('not scored')) return `${gate}. The scan never had a row to fire from. Not applied.`;
  if (gate === 'called' || gate === 'would have called (late mark)') return 'This one was a call.';
  return `The first gate was “${gate}”. That is the rule that said no. Not applied.`;
};

const TH = 'font-normal pb-1';

const Note = ({ title, line }: { title: string; line: string }) => (
  <li className="border-b border-borderSubtle/40 py-2">
    <p className="font-mono text-t12 text-textPrimary">{title}</p>
    <p className="font-mono text-t11 text-textSecondary whitespace-normal">{line}</p>
  </li>
);

const TakenNotes = ({ rows }: { rows: Signal[] }) => (
  <Section title="Taken · the trades the models fired">
    <p className="mb-2 font-mono text-t10 text-textMuted">Why the rule fired, the fill, the exit, and whether the peak bid would have paid more. Hindsight is not a new rule.</p>
    {rows.length === 0 ? <p className="font-mono text-t11 text-textMuted">No call on this cut.</p> : (
      <ul data-study-taken>
        {rows.map(s => (
          <Note
            key={s.key}
            title={`${s.contract} · ${BOOK[s.book] ?? s.book}${s.outcome?.pnl != null ? ` · ${money(s.outcome.pnl)}` : ''}`}
            line={`${whyTaken(s)} ${leftOnTable(s)}`}
          />
        ))}
      </ul>
    )}
  </Section>
);

const fillLine = (r: FillableRow): string =>
  `Fillable. Ask ${r.ask.toFixed(2)}, size ${r.size.toLocaleString('en-US')}, spread ${r.spread}%. The best sized bid in the next 20 minutes was ${r.later.toFixed(2)}, ${r.move}%. No model called it. Catching it means a rule that buys this ask. Not applied. Paper only.`;

const FillMissed = ({ rows }: { rows: FillableRow[] }) => (
  <Section title="Missed · fillable moves the models did not call">
    <p className="mb-2 font-mono text-t10 text-textMuted">The ask could have been bought. The bid in the next 20 minutes is the move. Nothing here is an order.</p>
    {rows.length === 0 ? <p className="font-mono text-t11 text-textMuted">Every fillable row on this cut was a call, or this book has none.</p> : (
      <ul data-study-missed>
        {rows.slice(0, 12).map(r => (
          <Note key={`${r.sleeve}|${r.contract}|${r.when}|${r.ask}`} title={`${r.contract} · ${r.move}% · ${r.when}`} line={fillLine(r)} />
        ))}
      </ul>
    )}
  </Section>
);

const MissedNotes = ({ rows }: { rows: Mover[] }) => (
  <Section title="Missed · how the scan could have caught them">
    <p className="mb-2 font-mono text-t10 text-textMuted">The first gate that said no, on the movers already in this study. Nothing here is turned on.</p>
    {rows.length === 0 ? <p className="font-mono text-t11 text-textMuted">No mover sat close on this cut.</p> : (
      <ul data-study-missed>
        {rows.slice(0, 12).map(m => (
          <Note
            key={`${m.sleeve}|${m.contract}|${m.mark}`}
            title={`${m.contract} · ${m.ratio.toFixed(2)}× · ask ${m.ask.toFixed(2)} → ${m.bestBid.toFixed(2)}`}
            line={catchLine(m.gate)}
          />
        ))}
      </ul>
    )}
  </Section>
);

const Calls = ({ rows }: { rows: Signal[] }) => (
  <Section title="Calls we took · every model">
    {rows.length === 0 ? (
      <p className="font-mono text-t11 text-textMuted">No call on this cut.</p>
    ) : (
      <table className="w-full font-mono text-t11 tnum" data-study-calls>
        <tbody>
          {rows.map(s => (
            <tr key={s.key} id={s.key} className="border-b border-borderSubtle/40 align-top">
              <td className="py-1 pr-3 text-textPrimary whitespace-nowrap">{s.contract}</td>
              <td className="py-1 pr-3 text-textMuted whitespace-nowrap">{BOOK[s.book] ?? s.book}{s.would ? ' · closest, not taken' : ''}</td>
              <td className={`py-1 pr-3 text-right ${ (s.outcome?.pnl ?? 0) > 0 ? 'text-bull' : s.outcome?.pnl != null ? 'text-bear' : 'text-textMuted'}`}>{money(s.outcome?.pnl)}</td>
              <td className="py-1 text-textSecondary">{takenLine(s)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </Section>
);

/** One bucket on a 0–100% track: the realised rate's 95% interval (the band), its rate (the bar) and the mean
    score (the tick). A calibrated bucket has the tick inside the band. */
const Strip = ({ r }: { r: Rate }) => (
  <div className="relative h-3 w-full min-w-[96px] rounded-sm bg-chip" aria-hidden="true">
    {r.n > 0 && <div className="absolute inset-y-0 rounded-sm bg-silver/25" style={{ left: `${r.lo95 * 100}%`, width: `${Math.max(0.5, (r.hi95 - r.lo95) * 100)}%` }} />}
    {r.n > 0 && <div className="absolute inset-y-[3px] w-[2px] bg-textPrimary" style={{ left: `calc(${r.rate * 100}% - 1px)` }} />}
  </div>
);

/** Every labelled session together */
const PooledView = ({ doc }: { doc: PooledStudy }) => {
  const io = doc.inputsOverTime;
  return (
    <>
      <Section title="Can Model 1 be read as a probability?">
        <p className={`text-t12 leading-relaxed ${doc.verdict.ready ? 'text-textPrimary' : 'text-textSecondary'}`} data-pool-verdict={doc.verdict.ready ? 'ready' : 'not-yet'}>
          <span className="font-semibold text-textPrimary">{doc.verdict.ready ? 'The bars are met. ' : 'Not yet. '}</span>
          {(() => {
            const rest = doc.verdict.line.replace(/^No: /, '');
            return rest.charAt(0).toUpperCase() + rest.slice(1);
          })()}
        </p>
        <table className="mt-3 w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-needs>
          <thead>
            <tr className="text-textMuted text-t9 uppercase tracking-widest">
              <th className={`text-left ${TH}`}>What it needs</th>
              <th className={`text-left ${TH} max-sm:hidden`}>Needs</th>
              <th className={`text-left ${TH}`}>Has</th>
              <th className={`text-right ${TH}`}>Met</th>
            </tr>
          </thead>
          <tbody>
            {doc.verdict.needs.map(n => (
              <tr key={n.what} className="border-b border-borderSubtle/40 align-top">
                <td className="py-1 pr-3 text-textSecondary">
                  {n.what}
                  <span className="sm:hidden block text-textMuted">{n.need}</span>
                </td>
                <td className="py-1 pr-3 text-textMuted max-sm:hidden whitespace-nowrap">{n.need}</td>
                <td className="py-1 pr-3 text-textPrimary">{n.have}</td>
                <td className={`py-1 text-right whitespace-nowrap ${n.met ? 'text-bull' : 'text-warn'}`}>{n.met ? 'Yes' : 'Not yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 font-mono text-t10 text-textMuted">
          The bars are fixed: {POOL_BAR.sessions}+ sessions, {POOL_BAR.rowsPerBucket}+ settled rows in every bucket inside the trained minutes, each bucket within ±{POOL_BAR.gapPoints} points of its mean score. Meeting them is evidence for the owner, not a switch: the “Unvalidated” label stays until the owner lifts it after the input check.
        </p>
      </Section>
      <Section title={`Model 1 against what happened · ${doc.days.length} session${doc.days.length === 1 ? '' : 's'} pooled`}>
        <table className="w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-calibration>
          <thead>
            <tr className="text-textMuted text-t9 uppercase tracking-widest">
              <th className={`text-left ${TH}`}>Model 1</th>
              <th className={`text-right ${TH}`} title="Settled rows inside the trained minutes, 09:45–15:00 ET">Rows</th>
              <th className={`text-right ${TH}`} title="Took the 1.50× profit by Model 1's near-the-money rules from the mark">Took</th>
              <th className={`text-right ${TH} max-sm:hidden`}>95% interval</th>
              <th className={`text-right ${TH}`} title="Inside the bar (the band's outcomes sit near the band's own reading), or not. No score is shown.">Calibrated</th>
              <th className={`text-left ${TH} pl-4 max-md:hidden w-[28%]`}>
                <span className="text-textMuted">Took, 95% band</span>
              </th>
              <th className={`text-right ${TH} max-lg:hidden`} title="All settled rows, every minute">All rows · took</th>
              <th className={`text-right ${TH} max-lg:hidden`}>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {doc.calibration.map(c => (
              <tr key={c.bucket} className={`border-b border-borderSubtle/40 ${c.lo >= P1_MIN ? 'text-textPrimary' : 'text-textSecondary'}`}>
                <td className="py-1 whitespace-nowrap">{c.bucket}</td>
                <td className={`py-1 text-right ${c.win.n < POOL_BAR.rowsPerBucket ? 'text-warn' : ''}`}>{c.win.n.toLocaleString('en-US')}</td>
                <td className="py-1 text-right">{c.win.n ? pct(c.win.rate) : blank}</td>
                <td className="py-1 text-right text-textMuted max-sm:hidden">{band(c.win)}</td>
                <td className={`py-1 text-right ${c.gapPoints == null ? '' : Math.abs(c.gapPoints) <= POOL_BAR.gapPoints ? 'text-bull' : 'text-bear'}`}>{c.gapPoints == null ? blank : Math.abs(c.gapPoints) <= POOL_BAR.gapPoints ? 'Yes' : 'No'}</td>
                <td className="py-1 pl-4 max-md:hidden"><Strip r={c.win} /></td>
                <td className="py-1 text-right max-lg:hidden">{c.all.n.toLocaleString('en-US')} · {c.all.n ? pct(c.all.rate) : '—'}</td>
                <td className="py-1 text-right max-lg:hidden">{c.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="The threshold, cut other ways · 09:45–15:00 ET">
        <table className="w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-thresholds>
          <thead>
            <tr className="text-textMuted text-t9 uppercase tracking-widest">
              <th className={`text-left ${TH}`}>At or over</th>
              <th className={`text-right ${TH}`}>Rows</th>
              <th className={`text-right ${TH}`}>Took</th>
              <th className={`text-right ${TH} max-sm:hidden`}>95% interval</th>
              <th className={`text-right ${TH}`} title="Mean Model 1 return per row (near-the-money rules), percent">Mean return</th>
              <th className={`text-right ${TH}`} title="Sessions whose mean return at this cut was positive, of those with a row">Sessions up</th>
            </tr>
          </thead>
          <tbody>
            {doc.thresholds.map(t => (
              <tr key={t.p1} className={`border-b border-borderSubtle/40 ${Math.abs(t.p1 - P1_MIN) < 1e-9 ? 'text-textPrimary' : 'text-textSecondary'}`}>
                <td className="py-1 whitespace-nowrap">{Math.abs(t.p1 - P1_MIN) < 1e-9 ? <>The line <span className="text-textMuted"> · now</span></> : `Cut ${doc.thresholds.indexOf(t) + 1}${t.p1 < P1_MIN ? ', under the line' : ', over the line'}`}</td>
                <td className="py-1 text-right">{t.win.n.toLocaleString('en-US')}</td>
                <td className="py-1 text-right">{t.win.n ? pct(t.win.rate) : blank}</td>
                <td className="py-1 text-right text-textMuted max-sm:hidden">{band(t.win)}</td>
                <td className={`py-1 text-right ${t.meanRet == null ? '' : t.meanRet > 0 ? 'text-bull' : 'text-bear'}`}>{t.meanRet == null ? blank : `${signed(t.meanRet, 2)}%`}</td>
                <td className="py-1 text-right">{t.upSessions} of {t.sessions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="Why the movers were missed · every session">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          <table className="w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-reasons>
            <thead><tr className="text-textMuted text-t9 uppercase tracking-widest"><th className={`text-left ${TH}`}>What stopped it</th><th className={`text-right ${TH}`}>Movers</th><th className={`text-right ${TH}`}>Sessions</th></tr></thead>
            <tbody>
              {doc.missReasons.map(r => (
                <tr key={r.gate} className="border-b border-borderSubtle/40">
                  <td className="py-1 pr-3 text-textSecondary">{r.gate}</td>
                  <td className="py-1 text-right text-textPrimary">{r.n.toLocaleString('en-US')}</td>
                  <td className="py-1 text-right text-textMuted">{r.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-held>
            <thead><tr className="text-textMuted text-t9 uppercase tracking-widest"><th className={`text-left ${TH}`}>Input holding Model 1 down</th><th className={`text-right ${TH}`}>Movers</th><th className={`text-right ${TH}`}>Sessions</th></tr></thead>
            <tbody>
              {doc.heldDownMost.map(r => (
                <tr key={r.col} className="border-b border-borderSubtle/40">
                  <td className="py-1 pr-3 text-textSecondary">{r.name}</td>
                  <td className="py-1 text-right text-textPrimary">{r.n}</td>
                  <td className="py-1 text-right text-textMuted">{r.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title="Session by session">
        <table className="w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-sessions>
          <thead>
            <tr className="text-textMuted text-t9 uppercase tracking-widest">
              <th className={`text-left ${TH}`}>Session</th>
              <th className={`text-right ${TH} max-sm:hidden`}>Rows</th>
              <th className={`text-right ${TH}`} title="Settled rows that cleared Model 1's line, 09:45–15:00 ET">Over the bar</th>
              <th className={`text-right ${TH}`}>Took</th>
              <th className={`text-right ${TH}`}>Mean return</th>
              <th className={`text-right ${TH} max-sm:hidden`}>Movers</th>
            </tr>
          </thead>
          <tbody>
            {doc.sessions.slice().reverse().map(d => (
              <tr key={d.day} className="border-b border-borderSubtle/40 text-textSecondary">
                <td className="py-1 text-textPrimary whitespace-nowrap">{d.day}</td>
                <td className="py-1 text-right max-sm:hidden">{d.settled.toLocaleString('en-US')}</td>
                <td className="py-1 text-right">{d.over.n.toLocaleString('en-US')}</td>
                <td className="py-1 text-right text-textPrimary">{d.over.n ? pct(d.over.rate) : blank}</td>
                <td className={`py-1 text-right ${d.overMeanRet == null ? '' : d.overMeanRet > 0 ? 'text-bull' : 'text-bear'}`}>{d.overMeanRet == null ? blank : `${signed(d.overMeanRet, 2)}%`}</td>
                <td className="py-1 text-right max-sm:hidden">{d.movers ?? blank}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {io.cols.length > 0 && (
          <div className="mt-5">
            <h4 className="font-mono text-t9 uppercase tracking-widest text-textMuted">Inputs holding the missed movers down, over time</h4>
            {/* a phone reads each session as a short list, never a table that scrolls sideways */}
            <div className="sm:hidden mt-2 space-y-3" data-pool-inputs-phone>
              {io.rows.slice().reverse().map(r => (
                <div key={r.day} className="font-mono text-t11 tnum">
                  <div className="flex justify-between text-textPrimary"><span>{r.day}</span><span className="text-textMuted">{r.under} under the bar</span></div>
                  {r.n.map((n, i) => (
                    <div key={io.cols[i].col} className="flex justify-between gap-3 border-b border-borderSubtle/40 py-1 text-textSecondary">
                      <span className="min-w-0">{io.cols[i].name}</span>
                      <span className="shrink-0">{n}{r.under ? <span className="text-textMuted"> · {pct(n / r.under, 0)}</span> : null}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="max-sm:hidden mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-inputs>
                <thead>
                  <tr className="text-textMuted text-t9 tracking-wide">
                    <th className={`text-left ${TH} uppercase tracking-widest`}>Session</th>
                    <th className={`text-right ${TH} uppercase tracking-widest`} title="Movers scored under the threshold that session">Under the bar</th>
                    {io.cols.map(c => <th key={c.col} className={`text-right ${TH}`}>{c.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {io.rows.slice().reverse().map(r => (
                    <tr key={r.day} className="border-b border-borderSubtle/40 text-textSecondary">
                      <td className="py-1 text-textPrimary whitespace-nowrap">{r.day}</td>
                      <td className="py-1 text-right">{r.under}</td>
                      {r.n.map((n, i) => <td key={io.cols[i].col} className="py-1 text-right">{n}{r.under ? <span className="text-textMuted"> · {pct(n / r.under, 0)}</span> : null}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Section>
      {doc.notes.length > 0 && <p className="border-t border-borderSubtle px-5 py-3 font-mono text-t10 text-textMuted">{doc.notes.join(' ')}</p>}
    </>
  );
};

const SessionStudy = () => {
  const location = useLocation();
  const [view, setView] = useState<'one' | 'all'>(() => (new URLSearchParams(location.search).get('day') === 'all' ? 'all' : 'one'));
  const [askedDay, setDay, days] = useReviewDay();
  const day = askedDay === 'all' ? (days[0] ?? null) : askedDay;
  const [sleeve, setSleeve] = useState<'all' | '0' | '1-7' | '8-30'>('all');
  const one = useCompassDoc('study', view === 'one' ? day : null);
  const pool = useCompassDoc('pooled', view === 'all' ? 'all' : null);
  const feed = useCompassFeed();
  const every = useAllCalls(feed.day || '1970-01-01', feed.at);
  const { doc, status, error } = one;
  const taken = useMemo(() => (every ?? []).filter(s => (view === 'all' ? true : s.day === day)), [every, view, day]);
  const closest = useMemo(() => (doc?.movers ?? []).filter(m => m.gate !== 'called' && (sleeve === 'all' || (sleeve === '0' ? m.sleeve === 'odte' : sleeve === '1-7' ? m.sleeve === 'weekly' : false))), [doc, sleeve]);
  const board = fillableBoard(view === 'one' ? day : null);
  const called = useMemo(() => new Set(taken.filter(s => !s.would).map(s => s.contract.replace(/\s+/g, ' ').trim())), [taken]);
  const missedFill = useMemo(() => (board?.rows ?? []).filter(r => (sleeve === 'all' || r.sleeve === sleeve) && !called.has(r.contract)), [board, sleeve, called]);
  const won = taken.filter(s => (s.outcome?.pnl ?? 0) > 0).length;
  const lost = taken.filter(s => s.outcome?.pnl != null && s.outcome.pnl <= 0).length;
  return (
    <TraceBox
      title="Study"
      sub={view === 'all' ? 'Every call every model took, on every session, and what would have improved it' : 'The calls this session, and the closest ones the scan did not take'}
      testId="compass-study"
      facts={
        <>
          <Fact label="Calls" testId="calls">{every ? taken.length.toLocaleString('en-US') : '—'}</Fact>
          <Fact label="Won · lost" testId="won" title="A win is a gain on (exit − fill) × 100. No fees.">
            <span className="text-bull">{every ? won : '—'}</span> · <span className="text-bear">{every ? lost : '—'}</span>
          </Fact>
          <Fact label="Closest not taken" testId="closest" title="Fillable asks the models did not call, or scored movers the study already kept">{view === 'one' ? (board ? missedFill.length.toLocaleString('en-US') : doc ? closest.length.toLocaleString('en-US') : '—') : '—'}</Fact>
          <Fact label="Sessions" testId="pool-sessions">{view === 'all' ? (pool.doc ? pool.doc.days.length : '—') : (day ?? '—')}</Fact>
        </>
      }
      controls={
        <>
          <DropdownSelect
            label="Study"
            value={view}
            options={[
              { value: 'one', label: 'One session', hint: 'The calls, and the closest the scan did not take' },
              { value: 'all', label: 'All sessions', hint: 'Every call on the record, then the model check' },
            ]}
            onChange={setView}
            title="One session, or every labelled session pooled"
            testId="study-view"
          />
          {view === 'one' && (
            <>
              <ExpiryCalendar value={day ?? ''} expiries={days.map(expiryOfDay)} onChange={e => setDay(isoDate(e.date))} anyLabel="Newest" steppers={!!day} label="Session" icon={CalendarDays} title="The session to study" testId="study-day" />
              <DropdownSelect label="Sleeve" value={sleeve} options={[{ value: 'all', label: 'Every book' }, { value: '0', label: '0 DTE' }, { value: '1-7', label: '1–7 DTE' }, { value: '8-30', label: '8–30 DTE' }]} onChange={setSleeve} title="Which book's movers" testId="study-sleeve" />
            </>
          )}
        </>
      }
      sentence={
        view === 'all' ? (
          <span>Every call on the record, every model. Under it, whether Model 1 meant anything. Nothing is applied from here.</span>
        ) : (
          <span>{board ? `${missedFill.length.toLocaleString('en-US')} fillable asks the models did not call. The move is the best sized bid in the next 20 minutes. Nothing is applied. Paper only.` : 'The closest are the contracts the scan scored, or that ran 50% or more, and did not become a call. Nothing is applied.'}</span>
        )
      }
    >
      {view === 'all' ? (
        pool.status === 'loading' && !pool.doc ? (
          <div className="border-t border-borderSubtle"><LoadingBox shape="table" rows={6} label="Pooling the sessions" /></div>
        ) : pool.status === 'error' && !pool.doc ? (
          <div className="border-t border-borderSubtle"><ErrorBox what="The pooled study did not load" detail={pool.error} /></div>
        ) : !pool.doc && !taken.length ? (
          <div className="border-t border-borderSubtle"><EmptyBox title="No session labelled yet" reason="Calls show as soon as they are on the record. The closest are counted once the session has settled." /></div>
        ) : (
          <>
            <Calls rows={taken} />
            {pool.doc ? <PooledView doc={pool.doc} /> : null}
          </>
        )
      ) : status === 'loading' && !doc && !taken.length ? (
        <div className="border-t border-borderSubtle"><LoadingBox shape="table" rows={6} label="Reading the study" /></div>
      ) : status === 'error' && !doc ? (
        <div className="border-t border-borderSubtle"><ErrorBox what="The study did not load" detail={error} /></div>
      ) : !doc && !taken.length && !board ? (
        <div className="border-t border-borderSubtle"><EmptyBox title="Nothing on this session" reason="No call is on the record, and the study has not been built." /></div>
      ) : (
        <>
          <TakenNotes rows={taken} />
          {board ? <FillMissed rows={missedFill} /> : <MissedNotes rows={closest} />}
          {doc ? (
        <>
          <Section title="Suggested changes · not applied">
            <ul className="space-y-2" data-study-suggestions>
              {doc.suggestions.map(x => (
                <li key={x.change} className="text-t12 leading-relaxed">
                  <span className="font-semibold text-textPrimary">{x.change}</span>
                  <span className="font-mono text-t10 text-textMuted"> · n = {x.n.toLocaleString('en-US')}</span>
                  <p className="text-textSecondary">{x.evidence}</p>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Why the movers were missed">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <table className="w-full font-mono text-t11 tnum" data-study-reasons>
                <tbody>
                  {doc.missReasons.map(r => (
                    <tr key={r.gate} className="border-b border-borderSubtle/40">
                      <td className="py-1 text-textSecondary">{r.gate}</td>
                      <td className="py-1 text-right text-textPrimary">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table className="w-full font-mono text-t11 tnum" data-study-held>
                <thead><tr className="text-textMuted text-t9 uppercase tracking-widest"><th className="text-left font-normal pb-1">Input holding Model 1 down</th><th className="text-right font-normal pb-1">Movers</th></tr></thead>
                <tbody>
                  {doc.heldDownMost.map(r => (
                    <tr key={r.col} className="border-b border-borderSubtle/40">
                      <td className="py-1 text-textSecondary">{r.name}</td>
                      <td className="py-1 text-right text-textPrimary">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title="Model 1 against what happened (its near-the-money rules from each mark)">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] font-mono text-t11 tnum" data-study-calibration>
                <thead>
                  <tr className="text-textMuted text-t9 uppercase tracking-widest">
                    <th className="text-left font-normal pb-1">Model 1</th>
                    <th className="text-right font-normal pb-1">Rows</th>
                    <th className="text-right font-normal pb-1">Took 1.50×</th>
                    <th className="text-right font-normal pb-1">Bid hit 1.50×</th>
                    <th className="text-right font-normal pb-1">09:45–15:00 rows · took</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.calibration.map(c => (
                    <tr key={c.bucket} className={`border-b border-borderSubtle/40 ${c.lo >= P1_MIN ? 'text-textPrimary' : 'text-textSecondary'}`}>
                      <td className="py-1">{c.bucket}</td>
                      <td className="py-1 text-right">{c.n.toLocaleString('en-US')}</td>
                      <td className="py-1 text-right">{(c.tp1 * 100).toFixed(1)}%</td>
                      <td className="py-1 text-right">{(c.hit50 * 100).toFixed(1)}%</td>
                      <td className="py-1 text-right">{c.inWindowN.toLocaleString('en-US')} · {(c.inWindowTp1 * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          {doc.falsePositives.length > 0 && (
            <Section title="Calls and would-have calls that lost">
              <ul className="font-mono text-t11 space-y-1">
                {doc.falsePositives.map(f => (
                  <li key={`${f.contract}${f.would}`} className="flex gap-3">
                    <span className="text-textPrimary">{f.contract}</span>
                    <span className="text-textMuted">{modelWordOf({ book: f.book })}{f.would ? ' · would have called' : ''}</span>
                    <span className="text-bear tnum">{f.pnl == null ? '—' : `−$${Math.abs(f.pnl).toFixed(2)}`}</span>
                    <span className="text-textSecondary">{f.cause}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <div className="border-t border-borderSubtle">
            <TraceGrid
              rows={closest}
              columns={COLUMNS}
              widths={WIDTHS}
              rowKey={r => `${r.sleeve}|${r.contract}|${r.expiry}`}
              autoHeight
              lockColumns
              initialSort={{ key: 'ratio', dir: 'desc' }}
              animate={false}
              testId="study-movers"
              emptyText="No contract sat close on this cut."
              phoneRow={r => (
                <PhoneRow
                  title={<ContractLabel contract={r.contract} right={r.contract.endsWith('C') ? 'C' : 'P'} logo={r.contract.split(' ')[0]} size="sm" />}
                  aside={<span className="text-bull">{r.ratio.toFixed(2)}×</span>}
                  figures={[
                    <span key="m">{r.mark} ET · ask {r.ask.toFixed(2)} → {r.bestBid.toFixed(2)} at {r.bestAt}</span>,
                    <span key="g">{r.p1 == null ? 'Not scored' : r.p1 + 1e-12 >= P1_MIN ? 'Cleared Model 1' : 'Under Model 1’s line'} · {r.gate}</span>,
                  ]}
                />
              )}
            />
          </div>
          {doc.notes.length > 0 && (
            <p className="border-t border-borderSubtle px-5 py-3 font-mono text-t10 text-textMuted">{doc.notes.join(' ')}</p>
          )}
          </>
          ) : null}
        </>
      )}
    </TraceBox>
  );
};

/** The movers grid's columns, for scripts/compass-words-proof.ts (the grid itself renders only in a browser) */
export const STUDY_GRID = { columns: COLUMNS };

export default SessionStudy;
