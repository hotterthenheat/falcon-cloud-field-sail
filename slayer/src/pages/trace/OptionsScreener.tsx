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
import { dayLean, indexRoot, INDEX_OTM_TITLE, useContracts, usd as fmtUsd } from '../../data/traceLive';
import { FLOW_TTL_MS, FeedFallback, StaleMark, TickFigure } from '../../components/ui/liveRead';
import { applyFilters, crossDay, crossHint, doiTail, floorPackaged, SPREAD_LEG_PCT, FRESH_VOL_OI, notABet, spreadLegDay, spreadLegHint, stockLike, volOiText, FLOW_SCREENS, runScreen, type BookFilters, type ScreenKey } from '../../data/flowBook';
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
import FlowSearch, { CONTRACT_FORMATS, matchesContract, normSymbol, searchedName, useSearchedName } from '../../components/trace/FlowSearch';
import { LiveHold, useHold } from '../../components/trace/LiveHold';
import ColumnChooser, { useHiddenColumns } from '../../components/trace/ColumnChooser';
import LeanCell from '../../components/trace/LeanCell';
import { shyPct } from '../../components/trace/dayWords';
import { dayAdv, oiAfterWords, oiCoverOf, oiInWords, oiLags, oiPendingWords, oiRowTitle, prevSessionIso, shortDay } from '../../components/trace/dayWords';
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
  if (notABet(r)) return floorPackaged(r) ? 'floor package · no lean' : r.multiPct >= SPREAD_LEG_PCT ? `spread legs ${Math.round(r.multiPct)}% · no lean` : `a cross ${Math.round(r.crossPct ?? 0)}% · no lean`;
  const l = dayLean(r);
  /* the share the rule is called on (the sided volume), and an even day's larger side too (retail, 2026-10-23) */
  return l.lean === 'ASK' ? `ask ${Math.round(l.askSided)}%` : l.lean === 'BID' ? `bid ${Math.round(l.bidSided)}%` : l.lean === 'UNSIDED' ? (Number.isFinite(l.mid) ? `mid/no side ${Math.round(l.mid)}%` : '—') : `even · ${l.askSided >= 50 ? `ask ${shyPct(l.askSided)}%` : `bid ${shyPct(l.bidSided)}%`}`;
};

/** A contract's day on a phone */
const phoneRow = (r: BookContract) => (
  <PhoneRow
    lead={<WatchStar k={contractKey(r)} make={() => watchContract(r, 'screener')} />}
    title={
      <>
        <CompanyLogo ticker={r.ticker} size={15} />
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
/* THE BOOK FITS A LAPTOP (audit round 4: at 1440 the "IV · Δ" header stood blank past the box, its values cut, and Vol/OI
   and Sweep sat under the pinned Prem — fourteen columns summed 1,468px in a 1,149px box). Every visible column has its
   floor here, the set at rest sums under the box, and the DTE (the contract cell carries the date) and the OI (the card,
   Vol/OI and ΔOI carry it) open folded — one click away in Columns. */
/* the lean fits its words at 1440 (retail, round 10: "bid 53%…") */
const WIDTHS: Record<string, number> = { time: 76, ticker: 84, contract: 132, dte: 56, otm: 70, last: 140, vol: 84, oi: 80, doi: 120, prem: 84, iv: 92, voloi: 66, sweep: 60, floor: 64, multi: 64, sector: 176, lean: 132 };
const TOOLTIPS: Record<string, string> = {
  time: 'When the contract last printed, New York — the bookmark tracks it in the Tracker',
  contract: 'The strike, the side and the expiry — click the row for the card',
  otm: 'How far the strike sits from the stock, as a percent',
  voloi: 'Volume over the open interest that stood at the session’s open — at 1.5 and above the positions were built in the session; "new" when there was no open interest to divide by',
  vol: "The screener's day volume for the contract, as of its last fill (the Time column) — the card adds its session row's figure, after-hours prints included",
  last: "The screener's last fill and the New York time it printed, with the change on the previous close — the card shows the latest regular-session print with its own time",
  sweep: 'The share of the volume that swept across exchanges',
  floor: 'The share that printed on the floor — worked orders',
  multi: 'The share that was a leg of a multi-leg structure',
  lean: "The day's lean: the side's share of the contracts that traded on a side. In bold (\"bid 60%\") the side held 55% or more — a lean is called; \"even · bid 51%\" fell short of 55%, no lean. \"legs\" and \"cross\" days get no lean. The hover gives each side's share of the whole day",
  iv: "The contract's implied volatility, and the vendor's IV change on the day (iv_change, ×100) — a change in IV, not the delta",
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

  /* MIRROR SCREENS READ ONE POOL (audit round 9, major 2: "Unusually bullish" read the vendor's unusual list and "Unusually
     bearish" the plain top 200 by premium; "Conviction puts" read 0 from the other pool than its calls): every question
     about unusual flow — bullish, bearish, new positioning, conviction calls and puts — reads the vendor's unusual list,
     and the sub-line says so */
  const unusual = screen === 'bullish' || screen === 'bearish' || screen === 'fresh' || screen === 'conviction-calls' || screen === 'conviction-puts';
  /* MOST ACTIVE IS ASKED BY VOLUME (the audit, 2026-10-22: it asked the vendor for premium order under "heaviest volume first") */
  /* A NAME SEARCHED IS ASKED FOR (audit round 11, major 5): the name's own contracts, in the screen's order, paged */
  const askedName = useSearchedName(query);
  const hottest = useContracts(false, screen === 'active' ? 'stock' : null, screen === 'active' ? 'volume' : 'premium', askedName, !unusual);
  const unusualBook = useContracts(true, null, 'premium', askedName, unusual);
  const pack = unusual ? unusualBook : hottest;
  const liveBook = pack.rows;
  /* ONE hold for the whole page: paused, the book AND the tick freeze together */
  const hold = useHold(useMemo(() => ({ book: liveBook, tick: marketData }), [liveBook, marketData]), activeTicker, !(pack.waiting && liveBook.length === 0));
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
    return normSymbol(cutQuery) === '' ? cut : cut.filter(r => matchesContract(cutQuery, r));
  }, [book, screen, filters, cutQuery]);

  /* Three registers per column — see components/trace/earnedInk.ts */
  const oiCover = useMemo(() => oiCoverOf(rows), [rows]);
  const tooltips = useMemo(
    () => ({
      ...TOOLTIPS,
      oi: `Open interest ${oiAfterWords(oiCover.day)} — counted the morning after${oiPendingWords(oiCover) ? `; ${oiPendingWords(oiCover)}` : ''}`,
      doi: `What open interest did ${oiInWords(oiCover.day)}${oiCover.day ? ` — from the count at ${shortDay(oiCover.day)}'s open (after ${shortDay(prevSessionIso(oiCover.day))}'s trading)` : ''}; a row marked with an earlier day is still on the count before`,
    }),
    [oiCover]
  );
  const marks = useMemo(() => ({ vol: earnMarks(rows, r => r.volume), oi: earnMarks(rows, r => r.oi), doi: earnMarks(rows, r => r.deltaOI), prem: earnMarks(rows, r => r.premium) }), [rows]);

  /* THE HEAD'S MONEY LEAVES THE FLOOR PACKAGES OUT (audit round 7: $126.4M of the $1.4B was contracts whose day was mostly
     floor-traded multi-leg packages, summed without a word) — counted apart and said on the hover */
  const facts = useMemo(() => {
    let prem = 0;
    let callPrem = 0;
    let fresh = 0;
    let pkgPrem = 0;
    let pkg = 0;
    let legPrem = 0;
    let legs = 0;
    let crossPrem = 0;
    let crosses = 0;
    const names = new Set<string>();
    for (const r of rows) {
      /* THE NAMES AND THE FRESH COUNT ARE THE BETS' (audit round 10, minor 3: "on 46 names" counted all 200 rows — the bets
         span 35 — and "1.5× OI" counted packages, legs and crosses), as on Compare */
      if (floorPackaged(r)) {
        pkgPrem += r.premium;
        pkg++;
        continue;
      }
      /* A DAY OF SPREAD LEGS IS SET APART THE SAME WAY (audit round 8, major 1) */
      if (spreadLegDay(r)) {
        legPrem += r.premium;
        legs++;
        continue;
      }
      /* …AND A DAY OF CROSSES (audit round 9: one 25,000-lot PLTR 175C cross) */
      if (crossDay(r)) {
        crossPrem += r.premium;
        crosses++;
        continue;
      }
      prem += r.premium;
      if (r.right === 'C') callPrem += r.premium;
      names.add(r.ticker);
      if (r.oi > 0 && r.volOverOI >= FRESH_VOL_OI) fresh++;
    }
    return { prem, callPct: Math.round((callPrem / Math.max(1, prem)) * 100), fresh, names: names.size, pkgPrem, pkg, legPrem, legs, crossPrem, crosses };
  }, [rows]);
  const bookReading = (pack.waiting && liveBook.length === 0) || searchedName(query) !== askedName;
  const champs = useMemo(() => {
    /* a day that was mostly floor-traded multi-leg packages — compression's shape — is named apart, never crowned the
       largest without saying so (the third audit; flowBook floorPackaged) */
    /* …and so is a day that was mostly spread legs (audit round 8: "Largest VRT 185P $13.6M" was 10,840 of 10,847 contracts
       in multi-leg orders) — the biggest SINGLE bet is the biggest contract that was neither */
    const by = (pick: (r: BookContract) => boolean) => rows.filter(r => !notABet(r) && pick(r)).reduce<BookContract | null>((a, r) => (a === null || r.premium > a.premium ? r : a), null);
    const packaged = rows.filter(notABet).reduce<BookContract | null>((a, r) => (a === null || r.premium > a.premium ? r : a), null);
    return { call: by(r => r.right === 'C'), put: by(r => r.right === 'P'), all: by(() => true), packaged };
  }, [rows]);
  const sentence = useMemo(() => {
    if (bookReading) return 'Reading the book…';
    if (rows.length === 0) return query ? `Nothing on this cut for "${query}" — the search takes a name, or a contract written like ${CONTRACT_FORMATS}.` : 'Nothing on this cut.';
    const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
    const apart = [facts.pkg ? `${plural(facts.pkg, 'floor-package contract', 'floor-package contracts')} (${fmtUsd(facts.pkgPrem)}, mostly floor-traded multi-leg packages)` : '', facts.legs ? `${plural(facts.legs, 'spread-leg contract', 'spread-leg contracts')} (${fmtUsd(facts.legPrem)}, half or more of the day in multi-leg orders)` : '', facts.crosses ? `${plural(facts.crosses, 'contract', 'contracts')} traded mostly in cross trades (${fmtUsd(facts.crossPrem)})` : ''].filter(Boolean);
    const pkgWords = apart.length ? ` (${apart.join(' and ')} left out — packages, legs and crosses, not bets of their own)` : '';
    return `${fmtUsd(facts.prem)} across ${plural(rows.length - facts.pkg - facts.legs - facts.crosses, 'contract', 'contracts')}${pkgWords} on ${plural(facts.names, 'name', 'names')} — calls ${facts.callPct}% of it, puts ${100 - facts.callPct}%. ${plural(facts.fresh, 'single-bet contract has', 'single-bet contracts have')} traded at least 1.5 times ${facts.fresh === 1 ? 'its' : 'their'} open interest ${dayAdv()}.`;
  }, [rows.length, facts, bookReading, query]);
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
    /* in plain words (audit round 11, minor 5: "no contract passes … together") */
    if (on.length === 1 && query) return `No contract on this list matches “${query}” — the search takes a name, or a contract written like ${CONTRACT_FORMATS}`;
    return on.length ? `No contract fits all of these at once: ${on.join(', ')} — loosen one${query ? ` (the search takes a name, or a contract written like ${CONTRACT_FORMATS})` : ''}` : 'Nothing has traded on the book';
  }, [screen, filters, expiry, query]);
  const activeScreen = FLOW_SCREENS.find(s => s.key === screen) ?? FLOW_SCREENS[0];
  /* a DAY total, said so — the card it opens heads its own print */
  const pill = (r: BookContract) => `${r.ticker} ${r.strike}${r.right} · ${fmtUsd(r.premium)} ${dayAdv()}${stockLike(r) ? ' · stock-like' : ''}`;

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
            <span className="text-textPrimary" title={indexRoot(r.ticker) ? INDEX_OTM_TITLE : undefined}>{indexRoot(r.ticker) ? "≈" : ""}{pctSigned(r.otmPct, 1)}</span>
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
      { key: 'oi', header: 'OI', align: 'right', sortValue: r => r.oi, render: r => <span className={weightInk(r.oi, marks.oi)} title={oiRowTitle(r)}>{num(r.oi)}</span> },
      {
        key: 'doi',
        header: 'ΔOI',
        align: 'right',
        sortValue: r => r.deltaOI,
        render: r => {
          /* a row still on the count before names its day, in plain ink (audit round 7) */
          const lag = oiLags(r, oiCover) && r.oiDay ? <span className="mr-1 text-[10px] text-textMuted">{shortDay(r.oiDay)}</span> : null;
          if (r.deltaOI === 0) return <span className="text-textSecondary" title={oiRowTitle(r)}>{lag}—</span>;
          const a = Math.abs(r.deltaOI);
          const tone = lag ? 'text-textPrimary' : a >= marks.doi.top ? 'text-supreme font-bold' : a >= marks.doi.bar ? (r.deltaOI > 0 ? 'text-bull dir-up' : 'text-bear dir-down') : 'text-textPrimary';
          return (
            <span className={tone} title={oiRowTitle(r)}>
              {lag}
              {r.deltaOI > 0 ? '+' : '−'}
              {num(Math.abs(r.deltaOI))} {/* a tier down, never opacity */}
              {/* a percentage of next to nothing is no figure ("+4564800%" on an open interest of 1) */}
              <span className="text-[11px]">{doiTail(r)}</span>
            </span>
          );
        },
      },
      { key: 'prem', header: 'Prem', align: 'right', sortValue: r => r.premium, render: r => <span className={weightInk(r.premium, marks.prem)}><TickFigure value={r.premium}>{fmtUsd(r.premium)}</TickFigure></span> },
      {
        key: 'iv',
        header: 'IV · IV chg',
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
      { key: 'voloi', header: 'Vol/OI', align: 'right', sortValue: r => r.volOverOI, render: r => <span className={`font-mono tnum ${r.oi > 0 && r.volOverOI >= FRESH_VOL_OI ? 'font-bold text-textPrimary' : 'text-textPrimary'}`} title={r.volOverOI > 0 || !(r.volume > 0) ? undefined : 'No open interest before the session — a new contract, nothing to divide by'}>{volOiText(r)}</span> },
      { key: 'sweep', header: 'Sweep', align: 'right', sortValue: r => r.sweepPct, render: r => <span className={r.sweepPct >= 40 ? 'font-semibold text-textPrimary' : 'text-textPrimary'}>{Math.round(r.sweepPct)}%</span> },
      { key: 'floor', header: 'Floor', align: 'right', sortValue: r => r.floorPct, render: r => (r.floorPct === 0 ? <span className="text-textSecondary">—</span> : <span className={r.floorPct >= 50 ? 'text-textPrimary font-bold' : 'text-textPrimary'}>{Math.round(r.floorPct)}%</span>) },
      { key: 'multi', header: 'Multi', align: 'right', sortValue: r => r.multiPct, render: r => <span className={r.multiPct >= 30 ? 'font-semibold text-textPrimary' : 'text-textPrimary'}>{Math.round(r.multiPct)}%</span> },
      { key: 'lean', header: 'Lean', align: 'right', sortValue: r => r.askPct, render: r => <LeanCell askPct={r.askPct} split={r.sideVol} legsPct={r.multiPct} crossPct={r.crossPct} /> },
      { key: 'sector', header: 'Sector', sortValue: r => r.sector ?? '', render: r => <SectorName sector={r.sector} /> },
    ],
    [marks, oiCover]
  );

  /* SEVENTEEN COLUMNS DID NOT FIT AT 1440 (the audit, 2026-10-22): the floor share, the multi-leg share and the sector open
     folded — one click away in Columns */
  const { hidden, toggle, showAll, hideAll } = useHiddenColumns('slayer_screener_cols_v3', ['floor', 'multi', 'sector', 'dte', 'oi']);
  /* WHAT THE BOOK IS (the audit: "every contract that traded today" headed the vendor's top 200) */
  /* NOT YET IS NOT NOTHING (retail, round 11: "the 0 single-stock contracts loaded" while the book read) */
  const pool = bookReading
    ? 'reading the book…'
    : unusual
    ? `from the vendor's unusual list — the ${num(liveBook.length)} unusual contracts loaded, most premium ${dayAdv()} first (more as you scroll), the pool every unusual screen (bullish, bearish, new positioning, conviction calls and puts) reads`
    : screen === 'active'
      ? `the ${num(liveBook.length)} single-stock contracts loaded, most volume ${dayAdv()} first — more as you scroll`
      : `the ${num(liveBook.length)} contracts loaded, most premium ${dayAdv()} first — more as you scroll`;
  const chooserCols = useMemo(() => columns.map(c => ({ key: c.key, label: typeof c.header === 'string' ? c.header : c.key })), [columns]);
  const screenOptions = useMemo<DropdownOption<ScreenKey>[]>(() => FLOW_SCREENS.map(s => ({ value: s.key, label: s.label, hint: s.hint })), []);
  const tenorGroups = useMemo(() => [{ title: 'Tenor', options: SLEEVES.map(s => ({ value: s.key, label: s.label, hint: s.blurb })) }], []);
  const openCut = (q: string) => setParams(new URLSearchParams(q), { replace: true });
  /* ONE PLAIN LINE (retail, round 11) — the money on this screen and where it went; the full read behind "more" */
  const leadLine = bookReading
    ? 'Reading the book…'
    : rows.length === 0
      ? sentence
      : `${fmtUsd(facts.prem)} traded ${dayAdv()} on ${num(rows.length - facts.pkg - facts.legs - facts.crosses)} contracts across ${num(facts.names)} names — ${facts.callPct}% in calls, ${100 - facts.callPct}% in puts.`;

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
            <Fact label={facts.pkg || facts.legs || facts.crosses ? 'Premium · packages, legs & crosses out' : 'Premium'} testId="premium" title={facts.pkg || facts.legs || facts.crosses ? `The day's premium of the contracts on this cut, less ${num(facts.pkg)} whose day was mostly floor-traded multi-leg packages (${fmtUsd(facts.pkgPrem)}), ${num(facts.legs)} whose day was half or more legs of multi-leg orders (${fmtUsd(facts.legPrem)}) and ${num(facts.crosses)} whose day was half or more cross trades (${fmtUsd(facts.crossPrem)}) — set apart, not single bets` : "The day's premium of the contracts on this cut"}>
              {bookReading ? <span className="text-textMuted">Reading…</span> : fmtUsd(facts.prem)}
              {/* no premium, no split — "calls 0% / puts 100%" on $0 was a division by nothing */}
              {facts.prem > 0 && (
                <>
                  {' '}
                  <span className="text-textSecondary">·</span> <span className="text-bull">calls {facts.callPct}%</span> <span className="text-textSecondary">/</span> <span className="text-bear">puts {100 - facts.callPct}%</span>
                </>
              )}
            </Fact>
            <Fact label="Contracts" testId="contracts" title="The single bets on this cut and the names they span; floor packages, days of spread legs and days of crosses are counted apart — not bets">
              {bookReading ? <span className="text-textMuted">Reading…</span> : <>{num(rows.length - facts.pkg - facts.legs - facts.crosses)} <span className="text-textSecondary">bets · {facts.names} names{facts.pkg + facts.legs + facts.crosses ? ` · ${num(facts.pkg + facts.legs + facts.crosses)} apart` : ''}</span></>}
            </Fact>
            <Fact label="Vol ≥ 1.5× OI" testId="fresh" title={`Single-bet contracts on this cut (floor packages, spread legs and crosses left out) whose volume ${dayAdv()} is at least 1.5 times their open interest — positions likely built in the session (the one floor across Trace; a contract with no open interest before the session is new and not counted)`}>
              {bookReading ? <span className="text-textMuted">Reading…</span> : facts.fresh}
            </Fact>
            {champs.call && champs.call !== champs.all && (
              <Champion label="Top call" ink="plain" title="The biggest single bet among the calls: the most premium among contracts whose day was not mostly floor-traded packages, spread legs (half or more in multi-leg orders) or cross trades — those are set apart, not bets" onOpen={() => setOpenKey(champs.call!.key)} testId="top-call">
                {pill(champs.call)}
              </Champion>
            )}
            {champs.put && champs.put !== champs.all && (
              <Champion label="Top put" ink="plain" title="The biggest single bet among the puts: the most premium among contracts whose day was not mostly floor-traded packages, spread legs (half or more in multi-leg orders) or cross trades — those are set apart, not bets" onOpen={() => setOpenKey(champs.put!.key)} testId="top-put">
                {pill(champs.put)}
              </Champion>
            )}
            {champs.all && (
              /* THE SCOPE IN THE PILL (retail, round 11: the tape's "Most premium" — every name, index included — and this
                 "Largest" — single stocks on Most active — disagreed unless the fine print was read) */
              <Champion label={`Largest · ${screen === 'active' ? 'single stocks' : unusual ? 'unusual list' : 'all names incl. index'}`} ink="supreme" title="The biggest single bet by premium — the most premium among contracts whose day was not mostly floor-traded packages, spread legs (half or more in multi-leg orders) or cross trades. Not a side: the Lean column says which way it leaned" onOpen={() => setOpenKey(champs.all!.key)} testId="largest">
                {pill(champs.all)}
              </Champion>
            )}
            {champs.packaged && (!champs.all || champs.packaged.premium > champs.all.premium) && (
              <Champion label={floorPackaged(champs.packaged) ? 'Floor packages · not a bet' : champs.packaged.multiPct >= SPREAD_LEG_PCT ? 'Spread legs · not a bet' : 'One cross · not a bet'} ink="plain" title={floorPackaged(champs.packaged) ? `More premium, but ${Math.round(champs.packaged.floorPct)}% of its day traded on the floor and ${Math.round(champs.packaged.multiPct)}% in multi-leg packages — the shape of compression (OPRA cbmo), which nets open interest down, not a directional bet` : champs.packaged.multiPct >= SPREAD_LEG_PCT ? `More premium, but ${spreadLegHint(champs.packaged)}` : `More premium, but ${crossHint(champs.packaged)}`} onOpen={() => setOpenKey(champs.packaged!.key)} testId="packaged">
                {pill(champs.packaged)}
              </Champion>
            )}
          </>
        }
        controls={
          <>
            <LiveHold paused={hold.paused} onToggle={hold.toggle} heldAt={hold.heldAt} waitingFirst={hold.waitingFirst} />
            {!hold.paused && <StaleMark at={pack.at} ttlMs={FLOW_TTL_MS} fault={pack.fault} />}
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
        <TraceGrid rows={rows} columns={columns} hidden={hidden} widths={WIDTHS} tooltips={tooltips} rowKey={keyOf} onRowClick={openRow} selectedKey={openKey} pinLeft={PIN_LEFT} pinRight={PIN_RIGHT} phoneRow={phoneRow} autoHeight endless={endlessOf(pack.older, 'contracts', "the vendor's list for the day is done", hold.paused, 'Load more ↓')} emptyText={bookReading ? 'Reading the book…' : pack.fault && liveBook.length === 0 ? 'This read did not land — the book fills when the feed answers' : emptyText} testId="screener" />
        {pack.fault && rows.length === 0 ? <FeedFallback fault={pack.fault} /> : null}
      </TraceBox>
      <BookDrill list={rows} openKey={openKey} onOpen={setOpenKey} tick={tick} />
    </>
  );
};

export default OptionsScreener;
