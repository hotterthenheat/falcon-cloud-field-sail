/* The session review: every trade Compass took, and every one a late mark would have taken, reviewed after the
   session from ThetaData's recorded quotes (data/compassReview.ts). The verdict first, then the numbers. */

import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import TraceBox, { Fact } from '../../components/trace/TraceBox';
import TradeReviewCard from '../../components/compass/TradeReviewCard';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import DropdownSelect from '../../components/ui/DropdownSelect';
import { EmptyBox, ErrorBox, LoadingBox } from '../../components/ui/states';
import { useCompassDays, useCompassDoc } from '../../data/compassReviewFeed';
import { holdCompassFeed } from '../../data/compassFeed';
import { isoDate, type Expiry } from '../../core/calendar';

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

const SessionReview = () => {
  useEffect(() => holdCompassFeed(), []);
  const [day, setDay, days] = useReviewDay();
  const [kind, setKind] = useState<'all' | 'calls' | 'would'>('all');
  const { doc, status, error } = useCompassDoc('review', day);
  const trades = useMemo(() => (doc?.trades ?? []).filter(t => kind === 'all' || (kind === 'would' ? t.would : !t.would)), [doc, kind]);
  const calls = (doc?.trades ?? []).filter(t => !t.would);
  const would = (doc?.trades ?? []).filter(t => t.would);
  const causes = new Map<string, number>();
  for (const t of doc?.trades ?? []) causes.set(t.verdict.cause, (causes.get(t.verdict.cause) ?? 0) + 1);
  const top = [...causes].sort((a, b) => b[1] - a[1])[0];
  const location = useLocation();
  useEffect(() => {
    if (!location.hash || !doc) return;
    document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView({ block: 'start' });
  }, [location.hash, doc]);
  return (
    <TraceBox
      title="Session review"
      sub="Every trade it took, and every one a late mark would have taken, reviewed after the close"
      testId="compass-review"
      facts={
        <>
          <Fact label="Calls" testId="calls">{calls.length}</Fact>
          <Fact label="Won · lost" testId="won" title="Live calls, after the round trip's fees.">
            <span className="text-bull">{calls.filter(t => (t.after.pnl ?? 0) > 0).length}</span> · <span className="text-bear">{calls.filter(t => t.after.pnl != null && t.after.pnl <= 0).length}</span>
          </Fact>
          <Fact label="Would have called" testId="would" title="Marks scored late from recorded quotes. Never calls, never seats.">{would.length}</Fact>
          <Fact label="Most common cause" testId="cause">{top ? `${top[0]} · ${top[1]}` : '—'}</Fact>
        </>
      }
      controls={
        <>
          <ExpiryCalendar value={day ?? ''} expiries={days.map(expiryOfDay)} onChange={e => setDay(isoDate(e.date))} anyLabel="Newest" steppers={!!day} label="Session" icon={CalendarDays} title="The session to review" testId="review-day" />
          <DropdownSelect
            label="Show"
            value={kind}
            options={[{ value: 'all', label: 'Calls and would-have' }, { value: 'calls', label: 'Live calls' }, { value: 'would', label: 'Would have called' }]}
            onChange={setKind}
            title="Which trades the review shows"
            testId="review-kind"
          />
        </>
      }
      sentence={doc ? <span>Built {new Date(doc.builtAt).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false })} ET from ThetaData&apos;s recorded quotes. Causes come from repricing the mid step by step: the underlying&apos;s move, time, implied vol, the spread.</span> : false}
    >
      <div className="border-t border-borderSubtle">
        {status === 'loading' && !doc ? (
          <LoadingBox shape="lines" rows={6} label="Reading the review" />
        ) : status === 'error' && !doc ? (
          <ErrorBox what="The review did not load" detail={error} />
        ) : status === 'missing' || !doc ? (
          <EmptyBox title="Not built yet" reason="The review is built once the session's calls have settled, after 16:20 ET." />
        ) : trades.length === 0 ? (
          <EmptyBox title="No trade" reason="Nothing was called or would have been called on this session." />
        ) : (
          <div className="px-4 sm:px-5 py-4 grid grid-cols-1 2xl:grid-cols-2 gap-3" data-review-list>
            {trades.map(t => <TradeReviewCard key={t.key} r={t} />)}
          </div>
        )}
      </div>
    </TraceBox>
  );
};

export default SessionReview;
