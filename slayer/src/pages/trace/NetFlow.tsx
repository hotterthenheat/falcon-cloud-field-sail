/*
==================================================
  SLAYER TERMINAL - NET FLOW (Trace)
  Which way is each name's money leaning (Noah,
  2026-08-30; walked into the house grammar
  2026-09-09): one box — the head with the board's
  facts and its loudest names as champions, the
  live hold, a names-only search and the expiry
  card on the cards line, the sentence — and the
  body: THE BOARD on the left, every name ranked
  most bullish to most bearish by net premium, and
  THE PANE on the right, the picked name through
  the session (its own candles as the spot line,
  net call and put lines, cut by moneyness and by
  tenor). Board and chart come from the same series
  generator, so they can never disagree.

  THE PARTNER'S PAGE (Noah, 2026-10-13: "my netflow
  doesnt look like his, change it. he has a ticker
  search exp and other things"): a ticker search in
  place of the scope chip — the field holds what is
  typed, the pane takes a name only when the book
  carries it and keeps the last real one meanwhile;
  an Expiry card that cuts the board and the pane to
  one date and keeps the name on the pane while it
  does; the sentence and the facts say the net as
  net calls LESS net puts, each figure in its
  meaning's ink; a Busiest name champion; every
  row's share of the board's whole lean and its
  contract count.
==================================================
*/

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useMarketData } from '../../context/MarketDataContext';
import { useTopNet, useLiveBook, useTide } from '../../data/traceLive';
import { nyClock } from '../../core/nyTime';
import { FLOW_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { type MoneynessKey } from '../../data/flowBook';
import { usd as fmtUsd } from '../../data/traceLive';
import Lean from '../../components/trace/Lean';
import type { SleeveKey } from '../../types/compass';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import NetFlowPane, { paneTimes } from '../../components/trace/NetFlowPane';
import { directionInk, earnMarks } from '../../components/trace/earnedInk';
import FlowSearch from '../../components/trace/FlowSearch';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ReadDoor from '../../components/trace/ReadDoor';
import TraceBox, { Champion, Fact } from '../../components/trace/TraceBox';
import { NetFlowGuide } from '../../components/trace/TraceGuide';

const num = (v: number) => v.toLocaleString('en-US');
// Signed on purpose — a champion's figure keeps its sign (2026-08-30).
const signed = (v: number) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`;

/** What another page may hand this one (the 0DTE desk's door, 2026-09-03). */
interface NetFlowHandoff {
  ticker?: string | null;
  tenor?: SleeveKey | 'all';
}
const TENORS = new Set<string>(['all', 'odte', 'weekly', 'swing', 'leaps']);

const NetFlow = () => {
  const { marketData, activeTicker } = useMarketData();
  /* Arriving through a door: the name goes on the pane and the clock is set before the first paint */
  const handoff = (useLocation().state ?? null) as NetFlowHandoff | null;
  const [picked, setPicked] = useState<string | null>(() => (typeof handoff?.ticker === 'string' && /^[A-Z0-9.]{1,6}$/.test(handoff.ticker) ? handoff.ticker : null));
  /* THE FIELD IS NOT THE PICK: anything typed went on the pane — "ZZZZ" drew letter logos and an invented price line.
     The field holds what is typed; the pane takes a name only when the book carries it, and keeps the last real one
     meanwhile. */
  const [query, setQuery] = useState<string>(picked ?? '');
  const [mny, setMny] = useState<MoneynessKey>('all');
  const [tenor, setTenor] = useState<SleeveKey | 'all'>(() => (typeof handoff?.tenor === 'string' && TENORS.has(handoff.tenor) ? handoff.tenor : 'all'));
  const [guideOpen, setGuideOpen] = useState(false);

  const top = useTopNet(40);
  /* THE MARKET'S OWN NET (the audit, 2026-10-22): the board is the vendor's 20 most bullish and 20 most bearish names,
     and their sum was headed "Net across the board" as if it were the market. The market's net is the vendor's market
     tide — every name's net call premium less net put premium, running from the open. */
  const tide = useTide('market', '');
  const liveBook = useLiveBook(picked || activeTicker).rows;
  // The shared hold (see LiveHold): the board's book and the pane's tick freeze together while paused
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker);
  const { book: heldBook, tick } = hold.value;
  /* the pane draws the picked name's own minutes (usePaneFlow); the book only feeds the search's suggestions */
  const book = heldBook;
  /* Sampled at the chart tape's last bar — the pane draws to the SIM tape's now; the expiry names the cut the rows came
     through, so the same minute on another cut is another board */
  const leaders = useMemo(
    () =>
      top.rows.map(r => ({
        ticker: r.ticker,
        sector: null as string | null,
        sectorColor: null as string | null,
        net: r.net,
        netCall: r.net > 0 ? r.net : 0,
        netPut: r.net < 0 ? r.net : 0,
        volume: r.volume,
        count: r.count,
      })),
    [top.rows]
  );
  /* the names a search may put on the pane: the book's */
  const known = useMemo(() => new Set(leaders.map(r => r.ticker)), [leaders]);
  const onQuery = (v: string) => {
    setQuery(v);
    if (!v) setPicked(null);
    else if (known.has(v)) setPicked(v);
  };
  const unknown = query !== '' && !known.has(query) && ![...known].some(t => t.startsWith(query));

  const sel = picked ?? leaders[0]?.ticker ?? 'SPY';
  const maxAbs = useMemo(() => Math.max(...leaders.map(l => Math.abs(l.net)), 1), [leaders]);
  const netMarks = useMemo(() => earnMarks(leaders, l => l.net), [leaders]);

  const facts = useMemo(() => {
    const total = leaders.reduce((a, l) => a + l.net, 0);
    const volume = leaders.reduce((a, l) => a + l.volume, 0);
    const calls = leaders.reduce((a, l) => a + l.netCall, 0);
    const puts = leaders.reduce((a, l) => a + l.netPut, 0);
    const contracts = leaders.reduce((a, l) => a + l.count, 0);
    /* the board's gross lean — every name's share of it is printed on its row */
    const gross = leaders.reduce((a, l) => a + Math.abs(l.net), 0) || 1;
    const bullish = leaders.filter(l => l.net > 0).length;
    const top = leaders[0] ?? null;
    const bottom = leaders.length ? leaders[leaders.length - 1] : null;
    const topIsChamp = !!top && !!bottom && Math.abs(top.net) >= Math.abs(bottom.net);
    const busiest = leaders.reduce<(typeof leaders)[number] | null>((a, l) => (a === null || l.volume > a.volume ? l : a), null);
    /* the vendor's ranking sends a name and its net premium only — no volume, no count, no call/put split — so the
       board never prints "P $0 · 0 vol · 1 cons" for figures it was never given */
    const hasVol = leaders.some(l => l.volume > 0);
    return { total, volume, calls, puts, contracts, gross, bullish, bearish: leaders.length - bullish, top, bottom, topIsChamp, busiest: hasVol ? busiest : null, hasVol };
  }, [leaders]);

  /* ReactNode: both named leaders are doors — clicking puts that name on the pane.
     THE PARTS ADD UP: "+$113.6M net … +$104.5M of it in calls and −$9.1M in puts" did not sum; the net is net calls LESS
     net puts, and the sentence says it that way, each figure in its meaning's ink */
  const market = useMemo(() => {
    const lastPt = tide.rows.length ? tide.rows[tide.rows.length - 1] : null;
    /* THE REAL SPAN (the re-audit, 2026-10-22: "from the open" over a tide that runs 07:30–16:14): the tide's own first
       and last minute */
    const firstPt = tide.rows.length ? tide.rows[0] : null;
    return lastPt ? { net: lastPt.callPrem - lastPt.putPrem, calls: lastPt.callPrem, puts: lastPt.putPrem, at: nyClock(lastPt.time * 1000), from: firstPt ? nyClock(firstPt.time * 1000) : null } : null;
  }, [tide.rows]);
  const read = useMemo<ReactNode>(() => {
    if (!facts.top || !facts.bottom) return <RichRead text="The book is still waking up." />;
    const { top, bottom, topIsChamp } = facts;
    const crown = (v: number, champ: boolean) => (champ ? <span className="font-semibold tnum text-supreme">{signed(v)}</span> : <Lean v={v} />);
    return (
      <>
        {market && (
          <>
            <RichRead text={`The whole market's money leans ${market.net >= 0 ? 'bullish' : 'bearish'} — `} />
            <Lean v={market.net} /> net{market.from ? ` from ${market.from}` : ''} to {market.at} ET (net calls <Lean v={market.calls} /> less net puts <Lean v={market.puts} put />).{' '}
          </>
        )}
        <RichRead text={`On the board — the vendor's ${facts.bullish} most bullish and ${facts.bearish} most bearish names — `} />
        the bullish names sum to <Lean v={facts.calls} /> and the bearish to <Lean v={facts.puts} put />.{' '}
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
  }, [facts, leaders.length, market]);

  /* The search PICKS a name (it is a board, not a filter); the board scrolls the picked row into view */
  const boardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!picked) return;
    boardRef.current?.querySelector<HTMLElement>(`[data-ticker="${picked}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [picked]);

  const champ = facts.topIsChamp ? facts.top : facts.bottom;

  return (
    <TraceBox
      title="Which way the money leans"
      sub="The vendor's most bullish and most bearish names, ranked by today's net premium — net calls less net puts · click a name and its session goes on the pane"
      testId="net-flow"
      className="md:flex-1 md:min-h-0"
      data={{ picked: sel, names: leaders.length }}
      guide={{ title: 'How to read the board', door: 'What the board, the lines and the floor mean', body: <NetFlowGuide />, testId: 'net-flow-guide', open: guideOpen, onOpen: setGuideOpen }}
      facts={
        <>
          <Fact label="Market net · every name" testId="net" title="The vendor's market tide: every name's net call premium less its net put premium, over the minutes the tide covers — pre-market included">
            {market ? (
              <>
                <Lean v={market.net} /> <span className="text-textSecondary">· {market.from ? `${market.from}–` : 'to '}{market.at} ET</span>
              </>
            ) : (
              <span className="text-textMuted">—</span>
            )}
          </Fact>
          <Fact label="The board · bullish · bearish" testId="sides" title="The board is the vendor's most bullish and most bearish names by net premium (net calls less net puts). These are the two ends summed — not the whole market">
            <Lean v={facts.calls} className="font-normal" /> <span className="text-textSecondary">·</span> <Lean v={facts.puts} put className="font-normal" />
          </Fact>
          <Fact label="Names" testId="names">
            {leaders.length} <span className="text-textSecondary">·</span> <span className="text-bull">{facts.bullish} bullish</span> <span className="text-textSecondary">·</span> <span className="text-bear">{facts.bearish} bearish</span>
          </Fact>
          {facts.hasVol && (
            <Fact label="Contracts traded" testId="volume" title="Volume across the board, and how many contracts carried it">
              {num(facts.volume)} <span className="text-textSecondary">· {num(facts.contracts)} contracts</span>
            </Fact>
          )}
          {facts.busiest && (
            <Champion label="Busiest name" ink="plain" title="Put this name on the pane" onOpen={() => onQuery(facts.busiest!.ticker)} testId="busiest">
              {facts.busiest.ticker} · {num(facts.busiest.volume)} vol
            </Champion>
          )}
          {/* the two ends of the board, each named for what it is; the larger of the two wears the magenta */}
          {facts.top && facts.top.net > 0 && (
            <Champion label="Most bullish" ink={champ === facts.top ? 'supreme' : 'bull'} title="Put this name on the pane" onOpen={() => onQuery(facts.top!.ticker)} testId="bullish">
              {facts.top.ticker} · {signed(facts.top.net)}
            </Champion>
          )}
          {facts.bottom && facts.bottom.net < 0 && (
            <Champion label="Most bearish" ink={champ === facts.bottom ? 'supreme' : 'bear'} title="Put this name on the pane" onOpen={() => onQuery(facts.bottom!.ticker)} testId="bearish">
              {facts.bottom.ticker} · {signed(facts.bottom.net)}
            </Champion>
          )}
        </>
      }
      controls={
        <>
          <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
          <StaleMark at={top.at} ttlMs={FLOW_TTL_MS} fault={top.fault} />
          <span className="inline-flex items-center gap-2 flex-wrap" data-span>
            <FlowSearch value={query} onChange={onQuery} rows={book} countNoun="contracts" tickersOnly />
            {unknown && (
              <span role="status" className="text-[11px] text-textSecondary" data-net-unknown>
                No contracts for {query} today — the pane keeps {sel}
              </span>
            )}
          </span>
        </>
      }
      sentence={read}
    >
      {/* ON A PHONE THE BOARD STANDS OVER THE PANE: side by side at 390px the pane was squeezed to a sliver beside the
          board — its chart and its menus cut off at the screen's edge */}
      <div className="flex max-md:flex-col md:flex-1 md:min-h-0 border-t border-borderSubtle">
        {/* THE BOARD — most bullish at the top, most bearish at the floor */}
        <div ref={boardRef} className="md:w-[304px] shrink-0 md:border-r max-md:border-b max-md:max-h-[306px] border-borderSubtle overflow-y-auto" data-net-board>
          {/* THE COLUMNS SAY THEMSELVES (the retail pass: "2%", "1%" with no word) */}
          {leaders.length > 0 && (
            <div className="sticky top-0 z-10 bg-panel flex items-center gap-2 px-3 py-1.5 border-b border-borderSubtle font-mono text-[10px] uppercase tracking-wider text-textMuted" data-net-board-head>
              <span className="w-5">#</span>
              <span className="flex-1">Name · share of the board's lean</span>
              <span>Net today</span>
            </div>
          )}
          {leaders.length === 0 && (
            <p className="px-4 py-6 font-mono text-[10px] uppercase tracking-widest text-textMuted" data-net-board-empty>
              {top.fault ? 'This read did not land' : 'No name has leaned yet today'}
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
                  <span className="font-mono text-[11px] text-textPrimary tnum w-5">{String(i + 1).padStart(2, '0')}</span>
                  <CompanyLogo ticker={l.ticker} size={15} />
                  <span className="font-mono text-[11px] font-bold text-textPrimary">{l.ticker}</span>
                  {/* the name's share of the board's gross lean */}
                  <span className="font-mono text-[11px] tnum text-textSecondary cursor-help" title={`${l.ticker}'s share of the board's gross lean: its net premium (${signed(l.net)}) against the sum of every board name's net, signs dropped (${fmtUsd(facts.gross)})`}>
                    {Math.round((Math.abs(l.net) / facts.gross) * 100)}%
                  </span>
                  <span className={`ml-auto font-mono text-[11px] tabular-nums ${directionInk(l.net, netMarks)}`}><TickFigure value={l.net}>{fmtUsd(l.net)}</TickFigure></span>
                </span>
                <span className="flex items-center gap-2 pl-7">
                  <span className="relative h-0.5 flex-1 rounded-full bg-ink/[0.06] overflow-hidden">
                    <span className={`absolute left-0 top-0 h-full ${l.net >= 0 ? 'bg-bull/60' : 'bg-bear/60'}`} style={{ width: `${Math.round((Math.abs(l.net) / maxAbs) * 100)}%` }} />
                  </span>
                  {facts.hasVol ? (
                    <span className="font-mono text-[11px] text-textPrimary tnum whitespace-nowrap" title={`Net calls, net puts, volume and the ${l.count} contracts traded on ${l.ticker} today`}>
                      C {fmtUsd(l.netCall)} · P {fmtUsd(l.netPut)} · {num(l.volume)} vol · {l.count} cons
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-textMuted whitespace-nowrap">{l.net >= 0 ? 'net bullish' : 'net bearish'}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {/* THE PANE — the picked name's session */}
        <div className="flex-1 min-w-0 p-2 max-md:h-[460px] max-md:flex-none">
          <NetFlowPane
            book={book}
            seg="all"
            mny={mny}
            onSeg={() => {}}
            onMny={setMny}
            tick={tick}
            ticker={sel}
            tenor={tenor}
            onTenor={setTenor}
            dteMax={Infinity}
          />
          {top.fault && leaders.length === 0 ? <FeedFallback fault={top.fault} /> : null}
        </div>
      </div>
    </TraceBox>
  );
};

export default NetFlow;
