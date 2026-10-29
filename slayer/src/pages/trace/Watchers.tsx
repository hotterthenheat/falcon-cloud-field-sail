/* Watchers: the desk's reasons (and the reader's own, from data/flowReasons.ts) run over the day book. A row is a
   contract that meets one, told by its own day; a house reason wears its hue, one of yours a hollow ring. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { bookLeanWords, buildCatches, notABetHint, notABetLabel, FRESH_VOL_OI, notABet, stockLike, volOiText, reasonPhrase, WATCHERS, type WatcherKey, type Catch } from '../../data/flowBook';
import { fmtCount as num, pairOiFor, usd as fmtUsd } from '../../data/traceLive';
import { dayAdv, earnWords } from '../../components/trace/dayWords';
import { reasonSentence, useReasons } from '../../data/flowReasons';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import WatchStar from '../../components/trace/WatchStar';
import { contractKey, watchContract } from '../../context/WatchContext';
import LeanCell from '../../components/trace/LeanCell';
import RichRead from '../../components/ui/RichRead';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell, { OtmCell, otmSortValue } from '../../components/trace/ContractCell';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import { LiveHold, SessionMark } from '../../components/trace/LiveHold';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { isoDate } from '../../core/calendar';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import ReasonDoor from '../../components/trace/ReasonDoor';
import ReadDoor from '../../components/trace/ReadDoor';
import FlowSearch, { searchMiss, matchesContract, normSymbol } from '../../components/trace/FlowSearch';
import TermLine from '../../components/trace/TermLine';
import { useHeldBook } from '../../components/trace/useHeldBook';
import TraceBox, { Champion, endlessOf, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { WatchersGuide } from '../../components/trace/TraceGuide';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { isIsoDay, isQuery, oneOf, useAddressCut } from '../../components/trace/addressCut';
import { PREM_FLOOR_OPTIONS, PREM_FLOORS, type PremFloor } from '../../components/trace/premFloor';
import { createViewStore } from '../../data/savedViews';
import { expiryLabel } from '../../core/format';

const SIDE_OPTIONS: DropdownOption<'ALL' | 'C' | 'P'>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
/* the reason wraps to two lines, so it takes the room */
const WIDTHS: Record<string, number> = { time: 92, ticker: 96, contract: 168, dte: 64, reason: 212, clip: 132, clipprem: 100, sideCol: 92, otm: 76, earn: 128 };
const FLEXES: Record<string, number> = { reason: 3 };
/* the reason is words: two lines and its hover, giving way to the figures first */
const PROSE = ['reason'];
const PIN_LEFT = ['time', 'ticker', 'contract'];
const PIN_RIGHT = ['clipprem'];
const WATCHER_CUTS = createViewStore('slayer_watchers_cuts_v1');
const TOOLTIPS: Record<string, string> = {
  reason: 'Why the contract is here — the desk’s reasons, or yours (hollow ring)',
  time: 'When the contract last printed, New York',
  clip: "The contract's last fill",
  clipprem: "The contract's premium today — every print",
  sideCol: 'The side holding 55%+ of the sided contracts, with half the day on a side',
  voloi: 'Volume over the open interest the session opened on; 1.5+ means positions built today',
};

/** A reason names a kind, never a verdict: the house's categorical hues */
const RULE_DOT: Record<WatcherKey, string> = {
  'big-money': 'rgb(var(--cat-analyst))',
  'into-earnings': 'rgb(var(--cat-earnings))',
  climbing: 'rgb(var(--cat-macro))',
  falling: 'rgb(var(--cat-ma))',
  'fresh-size': 'rgb(var(--cat-guidance))',
  hammering: 'rgb(var(--cat-regulatory))',
};

const RULE_META = Object.fromEntries(WATCHERS.map(r => [r.key, r])) as Record<WatcherKey, (typeof WATCHERS)[number]>;

const phoneRow = (a: Catch) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(a.row)} make={() => watchContract(a.row, 'watchers')} />}
    title={
      <>
        <CompanyLogo ticker={a.row.ticker} size={15} />
        <span className="font-bold">{a.row.ticker}</span>
        <span className="font-bold tnum">{a.row.strike}</span>
        <span className={a.row.right === 'C' ? 'text-bull' : 'text-bear'}>{a.row.right === 'C' ? 'call' : 'put'}</span>
        <span className="text-t11 text-textSecondary tnum">{a.row.expiry.slice(0, 5)}</span>
      </>
    }
    aside={`${a.time} ET`}
    figures={[
      <span key="p" className="font-semibold text-textPrimary">
        {fmtUsd(a.premium)}
      </span>,
      <span key="s">last ${a.last.toFixed(2)}</span>,
      <span key="z">
        {num(a.row.volume)} vol · {bookLeanWords(a.row)}
      </span>,
    ]}
  />
);

const Watchers = () => {
  const { activeTicker } = useTicker();
  const myReasons = useReasons();
  const addr = useAddressCut({
    reason: { def: 'ALL', valid: (v: string) => v.length > 0 && v.length < 64 },
    side: { def: 'ALL', valid: oneOf(['ALL', 'C', 'P']) },
    q: { def: '', valid: isQuery },
    exp: { def: '', valid: isIsoDay },
    prem: { def: '0', valid: oneOf(PREM_FLOORS) },
  });
  const rule = addr.cut.reason;
  const prem = addr.cut.prem as PremFloor;
  const setRule = (v: string) => addr.set({ reason: v });
  const side = addr.cut.side as 'ALL' | 'C' | 'P';
  const setSide = (v: 'ALL' | 'C' | 'P') => addr.set({ side: v });
  const query = addr.cut.q;
  const setQuery = (v: string) => addr.set({ q: v });
  const cuts = useSavedCuts();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* the market's book only; a searched name's own book, paged */
  const { bookPack, bookWord, reading, hold, heldBook, expiryCut, stand, book } = useHeldBook(query, activeTicker, { value: addr.cut.exp || null, onChange: iso => addr.set({ exp: iso ?? '' }) });
  const { expiry, setExpiry, expiries, chosen } = expiryCut;
  const keyOf = useCallback((a: { id: string }) => a.id, []);
  const openRow = useCallback((a: { row: { key: string } }) => setOpenKey(a.row.key), []);
  const catches = useMemo(() => buildCatches(book, myReasons), [book, myReasons]);

  /* one lookup for a reason's words — the column, the card and the hint never describe a reason two ways */
  const reasonOf = useMemo(() => {
    const mine = new Map(myReasons.map(r => [r.id, r]));
    return (key: string): { label: string; phrase: string; mine: boolean } | null => {
      const house = RULE_META[key as WatcherKey];
      if (house) return { label: house.label, phrase: house.reason, mine: false };
      const own = mine.get(key);
      return own ? { label: own.name, phrase: reasonSentence(own), mine: true } : null;
    };
  }, [myReasons]);

  /* a deleted reason must not keep filtering everything away */
  useEffect(() => {
    if (rule !== 'ALL' && !reasonOf(rule)) setRule('ALL');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, reasonOf]);

  const rows = useMemo(() => {
    const nq = normSymbol(query);
    const floor = Number(prem);
    return catches.filter(a => (rule === 'ALL' || a.rules.includes(rule)) && (side === 'ALL' || a.row.right === side) && a.premium >= floor && (nq === '' || matchesContract(query, a.row)));
  }, [catches, rule, side, query, prem]);

  /* one row per contract for the search's tallies */
  const searchRows = useMemo(() => {
    const seen = new Map<string, BookContract>();
    for (const a of catches) if (!seen.has(a.row.key)) seen.set(a.row.key, a.row);
    return [...seen.values()];
  }, [catches]);

  const marks = useMemo(() => ({ prem: earnMarks(rows, a => a.premium), vol: earnMarks(rows, a => a.row.volume), oi: earnMarks(rows, a => a.row.oi) }), [rows]);

  /* the read's door opens even when a filter hides that row */
  const drillList = useMemo(() => {
    const base = rows.map(a => a.row);
    const latest = catches[0];
    return latest && !base.some(r => r.key === latest.row.key) ? [latest.row, ...base] : base;
  }, [rows, catches]);

  const facts = useMemo(() => {
    const byRule = new Map<string, number>();
    let mine = 0;
    for (const a of catches) {
      for (const r of a.rules) byRule.set(r, (byRule.get(r) ?? 0) + 1);
      if (a.mine) mine++;
    }
    const loud = [...byRule.entries()].sort((a, b) => b[1] - a[1])[0];
    return { total: catches.length, loudKey: loud?.[0] ?? null, loudName: loud ? (reasonOf(loud[0])?.label ?? '') : '', loudCount: loud ? loud[1] : 0, mine, names: new Set(catches.map(a => a.row.ticker)).size };
  }, [catches, reasonOf]);

  const read = useMemo<ReactNode>(() => {
    if (reading) return <RichRead text={`Reading ${bookWord}…`} />;
    if (bookPack.fault && heldBook.length === 0) return <RichRead text="The book did not answer — the watchers run when it does." />;
    if (catches.length === 0) return <RichRead text={`Nothing flagged ${dayAdv()}.`} />;
    const phrase = facts.loudKey ? (reasonOf(facts.loudKey)?.phrase ?? facts.loudName) : '';
    const why = phrase.charAt(0).toLowerCase() + phrase.slice(1);
    const latest = catches[0];
    return (
      <>
        <RichRead text={`${num(catches.length)} contracts on ${facts.names} names caught among the ${num(book.length)} standing on ${bookWord}${stand.expired ? ` (${num(stand.expired)} expired left out)` : ''} — [[${num(facts.loudCount)}]] because ${why}.${facts.mine ? ` ${num(facts.mine)} from your reasons.` : ''} Most recent: `} />
        <ReadDoor onOpen={() => setOpenKey(latest.row.key)}>
          {latest.row.ticker} {latest.row.strike}
          {latest.row.right}
        </ReadDoor>
        <RichRead text={`, last $${latest.last.toFixed(2)} at ${latest.time} ET, ${fmtUsd(latest.premium)} ${dayAdv()}.`} />
      </>
    );
  }, [catches, reasonOf, book.length, stand.expired, reading, bookPack.fault, heldBook.length, bookWord, facts]);

  const activeRule = rule === 'ALL' ? null : reasonOf(rule);
  const reasonOptions = useMemo<DropdownOption<string>[]>(
    () => [
      { value: 'ALL', label: 'Every reason', short: 'All', hint: "The desk's reasons and yours" },
      ...WATCHERS.map(r => ({ value: r.key, label: r.label, hint: r.hint })),
      ...myReasons.map(r => ({ value: r.id, label: r.name, hint: reasonSentence(r) })),
    ],
    [myReasons]
  );

  const columns = useMemo<Column<Catch>[]>(
    () => [
      {
        key: 'time',
        header: 'Time ET',
        sortValue: a => a.minute,
        render: a => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(a.row)} make={() => watchContract(a.row, 'watchers')} />
            <span className="text-t11 text-textPrimary">{a.time}</span>
          </span>
        ),
      },
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: a => a.row.ticker,
        render: a => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={a.row.ticker} size={15} />
            <span className="font-bold text-textPrimary">{a.row.ticker}</span>
          </span>
        ),
      },
      { key: 'contract', header: 'Contract', align: 'right', sortValue: a => a.row.strike, render: a => <ContractCell strike={a.row.strike} right={a.row.right} expiry={a.row.expiry} /> },
      { key: 'dte', header: 'DTE', align: 'right', sortValue: a => a.row.dte, render: a => <span className="text-textPrimary">{a.row.dte}d</span> },
      {
        key: 'reason',
        header: 'Reason',
        sortValue: a => a.rule,
        render: a => {
          /* every reason the contract meets, each in its own figure */
          const said = a.rules
            .map(k => {
              const meta = reasonOf(k);
              if (!meta) return null;
              return { k, mine: meta.mine, text: meta.mine ? `${meta.label}: ${meta.phrase}` : reasonPhrase(k as WatcherKey, a.row) };
            })
            .filter((x): x is { k: string; mine: boolean; text: string } => !!x);
          if (!said.length) return <span className="text-textSecondary">—</span>;
          return (
            <span className="inline-flex items-center gap-1.5 text-t11 leading-tight text-textPrimary whitespace-normal" title={said.map(x => x.text).join(' · ')}>
              <span className="inline-flex gap-0.5 shrink-0">
                {said.map(x => (x.mine ? <span key={x.k} className="w-1.5 h-1.5 rounded-full border border-textSecondary" /> : <span key={x.k} className="w-1.5 h-1.5 rounded-full" style={{ background: RULE_DOT[x.k as WatcherKey] }} />))}
              </span>
              <span className="line-clamp-2">{said.map(x => x.text).join(' · ')}</span>
            </span>
          );
        },
      },
      {
        key: 'clip',
        header: 'Last fill',
        align: 'right',
        sortValue: a => a.last,
        render: a => (
          <span className="text-textPrimary">
            ${a.last.toFixed(2)} <span className="text-t11 text-textSecondary">{a.time}</span>
          </span>
        ),
      },
      { key: 'clipprem', header: 'Day $', align: 'right', sortValue: a => a.premium, render: a => <span className={weightInk(a.premium, marks.prem)}>{fmtUsd(a.premium)}</span> },
      {
        key: 'sideCol',
        header: 'Day lean',
        align: 'right',
        sortValue: a => a.row.askPct,
        render: a => (a.row.sideVol ? <LeanCell askPct={a.row.askPct} split={a.row.sideVol} legsPct={a.row.multiPct} crossPct={a.row.crossPct} /> : <span className={`text-t11 ${a.side === 'EVEN' || a.side === 'MID' || a.side === 'LEGS' ? 'text-textMuted' : 'text-textPrimary'}`}>{bookLeanWords(a.row)}</span>),
      },
      { key: 'vol', header: 'Vol', align: 'right', sortValue: a => a.row.volume, render: a => <span className={weightInk(a.row.volume, marks.vol)}>{num(a.row.volume)}</span> },
      { key: 'oi', header: 'OI', align: 'right', sortValue: a => a.row.oi, render: a => <span className={weightInk(a.row.oi, marks.oi)}>{num(a.row.oi)}</span> },
      { key: 'voloi', header: 'Vol/OI', align: 'right', sortValue: a => a.row.volOverOI, render: a => <span className={a.row.volOverOI >= FRESH_VOL_OI ? 'font-bold text-textPrimary' : 'text-textPrimary'} title={a.row.volOverOI > 0 || !(a.row.volume > 0) ? undefined : 'No open interest before the session — a new contract'}>{volOiText(a.row)}</span> },
      { key: 'otm', header: 'OTM %', align: 'right', sortValue: a => otmSortValue(a.row.otmPct), render: a => <OtmCell otmPct={a.row.otmPct} ticker={a.row.ticker} /> },
      {
        key: 'earn',
        header: 'Earnings',
        align: 'right',
        sortValue: a => a.row.earnDays ?? 999,
        render: a => {
          const e = earnWords(a.row);
          return e ? <span className={a.row.earnDays! <= 5 ? 'text-warn' : 'text-textPrimary'} title={e.title}>{e.text}</span> : <span className="text-textSecondary">—</span>;
        },
      },
    ],
    [reasonOf, marks]
  );

  /* a side is not a direction: the side champions wear the plain ink; packages and legs are never "most money" */
  const champs = useMemo(() => {
    const by = (pick: (a: Catch) => boolean) => rows.filter(a => !notABet(a.row) && pick(a)).reduce<Catch | null>((a, x) => (a === null || x.premium > a.premium ? x : a), null);
    const packaged = rows.filter(a => notABet(a.row)).reduce<Catch | null>((a, x) => (a === null || x.premium > a.premium ? x : a), null);
    return { ask: by(a => a.side === 'ASK'), bid: by(a => a.side === 'BID'), all: by(() => true), packaged };
  }, [rows]);
  /* two SPX 7000 calls on different dates are two contracts: the expiry rides in the pill */
  const pill = (a: Catch) => `${a.row.ticker} ${a.row.strike}${a.row.right} ${expiryLabel(a.row.expiry)} · ${fmtUsd(a.premium)}${stockLike(a.row) ? ' · stock-like' : ''}`;

  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_flowalerts_cols');
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);
  const selectedId = openKey ? (rows.find(a => a.row.key === openKey)?.id ?? null) : null;

  return (
    <>
      <TraceBox
        title="The desk watching the tape"
        sub={`${activeRule ? `${activeRule.label} — ${activeRule.phrase}` : 'Every contract a reason flags'} · newest first`}
        testId="watchers"
        foldOnPhone
        data={{ rule, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the watchers', door: 'What a reason, the print and the side mean', body: <WatchersGuide />, testId: 'watchers-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Contracts caught" testId="caught" title={`Contracts on ${bookWord} meeting a reason, each counted once`}>
              {reading ? <span className="text-textMuted">—</span> : num(facts.total)}
              {!reading && facts.loudName && <span className="text-textSecondary"> · most often {facts.loudName} ({num(facts.loudCount)})</span>}
            </Fact>
            <Fact label="From your reasons" testId="mine">
              {reading ? <span className="text-textMuted">—</span> : <span className={facts.mine > 0 ? 'text-textPrimary' : 'text-textSecondary'}>{facts.mine}</span>}
            </Fact>
            {champs.ask && champs.ask !== champs.all && (
              <Champion label="Most money · ask" ink="plain" onOpen={() => setOpenKey(champs.ask!.row.key)} testId="top-ask">
                {pill(champs.ask)}
              </Champion>
            )}
            {champs.bid && champs.bid !== champs.all && (
              <Champion label="Most money · bid" ink="plain" onOpen={() => setOpenKey(champs.bid!.row.key)} testId="top-bid">
                {pill(champs.bid)}
              </Champion>
            )}
            {champs.all && (
              <Champion label="Most money" ink="supreme" title="The most premium among single bets" onOpen={() => setOpenKey(champs.all!.row.key)} testId="largest">
                {pill(champs.all)}
              </Champion>
            )}
            {champs.packaged && (!champs.all || champs.packaged.premium > champs.all.premium) && (
              <Champion label={`${notABetLabel([champs.packaged.row])} · not a bet`} ink="plain" title={`More premium, but ${notABetHint(champs.packaged.row)}`} onOpen={() => setOpenKey(champs.packaged!.row.key)} testId="packaged">
                {pill(champs.packaged)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <SessionMark at={bookPack.at} fault={bookPack.fault} paused={hold.paused} kept={bookPack.kept} />
            <FlowSearch value={query} onChange={setQuery} rows={searchRows} countNoun="contracts" span />
            <DropdownSelect label="Reason" value={rule} options={reasonOptions} onChange={setRule} title="Which watcher's catches" testId="watchers-reason" />
            <DropdownSelect label="Side" value={side} options={SIDE_OPTIONS} onChange={setSide} title="Calls, puts or both" testId="watchers-side" />
            <DropdownSelect label="Premium" value={prem} options={PREM_FLOOR_OPTIONS} onChange={v => addr.set({ prem: v })} title="The least money a contract carried in the session" testId="watchers-premium" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="One expiry, or every expiry" testId="watchers-expiry" />
            <ReasonDoor book={book} />
            <SavedCutsControl store={WATCHER_CUTS} query={addr.query} onOpen={addr.open} noun="cut" testId="watchers" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={WATCHER_CUTS} query="" onOpen={addr.open} noun="cut" testId="watchers" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-t11 text-textSecondary">
                {cuts.said}
              </p>
            )}
          </>
        }
        lead={reading ? `Reading ${bookWord}…` : catches.length === 0 ? `Nothing on ${bookWord} meets a reason ${dayAdv()}.` : `${num(facts.total)} contracts meet a reason ${dayAdv()}${facts.loudName ? ` — most often “${facts.loudName}”` : ''}.`}
        detail={
          <>
            {read}
            <TermLine keys={['standing', 'floor', 'spreadLegs', 'volOi', 'stockLike']} testId="watchers" />
          </>
        }
      >
        <TraceGrid rows={rows} columns={columns} hidden={hidden} widths={WIDTHS} flexes={FLEXES} prose={PROSE} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={openRow} selectedKey={selectedId} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight onVisible={vis => pairOiFor(vis.map(a => a.row))} endless={endlessOf(bookPack.older, bookPack.name ? `${bookPack.name} contracts` : 'contracts on the book', 'the list for the day is done', hold.paused, 'Load more ↓')} emptyText={query.trim() && book.some(r => matchesContract(query, r)) ? `${query.trim()} is on ${bookWord} but meets no reason ${dayAdv()}` : query.trim() && catches.length > 0 ? searchMiss(query, 'catch') : reading ? 'Reading the book…' : bookPack.fault && heldBook.length === 0 ? 'This read did not land — the watchers run when the book answers' : 'Nothing on the book meets a reason yet'} testId="watchers" />
      </TraceBox>

      <BookDrill list={drillList} openKey={openKey} onOpen={setOpenKey} />
    </>
  );
};

export default Watchers;
