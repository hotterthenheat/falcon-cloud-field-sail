/* Which scripts sit on each pane, with their settings, as one reactive store the chart, the library and the
   toolbar all read. */

import { useSyncExternalStore } from 'react';
import type { Bar } from '../core/pine';
import type { ChartScript, PaneId, Script, ScriptInputValue } from '../types/scripts';
import { scriptStore } from './scriptStore';

export interface PaneScript {
  chart: ChartScript;
  script: Script;
}

const EMPTY: PaneScript[] = [];
const snapshots = new Map<PaneId, PaneScript[]>();
const listeners = new Map<PaneId, Set<() => void>>();
const loading = new Set<PaneId>();

const notify = (paneId: PaneId) => listeners.get(paneId)?.forEach(fn => fn());

/** Re-read a pane from the store and tell every reader */
export async function refreshPane(paneId: PaneId): Promise<void> {
  const rows = await scriptStore.onPane(paneId);
  const out: PaneScript[] = [];
  for (const chart of rows) {
    const script = await scriptStore.get(chart.scriptId);
    if (script) out.push({ chart, script });
    else await scriptStore.lift(chart.id);
  }
  snapshots.set(paneId, out);
  notify(paneId);
}

function subscribe(paneId: PaneId, fn: () => void): () => void {
  let set = listeners.get(paneId);
  if (!set) {
    set = new Set();
    listeners.set(paneId, set);
  }
  set.add(fn);
  if (!snapshots.has(paneId) && !loading.has(paneId)) {
    loading.add(paneId);
    refreshPane(paneId).finally(() => loading.delete(paneId));
  }
  return () => {
    set!.delete(fn);
  };
}

/** The scripts on a pane, live; an empty list until the store answers or when no pane is named */
export function usePaneScripts(paneId?: PaneId): PaneScript[] {
  return useSyncExternalStore(
    fn => (paneId ? subscribe(paneId, fn) : () => {}),
    () => (paneId ? (snapshots.get(paneId) ?? EMPTY) : EMPTY),
    () => EMPTY
  );
}

export async function placeOnPane(paneId: PaneId, scriptId: string, inputs?: Record<string, ScriptInputValue>): Promise<ChartScript> {
  const cs = await scriptStore.place(paneId, scriptId, inputs);
  await refreshPane(paneId);
  return cs;
}

export async function liftFromPane(paneId: PaneId, chartScriptId: string): Promise<void> {
  await scriptStore.lift(chartScriptId);
  await refreshPane(paneId);
}

export async function updateOnPane(paneId: PaneId, chartScript: ChartScript): Promise<void> {
  await scriptStore.update(chartScript);
  await refreshPane(paneId);
}

/** After a script is saved, copied or removed, every pane that carries it re-reads */
export async function refreshEveryPane(): Promise<void> {
  await Promise.all([...snapshots.keys()].map(refreshPane));
}

/* ---- the pane's bars, for the editor's status line -------------------------------- */

const paneBars = new Map<PaneId, { bars: Bar[]; ticker: string; timeframe: string }>();

export function setPaneBars(paneId: PaneId, bars: Bar[], ticker: string, timeframe: string): void {
  paneBars.set(paneId, { bars, ticker, timeframe });
}

export function getPaneBars(paneId: PaneId): { bars: Bar[]; ticker: string; timeframe: string } | undefined {
  return paneBars.get(paneId);
}

/* ---- the library's own refresh ------------------------------------------------------- */

let libraryVersion = 0;
const librarySubs = new Set<() => void>();
export function bumpLibrary(): void {
  libraryVersion++;
  librarySubs.forEach(fn => fn());
}
/** A number that moves whenever a script is saved, copied, removed or favourited — the library re-lists on it */
export function useLibraryVersion(): number {
  return useSyncExternalStore(
    fn => {
      librarySubs.add(fn);
      return () => librarySubs.delete(fn);
    },
    () => libraryVersion,
    () => 0
  );
}
