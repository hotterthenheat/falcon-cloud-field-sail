/*
  What the Compass board was set to (tenor, kind, layout, name, selected card), kept across the trip to a setup's
  page and back.
*/

import { useSyncExternalStore } from 'react';
import type { OptionRight, ScannerKey, SleeveKey } from '../types/compass';

export type BoardLayout = 'cards' | 'table';

export interface CompassView {
  sleeve: SleeveKey;
  scanner: ScannerKey;
  layout: BoardLayout;
  /** null = every name */
  tickerFilter: string | null;
  selectedId: string | null;
  /** THE CONTRACT THE READER IS INSIDE (2026-09-13): the last setup page landed on — the sidebar's
      "Inside the contract" points at it and keeps it across the board and the Tracker until another
      contract takes its place (Noah: "it should stay there until another con takes its place") */
  chosenId: string | null;
  /** Board side. BOTH is the whole book. Call or Put narrows it. */
  right: OptionRight | 'BOTH';
}

let view: CompassView = { sleeve: 'odte', scanner: 'top-setups', layout: 'cards', tickerFilter: null, selectedId: null, chosenId: null, right: 'BOTH' };

const VIEW_KEY = 'slayer_compass_view';

function readView(): CompassView {
  if (typeof sessionStorage === 'undefined') return view;
  try {
    const raw = JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null') as Partial<CompassView> | null;
    if (!raw || typeof raw !== 'object') return view;
    return {
      ...view,
      sleeve: raw.sleeve === 'weekly' || raw.sleeve === 'odte' || raw.sleeve === 'swing' ? raw.sleeve : view.sleeve,
      layout: raw.layout === 'table' ? 'table' : 'cards',
      tickerFilter: typeof raw.tickerFilter === 'string' ? raw.tickerFilter : null,
      selectedId: typeof raw.selectedId === 'string' ? raw.selectedId : null,
      chosenId: typeof raw.chosenId === 'string' ? raw.chosenId : null,
      right: raw.right === 'C' || raw.right === 'P' ? raw.right : 'BOTH',
    };
  } catch {
    return view;
  }
}

view = readView();

const subs = new Set<() => void>();

export const setCompassView = (patch: Partial<CompassView>): void => {
  view = { ...view, ...patch };
  try { sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch { /* the view still holds this tab */ }
  subs.forEach(fn => fn());
};

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const get = () => view;

export const useCompassView = (): CompassView => useSyncExternalStore(subscribe, get, get);
