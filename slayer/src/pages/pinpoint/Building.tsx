/*
==================================================
  SLAYER TERMINAL - BUILDING
  (pages/pinpoint/Building.tsx)

  A FACE OF THE AGENDA since 2026-10-14 (Noah:
  Building and Targets "on the same page put
  interchangable" — pages/pinpoint/Agenda.tsx,
  /pinpoint/agenda?view=building). ONE BOX since
  the same day (Noah, with its picture: "remove
  both of these from their designated sections and
  add more strikes to fill their positions"): the
  heading drawing is gone from this face — it lives
  on as the Pulse desk's tile — and the ledger
  opens on twenty strikes each side instead of
  fifteen.

  ONE TO FOUR NAMES, EACH ON ITS OWN EXPIRY (Noah,
  2026-10-14: "for the building page i want to have
  the ability to choose different tickers and
  different exps from 1 to 4 tickers. you choose how
  the layout should be"). THE LAYOUT, mine: one box.
  Its head is the Agenda's switch, the guide door
  and the line; under it ONE line of cards for every
  pane — Show · Order · Strikes · the NAMES door
  (the Map's own: "+ Names N", a name picked from
  the whole listing, four at most) — and the key.
  Then THE PANES SIDE BY SIDE, one a name: the first
  follows the frame's name (its chip is linked, the
  Map's grammar) and each added one holds its own;
  every pane carries its EXPIRY card (the house's
  expiries as dates, ladderControls) and its two
  facts; beside other panes a pane goes COMPACT —
  the strike, the wall, the change and the word's
  chip, four columns a quarter of the screen can
  hold — and alone it is the whole ledger. The panes
  are kept on this machine (slayer_building_panes),
  the Map's names the same way.

  The fifth page of Pinpoint (2026-09-07). The Map
  says where the hedging sits, Ahead what happens
  from here to the close. Building says which of
  the hedging arrived TODAY — the wall a day early
  — read top to bottom in two boxes:

    WHAT'S BEING BUILT   every strike: the hedging
                         there now, what today added
                         or took off (calls · puts),
                         the day's shape, the word
    WHERE THE WALLS      the four levels at the open,
    ARE HEADING          now, and by the close at
                         today's pace, with the
                         strike growing fastest on
                         each side

  A COMPOSITION, like Ahead: the open interest is
  the one every snapshot carries, the units are the
  chain's own at the live spot, the levels are the
  Map's, the clock is the shell's. data/building.ts
  holds the arithmetic. IN THE SIMULATOR the open
  interest is one book: a pane's expiry scales the
  hedging the way the Map's does (data/exposure
  EXPIRY_DECAY); on the feed each expiry has its own
  open interest and the deltas follow.
==================================================
*/

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
import { fmtDistance, impliedDaySigma, sessionAtr } from '../../data/atr';
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
/* THE PANES (data/panes.ts since 2026-10-15 — Targets stands on the same store and door) */
const PANES_KEY = 'slayer_building_panes';
let panesMemory: Pane[] | null = null;

/* The ledger's choices, held across route changes, reset on reload */
let orderMemory: BuildOrder = 'strike';
let windowMemory: StrikeWindow = 20;
/* EVERY STRIKE BY DEFAULT (Noah, 2026-10-14: "always start of by showing the full expanded view and then the user can
   collaspe to only see the one with actual significance") — Show · What moved folds the steady strikes away; the movers
   alone had been the default since 2026-09-13 */
let showMemory: BuildShow = 'all';

const WINDOWS = new Set<number>([10, 15, 20, 25, 30]);
const ORDERS = new Set<string>(['strike', 'built', 'drained']);
const SHOWS = new Set<string>(['moved', 'all']);
const paneWindow = (p: Pane, fallback: StrikeWindow): StrikeWindow => (WINDOWS.has(p.strikes ?? -1) ? (p.strikes as StrikeWindow) : fallback);
const paneOrder = (p: Pane, fallback: BuildOrder): BuildOrder => (ORDERS.has(p.order ?? '') ? (p.order as BuildOrder) : fallback);
const paneShow = (p: Pane, fallback: BuildShow): BuildShow => (SHOWS.has(p.show ?? '') ? (p.show as BuildShow) : fallback);

/* New York's clock with its zone — the machine's own zone printed 18:xx on a 14:xx market (the retail test, 2026-10-22) */
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
  /* THE EXPIRIES AS DATES — one list for every pane's card (ladderControls, the Map's own) */
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
    /* the full book (every expiry's own chain) lands a few seconds after the board read — inside the sweep's window,
       so it was dropped and the page sat on the whole-book-only read until the next refresh (the UI sweep, 2026-10-22:
       the Map crowned the whole book's supreme while the other pages read today's) — a book that changes SHAPE is taken
       at once */
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
  /* until any strike carries a change of open interest the book is still being read — "0 of 41 moved" over a
     loading ledger claimed a quiet day it had not seen (the ship pass, 2026-10-22) */
  /* …and "N of M moved" only once every pane's count is final (the fifth audit: "0 OF 23 MOVED" printed while the totals
     still read "…") */
  const counted = [...builds.values()].every(b => !b.loading) && [...builds.values()].some(b => b.rows.some(r => r.dCall !== 0 || r.dPut !== 0));

  /* THE NAMES DOOR — the Map's: "+ Names N", a name from the whole listing, four at most (NamesDoor, Targets' too) */
  const namesDoor = <NamesDoor count={panes.length} onPick={addPane} testId="build" />;

  return (
    <div className="relative border border-borderSubtle rounded-md bg-panel" data-build data-build-panes={panes.length}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read what's being built" testId="build-guide" viewport>
        <BuildingGuide data={first} clock={clock} />
      </GuideFocus>
      {/* THE BOX'S HEAD — the Agenda's switch as the title, the guide, the line */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <AgendaSwitch />
          <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the bar, the chip and the line mean" testId="build-guide" />
        </div>
        <p className="mt-0.5 text-[11px] text-textMuted lg:whitespace-nowrap lg:truncate" title={first.overnight ? `The overnight open-interest count · ${oiWhen(first.oiDates).long}` : undefined}>
          {first.overnight
            ? `The overnight open-interest count, contract by contract · the hedging ${oiWhen(first.oiDates).long} added or took off, each contract valued at the same pricing as the wall now (the live book's own price and minute)${oiWhen(first.oiDates).pending ? ` · ${oiWhen(first.oiDates).pending}` : ''} · every strike, the steady ones too — Show · What moved folds them away`
            : `${clock.inSession ? "Today's trading" : 'The last session'}, strike by strike · estimated from the day's volume until the overnight open-interest count loads · every strike, the steady ones too — Show · What moved folds them away`}
          {panes.length > 1 ? ' · one pane a name, each with its own expiry, strikes and order' : ''}
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
          const scales = data && iv != null ? { atr: sessionAtr(bookCandles(data.ticker) ?? []), sigma: peekDaySigma(data.ticker) ?? impliedDaySigma(data.spot, iv) } : null;
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
            <span title={OFF_SCOPE_TITLE} className="inline-flex items-center h-6 px-1.5 rounded border border-borderSubtle font-mono text-[9px] uppercase tracking-widest text-textMuted cursor-help" data-off-scope>
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
            </div>
          );
        })}
      </div>
      <BuildingArrived ticker={activeTicker} />
    </div>
  );
};

export default Building;
