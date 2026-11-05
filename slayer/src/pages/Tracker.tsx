/* The signals in play: every Compass call still open, and today's that closed, from the server's official record,
   each with the quote it fired on, its fill a minute later, and its path since then off the contract's one-minute
   NBBO from ThetaData. A contract you track is marked; nothing here is priced from a model or another feed. */

import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bookmark } from 'lucide-react';
import { useTracker } from '../context/TrackerContext';
import type { TrackedSetup } from '../types/tracker';
import { nyClock, nyIsoDate } from '../core/nyTime';
import { activeStop, useSignals, type Signal } from '../data/compassLedger';
import { daySummary } from '../data/compassOutcome';
import { backlogLine, holdCompassFeed, useCompassFeed } from '../data/compassFeed';
import { EmptyBox, ErrorBox, asOfText } from '../components/ui/states';
import { useThetaStatus } from '../data/thetaQuote';
import TraceBox, { Fact } from '../components/trace/traceFrame';
import ContractLabel from '../components/ui/ContractLabel';
import SessionSpark from '../components/compass/SessionSpark';
import { usd2 as money } from '../core/format';
import { RIDING_WORD, modelOfBook, takeProfitPx, targetPx } from '../data/compassParams';
import { useContractLive } from '../data/thetaBook';
import { chainRoot } from '../../shared/optionChain.mjs';

const pct = (v: number | null) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`);
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
  const tail = s.book === 'R';
  const live = useContractLive(chainRoot(s.ticker), s.expiry, s.strike, s.right, tail && o?.status !== 'closed');
  const liveBid = live && live.bid > 0 && Date.now() - live.heard < 15_000 ? live.bid : null;
  const now = o?.exit?.px ?? (tail ? liveBid : null) ?? o?.last?.bid ?? null;
  const state = stateOf(s);
  const lottery = s.book === 'C';
  const runner = s.book === 'B' || s.runner;
  const closed = o?.status === 'closed';
  const pnl = closed ? o?.pnl ?? null : paid > 0 && now != null ? (now - paid) * 100 : null;
  const ret = closed ? o?.ret ?? null : paid > 0 && now != null ? ((now - paid) / paid) * 100 : o?.ret ?? null;
  const standing = paid > 0 && o && !lottery && !tail ? activeStop(paid, o.peak, runner) : null;
  const target = tail ? 0 : paid > 0 ? (lottery ? targetPx(paid, 2) : runner ? 0 : takeProfitPx(paid)) : 0;
  const away = (px: number) => (now != null && now > 0 && px > 0 && !closed ? `${px >= now ? '+' : '−'}${Math.abs((px / now - 1) * 100).toFixed(0)}% from the bid` : undefined);
  const hold = tail ? 'Back through, or 30m' : lottery ? '3× or 2×' : s.book === 'A' && s.runner ? 'Model 2 rides' : runner ? 'Ratchet' : 'Out at 1.50×';
  return (
    <button type="button" onClick={onOpen} className="text-left border border-borderSubtle bg-panel rounded-md overflow-hidden flex flex-col hover:border-borderMuted transition-colors" data-tracker-signal={s.key}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-borderSubtle">
        <ContractLabel contract={s.contract} right={s.right} logo={s.ticker} size="sm" />
        <span className="font-mono text-t10 font-bold uppercase tracking-wider text-textPrimary border border-silver/50 rounded px-1.5 py-0.5" data-tracker-model>{modelOfBook(s.book)}</span>
        {s.book === 'A' && s.runner && <span className="font-mono text-t10 font-bold uppercase tracking-wider text-onfoil holo-bg rounded px-1.5 py-0.5">{RIDING_WORD}</span>}
        {s.how === 'late' && <span className="font-mono text-t10 text-warn border border-warn/40 rounded px-1.5 py-0.5" title="Scored after its mark from the recorded quotes at the mark">Late</span>}
        {tracked && <Bookmark className="w-3.5 h-3.5 text-textSecondary" aria-label="Tracked" />}
        <span className={`ml-auto font-mono text-t10 uppercase tracking-wider ${state.tone}`}>{state.word}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-borderSubtle/30">
        <Cell label="Hold" value={hold} />
        <Cell label="At call" value={`${s.bid.toFixed(2)}×${s.ask.toFixed(2)}`} />
        <Cell label="Filled" value={paid > 0 ? money(paid) : '—'} />
        <Cell label={closed ? 'Exit' : 'Bid'} value={now != null ? money(now) : '—'} />
        <Cell label="P&L" value={pct(ret)} tone={ink(ret)} note={dollars(pnl)} />
        <Cell label={standing?.name ?? 'Stop'} value={tail ? 'The line' : lottery ? 'None' : standing ? money(standing.stop) : '—'} tone={lottery || tail ? 'text-textSecondary' : 'text-warn'} note={standing ? away(standing.stop) : undefined} />
        <Cell label="Target" value={target > 0 ? money(target) : runner && !lottery && !tail ? 'Ratchet' : '—'} note={target > 0 ? away(target) : undefined} />
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

const TrackedCard = ({ t, onOpen }: { t: TrackedSetup; onOpen: () => void }) => {
  const quoted = t.signalAsk != null && t.signalAsk > 0 && t.signalBid != null && t.signalBid >= 0 && t.signalAsk >= t.signalBid;
  return (
    <button type="button" onClick={onOpen} className="text-left border border-borderSubtle bg-panel rounded-md overflow-hidden flex flex-col hover:border-borderMuted transition-colors" data-tracker-tracked={t.id}>
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-borderSubtle">
        <ContractLabel contract={t.contract} right={t.right} logo={t.ticker} size="sm" />
        <span className="font-mono text-t10 text-textSecondary border border-borderSubtle rounded px-1.5 py-0.5">Tracked</span>
        <Bookmark className="w-3.5 h-3.5 text-textSecondary" aria-label="Tracked" />
        <span className="ml-auto font-mono text-t10 uppercase tracking-wider text-textSecondary">Not a call</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-borderSubtle/30">
        <Cell label="Quote" value={quoted ? `${(t.signalBid as number).toFixed(2)}×${(t.signalAsk as number).toFixed(2)}` : '—'} />
        <Cell label="Ask" value={t.askAtTrack != null && t.askAtTrack > 0 ? money(t.askAtTrack) : '—'} />
        <Cell label="Stop" value={t.stopAtTrack != null && t.stopAtTrack > 0 ? money(t.stopAtTrack) : '—'} tone="text-warn" />
        <Cell label="Saved" value={nyClock(t.trackedAt, { zone: true })} />
      </div>
      <div className="px-3.5 py-2">
        <p className="font-mono text-t10 text-textSecondary whitespace-normal">Saved from its page. Not a Compass call.</p>
      </div>
    </button>
  );
};

/** `embedded`: under the Compass shell, which wears the head */
const Tracker = ({ embedded = false }: { embedded?: boolean } = {}) => {
  void embedded;
  const navigate = useNavigate();
  const { isTracked, trackedSetups } = useTracker();
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
  const bookmarks = useMemo(
    () => trackedSetups.filter(t => !record.some(s => s.id === t.id)),
    [trackedSetups, record],
  );
  const kept = useMemo(() => {
    const shown = new Set([...rows.live, ...rows.done].map(s => s.id));
    const out: Signal[] = [];
    for (const t of trackedSetups) {
      if (shown.has(t.id)) continue;
      const mine = record.filter(s => s.id === t.id).sort((a, b) => b.firedAt - a.firedAt);
      if (mine[0]) out.push(mine[0]);
    }
    return out;
  }, [trackedSetups, record, rows]);
  const readAt = rows.live.reduce((m, s) => Math.max(m, s.pathAt), 0);
  const tracked = record.filter(s => isTracked(s.id)).length;
  const sentence = feed.status === 'offline'
    ? `Compass server offline. ${feed.error || 'Reconnecting.'}`
    : feed.status === 'kept' && feed.at
      ? `The record ${asOfText(feed.at)}. ${feed.error || 'Reconnecting to the Compass server.'}`
      : theta === 'down' && rows.live.length
    ? `Live data offline — reconnecting. Paths as of ${readAt ? nyClock(readAt, { zone: true }) : 'the call'}.`
    : rows.live.length
      ? `Returns live on each contract's bid. Paths read once a minute from the contract's own quotes${readAt ? `. Last read ${nyClock(readAt, { zone: true })}` : ''}.`
      : false;
  const open = (s: Signal) => navigate(`/compass/${s.id}?day=${s.day}`, { state: { from: 'Tracker' } });
  const openTracked = (t: TrackedSetup) => navigate(`/compass/${t.id}`, { state: { from: 'Tracker' } });

  return (
    <TraceBox
      title="Tracker"
      sub="The signals in play and today's closes"
      testId="tracker"
      facts={
        <>
          <Fact label="Calls today" testId="calls">{day.calls}</Fact>
          <Fact label="Won · lost · open" testId="open" title="Today's calls: closed with a gain, closed at or under the fill, and still held.">
            <span className="text-bull">{day.won}</span> · <span className="text-bear">{day.lost}</span> · {day.open}
          </Fact>
          <Fact label="Net today" testId="net" title="Per contract: today's closed calls, (exit − fill) × 100.">{day.won + day.lost ? <span className={ink(day.net)}>{dollars(day.net)}</span> : '—'}</Fact>
          <Fact label="Open at bid" testId="open-mark" title="Today's open calls marked at their last bid, (bid − fill) × 100. No fees.">{day.open ? <span className={ink(day.openMark)}>{dollars(day.openMark)}</span> : '—'}</Fact>
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
      {rows.live.length + rows.done.length + bookmarks.length + kept.length === 0 ? (
        <div className="border-t border-borderSubtle" data-tracker-empty>
          {feed.status === 'offline' && !record.length ? (
            <ErrorBox what="The record did not load" detail={feed.error || 'The Compass server did not answer.'} />
          ) : (
          <EmptyBox
            title="Nothing in play"
            reason={backlogLine(feed.marks) || 'When the scan fires a call it shows here with the quote it fired on, its fill and its path, until it closes.'}
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
          {bookmarks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3" data-tracker-tracked>
              {bookmarks.map(t => <TrackedCard key={t.id} t={t} onOpen={() => openTracked(t)} />)}
            </div>
          )}
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
          {kept.length > 0 && (
            <>
              <p className="font-mono text-t9 uppercase tracking-widest text-textMuted">Kept from earlier sessions</p>
              <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3" data-tracker-kept>
                {kept.map(s => <SignalCard key={s.key} s={s} tracked onOpen={() => open(s)} />)}
              </div>
            </>
          )}
        </div>
      )}
    </TraceBox>
  );
};

export default Tracker;
