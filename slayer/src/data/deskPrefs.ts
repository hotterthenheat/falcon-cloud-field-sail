/* What every desk reads by, set on Settings: the name and timeframe a desk opens on, whether alerts sound, whose clock the axes keep.
   In localStorage until the account carries them; read at first render, by the chart clock and by the bell. The charts'
   own two choices ride here too: how the exposure nodes draw, and which option prints the flow pane sums. */

import { useSyncExternalStore } from 'react';
import { TIMEFRAMES, frameServed, type Timeframe } from './timeframe';
import { PRINT_TYPES, type PrintType } from './printTags';

/* THE AXES' CLOCK (Settings › Desk › Clock, and the timezone door on Terrain's strip — the partner tree's 260a099 list):
   the machine's own, New York's, or one of the world sessions' cities (shared/marketSession.mjs WORLD_SESSIONS keeps
   Tokyo's and London's windows). 'local' keeps a null zone — the Date's own getters are the reader's clock. */
export type ClockZone = 'local' | 'ny' | 'utc' | 'london' | 'tokyo';
export interface ClockZoneDef {
  value: ClockZone;
  label: string;
  /** the letters a chip prints */
  short: string;
  hint: string;
  /** the IANA zone; null = the machine's own */
  zone: string | null;
}
const machineZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "The machine's zone";
  }
};
export const CLOCK_ZONES: readonly ClockZoneDef[] = [
  { value: 'local', label: 'Your own', short: 'Local', hint: machineZone(), zone: null },
  { value: 'ny', label: 'New York', short: 'NY', hint: "The market's clock — the regular session opens and closes on it", zone: 'America/New_York' },
  { value: 'utc', label: 'UTC', short: 'UTC', hint: 'The wire’s clock — no summer time', zone: 'UTC' },
  { value: 'london', label: 'London', short: 'LDN', hint: 'The LSE’s day, 08:00 to 16:30 London', zone: 'Europe/London' },
  { value: 'tokyo', label: 'Tokyo', short: 'TYO', hint: 'The TSE’s day, 09:00 to 15:30 Tokyo', zone: 'Asia/Tokyo' },
];
const isClockZone = (v: unknown): v is ClockZone => CLOCK_ZONES.some(z => z.value === v);
/** The IANA zone behind a choice; null for the machine's own */
export const clockZoneOf = (c: ClockZone): string | null => CLOCK_ZONES.find(z => z.value === c)?.zone ?? null;

/** How the exposure nodes draw: the book's biggest nodes as level bands across the chart (levels, the default), dotted
    strike rows (beads), the filled field behind price (heat), beads over a faint field, or each strike as a waveform
    ribbon whose thickness is its strength (ribbon) */
export type NodeLook = 'levels' | 'beads' | 'heat' | 'both' | 'ribbon';
export const NODE_LOOKS: readonly { value: NodeLook; label: string; hint: string }[] = [
  { value: 'levels', label: 'Levels', hint: "The biggest nodes of the book now, each a band across the whole chart, its thickness the node's size" },
  { value: 'beads', label: 'Beads', hint: 'A row of dots on each heavy strike, each dot sized by the exposure at that bar' },
  { value: 'heat', label: 'Heat', hint: 'The filled field: every strike, every bar, coloured by its exposure' },
  { value: 'both', label: 'Both', hint: 'The beads over a faint field' },
  { value: 'ribbon', label: 'Ribbon', hint: 'Each heavy strike as a ribbon across time, its thickness the exposure at that bar' },
];

/** Which option prints the flow pane sums. Each is a narrowing or "all". */
export interface FlowFilters {
  /** spread legs left out of the net ('single', the default: a leg is half of a structure, not a bet), or counted by
      their side ('all') */
  leg: 'single' | 'all';
  /** out of the money only */
  mny: 'otm' | 'all';
  /** at the ask only (calls bought up, puts bought down), or both sides */
  side: 'ask' | 'all';
  /** which prints, by type (data/printTags.ts): every one, or sweeps, spread legs, floor trades, blocks or singles */
  kind: 'all' | PrintType;
  /** days to expiry, at most: 14, 60, or any */
  dte: '14' | '60' | 'all';
  /** a print's premium, at least: $50K, $250K, or any — the vendor's tape holds one session, and a floor is what lets a
      few pages of it reach back to the open on a busy name */
  prem: '50k' | '250k' | 'all';
}
/** The node-pressure distances a reader picks from, percent of price */
export const NODE_ALERT_PCTS: readonly number[] = [0.1, 0.15, 0.25, 0.5];

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
  /** the axes' clock — New York's, the machine's own, UTC, London's or Tokyo's */
  clock: ClockZone;
  /** how the exposure nodes draw on the charts */
  nodeLook: NodeLook;
  /** the looks' revision the stored `nodeLook` was chosen under: an older one opens on the new default once */
  nodeLookV?: number;
  /** the flow pane's filters */
  flowFilters: FlowFilters;
  /** node pressure: how near a heavy node or the flip, in percent of price, fires the alert */
  nodeAlertPct: number;
}

const KEY = 'slayer_desk_prefs';
/** The looks' revision: 2 made `levels` the default (2026-11-01) */
const NODE_LOOK_V = 2;
const DEFAULT_DESK_PREFS: DeskPrefs = { opensOn: { ticker: null, timeframe: null, page: null }, alertsSound: true, clock: 'ny', nodeLook: 'levels', nodeLookV: NODE_LOOK_V, flowFilters: DEFAULT_FLOW_FILTERS, nodeAlertPct: 0.15 };

function asTimeframe(v: unknown): Timeframe | null {
  if (typeof v !== 'string') return null;
  const known = TIMEFRAMES.find(t => t.value === v);
  return known && frameServed(known.value) ? known.value : null;
}

const asLook = (v: unknown): NodeLook => (v === 'levels' || v === 'beads' || v === 'heat' || v === 'both' || v === 'ribbon' ? v : 'levels');

/** A stored filter set, field by field against the default */
export function asFlowFilters(v: unknown): FlowFilters {
  const f = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof FlowFilters, unknown>>;
  const d = DEFAULT_FLOW_FILTERS;
  return {
    leg: f.leg === 'single' || f.leg === 'all' ? f.leg : d.leg,
    mny: f.mny === 'otm' || f.mny === 'all' ? f.mny : d.mny,
    side: f.side === 'ask' || f.side === 'all' ? f.side : d.side,
    kind: f.kind === 'all' || (PRINT_TYPES as readonly unknown[]).includes(f.kind) ? (f.kind as FlowFilters['kind']) : d.kind,
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
      clock: isClockZone(p.clock) ? p.clock : 'ny',
      /* a look stored before `levels` was the default opens on it once; a later pick is kept */
      nodeLook: p.nodeLookV === NODE_LOOK_V ? asLook(p.nodeLook) : 'levels',
      nodeLookV: NODE_LOOK_V,
      flowFilters: asFlowFilters(p.flowFilters),
      nodeAlertPct: typeof p.nodeAlertPct === 'number' && p.nodeAlertPct > 0 && p.nodeAlertPct <= 5 ? p.nodeAlertPct : 0.15,
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
