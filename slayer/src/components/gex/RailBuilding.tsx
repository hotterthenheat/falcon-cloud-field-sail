/*
  THE RAIL'S BUILDING TAB (2026-10-31, the owner: "isn't the OI change the same thing as the Building section in
  Pinpoint?" — it is): Pinpoint's Building, one pane of it, in Terrain's strike rail. The same ledger
  (BuildingLedger, its rail variant), the same arithmetic (data/building.ts buildBuilding) and the same reads as
  /pinpoint/agenda?view=building for the pane's name: the full book (data/book/feed.ts snapshotOf 'full', the one
  store every page shares) and the overnight open-interest change through data/book/oiChange.ts's public API
  (ensureOiChange / peekOiChange) — no request of its own. The pane's Expiry card is Building's own (ladderExpiryOptions),
  kept per name for the session; the strike rail's pick of a strike is the ledger's pin.
*/

import { useEffect, useMemo, useState } from 'react';
import { daySigmaOfIv } from '../../data/expectedMove';
import { bookCandles, bookHistory } from '../../data/book/levels';
import { peekDaySigma, peekIv } from '../../data/book/move';
import { snapshotOf } from '../../data/book/feed';
import { useBookRev } from '../../data/book/store';
import { ensureOiChange, peekOiChange } from '../../data/book/oiChange';
import { buildExposureProfile } from '../../data/exposure';
import { aheadClock } from '../../data/ahead';
import { fmtDistance, sessionAtr } from '../../data/atr';
import { buildBuilding } from '../../data/building';
import { unitForName } from '../../data/distanceUnits';
import { levelsForName } from '../../data/levelsScope';
import { readSessionClock } from '../../data/moc';
import { usePositions } from '../../data/positions';
import DropdownSelect from '../ui/DropdownSelect';
import ExpiryCard from '../ui/ExpiryCard';
import BuildingLedger, { SHOW_OPTIONS, type BuildShow } from './BuildingLedger';
import { BuildingLedgerSkeleton } from './buildingSkeletons';
import { ladderExpiryOptions } from './ladderControls';
import type { ExposureExpiry } from '../../types/gex';

/** Building's own pace (pages/pinpoint/Building.tsx): the open interest is re-valued every ten seconds, not every tick */
const SCAN_INTERVAL_MS = 10_000;
/** Building's default window, ±20 strikes */
const WINDOW = 20;
/* each name's expiry and Show choice, held for the session as Pinpoint's panes hold theirs */
const expiryMemory = new Map<string, ExposureExpiry>();
let showMemory: BuildShow = 'moved';

interface Props {
  ticker: string;
  focus: number | null;
  onPick?: (strike: number) => void;
}

const RailBuilding = ({ ticker, focus, onPick }: Props) => {
  const t = ticker.toUpperCase();
  const [expiry, setExpiryState] = useState<ExposureExpiry>(() => expiryMemory.get(t) ?? levelsForName(t));
  useEffect(() => setExpiryState(expiryMemory.get(t) ?? levelsForName(t)), [t]);
  const setExpiry = (e: ExposureExpiry) => {
    expiryMemory.set(t, e);
    setExpiryState(e);
  };
  const [show, setShowState] = useState<BuildShow>(showMemory);
  const setShow = (s: BuildShow) => {
    showMemory = s;
    setShowState(s);
  };
  const bookRev = useBookRev();
  /* the clock and the scan, on Building's own cadence */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = globalThis.setInterval(() => setTick(n => n + 1), SCAN_INTERVAL_MS);
    return () => globalThis.clearInterval(id);
  }, []);
  const clock = useMemo(() => aheadClock(readSessionClock()), [tick]);
  const data = useMemo(() => {
    const snap = snapshotOf(t, 'full');
    if (!snap) return null;
    ensureOiChange(t);
    return buildBuilding(snap, bookHistory(t) ?? [], bookCandles(t) ?? [], buildExposureProfile(snap, expiry, WINDOW), clock, peekOiChange(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, expiry, clock, bookRev]);
  const positions = usePositions(t);
  const yours = useMemo(() => new Set(positions.map(p => p.strike)), [positions]);

  if (!data) return <BuildingLedgerSkeleton rows={WINDOW * 2 + 1} bare folded={show === 'moved'} />;
  const iv = peekIv(data.ticker);
  const scales = iv != null ? { atr: sessionAtr(bookCandles(data.ticker) ?? []), sigma: peekDaySigma(data.ticker) ?? daySigmaOfIv(data.spot, iv) } : null;
  const distanceOf = (strike: number) => (scales ? fmtDistance(strike - data.spot, data.spot, unitForName(t), scales) : '');
  const head = (
    <>
      <ExpiryCard label="Expiry" value={expiry} choices={ladderExpiryOptions(t)} onChange={setExpiry} title={`Which expiry ${t}'s Building reads`} testId="rail-build-expiry" size="sm" />
      <DropdownSelect label="Show" value={show} options={SHOW_OPTIONS} onChange={setShow} title="What the ledger lists" testId="rail-build-show" size="sm" />
    </>
  );
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden" data-rail-building={t}>
      <BuildingLedger
        data={data}
        ticker={t}
        clock={clock}
        order="strike"
        window={WINDOW}
        show={show}
        distanceOf={distanceOf}
        yours={yours}
        focus={focus}
        onPick={onPick}
        onClear={() => focus != null && onPick?.(focus)}
        head={head}
        rail
      />
    </div>
  );
};

export default RailBuilding;
