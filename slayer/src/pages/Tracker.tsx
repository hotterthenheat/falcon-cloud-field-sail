/* The signals in play: every Compass signal still open, and today's that closed, each with the quote it fired on,
   its fill a minute later, and its path since then off the contract's one-minute NBBO from ThetaData. A contract
   you track is marked; nothing here is priced from a model or another feed. */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { useTracker } from '../context/TrackerContext';
import { nyClock, nyIsoDate } from '../core/nyTime';
import { useSignals, type Signal } from '../data/compassLedger';
import { useThetaStatus } from '../data/thetaQuote';
import TraceBox, { Fact } from '../components/trace/TraceBox';
import ContractLabel from '../components/ui/ContractLabel';
import SessionSpark from '../components/compass/SessionSpark';
import { usd2 as money } from '../core/format';

const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);
const ink = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

const Cell = ({ label, value, tone = 'text-textPrimary' }: { label: string; value: string; tone?: string }) => (
  <div className="bg-panel px-3 py-2.5 min-w-0">
    <div className="font-mono text-t9 uppercase tracking-widest text-textMuted">{label}</div>
    <div className={`mt-0.5 font-mono text-t13 font-semibold tnum truncate ${tone}`}>{value}</div>
  </div>
);

function stateOf(s: Signal): { word: string; tone: string; line: string } {
  const o = s.outcome;
  if (!o || o.status === 'waiting') return { word: 'Filling', tone: 'text-textSecondary', line: 'Fills at the ask of the first quote a full minute after the call.' };
  if (o.status === 'unavailable') return { word: 'Unavailable', tone: 'text-textMuted', line: 'No valid quote stood a minute after the call. No price was substituted.' };
  if (o.status === 'closed' && o.exit && o.fill) {
    const win = o.exit.px > o.fill.ask;
    return { word: win ? 'Win' : 'Loss', tone: win ? 'text-bull' : 'text-bear', line: `${o.exit.why}. Left at ${money(o.exit.px)}, ${nyClock(o.exit.at, { zone: true })}.` };
  }
  return { word: 'Open', tone: 'text-textPrimary', line: o.last ? `Last bid ${money(o.last.bid)} at ${nyClock(o.last.t, { zone: true })}.` : 'Filled. No later quote yet.' };
}

const SignalCard = ({ s, tracked, onOpen }: { s: Signal; tracked: boolean; onOpen: () => void }) => {
  const o = s.outcome;
  const paid = o?.fill?.ask ?? 0;
  const now = o?.exit?.px ?? o?.last?.bid ?? null;
  const state = stateOf(s);
  const lottery = s.book === 'C';
  return (
    <button type="button" onClick={onOpen} className="text-left border border-borderSubtle bg-panel rounded-md overflow-hidden flex flex-col hover:border-borderMuted transition-colors" data-tracker-signal={s.key}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-borderSubtle">
        <ContractLabel contract={s.contract} right={s.right} logo={s.ticker} size="sm" />
        <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">Book {s.book}</span>
        {tracked && <Bookmark className="w-3.5 h-3.5 text-textSecondary" aria-label="Tracked" />}
        <span className={`ml-auto font-mono text-t10 uppercase tracking-wider ${state.tone}`}>{state.word}</span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-borderSubtle/30">
        <Cell label="Model 1" value={s.p1 != null ? `${(s.p1 * 100).toFixed(1)}%` : 'No model'} />
        <Cell label="Filled" value={paid > 0 ? money(paid) : '—'} />
        <Cell label={o?.status === 'closed' ? 'Exit' : 'Bid'} value={now != null ? money(now) : '—'} />
        <Cell label="Return" value={pct(o?.ret ?? null)} tone={ink(o?.ret ?? null)} />
        <Cell label="Stop" value={lottery ? 'None' : o && o.stop > 0 ? money(o.stop) : '—'} tone={lottery ? 'text-textSecondary' : 'text-warn'} />
        <Cell label="Peak bid" value={o && o.peak > 0 ? money(o.peak) : '—'} />
      </div>
      <div className="px-3.5 py-2 flex items-center gap-3">
        <p className="min-w-0 flex-1 font-mono text-t10 text-textSecondary whitespace-normal">
          Called {nyClock(s.firedAt, { zone: true })} on {s.bid.toFixed(2)} × {s.ask.toFixed(2)}. {state.line}
        </p>
        <SessionSpark ticker={s.ticker} points={s.spark.length ? s.spark : undefined} width={80} height={28} />
      </div>
    </button>
  );
};

/** `embedded`: under the Compass shell, which wears the head */
const Tracker = ({ embedded = false }: { embedded?: boolean } = {}) => {
  void embedded;
  const navigate = useNavigate();
  const { isTracked } = useTracker();
  const record = useSignals();
  const theta = useThetaStatus();
  const today = nyIsoDate();
  const rows = useMemo(() => {
    const live = record.filter(s => !s.outcome || s.outcome.status === 'open' || s.outcome.status === 'waiting');
    const done = record.filter(s => s.day === today && s.outcome && (s.outcome.status === 'closed' || s.outcome.status === 'unavailable'));
    return { live, done };
  }, [record, today]);
  const readAt = rows.live.reduce((m, s) => Math.max(m, s.pathAt), 0);
  const tracked = record.filter(s => isTracked(s.id)).length;
  const sentence = theta === 'down' && rows.live.length
    ? `ThetaData offline — reconnecting. Paths as of ${readAt ? nyClock(readAt, { zone: true }) : 'the call'}.`
    : rows.live.length
      ? `Paths read once a minute from the contract's own quotes${readAt ? `. Last read ${nyClock(readAt, { zone: true })}` : ''}.`
      : false;
  const open = (s: Signal) => navigate(`/compass/${s.id}`, { state: { from: 'Tracker' } });

  return (
    <TraceBox
      title="Tracker"
      sub="The signals in play and today's closes"
      testId="tracker"
      facts={
        <>
          <Fact label="Open" testId="open">{rows.live.filter(s => s.outcome?.status === 'open').length}</Fact>
          <Fact label="Filling" testId="filling">{rows.live.filter(s => !s.outcome || s.outcome.status === 'waiting').length}</Fact>
          <Fact label="Closed today" testId="closed">{rows.done.length}</Fact>
          <Fact label="Tracked" testId="tracked" title="Signals you bookmarked from their page.">{tracked}</Fact>
        </>
      }
      controls={
        <button type="button" onClick={() => navigate('/compass/blotter')} className="slayer-chip uppercase tracking-wider" data-tracker-blotter>
          The blotter
        </button>
      }
      sentence={sentence ? <span data-tracker-line>{sentence}</span> : false}
    >
      {rows.live.length + rows.done.length === 0 ? (
        <div className="border-t border-borderSubtle px-5 py-10 font-mono text-t11 text-textMuted" data-tracker-empty>
          No signal is in play. When Compass fires a Book A, B or C call it shows here with the quote it fired on, its fill and its path, until it closes.
          {record.length > 0 && (
            <button type="button" onClick={() => navigate('/compass/blotter')} className="ml-1 text-textPrimary underline decoration-borderMuted underline-offset-4">
              Every earlier signal is on the blotter.
            </button>
          )}
        </div>
      ) : (
        <div className="border-t border-borderSubtle px-4 sm:px-5 py-4 flex flex-col gap-4">
          {rows.live.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3" data-tracker-open>
              {rows.live.map(s => <SignalCard key={s.key} s={s} tracked={isTracked(s.id)} onOpen={() => open(s)} />)}
            </div>
          )}
          {rows.done.length > 0 && (
            <>
              <p className="font-mono text-t9 uppercase tracking-widest text-textMuted">Closed today</p>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3" data-tracker-done>
                {rows.done.map(s => <SignalCard key={s.key} s={s} tracked={isTracked(s.id)} onOpen={() => open(s)} />)}
              </div>
            </>
          )}
        </div>
      )}
    </TraceBox>
  );
};

export default Tracker;
