/*
  THE PHONE'S WAY IN to the rail's Regime and OI change tabs. A phone's Terrain has no strike rail (one chart fills the
  screen), so the two market reads stand as one quiet line under the chart — the curve's shape and the VIX, read off the
  same shared answer the rails use — and open as a sheet with both tabs. The same views as the rail, at the phone's
  width; no second request (data/regimeFeed.ts).
*/

import { useState } from 'react';
import { ChevronUp } from 'lucide-react';
import Modal from '../ui/Modal';
import FilterTabs from '../ui/FilterTabs';
import { RegimeTabs } from './regimeLazy';
import { useVolRegime } from '../../data/regimeFeed';

type Tab = 'regime' | 'oi';
const TABS = [
  { value: 'regime', label: 'Regime' },
  { value: 'oi', label: 'OI change' },
] as const;

interface Props {
  ticker: string;
  oiScope: { expiry: string; label: string };
  spot: number;
}

const RegimeDoor = ({ ticker, oiScope, spot }: Props) => {
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
        aria-label="Open the vol regime and the open-interest change"
        data-regime-door
      >
        <span className="text-t9 uppercase tracking-widest text-textMuted shrink-0">Curve</span>
        {shape && <span className="font-semibold text-textPrimary shrink-0">{shape}</span>}
        {ratio != null && <span className="text-textSecondary shrink-0">{ratio.toFixed(3)}</span>}
        {vix?.price != null && <span className="text-textSecondary truncate">VIX {vix.price.toFixed(2)}</span>}
        {!data && <span className="text-textMuted truncate">reading…</span>}
        <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-t9 uppercase tracking-widest text-textMuted">
          OI change
          <ChevronUp className="w-3.5 h-3.5" />
        </span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Vol regime and open-interest change"
        header={<FilterTabs options={TABS} value={tab} onChange={setTab} ariaLabel="Regime or OI change" size="sm" />}
      >
        <div className="h-[70dvh] -mx-4 -my-4" data-regime-sheet={tab}>
          {tab === 'regime' ? <RegimeTabs.Regime /> : <RegimeTabs.Oi ticker={ticker} expiry={oiScope.expiry} scopeLabel={oiScope.label} spot={spot} />}
        </div>
      </Modal>
    </>
  );
};

export default RegimeDoor;
