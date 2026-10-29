/* The signals in play: every Compass call still open, and today's that closed, from the server's official record,
   each with the quote it fired on, its fill a minute later, and its path since then off the contract's one-minute
   NBBO from ThetaData. A contract you track is marked; nothing here is priced from a model or another feed. */

import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { useTracker } from '../context/TrackerContext';
import { nyClock, nyIsoDate } from '../core/nyTime';
import { activeStop, useSignals, type Signal } from '../data/compassLedger';
import { daySummary, optionFees } from '../data/compassOutcome';
import { backlogLine, holdCompassFeed, useCompassFeed } from '../data/compassFeed';
import { EmptyBox, ErrorBox, asOfText } from '../components/ui/states';
import { useThetaStatus } from '../data/thetaQuote';
import TraceBox, { Fact } from '../components/trace/TraceBox';
import ContractLabel from '../components/ui/ContractLabel';
import SessionSpark from '../components/compass/SessionSpark';
import { usd2 as money } from '../core/format';

const pct = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);
const ink = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? 'text-textPrimary' : v > 0 ? 'text-bull' : 'text-bear');

const Cell = ({ label, value, tone = 'text-textPrimary', note }: { label: string; value: string; tone?: string; note?: string }) => (
  <div className="bg-panel px-3 py-2.5 min-w-0">
    <div className="font-mono text-t9 uppercase tracking-widest text-textMuted">{label}</div>
    <div className={`mt-0.5 font-mono text-t13 font-semibold tnum truncate ${tone}`}>{value}</div>
    {note ? <div className="font-mono text-t10 text-textMuted tnum truncate">{note}</div> : null}
  </div>
);
const dollars = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v < 0 ? '−' : '+'}$${Math.abs(v).toFixed(2)}`);

function stateOf(s: Signal): { word: string; tone: string; line: string } {
  const o = s.outcome;
  if (!o || o.status === 'waiting') return { word: 'Filling', tone: 'text-textSecondary', line: 'Fills at the ask of the first quote a full minute after the call.' };
  if (o.status === 'unavailable') return { word: 'Unavailable', tone: 'text-textMuted', line: 'No valid quote stood a minute after the call. No price was substituted.' };
  if (o.status === 'closed' && o.exit && o.fill) {
    const win = o.pnl != null && o.pnl > 0;
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
  const runner = s.book === 'B' || s.runner;
  const closed = o?.status === 'closed';
  /* per contract after the round trip: the exit's, or the last bid's while it is open */
  const pnl = closed ? o?.pnl ?? null : paid > 0 && o?.last ? (o.last.bid - paid) * 100 - optionFees(o.last.bid) : null;
  const standing = paid > 0 && o && !lottery ? activeStop(paid, o.peak, runner) : null;
  const target = paid > 0 ? (lottery ? paid * 2 : runner ? 0 : paid * 1.5) : 0;
  const away = (px: number) => (now != null && now > 0 && px > 0 && !closed ? `${px >= now ? '+' : '−'}${Math.abs((px / now - 1) * 100).toFixed(0)}% from the bid` : undefined);
  return (
    <button type="button" onClick={onOpen} className="text-left border border-borderSubtle bg-panel rounded-md overflow-hidden flex flex-col hover:border-borderMuted transition-colors" data-tracker-signal={s.key}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-borderSubtle">
        <ContractLabel contract={s.contract} right={s.right} logo={s.ticker} size="sm" />
        <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">Book {s.book}</span>
        {tracked && <Bookmark className="w-3.5 h-3.5 text-textSecondary" aria-label="Tracked" />}
        <span className={`ml-auto font-mono text-t10 uppercase tracking-wider ${state.tone}`}>{state.word}</span>
      </div>
      <div className="grid grid-cols-4 gap-px bg-borderSubtle/30">
        <Cell label="Model 1" value={s.p1 != null ? `${(s.p1 * 100).toFixed(1)}%` : 'No model'} />
        <Cell label="At call" value={`${s.bid.toFixed(2)}×${s.ask.toFixed(2)}`} />
        <Cell label="Filled" value={paid > 0 ? money(paid) : '—'} />
        <Cell label={closed ? 'Exit' : 'Bid'} value={now != null ? money(now) : '—'} />
        <Cell label="P&L" value={dollars(pnl)} tone={ink(pnl)} note={pct(o?.ret ?? null)} />
        <Cell label={standing?.name ?? 'Stop'} value={lottery ? 'None' : standing ? money(standing.stop) : '—'} tone={lottery ? 'text-textSecondary' : 'text-warn'} note={standing ? away(standing.stop) : undefined} />
        <Cell label="Target" value={target > 0 ? money(target) : runner && !lottery ? 'Ratchet' : '—'} note={target > 0 ? away(target) : undefined} />
        <Cell label="Peak bid" value={o && o.peak > 0 ? money(o.peak) : '—'} />
      </div>
      <div className="px-3.5 py-2 flex items-center gap-3">
        <p className="min-w-0 flex-1 font-mono text-t10 text-textSecondary whitespace-normal">
          {s.how === 'late' ? `Scored late from recorded quotes (${nyClock(s.mark ?? s.firedAt)} ET mark)` : `Called ${nyClock(s.firedAt, { zone: true })}`} on {s.bid.toFixed(2)} × {s.ask.toFixed(2)}. {state.line}
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
  useEffect(() => holdCompassFeed(), []);
  const record = useSignals();
  const feed = useCompassFeed();
  const theta = useThetaStatus();
  const today = nyIsoDate();
  const day = useMemo(() => daySummary(record.filter(s => s.day === today)), [record, today]);
  const rows = useMemo(() => {
    const live = record.filter(s => !s.outcome || s.outcome.status === 'open' || s.outcome.status === 'waiting');
    const done = record.filter(s => s.day === today && s.outcome && (s.outcome.status === 'closed' || s.outcome.status === 'unavailable'));
    return { live, done };
  }, [record, today]);
  const readAt = rows.live.reduce((m, s) => Math.max(m, s.pathAt), 0);
  const tracked = record.filter(s => isTracked(s.id)).length;
  const sentence = feed.status === 'offline'
    ? `Compass server offline. ${feed.error || 'Reconnecting.'}`
    : feed.status === 'kept' && feed.at
      ? `The record ${asOfText(feed.at)}. ${feed.error || 'Reconnecting to the Compass server.'}`
      : theta === 'down' && rows.live.length
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
          <Fact label="Calls today" testId="calls">{day.calls}</Fact>
          <Fact label="Won · lost · open" testId="open" title="Today's calls: closed with a gain after fees, closed at or under the fill, and still held.">
            <span className="text-bull">{day.won}</span> · <span className="text-bear">{day.lost}</span> · {day.open}
          </Fact>
          <Fact label="Net today" testId="net" title="Per contract: today's closed calls after an estimated $1.08 round trip plus the SEC fee.">{day.won + day.lost ? <span className={ink(day.net)}>{dollars(day.net)}</span> : '—'}</Fact>
          <Fact label="Open at bid" testId="open-mark" title="Today's open calls marked at their last bid, after the same round-trip cost.">{day.open ? <span className={ink(day.openMark)}>{dollars(day.openMark)}</span> : '—'}</Fact>
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
        <div className="border-t border-borderSubtle" data-tracker-empty>
          {feed.status === 'offline' && !record.length ? (
            <ErrorBox what="The record did not load" detail={feed.error || 'The Compass server did not answer.'} />
          ) : (
          <EmptyBox
            title="Nothing in play"
            reason={backlogLine(feed.marks) || 'When the scan fires a Book A, B or C call it shows here with the quote it fired on, its fill and its path, until it closes.'}
            action={record.length > 0 ? (
              <button type="button" onClick={() => navigate('/compass/blotter')} className="slayer-chip uppercase tracking-wider tap-40">
                Every earlier call is on the blotter
              </button>
            ) : undefined}
          />
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
