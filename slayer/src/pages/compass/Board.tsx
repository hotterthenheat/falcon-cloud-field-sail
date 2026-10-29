/*
==================================================
  SLAYER TERMINAL - THE COMPASS BOARD (pages/compass/Board.tsx)

  The setups the sweep found, graded and ranked.
  WALKED into the house grammar (2026-09-11, the
  walk after Trace and the Record): under the
  shell head (CompassLayout), ONE box — the head
  with its facts and the top pick among them, one
  line of cards (Expiry · Kind · Name · Layout),
  the sentence, and the board growing with what
  the sweep found (the cards two across, or the
  grid) — with the heaviest contracts on the
  selected name in a rail beside it that sticks
  while the page scrolls (Noah, 2026-09-11). The
  four tenor boxes, the six scanner pills, the
  hand-rolled filter menu and the pager are gone;
  Expiry and Kind are cards on the line, changed
  in place, never pages in the sidebar (Noah:
  "they require immediate ability to change").

  A setup's page has a ROUTE of its own since the
  walk (/compass/<id>, pages/compass/SetupPage.tsx)
  — the board keeps its view in data/compassView
  across the trip and back.

  THE ENGINE IS UNTOUCHED: buildCompassView takes
  the snapshot, the kind, the universe and the
  tenor as arguments and never reads the simulator
  — the backtest harness runs the same call
  (docs/compass-backtest-spec.md). This file only
  decides what the reader sees.
==================================================
*/

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Check } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { useTracker } from '../../context/TrackerContext';
import { setupIdOf } from '../../data/compass';
import { COMPASS_TICKERS, COMPASS_SET } from '../../data/compassUniverse';
import { settleOpen, useCompassBook } from '../../data/compassLedger';
import { liveSpark, useThetaBook, alertUniverse } from '../../data/thetaBook';
import { currentPicks, lockReason, scanBusy, scanReport } from '../../data/compassModel';
import { MODELS_VALIDATED, P1_MIN, UNVALIDATED_LINE } from '../../data/compassParams';
import { setCompassView, useCompassView, type BoardLayout } from '../../data/compassView';
import { OPEN_CAP, sessionBook, useScanClock } from '../../data/compassDoor';
import { setCompassAlert, useCompassAlert } from '../../data/compassAlerts';
import { odteAsleep, odteBoardDone, nextOdteOpen } from '../../data/compassSession';
import { SCANNERS, SLEEVES, type OptionRight, type ScannerKey, type Setup, type SleeveKey } from '../../types/compass';
import { expiryFor } from '../../core/calendar';
import { companyName, companyNamesRev, subscribeCompanyNames, askCompanyNames } from '../../data/tickers';
import { NAV_INK } from '../../components/layout/nav';
import TraceBox, { Fact } from '../../components/trace/TraceBox';
import RichRead from '../../components/ui/RichRead';
import type { DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownSelect from '../../components/ui/DropdownSelect';
import * as Popover from '@radix-ui/react-popover';
import CompanyLogo from '../../components/ui/CompanyLogo';
import { CARD } from '../../components/ui/DropdownSelect';
import DropdownSearch, { type SearchOption } from '../../components/ui/DropdownSearch';
import BackToTop from '../../components/ui/BackToTop';
import { CompassGuide } from '../../components/compass/CompassGuide';
import SetupScanBoard from '../../components/compass/SetupScanBoard';
import FilterTabs from '../../components/ui/FilterTabs';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sep 16", or "Sep 10 '27" once the year turns */
const dayOf = (d: Date) => {
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : ` '${String(d.getFullYear()).slice(2)}`}`;
};

const LAYOUT_OPTIONS: DropdownOption<BoardLayout>[] = [
  { value: 'cards', label: 'Cards', hint: "Two across, the stock's line on each" },
  { value: 'table', label: 'Table', hint: 'One row per setup, sortable' },
];

/** A card is a call, or one of the closest that did not clear. Closest does not need 70.67%. */
function shownCard(s: Setup): boolean {
  const dte = s.expiry === '0DTE' ? 0 : Number(/^(\d+)DTE$/.exec(s.expiry)?.[1]);
  if (!(dte >= 0 && dte <= 7)) return false;
  if (s.band === 'closest') return s.p1 != null;
  if (s.band === 'lottery') return dte === 0;
  if (s.band !== 'top' && s.band !== 'wing') return false;
  return s.p1 != null && s.p1 + 1e-12 >= P1_MIN;
}

/** One side per name. Same-strike call and put never both sit on the board. The higher entry chance keeps the name. */
function oneSide(rows: Setup[]): Setup[] {
  const byRoot = new Map<string, Setup[]>();
  for (const s of rows) {
    if (!shownCard(s)) continue;
    const list = byRoot.get(s.ticker) ?? [];
    list.push(s);
    byRoot.set(s.ticker, list);
  }
  const out: Setup[] = [];
  const bandRank = (s: Setup) => (s.band === 'top' ? 3 : s.band === 'wing' ? 2 : 1);
  for (const list of byRoot.values()) {
    const published = list.filter(s => s.band !== 'closest');
    const pool = published.length ? published : list;
    const calls = pool.filter(s => s.right === 'C');
    const puts = pool.filter(s => s.right === 'P');
    const best = (xs: Setup[]) => xs.reduce((m, s) => Math.max(m, s.p1 ?? 0), 0);
    const keep = calls.length && puts.length ? (best(calls) >= best(puts) ? calls : puts) : pool;
    const strikes = new Map<string, Setup>();
    for (const s of keep) {
      const key = `${s.strike}|${s.expiryDate}`;
      const had = strikes.get(key);
      if (!had || (s.p1 ?? -1) > (had.p1 ?? -1) || ((s.p1 ?? -1) === (had.p1 ?? -1) && bandRank(s) > bandRank(had))) strikes.set(key, s);
    }
    out.push(...strikes.values());
  }
  return out.sort((a, b) => bandRank(b) - bandRank(a) || (b.p1 ?? 0) - (a.p1 ?? 0));
}

/* Each card's glyph wears its own ink on hover and while open — the sidebar's
   rule (Noah, 2026-09-11: "turn a colour like we have on our sidebar") */
const CARD_INK = { expiry: NAV_INK.record, kind: NAV_INK.weigher, name: NAV_INK.compass, layout: NAV_INK.terrain } as const;

const Board = () => {
  const { activeTicker, changeTicker } = useTicker();
  const location = useLocation();
  const navigate = useNavigate();
  const { sleeve, layout, tickerFilter, selectedId, right } = useCompassView();
  const side: OptionRight | 'BOTH' = right === 'P' ? 'P' : right === 'C' ? 'C' : 'BOTH';
  const offered: SleeveKey = sleeve === 'weekly' ? 'weekly' : 'odte';
  const [guideOpen, setGuideOpen] = useState(false);
  const clock = useScanClock();
  const { trackedSetups, untrackSetup } = useTracker();
  const book = useCompassBook();
  const closed = useMemo(() => new Set(book.map(l => l.id)), [book]);
  const live = useThetaBook(offered);
  const openN = sessionBook(trackedSetups).length;

  // Deep links in: a setup from the Tracker, the Weigher, the tape's drilldown
  // or the Pulse tile lands on ITS PAGE; the wire's door lands here on one name.
  useEffect(() => {
    const state = location.state as {
      monitor?: { ticker: string; strike: number; right: 'C' | 'P'; scanner: ScannerKey; sleeve?: SleeveKey };
      tickerFilter?: string;
    } | null;
    if (state?.tickerFilter && !state.monitor) {
      if (COMPASS_SET.has(state.tickerFilter)) setCompassView({ tickerFilter: state.tickerFilter });
      /* replaceState leaves React Router's state in place, so the next mount
         puts the name back and the reader cannot get to every ticker. */
      navigate(location.pathname, { replace: true, state: null });
      return;
    }
    if (state?.monitor) {
      const incoming = state.monitor;
      if (!COMPASS_SET.has(incoming.ticker)) return;
      // Legacy deep links can carry pre-sleeve scanner keys ('weeklies',
      // 'swings') — those were tenors, so they land on the matching sleeve.
      const known = SCANNERS.some(s => s.key === incoming.scanner);
      const kind: ScannerKey = known ? incoming.scanner : 'top-setups';
      const tenor: SleeveKey = incoming.sleeve ?? (!known ? ((incoming.scanner as string) === 'swings' ? 'swing' : 'weekly') : sleeve);
      navigate(`/compass/${setupIdOf({ ticker: incoming.ticker, strike: incoming.strike, right: incoming.right, scanner: kind, sleeve: tenor })}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- two-tier cadence -----------------------------------------------------
  // The calendar follows the session clock. It does not follow the simulator.
  const sleeveDates = useMemo(() => {
    return Object.fromEntries(SLEEVES.map(s => [s.key, expiryFor(s.dte)])) as Record<SleeveKey, ReturnType<typeof expiryFor>>;
  }, [clock.session]);

  const opens = useMemo(() => {
    const m = new Map<string, number>();
    for (const [ticker, series] of Object.entries(live.sparks)) {
      if (series[0] > 0) m.set(ticker, series[0]);
    }
    return m;
  }, [live.sparks]);

  // Published calls only. A raw quote is not a call, and a call and the same-strike put are not both sent.
  const rankedSetups = useMemo(() => {
    const pool = currentPicks().filter(s => (offered === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE' && s.band !== 'lottery'));
    const ranked = oneSide(pool)
      .filter(s => !closed.has(s.id))
      .filter(s => !tickerFilter || s.ticker === tickerFilter || (tickerFilter === 'SPX' && (s.ticker === 'SPXW' || s.ticker === 'XSP')) || (tickerFilter === 'NDX' && s.ticker === 'NDXP') || (tickerFilter === 'RUT' && s.ticker === 'RUTW'));
    return (side === 'BOTH' ? ranked : ranked.filter(s => s.right === side)).map(s => ({ ...s, spark: liveSpark(s.ticker) }));
  }, [live.setups, live.sparks, side, closed, tickerFilter, offered]);

  useEffect(() => {
    const spotOf = new Map<string, number>();
    for (const s of live.setups) spotOf.set(s.ticker, live.spots[s.ticker] ?? live.spots[s.ticker === 'SPXW' || s.ticker === 'XSP' ? 'SPX' : s.ticker === 'RUTW' ? 'RUT' : s.ticker] ?? 0);
    for (const id of settleOpen(trackedSetups, live.setups, spotOf, opens)) untrackSetup(id);
  }, [live.setups, live.spots, trackedSetups, opens, untrackSetup]);

  /* Nothing selected → #1 is. The rail always follows a selection, so it
     never belongs to nothing; a sweep, filter or kind change that drops the
     selected card falls back to the first one visible. */
  useEffect(() => {
    if (!rankedSetups.length) return;
    if (!selectedId || !rankedSetups.some(s => s.id === selectedId)) setCompassView({ selectedId: rankedSetups[0].id });
  }, [rankedSetups, selectedId]);

  const activeSleeveExp = sleeveDates[sleeve];

  useEffect(() => {
    if (tickerFilter && !COMPASS_SET.has(tickerFilter)) setCompassView({ tickerFilter: null });
  }, [tickerFilter]);

  const openSetup = (setup: Setup) => {
    if (setup.ticker !== activeTicker) changeTicker(setup.ticker);
    setCompassView({ selectedId: setup.id });
    navigate(`/compass/${setup.id}`);
  };

  const handleSelect = (setup: Setup) => {
    if (setup.id === selectedId) openSetup(setup);
    else setCompassView({ selectedId: setup.id });
  };

  const expiryOptions = useMemo<DropdownOption<SleeveKey>[]>(() => {
    const same = sleeveDates.odte;
    const week = sleeveDates.weekly;
    return [
      {
        value: 'odte',
        label: `0DTE · ${dayOf(same.date)}`,
        hint: same.dte === 0 ? 'Stops today. Book C runs here.' : `Next session, ${same.weekday}.`,
      },
      {
        value: 'weekly',
        label: `1–7 DTE · ${dayOf(week.date)}`,
        hint: 'Same models as same-day. Book C does not run here.',
      },
    ];
  }, [sleeveDates]);
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  useEffect(() => {
    askCompanyNames(COMPASS_TICKERS);
  }, []);
  const ALIAS: Record<string, string> = {
    SPX: 'spx spxw xsp s&p sp500',
    SPXW: 'spx spxw xsp',
    XSP: 'xsp spx',
    NDX: 'ndx ndxp nasdaq',
    NDXP: 'ndx ndxp nasdaq',
    RUT: 'rut rutw russell',
    RUTW: 'rut rutw russell',
    GOOG: 'google googl alphabet',
    GOOGL: 'google goog alphabet',
  };
  const nameOptions = useMemo<SearchOption<string>[]>(
    () => [
      { value: 'ALL', label: 'All names', hint: `${COMPASS_TICKERS.length} names`, keywords: 'all names every' },
      ...COMPASS_TICKERS.map(t => {
        const name = companyName(t);
        const shown = name.toUpperCase() === t ? '' : name;
        return {
          value: t,
          label: t,
          logo: t,
          keywords: [shown, ALIAS[t] ?? ''].filter(Boolean).join(' '),
          hint: shown || undefined,
        };
      }),
    ],
    [nameRev]
  );
  const matchName = (o: SearchOption<string>, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (o.value === 'ALL') return 'all'.startsWith(q) || 'all names'.startsWith(q);
    const label = o.label.toLowerCase();
    if (label.startsWith(q)) return true;
    const words = (o.keywords ?? '').toLowerCase();
    return q.length >= 2 && (label.includes(q) || words.includes(q));
  };

  const sideWord = side === 'P' ? 'Puts' : side === 'C' ? 'Calls' : 'Calls and puts';
  const dayOver = offered === 'odte' && odteBoardDone(activeSleeveExp.dte === 0);
  const scanOff = clock.phase === 'closed';
  const report = scanReport(offered === 'weekly' ? 'weekly' : 'odte');
  const bestLine = report.scored
    ? `Nothing cleared. Closest is ${report.contract} at ${Math.round(report.best * 100)}%.`
    : report.quiet
      ? 'Quotes are in. The minute tape did not load, so nothing was scored.'
      : '';
  const reading = 'Scoring the book. A call prints as soon as it clears.';
  const swings = rankedSetups.filter(s => s.band === 'top').length;
  const wings = rankedSetups.filter(s => s.band === 'wing').length;
  const booksC = rankedSetups.filter(s => s.band === 'lottery').length;
  const near = rankedSetups.filter(s => s.band === 'closest').length;
  const called = swings + wings + booksC;
  const caveat = MODELS_VALIDATED ? '' : ` ${UNVALIDATED_LINE}`;
  const calledLine = offered === 'odte'
    ? `Book A ${swings}. Book B ${wings}. Book C ${booksC}.${near ? ` Closest ${near}.` : ''} Model 1 is the entry. Model 2 is the runner.${caveat}`
    : `Book A ${swings}. Book B ${wings}. Book C is same-day only.${near ? ` Closest ${near}.` : ''} Model 1 is the entry. Model 2 is the runner.${caveat}`;
  const sentence = (
    <RichRead text={dayOver ? "Same-day calls are done for the session. Cards stay until a stop, a target, the reversal, or the 15:55 flat." : scanOff || clock.phase === 'halt' ? clock.line : !called && !near && lockReason() ? lockReason() : scanBusy() && !called && !near ? reading : called || near ? `${clock.line} ${calledLine}` : clock.open ? (bestLine || (offered === 'odte' ? 'Nothing cleared Book A, Book B, or Book C.' : 'Nothing cleared Book A or Book B.')) : clock.line} />
  );

  return (
    <>
      <div data-compass-scan className="xl:h-full xl:min-h-0">
          <TraceBox
            title="The scan"
            sub={offered === 'odte' ? `0DTE · ${dayOf(sleeveDates.odte.date)} · ${clock.line.split('.')[0]}` : `1–7 DTE · ${dayOf(sleeveDates.weekly.date)} · ${clock.line.split('.')[0]}`}
            testId="compass"
            className="xl:h-full xl:min-h-0"
            data={{ expiry: offered, kind: 'top-setups', layout, rows: rankedSetups.length }}
            guide={{ title: 'How to read the scan', door: 'What this page is', body: <CompassGuide />, testId: 'compass-guide', open: guideOpen, onOpen: setGuideOpen }}
            facts={
              <>
                <Fact label="Called" testId="found">{called.toLocaleString('en-US')}</Fact>
                <Fact label="Closest" testId="active">{near.toLocaleString('en-US')}</Fact>
                <Fact label="Type" testId="proving">{sideWord}</Fact>
                <Fact label="Slots" testId="fading">
                  <span className={openN >= OPEN_CAP ? 'text-bear' : 'text-textPrimary'}>{openN} of {OPEN_CAP}</span>
                </Fact>
              </>
            }
            controls={
              <>
                <DropdownSelect
                  label="Expiry"
                  value={offered}
                  options={expiryOptions}
                  onChange={next => setCompassView({ sleeve: next === 'weekly' ? 'weekly' : 'odte' })}
                  title="0DTE includes Book C. 1–7 DTE uses Book A and Book B."
                  ink={CARD_INK.expiry}
                  testId="compass-expiry"
                />
                <DropdownSelect
                  label="Type"
                  value={side}
                  options={[
                    { value: 'BOTH', label: 'Calls and puts', hint: 'The whole book.' },
                    { value: 'C', label: 'Calls', hint: 'Calls only.', tone: 'bull' },
                    { value: 'P', label: 'Puts', hint: 'Puts only.', tone: 'bear' },
                  ]}
                  onChange={next => setCompassView({ right: next, selectedId: null })}
                  title="Calls, puts, or both."
                  ink={CARD_INK.kind}
                  testId="compass-side"
                />
                <DropdownSelect
                  label="Layout"
                  value={layout}
                  options={LAYOUT_OPTIONS}
                  onChange={next => setCompassView({ layout: next })}
                  title="Cards or the grid."
                  ink={CARD_INK.layout}
                  testId="compass-layout"
                />
                <CompassAlertControl />
                <DropdownSearch
                label="Name"
                value={tickerFilter ?? 'ALL'}
                options={nameOptions}
                match={matchName}
                onChange={v => {
                  if (v === 'ALL' || !COMPASS_SET.has(v)) {
                    setCompassView({ tickerFilter: null });
                    return;
                  }
                  setCompassView({ tickerFilter: v, selectedId: null });
                }}
                title="Show this name on the scan."
                placeholder="Search a name…"
                icon={Search}
                ink={CARD_INK.name}
                testId="compass-name"
                clearTo="ALL"
              />
              </>
            }
            sentence={sentence}
          >
            <div className="xl:flex-1 xl:min-h-0 xl:overflow-y-auto">
            {offered === 'odte' && odteAsleep() ? (
              <OdteOver />
            ) : (
            <SetupScanBoard
              setups={rankedSetups}
              layout={layout === 'table' ? 'table' : 'cards'}
              selectedId={selectedId}
              onSelect={handleSelect}
              onAnalysis={openSetup}
              expiryChip={sleeveDates[offered].label}
              emptyLabel={bestLine || (offered === 'odte' ? 'Nothing cleared Book A, Book B, or Book C.' : 'Nothing cleared Book A or Book B.')}
            />
            )}
            </div>
          </TraceBox>
      </div>
      <BackToTop testId="compass" />
    </>
  );
};

const OdteOver = () => {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick(n => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const next = nextOdteOpen();
  const left = Math.max(0, next.atMs - Date.now());
  const hours = Math.floor(left / 3_600_000);
  const mins = Math.floor((left % 3_600_000) / 60_000);
  const secs = Math.floor((left % 60_000) / 1000);
  const clock = `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  void tick;
  return (
    <div className="flex flex-col items-center justify-center gap-2 h-[200px] border-t border-borderSubtle px-6" data-odte-over>
      <p className="font-mono text-t10 uppercase tracking-widest text-textMuted">The tape opens again in</p>
      <p className="holo-text font-mono text-t20 font-semibold tnum tracking-wide" data-odte-countdown>{clock}</p>
    </div>
  );
};

const CompassAlertControl = () => {
  const pref = useCompassAlert();
  const [tab, setTab] = useState<'odte' | 'swing'>('odte');
  const [query, setQuery] = useState('');
  const book = tab === 'odte' ? pref.odte : pref.swing;
  const universe = alertUniverse(tab === 'odte' ? 'odte' : 'weekly');
  const q = query.trim().toLowerCase();
  const matched = universe.filter(t => {
    if (!q) return true;
    if (t.toLowerCase().includes(q)) return true;
    return q.length >= 2 && companyName(t).toLowerCase().includes(q);
  });
  const shown = matched.slice(0, 48);
  const on = (t: string) => book === 'all' || (Array.isArray(book) && book.includes(t));
  const toggle = (t: string) => {
    const next = book === 'all'
      ? universe.filter(n => n !== t)
      : book === 'off'
        ? [t]
        : book.includes(t)
          ? book.filter(n => n !== t)
          : [...book, t];
    const value = next.length === 0 ? 'off' : next.length >= universe.length ? 'all' : next;
    setCompassAlert(tab === 'odte' ? { odte: value } : { swing: value });
  };
  const word = (side: 'odte' | 'swing', label: string) => {
    const b = side === 'odte' ? pref.odte : pref.swing;
    if (b === 'off') return '';
    if (b === 'all') return `${label} · all`;
    return b.length === 1 ? `${label} · ${b[0]}` : `${label} · ${b.length}`;
  };
  const summary = [word('odte', '0DTE'), word('swing', '1–7')].filter(Boolean).join(' · ') || 'Off';
  return (
    <Popover.Root onOpenChange={open => { if (!open) setQuery(''); }}>
      <Popover.Trigger asChild>
        <button type="button" className="inline-flex items-center gap-1.5 h-7 max-w-[220px] px-2.5 rounded-md border border-borderSubtle bg-chip hover:border-borderMuted data-[state=open]:border-silver/50 transition-colors font-mono" data-compass-alerts>
          <span className="text-t9 uppercase tracking-widest text-textMuted">Alerts</span>
          <span className={`text-t11 font-semibold truncate ${summary === 'Off' ? 'text-textSecondary' : 'text-textPrimary'}`}>{summary}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={12} className={`${CARD} w-[280px] p-0 outline-none`} data-compass-alert-card>
          <div className="px-2 pt-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search this list…"
              aria-label="Search the names that can chime"
              className="w-full slayer-field"
            />
          </div>
          <div className="px-2 pt-2">
            <FilterTabs
              ariaLabel="Which sleeve can chime"
              value={tab}
              onChange={next => { setTab(next); setQuery(''); }}
              options={[{ value: 'odte', label: '0DTE' }, { value: 'swing', label: '1–7 DTE' }]}
            />
          </div>
          <div className="px-2 pt-1 pb-2 max-h-[280px] overflow-y-auto">
            <button type="button" onClick={() => setCompassAlert(tab === 'odte' ? { odte: book === 'all' ? 'off' : 'all' } : { swing: book === 'all' ? 'off' : 'all' })} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink/[0.04] text-left">
              <span className={`inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border ${book === 'all' ? 'bg-silverFill border-silverFill' : 'border-borderMuted'}`}>
                {book === 'all' && <Check className="w-2.5 h-2.5 text-onfoil" />}
              </span>
              <span className="font-mono text-t11 text-textPrimary">Every name</span>
            </button>
            {shown.map(t => {
              const checked = on(t);
              const name = companyName(t);
              return (
                <button key={t} type="button" onClick={() => toggle(t)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ink/[0.04] text-left">
                  <span className={`inline-flex w-3.5 h-3.5 shrink-0 items-center justify-center rounded-[3px] border ${checked ? 'bg-silverFill border-silverFill' : 'border-borderMuted'}`}>
                    {checked && <Check className="w-2.5 h-2.5 text-onfoil" />}
                  </span>
                  <CompanyLogo ticker={t} size={14} />
                  <span className="min-w-0">
                    <span className="block font-mono text-t11 font-semibold text-textPrimary">{t}</span>
                    {name.toUpperCase() !== t && <span className="block text-t10 text-textMuted truncate">{name}</span>}
                  </span>
                </button>
              );
            })}
            {matched.length > shown.length && <p className="px-2 py-1 font-mono text-t10 text-textMuted">Keep typing. {matched.length.toLocaleString('en-US')} names.</p>}
            {shown.length === 0 && <p className="px-2 py-2 font-mono text-t10 text-textMuted">No name matches.</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export default Board;
