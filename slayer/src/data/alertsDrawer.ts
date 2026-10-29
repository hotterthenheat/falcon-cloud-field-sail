/*
  Whether the alerts drawer is open: one flag the sidebar's bell flips and the drawer reads.
*/

import { useSyncExternalStore } from 'react';

let open = false;
const subs = new Set<() => void>();
const notify = () => subs.forEach(fn => fn());

export const openAlertsDrawer = (): void => {
  if (open) return;
  open = true;
  notify();
};

export const closeAlertsDrawer = (): void => {
  if (!open) return;
  open = false;
  notify();
};

export const toggleAlertsDrawer = (): void => (open ? closeAlertsDrawer() : openAlertsDrawer());

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
const get = () => open;

export const useAlertsDrawer = (): boolean => useSyncExternalStore(subscribe, get, get);
