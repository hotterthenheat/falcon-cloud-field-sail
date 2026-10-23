/*
==================================================
  SLAYER TERMINAL - THE SCREENER (Trace)

  The whole day's option book, asked questions
  (Noah, 2026-08-30; walked into the house grammar
  2026-09-09): one box — the head with the book's
  facts and its champions, one line of cards
  (Screen · Side · Tenor · Volume · Premium ·
  Moneyness · Expiry) beside the live hold, the
  search, Link and Save and the column chooser, the
  sentence, then every contract in the house grid.
  Screens are QUESTIONS, not judgments: a row opens
  the contract's card, and THERE the one state
  engine grades it.

  THE PARTNER'S LAYOUT (Noah, 2026-10-13): the
  time, the ticker and the contract stand still at
  the left while the rest scrolls, the premium at
  the right; the whole screen — the screen, the
  filters, the search, the expiry — lives in the
  address (data/screenerViews.ts), so Link and
  Save work and a reopened page comes back whole;
  an Expiry card that offers only the dates the
  other cards leave; two-line rows on a phone.
==================================================
*/

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { filtersToParams, paramsToFilters, screenerCuts } from '../../data/screenerViews';
import { SavedCutsControl, SavedCutsList, useSavedCuts } from '../../components/trace/SavedCuts';
import { useMarketData } from '../../context/MarketDataContext';
import { dayLean, useContracts, usd as fmtUsd } from '../../data/traceLive';
import { FLOW_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { applyFilters, floorPackaged, FLOW_SCREENS, runScreen, type BookFilters, type ScreenKey } from '../../data/flowBook';
import { SLEEVES, type SleeveKey } from '../../types/compass';
import type { BookContract } from '../../types/trace';
import type { Column } from '../../components/ui/DataTable';
import CompanyLogo from '../../components/ui/CompanyLogo';
import RichRead from '../../components/ui/RichRead';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownMulti from '../../components/ui/DropdownMulti';
import BookDrill from '../../components/trace/BookDrill';
import ContractCell from '../../components/trace/ContractCell';
import { earnMarks, weightInk } from '../../components/trace/earnedInk';
import FlowSearch, { normSymbol } from '../../components/trace/FlowSearch';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import LeanCell from '../../components/trace/LeanCell';
import { SectorName } from '../../components/trace/SectorMark';
import WatchStar from '../../components/trace/WatchStar';
import TraceBox, { Champion, Fact, PhoneRow, TraceGrid } from '../../components/trace/TraceBox';
import { ScreenerGuide } from '../../components/trace/TraceGuide';
import { contractKey, watchContract } from '../../context/WatchContext';
import ExpiryCalendar from '../../components/ui/ExpiryCalendar';
import { useExpiryCut } from '../../components/trace/bookExpiry';
import { isoDate } from '../../core/calendar';
import { pctSigned } from '../../core/format';

/* ALL OR NONE: the filters were kept and the screen, the search and the expiry were not, so a reopened page came back
   "Weekly, Swing +1" with no word why. The whole screen is kept now, as the address it is. */
const SCREEN_KEY = 'slayer_screener_screen_v2';
const num = (v: number) => v.toLocaleString('en-US');

function loadScreen(): URLSearchParams {
  try {
    return new URLSearchParams(localStorage.getItem(SCREEN_KEY) ?? '');
  } catch {
    return new URLSearchParams();
  }
}

const PIN_LEFT = ['time', 'ticker', 'contract'];
const PIN_RIGHT = ['prem'];

/** The day's side in words */
const leanWords = (r: BookContract) => {
  const l = dayLean(r);
  return l.lean === 'ASK' ? `ask ${Math.round(l.ask)}%` : l.lean === 'BID' ? `bid ${Math.round(l.bid)}%` : l.lean === 'UNSIDED' ? (Number.isFinite(l.mid) ? `mid/no side ${Math.round(l.mid)}%` : '—') : 'even';
};

/** A contract's day on a phone */
const phoneRow = (r: BookContract) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />}
    title={
      <>
        <span className="font-bold">{r.ticker}</span>
        <span className="font-bold tnum">{r.strike}</span>
        <span className={r.right === 'C' ? 'text-bull' : 'text-bear'}>{r.right === 'C' ? 'call' : 'put'}</span>
        <span className="text-[11px] text-textSecondary tnum">{r.expiry.slice(0, 5)}</span>
      </>
    }
    aside={r.lastAt}
    figures={[
      <span key="p" className="font-semibold text-textPrimary">
        {fmtUsd(r.premium)}
      </span>,
      <span key="v">{num(r.volume)} vol</span>,
      <span key="l">{leanWords(r)}</span>,
    ]}
  />
);

/* THE CARDS — the filters popover's chips and number boxes as labelled cards (the approved look) */
const SIDE_OPTIONS: DropdownOption<BookFilters['side']>[] = [
  { value: 'ALL', label: 'Both', hint: 'Calls and puts' },
  { value: 'C', label: 'Calls', hint: 'Calls only' },
  { value: 'P', label: 'Puts', hint: 'Puts only' },
];
const VOLUME_STEPS = [0, 1_000, 5_000, 25_000, 100_000];
const VOLUME_OPTIONS: DropdownOption<number>[] = [
  { value: 0, label: 'Any volume', hint: 'Every contract that traded' },
  { value: 1_000, label: '1K and up', hint: 'At least a thousand contracts' },
  { value: 5_000, label: '5K and up', hint: 'At least five thousand' },
  { value: 25_000, label: '25K and up', hint: 'At least twenty-five thousand' },
  { value: 100_000, label: '100K and up', hint: 'The heaviest names only' },
];
const PREMIUM_STEPS = [0, 100_000, 1_000_000, 10_000_000];
const PREMIUM_OPTIONS: DropdownOption<number>[] = [
  { value: 0, label: 'Any premium', hint: 'Whatever the money' },
  { value: 100_000, label: '$100K and up', hint: 'At least a hundred thousand dollars' },
  { value: 1_000_000, label: '$1M and up', hint: 'At least a million' },
  { value: 10_000_000, label: '$10M and up', hint: 'Ten million and more' },
];
const MONEY_OPTIONS: DropdownOption<'any' | 'otm'>[] = [
  { value: 'any', label: 'Any', hint: 'In and out of the money' },
  { value: 'otm', label: 'Out of the money', hint: 'Strikes past the stock only' },
];
const snap = (v: number, steps: number[]) => steps.reduce((best, s) => (s <= v ? s : best), 0);

/** The grid's own widths where flex would starve a cell */
const WIDTHS: Record<string, number> = { time: 92, ticker: 96, contract: 168, dte: 64, otm: 76, last: 168, doi: 124, prem: 92, iv: 124, sector: 176, lean: 96 };
const TOOLTIPS: Record<string, string> = {
  time: 'When the contract last printed, New York — the bookmark tracks it in the Tracker',
  contract: 'The strike, the side and the expiry — click the row for the card',
  otm: 'How far the strike sits from the stock, as a percent',
  voloi: 'Volume over open interest — above 1.5 the positions were built today',
  sweep: 'The share of the volume that swept across exchanges',
  floor: 'The share that printed on the floor — worked orders',
  multi: 'The share that was a leg of a multi-leg structure',
  lean: 'Whether the volume paid the ask or hit the bid',
};

const OptionsScreener = () => {
  const { marketData, activeTicker } = useMarketData();
  const [params, setParams] = useSearchParams();

  /* THE ADDRESS IS THE SCREEN (the partner's page kept the screen in state and mirrored it to the address through two
     effects; at boot with a stored screen the two fell out of step — "New positioning" beside Side "Both" — and a chip
     press then wiped the cut). Every card reads the query string and writes it back, as the other pages do through
     useAddressCut; `replace` rather than push, so tuning a filter is not twenty Back presses. THE URL WINS OVER THE
     STORED SCREEN: a link someone was SENT is a more specific instruction than what this reader looked at last. A bare
     address starts from the stored screen, once, at boot. */
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
  /* the field answers first; the grid's cut follows as a lower-priority render (2026-09-20) */
  const cutQuery = useDeferredValue(query);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const cuts = useSavedCuts();

  /* the screen in its canonical spelling — what Link copies and Save keeps */
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
      /* private mode — the screen just doesn't persist */
    }
  }, [screenQuery]);

  const unusual = screen === 'bullish' || screen === 'fresh' || screen === 'conviction-calls';
  /* MOST ACTIVE IS ASKED BY VOLUME (the audit, 2026-10-22: it asked the vendor for premium order under "heaviest volume first") */
  const hottest = useContracts(false, screen === 'active' ? 'stock' : null, screen === 'active' ? 'volume' : 'premium');
  const unusualBook = useContracts(true);
  const pack = unusual ? unusualBook : hottest;
  const liveBook = pack.rows;
  /* ONE hold for the whole page: paused, the book AND the tick freeze together */
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker);
  const { book: heldBook, tick } = hold.value;
  /* THE EXPIRY CUT: the dates on the book, as a calendar. THE CALENDAR OFFERS WHAT THE OTHER CARDS LEAVE: its dates
     come from the book under the screen and the filters, so it never offers a day the other cards have already shut out */
  const screened = useMemo(() => applyFilters(runScreen(heldBook, screen), filters), [heldBook, screen, filters]);
  const { expiry, setExpiry, expiries, cut: cutExpiry, chosen } = useExpiryCut(screened, r => r.expiry, { value: expiryPick, onChange: setExpiryPick });
  const book = useMemo(() => cutExpiry(heldBook), [heldBook, cutExpiry]);
  const keyOf = useCallback((r: { key: string }) => r.key, []);
  const openRow = useCallback((r: { key: string }) => setOpenKey(r.key), []);

  const rows = useMemo(() => {
    const cut = applyFilters(runScreen(book, screen), filters);
    const nq = normSymbol(cutQuery);
    return nq === '' ? cut : cut.filter(r => normSymbol(`${r.ticker}${r.strike}${r.right}`).includes(nq));
  }, [book, screen, filters, cutQuery]);

  /* Three registers per column — see components/trace/earnedInk.ts */
  const marks = useMemo(() => ({ vol: earnMarks(rows, r => r.volume), oi: earnMarks(rows, r => r.oi), doi: earnMarks(rows, r => r.deltaOI), prem: earnMarks(rows, r => r.premium) }), [rows]);

  const facts = useMemo(() => {
    let prem = 0;
    let callPrem = 0;
    let fresh = 0;
    const names = new Set<string>();
    for (const r of rows) {
      prem += r.premium;
      if (r.right === 'C') callPrem += r.premium;
      if (r.volOverOI >= 1.5) fresh++;
      names.add(r.ticker);
    }
    return { prem, callPct: Math.round((callPrem / Math.max(1, prem)) * 100), fresh, names: names.size };
  }, [rows]);
  const champs = useMemo(() => {
    /* a day that was mostly floor-traded multi-leg packages — compression's shape — is named apart, never crowned the
       largest without saying so (the third audit; flowBook floorPackaged) */
    const by = (pick: (r: BookContract) => boolean) => rows.filter(r => !floorPackaged(r) && pick(r)).reduce<BookContract | null>((a, r) => (a === null || r.premium > a.premium ? r : a), null);
    const packaged = rows.filter(floorPackaged).reduce<BookContract | null>((a, r) => (a === null || r.premium > a.premium ? r : a), null);
    return { call: by(r => r.right === 'C'), put: by(r => r.right === 'P'), all: by(() => true), packaged };
  }, [rows]);
  const sentence = useMemo(() => {
    if (rows.length === 0) return 'Nothing on this cut.';
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    return `${fmtUsd(facts.prem)} across ${plural(rows.length, 'contract', 'contracts')} on ${plural(facts.names, 'name', 'names')} — calls ${facts.callPct}% of it, puts ${100 - facts.callPct}%. ${plural(facts.fresh, 'contract has', 'contracts have')} traded at least 1.5 times ${facts.fresh === 1 ? 'its' : 'their'} open interest today.`;
  }, [rows.length, facts]);
  /* AN EMPTY CUT NAMES THE CARDS THAT EMPTIED IT */
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
    return on.length ? `Nothing matches this cut — no contract passes ${on.join(', ')} together; loosen one of them` : 'Nothing has traded on the book';
  }, [screen, filters, expiry, query]);
  const activeScreen = FLOW_SCREENS.find(s => s.key === screen) ?? FLOW_SCREENS[0];
  /* a DAY total, said so — the card it opens heads its own print */
  const pill = (r: BookContract) => `${r.ticker} ${r.strike}${r.right} · ${fmtUsd(r.premium)} today`;

  const columns = useMemo<Column<BookContract>[]>(
    () => [
      {
        key: 'time',
        header: 'Time',
        sortValue: r => r.lastAtMin,
        render: r => (
          <span className="inline-flex items-center gap-1.5">
            <WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />
            <span className="text-[11px] text-textPrimary">{r.lastAt}</span>
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
      { key: 'contract', header: 'Contract', align: 'right', sortValue: r => r.strike, render: r => <ContractCell strike={r.strike} right={r.right} expiry={r.expiry} /> },
      { key: 'dte', header: 'DTE', align: 'right', sortValue: r => r.dte, render: r => <span className="text-textPrimary">{r.dte}d</span> },
      {
        key: 'otm',
        header: 'OTM %',
        align: 'right',
        sortValue: r => (Number.isFinite(r.otmPct) ? r.otmPct : Number.NEGATIVE_INFINITY),
        /* NO BLANK CELL (the third audit: XSP's OTM % was empty): a dash, and why */
        render: r =>
          Number.isFinite(r.otmPct) ? (
            <span className="text-textPrimary">{pctSigned(r.otmPct, 1)}</span>
          ) : (
            <span className="text-textMuted" title={r.spot > 0 ? "The index level comes in whole points — too coarse for this distance on a small index (XSP, VIX)" : 'No underlying price on this row'}>—</span>
          ),
      },
      {
        key: 'last',
        header: 'Fill · Chg',
        align: 'right',
        sortValue: r => (Number.isFinite(r.chgPct) ? r.chgPct : -Infinity),
        render: r => (
          <span className="text-textPrimary">
            ${r.last.toFixed(2)}{' '}
            {/* THE PRICE'S TIME (the third audit: prices differ by cents across pages with no time) — the last fill's */}
            {r.lastAt && r.lastAt !== '—' && <span className="text-[11px] text-textSecondary" title="New York time of the last fill this price is">{r.lastAt}</span>}{' '}
            {Number.isFinite(r.chgPct) ? <span className={`text-[11px] ${r.chgPct >= 0 ? 'text-bull dir-up' : 'text-bear dir-down'}`}>{pctSigned(r.chgPct, 1)}</span> : <span className="text-[11px] text-textMuted">new</span>}
          </span>
        ),
      },
      { key: 'vol', header: 'Vol', align: 'right', sortValue: r => r.volume, render: r => <span className={weightInk(r.volume, marks.vol)}>{num(r.volume)}</span> },
      { key: 'oi', header: 'OI', align: 'right', sortValue: r => r.oi, render: r => <span className={weightInk(r.oi, marks.oi)}>{num(r.oi)}</span> },
      {
        key: 'doi',
        header: 'ΔOI',
        align: 'right',
        sortValue: r => r.deltaOI,
        render: r => {
          if (r.deltaOI === 0) return <span className="text-textSecondary">—</span>;
          const a = Math.abs(r.deltaOI);
          const tone = a >= marks.doi.top ? 'text-supreme font-bold' : a >= marks.doi.bar ? (r.deltaOI > 0 ? 'text-bull dir-up' : 'text-bear dir-down') : 'text-textPrimary';
          return (
            <span className={tone}>
              {r.deltaOI > 0 ? '+' : '−'}
              {num(Math.abs(r.deltaOI))} {/* a tier down, never opacity */}
              <span className="text-[11px]">{pctSigned(r.deltaOIPct, 0)}</span>
            </span>
          );
        },
      },
      { key: 'prem', header: 'Prem', align: 'right', sortValue: r => r.premium, render: r => <span className={weightInk(r.premium, marks.prem)}><TickFigure value={r.premium}>{fmtUsd(r.premium)}</TickFigure></span> },
      {
        key: 'iv',
        header: 'IV · Δ',
        align: 'right',
        sortValue: r => r.iv,
        /* a contract the vendor sends no volatility for reads "—", never "0% +0.0" */
        render: r =>
          r.iv > 0 ? (
            <span className="text-textPrimary">
              {r.iv.toFixed(0)}%{' '}
              <span className={`text-[11px] ${r.ivChg >= 0 ? 'text-bull dir-up' : 'text-bear dir-down'}`}>
                {r.ivChg >= 0 ? '+' : '−'}
                {Math.abs(r.ivChg).toFixed(Math.abs(r.ivChg) >= 100 ? 0 : 1)}
              </span>
            </span>
          ) : (
            <span className="text-textMuted">—</span>
          ),
      },
      { key: 'voloi', header: 'Vol/OI', align: 'right', sortValue: r => r.volOverOI, render: r => <span className={`font-mono tnum ${r.volOverOI >= 1.5 ? 'font-bold text-textPrimary' : 'text-textPrimary'}`}>{r.volOverOI.toFixed(2)}</span> },
      { key: 'sweep', header: 'Sweep', align: 'right', sortValue: r => r.sweepPct, render: r => <span className={r.sweepPct >= 40 ? 'font-semibold text-textPrimary' : 'text-textPrimary'}>{Math.round(r.sweepPct)}%</span> },
      { key: 'floor', header: 'Floor', align: 'right', sortValue: r => r.floorPct, render: r => (r.floorPct === 0 ? <span className="text-textSecondary">—</span> : <span className={r.floorPct >= 50 ? 'text-textPrimary font-bold' : 'text-textPrimary'}>{Math.round(r.floorPct)}%</span>) },
      { key: 'multi', header: 'Multi', align: 'right', sortValue: r => r.multiPct, render: r => <span className={r.multiPct >= 30 ? 'font-semibold text-textPrimary' : 'text-textPrimary'}>{Math.round(r.multiPct)}%</span> },
      { key: 'lean', header: 'Lean', align: 'right', sortValue: r => r.askPct, render: r => <LeanCell askPct={r.askPct} split={r.sideVol} /> },
      { key: 'sector', header: 'Sector', sortValue: r => r.sector ?? '', render: r => <SectorName sector={r.sector} /> },
    ],
    [marks]
  );

  /* SEVENTEEN COLUMNS DID NOT FIT AT 1440 (the audit, 2026-10-22): the floor share, the multi-leg share and the sector open
     folded — one click away in Columns */
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_screener_cols_v2', ['floor', 'multi', 'sector']);
  /* WHAT THE BOOK IS (the audit: "every contract that traded today" headed the vendor's top 200) */
  const pool = unusual
    ? "the vendor's 200 unusual contracts with the most premium today"
    : screen === 'active'
      ? 'the 200 single-stock contracts with the most volume today'
      : 'the 200 contracts with the most premium today';
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);
  const screenOptions = useMemo<DropdownOption<ScreenKey>[]>(() => FLOW_SCREENS.map(s => ({ value: s.key, label: s.label, hint: s.hint })), []);
  const tenorGroups = useMemo(() => [{ title: 'Tenor', options: SLEEVES.map(s => ({ value: s.key, label: s.label, hint: s.blurb })) }], []);
  const openCut = (q: string) => setParams(new URLSearchParams(q), { replace: true });

  return (
    <>
      <TraceBox
        title="The book"
        sub={`${activeScreen.label} — ${activeScreen.hint} · ${pool} · a row opens the contract's card`}
        testId="screener"
        foldOnPhone
        data={{ screen, rows: rows.length, expiry: expiry ?? 'all' }}
        guide={{ title: 'How to read the book', door: 'What a row, the inks and the shares mean', body: <ScreenerGuide />, testId: 'screener-guide', open: guideOpen, onOpen: setGuideOpen }}
        facts={
          <>
            <Fact label="Premium" testId="premium">
              {fmtUsd(facts.prem)}
              {/* no premium, no split — "calls 0% / puts 100%" on $0 was a division by nothing */}
              {facts.prem > 0 && (
                <>
                  {' '}
                  <span className="text-textSecondary">·</span> <span className="text-bull">calls {facts.callPct}%</span> <span className="text-textSecondary">/</span> <span className="text-bear">puts {100 - facts.callPct}%</span>
                </>
              )}
            </Fact>
            <Fact label="Contracts" testId="contracts">
              {num(rows.length)} <span className="text-textSecondary">· {facts.names} names</span>
            </Fact>
            <Fact label="Vol ≥ 1.5× OI" testId="fresh" title="Contracts on this cut whose volume today is at least 1.5 times their open interest — positions likely built today">
              {facts.fresh}
            </Fact>
            {champs.call && champs.call !== champs.all && (
              <Champion label="Top call" ink="bull" onOpen={() => setOpenKey(champs.call!.key)} testId="top-call">
                {pill(champs.call)}
              </Champion>
            )}
            {champs.put && champs.put !== champs.all && (
              <Champion label="Top put" ink="bear" onOpen={() => setOpenKey(champs.put!.key)} testId="top-put">
                {pill(champs.put)}
              </Champion>
            )}
            {champs.all && (
              <Champion label="Largest" ink="supreme" title="The most premium today among contracts whose day was not mostly floor-traded multi-leg packages" onOpen={() => setOpenKey(champs.all!.key)} testId="largest">
                {pill(champs.all)}
              </Champion>
            )}
            {champs.packaged && (!champs.all || champs.packaged.premium > champs.all.premium) && (
              <Champion label="Floor packages · not a bet" ink="plain" title={`More premium, but ${Math.round(champs.packaged.floorPct)}% of its day traded on the floor and ${Math.round(champs.packaged.multiPct)}% in multi-leg packages — the shape of compression (OPRA cbmo), which nets open interest down, not a directional bet`} onOpen={() => setOpenKey(champs.packaged!.key)} testId="packaged">
                {pill(champs.packaged)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} />
            <StaleMark at={pack.at} ttlMs={FLOW_TTL_MS} fault={pack.fault} />
            <FlowSearch value={query} onChange={setQuery} rows={book} countNoun="contracts" span />
            <DropdownSelect label="Screen" value={screen} options={screenOptions} onChange={setScreen} title="The question asked of the book" testId="screener-screen" />
            <DropdownSelect label="Side" value={filters.side} options={SIDE_OPTIONS} onChange={v => setFilters(f => ({ ...f, side: v }))} title="Calls, puts or both" testId="screener-side" />
            {/* every tenor picked is no cut at all: it reads "Any" */}
            <DropdownMulti label="Tenor" values={filters.tenors} groups={tenorGroups} onChange={v => setFilters(f => ({ ...f, tenors: v.length >= SLEEVES.length ? [] : (v as SleeveKey[]) }))} title="How far out the contracts run" emptyWord="Any" align="start" testId="screener-tenor" />
            <DropdownSelect label="Volume" value={snap(filters.minVolume, VOLUME_STEPS)} options={VOLUME_OPTIONS} onChange={v => setFilters(f => ({ ...f, minVolume: v }))} title="The least volume a contract must carry" testId="screener-volume" />
            <DropdownSelect label="Premium" value={snap(filters.minPremium, PREMIUM_STEPS)} options={PREMIUM_OPTIONS} onChange={v => setFilters(f => ({ ...f, minPremium: v }))} title="The least money a contract must carry" testId="screener-premium" />
            <DropdownSelect label="Moneyness" value={filters.excludeItm ? 'otm' : 'any'} options={MONEY_OPTIONS} onChange={v => setFilters(f => ({ ...f, excludeItm: v === 'otm' }))} title="Where the strikes sit against the stock" testId="screener-money" />
            <ExpiryCalendar value={chosen ? isoDate(chosen.date) : ''} expiries={expiries} onChange={e => setExpiry(isoDate(e.date))} onClear={() => setExpiry(null)} label="Expiry" icon={CalendarDays} steppers={false} title="Only contracts on one expiry — or every expiry" testId="screener-expiry" />
            {/* THE FILTER IS THE ADDRESS (data/savedViews): a tuned screen
                lives in the query string, so it can be sent, bookmarked,
                opened twice side by side, and saved by name. */}
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
              <p role="status" className="mb-2 font-mono text-[11px] text-textSecondary" data-screener-said>
                {cuts.said}
              </p>
            )}
            <RichRead text={sentence} />
          </>
        }
      >
        <TraceGrid rows={rows} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={TOOLTIPS} rowKey={keyOf} onRowClick={openRow} selectedKey={openKey} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight emptyText={emptyText} testId="screener" />
        {pack.fault && rows.length === 0 ? <FeedFallback fault={pack.fault} /> : null}
      </TraceBox>
      <BookDrill list={rows} openKey={openKey} onOpen={setOpenKey} tick={tick} />
    </>
  );
};

export default OptionsScreener;
