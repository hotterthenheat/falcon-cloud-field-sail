import { useSyncExternalStore, type ReactNode } from 'react';

/*
  A value that changes at pointer rate, held outside React state.

  A hover read (the bar under the crosshair, the bead or rung under the pointer) written to a component's state
  re-renders that component on every change — for the chart and the pane that meant the toolbar, the rail and the
  chart's whole tree, many times a second. A cell re-renders only what reads it: `<CellView>` or `useCell`.
*/
export interface Cell<T> {
  get: () => T;
  /** Same-value writes (Object.is) notify nobody — a functional update can return `prev` to bail out */
  set: (next: T | ((prev: T) => T)) => void;
  subscribe: (fn: () => void) => () => void;
}

export function makeCell<T>(initial: T): Cell<T> {
  let cur = initial;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set: next => {
      const v = typeof next === 'function' ? (next as (prev: T) => T)(cur) : next;
      if (Object.is(v, cur)) return;
      cur = v;
      subs.forEach(fn => fn());
    },
    subscribe: fn => {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
}

export const useCell = <T,>(cell: Cell<T>): T => useSyncExternalStore(cell.subscribe, cell.get);

/** Renders `children(value)` and re-renders on the cell alone. The render function is the parent's latest, so it can
    read the parent's props and refs as they stand. */
export function CellView<T>({ cell, children }: { cell: Cell<T>; children: (value: T) => ReactNode }) {
  const v = useCell(cell);
  return <>{children(v)}</>;
}
