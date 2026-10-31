/* The session study: every contract in the scan's strike band that made a 50%+ move by the books' own definitions,
   what the model read at that mark and the gate that stopped it; the miss reasons; Model 1's calibration on the
   day's labelled rows; and suggested changes with their evidence. Nothing here is applied.
   "All sessions" pools every labelled day (data/compassStudy.ts poolStudies): the calibration with 95% intervals, the
   threshold sweep, the miss reasons, the inputs over time, and a plain verdict on reading Model 1 as a probability,
   which never lifts the "Unvalidated" label by itself. */

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import TraceBox, { Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import type { Column } from '../../components/ui/DataTable';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ContractLabel from '../../components/ui/ContractLabel';
import { EmptyBox, ErrorBox, LoadingBox } from '../../components/ui/states';
import { useCompassDoc } from '../../data/compassReviewFeed';
import { holdCompassFeed } from '../../data/compassFeed';
import { BOOK_NAME, MODEL_1_NAME, P1_MIN } from '../../data/compassParams';
import { POOL_BAR, type Mover, type PooledStudy, type Rate } from '../../data/compassStudy';
import { isoDate } from '../../core/calendar';
import { expiryOfDay, useReviewDay } from './SessionReview';

const blank = <span className="text-textMuted">—</span>;
const COLUMNS: Column<Mover>[] = [
  { key: 'contract', header: 'Contract', sortValue: r => r.contract, render: r => <ContractLabel contract={r.contract} right={r.contract.endsWith('C') ? 'C' : 'P'} logo={r.contract.split(' ')[0]} size="sm" /> },
  { key: 'sleeve', header: 'Sleeve', sortValue: r => r.sleeve, render: r => <span className="text-textSecondary">{r.sleeve === 'odte' ? '0DTE' : '1–7 DTE'}</span> },
  { key: 'mark', header: 'Mark ET', sortValue: r => r.mark, render: r => <span className="tnum text-textPrimary">{r.mark}</span> },
  { key: 'ask', header: 'Ask', align: 'right', sortValue: r => r.ask, render: r => <span className="tnum">{r.ask.toFixed(2)}</span> },
  { key: 'best', header: 'Best bid', align: 'right', sortValue: r => r.bestBid, render: r => <span className="tnum text-bull">{r.bestBid.toFixed(2)} <span className="text-textMuted">{r.bestAt}</span></span> },
  { key: 'ratio', header: 'Move', align: 'right', sortValue: r => r.ratio, render: r => <span className="tnum text-bull">{r.ratio.toFixed(2)}×</span> },
  { key: 'stop', header: 'Stop first', align: 'right', sortValue: r => (r.stopFirst ? 1 : 0), render: r => (r.stopFirst ? <span className="text-warn">Yes</span> : <span className="text-textMuted">No</span>) },
  { key: 'p1', header: MODEL_1_NAME, align: 'right', sortValue: r => r.p1 ?? -1, render: r => (r.p1 == null ? blank : <span className={`tnum ${r.p1 + 1e-12 >= P1_MIN ? 'text-bull' : 'text-textPrimary'}`}>{(r.p1 * 100).toFixed(1)}%</span>) },
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
const TH = 'font-normal pb-1';

/** One bucket on a 0–100% track: the realised rate's 95% interval (the band), its rate (the bar) and the mean
    score (the tick). A calibrated bucket has the tick inside the band. */
const Strip = ({ r, score }: { r: Rate; score: number | null }) => (
  <div className="relative h-3 w-full min-w-[96px] rounded-sm bg-chip" aria-hidden="true">
    {r.n > 0 && <div className="absolute inset-y-0 rounded-sm bg-silver/25" style={{ left: `${r.lo95 * 100}%`, width: `${Math.max(0.5, (r.hi95 - r.lo95) * 100)}%` }} />}
    {r.n > 0 && <div className="absolute inset-y-[3px] w-[2px] bg-textPrimary" style={{ left: `calc(${r.rate * 100}% - 1px)` }} />}
    {score != null && <div className="absolute -inset-y-[2px] w-[2px] bg-warn" style={{ left: `calc(${score * 100}% - 1px)` }} />}
  </div>
);

/** Every labelled session together */
const PooledView = ({ doc }: { doc: PooledStudy }) => {
  const io = doc.inputsOverTime;
  return (
    <>
      <Section title={`Can the ${MODEL_1_NAME} be read as a probability?`}>
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
          The bars are fixed: {POOL_BAR.sessions}+ sessions, {POOL_BAR.rowsPerBucket}+ effective rows in every bucket inside the trained minutes (settled rows counted after clustering by session, since one session’s rows move together), each bucket within ±{POOL_BAR.gapPoints} points of its mean score. Meeting them is evidence for the owner, not a switch: the “Unvalidated” label stays until the owner lifts it after the input check.
        </p>
      </Section>
      <Section title={`${MODEL_1_NAME} against what happened · ${doc.days.length} session${doc.days.length === 1 ? '' : 's'} pooled`}>
        <table className="w-full font-mono text-t11 tnum [&_td+td]:pl-3 [&_th+th]:pl-3" data-pool-calibration>
          <thead>
            <tr className="text-textMuted text-t9 uppercase tracking-widest">
              <th className={`text-left ${TH}`}>{MODEL_1_NAME}</th>
              <th className={`text-right ${TH}`} title="Settled rows inside the trained minutes, 09:45–15:00 ET, then the effective count after clustering by session (the bar reads the effective count)">Rows · eff.</th>
              <th className={`text-right ${TH}`} title={`Mean ${MODEL_1_NAME} of those rows`}>Score</th>
              <th className={`text-right ${TH}`} title={`Took the 1.50× profit by the ${BOOK_NAME.A} rules from the mark`}>Took</th>
              <th className={`text-right ${TH} max-sm:hidden`}>95% interval</th>
              <th className={`text-right ${TH}`} title="Took minus score, points">Gap</th>
              <th className={`text-left ${TH} pl-4 max-md:hidden w-[28%]`}>
                <span className="text-textMuted">Took, 95% band</span> · <span className="text-warn">score</span>
              </th>
              <th className={`text-right ${TH} max-lg:hidden`} title="All settled rows, every minute">All rows · took</th>
              <th className={`text-right ${TH} max-lg:hidden`}>Sessions</th>
            </tr>
          </thead>
          <tbody>
            {doc.calibration.map(c => (
              <tr key={c.bucket} className={`border-b border-borderSubtle/40 ${c.lo >= P1_MIN ? 'text-textPrimary' : 'text-textSecondary'}`}>
                <td className="py-1 whitespace-nowrap">{c.bucket}</td>
                <td className={`py-1 text-right whitespace-nowrap ${(c.win.nEff ?? c.win.n) < POOL_BAR.rowsPerBucket ? 'text-warn' : ''}`}>{c.win.n.toLocaleString('en-US')} · {Math.round(c.win.nEff ?? c.win.n).toLocaleString('en-US')}</td>
                <td className="py-1 text-right">{c.meanP1 == null ? blank : pct(c.meanP1)}</td>
                <td className="py-1 text-right">{c.win.n ? pct(c.win.rate) : blank}</td>
                <td className="py-1 text-right text-textMuted max-sm:hidden">{band(c.win)}</td>
                <td className={`py-1 text-right ${c.gapPoints == null ? '' : Math.abs(c.gapPoints) <= POOL_BAR.gapPoints ? 'text-bull' : 'text-bear'}`}>{c.gapPoints == null ? blank : signed(c.gapPoints)}</td>
                <td className="py-1 pl-4 max-md:hidden"><Strip r={c.win} score={c.meanP1} /></td>
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
              <th className={`text-right ${TH}`} title={`Mean ${BOOK_NAME.A} return per row, percent`}>Mean return</th>
              <th className={`text-right ${TH}`} title="Sessions whose mean return at this cut was positive, of those with a row">Sessions up</th>
            </tr>
          </thead>
          <tbody>
            {doc.thresholds.map(t => (
              <tr key={t.p1} className={`border-b border-borderSubtle/40 ${Math.abs(t.p1 - P1_MIN) < 1e-9 ? 'text-textPrimary' : 'text-textSecondary'}`}>
                <td className="py-1 whitespace-nowrap">{(t.p1 * 100).toFixed(Math.abs(t.p1 - P1_MIN) < 1e-9 ? 2 : 0)}%{Math.abs(t.p1 - P1_MIN) < 1e-9 && <span className="text-textMuted"> · now</span>}</td>
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
            <thead><tr className="text-textMuted text-t9 uppercase tracking-widest"><th className={`text-left ${TH}`}>Input holding the {MODEL_1_NAME} down</th><th className={`text-right ${TH}`}>Movers</th><th className={`text-right ${TH}`}>Sessions</th></tr></thead>
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
              <th className={`text-right ${TH}`} title={`Settled rows at or over ${(P1_MIN * 100).toFixed(2)}%, 09:45–15:00 ET`}>Over the bar</th>
              <th className={`text-right ${TH}`}>Took</th>
              <th className={`text-right ${TH} max-sm:hidden`}>Score</th>
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
                <td className="py-1 text-right max-sm:hidden">{d.overMeanP1 == null ? blank : pct(d.overMeanP1)}</td>
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
  useEffect(() => holdCompassFeed(), []);
  const location = useLocation();
  const [view, setView] = useState<'one' | 'all'>(() => (new URLSearchParams(location.search).get('day') === 'all' ? 'all' : 'one'));
  const [askedDay, setDay, days] = useReviewDay();
  const day = askedDay === 'all' ? (days[0] ?? null) : askedDay;
  const [sleeve, setSleeve] = useState<'all' | 'odte' | 'weekly'>('all');
  const one = useCompassDoc('study', view === 'one' ? day : null);
  const pool = useCompassDoc('pooled', view === 'all' ? 'all' : null);
  const { doc, status, error } = one;
  const movers = useMemo(() => (doc?.movers ?? []).filter(m => sleeve === 'all' || m.sleeve === sleeve), [doc, sleeve]);
  const s = doc?.sleeves;
  return (
    <TraceBox
      title="Session study"
      sub={view === 'all' ? `Every labelled session pooled: the ${MODEL_1_NAME} against what happened, and whether it reads as a probability yet` : "What made 50%+ in the scan's band, what the model read, and what stopped it"}
      testId="compass-study"
      facts={
        view === 'all' ? (
          <>
            <Fact label="Sessions pooled" testId="pool-sessions">{pool.doc ? pool.doc.days.length : '—'}</Fact>
            <Fact label="Rows labelled · settled" testId="pool-labels">{pool.doc ? `${pool.doc.labels.toLocaleString('en-US')} · ${pool.doc.settled.toLocaleString('en-US')}` : '—'}</Fact>
            <Fact label="Movers" testId="pool-movers" title="Contracts whose bid reached 1.50× an ask at a mark, before the flat, every session">{pool.doc ? pool.doc.movers.toLocaleString('en-US') : '—'}</Fact>
            <Fact label={`${MODEL_1_NAME} as a probability`} testId="pool-verdict">{pool.doc ? <span className={pool.doc.verdict.ready ? 'text-bull' : 'text-warn'}>{pool.doc.verdict.ready ? 'Bars met' : 'Not yet'}</span> : '—'}</Fact>
          </>
        ) : (
          <>
            <Fact label="0DTE movers" testId="odte" title="Contracts whose bid reached 1.50× an ask at a mark, before the flat">{s ? s.odte.movers : '—'}</Fact>
            <Fact label="1–7 DTE movers" testId="weekly">{s ? s.weekly.movers : '—'}</Fact>
            <Fact label="Scored · over the bar" testId="scored" title={`Read by the model at that mark, and at or over ${(P1_MIN * 100).toFixed(2)}%`}>{s ? `${s.odte.scored + s.weekly.scored} · ${s.odte.aboveThreshold + s.weekly.aboveThreshold}` : '—'}</Fact>
            <Fact label="Called" testId="called">{s ? s.odte.called + s.weekly.called : '—'}</Fact>
            <Fact label="Rows labelled" testId="labels">{doc ? doc.labels.toLocaleString('en-US') : '—'}</Fact>
          </>
        )
      }
      controls={
        <>
          <DropdownSelect
            label="Study"
            value={view}
            options={[
              { value: 'one', label: 'One session', hint: "A session's movers, gates and calibration" },
              { value: 'all', label: 'All sessions', hint: `Every labelled session pooled, with a verdict on the ${MODEL_1_NAME}` },
            ]}
            onChange={setView}
            title="One session, or every labelled session pooled"
            testId="study-view"
          />
          {view === 'one' && (
            <>
              <ExpiryCalendar value={day ?? ''} expiries={days.map(expiryOfDay)} onChange={e => setDay(isoDate(e.date))} anyLabel="Newest" steppers={!!day} label="Session" icon={CalendarDays} title="The session to study" testId="study-day" />
              <DropdownSelect label="Sleeve" value={sleeve} options={[{ value: 'all', label: 'Both sleeves' }, { value: 'odte', label: '0DTE' }, { value: 'weekly', label: '1–7 DTE' }]} onChange={setSleeve} title="Which sleeve's movers" testId="study-sleeve" />
            </>
          )}
        </>
      }
      sentence={
        view === 'all' ? (
          <span>Every labelled session&apos;s rows together, with 95% intervals. The verdict states what is still missing; nothing is lifted or applied from here.</span>
        ) : (
          <span>Suggestions carry their evidence and sample size. Nothing is applied: the owner decides.</span>
        )
      }
    >
      {view === 'all' ? (
        pool.status === 'loading' && !pool.doc ? (
          <div className="border-t border-borderSubtle"><LoadingBox shape="table" rows={6} label="Pooling the sessions" /></div>
        ) : pool.status === 'error' && !pool.doc ? (
          <div className="border-t border-borderSubtle"><ErrorBox what="The pooled study did not load" detail={pool.error} /></div>
        ) : !pool.doc ? (
          <div className="border-t border-borderSubtle"><EmptyBox title="No session labelled yet" reason="Each session's rows are labelled once it has settled, after 16:20 ET." /></div>
        ) : (
          <PooledView doc={pool.doc} />
        )
      ) : status === 'loading' && !doc ? (
        <div className="border-t border-borderSubtle"><LoadingBox shape="table" rows={6} label="Reading the study" /></div>
      ) : status === 'error' && !doc ? (
        <div className="border-t border-borderSubtle"><ErrorBox what="The study did not load" detail={error} /></div>
      ) : !doc ? (
        <div className="border-t border-borderSubtle"><EmptyBox title="Not built yet" reason="The study is built once the session has settled, after 16:20 ET." /></div>
      ) : (
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
                <thead><tr className="text-textMuted text-t9 uppercase tracking-widest"><th className="text-left font-normal pb-1">Input holding the {MODEL_1_NAME} down</th><th className="text-right font-normal pb-1">Movers</th></tr></thead>
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
          <Section title={`${MODEL_1_NAME} against what happened (${BOOK_NAME.A} rules from each mark)`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] font-mono text-t11 tnum" data-study-calibration>
                <thead>
                  <tr className="text-textMuted text-t9 uppercase tracking-widest">
                    <th className="text-left font-normal pb-1">{MODEL_1_NAME}</th>
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
                    <span className="text-textMuted">{BOOK_NAME[f.book as 'A' | 'B' | 'C'] ?? f.book}{f.would ? ' · would have called' : ''}</span>
                    <span className="text-bear tnum">{f.pnl == null ? '—' : `−$${Math.abs(f.pnl).toFixed(2)}`}</span>
                    <span className="text-textSecondary">{f.cause}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <div className="border-t border-borderSubtle">
            <TraceGrid
              rows={movers}
              columns={COLUMNS}
              widths={WIDTHS}
              rowKey={r => `${r.sleeve}|${r.contract}|${r.expiry}`}
              autoHeight
              lockColumns
              initialSort={{ key: 'ratio', dir: 'desc' }}
              animate={false}
              testId="study-movers"
              emptyText="No contract made a 50%+ move on this cut."
              phoneRow={r => (
                <PhoneRow
                  title={<ContractLabel contract={r.contract} right={r.contract.endsWith('C') ? 'C' : 'P'} logo={r.contract.split(' ')[0]} size="sm" />}
                  aside={<span className="text-bull">{r.ratio.toFixed(2)}×</span>}
                  figures={[
                    <span key="m">{r.mark} ET · ask {r.ask.toFixed(2)} → {r.bestBid.toFixed(2)} at {r.bestAt}</span>,
                    <span key="g">{r.p1 == null ? 'Not scored' : `${MODEL_1_NAME} ${(r.p1 * 100).toFixed(1)}%`} · {r.gate}</span>,
                  ]}
                />
              )}
            />
          </div>
          {doc.notes.length > 0 && (
            <p className="border-t border-borderSubtle px-5 py-3 font-mono text-t10 text-textMuted">{doc.notes.join(' ')}</p>
          )}
        </>
      )}
    </TraceBox>
  );
};

export default SessionStudy;
