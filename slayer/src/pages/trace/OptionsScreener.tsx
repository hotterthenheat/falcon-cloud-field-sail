/* The Screener: the day's option book asked one question at a time. Screens are questions, not judgments; a row opens
   the contract's card. The whole screen lives in the address (data/screenerViews.ts). */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { filtersToParams, paramsToFilters, screenerCuts } from '../../data/screenerViews';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { useTicker } from '../../context/MarketDataContext';
import { fmtCount as num, pairOiFor, useContracts, usd as fmtUsd } from '../../data/traceLive';
import { FeedFallback, TickFigure } from '../../components/ui/liveRead';
import { applyFilters, bookFacts, bookLeanWords, crossHint, doiTail, floorPackaged, SPREAD_LEG_PCT, FRESH_VOL_OI, notABet, spreadLegHint, stockLike, volOiText, FLOW_SCREENS, runScreen, type BookFilters, type ScreenKey } from '../../data/flowBook';
import { SLEEVES, type SleeveKey } from '../../types/compass';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti from '../../components/ui/DropdownMulti';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell, { OtmCell, otmSortValue } from '../../components/trace/ContractCell';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import FlowSearch, { CONTRACT_FORMATS, matchesContract, normSymbol, searchedName, useSearchedName } from '../../components/trace/FlowSearch';
import { LiveHold, SessionMark, useHold } from '../../components/trace/LiveHold';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import LeanCell from '../../components/trace/LeanCell';
import { dayAdv, oiAfterWords, oiCoverOf, oiInWords, oiLags, oiPendingWords, oiRowTitle, shortDay } from '../../components/trace/dayWords';
import { SectorName } from '../../components/trace/SectorMark';
import WatchStar from '../../components/trace/WatchStar';
import TermLine from '../../components/trace/TermLine';
import TraceBox, { Champion, endlessOf, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { ScreenerGuide } from '../../components/trace/TraceGuide';
import { contractKey, watchContract } from '../../context/WatchContext';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import { pctSigned } from '../../core/format';
import OpeningTag from '../../components/trace/OpeningTag';

/* the whole screen is kept, as the address it is — a reopened page comes back as it was left */
const SCREEN_KEY = 'slayer_screener_screen_v2';

function loadScreen(): URLSearchParams {
  try {
    return new URLSearchParams(localStorage.getItem(SCREEN_KEY) ?? '');
  } catch {
    return new URLSearchParams();
  }
}

const PIN_LEFT = ['time', 'ticker', 'contract'];
const PIN_RIGHT = ['prem'];

const phoneRow = (r: BookContract) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />}
    title={
      <>
        <CompanyLogo ticker={r.ticker} size={15} />
        <span className="font-bold">{r.ticker}</span>
        <span className="font-bold tnum">{r.strike}</span>
        <span className={r.right === 'C' ? 'text-bull' : 'text-bear'}>{r.right === 'C' ? 'call' : 'put'}</span>
        <span className="text-t11 text-textSecondary tnum">{r.expiry.slice(0, 5)}</span>
      </>
    }
    aside={`${r.lastAt} ET`}
    figures={[
      <span key="p" className="font-semibold text-textPrimary">
        {fmtUsd(r.premium)}
      </span>,
      <span key="v">{num(r.volume)} vol</span>,
      <span key="l">{bookLeanWords(r)}</span>,
    ]}
  />
);

const SIDE_OPTIONS: DropdownOption<BookFilters['side']>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
const VOLUME_STEPS = [0, 1_000, 5_000, 25_000, 100_000];
const VOLUME_OPTIONS: DropdownOption<number>[] = [
  { value: 0, label: 'Any volume', hint: 'Every contract that traded' },
  { value: 1_000, label: '1K and up', hint: 'At least 1,000 contracts' },
  { value: 5_000, label: '5K and up', hint: 'At least 5,000 contracts' },
  { value: 25_000, label: '25K and up', hint: 'At least 25,000 contracts' },
  { value: 100_000, label: '100K and up', hint: 'The heaviest only' },
];
const PREMIUM_STEPS = [0, 100_000, 1_000_000, 10_000_000];
const PREMIUM_OPTIONS: DropdownOption<number>[] = [
  { value: 0, label: 'Any premium', hint: 'Whatever the money' },
  { value: 100_000, label: '$100K and up', hint: 'At least $100K' },
  { value: 1_000_000, label: '$1M and up', hint: 'At least $1M' },
  { value: 10_000_000, label: '$10M and up', hint: 'At least $10M' },
];
const MONEY_OPTIONS: DropdownOption<'any' | 'otm'>[] = [
  { value: 'any', label: 'Any', hint: 'In and out of the money' },
  { value: 'otm', label: 'Out of the money', hint: 'Strikes past the stock only' },
];
const snap = (v: number, steps: number[]) => steps.reduce((best, s) => (s <= v ? s : best), 0);

/* each width is a floor; the set at rest fits a 1440 box, and the folded columns are one click away in Columns */
const WIDTHS: Record<string, number> = { time: 76, ticker: 84, contract: 132, dte: 56, otm: 70, last: 140, vol: 84, oi: 80, doi: 120, prem: 84, iv: 92, voloi: 66, sweep: 60, floor: 64, multi: 64, sector: 176, lean: 132 };
const TOOLTIPS: Record<string, string> = {
  time: 'When the contract last printed, New York',
  contract: 'Strike, side and expiry — click the row for the card',
  otm: 'Out of the money by this much of the spot, calls and puts alike',
  voloi: 'Volume over the open interest the session opened on; 1.5+ means positions built today',
  vol: "The screener's day volume, as of the last fill",
  last: 'The last fill and the change on the previous close; its New York time is the row’s Time',
  sweep: 'Share of the volume swept across exchanges',
  floor: 'Share that printed on the floor',
  multi: 'Share that traded as legs of multi-leg orders',
  lean: 'The side holding 55%+ of the sided contracts, with half the day on a side',
  iv: 'Implied volatility, and its change on the day',
};

const OptionsScreener = () => {
  const { activeTicker } = useTicker();
  const [params, setParams] = useSearchParams();

  /* every card reads the query string and writes it back (replace, not push); a link wins over the stored screen */
  const validTenors = useMemo(() => SLEEVES.map(x => x.key), []);
  const here = useMemo(() => paramsToFilters(params, validTenors), [params, validTenors]);
  const screen: ScreenKey = here.screen && FLOW_SCREENS.some(x => x.key === here.screen) ? (here.screen as ScreenKey) : 'active';
  const filters = here.filters;
  const query = here.query;
  const expiryPick = here.expiry;
  const write = useCallback((f: BookFilters, s: ScreenKey, q: string, e: string | null) => setParams(filtersToParams(f, s === 'active' ? undefined : s, q || undefined, e), { replace: true }), [setParams]);
  const setScreen = (s: ScreenKey) => write(filters, s, query, expiryPick);
  const setFilters = (fn: (f: BookFilters) => BookFilters) => write(fn(filters), screen, query, expiryPick);
  const setQuery = (q: string) => write(filters, screen, q, expiryPick);
  const setExpiryPick = (e: string | null) => write(filters, screen, query, e);
  const cutQuery = useDeferredValue(query);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const cuts = useSavedCuts();

  const screenQuery = filtersToParams(filters, screen === 'active' ? undefined : screen, query || undefined, expiryPick).toString();
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    if (here.any) return;
    const stored = loadScreen();
    if ([...stored.keys()].length) setParams(stored, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!booted.current) return;
    try {
      localStorage.setItem(SCREEN_KEY, screenQuery);
    } catch {
      /* private mode: the screen does not persist */
    }
  }, [screenQuery]);

  /* every unusual screen reads the vendor's one unusual list; Most active is asked by volume */
  const unusual = screen === 'bullish' || screen === 'bearish' || screen === 'fresh' || screen === 'conviction-calls' || screen === 'conviction-puts';
  const askedName = useSearchedName(query);
  const hottest = useContracts(false, screen === 'active' ? 'stock' : null, screen === 'active' ? 'volume' : 'premium', askedName, !unusual);
  const unusualBook = useContracts(true, null, 'premium', askedName, unusual);
  const pack = unusual ? unusualBook : hottest;
  const liveBook = pack.rows;
  const hold = useHold(liveBook, activeTicker, !(pack.waiting && liveBook.length === 0));
  const heldBook = hold.value;
  /* the calendar offers only the dates the screen and filters leave */
  const screened = useMemo(() => applyFilters(runScreen(heldBook, screen), filters), [heldBook, screen, filters]);
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(screened, r => r.expiry, { value: expiryPick, onChange: setExpiryPick });
  const book = useMemo(() => cutExpiry(heldBook), [heldBook, cutExpiry]);
  const keyOf = useCallback((r: { key: string }) => r.key, []);
  const openRow = useCallback((r: { key: string }) => setOpenKey(r.key), []);

  const rows = useMemo(() => {
    const cut = applyFilters(runScreen(book, screen), filters);
    return normSymbol(cutQuery) === '' ? cut : cut.filter(r => matchesContract(cutQuery, r));
  }, [book, screen, filters, cutQuery]);

  const oiCover = useMemo(() => oiCoverOf(rows), [rows]);
  const tooltips = useMemo(
    () => ({
      ...TOOLTIPS,
      oi: `Open interest ${oiAfterWords(oiCover.day)}${oiPendingWords(oiCover) ? `; ${oiPendingWords(oiCover)}` : ''}`,
      doi: `Built or unwound ${oiInWords(oiCover.day)}; a row marked with an earlier day is still on the count before`,
    }),
    [oiCover]
  );
  const marks = useMemo(() => ({ vol: earnMarks(rows, r => r.volume), oi: earnMarks(rows, r => r.oi), doi: earnMarks(rows, r => r.deltaOI), prem: earnMarks(rows, r => r.premium) }), [rows]);

  /* floor packages, days of spread legs and days of crosses are counted apart, never in the head's money */
  const facts = useMemo(() => bookFacts(rows), [rows]);
  const bookReading = (pack.waiting && liveBook.length === 0) || searchedName(query) !== askedName;
  const champs = useMemo(() => {
    const by = (pick: (r: BookContract) => boolean) => rows.filter(r => !notABet(r) && pick(r)).reduce<BookContract | null>((a, r) => (a === null || r.premium > a.premium ? r : a), null);
    const packaged = rows.filter(notABet).reduce<BookContract | null>((a, r) => (a === null || r.premium > a.premium ? r : a), null);
    return { call: by(r => r.right === 'C'), put: by(r => r.right === 'P'), all: by(() => true), packaged };
  }, [rows]);
  const sentence = useMemo(() => {
    if (bookReading) return 'Reading the book…';
    if (rows.length === 0) return query ? `Nothing on this cut for "${query}" — search a name, or a contract like ${CONTRACT_FORMATS}.` : 'Nothing on this cut.';
    const apartWords = facts.apart ? ` ${num(facts.apart)} packages, spread legs or crosses (${fmtUsd(facts.apartPrem)}) are left out — not bets.` : '';
    return `${fmtUsd(facts.prem)} across ${num(facts.bets)} contracts on ${num(facts.names)} names — calls ${facts.callPct}%, puts ${100 - facts.callPct}%.${apartWords} ${num(facts.fresh)} traded 1.5× their open interest or more ${dayAdv()}.`;
  }, [rows.length, facts, bookReading, query]);
  /* an empty cut names the cards that emptied it */
  const emptyText = useMemo(() => {
    const on: string[] = [];
    if (screen !== 'active') on.push(`the screen (${FLOW_SCREENS.find(x => x.key === screen)?.label})`);
    if (filters.side !== 'ALL') on.push('the side');
    if (filters.tenors.length) on.push('the tenor');
    if (filters.minVolume > 0) on.push('the volume floor');
    if (filters.minPremium > 0) on.push('the premium floor');
    if (filters.excludeItm) on.push('the moneyness');
    if (expiry) on.push('the expiry');
    if (query) on.push('the search');
    if (on.length === 1 && query) return `No contract on this list matches “${query}” — search a name, or a contract like ${CONTRACT_FORMATS}`;
    return on.length ? `No contract fits all of these: ${on.join(', ')} — loosen one` : 'Nothing has traded on the book';
  }, [screen, filters, expiry, query]);
  const activeScreen = FLOW_SCREENS.find(s => s.key === screen) ?? FLOW_SCREENS[0];
  const pill = (r: BookContract) => `${r.ticker} ${r.strike}${r.right} · ${fmtUsd(r.premium)}${stockLike(r) ? ' · stock-like' : ''}`;

  const columns = useMemo<Column<BookContract>[]>(
    () => [
      {
        key: 'time',
        header: 'Time ET',
        sortValue: r => r.lastAtMin,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />
            <span className="text-t11 text-textPrimary">{r.lastAt}</span>
          </span>
        ),
      },
      {
        key: 'ticker',
        header: 'Ticker',
        sortValue: r => r.ticker,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <CompanyLogo ticker={r.ticker} size={15} />
            <span className="font-bold text-textPrimary">{r.ticker}</span>
          </span>
        ),
      },
      { key: 'contract', header: 'Contract', align: 'right', sortValue: r => r.strike, render: r => <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} stack /> },
      { key: 'dte', header: 'DTE', align: 'right', sortValue: r => r.dte, render: r => <span className="text-textPrimary">{r.dte}d</span> },
      { key: 'otm', header: 'OTM %', align: 'right', sortValue: r => otmSortValue(r.otmPct), render: r => <OtmCell otmPct={r.otmPct} ticker={r.ticker} spot={r.spot} /> },
      {
        key: 'last',
        header: 'Fill · Chg',
        align: 'right',
        sortValue: r => (Number.isFinite(r.chgPct) ? r.chgPct : -Infinity),
        /* the fill over its change: the column is the figure's width, so the grid fits a 1280 screen. Its time is the
           row's Time (the same last print), so it is not said twice */
        render: r => (
          <span className="inline-flex flex-col items-end align-middle leading-tight text-textPrimary whitespace-nowrap" title={r.lastAt && r.lastAt !== '—' ? `Filled at ${r.lastAt} ET` : undefined}>
            <span>${r.last.toFixed(2)}</span>
            {Number.isFinite(r.chgPct) ? <span className={`text-t11 ${r.chgPct >= 0 ? 'text-bull dir-up' : 'text-bear dir-down'}`}>{pctSigned(r.chgPct, 1)}</span> : <span className="text-t11 text-textMuted">new</span>}
          </span>
        ),
      },
      { key: 'vol', header: 'Vol', align: 'right', sortValue: r => r.volume, render: r => <span className={weightInk(r.volume, marks.vol)}>{num(r.volume)}</span> },
      { key: 'oi', header: 'OI', align: 'right', sortValue: r => r.oi, render: r => <span className={weightInk(r.oi, marks.oi)} title={oiRowTitle(r)}>{num(r.oi)}</span> },
      {
        key: 'doi',
        header: 'ΔOI',
        align: 'right',
        sortValue: r => r.deltaOI,
        render: r => {
          /* a row still on the count before names its day, in plain ink */
          const lag = oiLags(r, oiCover) && r.oiDay ? <span className="mr-1 text-t11 text-textMuted">{shortDay(r.oiDay)}</span> : null;
          if (r.deltaOI === 0) return <span className="text-textSecondary" title={oiRowTitle(r)}>{lag}—</span>;
          const a = Math.abs(r.deltaOI);
          const tone = lag ? 'text-textPrimary' : a >= marks.doi.top ? 'text-supreme font-bold' : a >= marks.doi.bar ? (r.deltaOI > 0 ? 'text-bull dir-up' : 'text-bear dir-down') : 'text-textPrimary';
          const tail = doiTail(r);
          /* the change over its share (and the day a lagging count is on): the column is the figure's width */
          return (
            <span className={`inline-flex flex-col items-end align-middle leading-tight whitespace-nowrap ${tone}`} title={oiRowTitle(r)}>
              <span>
                {r.deltaOI > 0 ? '+' : '−'}
                {num(a)}
              </span>
              {(lag || tail) && (
                <span className="text-t11">
                  {lag}
                  {tail}
                </span>
              )}
            </span>
          );
        },
      },
      { key: 'prem', header: 'Prem', align: 'right', sortValue: r => r.premium, render: r => <span className={weightInk(r.premium, marks.prem)}><TickFigure value={r.premium}>{fmtUsd(r.premium)}</TickFigure></span> },
      {
        key: 'iv',
        header: 'IV · chg',
        align: 'right',
        sortValue: r => r.iv,
        render: r =>
          r.iv > 0 ? (
            /* the level over its change on the day */
            <span className="inline-flex flex-col items-end align-middle leading-tight text-textPrimary whitespace-nowrap">
              <span>{r.iv.toFixed(0)}%</span>
              <span className={`text-t11 ${r.ivChg >= 0 ? 'text-bull dir-up' : 'text-bear dir-down'}`}>
                {r.ivChg >= 0 ? '+' : '−'}
                {Math.abs(r.ivChg).toFixed(Math.abs(r.ivChg) >= 100 ? 0 : 1)}
              </span>
            </span>
          ) : (
            <span className="text-textMuted">—</span>
          ),
      },
      { key: 'voloi', header: 'Vol/OI', align: 'right', sortValue: r => r.volOverOI, render: r => <span className={`inline-flex flex-col items-end gap-[2px] leading-none align-middle [&>[data-likely-opening]]:ml-0 font-mono tnum ${r.volOverOI >= FRESH_VOL_OI ? 'font-bold text-textPrimary' : 'text-textPrimary'}`} title={r.volOverOI > 0 || !(r.volume > 0) ? undefined : 'No open interest before the session — a new contract'}>{volOiText(r)}<OpeningTag flag={r.likelyOpening} volume={r.volume} oi={r.oi} /></span> },
      { key: 'sweep', header: 'Sweep', align: 'right', sortValue: r => r.sweepPct, render: r => <span className={r.sweepPct >= 40 ? 'font-semibold text-textPrimary' : 'text-textPrimary'}>{Math.round(r.sweepPct)}%</span> },
      { key: 'floor', header: 'Floor', align: 'right', sortValue: r => r.floorPct, render: r => (r.floorPct === 0 ? <span className="text-textSecondary">—</span> : <span className={r.floorPct >= 50 ? 'text-textPrimary font-bold' : 'text-textPrimary'}>{Math.round(r.floorPct)}%</span>) },
      { key: 'multi', header: 'Multi', align: 'right', sortValue: r => r.multiPct, render: r => <span className={r.multiPct >= 30 ? 'font-semibold text-textPrimary' : 'text-textPrimary'}>{Math.round(r.multiPct)}%</span> },
      { key: 'lean', header: 'Lean', align: 'right', sortValue: r => r.askPct, render: r => <LeanCell askPct={r.askPct} split={r.sideVol} legsPct={r.multiPct} crossPct={r.crossPct} /> },
      { key: 'sector', header: 'Sector', sortValue: r => r.sector ?? '', render: r => <SectorName sector={r.sector} /> },
    ],
    [marks, oiCover]
  );

  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_screener_cols_v3', ['floor', 'multi', 'sector', 'dte', 'oi']);
  const pool = bookReading ? 'reading the book…' : unusual ? `${num(liveBook.length)} unusual contracts loaded` : `${num(liveBook.length)} ${screen === 'active' ? 'single-stock ' : ''}contracts loaded`;
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);
  const screenOptions = useMemo<DropdownOption<ScreenKey>[]>(() => FLOW_SCREENS.map(s => ({ value: s.key, label: s.label, hint: s.hint })), []);
  const tenorGroups = useMemo(() => [{ title: 'Tenor', options: SLEEVES.map(s => ({ value: s.key, label: s.label, hint: s.blurb })) }], []);
  const openCut = (q: string) => setParams(new URLSearchParams(q), { replace: true });
  const leadLine = bookReading ? 'Reading the book…' : rows.length === 0 ? sentence : `${fmtUsd(facts.prem)} traded ${dayAdv()} on ${num(facts.bets)} contracts — ${facts.callPct}% calls, ${100 - facts.callPct}% puts.`;
  const apartTitle = (r: BookContract) => (floorPackaged(r) ? `${Math.round(r.floorPct)}% floor-traded packages — the shape of compression, not a bet` : r.multiPct >= SPREAD_LEG_PCT ? spreadLegHint(r) : crossHint(r));

  return (
    <>
      <TraceBox
        title="The book"
        sub={`${activeScreen.label} — ${activeScreen.hint} · ${pool}`}
        testId="screener"
        foldOnPhone
        data={{ screen, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the book', door: 'What a row, the inks and the shares mean', body: <ScreenerGuide />, testId: 'screener-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Premium" testId="premium" title={facts.apart ? `Single bets only; ${num(facts.apart)} packages, legs or crosses (${fmtUsd(facts.apartPrem)}) left out` : 'The day premium on this cut'}>
              {bookReading ? <span className="text-textMuted">Reading…</span> : fmtUsd(facts.prem)}
              {facts.prem > 0 && (
                <>
                  {' '}
                  <span className="text-textSecondary">·</span> <span className="text-bull">calls {facts.callPct}%</span> <span className="text-textSecondary">/</span> <span className="text-bear">puts {100 - facts.callPct}%</span>
                </>
              )}
            </Fact>
            <Fact label="Contracts" testId="contracts" title="Single bets on this cut and the names they span">
              {bookReading ? <span className="text-textMuted">Reading…</span> : <>{num(facts.bets)} <span className="text-textSecondary">· {facts.names} names</span></>}
            </Fact>
            <Fact label="Vol ≥ 1.5× OI" testId="fresh" title="Single bets whose volume is 1.5× the open interest the session opened on or more">
              {bookReading ? <span className="text-textMuted">Reading…</span> : facts.fresh}
            </Fact>
            {champs.call && champs.call !== champs.all && (
              <Champion label="Top call" ink="plain" title="The most premium among the calls, single bets only" onOpen={() => setOpenKey(champs.call!.key)} testId="top-call">
                {pill(champs.call)}
              </Champion>
            )}
            {champs.put && champs.put !== champs.all && (
              <Champion label="Top put" ink="plain" title="The most premium among the puts, single bets only" onOpen={() => setOpenKey(champs.put!.key)} testId="top-put">
                {pill(champs.put)}
              </Champion>
            )}
            {champs.all && (
              <Champion label="Largest" ink="supreme" title={`The most premium on ${screen === 'active' ? 'single stocks' : unusual ? 'the unusual list' : 'every name, index included'}, single bets only`} onOpen={() => setOpenKey(champs.all!.key)} testId="largest">
                {pill(champs.all)}
              </Champion>
            )}
            {champs.packaged && (!champs.all || champs.packaged.premium > champs.all.premium) && (
              <Champion label="Not a bet" ink="plain" title={`More premium, but ${apartTitle(champs.packaged)}`} onOpen={() => setOpenKey(champs.packaged!.key)} testId="packaged">
                {pill(champs.packaged)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            <SessionMark at={pack.at} fault={pack.fault} paused={hold.paused} kept={pack.kept} />
            <FlowSearch value={query} onChange={setQuery} rows={book} countNoun="contracts" span />
            <DropdownSelect label="Screen" value={screen} options={screenOptions} onChange={setScreen} title="The question asked of the book" testId="screener-screen" />
            <DropdownSelect label="Side" value={filters.side} options={SIDE_OPTIONS} onChange={v => setFilters(f => ({ ...f, side: v }))} title="Calls, puts or both" testId="screener-side" />
            <DropdownMulti label="Tenor" values={filters.tenors} groups={tenorGroups} onChange={v => setFilters(f => ({ ...f, tenors: v.length >= SLEEVES.length ? [] : (v as SleeveKey[]) }))} title="How far out the contracts run" emptyWord="Any" align="start" testId="screener-tenor" />
            <DropdownSelect label="Volume" value={snap(filters.minVolume, VOLUME_STEPS)} options={VOLUME_OPTIONS} onChange={v => setFilters(f => ({ ...f, minVolume: v }))} title="The least volume a contract must carry" testId="screener-volume" />
            <DropdownSelect label="Premium" value={snap(filters.minPremium, PREMIUM_STEPS)} options={PREMIUM_OPTIONS} onChange={v => setFilters(f => ({ ...f, minPremium: v }))} title="The least money a contract must carry" testId="screener-premium" />
            <DropdownSelect label="Moneyness" value={filters.excludeItm ? 'otm' : 'any'} options={MONEY_OPTIONS} onChange={v => setFilters(f => ({ ...f, excludeItm: v === 'otm' }))} title="Where the strikes sit against the stock" testId="screener-money" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="One expiry, or every expiry" testId="screener-expiry" />
            <SavedCutsControl store={screenerCuts} query={screenQuery} onOpen={openCut} noun="screen" testId="screener" onSay={cuts.say} open={cuts.open} onToggleOpen={cuts.toggle} />
            <div className="ml-auto">
              <ColumnChooser columns={chooserCols} hidden={hidden} onToggle={toggle} onAll={showAll} onNone={() => hideAll(columns.map(c => c.key))} />
            </div>
          </>
        }
        sentence={
          <>
            <SavedCutsList store={screenerCuts} query="" onOpen={openCut} noun="screen" testId="screener" onSay={cuts.say} open={cuts.open} />
            {cuts.said && (
              <p role="status" className="mb-2 font-mono text-t11 text-textSecondary" data-screener-said>
                {cuts.said}
              </p>
            )}
          </>
        }
        lead={leadLine}
        detail={
          <>
            <RichRead text={sentence} />
            <TermLine keys={['floor', 'spreadLegs', 'volOi', 'doi', 'stockLike', 'oiDay']} testId="screener" />
          </>
        }
      >
        <TraceGrid rows={rows} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={tooltips} rowKey={keyOf} onRowClick={openRow} selectedKey={openKey} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight onVisible={pairOiFor} endless={endlessOf(pack.older, 'contracts', "the feed's list for the day is done", hold.paused, 'Load more ↓')} emptyText={bookReading ? 'Reading the book…' : pack.fault && liveBook.length === 0 ? 'This read did not land — the book fills when the feed answers' : emptyText} testId="screener" />
        {pack.fault && rows.length === 0 ? <FeedFallback fault={pack.fault} /> : null}
      </TraceBox>
      <BookDrill list={rows} openKey={openKey} onOpen={setOpenKey} />
    </>
  );
};

export default OptionsScreener;
