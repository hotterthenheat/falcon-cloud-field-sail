/* SYNC DRAWINGS (TradingView's): every chart on the page showing the same tape hears when its drawings change, and takes
   the stored set — so a mark drawn in one pane of a layout appears at once in the others on that symbol, and a pane
   holding a stale list can never write it back over a newer one. The reader can turn it off (the rail's switch): then
   each pane keeps its own drawings under its own key. */

import { useSyncExternalStore } from 'react';

type Hear = (key: string) => void;
const ears = new Set<Hear>();

/** A tape's stored drawings changed (drawingsPrimitive.saveDrawings calls this) */
export function publishDrawings(key: string): void {
  ears.forEach(fn => {
    try {
      fn(key);
    } catch {
      /* one pane's trouble is not the others' */
    }
  });
}
export function hearDrawings(fn: Hear): () => void {
  ears.add(fn);
  return () => {
    ears.delete(fn);
  };
}

// ---- the switch -------------------------------------------------------------------------------------

const KEY = 'slayer_draw_sync_v1';
let on: boolean = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();
const subs = new Set<() => void>();
export const drawSyncOn = (): boolean => on;
export function setDrawSync(next: boolean): void {
  on = next;
  try {
    localStorage.setItem(KEY, next ? 'on' : 'off');
  } catch {
    /* storage off — the choice lives for the session */
  }
  subs.forEach(fn => fn());
}
const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
export const useDrawSync = (): boolean => useSyncExternalStore(subscribe, drawSyncOn, drawSyncOn);

/** The key a pane's drawings are kept under: the tape's own when synced, the pane's own when not */
export const drawingsKey = (tapeKey: string, paneId: string | undefined, sync: boolean): string => (sync || !paneId ? tapeKey : `${tapeKey}#${paneId}`);
