/*
==================================================
  SLAYER TERMINAL - TARGETS, THE AGENDA
  (pages/pinpoint/RankedTargets.tsx)

  A FACE OF THE AGENDA since 2026-10-14 (Noah:
  Building and Targets "on the same page put
  interchangable" — pages/pinpoint/Agenda.tsx,
  /pinpoint/agenda, the face it opens on). ONE BOX
  since the same day (Noah, with its picture:
  "remove both of these from their designated
  sections and add more strikes to fill their
  positions"): the strike axis is gone, and the
  list opens on twenty strikes each side instead
  of fifteen.

  ONE TO FOUR NAMES, EACH ON ITS OWN EXPIRY (Noah,
  2026-10-15: "can we add exp and different tickers
  to the targets page as well?") — Building's
  grammar, the same box: its head is the Agenda's
  switch, the guide door and the line; under it ONE
  line of cards for every pane — Ranked by · Strikes
  · the NAMES door — and then THE PANES SIDE BY
  SIDE, one a name: the first follows the frame's
  name (its chip is linked, the Map's grammar) and
  each added one holds its own; every pane carries
  its EXPIRY card (the house's expiries as dates,
  ladderControls), its watch menu, its four facts,
  its sentence, its podium and its list. Beside
  other panes a pane goes COMPACT — beside one it
  keeps the figures and drops the words, beside two
  or three it keeps the strike, the odds and the
  actions (TargetsBoard's densities) — and alone it
  is the whole board as it was. The panes are kept
  on this machine (slayer_targets_panes, data/panes).
  The expiry is the agenda's: the hedging a pane
  ranks is that expiry's (data/exposure
  EXPIRY_DECAY in the simulator; each expiry's own
  open interest on the feed).

  Rebuilt 2026-09-08 on the numbers the other pages
  now produce. The page that answers "so what do I
  watch today, in what order?": every strike in the
  order it matters — how likely price gets there ×
  how much happens if it does; the first three side
  by side, the rest as one list, two actions per
  strike (chart · alert).

  A COMPOSITION: reach and holds are At the wall's,
  built or drained is Building's, "closes here" is
  Ahead's, the roles are the Map's, the positions
  the overlay's, the alerts the chart's own store.
  data/agenda.ts holds the order, and the Pulse
  Targets panel reads the same one.
==================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { useIsPhone } from '../../components/ui/useMediaQuery';
import { bookCandles, bookHistory, ensureBook, peekIv, snapshotOf, useBookRev, usePinpointFeed, ensureOiChange, peekOiChange } from '../../data/uwBook';
import { useTicker } from '../../context/MarketDataContext';
import { useFocus } from '../../context/FocusContext';
import ScopeChip from '../../components/ui/ScopeChip';
import DropdownSelect, { type DropdownOption } from '../../components/ui/DropdownSelect';
import GuideFocus, { GuideDoor } from '../../components/ui/GuideFocus';
import { Deferred } from '../../components/ui/Skeleton';
import NamesDoor from '../../components/gex/NamesDoor';
import TargetsBoard, { TargetsControls, densityFor, type TargetsDensity } from '../../components/gex/TargetsBoard';
import { TargetsGuide } from '../../components/gex/TargetsGuide';
import { AgendaSwitch } from './Agenda';
import { TargetsInner, TargetsPageSkeleton } from '../../components/gex/targetsSkeletons';
import { BookOrSkeleton } from './BookDown';
import WatchMenu from '../../components/gex/WatchMenu';
import { ladderExpiryOptions } from '../../components/gex/ladderControls';
import { armPrice, removeAlert, useAlerts } from '../../components/gex/alertStore';
import { buildAgenda, type Agenda, type AgendaOrder, type Target } from '../../data/agenda';
import { buildExposureProfile, type StrikeWindow } from '../../data/exposure';
import { buildExposureSurface, CALENDAR_DTES } from '../../data/exposureSurface';
import { aheadClock, type AheadClock } from '../../data/ahead';
import { buildBuilding } from '../../data/building';
import { readSessionClock } from '../../data/moc';
import { MAX_PANES, PANE_COLS, newPaneKey, readPanes, writePanes, type Pane } from '../../data/panes';
import { contractWords, usePositions } from '../../data/positions';
import type { ExposureExpiry } from '../../types/gex';
import type { MarketSnapshot } from '../../types/market';

/** The order sweeps on its own cadence — an agenda must not reshuffle with every tick */
const SCAN_INTERVAL_MS = 10_000;
const PANES_KEY = 'slayer_targets_panes';
let panesMemory: Pane[] | null = null;
let orderMemory: AgendaOrder = 'matters';
let windowMemory: StrikeWindow = 20;

const hhmmss = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

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
  expiryOptions: DropdownOption<ExposureExpiry>[];
  /** The first pane follows the frame's name when it carries none of its own */
  linked: boolean;
  onToggleLink: () => void;
  onPickName: (t: string) => void;
  onExpiry: (e: ExposureExpiry) => void;
  onRemove: () => void;
  yours?: ReadonlyMap<number, string>;
  focus: number | null;
  onPick: (strike: number) => void;
}

/** A pane: its own alerts, its own watch menu, its own door off — the board under its line */
const TargetsPane = ({ pane, index, ticker, agenda, snap, clock, density, count, expiryOptions, linked, onToggleLink, onPickName, onExpiry, onRemove, yours, focus, onPick }: PaneProps) => {
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
  const chip = <ScopeChip ticker={ticker} linked={index === 0 ? linked : undefined} quote={density === 'full'} onToggleLink={index === 0 ? onToggleLink : undefined} onPick={onPickName} />;
  const expiry = <DropdownSelect label="Expiry" value={pane.expiry} options={expiryOptions} onChange={onExpiry} title="Which expiry's hedging this pane ranks" testId={`targets-expiry-${index}`} size="sm" />;
  const watch = <WatchMenu ticker={ticker} spot={agenda.spot} levels={levels} />;
  const off = count > 1 && (
    <button type="button" onClick={onRemove} title="Take this name off" aria-label={`Take ${ticker} off`} className="inline-flex items-center justify-center w-6 h-6 rounded text-textMuted hover:text-textPrimary hover:bg-ink/[0.06] transition-colors" data-targets-remove={ticker}>
      <X className="w-3 h-3" />
    </button>
  );
  /* a quarter of the screen holds the line in two rows by design — the name with its door off beside it, then the expiry
     and the watch — rather than wrapping the door off alone under the rest. THE DOOR OFF STAYS BY THE NAME (Noah,
     2026-10-15: pushed to the row's far end it stood "in the middle of the screen" between panes) */
  const head =
    density === 'tight' ? (
      <div className="w-full flex flex-col gap-2">
        <div className="flex items-center gap-2">
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
  const addPane = (ticker: string) => {
    if (panes.length >= MAX_PANES) return;
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    ensureBook(t, 'full');
    setPanes([...panes, { key: newPaneKey(), ticker: t, expiry: '0DTE' }]);
  };
  const removePane = (key: string) => {
    if (panes.length <= 1) return;
    setPanes(panes.filter(p => p.key !== key));
  };
  const [order, setOrderState] = useState<AgendaOrder>(orderMemory);
  const setOrder = (o: AgendaOrder) => {
    orderMemory = o;
    setOrderState(o);
  };
  const [window, setWindowState] = useState<StrikeWindow>(windowMemory);
  const setWindow = (w: StrikeWindow) => {
    windowMemory = w;
    setWindowState(w);
  };
  const [guideOpen, setGuideOpen] = useState(false);
  /* THE EXPIRIES AS DATES — one list for every pane's card (ladderControls, the Map's own) */
  /* each pane's Expiry card names the listing its own name reads (ladderExpiryOptions with a ticker) — re-read as the
     book lands (bookRev re-renders the page) */
  const expiryOptionsFor = (t: string): DropdownOption<ExposureExpiry>[] => ladderExpiryOptions(t).map(o => ({ value: o.value, label: o.label, hint: o.hint }));

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
    /* the full book (every expiry's own chain) lands a few seconds after the board read — inside the sweep's window,
       so it was dropped and the page sat on the whole-book-only read until the next refresh (the UI sweep, 2026-10-22:
       the Map crowned the whole book's supreme while the other pages read today's) — a book that changes SHAPE is taken
       at once */
    const shape = (s: MarketSnapshot | null) => Object.keys(s?.uwChains ?? {}).length;
    const due = !scanRef.current || now - scanAtRef.current >= SCAN_INTERVAL_MS || scanRef.current.ticker !== marketData.ticker || shape(scanRef.current) !== shape(marketData);
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
    if (!scan) return null;
    if (!p.ticker || p.ticker === scan.snap.ticker) return scan.snap;
    return ownSnaps.get(p.ticker) ?? scan.snap;
  };
  const tickerFor = (p: Pane) => p.ticker ?? activeTicker;
  const focusFor = (t: string) => (focus && focus.ticker === t ? focus.price : null);

  /* THE AGENDA, one a pane — the same composition At the wall makes, every strike through it, on the pane's expiry */
  const nonce = scan?.nonce ?? 0;
  const panesKey = panes.map(p => `${p.key}:${p.ticker ?? ''}:${p.expiry}`).join(',');
  const agendas = useMemo(() => {
    const out = new Map<string, Agenda>();
    for (const p of panes) {
      const snap = snapFor(p);
      if (!snap) continue;
      const t = snap.ticker;
      const profile = buildExposureProfile(snap, p.expiry, window);
      const iv = peekIv(t) ?? 0;
      ensureOiChange(t);
      const building = buildBuilding(snap, bookHistory(t) ?? [], bookCandles(t) ?? [], profile, clock, peekOiChange(t));
      const surface = buildExposureSurface(snap, 30, CALENDAR_DTES);
      out.set(p.key, buildAgenda(snap, profile, building, surface, bookCandles(t) ?? [], clock, iv, order));
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

  /* a phone is one narrow pane: the tight columns (strike · reached · holds · actions) fit its 360px, the full list ran
     off the right edge at "Reached next" (the phone sweep, 2026-10-22) */
  const density = phone ? 'tight' : densityFor(panes.length);
  let strikes = 0;
  for (const a of agendas.values()) strikes += a.targets.length;

  return (
    <div className="relative border border-borderSubtle rounded-md bg-panel" data-targets data-targets-panes={panes.length} data-scope-ticker={tickerFor(panes[0])}>
      <GuideFocus open={guideOpen} onClose={() => setGuideOpen(false)} title="How to read the agenda" testId="targets-guide" viewport>
        <TargetsGuide agenda={first} clock={clock} />
      </GuideFocus>
      {/* THE BOX'S HEAD — the Agenda's switch as the title, the guide, the line */}
      <div className="px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 flex-wrap">
          <AgendaSwitch />
          <GuideDoor open={guideOpen} onClick={() => setGuideOpen(v => !v)} title="What the order, the cards and the rows mean" testId="targets-guide" />
        </div>
        <p className="mt-0.5 text-[11px] text-textMuted whitespace-nowrap truncate">
          Every strike in the order it matters today — how likely price gets there × how much happens if it does
          {panes.length > 1 ? ' · one pane a name, each on its own expiry' : ''}
        </p>
      </div>
      <TargetsControls
        order={order}
        onOrder={setOrder}
        window={window}
        onWindow={setWindow}
        names={<NamesDoor count={panes.length} onPick={addPane} testId="targets" title="Rank another name beside this one — up to four side by side, each on its own expiry" />}
        updatedAt={scan.at}
        strikes={strikes}
      />

      {/* THE PANES — side by side at desk width, a hairline between; stacked on a phone. ON SHARED ROWS (Noah, 2026-10-15,
          with three panes: "do you notice the alignment issues here esp with the #1 card" — one pane's sentence ran to three
          lines, the others' to two, and its card and list sat lower): every pane is a subgrid of five rows — the head,
          the sentence, the podium, the list, the foot — so each row is as tall as the tallest pane needs and the cards and
          the lists line up across the box */}
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
                    onRemove={() => removePane(p.key)}
                    yours={t === activeTicker ? yours : undefined}
                    focus={focusFor(t)}
                    onPick={strike => toggleFocus(strike, t)}
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
