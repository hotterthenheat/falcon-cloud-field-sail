/*
  THE PHONE'S WAY IN to the rail's Regime and Building tabs. A phone's Terrain has no strike rail (one chart fills the
  screen), so they stand as one quiet line under the chart — the curve's shape and the VIX, read off the same shared
  answer the rails use — and open as a sheet with both tabs. The same views as the rail, at the phone's width; no second
  request (data/regimeFeed.ts; Building's book and open-interest change are Pinpoint's own stores).
*/

import { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import Modal from '../ui/Modal';
import FilterTabs from '../ui/FilterTabs';
import { RegimeTabs } from './regimeLazy';
import { useVolRegime } from '../../data/regimeFeed';
import RailBuilding from './RailBuilding';
import { regimeInk } from './regimeInk';
import type { HeatMode } from './heatmap';

type Tab = 'regime' | 'building';
const TABS = [
  { value: 'regime', label: 'Regime' },
  { value: 'building', label: 'Building' },
] as const;

interface Props {
  ticker: string;
  /** The desk's heat ramp and the page's theme, as the rails read them */
  mode: HeatMode;
  paper: boolean;
}

const RegimeDoor = ({ ticker, mode, paper }: Props) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('regime');
  const { data } = useVolRegime();
  const vix = data?.quotes?.find(q => q.sym === 'VIX');
  const ratio = data?.ratios?.[0]?.value ?? null;
  const shape = data?.regime === 'contango' ? 'Contango' : data?.regime === 'backwardation' ? 'Backwardation' : data?.regime === 'flat' ? 'Flat curve' : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 mt-1.5 flex items-center gap-2 h-9 px-3 rounded-md border border-borderSubtle bg-panel text-left font-mono text-t11 tnum min-w-0"
        aria-label="Open the vol regime and Building"
        data-regime-door
      >
        <span className="text-t9 uppercase tracking-widest text-textMuted shrink-0">Curve</span>
        {shape && (
          <span className="font-semibold shrink-0" style={{ color: regimeInk(data?.regime) }}>
            {shape}
          </span>
        )}
        {ratio != null && <span className="text-textSecondary shrink-0">{ratio.toFixed(3)}</span>}
        {vix?.price != null && <span className="text-textSecondary truncate">VIX {vix.price.toFixed(2)}</span>}
        {!data && <span className="text-textMuted truncate">reading…</span>}
        <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textMuted">
          Building
          <ChevronUp className="w-3.5 h-3.5" />
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Vol regime and Building"
        header={<FilterTabs options={TABS} value={tab} onChange={setTab} ariaLabel="Regime or Building" size="sm" />}
      >
        <div className="h-[70dvh] -mx-4 -my-4" data-regime-sheet={tab}>
          {tab === 'regime' ? <RegimeTabs.Regime mode={mode} paper={paper} /> : <RailBuilding ticker={ticker} focus={null} />}
        </div>
      </Modal>
    </>
  );
};

export default RegimeDoor;
