/* What every desk reads by, set on Settings: the name and timeframe a desk opens on, whether alerts sound, whose clock the axes keep.
   In localStorage until the account carries them; read at first render, by the chart clock and by the bell. The charts'
   own two choices ride here too: how the exposure nodes draw, and which option prints the flow pane sums. */

import { useSyncExternalStore } from 'react';
import { TIMEFRAMES, frameServed, type Timeframe } from './timeframe';

export type ClockZone = 'local' | 'ny';

/** How the exposure nodes draw: dotted strike rows (beads), the filled field behind price (heat), or beads over a faint field */
export type NodeLook = 'beads' | 'heat' | 'both';
export const NODE_LOOKS: readonly { value: NodeLook; label: string; hint: string }[] = [
  { value: 'beads', label: 'Beads', hint: 'A row of dots on each heavy strike, each dot sized by the exposure at that bar' },
  { value: 'heat', label: 'Heat', hint: 'The filled field: every strike, every bar, coloured by its exposure' },
  { value: 'both', label: 'Both', hint: 'The beads over a faint field' },
];

/** Which option prints the flow pane sums. Each is a narrowing or "all". */
export interface FlowFilters {
  /** single-leg prints only, or legs of multi-leg orders as well */
  leg: 'single' | 'all';
  /** out of the money only */
  mny: 'otm' | 'all';
  /** at the ask only (calls bought up, puts bought down), or both sides */
  side: 'ask' | 'all';
  /** sweeps only */
  kind: 'sweep' | 'all';
  /** days to expiry, at most: 14, 60, or any */
  dte: '14' | '60' | 'all';
  /** a print's premium, at least: $50K, $250K, or any — the vendor's tape holds one session, and a floor is what lets a
      few pages of it reach back to the open on a busy name */
  prem: '50k' | '250k' | 'all';
}
export const DEFAULT_FLOW_FILTERS: FlowFilters = { leg: 'single', mny: 'otm', side: 'all', kind: 'all', dte: '60', prem: '50k' };

interface DeskPrefs {
  opensOn: {
    /** null = where you left off (the simulator's last active name) */
    ticker: string | null;
    /** null = each desk's own (Pulse 1m, the Map 15m …) */
    timeframe: Timeframe | null;
    /** null = the start page; else a rail page's path, where the landing's launch door lands (landing/pieces.tsx doorTo). */
    page: string | null;
  };
  /** the jingle when one arms, the chime when it fires */
  alertsSound: boolean;
  /** the axes' clock — New York's, or the machine's own */
  clock: ClockZone;
  /** how the exposure nodes draw on the charts */
  nodeLook: NodeLook;
  /** the flow pane's filters */
  flowFilters: FlowFilters;
}

const KEY = 'slayer_desk_prefs';
const DEFAULT_DESK_PREFS: DeskPrefs = { opensOn: { ticker: null, timeframe: null, page: null }, alertsSound: true, clock: 'ny', nodeLook: 'both', flowFilters: DEFAULT_FLOW_FILTERS };

function asTimeframe(v: unknown): Timeframe | null {
  if (typeof v !== 'string') return null;
  const known = TIMEFRAMES.find(t => t.value === v);
  return known && frameServed(known.value) ? known.value : null;
}

const asLook = (v: unknown): NodeLook => (v === 'beads' || v === 'heat' || v === 'both' ? v : 'both');

/** A stored filter set, field by field against the default */
export function asFlowFilters(v: unknown): FlowFilters {
  const f = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof FlowFilters, unknown>>;
  const d = DEFAULT_FLOW_FILTERS;
  return {
    leg: f.leg === 'single' || f.leg === 'all' ? f.leg : d.leg,
    mny: f.mny === 'otm' || f.mny === 'all' ? f.mny : d.mny,
    side: f.side === 'ask' || f.side === 'all' ? f.side : d.side,
    kind: f.kind === 'sweep' || f.kind === 'all' ? f.kind : d.kind,
    dte: f.dte === '14' || f.dte === '60' || f.dte === 'all' ? f.dte : d.dte,
    prem: f.prem === '50k' || f.prem === '250k' || f.prem === 'all' ? f.prem : d.prem,
  };
}

let prefs: DeskPrefs = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DESK_PREFS;
    const p = JSON.parse(raw) as Partial<DeskPrefs>;
    return {
      opensOn: { ticker: p.opensOn?.ticker ?? null, timeframe: asTimeframe(p.opensOn?.timeframe), page: typeof p.opensOn?.page === 'string' ? p.opensOn.page : null },
      alertsSound: p.alertsSound ?? true,
      /* New York's clock unless the reader chose the machine's (every time in the app is ET) */
      clock: p.clock === 'local' ? 'local' : 'ny',
      nodeLook: asLook(p.nodeLook),
      flowFilters: asFlowFilters(p.flowFilters),
    };
  } catch {
    return DEFAULT_DESK_PREFS;
  }
})();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** A patch — `opensOn` may name only the name or only the timeframe, `flowFilters` only the filters it changes */
type DeskPrefsPatch = Partial<Omit<DeskPrefs, 'opensOn' | 'flowFilters'>> & { opensOn?: Partial<DeskPrefs['opensOn']>; flowFilters?: Partial<FlowFilters> };
export function setDeskPrefs(patch: DeskPrefsPatch): void {
  const nextOpen = patch.opensOn?.timeframe;
  const opensOn = nextOpen && !frameServed(nextOpen) ? { ...patch.opensOn, timeframe: null } : patch.opensOn;
  prefs = {
    ...prefs,
    ...patch,
    opensOn: { ...prefs.opensOn, ...(opensOn ?? {}) },
    flowFilters: patch.flowFilters ? asFlowFilters({ ...prefs.flowFilters, ...patch.flowFilters }) : prefs.flowFilters,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage off — the choice lives for the session */
  }
  listeners.forEach(fn => fn());
}

/** For code outside React — a host's first render, the chart clock, the bell */
export const readDeskPrefs = (): DeskPrefs => prefs;
export const useDeskPrefs = (): DeskPrefs => useSyncExternalStore(subscribe, readDeskPrefs, () => DEFAULT_DESK_PREFS);
