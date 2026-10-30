/* Building, a face of the Agenda (/pinpoint/agenda?view=building): which of the hedging arrived today — every strike's
   hedging now, what the overnight open-interest change added or took off (calls · puts) and the word. One to four panes,
   each a name on its own expiry (kept in slayer_building_panes); data/building.ts holds the arithmetic. */

import { daySigmaOfIv } from '../../data/expectedMove';
import { nyClock } from '../../core/nyTime';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { bookCandles, bookHistory, ensureBook, peekDaySigma, peekIv, snapshotOf, useBookRev, usePinpointFeed, ensureOiChange, peekOiChange } from '../../data/uwBook';
import { useTicker } from '../../context/MarketDataContext';
import { useFocus } from '../../context/FocusContext';
import ScopeChip from '../../components/ui/ScopeChip';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ExpiryCard, { type ExpiryChoice } from '../../components/ui/ExpiryCard';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import { Deferred } from '../../components/ui/Skeleton';
import BuildingLedger, { BuildingControls, ORDER_OPTIONS, SHOW_OPTIONS, WINDOW_OPTIONS, type BuildOrder, type BuildShow } from '../../components/gex/BuildingLedger';
import NamesDoor from '../../components/gex/NamesDoor';
import { BuildingGuide } from '../../components/gex/BuildingGuide';
import { ladderExpiryOptions } from '../../components/gex/ladderControls';
import { AgendaSwitch } from './Agenda';
import { BuildingLedgerSkeleton, BuildingPageSkeleton } from '../../components/gex/buildingSkeletons';
import { BookOrSkeleton } from './BookDown';
import { buildExposureProfile, type StrikeWindow } from '../../data/exposure';
import { aheadClock } from '../../data/ahead';
import { fmtDistance, sessionAtr } from '../../data/atr';
import { buildBuilding, oiWhen, type Building as BuildingData } from '../../data/building';
import { unitForName, useNameUnit } from '../../data/distanceUnits';
import { levelsForName } from '../../data/levelsScope';
import { readSessionClock } from '../../data/moc';
import { MAX_PANES, OFF_SCOPE_TITLE, PANE_COLS, newPaneKey, readPanes, usePanesFollowScope, writePanes, type Pane } from '../../data/panes';
import { usePositions } from '../../data/positions';
import { BuildingArrived } from '../../components/vendor/LiveDesk';
import { useIsPhone } from '../../components/ui/useMediaQuery';
import type { ExposureExpiry } from '../../types/gex';
import type { MarketSnapshot } from '../../types/market';

/** The open interest sweeps on its own cadence — a wall must not vibrate with every tick */
const SCAN_INTERVAL_MS = 10_000;
/* the panes (data/panes.ts — Targets stands on the same store and door) */
const PANES_KEY = 'slayer_building_panes';
let panesMemory: Pane[] | null = null;

/* The ledger's choices, held across route changes, reset on reload */
let orderMemory: BuildOrder = 'strike';
let windowMemory: StrikeWindow = 20;
/* the strikes that moved by default; Show · Every strike lists the steady ones too */
let showMemory: BuildShow = 'moved';

const WINDOWS = new Set<number>([10, 15, 20, 25, 30]);
const ORDERS = new Set<string>(['strike', 'built', 'drained']);
const SHOWS = new Set<string>(['moved', 'all']);
const paneWindow = (p: Pane, fallback: StrikeWindow): StrikeWindow => (WINDOWS.has(p.strikes ?? -1) ? (p.strikes as StrikeWindow) : fallback);
const paneOrder = (p: Pane, fallback: BuildOrder): BuildOrder => (ORDERS.has(p.order ?? '') ? (p.order as BuildOrder) : fallback);
const paneShow = (p: Pane, fallback: BuildShow): BuildShow => (SHOWS.has(p.show ?? '') ? (p.show as BuildShow) : fallback);

/* New York's clock with its zone */
const hhmmss = (d: Date) => nyClock(d, { seconds: true, zone: true });

const Building = () => {
  /* a phone reads the compact ledger too — the full one is 1060px wide and ran off a 390px screen */
  const phone = useIsPhone();
  const { activeTicker, changeTicker } = useTicker();
  const marketData = usePinpointFeed(activeTicker);
  const bookRev = useBookRev();
  const { focus, toggleFocus, clearFocus } = useFocus();
  const [panes, setPanesState] = useState<Pane[]>(() => panesMemory ?? (panesMemory = readPanes(PANES_KEY)));
  const setPanes = (next: Pane[]) => {
    panesMemory = next;
    writePanes(PANES_KEY, next);
    setPanesState(next);
  };
  const patchPane = (key: string, patch: Partial<Pane>) => setPanes(panes.map(p => (p.key === key ? { ...p, ...patch } : p)));
  usePanesFollowScope(panes, setPanes);
  const addPane = (ticker: string) => {
    if (panes.length >= MAX_PANES) return;
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    ensureBook(t, 'full');
    setPanes([...panes, { key: newPaneKey(), ticker: t, expiry: levelsForName(t) }]);
  };
  const removePane = (key: string) => {
    if (panes.length <= 1) return;
    setPanes(panes.filter(p => p.key !== key));
  };
  const [order, setOrderState] = useState<BuildOrder>(orderMemory);
  const [window, setWindowState] = useState<StrikeWindow>(windowMemory);
  const setOrder = (o: BuildOrder) => {
    orderMemory = o;
    setOrderState(o);
  };
  const setWindow = (w: StrikeWindow) => {
    windowMemory = w;
    setWindowState(w);
  };
  const [show, setShowState] = useState<BuildShow>(showMemory);
  const setShow = (s: BuildShow) => {
    showMemory = s;
    setShowState(s);
  };
  const [guideOpen, setGuideOpen] = useState(false);
  /* each pane's distance is that name's ruler */
  useNameUnit(activeTicker);
  /* The expiries as dates, one list for every pane's card (ladderControls). */
  /* each pane's Expiry card names the listing its own name reads (ladderExpiryOptions with a ticker) — re-read as the
     book lands (bookRev re-renders the page) */
  const expiryOptionsFor = (t: string): ExpiryChoice<ExposureExpiry>[] => ladderExpiryOptions(t);

  /* THE CLOCK — New York time, re-read every 15s; the pace runs on it */
  const [clockRaw, setClockRaw] = useState(() => readSessionClock());
  useEffect(() => {
    const id = globalThis.setInterval(() => setClockRaw(readSessionClock()), 15_000);
    return () => globalThis.clearInterval(id);
  }, []);
  const clock = useMemo(() => aheadClock(clockRaw), [clockRaw]);

  /* Scan-tier snapshot: the open interest sweeps every SCAN_INTERVAL_MS (a name change is immediate) */
  const [scan, setScan] = useState<{ snap: MarketSnapshot; at: string; nonce: number } | null>(null);
  const scanRef = useRef<MarketSnapshot | null>(null);
  const scanAtRef = useRef(0);
  useEffect(() => {
    if (!marketData) return;
    const now = Date.now();
    /* a book that changes shape (the full book landing after the board read) is taken at once */
    const shape = (s: MarketSnapshot | null) => Object.keys(s?.uwChains ?? {}).length;
    /* a book whose dates or contract facts landed (a new uwByDate — uwBook never edits a chain in place) is taken at once */
    const due = !scanRef.current || now - scanAtRef.current >= SCAN_INTERVAL_MS || scanRef.current.ticker !== marketData.ticker || shape(scanRef.current) !== shape(marketData) || scanRef.current.uwByDate !== marketData.uwByDate;
    if (due) {
      scanRef.current = marketData;
      scanAtRef.current = now;
      setScan({ snap: marketData, at: hhmmss(new Date(now)), nonce: now });
    }
  }, [marketData]);

  /* The own-name snapshots, one per name a pane holds — rebuilt on the scan's cadence, so the panes agree about the moment */
  const pinnedKey = panes.map(p => p.ticker).filter(Boolean).join('|');
  const ownSnaps = useMemo(() => {
    const m = new Map<string, MarketSnapshot>();
    if (!scan || !pinnedKey) return m;
    for (const t of new Set(pinnedKey.split('|'))) {
      if (t === scan.snap.ticker) continue;
      try {
        const live = snapshotOf(t, 'full');
        if (live) m.set(t, live);
      } catch {
        /* a name the sim can't build — the pane stays on the frame's */
      }
    }
    return m;
  }, [scan, pinnedKey, bookRev]);
  const snapFor = (p: Pane): MarketSnapshot | null => {
    const want = p.ticker ?? activeTicker;
    if (scan && scan.snap.ticker === want) return scan.snap;
    return ownSnaps.get(want) ?? null;
  };
  const tickerFor = (p: Pane) => p.ticker ?? activeTicker;
  const focusFor = (t: string) => (focus && focus.ticker === t ? focus.price : null);

  /* THE ANSWERS, one a pane — the whole day's snapshots against the live chain, on the pane's expiry */
  const nonce = scan?.nonce ?? 0;
  const panesKey = panes.map(p => `${p.key}:${p.ticker ?? ''}:${p.expiry}:${p.strikes ?? ''}:${p.order ?? ''}:${p.show ?? ''}`).join(',');
  const builds = useMemo(() => {
    const out = new Map<string, BuildingData>();
    for (const p of panes) {
      const snap = snapFor(p);
      if (!snap) continue;
      const t = snap.ticker;
      const profile = buildExposureProfile(snap, p.expiry, paneWindow(p, window));
      ensureOiChange(t);
      out.set(p.key, buildBuilding(snap, bookHistory(t) ?? [], bookCandles(t) ?? [], profile, clock, peekOiChange(t)));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, ownSnaps, panesKey, window, clock, nonce, bookRev]);

  /* Your strikes, for the rows — only on a pane that stands on the frame's name */
  const positions = usePositions(activeTicker);
  const yours = useMemo(() => new Set(positions.map(p => p.strike)), [positions]);

  const rows = window * 2 + 1;
  const first = builds.get(panes[0].key);
  if (!scan || !first) return <BookOrSkeleton tickers={[activeTicker]}><BuildingPageSkeleton rows={rows} folded={show === 'moved'} /></BookOrSkeleton>;

  const compact = panes.length > 1 || phone;
  let moved = 0;
  let total = 0;
  for (const b of builds.values()) {
    moved += b.rows.filter(r => r.verdict !== 'steady').length;
    total += b.rows.length;
  }
  /* until any strike carries a change of open interest the book is still being read */
  /* …and "N of M moved" only once every pane's count is final */
  const counted = [...builds.values()].every(b => !b.loading) && [...builds.values()].some(b => b.rows.some(r => r.dCall !== 0 || r.dPut !== 0));

  /* The names door, the Map's (NamesDoor): "+ Names N", four at most. */
  const namesDoor = <NamesDoor count={panes.length} onPick={addPane} testId="build" />;

  return (
    <div className="relative border border-borderSubtle rounded-md bg-panel" data-build data-build-panes={panes.length}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read what's being built" testId="build-guide" viewport>
        <BuildingGuide data={first} clock={clock} />
      </GuideFocus>
      {/* The box's head: the Agenda's switch as the title, the guide, the line. */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <AgendaSwitch />
          <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the bar, the chip and the line mean" testId="build-guide" />
        </div>
        <p
          className="mt-0.5 text-t11 text-textMuted sm:whitespace-nowrap sm:truncate"
          title={first.overnight ? `The overnight open-interest count, contract by contract (${oiWhen(first.oiDates).long}), each contract valued at the live book's own price and minute${oiWhen(first.oiDates).pending ? ` · ${oiWhen(first.oiDates).pending}` : ''}` : "Estimated from the day's volume until the overnight open-interest count loads"}
        >
          {first.overnight ? `What the overnight open-interest count added and took off · ${oiWhen(first.oiDates).short}` : `${clock.inSession ? "Today's trading" : 'The last session'}, from volume until the open-interest count loads`}
        </p>
      </div>
      <BuildingControls clock={clock} order={order} onOrder={setOrder} window={window} onWindow={setWindow} show={show} onShow={setShow} names={namesDoor} updatedAt={scan.at} moved={counted ? moved : null} total={total} lenses={panes.length < 2} />

      {/* THE PANES — side by side at desk width, a hairline between; stacked on a phone */}
      <div className={`border-t border-borderSubtle grid grid-cols-1 ${PANE_COLS[panes.length] ?? ''} gap-px bg-borderSubtle/60`} data-build-grid>
        {panes.map((p, i) => {
          const data = builds.get(p.key);
          const t = tickerFor(p);
          const linked = p.ticker === undefined;
          const iv = data ? peekIv(data.ticker) : null;
          const scales = data && iv != null ? { atr: sessionAtr(bookCandles(data.ticker) ?? []), sigma: peekDaySigma(data.ticker) ?? daySigmaOfIv(data.spot, iv) } : null;
          const distanceOf = (strike: number) => (data && scales ? fmtDistance(strike - data.spot, data.spot, unitForName(t), scales) : '');
          const head = (
            <>
              <ScopeChip
                closeOutside
                ticker={t}
                linked={i === 0 ? linked : undefined}
                /* the quote is room beside other panes — the chip and the Expiry card share one row there */
                quote={panes.length < 2}
                onToggleLink={i === 0 ? () => patchPane(p.key, { ticker: linked ? t : undefined }) : undefined}
                onPick={next => (i === 0 && linked ? changeTicker(next) : patchPane(p.key, { ticker: next.toUpperCase() }))}
              />
              <ExpiryCard label="Expiry" value={p.expiry} choices={expiryOptionsFor(tickerFor(p))} onChange={e => patchPane(p.key, { expiry: e })} title={`Which expiry ${t} reads. The other names keep theirs.`} testId={`build-expiry-${i}`} size="sm" />
              {panes.length > 1 && (
                <>
                  <DropdownSelect label="Show" value={paneShow(p, show)} options={SHOW_OPTIONS} onChange={s => patchPane(p.key, { show: s })} title={`What ${t} lists. The other names keep theirs.`} testId={`build-show-${i}`} />
                  <DropdownSelect label="Order" value={paneOrder(p, order)} options={ORDER_OPTIONS} onChange={o => patchPane(p.key, { order: o })} title={`How ${t} is listed. The other names keep theirs.`} testId={`build-order-${i}`} />
                  <DropdownSelect label="Strikes" value={paneWindow(p, window)} options={WINDOW_OPTIONS} onChange={w => patchPane(p.key, { strikes: w })} title={`How many strikes ${t} shows. The other names keep theirs.`} testId={`build-window-${i}`} />
                </>
              )}
              {p.expiry !== levelsForName(t) && (
            <span title={OFF_SCOPE_TITLE} className="inline-flex items-center h-6 px-1.5 rounded border border-borderSubtle font-mono text-t9 uppercase tracking-widest text-textMuted cursor-help" data-off-scope>
              own expiry
            </span>
          )}
              {panes.length > 1 && (
                <button type="button" onClick={() => removePane(p.key)} title="Take this name off" aria-label={`Take ${t} off`} className="inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-build-remove={t}>
                  <X className="w-3 h-3" />
                </button>
              )}
            </>
          );
          return (
            <div key={p.key} className="bg-panel min-w-0" data-build-pane-box={t} data-build-expiry={p.expiry}>
              {data ? (
                <Deferred fallback={<BuildingLedgerSkeleton rows={rows} bare folded={show === 'moved'} />} className="animate-fade-in">
                  <BuildingLedger
                    data={data}
                    ticker={t}
                    clock={clock}
                    order={paneOrder(p, order)}
                    window={paneWindow(p, window)}
                    show={paneShow(p, show)}
                    distanceOf={distanceOf}
                    yours={t === activeTicker ? yours : undefined}
                    focus={focusFor(t)}
                    onPick={price => toggleFocus(price, t)}
                    onClear={clearFocus}
                    head={head}
                    compact={compact}
                  />
                </Deferred>
              ) : (
                <BuildingLedgerSkeleton rows={rows} bare folded={show === 'moved'} />
              )}
              <BuildingArrived ticker={t} expiry={p.expiry} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Building;
