/* Targets, a face of the Agenda: every strike in the order it matters (data/agenda.ts, which the Pulse panel also reads), the first three
   side by side. One to four panes, each a name and expiry (data/panes, slayer_targets_panes); beside others a pane goes compact. */

import { nyClock } from '../../core/nyTime';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useIsPhone } from '../../components/ui/useMediaQuery';
import { ensureBook } from '../../data/book/load';
import { snapshotOf, usePinpointFeed } from '../../data/book/feed';
import { useBookRev } from '../../data/book/store';
import { useTicker } from '../../context/MarketDataContext';
import { useFocus } from '../../context/FocusContext';
import ScopeChip from '../../components/ui/ScopeChip';
import DropdownSelect from '../../components/ui/DropdownSelect';
import ExpiryCard, { type ExpiryChoice } from '../../components/ui/ExpiryCard';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import { Deferred } from '../../components/ui/Skeleton';
import NamesDoor from '../../components/gex/NamesDoor';
import TargetsBoard, { ORDER_OPTIONS, TargetsControls, WINDOW_OPTIONS, densityFor, type TargetsDensity } from '../../components/gex/TargetsBoard';
import { TargetsGuide } from '../../components/gex/TargetsGuide';
import { AgendaSwitch } from './Agenda';
import { TargetsInner, TargetsPageSkeleton } from '../../components/gex/targetsSkeletons';
import { BookOrSkeleton } from './BookDown';
import WatchMenu from '../../components/gex/WatchMenu';
import { ladderExpiryOptions } from '../../components/gex/ladderControls';
import { armPrice, removeAlert, useAlerts } from '../../components/gex/alertStore';
import { trimAgenda, type Agenda, type AgendaOrder, type Target } from '../../data/agenda';
import { deskAgenda } from '../../data/board';
import { todayScopeLabel } from '../../data/bookWindow';
import { buildExposureProfile, type StrikeWindow } from '../../data/exposure';
import { buildExposureSurface, CALENDAR_DTES } from '../../data/exposureSurface';
import { aheadClock, type AheadClock } from '../../data/ahead';
import { readSessionClock } from '../../data/moc';
import { levelsForName } from '../../data/levelsScope';
import { MAX_PANES, OFF_SCOPE_TITLE, PANE_COLS, newPaneKey, readPanes, usePanesFollowScope, writePanes, type Pane } from '../../data/panes';
import { contractWords, usePositions } from '../../data/positions';
import type { ExposureExpiry } from '../../types/gex';
import type { MarketSnapshot } from '../../types/market';

/** The order sweeps on its own cadence — an agenda must not reshuffle with every tick */
const SCAN_INTERVAL_MS = 10_000;
const PANES_KEY = 'slayer_targets_panes';
let panesMemory: Pane[] | null = null;
let orderMemory: AgendaOrder = 'matters';
let windowMemory: StrikeWindow = 20;

const WINDOWS = new Set<number>([10, 15, 20, 25, 30]);
const ORDERS = new Set<string>(['matters', 'nearest', 'reached', 'weakest', 'biggest']);
const paneWindow = (p: Pane, fallback: StrikeWindow): StrikeWindow => (WINDOWS.has(p.strikes ?? -1) ? (p.strikes as StrikeWindow) : fallback);
const paneOrder = (p: Pane, fallback: AgendaOrder): AgendaOrder => (ORDERS.has(p.order ?? '') ? (p.order as AgendaOrder) : fallback);

/* New York's clock with its zone. */
const hhmmss = (d: Date) => nyClock(d, { seconds: true, zone: true });

/* ---- one pane --------------------------------------------------------------------------- */

interface PaneProps {
  pane: Pane;
  index: number;
  ticker: string;
  agenda: Agenda;
  snap: MarketSnapshot;
  clock: AheadClock;
  density: TargetsDensity;
  count: number;
  expiryOptions: ExpiryChoice<ExposureExpiry>[];
  /** The first pane follows the frame's name when it carries none of its own */
  linked: boolean;
  onToggleLink: () => void;
  onPickName: (t: string) => void;
  onExpiry: (e: ExposureExpiry) => void;
  /** The pane reads another expiry than the Levels card */
  offScope?: boolean;
  onRemove: () => void;
  yours?: ReadonlyMap<number, string>;
  focus: number | null;
  onPick: (strike: number) => void;
  /** This pane's list. Absent on a single pane — the row above owns it. */
  own?: { order: AgendaOrder; window: StrikeWindow; onOrder: (o: AgendaOrder) => void; onWindow: (w: StrikeWindow) => void };
}

/** A pane: its own alerts, its own watch menu, its own door off — the board under its line */
const TargetsPane = ({ pane, index, ticker, agenda, snap, clock, density, count, expiryOptions, linked, onToggleLink, onPickName, onExpiry, onRemove, yours, focus, onPick, offScope, own }: PaneProps) => {
  const navigate = useNavigate();
  const { focusOn } = useFocus();
  const alerts = useAlerts(ticker);
  const armedAt = (strike: number) => alerts.some(a => a.kind === 'price' && Math.abs(a.price - strike) < 1e-9);
  const onAlert = (t: Target) => {
    const armed = alerts.find(a => a.kind === 'price' && Math.abs(a.price - t.strike) < 1e-9);
    if (armed) removeAlert(ticker, armed.id);
    else armPrice(ticker, t.strike, agenda.spot);
  };
  /* THE CHART is the Map's — the strike arrives there already in focus */
  const onChart = (t: Target) => {
    focusOn(t.strike, ticker);
    navigate('/pinpoint/map');
  };
  const levels = useMemo(() => buildExposureProfile(snap, pane.expiry, 20).levels, [snap, pane.expiry]);
  const chip = <ScopeChip closeOutside ticker={ticker} linked={index === 0 ? linked : undefined} quote={density === 'full'} onToggleLink={index === 0 ? onToggleLink : undefined} onPick={onPickName} />;
  const expiry = (
    <>
      <ExpiryCard label="Expiry" value={pane.expiry} choices={expiryOptions} onChange={onExpiry} title={`Which expiry ${ticker} ranks. The other names keep theirs.`} testId={`targets-expiry-${index}`} size="sm" />
      {own && (
        <>
          <DropdownSelect label="Ranked by" value={own.order} options={ORDER_OPTIONS} onChange={own.onOrder} title={`How ${ticker} is ranked. The other names keep theirs.`} testId={`targets-order-${index}`} />
          <DropdownSelect label="Strikes" value={own.window} options={WINDOW_OPTIONS} onChange={v => own.onWindow(v as StrikeWindow)} title={`How many strikes ${ticker} shows. The other names keep theirs.`} testId={`targets-strikes-${index}`} />
        </>
      )}
      {offScope && (
            <span title={OFF_SCOPE_TITLE} className="inline-flex items-center h-6 px-1.5 rounded border border-borderSubtle font-mono text-t9 uppercase tracking-widest text-textMuted cursor-help" data-off-scope>
              own expiry
            </span>
          )}
    </>
  );
  const watch = <WatchMenu ticker={ticker} spot={agenda.spot} levels={levels} />;
  const off = count > 1 && (
    <button type="button" onClick={onRemove} title="Take this name off" aria-label={`Take ${ticker} off`} className="inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-targets-remove={ticker}>
      <X className="w-3 h-3" />
    </button>
  );
  /* A quarter of the screen holds the head in two rows; the door off stays by the name. The name's row stands over the
     expiry's (z-[1]): on a phone the scope chip's finger box reaches 22px under its centre, past the row's foot, and the
     expiry card's own box, drawn after it, used to take that strip (the last-targets pass, 2026-10-30). */
  const head =
    density === 'tight' ? (
      <div className="w-full flex flex-col gap-2">
        <div className="relative z-[1] flex items-center gap-2">
          {chip}
          {off}
        </div>
        <div className="flex items-center gap-2">
          {expiry}
          {watch}
        </div>
      </div>
    ) : (
      <>
        {chip}
        {expiry}
        {watch}
        {off}
      </>
    );
  return <TargetsBoard agenda={agenda} ticker={ticker} clock={clock} head={head} density={density} yours={yours} armedAt={armedAt} onChart={onChart} onAlert={onAlert} focus={focus} onPick={onPick} />;
};

/* ---- the face --------------------------------------------------------------------------- */

const RankedTargets = () => {
  const phone = useIsPhone();
  const { activeTicker, changeTicker } = useTicker();
  const marketData = usePinpointFeed(activeTicker);
  const bookRev = useBookRev();
  const { focus, toggleFocus } = useFocus();
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
  const [order, setOrderState] = useState<AgendaOrder>(orderMemory);
  const setOrder = (o: AgendaOrder) => {
    orderMemory = o;
    setOrderState(o);
    if (panes.length < 2) setPanes(panes.map(p => ({ ...p, order: o })));
  };
  const [window, setWindowState] = useState<StrikeWindow>(windowMemory);
  const setWindow = (w: StrikeWindow) => {
    windowMemory = w;
    setWindowState(w);
    if (panes.length < 2) setPanes(panes.map(p => ({ ...p, strikes: w })));
  };
  const [guideOpen, setGuideOpen] = useState(false);
  /* The expiries as dates, one list for every pane's card (ladderControls). */
  /* each pane's Expiry card names the listing its own name reads (ladderExpiryOptions with a ticker) — re-read as the
     book lands (bookRev re-renders the page) */
  const expiryOptionsFor = (t: string): ExpiryChoice<ExposureExpiry>[] => ladderExpiryOptions(t);

  /* THE CLOCK — New York time, re-read every 15s; the reach odds run on it */
  const [clockRaw, setClockRaw] = useState(() => readSessionClock());
  useEffect(() => {
    const id = globalThis.setInterval(() => setClockRaw(readSessionClock()), 15_000);
    return () => globalThis.clearInterval(id);
  }, []);
  const clock = useMemo(() => aheadClock(clockRaw), [clockRaw]);

  /* Scan-tier snapshot: the order sweeps every SCAN_INTERVAL_MS (a name change is immediate) */
  const [scan, setScan] = useState<{ snap: MarketSnapshot; at: string; nonce: number } | null>(null);
  const scanRef = useRef<MarketSnapshot | null>(null);
  const scanAtRef = useRef(0);
  useEffect(() => {
    if (!marketData) return;
    const now = Date.now();
    /* A book that changes shape (its per-expiry chains landed) is taken at once, not at the next scan. */
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

  /* THE AGENDA, one a pane — the same composition At the wall makes, every strike through it, on the pane's expiry */
  const nonce = scan?.nonce ?? 0;
  const panesKey = panes.map(p => `${p.key}:${p.ticker ?? ''}:${p.expiry}:${p.strikes ?? ''}:${p.order ?? ''}`).join(',');
  const agendas = useMemo(() => {
    const out = new Map<string, Agenda>();
    for (const p of panes) {
      const snap = snapFor(p);
      if (!snap) continue;
      /* The desk's one agenda (board.ts deskAgenda): the Board's and Compare's watch-first is this page's; the Strikes card only trims the list. */
      const surface = buildExposureSurface(snap, 30, CALENDAR_DTES);
      const agenda = deskAgenda(snap, p.expiry, clock, paneOrder(p, order), surface);
      if (agenda) out.set(p.key, trimAgenda(agenda, paneWindow(p, window)));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan, ownSnaps, panesKey, window, order, clock, nonce, bookRev]);

  /* Your strikes, for the rows — only on a pane that stands on the frame's name */
  const positions = usePositions(activeTicker);
  const yours = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of positions) {
      const w = `${p.side === 'long' ? 'you own' : 'you sold'} ${contractWords(p)}`;
      m.set(p.strike, m.has(p.strike) ? `${m.get(p.strike)} · ${w}` : w);
    }
    return m;
  }, [positions]);

  /* The box stands in its own shape while the first read walks in */
  const first = agendas.get(panes[0].key);
  if (!scan || !first) return <BookOrSkeleton tickers={[activeTicker]}><TargetsPageSkeleton rows={window * 2 - 2} /></BookOrSkeleton>;

  /* A phone is one narrow pane: the tight columns fit 360 px. */
  const density = phone ? 'tight' : densityFor(panes.length);
  let strikes = 0;
  for (const a of agendas.values()) strikes += a.targets.length;
  const lone = panes.length < 2;
  const headOrder = lone ? paneOrder(panes[0], order) : order;
  const headWindow = lone ? paneWindow(panes[0], window) : window;

  return (
    <div className="relative border border-borderSubtle rounded-md bg-panel" data-targets data-targets-panes={panes.length} data-scope-ticker={tickerFor(panes[0])}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the agenda" testId="targets-guide" viewport>
        <TargetsGuide agenda={first} clock={clock} />
      </GuideFocus>
      {/* The box's head: the Agenda's switch as the title, the guide, the line. */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <AgendaSwitch />
          <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the order, the cards and the rows mean" testId="targets-guide" />
        </div>
        <p className="mt-0.5 text-t11 text-textMuted lg:whitespace-nowrap lg:truncate">
          Every strike in the order it matters {todayScopeLabel() === 'Today' ? 'today' : 'next session'} — how likely price gets there × how much happens if it does
          {panes.length > 1 ? ' · one pane a name, each with its own expiry, rank and strikes' : ''}
        </p>
      </div>
      <TargetsControls
        lenses={panes.length < 2}
        order={headOrder}
        onOrder={setOrder}
        window={headWindow}
        onWindow={setWindow}
        names={<NamesDoor count={panes.length} onPick={addPane} testId="targets" title="Rank another name beside this one — up to four side by side, each on its own expiry" />}
        updatedAt={scan.at}
        strikes={strikes}
      />

      {/* The panes side by side (stacked on a phone), each a subgrid of five shared rows so the cards and lists line up across panes. */}
      <div className={`border-t border-borderSubtle grid grid-cols-1 ${PANE_COLS[panes.length] ?? ''} gap-x-px gap-y-0 bg-borderSubtle/60`} data-targets-grid>
        {panes.map((p, i) => {
          const agenda = agendas.get(p.key);
          const snap = snapFor(p);
          const t = tickerFor(p);
          const linked = p.ticker === undefined;
          return (
            <div key={p.key} className="bg-panel min-w-0 grid grid-rows-subgrid row-span-5" data-targets-pane={t} data-targets-expiry={p.expiry}>
              {agenda && snap ? (
                <Deferred
                  fallback={
                    <div className="row-span-5">
                      <TargetsInner rows={Math.max(0, agenda.targets.length - 3)} bare />
                    </div>
                  }
                  className="grid grid-rows-subgrid row-span-5 animate-fade-in"
                >
                  <TargetsPane
                    pane={p}
                    index={i}
                    ticker={t}
                    agenda={agenda}
                    snap={snap}
                    clock={clock}
                    density={density}
                    count={panes.length}
                    expiryOptions={expiryOptionsFor(t)}
                    linked={linked}
                    onToggleLink={() => patchPane(p.key, { ticker: linked ? t : undefined })}
                    onPickName={next => (i === 0 && linked ? changeTicker(next) : patchPane(p.key, { ticker: next.toUpperCase() }))}
                    onExpiry={e => patchPane(p.key, { expiry: e })}
                    offScope={p.expiry !== levelsForName(t)}
                    onRemove={() => removePane(p.key)}
                    yours={t === activeTicker ? yours : undefined}
                    focus={focusFor(t)}
                    onPick={strike => toggleFocus(strike, t)}
                    own={panes.length > 1 ? { order: paneOrder(p, order), window: paneWindow(p, window), onOrder: o => patchPane(p.key, { order: o }), onWindow: w => patchPane(p.key, { strikes: w }) } : undefined}
                  />
                </Deferred>
              ) : (
                <div className="row-span-5">
                  <TargetsInner rows={window * 2 - 2} bare />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RankedTargets;
