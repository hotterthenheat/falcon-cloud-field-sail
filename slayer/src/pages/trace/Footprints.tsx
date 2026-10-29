/* Footprints: what the flow left standing — open interest built and unwound by one session's trading, on the market's
   book (or a searched name's). The cut lives in the address. */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { CalendarDays } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { FOOTPRINT_SCREENS, notABet, notABetHint, notABetLabel, notABetWord, runFootprintScreen, stockLike, type FootprintScreenKey } from '../../data/flowBook';
import { fmtCount as num, pairOiFor, prevSessionIso, standing, useSearchBook } from '../../data/traceLive';
import { dayLabel, earnWords, oiAfterWords, oiCoverOf, oiInWords, oiLags, oiPendingWords, oiRowTitle, shortDay, type OiCover } from '../../components/trace/dayWords';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import WatchStar from '../../components/trace/WatchStar';
import { contractKey, watchContract } from '../../context/WatchContext';
import RichRead from '../../components/ui/RichRead';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell, { OtmCell, otmSortValue } from '../../components/trace/ContractCell';
import ReadDoor from '../../components/trace/ReadDoor';
import { earnMarks, weightInk, type InkMarks } from '../../components/trace/earnedInk';
import FlowSearch, { searchMiss, matchesContract, normSymbol, searchedName, useSearchedName } from '../../components/trace/FlowSearch';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import TermLine from '../../components/trace/TermLine';
import TraceBox, { Champion, endlessOf, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { isIsoDay, isQuery, oneOf, useAddressCut } from '../../components/trace/addressCut';
import { PREM_FLOOR_OPTIONS, PREM_FLOORS, type PremFloor } from '../../components/trace/premFloor';
import { createViewStore } from '../../data/savedViews';
import { FootprintsGuide } from '../../components/trace/TraceGuide';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';

const SIDE_OPTIONS: DropdownOption<'ALL' | 'C' | 'P'>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
const WIDTHS: Record<string, number> = { ticker: 104, contract: 144, dte: 52, otm: 80, oi: 88, prevoi: 88, doi: 142, doipct: 72, prevavg: 100, streak: 60, earn: 108 };
const PIN_LEFT = ['ticker', 'contract'];
const PIN_RIGHT = ['doi'];
const FOOT_CUTS = createViewStore('slayer_footprints_cuts_v1');
/* a percentage build on a near-empty contract is a percentage of nothing: the fastest-build crown needs this much before */
const FASTEST_MIN_PREV_OI = 500;

const phoneRow = (r: BookContract) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(r)} make={() => watchContract(r, 'footprints')} />}
    title={
      <>
        <CompanyLogo ticker={r.ticker} size={15} />
        <span className="font-bold">{r.ticker}</span>
        <span className="font-bold tnum">{r.strike}</span>
        <span className={r.right === 'C' ? 'text-bull' : 'text-bear'}>{r.right === 'C' ? 'call' : 'put'}</span>
        <span className="text-t11 text-textSecondary tnum">{r.expiry.slice(0, 5)}</span>
      </>
    }
    aside={`${r.dte}d`}
    figures={[
      <span key="d" className={r.deltaOI > 0 ? 'font-semibold text-bull' : r.deltaOI < 0 ? 'font-semibold text-bear' : ''}>
        {r.deltaOI > 0 ? '+' : r.deltaOI < 0 ? '−' : ''}
        {num(Math.abs(r.deltaOI))} OI
      </span>,
      <span key="o">{num(r.oi)} standing</span>,
    ]}
  />
);

/* the open-interest heads name whose trading they reflect */
const tooltipsFor = (cover: OiCover): Record<string, string> => ({
  oi: `Open interest ${oiAfterWords(cover.day)}, counted the morning after`,
  prevoi: cover.day ? `Open interest at ${shortDay(cover.day)}'s open` : 'Open interest of the count before',
  doi: `Built or unwound ${oiInWords(cover.day)}; a row marked with an earlier day is still on the count before`,
  doipct: 'The change as a share of what stood before',
  prevavg: "The contract's close the session before",
  streak: 'Sessions in a row the interest has grown',
  earn: "The name's next report, if it lands before expiry",
});

const dirInk = (v: number, m: InkMarks): string => (Math.abs(v) >= m.top ? 'text-supreme font-bold' : Math.abs(v) >= m.bar ? (v > 0 ? 'text-bull dir-up' : 'text-bear dir-down') : 'text-textPrimary');

const Footprints = () => {
  const { activeTicker } = useTicker();
  const addr = useAddressCut({
    screen: { def: 'builds', valid: oneOf(FOOTPRINT_SCREENS.map(x => x.key)) },
    side: { def: 'ALL', valid: oneOf(['ALL', 'C', 'P']) },
    q: { def: '', valid: isQuery },
    exp: { def: '', valid: isIsoDay },
    prem: { def: '0', valid: oneOf(PREM_FLOORS) },
  });
  const screen = addr.cut.screen as FootprintScreenKey;
  const setScreen = (v: FootprintScreenKey) => addr.set({ screen: v });
  const side = addr.cut.side as 'ALL' | 'C' | 'P';
  const setSide = (v: 'ALL' | 'C' | 'P') => addr.set({ side: v });
  const query = addr.cut.q;
  const setQuery = (v: string) => addr.set({ q: v });
  const prem = addr.cut.prem as PremFloor;
  const cuts = useSavedCuts();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  /* the market's book only — the shell's ticker never joins it; a name is read through the search */
  const askedName = useSearchedName(query);
  const bookPack = useSearchBook(askedName);
  const bookWord = bookPack.name ? `${bookPack.name}'s book` : "the market's book";
  const liveBook = bookPack.rows;
  const reading = (bookPack.waiting && liveBook.length === 0) || searchedName(query) !== askedName;
  const hold = useHold(liveBook, activeTicker, !reading);
  const heldBook = hold.value;
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(heldBook, r => r.expiry, { value: addr.cut.exp || null, onChange: iso => addr.set({ exp: iso ?? '' }) });
  /* a contract that expired at the bell no longer stands */
  const stand = useMemo(() => standing(cutExpiry(heldBook)), [heldBook, cutExpiry]);
  const book = stand.rows;
  /* one session's builds: a row the vendor has not re-counted keeps its place, marked, out of every sum and crown */
  const cover = useMemo(() => oiCoverOf(book), [book]);
  const onCount = useCallback((r: BookContract) => !oiLags(r, cover), [cover]);
  const keyOf = useCallback((r: { key: string }) => r.key, []);
  const openRow = useCallback((r: { key: string }) => setOpenKey(r.key), []);

  const filtered = useMemo(() => {
    const floor = Number(prem);
    const sided = book.filter(r => (side === 'ALL' || r.right === side) && r.premium >= floor);
    return normSymbol(query) === '' ? sided : sided.filter(r => matchesContract(query, r));
  }, [book, side, query, prem]);
  const rows = useMemo(() => runFootprintScreen(filtered, screen), [filtered, screen]);
  const cutWord = useMemo(() => [query ? `matching "${query}"` : '', side === 'C' ? 'calls only' : side === 'P' ? 'puts only' : ''].filter(Boolean).join(', '), [query, side]);
  /* floor packages, days of spread legs and days of crosses are not bets: out of the crowns and the sums */
  const ranked = useCallback((r: BookContract) => onCount(r) && !notABet(r), [onCount]);
  const loudestBuild = useMemo(() => filtered.filter(r => r.deltaOI > 0 && ranked(r)).sort((a, b) => b.deltaOI - a.deltaOI)[0] ?? null, [filtered, ranked]);
  const loudestUnwind = useMemo(() => filtered.filter(r => r.deltaOI < 0 && ranked(r)).sort((a, b) => a.deltaOI - b.deltaOI)[0] ?? null, [filtered, ranked]);
  const loudest = screen === 'unwinds' ? loudestUnwind : loudestBuild;

  const facts = useMemo(() => {
    let added = 0;
    let shed = 0;
    let builds = 0;
    let unwinds = 0;
    let apart = 0;
    let apartMoved = 0;
    for (const r of filtered) {
      if (!onCount(r)) continue;
      if (notABet(r)) {
        apart++;
        apartMoved += r.deltaOI;
        continue;
      }
      if (r.deltaOI > 0) {
        added += r.deltaOI;
        builds++;
      } else if (r.deltaOI < 0) {
        shed -= r.deltaOI;
        unwinds++;
      }
    }
    return { added, shed, builds, unwinds, apart, apartMoved, lag: filtered.filter(r => !onCount(r)).length };
  }, [filtered, onCount]);

  const read = useMemo<ReactNode>(() => {
    if (reading) return <RichRead text={`Reading ${bookWord} and its open interest…`} />;
    if (bookPack.fault && heldBook.length === 0) return <RichRead text="The book did not answer — the footprints fill when it does." />;
    const apartWords = facts.apart ? ` ${num(facts.apart)} more (${notABetLabel(filtered.filter(r => onCount(r) && notABet(r))).toLowerCase()}, ${facts.apartMoved >= 0 ? '+' : '−'}${num(Math.abs(facts.apartMoved))}) are not bets and are left out.` : '';
    const lagWords = facts.lag ? ` ${num(facts.lag)} still on the count before are left out.` : '';
    const scope = `${num(heldBook.length)} contracts loaded on ${bookWord}${stand.expired ? `, ${num(stand.expired)} expired left out` : ''}`;
    const base = `Of the ${scope}: open interest rose ${num(facts.added)} on ${num(facts.builds)} and fell ${num(facts.shed)} on ${num(facts.unwinds)} ${oiInWords(cover.day)}.${apartWords}${lagWords}`;
    if (!loudest) return <RichRead text={base} />;
    const unwind = loudest.deltaOI < 0;
    return (
      <>
        <RichRead text={`${base} ${unwind ? 'Biggest unwind' : 'Biggest build'}: `} />
        <ReadDoor onOpen={() => setOpenKey(loudest.key)}>
          {loudest.ticker} {loudest.strike}
          {loudest.right}
        </ReadDoor>
        <RichRead text={` [[${unwind ? '−' : '+'}${num(Math.abs(loudest.deltaOI))}]]${!unwind && stockLike(loudest) ? ' — deep in the money and long-dated: likely a stock replacement, not a bet' : ''}.`} />
      </>
    );
  }, [filtered, loudest, stand.expired, onCount, cover, reading, bookPack.fault, heldBook.length, bookWord, facts]);

  const marks = useMemo(
    () => ({
      oi: earnMarks(rows, r => r.oi),
      prevOI: earnMarks(rows, r => r.prevOI),
      doi: earnMarks(rows, r => r.deltaOI),
      doiPct: earnMarks(rows, r => r.deltaOIPct),
      vol: earnMarks(rows, r => r.volume),
      prevAvg: earnMarks(rows, r => r.prevAvgFill),
    }),
    [rows]
  );

  const columns = useMemo<Column<BookContract>[]>(
    () => [
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: r => r.ticker,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(r)} make={() => watchContract(r, 'footprints')} />
            <CompanyLogo ticker={r.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.ticker}</span>
          </span>
        ),
      },
      { key: 'contract', header: 'Contract', align: 'right', sortValue: r => r.strike, render: r => <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} /> },
      { key: 'dte', header: 'DTE', align: 'right', sortValue: r => r.dte, render: r => <span className="text-textPrimary">{r.dte}d</span> },
      { key: 'otm', header: 'OTM %', align: 'right', sortValue: r => otmSortValue(r.otmPct), render: r => <OtmCell otmPct={r.otmPct} ticker={r.ticker} /> },
      { key: 'oi', header: 'OI', align: 'right', sortValue: r => r.oi, render: r => <span className={weightInk(r.oi, marks.oi)}>{num(r.oi)}</span> },
      { key: 'prevoi', header: 'Prev OI', align: 'right', sortValue: r => r.prevOI, render: r => <span className={weightInk(r.prevOI, marks.prevOI)}>{num(r.prevOI)}</span> },
      {
        key: 'doi',
        header: 'ΔOI',
        align: 'right',
        sortValue: r => r.deltaOI,
        render: r => {
          /* a row still on the count before names its day, in plain ink; a non-bet says what it is */
          const lag = oiLags(r, cover) && r.oiDay ? <span className="mr-1 text-t10 text-textMuted">{shortDay(r.oiDay)}</span> : notABet(r) ? <span className="mr-1 text-t10 text-warn" title={notABetHint(r)}>{notABetWord(r) === 'floor package' ? 'pkg' : notABetWord(r) === 'a cross' ? 'cross' : 'legs'}</span> : null;
          if (r.deltaOI === 0) return <span className="text-textSecondary" title={oiRowTitle(r)}>{lag}—</span>;
          const a = Math.abs(r.deltaOI);
          const ink = lag ? 'text-textPrimary' : a >= marks.doi.top ? 'text-supreme font-bold' : a >= marks.doi.bar ? `font-bold ${r.deltaOI > 0 ? 'text-bull dir-up' : 'text-bear dir-down'}` : 'text-textPrimary';
          return (
            <span className={ink} title={oiRowTitle(r)}>
              {lag}
              {r.deltaOI > 0 ? '+' : '−'}
              {num(a)}
            </span>
          );
        },
      },
      {
        key: 'doipct',
        header: 'ΔOI %',
        align: 'right',
        sortValue: r => r.deltaOIPct,
        render: r =>
          r.deltaOI === 0 ? (
            <span className="text-textSecondary">—</span>
          ) : (
            <span className={dirInk(r.deltaOI > 0 ? Math.abs(r.deltaOIPct) : -Math.abs(r.deltaOIPct), marks.doiPct)}>
              {r.prevOI < 100 ? 'new' : <>{r.deltaOIPct > 0 ? '+' : '−'}{num(Math.abs(Math.round(r.deltaOIPct)))}%</>}
            </span>
          ),
      },
      { key: 'vol', header: `Vol ${dayLabel()}`, align: 'right', sortValue: r => r.volume, render: r => <span className={weightInk(r.volume, marks.vol)}>{num(r.volume)}</span> },
      { key: 'prevavg', header: `${shortDay(prevSessionIso())} close`, align: 'right', sortValue: r => r.prevAvgFill, render: r => <span className={weightInk(r.prevAvgFill, marks.prevAvg)}>${r.prevAvgFill.toFixed(2)}</span> },
      { key: 'streak', header: 'Streak', align: 'right', sortValue: r => r.oiStreak, render: r => (r.oiStreak === 0 ? <span className="text-textSecondary">—</span> : <span className={r.oiStreak >= 3 ? 'font-bold text-textPrimary' : 'text-textPrimary'}>{r.oiStreak}d</span>) },
      {
        key: 'earn',
        header: 'Earnings',
        align: 'right',
        sortValue: r => r.earnDays ?? 999,
        render: r => {
          const e = earnWords(r);
          return e ? <span className={r.earnDays! <= 5 ? 'text-warn' : 'text-textPrimary'} title={e.title}>{e.text}</span> : <span className="text-textSecondary">—</span>;
        },
      },
    ],
    [marks, cover]
  );

  const champs = useMemo(() => {
    const builds = rows.filter(r => r.deltaOI > 0 && ranked(r));
    const unwinds = rows.filter(r => r.deltaOI < 0 && ranked(r));
    const build = builds.reduce<BookContract | null>((a, r) => (a === null || r.deltaOI > a.deltaOI ? r : a), null);
    const unwind = unwinds.reduce<BookContract | null>((a, r) => (a === null || r.deltaOI < a.deltaOI ? r : a), null);
    const fastest = builds.filter(r => r.prevOI >= FASTEST_MIN_PREV_OI).reduce<BookContract | null>((a, r) => (a === null || r.deltaOIPct > a.deltaOIPct ? r : a), null);
    return { build, unwind, fastest };
  }, [rows, ranked]);
  const tooltips = useMemo(() => tooltipsFor(cover), [cover]);
  const pendingNote = oiPendingWords(cover);
  const pill = (r: BookContract, v: string) => `${r.ticker} ${r.strike}${r.right} · ${v}${stockLike(r) ? ' · stock-like' : ''}`;
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_footprints_cols');
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);
  const activeScreen = FOOTPRINT_SCREENS.find(s => s.key === screen) ?? FOOTPRINT_SCREENS[0];
  const screenOptions = useMemo<DropdownOption<FootprintScreenKey>[]>(() => FOOTPRINT_SCREENS.map(s => ({ value: s.key, label: s.label, hint: s.hint })), []);

  return (
    <>
      <TraceBox
        title="What the flow left standing"
        sub={`${activeScreen.label} · OI ${oiAfterWords(cover.day)}${pendingNote ? ` (${pendingNote})` : ''}`}
        testId="footprints"
        foldOnPhone
        data={{ screen, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the footprints', door: 'What open interest, a build and a streak mean', body: <FootprintsGuide />, testId: 'footprints-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Interest added · shed" testId="overnight" title={`Open interest built and unwound ${oiInWords(cover.day)}, single bets only${cutWord ? `, ${cutWord}` : ''}`}>
              {reading ? <span className="text-textMuted">—</span> : <><span className="text-bull">+{num(facts.added)}</span> <span className="text-textSecondary">·</span> <span className="text-bear">−{num(facts.shed)}</span></>}
            </Fact>
            <Fact label="Built · unwound" testId="contracts" title={facts.apart ? `${num(facts.apart)} packages, legs or crosses left out` : undefined}>
              {reading ? <span className="text-textMuted">—</span> : <>{num(facts.builds)} <span className="text-textSecondary">·</span> {num(facts.unwinds)}</>}
            </Fact>
            {champs.build && champs.build !== champs.fastest && (
              <Champion label="Biggest build" ink="bull" onOpen={() => setOpenKey(champs.build!.key)} testId="build">
                {pill(champs.build, `+${num(champs.build.deltaOI)}`)}
              </Champion>
            )}
            {champs.unwind && (
              <Champion label="Biggest unwind" ink="bear" onOpen={() => setOpenKey(champs.unwind!.key)} testId="unwind">
                {pill(champs.unwind, `−${num(Math.abs(champs.unwind.deltaOI))}`)}
              </Champion>
            )}
            {champs.fastest && (
              <Champion label="Fastest build" ink="supreme" title={`Largest % build among contracts with ${num(FASTEST_MIN_PREV_OI)}+ open interest before`} onOpen={() => setOpenKey(champs.fastest!.key)} testId="fastest">
                {pill(champs.fastest, `+${num(Math.round(champs.fastest.deltaOIPct))}% from ${num(champs.fastest.prevOI)}`)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <SessionMark at={bookPack.at} fault={bookPack.fault} paused={hold.paused} kept={bookPack.kept} />
            <FlowSearch value={query} onChange={setQuery} rows={book} countNoun="contracts" span />
            <DropdownSelect label="Screen" value={screen} options={screenOptions} onChange={setScreen} title="Which side of the overnight ledger" testId="footprints-cut" />
            <DropdownSelect label="Side" value={side} options={SIDE_OPTIONS} onChange={setSide} title="Calls, puts or both" testId="footprints-side" />
            <DropdownSelect label="Premium" value={prem} options={PREM_FLOOR_OPTIONS} onChange={v => addr.set({ prem: v })} title="The least money a contract carried in the session" testId="footprints-premium" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="One expiry, or every expiry" testId="footprints-expiry" />
            <SavedCutsControl store={FOOT_CUTS} query={addr.query} onOpen={addr.open} noun="cut" testId="footprints" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={FOOT_CUTS} query="" onOpen={addr.open} noun="cut" testId="footprints" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-t11 text-textSecondary">
                {cuts.said}
              </p>
            )}
          </>
        }
        lead={reading ? `Reading ${bookWord}…` : facts.builds + facts.unwinds === 0 ? `No open interest changed ${oiInWords(cover.day)}.` : `${num(facts.builds)} contracts built (+${num(facts.added)}), ${num(facts.unwinds)} unwound (−${num(facts.shed)}) ${oiInWords(cover.day)}.`}
        detail={
          <>
            {read}
            <TermLine keys={['standing', 'doi', 'oiDay', 'stockLike']} testId="footprints" />
          </>
        }
      >
        <TraceGrid rows={rows} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={tooltips} rowKey={keyOf} onRowClick={openRow} selectedKey={openKey} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight onVisible={pairOiFor} endless={endlessOf(bookPack.older, bookPack.name ? `${bookPack.name} contracts` : 'contracts', 'the list for the day is done', hold.paused, 'Load more ↓')} emptyText={query.trim() && book.length > 0 ? searchMiss(query, 'contract') : reading ? 'Reading the book…' : bookPack.fault && heldBook.length === 0 ? 'This read did not land — the footprints fill when the book answers' : 'No open interest moved on this cut'} testId="footprints" />
      </TraceBox>

      <BookDrill list={loudest && !rows.some(r => r.key === loudest.key) ? [loudest, ...rows] : rows} openKey={openKey} onOpen={setOpenKey} />
    </>
  );
};

export default Footprints;
