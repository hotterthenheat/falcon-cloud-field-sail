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

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useMarketData } from '../../context/MarketDataContext';
import { useTracker } from '../../context/TrackerContext';
import type { MarketSnapshot } from '../../types/market';
import { buildCompassView, buildCompassUnion, buildMarketImpact, countCompass, setupIdOf } from '../../data/compass';
import { COMPASS_TICKERS, COMPASS_SET, compassQuotes } from '../../data/compassUniverse';
import { settleOpen, useCompassBook } from '../../data/compassLedger';
import { liveSpark, useThetaBook } from '../../data/thetaBook';
import { AVG_BAND, currentPicks, scanBusy, scanReport } from '../../data/compassModel';
import { setCompassView, useCompassView, type BoardLayout } from '../../data/compassView';
import { OPEN_CAP, sessionBook, useScanClock } from '../../data/compassDoor';
import { odteBoardDone } from '../../data/compassSession';
import { SCANNERS, SLEEVES, SLEEVE_BY_KEY, isScannerEligible, scannerEligibility, type ImpactRow, type OptionRight, type ScannerKey, type Setup, type SleeveKey } from '../../types/compass';
import { expiryFor } from '../../core/calendar';
import { companyName, companyNamesRev, subscribeCompanyNames } from '../../data/tickers';
import { NAV_INK } from '../../components/layout/nav';
import TraceBox, { Fact } from '../../components/trace/TraceBox';
import RichRead from '../../components/ui/RichRead';
import type { DropdownOption } from '../../components/ui/DropdownSelect';
import DropdownSelect from '../../components/ui/DropdownSelect';
import DropdownSearch, { type SearchOption } from '../../components/ui/DropdownSearch';
import BackToTop from '../../components/ui/BackToTop';
import { CompassGuide } from '../../components/compass/CompassGuide';
import { processState } from '../../components/compass/setupProcess';
import SetupScanBoard from '../../components/compass/SetupScanBoard';

/** The scanner sweeps on its own cadence — the feed must not vibrate with every price tick. */
const SCAN_INTERVAL_MS = 10_000;

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

/* Each card's glyph wears its own ink on hover and while open — the sidebar's
   rule (Noah, 2026-09-11: "turn a colour like we have on our sidebar") */
const CARD_INK = { expiry: NAV_INK.record, kind: NAV_INK.weigher, name: NAV_INK.compass, layout: NAV_INK.terrain } as const;

const Board = () => {
  const { activeTicker, marketData, changeTicker } = useMarketData();
  const location = useLocation();
  const navigate = useNavigate();
  const { sleeve, scanner, layout, tickerFilter, selectedId, right } = useCompassView();
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
  // Scan tier (every SCAN_INTERVAL_MS): the board, the counts, the rail.
  const [scanSnapshot, setScanSnapshot] = useState<MarketSnapshot | null>(null);
  const scanRef = useRef<MarketSnapshot | null>(null);
  const lastScanTimeRef = useRef(0);

  useEffect(() => {
    if (!marketData) return;
    const now = Date.now();
    const due =
      !scanRef.current ||
      now - lastScanTimeRef.current >= SCAN_INTERVAL_MS ||
      scanRef.current.ticker !== marketData.ticker; // ticker switch refreshes immediately
    if (due) {
      scanRef.current = marketData;
      lastScanTimeRef.current = now;
      setScanSnapshot(marketData);
    }
  }, [marketData]);

  // The live harness's market state for the whole board — the engine takes it
  // as an argument (never reads the simulator itself), so replay and live run
  // identical code. Scan-tier cadence: quotes refresh with the sweep.
  const universe = useMemo(() => [] as ReturnType<typeof compassQuotes>, []);
  const opens = useMemo(() => {
    const m = new Map<string, number>();
    for (const [ticker, series] of Object.entries(live.sparks)) {
      if (series[0] > 0) m.set(ticker, series[0]);
    }
    return m;
  }, [live.sparks]);

  // Scan tier: the groups, the counts, the rail — stable between sweeps
  const data = useMemo(
    () => (universe.length && scanSnapshot ? buildCompassView(scanSnapshot, 'top-setups', universe, offered, opens) : null),
    [offered, universe, opens]
  );
  /* The clock says when THIS cut was built. A feed tick is not a new sweep. */
  const foundAt = useMemo(() => (data ? new Date().toLocaleTimeString('en-GB') : ''), [data]);

  // The groups under the Name card
  const filteredGroups = useMemo(() => {
    if (!data) return [];
    if (!tickerFilter || !COMPASS_SET.has(tickerFilter)) return data.groups;
    return data.groups.filter(g => g.ticker === tickerFilter);
  }, [data, tickerFilter]);

  // Counts per kind. One kind is the board. The rest are a score pass — building
  // every kind's setups walked the whole book a dozen times after the first paint.
  const restCounts = useMemo(() => {
    if (universe.length === 0) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    for (const s of SCANNERS) {
      if (s.key === 'all' || !isScannerEligible(s.key, sleeve)) continue;
      counts[s.key] = countCompass(universe, s.key, sleeve, opens);
    }
    return counts;
  }, [universe, sleeve, opens]);
  const scannerCounts = useMemo(() => {
    const counts: Record<string, number> = { ...restCounts };
    let allCount = 0;
    for (const s of SCANNERS) {
      if (s.key === 'all' || !isScannerEligible(s.key, sleeve)) continue;
      const n = s.key === scanner ? (data?.totalFound ?? 0) : (counts[s.key] ?? 0);
      counts[s.key] = n;
      allCount += n;
    }
    counts.all = scanner === 'all' && data ? data.totalFound : allCount;
    return counts as Record<ScannerKey, number>;
  }, [restCounts, data, scanner, sleeve]);

  // Real expiry per tenor, through the clock-aware calendar — recomputed with
  // each sweep so a session rollover moves the card.
  const sleeveDates = useMemo(() => {
    void scanSnapshot; // sweep dependency — the calendar reads the engine clock
    return Object.fromEntries(SLEEVES.map(s => [s.key, expiryFor(s.dte)])) as Record<SleeveKey, ReturnType<typeof expiryFor>>;
  }, [scanSnapshot]);

  // The flat, globally-ranked board — rank is the organizing principle
  const rankedSetups = useMemo(() => {
    if (offered === 'odte' && !clock.open) return [];
    const ranked = currentPicks()
      .filter(s => !closed.has(s.id))
      .filter(s => (offered === 'odte' ? s.expiry === '0DTE' : s.expiry !== '0DTE'))
      .filter(s => !tickerFilter || s.ticker === tickerFilter || (tickerFilter === 'SPX' && (s.ticker === 'SPXW' || s.ticker === 'XSP')) || (tickerFilter === 'RUT' && s.ticker === 'RUTW'));
    return (side === 'BOTH' ? ranked : ranked.filter(s => s.right === side)).map(s => ({ ...s, spark: liveSpark(s.ticker) }));
  }, [live.setups, live.sparks, side, closed, tickerFilter, offered, clock.open]);

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

  /* The rail is the whole allowed book, ranked together. A selected card does not change it. */
  const railRows = useMemo(() => (universe.length ? buildMarketImpact(universe, sleeve) : []), [universe, sleeve]);

  const activeScanner = SCANNERS.find(s => s.key === scanner)!;
  const activeSleeveExp = sleeveDates[sleeve];

  useEffect(() => {
    if (tickerFilter && !COMPASS_SET.has(tickerFilter)) setCompassView({ tickerFilter: null });
  }, [tickerFilter]);
  const handleScanner = (next: ScannerKey) => setCompassView({ scanner: next, selectedId: null });
  const handleSleeve = (next: SleeveKey) => {
    // A kind the new tenor doesn't sell falls back to the ranking — landing
    // on a Quick scalp that LEAPS doesn't have would strand the board.
    setCompassView({ sleeve: next, scanner: isScannerEligible(scanner, next) ? scanner : 'top-setups', selectedId: null });
  };

  // The setup's page. The desk REPOINTS to the contract's underlying (a QQQ
  // setup over an SPY chain was the monitor pricing the wrong market); the
  // card stays selected underneath, so coming Back lands on it with the rail
  // on its name.
  const openSetup = (setup: Setup) => {
    if (setup.ticker !== activeTicker) changeTicker(setup.ticker);
    setCompassView({ selectedId: setup.id });
    navigate(`/compass/${setup.id}`);
  };

  // One click selects; a second click on the selected card opens it.
  const handleSelect = (setup: Setup) => {
    if (setup.id === selectedId) openSetup(setup);
    else setCompassView({ selectedId: setup.id });
  };

  // A contract from the rail opens its OWN page (Mo, 2026-08-19) — the same
  // door the cards use, pinned to that strike and side on the rail's name.
  const handleOpenContract = (row: ImpactRow) => {
    const ticker = row.contract.split(' ')[0];
    if (!ticker || !COMPASS_SET.has(ticker)) return;
    if (ticker !== activeTicker) changeTicker(ticker);
    navigate(`/compass/${setupIdOf({ ticker, strike: row.strike, right: row.right, scanner: 'top-setups', sleeve })}`);
  };

  /* ---- the head's facts and the sentence ------------------------------------------ */

  const counts = useMemo(() => {
    let moving = 0;
    for (const s of rankedSetups) if (processState(s) === 'MOVING') moving++;
    return { moving };
  }, [rankedSetups]);
  const top = rankedSetups[0] ?? null;
  const byName = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of rankedSetups) m.set(s.ticker, (m.get(s.ticker) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rankedSetups]);

  /* THE CARDS: Expiry, side, name, layout. The book under them is the scan. */
  const expiryOptions = useMemo<DropdownOption<SleeveKey>[]>(() => {
    const same = sleeveDates.odte;
    const week = sleeveDates.weekly;
    return [
      {
        value: 'odte',
        label: `0DTE · ${dayOf(same.date)}`,
        hint: same.dte === 0 ? 'Stops today. The last names go to 16:15 ET.' : `Next session, ${same.weekday}.`,
      },
      {
        value: 'weekly',
        label: `1–7 DTE · ${dayOf(week.date)}`,
        hint: `${week.weekday} · ${week.sessions} sessions.`,
      },
    ];
  }, [sleeveDates]);
  /* a kind that stands LIMITED on this sleeve (his partner's table, 2026-10-10) says so in its line — a stricter bar,
     fewer candidates, the note to come with the math */
  const kindOptions = useMemo<DropdownOption<ScannerKey>[]>(
    () =>
      SCANNERS.filter(s => isScannerEligible(s.key, sleeve)).map(s => {
        const limited = scannerEligibility(s.key, sleeve) === 'limited';
        return { value: s.key, label: `${s.label} · ${scannerCounts[s.key] ?? 0}${limited ? ' · limited' : ''}`, hint: limited ? `${s.blurb} — limited on ${SLEEVE_BY_KEY[sleeve].label}: a stricter bar, fewer candidates` : s.blurb };
      }),
    [sleeve, scannerCounts]
  );
  /* The Name card searches the locked 456 only — SPXW and SPX both stay. */
  const nameRev = useSyncExternalStore(subscribeCompanyNames, companyNamesRev, () => 0);
  const nameOptions = useMemo<SearchOption<string>[]>(
    () => [
      { value: 'ALL', label: 'All names', hint: `${COMPASS_TICKERS.length} names` },
      ...COMPASS_TICKERS.map(t => {
        const name = companyName(t);
        const shown = name.toUpperCase() === t ? '' : name;
        return {
          value: t,
          label: t,
          logo: t,
          keywords: shown || name,
          hint: shown || undefined,
        };
      }),
    ],
    [nameRev]
  );
  const matchName = (o: SearchOption<string>, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (o.value === 'ALL') return 'all names'.includes(q);
    if (o.label.toLowerCase().startsWith(q)) return true;
    return q.length >= 2 && (o.keywords ?? '').toLowerCase().includes(q);
  };

  const expiryWords = useMemo(() => {
    const day = dayOf(activeSleeveExp.date);
    if (sleeve === 'odte') return activeSleeveExp.dte === 0 ? "today's contracts" : `the ${day} contracts`;
    if (sleeve === 'weekly') return `this week's contracts (${day})`;
    if (sleeve === 'swing') return `the ${day} contracts`;
    if (sleeve === 'position') return `the ${day} contracts, a quarter out`;
    return `the ${day} contracts, a year out`;
  }, [sleeve, activeSleeveExp]);
  const horizonWords = activeSleeveExp.dte === 0 ? 'by the bell' : sleeve === 'leaps' ? 'over the year' : `by ${dayOf(activeSleeveExp.date)}`;

  const sideWord = side === 'P' ? 'Puts' : side === 'C' ? 'Calls' : 'Calls and puts';
  const dayOver = offered === 'odte' && odteBoardDone(activeSleeveExp.dte === 0);
  const scanOff = offered === 'odte' && !clock.open && !dayOver;
  const report = scanReport(offered === 'weekly' ? 'weekly' : 'odte');
  const bestLine = report.scored
    ? `Nothing cleared. Closest is ${report.contract} at ${Math.round(report.best * 100)}%. Top pick is 70.67%. Average is ${Math.round(AVG_BAND * 100)}%, on the blotter.`
    : report.quiet
      ? 'Quotes are in. The minute tape did not load, so nothing was scored.'
      : '';
  const reading = 'Scoring the book. A call prints as soon as it clears.';
  const swings = rankedSetups.filter(s => s.band === 'top').length;
  const band31 = rankedSetups.filter(s => s.band === 'average').length;
  const scalps = rankedSetups.filter(s => s.band === 'scalp').length;
  const wings = rankedSetups.filter(s => s.band === 'wing').length;
  const called = swings + band31 + scalps + wings;
  const sentence = (
    <RichRead text={dayOver ? "Day's over. No more 0DTE." : scanOff ? clock.line : scanBusy() && !called ? reading : called ? `${scalps} scalp. ${band31} at 31%. ${swings} at 70.67%. ${wings} wing.` : clock.open ? (bestLine || 'Nothing cleared a scalp, a wing, or a swing.') : live.line} />
  );

  if (live.status === 'loading' && rankedSetups.length === 0) {
    return (
      <div className="h-64 border border-borderSubtle rounded-md bg-panel flex items-center justify-center">
        <span className="font-mono text-[10px] uppercase tracking-widest text-textMuted">Waiting for the feed…</span>
      </div>
    );
  }

  return (
    <>
      <div data-compass-scan>
          <TraceBox
            title="The scan"
            sub={`${offered === 'odte' ? '0DTE' : '1–7 DTE'} · ${dayOf(sleeveDates[offered].date)} · calls and puts`}
            testId="compass"
            data={{ expiry: offered, kind: 'top-setups', layout, rows: rankedSetups.length }}
            guide={{ title: 'How to read the scan', door: 'What this page is', body: <CompassGuide />, testId: 'compass-guide', open: guideOpen, onOpen: setGuideOpen }}
            facts={
              <>
                <Fact label="Setups" testId="found">{dayOver ? 'Closed' : rankedSetups.length.toLocaleString('en-US')}</Fact>
                <Fact label="Moving" testId="active">{dayOver ? '—' : counts.moving.toLocaleString('en-US')}</Fact>
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
                  title="0DTE or 1–7 DTE."
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
            <p className="px-5 pt-3 font-mono text-[10px] uppercase tracking-wider text-textMuted" data-scan-clock>{clock.line}</p>
            {dayOver ? (
              <div className="border-t border-borderSubtle px-5 py-8" data-scan-closed="odte">
                <span className="font-mono text-[10px] uppercase tracking-widest text-textMuted">0DTE</span>
                <p className="mt-1 text-[15px] font-semibold text-textPrimary">Day's over. No more 0DTE.</p>
                <p className="mt-1 max-w-md text-[12px] text-textSecondary leading-relaxed">
                  Today's contracts are done. The last of them stopped at 16:15 ET. The next 0DTE scan opens {clock.label}, 09:30 ET. 1–7 DTE is still on.
                </p>
                <button
                  type="button"
                  onClick={() => setCompassView({ sleeve: 'weekly', scanner: 'top-setups', selectedId: null })}
                  className="mt-4 h-8 px-3 rounded-md holo-bg text-[#0a0a0a] hover:brightness-105 font-mono text-[11px] font-semibold uppercase tracking-wider"
                  data-scan-open-weekly
                >
                  Open 1–7 DTE
                </button>
              </div>
            ) : (
            <SetupScanBoard
              setups={rankedSetups}
              layout={layout === 'table' ? 'table' : 'cards'}
              selectedId={selectedId}
              onSelect={handleSelect}
              onAnalysis={openSetup}
              expiryChip={sleeveDates[offered].label}
              emptyLabel={scanBusy() && !report.scored ? reading : bestLine || 'Nothing cleared the bar on this sweep'}
              near={report.setup}
            />
            )}
          </TraceBox>
      </div>
      <BackToTop testId="compass" />
    </>
  );
};

export default Board;
