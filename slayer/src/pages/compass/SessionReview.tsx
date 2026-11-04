/* The review: a live scan of every name in the book. A turn is a minute whose bid stopped falling and whose next
   minute rose. The run is the high after that print, until the bid comes back or the session ends. */

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import TraceBox, { Fact } from '../../components/trace/TraceBox';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ContractLabel from '../../components/ui/ContractLabel';
import { EmptyBox, ErrorBox, LoadingBox } from '../../components/ui/states';
import { useCompassDays, useCompassDoc } from '../../data/compassReviewFeed';
import type { ReviewBand, ReviewHit, ReviewSleeve } from '../../data/reviewLive';
import { isoDate, type Expiry } from '../../core/calendar';
import { nyClock } from '../../core/nyTime';

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const expiryOfDay = (iso: string): Expiry => {
  const date = new Date(`${iso}T12:00:00`);
  return { date, label: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${String(date.getFullYear()).slice(2)}`, weekday: WEEK[date.getDay()], dte: 0, sessions: 0 };
};

/** The session the page shows: ?day=, else the newest on record. */
export function useReviewDay(): [string | null, (d: string) => void, string[]] {
  const location = useLocation();
  const asked = new URLSearchParams(location.search).get('day');
  const days = useCompassDays();
  const [day, setDay] = useState<string | null>(asked);
  useEffect(() => {
    if (!day && days.length) setDay(days[0]);
  }, [day, days]);
  return [day, setDay, days];
}

const SESSION: Record<string, string> = { gth: 'Overnight', pre: 'Pre-market', regular: 'Regular', curb: 'Curb', post: 'After hours', overnight: 'Overnight' };
const SLEEVE: Record<ReviewSleeve, string> = { '0': '0DTE', '1-7': '1–7 DTE', '8-30': '8–30 DTE' };
const BAND: Record<ReviewBand, string> = { 0: '60–99%', 1: '100–300%', 2: '301–800%', 3: '801%+' };
const END: Record<ReviewHit['end'], string> = { open: 'Open', back: 'Back at the print', session: 'Session ended' };

const n = (v: number | null, d = 2) => (v == null ? '—' : v.toFixed(d));
const pct = (v: number) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

type BandPick = 'all' | '60' | '0' | '1' | '2' | '3';

const Row = ({ r }: { r: ReviewHit }) => (
  <tr id={r.id} className="border-b border-borderSubtle/40 align-top">
    <td className="py-1.5 pr-3"><ContractLabel contract={r.contract} right={r.right} logo={r.root} size="sm" /></td>
    <td className="py-1.5 pr-3 text-textSecondary whitespace-nowrap">{SESSION[r.session] ?? r.session}</td>
    <td className="py-1.5 pr-3 text-textSecondary whitespace-nowrap">{SLEEVE[r.sleeve]}</td>
    <td className="py-1.5 pr-3 text-textPrimary whitespace-nowrap">{BAND[r.band]}{r.over ? <span className="text-warn"> · over 5,000%</span> : null}</td>
    <td className="py-1.5 pr-3 text-right">{r.baseAsk.toFixed(2)}</td>
    <td className="py-1.5 pr-3 text-right">{n(r.bid)}</td>
    <td className="py-1.5 pr-3 text-right">{n(r.ask)}</td>
    <td className="py-1.5 pr-3 text-right text-bull">{pct(r.pct)}</td>
    <td className="py-1.5 pr-3 text-right">{r.peakBid.toFixed(2)} <span className="text-textMuted">{nyClock(r.peakAt)}</span></td>
    <td className="py-1.5 pr-3 text-right" title={r.draws.map(d => `${d.pct}% from ${d.peak.toFixed(2)} to ${d.low.toFixed(2)}${d.through ? ', through the turn' : ''}`).join(' · ') || 'No pullback'}>
      {r.maxDraw > 0 ? <span className="text-bear">{pct(r.maxDraw)}</span> : '—'}
      {r.draws.length > 1 ? <span className="text-textMuted"> · {r.draws.length}</span> : null}
    </td>
    <td className="py-1.5 pr-3 text-textSecondary whitespace-nowrap">{r.through ? 'Through the turn' : END[r.end]}</td>
    <td className="py-1.5 pr-3 text-right max-lg:hidden">{r.iv == null ? '—' : `${(r.iv * 100).toFixed(1)}%`}</td>
    <td className="py-1.5 pr-3 text-right max-lg:hidden">{n(r.delta)}</td>
    <td className="py-1.5 pr-3 text-right max-xl:hidden">{n(r.gamma, 4)}</td>
    <td className="py-1.5 pr-3 text-right max-xl:hidden">{n(r.theta, 4)}</td>
    <td className="py-1.5 pr-3 text-right max-xl:hidden">{n(r.vega, 4)}</td>
    <td className="py-1.5 pr-3 text-right max-lg:hidden">{r.under == null ? '—' : r.under.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
    <td className="py-1.5 pr-3 text-right max-xl:hidden">{r.volume == null ? '—' : r.volume.toLocaleString('en-US')}</td>
    <td className="py-1.5 text-right max-xl:hidden">{r.oi == null ? '—' : r.oi.toLocaleString('en-US')}</td>
  </tr>
);

const SessionReview = () => {
  const [day, setDay, days] = useReviewDay();
  const [sleeve, setSleeve] = useState<'all' | ReviewSleeve>('all');
  const [band, setBand] = useState<BandPick>('all');
  const [session, setSession] = useState<'all' | string>('all');
  const { doc, status, error } = useCompassDoc('review', day, 5_000);
  const live = doc?.version === 4 && Array.isArray(doc.rows) ? doc : null;
  const sessions = useMemo(() => [...new Set((live?.rows ?? []).map(r => r.session))], [live]);
  const rows = useMemo(() => (live?.rows ?? []).filter(r => {
    if (sleeve !== 'all' && r.sleeve !== sleeve) return false;
    if (session !== 'all' && r.session !== session) return false;
    if (band === 'all') return r.band !== 0;
    if (band === '60') return true;
    return String(r.band) === band;
  }), [live, sleeve, band, session]);
  const count = (b: ReviewBand) => (live?.rows ?? []).filter(r => r.band === b).length;
  return (
    <TraceBox
      title="Review"
      sub="How far this run went off the print it turned from"
      testId="compass-review"
      facts={
        <>
          <Fact label="60%+" testId="band-0">{live ? (live.rows.length).toLocaleString('en-US') : '—'}</Fact>
          <Fact label="100–300%" testId="band-1">{live ? count(1).toLocaleString('en-US') : '—'}</Fact>
          <Fact label="301–800%" testId="band-2">{live ? count(2).toLocaleString('en-US') : '—'}</Fact>
          <Fact label="801%+" testId="band-3">{live ? count(3).toLocaleString('en-US') : '—'}</Fact>
          <Fact label="Books open" testId="open" title="Names whose options are in a session right now, of the 458">{live ? `${live.open} of ${live.names}` : '—'}</Fact>
        </>
      }
      controls={
        <>
          <ExpiryCalendar value={day ?? ''} expiries={days.map(expiryOfDay)} onChange={e => setDay(isoDate(e.date))} anyLabel="Newest" steppers={!!day} label="Session" icon={CalendarDays} title="The session day" testId="review-day" />
          <DropdownSelect label="Book" value={sleeve} options={[{ value: 'all', label: 'All expiries' }, { value: '0', label: '0DTE' }, { value: '1-7', label: '1–7 DTE' }, { value: '8-30', label: '8–30 DTE' }]} onChange={setSleeve} title="Which expiry book" testId="review-sleeve" />
          <DropdownSelect label="Band" value={band} options={[{ value: 'all', label: 'All bands', hint: '100% and above' }, { value: '60', label: '60%+', hint: '60% and above, including the three bands' }, { value: '0', label: '60–99%' }, { value: '1', label: '100–300%' }, { value: '2', label: '301–800%' }, { value: '3', label: '801%+' }]} onChange={setBand} title="How far this run went off the print it turned from" testId="review-band" />
          <DropdownSelect label="Tape" value={session} options={[{ value: 'all', label: 'All sessions' }, ...sessions.map(s => ({ value: s, label: SESSION[s] ?? s }))]} onChange={setSession} title="Which option session" testId="review-session" />
        </>
      }
      sentence={live ? <span>{live.line}. A turn is a minute whose bid stopped falling and whose next minute rose. The run is the highest bid after that print, until the bid comes back to it or the session ends. A run under 100% is not in All bands. 60%+ keeps those too. A pullback is kept, and one that comes back through the turn ends the run. The same contract can turn again after that. Nothing here is a model call.</span> : false}
    >
      <div className="border-t border-borderSubtle">
        {status === 'loading' && !live ? (
          <LoadingBox shape="table" rows={8} label="Reading the review" />
        ) : status === 'error' && !live ? (
          <ErrorBox what="The review did not load" detail={error} />
        ) : !live ? (
          <EmptyBox title="No scan for this day" reason="The review runs while an option book is open. This day has not been scanned." />
        ) : rows.length === 0 ? (
          <EmptyBox title="No run in this band yet" reason={live.rows.length ? 'Nothing in this book, band, or session.' : 'No bid has turned and run 60% off that print.'} />
        ) : (
          <div className="overflow-x-auto px-4 sm:px-5 py-3">
            <table className="w-full min-w-[860px] font-mono text-t11 tnum" data-review-list>
              <thead>
                <tr className="text-textMuted text-t9 uppercase tracking-widest">
                  <th className="text-left font-normal pb-1 pr-3">Contract</th>
                  <th className="text-left font-normal pb-1 pr-3">Session</th>
                  <th className="text-left font-normal pb-1 pr-3">Book</th>
                  <th className="text-left font-normal pb-1 pr-3">Band</th>
                  <th className="text-right font-normal pb-1 pr-3">Turn</th>
                  <th className="text-right font-normal pb-1 pr-3">Bid</th>
                  <th className="text-right font-normal pb-1 pr-3">Ask</th>
                  <th className="text-right font-normal pb-1 pr-3">Run</th>
                  <th className="text-right font-normal pb-1 pr-3">Peak</th>
                  <th className="text-right font-normal pb-1 pr-3">Drawdown</th>
                  <th className="text-left font-normal pb-1 pr-3">End</th>
                  <th className="text-right font-normal pb-1 pr-3 max-lg:hidden">IV</th>
                  <th className="text-right font-normal pb-1 pr-3 max-lg:hidden">Delta</th>
                  <th className="text-right font-normal pb-1 pr-3 max-xl:hidden">Gamma</th>
                  <th className="text-right font-normal pb-1 pr-3 max-xl:hidden">Theta</th>
                  <th className="text-right font-normal pb-1 pr-3 max-xl:hidden">Vega</th>
                  <th className="text-right font-normal pb-1 pr-3 max-lg:hidden">Under</th>
                  <th className="text-right font-normal pb-1 pr-3 max-xl:hidden">Volume</th>
                  <th className="text-right font-normal pb-1 max-xl:hidden">OI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => <Row key={r.id} r={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TraceBox>
  );
};

export default SessionReview;
