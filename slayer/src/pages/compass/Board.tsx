/* The Compass board: the scan's calls and closest misses under one head with its facts and controls, and the
   selected name's desks in a rail beside it. The board keeps its view across a trip to a setup's page. */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Check } from 'lucide-react';
import { useTicker } from '../../context/MarketDataContext';
import { setupIdOf } from '../../data/compass';
import { COMPASS_TICKERS, COMPASS_SET } from '../../data/compassUniverse';
import { liveSpark, useThetaBook, alertUniverse } from '../../data/thetaBook';
import { useSignals } from '../../data/compassLedger';
import { bestByName, currentPicks, lastScanAt, scanBusy, scanReport, seatsNow } from '../../data/compassModel';
import { backlogLine, compassFeed } from '../../data/compassFeed';
import { daySummary } from '../../data/compassOutcome';
import { asOfText } from '../../components/ui/states';
import { BOOK_NAME, MODELS_VALIDATED, MODEL_1_NAME, MODEL_2_NAME, P1_MIN, SEAT_CAP, inModelWindow } from '../../data/compassParams';
import { nyClock, nyDay, nyIsoDate, nyMinutes, nyWallTime } from '../../core/nyTime';
import { setCompassView, useCompassView, type BoardLayout } from '../../data/compassView';
import { useScanClock } from '../../data/compassDoor';
import { setCompassAlert, useCompassAlert } from '../../data/compassAlerts';
import { odteAsleep, odteBoardDone, nextOdteOpen } from '../../data/compassSession';
import { SCANNERS, SLEEVES, type OptionRight, type ScannerKey, type Setup, type SleeveKey } from '../../types/compass';
import { expiryFor, MONTHS } from '../../core/calendar';
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

/* Each card's glyph wears its own ink on hover and while open — the sidebar's rule */
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
  const live = useThetaBook(offered);
  const record = useSignals();

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

  // Published calls only. A raw quote is not a call, and a call and the same-strike put are not both sent.
  const rankedSetups = useMemo(() => {
    const held = currentPicks();
    const source = held.length ? held : live.earlier?.setups ?? [];
    const pool = source.filter(s => (offered === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE' && s.band !== 'lottery'));
    const ranked = oneSide(pool)
      .filter(s => !tickerFilter || s.ticker === tickerFilter || (tickerFilter === 'SPX' && (s.ticker === 'SPXW' || s.ticker === 'XSP')) || (tickerFilter === 'NDX' && s.ticker === 'NDXP') || (tickerFilter === 'RUT' && s.ticker === 'RUTW'));
    return (side === 'BOTH' ? ranked : ranked.filter(s => s.right === side)).map(s => ({ ...s, spark: liveSpark(s.ticker) }));
  }, [live.setups, live.sparks, live.earlier, record, side, tickerFilter, offered]);

  /* Nothing selected → #1 is: a scan, filter or kind change that drops the selected card falls back to the first visible. */
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
        hint: same.dte === 0 ? `Stops today. ${BOOK_NAME.C} runs here.` : `Next session, ${same.weekday}.`,
      },
      {
        value: 'weekly',
        label: `1–7 DTE · ${dayOf(week.date)}`,
        hint: `Same scores as same-day. ${BOOK_NAME.C} does not run here.`,
      },
    ];
  }, [sleeveDates]);
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  /* The name search matches company names, so all 456 are asked for, but only once the search is opened */
  const askNames = () => askCompanyNames(COMPASS_TICKERS);
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

  const dayOver = offered === 'odte' && odteBoardDone(activeSleeveExp.dte === 0);
  const scanOff = clock.phase === 'closed';
  const report = scanReport(offered === 'weekly' ? 'weekly' : 'odte');
  const bestLine = report.scored
    ? `Nothing cleared. Closest is ${report.contract} at ${(report.best * 100).toFixed(1)}%.`
    : report.quiet
      ? 'Quotes are in. The minute tape did not load, so nothing was scored.'
      : '';
  const reading = 'Scoring the book. A call prints as soon as it clears.';
  const swings = rankedSetups.filter(s => s.band === 'top').length;
  const wings = rankedSetups.filter(s => s.band === 'wing').length;
  const booksC = rankedSetups.filter(s => s.band === 'lottery').length;
  const near = rankedSetups.filter(s => s.band === 'closest').length;
  const called = swings + wings + booksC;
  const caveat = MODELS_VALIDATED ? '' : ' Unvalidated models.';
  const calledLine = offered === 'odte'
    ? `${BOOK_NAME.A} ${swings}. ${BOOK_NAME.B} ${wings}. ${BOOK_NAME.C} ${booksC}.${near ? ` Closest ${near}.` : ''}${caveat}`
    : `${BOOK_NAME.A} ${swings}. ${BOOK_NAME.B} ${wings}. ${BOOK_NAME.C} is same-day only.${near ? ` Closest ${near}.` : ''}${caveat}`;
  const scannedAt = lastScanAt(offered === 'weekly' ? 'weekly' : 'odte');
  const asOf = scannedAt
    ? `Last scan ${nyClock(scannedAt, { zone: true })}.`
    : live.earlier?.at
      ? `Last scan ${nyDay(live.earlier.at, { weekday: true })}, ${nyClock(live.earlier.at, { zone: true })}.`
      : 'No scan has run today.';
  const offline = live.theta === 'down';
  const todayIso = nyIsoDate();
  const day = daySummary(record.filter(s => s.day === todayIso));
  const backlog = backlogLine(compassFeed().marks);
  /* the server's engine: unreachable (nothing kept), or this browser's last copy of it, stamped */
  const lock = compassFeed().lock;
  const serverLine = live.feed === 'offline'
    ? `Compass server offline. ${live.feedError || 'Reconnecting.'}`
    : live.feed === 'kept' && live.feedAt
      ? `The board ${asOfText(live.feedAt)}. ${live.feedError || 'Reconnecting to the Compass server.'}`
      : '';
  const tNow = nyMinutes() - (9 * 60 + 30);
  const inWindow = inModelWindow(tNow);
  const windowLine = inWindow ? '' : ` Calls run 09:45–15:00 ET. Outside those minutes the scan still reads the book, but the ${MODEL_1_NAME} needs the regular session’s own minutes, so nothing calls.`;
  /* the runner tree's range input needs an hour of minutes: before 10:30 a call cannot ride */
  const runnerLine = !scanOff && tNow >= 15 && tNow < 60 ? ` ${MODEL_2_NAME} is off before 10:30 ET (it needs an hour of minutes), so a call before then takes the 1.50× profit and does not ride.` : '';
  const sessionDay = !scanOff && clock.phase !== 'halt' && !odteAsleep();
  const preEntry = sessionDay && tNow >= -60 && tNow < 15 && !day.calls;
  const nothingLine = preEntry
    ? 'Compass scans from 09:45 ET; no calls yet today.'
    : offered === 'odte' ? `Nothing cleared ${BOOK_NAME.A}, ${BOOK_NAME.B} or ${BOOK_NAME.C}.` : `Nothing cleared ${BOOK_NAME.A} or ${BOOK_NAME.B}.`;
  const sentence = (
    <RichRead text={
      serverLine
        ? serverLine
        : offline
        ? `Live data offline — reconnecting. ${asOf}`
        : dayOver
          ? 'Same-day calls are done for the session. A signal stays on the record until its stop, its target, the reversal, or the 15:55 flat.'
          : scanOff || clock.phase === 'halt'
            ? `${clock.line} ${asOf}`
            : !called && !near && lock
              ? lock
              : `${scanBusy() && !called && !near
                ? reading
                : called || near
                  ? `${calledLine} ${asOf}`
                  : `${preEntry ? nothingLine : bestLine || nothingLine} ${asOf}`}${windowLine}${runnerLine}${backlog ? ` ${backlog}` : ''}`
    } />
  );
  const bests = bestByName(offered === 'weekly' ? 'weekly' : 'odte');
  const cleared = [...bests.values()].filter(r => r.p1 + 1e-12 >= P1_MIN).length;
  const seats = seatsNow().seats;
  const emptyLabel = live.feed === 'offline'
    ? serverLine
    : offline
    ? `Live data offline — reconnecting. ${asOf}`
    : preEntry ? nothingLine : bestLine || nothingLine;

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
                <Fact label="Calls today" testId="found" title="Every call the scan fired today, on both sleeves. The blotter has each one.">{day.calls.toLocaleString('en-US')}</Fact>
                <Fact label="Won · lost · open" testId="day" title="Today's calls: closed with a gain, closed at or under the fill, and still held.">
                  <span className="text-bull">{day.won}</span> · <span className="text-bear">{day.lost}</span> · {day.open}
                </Fact>
                <Fact label="Net today" testId="net" title="Per contract: today's closed calls, (exit − fill) × 100.">
                  {day.won + day.lost ? <span className={day.net >= 0 ? 'text-bull' : 'text-bear'}>{`${day.net < 0 ? '−' : '+'}$${Math.abs(day.net).toFixed(2)}`}</span> : '—'}
                </Fact>
                <Fact label="Cleared" testId="best" title="Names on this sleeve whose best contract cleared the line. A call still needs a seat.">
                  {bests.size ? cleared.toLocaleString('en-US') : '—'}
                </Fact>
                <Fact label="Seats" testId="fading" title={`Roots the ${BOOK_NAME.A} and ${BOOK_NAME.B} books have called today. Five at most.`}>
                  <span className={seats >= SEAT_CAP ? 'text-bear' : 'text-textPrimary'}>{seats} of {SEAT_CAP}</span>
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
                  title={`0DTE includes ${BOOK_NAME.C}. 1–7 DTE uses ${BOOK_NAME.A} and ${BOOK_NAME.B}.`}
                  ink={CARD_INK.expiry}
                  testId="compass-expiry"
                  /* a phone's half-width card: the choice whole ("0DTE · Nov 2"), its name in the title */
                  labelFrom="sm"
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
                  labelFrom="sm"
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
                onOpen={askNames}
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
            {!currentPicks().length && live.earlier && rankedSetups.length > 0 && (
              <p className="px-5 py-2 border-t border-borderSubtle font-mono text-t10 uppercase tracking-wider text-textMuted" data-compass-asof>
                As of {live.earlier.at ? `${nyDay(live.earlier.at, { weekday: true })}, ${nyClock(live.earlier.at, { zone: true })}` : nyDay(nyWallTime(Number(live.earlier.day.slice(0, 4)), Number(live.earlier.day.slice(4, 6)), Number(live.earlier.day.slice(6, 8)), 12), { weekday: true })} · the last session&apos;s scan, not live
              </p>
            )}
            {offered === 'odte' && odteAsleep() && !rankedSetups.length ? (
              <OdteOver />
            ) : (
            <SetupScanBoard
              setups={rankedSetups}
              layout={layout === 'table' ? 'table' : 'cards'}
              selectedId={selectedId}
              onSelect={handleSelect}
              onAnalysis={openSetup}
              expiryChip={sleeveDates[offered].label}
              emptyLabel={emptyLabel}
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
    /* one line, not a 200px box around it */
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-borderSubtle px-5 py-3" data-odte-over>
      <p className="font-mono text-t10 uppercase tracking-widest text-textMuted">The tape opens again in</p>
      <p className="holo-text font-mono text-t15 font-semibold tnum tracking-wide" data-odte-countdown>{clock}</p>
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
