/* Which way each name's money leans: the vendor's most bullish and most bearish names on the left, the picked name's
   session on the pane at the right, and the market tide's own net in the head. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useTicker } from '../../context/MarketDataContext';
import { fmtCount as num, nyDateOf, tapeSessionIso, tideBetween, useTickerKnown, useTopNet, useTide, usd as fmtUsd } from '../../data/traceLive';
import { boardSums, VENDOR_TOTAL_NOTE } from '../../data/flowBook';
import { dayAdv, dayPos, isLiveDay, shortDay } from '../../components/trace/dayWords';
import { useTraceSession } from '../../components/trace/traceSession';
import { useQParam } from '../../components/trace/addressCut';
import { nyClock } from '../../core/nyTime';
import { FeedFallback, TickFigure } from '../../components/ui/liveRead';
import { type MoneynessKey } from '../../data/flowBook';
import Lean from '../../components/trace/Lean';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import NetFlowPane from '../../components/trace/NetFlowPane';
import { directionInk, earnMarks } from '../../components/trace/earnedInk';
import FlowSearch from '../../components/trace/FlowSearch';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import ReadDoor from '../../components/trace/ReadDoor';
import TraceBox, { Champion, Fact } from '../../components/trace/TraceBox';
import { NetFlowGuide } from '../../components/trace/TraceGuide';

/* signed on purpose: a champion's figure keeps its sign */
const signed = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;

/** What another page may hand this one */
interface NetFlowHandoff {
  ticker?: string | null;
}

const NetFlow = () => {
  const { activeTicker } = useTicker();
  /* arriving through a door: the name goes on the pane before the first paint */
  const handoff = (useLocation().state ?? null) as NetFlowHandoff | null;
  /* the name in the address (?q=) */
  const [qParam, setQParam] = useQParam();
  const [picked, setPicked] = useState<string | null>(() => (typeof handoff?.ticker === 'string' && /^[A-Z0-9.]{1,6}$/.test(handoff.ticker) ? handoff.ticker : null));
  /* a typed or linked ticker waits here until the vendor says it exists */
  const [want, setWant] = useState<string | null>(() => (!picked && /^[A-Z][A-Z0-9.]{0,5}$/.test(qParam) ? qParam : null));
  const wantKnown = useTickerKnown(want);
  useEffect(() => {
    if (want && wantKnown === true) {
      setPicked(want);
      setWant(null);
    }
  }, [want, wantKnown]);
  /* the field holds what is typed; the pane keeps the last real name meanwhile */
  const [query, setQuery] = useState<string>(picked ?? want ?? '');
  const [mny, setMny] = useState<MoneynessKey>('all');
  const [guideOpen, setGuideOpen] = useState(false);

  const top = useTopNet(40);
  /* the market's own net is the tide (every name), not the board's two ends summed */
  const tide = useTide('market', '');
  /* not yet is not nothing: the facts read "—" and the pane waits for the board's first name */
  const boardReading = top.waiting && top.rows.length === 0;
  const boardFault = top.fault;
  const hold = useHold(top.rows, activeTicker, !boardReading);
  /* the vendor's ranking carries a name and its net premium only */
  const leaders = useMemo(() => hold.value.map(r => ({ ticker: r.ticker, net: r.net })), [hold.value]);
  /* the search suggests the board's names */
  const searchRows = useMemo(() => leaders.map(l => ({ ticker: l.ticker, strike: 0, right: 'C' as const, premium: Math.abs(l.net) })), [leaders]);
  /* the names a search may put on the pane: the book's */
  const known = useMemo(() => new Set(leaders.map(r => r.ticker)), [leaders]);
  /* a board name goes on the pane at once; any other well-formed ticker once the typing settles and the vendor knows it */
  const typeTimer = useRef(0);
  const onQuery = (v: string) => {
    setQuery(v);
    setQParam(v);
    window.clearTimeout(typeTimer.current);
    setWant(null);
    if (!v) setPicked(null);
    else if (known.has(v)) setPicked(v);
    else if (/^[A-Z][A-Z0-9.]{0,5}$/.test(v)) typeTimer.current = window.setTimeout(() => setWant(v), 450);
  };
  useEffect(() => () => window.clearTimeout(typeTimer.current), []);
  const unknown = query !== '' && !/^[A-Z][A-Z0-9.]{0,5}$/.test(query);

  const sel = picked ?? leaders[0]?.ticker ?? (boardReading ? null : 'SPY');
  const maxAbs = useMemo(() => Math.max(...leaders.map(l => Math.abs(l.net)), 1), [leaders]);
  const netMarks = useMemo(() => earnMarks(leaders, l => l.net), [leaders]);

  const facts = useMemo(() => {
    /* the board's gross lean: every row prints its share of it */
    const { calls, puts, gross, bullish, bearish, neutral } = boardSums(leaders);
    const top = leaders[0] ?? null;
    const bottom = leaders.length ? leaders[leaders.length - 1] : null;
    const topIsChamp = !!top && !!bottom && Math.abs(top.net) >= Math.abs(bottom.net);
    /* a name at exactly zero net is neither end: counted apart, never as bearish */
    return { calls, puts, gross, bullish, bearish, neutral, top, bottom, topIsChamp };
  }, [leaders]);

  /* Regular: the tide's running figure at the last regular minute less its figure before the bell. Extended: the tide's
     minutes before 09:30 plus those from the 16:15 close, nothing between. */
  const session = useTraceSession();
  const market = useMemo(() => {
    if (session === 'regular') {
      const w = tideBetween(tide.rows, 570, 975);
      return w ? { net: w.net, calls: w.calls, puts: w.puts, at: nyClock(w.last * 1000), from: nyClock(w.first * 1000), none: false, span: `${nyClock(w.first * 1000)}–${nyClock(w.last * 1000)}`, day: nyDateOf(w.last * 1000) } : null;
    }
    const pre = tideBetween(tide.rows, 0, 570);
    const post = tideBetween(tide.rows, 975, 24 * 60);
    if (!pre && !post) return { net: 0, calls: 0, puts: 0, at: '', from: null, none: true, span: '', day: null as string | null };
    const calls = (pre?.calls ?? 0) + (post?.calls ?? 0);
    const puts = (pre?.puts ?? 0) + (post?.puts ?? 0);
    const span = [pre ? `${nyClock(pre.first * 1000)}–${nyClock(pre.last * 1000)}` : null, post ? `${nyClock(post.first * 1000)}–${nyClock(post.last * 1000)}` : null].filter(Boolean).join(' + ');
    return { net: calls - puts, calls, puts, at: (post ?? pre)!.last ? nyClock((post ?? pre)!.last * 1000) : '', from: pre ? nyClock(pre.first * 1000) : post ? nyClock(post.first * 1000) : null, none: false, span, day: nyDateOf((post ?? pre)!.last * 1000) as string | null };
  }, [tide.rows, session]);
  const read = useMemo<ReactNode>(() => {
    if (boardReading) return <RichRead text="Reading the board and the market tide…" />;
    if (!facts.top || !facts.bottom) return <RichRead text={boardFault ? 'The board did not answer — it fills when the feed does.' : 'The book is still waking up.'} />;
    const { top, bottom, topIsChamp } = facts;
    const crown = (v: number, champ: boolean) => (champ ? <span className="font-semibold tnum text-supreme">{signed(v)}</span> : <Lean v={v} />);
    return (
      <>
        {market && market.none && <RichRead text={`The market tide holds no minutes outside the regular session${isLiveDay(tapeSessionIso()) ? '' : ` on ${shortDay(tapeSessionIso())}`} — nothing before 09:30 or after the 16:15 close to add up. `} />}
        {/* every window dated; extended-hours money is shown in plain ink, never read as a lean */}
        {market && !market.none && session === 'regular' && (
          <>
            <RichRead text={`The whole market's money ${market.day && !isLiveDay(market.day) ? `on ${shortDay(market.day)} ` : 'today '}leans ${market.net >= 0 ? 'bullish' : 'bearish'} — `} />
            <Lean v={market.net} /> net from {market.from} to {market.at} ET (net calls <Lean v={market.calls} /> less net puts <Lean v={market.puts} put />).{' '}
          </>
        )}
        {market && !market.none && session !== 'regular' && (
          <>
            {`Outside the regular session${market.day ? ` (${isLiveDay(market.day) ? 'today' : shortDay(market.day)}, ${market.span} ET)` : ''}, the whole market netted `}
            <span className="font-semibold tnum text-textPrimary">{signed(market.net)}</span> (net calls <span className="tnum text-textPrimary">{signed(market.calls)}</span> less net puts <span className="tnum text-textPrimary">{signed(market.puts)}</span>) — extended-hours money trades against thin quotes and is shown, not read.{' '}
          </>
        )}
        <RichRead text={`On the board — the ${facts.bullish} most bullish and ${facts.bearish} most bearish names${facts.neutral ? ` (and ${facts.neutral} at zero)` : ''} ${dayAdv()}, summed totals with spread legs and floor packages in them — `} />
        the bullish names sum to <Lean v={facts.calls} /> and the bearish to <Lean v={facts.puts} />.{' '}
        <ReadDoor onOpen={() => onQuery(top.ticker)} title={`Put ${top.ticker} on the pane`}>
          {top.ticker}
        </ReadDoor>
        <RichRead text=" leads bullish at " />
        {crown(top.net, topIsChamp)};{' '}
        <ReadDoor onOpen={() => onQuery(bottom.ticker)} title={`Put ${bottom.ticker} on the pane`}>
          {bottom.ticker}
        </ReadDoor>
        <RichRead text=" leans hardest bearish at " />
        {crown(bottom.net, !topIsChamp)}.
      </>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facts, leaders.length, market, boardReading, boardFault]);

  const leadLine = boardReading
    ? "Reading the board and the market's net…"
    : !facts.top || !facts.bottom
      ? boardFault
        ? 'The board did not answer — it fills when the feed does.'
        : 'The board is still waking up.'
      : `${market && !market.none && session === 'regular' ? `The whole market ${market.day && !isLiveDay(market.day) ? `on ${shortDay(market.day)}` : 'today'} leans ${market.net >= 0 ? 'bullish' : 'bearish'} (${signed(market.net)} net). ` : ''}${facts.top.ticker} leads bullish at ${signed(facts.top.net)}; ${facts.bottom.ticker} leans most bearish at ${signed(facts.bottom.net)}.`;
  /* the search picks a name (a board, not a filter); the board scrolls the picked row into view */
  const boardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!picked) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-ticker="${picked}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [picked]);

  const champ = facts.topIsChamp ? facts.top : facts.bottom;

  return (
    <TraceBox
      title="Which way the money leans"
      sub={`The most bullish and bearish names by ${dayPos()} net premium · click one to put its session on the pane`}
      testId="net-flow"
      className="md:flex-1 md:min-h-0"
      data={{ picked: sel, names: leaders.length }}
      foldOnPhone
      guide={{ title: 'How to read the board', door: 'What the board, the lines and the floor mean', body: <NetFlowGuide />, testId: 'net-flow-guide', open: guideOpen, onOpen: setGuideOpen }}
      facts={
        <>
          <Fact label="Market net" testId="net" title={session === 'regular' ? "The market tide: every name's net call less net put premium, 09:30–16:15 ET. Spread legs and floor packages are in it" : "The market tide outside the session only: before 09:30 and after 16:15 ET. Spread legs and floor packages are in it"}>
            {market && market.none ? (
              <span className="text-textMuted">none outside the session</span>
            ) : market ? (
              <>
                {session === 'regular' ? <Lean v={market.net} /> : <span className="tnum text-textPrimary">{signed(market.net)}</span>} <span className="text-textSecondary">· {market.day && !isLiveDay(market.day) ? `${shortDay(market.day)} ` : ''}{market.span} ET</span>
              </>
            ) : (
              <span className="text-textMuted">{tide.waiting ? '…' : '—'}</span>
            )}
          </Fact>
          <Fact label="Board ends, summed" testId="sides" title="The bullish names' net summed, then the bearish names'. Two ends of the ranking, not the market">
            {/* the bearish sum is names' net premium below zero, so it wears bearish ink */}
            {leaders.length === 0 ? <span className="text-textMuted">—</span> : <><Lean v={facts.calls} className="font-normal" /> <span className="text-textSecondary">·</span> <Lean v={facts.puts} className="font-normal" /></>}
          </Fact>
          <Fact label="Names" testId="names">
            {leaders.length === 0 ? <span className="text-textMuted">—</span> : <>{num(leaders.length)} <span className="text-textSecondary">·</span> <span className="text-bull">{facts.bullish} bullish</span> <span className="text-textSecondary">·</span> <span className="text-bear">{facts.bearish} bearish</span>{facts.neutral > 0 && <> <span className="text-textSecondary">·</span> <span className="text-textSecondary" title="Names whose net premium is exactly zero — neither end">{facts.neutral} neutral</span></>}</>}
          </Fact>
          {/* the two ends of the board, each named for what it is; the larger of the two wears the magenta */}
          {facts.top && facts.top.net > 0 && (
            <Champion label="Most bullish" ink={champ === facts.top ? 'supreme' : 'bull'} title={`Put it on the pane. ${dayPos()} whole-day net premium, pre-market in`} onOpen={() => onQuery(facts.top!.ticker)} testId="bullish">
              {facts.top.ticker} · {signed(facts.top.net)} <span className="text-textSecondary">· whole day</span>
            </Champion>
          )}
          {facts.bottom && facts.bottom.net < 0 && (
            <Champion label="Most bearish" ink={champ === facts.bottom ? 'supreme' : 'bear'} title={`Put it on the pane. ${dayPos()} whole-day net premium, pre-market in`} onOpen={() => onQuery(facts.bottom!.ticker)} testId="bearish">
              {facts.bottom.ticker} · {signed(facts.bottom.net)} <span className="text-textSecondary">· whole day</span>
            </Champion>
          )}
        </>
      }
      controls={
        <>
          <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
          <SessionMark at={top.at} fault={top.fault} paused={hold.paused} ttlMs={45_000} kept={top.kept} />
          <span className="inline-flex items-center gap-2 flex-wrap" data-span>
            <FlowSearch value={query} onChange={onQuery} rows={searchRows} countNoun="names" tickersOnly />
            {(unknown || (want && wantKnown === false)) && (
              <span role="status" className="text-t11 text-textSecondary" data-net-unknown>
                No ticker “{unknown ? query : want}”{sel ? ` — the pane keeps ${sel}` : ''}
              </span>
            )}
            {want && wantKnown == null && (
              <span role="status" className="text-t11 text-textMuted" data-net-checking>
                Looking up {want}…
              </span>
            )}
          </span>
        </>
      }
      sentence={null}
      lead={leadLine}
      detail={read}
    >
      {/* on a phone the board stands over the pane */}
      <div className="flex max-md:flex-col md:flex-1 md:min-h-0 border-t border-borderSubtle">
        <div ref={boardRef} className="md:w-[304px] shrink-0 md:border-r max-md:border-b max-md:max-h-[306px] border-borderSubtle overflow-y-auto" data-net-board>
          {leaders.length > 0 && (
            <div className="sticky top-0 z-10 bg-panel flex items-center gap-2 px-3 py-1.5 border-b border-borderSubtle font-mono text-t11 uppercase tracking-wider text-textMuted" data-net-board-head>
              <span className="w-5">#</span>
              <span className="flex-1">Name · share of lean</span>
              <span title={`Each name's whole day, pre-market in. The pane reads 09:30 on, so its figure can differ. ${VENDOR_TOTAL_NOTE}`}>Day net</span>
            </div>
          )}
          {leaders.length === 0 && (
            <p className="px-4 py-6 font-mono text-t11 uppercase tracking-widest text-textMuted" data-net-board-empty>
              {boardReading ? 'Reading the board…' : top.fault ? 'This read did not land' : `No name has leaned yet ${dayAdv()}`}
            </p>
          )}
          {leaders.map((l, i) => {
            const isSel = l.ticker === sel;
            return (
              <button
                key={l.ticker}
                type="button"
                data-ticker={l.ticker}
                onClick={() => onQuery(l.ticker)}
                aria-pressed={isSel}
                className={`w-full flex flex-col gap-1 px-3 py-2 border-b border-borderSubtle/60 text-left transition-colors ${isSel ? 'bg-silver/[0.06] shadow-[inset_2px_0_0_0_rgb(var(--silver)/0.7)]' : 'hover:bg-silver/[0.04]'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-t11 text-textPrimary tnum w-5">{String(i + 1).padStart(2, '0')}</span>
                  <CompanyLogo ticker={l.ticker} size={15} />
                  <span className="font-mono text-t11 font-bold text-textPrimary">{l.ticker}</span>
                  <span className="font-mono text-t11 tnum text-textSecondary cursor-help" title={`${l.ticker}'s net (${signed(l.net)}) against every board name's net, signs dropped (${fmtUsd(facts.gross)})`}>
                    {Math.round((Math.abs(l.net) / facts.gross) * 100)}%
                  </span>
                  <span className={`ml-auto font-mono text-t11 tabular-nums ${directionInk(l.net, netMarks)}`}><TickFigure value={l.net}>{fmtUsd(l.net)}</TickFigure></span>
                </span>
                <span className="flex items-center gap-2 pl-7">
                  <span className="relative h-0.5 flex-1 rounded-full bg-ink/[0.06] overflow-hidden">
                    <span className={`absolute left-0 top-0 h-full ${l.net >= 0 ? 'bg-bull/60' : 'bg-bear/60'}`} style={{ width: `${Math.round((Math.abs(l.net) / maxAbs) * 100)}%` }} />
                  </span>
                  <span className="font-mono text-t11 text-textMuted whitespace-nowrap">{l.net >= 0 ? 'net bullish' : 'net bearish'}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex-1 min-w-0 p-2 max-md:h-[460px] max-md:flex-none">
          {sel == null ? (
            <p className="px-4 py-6 font-mono text-t11 uppercase tracking-widest text-textMuted" data-net-pane-waiting>
              Reading the board — the pane opens on its first name
            </p>
          ) : (
            <NetFlowPane seg="all" mny={mny} onSeg={() => {}} onMny={setMny} ticker={sel} dteMax={Infinity} />
          )}
          {top.fault && leaders.length === 0 ? <FeedFallback fault={top.fault} /> : null}
        </div>
      </div>
    </TraceBox>
  );
};

export default NetFlow;
