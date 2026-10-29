/* The session study: every contract in the scan's strike band that made a 50%+ move by the books' own definitions,
   what the model read at that mark and the gate that stopped it; the miss reasons; Model 1's calibration on the
   day's labelled rows; and suggested changes with their evidence. Nothing here is applied. */

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import TraceBox, { Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import type { Column } from '../../components/ui/DataTable';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ContractLabel from '../../components/ui/ContractLabel';
import { EmptyBox, ErrorBox, LoadingBox } from '../../components/ui/states';
import { useCompassDoc } from '../../data/compassReviewFeed';
import { holdCompassFeed } from '../../data/compassFeed';
import { P1_MIN } from '../../data/compassParams';
import type { Mover } from '../../data/compassStudy';
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
  { key: 'p1', header: 'Model 1', align: 'right', sortValue: r => r.p1 ?? -1, render: r => (r.p1 == null ? blank : <span className={`tnum ${r.p1 + 1e-12 >= P1_MIN ? 'text-bull' : 'text-textPrimary'}`}>{(r.p1 * 100).toFixed(1)}%</span>) },
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

const SessionStudy = () => {
  useEffect(() => holdCompassFeed(), []);
  const [day, setDay, days] = useReviewDay();
  const [sleeve, setSleeve] = useState<'all' | 'odte' | 'weekly'>('all');
  const { doc, status, error } = useCompassDoc('study', day);
  const movers = useMemo(() => (doc?.movers ?? []).filter(m => sleeve === 'all' || m.sleeve === sleeve), [doc, sleeve]);
  const s = doc?.sleeves;
  return (
    <TraceBox
      title="Session study"
      sub="What made 50%+ in the scan's band, what the model read, and what stopped it"
      testId="compass-study"
      facts={
        <>
          <Fact label="0DTE movers" testId="odte" title="Contracts whose bid reached 1.50× an ask at a mark, before the flat">{s ? s.odte.movers : '—'}</Fact>
          <Fact label="1–7 DTE movers" testId="weekly">{s ? s.weekly.movers : '—'}</Fact>
          <Fact label="Scored · over the bar" testId="scored" title={`Read by the model at that mark, and at or over ${(P1_MIN * 100).toFixed(2)}%`}>{s ? `${s.odte.scored + s.weekly.scored} · ${s.odte.aboveThreshold + s.weekly.aboveThreshold}` : '—'}</Fact>
          <Fact label="Called" testId="called">{s ? s.odte.called + s.weekly.called : '—'}</Fact>
          <Fact label="Rows labelled" testId="labels">{doc ? doc.labels.toLocaleString('en-US') : '—'}</Fact>
        </>
      }
      controls={
        <>
          <ExpiryCalendar value={day ?? ''} expiries={days.map(expiryOfDay)} onChange={e => setDay(isoDate(e.date))} anyLabel="Newest" steppers={!!day} label="Session" icon={CalendarDays} title="The session to study" testId="study-day" />
          <DropdownSelect label="Sleeve" value={sleeve} options={[{ value: 'all', label: 'Both sleeves' }, { value: 'odte', label: '0DTE' }, { value: 'weekly', label: '1–7 DTE' }]} onChange={setSleeve} title="Which sleeve's movers" testId="study-sleeve" />
        </>
      }
      sentence={<span>Suggestions carry their evidence and sample size. Nothing is applied: the owner decides.</span>}
    >
      {status === 'loading' && !doc ? (
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
          <Section title="Model 1 against what happened (Book A rules from each mark)">
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
                    <span className="text-textMuted">Book {f.book}{f.would ? ' · would have called' : ''}</span>
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
                    <span key="g">{r.p1 == null ? 'Not scored' : `Model 1 ${(r.p1 * 100).toFixed(1)}%`} · {r.gate}</span>,
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
